"""
modules/financial_statements/statements_v1.py
===============================================
Financial Statements berbasis mapping COA (Task Plan 16-20):

    GET  /api/v1/reports/financial-statements/balance-sheet
    GET  /api/v1/reports/financial-statements/profit-loss
    GET  /api/v1/reports/financial-statements/changes-in-equity
    GET  /api/v1/reports/financial-statements/cash-flow
    GET  /api/v1/reports/financial-statements/segments
    GET  /api/v1/reports/financial-statements/notes
    GET  /api/v1/reports/financial-statements/notes/export.docx
    POST /api/v1/reports/financial-statements/notes                      note custom   (Tahap 3+)
    PUT  /api/v1/reports/financial-statements/notes/{note_id}            judul/narasi tetap/aktif/urutan (Tahap 3+)
    DELETE /api/v1/reports/financial-statements/notes/{note_id}          hapus note custom (Tahap 3+)
    PUT  /api/v1/reports/financial-statements/notes/{note_id}/content    narasi & status per periode (Tahap 3+)
    POST /api/v1/reports/financial-statements/notes/{note_id}/overrides  override angka (Tahap 4+, wajib alasan)
    DELETE /api/v1/reports/financial-statements/notes/{note_id}/overrides/{override_id}  (Tahap 4+)
    GET  /api/v1/reports/financial-statements/notes/{note_id}/audit      audit trail

Sumber angka: GL posted (db_client.ambil_baris_jurnal_posted_transaksi --
Journal Entry termasuk Opening Balance & Cash & Bank, Sales, Purchase),
BUKAN angka dokumen Sales/Purchase langsung. Mesin hitung: mapped.py.
Semua endpoint WAJIB management_client_id (mapping & COA per klien).

Parameter periode (P&L, SCE, Cash Flow, Notes):
    period_type = month | quarter | ytd | year | custom
    year, month (month/ytd), quarter (quarter), start_date & end_date (custom)
    compare     = none | previous_period | previous_year | custom (+ compare_start, compare_end)
    (ytd: awal = 1 Januari, atau bulan pertama pembukuan klien kalau mulai pertengahan tahun)
Balance Sheet: as_of + compare = none | previous_month | previous_year_end | same_date_last_year | custom (+ compare_as_of).
"""

from __future__ import annotations

import calendar
import io
import re
import uuid
from datetime import date, timedelta
from typing import Any, Dict, Optional, Tuple

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from ..management.clients_v1 import _require_level_v1
from . import fs_store, mapped

logger = get_module_logger("fs_statements_v1")

router = APIRouter(prefix="/api/v1/reports/financial-statements", tags=["reports-financial-statements-v1"])

LEVEL_EDIT_NARASI = 3    # Supervisor ke atas: narasi, pengaturan note, note custom
LEVEL_OVERRIDE = 4       # Manager ke atas: override angka hasil sistem

SEGMEN = [
    ("branch", "Branch"), ("department", "Department"), ("cost_center", "Cost Center"),
    ("project", "Project"), ("business_unit", "Business Unit"),
]


class GagalValidasi(Exception):
    def __init__(self, message: str, code: str, status_code: int = 400):
        super().__init__(message)
        self.message, self.code, self.status_code = message, code, status_code


def _respon_gagal(e: GagalValidasi):
    return gagal(message=e.message, errors={"code": e.code}, status_code=e.status_code)


# ============================================================
# PERIODE
# ============================================================

def akhir_bulan(tahun: int, bulan: int) -> date:
    return date(tahun, bulan, calendar.monthrange(tahun, bulan)[1])


def geser_tahun(d: date, n: int = -1) -> date:
    """Geser n tahun; akhir bulan tetap akhir bulan (29 Feb -> 28 Feb)."""
    t = d.year + n
    if d.day == calendar.monthrange(d.year, d.month)[1]:
        return akhir_bulan(t, d.month)
    return date(t, d.month, min(d.day, calendar.monthrange(t, d.month)[1]))


