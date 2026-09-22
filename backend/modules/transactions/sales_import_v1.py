"""
modules/transactions/sales_import_v1.py
==========================================
Upload file laporan penjualan (CSV/Excel) + ekstraksi otomatis lewat Sales
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
from typing import Any, Dict, List, Optional, Tuple

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
    # CSV/TXT dianggap delimited text -- PDF ditangani terpisah (tidak
    # pernah sampai fungsi ini, lihat endpoint di bawah).
    return _baca_csv_baris(content, encoding, delimiter, quoted_fields)


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
    summary="Upload file laporan penjualan (CSV/Excel) + ekstraksi otomatis pakai template (khusus Supervisor ke atas)",
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
    client_id = current_user.get("id")

    if file_type == "PDF":
        # [CATATAN] PDF belum didukung pembelajaran pola sama sekali --
        # lihat batasan fase ini di SALES_IMPORT_TEMPLATES.md. Tetap
        # dicatat sbg source_files supaya jejak upload-nya ada, tapi
        # langsung Butuh Review tanpa usaha ekstraksi apa pun.
        source_file = dbc.create_sales_source_file({
            "client_id": client_id,
            "management_client_id": management_client_id,
            "file_name": file.filename,
            "file_type": file_type,
            "rows_detected": 0,
            "status_ekstraksi": "Butuh Review",
            "status_mapping": "Butuh Review",
            "processed_by": current_user.get("nama") or current_user.get("username"),
            "uploaded_by": client_id,
        }, created_by=client_id)
        if source_file is None:
            return gagal(message="Gagal menyimpan source file (kesalahan database).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0},
            message="File PDF tercatat, tapi ekstraksi pola kolom belum didukung untuk PDF -- perlu ditinjau manual.",
            status_code=201,
        )

    cocok = None
    try:
        cocok = _cocokkan_template(content, file_type, management_client_id)
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
            "uploaded_by": client_id,
        }, created_by=client_id)
        if source_file is None:
            return gagal(message="Gagal menyimpan source file (kesalahan database).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0},
            message=(
                "Belum ada template pola kolom yang cocok untuk klien & format file ini -- "
                "file tersimpan sbg 'Butuh Review'. Buat template barunya dulu (lihat "
                "root/SALES_IMPORT_TEMPLATES.md) sebelum file jenis ini bisa diekstrak otomatis."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        baris_ekstrak = _ekstrak_dengan_template(rows, template, file.filename)
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
            "uploaded_by": client_id,
        }, created_by=client_id)
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
        "uploaded_by": client_id,
    }, created_by=client_id)
    if source_file is None:
        return gagal(message="Gagal menyimpan source file (kesalahan database).", status_code=500)

    for row_data in baris_ekstrak:
        dbc.create_sales_source_row({
            "source_file_id": source_file["id"],
            "client_id": client_id,
            **row_data,
        }, created_by=client_id)

    dbc.touch_sales_import_template_usage(template["id"])

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

    client_id = current_user.get("id")
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
        }, created_by=client_id)
        if invoice_baru is not None:
            dibuat += 1
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
