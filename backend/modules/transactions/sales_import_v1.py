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
       mapping_rules.format_type: 'grouped_invoice_report' atau flat),
       simpan ke financial_transaction_sales_source_rows, naikkan
       usage_count template.
    5. TIDAK ketemu template -> BELUM ada inferensi AI terpasang (lihat
       "Langkah Implementasi" di SALES_IMPORT_TEMPLATES.md) -- file tetap
       disimpan sbg source_files tapi status_ekstraksi/status_mapping =
       'Butuh Review', TANPA baris source_rows. User perlu membuat
       template baru secara manual (lewat SQL seed atau -- kalau UI-nya
       dibangun nanti -- lewat modal Mapping Rules) sebelum file jenis ini
       bisa diekstrak otomatis.

PDF (format_type 'grouped_invoice_report_pdf'): alurnya SAMA, hanya cara baca
dan cara cocokkan signature-nya beda -- PDF tidak punya baris/sel, jadi file
dibaca sebagai KATA + POSISI (x0, top) dari text layer (pdfplumber), dan
signature = hash band header tabel yang tercetak di halaman 1. Resepnya
dibaca dari varian PDF di template 'Multi' (lihat seed_template_sau_multi_
format_sales.sql). PDF hasil scan (tanpa text layer) tidak didukung.

File TIDAK disimpan ke disk (storage_path tetap NULL) -- diproses di
memory saja, konsisten dengan komentar yang sudah ada di DDL
("storage_path ... NULL kalau storage belum disambungkan"). Menyimpan file
fisik (local disk / object storage) sengaja di luar scope perubahan ini.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from datetime import date, datetime
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


def _baca_excel_baris(content: bytes, sheet_name: Optional[str]) -> List[List[str]]:
    import openpyxl

    wb = openpyxl.load_workbook(BytesIO(content), data_only=True, read_only=True)
    ws = wb[sheet_name] if sheet_name and sheet_name in wb.sheetnames else wb.active
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
    for template in kandidat:
        mapping_rules = template.get("mapping_rules") or {}
        encoding = mapping_rules.get("encoding", "utf-8")
        delimiter = mapping_rules.get("delimiter", ",")
        try:
            rows = _baca_file_jadi_baris(content, file_type, encoding, delimiter, template.get("sheet_name"), mapping_rules.get("quoted_fields", False))
        except Exception as e:
            logger.warning(f"Gagal decode file pakai template {template['id']}: {e}")
            continue
        idx = template["header_row_index"] - 1
        if idx < 0 or idx >= len(rows):
            continue
        if _hash_baris(rows[idx]) == template["column_signature_hash"]:
            return template, rows
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
    for alt in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y"):
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
            "validation_notes": "; ".join(catatan) or None,
            "is_duplicate_candidate": False,  # agregat per no. invoice -> tidak mungkin dobel di dalam 1 file
        })
    return hasil


def _parse_flat_grouped_by_key(rows: List[List[str]], template: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Tabel flat 1 baris = 1 item/line (mis. export POS "Report Item
    Details"), banyak baris berbagi 1 key (Receipt Number) -> dijumlah jadi
    1 baris kanonis per key. Kolom dicari lewat NAMA di baris header, bukan
    posisi. dpp = jumlah kolom `dpp_columns`, ppn = jumlah `ppn_columns`,
    total = dpp + ppn. Baris refund yang bernilai negatif otomatis
    mengurangi total struk asalnya."""
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
    i_key = kolom(recipe["invoice_key"])
    i_tanggal = kolom(recipe["tanggal"])
    i_customer = kolom(recipe["customer"]) if recipe.get("customer") else None
    i_cabang = kolom(recipe["cabang"]) if recipe.get("cabang") else None
    i_dpp = [kolom(n) for n in recipe["dpp_columns"]]
    i_ppn = [kolom(n) for n in recipe.get("ppn_columns", [])]
    fallback = recipe.get("customer_fallback")  # mis. "Penjualan POS - {Outlet}"
    fallback_kolom = {n: kolom(n) for n in re.findall(r"\{([^}]+)\}", fallback or "")}
    customer_kosong = {v.strip().lower() for v in recipe.get("customer_kosong_jika", [])}  # mis. ["-"]
    abaikan_tanpa_key = recipe.get("abaikan_baris_tanpa_key", False)  # baris ringkasan/total di bawah data

    def angka(row: List[str], idx: int) -> float:
        return _parse_angka(_ambil_kolom(row, idx + 1), number_format)

    agregat: Dict[str, Dict[str, Any]] = {}
    for row in rows[template["data_start_row_index"] - 1:]:
        if all((c or "").strip() == "" for c in row):
            continue
        key = _ambil_kolom(row, i_key + 1)
        if not key and abaikan_tanpa_key:
            continue
        a = agregat.get(key)
        if a is None:
            customer = _ambil_kolom(row, i_customer + 1) if i_customer is not None else ""
            if customer.lower() in customer_kosong:
                customer = ""
            if not customer and fallback:
                customer = re.sub(r"\{([^}]+)\}", lambda m: _ambil_kolom(row, fallback_kolom[m.group(1)] + 1), fallback)
            cabang = _ambil_kolom(row, i_cabang + 1) if i_cabang is not None else ""
            a = agregat[key] = {"tanggal_raw": _ambil_kolom(row, i_tanggal + 1), "customer": customer, "cabang": cabang, "dpp": 0.0, "ppn": 0.0}
        a["dpp"] += sum(angka(row, i) for i in i_dpp)
        a["ppn"] += sum(angka(row, i) for i in i_ppn)
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