"""
modules/management/opening_balance_import_v1.py
===============================================
COA > Opening Balance > tab "Import Data": template, upload, monitoring &
approval batch import per modul.

    GET    /api/v1/management/opening-balances/{ob_id}/imports                 ringkasan + riwayat batch semua modul
    GET    /api/v1/management/opening-balances/{ob_id}/imports/{module}/template  download template (.xlsx)
    POST   /api/v1/management/opening-balances/{ob_id}/imports/{module}        upload file -> batch "validated"
    GET    /api/v1/management/opening-balances/imports/{batch_id}             detail batch + baris
    POST   /api/v1/management/opening-balances/imports/{batch_id}/submit      validated -> submitted
    POST   /api/v1/management/opening-balances/imports/{batch_id}/approve     submitted -> approved
    POST   /api/v1/management/opening-balances/imports/{batch_id}/reject      submitted -> rejected (alasan wajib)
    POST   /api/v1/management/opening-balances/imports/{batch_id}/cancel      validated/rejected -> cancelled

Modul: coa (COA legacy + saldo non-subledger), ar, ap, inventory, asset.
Baris ERROR tidak bisa di-approve & tidak pernah diterapkan, tapi TIDAK memblokir
batch: submit & approve tetap jalan untuk baris valid/warning (keputusan bisnis
2026-10-24, _pilih_baris). WARNING = boleh, cukup direview.
Aturan modul coa:
    Source Account Code / Name  teks; nama wajib. Duplikat kode -> error. Kode kosong -> dibuat otomatis
                                6 digit format standar (digit depan = klasifikasi, _isi_kode_otomatis).
    Opening Debit / Credit      desimal, wajib, >= 0.      Dua-duanya > 0 -> error; dua-duanya 0 = baris tanpa saldo.
    Balance Date                tanggal, wajib, = tanggal cut-off set opening balance (periode opening).
    Currency                    selalu IDR (isi file diabaikan).
    Akun ZAFEB                  1 akun ZAFEB hanya boleh dipakai 1 baris. Kalau barisnya BERSALDO: akun harus
                                aktif, bukan akun kontrol Inventory/Fixed Asset, bukan Current Year Earnings.
                                Baris bersaldo di akun kontrol AR/AP dibuang diam-diam (tidak masuk batch). Belum di-mapping -> warning (saldonya tidak ikut diterapkan).
    Batch                       total debit != total kredit -> peringatan saja (_catatan_batch); selisihnya
                                diparkir ke akun suspense saat opening balance di-post.
    Akun BARU                   kode ZAFEB yang belum ada di COA klien BOLEH, asal standarnya jelas
                                (_cek_akun_baru): format kode valid & unik, nama tidak bentrok, Standard
                                Account Code wajib & dikenali (_katalog_standard: template COA industri +
                                COA klien), klasifikasi = klasifikasi standard code. Selalu warning "New
                                account" supaya direview; akun dibuat saat approve (_buat_akun_baru).

Saat batch coa di-APPROVE (_terapkan_coa): baris saldo AKUN NON-KONTROL set
opening balance DIGANTI dengan baris bersaldo dari batch ini (saldo akun
kontrol AR/AP/Inventory/Fixed Asset tidak disentuh -- milik modul 2-5), dan
nama akun ZAFEB diganti dengan Source Account Name (akun yang dikunci Account
Mapping tidak boleh berganti nama -> sudah ditolak saat validasi).

Account Mapping WAJIB (MAPPING_WAJIB): download template & upload tiap modul
ditolak (MAPPING_REQUIRED) selama akun yang dibutuhkan modul itu belum
di-mapping di Settings > Account Mapping. Modul coa butuh akun kontrol AR, AP
& Fixed Asset supaya saldo subledger bisa dikenali & ditolak dari import COA;
Inventory opsional (perusahaan jasa tanpa persediaan) -- akun persediaan tetap
dikenali dari standard code / kategori persediaan.
Modul asset TIDAK memakai Account Mapping tunggal tapi KATEGORI aset tetap
(Fixed Assets > Categories): tiap kategori punya akun aset, akumulasi
penyusutan & beban penyusutan (fallback: Account Mapping fixed_asset /
accumulated_depreciation / depreciation_expense) -- lihat _kurang_kategori.

Modul asset (Asset Register):
    Template dari server: kolom Asset Category dropdown kategori klien; umur,
    metode, nilai residu & 3 akun terisi dari kategori (boleh ditimpa per aset
    = override, jadi warning). Remaining Life & Net Book Value = formula info.
    Validasi (_validasi_aset): kode aset wajib & unik (di file & di register),
    tanggal perolehan <= cut-off, biaya > 0, akumulasi 0..(biaya - residu),
    akun aset = ASSET, akun akumulasi = ASSET (kontra) & beda dari akun aset,
    akun beban = beban; aset disusutkan wajib punya umur + akun akumulasi & beban.
    Approve (_terapkan_aset): aset dibuat di register Fixed Assets (tanpa jurnal
    perolehan -- sudah diwakili saldo awal), lalu baris saldo awal SEMUA akun
    aset tetap & akumulasi dihitung ulang dari register (biaya = debit akun aset,
    akumulasi awal = kredit akun akumulasi; aset yang diperoleh <= cut-off &
    belum punya jurnal perolehan). Akun beban penyusutan tidak punya saldo awal.

Modul ar / ap (Opening AR / AP) -- pola sama dengan asset:
    Template dari server (dropdown customer master / vendor riwayat Purchase +
    akun kontrol, default dari Account Mapping). 1 baris = 1 invoice/bill yang
    masih outstanding per cut-off. Validasi (_validasi_dok): nama pihak & nomor
    dokumen wajib, nomor unik (di file & di Sales/Purchase), tanggal <= cut-off,
    jatuh tempo >= tanggal, original > 0, 0 < outstanding <= original, IDR, akun
    = akun kontrol AR/AP aktif (beda dari default -> warning).
    Approve (_terapkan_dok): dokumen Sales (AR) / Purchase (AP) POSTED dengan
    is_opening_balance = true (migration 46): ikut di AR/AP & pelunasan Cash &
    Bank, TIDAK dibaca GL & tidak tampil di menu Sales/Purchase. Customer baru
    masuk customer master. Saldo awal SEMUA akun kontrol AR/AP dihitung ulang =
    total outstanding semua batch approved modul itu.
Modul inventory (Opening Stock):
    Setup = kategori persediaan lengkap (akun persediaan + HPP). Item / gudang
    baru boleh (dibuat saat approve). Validasi (_validasi_inv): kode item &
    gudang wajib, 1 baris per item per gudang, item+gudang belum punya stok
    awal, qty > 0, harga >= 0, akun di file harus = akun kategori.
    Approve (_terapkan_inv): 1 dokumen Opening POSTED per gudang di modul
    Inventory (tanpa jurnal), lalu saldo awal akun persediaan = nilai stok per
    cut-off dari kartu stok.

Template modul coa dibuat dari COA klien: SEMUA akun klien sudah terisi
(1 baris per akun, Source Account Code/Name = kode/nama akun saat ini, tinggal
diganti ke data legacy + diisi saldonya). Kolom Source Classification,
Suggested ZAFEB Account Code/Name & Standard Account Code berupa dropdown
yang SALING TERHUBUNG. Di baris akun yang sudah terisi, kode ZAFEB = kunci
(3 kolom lain mengikuti kode). Di baris kosong tambahan, pilih salah satu ->
3 lainnya terisi; formula keempat kolom saling merujuk (referensi melingkar
yang disengaja), jadi workbook disimpan dengan iterative calculation aktif.

Setiap template punya sheet "Cara Penggunaan" (_tambah_cara_penggunaan):
langkah pengisian, panduan per kolom, daftar error/warning & efek approve.
Pembaca upload (_baca_tabel) melewati sheet ini.

Hak akses (keputusan bisnis 2026-10-24, _akses_import): baca = token valid.
    Tanpa review ("langsung")  super_admin, internal tahap_3..5, user klien
                               client_lv_1..5 (klien itu sendiri). Boleh upload &
                               langsung approve (tanpa submit, termasuk batch
                               sendiri), juga approve/reject batch orang lain.
    Perlu review ("review")    internal tahap_1..2, user klien client_lv_6
                               (Accounting Staff). Boleh upload/submit/cancel;
                               batch-nya di-approve user grup "langsung".
    Selain itu (client_lv_7..9 / klien lain) ditolak 403.
"""

from __future__ import annotations

import csv
import io
import re
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import StreamingResponse
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.workbook.defined_name import DefinedName
from openpyxl.worksheet.datavalidation import DataValidation
from pydantic import BaseModel, Field
from sqlalchemy import func, text

import db_client as dbc
from ..accounting_export import _lebar_kolom_dari_isi
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .coa_v1 import KLASIFIKASI_AKUN
from .opening_balance_v1 import KLASIFIKASI_NERACA, STANDARD_CODE_LABA_BERJALAN, _awal_tahun

logger = get_module_logger("management_opening_balance_import_v1")

router = APIRouter(prefix="/api/v1/management/opening-balances", tags=["management-opening-balance-import-v1"])

# Hak akses import -- lihat _akses_import.
TAHAP_TANPA_REVIEW = 3        # internal tahap_3..5 (+ super_admin)
CLIENT_LV_TANPA_REVIEW = 5    # client_lv_1..5 (Org Owner .. Supervisor)
CLIENT_LV_MAKS_INPUT = 6      # client_lv_6 (Accounting Staff) boleh input, perlu review
MAKS_UKURAN_FILE = 10 * 1024 * 1024
MAKS_BARIS = 5000
NOL = Decimal("0")
SEN = Decimal("0.01")

MODUL = {
    "coa": "Legacy COA + Non-Subledger Opening Balances",
    "ar": "Opening AR",
    "ap": "Opening AP",
    "inventory": "Opening Stock Inventory",
    "asset": "Asset Register",
}

OB = dbc.ManagementClientCoaOpeningBalance
IMP = dbc.ManagementClientCoaOpeningBalanceImport
ROW = dbc.ManagementClientCoaOpeningBalanceImportRow
COA = dbc.ManagementClientCoa

# Kolom template modul coa (urutan = urutan di file). key -> judul kolom.
KOLOM_COA: List[Tuple[str, str]] = [
    ("source_code", "Source Account Code"),
    ("source_name", "Source Account Name"),
    ("source_classification", "Source Classification"),
    ("zafeb_code", "Suggested ZAFEB Account Code"),
    ("zafeb_name", "Suggested ZAFEB Account Name"),
    ("standard_code", "Standard Account Code"),
    ("debit", "Opening Debit"),
    ("credit", "Opening Credit"),
    ("balance_date", "Balance Date"),
    ("currency", "Currency"),
    ("branch", "Branch"),
    ("department", "Department"),
    ("project", "Project"),
    ("notes", "Notes"),
]
BARIS_HEADER = 4
BARIS_DATA_AWAL = 5
JUMLAH_BARIS_TEMPLATE = 500
BARIS_KOSONG_TAMBAHAN = 100   # baris kosong di bawah daftar akun untuk akun legacy tambahan
MATA_UANG = ["IDR", "USD", "SGD", "AUD", "EUR", "JPY"]
MATA_UANG_OPENING = "IDR"
# Source Account Code & Currency tidak wajib: kode kosong dibuat otomatis
# (_isi_kode_otomatis), currency selalu IDR (keputusan bisnis 2026-10-26).
KOLOM_WAJIB_COA = ("source_name", "debit", "credit", "balance_date")
# Digit depan kode akun standar per klasifikasi (skema COA industri V2: 6 digit,
# mis. 110001 asset lancar, 210001 liability lancar).
DIGIT_KLASIFIKASI: Dict[str, str] = {
    "ASSET": "1", "LIABILITY": "2", "EQUITY": "3", "REVENUE": "4", "COST OF SALES": "5",
    "EXPENSE": "6", "OTHER INCOME": "7", "OTHER EXPENSE": "8", "INCOME TAX": "9",
}
# Akun kontrol yang saldonya di file COA dibuang diam-diam (bukan error) --
# saldo AR/AP/Inventory/Fixed Asset diimpor lewat modulnya sendiri (keputusan bisnis 2026-10-26).
KONTROL_DIBUANG = ("ar", "ap", "inventory", "asset")

# Akun KONTROL = saldonya dikelola subledger & diimpor lewat file terpisah
# (modul ar/ap/inventory/asset) -> DITOLAK di import COA non-subledger.
# Dikenali dari standard_account_code ATAU Settings > Account Mapping klien.
AKUN_KONTROL_STD: Dict[str, str] = {
    "std_asset_current_receivable_trade": "ar",
    "std_liability_current_payable_trade": "ap",
    "std_asset_current_inventory": "inventory",
}
AKUN_KONTROL_STD_PREFIX: Dict[str, str] = {"std_asset_noncurrent_ppe_": "asset"}
AKUN_KONTROL_MAPPING: Dict[str, str] = {
    "accumulated_depreciation": "asset",
    "account_receivable": "ar",
    "account_payable": "ap",
    "inventory": "inventory",
    "inventory_general": "inventory",
    "inventory_waste": "inventory",
    "inventory_production": "inventory",
    "fixed_asset": "asset",
}


# Account Mapping yang wajib ada per modul: (label, key mapping -- salah satu cukup).
_MAP_AR = ("Account Receivable", ("account_receivable",))
_MAP_AP = ("Account Payable", ("account_payable",))
_MAP_INVENTORY = ("Inventory", ("inventory", "inventory_general", "inventory_waste", "inventory_production"))
_MAP_ASET = ("Fixed Asset", ("fixed_asset",))
# Inventory TIDAK wajib untuk modul coa: perusahaan jasa umumnya tidak punya
# persediaan. Akun persediaan tetap dikenali sebagai akun kontrol lewat
# standard code / kategori persediaan / mapping kalau ada (_penentu_kontrol).
MAPPING_WAJIB: Dict[str, List[Tuple[str, Tuple[str, ...]]]] = {
    "coa": [_MAP_AR, _MAP_AP, _MAP_ASET],
    "ar": [_MAP_AR],
    "ap": [_MAP_AP],
}
# Tempat user melengkapi setup yang kurang (dikirim ke FE untuk dialog info).
SETUP_MAPPING = {"label": "Settings > Account Mapping", "href": "/settings/account-mapping"}
SETUP_KATEGORI_ASET = {"label": "Fixed Assets > Categories", "href": "/assets?tab=register&categories=1"}
# Fallback akun kategori aset dari Account Mapping (kategori tanpa akun).
DEFAULT_AKUN_ASET = {"asset": "fixed_asset", "accum": "accumulated_depreciation", "expense": "depreciation_expense"}


class _Gagal(Exception):
    def __init__(self, message: str, kode: str = "VALIDATION_ERROR", status_code: int = 400):
        super().__init__(message)
        self.message, self.kode, self.status_code = message, kode, status_code


def _respon_gagal(e: _Gagal):
    return gagal(message=e.message, errors={"code": e.kode}, status_code=e.status_code)


class RejectRequest(BaseModel):
    reason: str = Field(..., min_length=3, max_length=1000)


class ApproveRequest(BaseModel):
    note: Optional[str] = Field(None, max_length=1000)
    # Select data: id baris yang disetujui. None = semua baris (all data).
    row_ids: Optional[List[str]] = Field(None, max_length=MAKS_BARIS)


# ============================================================
# HELPER
# ============================================================

def _nama_user(user: Dict[str, Any]) -> Optional[str]:
    return user.get("nama") or user.get("username")


def _cek_modul(module: str) -> str:
    m = (module or "").strip().lower()
    if m not in MODUL:
        raise _Gagal("Unknown import module.", kode="UNKNOWN_MODULE", status_code=404)
    return m


def _ambil_ob(session, ob_id: str) -> Any:
    try:
        UUID(str(ob_id))
    except ValueError:
        raise _Gagal("Opening balance not found.", kode="NOT_FOUND", status_code=404)
    ob = session.query(OB).filter(OB.id == ob_id, OB.deleted_at.is_(None)).first()
    if ob is None:
        raise _Gagal("Opening balance not found.", kode="NOT_FOUND", status_code=404)
    return ob


def _ambil_batch(session, batch_id: str) -> Any:
    try:
        UUID(str(batch_id))
    except ValueError:
        raise _Gagal("Import batch not found.", kode="NOT_FOUND", status_code=404)
    b = session.get(IMP, str(batch_id))
    if b is None:
        raise _Gagal("Import batch not found.", kode="NOT_FOUND", status_code=404)
    return b


