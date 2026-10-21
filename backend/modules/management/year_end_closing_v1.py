"""
modules/management/year_end_closing_v1.py
==========================================
Fitur Management > Year-End Closing (tutup buku tahunan):
/api/v1/management/year-end-closing/...

    GET  ""            daftar tahun buku klien + status (open/closed/reopened)
    GET  /status       ringan: tanggal kunci & tahun yang tertutup (badge FS/transaksi)
    GET  /preview      checklist pre-closing + usulan jurnal penutup 1 tahun buku
    POST /close        tutup buku (Tahap 4+): jurnal penutup + kunci periode
    POST /reopen       buka kembali (Tahap 5+, wajib alasan): jurnal penutup dibalik
    GET  /history      audit trail close/reopen
    GET  /workspace    semua klien: KPI + daftar tahun buku (ringan, tanpa hitung FS)
    GET  /detail       1 tahun yang (pernah) ditutup: snapshot, jurnal, audit trail

Tahun buku = tahun kalender (FS juga memakai Jan-Des; setting
tahun_buku_mulai di klien belum dipakai). Klien yang mulai pembukuan di
tengah tahun: periode tahun pertama mulai bulan pertama pembukuan
(sama dengan Buku.awal_pnl).

Tutup buku:
  1. Checklist harus lolos (tahun sudah berakhir, jurnal posted seimbang,
     Balance Sheet seimbang, akun Retained Earnings ada, tahun berikutnya
     belum ditutup). Peringatan (draft yang belum di-post, akun tanpa
     mapping, tahun sebelumnya belum ditutup) tidak memblokir.
  2. Jurnal POSTED source_type "Year-End Closing" (CL-<tahun>[-R<n>])
     bertanggal akhir tahun: tiap akun P&L dinolkan, selisihnya (= laba
     bersih) ke akun Retained Earnings.
  3. Baris management_client_fiscal_closings status 'closed' -> trigger DB
     (migrations/33-*.py) menolak posting/ubah/hapus transaksi posted
     bertanggal <= akhir tahun itu.

Financial Statements TIDAK membaca jurnal penutup (lihat
db_client.ambil_baris_jurnal_posted_transaksi): P&L tahun yang ditutup tetap
tampil apa adanya, dan Retained Earnings di Balance Sheet tetap = akumulasi
laba tahun-tahun sebelumnya -- angkanya sama dengan hasil jurnal penutup
selama periode terkunci. General Ledger menampilkan jurnal penutupnya.

Buka kembali: hanya tahun tertutup TERAKHIR. Status jadi 'reopened' dulu
(kunci lepas), lalu jurnal pembalik RV-CL-... bertanggal sama di-post.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..financial_statements import fs_store, mapped
from ..logging_config import get_module_logger
from .clients_v1 import _require_level_v1

logger = get_module_logger("management_year_end_closing_v1")

router = APIRouter(prefix="/api/v1/management/year-end-closing", tags=["management-year-end-closing-v1"])

LEVEL_MINIMAL_TUTUP = 4
LEVEL_MINIMAL_BUKA = 5
STANDARD_CODE_LABA_DITAHAN = "std_equity_retained_earnings"
STANDARD_CODE_LABA_BERJALAN = "std_equity_current_period_earnings"
MAPPING_KEY_LABA_DITAHAN = "retained_earnings"
SEN = Decimal("0.01")
NOL = Decimal("0")
_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]

FC = dbc.ManagementClientFiscalClosing
FCL = dbc.ManagementClientFiscalClosingLog
COA = dbc.ManagementClientCoa
JE = dbc.JournalEntryDraft
JEL = dbc.JournalEntryDraftLine


class _Gagal(Exception):
    def __init__(self, message: str, kode: str = "VALIDATION_ERROR", status_code: int = 400, data: Any = None):
        super().__init__(message)
        self.message, self.kode, self.status_code, self.data = message, kode, status_code, data


def _respon_gagal(e: _Gagal):
    errors: Dict[str, Any] = {"code": e.kode}
    if e.data is not None:
        errors["detail"] = e.data
    return gagal(message=e.message, errors=errors, status_code=e.status_code)


class CloseRequest(BaseModel):
    client_id: UUID
    fiscal_year: int = Field(..., ge=1900, le=2999)
    retained_earnings_coa_id: Optional[UUID] = None
    notes: Optional[str] = Field(None, max_length=2000)


class ReopenRequest(BaseModel):
    client_id: UUID
    fiscal_year: int = Field(..., ge=1900, le=2999)
    reason: str = Field(..., min_length=5, max_length=2000)


# ============================================================
# HELPER
# ============================================================

def _r(v: float) -> float:
    return round(float(v or 0), 2) + 0.0


def _dec(v: float) -> Decimal:
    return Decimal(str(round(float(v or 0), 2))).quantize(SEN)


def _nama(user: Dict[str, Any]) -> str:
    return user.get("nama") or user.get("username") or ""


def _wajib_klien(client_id: str) -> None:
    if dbc.get_management_client_by_id(client_id) is None:
        raise _Gagal("Client not found.", kode="NOT_FOUND", status_code=404)


def _periode(buku: mapped.Buku, fy: int) -> tuple:
    akhir = date(fy, 12, 31)
    return buku.awal_pnl(akhir), akhir


def _akun_ringkas(akun: Any) -> Optional[Dict[str, Any]]:
    if akun is None:
        return None
    return {"id": akun.id, "acc_no": akun.acc_no, "account_name": akun.account_name,
            "account_classification": akun.account_classification}


def _akun_ekuitas(session, client_id: str) -> List[Any]:
    rows = session.query(COA).filter(
        COA.client_id == client_id, COA.deleted_at.is_(None),
        func.upper(COA.account_classification) == "EQUITY",
    ).order_by(COA.acc_no).all()
    return [a for a in rows if (a.standard_account_code or "").strip().lower() != STANDARD_CODE_LABA_BERJALAN]


def _akun_laba_ditahan_default(session, client_id: str) -> Optional[Any]:
    """Settings > Account Mapping (retained_earnings), lalu akun COA dengan
    standard code Retained Earnings."""
    m = dbc.akun_mapping_setting(client_id, session=session).get(MAPPING_KEY_LABA_DITAHAN)
    if m:
        akun = session.get(COA, m["coa_id"])
        if akun is not None and akun.deleted_at is None:
            return akun
    return session.query(COA).filter(
        COA.client_id == client_id, COA.deleted_at.is_(None),
        func.lower(COA.standard_account_code) == STANDARD_CODE_LABA_DITAHAN,
    ).order_by(COA.acc_no).first()


def _tanggal_kunci(session, client_id: str) -> Optional[date]:
    return session.query(func.max(FC.period_end)).filter(FC.client_id == client_id, FC.status == "closed").scalar()


def _ringkasan_laba(buku: mapped.Buku, dari: date, sampai: date) -> Dict[str, Any]:
    """Mutasi tiap akun P&L di [dari, sampai] + pendapatan / beban / laba."""
    akun, pendapatan, beban = [], 0.0, 0.0
    for kode, info in buku.akun("PL"):
        m = buku.mutasi(kode, dari, sampai)  # debit - kredit
        if abs(m) < 0.005:
            continue
        if info["section"] in mapped.SEKSI_KREDIT:
            pendapatan += -m
        else:
            beban += m
        akun.append({"code": kode, "name": info["name"], "section": info["section"], "movement": _r(m)})
    return {"revenue": _r(pendapatan), "expenses": _r(beban), "net_profit": _r(pendapatan - beban), "accounts": akun}


def _baris_jurnal_penutup(ringkas: Dict[str, Any], akun_ld: Any) -> List[Dict[str, Any]]:
    """Tiap akun P&L dibalik ke nol; laba bersih ke Retained Earnings."""
    baris = []
    for a in ringkas["accounts"]:
        m = a["movement"]
        baris.append({
            "account_code": a["code"], "account_name": a["name"],
            "description": f"Close {a['name']} to retained earnings",
            "debit": _dec(-m) if m < 0 else NOL, "credit": _dec(m) if m > 0 else NOL,
        })
    laba = _dec(ringkas["net_profit"])
    selisih = sum((b["debit"] - b["credit"] for b in baris), NOL)  # = laba (pembulatan)
    if baris and selisih != 0:
        baris.append({
            "account_code": akun_ld.acc_no, "account_name": akun_ld.account_name,
            "description": "Net profit for the year transferred to retained earnings" if laba >= 0
            else "Net loss for the year transferred to retained earnings",
            "debit": -selisih if selisih < 0 else NOL, "credit": selisih if selisih > 0 else NOL,
        })
    return baris


def _dokumen_belum_posted(session, client_id: str, dari: date, sampai: date) -> Dict[str, int]:
    p = {"c": client_id, "a": dari, "b": sampai}
    je = session.execute(text("""
        select count(*) from financial_transaction_journal_entry_drafts
         where management_client_id = cast(:c as uuid) and deleted_at is null
           and entry_date between :a and :b and lower(status) not in ('posted', 'rejected')
    """), p).scalar() or 0
    sales = session.execute(text("""
        select count(*) from financial_transaction_sales_invoices
         where management_client_id = cast(:c as uuid) and deleted_at is null
           and invoice_date between :a and :b and lower(posting_status) <> 'posted'
    """), p).scalar() or 0
    purchase = session.execute(text("""
        select count(*) from financial_transaction_purchase_transactions
         where management_client_id = cast(:c as uuid) and deleted_at is null
           and purchase_date between :a and :b and lower(status) not in ('posted', 'rejected', 'cancelled')
    """), p).scalar() or 0
    kas_bank = session.execute(text("""
        select count(*) from financial_transaction_bank_cash_transactions
         where client_id = cast(:c as uuid) and deleted_at is null
           and tx_date between :a and :b and status in ('draft', 'approved')
    """), p).scalar() or 0
    aset_tetap = session.execute(text("""
        select (select count(*) from asset_fixed_asset_depreciation_runs
                 where client_id = cast(:c as uuid) and deleted_at is null
                   and posting_date between :a and :b and status in ('draft', 'approved'))
             + (select count(*) from asset_fixed_asset_disposals
                 where client_id = cast(:c as uuid) and deleted_at is null
                   and disposal_date between :a and :b and status in ('draft', 'pending', 'approved'))
    """), p).scalar() or 0
    persediaan = session.execute(text("""
        select count(*) from asset_inventory_documents
         where client_id = cast(:c as uuid) and deleted_at is null
           and doc_date between :a and :b and status = 'draft'
    """), p).scalar() or 0
    lain = session.execute(text("""
        select count(*) from financial_transaction_other_journals
         where client_id = cast(:c as uuid) and deleted_at is null
           and journal_date between :a and :b and status in ('draft', 'approved')
    """), p).scalar() or 0
    return {"journal_entry": int(je), "sales": int(sales), "purchase": int(purchase), "cash_bank": int(kas_bank),
            "fixed_asset": int(aset_tetap), "inventory": int(persediaan), "other": int(lain)}


def _cek(id_: str, label: str, status: str, detail: str, **lain) -> Dict[str, Any]:
    return {"id": id_, "label": label, "status": status, "detail": detail, **lain}


def _susun_preview(session, buku: mapped.Buku, client_id: str, fy: int, akun_ld: Optional[Any]) -> Dict[str, Any]:
    dari, sampai = _periode(buku, fy)
    hari_ini = date.today()
    ringkas = _ringkasan_laba(buku, dari, sampai)
    closing = session.query(FC).filter(FC.client_id == client_id, FC.fiscal_year == fy).first()
    tertutup_setelah = session.query(func.max(FC.fiscal_year)).filter(
        FC.client_id == client_id, FC.status == "closed", FC.fiscal_year > fy,
    ).scalar()
    cek: List[Dict[str, Any]] = []

    if closing is not None and closing.status == "closed":
        cek.append(_cek("not_closed", "Fiscal year is still open", "fail", f"FY {fy} is already closed."))
    if sampai >= hari_ini:
        cek.append(_cek("year_ended", "Fiscal year has ended", "fail",
                        f"FY {fy} ends on {sampai.strftime('%d %b %Y')} — it can only be closed after that date."))
    else:
        cek.append(_cek("year_ended", "Fiscal year has ended", "pass", f"Ended on {sampai.strftime('%d %b %Y')}."))
    if tertutup_setelah:
        cek.append(_cek("later_year", "No later fiscal year is closed", "fail",
                        f"FY {tertutup_setelah} is already closed. Re-open it first."))

    semua_tdk = buku.jurnal_tidak_seimbang(sampai)
    cek.append(_cek(
        "balanced_journals", "All posted journals are balanced", "fail" if semua_tdk else "pass",
        f"{len(semua_tdk)} posted journal(s) up to year end have debit ≠ credit." if semua_tdk else "Every posted journal balances.",
        items=semua_tdk[:20],
    ))

    neraca = mapped.susun_neraca(buku, sampai)
    cek.append(_cek(
        "balance_sheet", "Balance Sheet balances at year end", "pass" if neraca["check"]["balanced"] else "fail",
        "Assets = Liabilities + Equity." if neraca["check"]["balanced"]
        else f"Out of balance by {abs(neraca['check']['difference']):,.2f}.",
    ))

    if akun_ld is None:
        cek.append(_cek("retained_earnings_account", "Retained earnings account selected", "fail",
                        "Choose the equity account that receives the year's profit (or set Retained Earnings in Settings > Account Mapping)."))
    else:
        cek.append(_cek("retained_earnings_account", "Retained earnings account selected", "pass",
                        f"{akun_ld.acc_no} · {akun_ld.account_name}"))

    belum = _dokumen_belum_posted(session, client_id, dari, sampai)
    total_belum = sum(belum.values())
    cek.append(_cek(
        "pending_documents", "No unposted documents in the year", "warn" if total_belum else "pass",
        (f"{belum['journal_entry']} journal entr{'y' if belum['journal_entry'] == 1 else 'ies'}, {belum['sales']} sales invoice(s), "
         f"{belum['purchase']} purchase(s), {belum['cash_bank']} cash & bank transaction(s) and "
         f"{belum['fixed_asset']} fixed asset depreciation batch(es)/disposal(s) and "
         f"{belum['inventory']} inventory document(s) and {belum['other']} other journal(s) dated in FY {fy} are not posted. "
         "After closing they can no longer be posted "
         "into this year.") if total_belum else "Everything dated in the year is posted.",
        counts=belum,
    ))

    peringatan = mapped._peringatan_buku(buku)
    cek.append(_cek(
        "mapping", "All accounts are mapped", "warn" if peringatan else "pass",
        f"{len(peringatan)} account mapping warning(s) — check Financial Statements > Statement Mapping." if peringatan
        else "Every account has a valid statement mapping.",
        items=peringatan[:20],
    ))

    tahun_ditutup = {fy_ for (fy_,) in session.query(FC.fiscal_year).filter(FC.client_id == client_id, FC.status == "closed").all()}
    awal = buku.awal_pembukuan.year if buku.awal_pembukuan else fy
    terbuka = [y for y in range(awal, fy) if y not in tahun_ditutup
               and any(abs(buku.mutasi(k, *_periode(buku, y))) >= 0.005 for k, _ in buku.akun("PL"))]
    if terbuka:
        cek.append(_cek("prior_years", "Earlier fiscal years are closed", "warn",
                        f"FY {', '.join(map(str, terbuka))} {'has' if len(terbuka) == 1 else 'have'} P&L activity but "
                        f"{'is' if len(terbuka) == 1 else 'are'} not closed. Closing FY {fy} also locks "
                        f"{'it' if len(terbuka) == 1 else 'them'}."))

    if not ringkas["accounts"]:
        cek.append(_cek("activity", "Profit & loss activity", "warn",
                        f"No P&L movement in FY {fy}: no closing journal is needed, the period will only be locked."))

    baris = _baris_jurnal_penutup(ringkas, akun_ld) if akun_ld is not None else []
    return {
        "fiscal_year": fy,
        "period_start": dari.isoformat(),
        "period_end": sampai.isoformat(),
        "summary": {k: ringkas[k] for k in ("revenue", "expenses", "net_profit")},
        "retained_earnings_account": _akun_ringkas(akun_ld),
        "retained_earnings_options": [_akun_ringkas(a) for a in _akun_ekuitas(session, client_id)],
        "checks": cek,
        "can_close": not any(c["status"] == "fail" for c in cek),
        "journal_preview": {
            "je_number": _no_jurnal(fy, (closing.revision + 1) if closing is not None else 0),
            "date": sampai.isoformat(),
            "lines": [{**b, "debit": float(b["debit"]), "credit": float(b["credit"])} for b in baris],
            "total_debit": float(sum((b["debit"] for b in baris), NOL)),
            "total_credit": float(sum((b["credit"] for b in baris), NOL)),
        },
        "balance_sheet": {
            "assets": neraca["totals"]["assets"], "liabilities": neraca["totals"]["liabilities"],
            "equity": neraca["totals"]["equity"],
        },
    }


def _no_jurnal(fy: int, revisi: int) -> str:
    return f"CL-{fy}" + (f"-R{revisi}" if revisi else "")


def _tulis_jurnal(session, client_id: str, tanggal: date, je_number: str, deskripsi: str,
                  baris: List[Dict[str, Any]], user: Dict[str, Any], referensi: str) -> Any:
    """Insert 1 jurnal POSTED (pola opening_balance_v1._tulis_jurnal). TIDAK commit."""
    nama = _nama(user)
    je = JE(
        client_id=user.get("id"), management_client_id=client_id, je_number=je_number[:100],
        entry_date=tanggal, posting_date=tanggal, period_label=f"{_BULAN[tanggal.month - 1]} {tanggal.year}",
        description=deskripsi[:2000], source_type=dbc.SOURCE_TYPE_TUTUP_BUKU, source_reference=referensi,
        total_debit=sum((b["debit"] for b in baris), NOL), total_credit=sum((b["credit"] for b in baris), NOL),
        currency="IDR", status="posted", created_by=user.get("id"), created_by_name=nama, approved_by_name=nama,
        posted_at=datetime.now(), posted_by=user.get("id"),
    )
    session.add(je)
    session.flush()
    for no, b in enumerate(baris, 1):
        session.add(JEL(
            draft_id=je.id, client_id=user.get("id"), line_no=no,
            account_code=b["account_code"], account_name=(b["account_name"] or "")[:200],
            description=(b.get("description") or "")[:2000], debit=b["debit"], credit=b["credit"],
            created_by=user.get("id"),
        ))
    session.flush()
    return je


def _jurnal_ringkas(session, je_id: Optional[str]) -> Optional[Dict[str, Any]]:
    if not je_id:
        return None
    je = session.get(JE, je_id)
    if je is None:
        return None
    return {"id": je.id, "je_number": je.je_number, "entry_date": je.entry_date, "status": je.status,
            "total_debit": float(je.total_debit or 0), "total_credit": float(je.total_credit or 0)}


def _closing_dict(session, fc: Any, laba_kini: Optional[float] = None) -> Dict[str, Any]:
    snap = fc.snapshot or {}
    data = {
        "id": fc.id, "fiscal_year": fc.fiscal_year, "status": fc.status, "revision": fc.revision,
        "period_start": fc.period_start, "period_end": fc.period_end,
        "net_profit": float(fc.net_profit or 0),
        "summary": snap.get("summary"),
        "retained_earnings_account": _akun_ringkas(session.get(COA, fc.retained_earnings_coa_id)) if fc.retained_earnings_coa_id else None,
        "journal": _jurnal_ringkas(session, fc.journal_entry_id),
        "reversal_journal": _jurnal_ringkas(session, fc.reversal_journal_id),
        "notes": fc.notes,
        "closed_at": fc.closed_at, "closed_by_name": fc.closed_by_name,
        "reopened_at": fc.reopened_at, "reopened_by_name": fc.reopened_by_name, "reopen_reason": fc.reopen_reason,
    }
    if laba_kini is not None and fc.status == "closed":
        # Angka sekarang vs snapshot: beda kalau mapping COA diubah setelah ditutup.
        data["current_net_profit"] = _r(laba_kini)
        data["in_sync"] = abs(laba_kini - float(fc.net_profit or 0)) < 0.01
    return data


def _log(session, fc: Any, aksi: str, user: Dict[str, Any], *, je_id: Optional[str], reason: Optional[str], snapshot: Any = None):
    session.add(FCL(
        closing_id=fc.id, client_id=fc.client_id, fiscal_year=fc.fiscal_year, action=aksi,
        journal_entry_id=je_id, net_profit=fc.net_profit, reason=reason, snapshot=snapshot,
        performed_by=user.get("id"), performed_by_name=_nama(user), performed_at=datetime.now().astimezone(),
    ))


def _jalankan(fn):
    session = dbc.SessionLocal()
    try:
        hasil = fn(session)
        session.commit()
        return hasil
    except _Gagal:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        pesan = dbc.pesan_periode_terkunci(e)
        if pesan:
            raise _Gagal(pesan, kode="PERIOD_LOCKED", status_code=409)
        logger.exception("Gagal memproses year-end closing")
        raise
    finally:
        session.close()


# ============================================================
# ENDPOINT
# ============================================================

@router.get("", summary="Daftar tahun buku klien + status closing")
def daftar_tahun(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    session = dbc.SessionLocal()
    try:
        _wajib_klien(kid)
        buku = fs_store.buat_buku(kid)
        closings = {fc.fiscal_year: fc for fc in session.query(FC).filter(FC.client_id == kid).all()}
        tahun_ini = date.today().year
        # Dari tahun pertama pembukuan (minimal tahun lalu) s.d. tahun berjalan.
        awal = min(buku.awal_pembukuan.year if buku.awal_pembukuan else tahun_ini, tahun_ini - 1, *closings.keys())
        tahun = []
        for fy in range(tahun_ini, awal - 1, -1):
            dari, sampai = _periode(buku, fy)
            laba = buku.laba(dari, sampai)
            fc = closings.get(fy)
            tahun.append({
                "fiscal_year": fy,
                "period_start": dari.isoformat(),
                "period_end": sampai.isoformat(),
                "status": fc.status if fc is not None else "open",
                "has_ended": sampai < date.today(),
                "net_profit": _r(laba),
                "closing": _closing_dict(session, fc, laba) if fc is not None else None,
            })
        akun_ld = _akun_laba_ditahan_default(session, kid)
        return sukses(data={
            "lock_date": _tanggal_kunci(session, kid),
            "books_start": buku.awal_pembukuan,
            "default_retained_earnings_account": _akun_ringkas(akun_ld),
            "years": tahun,
        })
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()


@router.get("/status", summary="Tanggal kunci periode & tahun buku yang sudah ditutup")
def status_kunci(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    session = dbc.SessionLocal()
    try:
        rows = session.query(FC).filter(FC.client_id == kid, FC.status == "closed").order_by(FC.fiscal_year.desc()).all()
        return sukses(data={
            "lock_date": rows[0].period_end if rows else None,
            "closed_years": [{"fiscal_year": fc.fiscal_year, "period_end": fc.period_end, "closed_at": fc.closed_at,
                              "closed_by_name": fc.closed_by_name} for fc in rows],
        })
    finally:
        session.close()


@router.get("/preview", summary="Checklist pre-closing + usulan jurnal penutup")
def preview(
    client_id: UUID = Query(...),
    fiscal_year: int = Query(..., ge=1900, le=2999),
    retained_earnings_coa_id: Optional[UUID] = Query(None),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    kid = str(client_id)
    session = dbc.SessionLocal()
    try:
        _wajib_klien(kid)
        akun_ld = _pilih_akun_ld(session, kid, retained_earnings_coa_id)
        return sukses(data=_susun_preview(session, fs_store.buat_buku(kid), kid, fiscal_year, akun_ld))
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()


def _pilih_akun_ld(session, kid: str, coa_id: Optional[UUID]) -> Optional[Any]:
    if coa_id is None:
        return _akun_laba_ditahan_default(session, kid)
    akun = session.query(COA).filter(COA.id == str(coa_id), COA.client_id == kid, COA.deleted_at.is_(None)).first()
    if akun is None:
        raise _Gagal("Retained earnings account not found in this client's COA.", kode="COA_NOT_FOUND", status_code=404)
    if (akun.account_classification or "").upper() != "EQUITY":
        raise _Gagal("The retained earnings account must be an EQUITY account.", kode="NOT_EQUITY")
    if (akun.standard_account_code or "").strip().lower() == STANDARD_CODE_LABA_BERJALAN:
        raise _Gagal("Current Year Earnings is calculated automatically — choose the Retained Earnings account.", kode="CURRENT_YEAR_EARNINGS")
    return akun


@router.post("/close", summary="Tutup buku 1 tahun: jurnal penutup + kunci periode (Tahap 4+)")
def tutup_buku(payload: CloseRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_TUTUP))):
    kid, fy = str(payload.client_id), payload.fiscal_year

    def aksi(session):
        _wajib_klien(kid)
        # Kunci baris klien supaya 2 permintaan close bersamaan tidak dobel.
        session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"yec:{kid}"})
        akun_ld = _pilih_akun_ld(session, kid, payload.retained_earnings_coa_id)
        buku = fs_store.buat_buku(kid)
        waktu_cek = datetime.now().astimezone()
        pv = _susun_preview(session, buku, kid, fy, akun_ld)
        if not pv["can_close"]:
            gagal_ = [c["detail"] for c in pv["checks"] if c["status"] == "fail"]
            raise _Gagal("Cannot close FY {}: {}".format(fy, " ".join(gagal_)), kode="CHECKLIST_FAILED", status_code=422, data=pv["checks"])

        fc = session.query(FC).filter(FC.client_id == kid, FC.fiscal_year == fy).first()
        revisi = (fc.revision + 1) if fc is not None else 0
        dari, sampai = date.fromisoformat(pv["period_start"]), date.fromisoformat(pv["period_end"])
        ringkas = _ringkasan_laba(buku, dari, sampai)
        baris = _baris_jurnal_penutup(ringkas, akun_ld)
        je = None
        if baris:
            je = _tulis_jurnal(
                session, kid, sampai, _no_jurnal(fy, revisi),
                f"Year-end closing FY {fy}: close profit & loss accounts to {akun_ld.acc_no} {akun_ld.account_name}",
                baris, current_user, referensi=f"FY {fy}",
            )
        snapshot = {
            "summary": pv["summary"], "balance_sheet": pv["balance_sheet"],
            "checks": [{k: c[k] for k in ("id", "label", "status", "detail")} for c in pv["checks"]],
            "accounts": ringkas["accounts"],
            "checked_at": waktu_cek.isoformat(),
        }
        if fc is None:
            fc = FC(client_id=kid, fiscal_year=fy)
            session.add(fc)
        fc.period_start, fc.period_end = dari, sampai
        fc.status, fc.revision = "closed", revisi
        fc.retained_earnings_coa_id = akun_ld.id
        fc.journal_entry_id, fc.reversal_journal_id = (je.id if je else None), None
        fc.net_profit = _dec(ringkas["net_profit"])
        fc.snapshot, fc.notes = snapshot, (payload.notes or "").strip() or None
        fc.closed_at, fc.closed_by, fc.closed_by_name = datetime.now(), current_user.get("id"), _nama(current_user)
        fc.reopened_at = fc.reopened_by = fc.reopened_by_name = fc.reopen_reason = None
        fc.edited_at = datetime.now()
        session.flush()
        _log(session, fc, "close", current_user, je_id=je.id if je else None, reason=fc.notes, snapshot=snapshot)
        session.flush()
        return _closing_dict(session, fc, ringkas["net_profit"])

    try:
        return sukses(data=_jalankan(aksi), message=f"FY {fy} closed. Transactions up to 31 Dec {fy} are now locked.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/reopen", summary="Buka kembali tahun buku tertutup terakhir (Tahap 5+, wajib alasan)")
def buka_kembali(payload: ReopenRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_MINIMAL_BUKA))):
    kid, fy = str(payload.client_id), payload.fiscal_year
    alasan = payload.reason.strip()

    def aksi(session):
        session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"yec:{kid}"})
        fc = session.query(FC).filter(FC.client_id == kid, FC.fiscal_year == fy).first()
        if fc is None or fc.status != "closed":
            raise _Gagal(f"FY {fy} is not closed.", kode="NOT_CLOSED", status_code=409)
        lebih_baru = session.query(func.max(FC.fiscal_year)).filter(
            FC.client_id == kid, FC.status == "closed", FC.fiscal_year > fy,
        ).scalar()
        if lebih_baru:
            raise _Gagal(f"FY {lebih_baru} is closed. Re-open the latest closed year first.", kode="LATER_YEAR_CLOSED", status_code=409)

        # Lepas kunci DULU (trigger membaca status ini), baru jurnal pembalik di-post.
        fc.status = "reopened"
        fc.reopened_at, fc.reopened_by, fc.reopened_by_name = datetime.now(), current_user.get("id"), _nama(current_user)
        fc.reopen_reason, fc.edited_at = alasan, datetime.now()
        session.flush()

        rv = None
        asal = session.get(JE, fc.journal_entry_id) if fc.journal_entry_id else None
        if asal is not None:
            baris_asal = session.query(JEL).filter(JEL.draft_id == asal.id, JEL.deleted_at.is_(None)).order_by(JEL.line_no).all()
            rv = _tulis_jurnal(
                session, kid, asal.entry_date, f"RV-{asal.je_number}", f"Reversal of {asal.je_number}: {alasan}",
                [{"account_code": b.account_code, "account_name": b.account_name, "description": f"Reversal of {asal.je_number}",
                  "debit": Decimal(b.credit or 0), "credit": Decimal(b.debit or 0)} for b in baris_asal],
                current_user, referensi=f"FY {fy}",
            )
            rv.notes = alasan
            fc.reversal_journal_id = rv.id
        session.flush()
        _log(session, fc, "reopen", current_user, je_id=rv.id if rv else None, reason=alasan)
        session.flush()
        return _closing_dict(session, fc)

    try:
        return sukses(data=_jalankan(aksi), message=f"FY {fy} re-opened. Transactions in that year can be changed again.")
    except _Gagal as e:
        return _respon_gagal(e)


@router.get("/history", summary="Audit trail close / reopen klien")
def riwayat(client_id: UUID = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    kid = str(client_id)
    session = dbc.SessionLocal()
    try:
        rows = session.query(FCL).filter(FCL.client_id == kid).order_by(FCL.performed_at.desc()).limit(200).all()
        return sukses(data=[{
            "id": r.id, "fiscal_year": r.fiscal_year, "action": r.action,
            "net_profit": float(r.net_profit) if r.net_profit is not None else None,
            "reason": r.reason, "journal": _jurnal_ringkas(session, r.journal_entry_id),
            "performed_by_name": r.performed_by_name, "performed_at": r.performed_at,
        } for r in rows])
    finally:
        session.close()


# ============================================================
# WORKSPACE (semua klien) & DETAIL
# ============================================================

_SQL_AWAL_PEMBUKUAN = text("""
    select k, min(t) from (
        select management_client_id as k, min(entry_date) as t from financial_transaction_journal_entry_drafts
         where deleted_at is null and lower(status) = 'posted' and coalesce(source_type, '') <> :tutup
         group by 1
        union all
        select management_client_id, min(invoice_date) from financial_transaction_sales_invoices
         where deleted_at is null and lower(posting_status) = 'posted' and not is_opening_balance group by 1
        union all
        select management_client_id, min(purchase_date) from financial_transaction_purchase_transactions
         where deleted_at is null and lower(status) = 'posted' and not is_opening_balance group by 1
    ) x where k is not null group by k
