"""
modules/management/opening_balance_v1.py
=========================================
Fitur Management > COA > Opening Balances (saldo awal per tahun buku &
cabang): /api/v1/management/opening-balances/...

Data di tabel `management_client_coa_opening_balances` (header) &
`management_client_coa_opening_balance_lines` (baris) -- migration 25.
Prefix SENGAJA bukan /api/v1/management/coa/... supaya tidak bentrok dengan
rute GET /api/v1/management/coa/{coa_id} di coa_v1.py.

Alur status:
    draft   -> baris bebas diubah.
    posted  -> sudah jadi 1 jurnal POSTED (source_type "Opening Balance",
               je_number OB-<tahun>-<cabang>[-R<n>]) bertanggal as_of_date di
               financial_transaction_journal_entry_drafts. Cabang ditulis ke
               cost_center tiap baris jurnal. Financial Statements otomatis
               membacanya sbg saldo awal (jurnal POSTED sebelum periode).
    revise  -> jurnal lama dibalik (RV-<nomor>, tanggal sama, POSTED) lalu
               status kembali draft; post berikutnya membuat jurnal baru.
    locked  -> tidak bisa diubah/di-revise; buka kunci khusus Tahap 5 ke atas.

Selisih total debit vs kredit TIDAK ditolak: saat post, selisihnya diparkir
ke akun penampung (suspense_coa_id) supaya user yang memutuskan tindak
lanjutnya (koreksi saldo lalu revise, atau reklas lewat jurnal biasa).

Aturan tanggal (tahun buku = tahun kalender, belum ada setting tahun buku
per klien): as_of_date antara 31 Des (tahun_buku - 1) s.d. sebelum 31 Des
tahun_buku. Cut-off 31 Des tahun sebelumnya = saldo awal tahun -> hanya
akun Neraca. Cut-off di tengah tahun (klien mulai pakai sistem di tengah
tahun) -> akun Laba Rugi boleh diisi (saldo year-to-date).

Baca: cukup token valid. Tulis/post/revise/lock: minimal Tahap 3 (sama
dengan COA). Buka kunci: minimal Tahap 5.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .clients_v1 import _require_level_v1

logger = get_module_logger("management_opening_balance_v1")

router = APIRouter(prefix="/api/v1/management/opening-balances", tags=["management-opening-balance-v1"])

LEVEL_MINIMAL_UBAH = 3
LEVEL_MINIMAL_BUKA_KUNCI = 5
SOURCE_TYPE_JURNAL = "Opening Balance"
NOL = Decimal("0")
SEN = Decimal("0.01")
KLASIFIKASI_NERACA = {"ASSET", "LIABILITY", "EQUITY"}
# Akun Current Year Earnings (laba tahun berjalan) TIDAK boleh diisi/dijurnal di
# opening balance: Financial Statements sudah menghitung laba tahun berjalan dari
# akun P&L (financial_statements/core.py -- ekuitas + laba_ytd). Kalau akun ini
# ikut dijurnal, laba terhitung dua kali & jurnal opening tidak balance. Nilainya
# cuma ditampilkan sbg info di editor (FE): sum(kredit - debit) akun P&L.
STANDARD_CODE_LABA_BERJALAN = "std_equity_current_period_earnings"
_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

OB = dbc.ManagementClientCoaOpeningBalance
OBL = dbc.ManagementClientCoaOpeningBalanceLine
COA = dbc.ManagementClientCoa


class _Gagal(Exception):
    def __init__(self, message: str, kode: str = "VALIDATION_ERROR", status_code: int = 400):
        super().__init__(message)
        self.message, self.kode, self.status_code = message, kode, status_code


def _respon_gagal(e: _Gagal):
    return gagal(message=e.message, errors={"code": e.kode}, status_code=e.status_code)


# ============================================================
# SKEMA REQUEST
# ============================================================

class OpeningBalanceCreateRequest(BaseModel):
    client_id: UUID
    fiscal_year: int = Field(..., ge=1900, le=2999)
    as_of_date: Optional[date] = None          # default 31 Des (fiscal_year - 1)
    branch: Optional[str] = Field(None, max_length=100)
    suspense_coa_id: Optional[UUID] = None
    reference: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class OpeningBalanceUpdateRequest(BaseModel):
    """Partial update header (hanya status draft). client/tahun/cabang tetap."""
    as_of_date: Optional[date] = None
    suspense_coa_id: Optional[UUID] = None
    reference: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None


class OpeningBalanceLineIn(BaseModel):
    coa_id: UUID
    debit: Decimal = Field(default=NOL, ge=0)
    credit: Decimal = Field(default=NOL, ge=0)
    notes: Optional[str] = None


class OpeningBalanceLinesRequest(BaseModel):
    """Ganti SELURUH baris (baris debit=0 & kredit=0 dibuang)."""
    lines: List[OpeningBalanceLineIn] = Field(default_factory=list, max_length=10000)


class ReviseRequest(BaseModel):
    reason: Optional[str] = Field(None, max_length=500)


# ============================================================
# HELPER
# ============================================================

def _dec(v: Any) -> Decimal:
    try:
        return Decimal(str(v or 0)).quantize(SEN)
    except (InvalidOperation, ValueError):
        return NOL


def _rapikan(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip()
    return v or None


def _awal_tahun_buku(fiscal_year: int) -> date:
    return date(fiscal_year - 1, 12, 31)


def _validasi_tanggal(fiscal_year: int, as_of: date) -> None:
    awal, akhir = _awal_tahun_buku(fiscal_year), date(fiscal_year, 12, 31)
    if not (awal <= as_of < akhir):
        raise _Gagal(
            f"Tanggal cut-off untuk tahun buku {fiscal_year} harus antara {awal.isoformat()} "
            f"dan sebelum {akhir.isoformat()}.",
            kode="INVALID_AS_OF_DATE",
        )


def _awal_tahun(ob: Any) -> bool:
    """True = cut-off 31 Des tahun sebelumnya (saldo awal tahun, hanya akun Neraca)."""
    return ob.as_of_date == _awal_tahun_buku(ob.fiscal_year)


def _akun_klien(session, client_id: str, coa_id: str) -> Any:
    akun = session.query(COA).filter(
        COA.id == str(coa_id), COA.client_id == client_id, COA.deleted_at.is_(None),
    ).first()
    if akun is None:
        raise _Gagal("Akun COA tidak ditemukan di klien ini.", kode="COA_NOT_FOUND", status_code=404)
    return akun


def _ambil_header(session, ob_id: str) -> Any:
    try:
        UUID(str(ob_id))
    except ValueError:
        raise _Gagal("Opening balance tidak ditemukan.", kode="NOT_FOUND", status_code=404)
    ob = session.query(OB).filter(OB.id == ob_id, OB.deleted_at.is_(None)).first()
    if ob is None:
        raise _Gagal("Opening balance tidak ditemukan.", kode="NOT_FOUND", status_code=404)
    return ob


def _wajib_draft(ob: Any) -> None:
    if ob.status != "draft":
        pesan = ("Opening balance sudah dikunci." if ob.status == "locked"
                 else "Opening balance sudah di-post. Klik Revise dulu untuk mengubahnya.")
        raise _Gagal(pesan, kode=f"STATUS_{ob.status.upper()}", status_code=409)


def _akun_ringkas(akun: Any) -> Optional[Dict[str, Any]]:
    if akun is None:
        return None
    return {
        "id": akun.id, "acc_no": akun.acc_no, "account_name": akun.account_name,
        "account_classification": akun.account_classification, "normal_balance": akun.normal_balance,
    }


def _ringkasan(session, ob: Any) -> Dict[str, Any]:
    """Header + total baris + info penampung & jurnal (tanpa daftar baris)."""
    total = session.query(
        func.coalesce(func.sum(OBL.debit), 0), func.coalesce(func.sum(OBL.credit), 0), func.count(OBL.id),
    ).filter(OBL.opening_balance_id == ob.id).one()
    total_d, total_k = _dec(total[0]), _dec(total[1])
    selisih = total_d - total_k
    suspense = session.get(COA, ob.suspense_coa_id) if ob.suspense_coa_id else None
    jurnal = session.get(dbc.JournalEntryDraft, ob.journal_entry_id) if ob.journal_entry_id else None
    return {
        "id": ob.id,
        "client_id": ob.client_id,
        "fiscal_year": ob.fiscal_year,
        "as_of_date": ob.as_of_date,
        "is_year_start": _awal_tahun(ob),
        "branch": ob.branch,
        "reference": ob.reference,
        "notes": ob.notes,
        "status": ob.status,
        "revision": ob.revision,
        "suspense_account": _akun_ringkas(suspense),
        "total_debit": float(total_d),
        "total_credit": float(total_k),
        # >0 = debit lebih besar -> penampung dikredit; <0 = sebaliknya.
        "difference": float(selisih),
        "line_count": int(total[2]),
        "journal": {"id": jurnal.id, "je_number": jurnal.je_number, "status": jurnal.status} if jurnal else None,
        "posted_at": ob.posted_at,
        "locked_at": ob.locked_at,
        "created_at": ob.created_at,
        "edited_at": ob.edited_at,
    }


def _detail(session, ob: Any) -> Dict[str, Any]:
    data = _ringkasan(session, ob)
    rows = (
        session.query(OBL, COA)
        .join(COA, COA.id == OBL.coa_id)
        .filter(OBL.opening_balance_id == ob.id)
        .order_by(COA.acc_no)
        .all()
    )
    data["lines"] = [{
        "id": baris.id, "coa_id": baris.coa_id, "debit": float(_dec(baris.debit)), "credit": float(_dec(baris.credit)),
        "notes": baris.notes, "account": _akun_ringkas(akun),
    } for baris, akun in rows]
    return data


def _akun_laba_berjalan(akun: Any) -> bool:
    return (akun.standard_account_code or "").strip().lower() == STANDARD_CODE_LABA_BERJALAN


def _tolak_laba_berjalan(akun_list) -> None:
    kena = sorted(f"{a.acc_no} {a.account_name}" for a in akun_list if _akun_laba_berjalan(a))
    if kena:
        raise _Gagal(
            f"Akun Current Year Earnings ({', '.join(kena)}) dihitung otomatis dari akun Laba Rugi dan tidak "
            "dijurnal di opening balance -- kosongkan saldonya.",
            kode="CURRENT_YEAR_EARNINGS_AUTO",
        )


def _no_jurnal(ob: Any) -> str:
    cabang = "".join(ch for ch in (ob.branch or "HO").upper() if ch.isalnum())[:20] or "HO"
    nomor = f"OB-{ob.fiscal_year}-{cabang}"
    return f"{nomor}-R{ob.revision}" if ob.revision else nomor


def _tulis_jurnal(session, ob: Any, *, je_number: str, baris: List[Dict[str, Any]], description: str,
                  user: Dict[str, Any]) -> Any:
    """Insert 1 jurnal POSTED + barisnya (pola sama dgn bank_reconciliation_v1._tulis_jurnal). TIDAK commit."""
    tgl = ob.as_of_date
    nama = user.get("nama") or user.get("username")
    je = dbc.JournalEntryDraft(
        client_id=user.get("id"), management_client_id=ob.client_id, je_number=je_number[:100],
        entry_date=tgl, posting_date=tgl, period_label=f"{_BULAN[tgl.month - 1]} {tgl.year}",
        description=description[:2000], source_type=SOURCE_TYPE_JURNAL, source_reference=str(ob.id),
        total_debit=sum((b["debit"] for b in baris), NOL), total_credit=sum((b["credit"] for b in baris), NOL),
        currency="IDR", status="posted", created_by=user.get("id"), created_by_name=nama, approved_by_name=nama,
        posted_at=datetime.now(), posted_by=user.get("id"),
    )
    session.add(je)
    session.flush()
    for no, b in enumerate(baris, 1):
        session.add(dbc.JournalEntryDraftLine(
            draft_id=je.id, client_id=user.get("id"), line_no=no,
            account_code=b["account_code"], account_name=(b["account_name"] or "")[:200],
            description=(b.get("description") or "")[:2000], debit=b["debit"], credit=b["credit"],
            cost_center=ob.branch, created_by=user.get("id"),
        ))
    session.flush()
    return je


def _jalankan(fn):
    """Bungkus 1 aksi tulis: 1 session, commit kalau sukses, rollback kalau gagal."""
    session = dbc.SessionLocal()
    try:
        hasil = fn(session)
        session.commit()
        return hasil
    except _Gagal:
        session.rollback()
        raise
    except Exception:
        session.rollback()
        logger.exception("Gagal memproses opening balance")
        raise
    finally:
        session.close()


# ============================================================
# ENDPOINT
# ============================================================

@router.get("", summary="Daftar opening balance 1 klien")
def daftar_opening_balance(
    client_id: UUID = Query(...),
    fiscal_year: Optional[int] = Query(None),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    session = dbc.SessionLocal()
    try:
        q = session.query(OB).filter(OB.client_id == str(client_id), OB.deleted_at.is_(None))
        if fiscal_year:
            q = q.filter(OB.fiscal_year == fiscal_year)
        rows = q.order_by(OB.fiscal_year.desc(), func.coalesce(OB.branch, "")).all()
        return sukses(data=[_ringkasan(session, ob) for ob in rows])
    finally:
        session.close()


@router.get("/branches", summary="Saran nama cabang 1 klien")
def daftar_cabang(client_id: UUID = Query(...), _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    """Belum ada master cabang -- saran diambil dari cabang yang sudah pernah
    dipakai (data sales & opening balance klien ini)."""
    session = dbc.SessionLocal()
    try:
        rows = session.execute(text("""
            select distinct trim(cabang) as b from financial_transaction_sales_invoices
             where management_client_id = cast(:c as uuid) and coalesce(trim(cabang), '') <> ''
            union
            select distinct trim(branch) from management_client_coa_opening_balances
             where client_id = cast(:c as uuid) and deleted_at is null and coalesce(trim(branch), '') <> ''
            order by 1
        """), {"c": str(client_id)}).scalars().all()
        return sukses(data=list(rows))
    finally:
        session.close()


@router.get("/{ob_id}", summary="Detail opening balance + baris")
def detail_opening_balance(ob_id: str, _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        return sukses(data=_detail(session, _ambil_header(session, ob_id)))
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()


@router.post("", summary="Buat opening balance (draft)")
def buat_opening_balance(
    payload: OpeningBalanceCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH)),
):
    def aksi(session):
        client_id = str(payload.client_id)
        if dbc.get_management_client_by_id(client_id) is None:
            raise _Gagal("Client tidak ditemukan.", kode="NOT_FOUND", status_code=404)
        as_of = payload.as_of_date or _awal_tahun_buku(payload.fiscal_year)
        _validasi_tanggal(payload.fiscal_year, as_of)
        branch = _rapikan(payload.branch)
        bentrok = session.query(OB).filter(
            OB.client_id == client_id, OB.fiscal_year == payload.fiscal_year, OB.deleted_at.is_(None),
            func.coalesce(OB.branch, "") == (branch or ""),
        ).first()
        if bentrok:
            raise _Gagal(
                f"Opening balance tahun buku {payload.fiscal_year} untuk "
                f"{'cabang ' + branch if branch else 'tanpa cabang'} sudah ada.",
                kode="DUPLICATE", status_code=409,
            )
        suspense_id = str(payload.suspense_coa_id) if payload.suspense_coa_id else None
        if suspense_id:
            _akun_klien(session, client_id, suspense_id)
        else:
            # Default akun penampung = Opening Balance Equity di Settings > Account Mapping.
            suspense_id = (dbc.akun_mapping_setting(client_id, session=session).get("opening_balance_equity") or {}).get("coa_id")
        ob = OB(
            client_id=client_id, fiscal_year=payload.fiscal_year, as_of_date=as_of, branch=branch,
            suspense_coa_id=suspense_id,
            reference=_rapikan(payload.reference), notes=_rapikan(payload.notes),
            status="draft", revision=0, created_by=current_user.get("id"),
        )
        session.add(ob)
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Opening balance dibuat.", status_code=201)
    except _Gagal as e:
        return _respon_gagal(e)


@router.put("/{ob_id}", summary="Ubah header opening balance (draft)")
def ubah_opening_balance(
    ob_id: str,
    payload: OpeningBalanceUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH)),
):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        _wajib_draft(ob)
        data = payload.model_dump(exclude_unset=True)
        if "as_of_date" in data and data["as_of_date"]:
            _validasi_tanggal(ob.fiscal_year, data["as_of_date"])
            ob.as_of_date = data["as_of_date"]
        if "suspense_coa_id" in data:
            if data["suspense_coa_id"]:
                _akun_klien(session, ob.client_id, str(data["suspense_coa_id"]))
            ob.suspense_coa_id = str(data["suspense_coa_id"]) if data["suspense_coa_id"] else None
        if "reference" in data:
            ob.reference = _rapikan(data["reference"])
        if "notes" in data:
            ob.notes = _rapikan(data["notes"])
        ob.edited_at, ob.edited_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Opening balance diperbarui.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.put("/{ob_id}/lines", summary="Simpan seluruh baris saldo (draft)")
def simpan_baris(
    ob_id: str,
    payload: OpeningBalanceLinesRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH)),
):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        _wajib_draft(ob)
        terisi = [b for b in payload.lines if _dec(b.debit) > 0 or _dec(b.credit) > 0]
        dipakai = set()
        for b in terisi:
            if _dec(b.debit) > 0 and _dec(b.credit) > 0:
                raise _Gagal("Satu akun hanya boleh diisi debit ATAU kredit.", kode="BOTH_SIDES")
            if str(b.coa_id) in dipakai:
                raise _Gagal("Ada akun yang diisi lebih dari sekali.", kode="DUPLICATE_ACCOUNT")
            dipakai.add(str(b.coa_id))

        akun_map = {
            a.id: a for a in session.query(COA).filter(
                COA.id.in_(dipakai or {""}), COA.client_id == ob.client_id, COA.deleted_at.is_(None),
            ).all()
        } if dipakai else {}
        hilang = dipakai - set(akun_map)
        if hilang:
            raise _Gagal(f"{len(hilang)} akun tidak ditemukan di COA klien ini.", kode="COA_NOT_FOUND", status_code=404)
        _tolak_laba_berjalan(akun_map.values())
        if _awal_tahun(ob):
            laba_rugi = sorted(
                a.acc_no for a in akun_map.values() if (a.account_classification or "").upper() not in KLASIFIKASI_NERACA
            )
            if laba_rugi:
                raise _Gagal(
                    "Cut-off di awal tahun buku hanya untuk akun Neraca (Asset/Liability/Equity) -- laba tahun lalu "
                    f"masuk ke Retained Earnings. Akun Laba Rugi: {', '.join(laba_rugi[:10])}. Untuk klien yang mulai "
                    "di tengah tahun, ubah tanggal cut-off dulu.",
                    kode="PL_ACCOUNT_AT_YEAR_START",
                )

        session.query(OBL).filter(OBL.opening_balance_id == ob.id).delete(synchronize_session=False)
        for b in terisi:
            session.add(OBL(
                opening_balance_id=ob.id, coa_id=str(b.coa_id), debit=_dec(b.debit), credit=_dec(b.credit),
                notes=_rapikan(b.notes), created_by=current_user.get("id"),
            ))
        ob.edited_at, ob.edited_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Saldo awal disimpan.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/{ob_id}/post", summary="Post opening balance jadi jurnal POSTED")
def post_opening_balance(ob_id: str, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH))):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        _wajib_draft(ob)
        rows = (
            session.query(OBL, COA).join(COA, COA.id == OBL.coa_id)
            .filter(OBL.opening_balance_id == ob.id).order_by(COA.acc_no).all()
        )
        if not rows:
            raise _Gagal("Belum ada saldo yang diisi.", kode="NO_LINES")
        _tolak_laba_berjalan(akun for _, akun in rows)

        label = f"Saldo awal {ob.fiscal_year}" + (f" - {ob.branch}" if ob.branch else "")
        baris = [{
            "account_code": akun.acc_no, "account_name": akun.account_name,
            "description": f"{label}: {akun.account_name}", "debit": _dec(b.debit), "credit": _dec(b.credit),
        } for b, akun in rows]

        selisih = sum((b["debit"] - b["credit"] for b in baris), NOL)
        if selisih != 0:
            if not ob.suspense_coa_id:
                # Belum dipilih -> pakai Opening Balance Equity dari Settings > Account Mapping.
                ob.suspense_coa_id = (dbc.akun_mapping_setting(ob.client_id, session=session).get("opening_balance_equity") or {}).get("coa_id")
            if not ob.suspense_coa_id:
                raise _Gagal(
                    f"Total debit dan kredit selisih {abs(selisih):,.2f}. Pilih akun penampung dulu (atau atur "
                    "Opening Balance Equity di Settings > Account Mapping) -- selisihnya akan diparkir di sana.",
                    kode="SUSPENSE_REQUIRED",
                )
            penampung = _akun_klien(session, ob.client_id, ob.suspense_coa_id)
            baris.append({
                "account_code": penampung.acc_no, "account_name": penampung.account_name,
                "description": f"{label}: selisih saldo awal (penampung)",
                "debit": -selisih if selisih < 0 else NOL, "credit": selisih if selisih > 0 else NOL,
            })

        je = _tulis_jurnal(
            session, ob, je_number=_no_jurnal(ob), baris=baris, user=current_user,
            description=f"{label} per {ob.as_of_date.isoformat()}" + (f" ({ob.reference})" if ob.reference else ""),
        )
        ob.journal_entry_id = je.id
        ob.status = "posted"
        ob.posted_at, ob.posted_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Opening balance di-post.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/{ob_id}/revise", summary="Balik jurnal opening balance & kembali ke draft")
def revise_opening_balance(
    ob_id: str,
    payload: ReviseRequest = ReviseRequest(),
    current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH)),
):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        if ob.status == "locked":
            raise _Gagal("Opening balance sudah dikunci.", kode="STATUS_LOCKED", status_code=409)
        if ob.status != "posted" or not ob.journal_entry_id:
            raise _Gagal("Hanya opening balance yang sudah di-post yang bisa di-revise.", kode="STATUS_DRAFT", status_code=409)
        asal = session.get(dbc.JournalEntryDraft, ob.journal_entry_id)
        baris_asal = session.query(dbc.JournalEntryDraftLine).filter(
            dbc.JournalEntryDraftLine.draft_id == ob.journal_entry_id, dbc.JournalEntryDraftLine.deleted_at.is_(None),
        ).order_by(dbc.JournalEntryDraftLine.line_no).all()
        if asal is not None and baris_asal:
            alasan = _rapikan(payload.reason) or "Revisi saldo awal"
            # Pembalik bertanggal SAMA dgn jurnal asal -> netto nol di semua periode laporan.
            rv = _tulis_jurnal(
                session, ob, je_number=f"RV-{asal.je_number}", user=current_user,
                description=f"Pembalik {asal.je_number}: {alasan}",
                baris=[{
                    "account_code": b.account_code, "account_name": b.account_name,
                    "description": f"Pembalik {asal.je_number}", "debit": _dec(b.credit), "credit": _dec(b.debit),
                } for b in baris_asal],
            )
            rv.notes = alasan
        ob.journal_entry_id = None
        ob.status = "draft"
        ob.revision = (ob.revision or 0) + 1
        ob.posted_at = ob.posted_by = None
        ob.edited_at, ob.edited_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Jurnal saldo awal dibalik, status kembali draft.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/{ob_id}/lock", summary="Kunci opening balance")
def lock_opening_balance(ob_id: str, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH))):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        if ob.status != "posted":
            raise _Gagal("Hanya opening balance yang sudah di-post yang bisa dikunci.", kode=f"STATUS_{ob.status.upper()}", status_code=409)
        ob.status = "locked"
        ob.locked_at, ob.locked_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Opening balance dikunci.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/{ob_id}/unlock", summary="Buka kunci opening balance (Tahap 5+)")
def unlock_opening_balance(ob_id: str, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_BUKA_KUNCI))):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        if ob.status != "locked":
            raise _Gagal("Opening balance tidak sedang dikunci.", kode=f"STATUS_{ob.status.upper()}", status_code=409)
        ob.status = "posted"
        ob.locked_at = ob.locked_by = None
        ob.edited_at, ob.edited_by = datetime.now(), current_user.get("id")
        session.flush()
        return _detail(session, ob)

    try:
        return sukses(data=_jalankan(aksi), message="Kunci opening balance dibuka.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.delete("/{ob_id}", summary="Hapus opening balance (draft)")
def hapus_opening_balance(ob_id: str, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_UBAH))):
    def aksi(session):
        ob = _ambil_header(session, ob_id)
        _wajib_draft(ob)
        ob.deleted_at, ob.deleted_by = datetime.now(), current_user.get("id")
        return None

    try:
        _jalankan(aksi)
        return sukses(data=None, message="Opening balance dihapus.")
    except _Gagal as e:
        return _respon_gagal(e)
