"""
modules/transactions/bank_cash_v1.py
====================================
Backend Cash & Bank: /api/v1/transactions/bank-cash/...

Frontend (src/lib/bankCashStore.ts) memanggil prefix ini; tanpa router ini semua
request jadi 404 ("Not Found" di halaman Source Data).

FASE 1 (file ini) -- cukup untuk tab Source Data & Bank Mapping bekerja:
  GET  /accounts                      akun kas/bank dari COA klien
  GET/POST/PUT/DELETE /bank-mappings  mapping bank/rekening -> akun COA
  GET/PUT/DELETE /import-templates    template ekstraksi (tabel migration 36)
  POST /statements/preview            baca file TANPA menyimpan
  POST /statements/upload             baca + simpan statement & mutasi
  GET  /statements, DELETE /statements/{id}
  GET  /mutations, POST /mutations/{id}/review|ignore|restore, DELETE /mutations/{id}
  GET  /overview

FASE 2 (BELUM dibuat -- endpoint mengembalikan 501 NOT_IMPLEMENTED / list kosong):
  matching mutasi ke invoice, saran pencocokan, transaksi Cash Payment/Receipt,
  approve/post/reverse (jurnal), open-invoices. Butuh tabel transaksi + aturan posting
  jurnal yang harus diputuskan bersama dulu.

Tabel baru (dibuat otomatis sekali saat endpoint pertama dipanggil, atau lewat
migrations/37-create_bank_cash_statements_and_mutations.py):
  financial_transaction_bank_cash_statements
  financial_transaction_bank_cash_mutations
Tabel template & bank mapping memakai tabel dari migration 36.

Konvensi: client_id di API ini = management_clients.id. debit = uang KELUAR,
credit = uang MASUK (sesuai rekening koran).
"""

from __future__ import annotations

import functools
import hashlib
import json
import re
import uuid
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.concurrency import run_in_threadpool

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from . import bank_statement_parser as bsp
from .sales_v1 import _require_level_v1

logger = get_module_logger("transactions_bank_cash_v1")

