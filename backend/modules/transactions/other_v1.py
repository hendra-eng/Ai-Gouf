"""
modules/transactions/other_v1.py
================================
Transactions > Other, UI dataset/picture/Template UI/other/1-7.png -- tab
Overview, Source Data, Other Transaction, Journal Preview, Exceptions, Posted.
Endpoint /api/v1/transactions/other/... Tabel: migrations/42-create_other_journal_tables.py.

Jurnal lain-lain di luar Sales, Purchase, dan Cash & Bank (CapEx, akrual,
reklasifikasi, koreksi, transaksi belum terkategori):

    Save Draft        -> draft      (Supervisor+)
    Approve           -> approved   (Supervisor+, hanya bila lolos semua cek error)
    Reject            -> rejected   (Supervisor+, bisa diperbaiki lalu jadi draft lagi)
    Post              -> posted     (Manager+) -> GL/FS sumber "other"
    Reverse           -> reversed   (Manager+) -> jurnal pembalik RV-<no> di reversal_date

Cek per jurnal (Journal Preview / Exceptions): minimal 2 baris, debit = kredit,
nominal > 0, akun ada di COA klien (error); akun nonaktif / belum dipetakan ke
akun standar (warning); tanggal di periode yang sudah ditutup (error).
"""

from __future__ import annotations

import re
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Any, Dict, List, Literal, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import text

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from . import bank_cash_v1 as bc

logger = get_module_logger("transactions_other_v1")

router = APIRouter(prefix="/api/v1/transactions/other", tags=["transactions-other"])

LEVEL_INPUT = bc.LEVEL_INPUT
LEVEL_POST = bc.LEVEL_POST
NOL = Decimal("0")
_Gagal = bc._Gagal
_f = bc._f
_nama = bc._nama
_sekarang = bc._sekarang
JR = dbc.OtherJournal
JL = dbc.OtherJournalLine
COA = dbc.ManagementClientCoa

KATEGORI = {"general": "General Journal", "capex": "CapEx", "accrual": "Accrual", "prepaid": "Prepaid / Amortization",
            "reclass": "Reclassification", "correction": "Correction", "payroll": "Payroll", "uncategorized": "Uncategorized", "other": "Other"}


def _teks(s: Optional[str]) -> Optional[str]:
    s = (s or "").strip()
    return s or None


def _awal(d: date) -> date:
    return d.replace(day=1)


def _geser(d: date, n: int) -> date:
    m = d.year * 12 + d.month - 1 + n
    return date(m // 12, m % 12 + 1, 1)


def _kunci(session, kid: str) -> None:
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"other-journal:{kid}"})


def _tanggal_kunci(session, kid: str) -> Optional[date]:
    try:
        return session.execute(text("select fn_tanggal_kunci_periode(cast(:c as uuid))"), {"c": kid}).scalar()
    except Exception:
        session.rollback()
        return None


# ============================================================
# MUAT + CEK
# ============================================================

def _muat(session, kid: str, ids: Optional[List[str]] = None) -> Tuple[List[Any], Dict[str, List[Any]]]:
    q = session.query(JR).filter(JR.client_id == kid, JR.deleted_at.is_(None))
    if ids is not None:
        q = q.filter(JR.id.in_(ids or ["00000000-0000-0000-0000-000000000000"]))
    jurnal = q.order_by(JR.journal_date.desc(), JR.journal_no.desc()).all()
    baris: Dict[str, List[Any]] = defaultdict(list)
    if jurnal:
        for l in session.query(JL).filter(JL.journal_id.in_([j.id for j in jurnal])).order_by(JL.line_no).all():
            baris[l.journal_id].append(l)
    return jurnal, baris