""")


def _nama_klien(c: Dict[str, Any]) -> str:
    return c.get("nama_client") or c.get("client_code") or "—"


@router.get("/workspace", summary="Semua klien: KPI + daftar tahun buku beserta status closing")
def workspace(_u: Dict[str, Any] = Depends(get_current_user_v1)):
    """Ringan (tanpa menghitung laporan keuangan): tahun buku tiap klien dari
    tahun pertama pembukuan (minimal tahun lalu) s.d. tahun berjalan."""
    session = dbc.SessionLocal()
    try:
        klien = dbc.list_management_clients()
        awal_map = {str(k): t for k, t in session.execute(_SQL_AWAL_PEMBUKUAN, {"tutup": dbc.SOURCE_TYPE_TUTUP_BUKU}).all()}
        closings: Dict[str, Dict[int, Any]] = {}
        for fc in session.query(FC).all():
            closings.setdefault(str(fc.client_id), {})[fc.fiscal_year] = fc
        pernah_dibuka = {(str(k), fy) for k, fy in session.query(FCL.client_id, FCL.fiscal_year).filter(FCL.action == "reopen").distinct().all()}
        no_jurnal = {str(i): n for i, n in session.query(JE.id, JE.je_number).filter(
            JE.id.in_([fc.journal_entry_id for per in closings.values() for fc in per.values() if fc.journal_entry_id] or [None])
        ).all()}

        hari_ini = date.today()
        tahun_ini = hari_ini.year
        baris: List[Dict[str, Any]] = []
        for c in klien:
            kid = str(c["id"])
            awal = awal_map.get(kid)
            per_klien = closings.get(kid, {})
            mulai = min(awal.year if awal else tahun_ini, tahun_ini - 1, *per_klien.keys())
            for fy in range(tahun_ini, mulai - 1, -1):
                akhir = date(fy, 12, 31)
                dari = date(fy, awal.month, 1) if awal and awal.year == fy else date(fy, 1, 1)
                fc = per_klien.get(fy)
                ada = fc is not None
                baris.append({
                    "client_id": kid,
                    "client_name": _nama_klien(c),
                    "client_code": c.get("client_code"),
                    "fiscal_year": fy,
                    "period_start": (fc.period_start if ada else dari).isoformat(),
                    "period_end": akhir.isoformat(),
                    "status": fc.status if ada else "open",
                    "has_ended": akhir < hari_ini,
                    "ever_reopened": (kid, fy) in pernah_dibuka,
                    "net_profit": float(fc.net_profit or 0) if ada else None,
                    "journal_number": no_jurnal.get(str(fc.journal_entry_id)) if ada and fc.journal_entry_id else None,
                    "closed_at": fc.closed_at if ada else None,
                    "closed_by_name": fc.closed_by_name if ada else None,
                    "reopened_at": fc.reopened_at if ada else None,
                    "reopened_by_name": fc.reopened_by_name if ada else None,
                    "reopen_reason": fc.reopen_reason if ada else None,
                })
        # Tahun tertutup terakhir per klien (hanya itu yang boleh dibuka kembali).
        terakhir: Dict[str, int] = {}
        for b in baris:
            if b["status"] == "closed":
                terakhir[b["client_id"]] = max(terakhir.get(b["client_id"], 0), b["fiscal_year"])
        for b in baris:
            b["can_reopen"] = b["status"] == "closed" and terakhir.get(b["client_id"]) == b["fiscal_year"]
        belum = [b for b in baris if b["status"] != "closed"]
        kpi = {
            "open": len(belum),
            "closed": len(baris) - len(belum),
            "reopened": len(pernah_dibuka),
            "pending_checks": sum(1 for b in belum if b["has_ended"]),
        }
        return sukses(data={"kpi": kpi, "years": baris})
    finally:
        session.close()


_JUDUL_LOG = {"close": "Approved closing", "reopen": "Fiscal year re-opened"}


@router.get("/detail", summary="Detail 1 tahun buku yang (pernah) ditutup: snapshot, jurnal penutup, audit trail")
def detail(
    client_id: UUID = Query(...),
    fiscal_year: int = Query(..., ge=1900, le=2999),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    kid = str(client_id)
    session = dbc.SessionLocal()
    try:
        klien = dbc.get_management_client_by_id(kid)
        if klien is None:
            raise _Gagal("Client not found.", kode="NOT_FOUND", status_code=404)
        fc = session.query(FC).filter(FC.client_id == kid, FC.fiscal_year == fiscal_year).first()
        if fc is None:
            raise _Gagal(f"FY {fiscal_year} has never been closed.", kode="NOT_FOUND", status_code=404)
        snap = fc.snapshot or {}

        # Audit trail kronologis: tiap close = cek pre-closing -> disetujui ->
        # jurnal di-post; tiap reopen = dibuka kembali (+ jurnal pembalik).
        jejak: List[Dict[str, Any]] = []
        for lg in session.query(FCL).filter(FCL.closing_id == fc.id).order_by(FCL.performed_at).all():
            s_ = lg.snapshot or {}
            je = _jurnal_ringkas(session, lg.journal_entry_id)
            if lg.action == "close":
                jejak.append({"step": "precheck", "title": "Created pre-check",
                              "at": s_.get("checked_at") or lg.performed_at, "by": lg.performed_by_name, "detail": None})
            jejak.append({"step": lg.action, "title": _JUDUL_LOG.get(lg.action, lg.action),
                          "at": lg.performed_at, "by": lg.performed_by_name, "detail": lg.reason})
            if lg.action == "close":
                jejak.append({"step": "posted", "title": "Posting completed", "at": lg.performed_at, "by": lg.performed_by_name,
                              "detail": je["je_number"] if je else "No P&L activity — period locked only"})
            elif je:
                jejak.append({"step": "reversed", "title": "Closing journal reversed", "at": lg.performed_at,
                              "by": lg.performed_by_name, "detail": je["je_number"]})

        return sukses(data={
            **_closing_dict(session, fc),
            "client_id": kid,
            "client_name": _nama_klien(klien),
            "snapshot": {
                "balance_sheet": snap.get("balance_sheet"),
                "summary": snap.get("summary"),
                "checks": snap.get("checks") or [],
                "checked_at": snap.get("checked_at"),
            },
            "audit_trail": jejak,
        })
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()
