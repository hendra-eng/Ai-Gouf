"""
modules/finance/bank_reconciliation_v1.py
==========================================
Reconciliation Cash & Bank: mencocokkan mutasi Bank Feed ke invoice yang masih
outstanding, mencatat pembayarannya, dan membentuk jurnal Kas vs Hutang/Piutang
otomatis.

    Bank Feed (mutasi mentah, hidup di sesi browser)
        debet  (uang keluar)  -> invoice PURCHASE posted yang masih ada sisa hutang
        kredit (uang masuk)   -> invoice SALES Posted/Partial yang masih ada sisa piutang
    matched   -> 1 baris financial_transaction_bank_cash_payments per invoice
                 (trigger DB fn_bcp_apply memperbarui accounts_payable/payment_status
                 Purchase atau paid_amount/posting_status Sales) + 1 jurnal DRAFT
                 (source_module BANK_RECONCILIATION) -> tampil di Journal Preview
                 jalur pendek.
    unmatched -> dicatat di financial_transaction_bank_cash_exceptions
                 (exception_type "Unmatched bank mutation") dan diklasifikasi
                 lewat jalur lengkap.

Bank Feed SENGAJA tidak disimpan di database (lihat BankFeedContext.tsx), jadi
endpoint di sini STATELESS terhadap Bank Feed: frontend mengirim baris mutasi
beserta `ref` yang stabil (refDasar() di cashBankExceptionsStore.ts) dan `ref`
itulah yang disimpan sebagai payments.bank_mutation_ref.

client_id di SEMUA endpoint = management_clients.id (company aktif di "Switch
Company"), sama seperti modul exceptions.

Aturan yang dijaga di sini (sisanya dijaga trigger DB fn_bcp_validate):
  - Total alokasi ke invoice harus SAMA dengan nominal mutasi (toleransi 0,50).
    Selisih (biaya admin bank, potongan, dst) tidak diselesaikan diam-diam --
    biarkan unmatched / exception.
  - Satu mutasi (ref) hanya boleh dicocokkan sekali; batalkan dulu (unmatch)
    untuk mencocokkan ulang.
  - Jurnal dibuat berstatus DRAFT. Jurnal yang sudah POSTED tidak dibatalkan
    otomatis saat unmatch (harus di-reverse lewat jurnal).
"""

from __future__ import annotations

import itertools
import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("finance_bank_reconciliation_v1")

router = APIRouter(prefix="/api/v1/finance/bank-reconciliation", tags=["bank-reconciliation-v1"])

TOLERANSI = Decimal("0.50")
SUMBER_JURNAL = "BANK_RECONCILIATION"
TIPE_EXCEPTION_UNMATCHED = "Unmatched bank mutation"

# Kata umum yang tidak dianggap sebagai bukti nama pihak (vendor/customer).
_KATA_ABAIKAN = {
    "pt", "cv", "tbk", "ud", "pd", "persero", "the", "and", "dan", "bank", "transfer", "trf",
    "payment", "pembayaran", "bayar", "inv", "invoice", "faktur", "no", "nomor", "ke", "dari",
    "atas", "untuk", "via", "ibanking", "mbanking", "kliring", "sknbi", "bifast", "switching",
}


def _require_level_v1(min_tahap: int):
    def _dependency(current_user: Dict[str, Any] = Depends(get_current_user_v1)) -> Dict[str, Any]:
        if auth.role_level(current_user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. "
                    f"Akun kamu: {auth.role_label(current_user.get('role'))}."
                ),
            )
        return current_user

    return _dependency


# ============================================================
# SKEMA REQUEST
# ============================================================

class MutasiIn(BaseModel):
    """Satu mutasi Bank Feed. `ref` = referensi STABIL dari frontend (refDasar())."""
    ref: str = Field(..., min_length=1, max_length=100)
    date: str
    description: Optional[str] = ""
    debit: float = 0     # uang keluar dari rekening
    credit: float = 0    # uang masuk ke rekening
    bank_account: Optional[str] = None
    source_file: Optional[str] = None


class SuggestRequest(BaseModel):
    client_id: str
    mutations: List[MutasiIn] = Field(..., min_length=1, max_length=1000)


class AlokasiIn(BaseModel):
    invoice_id: str
    amount: float = Field(..., gt=0)


class MatchRequest(BaseModel):
    client_id: str
    mutation: MutasiIn
    allocations: List[AlokasiIn] = Field(..., min_length=1, max_length=50)
    bank_coa_id: Optional[str] = None      # kosong -> dicari otomatis dari nama rekening / role
    counter_coa_id: Optional[str] = None   # kosong -> Hutang Usaha / Piutang Usaha client
    notes: Optional[str] = None


class AutoMatchRequest(BaseModel):
    client_id: str
    mutations: List[MutasiIn] = Field(..., min_length=1, max_length=1000)
    bank_coa_id: Optional[str] = None
    catat_exception: bool = True   # mutasi yang tidak bisa dicocokkan dicatat ke tab Exceptions