def _teks(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    return str(v).strip()


def _angka(v: Any) -> Optional[Decimal]:
    """Nilai sel -> Decimal. "" -> 0. None kalau bukan angka. Terima 1.234.567,50 & 1,234,567.50."""
    if v is None or (isinstance(v, str) and not v.strip()):
        return NOL
    if isinstance(v, (int, float, Decimal)):
        try:
            return Decimal(str(v)).quantize(SEN)
        except InvalidOperation:
            return None
    s = re.sub(r"[^\d,.\-()]", "", str(v))
    negatif = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif s.count(",") == 1 and len(s.split(",")[1]) <= 2:
        s = s.replace(",", ".")
    else:
        s = s.replace(",", "")
        if s.count(".") > 1:
            s = s.replace(".", "")
    try:
        d = Decimal(s).quantize(SEN)
    except InvalidOperation:
        return None
    return -d if negatif else d


def _tanggal(v: Any) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = _teks(v)
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d-%b-%Y", "%d %b %Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _dec_aman(v: Any) -> Decimal:
    return Decimal(str(v or 0)).quantize(SEN)


def _baris_terpilih(session, b: Any) -> List[Any]:
    """Baris batch yang diterapkan saat approve = yang tidak di-exclude approver (select data)."""
    return session.query(ROW).filter(ROW.import_id == b.id, ROW.is_excluded.is_(False)).order_by(ROW.row_no).all()


def _pilih_baris(session, b: Any, row_ids: Optional[List[str]]) -> Tuple[int, int, int]:
    """Select data saat approve: baris di luar row_ids ditandai is_excluded (tidak
    diterapkan). row_ids None = semua baris. Baris ERROR selalu dikeluarkan
    (tidak bisa di-approve) -- sisanya tetap jalan. Modul coa: debit != kredit
    tidak diblokir (selisih -> akun suspense saat posting opening balance).
    Return (jumlah dipilih, jumlah baris, jumlah baris error yang dilewati)."""
    rows = session.query(ROW).filter(ROW.import_id == b.id).all()
    semua = {r.id for r in rows}
    pilih = semua if row_ids is None else {str(x) for x in row_ids}
    if pilih - semua:
        raise _Gagal("Some selected rows do not belong to this batch — reload the page.", kode="INVALID_ROWS")
    error = {r.id for r in rows if r.status == "error"}
    pilih -= error
    if not pilih:
        raise _Gagal("There are no valid rows to approve — rows with errors cannot be approved. Fix the file and "
                     "import it again.", kode="NO_VALID_ROWS")
    for r in rows:
        r.is_excluded = r.id not in pilih
    session.flush()
    return len(pilih), len(rows), len(error)


def _akses_import(session, user: Dict[str, Any], client_id: str) -> Optional[str]:
    """Hak akses user ke import opening balance 1 klien: "langsung" (tanpa
    review), "review" (batch perlu di-approve user lain) atau None (ditolak).
    Lihat docstring modul."""
    role = (user.get("role") or "").strip()
    if role == auth.SUPER_ADMIN_ROLE:
        return "langsung"
    if role in auth.LEVELS:
        level = auth.role_level(role)
        return "langsung" if level >= TAHAP_TANPA_REVIEW else "review" if level >= 1 else None
    if role in auth.CLIENT_LEVELS:
        # User klien hanya untuk klien miliknya sendiri (management_users.client_id).
        u = session.get(dbc.User, str(user.get("id"))) if user.get("id") else None
        if u is None or u.deleted_at is not None or u.is_active is False or str(u.client_id) != str(client_id):
            return None
        level = auth.client_role_level(role) or 99
        return "langsung" if level <= CLIENT_LV_TANPA_REVIEW else "review" if level <= CLIENT_LV_MAKS_INPUT else None
    return None


def _wajib_akses(session, user: Dict[str, Any], client_id: str, perlu: str = "review") -> str:
    """perlu="review" = cukup boleh input; perlu="langsung" = boleh approve/reject."""
    akses = _akses_import(session, user, client_id)
    if akses is None:
        raise _Gagal("You do not have access to import opening balances for this client.",
                     kode="FORBIDDEN", status_code=403)
    if perlu == "langsung" and akses != "langsung":
        raise _Gagal("Your role cannot approve import batches. Internal Tahap 3+ or client roles Org Owner to "
                     "Supervisor can approve.", kode="FORBIDDEN", status_code=403)
    return akses


def _izin_batch(session, user: Dict[str, Any], b: Any) -> Dict[str, bool]:
    """Tombol aksi untuk FE (halaman review)."""
    akses = _akses_import(session, user, b.client_id)
    langsung = akses == "langsung"
    return {
        "can_input": akses is not None,
        "no_review": langsung,
        "can_submit": akses is not None and not langsung and b.status == "validated",
        "can_approve": langsung and b.status in ("validated", "submitted"),
        "can_reject": langsung and b.status == "submitted",
        "can_cancel": akses is not None and b.status in ("validated", "rejected"),
    }


def _catatan_batch(b: Any) -> List[str]:
    """Catatan level batch untuk reviewer -- TIDAK memblokir submit/approve
    (baris error otomatis dilewati saat approve, lihat _pilih_baris)."""
    isu = []
    if b.error_rows:
        isu.append(f"{b.error_rows} row(s) have errors — they cannot be approved and will not be applied; the other "
                   "rows can still be approved.")
    if b.module == "coa" and _dec_aman(b.total_debit) != _dec_aman(b.total_credit):
        selisih = abs(_dec_aman(b.total_debit) - _dec_aman(b.total_credit))
        isu.append(f"Total debit and total credit are not equal (difference {selisih:,.2f}) — any difference of the "
                   "approved rows is parked in the suspense account when the opening balance is posted.")
    return isu


def _ringkas_batch(b: Any) -> Dict[str, Any]:
    return {
        "id": b.id,
        "opening_balance_id": b.opening_balance_id,
        "client_id": b.client_id,
        "module": b.module,
        "module_label": MODUL.get(b.module, b.module),
        "file_name": b.file_name,
        "status": b.status,
        "total_rows": b.total_rows,
        "valid_rows": b.valid_rows,
        "warning_rows": b.warning_rows,
        "error_rows": b.error_rows,
        "total_debit": float(b.total_debit or 0),
        "total_credit": float(b.total_credit or 0),
        "issues": _catatan_batch(b),
        "notes": b.notes,
        "created_at": b.created_at,
        "created_by": b.created_by,
        "created_by_name": b.created_by_name,
        "submitted_at": b.submitted_at,
        "submitted_by_name": b.submitted_by_name,
        "reviewed_at": b.reviewed_at,
        "reviewed_by_name": b.reviewed_by_name,
        "review_note": b.review_note,
        "cancelled_at": b.cancelled_at,
    }


def _jalankan(fn):
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
        logger.exception("Gagal memproses import opening balance")
        raise
    finally:
        session.close()


def _mapping_kurang(mapping: Dict[str, Any], module: str) -> List[str]:
    """Label Account Mapping yang dibutuhkan modul tapi belum di-mapping."""
    return [label for label, keys in MAPPING_WAJIB.get(module, []) if not any(mapping.get(k, {}).get("coa_id") for k in keys)]


def _akun_kategori(c: Any, mapping: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Akun efektif 1 kategori aset: akun kategori, kalau kosong fallback Account Mapping."""
    kolom = {"asset": "asset_coa_id", "accum": "accum_coa_id", "expense": "expense_coa_id"}
    return {j: getattr(c, k) or (mapping.get(DEFAULT_AKUN_ASET[j]) or {}).get("coa_id") for j, k in kolom.items()}


def _kategori_aset(session, client_id: str) -> List[Any]:
    CAT = dbc.FixedAssetCategory
    return session.query(CAT).filter(CAT.client_id == client_id, CAT.deleted_at.is_(None)).order_by(CAT.name).all()


def _kurang_kategori(session, client_id: str, mapping: Dict[str, Any]) -> List[str]:
    """Setup kategori aset tetap yang belum lengkap untuk import Asset Register."""
    kategori = _kategori_aset(session, client_id)
    if not kategori:
        return ["At least one fixed asset category"]
    kurang = []
    for c in kategori:
        akun = _akun_kategori(c, mapping)
        perlu = [("asset", "Asset Account")]
        if c.is_depreciable and c.depreciation_method != "none":
            perlu += [("accum", "Accum. Dep. Account"), ("expense", "Depreciation Expense Account")]
            if not c.useful_life_months:
                kurang.append(f"{c.name}: Useful Life")
        kurang += [f"{c.name}: {label}" for j, label in perlu if not akun[j]]
    return kurang


def _setup_kurang(session, client_id: str, module: str, mapping: Dict[str, Any]) -> Tuple[List[str], Dict[str, str]]:
    if module == "asset":
        return _kurang_kategori(session, client_id, mapping), SETUP_KATEGORI_ASET
    if module == "inventory":
        return _kurang_kategori_persediaan(session, client_id), SETUP_KATEGORI_PERSEDIAAN
    return _mapping_kurang(mapping, module), SETUP_MAPPING


def _wajib_mapping(session, client_id: str, module: str) -> None:
    kurang, setup = _setup_kurang(session, client_id, module, dbc.akun_mapping_setting(client_id, session=session))
    if kurang:
        apa = {"asset": "Complete the fixed asset categories", "inventory": "Complete the inventory categories"}.get(
            module, "Map these accounts")
        raise _Gagal(
            f"{apa} in {setup['label']} before using \"{MODUL[module]}\": {', '.join(kurang)}.",
            kode="MAPPING_REQUIRED", status_code=409,
        )


def _penentu_kontrol(session, client_id: str):
    """Fungsi akun -> modul subledger (ar/ap/inventory/asset) kalau akun itu akun
    KONTROL, None kalau bukan. Dari standard_account_code atau Account Mapping."""
    mapping = dbc.akun_mapping_setting(client_id, session=session)
    kontrol_mapping = {
        v["coa_id"]: AKUN_KONTROL_MAPPING[k] for k, v in mapping.items() if k in AKUN_KONTROL_MAPPING and v.get("coa_id")
    }
    for c in _kategori_aset(session, client_id):
        akun = _akun_kategori(c, mapping)
        for j in ("asset", "accum"):
            if akun[j]:
                kontrol_mapping.setdefault(akun[j], "asset")
    for c in _kategori_persediaan(session, client_id):
        if c.inventory_coa_id:
            kontrol_mapping.setdefault(c.inventory_coa_id, "inventory")

    def modul_kontrol(a: Any) -> Optional[str]:
        return _std_kontrol(a.standard_account_code) or kontrol_mapping.get(a.id)

    return modul_kontrol


def _akun_klien(session, client_id: str) -> List[Any]:
    return (
        session.query(COA)
        .filter(COA.client_id == client_id, COA.deleted_at.is_(None))
        .order_by(COA.acc_no)
        .all()
    )


# Akun BARU dari import COA: kode boleh huruf/angka + . - _ / (maks 50, sama
# dengan kolom acc_no), diawali huruf/angka.
POLA_KODE_AKUN_BARU = re.compile(r"[A-Za-z0-9][A-Za-z0-9.\-_/]{0,49}")
KLASIFIKASI_SALDO_DEBIT = ("ASSET", "COST OF SALES", "EXPENSE", "OTHER EXPENSE", "INCOME TAX")
_KOLOM_KATALOG = ("account_classification", "account_head", "account_sub", "normal_balance",
                  "international_standard_group", "ifrs_taxonomy_reference", "ifrs_source")


def _katalog_standard(session, client_id: str) -> Dict[str, Dict[str, Any]]:
    """Daftar standard account code yang dikenali sistem -> atribut akunnya
    (klasifikasi, head, sub, saldo normal, referensi IFRS). Sumber: akun
    template COA industri (semua industri) + COA klien sendiri (menimpa).
    Dipakai untuk akun BARU di import COA: standard code wajib ada di sini
    supaya akun baru langsung punya lapisan semantik yang benar (FS mapping)."""
    TA = dbc.ManagementCoaIndustryTemplateAccount
    katalog: Dict[str, Dict[str, Any]] = {}
    sumber = [
        session.query(TA).filter(TA.standard_account_code.isnot(None)).order_by(TA.sort_order).all(),
        _akun_klien(session, client_id),
    ]
    for daftar in sumber:
        for a in daftar:
            std = (a.standard_account_code or "").strip()
            if not std or not a.account_classification:
                continue
            katalog[std.lower()] = {"standard_account_code": std, **{k: getattr(a, k) for k in _KOLOM_KATALOG}}
    return dict(sorted(katalog.items()))


def _std_kontrol(std: str) -> Optional[str]:
    std = (std or "").strip().lower()
    if std in AKUN_KONTROL_STD:
        return AKUN_KONTROL_STD[std]
    return next((m for prefix, m in AKUN_KONTROL_STD_PREFIX.items() if std.startswith(prefix)), None)


# ============================================================
# TEMPLATE MODUL COA
# ============================================================

_FONT = "Carlito"
_FILL_JUDUL = PatternFill("solid", fgColor="FF0F766E")
_FILL_KET = PatternFill("solid", fgColor="FFF8FBFB")
_FILL_HEADER = PatternFill("solid", fgColor="FF134E4A")
_FILL_RINGKAS = PatternFill("solid", fgColor="FFDFF3EE")
_FILL_LINK = PatternFill("solid", fgColor="FFECFDF5")
_FMT_ANGKA = "#,##0;[Red]-#,##0"
_FMT_TANGGAL = "dd-mmm-yyyy"
# Lebar kolom mengikuti template referensi dataset/COA/01_Template_Import_COA_NonSubledger.xlsx
# (kolom Mapping Status & Confidence dihapus).
_LEBAR_COA = [18, 28, 22, 26, 32, 38, 16, 16, 14, 10, 14, 18, 15, 32, 4, 23, 18]
SHEET_TEMPLATE = "COA_NON_SUBLEDGER"
SHEET_REFERENSI = "ZAFEB_COA"
# Sheet referensi TERLIHAT (khusus template modul coa): daftar COA klien supaya
# user tidak bingung mengisi. _baca_tabel MELEWATI sheet ini.
SHEET_STANDARD_REF = "Standard Reference"


def _formula_link(r: int, kolom: str, dari_kode: bool = False) -> str:
    """Formula 1 sel kolom mapping (C/D/E/F) di baris r. Tiap kolom mencari akun
    lewat kolom lain (kode -> nama -> standard code), jadi user cukup memilih
    SALAH SATU dari dropdown; '&""' memaksa hasil teks (sel kosong tidak jadi 0).
    dari_kode=True: baris akun yang sudah terisi -- kode (kolom D) berupa nilai,
    kolom C/E/F cukup mengikuti kode."""
    def cari(hasil: str, kunci_sel: str, kunci_rng: str) -> str:
        return f'INDEX({hasil},MATCH({kunci_sel}{r}&"",{kunci_rng},0))&""'

    sumber = [("D", "ZCOA_CODE")] if dari_kode else {
        "D": [("E", "ZCOA_NAME"), ("F", "ZCOA_STD")],
        "E": [("D", "ZCOA_CODE"), ("F", "ZCOA_STD")],
        "F": [("D", "ZCOA_CODE"), ("E", "ZCOA_NAME")],
        "C": [("D", "ZCOA_CODE"), ("E", "ZCOA_NAME"), ("F", "ZCOA_STD")],
    }[kolom]
    hasil = {"C": "ZCOA_CLASS", "D": "ZCOA_CODE", "E": "ZCOA_NAME", "F": "ZCOA_STD"}[kolom]
    # Klasifikasi yang tidak ketemu di COA klien -> dari katalog standard code (kolom F).
    rumus = f'IFERROR({cari("ZSTD_CLASS", "F", "ZSTD_CODE")},"")' if kolom == "C" else '""'
    for sel, rng in reversed(sumber):
        rumus = f"IFERROR({cari(hasil, sel, rng)},{rumus})"
    if dari_kode or kolom == "D":
        return "=" + rumus
    # Kode ZAFEB diketik & belum ada di COA klien = AKUN BARU: nama & standard code
    # diisi user sendiri (tidak ikut akun lama), klasifikasi mengikuti standard code.
    baru = f'AND(D{r}<>"",ISNA(MATCH(D{r}&"",ZCOA_CODE,0)))'
    isi_baru = f'IFERROR({cari("ZSTD_CLASS", "F", "ZSTD_CODE")},"")' if kolom == "C" else '""'
    return f"=IF({baru},{isi_baru},{rumus})"


# Seri akun bernomor (mis. "Bank Account", "Bank Account 2" .. "Bank Account 15"):
# di sheet COA_NON_SUBLEDGER cukup BATAS_AKUN_BERNOMOR pertama; daftar lengkap
# tetap di sheet Standard Reference & dropdown (ZAFEB_COA). Keputusan bisnis 2026-10-24.
BATAS_AKUN_BERNOMOR = 5
_POLA_BERNOMOR = re.compile(r"^(.*\D)\s*(\d+)\s*$")


def _akun_sheet_coa(akun: List[Any], dipertahankan: Optional[set] = None) -> List[Any]:
    """Akun untuk sheet COA_NON_SUBLEDGER. Seri = nama sama setelah angka di
    belakang dibuang + standard code sama, dan nomornya memuat 2 (seri berurutan
    -- "PPh 21 / 23" bukan seri). Akun tanpa angka dihitung nomor 1. Nomor di atas
    BATAS_AKUN_BERNOMOR disembunyikan, kecuali akunnya sudah punya saldo awal /
    Source Account Code (id di `dipertahankan`)."""
    dipertahankan = dipertahankan or set()

    def kunci_no(a: Any) -> Tuple[Tuple[str, str], int]:
        nama = (a.account_name or "").strip()
        m = _POLA_BERNOMOR.match(nama)
        dasar, no = (m.group(1).strip(), int(m.group(2))) if m else (nama, 1)
        return (dasar.lower(), (a.standard_account_code or "").strip().lower()), no

    seri: Dict[Tuple[str, str], set] = {}
    for a in akun:
        k, no = kunci_no(a)
        seri.setdefault(k, set()).add(no)
    hasil = []
    for a in akun:
        k, no = kunci_no(a)
        if 2 in seri[k] and no > BATAS_AKUN_BERNOMOR and a.id not in dipertahankan:
            continue
        hasil.append(a)
    return hasil


def buat_template_coa(nama_klien: str, akun: List[Any], ob: Any, modul_kontrol=None,
                      katalog: Optional[Dict[str, Dict[str, Any]]] = None,
                      dipertahankan: Optional[set] = None) -> bytes:
    katalog = katalog or {}
    semua_akun = akun
    # Sheet data: seri akun bernomor dibatasi (_akun_sheet_coa); referensi & dropdown tetap semua akun.
    akun = _akun_sheet_coa(semua_akun, dipertahankan)
    n_disembunyikan = len(semua_akun) - len(akun)
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_TEMPLATE
    font = Font(name=_FONT, size=11)
    akhir = BARIS_DATA_AWAL + max(JUMLAH_BARIS_TEMPLATE, len(akun) + BARIS_KOSONG_TAMBAHAN) - 1
    n_kolom = len(KOLOM_COA)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_kolom)
    c = ws.cell(1, 1, f"ZAFEB – IMPORT LEGACY COA + NON-SUBLEDGER OPENING BALANCES · {nama_klien} · FY {ob.fiscal_year}")
    c.font, c.fill = Font(name=_FONT, size=14, bold=True, color="FFFFFFFF"), _FILL_JUDUL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_kolom)
    c = ws.cell(2, 1, (
        "Use this template for the legacy chart of accounts and NON-SUBLEDGER opening balances. Every account of this "
        "client's COA is listed: replace Source Account Code / Name with your legacy values and fill in the balances — "
        "after approval the Source Account Name becomes the account name, and these balances REPLACE all opening "
        "balance lines. Each ZAFEB account may be used once. For extra legacy accounts use the empty rows below and pick "
        "ONE of Suggested ZAFEB Account Code / Account Name / Standard Account Code (the other columns fill in). "
        "To ADD A NEW account, type a new code in Suggested ZAFEB Account Code and pick its Standard Account Code "
        "(the account name is the Suggested ZAFEB Account Name, or the Source Account Name when left empty). "
        f"Required: Source Account Name, Opening Debit/Credit (>= 0) and Balance Date = cut-off date "
        f"({ob.as_of_date.strftime('%d-%b-%Y')}). An empty Source Account Code gets a standard code automatically; "
        "all balances are in IDR. Total debit must equal total credit. "
        "AR and AP balances are skipped here (imported through their own files); Inventory and Fixed Asset control "
        "accounts must stay 0."
        + (f" Numbered account series (e.g. Bank Account 1-{BATAS_AKUN_BERNOMOR}) are listed up to {BATAS_AKUN_BERNOMOR} "
           f"here ({n_disembunyikan} more account(s) are in sheet \"{SHEET_STANDARD_REF}\") — to use one, add it in "
           "an empty row and pick its Suggested ZAFEB Account Code." if n_disembunyikan else "")
    ))
    c.font, c.fill = Font(name=_FONT, size=11, color="FF475569"), _FILL_KET
    c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.row_dimensions[2].height = 96

    for i, (_, judul) in enumerate(KOLOM_COA, 1):
        c = ws.cell(BARIS_HEADER, i, judul)
        c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[BARIS_HEADER].height = 32

    rata_atas = Alignment(vertical="top", wrap_text=True)
    for r in range(BARIS_DATA_AWAL, akhir + 1):
        a = akun[r - BARIS_DATA_AWAL] if r - BARIS_DATA_AWAL < len(akun) else None
        for i in range(1, n_kolom + 1):
            c = ws.cell(r, i)
            c.font, c.alignment = font, rata_atas
        for kol in ("C", "D", "E", "F"):
            c = ws[f"{kol}{r}"]
            c.value = _formula_link(r, kol, dari_kode=a is not None)
            c.fill = _FILL_LINK
        if a is not None:
            # Baris akun klien: kode akun ZAFEB = kunci (nilai, bukan formula).
            ws[f"A{r}"].value = dbc.kode_tampil_akun(a)
            ws[f"B{r}"].value = a.account_name
            ws[f"D{r}"].value = str(a.acc_no)
            if not a.is_active:
                ws[f"N{r}"].value = "Inactive account — keep the balance at 0."
        # Kolom wajib diisi default supaya user cukup mengubah yang perlu.
        for kol in ("G", "H"):
            ws[f"{kol}{r}"].value = 0
            ws[f"{kol}{r}"].number_format = _FMT_ANGKA
        ws[f"I{r}"].value = ob.as_of_date
        ws[f"I{r}"].number_format = _FMT_TANGGAL
        ws[f"J{r}"].value = MATA_UANG_OPENING

    # Ringkasan kontrol (kolom P-Q) seperti template referensi.
    ringkas = [
        ("CONTROL SUMMARY", None),
        ("Total Debit", f"=SUM(G{BARIS_DATA_AWAL}:G{akhir})"),
        ("Total Credit", f"=SUM(H{BARIS_DATA_AWAL}:H{akhir})"),
        ("Difference", f"=Q{BARIS_HEADER + 1}-Q{BARIS_HEADER + 2}"),
        ("Status", f'=IF(Q{BARIS_HEADER + 3}=0,"BALANCED","NOT BALANCED")'),
    ]
    for j, (label, rumus) in enumerate(ringkas):
        r = BARIS_HEADER + j
        c = ws.cell(r, 16, label)
        if j == 0:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
            ws.cell(r, 17).fill = _FILL_HEADER
        else:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FF134E4A"), _FILL_RINGKAS
            q = ws.cell(r, 17, rumus)
            q.font = Font(name=_FONT, size=11, color="FF008000")
            if j < 4:
                q.number_format = _FMT_ANGKA

    for i, lebar in enumerate(_LEBAR_COA, 1):
        ws.column_dimensions[get_column_letter(i)].width = lebar
    ws.freeze_panes = f"A{BARIS_DATA_AWAL}"

    # Sheet referensi (tersembunyi) = sumber dropdown, diambil dari COA klien.
    ref = wb.create_sheet(SHEET_REFERENSI)
    ref.append(["Account Code", "Account Name", "Classification", "Standard Account Code", "", "Classifications", "",
                "Standard Codes", "Std Classification"])
    # Semua akun (termasuk nonaktif & seri bernomor yang tidak tampil di sheet data)
    # supaya tetap bisa dipilih; akun nonaktif bersaldo ditolak saat validasi upload.
    for a in semua_akun:
        ref.append([str(a.acc_no), a.account_name, a.account_classification or "", a.standard_account_code or ""])
    # Klasifikasi = daftar lengkap (akun baru boleh klasifikasi yang belum dipakai klien).
    klasifikasi = list(KLASIFIKASI_AKUN)
    for i, k in enumerate(klasifikasi, 2):
        ref.cell(i, 6, k)
    # Katalog standard code (_katalog_standard) = sumber dropdown kolom F & klasifikasi akun baru.
    for i, info in enumerate(katalog.values(), 2):
        ref.cell(i, 8, info["standard_account_code"])
        ref.cell(i, 9, info["account_classification"])
    for i, lebar in enumerate([18, 40, 20, 42, 2, 20, 2, 42, 20], 1):
        ref.column_dimensions[get_column_letter(i)].width = lebar
    ref.sheet_state = "hidden"

    n = max(len(semua_akun), 1) + 1
    nama_range = {
        "ZCOA_CODE": f"$A$2:$A${n}",
        "ZCOA_NAME": f"$B$2:$B${n}",
        "ZCOA_CLASS": f"$C$2:$C${n}",
        "ZCOA_STD": f"$D$2:$D${n}",
        "ZCLASS_LIST": f"$F$2:$F${max(len(klasifikasi), 1) + 1}",
        "ZSTD_CODE": f"$H$2:$H${max(len(katalog), 1) + 1}",
        "ZSTD_CLASS": f"$I$2:$I${max(len(katalog), 1) + 1}",
    }
    for nama, rng in nama_range.items():
        wb.defined_names[nama] = DefinedName(nama, attr_text=f"'{SHEET_REFERENSI}'!{rng}")

    def dropdown(rumus: str, kolom: str, judul: str, strict: bool = True, pesan: Optional[str] = None):
        dv = DataValidation(type="list", formula1=rumus, allow_blank=True, showErrorMessage=True,
                            errorStyle="stop" if strict else "warning",
                            errorTitle="Invalid value" if pesan is None else "New account?",
                            error=pesan or f"Pick a {judul} from the list.")
        dv.add(f"{kolom}{BARIS_DATA_AWAL}:{kolom}{akhir}")
        ws.add_data_validation(dv)

    dropdown("ZCLASS_LIST", "C", "classification")
    # Kode & nama ZAFEB boleh diketik di luar daftar (= akun BARU) -> peringatan, bukan blokir.
    dropdown("ZCOA_CODE", "D", "ZAFEB account code", strict=False, pesan=(
        "This code is not in the client's COA. Click Yes to ADD it as a NEW account, then pick its Standard Account "
        "Code. Click No to pick an existing account."))
    dropdown("ZCOA_NAME", "E", "ZAFEB account name", strict=False, pesan=(
        "This name is not in the client's COA. Keep it only for a NEW account (new code in Suggested ZAFEB "
        "Account Code)."))
    dropdown("ZSTD_CODE", "F", "standard account code")
    dropdown('"' + ",".join(MATA_UANG) + '"', "J", "currency", strict=False)

    _tambah_cara_penggunaan(wb, _panduan_coa(nama_klien, ob))
    _tambah_standard_reference(wb, nama_klien, semua_akun, modul_kontrol, katalog)

    # Formula kolom mapping saling merujuk -> wajib iterative calculation.
    wb.calculation.iterate = True
    wb.calculation.iterateCount = 100
    wb.calculation.iterateDelta = 0.001
    wb.calculation.fullCalcOnLoad = True

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


_LABEL_SUBLEDGER = {"ar": "AR", "ap": "AP", "inventory": "Inventory", "asset": "Fixed Assets"}


def _tambah_standard_reference(wb: Workbook, nama_klien: str, akun: List[Any], modul_kontrol=None,
                               katalog: Optional[Dict[str, Dict[str, Any]]] = None) -> None:
    """Sheet "Standard Reference" (setelah "Cara Penggunaan"): seluruh COA klien
    sebagai acuan pengisian -- kode, nama, klasifikasi, standard code, saldo
    normal, status & akun kontrol subledger (saldonya wajib 0 di template ini).
    Di bawahnya: katalog standard account code (_katalog_standard) untuk akun BARU."""
    ws = wb.create_sheet(SHEET_STANDARD_REF, 2)
    kolom = ["ZAFEB Account Code", "Account Code Shown", "Account Name", "Classification", "Account Head", "Account Sub",
             "Standard Account Code", "Normal Balance", "Status", "Subledger Control", "Description"]
    n_kolom = len(kolom)
    font = Font(name=_FONT, size=11)

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_kolom)
    c = ws.cell(1, 1, f"STANDARD REFERENCE — CHART OF ACCOUNTS · {nama_klien}")
    c.font, c.fill = Font(name=_FONT, size=14, bold=True, color="FFFFFFFF"), _FILL_JUDUL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_kolom)
    c = ws.cell(2, 1, (
        f"Reference only — this sheet is not imported. It lists all {len(akun)} accounts of this client's COA to help "
        f"you map legacy accounts in sheet {SHEET_TEMPLATE}. Accounts marked as Subledger Control must stay 0 there "
        "(their balances are imported through the AR / AP / Inventory / Fixed Asset files); inactive accounts must "
        "also stay 0."
    ))
    c.font, c.fill = Font(name=_FONT, size=11, color="FF475569"), _FILL_KET
    c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.row_dimensions[2].height = 48

    for i, judul in enumerate(kolom, 1):
        c = ws.cell(BARIS_HEADER, i, judul)
        c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[BARIS_HEADER].height = 20

    for r, a in enumerate(akun, BARIS_DATA_AWAL):
        kontrol = modul_kontrol(a) if modul_kontrol else None
        nilai = [
            str(a.acc_no), dbc.kode_tampil_akun(a), a.account_name, a.account_classification or "", a.account_head or "",
            a.account_sub or "", a.standard_account_code or "", a.normal_balance or "",
            "Active" if a.is_active else "Inactive", _LABEL_SUBLEDGER.get(kontrol, "") if kontrol else "",
            a.description or "",
        ]
        for i, v in enumerate(nilai, 1):
            c = ws.cell(r, i, v)
            c.font = font
            if kontrol or not a.is_active:
                c.fill = _FILL_WARNING

    # Daftar standard account code yang dikenali sistem -> acuan untuk akun BARU.
    if katalog:
        r = BARIS_DATA_AWAL + len(akun) + 2
        ws.merge_cells(start_row=r, start_column=1, end_row=r, end_column=n_kolom)
        c = ws.cell(r, 1, (
            f"STANDARD ACCOUNT CODES — for NEW accounts ({len(katalog)} codes). A new account in sheet "
            f"{SHEET_TEMPLATE} must use one of these codes; its classification, head, sub and normal balance follow "
            "the code. Codes marked as Subledger Control may be added but must stay 0."
        ))
        c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FF134E4A"), _FILL_RINGKAS
        c.alignment = Alignment(vertical="top", wrap_text=True)
        ws.row_dimensions[r].height = 32
        r += 1
        kolom_std = ["Standard Account Code", "Classification", "Account Head", "Account Sub", "Normal Balance",
                     "Used in this COA", "Subledger Control"]
        for i, judul in enumerate(kolom_std, 1):
            c = ws.cell(r, i, judul)
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
            c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        dipakai = {(a.standard_account_code or "").strip().lower() for a in akun}
        for r, (kunci, info) in enumerate(katalog.items(), r + 1):
            kontrol = _std_kontrol(kunci)
            nilai = [info["standard_account_code"], info["account_classification"] or "", info["account_head"] or "",
                     info["account_sub"] or "", info["normal_balance"] or "", "Yes" if kunci in dipakai else "No",
                     _LABEL_SUBLEDGER.get(kontrol, "") if kontrol else ""]
            for i, v in enumerate(nilai, 1):
                c = ws.cell(r, i, v)
                c.font = font
                if kontrol:
                    c.fill = _FILL_WARNING

    ws.auto_filter.ref = f"A{BARIS_HEADER}:{get_column_letter(n_kolom)}{BARIS_HEADER + max(len(akun), 1)}"
    ws.freeze_panes = f"D{BARIS_DATA_AWAL}"
    for huruf, lebar in _lebar_kolom_dari_isi(ws).items():
        ws.column_dimensions[huruf].width = lebar


# ============================================================
# SHEET "CARA PENGGUNAAN" (panduan pengisian di setiap template)
# ============================================================

# Nama sheet panduan -- _baca_tabel MELEWATI sheet ini (isinya memuat nama-nama
# kolom, jadi bisa dikira tabel data).
SHEET_PANDUAN = "Cara Penggunaan"
_FILL_SEKSI = PatternFill("solid", fgColor="FFDFF3EE")
_FILL_ERROR = PatternFill("solid", fgColor="FFFDECEC")
_FILL_WARNING = PatternFill("solid", fgColor="FFFFF7E6")


def _tambah_cara_penggunaan(wb: Workbook, p: Dict[str, Any]) -> None:
    """Sheet panduan setelah sheet data: info, langkah, panduan kolom, aturan
    validasi (error/warning) & apa yang terjadi setelah approve."""
    ws = wb.create_sheet(SHEET_PANDUAN, 1)
    lebar = [6, 30, 12, 22, 70]
    for i, l in enumerate(lebar, 1):
        ws.column_dimensions[get_column_letter(i)].width = l
    font = Font(name=_FONT, size=11)
    tebal = Font(name=_FONT, size=11, bold=True, color="FF134E4A")
    putih = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF")
    bungkus = Alignment(vertical="top", wrap_text=True)
    r = 1

    def baris_merge(teks: str, fnt: Font, fill: Optional[PatternFill] = None, tinggi: Optional[float] = None, mulai: int = 1):
        nonlocal r
        ws.merge_cells(start_row=r, start_column=mulai, end_row=r, end_column=len(lebar))
        c = ws.cell(r, mulai, teks)
        c.font, c.alignment = fnt, bungkus
        if fill is not None:
            for k in range(mulai, len(lebar) + 1):
                ws.cell(r, k).fill = fill
        if tinggi:
            ws.row_dimensions[r].height = tinggi
        r += 1

    def seksi(judul: str):
        nonlocal r
        r += 1
        baris_merge(judul, tebal, _FILL_SEKSI, 20)

    def daftar(items: List[str], fill: Optional[PatternFill] = None, penanda: str = "num"):
        for i, t in enumerate(items, 1):
            c = ws.cell(r, 1, f"{i}." if penanda == "num" else "•")
            c.font, c.alignment = font, Alignment(horizontal="right", vertical="top")
            baris_merge(t, font, fill, 15 * (len(t) // 130 + 1) + 3, mulai=2)

    baris_merge(f"HOW TO USE THIS TEMPLATE — {p['judul']}", Font(name=_FONT, size=14, bold=True, color="FFFFFFFF"), _FILL_JUDUL, 26)
    for label, nilai in p["info"]:
        ws.cell(r, 1).font = font
        c = ws.cell(r, 2, label)
        c.font = Font(name=_FONT, size=11, bold=True)
        ws.merge_cells(start_row=r, start_column=3, end_row=r, end_column=len(lebar))
        c = ws.cell(r, 3, nilai)
        c.font, c.alignment = font, bungkus
        r += 1

    seksi("STEPS")
    daftar(p["langkah"])

    seksi(f"COLUMN GUIDE — sheet {p['sheet']}")
    for i, judul in enumerate(("#", "Column", "Required", "Format", "How to fill / rule"), 1):
        c = ws.cell(r, i, judul)
        c.font, c.fill, c.alignment = putih, _FILL_HEADER, Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[r].height = 20
    r += 1
    for i, (kolom, wajib, fmt, catatan) in enumerate(p["kolom"], 1):
        nilai = (i, kolom, wajib, fmt, catatan)
        for j, v in enumerate(nilai, 1):
            c = ws.cell(r, j, v)
            c.font, c.alignment = font, bungkus
            if j == 3 and wajib == "Yes":
                c.font = Font(name=_FONT, size=11, bold=True, color="FFB91C1C")
            if j == 2 and wajib == "Auto":
                c.fill = _FILL_LINK
        # Tinggi baris = baris terbanyak di antara kolom yang di-wrap (lebar kolom ~ jumlah karakter per baris).
        ws.row_dimensions[r].height = 15 * max(len(kolom) // 28 + 1, len(fmt) // 20 + 1, len(catatan) // 66 + 1) + 3
        r += 1
    baris_merge("Green-shaded cells are filled automatically by formulas — you may overwrite them where the guide says so.",
                Font(name=_FONT, size=10, italic=True, color="FF475569"))

    seksi("ERRORS — these rows cannot be approved and are not applied (the other rows can still be approved)")
    daftar(p["error"], _FILL_ERROR, "dot")
    seksi("WARNINGS — allowed, the reviewer only needs to check them")
    daftar(p["warning"], _FILL_WARNING, "dot")
    seksi("AFTER APPROVAL")
    daftar(p["setelah"], penanda="dot")
    ws.sheet_view.showGridLines = False
    ws.freeze_panes = "A2"


def _info_panduan(nama_klien: str, ob: Any, modul: str) -> List[Tuple[str, str]]:
    return [
        ("Client", nama_klien),
        ("Fiscal year", str(ob.fiscal_year)),
        ("Cut-off date", ob.as_of_date.strftime("%d-%b-%Y")),
        ("Branch", ob.branch or "No branch"),
        ("Import module", MODUL[modul]),
    ]


_LANGKAH_UMUM_AKHIR = [
    "Save the file as .xlsx (keep the sheet and column names unchanged) and upload it with the Import button on "
    "COA > Opening Balance > Import Data.",
    "Review the validation result: rows marked Error cannot be approved and are skipped — fix them in the file and "
    "import them again if needed; rows marked Warning can stay but must be reviewed.",
    "Internal Tahap 3-5 and client roles Org Owner to Supervisor approve the batch directly (no review needed). Other "
    "roles submit it for approval; one of those users then approves or rejects it.",
]


def _panduan_coa(nama_klien: str, ob: Any) -> Dict[str, Any]:
    cut = ob.as_of_date.strftime("%d-%b-%Y")
    return {
        "judul": "LEGACY COA + NON-SUBLEDGER OPENING BALANCES", "sheet": SHEET_TEMPLATE,
        "info": _info_panduan(nama_klien, ob, "coa"),
        "langkah": [
            "Every account of this client's chart of accounts is already listed (one row per account). Do not delete rows "
            "you do not use — leave their balance at 0.",
            f"Numbered account series (e.g. Bank Account, Bank Account 2 .. 15) are listed only up to number "
            f"{BATAS_AKUN_BERNOMOR}. The full list is in sheet \"{SHEET_STANDARD_REF}\" — to use a higher number, add it "
            "in an empty row below the list and pick its Suggested ZAFEB Account Code.",
            "Replace Source Account Code and Source Account Name with the code and name from the legacy system. After "
            "approval the Source Account Code becomes the account code shown in the system and the Source Account Name "
            "becomes the account name (the ZAFEB code stays as the internal standard code).",
            "Fill Opening Debit OR Opening Credit with the balance on the cut-off date (the other stays 0).",
            "For an extra legacy account, use an empty row below the list and pick ONE of Suggested ZAFEB Account Code / "
            "Account Name / Standard Account Code — the other mapping columns fill in. To change a mapping, clear all four "
            "mapping cells of that row first.",
            "To ADD A NEW account that is not in the client's COA yet: type a new code in Suggested ZAFEB Account Code "
            "(Excel asks to confirm — click Yes), pick its Standard Account Code from the dropdown (Source "
            "Classification fills in), and optionally type the name in Suggested ZAFEB Account Name (empty = Source "
            "Account Name). The account is created in the COA when the batch is approved.",
            "AR, AP, Inventory and Fixed Asset balances in this file are skipped automatically — import them through the "
            "AR / AP / Inventory / Fixed Asset modules.",
            "Duplicates are made unique automatically: when a code or name is already used, the lower (newer) row gets "
            "the next number (e.g. 100005 -> 100006, Bank BCA -> Bank BCA 2). A second row on the same ZAFEB account "
            "becomes a new account with the next free code.",
            "Leave Source Account Code empty to get a unique standard code automatically (first digit follows the "
            "classification: 1 Asset, 2 Liability, 3 Equity, 4 Revenue, 5 Cost of Sales, 6 Expense, 7 Other Income, "
            "8 Other Expense, 9 Income Tax).",
            f'Use sheet "{SHEET_STANDARD_REF}" as a lookup of the client\'s COA (code, name, classification, standard '
            "account code, normal balance, status and subledger control accounts). It is reference only and is not imported.",
            "Check the CONTROL SUMMARY on the right: Status must be BALANCED (total debit = total credit).",
            *_LANGKAH_UMUM_AKHIR,
        ],
        "kolom": [
            ("Source Account Code", "No", "Text (max 50)", "Account code in the legacy system. A code already used in the file or the COA is changed to the next free number. After approval it becomes the account code SHOWN everywhere in the system (the ZAFEB code stays as the internal standard code). Empty = a unique 6-digit standard code is generated (first digit by classification)."),
            ("Source Account Name", "Yes", "Text (max 255)", "Account name in the legacy system. Becomes the ZAFEB account name after approval (not allowed for accounts locked in Account Mapping)."),
            ("Source Classification", "Auto", "Dropdown", "Follows the selected ZAFEB account. A different value only gives a warning. New account: follows the Standard Account Code and must match it."),
            ("Suggested ZAFEB Account Code", "Auto", "Dropdown / Text", "ZAFEB account this row maps to. Prefilled for listed accounts; a second row on the same account becomes a new account (next free code). A code not in the COA = NEW account: letters, digits and . - _ / only, no spaces, max 50 characters."),
            ("Suggested ZAFEB Account Name", "Auto", "Dropdown / Text", "Linked to the account code. New account: the new name (max 255; a name already used gets a number, e.g. Bank BCA 2); empty = Source Account Name."),
            ("Standard Account Code", "Auto", "Dropdown", f'Linked to the account code. Required for a NEW account — pick from the list (see "{SHEET_STANDARD_REF}", section STANDARD ACCOUNT CODES).'),
            ("Opening Debit", "No", "Number >= 0", "Debit balance on the cut-off date. Empty = 0."),
            ("Opening Credit", "No", "Number >= 0", "Credit balance on the cut-off date. Empty = 0. Do not fill both debit and credit."),
            ("Balance Date", "Yes", "Date", f"Must be the cut-off date {cut} (prefilled)."),
            ("Currency", "No", "ISO code", "Always IDR — any other value is ignored."),
            ("Branch", "No", "Text", "Informational. A branch different from this opening balance set gives a warning."),
            ("Department / Project / Notes", "No", "Text", "Informational; Notes is copied to the opening balance line."),
        ],
        "error": [
            "Source Account Name empty.",
            "Opening Debit / Credit not a number, negative, or both filled.",
            f"Balance Date empty, invalid or not equal to {cut}.",
            "ZAFEB account not found, or mapping columns pointing to different accounts.",
            "A balance on an inactive account, Current Year Earnings, "
            "or a P&L account when the cut-off is the start of the fiscal year.",
            "Renaming an account that is locked in Settings > Account Mapping.",
            "New account: invalid code, Standard Account Code empty or "
            "not recognized, Source Classification invalid or different from the standard code, Current Year Earnings, "
            "or a balance on a subledger control standard code.",
        ],
        "warning": [
            "Row without a ZAFEB account (unmapped) — its balance is NOT applied to the opening balance.",
            "Total debit not equal to total credit — the difference of the approved rows is parked in the suspense "
            "account when the opening balance is posted.",
            "Source Classification different from the ZAFEB account classification.",
            "Branch different from this opening balance set.",
            "New account — the reviewer confirms it before it is added to the client's COA.",
            "Duplicate code / name / ZAFEB account — changed automatically to a unique one (the message shows the new value).",
        ],
        "setelah": [
            "Opening balance lines of all NON-control accounts are REPLACED with the balances of this batch (control account "
            "balances from AR / AP / Inventory / Fixed Assets are kept).",
            "ZAFEB account names are updated from Source Account Name, and the Source Account Code is saved as the "
            "account code shown in the system.",
            "New accounts are added to the client's COA (active) with the classification, head, sub and normal balance of "
            "their Standard Account Code; their balances become opening balance lines.",
        ],
    }


def _panduan_aset(nama_klien: str, ob: Any) -> Dict[str, Any]:
    cut = ob.as_of_date.strftime("%d-%b-%Y")
    return {
        "judul": "FIXED ASSET REGISTER", "sheet": SHEET_TEMPLATE_ASET,
        "info": _info_panduan(nama_klien, ob, "asset"),
        "langkah": [
            "Enter one row per fixed asset that the client owns on the cut-off date.",
            "Pick the Asset Category from the dropdown — useful life, method, residual value and the three accounts fill in "
            "from the category (Fixed Assets > Categories). Overwrite them only if this asset differs.",
            "Enter the Original Cost and the Accumulated Depreciation up to the cut-off date from the legacy register.",
            "Net Book Value and Remaining Life are calculated — check them against the legacy register.",
            *_LANGKAH_UMUM_AKHIR,
        ],
        "kolom": [
            ("Asset Code", "Yes", "Text (max 50)", "Unique in the file and not yet in the Fixed Asset register."),
            ("Asset Name", "Yes", "Text (max 255)", "Description of the asset."),
            ("Asset Category", "Yes", "Dropdown", "Must be an existing fixed asset category."),
            ("Acquisition Date", "Yes", "Date", f"On or before the cut-off date {cut}."),
            ("Original Cost", "Yes", "Number > 0", "Acquisition cost."),
            ("Residual Value", "Auto", "Number >= 0", "Default = cost × category residual %. Must be lower than the cost."),
            ("Useful Life (Years)", "Auto", "Number > 0", "Default from the category. Required for depreciable assets."),
            ("Depreciation Method", "Auto", "Dropdown", "Straight Line, Declining Balance or None. Default from the category."),
            ("Depreciation Start Date", "Auto", "Date", "Default = acquisition date. Cannot be before it."),
            ("Accumulated Depreciation", "Yes", "Number >= 0", "Depreciation up to the cut-off date. Max = cost − residual value; 0 for assets that are not depreciated."),
            ("Net Book Value", "Auto", "Formula", "Original Cost − Accumulated Depreciation."),
            ("Remaining Life (Months)", "Auto", "Formula", "Useful life minus the months already depreciated up to the cut-off date."),
            ("Asset Account", "Auto", "Dropdown", "From the category. Must be an asset account."),
            ("Accum. Dep. Account", "Auto", "Dropdown", "From the category. Contra-asset account, different from the Asset Account."),
            ("Depreciation Expense Account", "Auto", "Dropdown", "From the category. Must be an expense account."),
            ("Location / Department / Custodian", "No", "Text", "Copied to the asset."),
            ("Tax Depreciation Group / Notes", "No", "Text", "Copied to the asset description."),
        ],
        "error": [
            "Asset Code empty, duplicated or already in the register; Asset Name or Asset Category empty / not found.",
            f"Acquisition Date empty, invalid or after {cut}; Depreciation Start Date before the Acquisition Date.",
            "Original Cost not greater than 0; Residual Value not lower than the cost.",
            "Accumulated Depreciation more than cost − residual value, or filled for an asset that is not depreciated.",
            "Useful life or the Accum. Dep. / Depreciation Expense account missing for a depreciable asset.",
            "An account not found, inactive, or of the wrong type.",
        ],
        "warning": ["An account different from the category default (override for this asset)."],
        "setelah": [
            "The assets are created in Fixed Assets > Asset Register (no acquisition journal — the cost is already in the "
            "opening balance).",
            "Opening balances of all fixed asset and accumulated depreciation accounts are recalculated from the register.",
            "Depreciation runs start from the month after the cut-off date.",
        ],
    }


def _panduan_dok(sisi: "SisiDok", nama_klien: str, ob: Any) -> Dict[str, Any]:
    cut = ob.as_of_date.strftime("%d-%b-%Y")
    ar = sisi.modul == "ar"
    pihak, dok, akun = sisi.pihak, sisi.dokumen, ("AR" if ar else "AP")
    kolom = [
        (f"{pihak} Code", "No", "Dropdown / text", f"Pick an existing {pihak.lower()} — the name and tax ID fill in. "
                                                     f"Type a new code for a new {pihak.lower()}."),
        (f"{pihak} Name", "Yes", "Text (max 255)", f"Filled from the code for an existing {pihak.lower()}; type it for a new one."),
        (f"{pihak} Tax ID", "No", "Text (max 30)", "NPWP."),
        (dict(sisi.kolom)["doc_no"], "Yes", "Text", f"Unique {dok.lower()} number (not yet recorded in "
                                                   f"{'Sales / AR' if ar else 'Purchase / AP'})."),
        (f"{dok} Date", "Yes", "Date", f"On or before the cut-off date {cut}."),
        ("Due Date", "No", "Date", f"Not before the {dok} Date. Used for aging."),
        (dict(sisi.kolom)["original"], "Yes", "Number > 0", f"Original {dok.lower()} amount."),
        ("Outstanding Amount", "Yes", "Number > 0", f"Unpaid amount on the cut-off date — not more than the original amount. "
                                                    f"Fully paid {dok.lower()}s are not imported."),
        ("Currency", "No", "ISO code", "Always IDR — any other value is ignored."),
        (f"{akun} Control Account", "Yes", "Dropdown", f"Prefilled with the default from Settings > Account Mapping. Must be "
                                                         f"an {akun} control account."),
    ]
    if not ar:
        kolom += [("Withholding Tax Type / Withholding Outstanding", "No", "Text / number",
                   "Informational (copied to the bill notes). Outstanding withholding cannot exceed the outstanding amount.")]
    kolom += [("Branch", "No", "Text", "Prefilled with the branch of this opening balance set; a different branch gives a warning."),
              (f"Department / Project{' / Salesperson' if ar else ''} / Reference / Notes", "No", "Text",
               f"Copied to the {dok.lower()}.")]
    return {
        "judul": sisi.judul.replace("IMPORT ", ""), "sheet": sisi.sheet,
        "info": _info_panduan(nama_klien, ob, sisi.modul),
        "langkah": [
            f"Enter one row per {pihak.lower()} {dok.lower()} that is still unpaid (fully or partly) on the cut-off date.",
            f"Pick an existing {pihak} Code from the dropdown, or type the name of a new {pihak.lower()}"
            f"{' (it is added to the customer master on approval)' if ar else ''}.",
            "Enter the original amount and the outstanding amount on the cut-off date.",
            f"Keep the {akun} Control Account from the dropdown (default from Account Mapping).",
            "Check the CONTROL SUMMARY on the right against the legacy aging report.",
            *_LANGKAH_UMUM_AKHIR,
        ],
        "kolom": kolom,
        "error": [
            f"{pihak} Name or {dok} Number empty; {dok} Number duplicated in the file or already recorded.",
            f"{dok} Date empty, invalid or after {cut}; Due Date before the {dok} Date.",
            "Original or Outstanding Amount empty, not greater than 0, or outstanding more than the original.",
            f"{akun} Control Account empty, not found, inactive or not an {akun} control account.",
        ],
        "warning": [
            *( ["New customer (added to the customer master)."] if ar else [] ),
            f"{pihak} name different from the master (the master name is used).",
            f"{akun} Control Account different from the default.",
            "Branch different from this opening balance set.",
        ],
        "setelah": [
            f"The {dok.lower()}s appear in {'Accounts Receivable' if ar else 'Accounts Payable'} (aging, statements) and can "
            "be settled through Cash & Bank. They are marked as opening balance documents: not shown in "
            f"{'Sales' if ar else 'Purchase'} and not posted to the General Ledger again.",
            f"The opening balance of the {akun} control account(s) is recalculated from the outstanding amounts of all "
            f"approved {akun} batches.",
        ],
    }


def _panduan_inv(nama_klien: str, ob: Any) -> Dict[str, Any]:
    cut = ob.as_of_date.strftime("%d-%b-%Y")
    return {
        "judul": "OPENING STOCK INVENTORY", "sheet": SHEET_TEMPLATE_INV,
        "info": _info_panduan(nama_klien, ob, "inventory"),
        "langkah": [
            f"Enter one row per item per warehouse with the stock on the cut-off date {cut}.",
            "Pick an existing Item Code from the dropdown (name, category and unit fill in), or type a new code with Item "
            "Name, Category and Unit — the item is created on approval.",
            "Pick an existing Warehouse Code, or type a new code with Warehouse Name — the warehouse is created on approval.",
            "Enter Opening Qty and Unit Cost. Opening Inventory Value is calculated.",
            "Inventory and COGS accounts come from the item category (Inventory > Setup) and cannot be changed per row.",
            *_LANGKAH_UMUM_AKHIR,
        ],
        "kolom": [
            ("Item Code", "Yes", "Dropdown / text", "Existing item, or a new code (max 50)."),
            ("Item Name", "Auto", "Text", "Filled for an existing item; required for a new item."),
            ("Category", "Auto", "Dropdown", "Filled for an existing item; required for a new item. Must be an existing inventory category."),
            ("Warehouse Code", "Yes", "Dropdown / text", "Existing warehouse, or a new code (max 30)."),
            ("Warehouse Name", "Auto", "Text", "Filled for an existing warehouse; required for a new warehouse."),
            ("Unit", "Auto", "Text", "Filled for an existing item; for a new item, empty = Pcs."),
            ("Opening Qty", "Yes", "Number > 0", "Quantity on hand on the cut-off date."),
            ("Unit Cost", "Yes", "Number >= 0", "Cost per unit. 0 records the stock without value (warning)."),
            ("Opening Inventory Value", "Auto", "Formula", "Opening Qty × Unit Cost."),
            ("Inventory Account / COGS Account", "Auto", "From category", "Must match the item category accounts."),
            ("Batch / Lot, Expiry Date", "No", "Text / date", "Copied to the opening stock document line."),
            ("Branch / Project / Notes", "No", "Text", "Informational; a different branch gives a warning."),
        ],
        "error": [
            "Item Code or Warehouse Code empty; the same item and warehouse on two rows.",
            "The item already has opening stock in that warehouse.",
            "New item without Item Name or Category; new warehouse without Warehouse Name; category not found.",
            "Opening Qty not greater than 0; Unit Cost empty or negative.",
            "Item inactive / without category, warehouse inactive, or accounts different from the category.",
        ],
        "warning": [
            "New item or new warehouse (created on approval).",
            "Item name or unit different from the item master (the master is kept).",
            "Unit Cost 0, or branch different from this opening balance set.",
        ],
        "setelah": [
            "An Opening stock document is posted per warehouse in Inventory (no journal — the value is already in the opening "
            "balance).",
            "The opening balance of the inventory account(s) is recalculated from the stock valuation on the cut-off date.",
        ],
    }


# ============================================================
# BACA FILE
# ============================================================

def _norm_header(s: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", _teks(s).lower())


def _baca_tabel(isi: bytes, nama_file: str, header_wajib: Optional[str] = None) -> Tuple[List[str], List[Tuple[int, List[Any]]]]:
    """File -> (header, [(nomor_baris_excel, nilai[])]). Baris header = baris pertama
    yang memuat `header_wajib` (kalau ada) atau yang berisi >=3 sel teks."""
    ext = nama_file.lower().rsplit(".", 1)[-1] if "." in nama_file else ""
    if ext == "csv":
        teks = isi.decode("utf-8-sig", errors="replace")
        try:
            dialek = csv.Sniffer().sniff(teks[:4096], delimiters=",;\t")
        except csv.Error:
            dialek = csv.excel
        lembar = [list(r) for r in csv.reader(io.StringIO(teks), dialek)]
    elif ext in ("xlsx", "xlsm"):
        try:
            wb = load_workbook(io.BytesIO(isi), data_only=True)
        except Exception:
            raise _Gagal("Could not read the file. Upload a valid .xlsx or .csv file.", kode="UNREADABLE_FILE")
        lewati = {SHEET_PANDUAN.lower(), SHEET_STANDARD_REF.lower()}
        data_ws = [ws for ws in wb.worksheets if ws.title.strip().lower() not in lewati]
        kandidat = [ws for ws in data_ws if ws.sheet_state == "visible"] or data_ws
        lembar = []
        for ws in kandidat:
            rows = [list(r) for r in ws.iter_rows(values_only=True)]
            if header_wajib is None or any(_norm_header(header_wajib) in {_norm_header(v) for v in r} for r in rows[:30]):
                lembar = rows
                break
    else:
        raise _Gagal("Unsupported file type. Upload .xlsx or .csv.", kode="UNSUPPORTED_FILE")

    idx_header = None
    for i, r in enumerate(lembar[:30]):
        norm = {_norm_header(v) for v in r}
        if header_wajib is not None:
            if _norm_header(header_wajib) in norm:
                idx_header = i
                break
        elif sum(1 for v in r if isinstance(v, str) and v.strip()) >= 3:
            idx_header = i
            break
    if idx_header is None:
        pesan = f'Header row not found (expected a "{header_wajib}" column).' if header_wajib else "Header row not found."
        raise _Gagal(pesan + " Use the downloaded template.", kode="HEADER_NOT_FOUND")

    header = [_teks(v) for v in lembar[idx_header]]
    data = []
    for i, r in enumerate(lembar[idx_header + 1:], idx_header + 2):
        if any(_teks(v) for v in r):
            data.append((i, list(r)))
    return header, data


# ============================================================
# VALIDASI MODUL COA
# ============================================================

def _kode_unik(kode: str, dipakai: set) -> str:
    """Kode yang sudah dipakai -> angka di belakangnya +1 sampai bebas (100005 ->
    100006, nol di depan dipertahankan; tanpa angka: BANK -> BANK-2). `dipakai`
    berisi kode huruf kecil. Keputusan bisnis 2026-10-26: duplikat dibuat unik."""
    m = re.fullmatch(r"(.*?)(\d+)", kode)
    dasar, n, lebar = (m.group(1), int(m.group(2)), len(m.group(2))) if m else (f"{kode}-", 1, 1)
    while True:
        n += 1
        baru = f"{dasar}{n:0{lebar}d}"
        if baru.lower() not in dipakai:
            return baru


def _nama_unik(nama: str, dipakai: set) -> str:
    """Nama yang sudah dipakai -> nomor di belakangnya +1 (Bank BCA -> Bank BCA 2,
    Bank BCA 2 -> Bank BCA 3). `dipakai` berisi nama huruf kecil."""
    m = re.fullmatch(r"(.*\S)\s+(\d+)", nama)
    dasar, n = (m.group(1), int(m.group(2))) if m else (nama, 1)
    while True:
        n += 1
        baru = f"{dasar} {n}"
        if baru.lower() not in dipakai:
            return baru


def _cek_akun_baru(d: Dict[str, str], no_baris: int, bersaldo: bool, katalog: Dict[str, Dict[str, Any]],
                   per_nama: Dict[str, List[Any]], kode_dipakai: Dict[str, int], nama_dipakai: Dict[str, int],
                   semua_kode: set, awal_tahun: bool, err, warn, ada_error) -> Dict[str, Any]:
    """Baris dengan Suggested ZAFEB Account Code yang BELUM ada di COA klien =
    akun baru. Boleh, asal standarnya jelas:
        kode    pola POLA_KODE_AKUN_BARU; dipakai akun baru lain di file -> +1
                (_kode_unik, terhadap `semua_kode`) + warning.
        nama    Suggested ZAFEB Account Name, kosong -> Source Account Name;
                sama dengan nama akun yang sudah ada / akun baru lain -> dibuat
                unik (_nama_unik) + warning.
        std     Standard Account Code WAJIB & harus dikenali (_katalog_standard);
                head/sub/saldo normal/referensi IFRS diambil dari katalog.
        kls     Source Classification (kosong -> dari katalog) harus salah satu
                KLASIFIKASI_AKUN & sama dengan klasifikasi standard code.
    Aturan saldo sama dengan akun lama: Current Year Earnings ditolak, akun
    kontrol subledger harus bersaldo 0, cut-off awal tahun hanya akun neraca.
    Return atribut akun yang dibuat saat approve (_buat_akun_baru)."""
    kode = d["zafeb_code"]
    if not POLA_KODE_AKUN_BARU.fullmatch(kode):
        err(f'New ZAFEB account code "{kode}" is invalid — use letters, digits and . - _ / only '
            "(no spaces, max 50 characters).")
    else:
        if kode.lower() in kode_dipakai:
            lama, kode = kode, _kode_unik(kode, semua_kode | set(kode_dipakai))
            warn(f"New ZAFEB account code {lama} is also used on row {kode_dipakai[lama.lower()]} — "
                 f"changed to {kode} to keep it unique.")
        kode_dipakai[kode.lower()] = no_baris
        semua_kode.add(kode.lower())

    nama = d.get("zafeb_name") or d.get("source_name") or ""
    if d.get("zafeb_name") and len(nama) > 255:
        err("Suggested ZAFEB Account Name is longer than 255 characters.")
    elif nama:
        lain = per_nama.get(nama.lower())
        if lain or nama.lower() in nama_dipakai:
            pemilik = f"account {dbc.kode_tampil_akun(lain[0])}" if lain else f"row {nama_dipakai[nama.lower()]}"
            lama, nama = nama, _nama_unik(nama, set(per_nama) | set(nama_dipakai))
            warn(f'Account name "{lama}" is already used by {pemilik} — changed to "{nama}" to keep it unique.')
        nama_dipakai[nama.lower()] = no_baris

    std = d.get("standard_code") or ""
    info = katalog.get(std.lower()) if std else None
    if not std:
        err(f"Standard Account Code is required for new account {kode} — pick one from the dropdown.")
    elif info is None:
        err(f'Standard account code "{std}" is not recognized — pick one from the dropdown '
            f'(list in sheet "{SHEET_STANDARD_REF}").')
    kls_std = ((info or {}).get("account_classification") or "").upper()
    # Klasifikasi kosong -> dari standard code (kalau standard code gagal, error-nya sudah di atas).
    kls = (d.get("source_classification") or "").strip().upper() or kls_std
    if kls and kls not in KLASIFIKASI_AKUN:
        err(f'Source Classification "{d.get("source_classification")}" is invalid — use one of: {", ".join(KLASIFIKASI_AKUN)}.')
    elif kls_std and kls != kls_std:
        err(f"Source Classification {kls} does not match standard account code {info['standard_account_code']} ({kls_std}).")

    if info is not None:
        if std.lower() == STANDARD_CODE_LABA_BERJALAN:
            err("Current Year Earnings is calculated automatically — it cannot be added as a new account.")
        kontrol = _std_kontrol(std)
        if kontrol and bersaldo:
            err(f"Standard account code {info['standard_account_code']} is a {_LABEL_SUBLEDGER[kontrol]} control account — "
                f"the new account may be added, but its balance must be imported through \"{MODUL[kontrol]}\" (keep 0 here).")
    if bersaldo and awal_tahun and kls and kls not in KLASIFIKASI_NERACA:
        err("Start-of-year cut-off accepts balance sheet accounts only (P&L belongs in Retained Earnings).")

    if not ada_error():
        warn(f"New account — {kode} {nama} will be added to this client's COA on approval.")
    info = info or {}
    return {
        "acc_no": kode,
        "account_name": nama,
        "account_classification": kls or None,
        "account_head": info.get("account_head"),
        "account_sub": info.get("account_sub"),
        "normal_balance": info.get("normal_balance") or ("DEBIT" if kls in KLASIFIKASI_SALDO_DEBIT else "CREDIT"),
        "standard_account_code": info.get("standard_account_code") or std or None,
        "international_standard_group": info.get("international_standard_group"),
        "ifrs_taxonomy_reference": info.get("ifrs_taxonomy_reference"),
        "ifrs_source": info.get("ifrs_source"),
        "description": f"Added by opening balance import (legacy account {d.get('source_code') or '-'}).",
        "source_acc_no": d.get("source_code") or None,
    }


def _validasi_coa(session, ob: Any, header: List[str], data: List[Tuple[int, List[Any]]]) -> List[Dict[str, Any]]:
    posisi: Dict[str, int] = {}
    norm = [_norm_header(h) for h in header]
    for key, judul in KOLOM_COA:
        if _norm_header(judul) in norm:
            posisi[key] = norm.index(_norm_header(judul))
    hilang = [judul for key, judul in KOLOM_COA if key in KOLOM_WAJIB_COA and key not in posisi]
    if hilang:
        raise _Gagal(f"Missing required column(s): {', '.join(hilang)}. Use the downloaded template.", kode="MISSING_COLUMNS")

    akun = [a for a in _akun_klien(session, ob.client_id)]
    per_kode = {str(a.acc_no).strip().lower(): a for a in akun}
    per_nama: Dict[str, List[Any]] = {}
    per_std: Dict[str, List[Any]] = {}
    for a in akun:
        per_nama.setdefault(a.account_name.strip().lower(), []).append(a)
        if a.standard_account_code:
            per_std.setdefault(a.standard_account_code.strip().lower(), []).append(a)
    modul_kontrol = _penentu_kontrol(session, ob.client_id)
    awal_tahun = _awal_tahun(ob)
    # Akun yang dikunci Account Mapping tidak boleh berganti nama (trigger DB
    # trg_kunci_coa_mapping) -> nama dari Source Account Name ditolak di sini.
    MAP = dbc.ManagementSettingAccountMapping
    kunci_mapping: Dict[str, List[str]] = {}
    for coa_id, key in session.query(MAP.coa_id, MAP.mapping_key).filter(
        MAP.client_id == ob.client_id, MAP.is_locked.is_(True),
    ).all():
        kunci_mapping.setdefault(str(coa_id), []).append(key)

    katalog = _katalog_standard(session, ob.client_id)

    def kosong(v: Any) -> bool:
        return not _teks(v)

    def pilih_per_kode(kand: List[Any], kode: str) -> Optional[Any]:
        return next((x for x in kand if str(x.acc_no).strip().lower() == kode.lower()), None)

    # Kode yang sudah terpakai (COA klien + semua kode di file) -> acuan +1 di _kode_unik
    # supaya kode hasil +1 tidak menabrak kode baris lain di bawahnya.
    def kode_di_file(key: str) -> set:
        p = posisi.get(key)
        if p is None:
            return set()
        return {_teks(r[p]).lower() for _, r in data if p < len(r) and _teks(r[p])}
    semua_kode_zafeb = set(per_kode) | kode_di_file("zafeb_code")
    semua_kode_sumber = set(per_kode) | {dbc.kode_tampil_akun(a).lower() for a in akun} | kode_di_file("source_code")

    hasil, kode_dipakai, akun_dipakai = [], {}, {}
    kode_baru_dipakai: Dict[str, int] = {}
    nama_baru_dipakai: Dict[str, int] = {}
    for no_baris, r in data:
        nilai = {k: (r[p] if p < len(r) else None) for k, p in posisi.items()}
        d = {k: _teks(v) for k, v in nilai.items() if k not in ("debit", "credit", "balance_date")}
        # Baris template kosong (hasil formula kosong + default 0/tanggal/IDR) -> lewati.
        if not any(d.get(k) for k in ("source_code", "source_name")) and all(
            kosong(nilai.get(k)) or (_angka(nilai.get(k)) or NOL) == 0 for k in ("debit", "credit")
        ):
            continue
        pesan: List[Dict[str, str]] = []

        def err(m): pesan.append({"level": "error", "message": m})
        def warn(m): pesan.append({"level": "warning", "message": m})

        # Source Account Code opsional (kosong -> dibuat otomatis di _isi_kode_otomatis); Name wajib.
        if not d.get("source_name"):
            err("Source Account Name is required.")
        elif len(d["source_name"]) > 255:
            err("Source Account Name is longer than 255 characters.")
        if len(d.get("source_code") or "") > 50:
            err("Source Account Code is longer than 50 characters.")
        if d.get("source_code"):
            k = d["source_code"].lower()
            if k in kode_dipakai:
                # Duplikat -> baris yang lebih bawah (data terbaru) dibuat unik: +1.
                baru = _kode_unik(d["source_code"], semua_kode_sumber | set(kode_dipakai))
                warn(f"Source Account Code {d['source_code']} is also used on row {kode_dipakai[k]} — "
                     f"changed to {baru} to keep it unique.")
                d["source_code"], k = baru, baru.lower()
                semua_kode_sumber.add(k)
            kode_dipakai[k] = no_baris

        # Opening Debit / Credit: desimal >= 0; kosong = 0 (keputusan bisnis 2026-10-26).
        debit = kredit = NOL
        for key, label in (("debit", "Opening Debit"), ("credit", "Opening Credit")):
            if kosong(nilai.get(key)):
                continue
            n = _angka(nilai.get(key))
            if n is None:
                err(f"{label} must be a number.")
            elif n < 0:
                err(f"{label} must be 0 or more.")
            elif key == "debit":
                debit = n
            else:
                kredit = n
        if debit > 0 and kredit > 0:
            err("Fill either Opening Debit or Opening Credit, not both.")
        bersaldo = debit > 0 or kredit > 0

        # Mapping ke akun ZAFEB: kode / standard code / nama harus menunjuk akun yang sama.
        # Kode ZAFEB yang BELUM ada di COA klien = akun BARU (dibuat saat approve) -> _cek_akun_baru.
        dipilih: Optional[Any] = None
        akun_baru: Optional[Dict[str, Any]] = None
        cocok: List[Tuple[str, Optional[Any]]] = []
        mapping_gagal = False
        # Standard code yang diketik di kolom Suggested ZAFEB Account Code -> dipindah ke
        # Standard Account Code (jangan jadi akun baru berkode "std_...").
        if (d.get("zafeb_code") and d["zafeb_code"].lower() not in per_kode
                and d["zafeb_code"].lower() in katalog):
            d["standard_code"] = d.get("standard_code") or d["zafeb_code"]
            d["zafeb_code"] = ""
        # Standard code yang belum punya akun di COA klien -> akun BARU dengan kode otomatis
        # (6 digit per klasifikasi, _kode_otomatis).
        std = (d.get("standard_code") or "").lower()
        if not d.get("zafeb_code") and std and std not in per_std and std in katalog:
            pool = semua_kode_zafeb | set(kode_baru_dipakai)
            d["zafeb_code"] = (_kode_otomatis(katalog[std].get("account_classification") or "", "", pool)
                               or _kode_unik(katalog[std]["standard_account_code"], pool))
        if d.get("zafeb_code"):
            a = per_kode.get(d["zafeb_code"].lower())
            if a is None:
                akun_baru = _cek_akun_baru(d, no_baris, bersaldo, katalog, per_nama, kode_baru_dipakai,
                                           nama_baru_dipakai, semua_kode_zafeb, awal_tahun, err, warn,
                                           lambda: any(p["level"] == "error" for p in pesan))
                d["zafeb_code"], d["zafeb_name"] = akun_baru["acc_no"], akun_baru["account_name"]
            else:
                cocok.append(("code", a))
        for key, label in (("standard_code", "Standard account code"), ("zafeb_name", "ZAFEB account name")):
            # Akun baru: standard code & nama sudah dicek di _cek_akun_baru (boleh sama dgn akun lain).
            if akun_baru is not None or not d.get(key):
                continue
            kand = (per_std if key == "standard_code" else per_nama).get(d[key].lower(), [])
            if not kand and any(a is not None for _, a in cocok):
                continue  # kode ZAFEB sudah menunjuk akun -> kolom lain yang tidak dikenal diabaikan
            if not kand:
                mapping_gagal = True
                err(f'{label} "{d[key]}" is not in this client\'s COA.')
                cocok.append((key, None))
            elif len(kand) == 1:
                cocok.append((key, kand[0]))
            elif d.get("zafeb_code"):
                # Tidak unik (mis. beberapa akun bank 1 standard code) -> cukup cocok dgn kode yang dipilih.
                cocok.append((key, pilih_per_kode(kand, d["zafeb_code"]) or kand[0]))
            else:
                # Beberapa akun 1 standard code / nama -> akun pertama yang belum dipakai baris lain
                # (semua sudah dipakai -> akun pertama, lalu dibuat akun baru unik di bawah).
                cocok.append((key, next((x for x in kand if x.id not in akun_dipakai), kand[0])))
        ketemu = {a.id: a for _, a in cocok if a is not None}
        if len(ketemu) > 1:
            err("Mapping columns point to different ZAFEB accounts — clear them and pick one again.")
        elif ketemu and not mapping_gagal:
            dipilih = next(iter(ketemu.values()))

        # Saldo akun kontrol AR/AP/Inventory/Fixed Asset -> baris dibuang tanpa pesan (diimpor lewat modulnya).
        kontrol_baris = (modul_kontrol(dipilih) if dipilih is not None
                         else _std_kontrol(d.get("standard_code") or "") if akun_baru is not None else None)
        if bersaldo and kontrol_baris in KONTROL_DIBUANG:
            for catatan in (kode_dipakai, kode_baru_dipakai, nama_baru_dipakai):
                for k in [k for k, v in catatan.items() if v == no_baris]:
                    del catatan[k]
            continue

        # 1 akun ZAFEB = 1 baris. Baris berikutnya yang menunjuk akun yang sama (data terbaru)
        # -> akun BARU dengan kode +1 & nama unik, standard code ikut akun asal
        # (keputusan bisnis 2026-10-26: duplikat dibuat unik, bukan error).
        if dipilih is not None and dipilih.id in akun_dipakai:
            asal, baris_asal = dipilih, akun_dipakai[dipilih.id]
            d = {**d, "zafeb_code": _kode_unik(str(asal.acc_no).strip(), semua_kode_zafeb | set(kode_baru_dipakai)),
                 "zafeb_name": d.get("source_name") or asal.account_name,
                 "standard_code": asal.standard_account_code or "", "source_classification": ""}
            warn(f"ZAFEB account {dbc.kode_tampil_akun(asal)} {asal.account_name} is already used on row {baris_asal} "
                 f"— this row becomes new account {d['zafeb_code']} to keep it unique.")
            dipilih = None
            akun_baru = _cek_akun_baru(d, no_baris, bersaldo, katalog, per_nama, kode_baru_dipakai,
                                       nama_baru_dipakai, semua_kode_zafeb, awal_tahun, err, warn,
                                       lambda: any(p["level"] == "error" for p in pesan))
            d.update(zafeb_code=akun_baru["acc_no"], zafeb_name=akun_baru["account_name"],
                     source_classification=akun_baru["account_classification"] or "")

        if not cocok and akun_baru is None:
            warn("Unmapped — this balance will not be applied to the opening balance." if bersaldo
                 else "Unmapped — no ZAFEB account selected.")
        if dipilih is not None:
            kls = (dipilih.account_classification or "").upper()
            # 1 akun ZAFEB = 1 baris (baris saldo awal unik per akun & nama akun diambil dari baris ini).
            akun_dipakai[dipilih.id] = no_baris
            # Aturan akun berlaku untuk baris bersaldo saja (template memuat semua akun, termasuk akun kontrol).
            if bersaldo:
                if not dipilih.is_active:
                    err(f"ZAFEB account {dipilih.acc_no} {dipilih.account_name} is inactive.")
                kontrol = modul_kontrol(dipilih)
                if kontrol:
                    err(f"{dipilih.acc_no} {dipilih.account_name} is a control account — import its balance through "
                        f"\"{MODUL[kontrol]}\" instead.")
                if (dipilih.standard_account_code or "").strip().lower() == STANDARD_CODE_LABA_BERJALAN:
                    err("Current Year Earnings is calculated automatically — map this balance to another account.")
                if awal_tahun and kls not in KLASIFIKASI_NERACA:
                    err("Start-of-year cut-off accepts balance sheet accounts only (P&L belongs in Retained Earnings).")
            nama_baru = d.get("source_name") or ""
            if nama_baru and nama_baru != dipilih.account_name and str(dipilih.id) in kunci_mapping:
                err(f"{dipilih.acc_no} {dipilih.account_name} is locked by Account Mapping "
                    f"({', '.join(sorted(kunci_mapping[str(dipilih.id)]))}) — its name cannot change. Keep the current "
                    "name in Source Account Name or unlock it in Settings > Account Mapping.")
            if d.get("source_classification") and d["source_classification"].upper() != kls:
                warn(f"Source Classification {d['source_classification']} differs from the ZAFEB account ({kls}).")

        # Balance Date: tanggal, wajib, harus = tanggal cut-off set opening balance ini.
        tgl = None
        if kosong(nilai.get("balance_date")):
            err("Balance Date is required.")
        else:
            tgl = _tanggal(nilai.get("balance_date"))
            if tgl is None:
                err("Balance Date is not a valid date.")
            elif tgl != ob.as_of_date:
                err(f"Balance Date {tgl.strftime('%d-%b-%Y')} is outside the opening period — "
                    f"it must be the cut-off date {ob.as_of_date.strftime('%d-%b-%Y')}.")

        # Currency: selalu IDR, isi file diabaikan.
        mata_uang = MATA_UANG_OPENING

        if d.get("branch") and ob.branch and d["branch"].strip().lower() != ob.branch.strip().lower():
            warn(f'Branch "{d["branch"]}" differs from this opening balance set ({ob.branch}).')

        status = "error" if any(p["level"] == "error" for p in pesan) else "warning" if pesan else "valid"
        hasil.append({
            "row_no": no_baris,
            "coa_id": dipilih.id if dipilih is not None else None,
            "debit": debit if debit > 0 else NOL,
            "credit": kredit if kredit > 0 else NOL,
            "status": status,
            "messages": pesan,
            "data": {
                **{k: d.get(k) or None for k, _ in KOLOM_COA if k not in ("debit", "credit", "balance_date")},
                "balance_date": tgl.isoformat() if tgl else None,
                "currency": mata_uang or None,
                "mapping_status": "matched" if dipilih is not None else "new" if akun_baru is not None else "unmapped",
                "rename": bool(dipilih is not None and d.get("source_name") and d["source_name"] != dipilih.account_name),
                "zafeb_account": {
                    "acc_no": dipilih.acc_no, "account_name": dipilih.account_name,
                    "account_classification": dipilih.account_classification,
                    "standard_account_code": dipilih.standard_account_code,
                } if dipilih is not None else {
                    k: akun_baru.get(k) for k in ("acc_no", "account_name", "account_classification", "standard_account_code")
                } if akun_baru is not None else None,
                # Atribut akun yang dibuat di COA klien saat batch di-approve (_buat_akun_baru).
                "new_account": akun_baru,
                "code_change": bool(dipilih is not None and d.get("source_code")
                                    and d["source_code"] != dbc.kode_tampil_akun(dipilih)),
            },
        })
    _isi_kode_otomatis(akun, hasil)
    _cek_kode_tampil(akun, hasil)
    return hasil


def _kode_otomatis(kls: str, preferensi: str, dipakai: set) -> Optional[str]:
    """Kode akun 6 digit format standar (digit depan = klasifikasi, DIGIT_KLASIFIKASI)
    yang belum dipakai. `preferensi` (kode ZAFEB akunnya) dipakai apa adanya kalau
    sudah format standar & masih bebas; selain itu nomor berikut di grup 2 digit
    yang sama (mis. 21xxxx), lalu grup lain klasifikasi itu."""
    digit = DIGIT_KLASIFIKASI.get((kls or "").upper())
    if not digit:
        return None
    standar = bool(re.fullmatch(r"\d{6}", preferensi or "")) and preferensi[0] == digit
    if standar and preferensi.lower() not in dipakai:
        return preferensi
    grup = [preferensi[:2]] if standar else []
    grup += [digit + str(i) for i in range(1, 10) if digit + str(i) not in grup]
    for g in grup:
        nomor = [int(k[2:]) for k in dipakai if re.fullmatch(r"\d{6}", k) and k.startswith(g)]
        n = max(nomor, default=0) + 1
        while n <= 9999 and f"{g}{n:04d}" in dipakai:
            n += 1
        if n <= 9999:
            return f"{g}{n:04d}"
    return None


def _isi_kode_otomatis(akun: List[Any], hasil: List[Dict[str, Any]]) -> None:
    """Baris tanpa Source Account Code -> kode dibuat otomatis (_kode_otomatis),
    unik terhadap kode tampilan & acc_no semua akun klien dan kode lain di file.
    Kode tampilan akun yang ikut di-mapping di file boleh dipakai ulang oleh baris
    akun itu sendiri (tidak berubah)."""
    kosong = [h for h in hasil if not h["data"].get("source_code")]
    if not kosong:
        return
    per_id = {a.id: a for a in akun}
    dipakai = {str(a.acc_no or "").strip().lower() for a in akun}
    dipakai |= {dbc.kode_tampil_akun(a).lower() for a in akun}
    dipakai |= {h["data"]["source_code"].lower() for h in hasil if h["data"].get("source_code")}
    for h in kosong:
        data = h["data"]
        a = per_id.get(h["coa_id"]) if h["coa_id"] else None
        baru = data.get("new_account")
        if a is not None:
            kls, pref = a.account_classification, str(a.acc_no or "").strip()
            sendiri = {pref.lower(), dbc.kode_tampil_akun(a).lower()}
        else:
            kls = (baru or {}).get("account_classification") or data.get("source_classification")
            pref = (baru or {}).get("acc_no") or ""
            sendiri = set()
        kode = _kode_otomatis(kls, pref, dipakai - sendiri)
        if not kode:
            continue
        dipakai.add(kode.lower())
        data["source_code"], data["source_code_generated"] = kode, True
        if baru is not None:
            baru["source_acc_no"] = kode
        if a is not None:
            data["code_change"] = kode != dbc.kode_tampil_akun(a)


def _cek_kode_tampil(akun: List[Any], hasil: List[Dict[str, Any]]) -> None:
    """Setelah approve, Source Account Code menjadi kode akun yang DITAMPILKAN
    (management_client_coa.source_acc_no, migration 50) -> kode tampilan harus
    unik per klien. Akun yang tidak ada di file tetap memakai kode tampilannya
    sekarang. Bentrok dengan akun itu / baris di atasnya -> kode baris ini dibuat
    unik (+1, _kode_unik) + warning (keputusan bisnis 2026-10-26)."""
    dipakai = [h for h in hasil if h["status"] != "error" and h["data"].get("source_code")
               and (h["coa_id"] or h["data"].get("new_account"))]
    dipetakan = {h["coa_id"] for h in dipakai if h["coa_id"]}
    per_id = {a.id: a for a in akun}
    pemilik: Dict[str, str] = {}
    for a in akun:
        if a.id not in dipetakan:
            pemilik.setdefault(dbc.kode_tampil_akun(a).lower(), f"{a.account_name} (not in this file)")
    semua = set(pemilik) | {str(a.acc_no or "").strip().lower() for a in akun}
    semua |= {dbc.kode_tampil_akun(a).lower() for a in akun}
    semua |= {h["data"]["source_code"].lower() for h in hasil if h["data"].get("source_code")}
    for h in dipakai:
        data = h["data"]
        kode = data["source_code"]
        if kode.lower() in pemilik:
            baru = _kode_unik(kode, semua)
            semua.add(baru.lower())
            h["messages"].append({"level": "warning", "message": (
                f"Source Account Code {kode} becomes the account code shown in the system, but it is already used by "
                f"{pemilik[kode.lower()]} — changed to {baru} to keep it unique.")})
            if h["status"] == "valid":
                h["status"] = "warning"
            data["source_code"] = kode = baru
            if data.get("new_account"):
                data["new_account"]["source_acc_no"] = baru
            if h["coa_id"] in per_id:
                data["code_change"] = baru != dbc.kode_tampil_akun(per_id[h["coa_id"]])
        pemilik[kode.lower()] = f"row {h['row_no']}"


# ============================================================
# MODUL ASSET REGISTER
# ============================================================

KOLOM_ASET: List[Tuple[str, str]] = [
    ("asset_code", "Asset Code"),
    ("asset_name", "Asset Name"),
    ("category", "Asset Category"),
    ("acquisition_date", "Acquisition Date"),
    ("cost", "Original Cost"),
    ("residual", "Residual Value"),
    ("life_years", "Useful Life (Years)"),
    ("method", "Depreciation Method"),
    ("dep_start", "Depreciation Start Date"),
    ("accum", "Accumulated Depreciation"),
    ("nbv", "Net Book Value"),
    ("remaining", "Remaining Life (Months)"),
    ("asset_account", "Asset Account"),
    ("accum_account", "Accum. Dep. Account"),
    ("expense_account", "Depreciation Expense Account"),
    ("location", "Location"),
    ("department", "Department"),
    ("custodian", "Custodian"),
    ("tax_group", "Tax Depreciation Group"),
    ("notes", "Notes"),
]
KOLOM_WAJIB_ASET = ("asset_code", "asset_name", "category", "acquisition_date", "cost", "accum")
SHEET_TEMPLATE_ASET = "ASSET_REGISTER"
SHEET_REFERENSI_ASET = "ZAFEB_FA"
_LEBAR_ASET = [14, 30, 22, 15, 16, 14, 12, 20, 16, 18, 16, 14, 16, 18, 20, 16, 16, 16, 16, 30, 4, 22, 18]
METODE_LABEL = {"straight_line": "Straight Line", "declining_balance": "Declining Balance", "none": "None"}
KLASIFIKASI_BEBAN = ("EXPENSE", "COST OF SALES", "OTHER EXPENSE")


def _metode(v: Any) -> Optional[str]:
    """Teks metode penyusutan -> kode (None kalau tidak dikenali, "" kalau kosong)."""
    t = re.sub(r"[^a-z]", "", _teks(v).lower())
    if not t:
        return ""
    if t in ("straightline", "sl", "garislurus"):
        return "straight_line"
    if t in ("decliningbalance", "doubledecliningbalance", "ddb", "db", "saldomenurun"):
        return "declining_balance"
    if t in ("none", "nodepreciation", "tidakdisusutkan"):
        return "none"
    return None


def _metode_kategori(c: Any) -> str:
    return c.depreciation_method if c.is_depreciable else "none"


def buat_template_aset(nama_klien: str, akun: List[Any], kategori: List[Tuple[Any, Dict[str, Optional[str]]]], ob: Any) -> bytes:
    """Template Asset Register (pola dataset/COA/05_Template_Import_Fixed_Asset_Register.xlsx):
    pilih Asset Category -> umur, metode, residu & 3 akun terisi dari kategori."""
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_TEMPLATE_ASET
    font = Font(name=_FONT, size=11)
    akhir = BARIS_DATA_AWAL + JUMLAH_BARIS_TEMPLATE - 1
    n_kolom = len(KOLOM_ASET)
    kode_akun = {a.id: str(a.acc_no) for a in akun}
    cut = ob.as_of_date

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_kolom)
    c = ws.cell(1, 1, f"ZAFEB – IMPORT FIXED ASSET REGISTER · {nama_klien} · FY {ob.fiscal_year}")
    c.font, c.fill = Font(name=_FONT, size=14, bold=True, color="FFFFFFFF"), _FILL_JUDUL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_kolom)
    c = ws.cell(2, 1, (
        "Import the legacy fixed asset register — one row per asset. Pick the Asset Category from the dropdown: useful "
        "life, depreciation method, residual value and the Asset / Accum. Dep. / Depreciation Expense accounts fill in "
        "from the category (you may override them per asset). "
        f"Required: Asset Code (unique), Asset Name, Asset Category, Acquisition Date (on or before the cut-off date "
        f"{cut.strftime('%d-%b-%Y')}), Original Cost (> 0) and Accumulated Depreciation up to the cut-off date (0 to "
        "Original Cost − Residual Value). Net Book Value and Remaining Life are calculated. After approval the assets "
        "are created in the Fixed Asset register and the opening balances of the asset and accumulated depreciation "
        "accounts are recalculated from the register."
    ))
    c.font, c.fill = Font(name=_FONT, size=11, color="FF475569"), _FILL_KET
    c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.row_dimensions[2].height = 80

    for i, (_, judul) in enumerate(KOLOM_ASET, 1):
        c = ws.cell(BARIS_HEADER, i, judul)
        c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[BARIS_HEADER].height = 32

    tgl_cut = f"DATE({cut.year},{cut.month},{cut.day})"
    rata_atas = Alignment(vertical="top", wrap_text=True)
    for r in range(BARIS_DATA_AWAL, akhir + 1):
        for i in range(1, n_kolom + 1):
            c = ws.cell(r, i)
            c.font, c.alignment = font, rata_atas

        def dari_kategori(rng: str) -> str:
            return f'=IFERROR(INDEX({rng},MATCH(C{r},ZFA_CAT,0))&"","")'

        isi = {
            "F": f'=IF(OR(C{r}="",E{r}=""),"",ROUND(E{r}*IFERROR(INDEX(ZFA_CAT_RATE,MATCH(C{r},ZFA_CAT,0)),0)/100,0))',
            "G": f'=IF(C{r}="","",IFERROR(INDEX(ZFA_CAT_LIFE,MATCH(C{r},ZFA_CAT,0)),""))',
            "H": dari_kategori("ZFA_CAT_METHOD"),
            "I": f'=IF(D{r}="","",D{r})',
            "K": f'=IF(E{r}="","",E{r}-N(J{r}))',
            "L": (f'=IF(OR(N(G{r})=0,I{r}=""),"",MAX(ROUND(G{r}*12,0)-MAX((YEAR({tgl_cut})-YEAR(I{r}))*12'
                  f'+MONTH({tgl_cut})-MONTH(I{r})+1,0),0))'),
            "M": dari_kategori("ZFA_CAT_ASSET"),
            "N": dari_kategori("ZFA_CAT_ACCUM"),
            "O": dari_kategori("ZFA_CAT_EXP"),
        }
        for kol, rumus in isi.items():
            ws[f"{kol}{r}"].value = rumus
            ws[f"{kol}{r}"].fill = _FILL_LINK
        for kol in ("E", "F", "J", "K"):
            ws[f"{kol}{r}"].number_format = _FMT_ANGKA
        for kol in ("D", "I"):
            ws[f"{kol}{r}"].number_format = _FMT_TANGGAL

    ringkas = [
        ("CONTROL SUMMARY", None),
        ("Total Assets", f'=COUNTA(A{BARIS_DATA_AWAL}:A{akhir})'),
        ("Original Cost", f"=SUM(E{BARIS_DATA_AWAL}:E{akhir})"),
        ("Accumulated Dep.", f"=SUM(J{BARIS_DATA_AWAL}:J{akhir})"),
        ("Net Book Value", f"=SUM(K{BARIS_DATA_AWAL}:K{akhir})"),
    ]
    for j, (label, rumus) in enumerate(ringkas):
        r = BARIS_HEADER + j
        c = ws.cell(r, n_kolom + 2, label)
        if j == 0:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
            ws.cell(r, n_kolom + 3).fill = _FILL_HEADER
        else:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FF134E4A"), _FILL_RINGKAS
            q = ws.cell(r, n_kolom + 3, rumus)
            q.font = Font(name=_FONT, size=11, color="FF008000")
            q.number_format = _FMT_ANGKA
    for i, lebar in enumerate(_LEBAR_ASET, 1):
        ws.column_dimensions[get_column_letter(i)].width = lebar
    ws.freeze_panes = f"C{BARIS_DATA_AWAL}"

    # Sheet referensi (tersembunyi): kategori + daftar akun untuk dropdown.
    ref = wb.create_sheet(SHEET_REFERENSI_ASET)
    ref.append(["Category", "Asset Account", "Accum. Dep. Account", "Depreciation Expense Account", "Method",
                "Useful Life (Years)", "Residual %", "", "Asset-type Accounts", "Name", "", "Expense Accounts", "Name",
                "", "Methods"])
    for i, (c, akun_kat) in enumerate(kategori, 2):
        umur = round(c.useful_life_months / 12, 2) if c.useful_life_months and c.is_depreciable else None
        nilai = [c.name, kode_akun.get(akun_kat["asset"], ""), kode_akun.get(akun_kat["accum"], ""),
                 kode_akun.get(akun_kat["expense"], ""), METODE_LABEL.get(_metode_kategori(c), ""), umur,
                 float(c.residual_rate or 0)]
        for j, v in enumerate(nilai, 1):
            ref.cell(i, j, v)
    aktif = [a for a in akun if a.is_active]
    akun_aset = [a for a in aktif if (a.account_classification or "").upper() == "ASSET"]
    akun_beban = [a for a in aktif if (a.account_classification or "").upper() in KLASIFIKASI_BEBAN]
    for i, a in enumerate(akun_aset, 2):
        ref.cell(i, 9, str(a.acc_no)); ref.cell(i, 10, a.account_name)
    for i, a in enumerate(akun_beban, 2):
        ref.cell(i, 12, str(a.acc_no)); ref.cell(i, 13, a.account_name)
    for i, m in enumerate(METODE_LABEL.values(), 2):
        ref.cell(i, 15, m)
    for i, lebar in enumerate([24, 16, 18, 22, 18, 12, 10, 2, 16, 36, 2, 16, 36, 2, 18], 1):
        ref.column_dimensions[get_column_letter(i)].width = lebar
    ref.sheet_state = "hidden"

    n_kat = max(len(kategori), 1) + 1
    nama_range = {
        "ZFA_CAT": f"$A$2:$A${n_kat}", "ZFA_CAT_ASSET": f"$B$2:$B${n_kat}", "ZFA_CAT_ACCUM": f"$C$2:$C${n_kat}",
        "ZFA_CAT_EXP": f"$D$2:$D${n_kat}", "ZFA_CAT_METHOD": f"$E$2:$E${n_kat}", "ZFA_CAT_LIFE": f"$F$2:$F${n_kat}",
        "ZFA_CAT_RATE": f"$G$2:$G${n_kat}",
        "ZFA_ACC_ASSET": f"$I$2:$I${max(len(akun_aset), 1) + 1}",
        "ZFA_ACC_EXP": f"$L$2:$L${max(len(akun_beban), 1) + 1}",
        "ZFA_METHOD": f"$O$2:$O${len(METODE_LABEL) + 1}",
    }
    for nama, rng in nama_range.items():
        wb.defined_names[nama] = DefinedName(nama, attr_text=f"'{SHEET_REFERENSI_ASET}'!{rng}")

    def dropdown(rumus: str, kolom: str, judul: str):
        dv = DataValidation(type="list", formula1=rumus, allow_blank=True, showErrorMessage=True, errorStyle="stop",
                            errorTitle="Invalid value", error=f"Pick a {judul} from the list.")
        dv.add(f"{kolom}{BARIS_DATA_AWAL}:{kolom}{akhir}")
        ws.add_data_validation(dv)

    dropdown("ZFA_CAT", "C", "category")
    dropdown("ZFA_METHOD", "H", "depreciation method")
    dropdown("ZFA_ACC_ASSET", "M", "asset account")
    dropdown("ZFA_ACC_ASSET", "N", "accumulated depreciation account")
    dropdown("ZFA_ACC_EXP", "O", "depreciation expense account")
    _tambah_cara_penggunaan(wb, _panduan_aset(nama_klien, ob))

    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _akun_dict(a: Any) -> Optional[Dict[str, Any]]:
    return {"id": a.id, "acc_no": a.acc_no, "account_name": a.account_name} if a is not None else None


def _validasi_aset(session, ob: Any, header: List[str], data: List[Tuple[int, List[Any]]]) -> List[Dict[str, Any]]:
    posisi: Dict[str, int] = {}
    norm = [_norm_header(h) for h in header]
    for key, judul in KOLOM_ASET:
        if _norm_header(judul) in norm:
            posisi[key] = norm.index(_norm_header(judul))
    hilang = [judul for key, judul in KOLOM_ASET if key in KOLOM_WAJIB_ASET and key not in posisi]
    if hilang:
        raise _Gagal(f"Missing required column(s): {', '.join(hilang)}. Use the downloaded template.", kode="MISSING_COLUMNS")

    FA = dbc.FixedAsset
    mapping = dbc.akun_mapping_setting(ob.client_id, session=session)
    kategori = {c.name.strip().upper(): (c, _akun_kategori(c, mapping)) for c in _kategori_aset(session, ob.client_id)}
    akun = _akun_klien(session, ob.client_id)
    per_kode = {str(a.acc_no).strip().lower(): a for a in akun}
    per_id = {a.id: a for a in akun}
    kode_register = {
        (k or "").strip().upper() for (k,) in session.query(FA.asset_code).filter(FA.client_id == ob.client_id, FA.deleted_at.is_(None)).all()
    }
    cut = ob.as_of_date

    hasil, kode_dipakai = [], {}
    for no_baris, r in data:
        nilai = {k: (r[p] if p < len(r) else None) for k, p in posisi.items()}
        d = {k: _teks(v) for k, v in nilai.items()}
        # Baris template kosong (cuma hasil formula) -> lewati.
        if not any(d.get(k) for k in ("asset_code", "asset_name", "category", "cost")):
            continue
        pesan: List[Dict[str, str]] = []

        def err(m): pesan.append({"level": "error", "message": m})
        def warn(m): pesan.append({"level": "warning", "message": m})

        kode = (d.get("asset_code") or "").upper()
        if not kode:
            err("Asset Code is required.")
        elif len(kode) > 50:
            err("Asset Code is longer than 50 characters.")
        elif kode in kode_dipakai:
            err(f"Duplicate Asset Code (also on row {kode_dipakai[kode]}).")
        elif kode in kode_register:
            err(f"Asset Code {kode} already exists in the Fixed Asset register.")
        if kode and kode not in kode_dipakai:
            kode_dipakai[kode] = no_baris
        if not d.get("asset_name"):
            err("Asset Name is required.")
        elif len(d["asset_name"]) > 255:
            err("Asset Name is longer than 255 characters.")

        kat, akun_kat = kategori.get((d.get("category") or "").upper(), (None, {}))
        if not d.get("category"):
            err("Asset Category is required.")
        elif kat is None:
            err(f'Asset Category "{d["category"]}" does not exist — add it in Fixed Assets > Categories.')
        metode_kat = _metode_kategori(kat) if kat is not None else None

        def tanggal(key: str, label: str, wajib: bool) -> Optional[date]:
            if not d.get(key):
                if wajib:
                    err(f"{label} is required.")
                return None
            t = _tanggal(nilai.get(key))
            if t is None:
                err(f"{label} is not a valid date.")
            return t

        def angka(key: str, label: str, wajib: bool) -> Optional[Decimal]:
            if not d.get(key):
                if wajib:
                    err(f"{label} is required" + (" (enter 0 if none)." if key == "accum" else "."))
                return None
            n = _angka(nilai.get(key))
            if n is None:
                err(f"{label} must be a number.")
            elif n < 0:
                err(f"{label} must be 0 or more.")
                return None
            return n

        tgl_oleh = tanggal("acquisition_date", "Acquisition Date", True)
        if tgl_oleh and tgl_oleh > cut:
            err(f"Acquisition Date is after the cut-off date {cut.strftime('%d-%b-%Y')} — add this asset in Fixed Assets instead.")
        mulai = tanggal("dep_start", "Depreciation Start Date", False) or tgl_oleh
        if mulai and tgl_oleh and mulai < tgl_oleh:
            err("Depreciation Start Date cannot be before the Acquisition Date.")

        biaya = angka("cost", "Original Cost", True)
        if biaya is not None and biaya == 0:
            err("Original Cost must be greater than 0.")
        akum = angka("accum", "Accumulated Depreciation", True)

        metode = _metode(nilai.get("method"))
        if metode is None:
            err(f'Depreciation Method "{d["method"]}" is not valid (use Straight Line, Declining Balance or None).')
        metode = metode or metode_kat
        disusutkan = metode in ("straight_line", "declining_balance")

        umur_bulan = None
        if d.get("life_years"):
            th = _angka(nilai.get("life_years"))
            if th is None or th <= 0:
                err("Useful Life (Years) must be a number greater than 0.")
            else:
                umur_bulan = int((th * 12).to_integral_value())
        elif kat is not None and kat.useful_life_months:
            umur_bulan = kat.useful_life_months
        if disusutkan and not umur_bulan:
            err("Useful Life (Years) is required for a depreciable asset.")

        residu = angka("residual", "Residual Value", False)
        if residu is None and biaya is not None and kat is not None:
            residu = (biaya * _dec_aman(kat.residual_rate) / 100).quantize(SEN) if disusutkan else NOL
        residu = residu or NOL
        if biaya is not None and biaya > 0:
            if disusutkan and residu >= biaya:
                err("Residual Value must be lower than the Original Cost.")
            if akum is not None and akum > biaya - residu:
                err("Accumulated Depreciation cannot exceed Original Cost − Residual Value.")
        if akum and not disusutkan and kat is not None:
            err("This asset is not depreciated (category/method None) — Accumulated Depreciation must be 0.")
        if akum and mulai and mulai > cut:
            err("Accumulated Depreciation must be 0 when depreciation starts after the cut-off date.")

        # Akun: isi file (boleh override) atau default kategori.
        def pilih_akun(key: str, jenis: str, label: str, wajib: bool) -> Optional[Any]:
            a = None
            if d.get(key):
                a = per_kode.get(d[key].lower())
                if a is None:
                    err(f'{label} "{d[key]}" is not in this client\'s COA.')
                    return None
            elif akun_kat.get(jenis):
                a = per_id.get(akun_kat[jenis])
            if a is None:
                if wajib:
                    err(f"{label} is required.")
                return None
            if not a.is_active:
                err(f"{label} {a.acc_no} {a.account_name} is inactive.")
            default = per_id.get(akun_kat.get(jenis))
            if default is not None and a.id != default.id:
                warn(f"{label} {a.acc_no} differs from the category default ({default.acc_no}).")
            return a

        a_aset = pilih_akun("asset_account", "asset", "Asset Account", True)
        a_akum = pilih_akun("accum_account", "accum", "Accum. Dep. Account", disusutkan)
        a_beban = pilih_akun("expense_account", "expense", "Depreciation Expense Account", disusutkan)
        if a_aset is not None and (a_aset.account_classification or "").upper() != "ASSET":
            err(f"Asset Account {a_aset.acc_no} must be an asset account.")
        if a_akum is not None:
            if (a_akum.account_classification or "").upper() != "ASSET":
                err(f"Accum. Dep. Account {a_akum.acc_no} must be a contra-asset account.")
            if a_aset is not None and a_akum.id == a_aset.id:
                err("Accum. Dep. Account must be different from the Asset Account.")
        if a_beban is not None and (a_beban.account_classification or "").upper() not in KLASIFIKASI_BEBAN:
            err(f"Depreciation Expense Account {a_beban.acc_no} must be an expense account.")

        status = "error" if any(p["level"] == "error" for p in pesan) else "warning" if pesan else "valid"
        hasil.append({
            "row_no": no_baris,
            "coa_id": a_aset.id if a_aset is not None else None,
            "debit": biaya if biaya is not None else NOL,
            "credit": akum if akum is not None else NOL,
            "status": status,
            "messages": pesan,
            "data": {
                "asset_code": kode or None, "asset_name": d.get("asset_name") or None,
                "category": kat.name if kat is not None else (d.get("category") or None),
                "category_id": kat.id if kat is not None else None,
                "acquisition_date": tgl_oleh.isoformat() if tgl_oleh else None,
                "dep_start": mulai.isoformat() if mulai else None,
                "cost": float(biaya) if biaya is not None else None,
                "residual": float(residu),
                "accum": float(akum) if akum is not None else None,
                "nbv": float(biaya - (akum or NOL)) if biaya is not None else None,
                "life_months": umur_bulan, "method": metode,
                "asset_account": _akun_dict(a_aset), "accum_account": _akun_dict(a_akum),
                "expense_account": _akun_dict(a_beban),
                **{k: d.get(k) or None for k in ("location", "department", "custodian", "tax_group", "notes")},
            },
        })
    return hasil


def _wajib_ob_draft(session, b: Any) -> Any:
    ob = session.get(OB, b.opening_balance_id)
    if ob is None or ob.deleted_at is not None:
        raise _Gagal("Opening balance not found.", kode="NOT_FOUND", status_code=404)
    if ob.status != "draft":
        raise _Gagal("Opening balance is not in draft — click Revise first, then approve this batch.",
                     kode=f"STATUS_{ob.status.upper()}", status_code=409)
    return ob


def _terapkan_aset(session, b: Any, user: Dict[str, Any]) -> str:
    """Batch asset yang di-approve -> aset dibuat di register Fixed Assets, lalu saldo
    awal akun aset tetap & akumulasi penyusutan dihitung ulang dari register."""
    FA, CAT = dbc.FixedAsset, dbc.FixedAssetCategory
    OBL = dbc.ManagementClientCoaOpeningBalanceLine
    ob = _wajib_ob_draft(session, b)
    kid = ob.client_id
    # Kunci yang sama dengan modul Fixed Assets supaya tidak bentrok dengan input/penyusutan paralel.
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"fixed-asset:{kid}"})

    rows = _baris_terpilih(session, b)
    if any(r.status == "error" for r in rows):
        raise _Gagal("The batch has rows with errors.", kode="HAS_ERRORS")
    kategori = {c.id: c for c in session.query(CAT).filter(CAT.client_id == kid, CAT.deleted_at.is_(None)).all()}
    ada = {(k or "").upper() for (k,) in session.query(FA.asset_code).filter(FA.client_id == kid, FA.deleted_at.is_(None)).all()}
    bentrok = [r.data["asset_code"] for r in rows if (r.data.get("asset_code") or "").upper() in ada]
    if bentrok:
        raise _Gagal(f"Asset code(s) already in the Fixed Asset register: {', '.join(bentrok[:10])}. Reject the batch "
                     "and upload it again.", kode="CONFLICT", status_code=409)

    sekarang, uid = datetime.now(), user.get("id")
    for r in rows:
        x = r.data
        kat = kategori.get(x.get("category_id"))
        if kat is None:
            raise _Gagal(f"Asset category \"{x.get('category')}\" (row {r.row_no}) no longer exists. Reject the batch and "
                         "upload it again.", kode="CATEGORY_NOT_FOUND", status_code=409)

        def override(jenis: str, kolom: str) -> Optional[str]:
            # Simpan di aset hanya kalau beda dari akun kategori (perubahan kategori tetap berlaku).
            a = x.get(jenis) or {}
            return a.get("id") if a.get("id") and a.get("id") != getattr(kat, kolom) else None

        keterangan = " · ".join(t for t in (
            f"Tax depreciation group: {x['tax_group']}" if x.get("tax_group") else None, x.get("notes")) if t)
        session.add(FA(
            client_id=kid, asset_code=x["asset_code"], name=x["asset_name"], category_id=kat.id, category=kat.name,
            description=keterangan or None, location=x.get("location"), department=x.get("department"),
            custodian=x.get("custodian"), branch=ob.branch, reference=f"Opening balance import: {b.file_name}"[:100],
            purchase_date=date.fromisoformat(x["acquisition_date"]),
            depreciation_start_date=date.fromisoformat(x["dep_start"]),
            cost=Decimal(str(x["cost"])), residual_value=Decimal(str(x["residual"])),
            opening_accumulated_depreciation=Decimal(str(x["accum"] or 0)),
            useful_life_months=x.get("life_months"),
            useful_life_years=(x["life_months"] // 12) if x.get("life_months") else None,
            depreciation_method=x.get("method") if x.get("method") != _metode_kategori(kat) else None,
            coa_id=override("asset_account", "asset_coa_id"), accum_coa_id=override("accum_account", "accum_coa_id"),
            expense_coa_id=override("expense_account", "expense_coa_id"),
            status="active", created_by=uid, created_by_name=_nama_user(user),
        ))
    session.flush()

    # Saldo awal akun aset tetap & akumulasi = posisi register per cut-off (aset yang diperoleh
    # <= cut-off & tidak punya jurnal perolehan sendiri).
    mapping = dbc.akun_mapping_setting(kid, session=session)
    akun_kat = {c.id: _akun_kategori(c, mapping) for c in kategori.values()}
    akun_fa = {a for v in akun_kat.values() for a in (v["asset"], v["accum"]) if a}
    saldo: Dict[str, Decimal] = {}
    for a in session.query(FA).filter(FA.client_id == kid, FA.deleted_at.is_(None)).all():
        akun_aset = a.coa_id or akun_kat.get(a.category_id, {}).get("asset")
        akun_akum = a.accum_coa_id or akun_kat.get(a.category_id, {}).get("accum")
        akun_fa.update(x for x in (akun_aset, akun_akum) if x)
        if a.acquisition_journal_id or not a.purchase_date or a.purchase_date > ob.as_of_date:
            continue
        if akun_aset:
            saldo[akun_aset] = saldo.get(akun_aset, NOL) + _dec_aman(a.cost)
        if akun_akum and _dec_aman(a.opening_accumulated_depreciation):
            saldo[akun_akum] = saldo.get(akun_akum, NOL) - _dec_aman(a.opening_accumulated_depreciation)
    session.query(OBL).filter(OBL.opening_balance_id == ob.id, OBL.coa_id.in_(akun_fa or {""})).delete(synchronize_session=False)
    for coa_id, n in saldo.items():
        if n != 0:
            session.add(OBL(opening_balance_id=ob.id, coa_id=coa_id, debit=n if n > 0 else NOL, credit=-n if n < 0 else NOL,
                            notes="From the Fixed Asset register (opening balance import).", created_by=uid))
    ob.edited_at, ob.edited_by = sekarang, uid
    session.flush()
    return (f"Applied: {len(rows)} asset(s) added to the Fixed Asset register; opening balances of "
            f"{sum(1 for n in saldo.values() if n != 0)} fixed asset / accumulated depreciation account(s) recalculated "
            "from the register.")


# ============================================================
# MODUL OPENING AR / OPENING AP
# ============================================================

@dataclass(frozen=True)
class SisiDok:
    modul: str            # ar / ap
    sheet: str
    judul: str
    pihak: str            # Customer / Vendor
    dokumen: str          # Invoice / Bill
    kolom: Tuple[Tuple[str, str], ...]
    lebar: Tuple[int, ...]
    nama_file: str


SISI_AR = SisiDok(
    "ar", "OPENING_AR", "IMPORT OPENING ACCOUNTS RECEIVABLE (AR)", "Customer", "Invoice",
    (("party_code", "Customer Code"), ("party_name", "Customer Name"), ("tax_id", "Customer Tax ID"),
     ("doc_no", "Invoice Number"), ("doc_date", "Invoice Date"), ("due_date", "Due Date"),
     ("original", "Original Invoice Amount"), ("outstanding", "Outstanding Amount"), ("currency", "Currency"),
     ("account", "AR Control Account"), ("branch", "Branch"), ("department", "Department"), ("project", "Project"),
     ("salesperson", "Salesperson"), ("reference", "Reference"), ("notes", "Notes")),
    (16, 30, 22, 20, 14, 14, 20, 20, 10, 18, 14, 16, 16, 16, 16, 30, 4, 20, 18),
    "02_Template_Import_Opening_AR",
)
SISI_AP = SisiDok(
    "ap", "OPENING_AP", "IMPORT OPENING ACCOUNTS PAYABLE (AP)", "Vendor", "Bill",
    (("party_code", "Vendor Code"), ("party_name", "Vendor Name"), ("tax_id", "Vendor Tax ID"),
     ("doc_no", "Bill / Invoice Number"), ("doc_date", "Bill Date"), ("due_date", "Due Date"),
     ("original", "Original Bill Amount"), ("outstanding", "Outstanding Amount"), ("currency", "Currency"),
     ("account", "AP Control Account"), ("wht_type", "Withholding Tax Type"), ("wht_outstanding", "Withholding Outstanding"),
     ("branch", "Branch"), ("department", "Department"), ("project", "Project"), ("reference", "Reference"),
     ("notes", "Notes")),
    (16, 30, 22, 22, 14, 14, 20, 20, 10, 18, 18, 18, 14, 16, 16, 16, 30, 4, 20, 18),
    "03_Template_Import_Opening_AP",
)
SISI_DOK = {"ar": SISI_AR, "ap": SISI_AP}
KOLOM_WAJIB_DOK = ("party_name", "doc_no", "doc_date", "original", "outstanding", "account")
SHEET_REFERENSI_DOK = "ZAFEB_REF"


def _akun_kontrol(session, client_id: str, modul: str) -> List[Any]:
    """Akun kontrol aktif 1 modul subledger (dikenali lewat _penentu_kontrol)."""
    kontrol = _penentu_kontrol(session, client_id)
    return [a for a in _akun_klien(session, client_id) if kontrol(a) == modul]


def _akun_default_dok(session, client_id: str, modul: str) -> Optional[Any]:
    """Akun kontrol default dari Account Mapping (account_receivable / account_payable)."""
    key = {"ar": "account_receivable", "ap": "account_payable"}[modul]
    coa_id = (dbc.akun_mapping_setting(client_id, session=session).get(key) or {}).get("coa_id")
    return session.get(COA, coa_id) if coa_id else None


def _pihak_master(session, client_id: str, modul: str) -> List[Tuple[str, str, str]]:
    """(kode, nama, NPWP) customer master (AR) / vendor dari riwayat Purchase (AP)."""
    if modul == "ar":
        CU = dbc.ArCustomer
        return [(c.code, c.name, c.npwp or "") for c in session.query(CU).filter(
            CU.client_id == client_id, CU.deleted_at.is_(None)).order_by(CU.code).all()]
    PT = dbc.PurchaseTransaction
    hasil: Dict[str, Tuple[str, str, str]] = {}
    for kode, nama in session.query(PT.vendor_code, PT.vendor_name).filter(
        PT.management_client_id == client_id, PT.deleted_at.is_(None), PT.vendor_code.isnot(None),
    ).all():
        if kode and nama and kode.strip().upper() not in hasil:
            hasil[kode.strip().upper()] = (kode.strip(), nama.strip(), "")
    return sorted(hasil.values())


def _judul_template(ws, n_kolom: int, judul: str, keterangan: str) -> None:
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=n_kolom)
    c = ws.cell(1, 1, judul)
    c.font, c.fill = Font(name=_FONT, size=14, bold=True, color="FFFFFFFF"), _FILL_JUDUL
    c.alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 24
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=n_kolom)
    c = ws.cell(2, 1, keterangan)
    c.font, c.fill = Font(name=_FONT, size=11, color="FF475569"), _FILL_KET
    c.alignment = Alignment(vertical="top", wrap_text=True)
    ws.row_dimensions[2].height = 80


def _header_template(ws, kolom: Tuple[Tuple[str, str], ...]) -> None:
    for i, (_, judul) in enumerate(kolom, 1):
        c = ws.cell(BARIS_HEADER, i, judul)
        c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
        c.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[BARIS_HEADER].height = 32


def _ringkasan_template(ws, kolom_awal: int, ringkas: List[Tuple[str, Optional[str]]]) -> None:
    for j, (label, rumus) in enumerate(ringkas):
        r = BARIS_HEADER + j
        c = ws.cell(r, kolom_awal, label)
        if j == 0:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FFFFFFFF"), _FILL_HEADER
            ws.cell(r, kolom_awal + 1).fill = _FILL_HEADER
        else:
            c.font, c.fill = Font(name=_FONT, size=11, bold=True, color="FF134E4A"), _FILL_RINGKAS
            q = ws.cell(r, kolom_awal + 1, rumus)
            q.font = Font(name=_FONT, size=11, color="FF008000")
            q.number_format = _FMT_ANGKA


def _dropdown(ws, rumus: str, rentang: str, judul: str, strict: bool = True) -> None:
    dv = DataValidation(type="list", formula1=rumus, allow_blank=True, showErrorMessage=True,
                        errorStyle="stop" if strict else "warning",
                        errorTitle="Invalid value" if strict else "Not in the list", error=f"Pick a {judul} from the list.")
    dv.add(rentang)
    ws.add_data_validation(dv)


def buat_template_dok(sisi: SisiDok, nama_klien: str, pihak: List[Tuple[str, str, str]], akun_kontrol: List[Any],
                      akun_default: Optional[Any], ob: Any) -> bytes:
    """Template Opening AR / AP (pola dataset/COA/02 & 03): 1 baris = 1 dokumen outstanding."""
    wb = Workbook()
    ws = wb.active
    ws.title = sisi.sheet
    font = Font(name=_FONT, size=11)
    akhir = BARIS_DATA_AWAL + JUMLAH_BARIS_TEMPLATE - 1
    kolom = sisi.kolom
    n_kolom = len(kolom)
    huruf = {k: get_column_letter(i) for i, (k, _) in enumerate(kolom, 1)}
    cut = ob.as_of_date
    akun_label = "AR Control Account" if sisi.modul == "ar" else "AP Control Account"

    _judul_template(ws, n_kolom, f"ZAFEB – {sisi.judul} · {nama_klien} · FY {ob.fiscal_year}", (
        f"Import every {sisi.pihak.lower()} {sisi.dokumen.lower()} that is still OUTSTANDING on the cut-off date "
        f"{cut.strftime('%d-%b-%Y')} — one row per {sisi.dokumen.lower()}. Pick an existing {sisi.pihak} Code from the "
        f"dropdown (name and tax ID fill in) or type a new {sisi.pihak.lower()}. "
        f"Required: {sisi.pihak} Name, {sisi.dokumen} Number (unique), {sisi.dokumen} Date (on or before the cut-off date), "
        f"Original Amount (> 0), Outstanding Amount (> 0, not more than the original) and the {akun_label} "
        f"(prefilled with the default from Account Mapping). After approval the {sisi.dokumen.lower()}s appear in "
        f"{'Accounts Receivable' if sisi.modul == 'ar' else 'Accounts Payable'} and the opening balance of the control "
        "account(s) is recalculated from them."
    ))
    _header_template(ws, kolom)

    for r in range(BARIS_DATA_AWAL, akhir + 1):
        for i in range(1, n_kolom + 1):
            c = ws.cell(r, i)
            c.font, c.alignment = font, Alignment(vertical="top", wrap_text=True)
        kode = f"{huruf['party_code']}{r}"
        for k, rng in (("party_name", "ZREF_PARTY_NAME"), ("tax_id", "ZREF_PARTY_TAX")):
            sel = ws[f"{huruf[k]}{r}"]
            sel.value = f'=IF({kode}="","",IFERROR(INDEX({rng},MATCH({kode},ZREF_PARTY_CODE,0))&"",""))'
            sel.fill = _FILL_LINK
        for k in ("doc_date", "due_date"):
            ws[f"{huruf[k]}{r}"].number_format = _FMT_TANGGAL
        for k in ("original", "outstanding", "wht_outstanding"):
            if k in huruf:
                ws[f"{huruf[k]}{r}"].number_format = _FMT_ANGKA
        ws[f"{huruf['currency']}{r}"].value = MATA_UANG_OPENING
        if akun_default is not None:
            ws[f"{huruf['account']}{r}"].value = str(akun_default.acc_no)
        if ob.branch:
            ws[f"{huruf['branch']}{r}"].value = ob.branch

    _ringkasan_template(ws, n_kolom + 2, [
        ("CONTROL SUMMARY", None),
        (f"Total {sisi.pihak}s", f"=SUMPRODUCT(({huruf['party_name']}{BARIS_DATA_AWAL}:{huruf['party_name']}{akhir}<>\"\")"
                                 f"/COUNTIF({huruf['party_name']}{BARIS_DATA_AWAL}:{huruf['party_name']}{akhir},"
                                 f"{huruf['party_name']}{BARIS_DATA_AWAL}:{huruf['party_name']}{akhir}&\"\"))"),
        (f"Total {sisi.dokumen}s", f"=COUNTA({huruf['doc_no']}{BARIS_DATA_AWAL}:{huruf['doc_no']}{akhir})"),
        ("Original Amount", f"=SUM({huruf['original']}{BARIS_DATA_AWAL}:{huruf['original']}{akhir})"),
        ("Outstanding Amount", f"=SUM({huruf['outstanding']}{BARIS_DATA_AWAL}:{huruf['outstanding']}{akhir})"),
    ])
    for i, lebar in enumerate(sisi.lebar, 1):
        ws.column_dimensions[get_column_letter(i)].width = lebar
    ws.freeze_panes = f"C{BARIS_DATA_AWAL}"

    ref = wb.create_sheet(SHEET_REFERENSI_DOK)
    ref.append([f"{sisi.pihak} Code", f"{sisi.pihak} Name", "Tax ID", "", "Control Account", "Name"])
    for i, (k, n, npwp) in enumerate(pihak, 2):
        ref.cell(i, 1, k); ref.cell(i, 2, n); ref.cell(i, 3, npwp)
    for i, a in enumerate(akun_kontrol, 2):
        ref.cell(i, 5, str(a.acc_no)); ref.cell(i, 6, a.account_name)
    for i, lebar in enumerate([16, 36, 22, 2, 18, 36], 1):
        ref.column_dimensions[get_column_letter(i)].width = lebar
    ref.sheet_state = "hidden"
    n_p = max(len(pihak), 1) + 1
    for nama, rng in {
        "ZREF_PARTY_CODE": f"$A$2:$A${n_p}", "ZREF_PARTY_NAME": f"$B$2:$B${n_p}", "ZREF_PARTY_TAX": f"$C$2:$C${n_p}",
        "ZREF_ACCOUNT": f"$E$2:$E${max(len(akun_kontrol), 1) + 1}",
    }.items():
        wb.defined_names[nama] = DefinedName(nama, attr_text=f"'{SHEET_REFERENSI_DOK}'!{rng}")

    rentang = lambda k: f"{huruf[k]}{BARIS_DATA_AWAL}:{huruf[k]}{akhir}"
    _dropdown(ws, "ZREF_PARTY_CODE", rentang("party_code"), f"{sisi.pihak.lower()} code (or type a new one)", strict=False)
    _dropdown(ws, "ZREF_ACCOUNT", rentang("account"), akun_label.lower())
    _dropdown(ws, '"' + ",".join(MATA_UANG) + '"', rentang("currency"), "currency", strict=False)
    _tambah_cara_penggunaan(wb, _panduan_dok(sisi, nama_klien, ob))

    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _posisi_kolom(header: List[str], kolom, wajib) -> Dict[str, int]:
    posisi: Dict[str, int] = {}
    norm = [_norm_header(h) for h in header]
    for key, judul in kolom:
        if _norm_header(judul) in norm:
            posisi[key] = norm.index(_norm_header(judul))
    hilang = [judul for key, judul in kolom if key in wajib and key not in posisi]
    if hilang:
        raise _Gagal(f"Missing required column(s): {', '.join(hilang)}. Use the downloaded template.", kode="MISSING_COLUMNS")
    return posisi


def _cek_mata_uang(d: Dict[str, str], err) -> str:
    """Opening balance selalu IDR: isi kolom Currency diabaikan (keputusan bisnis 2026-10-26)."""
    return MATA_UANG_OPENING


def _dokumen_terdaftar(session, client_id: str, modul: str) -> set:
    """Nomor dokumen yang sudah ada: AR = nomor invoice Sales; AP = (nomor bill, VENDOR)."""
    if modul == "ar":
        SI = dbc.SalesInvoice
        return {(n or "").strip().upper() for (n,) in session.query(SI.invoice_no).filter(
            SI.management_client_id == client_id, SI.deleted_at.is_(None)).all()}
    PT = dbc.PurchaseTransaction
    return {((n or "").strip().upper(), (v or "").strip().upper()) for n, v in session.query(PT.invoice_number, PT.vendor_name).filter(
        PT.management_client_id == client_id, PT.deleted_at.is_(None), PT.invoice_number.isnot(None)).all()}


def _validasi_dok(session, ob: Any, header: List[str], data: List[Tuple[int, List[Any]]], sisi: SisiDok) -> List[Dict[str, Any]]:
    posisi = _posisi_kolom(header, sisi.kolom, KOLOM_WAJIB_DOK)
    pihak = _pihak_master(session, ob.client_id, sisi.modul)
    per_kode_pihak = {k.strip().upper(): (k, n, t) for k, n, t in pihak}
    per_nama_pihak = {n.strip().upper(): (k, n, t) for k, n, t in pihak}
    kontrol = {a.id: a for a in _akun_kontrol(session, ob.client_id, sisi.modul)}
    per_kode_akun = {str(a.acc_no).strip().lower(): a for a in _akun_klien(session, ob.client_id)}
    default = _akun_default_dok(session, ob.client_id, sisi.modul)
    terdaftar = _dokumen_terdaftar(session, ob.client_id, sisi.modul)
    cut = ob.as_of_date
    label_akun = "AR Control Account" if sisi.modul == "ar" else "AP Control Account"

    hasil, no_dipakai = [], {}
    for no_baris, r in data:
        nilai = {k: (r[p] if p < len(r) else None) for k, p in posisi.items()}
        d = {k: _teks(v) for k, v in nilai.items()}
        if not any(d.get(k) for k in ("party_code", "doc_no", "original", "outstanding")):
            continue   # baris template kosong (hanya default IDR / akun / cabang)
        pesan: List[Dict[str, str]] = []

        def err(m): pesan.append({"level": "error", "message": m})
        def warn(m): pesan.append({"level": "warning", "message": m})

        # Pihak: kode master -> nama master; tanpa kode -> cocokkan nama; selain itu pihak baru.
        kode_pihak = d.get("party_code") or ""
        nama_pihak = d.get("party_name") or ""
        master = per_kode_pihak.get(kode_pihak.upper()) if kode_pihak else None
        if master is not None:
            if nama_pihak and nama_pihak.upper() != master[1].strip().upper():
                warn(f'{sisi.pihak} name "{nama_pihak}" differs from the master ({master[1]}) — the master name is used.')
            nama_pihak = master[1]
        elif nama_pihak and nama_pihak.upper() in per_nama_pihak:
            master = per_nama_pihak[nama_pihak.upper()]
            if kode_pihak and master[0] and kode_pihak.upper() != master[0].upper():
                warn(f"{sisi.pihak} {master[1]} already has code {master[0]} — that code is used.")
        elif nama_pihak and sisi.modul == "ar":
            warn(f"New customer — {nama_pihak} will be added to the customer master.")
        if not nama_pihak:
            err(f"{sisi.pihak} Name is required.")
        elif len(nama_pihak) > 255:
            err(f"{sisi.pihak} Name is longer than 255 characters.")
        if len(kode_pihak) > (30 if sisi.modul == "ar" else 50):
            err(f"{sisi.pihak} Code is too long.")
        if len(d.get("tax_id") or "") > 30:
            err(f"{sisi.pihak} Tax ID is longer than 30 characters.")

        no = (d.get("doc_no") or "").strip()
        kunci = no.upper() if sisi.modul == "ar" else (no.upper(), nama_pihak.strip().upper())
        if not no:
            err(f"{sisi.dokumen} Number is required.")
        elif len(no) > 90:
            err(f"{sisi.dokumen} Number is longer than 90 characters.")
        elif kunci in no_dipakai:
            err(f"Duplicate {sisi.dokumen} Number (also on row {no_dipakai[kunci]}).")
        elif kunci in terdaftar:
            err(f"{sisi.dokumen} {no} already exists in "
                f"{'Sales / Accounts Receivable' if sisi.modul == 'ar' else 'Purchase / Accounts Payable'}.")
        if no and kunci not in no_dipakai:
            no_dipakai[kunci] = no_baris

        tgl = jatuh_tempo = None
        if not d.get("doc_date"):
            err(f"{sisi.dokumen} Date is required.")
        else:
            tgl = _tanggal(nilai.get("doc_date"))
            if tgl is None:
                err(f"{sisi.dokumen} Date is not a valid date.")
            elif tgl > cut:
                err(f"{sisi.dokumen} Date is after the cut-off date {cut.strftime('%d-%b-%Y')} — record it as a normal transaction instead.")
        if d.get("due_date"):
            jatuh_tempo = _tanggal(nilai.get("due_date"))
            if jatuh_tempo is None:
                err("Due Date is not a valid date.")
            elif tgl and jatuh_tempo < tgl:
                err(f"Due Date cannot be before the {sisi.dokumen} Date.")

        angka: Dict[str, Optional[Decimal]] = {}
        for key, label in (("original", "Original Amount"), ("outstanding", "Outstanding Amount")):
            angka[key] = None
            if not d.get(key):
                err(f"{label} is required.")
                continue
            n = _angka(nilai.get(key))
            if n is None:
                err(f"{label} must be a number.")
            elif n <= 0:
                err(f"{label} must be greater than 0" + (" — fully settled documents are not imported." if key == "outstanding" else "."))
            else:
                angka[key] = n
        if angka["original"] is not None and angka["outstanding"] is not None and angka["outstanding"] > angka["original"]:
            err("Outstanding Amount cannot be more than the Original Amount.")
        wht = None
        if sisi.modul == "ap" and d.get("wht_outstanding"):
            wht = _angka(nilai.get("wht_outstanding"))
            if wht is None or wht < 0:
                err("Withholding Outstanding must be a number of 0 or more.")
            elif angka["outstanding"] is not None and wht > angka["outstanding"]:
                err("Withholding Outstanding cannot be more than the Outstanding Amount.")

        mata_uang = _cek_mata_uang(d, err)

        akun = None
        if not d.get("account"):
            err(f"{label_akun} is required.")
        else:
            akun = per_kode_akun.get(d["account"].lower())
            if akun is None:
                err(f'{label_akun} "{d["account"]}" is not in this client\'s COA.')
            elif akun.id not in kontrol:
                err(f"{akun.acc_no} {akun.account_name} is not an {'AR' if sisi.modul == 'ar' else 'AP'} control account "
                    "(set it in Settings > Account Mapping or use the dropdown).")
                akun = None
            elif not akun.is_active:
                err(f"{label_akun} {akun.acc_no} {akun.account_name} is inactive.")
            elif default is not None and akun.id != default.id:
                warn(f"{label_akun} {akun.acc_no} differs from the default ({default.acc_no}).")

        if d.get("branch") and ob.branch and d["branch"].strip().lower() != ob.branch.strip().lower():
            warn(f'Branch "{d["branch"]}" differs from this opening balance set ({ob.branch}).')

        sisa = angka["outstanding"] or NOL
        status = "error" if any(p["level"] == "error" for p in pesan) else "warning" if pesan else "valid"
        hasil.append({
            "row_no": no_baris,
            "coa_id": akun.id if akun is not None else None,
            "debit": sisa if sisi.modul == "ar" else NOL,
            "credit": sisa if sisi.modul == "ap" else NOL,
            "status": status,
            "messages": pesan,
            "data": {
                "party_code": (master[0] if master is not None and master[0] else kode_pihak) or None,
                "party_name": nama_pihak or None, "party_exists": master is not None,
                "tax_id": d.get("tax_id") or (master[2] if master is not None else None) or None,
                "doc_no": no or None,
                "doc_date": tgl.isoformat() if tgl else None, "due_date": jatuh_tempo.isoformat() if jatuh_tempo else None,
                "original": float(angka["original"]) if angka["original"] is not None else None,
                "outstanding": float(sisa), "currency": mata_uang,
                "account": _akun_dict(akun),
                **({"wht_type": d.get("wht_type") or None, "wht_outstanding": float(wht) if wht is not None else None}
                   if sisi.modul == "ap" else {"salesperson": d.get("salesperson") or None}),
                **{k: d.get(k) or None for k in ("branch", "department", "project", "reference", "notes")},
            },
        })
    return hasil


def _ganti_saldo_kontrol(session, ob: Any, modul: str, saldo: Dict[str, Decimal], uid: Any, catatan: str) -> int:
    """Ganti baris saldo awal SEMUA akun kontrol 1 modul dengan `saldo` (coa_id -> debit(+)/kredit(-))."""
    OBL = dbc.ManagementClientCoaOpeningBalanceLine
    akun = {a.id for a in _akun_kontrol(session, ob.client_id, modul)} | set(saldo)
    session.query(OBL).filter(OBL.opening_balance_id == ob.id, OBL.coa_id.in_(akun or {""})).delete(synchronize_session=False)
    n = 0
    for coa_id, v in saldo.items():
        if v != 0:
            session.add(OBL(opening_balance_id=ob.id, coa_id=coa_id, debit=v if v > 0 else NOL, credit=-v if v < 0 else NOL,
                            notes=catatan, created_by=uid))
            n += 1
    ob.edited_at, ob.edited_by = datetime.now(), uid
    session.flush()
    return n


def _saldo_dari_batch(session, b: Any) -> Dict[str, Decimal]:
    """Saldo per akun kontrol dari SEMUA batch approved modul ini di set opening balance yang sama
    (+ batch yang sedang di-approve). AR = debit, AP = kredit."""
    batch_ids = [x for (x,) in session.query(IMP.id).filter(
        IMP.opening_balance_id == b.opening_balance_id, IMP.module == b.module, IMP.status == "approved").all()]
    saldo: Dict[str, Decimal] = {}
    for r in session.query(ROW).filter(ROW.import_id.in_(set(batch_ids) | {b.id}), ROW.coa_id.isnot(None),
                                       ROW.is_excluded.is_(False)).all():
        saldo[r.coa_id] = saldo.get(r.coa_id, NOL) + _dec_aman(r.debit) - _dec_aman(r.credit)
    return saldo


def _terapkan_dok(session, b: Any, user: Dict[str, Any], sisi: SisiDok) -> str:
    """Batch AR/AP yang di-approve -> dokumen Sales/Purchase POSTED bertanda saldo awal
    (is_opening_balance, tidak dibaca GL) + saldo awal akun kontrol dihitung ulang."""
    ob = _wajib_ob_draft(session, b)
    kid = ob.client_id
    rows = _baris_terpilih(session, b)
    if any(r.status == "error" for r in rows):
        raise _Gagal("The batch has rows with errors.", kode="HAS_ERRORS")
    terdaftar = _dokumen_terdaftar(session, kid, sisi.modul)
    bentrok = [r.data["doc_no"] for r in rows if (
        r.data["doc_no"].upper() if sisi.modul == "ar" else (r.data["doc_no"].upper(), r.data["party_name"].upper())) in terdaftar]
    if bentrok:
        raise _Gagal(f"{sisi.dokumen}(s) already recorded: {', '.join(bentrok[:10])}. Reject the batch and upload it again.",
                     kode="CONFLICT", status_code=409)

    sekarang, uid = datetime.now(), user.get("id")
    pelanggan_baru = 0
    if sisi.modul == "ar":
        CU = dbc.ArCustomer
        master = {c.name.strip().upper(): c for c in session.query(CU).filter(CU.client_id == kid, CU.deleted_at.is_(None)).all()}
        kode_ada = {c.code.upper() for c in master.values()}
        urut = max((int(m.group(1)) for k in kode_ada if (m := re.fullmatch(r"CUST-(\d+)", k))), default=0)
    for r in rows:
        x = r.data
        akun = x["account"]
        tgl = date.fromisoformat(x["doc_date"])
        tempo = date.fromisoformat(x["due_date"]) if x.get("due_date") else None
        asli, sisa = Decimal(str(x["original"])), Decimal(str(x["outstanding"]))
        ket = " · ".join(t for t in (
            x.get("notes"), f"Ref: {x['reference']}" if x.get("reference") else None,
            f"Dept: {x['department']}" if x.get("department") else None,
            f"WHT {x.get('wht_type') or ''}: {x['wht_outstanding']:,.2f}".replace(" :", ":") if x.get("wht_outstanding") else None,
        ) if t) or None
        if sisi.modul == "ar":
            nama = x["party_name"].strip()
            if nama.upper() not in master:
                kode = (x.get("party_code") or "").strip().upper()
                if not kode or kode in kode_ada:
                    urut += 1
                    kode = f"CUST-{urut:03d}"
                c = CU(client_id=kid, code=kode, name=nama, npwp=x.get("tax_id"), created_by=uid)
                session.add(c)
                master[nama.upper()] = c
                kode_ada.add(kode)
                pelanggan_baru += 1
            inv = dbc.SalesInvoice(
                management_client_id=kid, invoice_no=x["doc_no"], invoice_date=tgl, due_date=tempo, customer_name=nama,
                customer_npwp=x.get("tax_id"), description=ket, transaction_type="Opening Balance",
                project_name=x.get("project"), sales_person=x.get("salesperson"), cabang=x.get("branch") or ob.branch,
                dpp=NOL, ppn=NOL, pph=NOL, gross_amount=asli, paid_amount=asli - sisa,
                posting_status="Posted", journal_sync_status="Opening Balance", posted_at=sekarang,
                is_opening_balance=True, opening_import_id=b.id, created_by=uid,
            )
            session.add(inv)
            session.flush()
            session.add(dbc.SalesAccountMapping(
                client_id=kid, invoice_id=inv.id, piutang_account_code=akun["acc_no"], piutang_account_name=akun["account_name"],
                pendapatan_account_code=akun["acc_no"], pendapatan_account_name=akun["account_name"],
                is_ai_suggested=False, mapped_by=None, created_by=uid,
            ))
        else:
            session.add(dbc.PurchaseTransaction(
                management_client_id=kid, purchase_no=f"OB-{x['doc_no']}"[:100], purchase_date=tgl, invoice_date=tgl,
                invoice_number=x["doc_no"], vendor_name=x["party_name"].strip(), vendor_code=x.get("party_code"),
                source_doc_type="Opening Balance", source_ref=x.get("reference"), description=ket,
                subtotal=asli, total=asli, accounts_payable=sisa, currency=MATA_UANG_OPENING,
                payment_status="unpaid" if sisa == asli else "partial", due_date=tempo, status="posted",
                period_label="Opening Balance", created_by_name=_nama_user(user), posted_by_name=_nama_user(user),
                notes=x.get("notes"), posting_date=tgl, posted_at=sekarang,
                ap_account_code=akun["acc_no"], ap_account_name=akun["account_name"],
                is_opening_balance=True, opening_import_id=b.id, created_by=uid,
            ))
    session.flush()
    n = _ganti_saldo_kontrol(session, ob, sisi.modul, _saldo_dari_batch(session, b), uid,
                             f"From opening {'AR invoices' if sisi.modul == 'ar' else 'AP bills'} (opening balance import).")
    tambahan = f"; {pelanggan_baru} new customer(s) added" if pelanggan_baru else ""
    return (f"Applied: {len(rows)} {sisi.dokumen.lower()}(s) added to "
            f"{'Accounts Receivable' if sisi.modul == 'ar' else 'Accounts Payable'}{tambahan}; opening balance of "
            f"{n} control account(s) recalculated from all approved {sisi.modul.upper()} batches.")


# ============================================================
# MODUL OPENING STOCK INVENTORY
# ============================================================

KOLOM_INV: Tuple[Tuple[str, str], ...] = (
    ("item_code", "Item Code"), ("item_name", "Item Name"), ("category", "Category"),
    ("wh_code", "Warehouse Code"), ("wh_name", "Warehouse Name"), ("unit", "Unit"),
    ("qty", "Opening Qty"), ("unit_cost", "Unit Cost"), ("value", "Opening Inventory Value"),
    ("inv_account", "Inventory Account"), ("cogs_account", "COGS Account"), ("lot", "Batch / Lot"),
    ("expiry", "Expiry Date"), ("branch", "Branch"), ("project", "Project"), ("notes", "Notes"),
)
KOLOM_WAJIB_INV = ("item_code", "wh_code", "qty", "unit_cost")
_LEBAR_INV = (16, 30, 20, 16, 22, 10, 14, 16, 20, 18, 16, 16, 14, 14, 16, 30, 4, 20, 18)
SHEET_TEMPLATE_INV = "OPENING_INVENTORY"
SHEET_REFERENSI_INV = "ZAFEB_INV"
SETUP_KATEGORI_PERSEDIAAN = {"label": "Inventory > Setup", "href": "/inventory?setup=1"}


def _kategori_persediaan(session, client_id: str) -> List[Any]:
    CAT = dbc.InventoryCategory
    return session.query(CAT).filter(CAT.client_id == client_id, CAT.deleted_at.is_(None)).order_by(CAT.name).all()


def _kurang_kategori_persediaan(session, client_id: str) -> List[str]:
    kategori = _kategori_persediaan(session, client_id)
    if not kategori:
        return ["At least one inventory category"]
    kurang = []
    for c in kategori:
        kurang += [f"{c.name}: {label}" for kolom, label in (("inventory_coa_id", "Inventory Account"), ("cogs_coa_id", "COGS Account"))
                   if not getattr(c, kolom)]
    return kurang


def buat_template_inv(nama_klien: str, akun: List[Any], kategori: List[Any], items: List[Any], gudang: List[Any], ob: Any) -> bytes:
    """Template Opening Stock (pola dataset/COA/04): 1 baris = 1 item di 1 gudang."""
    wb = Workbook()
    ws = wb.active
    ws.title = SHEET_TEMPLATE_INV
    font = Font(name=_FONT, size=11)
    akhir = BARIS_DATA_AWAL + JUMLAH_BARIS_TEMPLATE - 1
    n_kolom = len(KOLOM_INV)
    kode_akun = {a.id: str(a.acc_no) for a in akun}
    nama_kat = {c.id: c.name for c in kategori}

    _judul_template(ws, n_kolom, f"ZAFEB – IMPORT OPENING STOCK INVENTORY · {nama_klien} · FY {ob.fiscal_year}", (
        f"Import the opening stock per item and warehouse on the cut-off date {ob.as_of_date.strftime('%d-%b-%Y')}. "
        "Pick an existing Item Code / Warehouse Code from the dropdown (name, category and unit fill in) or type a new one — "
        "new items need Item Name, Category and Unit, new warehouses need Warehouse Name. Inventory and COGS accounts come "
        "from the item category. Required: Item Code, Warehouse Code, Opening Qty (> 0) and Unit Cost (>= 0); one row per "
        "item per warehouse. After approval an opening stock document is posted per warehouse in Inventory and the "
        "opening balance of the inventory account(s) is recalculated from the stock valuation."
    ))
    _header_template(ws, KOLOM_INV)

    for r in range(BARIS_DATA_AWAL, akhir + 1):
        for i in range(1, n_kolom + 1):
            c = ws.cell(r, i)
            c.font, c.alignment = font, Alignment(vertical="top", wrap_text=True)

        def cari(kunci: str, rng_kunci: str, rng: str) -> str:
            return f'IFERROR(INDEX({rng},MATCH({kunci}{r},{rng_kunci},0))&"","")'

        isi = {
            "B": f'=IF(A{r}="","",{cari("A", "ZINV_ITEM_CODE", "ZINV_ITEM_NAME")})',
            "C": f'=IF(A{r}="","",{cari("A", "ZINV_ITEM_CODE", "ZINV_ITEM_CAT")})',
            "E": f'=IF(D{r}="","",{cari("D", "ZINV_WH_CODE", "ZINV_WH_NAME")})',
            "F": f'=IF(A{r}="","",{cari("A", "ZINV_ITEM_CODE", "ZINV_ITEM_UNIT")})',
            "I": f'=IF(OR(G{r}="",H{r}=""),"",G{r}*H{r})',
            "J": f'=IF(C{r}="","",{cari("C", "ZINV_CAT", "ZINV_CAT_INV")})',
            "K": f'=IF(C{r}="","",{cari("C", "ZINV_CAT", "ZINV_CAT_COGS")})',
        }
        for kol, rumus in isi.items():
            ws[f"{kol}{r}"].value = rumus
            ws[f"{kol}{r}"].fill = _FILL_LINK
        for kol in ("H", "I"):
            ws[f"{kol}{r}"].number_format = _FMT_ANGKA
        ws[f"G{r}"].number_format = "#,##0.####"
        ws[f"M{r}"].number_format = _FMT_TANGGAL
        if ob.branch:
            ws[f"N{r}"].value = ob.branch

    _ringkasan_template(ws, n_kolom + 2, [
        ("CONTROL SUMMARY", None),
        ("Total Rows", f"=COUNTA(A{BARIS_DATA_AWAL}:A{akhir})"),
        ("Total Qty", f"=SUM(G{BARIS_DATA_AWAL}:G{akhir})"),
        ("Inventory Value", f"=SUM(I{BARIS_DATA_AWAL}:I{akhir})"),
    ])
    for i, lebar in enumerate(_LEBAR_INV, 1):
        ws.column_dimensions[get_column_letter(i)].width = lebar
    ws.freeze_panes = f"C{BARIS_DATA_AWAL}"

    ref = wb.create_sheet(SHEET_REFERENSI_INV)
    ref.append(["Item Code", "Item Name", "Category", "Unit", "", "Warehouse Code", "Warehouse Name", "", "Category",
                "Inventory Account", "COGS Account"])
    for i, it in enumerate(items, 2):
        for j, v in enumerate((it.code, it.name, nama_kat.get(it.category_id, ""), it.unit), 1):
            ref.cell(i, j, v)
    for i, w in enumerate(gudang, 2):
        ref.cell(i, 6, w.code); ref.cell(i, 7, w.name)
    for i, c in enumerate(kategori, 2):
        ref.cell(i, 9, c.name); ref.cell(i, 10, kode_akun.get(c.inventory_coa_id, "")); ref.cell(i, 11, kode_akun.get(c.cogs_coa_id, ""))
    for i, lebar in enumerate([16, 36, 22, 10, 2, 16, 28, 2, 24, 18, 18], 1):
        ref.column_dimensions[get_column_letter(i)].width = lebar
    ref.sheet_state = "hidden"
    n_it, n_wh, n_cat = max(len(items), 1) + 1, max(len(gudang), 1) + 1, max(len(kategori), 1) + 1
    for nama, rng in {
        "ZINV_ITEM_CODE": f"$A$2:$A${n_it}", "ZINV_ITEM_NAME": f"$B$2:$B${n_it}", "ZINV_ITEM_CAT": f"$C$2:$C${n_it}",
        "ZINV_ITEM_UNIT": f"$D$2:$D${n_it}", "ZINV_WH_CODE": f"$F$2:$F${n_wh}", "ZINV_WH_NAME": f"$G$2:$G${n_wh}",
        "ZINV_CAT": f"$I$2:$I${n_cat}", "ZINV_CAT_INV": f"$J$2:$J${n_cat}", "ZINV_CAT_COGS": f"$K$2:$K${n_cat}",
    }.items():
        wb.defined_names[nama] = DefinedName(nama, attr_text=f"'{SHEET_REFERENSI_INV}'!{rng}")

    rentang = lambda kol: f"{kol}{BARIS_DATA_AWAL}:{kol}{akhir}"
    _dropdown(ws, "ZINV_ITEM_CODE", rentang("A"), "item code (or type a new one)", strict=False)
    _dropdown(ws, "ZINV_CAT", rentang("C"), "category")
    _dropdown(ws, "ZINV_WH_CODE", rentang("D"), "warehouse code (or type a new one)", strict=False)
    _tambah_cara_penggunaan(wb, _panduan_inv(nama_klien, ob))

    wb.calculation.fullCalcOnLoad = True
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _validasi_inv(session, ob: Any, header: List[str], data: List[Tuple[int, List[Any]]]) -> List[Dict[str, Any]]:
    posisi = _posisi_kolom(header, KOLOM_INV, KOLOM_WAJIB_INV)
    IT, WH, MV = dbc.InventoryItem, dbc.InventoryWarehouse, dbc.InventoryMovement
    kid = ob.client_id
    kategori = {c.name.strip().upper(): c for c in _kategori_persediaan(session, kid)}
    kat_per_id = {c.id: c for c in kategori.values()}
    items = {i.code.strip().upper(): i for i in session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).all()}
    gudang = {w.code.strip().upper(): w for w in session.query(WH).filter(WH.client_id == kid, WH.deleted_at.is_(None)).all()}
    per_id_akun = {a.id: a for a in _akun_klien(session, kid)}
    # Item + gudang yang sudah punya stok awal (qty bersih movement opening > 0; dokumen void = movement pembalik).
    sudah_awal = {(i, w) for i, w, q in session.query(
        MV.item_id, MV.warehouse_id, func.sum(func.coalesce(MV.qty_in, 0) - func.coalesce(MV.qty_out, 0)),
    ).filter(MV.client_id == kid, MV.movement_type == "opening").group_by(MV.item_id, MV.warehouse_id).all() if q and q > 0}

    hasil, dipakai = [], {}
    for no_baris, r in data:
        nilai = {k: (r[p] if p < len(r) else None) for k, p in posisi.items()}
        d = {k: _teks(v) for k, v in nilai.items()}
        if not any(d.get(k) for k in ("item_code", "wh_code", "qty", "unit_cost")):
            continue
        pesan: List[Dict[str, str]] = []

        def err(m): pesan.append({"level": "error", "message": m})
        def warn(m): pesan.append({"level": "warning", "message": m})

        kode = (d.get("item_code") or "").upper()
        it = items.get(kode) if kode else None
        kat = kategori.get((d.get("category") or "").upper()) if d.get("category") else None
        nama, satuan = d.get("item_name") or "", d.get("unit") or ""
        if not kode:
            err("Item Code is required.")
        elif len(kode) > 50:
            err("Item Code is longer than 50 characters.")
        if d.get("category") and kat is None:
            err(f'Category "{d["category"]}" does not exist — add it in Inventory > Setup.')
        if it is not None:
            kat_item = kat_per_id.get(it.category_id)
            if kat is not None and kat_item is not None and kat.id != kat_item.id:
                err(f"Item {it.code} belongs to category {kat_item.name}, not {kat.name}.")
            kat = kat_item or kat
            if kat is None:
                err(f"Item {it.code} has no category — set it in Inventory first.")
            if nama and nama.upper() != it.name.strip().upper():
                warn(f'Item Name "{nama}" differs from the item master ({it.name}) — the master name is kept.')
            if satuan and satuan.upper() != (it.unit or "").upper():
                warn(f"Unit {satuan} differs from the item master ({it.unit}) — quantities are taken in {it.unit}.")
            if it.status != "active":
                err(f"Item {it.code} is inactive.")
            nama, satuan = it.name, it.unit
        elif kode:
            if not nama:
                err("Item Name is required for a new item.")
            if not d.get("category"):
                err("Category is required for a new item.")
            if not satuan:
                satuan = "Pcs"
                warn("Unit is empty — the new item uses Pcs.")
            if nama and kat is not None:
                warn(f"New item — {kode} {nama} will be added to the item master.")
        if kat is not None and not kat.inventory_coa_id:
            err(f"Category {kat.name} has no Inventory Account.")

        kode_wh = (d.get("wh_code") or "").upper()
        wh = gudang.get(kode_wh) if kode_wh else None
        if not kode_wh:
            err("Warehouse Code is required.")
        elif len(kode_wh) > 30:
            err("Warehouse Code is longer than 30 characters.")
        elif wh is None:
            if not d.get("wh_name"):
                err("Warehouse Name is required for a new warehouse.")
            else:
                warn(f"New warehouse — {kode_wh} {d['wh_name']} will be created.")
        elif not wh.is_active:
            err(f"Warehouse {wh.code} is inactive.")

        kunci = (kode, kode_wh)
        if kode and kode_wh:
            if kunci in dipakai:
                err(f"Duplicate item and warehouse (also on row {dipakai[kunci]}) — one row per item per warehouse.")
            else:
                dipakai[kunci] = no_baris
            if it is not None and wh is not None and (it.id, wh.id) in sudah_awal:
                err(f"{it.code} already has opening stock in warehouse {wh.code}.")

        qty = harga = None
        if not d.get("qty"):
            err("Opening Qty is required.")
        else:
            qty = _angka(nilai.get("qty")) if not isinstance(nilai.get("qty"), (int, float)) else Decimal(str(nilai["qty"]))
            if qty is None:
                err("Opening Qty must be a number.")
            elif qty <= 0:
                err("Opening Qty must be greater than 0.")
                qty = None
            else:
                qty = qty.quantize(Decimal("0.0001"))
        if not d.get("unit_cost"):
            err("Unit Cost is required (enter 0 if there is no cost).")
        else:
            harga = _angka(nilai.get("unit_cost"))
            if harga is None:
                err("Unit Cost must be a number.")
            elif harga < 0:
                err("Unit Cost must be 0 or more.")
                harga = None
            elif harga == 0:
                warn("Unit Cost is 0 — the stock is recorded without value.")

        for key, label, kolom in (("inv_account", "Inventory Account", "inventory_coa_id"), ("cogs_account", "COGS Account", "cogs_coa_id")):
            a_kat = per_id_akun.get(getattr(kat, kolom)) if kat is not None else None
            if d.get(key) and a_kat is not None and d[key].strip().lower() != str(a_kat.acc_no).strip().lower():
                err(f"{label} {d[key]} differs from category {kat.name} ({a_kat.acc_no}) — accounts come from the item category.")

        kedaluwarsa = None
        if d.get("expiry"):
            kedaluwarsa = _tanggal(nilai.get("expiry"))
            if kedaluwarsa is None:
                err("Expiry Date is not a valid date.")
        if d.get("branch") and ob.branch and d["branch"].strip().lower() != ob.branch.strip().lower():
            warn(f'Branch "{d["branch"]}" differs from this opening balance set ({ob.branch}).')

        nilai_stok = (qty * harga).quantize(SEN) if qty is not None and harga is not None else NOL
        a_inv = per_id_akun.get(kat.inventory_coa_id) if kat is not None else None
        status = "error" if any(p["level"] == "error" for p in pesan) else "warning" if pesan else "valid"
        hasil.append({
            "row_no": no_baris,
            "coa_id": a_inv.id if a_inv is not None else None,
            "debit": nilai_stok, "credit": NOL,
            "status": status,
            "messages": pesan,
            "data": {
                "item_code": kode or None, "item_name": nama or None, "item_exists": it is not None,
                "category": kat.name if kat is not None else (d.get("category") or None),
                "category_id": kat.id if kat is not None else None, "unit": satuan or None,
                "wh_code": kode_wh or None, "wh_name": (wh.name if wh is not None else d.get("wh_name")) or None,
                "wh_exists": wh is not None,
                "qty": float(qty) if qty is not None else None, "unit_cost": float(harga) if harga is not None else None,
                "value": float(nilai_stok), "inventory_account": _akun_dict(a_inv),
                "cogs_account": _akun_dict(per_id_akun.get(kat.cogs_coa_id)) if kat is not None else None,
                "lot": d.get("lot") or None, "expiry": kedaluwarsa.isoformat() if kedaluwarsa else None,
                **{k: d.get(k) or None for k in ("branch", "project", "notes")},
            },
        })
    return hasil


def _terapkan_inv(session, b: Any, user: Dict[str, Any]) -> str:
    """Batch inventory yang di-approve -> item/gudang baru dibuat, 1 dokumen Opening (OB-…)
    POSTED per gudang di modul Inventory (tanpa jurnal), lalu saldo awal akun persediaan
    dihitung ulang dari nilai stok per cut-off."""
    from ..assets_and_equity import inventory_v1 as inv

    ob = _wajib_ob_draft(session, b)
    kid = ob.client_id
    session.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"inventory:{kid}"})
    rows = _baris_terpilih(session, b)
    if any(r.status == "error" for r in rows):
        raise _Gagal("The batch has rows with errors.", kode="HAS_ERRORS")
    IT, WH, MV = dbc.InventoryItem, dbc.InventoryWarehouse, dbc.InventoryMovement
    kategori = {c.id: c for c in _kategori_persediaan(session, kid)}
    items = {i.code.strip().upper(): i for i in session.query(IT).filter(IT.client_id == kid, IT.deleted_at.is_(None)).all()}
    gudang = {w.code.strip().upper(): w for w in session.query(WH).filter(WH.client_id == kid, WH.deleted_at.is_(None)).all()}
    uid = user.get("id")

    baru_item = baru_wh = 0
    per_gudang: Dict[str, List[Tuple[Any, Any]]] = {}
    for r in rows:
        x = r.data
        if x["category_id"] not in kategori:
            raise _Gagal(f"Category \"{x.get('category')}\" (row {r.row_no}) no longer exists. Reject the batch and upload "
                         "it again.", kode="CATEGORY_NOT_FOUND", status_code=409)
        w = gudang.get(x["wh_code"])
        if w is None:
            w = WH(client_id=kid, code=x["wh_code"], name=x["wh_name"], is_active=True, created_by=uid)
            session.add(w)
            session.flush()
            gudang[x["wh_code"]] = w
            baru_wh += 1
        it = items.get(x["item_code"])
        if it is None:
            it = IT(client_id=kid, code=x["item_code"], name=x["item_name"], category_id=x["category_id"],
                    unit=x.get("unit") or "Pcs", default_warehouse_id=w.id, status="active", created_by=uid)
            session.add(it)
            session.flush()
            items[x["item_code"]] = it
            baru_item += 1
        per_gudang.setdefault(w.id, []).append((it, x))

    dokumen = []
    for wh_id, baris in per_gudang.items():
        for i in range(0, len(baris), 1000):
            potong = baris[i:i + 1000]
            p = inv.DokumenRequest(
                client_id=kid, doc_type="opening", doc_date=ob.as_of_date, warehouse_id=wh_id,
                source_ref="Opening balance import", notes=f"Opening stock from {b.file_name}"[:2000],
                lines=[inv.BarisDokIn(
                    item_id=it.id, quantity=x["qty"], unit_cost=x["unit_cost"],
                    notes=" · ".join(t for t in (f"Lot {x['lot']}" if x.get("lot") else None,
                                                 f"Exp {x['expiry']}" if x.get("expiry") else None, x.get("notes")) if t)[:500] or None,
                ) for it, x in potong],
            )
            d = inv._simpan_dok(session, kid, p, user)
            inv._posting_dok(session, kid, d, user)
            dokumen.append(d.doc_no)

    # Saldo awal akun persediaan = nilai stok per cut-off (semua movement s.d. cut-off), per akun kategori item.
    kat_item = {i.id: i.category_id for i in session.query(IT).filter(IT.client_id == kid).all()}
    saldo: Dict[str, Decimal] = {}
    for m in session.query(MV).filter(MV.client_id == kid, MV.movement_date <= ob.as_of_date).all():
        c = kategori.get(kat_item.get(m.item_id))
        if c is not None and c.inventory_coa_id:
            saldo[c.inventory_coa_id] = saldo.get(c.inventory_coa_id, NOL) + _dec_aman(m.value_in) - _dec_aman(m.value_out)
    n = _ganti_saldo_kontrol(session, ob, "inventory", saldo, uid, "From the Inventory stock valuation (opening balance import).")
    tambahan = "".join(f"; {k} new {lbl}(s) created" for k, lbl in ((baru_item, "item"), (baru_wh, "warehouse")) if k)
    return (f"Applied: opening stock posted in Inventory ({', '.join(dokumen)}) for {len(rows)} row(s){tambahan}; "
            f"opening balance of {n} inventory account(s) recalculated from the stock valuation.")


# ============================================================
# ENDPOINT
# ============================================================

@router.get("/{ob_id}/imports", summary="Ringkasan & riwayat batch import semua modul")
def daftar_import(ob_id: str, _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        ob = _ambil_ob(session, ob_id)
        batch = (
            session.query(IMP).filter(IMP.opening_balance_id == ob.id)
            .order_by(IMP.created_at.desc()).all()
        )
        mapping = dbc.akun_mapping_setting(ob.client_id, session=session)
        modul = []
        for key, label in MODUL.items():
            riwayat = [b for b in batch if b.module == key]
            terakhir = next((b for b in riwayat if b.status != "cancelled"), None)
            modul.append({
                "module": key, "label": label,
                "latest": _ringkas_batch(terakhir) if terakhir else None,
                "batch_count": len(riwayat),
                "pending_approval": sum(1 for b in riwayat if b.status == "submitted"),
                **dict(zip(("missing_mappings", "setup"), _setup_kurang(session, ob.client_id, key, mapping))),
            })
        return sukses(data={"modules": modul, "batches": [_ringkas_batch(b) for b in batch]})
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()


@router.get("/{ob_id}/imports/{module}/template", summary="Download template import")
def download_template(ob_id: str, module: str, _current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        ob = _ambil_ob(session, ob_id)
        m = _cek_modul(module)
        _wajib_mapping(session, ob.client_id, m)
        klien = dbc.get_management_client_by_id(ob.client_id, termasuk_nonaktif=True) or {}
        nama_klien = klien.get("company_name") or klien.get("client_code") or "Client"
        akun = _akun_klien(session, ob.client_id)
        if m == "coa":
            # Akun seri bernomor yang sudah bersaldo awal / punya Source Account Code tetap tampil.
            OBL = dbc.ManagementClientCoaOpeningBalanceLine
            dipertahankan = {c for (c,) in session.query(OBL.coa_id).filter(OBL.opening_balance_id == ob.id).all()}
            dipertahankan |= {a.id for a in akun if a.source_acc_no}
            isi = buat_template_coa(nama_klien, akun, ob, _penentu_kontrol(session, ob.client_id),
                                    _katalog_standard(session, ob.client_id), dipertahankan)
        elif m == "asset":
            mapping = dbc.akun_mapping_setting(ob.client_id, session=session)
            isi = buat_template_aset(nama_klien, akun,
                                     [(c, _akun_kategori(c, mapping)) for c in _kategori_aset(session, ob.client_id)], ob)
        elif m == "inventory":
            IT, WH = dbc.InventoryItem, dbc.InventoryWarehouse
            isi = buat_template_inv(
                nama_klien, akun, _kategori_persediaan(session, ob.client_id),
                session.query(IT).filter(IT.client_id == ob.client_id, IT.deleted_at.is_(None), IT.status == "active").order_by(IT.code).all(),
                session.query(WH).filter(WH.client_id == ob.client_id, WH.deleted_at.is_(None), WH.is_active.is_(True)).order_by(WH.code).all(),
                ob)
        else:
            isi = buat_template_dok(SISI_DOK[m], nama_klien, _pihak_master(session, ob.client_id, m),
                                    [a for a in _akun_kontrol(session, ob.client_id, m) if a.is_active],
                                    _akun_default_dok(session, ob.client_id, m), ob)
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()
    kode = re.sub(r"[^A-Za-z0-9_\-]", "_", str(klien.get("client_code") or "client"))
    awalan = {"coa": "01_Template_Import_COA_NonSubledger", "ar": SISI_AR.nama_file, "ap": SISI_AP.nama_file,
              "inventory": "04_Template_Import_Opening_Inventory", "asset": "05_Template_Import_Fixed_Asset_Register"}[m]
    nama = f"{awalan}_{kode}_FY{ob.fiscal_year}.xlsx"
    return StreamingResponse(
        io.BytesIO(isi),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nama}"'},
    )


@router.post("/{ob_id}/imports/{module}", summary="Upload file import -> batch validated")
async def upload_import(
    ob_id: str,
    module: str,
    file: UploadFile = File(...),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    isi = await file.read()
    nama_file = (file.filename or "upload").strip()[:255]

    def aksi(session):
        ob = _ambil_ob(session, ob_id)
        m = _cek_modul(module)
        _wajib_akses(session, current_user, ob.client_id)
        if ob.status != "draft":
            raise _Gagal("Opening balance is not in draft — click Revise first to import new data.", kode=f"STATUS_{ob.status.upper()}", status_code=409)
        _wajib_mapping(session, ob.client_id, m)
        if not isi:
            raise _Gagal("The file is empty.", kode="EMPTY_FILE")
        if len(isi) > MAKS_UKURAN_FILE:
            raise _Gagal("The file is larger than 10 MB.", kode="FILE_TOO_LARGE")
        menunggu = session.query(IMP).filter(
            IMP.opening_balance_id == ob.id, IMP.module == m, IMP.status == "submitted",
        ).first()
        if menunggu:
            raise _Gagal(
                f'Batch "{menunggu.file_name}" is still waiting for approval. Approve or reject it before uploading a new file.',
                kode="PENDING_APPROVAL", status_code=409,
            )

        header_wajib = {"coa": "Source Account Code", "asset": "Asset Code", "inventory": "Item Code"}.get(m)
        if m in SISI_DOK:
            header_wajib = dict(SISI_DOK[m].kolom)["doc_no"]
        header, data = _baca_tabel(isi, nama_file, header_wajib=header_wajib)
        if m == "coa":
            baris = _validasi_coa(session, ob, header, data)
        elif m == "asset":
            baris = _validasi_aset(session, ob, header, data)
        elif m == "inventory":
            baris = _validasi_inv(session, ob, header, data)
        else:
            baris = _validasi_dok(session, ob, header, data, SISI_DOK[m])
        if not baris:
            raise _Gagal("The file has no data rows.", kode="NO_ROWS")
        if len(baris) > MAKS_BARIS:
            raise _Gagal(f"The file has {len(baris)} rows — the maximum is {MAKS_BARIS}.", kode="TOO_MANY_ROWS")

        # Batch lama yang belum di-submit tidak relevan lagi -> dibatalkan otomatis.
        for lama in session.query(IMP).filter(
            IMP.opening_balance_id == ob.id, IMP.module == m, IMP.status == "validated",
        ).all():
            lama.status, lama.cancelled_at, lama.cancelled_by = "cancelled", datetime.now(), current_user.get("id")

        b = IMP(
            opening_balance_id=ob.id, client_id=ob.client_id, module=m, file_name=nama_file, status="validated",
            total_rows=len(baris),
            valid_rows=sum(1 for x in baris if x["status"] == "valid"),
            warning_rows=sum(1 for x in baris if x["status"] == "warning"),
            error_rows=sum(1 for x in baris if x["status"] == "error"),
            total_debit=sum((x["debit"] for x in baris), NOL),
            total_credit=sum((x["credit"] for x in baris), NOL),
            notes=None,
            created_by=current_user.get("id"), created_by_name=_nama_user(current_user),
        )
        session.add(b)
        session.flush()
        for x in baris:
            session.add(ROW(import_id=b.id, **x))
        session.flush()
        return _ringkas_batch(b)

    try:
        return sukses(data=_jalankan(aksi), message="File uploaded and validated.", status_code=201)
    except _Gagal as e:
        return _respon_gagal(e)


@router.get("/imports/{batch_id}", summary="Detail batch import + baris")
def detail_import(batch_id: str, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    session = dbc.SessionLocal()
    try:
        b = _ambil_batch(session, batch_id)
        ob = session.get(OB, b.opening_balance_id)
        rows = session.query(ROW).filter(ROW.import_id == b.id).order_by(ROW.row_no).all()
        data = _ringkas_batch(b)
        data["opening_balance"] = {
            "id": ob.id, "fiscal_year": ob.fiscal_year, "branch": ob.branch,
            "as_of_date": ob.as_of_date, "status": ob.status,
        } if ob else None
        data["rows"] = [{
            "id": r.id, "row_no": r.row_no, "coa_id": r.coa_id, "debit": float(r.debit or 0),
            "credit": float(r.credit or 0), "status": r.status, "messages": r.messages or [], "data": r.data or {},
            "is_excluded": bool(r.is_excluded),
        } for r in rows]
        data["excluded_rows"] = sum(1 for r in rows if r.is_excluded)
        data["permissions"] = _izin_batch(session, current_user, b)
        return sukses(data=data)
    except _Gagal as e:
        return _respon_gagal(e)
    finally:
        session.close()


def _ubah_status(batch_id: str, fn, pesan: str):
    def aksi(session):
        b = _ambil_batch(session, batch_id)
        fn(session, b)
        b_ob = session.get(OB, b.opening_balance_id)
        if b_ob is None or b_ob.deleted_at is not None:
            raise _Gagal("Opening balance not found.", kode="NOT_FOUND", status_code=404)
        session.flush()
        return _ringkas_batch(b)

    try:
        return sukses(data=_jalankan(aksi), message=pesan)
    except _Gagal as e:
        return _respon_gagal(e)


@router.post("/imports/{batch_id}/submit", summary="Ajukan batch untuk approval")
def submit_import(batch_id: str, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    def fn(session, b):
        _wajib_akses(session, current_user, b.client_id)
        if b.status != "validated":
            raise _Gagal("Only a validated batch can be submitted.", kode=f"STATUS_{b.status.upper()}", status_code=409)
        if not (b.valid_rows or 0) + (b.warning_rows or 0):
            raise _Gagal("There are no valid rows to submit — rows with errors cannot be approved. Fix the file and "
                         "import it again.", kode="NO_VALID_ROWS")
        b.status = "submitted"
        b.submitted_at, b.submitted_by, b.submitted_by_name = datetime.now(), current_user.get("id"), _nama_user(current_user)

    return _ubah_status(batch_id, fn, "Batch submitted for approval.")


def _terapkan_coa(session, b: Any, user: Dict[str, Any]) -> str:
    """Batch coa yang di-approve -> GANTI seluruh baris saldo set opening balance
    dengan baris bersaldo batch ini + ganti nama akun ZAFEB dengan Source Account
    Name. Mengembalikan ringkasan untuk catatan batch."""
    ob = session.get(OB, b.opening_balance_id)
    if ob is None or ob.deleted_at is not None:
        raise _Gagal("Opening balance not found.", kode="NOT_FOUND", status_code=404)
    if ob.status != "draft":
        raise _Gagal("Opening balance is not in draft — click Revise first, then approve this batch.",
                     kode=f"STATUS_{ob.status.upper()}", status_code=409)

    semua = _baris_terpilih(session, b)
    if any(r.status == "error" for r in semua):
        raise _Gagal("The batch has rows with errors.", kode="HAS_ERRORS")
    rows = [r for r in semua if r.coa_id is not None]
    baru = [r for r in semua if r.coa_id is None and (r.data or {}).get("new_account")]
    akun = {
        a.id: a for a in session.query(COA).filter(
            COA.id.in_({r.coa_id for r in rows} or {""}), COA.client_id == ob.client_id, COA.deleted_at.is_(None),
        ).all()
    } if rows else {}
    hilang = sorted({r.row_no for r in rows if r.coa_id not in akun})
    if hilang:
        raise _Gagal(f"ZAFEB account(s) on row {', '.join(map(str, hilang[:10]))} no longer exist in this client's COA. "
                     "Reject the batch and upload it again.", kode="COA_NOT_FOUND", status_code=409)

    sekarang, uid = datetime.now(), user.get("id")
    # Source Account Code -> kode tampilan akun (source_acc_no). 2 tahap: kode yang berubah
    # diganti sementara dulu supaya tukar kode antar akun tidak melanggar unique index.
    kode_baru = {r.coa_id: r.data["source_code"] for r in rows if (r.data or {}).get("source_code")}
    berubah = [akun[k] for k, v in kode_baru.items() if dbc.kode_tampil_akun(akun[k]) != v]
    for a in berubah:
        a.source_acc_no = f"~{a.id}"
    with _bentrok_kode_tampil():
        session.flush()
        # Akun baru dibuat dulu di COA klien -> baris batch-nya ikut diproses seperti akun lama.
        akun.update(_buat_akun_baru(session, ob, baru, uid, sekarang))
    for a in berubah:
        a.source_acc_no, a.edited_at, a.edited_by = kode_baru[a.id], sekarang, uid
    id_baru = {r.id for r in baru}
    rows = sorted(rows + baru, key=lambda r: r.row_no)
    OBL = dbc.ManagementClientCoaOpeningBalanceLine
    # Saldo akun kontrol (AR/AP/Inventory/Fixed Asset) dikelola modul 2-5 -> dipertahankan.
    modul_kontrol = _penentu_kontrol(session, ob.client_id)
    lama = session.query(OBL, COA).join(COA, COA.id == OBL.coa_id).filter(OBL.opening_balance_id == ob.id).all()
    dipertahankan = {l.coa_id for l, a in lama if modul_kontrol(a)}
    for l, a in lama:
        if l.coa_id not in dipertahankan:
            session.delete(l)
    session.flush()
    n_saldo = n_nama = 0
    for r in rows:
        if (_dec_aman(r.debit) > 0 or _dec_aman(r.credit) > 0) and r.coa_id not in dipertahankan:
            session.add(OBL(
                opening_balance_id=ob.id, coa_id=r.coa_id, debit=_dec_aman(r.debit), credit=_dec_aman(r.credit),
                notes=(r.data or {}).get("notes"), created_by=uid,
            ))
            n_saldo += 1
        if r.id in id_baru:
            continue  # nama akun baru sudah final (Suggested ZAFEB Account Name / Source Account Name)
        a = akun[r.coa_id]
        nama = ((r.data or {}).get("source_name") or "").strip()
        if nama and nama != a.account_name:
            a.account_name, a.edited_at, a.edited_by = nama, sekarang, uid
            n_nama += 1
    ob.edited_at, ob.edited_by = sekarang, uid
    try:
        with _bentrok_kode_tampil():
            session.flush()
    except _Gagal:
        raise
    except Exception as e:
        # Trigger trg_kunci_coa_mapping: akun terkunci Account Mapping tidak boleh ganti nama.
        if "MAPPING_LOCKED" in str(e):
            raise _Gagal("Some accounts are locked by Account Mapping and cannot be renamed. Unlock them in "
                         "Settings > Account Mapping, or reject the batch and keep their current names.",
                         kode="MAPPING_LOCKED", status_code=409)
        raise
    kontrol = f"; {len(dipertahankan)} control account balance(s) kept" if dipertahankan else ""
    tambah = f"; {len(baru)} new account(s) added to the COA" if baru else ""
    kode = f"; {len(berubah)} account code(s) updated from Source Account Code" if berubah else ""
    return (f"Applied to the opening balance: {n_saldo} account balance(s) replaced the previous non-control lines"
            f"{kontrol}; {n_nama} account name(s) updated from Source Account Name{kode}{tambah}.")


@contextmanager
def _bentrok_kode_tampil():
    """Pelanggaran unique index kode tampilan (migration 50) -> pesan yang jelas."""
    try:
        yield
    except Exception as e:
        if "uq_management_client_coa_display_code" in str(e):
            raise _Gagal("Some Source Account Codes are already used as account codes of other accounts (for example "
                         "accounts excluded from this approval). Change the selection, or reject the batch and use "
                         "unique codes.", kode="DUPLICATE_ACCOUNT_CODE", status_code=409)
        raise


def _buat_akun_baru(session, ob: Any, rows: List[Any], uid: Any, sekarang: datetime) -> Dict[str, Any]:
    """Buat akun BARU (data.new_account dari _cek_akun_baru) di COA klien saat
    batch coa di-approve; baris batch diisi coa_id-nya. Kode yang dulu pernah
    di-soft-delete dihidupkan lagi (UNIQUE client_id + acc_no tetap berlaku untuk
    baris terhapus, sama seperti POST /api/v1/management/coa)."""
    if not rows:
        return {}
    kode = [r.data["new_account"]["acc_no"] for r in rows]
    ada = {
        str(a.acc_no).strip().lower(): a for a in session.query(COA).filter(
            COA.client_id == ob.client_id, func.lower(func.trim(COA.acc_no)).in_([k.lower() for k in kode]),
        ).all()
    }
    bentrok = [k for k in kode if k.lower() in ada and ada[k.lower()].deleted_at is None]
    if bentrok:
        raise _Gagal(f"Account code(s) {', '.join(bentrok[:10])} were added to this client's COA after the upload. "
                     "Reject the batch and upload it again.", kode="COA_CONFLICT", status_code=409)
    klien = dbc.get_management_client_by_id(ob.client_id, termasuk_nonaktif=True) or {}
    hasil: Dict[str, Any] = {}
    for r in rows:
        kolom = dict(r.data["new_account"])
        a = ada.get(kolom["acc_no"].lower())
        if a is None:
            a = COA(client_id=ob.client_id, client_code=klien.get("client_code"), is_active=True, created_by=uid, **kolom)
            session.add(a)
        else:
            for k, v in kolom.items():
                setattr(a, k, v)
            a.is_active, a.deleted_at, a.deleted_by, a.edited_at, a.edited_by = True, None, None, sekarang, uid
        session.flush()
        r.coa_id = a.id
        hasil[a.id] = a
    return hasil


@router.post("/imports/{batch_id}/approve", summary="Setujui batch (grup tanpa review, lihat _akses_import)")
def approve_import(
    batch_id: str,
    payload: ApproveRequest = ApproveRequest(),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    def fn(session, b):
        _wajib_akses(session, current_user, b.client_id, perlu="langsung")
        if b.status not in ("validated", "submitted"):
            raise _Gagal("Only a validated or submitted batch can be approved.", kode=f"STATUS_{b.status.upper()}",
                         status_code=409)
        if b.status == "validated":
            # Grup tanpa review: approve langsung tanpa tahap submit (baris error tetap
            # tidak boleh ikut dipilih -- dicek di _terapkan_*; coa: pilihan harus seimbang).
            b.submitted_at, b.submitted_by, b.submitted_by_name = datetime.now(), current_user.get("id"), _nama_user(current_user)
        dipilih, total, n_error = _pilih_baris(session, b, payload.row_ids)
        if b.module == "coa":
            b.notes = _terapkan_coa(session, b, current_user)
        elif b.module == "asset":
            b.notes = _terapkan_aset(session, b, current_user)
        elif b.module == "inventory":
            b.notes = _terapkan_inv(session, b, current_user)
        else:
            b.notes = _terapkan_dok(session, b, current_user, SISI_DOK[b.module])
        if dipilih < total:
            dikeluarkan = total - dipilih - n_error
            b.notes = (f"{b.notes} Approved {dipilih} of {total} row(s)"
                       + (f"; {n_error} row(s) with errors skipped" if n_error else "")
                       + (f"; {dikeluarkan} excluded by the reviewer" if dikeluarkan else "") + ".")
        b.status = "approved"
        b.reviewed_at, b.reviewed_by, b.reviewed_by_name = datetime.now(), current_user.get("id"), _nama_user(current_user)
        b.review_note = (payload.note or "").strip() or None

    return _ubah_status(batch_id, fn, "Batch approved.")


@router.post("/imports/{batch_id}/reject", summary="Tolak batch (grup tanpa review, lihat _akses_import)")
def reject_import(
    batch_id: str,
    payload: RejectRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    def fn(session, b):
        _wajib_akses(session, current_user, b.client_id, perlu="langsung")
        if b.status != "submitted":
            raise _Gagal("Only a submitted batch can be rejected.", kode=f"STATUS_{b.status.upper()}", status_code=409)
        b.status = "rejected"
        b.reviewed_at, b.reviewed_by, b.reviewed_by_name = datetime.now(), current_user.get("id"), _nama_user(current_user)
        b.review_note = payload.reason.strip()

    return _ubah_status(batch_id, fn, "Batch rejected.")


@router.post("/imports/{batch_id}/cancel", summary="Batalkan batch (validated/rejected)")
def cancel_import(batch_id: str, current_user: Dict[str, Any] = Depends(get_current_user_v1)):
    def fn(session, b):
        _wajib_akses(session, current_user, b.client_id)
        if b.status not in ("validated", "rejected"):
            raise _Gagal("Only a validated or rejected batch can be cancelled.", kode=f"STATUS_{b.status.upper()}", status_code=409)
        b.status, b.cancelled_at, b.cancelled_by = "cancelled", datetime.now(), current_user.get("id")

    return _ubah_status(batch_id, fn, "Batch cancelled.")