def _klien(management_client_id: Optional[str]) -> str:
    try:
        kid = str(uuid.UUID(str(management_client_id)))
    except (ValueError, TypeError):
        raise GagalValidasi("management_client_id wajib diisi & harus UUID valid.", "INVALID_MANAGEMENT_CLIENT_ID")
    if dbc.get_management_client_by_id(kid) is None:
        raise GagalValidasi("Client tidak ditemukan.", "NOT_FOUND", 404)
    return kid


def _uuid_atau_gagal(nilai: str, nama: str) -> str:
    try:
        return str(uuid.UUID(str(nilai)))
    except (ValueError, TypeError):
        raise GagalValidasi(f"{nama} tidak valid.", "INVALID_ID")


def tentukan_periode(
    buku: mapped.Buku, period_type: str, year: Optional[int], month: Optional[int], quarter: Optional[int],
    start_date: Optional[date], end_date: Optional[date],
) -> Tuple[date, date, str]:
    hari_ini = date.today()
    tahun = year or hari_ini.year
    bulan = month or (hari_ini.month if tahun == hari_ini.year else 12)
    if period_type == "custom":
        if not start_date or not end_date:
            raise GagalValidasi("start_date & end_date wajib untuk period_type=custom.", "INVALID_PERIOD")
        if start_date > end_date:
            raise GagalValidasi("Start date tidak boleh setelah end date.", "INVALID_DATE_RANGE")
        return start_date, end_date, "custom"
    if not 1 <= bulan <= 12:
        raise GagalValidasi("month harus 1-12.", "INVALID_PERIOD")
    if period_type == "month":
        return date(tahun, bulan, 1), akhir_bulan(tahun, bulan), "month"
    if period_type == "quarter":
        q = quarter or ((bulan - 1) // 3 + 1)
        if not 1 <= q <= 4:
            raise GagalValidasi("quarter harus 1-4.", "INVALID_PERIOD")
        return date(tahun, q * 3 - 2, 1), akhir_bulan(tahun, q * 3), "quarter"
    if period_type == "ytd":
        akhir = akhir_bulan(tahun, bulan)
        return buku.awal_pnl(akhir), akhir, "ytd"
    if period_type == "year":
        akhir = date(tahun, 12, 31)
        return buku.awal_pnl(akhir), akhir, "year"
    raise GagalValidasi("period_type harus month, quarter, ytd, year, atau custom.", "INVALID_PERIOD")


def tentukan_pembanding(
    buku: mapped.Buku, jenis: str, compare: str, dari: date, sampai: date,
    compare_start: Optional[date], compare_end: Optional[date],
) -> Optional[Tuple[date, date]]:
    if compare in (None, "", "none"):
        return None
    if compare == "custom":
        if not compare_start or not compare_end or compare_start > compare_end:
            raise GagalValidasi("compare_start & compare_end wajib & valid untuk compare=custom.", "INVALID_COMPARE")
        return compare_start, compare_end
    if compare == "previous_year" or (compare == "previous_period" and jenis in ("ytd", "year")):
        akhir = geser_tahun(sampai)
        awal = buku.awal_pnl(akhir) if jenis in ("ytd", "year") else geser_tahun(dari)
        return awal, akhir
    if compare == "previous_period":
        if jenis == "month":
            akhir = dari - timedelta(days=1)
            return date(akhir.year, akhir.month, 1), akhir
        if jenis == "quarter":
            akhir = dari - timedelta(days=1)
            return date(akhir.year, akhir.month - 2, 1), akhir
        panjang = (sampai - dari).days
        akhir = dari - timedelta(days=1)
        return akhir - timedelta(days=panjang), akhir
    raise GagalValidasi("compare harus none, previous_period, previous_year, atau custom.", "INVALID_COMPARE")


def _label_rentang(dari: date, sampai: date) -> str:
    f = lambda d: d.strftime("%d %b %Y")  # noqa: E731
    return f"{f(dari)} – {f(sampai)}"


def _periode_dari_query(buku, period_type, year, month, quarter, start_date, end_date, compare, compare_start, compare_end):
    dari, sampai, jenis = tentukan_periode(buku, period_type, year, month, quarter, start_date, end_date)
    pembanding = tentukan_pembanding(buku, jenis, compare, dari, sampai, compare_start, compare_end)
    return dari, sampai, jenis, pembanding


def _info_periode(jenis, dari, sampai, pembanding) -> Dict[str, Any]:
    return {
        "period_type": jenis, "start": dari.isoformat(), "end": sampai.isoformat(), "label": _label_rentang(dari, sampai),
        "compare": None if not pembanding else {
            "start": pembanding[0].isoformat(), "end": pembanding[1].isoformat(), "label": _label_rentang(*pembanding),
        },
    }


def _buku(kid: str) -> mapped.Buku:
    # Semua jurnal posted (tanpa batas tanggal): periode pembanding/YTD bisa
    # butuh tanggal mana pun, dan ukuran data per klien masih kecil.
    return fs_store.buat_buku(kid)


def _meta_klien(kid: str, buku: mapped.Buku) -> Dict[str, Any]:
    klien = dbc.get_management_client_by_id(kid) or {}
    return {
        "management_client_id": kid,
        "company_name": klien.get("nama_client"),
        "books_start": buku.awal_pembukuan.isoformat() if buku.awal_pembukuan else None,
        "has_data": buku.ada_data,
    }


# Parameter periode dipakai banyak endpoint -> dependency.
class ParamPeriode:
    def __init__(
        self,
        period_type: str = Query("ytd", description="month | quarter | ytd | year | custom"),
        year: Optional[int] = Query(None, ge=1900, le=9999),
        month: Optional[int] = Query(None, ge=1, le=12),
        quarter: Optional[int] = Query(None, ge=1, le=4),
        start_date: Optional[date] = Query(None),
        end_date: Optional[date] = Query(None),
        compare: str = Query("none", description="none | previous_period | previous_year | custom"),
        compare_start: Optional[date] = Query(None),
        compare_end: Optional[date] = Query(None),
    ):
        self.args = (period_type, year, month, quarter, start_date, end_date, compare, compare_start, compare_end)


# ============================================================
# LAPORAN
# ============================================================

@router.get("/balance-sheet", summary="Statement of Financial Position dari GL + mapping COA")
def balance_sheet(
    management_client_id: str = Query(...),
    as_of: Optional[date] = Query(None, description="Default hari ini"),
    compare: str = Query("previous_year_end", description="none | previous_month | previous_year_end | same_date_last_year | custom"),
    compare_as_of: Optional[date] = Query(None),
    show_zero: bool = Query(False, description="Tampilkan akun bersaldo nol"),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        kid = _klien(management_client_id)
        per = as_of or date.today()
        if compare in ("none", ""):
            pemb = None
        elif compare == "previous_month":
            pemb = date(per.year, per.month, 1) - timedelta(days=1)
        elif compare == "previous_year_end":
            pemb = date(per.year - 1, 12, 31)
        elif compare == "same_date_last_year":
            pemb = geser_tahun(per)
        elif compare == "custom":
            if not compare_as_of:
                raise GagalValidasi("compare_as_of wajib untuk compare=custom.", "INVALID_COMPARE")
            pemb = compare_as_of
        else:
            raise GagalValidasi("compare tidak valid.", "INVALID_COMPARE")
        buku = _buku(kid)
    except GagalValidasi as e:
        return _respon_gagal(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal menyusun balance sheet: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    data = mapped.susun_neraca(buku, per, pemb, show_zero)
    data["client"] = _meta_klien(kid, buku)
    return sukses(data=data)


@router.get("/profit-loss", summary="Profit & Loss dari GL + mapping COA")
def profit_loss(
    management_client_id: str = Query(...),
    p: ParamPeriode = Depends(),
    segment_type: Optional[str] = Query(None, description="branch | department | cost_center | project | business_unit"),
    segment_value: Optional[str] = Query(None),
    breakdown: str = Query("none", description="none | monthly"),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        kid = _klien(management_client_id)
        segmen = None
        if segment_type and segment_value:
            if segment_type not in dict(SEGMEN):
                raise GagalValidasi("segment_type tidak valid.", "INVALID_SEGMENT")
            segmen = (segment_type, segment_value)
        buku = _buku(kid)
        dari, sampai, jenis, pemb = _periode_dari_query(buku, *p.args)
    except GagalValidasi as e:
        return _respon_gagal(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal menyusun profit & loss: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    data = mapped.susun_laba_rugi(buku, dari, sampai, pemb, segmen, breakdown == "monthly")
    data["period_info"] = _info_periode(jenis, dari, sampai, pemb)
    data["client"] = _meta_klien(kid, buku)
    return sukses(data=data)


@router.get("/changes-in-equity", summary="Statement of Changes in Equity")
def changes_in_equity(
    management_client_id: str = Query(...),
    p: ParamPeriode = Depends(),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        kid = _klien(management_client_id)
        buku = _buku(kid)
        dari, sampai, jenis, _ = _periode_dari_query(buku, *p.args)
    except GagalValidasi as e:
        return _respon_gagal(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal menyusun perubahan ekuitas: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    data = mapped.susun_perubahan_ekuitas(buku, dari, sampai)
    data["period_info"] = _info_periode(jenis, dari, sampai, None)
    data["client"] = _meta_klien(kid, buku)
    return sukses(data=data)


@router.get("/cash-flow", summary="Cash Flow Statement (indirect method)")
def cash_flow(
    management_client_id: str = Query(...),
    p: ParamPeriode = Depends(),
    _u: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        kid = _klien(management_client_id)
        buku = _buku(kid)
        dari, sampai, jenis, pemb = _periode_dari_query(buku, *p.args)
    except GagalValidasi as e:
        return _respon_gagal(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal menyusun arus kas: %s", e)
        return gagal(message="Gagal membaca data transaksi.", errors={"code": "DB_ERROR"}, status_code=500)
    data = mapped.susun_arus_kas(buku, dari, sampai)
    if pemb:
        data["compare"] = mapped.susun_arus_kas(buku, *pemb)
    data["period_info"] = _info_periode(jenis, dari, sampai, pemb)
    data["client"] = _meta_klien(kid, buku)
    return sukses(data=data)


@router.get("/segments", summary="Dimensi segment yang tersedia di transaksi posted klien")
def segments(management_client_id: str = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    try:
        kid = _klien(management_client_id)
        buku = _buku(kid)
    except GagalValidasi as e:
        return _respon_gagal(e)
    ada = buku.segmen_tersedia()
    return sukses(data={"types": [{"key": k, "label": label, "values": ada.get(k, [])} for k, label in SEGMEN]})


# ============================================================
# CALK
# ============================================================

def _susun_calk(kid: str, current_user: Dict[str, Any], p: ParamPeriode):
    fs_store.pastikan_note_klien(kid, current_user.get("id"))
    buku = _buku(kid)
    dari, sampai, jenis, pemb = _periode_dari_query(buku, *p.args)
    notes = fs_store.daftar_note_klien(kid)
    ids = [n["id"] for n in notes]
    klien = dbc.get_management_client_by_id(kid) or {}
    konteks = {
        "company": klien.get("nama_client") or "The Company",
        "period_start": dari.strftime("%d %B %Y"), "period_end": sampai.strftime("%d %B %Y"), "year": str(sampai.year),
    }
    data = mapped.susun_calk(buku, notes, fs_store.override_periode(ids, sampai), fs_store.konten_periode(ids, sampai),
                             sampai, dari, pemb, konteks)
    data["period_info"] = _info_periode(jenis, dari, sampai, pemb)
    data["client"] = _meta_klien(kid, buku)
    data["disabled_notes"] = [
        {"id": n["id"], "note_key": n["note_key"], "title": n["title"], "note_type": n["note_type"], "is_custom": not n.get("template_id")}
        for n in fs_store.daftar_note_klien(kid, termasuk_nonaktif=True) if not n["is_enabled"]
    ]
    return data


@router.get("/notes", summary="Notes to Financial Statements (CALK) untuk 1 periode")
def notes(
    management_client_id: str = Query(...),
    p: ParamPeriode = Depends(),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        kid = _klien(management_client_id)
        data = _susun_calk(kid, current_user, p)
    except GagalValidasi as e:
        return _respon_gagal(e)
    except Exception as e:  # noqa: BLE001
        logger.exception("Gagal menyusun CALK: %s", e)
        return gagal(message="Gagal menyusun catatan laporan keuangan.", errors={"code": "DB_ERROR"}, status_code=500)
    data["permissions"] = {
        "edit_narrative": _level(current_user) >= LEVEL_EDIT_NARASI,
        "override": _level(current_user) >= LEVEL_OVERRIDE,
    }
    return sukses(data=data)


def _level(current_user: Dict[str, Any]) -> int:
    from ..auth import core as auth
    return auth.role_level(current_user.get("role"))


@router.get("/notes/export.docx", summary="Export CALK ke Word (.docx)")
def notes_export_docx(
    management_client_id: str = Query(...),
    p: ParamPeriode = Depends(),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    from .calk_docx import buat_docx_calk
    try:
        kid = _klien(management_client_id)
        data = _susun_calk(kid, current_user, p)
    except GagalValidasi as e:
        return _respon_gagal(e)
    isi = buat_docx_calk(data)
    nama = re.sub(r"[^A-Za-z0-9_\-]", "_", f"CALK_{data['client'].get('company_name') or 'client'}_{data['as_of']}").strip("_")
    return StreamingResponse(
        io.BytesIO(isi),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{nama}.docx"'},
    )


def _note_milik(kid: str, note_id: str) -> Dict[str, Any]:
    note = fs_store.ambil_note(_uuid_atau_gagal(note_id, "note_id"))
    if not note or note["client_id"] != kid:
        raise GagalValidasi("Note tidak ditemukan.", "NOT_FOUND", 404)
    return note


_STATEMENT = ("GENERAL", "BALANCE_SHEET", "PROFIT_LOSS", "EQUITY", "CASH_FLOW")


class KontenNoteRequest(BaseModel):
    management_client_id: str
    period_end: date
    narrative: Optional[str] = Field(None, max_length=20000)
    status: Optional[str] = Field(None, pattern="^(draft|final)$")


@router.put("/notes/{note_id}/content", summary="Narasi & status note untuk 1 periode (Tahap 3+)")
def simpan_konten_note(note_id: str, body: KontenNoteRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_EDIT_NARASI))):
    try:
        kid = _klien(body.management_client_id)
        note = _note_milik(kid, note_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    return sukses(data=fs_store.simpan_konten(note, body.period_end, body.narrative, body.status, current_user), message="Note tersimpan.")


class UbahNoteRequest(BaseModel):
    management_client_id: str
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    narrative: Optional[str] = Field(None, max_length=20000, description="Narasi tetap klien (semua periode); string kosong = kembali ke template")
    is_enabled: Optional[bool] = None
    sort_order: Optional[int] = Field(None, ge=0, le=100000)


@router.put("/notes/{note_id}", summary="Ubah pengaturan note klien (Tahap 3+)")
def ubah_note(note_id: str, body: UbahNoteRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_EDIT_NARASI))):
    try:
        kid = _klien(body.management_client_id)
        note = _note_milik(kid, note_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    nilai = body.model_dump(exclude_unset=True, exclude={"management_client_id"})
    if "narrative" in nilai:
        nilai["narrative"] = (nilai["narrative"] or "").strip() or None
    return sukses(data=fs_store.ubah_note(note, nilai, current_user), message="Note diperbarui.")


class TambahNoteRequest(BaseModel):
    management_client_id: str
    title: str = Field(..., min_length=1, max_length=200)
    statement: str = "GENERAL"
    note_type: str = Field("policy", pattern="^(policy|account)$")
    note_key: Optional[str] = Field(None, max_length=60, description="Wajib untuk note_type=account; akun dengan note_key ini masuk tabelnya")
    narrative: Optional[str] = Field(None, max_length=20000)
    sort_order: Optional[int] = Field(None, ge=0, le=100000)


@router.post("/notes", summary="Tambah note custom klien (Tahap 3+)")
def tambah_note(body: TambahNoteRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_EDIT_NARASI))):
    try:
        kid = _klien(body.management_client_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    if body.statement not in _STATEMENT:
        return gagal(message=f"statement harus salah satu dari: {', '.join(_STATEMENT)}.", errors={"code": "INVALID_STATEMENT"})
    kunci = (body.note_key or "").strip().lower()
    if body.note_type == "account" and not kunci:
        return gagal(message="note_key wajib untuk note bertabel angka.", errors={"code": "NOTE_KEY_REQUIRED"})
    kunci = re.sub(r"[^a-z0-9_]", "_", kunci) if kunci else f"custom_{uuid.uuid4().hex[:8]}"
    if any(n["note_key"] == kunci for n in fs_store.daftar_note_klien(kid, termasuk_nonaktif=True)):
        return gagal(message="note_key sudah dipakai note lain.", errors={"code": "DUPLICATE_NOTE_KEY"}, status_code=409)
    nilai = {"title": body.title.strip(), "statement": body.statement, "note_type": body.note_type, "note_key": kunci,
             "narrative": (body.narrative or "").strip() or None, "sort_order": body.sort_order}
    return sukses(data=fs_store.tambah_note(kid, nilai, current_user), message="Note ditambahkan.", status_code=201)


@router.delete("/notes/{note_id}", summary="Hapus note custom (Tahap 3+); note template cukup dinonaktifkan")
def hapus_note(note_id: str, management_client_id: str = Query(...), current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_EDIT_NARASI))):
    try:
        kid = _klien(management_client_id)
        note = _note_milik(kid, note_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    if note.get("template_id"):
        return gagal(message="Note dari template tidak bisa dihapus; nonaktifkan saja.", errors={"code": "TEMPLATE_NOTE"}, status_code=409)
    fs_store.hapus_note(note, current_user)
    return sukses(data=None, message="Note dihapus.")


class OverrideRequest(BaseModel):
    management_client_id: str
    period_end: date
    row_key: str = Field(..., min_length=1, max_length=50, description="Kode akun (acc_no) di tabel note")
    override_value: float
    system_value: Optional[float] = None
    reason: str = Field(..., min_length=3, max_length=2000)


@router.post("/notes/{note_id}/overrides", summary="Override angka sistem di tabel note (Tahap 4+, wajib alasan)")
def pasang_override(note_id: str, body: OverrideRequest, current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_OVERRIDE))):
    try:
        kid = _klien(body.management_client_id)
        note = _note_milik(kid, note_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    if note["note_type"] != "account":
        return gagal(message="Note ini tidak punya tabel angka.", errors={"code": "NOT_ACCOUNT_NOTE"})
    hasil = fs_store.pasang_override(note, body.period_end, body.row_key.strip(), body.override_value, body.system_value,
                                     body.reason.strip(), current_user)
    return sukses(data=hasil, message="Override tersimpan.", status_code=201)


@router.delete("/notes/{note_id}/overrides/{override_id}", summary="Hapus override (Tahap 4+) -- kembali ke angka sistem")
def hapus_override(note_id: str, override_id: str, management_client_id: str = Query(...), reason: Optional[str] = Query(None, max_length=2000),
                   current_user: Dict[str, Any] = Depends(_require_level_v1(LEVEL_OVERRIDE))):
    try:
        kid = _klien(management_client_id)
        note = _note_milik(kid, note_id)
        oid = _uuid_atau_gagal(override_id, "override_id")
    except GagalValidasi as e:
        return _respon_gagal(e)
    if not fs_store.hapus_override(note, oid, reason, current_user):
        return gagal(message="Override tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=None, message="Override dihapus.")


@router.get("/notes/{note_id}/audit", summary="Audit trail 1 note")
def audit_note(note_id: str, management_client_id: str = Query(...), _u: Dict[str, Any] = Depends(get_current_user_v1)):
    try:
        kid = _klien(management_client_id)
        note = _note_milik(kid, note_id)
    except GagalValidasi as e:
        return _respon_gagal(e)
    return sukses(data=fs_store.riwayat_audit(note["id"]))