class UnmatchRequest(BaseModel):
    client_id: str
    bank_mutation_ref: str = Field(..., min_length=1, max_length=100)
    alasan: Optional[str] = None


# ============================================================
# UTIL
# ============================================================

class _Gagal(Exception):
    def __init__(self, pesan: str, kode: str = "VALIDATION", status_code: int = 422, detail: Any = None):
        super().__init__(pesan)
        self.pesan, self.kode, self.status_code, self.detail = pesan, kode, status_code, detail


def _dec(v: Any) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"))


def _parse_tanggal(v: Any) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v or "").strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    raise _Gagal(f"Tanggal mutasi tidak valid: '{v}'.")


def _norm(s: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _token(s: Optional[str]) -> set:
    return {
        t for t in re.findall(r"[a-z0-9]+", (s or "").lower())
        if len(t) >= 3 and not t.isdigit() and t not in _KATA_ABAIKAN
    }


def _uuid_atau_none(v: Any) -> Optional[str]:
    try:
        return str(uuid.UUID(str(v)))
    except (ValueError, TypeError, AttributeError):
        return None


def _pesan_db(e: Exception) -> str:
    """Ambil pesan trigger/constraint yang bisa dibaca user dari error driver."""
    orig = getattr(e, "orig", None)
    msg = str(orig if orig is not None else e).strip()
    msg = msg.split("\nCONTEXT:")[0].split("\nDETAIL:")[0]
    msg = re.sub(r"^\s*(ERROR|Error):\s*", "", msg)
    return msg.splitlines()[0] if msg else "Kesalahan database."


def _arah_dan_nominal(m: MutasiIn) -> Tuple[str, Decimal]:
    debit, credit = _dec(m.debit), _dec(m.credit)
    if debit > 0 and credit > 0:
        raise _Gagal("Mutasi memiliki debet dan kredit sekaligus.")
    if debit <= 0 and credit <= 0:
        raise _Gagal("Nominal mutasi harus lebih dari 0.")
    return ("purchase", debit) if debit > 0 else ("sales", credit)


def _prioritas(nominal: Decimal) -> str:
    n = abs(nominal)
    return "High" if n >= 50_000_000 else "Medium" if n >= 10_000_000 else "Low"


# ============================================================
# KANDIDAT INVOICE OUTSTANDING
# ============================================================

def _muat_kandidat(session, client_id: str) -> Dict[str, List[Dict[str, Any]]]:
    """Invoice yang masih punya sisa tagihan. Kriteria SAMA dengan trigger
    fn_bcp_validate (Purchase: status 'posted'; Sales: 'Posted'/'Partial'; pemilik =
    coalesce(management_client_id, client_id))."""
    purchase = session.execute(text("""
        select id::text as id, purchase_no, invoice_number, vendor_name as party,
               purchase_date, invoice_date, due_date, total,
               coalesce(accounts_payable, total) as outstanding
          from financial_transaction_purchase_transactions
         where deleted_at is null and status = 'posted'
           and coalesce(management_client_id, client_id) = cast(:cid as uuid)
           and coalesce(accounts_payable, total) > 0.005
    """), {"cid": client_id}).mappings().all()
    sales = session.execute(text("""
        select id::text as id, invoice_no, customer_name as party, invoice_date, due_date,
               gross_amount as total, gross_amount - coalesce(paid_amount, 0) as outstanding
          from financial_transaction_sales_invoices
         where deleted_at is null and posting_status in ('Posted', 'Partial')
           and coalesce(management_client_id, client_id) = cast(:cid as uuid)
           and gross_amount - coalesce(paid_amount, 0) > 0.005
    """), {"cid": client_id}).mappings().all()

    hasil: Dict[str, List[Dict[str, Any]]] = {"purchase": [], "sales": []}
    for r in purchase:
        hasil["purchase"].append({
            "type": "purchase", "id": r["id"], "no": r["invoice_number"] or r["purchase_no"],
            "refs": [x for x in (r["purchase_no"], r["invoice_number"]) if x],
            "party": r["party"], "date": r["invoice_date"] or r["purchase_date"], "due_date": r["due_date"],
            "total": _dec(r["total"]), "outstanding": _dec(r["outstanding"]),
        })
    for r in sales:
        hasil["sales"].append({
            "type": "sales", "id": r["id"], "no": r["invoice_no"], "refs": [r["invoice_no"]],
            "party": r["party"], "date": r["invoice_date"], "due_date": r["due_date"],
            "total": _dec(r["total"]), "outstanding": _dec(r["outstanding"]),
        })
    return hasil


def _nilai_kandidat(nominal: Decimal, tgl: date, deskripsi: str, c: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Skor 1 invoice untuk 1 mutasi. None kalau nominal melebihi sisa tagihan
    (tidak boleh -- trigger DB akan menolak)."""
    sisa = c["outstanding"]
    if nominal > sisa + TOLERANSI:
        return None
    exact = abs(sisa - nominal) <= TOLERANSI
    desk_norm = _norm(deskripsi)
    ref_hit = any(len(_norm(r)) >= 4 and _norm(r) in desk_norm for r in c["refs"])
    tok_party = _token(c["party"])
    tok_desk = _token(deskripsi)
    rasio = (len(tok_party & tok_desk) / len(tok_party)) if tok_party else 0.0

    skor = 0.60 if exact else 0.15
    if ref_hit:
        skor += 0.30
    skor += 0.15 * min(rasio, 1.0)
    if c["date"] and tgl >= c["date"]:
        skor += 0.05
    if c["due_date"] and abs((tgl - c["due_date"]).days) <= 14:
        skor += 0.05
    return {
        "exact": exact, "ref_hit": ref_hit, "party_ratio": round(rasio, 2), "score": round(min(skor, 1.0), 2),
    }


def _ringkas_alokasi(c: Dict[str, Any], jumlah: Decimal) -> Dict[str, Any]:
    return {
        "invoice_id": c["id"], "invoice_no": c["no"], "party": c["party"],
        "outstanding": float(c["outstanding"]), "amount": float(jumlah),
    }


def _saran_untuk_mutasi(m: MutasiIn, kandidat: Dict[str, List[Dict[str, Any]]], maks: int = 5) -> Dict[str, Any]:
    """Susun saran pencocokan 1 mutasi. TIDAK menulis apa pun."""
    tipe, nominal = _arah_dan_nominal(m)
    tgl = _parse_tanggal(m.date)
    deskripsi = m.description or ""
    pool = kandidat[tipe]

    daftar: List[Dict[str, Any]] = []
    for c in pool:
        n = _nilai_kandidat(nominal, tgl, deskripsi, c)
        if n is None:
            continue
        # buang kandidat yang cuma "kebetulan muat" tanpa bukti apa pun selain tanggal
        if not n["exact"] and not n["ref_hit"] and n["party_ratio"] < 0.5:
            continue
        daftar.append({"kind": "single", **n, "allocations": [_ringkas_alokasi(c, nominal)]})

    # Kombinasi 2-4 invoice yang totalnya PAS dengan nominal (satu transfer bayar beberapa invoice)
    if not any(d["exact"] for d in daftar):
        pool_kombo = [
            c for c in pool
            if c["outstanding"] < nominal and (
                _token(c["party"]) & _token(deskripsi)
                or any(len(_norm(r)) >= 4 and _norm(r) in _norm(deskripsi) for r in c["refs"])
            )
        ]
        pool_kombo = sorted(pool_kombo, key=lambda x: x["outstanding"], reverse=True)[:12]
        for ukuran in (2, 3, 4):
            for kombo in itertools.combinations(pool_kombo, ukuran):
                if abs(sum(x["outstanding"] for x in kombo) - nominal) <= TOLERANSI:
                    daftar.append({
                        "kind": "combo", "exact": True, "ref_hit": False, "party_ratio": 1.0, "score": 0.70,
                        "allocations": [_ringkas_alokasi(x, x["outstanding"]) for x in kombo],
                    })
            if len(daftar) >= maks * 2:
                break

    daftar.sort(key=lambda d: (d["score"], d["exact"]), reverse=True)
    daftar = daftar[:maks]

    # Auto-match hanya kalau: kandidat teratas 1 invoice, nominal PAS, ada bukti (no invoice / nama pihak),
    # dan tidak ada kandidat lain yang sama kuatnya (biar tidak salah pilih invoice).
    auto = False
    if daftar and daftar[0]["kind"] == "single" and daftar[0]["exact"] and (
        daftar[0]["ref_hit"] or daftar[0]["party_ratio"] >= 0.5
    ):
        pesaing = [
            d for d in daftar[1:]
            if d["exact"] and (d["ref_hit"] or d["party_ratio"] >= 0.5) and d["score"] >= daftar[0]["score"] - 0.10
        ]
        auto = not pesaing

    return {
        "ref": m.ref, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
        "amount": float(nominal), "candidates": daftar, "auto_match": auto,
    }


# ============================================================
# AKUN (COA)
# ============================================================

def _coa_row(session, client_id: str, coa_id: str) -> Optional[Dict[str, Any]]:
    r = session.execute(text("""
        select id::text as id, no_akun, nama_akun from coa
         where id = cast(:i as uuid) and client_id = cast(:c as uuid) and deleted_at is null
    """), {"i": coa_id, "c": client_id}).mappings().first()
    return dict(r) if r else None


def _coa_dari_role(session, client_id: str, role_code: str) -> Optional[Dict[str, Any]]:
    rows = session.execute(text("""
        select c.id::text as id, c.no_akun, c.nama_akun
          from company_account_roles car
          join account_roles r on r.id = car.role_id
          join coa c on c.id = car.coa_id
         where car.client_id = cast(:c as uuid) and car.active and r.active
           and r.role_code = :role and c.deleted_at is null
    """), {"c": client_id, "role": role_code}).mappings().all()
    return dict(rows[0]) if len(rows) == 1 else None


def _resolve_bank(session, client_id: str, explicit_id: Optional[str], bank_hint: Optional[str]) -> Dict[str, Any]:
    if explicit_id:
        r = _coa_row(session, client_id, explicit_id)
        if not r:
            raise _Gagal("Akun Kas/Bank tidak ditemukan pada COA client ini.")
        return r
    banks = [dict(x) for x in session.execute(text("""
        select id::text as id, no_akun, nama_akun from coa
         where client_id = cast(:c as uuid) and deleted_at is null and coalesce(aktif, true)
           and jenis_kas = 'bank' order by no_akun
    """), {"c": client_id}).mappings().all()]
    tok_hint = _token(bank_hint)
    if tok_hint:
        cocok = [b for b in banks if _token(b["nama_akun"]) & tok_hint]
        if len(cocok) == 1:
            return cocok[0]
    r = _coa_dari_role(session, client_id, "BANK_DEFAULT")
    if r:
        return r
    if len(banks) == 1:
        return banks[0]
    raise _Gagal(
        "Akun Bank tidak bisa ditentukan otomatis. Pilih akun bank untuk mutasi ini.",
        kode="NEED_ACCOUNT", detail={"field": "bank_coa_id", "options": banks},
    )


def _resolve_lawan(session, client_id: str, tipe: str, explicit_id: Optional[str]) -> Dict[str, Any]:
    if explicit_id:
        r = _coa_row(session, client_id, explicit_id)
        if not r:
            raise _Gagal("Akun Hutang/Piutang tidak ditemukan pada COA client ini.")
        return r
    role = "AP_CONTROL" if tipe == "purchase" else "AR_CONTROL"
    r = _coa_dari_role(session, client_id, role)
    if r:
        return r
    sub = "TRADE PAYABLES" if tipe == "purchase" else "TRADE RECEIVABLES"
    rows = [dict(x) for x in session.execute(text("""
        select id::text as id, no_akun, nama_akun from coa
         where client_id = cast(:c as uuid) and deleted_at is null and coalesce(aktif, true)
           and sub_kategori = :sub order by no_akun
    """), {"c": client_id, "sub": sub}).mappings().all()]
    if len(rows) > 1:  # buang akun perantara (clearance / other)
        utama = [x for x in rows if not re.search(r"clearance|other|lain", x["nama_akun"] or "", re.I)]
        rows = utama or rows
    if len(rows) > 1:
        awalan = "HUTANG USAHA" if tipe == "purchase" else "PIUTANG USAHA"
        persis = [x for x in rows if (x["nama_akun"] or "").upper().startswith(awalan)]
        rows = persis or rows
    if len(rows) == 1:
        return rows[0]
    raise _Gagal(
        f"Akun {'Hutang' if tipe == 'purchase' else 'Piutang'} Usaha tidak bisa ditentukan otomatis. Pilih akunnya.",
        kode="NEED_ACCOUNT", detail={"field": "counter_coa_id", "options": rows},
    )


# ============================================================
# INTI: MATCH (tulis payments + jurnal DRAFT dalam SATU transaksi)
# ============================================================

def _sudah_dicocokkan(session, client_id: str, ref: str) -> bool:
    n = session.execute(text("""
        select count(*) from financial_transaction_bank_cash_payments
         where client_id = cast(:c as uuid) and bank_mutation_ref = :r and deleted_at is null
    """), {"c": client_id, "r": ref}).scalar()
    return bool(n)


def _lakukan_match(
    session, *, client_id: str, m: MutasiIn, alokasi: List[Dict[str, Any]],
    bank_coa_id: Optional[str], counter_coa_id: Optional[str], notes: Optional[str], user_id: Optional[str],
) -> Dict[str, Any]:
    """Tulis payments + jurnal. TIDAK commit -- pemanggil yang commit/rollback."""
    tipe, nominal = _arah_dan_nominal(m)
    tgl = _parse_tanggal(m.date)

    if _sudah_dicocokkan(session, client_id, m.ref):
        raise _Gagal("Mutasi ini sudah dicocokkan. Batalkan pencocokan dulu (unmatch) kalau ingin mengulang.",
                     kode="ALREADY_MATCHED", status_code=409)

    total_alokasi = sum((_dec(a["amount"]) for a in alokasi), Decimal("0"))
    if abs(total_alokasi - nominal) > TOLERANSI:
        raise _Gagal(
            f"Total alokasi ({total_alokasi:,.2f}) tidak sama dengan nominal mutasi ({nominal:,.2f}). "
            "Selisih (mis. biaya admin bank) harus ditangani terpisah, bukan dipaksa cocok.",
            kode="ALLOCATION_MISMATCH",
        )
    ids = [a["invoice_id"] for a in alokasi]
    if len(set(ids)) != len(ids):
        raise _Gagal("Satu invoice tidak boleh muncul dua kali dalam alokasi yang sama.")

    # Data invoice untuk deskripsi jurnal (validasi kepemilikan/status/sisa dilakukan trigger DB).
    if tipe == "purchase":
        rows = session.execute(text("""
            select id::text as id, coalesce(invoice_number, purchase_no) as no, vendor_name as party
              from financial_transaction_purchase_transactions
             where id = any(cast(:ids as uuid[])) and deleted_at is null
        """), {"ids": ids}).mappings().all()
    else:
        rows = session.execute(text("""
            select id::text as id, invoice_no as no, customer_name as party
              from financial_transaction_sales_invoices
             where id = any(cast(:ids as uuid[])) and deleted_at is null
        """), {"ids": ids}).mappings().all()
    info = {r["id"]: r for r in rows}
    hilang = [i for i in ids if i not in info]
    if hilang:
        raise _Gagal(f"Invoice {'Purchase' if tipe == 'purchase' else 'Sales'} tidak ditemukan: {', '.join(hilang)}.")

    bank = _resolve_bank(session, client_id, bank_coa_id, m.bank_account)
    lawan = _resolve_lawan(session, client_id, tipe, counter_coa_id)

    # --- jurnal DRAFT: Purchase -> Dr Hutang / Cr Bank ; Sales -> Dr Bank / Cr Piutang
    baris: List[Dict[str, Any]] = []
    for a in alokasi:
        inv = info[a["invoice_id"]]
        jumlah = _dec(a["amount"])
        ket = f"{'Pembayaran' if tipe == 'purchase' else 'Penerimaan'} invoice {inv['no']} - {inv['party']}"
        if tipe == "purchase":
            baris.append({"coa_id": lawan["id"], "debit": jumlah, "credit": Decimal("0"), "desc": ket, "partner": inv["party"]})
        else:
            baris.append({"coa_id": lawan["id"], "debit": Decimal("0"), "credit": jumlah, "desc": ket, "partner": inv["party"]})
    ket_bank = (m.description or "").strip()[:200] or f"Mutasi bank {m.ref}"
    if tipe == "purchase":
        baris.append({"coa_id": bank["id"], "debit": Decimal("0"), "credit": total_alokasi, "desc": ket_bank, "partner": None})
    else:
        baris.insert(0, {"coa_id": bank["id"], "debit": total_alokasi, "credit": Decimal("0"), "desc": ket_bank, "partner": None})

    je = dbc.JournalEntry(
        client_id=client_id, journal_no=f"TEMP-{uuid.uuid4().hex}", source_module=SUMBER_JURNAL,
        source_transaction_id=m.ref[:100], document_date=tgl, posting_date=tgl,
        description=f"Rekonsiliasi bank {m.ref}: {ket_bank}"[:500], reference=m.ref[:150],
        status="DRAFT", currency="IDR", exchange_rate=Decimal("1"), created_by=user_id,
    )
    session.add(je)
    session.flush()
    je.journal_no = f"JE-{tgl.year}-{str(je.id).replace('-', '')[:8].upper()}"
    for no, b in enumerate(baris, 1):
        session.add(dbc.JournalLine(
            journal_entry_id=je.id, client_id=client_id, line_no=no, coa_id=b["coa_id"],
            description=b["desc"], debit=b["debit"], credit=b["credit"], partner_name=b["partner"],
            reconciliation_no=m.ref[:100],
        ))
    session.flush()

    # --- payments (trigger fn_bcp_validate + fn_bcp_apply berjalan di sini)
    payment_ids: List[str] = []
    for a in alokasi:
        hasil = session.execute(text("""
            insert into financial_transaction_bank_cash_payments
                (client_id, direction, purchase_transaction_id, sales_invoice_id, payment_date, amount,
                 bank_coa_id, counter_coa_id, bank_account, bank_mutation_ref, mutation_date,
                 mutation_amount, mutation_description, source_file, journal_entry_id, notes, created_by)
            values
                (cast(:client_id as uuid), :direction, cast(:pid as uuid), cast(:sid as uuid), :tgl, :amount,
                 cast(:bank as uuid), cast(:lawan as uuid), :rek, :ref, :tgl,
                 :mut_amount, :mut_desc, :src, cast(:je as uuid), :notes, cast(:by as uuid))
            returning id::text
        """), {
            "client_id": client_id, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
            "pid": a["invoice_id"] if tipe == "purchase" else None,
            "sid": a["invoice_id"] if tipe == "sales" else None,
            "tgl": tgl, "amount": _dec(a["amount"]), "bank": bank["id"], "lawan": lawan["id"],
            "rek": m.bank_account, "ref": m.ref, "mut_amount": nominal, "mut_desc": m.description,
            "src": m.source_file, "je": je.id, "notes": notes, "by": user_id,
        })
        payment_ids.append(hasil.scalar())

    return {
        "bank_mutation_ref": m.ref, "direction": "cash_payment" if tipe == "purchase" else "cash_receipt",
        "amount": float(nominal), "payment_ids": payment_ids,
        "journal_entry_id": str(je.id), "journal_no": je.journal_no, "journal_status": "DRAFT",
        "bank_account": {"id": bank["id"], "no_akun": bank["no_akun"], "nama_akun": bank["nama_akun"]},
        "counter_account": {"id": lawan["id"], "no_akun": lawan["no_akun"], "nama_akun": lawan["nama_akun"]},
    }


def _match_satu(client_id: str, m: MutasiIn, alokasi: List[Dict[str, Any]], bank_coa_id: Optional[str],
                counter_coa_id: Optional[str], notes: Optional[str], user_id: Optional[str]) -> Dict[str, Any]:
    """Sesi sendiri + commit/rollback. Ubah error DB (trigger) jadi _Gagal yang bisa dibaca."""
    session = dbc.SessionLocal()
    try:
        hasil = _lakukan_match(
            session, client_id=client_id, m=m, alokasi=alokasi, bank_coa_id=bank_coa_id,
            counter_coa_id=counter_coa_id, notes=notes, user_id=user_id,
        )
        session.commit()
        return hasil
    except _Gagal:
        session.rollback()
        raise
    except DBAPIError as e:
        session.rollback()
        raise _Gagal(_pesan_db(e), kode="DB_REJECTED")
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============================================================
# EXCEPTIONS (unmatched)
# ============================================================

def _catat_unmatched(client_id: str, m: MutasiIn, saran: Optional[Dict[str, Any]], user_id: Optional[str]) -> None:
    try:
        tipe, nominal = _arah_dan_nominal(m)
    except _Gagal:
        return
    if saran and saran["candidates"]:
        top = saran["candidates"][0]
        nama = ", ".join(a["invoice_no"] or "-" for a in top["allocations"])
        ai = (f"Ada {len(saran['candidates'])} kandidat invoice tetapi belum cukup pasti "
              f"(teratas: {nama}, skor {top['score']}). Cocokkan manual di tab Reconciliation.")
    else:
        ai = ("Tidak ada invoice Purchase/Sales outstanding yang nominalnya cocok. "
              "Klasifikasikan lewat Journal Preview jalur lengkap atau periksa input invoice.")
    dbc.upsert_bank_cash_exception({
        "client_id": client_id, "bank_mutation_ref": m.ref, "exception_type": TIPE_EXCEPTION_UNMATCHED,
        "source": "Reconciliation", "priority": _prioritas(nominal), "status": "Open",
        "ai_suggestion": ai,
        "source_snippet": {"tanggal": m.date, "kredit" if tipe == "sales" else "debit": float(nominal),
                           "rekening": m.bank_account or ""},
    }, user_id=user_id)


def _tutup_exception_unmatched(client_id: str, ref: str, user_id: Optional[str]) -> None:
    try:
        for row in dbc.list_bank_cash_exceptions(client_id=client_id, bank_mutation_ref=ref) or []:
            if row.get("exception_type") == TIPE_EXCEPTION_UNMATCHED and row.get("status") != "Resolved":
                dbc.update_bank_cash_exception(
                    row["id"], {"status": "Resolved", "resolved_at": datetime.now(), "resolved_by": user_id},
                    updated_by=user_id,
                )
    except Exception as e:  # exception hanya catatan; jangan gagalkan pencocokan yang sudah tersimpan
        logger.warning("Gagal menutup exception unmatched %s: %s", ref, e)


def _balas_gagal(e: _Gagal):
    return gagal(message=e.pesan, errors={"code": e.kode, "detail": e.detail}, status_code=e.status_code)


# ============================================================
# ENDPOINTS
# ============================================================

@router.post("/suggest", summary="Saran pencocokan mutasi Bank Feed ke invoice outstanding (tidak menulis apa pun)")
def api_suggest(payload: SuggestRequest, _user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        kandidat = _muat_kandidat(session, payload.client_id)
        sudah = {r[0] for r in session.execute(text("""
            select distinct bank_mutation_ref from financial_transaction_bank_cash_payments
             where client_id = cast(:c as uuid) and deleted_at is null
        """), {"c": payload.client_id}).all()}
    finally:
        session.close()
    hasil = []
    for m in payload.mutations:
        if m.ref in sudah:
            hasil.append({"ref": m.ref, "already_matched": True, "candidates": [], "auto_match": False})
            continue
        try:
            hasil.append(_saran_untuk_mutasi(m, kandidat))
        except _Gagal as e:
            hasil.append({"ref": m.ref, "error": e.pesan, "candidates": [], "auto_match": False})
    return sukses(data={"results": hasil}, message="OK")


@router.post("/match", summary="Cocokkan 1 mutasi ke 1..n invoice: catat pembayaran + jurnal DRAFT (Supervisor ke atas)")
def api_match(payload: MatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    try:
        hasil = _match_satu(
            payload.client_id, payload.mutation, [a.model_dump() for a in payload.allocations],
            payload.bank_coa_id, payload.counter_coa_id, payload.notes, user_id,
        )
    except _Gagal as e:
        return _balas_gagal(e)
    _tutup_exception_unmatched(payload.client_id, payload.mutation.ref, user_id)
    return sukses(data=hasil, message="Mutasi berhasil dicocokkan. Jurnal berstatus DRAFT.", status_code=201)


@router.post("/auto-match", summary="Cocokkan otomatis mutasi yang pasti; sisanya dicatat sebagai exception (Supervisor ke atas)")
def api_auto_match(payload: AutoMatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    session = dbc.SessionLocal()
    try:
        kandidat = _muat_kandidat(session, payload.client_id)
        sudah = {r[0] for r in session.execute(text("""
            select distinct bank_mutation_ref from financial_transaction_bank_cash_payments
             where client_id = cast(:c as uuid) and deleted_at is null
        """), {"c": payload.client_id}).all()}
    finally:
        session.close()

    matched: List[Dict[str, Any]] = []
    unmatched: List[Dict[str, Any]] = []
    dilewati: List[str] = []
    for m in payload.mutations:
        if m.ref in sudah:
            dilewati.append(m.ref)
            continue
        try:
            saran = _saran_untuk_mutasi(m, kandidat)
        except _Gagal as e:
            unmatched.append({"ref": m.ref, "alasan": e.pesan})
            continue
        if saran["auto_match"]:
            alok = [{"invoice_id": a["invoice_id"], "amount": a["amount"]} for a in saran["candidates"][0]["allocations"]]
            try:
                hasil = _match_satu(payload.client_id, m, alok, payload.bank_coa_id, None, "Auto-match rekonsiliasi", user_id)
            except _Gagal as e:
                unmatched.append({"ref": m.ref, "alasan": e.pesan, "kode": e.kode, "detail": e.detail})
                if payload.catat_exception and e.kode not in ("ALREADY_MATCHED",):
                    _catat_unmatched(payload.client_id, m, saran, user_id)
                continue
            matched.append(hasil)
            _tutup_exception_unmatched(payload.client_id, m.ref, user_id)
            # kurangi sisa in-memory supaya mutasi berikutnya di batch ini tidak memakai sisa yang sama
            tipe, _n = _arah_dan_nominal(m)
            for a in alok:
                for c in kandidat[tipe]:
                    if c["id"] == a["invoice_id"]:
                        c["outstanding"] -= _dec(a["amount"])
            kandidat[tipe] = [c for c in kandidat[tipe] if c["outstanding"] > Decimal("0.005")]
        else:
            unmatched.append({"ref": m.ref, "alasan": "Belum ada kandidat yang cukup pasti.",
                              "jumlah_kandidat": len(saran["candidates"])})
            if payload.catat_exception:
                _catat_unmatched(payload.client_id, m, saran, user_id)

    return sukses(
        data={"matched": matched, "unmatched": unmatched, "already_matched": dilewati},
        message=f"{len(matched)} mutasi dicocokkan, {len(unmatched)} belum cocok.",
    )


@router.post("/unmatch", summary="Batalkan pencocokan: pembayaran dibatalkan (saldo invoice dipulihkan trigger) & jurnal DRAFT ditolak (Supervisor ke atas)")
def api_unmatch(payload: UnmatchRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(3))):
    user_id = _uuid_atau_none(current_user.get("id"))
    session = dbc.SessionLocal()
    try:
        pay = session.execute(text("""
            select id::text as id, journal_entry_id::text as je from financial_transaction_bank_cash_payments
             where client_id = cast(:c as uuid) and bank_mutation_ref = :r and deleted_at is null
        """), {"c": payload.client_id, "r": payload.bank_mutation_ref}).mappings().all()
        if not pay:
            raise _Gagal("Tidak ada pembayaran aktif untuk mutasi ini.", kode="NOT_FOUND", status_code=404)

        je_ids = sorted({p["je"] for p in pay if p["je"]})
        if je_ids:
            terposting = session.execute(text("""
                select journal_no from journal_entries
                 where id = any(cast(:ids as uuid[])) and status = 'POSTED'
            """), {"ids": je_ids}).scalars().all()
            if terposting:
                raise _Gagal(
                    f"Jurnal {', '.join(terposting)} sudah diposting, tidak bisa dibatalkan otomatis. "
                    "Buat jurnal pembalik (reversal) dulu.", kode="JOURNAL_POSTED", status_code=409,
                )

        session.execute(text("""
            update financial_transaction_bank_cash_payments
               set deleted_at = now(), deleted_by = cast(:by as uuid),
                   notes = coalesce(notes || ' | ', '') || :alasan
             where client_id = cast(:c as uuid) and bank_mutation_ref = :r and deleted_at is null
        """), {"c": payload.client_id, "r": payload.bank_mutation_ref, "by": user_id,
               "alasan": f"Dibatalkan: {payload.alasan or 'unmatch'}"})
        if je_ids:
            session.execute(text("""
                update journal_entries set status = 'REJECTED', edited_at = now()
                 where id = any(cast(:ids as uuid[])) and status <> 'POSTED'
            """), {"ids": je_ids})
        session.commit()
        return sukses(
            data={"bank_mutation_ref": payload.bank_mutation_ref, "payments_dibatalkan": len(pay), "journal_ditolak": len(je_ids)},
            message="Pencocokan dibatalkan.",
        )
    except _Gagal as e:
        session.rollback()
        return _balas_gagal(e)
    except DBAPIError as e:
        session.rollback()
        return gagal(message=_pesan_db(e), errors={"code": "DB_REJECTED"}, status_code=422)
    finally:
        session.close()


@router.get("/payments", summary="Daftar pembayaran hasil rekonsiliasi (sumber tab Cash Payment / Cash Receipt / Overview)")
def api_daftar_payments(
    client_id: str = Query(..., description="management_clients.id"),
    direction: Optional[str] = Query(None, pattern="^(cash_payment|cash_receipt)$"),
    termasuk_dibatalkan: bool = Query(False),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        rows = session.execute(text("""
            select p.id::text as id, p.direction, p.payment_date, p.amount, p.bank_account, p.bank_mutation_ref,
                   p.mutation_amount, p.mutation_description, p.source_file, p.notes, p.deleted_at, p.created_at,
                   p.purchase_transaction_id::text as purchase_id, p.sales_invoice_id::text as sales_id,
                   coalesce(pt.invoice_number, pt.purchase_no, si.invoice_no) as invoice_no,
                   coalesce(pt.vendor_name, si.customer_name) as party,
                   coalesce(pt.total, si.gross_amount) as invoice_total,
                   p.journal_entry_id::text as journal_entry_id, je.journal_no, je.status as journal_status,
                   cb.no_akun as bank_no_akun, cb.nama_akun as bank_nama_akun,
                   cc.no_akun as counter_no_akun, cc.nama_akun as counter_nama_akun
              from financial_transaction_bank_cash_payments p
              left join financial_transaction_purchase_transactions pt on pt.id = p.purchase_transaction_id
              left join financial_transaction_sales_invoices si on si.id = p.sales_invoice_id
              left join journal_entries je on je.id = p.journal_entry_id
              left join coa cb on cb.id = p.bank_coa_id
              left join coa cc on cc.id = p.counter_coa_id
             where p.client_id = cast(:c as uuid)
               and (cast(:dir as text) is null or p.direction = cast(:dir as text))
               and (cast(:semua as boolean) or p.deleted_at is null)
             order by p.payment_date desc, p.created_at desc
        """), {"c": client_id, "dir": direction, "semua": termasuk_dibatalkan}).mappings().all()
        return sukses(data=[dict(r) for r in rows], message="OK")
    finally:
        session.close()


@router.get("/journal-preview", summary="Jurnal Kas vs Hutang/Piutang hasil rekonsiliasi (Journal Preview jalur pendek)")
def api_journal_preview(
    client_id: str = Query(..., description="management_clients.id"),
    status_jurnal: Optional[str] = Query(None, alias="status", pattern="^(DRAFT|POSTED|REJECTED|REVERSED)$"),
    _user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        entries = session.execute(text("""
            select id::text as id, journal_no, posting_date, description, reference, status
              from journal_entries
             where client_id = cast(:c as uuid) and source_module = :src and deleted_at is null
               and (cast(:st as text) is null or status = cast(:st as text))
             order by posting_date desc, journal_no desc
        """), {"c": client_id, "src": SUMBER_JURNAL, "st": status_jurnal}).mappings().all()
        if not entries:
            return sukses(data=[], message="OK")
        baris = session.execute(text("""
            select l.journal_entry_id::text as je, l.line_no, c.no_akun, c.nama_akun,
                   l.debit, l.credit, l.description, l.partner_name
              from journal_lines l join coa c on c.id = l.coa_id
             where l.journal_entry_id = any(cast(:ids as uuid[])) and l.deleted_at is null
             order by l.journal_entry_id, l.line_no
        """), {"ids": [e["id"] for e in entries]}).mappings().all()
        per_je: Dict[str, List[Dict[str, Any]]] = {}
        for b in baris:
            per_je.setdefault(b["je"], []).append({k: v for k, v in dict(b).items() if k != "je"})
        data = [{**dict(e), "lines": per_je.get(e["id"], [])} for e in entries]
        return sukses(data=data, message="OK")
    finally:
        session.close()