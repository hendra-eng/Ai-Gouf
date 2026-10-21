"""
modules/transactions/sales_import_v1.py
==========================================
Upload file laporan penjualan (CSV/Excel/PDF) + ekstraksi otomatis lewat Sales
Import Template -- implementasi backend dari alur yang didokumentasikan di
root/SALES_IMPORT_TEMPLATES.md. Endpoint tunggal:

    POST /api/v1/transactions/sales/source-files/upload
    (multipart/form-data: file, management_client_id)

Alur (ringkas -- detail & alasan tiap keputusan ada di SALES_IMPORT_
TEMPLATES.md):

    1. Baca file mentah (bytes), tentukan file_type dari ekstensi.
    2. Ambil semua template AKTIF milik (management_client_id, file_type).
    3. Untuk tiap kandidat template: decode file pakai encoding+delimiter
       template itu, ambil baris di posisi header_row_index-nya, hash
       (SHA-256, dinormalisasi) -- kalau SAMA dengan column_signature_hash
       template, itu templatenya.
    4. KETEMU template -> ekstrak baris (dispatch berdasar
       mapping_rules.format_type: 'grouped_invoice_report',
       'grouped_invoice_report_pdf', 'flat_grouped_by_key',
       'sectioned_by_customer_header', atau flat), simpan ke
       financial_transaction_sales_source_rows, naikkan usage_count template.
    5. TIDAK ketemu template -> BELUM ada inferensi AI terpasang (lihat
       "Langkah Implementasi" di SALES_IMPORT_TEMPLATES.md) -- file tetap
       disimpan sbg source_files tapi status_ekstraksi/status_mapping =
       'Butuh Review', TANPA baris source_rows. User perlu membuat
       template baru secara manual (lewat SQL seed atau -- kalau UI-nya
       dibangun nanti -- lewat modal Mapping Rules) sebelum file jenis ini
       bisa diekstrak otomatis.

Template "Multi" (1 baris DB, beberapa format file -- lihat seed_template_
sau_multi_format_sales.sql dan seed_template_nbm_multi_format_sales.sql):
langkah 2-3 memecahnya jadi template virtual per varian (mapping_rules.
variants, difilter per file_type), jadi 1 klien bisa melayani CSV, Excel dan
PDF sekaligus tanpa baris template terpisah. Contoh resep per format_type:
  - flat_grouped_by_key            CSV/Excel flat 1 baris = 1 item (NBM: POS; NPI: Excel POS 'Sales
                                   Recapitulation Detail Report', kop di atas header; UBD: Excel jurnal
                                   pendapatan buku besar, No Voucher = nomor invoice; Evita: sheet DATA,
                                   nomor invoice dirakit dari 2 kolom -- opsi lengkap di docstring
                                   _parse_flat_grouped_by_key)
  - sectioned_by_customer_header   Excel "Penjualan per Pelanggan" (NBM: wholesale)
  - category_summary               Excel/CSV laporan POS "Category Sales": 1 baris = 1 kategori, TANPA
                                   nomor invoice & tanggal di isi file; periode + outlet dari NAMA
                                   FILE, cabang = kategori (MM)
  - grouped_invoice_report(_pdf)   laporan blok per invoice (SAU: CSV dan PDF)
  - monthly_daily_matrix           Excel rekap pendapatan HARIAN, 1 sheet per bulan,
                                   kolom = tanggal 1..31 (AADL: Warung, Kafe Kapu,
                                   Omah & Kopi, Villa Putu)
  - monthly_rent_roll              Excel daftar sewa kamar, 1 sheet per bulan,
                                   1 invoice = total "Uang Kamar" sebulan (AADL: Kost)
  - multi_sheet_line_items         Excel catatan penjualan manual, 1 workbook = banyak sheet
                                   (1 sheet per jalur/pelanggan), 1 baris = 1 item, tanggal
                                   hanya diisi di baris pertama (ABE -- lihat bagian 3c)
  - monthly_block_invoice_register Excel register tagihan manual, 1 sheet berisi blok per bulan
                                   (header diulang tiap blok), 1 baris = 1 invoice, nomor invoice
                                   ADA di file, tanggal = kolom BULAN blok (Birawa -- bagian 3d)
  - monthly_income_list            Excel (xlsx/xls) daftar income per tamu, 1 sheet per bulan, header dicari lewat LABEL
                                   kolom, tanpa nomor invoice (dibentuk prefix + tanggal + nama tamu); sheet
                                   "YANG DI PAKAI" diutamakan, sheet tersembunyi dilewati (YM -- bagian 3f)
Tiga format sebelum ini BUKAN laporan invoice: file tidak punya nomor invoice, jadi
nomor invoice dibentuk dari prefix_invoice + tanggal (lihat bagian 3b dan 3c di bawah).
Catatan tambahan (bukan salah satu dari tiga format di atas):
  - daily_channel_recap            Excel rekap penjualan hotel per channel OTA: 1 workbook = 1 properti (nama
                                   properti dari NAMA FILE), 1 sheet = 1 channel (AIRBNB, BOOKING.COM), 1 baris =
                                   1 hari; 1 invoice = 1 hari x channel x properti (WSI -- bagian 3e)

CABANG itu opsional per klien/resep -- tidak ada setting klien khusus. Cabang
hanya terisi kalau resep memintanya: kolom di file (recipe "cabang", format
flat), nama file ("cabang_dari_nama_file", mis. SAU), atau judul seksi
("cabang_dari_judul_section"). Resep tanpa ketiganya (mis. NBM) menghasilkan
cabang kosong dan jurnal memakai akun pendapatan default klien.

PDF (format_type 'grouped_invoice_report_pdf'): alurnya SAMA, hanya cara baca
dan cara cocokkan signature-nya beda -- PDF tidak punya baris/sel, jadi file
dibaca sebagai KATA + POSISI (x0, top) dari text layer (pdfplumber), dan
signature = hash band header tabel yang tercetak di halaman 1. Resepnya
dibaca dari varian PDF di template 'Multi' (lihat seed_template_sau_multi_
format_sales.sql). PDF hasil scan (tanpa text layer) tidak didukung.

File .xls (Excel lama) dikonversi ke .xlsx di memory oleh _pastikan_xlsx() (butuh paket xlrd) sebelum dicocokkan.

File TIDAK disimpan ke disk (storage_path tetap NULL) -- diproses di
memory saja, konsisten dengan komentar yang sudah ada di DDL
("storage_path ... NULL kalau storage belum disambungkan"). Menyimpan file
fisik (local disk / object storage) sengaja di luar scope perubahan ini.
"""

from __future__ import annotations

import calendar
import csv
import hashlib
import io
import re
from datetime import date, datetime
from decimal import ROUND_HALF_UP, Decimal
from io import BytesIO
from typing import Any, Dict, Iterator, List, Optional, Tuple

from starlette.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .sales_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi

logger = get_module_logger("transactions_sales_import_v1")

router = APIRouter(prefix="/api/v1/transactions/sales", tags=["transactions-sales-v1"])

MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB -- laporan detail (mis. contoh SAU) bisa puluhan MB


# ============================================================
# 1) Deteksi tipe file & baca jadi baris mentah
# ============================================================

def _detect_file_type(filename: str) -> str:
    ext = (filename.rsplit(".", 1)[-1] if "." in filename else "").lower()
    if ext in ("xlsx", "xls"):
        return "Excel"
    if ext == "csv":
        return "CSV"
    if ext == "pdf":
        return "PDF"
    if ext == "txt":
        return "TXT"
    return ext.upper() or "File"


def _decode_teks(content: bytes, encoding: str) -> str:
    """Coba encoding yang diminta dulu, fallback ke beberapa encoding umum
    kalau gagal -- file laporan lama sering ISO-8859-1/cp1252, bukan UTF-8."""
    kandidat = [encoding, "utf-8", "utf-8-sig", "cp1252", "iso-8859-1"]
    for enc in kandidat:
        if not enc:
            continue
        try:
            return content.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return content.decode("utf-8", errors="replace")


def _baca_csv_baris(content: bytes, encoding: str, delimiter: str, quoted_fields: bool = False) -> List[List[str]]:
    teks = _decode_teks(content, encoding)
    if quoted_fields:
        # CSV "sungguhan" -- nilai yang memuat delimiter dibungkus tanda kutip
        # (mis. "Afternoon Delight, Tomu Friendly"), jadi WAJIB lewat csv.reader;
        # split() polos menggeser semua kolom di sebelah kanannya.
        return [list(r) for r in csv.reader(io.StringIO(teks), delimiter=delimiter)]
    baris_mentah = teks.splitlines()  # otomatis handle \r\n maupun \n
    return [baris.split(delimiter) for baris in baris_mentah]


_OLE2_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"


def _pastikan_xlsx(content: bytes) -> bytes:
    """File Excel lama (.xls / BIFF, ditandai header OLE2) dikonversi ke .xlsx di memory supaya
    seluruh pembaca di bawah (openpyxl) bisa memakainya. Yang dibawa: semua sheet (nama, status
    tersembunyi) dan NILAI sel (sel tanggal jadi datetime). Format sel, rumus dan sel gabungan
    tidak dibawa -- parser hanya membaca nilai. File .xlsx dikembalikan apa adanya. Kalau paket
    xlrd belum terpasang / file rusak, isi asli dikembalikan (pencocokan template lalu gagal ->
    'Butuh Review', bukan error)."""
    if not content or not content.startswith(_OLE2_MAGIC):
        return content
    try:
        import openpyxl
        import xlrd

        buku = xlrd.open_workbook(file_contents=content)
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for sh in buku.sheets():
            ws = wb.create_sheet(title=sh.name[:31] or "Sheet")
            ws.sheet_state = "visible" if sh.visibility == 0 else "hidden"
            for r in range(sh.nrows):
                for c in range(sh.ncols):
                    tipe, v = sh.cell_type(r, c), sh.cell_value(r, c)
                    if tipe in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK, xlrd.XL_CELL_ERROR):
                        continue
                    if tipe == xlrd.XL_CELL_DATE:
                        try:
                            v = xlrd.xldate.xldate_as_datetime(v, buku.datemode)
                        except Exception:
                            pass
                    elif tipe == xlrd.XL_CELL_BOOLEAN:
                        v = bool(v)
                    elif tipe == xlrd.XL_CELL_TEXT and not str(v).strip():
                        continue
                    ws.cell(row=r + 1, column=c + 1, value=v)
        if not wb.sheetnames:
            wb.create_sheet("Sheet1")
        keluar = BytesIO()
        wb.save(keluar)
        return keluar.getvalue()
    except Exception as e:
        logger.warning(f"Gagal mengonversi file .xls ke .xlsx: {e}")
        return content


def _norm_nama_sheet(nama: str) -> str:
    """Nama sheet dibandingkan tanpa peduli huruf besar/kecil, spasi di ujung, spasi ganda,
    underscore maupun strip (\"DATA\", \"Data \", \"data_penjualan\" == \"Data Penjualan\")."""
    return re.sub(r"[\s_\-]+", " ", (nama or "").strip().lower())


def _pilih_sheet_excel(wb, sheet_name: Optional[str]):
    """Sheet persis -> sheet dengan nama setara (lihat _norm_nama_sheet) -> sheet aktif."""
    if sheet_name:
        if sheet_name in wb.sheetnames:
            return wb[sheet_name]
        target = _norm_nama_sheet(sheet_name)
        for nama in wb.sheetnames:
            if _norm_nama_sheet(nama) == target:
                return wb[nama]
    return wb.active


def _nama_sheet_excel(content: bytes) -> List[str]:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    try:
        return list(wb.sheetnames)
    finally:
        wb.close()