def _cek(j: Any, ls: List[Any], akun: Dict[str, Any], kunci_tgl: Optional[date]) -> List[Dict[str, str]]:
    isu: List[Dict[str, str]] = []
    d = sum((bc._dec(l.debit) for l in ls), NOL)
    k = sum((bc._dec(l.credit) for l in ls), NOL)
    if not j.journal_no:
        isu.append({"code": "missing_number", "level": "error", "message": "Journal number is missing."})
    if len(ls) < 2:
        isu.append({"code": "few_lines", "level": "error", "message": "A journal needs at least two lines."})
    if d <= 0 and k <= 0:
        isu.append({"code": "zero_amount", "level": "error", "message": "The journal has no amount."})
    elif d != k:
        isu.append({"code": "unbalanced", "level": "error", "message": f"Not balanced: debit {d:,.2f} vs credit {k:,.2f}."})
    for l in ls:
        a = akun.get(l.account_code)
        if a is None:
            isu.append({"code": "account_missing", "level": "error", "message": f"Account {l.account_code} is not in the chart of accounts."})
            continue
        if not a.is_active:
            isu.append({"code": "account_inactive", "level": "warning", "message": f"Account {a.acc_no} {a.account_name} is inactive."})
        if not a.standard_account_code:
            isu.append({"code": "account_unmapped", "level": "warning",
                        "message": f"Account {a.acc_no} {a.account_name} is not mapped to a standard account."})
    if kunci_tgl and j.status not in ("posted", "reversed") and j.journal_date <= kunci_tgl:
        isu.append({"code": "period_locked", "level": "error",
                    "message": f"Journal date falls in a closed period (books closed through {kunci_tgl:%d %b %Y})."})
    # Hilangkan duplikat pesan (akun sama di beberapa baris).
    unik, hasil = set(), []
    for i in isu:
        if i["message"] not in unik:
            unik.add(i["message"])
            hasil.append(i)
    return hasil


def _jurnal_dict(j: Any, ls: List[Any], isu: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
    return {
        "id": j.id, "journal_no": j.journal_no, "journal_date": j.journal_date, "category": j.category,
        "category_label": KATEGORI.get(j.category, j.category), "reference": j.reference, "description": j.description,
        "review_note": j.review_note, "total_debit": _f(j.total_debit), "total_credit": _f(j.total_credit),
        "amount": _f(max(bc._dec(j.total_debit), bc._dec(j.total_credit))), "source": j.source, "status": j.status,
        "approved_by_name": j.approved_by_name, "approved_at": j.approved_at, "rejected_reason": j.rejected_reason,
        "posted_by_name": j.posted_by_name, "posted_at": j.posted_at, "reversal_date": j.reversal_date,
        "reversal_reason": j.reversal_reason, "reversed_by_name": j.reversed_by_name,
        "created_by_name": j.created_by_name, "created_at": j.created_at, "edited_at": j.edited_at,
        "lines": [{"id": l.id, "line_no": l.line_no, "coa_id": l.coa_id, "account_code": l.account_code, "account_name": l.account_name,
                   "description": l.description, "debit": _f(l.debit), "credit": _f(l.credit)} for l in ls],
        "issues": isu or [],
        "has_error": any(i["level"] == "error" for i in (isu or [])),
    }


def _semua(session, kid: str) -> List[Dict[str, Any]]:
    jurnal, baris = _muat(session, kid)
    akun = {a.acc_no: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}
    kunci = _tanggal_kunci(session, kid)
    return [_jurnal_dict(j, baris[j.id], _cek(j, baris[j.id], akun, kunci)) for j in jurnal]


# ============================================================
# ENDPOINT -- DATA
# ============================================================

@router.get("/accounts", summary="Akun COA klien (pilihan baris jurnal)")
def daftar_akun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return bc._respon(lambda session: [bc._akun_dict(a) | {"standard_code": a.standard_account_code}
                                       for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).order_by(COA.acc_no).all()])