router = APIRouter(prefix="/api/v1/transactions/bank-cash", tags=["transactions-bank-cash-v1"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024
T_STMT = "financial_transaction_bank_cash_statements"
T_MUT = "financial_transaction_bank_cash_mutations"
T_TPL = "financial_transaction_bank_cash_import_templates"
T_MAP = "financial_transaction_bank_cash_bank_mappings"

DDL: List[str] = [
    f"""CREATE TABLE IF NOT EXISTS {T_STMT} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES management_clients(id),
        bank_coa_id UUID NOT NULL REFERENCES management_client_coa(id),
        file_name VARCHAR(255) NOT NULL,
        file_type VARCHAR(20),
        file_hash VARCHAR(64),
        period_start DATE, period_end DATE,
        opening_balance NUMERIC(20,2), closing_balance NUMERIC(20,2),
        total_debit NUMERIC(20,2) NOT NULL DEFAULT 0,
        total_credit NUMERIC(20,2) NOT NULL DEFAULT 0,
        line_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
        extraction_method VARCHAR(20),
        template_id UUID REFERENCES {T_TPL}(id),
        validation JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by UUID, created_by_name VARCHAR(255),
        deleted_at TIMESTAMPTZ, deleted_by UUID
    )""",
    f"CREATE INDEX IF NOT EXISTS idx_bc_stmt_client ON {T_STMT} (client_id) WHERE deleted_at IS NULL",
    f"CREATE INDEX IF NOT EXISTS idx_bc_stmt_hash ON {T_STMT} (client_id, bank_coa_id, file_hash)",
    f"""CREATE TABLE IF NOT EXISTS {T_MUT} (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id UUID NOT NULL REFERENCES management_clients(id),
        statement_id UUID NOT NULL REFERENCES {T_STMT}(id),
        bank_coa_id UUID NOT NULL REFERENCES management_client_coa(id),
        line_no INTEGER NOT NULL,
        mutation_date DATE NOT NULL,
        description TEXT,
        debit NUMERIC(20,2) NOT NULL DEFAULT 0,
        credit NUMERIC(20,2) NOT NULL DEFAULT 0,
        balance_after NUMERIC(20,2),
        status VARCHAR(20) NOT NULL DEFAULT 'unmatched',
        ignore_reason TEXT,
        matched_tx_id UUID,
        row_hash VARCHAR(64),
        confidence VARCHAR(10),
        confidence_notes JSONB NOT NULL DEFAULT '[]'::jsonb,
        page_no INTEGER,
        reviewed_at TIMESTAMPTZ, reviewed_by UUID, reviewed_by_name VARCHAR(255),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        deleted_at TIMESTAMPTZ, deleted_by UUID
    )""",
    f"CREATE INDEX IF NOT EXISTS idx_bc_mut_client ON {T_MUT} (client_id, bank_coa_id, mutation_date) WHERE deleted_at IS NULL",
    f"CREATE INDEX IF NOT EXISTS idx_bc_mut_stmt ON {T_MUT} (statement_id)",
    f"CREATE INDEX IF NOT EXISTS idx_bc_mut_hash ON {T_MUT} (client_id, bank_coa_id, row_hash)",
]

_TABEL_SIAP = False


class _Err(Exception):
    def __init__(self, msg: str, code: str = "ERROR", status: int = 400):
        super().__init__(msg)
        self.msg, self.code, self.status = msg, code, status


def pastikan_tabel() -> None:
    """Buat 2 tabel baru kalau belum ada (idempoten) + cek tabel migration 36."""
    global _TABEL_SIAP
    if _TABEL_SIAP:
        return
    with dbc.engine.begin() as conn:
        for t in (T_TPL, T_MAP):
            if conn.execute(text("SELECT to_regclass(:t)"), {"t": f"public.{t}"}).scalar() is None:
                raise _Err(
                    f"Tabel {t} belum ada. Jalankan dulu migrations/36-create_bank_cash_import_templates_and_bank_mappings.py.",
                    "MIGRATION_36_MISSING", 500,
                )
        for stmt in DDL:
            conn.execute(text(stmt))
    _TABEL_SIAP = True


def _tangani(fn):
    @functools.wraps(fn)
    def pembungkus(*a, **k):
        try:
            return fn(*a, **k)
        except _Err as e:
            return gagal(e.msg, {"code": e.code}, e.status)
        except Exception as e:  # noqa: BLE001
            logger.exception("bank_cash_v1 error")
            return gagal(f"Kesalahan server: {e}", {"code": "SERVER_ERROR"}, 500)
    return pembungkus


# ============================================================
# Util
# ============================================================

def _uuid(v: Any, nama: str) -> str:
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, AttributeError, TypeError):
        raise _Err(f"{nama} tidak valid.", "INVALID_ID", 400)


def _num(v: Any) -> Optional[float]:
    return None if v is None else float(v)


def _iso(v: Any) -> Optional[str]:
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def _nama_user(u: Dict[str, Any]) -> Optional[str]:
    return u.get("nama") or u.get("nama_user") or u.get("username")


def _client_code(s, cid: str) -> str:
    row = s.execute(text("SELECT client_code FROM management_clients WHERE id = :c"), {"c": cid}).first()
    if row is None:
        raise _Err("Klien tidak ditemukan.", "CLIENT_NOT_FOUND", 404)
    return row[0] or ""


def _cash_type(nama: str, sub: Optional[str]) -> str:
    n = (nama or "").lower()
    if "petty" in n or "kas kecil" in n:
        return "petty_cash"
    if "transit" in n:
        return "transit"
    if re.search(r"\b(kas|cash)\b", n) and "bank" not in n:
        return "cash_on_hand"
    return "bank"


_SQL_AKUN_KAS = """
SELECT id::text AS id, acc_no, account_name, account_classification, account_sub, is_active
FROM management_client_coa
WHERE client_id = :c AND deleted_at IS NULL AND is_active = true
  AND account_classification = 'ASSET'
  AND (account_sub ILIKE '%cash%' OR standard_account_code ILIKE '%cash%'
       OR account_name ILIKE '%kas%' OR account_name ILIKE '%bank%' OR account_name ILIKE '%cash%')
ORDER BY acc_no
"""


def _akun_kas(s, cid: str) -> List[Dict[str, Any]]:
    out = []
    for r in s.execute(text(_SQL_AKUN_KAS), {"c": cid}).mappings():
        out.append({
            "id": r["id"], "code": r["acc_no"], "name": r["account_name"],
            "classification": r["account_classification"], "sub": r["account_sub"],
            "cash_type": _cash_type(r["account_name"], r["account_sub"]), "is_active": bool(r["is_active"]),
        })
    return out


def _akun_milik_klien(s, cid: str, coa_id: str) -> Dict[str, Any]:
    r = s.execute(
        text("SELECT id::text AS id, acc_no, account_name FROM management_client_coa WHERE id = :i AND client_id = :c AND deleted_at IS NULL"),
        {"i": coa_id, "c": cid},
    ).mappings().first()
    if r is None:
        raise _Err("Akun kas/bank tidak ditemukan di COA klien ini.", "INVALID_BANK_ACCOUNT", 400)
    return {"id": r["id"], "code": r["acc_no"], "name": r["account_name"]}


# ============================================================
# Template & bank mapping
# ============================================================

def _tpl_row(r) -> Dict[str, Any]:
    mr = r["mapping_rules"] or {}
    return {
        "id": r["id"], "template_name": r["template_name"], "file_type": r["file_type"],
        "header_columns": r["header_columns"] or [], "mapping_rules": mr,
        "method": mr.get("method"), "bank_name": mr.get("bank_name"),
        "detected_by": "manual" if (r["detected_by"] or "") == "manual" else "auto",
        "verified_pct": None, "is_active": bool(r["is_active"]), "usage_count": r["usage_count"] or 0,
        "last_used_at": _iso(r["last_used_at"]), "created_at": _iso(r["created_at"]), "edited_at": _iso(r["edited_at"]),
    }


_SQL_TPL = f"""
SELECT id::text AS id, template_name, file_type, header_columns, mapping_rules, detected_by, is_active,
       usage_count, last_used_at, created_at, edited_at
FROM {T_TPL} WHERE client_id = :c AND deleted_at IS NULL ORDER BY created_at DESC
"""


def _kandidat_template(s, cid: str, tipe: str) -> List[Dict[str, Any]]:
    """Template aktif milik klien -> kandidat untuk parser. Baris 'Multi' dipecah per varian (file_type varian)."""
    out: List[Dict[str, Any]] = []
    for r in s.execute(text(_SQL_TPL), {"c": cid}).mappings():
        if not r["is_active"]:
            continue
        mr = r["mapping_rules"] or {}
        if (r["file_type"] or "").lower() == "multi":
            for v in mr.get("variants") or []:
                if (v.get("file_type") or "").lower() == tipe.lower():
                    out.append({
                        "id": r["id"], "name": v.get("variant_name") or r["template_name"],
                        "header_columns": v.get("header_columns") or [], "rules": v.get("mapping_rules") or {},
                    })
        elif (r["file_type"] or "").lower() == tipe.lower():
            out.append({"id": r["id"], "name": r["template_name"], "header_columns": r["header_columns"] or [], "rules": mr})
    return out


_SQL_MAP = f"""
SELECT m.id::text AS id, m.bank_name, m.account_number, m.match_keyword, m.bank_coa_id::text AS bank_coa_id,
       c.acc_no AS bank_account_code, c.account_name AS bank_account_name, m.template_id::text AS template_id,
       t.template_name, m.notes, m.is_active, m.usage_count, m.last_used_at, m.created_at, m.edited_at
FROM {T_MAP} m
JOIN management_client_coa c ON c.id = m.bank_coa_id
LEFT JOIN {T_TPL} t ON t.id = m.template_id
WHERE m.client_id = :c AND m.deleted_at IS NULL {{extra}}
ORDER BY m.bank_name, m.account_number
"""


def _map_row(r) -> Dict[str, Any]:
    return {
        "id": r["id"], "bank_name": r["bank_name"], "account_number": r["account_number"], "match_keyword": r["match_keyword"],
        "bank_coa_id": r["bank_coa_id"], "bank_account_code": r["bank_account_code"], "bank_account_name": r["bank_account_name"],
        "template_id": r["template_id"], "template_name": r["template_name"], "notes": r["notes"],
        "is_active": bool(r["is_active"]), "usage_count": r["usage_count"] or 0,
        "last_used_at": _iso(r["last_used_at"]), "created_at": _iso(r["created_at"]), "edited_at": _iso(r["edited_at"]),
    }


def _daftar_mapping(s, cid: str, hanya_id: Optional[str] = None) -> List[Dict[str, Any]]:
    extra = "AND m.id = :mid" if hanya_id else ""
    par = {"c": cid, **({"mid": hanya_id} if hanya_id else {})}
    return [_map_row(r) for r in s.execute(text(_SQL_MAP.format(extra=extra)), par).mappings()]


def _cari_mapping(mappings: List[Dict[str, Any]], ex: Dict[str, Any], template_id: Optional[str]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Urutan prioritas sama dengan docstring BankCashBankMapping: no. rekening -> keyword -> template -> nama bank."""
    aktif = [m for m in mappings if m["is_active"]]
    teks = (ex["blob"] + "\n" + ex["filename"])
    runs = {re.sub(r"\D", "", x) for x in re.findall(r"\d[\d .\-]{5,28}\d", teks)} | set(re.findall(r"\d{6,}", teks))
    for m in aktif:
        nomor = re.sub(r"\D", "", m["account_number"] or "")
        if nomor and any(nomor in run for run in runs):
            return m, "account_number"
    low = teks.lower()
    for m in aktif:
        if m["match_keyword"] and m["match_keyword"].lower() in low:
            return m, "keyword"
    if template_id:
        for m in aktif:
            if m["template_id"] == template_id:
                return m, "template"
    nama = (ex.get("bank_name") or "").lower()
    if nama:
        sama = [m for m in aktif if m["bank_name"].lower() == nama]
        if len(sama) == 1:
            return sama[0], "bank_name"
    return None, None


# ============================================================
# Persiapan baca file (dipakai preview & upload)
# ============================================================

def _siapkan(s, cid: str, content: bytes, filename: str, bank_coa_id: Optional[str], rules_user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    tipe = bsp.deteksi_tipe(filename)
    kandidat = _kandidat_template(s, cid, tipe)
    try:
        ex = bsp.ekstrak_rekening_koran(content, filename, rules_user, kandidat)
    except bsp.ParserError as e:
        raise _Err(e.message, e.code, 422)
    tpl = ex["template"]
    mappings = _daftar_mapping(s, cid)
    mapping, match_by = _cari_mapping(mappings, ex, tpl["id"] if tpl else None)

    akun = None
    konflik = False
    if bank_coa_id:
        akun = _akun_milik_klien(s, cid, _uuid(bank_coa_id, "Akun kas/bank"))
        konflik = bool(mapping and mapping["bank_coa_id"] != akun["id"])
    elif mapping:
        akun = {"id": mapping["bank_coa_id"], "code": mapping["bank_account_code"], "name": mapping["bank_account_name"]}

    file_hash = hashlib.sha256(content).hexdigest()
    sudah = None
    ada_hash = set()
    if akun:
        r = s.execute(
            text(f"SELECT created_at FROM {T_STMT} WHERE client_id = :c AND bank_coa_id = :b AND file_hash = :h AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1"),
            {"c": cid, "b": akun["id"], "h": file_hash},
        ).first()
        sudah = _iso(r[0]) if r else None
        bsp.beri_hash(akun["id"], ex["records"])
        if ex["records"]:
            tg = [r["date"] for r in ex["records"] if r["date"]]
            if tg:
                ada_hash = {
                    x[0] for x in s.execute(
                        text(f"SELECT row_hash FROM {T_MUT} WHERE client_id = :c AND bank_coa_id = :b AND deleted_at IS NULL AND mutation_date BETWEEN :a AND :z"),
                        {"c": cid, "b": akun["id"], "a": min(tg), "z": max(tg)},
                    )
                }
    return {
        "ex": ex, "akun": akun, "mapping": mapping, "match_by": match_by, "konflik": konflik,
        "file_hash": file_hash, "sudah": sudah, "ada_hash": ada_hash, "tipe": tipe,
    }


def _rules_dari_form(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    if not raw:
        return None
    try:
        v = json.loads(raw)
    except ValueError:
        raise _Err("mapping_rules bukan JSON yang valid.", "INVALID_RULES", 400)
    return v if isinstance(v, dict) and v.get("columns") else None


def _validasi_json(v: Dict[str, Any]) -> Dict[str, Any]:
    return {k: (_iso(x) if isinstance(x, (date, datetime)) else x) for k, x in v.items()}


# ============================================================
# GET -- akun, template, mapping, statement, mutasi, overview
# ============================================================

@router.get("/accounts")
@_tangani
def list_accounts(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses(_akun_kas(s, cid))


@router.get("/import-templates")
@_tangani
def list_templates(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses([_tpl_row(r) for r in s.execute(text(_SQL_TPL), {"c": cid}).mappings()])


class TemplateUpdate(BaseModel):
    client_id: str
    template_name: Optional[str] = None
    is_active: Optional[bool] = None


@router.put("/import-templates/{template_id}")
@_tangani
def update_template(template_id: str, body: TemplateUpdate, user=Depends(_require_level_v1(3))):
    cid, tid = _uuid(body.client_id, "client_id"), _uuid(template_id, "template_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        sets, par = ["edited_at = now()", "edited_by = :u"], {"c": cid, "t": tid, "u": user.get("id")}
        if body.template_name is not None:
            sets.append("template_name = :n"); par["n"] = body.template_name.strip() or None
        if body.is_active is not None:
            sets.append("is_active = :a"); par["a"] = body.is_active
        n = s.execute(text(f"UPDATE {T_TPL} SET {', '.join(sets)} WHERE id = :t AND client_id = :c AND deleted_at IS NULL"), par).rowcount
        if not n:
            raise _Err("Template tidak ditemukan.", "NOT_FOUND", 404)
        s.commit()
        r = s.execute(text(_SQL_TPL.replace("ORDER BY", "AND id = :t ORDER BY")), {"c": cid, "t": tid}).mappings().first()
        return sukses(_tpl_row(r), "Template diperbarui.")


@router.delete("/import-templates/{template_id}")
@_tangani
def delete_template(template_id: str, client_id: str = Query(...), user=Depends(_require_level_v1(3))):
    cid, tid = _uuid(client_id, "client_id"), _uuid(template_id, "template_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        pakai = s.execute(text(f"SELECT count(*) FROM {T_MAP} WHERE template_id = :t AND deleted_at IS NULL"), {"t": tid}).scalar()
        if pakai:
            raise _Err(f"Template masih dipakai {pakai} bank mapping -- lepas dulu dari mapping.", "TEMPLATE_IN_USE", 409)
        n = s.execute(
            text(f"UPDATE {T_TPL} SET deleted_at = now(), deleted_by = :u, is_active = false WHERE id = :t AND client_id = :c AND deleted_at IS NULL"),
            {"t": tid, "c": cid, "u": user.get("id")},
        ).rowcount
        if not n:
            raise _Err("Template tidak ditemukan.", "NOT_FOUND", 404)
        s.commit()
        return sukses({"id": tid}, "Template dihapus.")


@router.get("/bank-mappings")
@_tangani
def list_bank_mappings(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses(_daftar_mapping(s, cid))


class MappingInput(BaseModel):
    client_id: str
    bank_name: str
    bank_coa_id: str
    account_number: Optional[str] = None
    match_keyword: Optional[str] = None
    template_id: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = True


def _bersih(v: Optional[str]) -> Optional[str]:
    v = (v or "").strip()
    return v or None


def _simpan_mapping(s, user, body: MappingInput, mid: Optional[str]) -> Dict[str, Any]:
    cid = _uuid(body.client_id, "client_id")
    akun = _akun_milik_klien(s, cid, _uuid(body.bank_coa_id, "Akun kas/bank"))
    nama = (body.bank_name or "").strip()
    if not nama:
        raise _Err("Nama bank wajib diisi.", "VALIDATION", 400)
    nomor = re.sub(r"\s+", "", body.account_number or "") or None
    tpl = _uuid(body.template_id, "template_id") if body.template_id else None
    par = {
        "c": cid, "n": nama, "a": nomor, "k": _bersih(body.match_keyword), "b": akun["id"], "t": tpl,
        "no": _bersih(body.notes), "ac": True if body.is_active is None else bool(body.is_active), "u": user.get("id"),
    }
    try:
        if mid:
            n = s.execute(
                text(f"""UPDATE {T_MAP} SET bank_name=:n, account_number=:a, match_keyword=:k, bank_coa_id=:b, template_id=:t,
                         notes=:no, is_active=:ac, edited_at=now(), edited_by=:u WHERE id=:id AND client_id=:c AND deleted_at IS NULL"""),
                {**par, "id": mid},
            ).rowcount
            if not n:
                raise _Err("Mapping tidak ditemukan.", "NOT_FOUND", 404)
            out_id = mid
        else:
            par["code"] = _client_code(s, cid)
            out_id = s.execute(
                text(f"""INSERT INTO {T_MAP} (client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id,
                         template_id, notes, is_active, created_by) VALUES (:c, :code, :n, :a, :k, :b, :t, :no, :ac, :u) RETURNING id::text"""),
                par,
            ).scalar()
        s.commit()
    except IntegrityError:
        s.rollback()
        raise _Err("Nomor rekening ini sudah dipakai mapping lain.", "DUPLICATE_ACCOUNT_NUMBER", 409)
    return _daftar_mapping(s, cid, out_id)[0]


@router.post("/bank-mappings")
@_tangani
def create_bank_mapping(body: MappingInput, user=Depends(_require_level_v1(3))):
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses(_simpan_mapping(s, user, body, None), "Mapping bank dibuat.", 201)


@router.put("/bank-mappings/{mapping_id}")
@_tangani
def update_bank_mapping(mapping_id: str, body: MappingInput, user=Depends(_require_level_v1(3))):
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses(_simpan_mapping(s, user, body, _uuid(mapping_id, "mapping_id")), "Mapping bank diperbarui.")


@router.delete("/bank-mappings/{mapping_id}")
@_tangani
def delete_bank_mapping(mapping_id: str, client_id: str = Query(...), user=Depends(_require_level_v1(3))):
    cid, mid = _uuid(client_id, "client_id"), _uuid(mapping_id, "mapping_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        n = s.execute(
            text(f"UPDATE {T_MAP} SET deleted_at = now(), deleted_by = :u, is_active = false WHERE id = :i AND client_id = :c AND deleted_at IS NULL"),
            {"i": mid, "c": cid, "u": user.get("id")},
        ).rowcount
        if not n:
            raise _Err("Mapping tidak ditemukan.", "NOT_FOUND", 404)
        s.commit()
        return sukses({"id": mid}, "Mapping dihapus.")


_SQL_STMT = f"""
SELECT s.id::text AS id, s.bank_coa_id::text AS bank_coa_id, c.acc_no AS bank_account_code, c.account_name AS bank_account_name,
       s.file_name, s.file_type, s.period_start, s.period_end, s.opening_balance, s.closing_balance, s.total_debit, s.total_credit,
       s.line_count, s.duplicate_count, s.warnings, s.extraction_method, s.template_id::text AS template_id, t.template_name,
       s.validation, s.created_at, s.created_by_name,
       COALESCE(m.matched, 0) AS matched_count, COALESCE(m.unmatched, 0) AS unmatched_count,
       COALESCE(m.ignored, 0) AS ignored_count, COALESCE(m.low, 0) AS low_confidence_count
FROM {T_STMT} s
JOIN management_client_coa c ON c.id = s.bank_coa_id
LEFT JOIN {T_TPL} t ON t.id = s.template_id
LEFT JOIN (
    SELECT statement_id,
           count(*) FILTER (WHERE status = 'matched') AS matched,
           count(*) FILTER (WHERE status = 'unmatched') AS unmatched,
           count(*) FILTER (WHERE status = 'ignored') AS ignored,
           count(*) FILTER (WHERE status = 'unmatched' AND confidence = 'low') AS low
    FROM {T_MUT} WHERE deleted_at IS NULL GROUP BY statement_id
) m ON m.statement_id = s.id
WHERE s.client_id = :c AND s.deleted_at IS NULL {{extra}}
ORDER BY s.created_at DESC
"""


def _stmt_row(r) -> Dict[str, Any]:
    return {
        "id": r["id"], "bank_coa_id": r["bank_coa_id"], "bank_account_code": r["bank_account_code"],
        "bank_account_name": r["bank_account_name"], "file_name": r["file_name"],
        "period_start": _iso(r["period_start"]), "period_end": _iso(r["period_end"]),
        "opening_balance": _num(r["opening_balance"]), "closing_balance": _num(r["closing_balance"]),
        "total_debit": float(r["total_debit"] or 0), "total_credit": float(r["total_credit"] or 0),
        "line_count": r["line_count"], "duplicate_count": r["duplicate_count"],
        "matched_count": r["matched_count"], "unmatched_count": r["unmatched_count"], "ignored_count": r["ignored_count"],
        "warnings": r["warnings"] or [], "created_at": _iso(r["created_at"]), "created_by_name": r["created_by_name"],
        "file_type": r["file_type"], "extraction_method": r["extraction_method"], "template_id": r["template_id"],
        "template_name": r["template_name"], "validation": r["validation"], "low_confidence_count": r["low_confidence_count"],
    }


@router.get("/statements")
@_tangani
def list_statements(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        return sukses([_stmt_row(r) for r in s.execute(text(_SQL_STMT.format(extra="")), {"c": cid}).mappings()])


@router.delete("/statements/{statement_id}")
@_tangani
def delete_statement(statement_id: str, client_id: str = Query(...), user=Depends(_require_level_v1(3))):
    cid, sid = _uuid(client_id, "client_id"), _uuid(statement_id, "statement_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        ada = s.execute(text(f"SELECT 1 FROM {T_STMT} WHERE id = :i AND client_id = :c AND deleted_at IS NULL"), {"i": sid, "c": cid}).first()
        if not ada:
            raise _Err("Statement tidak ditemukan.", "NOT_FOUND", 404)
        cocok = s.execute(text(f"SELECT count(*) FROM {T_MUT} WHERE statement_id = :i AND status = 'matched' AND deleted_at IS NULL"), {"i": sid}).scalar()
        if cocok:
            raise _Err(f"{cocok} mutasi sudah dicocokkan ke transaksi -- lepas pencocokannya dulu sebelum menghapus statement.", "HAS_MATCHED", 409)
        par = {"i": sid, "u": user.get("id")}
        s.execute(text(f"UPDATE {T_MUT} SET deleted_at = now(), deleted_by = :u WHERE statement_id = :i AND deleted_at IS NULL"), par)
        s.execute(text(f"UPDATE {T_STMT} SET deleted_at = now(), deleted_by = :u WHERE id = :i"), par)
        s.commit()
        return sukses({"id": sid}, "Statement dihapus.")


_SQL_MUT = f"""
SELECT m.id::text AS id, m.statement_id::text AS statement_id, m.bank_coa_id::text AS bank_coa_id,
       c.acc_no AS bank_account_code, c.account_name AS bank_account_name, m.line_no, m.mutation_date, m.description,
       m.debit, m.credit, m.balance_after, m.status, m.ignore_reason, s.file_name, m.confidence, m.confidence_notes,
       m.page_no, m.reviewed_at, m.reviewed_by_name
FROM {T_MUT} m
JOIN {T_STMT} s ON s.id = m.statement_id
JOIN management_client_coa c ON c.id = m.bank_coa_id
WHERE m.client_id = :c AND m.deleted_at IS NULL {{extra}}
ORDER BY m.mutation_date, s.created_at, m.line_no
LIMIT 20000
"""


def _mut_row(r) -> Dict[str, Any]:
    return {
        "id": r["id"], "statement_id": r["statement_id"], "bank_coa_id": r["bank_coa_id"],
        "bank_account_code": r["bank_account_code"], "bank_account_name": r["bank_account_name"],
        "line_no": r["line_no"], "date": _iso(r["mutation_date"]), "description": r["description"],
        "debit": float(r["debit"] or 0), "credit": float(r["credit"] or 0), "balance_after": _num(r["balance_after"]),
        "status": r["status"], "ignore_reason": r["ignore_reason"], "file_name": r["file_name"],
        "confidence": r["confidence"], "confidence_notes": r["confidence_notes"] or [], "page_no": r["page_no"],
        "reviewed_at": _iso(r["reviewed_at"]), "reviewed_by_name": r["reviewed_by_name"],
        "transaction": None,  # fase 2: relasi ke transaksi Cash Payment/Receipt
    }


@router.get("/mutations")
@_tangani
def list_mutations(
    client_id: str = Query(...), status: Optional[str] = Query(None),
    bank_coa_id: Optional[str] = Query(None), statement_id: Optional[str] = Query(None),
    user=Depends(get_current_user_v1),
):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    extra, par = [], {"c": cid}
    if status:
        if status not in ("unmatched", "matched", "ignored"):
            raise _Err("status tidak valid.", "VALIDATION", 400)
        extra.append("AND m.status = :st"); par["st"] = status
    if bank_coa_id:
        extra.append("AND m.bank_coa_id = :b"); par["b"] = _uuid(bank_coa_id, "bank_coa_id")
    if statement_id:
        extra.append("AND m.statement_id = :s"); par["s"] = _uuid(statement_id, "statement_id")
    with dbc.SessionLocal() as s:
        return sukses([_mut_row(r) for r in s.execute(text(_SQL_MUT.format(extra=" ".join(extra))), par).mappings()])


class ReviewInput(BaseModel):
    client_id: str
    mutation_date: Optional[str] = None
    description: Optional[str] = None
    debit: Optional[float] = None
    credit: Optional[float] = None
    balance_after: Optional[float] = None


class IgnoreInput(BaseModel):
    client_id: str
    reason: Optional[str] = None


class ClientOnly(BaseModel):
    client_id: str


def _ambil_mutasi(s, cid: str, mid: str, kunci: bool = True) -> Dict[str, Any]:
    r = s.execute(
        text(f"SELECT id::text AS id, status FROM {T_MUT} WHERE id = :i AND client_id = :c AND deleted_at IS NULL" + (" FOR UPDATE" if kunci else "")),
        {"i": mid, "c": cid},
    ).mappings().first()
    if r is None:
        raise _Err("Mutasi tidak ditemukan.", "NOT_FOUND", 404)
    return dict(r)


def _mut_balik(s, cid: str, mid: str) -> Dict[str, Any]:
    return _mut_row(s.execute(text(_SQL_MUT.format(extra="AND m.id = :mid")), {"c": cid, "mid": mid}).mappings().first())


@router.post("/mutations/{mutation_id}/review")
@_tangani
def review_mutation(mutation_id: str, body: ReviewInput, user=Depends(_require_level_v1(3))):
    cid, mid = _uuid(body.client_id, "client_id"), _uuid(mutation_id, "mutation_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        m = _ambil_mutasi(s, cid, mid)
        if m["status"] == "matched":
            raise _Err("Mutasi yang sudah dicocokkan tidak bisa diedit -- lepas pencocokan dulu.", "ALREADY_MATCHED", 409)
        sets, par = ["reviewed_at = now()", "reviewed_by = :u", "reviewed_by_name = :un", "confidence = 'high'"], {"i": mid, "u": user.get("id"), "un": _nama_user(user)}
        if body.mutation_date:
            d = bsp.parse_tanggal(body.mutation_date)
            if d is None:
                raise _Err("Format tanggal tidak valid.", "VALIDATION", 400)
            sets.append("mutation_date = :d"); par["d"] = d
        if body.description is not None:
            sets.append("description = :ds"); par["ds"] = body.description
        if body.debit is not None or body.credit is not None:
            deb, kre = abs(body.debit or 0), abs(body.credit or 0)
            if deb and kre:
                raise _Err("Debit dan kredit tidak boleh terisi bersamaan.", "VALIDATION", 400)
            sets += ["debit = :db", "credit = :kr"]; par["db"], par["kr"] = deb, kre
        if body.balance_after is not None:
            sets.append("balance_after = :ba"); par["ba"] = body.balance_after
        s.execute(text(f"UPDATE {T_MUT} SET {', '.join(sets)} WHERE id = :i"), par)
        s.commit()
        return sukses(_mut_balik(s, cid, mid), "Mutasi ditandai sudah direview.")


@router.post("/mutations/{mutation_id}/ignore")
@_tangani
def ignore_mutation(mutation_id: str, body: IgnoreInput, user=Depends(_require_level_v1(3))):
    cid, mid = _uuid(body.client_id, "client_id"), _uuid(mutation_id, "mutation_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        m = _ambil_mutasi(s, cid, mid)
        if m["status"] == "matched":
            raise _Err("Mutasi sudah dicocokkan -- lepas pencocokan dulu.", "ALREADY_MATCHED", 409)
        s.execute(text(f"UPDATE {T_MUT} SET status = 'ignored', ignore_reason = :r WHERE id = :i"), {"i": mid, "r": _bersih(body.reason)})
        s.commit()
        return sukses({"id": mid}, "Mutasi diabaikan.")


@router.post("/mutations/{mutation_id}/restore")
@_tangani
def restore_mutation(mutation_id: str, body: ClientOnly, user=Depends(_require_level_v1(3))):
    cid, mid = _uuid(body.client_id, "client_id"), _uuid(mutation_id, "mutation_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        m = _ambil_mutasi(s, cid, mid)
        if m["status"] != "ignored":
            raise _Err("Hanya mutasi berstatus 'ignored' yang bisa dikembalikan.", "VALIDATION", 400)
        s.execute(text(f"UPDATE {T_MUT} SET status = 'unmatched', ignore_reason = NULL WHERE id = :i"), {"i": mid})
        s.commit()
        return sukses({"id": mid}, "Mutasi dikembalikan.")


@router.delete("/mutations/{mutation_id}")
@_tangani
def delete_mutation(mutation_id: str, client_id: str = Query(...), user=Depends(_require_level_v1(3))):
    cid, mid = _uuid(client_id, "client_id"), _uuid(mutation_id, "mutation_id")
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        m = _ambil_mutasi(s, cid, mid)
        if m["status"] == "matched":
            raise _Err("Mutasi sudah dicocokkan -- lepas pencocokan dulu.", "ALREADY_MATCHED", 409)
        s.execute(text(f"UPDATE {T_MUT} SET deleted_at = now(), deleted_by = :u WHERE id = :i"), {"i": mid, "u": user.get("id")})
        s.commit()
        return sukses({"id": mid}, "Mutasi dihapus.")


@router.get("/overview")
@_tangani
def overview(client_id: str = Query(...), year: Optional[int] = Query(None), user=Depends(get_current_user_v1)):
    cid = _uuid(client_id, "client_id")
    pastikan_tabel()
    thn = year or date.today().year
    with dbc.SessionLocal() as s:
        akun = _akun_kas(s, cid)
        saldo = {
            r["b"]: r for r in s.execute(
                text(f"""SELECT DISTINCT ON (bank_coa_id) bank_coa_id::text AS b, closing_balance, period_end FROM {T_STMT}
                         WHERE client_id = :c AND deleted_at IS NULL AND closing_balance IS NOT NULL
                         ORDER BY bank_coa_id, period_end DESC NULLS LAST, created_at DESC"""), {"c": cid}).mappings()
        }
        belum = {
            r["b"]: r["n"] for r in s.execute(
                text(f"SELECT bank_coa_id::text AS b, count(*) AS n FROM {T_MUT} WHERE client_id = :c AND deleted_at IS NULL AND status = 'unmatched' GROUP BY bank_coa_id"),
                {"c": cid}).mappings()
        }
        bulanan = {i: {"month": i, "cash_in": 0.0, "cash_out": 0.0} for i in range(1, 13)}
        for r in s.execute(
            text(f"""SELECT EXTRACT(MONTH FROM mutation_date)::int AS bln, sum(credit) AS masuk, sum(debit) AS keluar FROM {T_MUT}
                     WHERE client_id = :c AND deleted_at IS NULL AND status <> 'ignored' AND EXTRACT(YEAR FROM mutation_date) = :y GROUP BY 1"""),
            {"c": cid, "y": thn}).mappings():
            bulanan[r["bln"]] = {"month": r["bln"], "cash_in": float(r["masuk"] or 0), "cash_out": float(r["keluar"] or 0)}
        hitung = {"unmatched": 0, "matched": 0, "ignored": 0}
        for r in s.execute(text(f"SELECT status, count(*) AS n FROM {T_MUT} WHERE client_id = :c AND deleted_at IS NULL GROUP BY status"), {"c": cid}).mappings():
            hitung[r["status"]] = r["n"]
        out_akun = []
        for a in akun:
            sb = saldo.get(a["id"])
            out_akun.append({
                **a,
                "book_balance": 0.0,  # fase 2: dihitung dari jurnal posted
                "bank_balance": _num(sb["closing_balance"]) if sb else None,
                "bank_balance_date": _iso(sb["period_end"]) if sb else None,
                "unmatched_count": belum.get(a["id"], 0),
            })
        return sukses({
            "year": thn, "accounts": out_akun, "monthly": list(bulanan.values()),
            "pipeline": {k: {"count": 0, "amount": 0.0} for k in ("draft", "approved", "posted", "reversed")},
            "mutations": hitung,
        })


# ============================================================
# Preview & Upload rekening koran
# ============================================================

def _bangun_preview(p: Dict[str, Any], filename: str) -> Dict[str, Any]:
    ex, akun, mapping = p["ex"], p["akun"], p["mapping"]
    recs = ex["records"]
    tanpa_tgl = sum(1 for r in recs if r["date"] is None)
    sdh = sum(1 for r in recs if r.get("row_hash") and r["row_hash"] in p["ada_hash"])
    tpl = ex["template"]
    return {
        "file_name": filename, "file_type": ex["file_type"], "method": ex["method"],
        "bank_name": ex["bank_name"], "account_number": ex["account_number"],
        "bank_coa_id": akun["id"] if akun else "", "bank_account_code": (akun or {}).get("code") or "",
        "bank_account_name": (akun or {}).get("name") or "",
        "bank_mapping": ({**mapping, "match_by": p["match_by"], "conflict": p["konflik"] or None} if mapping else None),
        "period_start": _iso(ex["period_start"]), "period_end": _iso(ex["period_end"]),
        "columns": ex["columns"], "amount_mode": ex["amount_mode"], "default_direction": ex["default_direction"],
        "number_format": ex["number_format"], "date_order": ex["date_order"],
        "validation": _validasi_json(ex["validation"]), "warnings": ex["warnings"],
        "template": ({"id": tpl["id"], "name": tpl["name"], "detected_by": "auto"} if tpl else None),
        "rows": [
            {"date": _iso(r["date"]), "description": r["description"], "debit": r["debit"], "credit": r["credit"],
             "balance": r["balance"], "page": r["page"], "confidence": r["confidence"], "notes": r["notes"]}
            for r in recs[:500]
        ],
        "row_count": len(recs), "recognized": ex["recognized"], "template_matched": bool(tpl),
        "will_learn_template": bool(ex["recognized"] and not tpl and recs),
        "already_uploaded_on": p["sudah"],
        "importable": len(recs) - tanpa_tgl - sdh, "already_in_feed": sdh, "without_date": tanpa_tgl,
    }


@router.post("/statements/preview")
async def preview_statement(
    client_id: str = Form(...), file: UploadFile = File(...), bank_coa_id: Optional[str] = Form(None),
    mapping_rules: Optional[str] = Form(None), user=Depends(get_current_user_v1),
):
    try:
        cid = _uuid(client_id, "client_id")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise _Err(f"Ukuran file melebihi {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.", "FILE_TOO_LARGE", 400)
        rules = _rules_dari_form(mapping_rules)

        def kerja():
            pastikan_tabel()
            with dbc.SessionLocal() as s:
                p = _siapkan(s, cid, content, file.filename or "file", bank_coa_id or None, rules)
                return _bangun_preview(p, file.filename or "file")

        return sukses(await run_in_threadpool(kerja))
    except _Err as e:
        return gagal(e.msg, {"code": e.code}, e.status)
    except Exception as e:  # noqa: BLE001
        logger.exception("preview_statement error")
        return gagal(f"Kesalahan server: {e}", {"code": "SERVER_ERROR"}, 500)


def _rules_simpan(ex: Dict[str, Any], rules_user: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "columns": [{"header": c["header"], "role": c["role"]} for c in ex["columns"]],
        "number_format": ex["number_format"], "date_order": ex["date_order"], "default_direction": ex["default_direction"],
        "amount_mode": ex["amount_mode"], "method": ex["method"], "bank_name": ex["bank_name"],
    }


def _upload_sync(cid: str, content: bytes, filename: str, bank_coa_id: Optional[str], rules_user: Optional[Dict[str, Any]],
                 simpan_template: bool, simpan_mapping: bool, user: Dict[str, Any]) -> Dict[str, Any]:
    pastikan_tabel()
    with dbc.SessionLocal() as s:
        p = _siapkan(s, cid, content, filename, bank_coa_id, rules_user)
        ex, akun = p["ex"], p["akun"]
        if akun is None:
            raise _Err(
                "Akun kas/bank tujuan belum ditentukan: pilih akun di dropdown, atau tambahkan Bank Mapping "
                "(nomor rekening / kata kunci) supaya Auto-detect bisa memilihnya.", "BANK_ACCOUNT_REQUIRED", 400,
            )
        if not ex["recognized"]:
            raise _Err(ex["warnings"][0] if ex["warnings"] else "Format file tidak dikenali.", "NOT_RECOGNIZED", 422)
        if p["sudah"]:
            raise _Err(f"File yang sama persis sudah diupload ke akun ini pada {p['sudah'][:10]}.", "FILE_ALREADY_UPLOADED", 409)
        baru = [r for r in ex["records"] if r["date"] is not None and r["row_hash"] not in p["ada_hash"]]
        dup = sum(1 for r in ex["records"] if r.get("row_hash") and r["row_hash"] in p["ada_hash"])
        if not baru:
            raise _Err(
                "Tidak ada baris baru untuk diimport" + (f" ({dup} baris sudah ada di sistem)." if dup else " -- tidak ada baris bertanggal yang terbaca."),
                "NO_NEW_ROWS", 422,
            )
        warnings = list(ex["warnings"])
        if dup:
            warnings.append(f"{dup} baris dilewati karena sudah ada di sistem.")
        val = ex["validation"]
        tg = [r["date"] for r in baru]
        user_id, user_nama = user.get("id"), _nama_user(user)

        # --- template: pakai yang cocok, atau pelajari yang baru ---
        tpl_info = None
        tpl_id = ex["template"]["id"] if ex["template"] else None
        if ex["template"]:
            s.execute(text(f"UPDATE {T_TPL} SET usage_count = usage_count + 1, last_used_at = now() WHERE id = :i"), {"i": tpl_id})
            tpl_info = {"id": tpl_id, "name": ex["template"]["name"], "action": "used", "detected_by": "auto"}
        if simpan_template and (not ex["template"] or rules_user):
            sig = bsp.signature(ex["header_cells"])
            nama_tpl = f"{ex['bank_name'] or 'Rekening'} - {ex['file_type']} ({akun['code']})"
            row = s.execute(
                text(f"""INSERT INTO {T_TPL} (client_id, client_code, template_name, file_type, sheet_name, header_row_index,
                         data_start_row_index, column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count, last_used_at, created_by)
                         VALUES (:c, :code, :n, :ft, NULL, :hr, :dr, :sig, CAST(:hc AS jsonb), CAST(:mr AS jsonb), :by, true, 1, now(), :u)
                         ON CONFLICT (client_id, file_type, column_signature_hash)
                         DO UPDATE SET usage_count = {T_TPL}.usage_count + 1, last_used_at = now(),
                                       mapping_rules = EXCLUDED.mapping_rules, detected_by = EXCLUDED.detected_by,
                                       edited_at = now(), edited_by = :u, deleted_at = NULL, is_active = true
                         RETURNING id::text, (xmax = 0) AS baru"""),
                {
                    "c": cid, "code": _client_code(s, cid), "n": nama_tpl, "ft": ex["file_type"], "hr": ex["header_row_index"] or 1,
                    "dr": (ex["header_row_index"] or 1) + ex.get("header_len", 1), "sig": sig,
                    "hc": json.dumps(ex["header_cells"], ensure_ascii=False),
                    "mr": json.dumps(_rules_simpan(ex, rules_user), ensure_ascii=False),
                    "by": "manual" if rules_user else "auto", "u": user_id,
                },
            ).first()
            tpl_id = row[0]
            tpl_info = {"id": tpl_id, "name": nama_tpl, "action": "created" if row[1] else "updated", "detected_by": "manual" if rules_user else "auto"}

        # --- statement + mutasi ---
        sid = str(uuid.uuid4())
        s.execute(
            text(f"""INSERT INTO {T_STMT} (id, client_id, bank_coa_id, file_name, file_type, file_hash, period_start, period_end,
                     opening_balance, closing_balance, total_debit, total_credit, line_count, duplicate_count, warnings,
                     extraction_method, template_id, validation, created_by, created_by_name)
                     VALUES (:id, :c, :b, :fn, :ft, :fh, :ps, :pe, :ob, :cb, :td, :tk, :lc, :dc, CAST(:w AS jsonb), :m, :t, CAST(:v AS jsonb), :u, :un)"""),
            {
                "id": sid, "c": cid, "b": akun["id"], "fn": filename, "ft": ex["file_type"], "fh": p["file_hash"],
                "ps": min(tg), "pe": max(tg), "ob": val["opening_balance"], "cb": val["closing_balance"],
                "td": round(sum(r["debit"] for r in baru), 2), "tk": round(sum(r["credit"] for r in baru), 2),
                "lc": len(baru), "dc": dup, "w": json.dumps(warnings, ensure_ascii=False), "m": ex["method"], "t": tpl_id,
                "v": json.dumps(_validasi_json(val), ensure_ascii=False, default=str), "u": user_id, "un": user_nama,
            },
        )
        s.execute(
            text(f"""INSERT INTO {T_MUT} (client_id, statement_id, bank_coa_id, line_no, mutation_date, description, debit, credit,
                     balance_after, status, row_hash, confidence, confidence_notes, page_no)
                     VALUES (:c, :s, :b, :ln, :d, :ds, :db, :kr, :ba, 'unmatched', :h, :cf, CAST(:cn AS jsonb), :pg)"""),
            [
                {"c": cid, "s": sid, "b": akun["id"], "ln": i, "d": r["date"], "ds": (r["description"] or "")[:2000], "db": r["debit"],
                 "kr": r["credit"], "ba": r["balance"], "h": r["row_hash"], "cf": r["confidence"],
                 "cn": json.dumps(r["notes"], ensure_ascii=False), "pg": r["page"]}
                for i, r in enumerate(baru, start=1)
            ],
        )

        # --- mapping bank: pakai yang ada, atau pelajari dari upload ini ---
        map_info = None
        if p["mapping"]:
            s.execute(text(f"UPDATE {T_MAP} SET usage_count = usage_count + 1, last_used_at = now() WHERE id = :i"), {"i": p["mapping"]["id"]})
            map_info = {**p["mapping"], "match_by": p["match_by"], "action": "used"}
        elif simpan_mapping and bank_coa_id and ex["account_number"]:
            ada = s.execute(
                text(f"SELECT 1 FROM {T_MAP} WHERE client_id = :c AND account_number = :a AND deleted_at IS NULL"),
                {"c": cid, "a": ex["account_number"]},
            ).first()
            if not ada:
                mid = s.execute(
                    text(f"""INSERT INTO {T_MAP} (client_id, client_code, bank_name, account_number, bank_coa_id, template_id, is_active, usage_count, last_used_at, created_by)
                             VALUES (:c, :code, :bn, :a, :b, :t, true, 1, now(), :u) RETURNING id::text"""),
                    {"c": cid, "code": _client_code(s, cid), "bn": ex["bank_name"] or "Bank", "a": ex["account_number"], "b": akun["id"], "t": tpl_id, "u": user_id},
                ).scalar()
                s.flush()
                dibuat = _daftar_mapping(s, cid, mid)
                if dibuat:
                    map_info = {**dibuat[0], "match_by": "account_number", "action": "created"}
        s.commit()
        return {
            "statement_id": sid, "file_name": filename, "imported": len(baru), "duplicates": dup,
            "period_start": _iso(min(tg)), "period_end": _iso(max(tg)),
            "opening_balance": val["opening_balance"], "closing_balance": val["closing_balance"], "warnings": warnings,
            "method": ex["method"], "validation_status": val["status"], "template": tpl_info,
            "confidence": {k: sum(1 for r in baru if r["confidence"] == k) for k in ("high", "medium", "low")},
            "bank_coa_id": akun["id"], "bank_account_code": akun["code"], "bank_account_name": akun["name"], "bank_mapping": map_info,
        }


@router.post("/statements/upload")
async def upload_statement(
    client_id: str = Form(...), file: UploadFile = File(...), bank_coa_id: Optional[str] = Form(None),
    mapping_rules: Optional[str] = Form(None), save_template: str = Form("true"), save_mapping: str = Form("true"),
    user=Depends(_require_level_v1(3)),
):
    try:
        cid = _uuid(client_id, "client_id")
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise _Err(f"Ukuran file melebihi {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.", "FILE_TOO_LARGE", 400)
        rules = _rules_dari_form(mapping_rules)
        hasil = await run_in_threadpool(
            _upload_sync, cid, content, file.filename or "file", bank_coa_id or None, rules,
            save_template.lower() != "false", save_mapping.lower() != "false", user,
        )
        return sukses(hasil, f"{hasil['imported']} baris diimport.", 201)
    except _Err as e:
        return gagal(e.msg, {"code": e.code}, e.status)
    except Exception as e:  # noqa: BLE001
        logger.exception("upload_statement error")
        return gagal(f"Kesalahan server: {e}", {"code": "SERVER_ERROR"}, 500)


# ============================================================
# FASE 2 -- belum diimplementasikan
# ============================================================

@router.get("/open-invoices")
@_tangani
def open_invoices(client_id: str = Query(...), type: str = Query("sales"), only_open: bool = Query(False), user=Depends(get_current_user_v1)):
    return sukses([], "Fase 2: daftar invoice terbuka belum tersedia.")


@router.get("/mutations/suggestions")
@_tangani
def mutation_suggestions(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    return sukses([], "Fase 2: saran pencocokan belum tersedia.")


@router.get("/transactions")
@_tangani
def list_transactions(client_id: str = Query(...), user=Depends(get_current_user_v1)):
    return sukses([], "Fase 2: transaksi Cash Payment/Receipt belum tersedia.")


@router.get("/transactions/{tx_id}")
@_tangani
def get_transaction(tx_id: str, client_id: str = Query(...), user=Depends(get_current_user_v1)):
    raise _Err("Transaksi tidak ditemukan (fase 2 belum tersedia).", "NOT_FOUND", 404)


async def _belum_ada(request: Request, user=Depends(get_current_user_v1)):
    return gagal(
        "Fitur ini (pencocokan mutasi / transaksi kas-bank / posting jurnal) belum tersedia di backend -- masuk fase 2.",
        {"code": "NOT_IMPLEMENTED"}, 501,
    )


for _metode, _path in [
    ("POST", "/mutations/{mutation_id}/match"), ("POST", "/mutations/{mutation_id}/match-account"),
    ("POST", "/mutations/{mutation_id}/unmatch"), ("POST", "/mutations/auto-match"),
    ("POST", "/transactions"), ("PUT", "/transactions/{tx_id}"), ("DELETE", "/transactions/{tx_id}"),
    ("POST", "/transactions/approve"), ("POST", "/transactions/return-to-draft"), ("POST", "/transactions/post"),
    ("POST", "/transactions/{tx_id}/reverse"),
]:
    router.add_api_route(_path, _belum_ada, methods=[_metode])