def _baca_excel_baris(content: bytes, sheet_name: Optional[str]) -> List[List[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    ws = _pilih_sheet_excel(wb, sheet_name)
    hasil: List[List[str]] = []
    for row in ws.iter_rows(values_only=True):
        hasil.append(["" if v is None else str(v) for v in row])
    return hasil


def _baca_file_jadi_baris(content: bytes, file_type: str, encoding: str, delimiter: str, sheet_name: Optional[str], quoted_fields: bool = False) -> List[List[str]]:
    if file_type == "Excel":
        return _baca_excel_baris(content, sheet_name)
    # CSV/TXT dianggap delimited text -- PDF TIDAK lewat sini (tidak punya
    # baris/sel); PDF dibaca per kata+posisi lewat _PdfSumber di bawah.
    return _baca_csv_baris(content, encoding, delimiter, quoted_fields)


class _PdfSumber:
    """Pembungkus bytes PDF yang dikembalikan _cocokkan_template() sebagai
    pengganti "rows" untuk file_type='PDF'. Isi PDF SENGAJA belum dibaca di
    sini -- laporan penuh bisa ribuan halaman (CRS: 1.813), jadi pencocokan
    template cukup membaca halaman 1, dan seluruh halaman baru dibaca
    (halaman demi halaman) oleh _parse_grouped_invoice_report_pdf()."""

    def __init__(self, content: bytes):
        self.content = content


# True = baca teks PDF pakai pypdfium2 (sekitar 7x lebih cepat dari pdfplumber,
# penting untuk laporan ribuan halaman). pypdfium2 ikut terpasang bersama
# pdfplumber. Kalau gagal/tidak ada, otomatis kembali ke pdfplumber. Ubah ke
# False untuk memaksa pdfplumber (referensi; hasilnya sama untuk PDF contoh).
PDF_PAKAI_PDFIUM = True


def _iter_kata_pdfium(content: bytes, hanya_halaman: Optional[int] = None) -> Iterator[Tuple[int, List[Dict[str, Any]]]]:
    """Versi cepat: ambil "rect" teks pdfium (1 rect = 1 sel/segmen teks),
    lalu pecah per kata. Semua kata dalam 1 rect memakai x0 rect itu (+ selisih
    kecil supaya urutan terjaga) -- cukup untuk parser, yang hanya butuh
    kolom (x0) tempat sel dimulai dan urutan baris (top)."""
    import pypdfium2 as pdfium

    pdf = pdfium.PdfDocument(content)
    try:
        for idx in range(len(pdf)):
            page = pdf[idx]
            try:
                tinggi = page.get_height()
                tp = page.get_textpage()
                kata: List[Dict[str, Any]] = []
                for k in range(tp.count_rects()):
                    kiri, bawah, kanan, atas = tp.get_rect(k)
                    teks = tp.get_text_bounded(kiri, bawah, kanan, atas)
                    for j, token in enumerate((teks or "").split()):
                        kata.append({"text": token, "x0": kiri + j * 0.001, "top": tinggi - atas})
                tp.close()
            finally:
                page.close()
            yield idx + 1, kata
            if hanya_halaman is not None and idx + 1 >= hanya_halaman:
                return
    finally:
        pdf.close()


def _iter_kata_pdfplumber(content: bytes, hanya_halaman: Optional[int] = None) -> Iterator[Tuple[int, List[Dict[str, Any]]]]:
    import pdfplumber

    with pdfplumber.open(BytesIO(content)) as pdf:
        for no, page in enumerate(pdf.pages, start=1):
            try:
                kata = page.extract_words()
            finally:
                page.flush_cache()  # jaga memori untuk PDF ribuan halaman
            yield no, kata
            if hanya_halaman is not None and no >= hanya_halaman:
                return


def _iter_kata_halaman_pdf(content: bytes, hanya_halaman: Optional[int] = None) -> Iterator[Tuple[int, List[Dict[str, Any]]]]:
    """Hasilkan (nomor_halaman, kata) per halaman, kata = dict (text, x0, top).
    hanya_halaman=1 -> berhenti setelah halaman 1. Utamakan pdfium (cepat);
    kalau gagal SEBELUM ada halaman yang dihasilkan, ulangi pakai pdfplumber."""
    if PDF_PAKAI_PDFIUM:
        try:
            gen = _iter_kata_pdfium(content, hanya_halaman)
            pertama = next(gen)
        except StopIteration:
            return
        except Exception as e:
            logger.warning(f"pypdfium2 gagal ({e}); pakai pdfplumber.")
        else:
            yield pertama
            yield from gen
            return
    yield from _iter_kata_pdfplumber(content, hanya_halaman)


def _kelompokkan_kata_jadi_baris(kata: List[Dict[str, Any]], toleransi: float = 3.0) -> List[List[Dict[str, Any]]]:
    """Urutkan kata menurut top, lalu kelompokkan jadi 1 baris bila selisih
    top terhadap kata pertama baris itu <= toleransi (pt). WAJIB toleransi,
    bukan pembulatan: kata dalam 1 baris footer bisa berbeda ~1 pt vertikal."""
    urut = sorted(kata, key=lambda w: (w["top"], w["x0"]))
    baris: List[List[Dict[str, Any]]] = []
    acuan: Optional[float] = None
    sekarang: List[Dict[str, Any]] = []
    for w in urut:
        if acuan is None or w["top"] - acuan > toleransi:
            if sekarang:
                baris.append(sorted(sekarang, key=lambda x: x["x0"]))
            sekarang = [w]
            acuan = w["top"]
        else:
            sekarang.append(w)
    if sekarang:
        baris.append(sorted(sekarang, key=lambda x: x["x0"]))
    return baris


def _teks_baris(baris: List[Dict[str, Any]]) -> str:
    return " ".join(w["text"] for w in baris)


def _norm_teks(s: str) -> str:
    return " ".join((s or "").strip().lower().split())


_RE_CAP_TANGGAL = re.compile(r"^\d{1,2}/\d{1,2}/\d{2,4}$")
_RE_CAP_JAM = re.compile(r"^\d{1,2}:\d{2}(:\d{2})?$")
_RE_CAP_HALAMAN = re.compile(r"^\d+/\d+$")


def _buang_cap_halaman(baris_halaman: List[List[Dict[str, Any]]]) -> List[List[Dict[str, Any]]]:
    """Buang HANYA kata cap di dasar halaman ('<dd/mm/yyyy> <hh:mm> REPORT
    <n>/<N>'): tanggal/jam/REPORT di x0 < 130 dan penghitung halaman di
    x0 >= 538, pada baris yang memuat kata REPORT. Kata lain di baris yang
    sama BUKAN cap (lanjutan alamat invoice bisa tercetak di baris itu)."""
    hasil = []
    for b in baris_halaman:
        if any(w["text"].upper() == "REPORT" and w["x0"] < 130 for w in b):
            b = [
                w for w in b
                if not (
                    w["x0"] < 130 and (
                        w["text"].upper() in ("REPORT", "AM", "PM")
                        or _RE_CAP_TANGGAL.match(w["text"]) or _RE_CAP_JAM.match(w["text"])
                    )
                )
                and not (w["x0"] >= 538 and _RE_CAP_HALAMAN.match(w["text"]))
            ]
        if b:
            hasil.append(b)
    return hasil


# ============================================================
# 2) Normalisasi header & signature -- PERSIS algoritma yang
#    didokumentasikan di SALES_IMPORT_TEMPLATES.md, supaya hasilnya sama
#    dengan yang dipakai bikin seed template manual (lihat
#    migrations/seed_template_sau_detail_penjualan_csv.sql).
# ============================================================

def _normalisasi_baris(row: List[str]) -> str:
    norm = [" ".join(cell.strip().lower().split()) for cell in row]
    return "|".join(norm)


def _hash_baris(row: List[str]) -> str:
    return hashlib.sha256(_normalisasi_baris(row).encode("utf-8")).hexdigest()


def ringkas_import_template(t: Dict[str, Any]) -> Dict[str, Any]:
    """Ringkasan read-only 1 import template (Purchase/Journal Entry) untuk
    modal Mapping Rules tab Source Data -- resep mapping_rules lengkap
    (posisi kolom per jenis baris blok) TIDAK dikirim utuh."""
    rules = t.get("mapping_rules") or {}
    return {
        "id": t["id"],
        "client_code": t.get("client_code"),
        "file_type": t.get("file_type"),
        "sheet_name": t.get("sheet_name"),
        "header_row_index": t.get("header_row_index"),
        "data_start_row_index": t.get("data_start_row_index"),
        "header_columns": t.get("header_columns") or [],
        "format_type": rules.get("format_type"),
        "description": rules.get("description"),
        "delimiter": rules.get("delimiter"),
        "encoding": rules.get("encoding"),
        "date_format": rules.get("date_format"),
        "field_mapping": rules.get("field_mapping") or {},
        "detected_by": t.get("detected_by"),
        "created_at": t.get("created_at"),
    }


# ============================================================
# 3) Cocokkan file ke template yang sudah ada
# ============================================================

FILE_TYPE_MULTI = "Multi"


def _template_dari_varian(template: Dict[str, Any], varian: Dict[str, Any]) -> Dict[str, Any]:
    """Template "Multi" (1 baris DB, beberapa format file) dipecah jadi
    template virtual per varian: tiap varian membawa field yang sama dgn
    baris template biasa (sheet_name, header_row_index, data_start_row_index,
    column_signature_hash, header_columns, mapping_rules), jadi sisa alur
    (cocokkan hash -> ekstrak) tidak perlu tahu bedanya. id/client_id tetap
    milik baris aslinya, supaya usage_count & source_files.template_id
    menunjuk ke 1 setting yang sama."""
    return {
        **template,
        "file_type": varian.get("file_type"),
        "sheet_name": varian.get("sheet_name"),
        "header_row_index": varian["header_row_index"],
        "data_start_row_index": varian["data_start_row_index"],
        "column_signature_hash": varian["column_signature_hash"],
        "header_columns": varian.get("header_columns", []),
        "mapping_rules": varian["mapping_rules"],
    }


def _kandidat_template(management_client_id: str, file_type: str) -> List[Dict[str, Any]]:
    kandidat: List[Dict[str, Any]] = []
    for template in dbc.list_sales_import_templates(client_id=management_client_id, hanya_aktif=True):
        if template.get("file_type") == file_type:
            kandidat.append(template)
        elif template.get("file_type") == FILE_TYPE_MULTI:
            for varian in (template.get("mapping_rules") or {}).get("variants", []):
                if varian.get("file_type") == file_type:
                    kandidat.append(_template_dari_varian(template, varian))
    return kandidat


def _cocokkan_template(content: bytes, file_type: str, management_client_id: str) -> Optional[Tuple[Dict[str, Any], List[List[str]]]]:
    """Coba tiap template AKTIF milik client+file_type ini (termasuk varian
    dari template file_type='Multi') -- kembalikan (template, baris_hasil_
    decode) kalau ketemu yang cocok, None kalau tidak ada satu pun yang
    match (file ini polanya belum pernah dipelajari)."""
    kandidat = _kandidat_template(management_client_id, file_type)
    if file_type == "PDF":
        return _cocokkan_template_pdf(content, kandidat)
    if file_type == "Excel":
        # .xls (Excel lama) -> .xlsx dulu; semua pembaca di bawah (dan sumber yang dikembalikan) memakai hasilnya.
        content = _pastikan_xlsx(content)
        # Varian daftar income bulanan (YM) dicocokkan lewat LABEL kolom header -- bagian 3f.
        income = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") == FORMAT_EXCEL_INCOME_LIST]
        if income:
            cocok_income = _cocokkan_template_excel_income_list(content, income)
            if cocok_income is not None:
                return cocok_income
            id_income = {id(t) for t in income}
            kandidat = [t for t in kandidat if id(t) not in id_income]
        # Varian multi-sheet (ABE) dicocokkan lewat header tiap sheet -- bagian 3c.
        multi_sheet = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") == FORMAT_EXCEL_MULTI_SHEET]
        if multi_sheet:
            cocok_multi = _cocokkan_template_excel_multi_sheet(content, multi_sheet)
            if cocok_multi is not None:
                return cocok_multi
            id_multi = {id(t) for t in multi_sheet}
            kandidat = [t for t in kandidat if id(t) not in id_multi]
        # Varian register invoice berblok bulanan (Birawa) dicocokkan lewat header 1 sheet
        # bernama -- bagian 3d (kolom A kosong/lebar sheet tidak ikut di-hash).
        register = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") == FORMAT_EXCEL_REGISTER_BLOK]
        if register:
            cocok_register = _cocokkan_template_excel_register_blok(content, register)
            if cocok_register is not None:
                return cocok_register
            id_register = {id(t) for t in register}
            kandidat = [t for t in kandidat if id(t) not in id_register]
        # Varian rekap bulanan (1 sheet per bulan) dicocokkan lewat judul sheet,
        # bukan lewat 1 sheet tertentu -- lihat bagian 3b.
        # Varian rekap harian per channel OTA (WSI) dicocokkan lewat LABEL kolom header di sheet mana pun -- bagian 3e.
        rekap = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") == FORMAT_EXCEL_REKAP_CHANNEL]
        if rekap:
            cocok_rekap = _cocokkan_template_excel_rekap_channel(content, rekap)
            if cocok_rekap is not None:
                return cocok_rekap
            id_rekap = {id(t) for t in rekap}
            kandidat = [t for t in kandidat if id(t) not in id_rekap]
        bulanan = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") in FORMAT_EXCEL_BULANAN]
        if bulanan:
            cocok_bulanan = _cocokkan_template_excel_bulanan(content, bulanan)
            if cocok_bulanan is not None:
                return cocok_bulanan
            id_bulanan = {id(t) for t in bulanan}
            kandidat = [t for t in kandidat if id(t) not in id_bulanan]
    for template in kandidat:
        mapping_rules = template.get("mapping_rules") or {}
        encoding = mapping_rules.get("encoding", "utf-8")
        delimiter = mapping_rules.get("delimiter", ",")
        try:
            rows = _baca_file_jadi_baris(content, file_type, encoding, delimiter, template.get("sheet_name"), mapping_rules.get("quoted_fields", False))
        except Exception as e:
            logger.warning(f"Gagal decode file pakai template {template['id']}: {e}")
            continue
        cocok = _cocokkan_header_fleksibel(rows, template)
        if cocok is not None:
            return cocok, rows
        # Opsional (resep "cari_di_semua_sheet"): tabel data bisa pindah/ganti nama sheet -> coba sheet lain.
        if file_type == "Excel" and mapping_rules.get("cari_di_semua_sheet"):
            try:
                nama_semua = _nama_sheet_excel(content)
            except Exception as e:
                logger.warning(f"Gagal membaca daftar sheet untuk template {template['id']}: {e}")
                continue
            sudah = _norm_nama_sheet(template.get("sheet_name") or "")
            for nama in nama_semua:
                if _norm_nama_sheet(nama) == sudah:
                    continue
                try:
                    rows_lain = _baca_excel_baris(content, nama)
                except Exception:
                    continue
                cocok = _cocokkan_header_fleksibel(rows_lain, template)
                if cocok is not None:
                    return cocok, rows_lain
    return None


def _hash_header(row: List[str], abaikan_kosong_di_ujung: bool) -> str:
    if abaikan_kosong_di_ujung:
        row = list(row)
        while row and not (row[-1] or "").strip():
            row.pop()
    return _hash_baris(row)


def _cocokkan_header_fleksibel(rows: List[List[str]], template: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Cocokkan baris header file ke template. Tanpa opsi di resep, perilakunya SAMA seperti
    sebelumnya (hash baris header_row_index persis). Opsi resep (semuanya opsional):
      signature_abaikan_kolom_kosong_di_ujung  sel kosong di ujung baris header tidak ikut di-hash
                                               (kolom bantu tanpa judul boleh ditambah/dihapus)
      header_cari_dalam_baris N                header juga dicari di N baris pertama (baris judul/
                                               subtotal di atasnya boleh bertambah/berkurang)
      cocok_jika_kolom_ada [nama, ...]         cadangan kalau hash beda: cocok bila semua kolom wajib
                                               ada di baris header (urutan/kolom tambahan bebas)
    Kembalian = template (header_row_index/data_start_row_index digeser kalau header ditemukan di
    baris lain), atau None."""
    recipe = template.get("mapping_rules") or {}
    resmi = template["header_row_index"] - 1
    trim = bool(recipe.get("signature_abaikan_kolom_kosong_di_ujung", False))
    scan = int(recipe.get("header_cari_dalam_baris") or 0)
    urutan = [resmi] + [i for i in range(min(scan, len(rows))) if i != resmi]
    urutan = [i for i in urutan if 0 <= i < len(rows)]

    def geser(i: int) -> Dict[str, Any]:
        if i == resmi:
            return template
        selisih = (i + 1) - template["header_row_index"]
        return {**template, "header_row_index": i + 1, "data_start_row_index": template["data_start_row_index"] + selisih}

    for i in urutan:
        if _hash_header(rows[i], trim) == template["column_signature_hash"]:
            return geser(i)
    wajib = {_norm_label(k) for k in recipe.get("cocok_jika_kolom_ada", []) if k}
    if wajib:
        for i in urutan:
            if wajib <= {_norm_label(c) for c in rows[i]}:
                return geser(i)
    return None


def _cocokkan_template_pdf(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_PdfSumber"]]:
    """Cocokkan PDF ke template: band header tabel (mis. 'No Transaksi |
    Tanggal | Dept. | Kode Pel. | Nama Pelanggan | Alamat') harus tercetak
    di halaman 1 sebagai 1 baris, dan SHA-256 sel-selnya (algoritma yang sama
    dengan CSV/Excel: _hash_baris) harus sama dengan column_signature_hash
    varian. mapping_rules.signature_rule.guard_judul_halaman_1 (kalau ada)
    = judul yang wajib ada di halaman 1, pengaman tambahan."""
    if not kandidat:
        return None
    try:
        _, kata = next(_iter_kata_halaman_pdf(content, hanya_halaman=1))
    except StopIteration:
        return None  # PDF tanpa halaman
    except Exception as e:
        logger.warning(f"Gagal membaca halaman 1 PDF: {e}")
        return None
    if not kata:
        return None  # tidak ada text layer (PDF scan) -- belum didukung
    teks_baris = [_norm_teks(_teks_baris(b)) for b in _kelompokkan_kata_jadi_baris(kata)]

    for template in kandidat:
        mapping_rules = template.get("mapping_rules") or {}
        sig = mapping_rules.get("signature_rule") or {}
        sel = sig.get("cells") or template.get("header_columns") or []
        if not sel:
            continue
        guard = sig.get("guard_judul_halaman_1")
        if guard and not any(_norm_teks(guard) in t for t in teks_baris):
            continue
        target = " ".join(_norm_teks(c) for c in sel)
        if not any(t == target or t.startswith(target + " ") for t in teks_baris):
            continue
        if _hash_baris(sel) == template["column_signature_hash"]:
            return template, _PdfSumber(content)
    return None


# ============================================================
# 3b) Excel REKAP BULANAN -- 1 sheet per bulan (klien AADL)
# ============================================================
# Bentuk file ini berbeda dari laporan invoice: 1 workbook = 1 cabang = 1 tahun,
# isinya 1 sheet per bulan ("Januari 2026", "Jan 2026", "JANUARI'26", "Des'25"),
# ditambah sheet RESUME/Sheet1 yang bukan data. Karena itu pencocokan template
# TIDAK memakai 1 sheet tertentu seperti _baca_excel_baris(): signature = hash
# baris JUDUL (mis. baris 2 = nama usaha) dari sheet-sheet bulanan, dan ekstraksi
# membaca SEMUA sheet bulanan.

FORMAT_EXCEL_BULANAN = ("monthly_daily_matrix", "monthly_rent_roll")

_BULAN_NAMA_SHEET = {
    "januari": 1, "jan": 1, "februari": 2, "pebruari": 2, "feb": 2, "maret": 3, "mar": 3,
    "april": 4, "apr": 4, "mei": 5, "juni": 6, "jun": 6, "juli": 7, "jul": 7,
    "agustus": 8, "agu": 8, "agt": 8, "september": 9, "sept": 9, "sep": 9,
    "oktober": 10, "okt": 10, "november": 11, "nov": 11, "nop": 11, "desember": 12, "des": 12,
}


class _ExcelBulananSumber:
    """Pembungkus bytes workbook yang dikembalikan _cocokkan_template() sebagai
    pengganti "rows" untuk varian Excel rekap bulanan (pola yang sama dengan
    _PdfSumber): semua sheet bulanan baru dibaca oleh parser format_type-nya."""

    def __init__(self, content: bytes):
        self.content = content


def _buka_workbook_bulanan(content: bytes):
    import openpyxl

    return openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)


def _bulan_dari_nama_sheet(nama: str) -> Tuple[Optional[int], Optional[int]]:
    """(bulan, tahun) dari nama sheet; (None, None) kalau bukan sheet bulanan
    (RESUME, Sheet1, dst). Tahun 2 digit (\"Des'25\") dijadikan 20xx; tahun
    boleh tidak ada (None)."""
    m = re.match(r"^\s*([A-Za-z]+)\W*(\d{4}|\d{2})?\s*$", nama or "")
    if not m:
        return None, None
    bulan = _BULAN_NAMA_SHEET.get(m.group(1).lower())
    if bulan is None:
        return None, None
    tahun = int(m.group(2)) if m.group(2) else None
    if tahun is not None and tahun < 100:
        tahun += 2000
    return bulan, tahun


def _daftar_sheet_bulanan(nama_sheet: List[str], recipe: Dict[str, Any]) -> List[Tuple[str, int, int]]:
    """[(nama_sheet, tahun, bulan)] untuk sheet bulanan saja, urut seperti di
    workbook. recipe.tahun:
      "nama_sheet"   (default) tahun dari nama sheet; kalau tidak ada, ikut sheet sebelumnya.
      "urutan_sheet" tahun HANYA dari sheet bulanan pertama, lalu naik 1 setiap bulan
                     \"mundur\" (Des -> Jan). Dipakai AADL karena nama sheet sering salah
                     ketik (\"Juli 2024\" di file 2026, judul sheet \"Juni 2025\")."""
    kandidat = []
    for nama in nama_sheet:
        bulan, tahun = _bulan_dari_nama_sheet(nama)
        if bulan is not None:
            kandidat.append((nama, bulan, tahun))
    tahun_awal = next((t for _, _, t in kandidat if t), None)
    mode = recipe.get("tahun", "nama_sheet")
    hasil: List[Tuple[str, int, int]] = []
    tahun_kini: Optional[int] = None
    bulan_lalu: Optional[int] = None
    for nama, bulan, tahun in kandidat:
        if mode == "urutan_sheet":
            if tahun_kini is None:
                tahun_kini = tahun or tahun_awal or date.today().year
            elif bulan < (bulan_lalu or 0):
                tahun_kini += 1
        else:
            tahun_kini = tahun or tahun_kini or tahun_awal or date.today().year
        bulan_lalu = bulan
        hasil.append((nama, tahun_kini, bulan))
    return hasil


def _periode_diizinkan(tahun: int, bulan: int, recipe: Dict[str, Any]) -> bool:
    """recipe.periode_mulai / periode_akhir (\"YYYY-MM\", opsional) -- sheet di luar
    rentang dilewati (mis. sheet Desember tahun sebelumnya)."""
    ym = f"{tahun:04d}-{bulan:02d}"
    if recipe.get("periode_mulai") and ym < recipe["periode_mulai"]:
        return False
    if recipe.get("periode_akhir") and ym > recipe["periode_akhir"]:
        return False
    return True


_SHEET_ABAIKAN = {"resume", "sheet1", "meta", "cek upload"}


def _baca_meta_bulanan(wb) -> Optional[Dict[str, Any]]:
    """Baca sheet 'META' (opsional) di workbook rekap bulanan AADL.
    Isi yang dibaca (posisi baris bebas, dicari lewat isinya):
      kolom A = 'CABANG', kolom B = nama cabang
      tabel: A = nama sheet persis, B = periode 'YYYY-MM', C = status FINAL / RENCANA / ABAIKAN
    Kalau ada META, daftar sheet & periodenya DIPAKAI dari sini (bukan ditebak dari nama
    sheet / urutan sheet). Tidak ada META atau tabelnya kosong -> None (perilaku lama)."""
    nama_meta = next((n for n in wb.sheetnames if n.strip().lower() == "meta"), None)
    if nama_meta is None:
        return None
    cabang = None
    sheets: Dict[str, Tuple[str, int, int, str]] = {}
    for row in wb[nama_meta].iter_rows(values_only=True):
        a = str(row[0]).strip() if len(row) > 0 and row[0] is not None else ""
        b = str(row[1]).strip() if len(row) > 1 and row[1] is not None else ""
        c = str(row[2]).strip().upper() if len(row) > 2 and row[2] is not None else ""
        if not a:
            continue
        if a.lower() == "cabang" and b:
            cabang = b
            continue
        m = re.fullmatch(r"(\d{4})-(\d{2})", b)
        if m and 1 <= int(m.group(2)) <= 12:
            sheets[_norm_label(a)] = (a, int(m.group(1)), int(m.group(2)), c or "FINAL")
    if not sheets:
        return None
    return {"cabang": cabang, "sheets": sheets}


def _pilih_sheet_bulanan(wb, recipe: Dict[str, Any]) -> Tuple[List[Tuple[str, int, int]], List[str]]:
    """([(nama_sheet, tahun, bulan)], [peringatan]) -- sheet bulanan yang akan dibaca.
    Dengan META: hanya sheet berstatus FINAL; sheet di luar META / META tanpa sheet-nya
    dilaporkan. Tanpa META: aturan lama (nama sheet + recipe.tahun + periode_mulai/akhir),
    ditambah laporan untuk sheet yang namanya tidak dikenali (mis. 'Agustus 2026 (2)')."""
    nama_sheet = list(wb.sheetnames)
    peringatan: List[str] = []
    meta = _baca_meta_bulanan(wb)
    if meta is None:
        semua = _daftar_sheet_bulanan(nama_sheet, recipe)
        dikenal = {n for n, _, _ in semua}
        hasil = [(n, t, b) for n, t, b in semua if _periode_diizinkan(t, b, recipe)]
        for n in nama_sheet:
            if n not in dikenal and _norm_label(n) not in _SHEET_ABAIKAN:
                peringatan.append(
                    f"Sheet '{n.strip()}' tidak dikenali sebagai sheet bulanan (pola nama: 'Agustus 2026') -- diabaikan, bulan ini TIDAK ikut diimpor."
                )
        return hasil, peringatan

    ada = {_norm_label(n): n for n in nama_sheet}
    hasil = []
    for kunci, (raw, tahun, bulan, status) in meta["sheets"].items():
        asli = ada.get(kunci)
        if asli is None:
            if status == "FINAL":
                peringatan.append(f"Sheet '{raw}' terdaftar FINAL di META tetapi tidak ada di file -- bulan ini TIDAK ikut diimpor.")
            continue
        if status == "FINAL":
            hasil.append((asli, tahun, bulan))
    for n in nama_sheet:
        k = _norm_label(n)
        if k not in meta["sheets"] and k not in _SHEET_ABAIKAN:
            peringatan.append(f"Sheet '{n.strip()}' tidak terdaftar di sheet META -- diabaikan, tambahkan barisnya di META bila perlu diimpor.")
    cabang_recipe = recipe.get("cabang_tetap")
    if meta["cabang"] and cabang_recipe and _norm_label(meta["cabang"]) != _norm_label(cabang_recipe):
        peringatan.append(f"CABANG di META ('{meta['cabang']}') berbeda dari cabang template ('{cabang_recipe}') -- pastikan file ini benar.")
    hasil.sort(key=lambda x: (x[1], x[2]))
    return hasil, peringatan


def _baris_peringatan(hasil: List[Dict[str, Any]], cabang: Optional[str], pesan: str) -> None:
    """Tambah baris INVALID berisi pesan (dpp/ppn/total 0, tanpa tanggal & invoice) supaya
    masalah struktur file terlihat di Source Data (status 'Butuh Review') dan tidak ikut
    jadi invoice -- bukan hilang diam-diam."""
    hasil.append({
        "row_no": len(hasil) + 1, "tanggal": None, "no_invoice": None, "nama_customer": None,
        "cabang": cabang, "dpp": 0.0, "ppn": 0.0, "total": 0.0,
        "is_valid": False, "validation_notes": pesan, "is_duplicate_candidate": False,
    })


def _cocokkan_template_excel_bulanan(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_ExcelBulananSumber"]]:
    """Cocok kalau hash baris judul (header_row_index) SALAH SATU sheet bulanan
    sama dengan column_signature_hash varian, atau salah satu dari
    mapping_rules.signature_alternatif (judul lain yang sah, mis. judul yang
    berubah di tengah tahun). Sel kosong di ujung baris dibuang dulu karena
    lebar sheet beda-beda tiap bulan."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template bulanan: {e}")
        return None
    try:
        hash_per_baris: Dict[int, set] = {}
        for template in kandidat:
            recipe = template.get("mapping_rules") or {}
            idx = template["header_row_index"]
            if idx not in hash_per_baris:
                hashes = set()
                for nama in wb.sheetnames:
                    if _bulan_dari_nama_sheet(nama)[0] is None:
                        continue
                    baris = next(wb[nama].iter_rows(min_row=idx, max_row=idx, values_only=True), None)
                    if baris is None:
                        continue
                    sel = ["" if v is None else str(v) for v in baris]
                    while sel and not sel[-1].strip():
                        sel.pop()
                    if sel:
                        hashes.add(_hash_baris(sel))
                hash_per_baris[idx] = hashes
            diterima = {template["column_signature_hash"], *(recipe.get("signature_alternatif") or [])}
            if hash_per_baris[idx] & diterima:
                return template, _ExcelBulananSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel bulanan: {e}")
    finally:
        wb.close()
    return None


# ============================================================
# 3c) Excel MULTI-SHEET catatan penjualan manual (klien ABE)
# ============================================================
# Bentuk file: 1 workbook = beberapa sheet (Supermarket, cash, Permonth, COCO,
# Retur, ...), tiap sheet = 1 jalur penjualan/pelanggan dengan kolom berbeda-beda.
# TIDAK ada nomor invoice: 1 baris = 1 ITEM, tanggal hanya diisi di baris pertama
# tiap kelompok (baris di bawahnya kosong = ikut tanggal di atasnya), dan sel
# tanggal tercampur: sel bertipe tanggal yang SUDAH TERTUKAR hari<->bulan (Excel
# membaca "02/07/2026" sbg 7 Februari padahal 2 Juli) dan teks "22/7/2026" /
# "07/31/2026". Resepnya (mapping_rules.sheets) mendaftar tiap sheet sendiri-sendiri.
# 1 baris source_rows = 1 invoice = 1 (sheet, tanggal, pelanggan).

FORMAT_EXCEL_MULTI_SHEET = "multi_sheet_line_items"


def _sel_header_terpangkas(baris: Any, jumlah_kolom: Optional[int] = None) -> List[str]:
    sel = ["" if v is None else str(v) for v in (baris or [])]
    if jumlah_kolom:
        sel = sel[:jumlah_kolom]
    while sel and not sel[-1].strip():
        sel.pop()
    return sel


def _cari_sheet_multi(nama_sheet: List[str], target: str) -> Optional[str]:
    kunci = _norm_label(target)
    return next((n for n in nama_sheet if _norm_label(n) == kunci), None)


def _cocokkan_template_excel_multi_sheet(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_ExcelBulananSumber"]]:
    """Cocok kalau SALAH SATU sheet yang terdaftar di mapping_rules.sheets ada di
    workbook DAN hash baris header-nya (header_row_index sheet itu, dipotong
    `signature_kolom` kolom pertama, sel kosong di ujung dibuang) sama dengan
    `signature` sheet tersebut. Sheet lain yang hilang/berubah tidak membatalkan
    kecocokan -- ia dilaporkan oleh parser (bukan hilang diam-diam)."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template multi-sheet: {e}")
        return None
    try:
        for template in kandidat:
            for spec in (template.get("mapping_rules") or {}).get("sheets", []):
                nama = _cari_sheet_multi(list(wb.sheetnames), spec.get("sheet_name", ""))
                if nama is None:
                    continue
                idx = spec.get("header_row_index", 1)
                baris = next(wb[nama].iter_rows(min_row=idx, max_row=idx, values_only=True), None)
                if baris is None:
                    continue
                sel = _sel_header_terpangkas(baris, spec.get("signature_kolom"))
                if sel and _hash_baris(sel) == spec.get("signature"):
                    return template, _ExcelBulananSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel multi-sheet: {e}")
    finally:
        wb.close()
    return None


def _tanggal_sel_multi(v: Any, tukar_hari_bulan: bool) -> Tuple[Optional[date], Optional[str]]:
    """(tanggal, catatan_error) dari 1 sel tanggal. Sel bertipe tanggal: kalau
    tukar_hari_bulan, hari dan bulan DITUKAR (hanya bila hasilnya valid -- tanggal
    asli seperti 22 Juli tidak mungkin hasil salah-baca, jadi dibiarkan). Teks:
    bagian pertama > 12 -> DD/MM/YYYY, bagian kedua > 12 -> MM/DD/YYYY, keduanya
    <= 12 dan berbeda -> AMBIGU (invalid, tidak ditebak)."""
    if isinstance(v, (datetime, date)):
        d = v.date() if isinstance(v, datetime) else v
        if tukar_hari_bulan:
            try:
                return date(d.year, d.day, d.month), None
            except ValueError:
                return d, None
        return d, None
    teks = str(v).strip()
    m = re.fullmatch(r"(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})", teks)
    if m:
        a, b, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if a > 12 and b <= 12:
            hari, bulan = a, b
        elif b > 12 and a <= 12:
            hari, bulan = b, a
        elif a == b:
            hari, bulan = a, b
        elif a <= 12 and b <= 12:
            return None, f"Tanggal ambigu (DD/MM atau MM/DD): '{teks}'"
        else:
            return None, f"Tanggal tidak terbaca: '{teks}'"
        try:
            return date(y, bulan, hari), None
        except ValueError:
            return None, f"Tanggal tidak terbaca: '{teks}'"
    d = _parse_tanggal(teks, "YYYY-MM-DD")
    if d is not None:
        return d, None
    return None, f"Tanggal tidak terbaca: '{teks}'"


def _slug_invoice(teks: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", (teks or "").upper()).strip("-")[:40]


def _parse_multi_sheet_line_items(sumber: "_ExcelBulananSumber", template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser format_type='multi_sheet_line_items' (ABE). Per sheet terdaftar di
    mapping_rules.sheets: header diverifikasi (signature), tanggal dibawa ke baris
    di bawahnya yang kosong, baris tersembunyi (hasil filter) dan baris bernilai 0
    dilewati, lalu baris dijumlah per (tanggal, pelanggan) -> 1 invoice.
    Nomor invoice = <prefix_invoice>-YYYYMMDD[-<PELANGGAN>]. Sheet di luar daftar
    (mis. sheet pelanggan baru) dilaporkan sbg baris invalid, bukan hilang diam-diam."""
    import openpyxl

    recipe = template["mapping_rules"]
    number_format = recipe.get("number_format", {"thousands_separator": ",", "decimal_separator": "."})
    hasil: List[Dict[str, Any]] = []
    # BUKAN read_only: status baris tersembunyi (row_dimensions.hidden) tidak terbaca di mode itu.
    wb = openpyxl.load_workbook(BytesIO(sumber.content), data_only=True)
    try:
        terdaftar = {_norm_label(sp.get("sheet_name", "")) for sp in recipe.get("sheets", [])}
        abaikan_nama = {_norm_label(n) for n in recipe.get("sheet_abaikan", [])}
        if recipe.get("peringatan_sheet_tak_dikenal", True):
            for nama in wb.sheetnames:
                k = _norm_label(nama)
                if k not in terdaftar and k not in abaikan_nama:
                    _baris_peringatan(hasil, None, f"Sheet '{nama.strip()}' tidak dikenal di template -- TIDAK ikut diimpor. Tambahkan sheet ini ke template (atau ke sheet_abaikan) bila perlu.")
        seen_invoice = set()
        for spec in recipe.get("sheets", []):
            if spec.get("abaikan"):
                continue
            nama = _cari_sheet_multi(list(wb.sheetnames), spec.get("sheet_name", ""))
            if nama is None:
                continue  # file bulan ini memang tidak memuat sheet ini
            ws = wb[nama]
            cols = spec["columns"]
            baris_semua = list(ws.iter_rows(values_only=True))
            idx_h = spec.get("header_row_index", 1) - 1
            sel = _sel_header_terpangkas(baris_semua[idx_h] if 0 <= idx_h < len(baris_semua) else [], spec.get("signature_kolom"))
            if not sel or _hash_baris(sel) != spec.get("signature"):
                _baris_peringatan(hasil, spec.get("cabang_tetap"), f"Sheet '{nama.strip()}': header berubah dari template -- sheet ini TIDAK ikut diimpor.")
                continue
            tukar = spec.get("tanggal_tukar_hari_bulan", recipe.get("tanggal_tukar_hari_bulan", False))
            lewati_tersembunyi = spec.get("lewati_baris_tersembunyi", recipe.get("lewati_baris_tersembunyi", True))
            tanda = -1 if spec.get("tanda") == "negatif" else 1
            prefix = spec["prefix_invoice"]
            cabang = spec.get("cabang_tetap")
            customer_tetap = spec.get("customer_tetap")
            customer_prefix = spec.get("customer_prefix")

            agregat: Dict[Tuple[Any, str], Dict[str, Any]] = {}
            tgl_kini: Optional[date] = None
            tgl_catatan: Optional[str] = None
            for i in range(spec.get("data_start_row_index", 2) - 1, len(baris_semua)):
                row = list(baris_semua[i])
                mentah_tgl = row[cols["tanggal"] - 1] if cols["tanggal"] - 1 < len(row) else None
                if mentah_tgl is not None and str(mentah_tgl).strip() != "":
                    tgl_kini, tgl_catatan = _tanggal_sel_multi(mentah_tgl, tukar)
                # tanggal dibawa dulu, BARU baris tersembunyi dilewati (baris tersembunyi pertama bisa memuat tanggal)
                if lewati_tersembunyi and ws.row_dimensions[i + 1].hidden:
                    continue
                qty = _angka_sel(row[cols["qty"] - 1], number_format) if cols.get("qty") and cols["qty"] - 1 < len(row) else None
                harga = _angka_sel(row[cols["harga"] - 1], number_format) if cols.get("harga") and cols["harga"] - 1 < len(row) else None
                jumlah = _angka_sel(row[cols["jumlah"] - 1], number_format) if cols["jumlah"] - 1 < len(row) else None
                if jumlah is None and qty is not None and harga is not None:
                    jumlah = qty * harga  # sel total berumus belum terhitung (file disimpan tanpa Excel)
                if not jumlah:
                    continue  # baris kosong / total 0 (mis. harga belum diisi) -- tidak jadi invoice 0
                client = str(row[cols["client"] - 1]).strip() if cols.get("client") and cols["client"] - 1 < len(row) and row[cols["client"] - 1] is not None else ""
                if customer_tetap:
                    nama_customer, slug = customer_tetap, ""
                else:
                    nama_customer = (f"{customer_prefix} {client}".strip() if customer_prefix and client else client)
                    slug = _slug_invoice(client)
                kunci = (tgl_kini, _norm_label(nama_customer))
                a = agregat.get(kunci)
                if a is None:
                    a = agregat[kunci] = {"customer": nama_customer, "slug": slug, "dpp": 0.0, "catatan": []}
                    if tgl_kini is None:
                        a["catatan"].append(tgl_catatan or "Tanggal tidak terbaca")
                    if not nama_customer:
                        a["catatan"].append("Nama pelanggan kosong")
                a["dpp"] += tanda * jumlah
            for (tgl, _), a in agregat.items():
                no_invoice = None
                if tgl is not None and (a["slug"] or customer_tetap):
                    no_invoice = f"{prefix}-{tgl:%Y%m%d}" + (f"-{a['slug']}" if a["slug"] else "")
                catatan = list(a["catatan"])
                if no_invoice is None and not catatan:
                    catatan.append("No. invoice kosong")
                dpp = round(a["dpp"], 2)
                hasil.append({
                    "row_no": len(hasil) + 1,
                    "tanggal": tgl,
                    "no_invoice": no_invoice,
                    "nama_customer": a["customer"] or None,
                    "cabang": cabang,
                    "dpp": dpp,
                    "ppn": 0.0,
                    "total": dpp,
                    "is_valid": not catatan,
                    "validation_notes": "; ".join(catatan) or None,
                    "is_duplicate_candidate": bool(no_invoice) and no_invoice in seen_invoice,
                })
                if no_invoice:
                    seen_invoice.add(no_invoice)
    finally:
        wb.close()
    return hasil


# ============================================================
# 3d) Excel REGISTER INVOICE BERBLOK BULANAN (klien Birawa)
# ============================================================
# Bentuk file: 1 sheet (mis. "Sheet1") = register tagihan manual 1 tahun. Tiap bulan =
# 1 BLOK: baris header (diulang di tiap blok), lalu 1 baris per invoice, lalu baris
# kosong. Kolom BULAN (tanggal 1 bulan itu) hanya terisi di baris PERTAMA blok (sel
# gabungan) -> dibawa ke baris-baris di bawahnya. Nomor invoice ADA di file (kolom NO
# INVOICE), tapi tanggal invoice TIDAK ada -- hanya bulan -> tanggal = BULAN blok.
# Blok bulan depan sudah berisi nomor invoice urut tanpa nilai (placeholder) -> baris
# tanpa nilai dilewati diam-diam. Sheet lain di workbook (pivot/rekap) tidak dibaca.
# 1 baris source_rows = 1 baris register = 1 invoice.

FORMAT_EXCEL_REGISTER_BLOK = "monthly_block_invoice_register"


def _sel_dari_kolom(baris: Any, kolom_awal: int) -> List[str]:
    """Sel header mulai kolom `kolom_awal` (1-based), sel kosong di ujung dibuang --
    kolom A / kolom terakhir yang kosong (lebar sheet beda-beda) tidak ikut di-hash."""
    sel = ["" if v is None else str(v) for v in (baris or [])]
    return _sel_header_terpangkas(sel[max(kolom_awal, 1) - 1:])


def _cocokkan_template_excel_register_blok(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_ExcelBulananSumber"]]:
    """Cocok kalau sheet bernama template.sheet_name ada di workbook DAN hash baris
    header-nya (header_row_index, mulai mapping_rules.kolom_awal) sama dengan
    column_signature_hash template/varian."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template register blok: {e}")
        return None
    try:
        for template in kandidat:
            recipe = template.get("mapping_rules") or {}
            nama = _cari_sheet_multi(list(wb.sheetnames), template.get("sheet_name") or "")
            if nama is None:
                continue
            idx = template["header_row_index"]
            baris = next(wb[nama].iter_rows(min_row=idx, max_row=idx, values_only=True), None)
            if baris is None:
                continue
            sel = _sel_dari_kolom(baris, recipe.get("kolom_awal", 1))
            if sel and _hash_baris(sel) == template["column_signature_hash"]:
                return template, _ExcelBulananSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel register blok: {e}")
    finally:
        wb.close()
    return None


def _parse_monthly_block_invoice_register(sumber: "_ExcelBulananSumber", template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser format_type='monthly_block_invoice_register' (Birawa). Kolom dicari lewat
    NAMA di baris header (mapping_rules.kolom). Baris header yang diulang di tiap blok,
    baris tanpa nomor invoice (subtotal) dan baris tanpa nilai (placeholder bulan depan)
    dilewati. dasar='tagihan' : total = NILAI INVOICE, ppn = kolom PPN (dibulatkan 2 desimal), dpp = total - ppn
                                (invoice tagihan penuh, termasuk gaji yang ditagihkan ulang). Baris
                                dengan NILAI INVOICE kosong/0 dilewati, termasuk baris subtotal yang
                                hanya mengisi kolom turunan (mis. PPN) tanpa nomor invoice.
    dasar='fee'     : dpp = kolom FEE NET(DPP), ppn = kolom PPN, total = dpp + ppn."""
    import openpyxl

    recipe = template["mapping_rules"]
    kol = recipe["kolom"]
    number_format = recipe.get("number_format", {"thousands_separator": ",", "decimal_separator": "."})
    dasar = recipe.get("dasar", "tagihan")
    kolom_awal = recipe.get("kolom_awal", 1)
    hasil: List[Dict[str, Any]] = []
    wb = openpyxl.load_workbook(BytesIO(sumber.content), data_only=True, read_only=True)
    try:
        nama = _cari_sheet_multi(list(wb.sheetnames), template.get("sheet_name") or "")
        if nama is None:
            _baris_peringatan(hasil, None, f"Sheet '{template.get('sheet_name')}' tidak ada di file.")
            return hasil
        baris_semua = list(wb[nama].iter_rows(values_only=True))
        idx_h = template["header_row_index"] - 1
        header = _sel_dari_kolom(baris_semua[idx_h] if 0 <= idx_h < len(baris_semua) else [], kolom_awal)
        header_norm = [_norm_label(h) for h in header]

        def posisi(nama_kolom: str) -> int:
            try:
                return kolom_awal - 1 + header_norm.index(_norm_label(nama_kolom))
            except ValueError:
                raise ValueError(f"Kolom '{nama_kolom}' tidak ada di header sheet '{nama}'")

        i_bulan, i_inv, i_cust = posisi(kol["bulan"]), posisi(kol["invoice"]), posisi(kol["customer"])
        i_total = posisi(kol["total"]) if dasar == "tagihan" else None
        i_ppn = posisi(kol["ppn"])
        i_fee = posisi(kol["dpp"]) if dasar == "fee" else None
        lbl_bulan, lbl_inv = _norm_label(kol["bulan"]), _norm_label(kol["invoice"])

        def sel(row: List[Any], i: Optional[int]) -> Any:
            return row[i] if i is not None and i < len(row) else None

        tgl_kini: Optional[date] = None
        seen = set()
        for row in baris_semua[template["data_start_row_index"] - 1:]:
            mentah_bulan = sel(row, i_bulan)
            if isinstance(mentah_bulan, (datetime, date)):
                tgl_kini = mentah_bulan.date() if isinstance(mentah_bulan, datetime) else mentah_bulan
            elif mentah_bulan is not None and str(mentah_bulan).strip():
                if _norm_label(mentah_bulan) == lbl_bulan:
                    continue  # baris header yang diulang di tiap blok bulan
                d = _parse_tanggal(str(mentah_bulan), recipe.get("date_format", "YYYY-MM-DD"))
                if d is not None:
                    tgl_kini = d
            raw_inv = sel(row, i_inv)
            no_invoice = str(raw_inv).strip() if raw_inv is not None else ""
            if no_invoice and _norm_label(no_invoice) == lbl_inv:
                continue
            if dasar == "tagihan":
                total = round(_angka_sel(sel(row, i_total), number_format) or 0.0, 2)
                if not total:
                    # placeholder (nomor invoice urut tanpa nilai), baris kosong, atau baris SUBTOTAL
                    # yang hanya mengisi kolom turunan (mis. PPN) tanpa NILAI INVOICE -- bukan invoice.
                    continue
                ppn = round(_angka_sel(sel(row, i_ppn), number_format) or 0.0, 2)
                dpp = round(total - ppn, 2)  # ppn sudah dibulatkan -> dpp + ppn = total persis
            else:
                dpp = round(_angka_sel(sel(row, i_fee), number_format) or 0.0, 2)
                ppn = round(_angka_sel(sel(row, i_ppn), number_format) or 0.0, 2)
                total = round(dpp + ppn, 2)
                if not total and not dpp:
                    continue  # placeholder (nomor invoice urut tanpa nilai) / baris kosong
            customer = str(sel(row, i_cust) or "").strip()
            catatan = []
            if not no_invoice:
                catatan.append("No. invoice kosong")  # ada nilai tapi tanpa nomor (mis. baris subtotal salah letak)
            if tgl_kini is None:
                catatan.append("Tanggal tidak terbaca (kolom BULAN blok belum terisi)")
            if not customer:
                catatan.append("Nama pelanggan (BEBAN) kosong")
            hasil.append({
                "row_no": len(hasil) + 1,
                "tanggal": tgl_kini,
                "no_invoice": no_invoice or None,
                "nama_customer": customer or None,
                "cabang": (customer if recipe.get("cabang_dari_kolom_customer") else None),
                "dpp": dpp,
                "ppn": ppn,
                "total": total,
                "is_valid": not catatan,
                "validation_notes": "; ".join(catatan) or None,
                "is_duplicate_candidate": bool(no_invoice) and no_invoice in seen,
            })
            if no_invoice:
                seen.add(no_invoice)
    finally:
        wb.close()
    return hasil


# ============================================================
# 3e) Excel REKAP HARIAN PER CHANNEL OTA (klien WSI)
# ============================================================
# Bentuk file: 1 workbook = 1 PROPERTI (nama properti HANYA ada di NAMA FILE, mis.
# "HOTEL SALES RECAP - August Lime villa.xlsx"; isi sheet hanya memuat nama PT). 1 sheet
# = 1 channel/OTA (AIRBNB, BOOKING.COM, ...). Tiap sheet: kop beberapa baris, header
# (MONTH | INCOME BEFORE TAX | SERVICE FEE (INC VAT) | TOTAL RECEIVING | HOTEL TAX 10% |
# NET INCOME AFTER TAX), lalu 1 baris per HARI (tanggal bertipe tanggal, hari tanpa
# transaksi berisi 0/kosong), lalu baris total (posisinya beda tiap sheet/file).
# Kolom TOTAL RECEIVING, HOTEL TAX dan NET INCOME berisi RUMUS -- file yang disimpan
# tanpa Excel bisa tidak punya nilai hasil rumus, jadi pajak dihitung ulang dari
# INCOME BEFORE TAX bila selnya kosong. 1 baris source_rows = 1 HARI x 1 CHANNEL x 1
# PROPERTI yang nilainya tidak 0. Tidak ada nomor invoice -> dibentuk
# <prefix_invoice>-<PROPERTI>-<CHANNEL>-YYYYMMDD. Kolom dicari lewat NAMA header (bukan
# posisi), header dicari di N baris teratas, dan sheet channel baru (mis. AGODA) otomatis
# ikut terbaca selama headernya sama -- lihat docstring _parse_daily_channel_recap.

FORMAT_EXCEL_REKAP_CHANNEL = "daily_channel_recap"

# Alias nama kolom (dibandingkan sebagai AWALAN setelah huruf kecil & spasi dirapikan).
# Bisa ditambah/diganti per klien lewat mapping_rules.kolom_alias.
_REKAP_KOLOM_ALIAS = {
    "tanggal": ["month", "date", "tanggal", "tgl"],
    "dpp": ["income before tax", "income before", "revenue before tax"],
    "fee": ["service fee", "ota fee", "commission", "komisi"],
    "pajak": ["hotel tax", "pb1", "tax"],
}


def _baris_sheet(ws, maks_baris: Optional[int] = None) -> List[List[Any]]:
    """Baris sheet sebagai list. reset_dimensions(): sebagian software penulis Excel menulis
    dimensi sheet salah (mis. A1:A1) sehingga mode read_only hanya membaca sebagian kolom."""
    try:
        ws.reset_dimensions()
    except Exception:
        pass
    return [list(r) for r in ws.iter_rows(min_row=1, max_row=maks_baris, values_only=True)]


def _cari_header_rekap(rows: List[List[Any]], recipe: Dict[str, Any]) -> Optional[Tuple[int, Dict[str, int]]]:
    """(index_baris_header, {kunci: index_kolom}) -- baris header = baris pertama (dalam
    `maks_baris_header` baris teratas) yang memuat semua kolom wajib (default: tanggal + dpp).
    Satu kolom hanya dipakai satu kunci. Kop/baris kosong di atas header boleh bertambah/berkurang,
    urutan kolom boleh berubah, kolom tambahan boleh ada."""
    alias = {k: [_norm_label(a) for a in v] for k, v in _REKAP_KOLOM_ALIAS.items()}
    for k, v in (recipe.get("kolom_alias") or {}).items():
        alias[k] = [_norm_label(a) for a in v]
    wajib = recipe.get("kolom_wajib") or ["tanggal", "dpp"]
    maks = int(recipe.get("maks_baris_header") or 15)
    for i, row in enumerate(rows[:maks]):
        peta: Dict[str, int] = {}
        dipakai = set()
        for kunci in ("tanggal", "dpp", "fee", "pajak"):
            for j, v in enumerate(row):
                if j in dipakai or not isinstance(v, str):
                    continue
                label = _norm_label(v)
                if label and any(label.startswith(a) for a in alias.get(kunci, []) if a):
                    peta[kunci] = j
                    dipakai.add(j)
                    break
        if all(k in peta for k in wajib):
            return i, peta
    return None


def _cocokkan_template_excel_rekap_channel(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_ExcelBulananSumber"]]:
    """Cocok kalau SALAH SATU sheet di workbook (selain sheet_abaikan) punya baris header yang
    memuat kolom wajib resep (lihat _cari_header_rekap). column_signature_hash varian tetap
    diisi di seed (NOT NULL + dokumentasi header contoh), tetapi pencocokan memakai LABEL kolom,
    bukan hash persis, supaya perubahan kecil (urutan kolom, 'HOTEL TAX 11%', kolom tambahan,
    kop bertambah) tidak membuat file jatuh ke 'Butuh Review'."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template rekap channel: {e}")
        return None
    try:
        for template in kandidat:
            recipe = template.get("mapping_rules") or {}
            abaikan = {_norm_label(n) for n in recipe.get("sheet_abaikan", [])}
            maks = int(recipe.get("maks_baris_header") or 15)
            for nama in wb.sheetnames:
                if _norm_label(nama) in abaikan:
                    continue
                if _cari_header_rekap(_baris_sheet(wb[nama], maks), recipe) is not None:
                    return template, _ExcelBulananSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel rekap channel: {e}")
    finally:
        wb.close()
    return None


def _properti_dari_nama_file(recipe: Dict[str, Any], file_name: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """(nama_properti, catatan) dari NAMA FILE. 1) daftar recipe.properti [{nama, cocok:[kata,...]}]
    -- nama kanonis (HURUF BESAR, dipakai sbg cabang & kunci pendapatan_account_by_cabang) dipilih
    kalau salah satu kata ada di nama file; 2) cadangan recipe.properti_dari_nama_file {pattern,
    group}: properti yang belum terdaftar tetap terbaca (diberi catatan peringatan). Tidak ketemu
    -> (None, None)."""
    if not file_name:
        return None, None
    stem = file_name.replace(chr(92), "/").split("/")[-1].rsplit(".", 1)[0].strip()
    norm = re.sub(r"[\s_\-]+", " ", stem.lower())
    for p in recipe.get("properti", []):
        if any(k and k.lower() in norm for k in p.get("cocok", [])):
            return str(p["nama"]).strip().upper(), None
    aturan = recipe.get("properti_dari_nama_file")
    if aturan:
        m = re.search(aturan["pattern"], stem, re.IGNORECASE)
        nama = " ".join((m.group(aturan.get("group", 1)) or "").replace("_", " ").split()).upper() if m else ""
        if nama:
            return nama[:100], f"Properti '{nama}' belum terdaftar di template (dibaca dari nama file) -- akun pendapatan memakai akun default; daftarkan di 'properti' bila perlu"
    return None, None


def _channel_dari_sheet(nama: str, rows: List[List[Any]], recipe: Dict[str, Any]) -> str:
    """Nama channel/OTA dari nama sheet (recipe.channel bisa memetakan alias -> nama baku).
    Sheet bernama generik (Sheet1, Data) -> dari judul di baris atas ('AIRBNB SALES RECAPITULATION')."""
    # "AIRBNB (2)" / "AIRBNB - Copy" (sheet salinan) -> channel yang sama, supaya nomor invoice-nya bentrok & terdeteksi ganda
    nama = re.sub(r"\s*(\(\s*(?:\d+|copy)\s*\)|[-_ ]\s*copy(?:\s*\d+)?)\s*$", "", nama or "", flags=re.IGNORECASE)
    peta = {_norm_label(k): v for k, v in (recipe.get("channel") or {}).items()}
    k = _norm_label(nama)
    if k in peta:
        return str(peta[k]).strip().upper()
    if re.fullmatch(r"(sheet|worksheet|lembar|data)\s*\d*", k):
        for row in rows[:5]:
            for v in row[:1]:
                judul = re.sub(r"\s*sales\s+recapitulation\s*$", "", _norm_label(v))
                if judul and not re.search(r"\d", judul):
                    return judul.upper()
    return (nama or "").strip().upper()


def _bulatkan_pajak(dpp: float, tarif: Decimal) -> Decimal:
    """Pembulatan seperti ROUND() Excel (setengah ke atas): 4.662.625 x 10% = 466.262,5 -> 466.263.
    round() Python membulatkan ke genap (466.262) -- selisih 1 rupiah per hari."""
    return (Decimal(str(dpp)) * tarif).quantize(Decimal("1"), rounding=ROUND_HALF_UP)


def _parse_daily_channel_recap(sumber: "_ExcelBulananSumber", template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Parser format_type='daily_channel_recap' (WSI -- rekap penjualan hotel per channel OTA).
    Per sheet: header dicari lewat nama kolom; tiap baris bertanggal dengan INCOME BEFORE TAX
    != 0 jadi 1 invoice. dpp = INCOME BEFORE TAX, ppn = HOTEL TAX (nilai di file; kosong ->
    tarif_pajak x dpp, dibulatkan setengah-ke-atas), total = dpp + ppn. Opsi resep:
      prefix_invoice               awalan nomor invoice (wajib)
      properti / properti_dari_nama_file   properti dari nama file (lihat _properti_dari_nama_file)
      channel                      {alias sheet: nama baku} -> nama customer
      sheet_abaikan                sheet yang dilewati tanpa peringatan (mis. SUMMARY)
      tarif_pajak                  default 0.10
      fee_mengurangi_dpp           true -> dpp = INCOME - SERVICE FEE (OTA netto); default false
      pajak_termasuk_dalam_income  true -> dpp = INCOME - pajak, total = INCOME; default false
      lewati_nol                   hari bernilai 0 dilewati (default true)
      toleransi_selisih            batas selisih rupiah utk cek total/pajak (default 1)
      kolom_alias / kolom_wajib / maks_baris_header   lihat _cari_header_rekap
    Yang TIDAK diam-diam: sheet tanpa header dikenal, sheet tersembunyi, baris tanpa tanggal bernilai,
    tanggal tidak terbaca, isi sel bukan angka, income negatif, total file != jumlah harian
    muncul sbg baris invalid (status 'Butuh Review'); pajak di file != tarif x income dan nomor
    invoice ganda hanya diberi catatan."""
    recipe = template["mapping_rules"]
    nf = recipe.get("number_format", {"thousands_separator": ",", "decimal_separator": "."})
    prefix = recipe["prefix_invoice"]
    tarif = Decimal(str(recipe.get("tarif_pajak", 0.10)))
    fee_kurang = bool(recipe.get("fee_mengurangi_dpp", False))
    pajak_termasuk = bool(recipe.get("pajak_termasuk_dalam_income", False))
    lewati_nol = recipe.get("lewati_nol", True)
    toleransi = float(recipe.get("toleransi_selisih", 1.0))
    tukar = bool(recipe.get("tanggal_tukar_hari_bulan", False))
    abaikan = {_norm_label(n) for n in recipe.get("sheet_abaikan", [])}

    hasil: List[Dict[str, Any]] = []
    cabang, catatan_properti = _properti_dari_nama_file(recipe, file_name)
    if cabang is None:
        _baris_peringatan(hasil, None, "Nama properti tidak terbaca dari NAMA FILE (mis. 'HOTEL SALES RECAP - August Lime villa.xlsx') -- file TIDAK diimpor supaya nomor invoice antar properti tidak bentrok. Perbaiki nama file lalu upload ulang, atau daftarkan properti di template.")
        return hasil
    slug_properti = _slug_invoice(cabang)

    def baris_invalid(tanggal, no_invoice, customer, dpp, ppn, pesan):
        hasil.append({
            "row_no": len(hasil) + 1, "tanggal": tanggal, "no_invoice": no_invoice, "nama_customer": customer,
            "cabang": cabang, "dpp": round(dpp, 2), "ppn": round(ppn, 2), "total": round(dpp + ppn, 2),
            "is_valid": False, "validation_notes": pesan, "is_duplicate_candidate": False,
        })

    sudah_ada = set()
    wb = _buka_workbook_bulanan(sumber.content)
    try:
        for nama in wb.sheetnames:
            if _norm_label(nama) in abaikan:
                continue
            ws = wb[nama]
            rows = _baris_sheet(ws)
            if not any(str(v).strip() for r in rows for v in r if v is not None):
                continue  # sheet kosong (mis. Sheet1 bawaan) -- bukan masalah
            header = _cari_header_rekap(rows, recipe)
            if header is None:
                _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}': header rekap (kolom tanggal & 'Income Before Tax') tidak ditemukan -- sheet ini TIDAK ikut diimpor. Tambahkan nama sheet ke sheet_abaikan di template bila memang bukan data penjualan.")
                continue
            if getattr(ws, "sheet_state", "visible") != "visible":
                _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}' tersembunyi -- TIDAK ikut diimpor. Tampilkan sheet-nya bila datanya memang harus masuk.")
                continue
            idx_h, peta = header
            channel = _channel_dari_sheet(nama, rows, recipe)
            slug_channel = _slug_invoice(channel)
            c_tgl, c_dpp, c_fee, c_pajak = peta["tanggal"], peta["dpp"], peta.get("fee"), peta.get("pajak")
            jumlah_harian = 0.0
            ada_baris = False

            def sel(row, c):
                return row[c] if c is not None and c < len(row) else None

            for i in range(idx_h + 1, len(rows)):
                row = rows[i]
                mentah_tgl, mentah_dpp = sel(row, c_tgl), sel(row, c_dpp)
                teks_tgl = str(mentah_tgl).strip() if mentah_tgl is not None else ""
                dpp_v = _angka_sel(mentah_dpp, nf)
                sedang = f"Sheet '{nama.strip()}' baris {i + 1}"
                label_total = bool(teks_tgl) and not isinstance(mentah_tgl, (datetime, date)) and bool(
                    re.match(r"^(grand\s+)?(total|jumlah|sum)\b", teks_tgl, re.IGNORECASE))

                # --- baris tanpa tanggal / baris total ---
                if not teks_tgl or label_total:
                    if dpp_v is None or dpp_v == 0:
                        continue  # baris kosong / rumus bernilai 0 di bawah data
                    if abs(dpp_v - jumlah_harian) > toleransi:
                        baris_invalid(None, None, channel, 0.0, 0.0,
                                      f"{sedang}: baris tanpa tanggal bernilai {dpp_v:,.2f} tidak sama dengan jumlah baris harian {jumlah_harian:,.2f} -- bila ini total, ada hari yang hilang/rusak; bila bukan, isi tanggalnya. Baris ini TIDAK diimpor.")
                    continue  # sama dengan jumlah harian = baris total

                # --- baris harian ---
                tgl, cat_tgl = _tanggal_sel_multi(mentah_tgl, tukar)
                fee_v = _angka_sel(sel(row, c_fee), nf)
                pajak_v = _angka_sel(sel(row, c_pajak), nf)
                bukan_angka = [lbl for lbl, mentah, v in (("Income Before Tax", mentah_dpp, dpp_v), ("Service Fee", sel(row, c_fee), fee_v), ("Hotel Tax", sel(row, c_pajak), pajak_v))
                               if v is None and isinstance(mentah, str) and re.search(r"\d", mentah)]
                if bukan_angka:
                    baris_invalid(tgl, None, channel, 0.0, 0.0, f"{sedang}: isi kolom {', '.join(bukan_angka)} bukan angka yang valid -- hari ini TIDAK diimpor.")
                    continue
                dpp_v = dpp_v or 0.0
                fee_v = fee_v or 0.0
                if dpp_v == 0 and fee_v == 0 and not pajak_v:
                    if lewati_nol:
                        continue
                if tgl is None:
                    baris_invalid(None, None, channel, dpp_v, 0.0, f"{sedang}: {cat_tgl or 'Tanggal tidak terbaca'}")
                    continue
                if dpp_v == 0:
                    baris_invalid(tgl, None, channel, 0.0, 0.0, f"{sedang}: Income Before Tax 0/kosong tetapi Service Fee/Hotel Tax terisi -- periksa baris ini.")
                    continue
                jumlah_harian += dpp_v

                catatan: List[str] = []
                pajak_hitung = _bulatkan_pajak(dpp_v, tarif)
                if pajak_v is None:
                    pajak_d = pajak_hitung  # sel rumus tanpa nilai tersimpan / kolom tidak ada
                else:
                    pajak_d = Decimal(str(pajak_v))
                    if abs(float(pajak_d - pajak_hitung)) > toleransi:
                        catatan.append(f"Hotel Tax di file {pajak_v:,.2f} tidak sama dengan {tarif * 100:.0f}% x Income ({pajak_hitung:,.2f}) -- periksa")
                if dpp_v > 0 and (fee_v < 0 or fee_v > dpp_v):
                    catatan.append(f"Service Fee {fee_v:,.2f} di luar kewajaran (negatif atau melebihi Income)")
                dpp_d = Decimal(str(dpp_v))
                if fee_kurang:
                    dpp_d -= Decimal(str(fee_v))
                if pajak_termasuk:
                    dpp_d -= pajak_d
                dpp = round(float(dpp_d), 2)
                ppn = round(float(pajak_d), 2)
                no_invoice = f"{prefix}-{slug_properti}-{slug_channel}-{tgl:%Y%m%d}"
                valid = True
                if dpp < 0:
                    valid = False
                    catatan.append("Income negatif (periksa pembatalan/refund)")
                if catatan_properti:
                    catatan.append(catatan_properti)
                ganda = no_invoice in sudah_ada
                if ganda:
                    catatan.append(f"No. invoice '{no_invoice}' muncul >1 kali di file ini (sheet channel dobel?)")
                hasil.append({
                    "row_no": len(hasil) + 1, "tanggal": tgl, "no_invoice": no_invoice, "nama_customer": channel,
                    "cabang": cabang, "dpp": dpp, "ppn": ppn, "total": round(dpp + ppn, 2),
                    "is_valid": valid, "validation_notes": "; ".join(catatan) or None, "is_duplicate_candidate": ganda,
                })
                sudah_ada.add(no_invoice)
                ada_baris = True
            if not ada_baris:
                continue  # channel tanpa transaksi bulan ini (mis. BOOKING.COM semua 0) -- wajar
    finally:
        wb.close()
    return hasil


# ============================================================
# 3f) Excel DAFTAR INCOME BULANAN (klien YM -- PT Yoniso Manasikara)
# ============================================================
# Bentuk file: 1 workbook = beberapa sheet, tiap sheet = 1 BULAN (nama sheet "0826",
# "0226 YANG DI PAKAI", "Jan 26", "Maret 26"), 1 baris = 1 tamu = 1 invoice. TIDAK ada nomor
# invoice (dibentuk dari prefix + tanggal + nama tamu). Header dicari lewat LABEL kolom
# ("Date of invoice", "Name", ...), baris total ada di bawah data, dan satu bulan bisa punya
# 2 sheet (mis. "0826" dan "0826 YANG DI PAKAI" -- yang dipakai adalah versi akhirnya).
# Dua varian resep memakai parser yang sama: INCOME LIST (xlsx, kolom "Total" dalam Rp) dan
# "Pemasukan" (xls, kolom "Total Rp" + "total EUR" untuk pembayaran cash). File .xls dikonversi
# dulu ke .xlsx oleh _pastikan_xlsx().

FORMAT_EXCEL_INCOME_LIST = "monthly_income_list"

_INCOME_LIST_ALIAS = {
    "tanggal": ["date of invoice", "invoice date", "tanggal invoice", "tgl invoice", "tanggal", "date"],
    "nama": ["name", "nama", "nama tamu", "guest", "guest name", "customer", "pelanggan"],
    "total": ["total"],
    "total_rp": ["total rp", "total idr", "total (rp)", "jumlah rp"],
    "total_eur": ["total €", "total eur", "total euro", "total (€)"],
    "part_diving": ["part diving", "diving"],
    "part_room": ["part r&b&s", "part rbs", "part room", "part r b s"],
    "extra": ["extra income", "income extra", "extra"],
}


def _label_income(v: Any) -> str:
    return _norm_label(v).rstrip(" .:")


def _alias_income(recipe: Dict[str, Any]) -> Dict[str, List[str]]:
    alias = {k: [_label_income(a) for a in v] for k, v in _INCOME_LIST_ALIAS.items()}
    for k, v in (recipe.get("kolom_alias") or {}).items():
        alias[k] = [_label_income(a) for a in v]
    return alias


def _cari_header_income(rows: List[List[Any]], recipe: Dict[str, Any]) -> Optional[Tuple[int, Dict[str, int]]]:
    """(index_baris_header, {kunci: index_kolom}) -- baris header = baris pertama (dalam
    `maks_baris_header` baris teratas, default 15) yang memuat semua kolom `kolom_wajib` (default
    tanggal + nama). Label dicocokkan PERSIS (huruf besar/kecil, spasi ganda dan titik di ujung
    diabaikan) supaya \"Total\" tidak tertukar dengan \"Total Rp\"/\"Total EUR\". Urutan kolom
    bebas, kolom tambahan boleh ada, kop di atas header boleh bertambah/berkurang."""
    alias = _alias_income(recipe)
    wajib = recipe.get("kolom_wajib") or ["tanggal", "nama"]
    maks = int(recipe.get("maks_baris_header") or 15)
    for i, row in enumerate(rows[:maks]):
        peta: Dict[str, int] = {}
        dipakai = set()
        for kunci, daftar in alias.items():
            for j, v in enumerate(row):
                if j in dipakai or not isinstance(v, str):
                    continue
                if _label_income(v) in daftar:
                    peta[kunci] = j
                    dipakai.add(j)
                    break
        if all(k in peta for k in wajib):
            return i, peta
    return None


def _cocokkan_template_excel_income_list(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_ExcelBulananSumber"]]:
    """Cocok kalau SALAH SATU sheet (selain sheet_abaikan) punya baris header yang memuat
    `kolom_wajib` resep. Kandidat dicoba berurutan (urutan array variants): varian yang
    kolom_wajibnya lebih ketat harus ditaruh lebih dulu. column_signature_hash hanya dokumentasi."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template income list: {e}")
        return None
    try:
        for template in kandidat:
            recipe = template.get("mapping_rules") or {}
            abaikan = {_norm_label(n) for n in recipe.get("sheet_abaikan", [])}
            maks = int(recipe.get("maks_baris_header") or 15)
            for nama in wb.sheetnames:
                if _norm_label(nama) in abaikan:
                    continue
                if _cari_header_income(_baris_sheet(wb[nama], maks), recipe) is not None:
                    return template, _ExcelBulananSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel income list: {e}")
    finally:
        wb.close()
    return None


def _periode_sheet_income(nama: str) -> Optional[Tuple[int, int]]:
    """(tahun, bulan) dari nama sheet: \"0826\" / \"0226 YANG DI PAKAI\" (BBTT di depan) atau
    \"Jan 26\" / \"Maret 26\" / \"Agustus 2026\". Tidak dikenali -> None (sheet dianggap grup sendiri)."""
    m = re.match(r"^\s*(\d{2})(\d{2})(?!\d)", nama or "")
    if m and 1 <= int(m.group(1)) <= 12:
        return 2000 + int(m.group(2)), int(m.group(1))
    bulan, tahun = _bulan_dari_nama_sheet(nama)
    if bulan is not None and tahun is not None:
        return tahun, bulan
    return None


def _skor_sheet_income(nama: str, recipe: Dict[str, Any]) -> int:
    """Skor pilihan antar sheet dari bulan yang sama. recipe.sheet_prioritas_kata (kata di nama
    sheet, spasi diabaikan, yang paling awal = paling diutamakan; default \"yang dipakai\",
    \"pembetulan\") -> skor positif; recipe.sheet_prioritas_rendah_kata (default \"sesuai klien\")
    -> -1; sisanya 0. Skor sama -> sheet yang lebih dulu di workbook."""
    kunci = re.sub(r"\s+", "", (nama or "").lower())
    tinggi = [re.sub(r"\s+", "", k.lower()) for k in recipe.get("sheet_prioritas_kata", ["yang dipakai", "pembetulan"])]
    for i, k in enumerate(tinggi):
        if k and k in kunci:
            return len(tinggi) - i
    rendah = [re.sub(r"\s+", "", k.lower()) for k in recipe.get("sheet_prioritas_rendah_kata", ["sesuai klien"])]
    if any(k and k in kunci for k in rendah):
        return -1
    return 0


def _tanggal_income_list(v: Any, tukar: bool) -> Tuple[Optional[date], Optional[str]]:
    """Tanggal dari 1 sel: sel tanggal; teks ISO (2026-08-05); teks DD/MM/YYYY dengan pemisah
    campur/berlebih (\"12./02/2026\", \"27-03-2026\"). Teks yang ambigu (05/02/2026) dibaca
    DD/MM -- konvensi Indonesia -- bukan ditolak seperti _tanggal_sel_multi."""
    if isinstance(v, (datetime, date)):
        return _tanggal_sel_multi(v, tukar)
    teks = str(v).strip()
    m = re.fullmatch(r"(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?", teks)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3))), None
        except ValueError:
            return None, f"Tanggal tidak terbaca: '{teks}'"
    rapi = re.sub(r"[\s./\-]+", "/", teks).strip("/")
    d, cat = _tanggal_sel_multi(rapi, False)
    if d is not None:
        return d, None
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})", rapi)
    if m:
        tahun = int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)
        try:
            return date(tahun, int(m.group(2)), int(m.group(1))), None
        except ValueError:
            pass
    return None, cat or f"Tanggal tidak terbaca: '{teks}'"


def _parse_monthly_income_list(sumber: "_ExcelBulananSumber", template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser format_type='monthly_income_list' (YM). 1 baris bernama tamu + bernilai = 1 invoice:
      invoice  = <prefix_invoice>-YYYYMMDD-<NAMA TAMU>   (-2, -3 bila tamu & tanggal sama tapi nilai beda)
      customer = nama tamu (spasi dirapikan), cabang = recipe.cabang_tetap (default kosong)
      dpp      = kolom nilai.kolom_total; kosong -> jumlah nilai.kolom_komponen; ppn = 0; total = dpp
    Opsi resep (semua opsional kecuali prefix_invoice):
      nilai                    {\"kolom_total\": \"total\", \"kolom_komponen\": [\"part_diving\", \"part_room\", \"extra\"]}
      valuta_asing             {\"kolom\": \"total_eur\", \"kurs\": null} -- baris yang memuat nilai valuta asing:
                               kurs diisi -> nilai += asing x kurs; kurs kosong -> baris INVALID (tidak ditebak)
      kolom_alias / kolom_wajib / maks_baris_header   lihat _cari_header_income
      sheet_abaikan            sheet yang dilewati diam-diam (default: Sheet1, Rekap, Summary)
      sheet_tersembunyi        \"abaikan\" (default, diam-diam) | \"peringatan\" | \"impor\"
      sheet_prioritas_kata / sheet_prioritas_rendah_kata   lihat _skor_sheet_income
      periode_mulai / periode_akhir   \"YYYY-MM\", sheet di luar rentang dilewati
      lewati_nol (true), toleransi_selisih (1.0), tanggal_tukar_hari_bulan (false), cabang_tetap
    Yang TIDAK diam-diam (baris invalid, status 'Butuh Review'): sheet tanpa header dikenal, tanggal
    tidak terbaca, nilai negatif / bukan angka, nilai valuta asing tanpa kurs, rumus yang belum
    dihitung (file belum dibuka di Excel), baris tanpa nama yang bukan total, total file != jumlah
    baris. Hanya catatan: tanggal di luar bulan sheet, baris identik (nomor invoice sama)."""
    import openpyxl

    recipe = template["mapping_rules"]
    nf = recipe.get("number_format", {"thousands_separator": ",", "decimal_separator": "."})
    prefix = recipe["prefix_invoice"]
    cabang = recipe.get("cabang_tetap")
    nilai_cfg = recipe.get("nilai") or {"kolom_total": "total", "kolom_komponen": ["part_diving", "part_room", "extra"]}
    kunci_total = nilai_cfg.get("kolom_total")
    kunci_komponen = list(nilai_cfg.get("kolom_komponen") or [])
    asing = recipe.get("valuta_asing") or {}
    kunci_asing, kurs = asing.get("kolom"), asing.get("kurs")
    lewati_nol = recipe.get("lewati_nol", True)
    toleransi = float(recipe.get("toleransi_selisih", 1.0))
    tukar = bool(recipe.get("tanggal_tukar_hari_bulan", False))
    mode_tersembunyi = recipe.get("sheet_tersembunyi", "abaikan")
    abaikan = {_norm_label(n) for n in recipe.get("sheet_abaikan", ["Sheet1", "Rekap", "Summary"])}

    hasil: List[Dict[str, Any]] = []

    def baris_invalid(tgl, no_invoice, customer, dpp, pesan):
        hasil.append({
            "row_no": len(hasil) + 1, "tanggal": tgl, "no_invoice": no_invoice, "nama_customer": customer,
            "cabang": cabang, "dpp": round(dpp, 2), "ppn": 0.0, "total": round(dpp, 2),
            "is_valid": False, "validation_notes": pesan, "is_duplicate_candidate": False,
        })

    wb = _buka_workbook_bulanan(sumber.content)
    rumus_wb = None  # workbook TANPA data_only -- dibuka hanya kalau ada sel nilai kosong yang perlu dicek rumusnya
    try:
        # --- 1) sheet yang dibaca: header dikenal, tidak tersembunyi, 1 sheet terbaik per bulan ---
        kandidat: List[Dict[str, Any]] = []
        tersembunyi_cocok = 0
        for urut, nama in enumerate(wb.sheetnames):
            if _norm_label(nama) in abaikan:
                continue
            ws = wb[nama]
            rows = _baris_sheet(ws)
            if not any(str(v).strip() for r in rows for v in r if v is not None):
                continue  # sheet kosong
            sembunyi = getattr(ws, "sheet_state", "visible") != "visible"
            if sembunyi and mode_tersembunyi == "abaikan":
                if _cari_header_income(rows, recipe) is not None:
                    tersembunyi_cocok += 1
                continue
            header = _cari_header_income(rows, recipe)
            if header is None:
                baris_invalid(None, None, None, 0.0, f"Sheet '{nama.strip()}': header (kolom tanggal & nama tamu) tidak ditemukan -- sheet ini TIDAK ikut diimpor. Tambahkan nama sheet ke sheet_abaikan di template bila memang bukan data penjualan.")
                continue
            if sembunyi and mode_tersembunyi == "peringatan":
                baris_invalid(None, None, None, 0.0, f"Sheet '{nama.strip()}' tersembunyi -- TIDAK ikut diimpor. Tampilkan sheet-nya bila datanya memang harus masuk.")
                continue
            periode = _periode_sheet_income(nama)
            if periode is not None and not _periode_diizinkan(periode[0], periode[1], recipe):
                continue
            kandidat.append({"nama": nama, "urut": urut, "rows": rows, "header": header, "periode": periode, "skor": _skor_sheet_income(nama, recipe)})

        terbaik: Dict[Any, Dict[str, Any]] = {}
        for k in kandidat:
            kunci = k["periode"] or ("nama", _norm_label(k["nama"]))
            if kunci not in terbaik or k["skor"] > terbaik[kunci]["skor"]:
                terbaik[kunci] = k
        dibaca = sorted(terbaik.values(), key=lambda k: (k["periode"] or (9999, 99), k["urut"]))
        if not dibaca and tersembunyi_cocok:
            baris_invalid(None, None, None, 0.0, f"Semua sheet data ({tersembunyi_cocok} sheet) tersembunyi -- TIDAK ada yang diimpor. Tampilkan sheet bulan yang harus diimpor lalu upload ulang.")

        # --- 2) baca tiap sheet terpilih ---
        nomor_per_dasar: Dict[str, List[float]] = {}
        for k in dibaca:
            nama, rows, (idx_h, peta), periode = k["nama"], k["rows"], k["header"], k["periode"]
            c_tgl, c_nama = peta["tanggal"], peta["nama"]
            c_total = peta.get(kunci_total) if kunci_total else None
            c_komp = [peta[x] for x in kunci_komponen if x in peta]
            c_asing = peta.get(kunci_asing) if kunci_asing else None
            if c_total is None and not c_komp:
                baris_invalid(None, None, None, 0.0, f"Sheet '{nama.strip()}': kolom nilai ('{kunci_total}' atau komponennya) tidak ada di header -- sheet ini TIDAK ikut diimpor.")
                continue

            def sel(row, c):
                return row[c] if c is not None and c < len(row) else None

            def nilai_baris(row):
                v = _angka_sel(sel(row, c_total), nf)
                if v is None and c_komp:
                    bagian = [_angka_sel(sel(row, c), nf) for c in c_komp]
                    if any(b is not None for b in bagian):
                        v = sum(b or 0.0 for b in bagian)
                return v

            def rumus_belum_dihitung(i_baris):
                """True kalau salah satu sel nilai baris ini kosong di data_only TAPI berisi rumus."""
                nonlocal rumus_wb
                if rumus_wb is None:
                    rumus_wb = openpyxl.load_workbook(BytesIO(sumber.content), data_only=False, read_only=True)
                cache = k.setdefault("rumus_rows", None)
                if cache is None:
                    cache = k["rumus_rows"] = _baris_sheet(rumus_wb[nama])
                if i_baris >= len(cache):
                    return False
                return any(isinstance(sel(cache[i_baris], c), str) and sel(cache[i_baris], c).lstrip().startswith("=")
                           for c in ([c_total] if c_total is not None else []) + c_komp)

            jumlah_utama = 0.0
            for i in range(idx_h + 1, len(rows)):
                row = rows[i]
                mentah_tgl = sel(row, c_tgl)
                teks_tgl = str(mentah_tgl).strip() if mentah_tgl is not None else ""
                nama_tamu = " ".join(str(sel(row, c_nama)).split()) if sel(row, c_nama) is not None else ""
                nilai = nilai_baris(row)
                sedang = f"Sheet '{nama.strip()}' baris {i + 1}"
                label_total = bool(teks_tgl) and not isinstance(mentah_tgl, (datetime, date)) and bool(
                    re.match(r"^(grand\s+)?(total|jumlah|sum)\b", teks_tgl, re.IGNORECASE))

                # --- baris total / baris tanpa nama ---
                # Baris total = akhir data sheet: blok ringkasan/pajak di bawahnya (label di kolom A, angka di
                # kolom B) TIDAK dibaca -- kalau tidak, angkanya terbaca sebagai tamu.
                if label_total or not nama_tamu:
                    if not nilai:
                        if label_total:
                            break
                        continue  # baris kosong / rumus bernilai 0
                    if abs(nilai - jumlah_utama) <= toleransi:
                        break  # = jumlah baris di atasnya -> baris total, data selesai
                    if label_total:
                        baris_invalid(None, None, None, 0.0, f"{sedang}: total di file {nilai:,.2f} tidak sama dengan jumlah baris {jumlah_utama:,.2f} -- ada baris yang hilang/rusak? Baris ini TIDAK diimpor.")
                        break
                    else:
                        baris_invalid(None, None, None, nilai, f"{sedang}: baris tanpa nama tamu bernilai {nilai:,.2f} dan bukan total (jumlah baris di atasnya {jumlah_utama:,.2f}) -- isi nama tamunya. Baris ini TIDAK diimpor.")
                    continue

                # --- baris tamu ---
                asing_v = _angka_sel(sel(row, c_asing), nf) if c_asing is not None else None
                if nilai is not None:
                    jumlah_utama += nilai
                if not teks_tgl and not nilai and not asing_v:
                    continue  # hanya nama, tanpa tanggal & nilai
                tgl, cat_tgl = _tanggal_income_list(mentah_tgl, tukar) if teks_tgl else (None, "Tanggal kosong")
                catatan: List[str] = []
                total_v = nilai or 0.0
                if asing_v:
                    if kurs:
                        total_v += asing_v * float(kurs)
                        catatan.append(f"nilai {asing_v:,.2f} ({kunci_asing}) dikonversi kurs {float(kurs):,.2f}")
                    else:
                        baris_invalid(tgl, None, nama_tamu, total_v, f"{sedang} ({nama_tamu}): memuat nilai valuta asing {asing_v:,.2f} tanpa kurs di template -- TIDAK diimpor (nilainya tidak ditebak). Isi 'kurs' di resep 'valuta_asing' atau pakai file Income List dalam Rupiah.")
                        continue
                if nilai is None and not asing_v:
                    if rumus_belum_dihitung(i):
                        baris_invalid(tgl, None, nama_tamu, 0.0, f"{sedang} ({nama_tamu}): nilai berupa rumus yang belum dihitung (file belum dibuka & disimpan di Excel) -- buka di Excel, simpan ulang, lalu upload lagi.")
                        continue
                    if lewati_nol:
                        continue
                if tgl is None:
                    baris_invalid(None, None, nama_tamu, total_v, f"{sedang} ({nama_tamu}): {cat_tgl or 'Tanggal tidak terbaca'}")
                    continue
                if total_v < 0:
                    baris_invalid(tgl, None, nama_tamu, total_v, f"{sedang} ({nama_tamu}): nilai negatif {total_v:,.2f} (pembatalan/refund?) -- periksa.")
                    continue
                if total_v == 0 and lewati_nol:
                    continue
                if periode is not None and (tgl.year, tgl.month) != periode:
                    catatan.append(f"Tanggal {tgl:%d-%m-%Y} di luar bulan sheet ({periode[1]:02d}/{periode[0]}) -- periksa")
                dpp = round(total_v, 2)
                dasar = f"{prefix}-{tgl:%Y%m%d}-{_slug_invoice(nama_tamu)}"
                terlihat = nomor_per_dasar.setdefault(dasar, [])
                ganda = dpp in terlihat
                if not ganda:
                    terlihat.append(dpp)
                urut_no = terlihat.index(dpp) + 1
                no_invoice = dasar if urut_no == 1 else f"{dasar}-{urut_no}"
                if ganda:
                    catatan.append(f"Baris identik (tanggal, nama, nilai) dengan baris sebelumnya -- nomor invoice '{no_invoice}' ganda")
                hasil.append({
                    "row_no": len(hasil) + 1, "tanggal": tgl, "no_invoice": no_invoice, "nama_customer": nama_tamu,
                    "cabang": cabang, "dpp": dpp, "ppn": 0.0, "total": dpp,
                    "is_valid": True, "validation_notes": "; ".join(catatan) or None, "is_duplicate_candidate": ganda,
                })
    finally:
        wb.close()
        if rumus_wb is not None:
            rumus_wb.close()
    return hasil


# ============================================================
# 4) Ekstraksi baris pakai template yang cocok
# ============================================================

_BULAN_ALIAS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "mei": 5, "may": 5, "jun": 6, "jul": 7,
    "agu": 8, "agt": 8, "aug": 8, "sep": 9, "okt": 10, "oct": 10, "nov": 11, "des": 12, "dec": 12,
}


def _parse_angka(s: str, number_format: Dict[str, str]) -> float:
    s = (s or "").strip()
    if not s:
        return 0.0
    ribuan = number_format.get("thousands_separator", ",")
    desimal = number_format.get("decimal_separator", ".")
    s = s.replace(ribuan, "")
    if desimal != ".":
        s = s.replace(desimal, ".")
    s = re.sub(r"[^0-9.\-]", "", s)
    try:
        return float(s) if s not in ("", "-", ".") else 0.0
    except ValueError:
        return 0.0


def _parse_tanggal(s: str, fmt: str) -> Optional[date]:
    s = (s or "").strip()
    if not s:
        return None
    python_fmt = fmt.replace("DD", "%d").replace("MM", "%m").replace("YYYY", "%Y")
    try:
        return datetime.strptime(s, python_fmt).date()
    except ValueError:
        pass
    # fallback -- beberapa format tanggal umum lain, kalau format template meleset
    for alt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y", "%d-%b-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return datetime.strptime(s, alt).date()
        except ValueError:
            continue
    # sel Excel bertipe tanggal dibaca sbg str(datetime) -> "2026-08-01 00:00:00"
    m = re.match(r"^(\d{4}-\d{2}-\d{2})[ T]", s)
    if m:
        try:
            return datetime.strptime(m.group(1), "%Y-%m-%d").date()
        except ValueError:
            pass
    return None


def _ambil_kolom(row: List[str], idx_1based: int) -> str:
    idx = idx_1based - 1
    return row[idx].strip() if 0 <= idx < len(row) else ""


def _parse_grouped_invoice_report(rows: List[List[str]], recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser "resep" laporan gaya cetak POS/kasir (1 invoice = 1 blok
    beberapa baris) -- lihat format_type='grouped_invoice_report' di
    SALES_IMPORT_TEMPLATES.md untuk penjelasan tiap field recipe."""
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "DD/MM/YYYY")
    inv_cols = recipe["invoice_header"]["columns"]
    footer_cols = recipe["block_footer_columns"]
    item_marker = recipe["item_header_marker"]["value"]
    footer_marker = recipe["block_footer_marker"]["value"]
    end_marker = recipe.get("end_of_data_marker", {}).get("value")
    delimiter = recipe.get("delimiter", ";")

    def gabung(row: List[str]) -> str:
        return delimiter.join(row)

    hasil: List[Dict[str, Any]] = []
    seen_invoice_no = set()
    i = recipe.get("block_start_row_index", 1) - 1
    n = len(rows)

    while i < n:
        row = rows[i]
        if end_marker and end_marker in gabung(row):
            break
        if all((c or "").strip() == "" for c in row):
            i += 1
            continue

        no_invoice = _ambil_kolom(row, inv_cols["no_invoice"])
        tanggal_raw = _ambil_kolom(row, inv_cols["tanggal"])
        nama_pelanggan = _ambil_kolom(row, inv_cols["nama_pelanggan"])
        i += 1

        # baris label item (opsional -- lewati kalau ada)
        if i < n and gabung(rows[i]).startswith(item_marker):
            i += 1

        # lewati baris-baris item sampai ketemu baris footer
        while i < n and not gabung(rows[i]).startswith(footer_marker):
            if end_marker and end_marker in gabung(rows[i]):
                break  # blok terakhir tanpa footer -- berhenti, jangan looping tanpa akhir
            i += 1
        if i >= n or (end_marker and end_marker in gabung(rows[i])):
            break  # blok terpotong/malformed di akhir file -- hentikan, jangan buang exception

        footer_row = rows[i]
        pajak = _parse_angka(_ambil_kolom(footer_row, footer_cols["pajak"]), number_format)
        total_akhir = _parse_angka(_ambil_kolom(footer_row, footer_cols["total_akhir"]), number_format)
        dpp = round(total_akhir - pajak, 2)
        tanggal = _parse_tanggal(tanggal_raw, date_format)

        is_duplicate = no_invoice in seen_invoice_no
        if no_invoice:
            seen_invoice_no.add(no_invoice)

        catatan = []
        if not no_invoice:
            catatan.append("No. invoice kosong")
        if tanggal is None:
            catatan.append("Tanggal tidak terbaca")

        hasil.append({
            "row_no": len(hasil) + 1,
            "tanggal": tanggal,
            "no_invoice": no_invoice or None,
            "nama_customer": nama_pelanggan or None,
            "cabang": None,  # format blok POS/kasir ini tidak punya info cabang
            "dpp": dpp,
            "ppn": pajak,
            "total": total_akhir,
            "is_valid": not catatan,
            "validation_notes": "; ".join(catatan) or None,
            "is_duplicate_candidate": is_duplicate,
        })

        i += 1
        if i < n and all((c or "").strip() == "" for c in rows[i]):
            i += 1

    return hasil


def _parse_grouped_invoice_report_pdf(sumber: "_PdfSumber", recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser resep format_type='grouped_invoice_report_pdf' -- laporan yang
    SAMA dengan grouped_invoice_report (1 invoice = 1 blok: header invoice,
    label item, item, subtotal, footer), tetapi dibaca dari KATA + POSISI
    di text layer PDF. 1 baris hasil = 1 invoice.

    Mesin status membaca baris demi baris lintas halaman. 1 invoice "terbuka"
    sejak baris header-nya sampai footer 'Pot. ... Total Akhir' terbaca, sehingga
    3 kasus pergantian halaman di recipe.page_break_rules tertangani:
      * footer jatuh di halaman berikutnya -> tetap milik invoice terbuka;
      * header terbelah -> lanjutan nama/alamat (sebelum label item) digabung
        ke invoice terbuka;
      * header dicetak 2x (nomor sama, belum ada footer) -> salinan kedua
        menimpa nama/alamat, TIDAK membuat baris baru."""
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "DD/MM/YYYY")
    hdr = recipe["invoice_header"]
    kolom = hdr["columns_x0"]
    pola_no = re.compile(hdr["no_invoice_pattern"])
    band = _norm_teks(recipe.get("ignore", {}).get("table_header_band", {}).get("value", ""))
    item_marker = _norm_teks(recipe["item_header_marker"]["value"])
    pola_footer = re.compile(recipe["block_footer_marker"]["value"], re.IGNORECASE)
    end_marker = (recipe.get("end_of_data_marker") or {}).get("value")

    def di_rentang(baris: List[Dict[str, Any]], nama_kolom: str) -> str:
        lo, hi = kolom[nama_kolom]
        return " ".join(w["text"] for w in baris if lo <= w["x0"] < hi).strip()

    hasil: List[Dict[str, Any]] = []
    seen_invoice_no = set()
    terbuka: Optional[Dict[str, Any]] = None  # invoice yang headernya sudah terbaca tapi footernya belum

    def tutup(inv: Dict[str, Any], pajak: float, total_akhir: float, ada_footer: bool) -> None:
        nama = " ".join(inv["nama"]).strip()
        tanggal = _parse_tanggal(inv["tanggal_raw"], date_format)
        no_invoice = inv["no_invoice"]
        is_duplicate = no_invoice in seen_invoice_no
        if no_invoice:
            seen_invoice_no.add(no_invoice)
        catatan = []
        if not no_invoice:
            catatan.append("No. invoice kosong")
        if tanggal is None:
            catatan.append("Tanggal tidak terbaca")
        if not ada_footer:
            catatan.append("Footer invoice (Total Akhir) tidak ditemukan")
        hasil.append({
            "row_no": len(hasil) + 1,
            "tanggal": tanggal,
            "no_invoice": no_invoice or None,
            "nama_customer": nama or None,
            "cabang": None,  # diisi dari nama file oleh _ekstrak_dengan_template
            "dpp": round(total_akhir - pajak, 2),
            "ppn": pajak,
            "total": total_akhir,
            "is_valid": not catatan,
            "validation_notes": "; ".join(catatan) or None,
            "is_duplicate_candidate": is_duplicate,
        })

    selesai = False
    for _no_hal, kata in _iter_kata_halaman_pdf(sumber.content):
        baris_halaman = _buang_cap_halaman(_kelompokkan_kata_jadi_baris(kata))
        for baris in baris_halaman:
            teks = _teks_baris(baris)
            norm = _norm_teks(teks)

            if end_marker and end_marker.lower() in teks.lower():
                selesai = True
                break
            if band and norm.startswith(band):
                continue  # band header tabel yang diulang di tiap halaman

            m_footer = pola_footer.search(teks)
            if m_footer:
                if terbuka is not None:
                    pajak = _parse_angka(m_footer.group(2) or "", number_format)
                    total_akhir = _parse_angka(m_footer.group(4) or "", number_format)
                    tutup(terbuka, pajak, total_akhir, ada_footer=True)
                    terbuka = None
                continue

            if norm.startswith(item_marker):
                if terbuka is not None:
                    terbuka["di_item"] = True
                continue

            pertama = baris[0]
            if pertama["x0"] < kolom["no_invoice"][1] and pola_no.match(pertama["text"]):
                no_invoice = pertama["text"]
                tanggal_raw = di_rentang(baris, "tanggal")
                nama = di_rentang(baris, "nama_pelanggan")
                if terbuka is not None and terbuka["no_invoice"] == no_invoice:
                    # header dicetak 2x: pakai salinan kedua yang lengkap
                    if tanggal_raw:
                        terbuka["tanggal_raw"] = tanggal_raw
                    terbuka["nama"] = [nama] if nama else []
                    terbuka["di_item"] = False
                    continue
                if terbuka is not None:
                    # invoice sebelumnya tidak pernah punya footer -- catat sbg tidak valid
                    tutup(terbuka, 0.0, 0.0, ada_footer=False)
                terbuka = {
                    "no_invoice": no_invoice,
                    "tanggal_raw": tanggal_raw,
                    "nama": [nama] if nama else [],
                    "di_item": False,
                }
                continue

            if terbuka is not None and not terbuka["di_item"]:
                # lanjutan nama pelanggan yang membungkus / terbelah antar halaman
                lanjutan = di_rentang(baris, "nama_pelanggan")
                if lanjutan:
                    terbuka["nama"].append(lanjutan)
        if selesai:
            break

    if terbuka is not None:
        tutup(terbuka, 0.0, 0.0, ada_footer=False)
    return hasil


def _parse_flat_mapping(rows: List[List[str]], template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fallback untuk template flat (1 baris = 1 field_key: nama_kolom_
    sumber biasa, BUKAN grouped_invoice_report) -- belum ada contoh seed
    utk format ini, disiapkan supaya sistem tetap bisa menangani laporan
    sederhana kalau ada nanti."""
    mapping_rules = template["mapping_rules"]
    header_idx = template["header_row_index"] - 1
    data_idx = template["data_start_row_index"] - 1
    if header_idx < 0 or header_idx >= len(rows):
        return []
    header = [h.strip() for h in rows[header_idx]]

    def cari_kolom(nama_sumber: str) -> Optional[int]:
        target = nama_sumber.strip().lower()
        for i, h in enumerate(header):
            if h.strip().lower() == target:
                return i
        return None

    idx_tanggal = cari_kolom(mapping_rules.get("tanggal", ""))
    idx_invoice = cari_kolom(mapping_rules.get("invoice", ""))
    idx_customer = cari_kolom(mapping_rules.get("customer", ""))
    idx_dpp = cari_kolom(mapping_rules.get("dpp", ""))
    idx_ppn = cari_kolom(mapping_rules.get("ppn", ""))
    idx_total = cari_kolom(mapping_rules.get("total", ""))
    number_format = mapping_rules.get("number_format", {"thousands_separator": ",", "decimal_separator": "."})
    date_format = mapping_rules.get("date_format", "DD/MM/YYYY")

    def ambil(row: List[str], idx: Optional[int]) -> str:
        return row[idx].strip() if idx is not None and idx < len(row) else ""

    hasil: List[Dict[str, Any]] = []
    seen = set()
    for row in rows[data_idx:]:
        if all((c or "").strip() == "" for c in row):
            continue
        no_invoice = ambil(row, idx_invoice)
        tanggal = _parse_tanggal(ambil(row, idx_tanggal), date_format)
        catatan = []
        if not no_invoice:
            catatan.append("No. invoice kosong")
        if tanggal is None:
            catatan.append("Tanggal tidak terbaca")
        is_dup = bool(no_invoice) and no_invoice in seen
        if no_invoice:
            seen.add(no_invoice)
        hasil.append({
            "row_no": len(hasil) + 1,
            "tanggal": tanggal,
            "no_invoice": no_invoice or None,
            "nama_customer": ambil(row, idx_customer) or None,
            "cabang": None,  # template flat lama tidak punya field cabang
            "dpp": _parse_angka(ambil(row, idx_dpp), number_format),
            "ppn": _parse_angka(ambil(row, idx_ppn), number_format),
            "total": _parse_angka(ambil(row, idx_total), number_format),
            "is_valid": not catatan,
            "validation_notes": "; ".join(catatan) or None,
            "is_duplicate_candidate": is_dup,
        })
    return hasil


def _susun_baris_hasil(agregat: "Dict[str, Dict[str, Any]]", date_format: str) -> List[Dict[str, Any]]:
    """Ubah agregat per invoice ({no_invoice: {tanggal_raw, customer, dpp, ppn}})
    jadi baris source_rows -- dipakai bersama oleh parser flat_grouped_by_key
    dan sectioned_by_customer_header."""
    hasil: List[Dict[str, Any]] = []
    for no_invoice, a in agregat.items():
        tanggal = _parse_tanggal(a["tanggal_raw"], date_format)
        dpp = round(a["dpp"], 2)
        ppn = round(a["ppn"], 2)
        catatan = []
        if not no_invoice:
            catatan.append("No. invoice kosong")
        if tanggal is None:
            catatan.append("Tanggal tidak terbaca")
        info = a.get("catatan_extra")  # mis. nomor dobel di file (resep key_ganda_pisah) -- peringatan, bukan galat
        hasil.append({
            "row_no": len(hasil) + 1,
            "tanggal": tanggal,
            "no_invoice": no_invoice or None,
            "nama_customer": a["customer"] or None,
            "cabang": a.get("cabang") or None,
            "dpp": dpp,
            "ppn": ppn,
            "total": round(dpp + ppn, 2),
            "is_valid": not catatan,
            "validation_notes": "; ".join(catatan + ([info] if info else [])) or None,
            "is_duplicate_candidate": bool(a.get("ganda")),  # selain resep key_ganda_pisah: agregat per no. invoice -> tidak mungkin dobel
        })
    return hasil


def _parse_flat_grouped_by_key(rows: List[List[str]], template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Tabel flat 1 baris = 1 item/line (mis. export POS "Report Item
    Details"), banyak baris berbagi 1 key (Receipt Number) -> dijumlah jadi
    1 baris kanonis per key. Kolom dicari lewat NAMA di baris header, bukan
    posisi. dpp = jumlah kolom `dpp_columns`, ppn = jumlah `ppn_columns`,
    total = dpp + ppn. Baris refund yang bernilai negatif otomatis
    mengurangi total struk asalnya.

    Opsi resep tambahan (semuanya opsional, tanpa opsi perilaku lama tidak berubah):
      invoice_key_gabung        key dirakit dari beberapa kolom, bukan 1 kolom. Isi = daftar; item
                                string = nama kolom header, item {"kolom_setelah": nama, "geser": n}
                                = kolom ke-n di kanan kolom bernama itu (untuk kolom TANPA judul).
                                Dipakai Evita: Kode Transaksi + nomor urut tanpa judul. Tidak
                                bergantung pada kolom rumus, jadi aman walau file tersimpan tanpa
                                nilai hasil rumus. Salah satu bagian kosong -> key kosong.
      invoice_key_pemisah       pemisah bagian key (default "/")
      invoice_key_nomor_pad N   bagian TERAKHIR yang angka dipadatkan nol ke N digit ("1" -> "0001")
      key_ganda_pisah           key yang sama dipakai transaksi BEDA (tanggal/customer beda): jangan
                                digabung; yang kedua dst disimpan sebagai "<key>-2", "<key>-3", semua
                                pemakai nomor itu ditandai is_duplicate_candidate + catatan
      abaikan_baris_ringkasan   lewati baris tanpa key, tanpa tanggal dan tanpa customer (baris
                                total/subtotal/sisa rumus); baris tanpa key tapi ada tanggal atau
                                customer TETAP muncul sebagai invalid "No. invoice kosong"
      kolom_opsional            daftar nama kolom yang BOLEH tidak ada di header file (mis. laporan POS
                                versi lain membuang kolom VAT). Kolom yang hilang dianggap kosong/0 --
                                tanpa opsi ini kolom yang tidak ada = ekstraksi gagal. Hanya untuk kolom
                                tambahan (ppn/customer/cabang/kolom bantu); jangan untuk key & tanggal.
      invoice_key_cadangan      nama kolom pengganti key kalau kolom `invoice_key` kosong di suatu baris
                                (mis. Bill Number kosong -> pakai Sales Number). Bila ada pun tetap
                                dianggap sama dengan key utama untuk baris yang berbagi nilainya.
      peringatan_nilai_kolom    {"Nama Kolom": ["nilai wajar", ...]} -- baris yang nilainya di luar daftar
                                TIDAK dibuang dan TIDAK invalid, hanya diberi catatan peringatan di
                                validation_notes (mis. Sales Type selain "Sales": void/refund/komplimen)
      peringatan_teks_mengandung {"Nama Kolom": ["kata", ...]} -- baris yang teks kolomnya memuat salah satu
                                kata (tanpa peduli huruf besar/kecil) diberi catatan peringatan, tidak
                                dibuang dan tidak invalid (mis. keterangan jurnal berisi "RETUR")
      dpp_kurang_columns        kolom yang DIKURANGKAN dari dpp (mis. UBD: dpp = Kredit - Debit, supaya
                                koreksi/retur yang dicatat di sisi debit mengurangi pendapatan)
      abaikan_baris_tanpa_penanda  nama kolom penanda (mis. "No" = nomor urut): baris yang kolom penandanya
                                kosong DAN tanggalnya tidak terbaca dianggap bukan data (tabel rekonsiliasi/
                                catatan di bawah data) dan dilewati. Baris bertanggal valid tetap diproses.
                                Kalau kolom penanda tidak ada di header, opsi diabaikan.
    """
    recipe = template["mapping_rules"]
    header_idx = template["header_row_index"] - 1
    if header_idx < 0 or header_idx >= len(rows):
        return []
    header = [h.strip().lower() for h in rows[header_idx]]
    opsional = {n.strip().lower() for n in recipe.get("kolom_opsional", [])}

    def kolom(nama: str) -> int:
        try:
            return header.index(nama.strip().lower())
        except ValueError:
            if nama.strip().lower() in opsional:
                return -1  # kolom opsional tidak ada: _ambil_kolom(row, 0) -> "" dan angka -> 0
            raise ValueError(f"Kolom '{nama}' tidak ada di header file")

    def kolom_gabung(item: Any) -> int:
        if isinstance(item, dict):
            return kolom(item["kolom_setelah"]) + int(item.get("geser", 1))
        return kolom(item)

    number_format = recipe.get("number_format", {})
    gabung = recipe.get("invoice_key_gabung")
    i_gabung = [kolom_gabung(g) for g in gabung] if gabung else []
    i_key = None if gabung else kolom(recipe["invoice_key"])
    i_key_cadangan = kolom(recipe["invoice_key_cadangan"]) if recipe.get("invoice_key_cadangan") else None
    peringatan_kolom = {kolom(n): {str(v).strip().lower() for v in daftar}
                        for n, daftar in (recipe.get("peringatan_nilai_kolom") or {}).items()
                        if kolom(n) >= 0}  # kolom opsional yang tidak ada di file -> tanpa peringatan
    pemisah = recipe.get("invoice_key_pemisah", "/")
    pad = int(recipe.get("invoice_key_nomor_pad") or 0)
    i_tanggal = kolom(recipe["tanggal"])
    i_customer = kolom(recipe["customer"]) if recipe.get("customer") else None
    i_cabang = kolom(recipe["cabang"]) if recipe.get("cabang") else None
    i_dpp = [kolom(n) for n in recipe["dpp_columns"]]
    i_ppn = [kolom(n) for n in recipe.get("ppn_columns", [])]
    i_dpp_kurang = [kolom(n) for n in recipe.get("dpp_kurang_columns", [])]
    i_penanda = kolom(recipe["abaikan_baris_tanpa_penanda"]) if recipe.get("abaikan_baris_tanpa_penanda") else -1
    peringatan_teks = {kolom(n): [str(k).strip().lower() for k in daftar]
                       for n, daftar in (recipe.get("peringatan_teks_mengandung") or {}).items()
                       if kolom(n) >= 0}
    fallback = recipe.get("customer_fallback")  # mis. "Penjualan POS - {Outlet}"
    fallback_kolom = {n: kolom(n) for n in re.findall(r"\{([^}]+)\}", fallback or "")}
    customer_kosong = {v.strip().lower() for v in recipe.get("customer_kosong_jika", [])}  # mis. ["-"]
    abaikan_tanpa_key = recipe.get("abaikan_baris_tanpa_key", False)  # baris ringkasan/total di bawah data
    abaikan_ringkasan = recipe.get("abaikan_baris_ringkasan", False)
    pisah_ganda = recipe.get("key_ganda_pisah", False)

    def angka(row: List[str], idx: int) -> float:
        return _parse_angka(_ambil_kolom(row, idx + 1), number_format)

    def ambil_key(row: List[str]) -> str:
        if i_key is not None:
            nilai = _ambil_kolom(row, i_key + 1)
            if not nilai and i_key_cadangan is not None:
                nilai = _ambil_kolom(row, i_key_cadangan + 1)
            return nilai
        bagian = [_ambil_kolom(row, i + 1) for i in i_gabung]
        if pad and bagian and re.fullmatch(r"\d+(\.0+)?", bagian[-1]):
            bagian[-1] = bagian[-1].split(".")[0].zfill(pad)
        if not bagian or any(not b for b in bagian):
            return ""
        return pemisah.join(bagian)

    agregat: Dict[str, Dict[str, Any]] = {}
    pemakai_key: Dict[str, List[str]] = {}  # key asli -> daftar key entri (hanya dipakai key_ganda_pisah)
    for row in rows[template["data_start_row_index"] - 1:]:
        if all((c or "").strip() == "" for c in row):
            continue
        key = ambil_key(row)
        tanggal_raw = _ambil_kolom(row, i_tanggal + 1)
        customer_asli = _ambil_kolom(row, i_customer + 1) if i_customer is not None else ""
        if not key:
            if abaikan_tanpa_key:
                continue
            if abaikan_ringkasan and not tanggal_raw and not customer_asli:
                continue
        if i_penanda >= 0 and not _ambil_kolom(row, i_penanda + 1) and _parse_tanggal(tanggal_raw, recipe.get("date_format", "DD/MM/YYYY")) is None:
            continue  # tabel rekonsiliasi/catatan di bawah data (penanda kosong + tanggal tidak terbaca)
        entri = key
        if pisah_ganda and key and key in pemakai_key:
            entri = None
            for k2 in pemakai_key[key]:
                if agregat[k2]["tanggal_raw"] == tanggal_raw and agregat[k2]["customer_asli"] == customer_asli:
                    entri = k2  # transaksi yang sama (banyak line) -> digabung
                    break
            if entri is None:
                entri = f"{key}-{len(pemakai_key[key]) + 1}"
        a = agregat.get(entri)
        if a is None:
            customer = customer_asli
            if customer.lower() in customer_kosong:
                customer = ""
            if not customer and fallback:
                customer = re.sub(r"\{([^}]+)\}", lambda m: _ambil_kolom(row, fallback_kolom[m.group(1)] + 1), fallback)
            cabang = _ambil_kolom(row, i_cabang + 1) if i_cabang is not None else ""
            a = agregat[entri] = {"tanggal_raw": tanggal_raw, "customer": customer, "customer_asli": customer_asli, "cabang": cabang, "dpp": 0.0, "ppn": 0.0}
            if pisah_ganda and key:
                daftar = pemakai_key.setdefault(key, [])
                daftar.append(entri)
                if len(daftar) > 1:
                    for k2 in daftar:
                        agregat[k2]["ganda"] = True
                        agregat[k2]["catatan_extra"] = (
                            f"No. invoice '{key}' dipakai >1 transaksi berbeda di file ini"
                            + (f"; disimpan sebagai '{k2}'" if k2 != key else "")
                        )
        a["dpp"] += sum(angka(row, i) for i in i_dpp) - sum(angka(row, i) for i in i_dpp_kurang)
        a["ppn"] += sum(angka(row, i) for i in i_ppn)
        for i_t, kata_kunci in peringatan_teks.items():
            teks = _ambil_kolom(row, i_t + 1).lower()
            cocok_kata = next((k for k in kata_kunci if k and k in teks), None)
            if cocok_kata:
                pesan = f"{rows[header_idx][i_t].strip()} memuat '{cocok_kata}' -- periksa apakah ini pendapatan"
                lama = a.get("catatan_extra") or ""
                if pesan not in lama:
                    a["catatan_extra"] = f"{lama}; {pesan}" if lama else pesan
        for i_p, wajar in peringatan_kolom.items():
            nilai_p = _ambil_kolom(row, i_p + 1)
            if nilai_p.strip().lower() not in wajar:
                pesan = f"{rows[header_idx][i_p].strip()} = '{nilai_p or '(kosong)'}' di luar nilai biasa"
                lama = a.get("catatan_extra") or ""
                if pesan not in lama:
                    a["catatan_extra"] = f"{lama}; {pesan}" if lama else pesan
    return _susun_baris_hasil(agregat, recipe.get("date_format", "DD/MM/YYYY"))


def _parse_sectioned_by_customer_header(rows: List[List[str]], template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Laporan "Penjualan per Pelanggan" (gaya Jurnal/Accurate): tiap
    pelanggan = 1 SECTION -- 1 baris judul (nama pelanggan saja, kolom lain
    kosong), N baris line invoice (1 invoice bisa punya banyak line produk,
    termasuk line "Diskon" bernilai negatif), 1 baris "Total Penjualan".
    Line dijumlah per no. invoice -> 1 baris kanonis per invoice. Posisi
    kolom (1-based) dari recipe, bukan nama, karena kolom judul section
    ("Pelanggan / Tanggal") dipakai ganda untuk nama pelanggan & tanggal."""
    recipe = template["mapping_rules"]
    cols = recipe["columns"]
    number_format = recipe.get("number_format", {})
    total_marker = recipe.get("section_total_marker", {})
    end_marker = recipe.get("end_of_data_marker", {})

    def cocok(row: List[str], marker: Dict[str, Any]) -> bool:
        if not marker:
            return False
        teks = _ambil_kolom(row, marker["column"])
        if "value" in marker:
            return teks == marker["value"]
        return marker["contains"] in teks

    agregat: Dict[str, Dict[str, Any]] = {}
    customer = ""
    for row in rows[template["data_start_row_index"] - 1:]:
        if all((c or "").strip() == "" for c in row):
            continue
        if cocok(row, end_marker):
            break
        if cocok(row, total_marker):
            continue
        if not _ambil_kolom(row, cols["transaksi"]):
            # bukan baris line -> baris judul section (nama pelanggan)
            nama = _ambil_kolom(row, cols["tanggal"])
            if nama:
                customer = nama
            continue
        no_invoice = _ambil_kolom(row, cols["no_invoice"])
        a = agregat.get(no_invoice)
        if a is None:
            a = agregat[no_invoice] = {"tanggal_raw": _ambil_kolom(row, cols["tanggal"]), "customer": customer, "cabang": customer if recipe.get("cabang_dari_judul_section") else "", "dpp": 0.0, "ppn": 0.0}
        a["dpp"] += _parse_angka(_ambil_kolom(row, cols["jumlah"]), number_format)
    return _susun_baris_hasil(agregat, recipe.get("date_format", "DD/MM/YYYY"))


def _slug_kode(teks: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "-", (teks or "").upper()).strip("-")


def _periode_dari_nama_file(file_name: Optional[str]) -> Tuple[Optional[date], Optional[date]]:
    """(awal, akhir) periode laporan dari NAMA FILE, mis. \"Report Category Sales - 01-08-2026 -
    31-08-2026 - Outlet 1.xlsx\" (spasi/underscore/strip/titik sebagai pemisah, DD-MM-YYYY atau
    YYYY-MM-DD). Hanya 1 tanggal ketemu -> awal = akhir. Tidak ada -> (None, None)."""
    if not file_name:
        return None, None
    stem = file_name.replace(chr(92), "/").split("/")[-1].rsplit(".", 1)[0]
    m = re.search(r"(?<!\d)(\d{1,2})[-_./ ](\d{1,2})[-_./ ](\d{4})(?:\D+?(\d{1,2})[-_./ ](\d{1,2})[-_./ ](\d{4}))?(?!\d)", stem)
    if m:
        def mk(d: Optional[str], mo: Optional[str], y: Optional[str]) -> Optional[date]:
            try:
                return date(int(y), int(mo), int(d)) if d else None
            except (ValueError, TypeError):
                return None
        awal = mk(m.group(1), m.group(2), m.group(3))
        akhir = mk(m.group(4), m.group(5), m.group(6)) if m.group(4) else awal
        return awal, akhir
    m = re.search(r"(?<!\d)(\d{4})-(\d{2})-(\d{2})(?:\D+?(\d{4})-(\d{2})-(\d{2}))?(?!\d)", stem)
    if m:
        try:
            awal = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
            akhir = date(int(m.group(4)), int(m.group(5)), int(m.group(6))) if m.group(4) else awal
            return awal, akhir
        except ValueError:
            pass
    return None, None


def _parse_category_summary(rows: List[List[str]], template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """Format_type='category_summary' (MM) -- laporan POS "Category Sales": 1 baris = 1 KATEGORI
    untuk 1 periode, TANPA nomor invoice dan TANPA tanggal di dalam file. Periode (dan outlet)
    diambil dari NAMA FILE. 1 baris source_rows = 1 kategori (kategori yang sama dijumlah).
      kategori            nama kolom kategori (dicari lewat NAMA header)
      dpp_columns         kolom nilai yang dijumlah jadi dpp (mis. [\"Net Sales\"]); ppn_columns idem
      akhir_data_jika     nilai kolom kategori yang menandai baris total/akhir data (default [\"Total\"])
      abaikan_nilai_nol   lewati kategori yang dpp + ppn = 0
      prefix_invoice      nomor invoice = <prefix>-<awal YYYYMMDD>-<akhir YYYYMMDD>[-<OUTLET>]-<KATEGORI>
      tanggal_pakai       \"akhir\" (default) atau \"awal\" periode sebagai tanggal invoice
      outlet_dari_nama_file {pattern, group, label}  mis. Outlet_1 -> OUTLET1 (opsional)
      customer_prefix     nama customer = <prefix> [- Outlet <x>] - <kategori>
    cabang = kategori (dipakai memilih akun pendapatan lewat pendapatan_account_by_cabang).
    Periode tidak terbaca dari nama file -> baris tetap dibuat tapi INVALID (aman, tidak ikut
    di-promote); kolom tambahan di kanan tabel (catatan manual user) diabaikan."""
    recipe = template["mapping_rules"]
    header_idx = template["header_row_index"] - 1
    if header_idx < 0 or header_idx >= len(rows):
        return []
    header = [h.strip().lower() for h in rows[header_idx]]

    def kolom(nama: str) -> int:
        try:
            return header.index(nama.strip().lower())
        except ValueError:
            raise ValueError(f"Kolom '{nama}' tidak ada di header file")

    number_format = recipe.get("number_format", {})
    i_kat = kolom(recipe["kategori"])
    i_dpp = [kolom(n) for n in recipe["dpp_columns"]]
    i_ppn = [kolom(n) for n in recipe.get("ppn_columns", [])]
    akhir = {_norm_label(v) for v in recipe.get("akhir_data_jika", ["Total"])}
    nol_dilewati = recipe.get("abaikan_nilai_nol", False)
    lebar = len(header)

    awal_p, akhir_p = _periode_dari_nama_file(file_name)
    tanggal = awal_p if recipe.get("tanggal_pakai") == "awal" else akhir_p
    outlet = ""
    aturan_outlet = recipe.get("outlet_dari_nama_file")
    if aturan_outlet and file_name:
        stem = file_name.replace(chr(92), "/").split("/")[-1].rsplit(".", 1)[0]
        mo = re.search(aturan_outlet["pattern"], stem, re.IGNORECASE)
        if mo:
            outlet = (mo.group(aturan_outlet.get("group", 1)) or "").strip()

    agregat: Dict[str, Dict[str, Any]] = {}
    for row in rows[template["data_start_row_index"] - 1:]:
        sel = list(row[:lebar])
        if all((c or "").strip() == "" for c in sel):
            continue
        kategori = _ambil_kolom(row, i_kat + 1)
        if _norm_label(kategori) in akhir:
            break
        dpp = sum(_parse_angka(_ambil_kolom(row, i + 1), number_format) for i in i_dpp)
        ppn = sum(_parse_angka(_ambil_kolom(row, i + 1), number_format) for i in i_ppn)
        a = agregat.get(_norm_label(kategori))
        if a is None:
            a = agregat[_norm_label(kategori)] = {"kategori": kategori, "dpp": 0.0, "ppn": 0.0}
        a["dpp"] += dpp
        a["ppn"] += ppn

    hasil: List[Dict[str, Any]] = []
    prefix = recipe.get("prefix_invoice", "POS")
    label_outlet = aturan_outlet.get("label", "OUTLET") if aturan_outlet else "OUTLET"
    for a in agregat.values():
        dpp = round(a["dpp"], 2)
        ppn = round(a["ppn"], 2)
        if nol_dilewati and dpp == 0 and ppn == 0 and a["kategori"]:
            continue
        catatan = []
        if not a["kategori"]:
            if dpp == 0 and ppn == 0:
                continue
            catatan.append("Kategori kosong")
        if tanggal is None:
            catatan.append("Tanggal tidak terbaca (periode tidak ada di nama file)")
        bagian = [prefix]
        if awal_p and akhir_p:
            bagian += [awal_p.strftime("%Y%m%d"), akhir_p.strftime("%Y%m%d")]
        if outlet:
            bagian.append(_slug_kode(f"{label_outlet}{outlet}"))
        bagian.append(_slug_kode(a["kategori"]) or "TANPA-KATEGORI")
        nama = " - ".join([p for p in (recipe.get("customer_prefix", "Penjualan POS"), f"Outlet {outlet}" if outlet else "", a["kategori"]) if p])
        hasil.append({
            "row_no": len(hasil) + 1,
            "tanggal": tanggal,
            "no_invoice": "-".join(bagian)[:100],
            "nama_customer": nama[:255],
            "cabang": (a["kategori"] or None),
            "dpp": dpp,
            "ppn": ppn,
            "total": round(dpp + ppn, 2),
            "is_valid": not catatan,
            "validation_notes": "; ".join(catatan) or None,
            "is_duplicate_candidate": False,
        })
    return hasil


def _norm_label(v: Any) -> str:
    return " ".join(str(v).strip().lower().split()) if v is not None else ""


def _angka_sel(v: Any, number_format: Dict[str, str]) -> Optional[float]:
    """Angka dari sel Excel mentah (openpyxl): angka -> float; teks berisi angka
    -> _parse_angka; kosong/teks tanpa angka -> None."""
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s or not re.search(r"\d", s):
        return None
    # Angka yang terlanjur diketik sebagai TEKS: "1.500.000" / "1.500.000,50" (gaya Indonesia)
    # atau "1,500,000" -- tidak boleh dibuang diam-diam.
    s = re.sub(r"^(rp\.?\s*)", "", s, flags=re.IGNORECASE)
    if re.search(r"[A-Za-z]", s):  # teks campur huruf ("abc 12") bukan angka -- jangan ditebak
        return None
    if re.fullmatch(r"-?\d{1,3}(\.\d{3})+(,\d+)?", s):
        return float(s.replace(".", "").replace(",", "."))
    if re.fullmatch(r"-?\d{1,3}(,\d{3})+(\.\d+)?", s):
        return float(s.replace(",", ""))
    try:
        return _parse_angka(s, number_format)
    except Exception:
        return None


def _cari_kolom_hari(rows: List[List[Any]], maks_baris: int) -> Optional[Tuple[int, Dict[int, int]]]:
    """(index_baris_header, {index_kolom: hari}) -- baris header = baris pertama
    (dalam `maks_baris` baris teratas) yang memuat angka 1..31 di >= 28 kolom
    (minimal 1..28 lengkap). Posisi kolom hari beda per cabang (B, C, atau D),
    jadi dicari, bukan di-hardcode."""
    for i, row in enumerate(rows[:maks_baris]):
        peta: Dict[int, int] = {}
        for j, v in enumerate(row):
            if isinstance(v, (int, float)) and not isinstance(v, bool) and float(v).is_integer() and 1 <= int(v) <= 31:
                peta[j] = int(v)
        if len(peta) >= 28 and set(range(1, 29)) <= set(peta.values()):
            return i, peta
    return None


def _parse_monthly_daily_matrix(sumber: "_ExcelBulananSumber", template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Rekap pendapatan HARIAN (AADL: Warung, Kafe Kapu, Omah & Kopi, Villa Putu).
    Tiap sheet bulanan = matriks: kolom = tanggal 1..31, baris = komponen
    pendapatan, 1 baris ringkasan (mis. \"TOTAL\") memuat pendapatan harian.
    1 baris kanonis (source_rows) = 1 HARI per cabang: dpp = nilai baris ringkasan
    hari itu, ppn = 0. File tidak punya nomor invoice -> dibentuk
    <prefix_invoice>-YYYY-MM-DD. Tanggal diambil dari NAMA SHEET + angka header
    hari (sel tanggal di baris header sering salah/tidak dirawat)."""
    recipe = template["mapping_rules"]
    number_format = recipe.get("number_format", {})
    spec = recipe["baris_pendapatan"]
    label_target = _norm_label(spec["label"])
    awalan = spec.get("cocok", "persis") == "awalan"
    kolom_label = spec.get("kolom", 1) - 1
    prefix = recipe["prefix_invoice"]
    customer = recipe.get("customer")
    cabang = recipe.get("cabang_tetap")
    lewati_nol = recipe.get("lewati_nol", True)
    maks_baris = recipe.get("maks_baris_header", 12)

    hasil: List[Dict[str, Any]] = []
    sudah_ada = set()
    wb = _buka_workbook_bulanan(sumber.content)
    try:
        sheets, peringatan = _pilih_sheet_bulanan(wb, recipe)
        for p in peringatan:
            _baris_peringatan(hasil, cabang, p)
        for nama, tahun, bulan in sheets:
            rows = [list(r) for r in wb[nama].iter_rows(values_only=True)]
            header = _cari_kolom_hari(rows, maks_baris)
            if header is None:
                _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}': baris header hari 1..31 tidak ditemukan -- bulan ini TIDAK ikut diimpor.")
                continue
            idx_header, peta_hari = header
            baris_target = None
            for row in rows[idx_header + 1:]:
                label = _norm_label(row[kolom_label]) if kolom_label < len(row) else ""
                if label and (label == label_target or (awalan and label.startswith(label_target))):
                    baris_target = row
                    break
            if baris_target is None:
                _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}': baris '{spec['label']}' tidak ditemukan (label diubah?) -- bulan ini TIDAK ikut diimpor.")
                continue
            for kolom, hari in sorted(peta_hari.items(), key=lambda kv: kv[1]):
                mentah = baris_target[kolom] if kolom < len(baris_target) else None
                nilai = _angka_sel(mentah, number_format)
                if nilai is None and isinstance(mentah, str) and re.search(r"\d", mentah):
                    _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}' hari {hari}: isi '{mentah.strip()}' bukan angka yang valid -- hari ini dilewati.")
                    continue
                if nilai is None or (lewati_nol and nilai == 0):
                    continue
                try:
                    tanggal = date(tahun, bulan, hari)
                except ValueError:
                    continue  # mis. kolom 31 di sheet Februari
                no_invoice = f"{prefix}-{tahun:04d}-{bulan:02d}-{hari:02d}"
                dpp = round(nilai, 2)
                catatan = []
                if dpp < 0:
                    catatan.append("Total harian negatif (periksa biaya/potongan)")
                hasil.append({
                    "row_no": len(hasil) + 1,
                    "tanggal": tanggal,
                    "no_invoice": no_invoice,
                    "nama_customer": customer,
                    "cabang": cabang,
                    "dpp": dpp,
                    "ppn": 0.0,
                    "total": dpp,
                    "is_valid": not catatan,
                    "validation_notes": "; ".join(catatan) or None,
                    "is_duplicate_candidate": no_invoice in sudah_ada,
                })
                sudah_ada.add(no_invoice)
    finally:
        wb.close()
    return hasil


def _parse_monthly_rent_roll(sumber: "_ExcelBulananSumber", template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Daftar sewa kamar (AADL: Kost Kapu Soemantri, Kost Warung Soemantri).
    Tiap sheet bulanan = tabel kamar (NO, KAMAR, Tanggal Masuk, ..., Deposit,
    Uang Kamar, Total Bayar) + baris TOTAL. 1 baris kanonis = 1 BULAN per
    cabang: dpp = jumlah kolom `kolom_jumlah` (\"Uang Kamar\") semua kamar
    bernomor; Deposit TIDAK ikut (jaminan, bukan pendapatan -- cocok dengan sheet
    RESUME file). Nomor invoice <prefix_invoice>-YYYY-MM, tanggal = akhir
    bulan (tanggal_bulanan = \"akhir_bulan\") atau tanggal 1 (\"awal_bulan\")."""
    recipe = template["mapping_rules"]
    number_format = recipe.get("number_format", {})
    judul_kolom = _norm_label(recipe["kolom_jumlah"])
    prefix = recipe["prefix_invoice"]
    customer = recipe.get("customer")
    cabang = recipe.get("cabang_tetap")
    lewati_nol = recipe.get("lewati_nol", True)
    maks_baris = recipe.get("maks_baris_header", 12)
    awal_bulan = recipe.get("tanggal_bulanan", "akhir_bulan") == "awal_bulan"

    hasil: List[Dict[str, Any]] = []
    sudah_ada = set()
    wb = _buka_workbook_bulanan(sumber.content)
    try:
        sheets, peringatan = _pilih_sheet_bulanan(wb, recipe)
        for p in peringatan:
            _baris_peringatan(hasil, cabang, p)
        for nama, tahun, bulan in sheets:
            rows = [list(r) for r in wb[nama].iter_rows(values_only=True)]
            idx_header = kolom = None
            for i, row in enumerate(rows[:maks_baris]):
                for j, v in enumerate(row):
                    if _norm_label(v) == judul_kolom:
                        idx_header, kolom = i, j
                        break
                if idx_header is not None:
                    break
            if idx_header is None:
                _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}': kolom '{recipe['kolom_jumlah']}' tidak ditemukan -- bulan ini TIDAK ikut diimpor.")
                continue
            jumlah = 0.0
            for row in rows[idx_header + 1:]:
                label = _norm_label(row[0]) if row else ""
                if label == "total":
                    break
                if re.fullmatch(r"\d+", label):  # baris kamar bernomor
                    mentah = row[kolom] if kolom < len(row) else None
                    angka = _angka_sel(mentah, number_format)
                    if angka is None and isinstance(mentah, str) and re.search(r"\d", mentah):
                        _baris_peringatan(hasil, cabang, f"Sheet '{nama.strip()}' kamar {row[1] if len(row) > 1 else label}: isi '{mentah.strip()}' bukan angka yang valid -- kamar ini dilewati.")
                    jumlah += angka or 0.0
            if lewati_nol and jumlah == 0:
                continue
            tanggal = date(tahun, bulan, 1 if awal_bulan else calendar.monthrange(tahun, bulan)[1])
            no_invoice = f"{prefix}-{tahun:04d}-{bulan:02d}"
            dpp = round(jumlah, 2)
            hasil.append({
                "row_no": len(hasil) + 1,
                "tanggal": tanggal,
                "no_invoice": no_invoice,
                "nama_customer": customer,
                "cabang": cabang,
                "dpp": dpp,
                "ppn": 0.0,
                "total": dpp,
                "is_valid": True,
                "validation_notes": None,
                "is_duplicate_candidate": no_invoice in sudah_ada,
            })
            sudah_ada.add(no_invoice)
    finally:
        wb.close()
    return hasil


def _cabang_dari_nama_file(recipe: Dict[str, Any], file_name: Optional[str]) -> Optional[str]:
    """Cabang yang diambil dari SUBSTRING nama file (dipakai klien yang
    laporannya tidak memuat kolom cabang, tapi 1 file = 1 cabang -- mis. SAU:
    "Detail PENJ OL.csv" -> "OL"). Aturannya di recipe:
        "cabang_dari_nama_file": {"pattern": "^Detail PENJ (.+)$", "group": 1}
    pattern dicocokkan (tidak peka huruf besar/kecil) ke nama file TANPA
    ekstensi & tanpa folder. Tidak cocok -> None (cabang dibiarkan kosong)."""
    aturan = recipe.get("cabang_dari_nama_file")
    if not aturan or not file_name:
        return None
    stem = file_name.replace(chr(92), "/").split("/")[-1].rsplit(".", 1)[0].strip()  # chr(92) = backslash (path Windows)
    m = re.search(aturan["pattern"], stem, re.IGNORECASE)
    if not m:
        return None
    return (m.group(aturan.get("group", 1)) or "").strip()[:100] or None


def _ekstrak_dengan_template(rows: List[List[str]], template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type == "grouped_invoice_report":
        hasil = _parse_grouped_invoice_report(rows, mapping_rules)
    elif format_type == "grouped_invoice_report_pdf":
        hasil = _parse_grouped_invoice_report_pdf(rows, mapping_rules)  # rows = _PdfSumber
    elif format_type == "flat_grouped_by_key":
        hasil = _parse_flat_grouped_by_key(rows, template)
    elif format_type == "sectioned_by_customer_header":
        hasil = _parse_sectioned_by_customer_header(rows, template)
    elif format_type == "category_summary":
        hasil = _parse_category_summary(rows, template, file_name)
    elif format_type == "monthly_daily_matrix":
        hasil = _parse_monthly_daily_matrix(rows, template)  # rows = _ExcelBulananSumber
    elif format_type == "monthly_rent_roll":
        hasil = _parse_monthly_rent_roll(rows, template)  # rows = _ExcelBulananSumber
    elif format_type == FORMAT_EXCEL_MULTI_SHEET:
        hasil = _parse_multi_sheet_line_items(rows, template)  # rows = _ExcelBulananSumber
    elif format_type == FORMAT_EXCEL_REGISTER_BLOK:
        hasil = _parse_monthly_block_invoice_register(rows, template)  # rows = _ExcelBulananSumber
    elif format_type == FORMAT_EXCEL_REKAP_CHANNEL:
        hasil = _parse_daily_channel_recap(rows, template, file_name)  # rows = _ExcelBulananSumber; properti dari NAMA FILE
    elif format_type == FORMAT_EXCEL_INCOME_LIST:
        hasil = _parse_monthly_income_list(rows, template)  # rows = _ExcelBulananSumber
    else:
        hasil = _parse_flat_mapping(rows, template)

    cabang_file = _cabang_dari_nama_file(mapping_rules, file_name)
    if cabang_file:
        for r in hasil:
            if not r.get("cabang"):  # cabang yang terbaca dari isi file (kalau ada) menang atas nama file
                r["cabang"] = cabang_file
    return hasil


# ============================================================
# ENDPOINT
# ============================================================

@router.post(
    "/source-files/upload",
    summary="Upload file laporan penjualan (CSV/Excel/PDF) + ekstraksi otomatis pakai template (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File berhasil diupload (template cocok -> langsung diekstrak, atau ditandai Butuh Review kalau belum ada template yang cocok)."},
        400: {"description": "Tipe file tidak didukung, atau file terlalu besar."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
    },
)
async def upload_source_file(
    file: UploadFile = File(...),
    management_client_id: str = Form(..., description="ID management_clients -- klien yang laporannya sedang diupload, WAJIB."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return gagal(
            message=f"Ukuran file ({len(content) / (1024*1024):.1f} MB) melebihi batas {MAX_UPLOAD_BYTES // (1024*1024)} MB.",
            errors={"code": "FILE_TOO_LARGE"},
            status_code=400,
        )

    file_type = _detect_file_type(file.filename or "file")
    user_id = current_user.get("id")  # management_users.id -- untuk uploaded_by / created_by
    client_id = management_client_id  # kolom client_id di DB = FK ke management_clients (BUKAN id user)

    cocok = None
    try:
        cocok = await run_in_threadpool(_cocokkan_template, content, file_type, management_client_id)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template untuk file {file.filename}: {e}")

    if cocok is None:
        source_file = dbc.create_sales_source_file({
            "client_id": client_id,
            "management_client_id": management_client_id,
            "file_name": file.filename,
            "file_type": file_type,
            "rows_detected": 0,
            "status_ekstraksi": "Butuh Review",
            "status_mapping": "Butuh Review",
            "processed_by": current_user.get("nama") or current_user.get("username"),
            "uploaded_by": user_id,
        }, created_by=user_id)
        if source_file is None:
            return gagal(message="Gagal menyimpan source file (kesalahan database).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0},
            message=(
                "Belum ada template pola kolom yang cocok untuk klien & format file ini "
                "(untuk PDF: pastikan PDF punya text layer, bukan hasil scan) -- "
                "file tersimpan sbg 'Butuh Review'. Buat template barunya dulu (lihat "
                "root/SALES_IMPORT_TEMPLATES.md) sebelum file jenis ini bisa diekstrak otomatis."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        baris_ekstrak = await run_in_threadpool(_ekstrak_dengan_template, rows, template, file.filename)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        source_file = dbc.create_sales_source_file({
            "client_id": client_id,
            "management_client_id": management_client_id,
            "file_name": file.filename,
            "file_type": file_type,
            "rows_detected": 0,
            "status_ekstraksi": "Gagal",
            "status_mapping": "Gagal",
            "template_id": template["id"],
            "processed_by": current_user.get("nama") or current_user.get("username"),
            "uploaded_by": user_id,
        }, created_by=user_id)
        return sukses(
            data={**(source_file or {}), "template_matched": True, "rows_extracted": 0},
            message=f"Template ditemukan tapi ekstraksi gagal: {e}",
            status_code=201,
        )

    rows_valid = sum(1 for r in baris_ekstrak if r["is_valid"])
    rows_invalid = len(baris_ekstrak) - rows_valid
    duplicate_count = sum(1 for r in baris_ekstrak if r["is_duplicate_candidate"])
    dpp_total = round(sum(r["dpp"] for r in baris_ekstrak), 2)
    ppn_total = round(sum(r["ppn"] for r in baris_ekstrak), 2)
    grand_total = round(sum(r["total"] for r in baris_ekstrak), 2)

    source_file = dbc.create_sales_source_file({
        "client_id": client_id,
        "management_client_id": management_client_id,
        "file_name": file.filename,
        "file_type": file_type,
        "rows_detected": len(baris_ekstrak),
        "rows_valid": rows_valid,
        "rows_invalid": rows_invalid,
        "duplicate_count": duplicate_count,
        "status_ekstraksi": "Berhasil" if rows_invalid == 0 else "Butuh Review",
        "status_mapping": "Berhasil",
        "confidence_score": template.get("ai_confidence"),
        "dpp_total": dpp_total,
        "ppn_total": ppn_total,
        "grand_total": grand_total,
        "ai_model_version": template.get("ai_model_version"),
        "mapping_rules": template.get("mapping_rules"),
        "template_id": template["id"],
        "processed_by": current_user.get("nama") or current_user.get("username"),
        "uploaded_by": user_id,
    }, created_by=user_id)
    if source_file is None:
        return gagal(message="Gagal menyimpan source file (kesalahan database).", status_code=500)

    # [FIX] Insert massal (1 transaksi) di threadpool -- sebelumnya create_sales_source_row
    # dipanggil per baris (~0,3 dtk/baris ke Supabase) di dalam handler async, sehingga file
    # 10rb+ baris membutuhkan berjam-jam dan MEMBLOKIR event loop (semua request lain
    # ikut "socket hang up"/ECONNRESET).
    n_tersimpan = await run_in_threadpool(
        dbc.create_sales_source_rows_bulk, baris_ekstrak, source_file["id"], client_id, user_id
    )
    if n_tersimpan != len(baris_ekstrak):
        await run_in_threadpool(dbc.update_sales_source_file, source_file["id"],
                                {"status_ekstraksi": "Gagal", "status_mapping": "Gagal", "rows_detected": 0}, user_id)
        return gagal(
            message="Ekstraksi berhasil tapi gagal menyimpan baris ke database (kesalahan database).",
            errors={"code": "BULK_INSERT_FAILED"}, status_code=500,
        )

    await run_in_threadpool(dbc.touch_sales_import_template_usage, template["id"])

    return sukses(
        data={**source_file, "template_matched": True, "rows_extracted": len(baris_ekstrak)},
        message=f"File berhasil diekstrak pakai template yang sudah dipelajari sebelumnya ({len(baris_ekstrak)} baris).",
        status_code=201,
    )


# ============================================================
# PROMOTE -- naikkan source_rows yang valid jadi financial_transaction_
# sales_invoices "resmi" (Draft), supaya baru dari titik ini data ikut
# muncul di tab Sales Transaction / Journal Preview / Posted / Overview
# (semuanya baca dari tabel invoices, BUKAN source_rows). Lihat §4.1
# SALES_IMPORT_TEMPLATES.md untuk tabel pemetaan kolomnya.
#
# SENGAJA endpoint TERPISAH (bukan otomatis sekali upload) -- baris yang
# is_valid=false atau invoice_no-nya bentrok dengan invoice yang sudah ada
# TIDAK IKUT naik, supaya data akuntansi tidak tercemar data yang belum
# ditinjau. User (lewat tombol di SalesSourceData.tsx) yang memutuskan
# kapan baris hasil upload ini "resmi" jadi transaksi Sales.
# ============================================================

@router.post(
    "/source-files/{source_file_id}/promote-to-invoices",
    summary="Naikkan baris valid hasil ekstraksi jadi invoice Sales resmi (khusus Supervisor ke atas)",
    responses={
        200: {"description": "Selesai diproses -- lihat ringkasan created/skipped di response."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        404: {"description": "Source file tidak ditemukan."},
    },
)
def promote_source_file_to_invoices(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    source_file = dbc.get_sales_source_file_by_id(source_file_id, termasuk_nonaktif=True)
    if source_file is None:
        return gagal(message="Source file tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)

    user_id = current_user.get("id")  # management_users.id -- untuk created_by / dibuat_oleh
    client_id = source_file.get("management_client_id")  # FK client_id -> management_clients
    rows = dbc.list_sales_source_rows(source_file_id=source_file_id, termasuk_nonaktif=False)

    dibuat = 0
    dilewati_tidak_valid = 0
    dilewati_sudah_pernah = 0
    dilewati_invoice_bentrok = 0

    for row in rows:
        if not row.get("is_valid"):
            dilewati_tidak_valid += 1
            continue
        if dbc.get_sales_invoice_by_source_row_id(row["id"]):
            dilewati_sudah_pernah += 1
            continue
        no_invoice = row.get("no_invoice")
        if not no_invoice:
            dilewati_tidak_valid += 1
            continue
        if dbc.get_sales_invoice_by_client_and_no(client_id, no_invoice):
            dilewati_invoice_bentrok += 1
            continue

        invoice_baru = dbc.create_sales_invoice({
            "client_id": client_id,
            "management_client_id": source_file.get("management_client_id"),
            "invoice_no": no_invoice,
            "invoice_date": row.get("tanggal"),
            "customer_name": row.get("nama_customer") or "-",
            "cabang": row.get("cabang"),
            "dpp": row.get("dpp") or 0,
            "ppn": row.get("ppn") or 0,
            "gross_amount": row.get("total") or 0,
            "tax_invoice_status": "Belum Terbit Faktur",
            "posting_status": "Draft",
            "source_row_id": row["id"],
        }, created_by=user_id)
        if invoice_baru is not None:
            dibuat += 1
            # Akun jurnal langsung mengikuti akun default klien (COA klien) --
            # dilewati diam-diam kalau klien belum punya pengaturan akun.
            dbc.pastikan_mapping_sales(invoice_baru["id"], dibuat_oleh=client_id)
        else:
            dilewati_invoice_bentrok += 1  # gagal simpan (mis. race condition duplikat) -- hitung sbg dilewati, bukan error keras

    if dibuat > 0:
        dbc.update_sales_source_file(source_file_id, {"status_ekstraksi": "Berhasil"}, updated_by=client_id)

    ringkasan = {
        "total_baris": len(rows),
        "invoice_dibuat": dibuat,
        "dilewati_tidak_valid": dilewati_tidak_valid,
        "dilewati_sudah_pernah_dipromosikan": dilewati_sudah_pernah,
        "dilewati_invoice_no_bentrok": dilewati_invoice_bentrok,
    }
    return sukses(
        data=ringkasan,
        message=(
            f"{dibuat} invoice baru dibuat dari {len(rows)} baris "
            f"({dilewati_tidak_valid} tidak valid, {dilewati_sudah_pernah} sudah pernah dipromosikan, "
            f"{dilewati_invoice_bentrok} bentrok no. invoice)."
        ),
    )