@router.get("/journals", summary="Semua jurnal Other + hasil cek")
def daftar_jurnal(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    return bc._respon(lambda session: {"journals": _semua(session, kid), "categories": [{"key": k, "label": v} for k, v in KATEGORI.items()],
                                       "next_number": _nomor_berikut(session, kid, date.today())})


@router.get("/journals/{journal_id}", summary="Detail 1 jurnal Other")
def detail_jurnal(journal_id: UUID, client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        hasil = [j for j in _semua(session, kid) if j["id"] == str(journal_id)]
        if not hasil:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        return hasil[0]
    return bc._respon(aksi)


@router.get("/overview", summary="Overview: KPI, tren bulanan, per kategori, pihak teratas")
def overview(client_id: UUID = Query(...), months: int = Query(12, ge=3, le=36), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        js = _semua(session, kid)
        terealisasi = [j for j in js if j["status"] in ("approved", "posted")]
        total = sum(j["amount"] for j in terealisasi)
        bulan_ini = _awal(date.today())
        tren = []
        for i in range(months - 1, -1, -1):
            m = _geser(bulan_ini, -i)
            xs = [j for j in terealisasi if _awal(j["journal_date"]) == m]
            tren.append({"month": m.strftime("%Y-%m"), "total": round(sum(j["amount"] for j in xs), 2), "count": len(xs)})
        kat: Dict[str, float] = defaultdict(float)
        pihak: Dict[str, Dict[str, Any]] = {}
        for j in terealisasi:
            kat[j["category_label"]] += j["amount"]
            if j["reference"]:
                p = pihak.setdefault(j["reference"], {"party": j["reference"], "amount": 0.0, "count": 0})
                p["amount"] += j["amount"]
                p["count"] += 1
        return {
            "kpi": {"total": round(total, 2), "count": len(terealisasi), "average": round(total / len(terealisasi), 2) if terealisasi else 0.0,
                    "unposted": sum(1 for j in js if j["status"] in ("draft", "approved")),
                    "needs_review": sum(1 for j in js if j["status"] not in ("posted", "reversed") and j["issues"]),
                    "draft_count": sum(1 for j in js if j["status"] == "draft"),
                    "draft_total": round(sum(j["amount"] for j in js if j["status"] == "draft"), 2)},
            "trend": tren,
            "by_category": [{"category": k, "amount": round(v, 2)} for k, v in sorted(kat.items(), key=lambda t: -t[1])],
            "top_parties": sorted(pihak.values(), key=lambda p: -p["amount"])[:5],
            "journals": js,
        }
    return bc._respon(aksi)


@router.get("/source-lines", summary="Source Data: semua baris jurnal + kualitas data")
def baris_sumber(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        akun = {a.acc_no: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}
        rows = []
        for j in _semua(session, kid):
            for l in j["lines"]:
                a = akun.get(l["account_code"])
                masalah = []
                if not j["journal_no"]:
                    masalah.append("No journal number")
                if a is None:
                    masalah.append("Account not in COA")
                elif not a.standard_account_code:
                    masalah.append("Account not mapped to a standard account")
                if any(i["code"] == "unbalanced" for i in j["issues"]):
                    masalah.append("Journal not balanced")
                rows.append({"journal_id": j["id"], "journal_no": j["journal_no"], "date": j["journal_date"], "category": j["category_label"],
                             "reference": j["reference"], "account_code": l["account_code"], "account_name": l["account_name"],
                             "description": l["description"] or j["description"], "debit": l["debit"], "credit": l["credit"],
                             "status": j["status"], "standard_code": a.standard_account_code if a is not None else None,
                             "problems": masalah})
        n = len(rows)
        komposisi: Dict[str, int] = defaultdict(int)
        for r in rows:
            komposisi[r["category"]] += 1
        return {"rows": rows, "quality": {
            "total": n, "clean": sum(1 for r in rows if not r["problems"]),
            "with_number": sum(1 for r in rows if r["journal_no"]), "mapped": sum(1 for r in rows if r["standard_code"])},
            "composition": [{"category": k, "count": v} for k, v in sorted(komposisi.items(), key=lambda t: -t[1])]}
    return bc._respon(aksi)


@router.get("/posted", summary="Posted: nilai posting per bulan + daftar jurnal posted/reversed")
def posted(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)

    def aksi(session):
        js = [j for j in _semua(session, kid) if j["status"] in ("posted", "reversed")]
        aktif = [j for j in js if j["status"] == "posted"]
        bulan: Dict[str, float] = defaultdict(float)
        for j in aktif:
            bulan[j["journal_date"].strftime("%Y-%m")] += j["amount"]
        terakhir = sorted(bulan.keys())[-12:]
        total = sum(j["amount"] for j in aktif)
        return {"monthly": [{"month": m, "total": round(bulan[m], 2)} for m in terakhir],
                "total": round(total, 2), "count": len(aktif), "average": round(total / len(aktif), 2) if aktif else None,
                "reversed_count": sum(1 for j in js if j["status"] == "reversed"), "journals": js}
    return bc._respon(aksi)


# ============================================================
# ENDPOINT -- TULIS
# ============================================================

def _nomor_berikut(session, kid: str, tgl: date) -> str:
    awalan = f"OTH-{tgl.year}-{tgl.month:02d}-"
    nomor = [n for (n,) in session.query(JR.journal_no).filter(JR.client_id == kid, JR.journal_no.like(f"{awalan}%")).all()]
    urut = max((int(m.group(1)) for n in nomor if (m := re.fullmatch(rf"{awalan}(\d+)", n or ""))), default=0)
    return f"{awalan}{urut + 1:04d}"


class BarisIn(BaseModel):
    coa_id: Optional[UUID] = None
    account_code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, max_length=1000)
    debit: float = Field(0, ge=0)
    credit: float = Field(0, ge=0)


class JurnalRequest(BaseModel):
    client_id: UUID
    journal_no: Optional[str] = Field(None, max_length=40)
    journal_date: date
    category: Literal["general", "capex", "accrual", "prepaid", "reclass", "correction", "payroll", "uncategorized", "other"] = "general"
    reference: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = Field(None, max_length=2000)
    review_note: Optional[str] = Field(None, max_length=2000)
    lines: List[BarisIn] = Field(..., min_length=1, max_length=500)


def _simpan(session, kid: str, p: JurnalRequest, user: Dict[str, Any], j: Any = None) -> Any:
    akun_id = {a.id: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}
    akun_kode = {a.acc_no: a for a in akun_id.values()}
    baris = []
    for i, b in enumerate(p.lines, start=1):
        if b.debit and b.credit:
            raise _Gagal(f"Line {i}: fill either debit or credit, not both.")
        if not b.debit and not b.credit:
            continue
        a = akun_id.get(str(b.coa_id)) if b.coa_id else akun_kode.get((b.account_code or "").strip())
        if a is None:
            raise _Gagal(f"Line {i}: choose an account from the chart of accounts.")
        baris.append((a, b))
    if not baris:
        raise _Gagal("Enter at least one line with an amount.")
    nomor = (_teks(p.journal_no) or (j.journal_no if j is not None else None) or _nomor_berikut(session, kid, p.journal_date)).upper()
    lain = session.query(JR).filter(JR.client_id == kid, JR.journal_no == nomor)
    if j is not None:
        lain = lain.filter(JR.id != j.id)
    if lain.first() is not None:
        raise _Gagal(f"Journal number {nomor} is already used.", kode="CONFLICT", status_code=409)
    td = sum((bc._dec(b.debit) for _, b in baris), NOL)
    tk = sum((bc._dec(b.credit) for _, b in baris), NOL)
    nilai = dict(journal_no=nomor, journal_date=p.journal_date, category=p.category, reference=_teks(p.reference),
                 description=_teks(p.description), review_note=_teks(p.review_note), total_debit=td, total_credit=tk)
    if j is None:
        j = JR(client_id=kid, status="draft", source="manual", created_by=user.get("id"), created_by_name=_nama(user), **nilai)
        session.add(j)
        session.flush()
    else:
        if j.status not in ("draft", "rejected", "approved"):
            raise _Gagal(f"{j.journal_no} is {j.status} and can no longer be edited.", kode="CONFLICT", status_code=409)
        for k, v in nilai.items():
            setattr(j, k, v)
        # Mengubah jurnal yang sudah approved/rejected mengembalikannya ke draft (perlu approval ulang).
        j.status, j.approved_at, j.approved_by, j.approved_by_name, j.rejected_reason = "draft", None, None, None, None
        j.edited_at, j.edited_by = _sekarang(), user.get("id")
        session.query(JL).filter(JL.journal_id == j.id).delete(synchronize_session=False)
    for i, (a, b) in enumerate(baris, start=1):
        session.add(JL(journal_id=j.id, line_no=i, coa_id=a.id, account_code=a.acc_no, account_name=a.account_name,
                       description=_teks(b.description), debit=bc._dec(b.debit), credit=bc._dec(b.credit)))
    session.flush()
    return j


def _detail(session, kid: str, jid: str) -> Dict[str, Any]:
    return next(x for x in _semua(session, kid) if x["id"] == jid)


@router.post("/journals", summary="Jurnal Other baru (draft, Supervisor+)")
def buat_jurnal(payload: JurnalRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        bc._wajib_klien(kid)
        _kunci(session, kid)
        j = _simpan(session, kid, payload, current_user)
        return _detail(session, kid, j.id)
    return bc._respon(aksi, "Journal saved as draft.")


@router.put("/journals/{journal_id}", summary="Ubah jurnal draft / approved / rejected (kembali ke draft, Supervisor+)")
def ubah_jurnal(journal_id: UUID, payload: JurnalRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        j = session.get(JR, str(journal_id))
        if j is None or j.deleted_at is not None or str(j.client_id) != kid:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        _simpan(session, kid, payload, current_user, j)
        return _detail(session, kid, j.id)
    return bc._respon(aksi, "Journal updated.")


@router.delete("/journals/{journal_id}", summary="Hapus jurnal yang belum diposting (Supervisor+)")
def hapus_jurnal(journal_id: UUID, client_id: UUID = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    kid = str(client_id)

    def aksi(session):
        j = session.get(JR, str(journal_id))
        if j is None or j.deleted_at is not None or str(j.client_id) != kid:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        if j.status in ("posted", "reversed"):
            raise _Gagal("Posted journals cannot be deleted. Reverse it instead.", kode="CONFLICT", status_code=409)
        j.deleted_at, j.deleted_by = _sekarang(), current_user.get("id")
        return {"id": j.id}
    return bc._respon(aksi, "Journal deleted.")


class AksiRequest(BaseModel):
    client_id: UUID
    ids: List[UUID] = Field(..., min_length=1, max_length=500)
    reason: Optional[str] = Field(None, max_length=2000)


def _aksi(payload: AksiRequest, user: Dict[str, Any], dari: Tuple[str, ...], ke: str, label: str):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        ids = list(dict.fromkeys(str(x) for x in payload.ids))
        jurnal, baris = _muat(session, kid, ids)
        akun = {a.acc_no: a for a in session.query(COA).filter(COA.client_id == kid, COA.deleted_at.is_(None)).all()}
        kunci = _tanggal_kunci(session, kid)
        selesai, gagal_ = [], []
        for j in jurnal:
            if j.status not in dari:
                gagal_.append({"id": j.id, "journal_no": j.journal_no, "reason": f"Status is {j.status}."})
                continue
            waktu = _sekarang()
            if ke in ("approved", "posted"):
                err = [i["message"] for i in _cek(j, baris[j.id], akun, kunci) if i["level"] == "error"]
                if err:
                    gagal_.append({"id": j.id, "journal_no": j.journal_no, "reason": err[0]})
                    continue
            if ke == "approved":
                j.status, j.approved_at, j.approved_by, j.approved_by_name = "approved", waktu, user.get("id"), _nama(user)
            elif ke == "draft":
                j.status, j.approved_at, j.approved_by, j.approved_by_name, j.rejected_reason = "draft", None, None, None, None
            elif ke == "rejected":
                j.status, j.rejected_reason = "rejected", _teks(payload.reason) or "Rejected"
                j.approved_at, j.approved_by, j.approved_by_name = None, None, None
            elif ke == "posted":
                try:
                    with session.begin_nested():
                        j.status, j.posted_at, j.posted_by, j.posted_by_name = "posted", waktu, user.get("id"), _nama(user)
                        if not j.approved_at:
                            j.approved_at, j.approved_by, j.approved_by_name = waktu, user.get("id"), _nama(user)
                        session.flush()
                except Exception as e:
                    pesan = dbc.pesan_periode_terkunci(e)
                    if not pesan:
                        raise
                    gagal_.append({"id": j.id, "journal_no": j.journal_no, "reason": pesan})
                    continue
            j.edited_at, j.edited_by = waktu, user.get("id")
            selesai.append(j.journal_no)
        tidak_ada = set(ids) - {j.id for j in jurnal}
        gagal_ += [{"id": i, "reason": "Not found."} for i in tidak_ada]
        session.flush()
        return {"done": selesai, "failed": gagal_}

    try:
        data = bc._jalankan(aksi)
    except _Gagal as e:
        return bc._respon_gagal(e)
    pesan = f"{len(data['done'])} journal(s) {label}."
    if data["failed"]:
        pesan += f" {len(data['failed'])} skipped: " + "; ".join(f"{f.get('journal_no', f['id'])}: {f['reason']}" for f in data["failed"][:5])
    if not data["done"] and data["failed"]:
        return gagal(message=pesan, errors={"code": "NOTHING_DONE", "detail": data["failed"]}, status_code=422)
    return sukses(data=data, message=pesan)


@router.post("/journals/approve", summary="Approve draft (Supervisor+)")
def approve(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi(payload, current_user, ("draft",), "approved", "approved")


@router.post("/journals/return-to-draft", summary="Kembalikan approved / rejected ke draft (Supervisor+)")
def kembali_draft(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi(payload, current_user, ("approved", "rejected"), "draft", "returned to draft")


@router.post("/journals/reject", summary="Tolak draft / approved (Supervisor+)")
def tolak(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_INPUT))):
    return _aksi(payload, current_user, ("draft", "approved"), "rejected", "rejected")


@router.post("/journals/post", summary="Post jurnal approved ke buku besar (Manager+)")
def post(payload: AksiRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    return _aksi(payload, current_user, ("approved",), "posted", "posted")


class BalikRequest(BaseModel):
    client_id: UUID
    reversal_date: Optional[date] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/journals/{journal_id}/reverse", summary="Balik jurnal posted: jurnal pembalik RV- di reversal_date (Manager+)")
def balik(journal_id: UUID, payload: BalikRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_POST))):
    kid = str(payload.client_id)

    def aksi(session):
        _kunci(session, kid)
        j = session.get(JR, str(journal_id))
        if j is None or j.deleted_at is not None or str(j.client_id) != kid:
            raise _Gagal("Journal not found.", kode="NOT_FOUND", status_code=404)
        if j.status != "posted":
            raise _Gagal(f"Only posted journals can be reversed ({j.journal_no} is {j.status}).", kode="CONFLICT", status_code=409)
        tgl = payload.reversal_date or date.today()
        if tgl < j.journal_date:
            raise _Gagal("The reversal date cannot be earlier than the journal date.")
        j.status, j.reversal_date, j.reversal_reason = "reversed", tgl, payload.reason.strip()
        j.reversed_at, j.reversed_by, j.reversed_by_name = _sekarang(), current_user.get("id"), _nama(current_user)
        session.flush()
        return _detail(session, kid, j.id)
    return bc._respon(aksi, "Journal reversed.")
