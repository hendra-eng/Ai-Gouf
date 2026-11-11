"""
modules/transactions/purchase_import_v1.py
=============================================
Upload file laporan pembelian (CSV/Excel) + ekstraksi otomatis lewat
Purchase Import Template -- versi Purchase dari
modules/transactions/journal_entry_import_v1.py (alur SENGAJA dibuat
separalel mungkin, lihat root/SALES_IMPORT_TEMPLATES.md untuk konsep
templatenya). Endpoint tunggal:

    POST /api/v1/transactions/purchase/import/upload
    (multipart/form-data: file, management_client_id)

Alur (ringkas):

    1. Baca file mentah (bytes), tentukan file_type dari ekstensi.
    2. Ambil semua template AKTIF milik (management_client_id, file_type)
       dari financial_transaction_purchase_import_templates.
    3. Cocokkan baris header_row_index ke column_signature_hash -- fungsi
       baca file & hash DIPAKAI ULANG dari sales_import_v1 (algoritma sama).
    4. KETEMU template -> ekstrak blok transaksi pakai resep mapping_rules
       (format_type 'grouped_purchase_report', lihat
       _parse_grouped_purchase_report), lalu buat Purchase Transaction +
       baris itemnya LANGSUNG lewat dbc.create_purchase_transaction_with_lines
       dengan status 'draft' -- sama seperti Journal Entry, tidak ada tahap
       staging karena tiap blok sudah memuat item lengkap + total.
    5. TIDAK ketemu template -> template_matched=false, tidak ada transaksi
       yang dibuat (belum ada inferensi AI, sama seperti Sales/JE).

Pemetaan angka footer blok ke kolom transaksi -- supaya jurnal yang
dibentuk Purchase Preview/Financial Statements (Dr akun baris = subtotal -
discount, Dr PPN Masukan = tax_amount, Cr Hutang = total) SAMA PERSIS
dengan "Total Akhir" di laporan:

    - Pot. % per item      -> discount baris itu (harga x jumlah - total item)
    - "Pot. :" blok        -> dialokasikan proporsional ke discount tiap baris
    - "Pajak :" blok       -> dialokasikan proporsional ke tax_amount tiap baris
    - "Biaya :" blok       -> 1 baris tambahan "Other Costs" (akun biaya_account)
    - selisih pembulatan antara SUM(total item) dan subtotal cetak blok ->
      diserap baris terakhir (subtotal cetak yang dianggap benar).
    Sisa pembulatan alokasi selalu dibebankan ke baris terakhir, jadi
    SUM(total baris) == Total Akhir persis. Blok yang tetap tidak cocok
    (selisih > toleransi) TIDAK dibuat -- dilaporkan di response.

Akun (mapping_rules template):
    - line_account / biaya_account : akun default baris item / baris biaya
    - line_account_by_dept         : {"CRS": {account_code, account_name}, ...}
                                     -- menimpa akun default untuk baris
                                     cabang/Dept. tsb (mis. persediaan per cabang SAU)
    - ap_account / tax_account     : akun Cr Hutang Usaha & Dr PPN Masukan,
                                     disimpan per transaksi (ap_account_* / tax_account_*)
    Akun umum di atas (line/biaya/ap/tax) ditimpa Settings > Account Mapping
    company (purchase_cogs / purchase_shipping / account_payable /
    purchase_tax_receivable) kalau sudah diatur.

File TIDAK disimpan ke disk -- diproses di memory saja.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from starlette.concurrency import run_in_threadpool

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from .purchase_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi
from .sales_import_v1 import (  # algoritma baca-file & signature SAMA PERSIS, tidak ada alasan duplikasi
    FILE_TYPE_MULTI,
    MAX_UPLOAD_BYTES,
    _ambil_kolom,
    _baca_file_jadi_baris,
    _baris_sheet,
    _bulan_dari_nama_sheet,
    _buka_workbook_bulanan,
    _cabang_dari_nama_file,
    _detect_file_type,
    _hash_baris,
    _norm_label,
    _parse_angka,
    _parse_tanggal,
    _pilih_sheet_bulanan,
    _template_dari_varian,
    ringkas_import_template,
)

logger = get_module_logger("transactions_purchase_import_v1")

router = APIRouter(prefix="/api/v1/transactions/purchase", tags=["transactions-purchase-v1"])

# Label periode pakai nama bulan Inggris -- UI Purchase seluruhnya berbahasa Inggris.
_BULAN_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

# Selisih (Rupiah) yang masih ditoleransi antara SUM(total baris) hasil
# alokasi dan "Total Akhir" cetak -- di atas ini blok dianggap rusak.
_TOLERANSI_TOTAL = 1.0


# ============================================================
# 1) Cocokkan file ke template yang sudah ada
# ============================================================

def _kandidat_template(management_client_id: str, file_type: str) -> List[Dict[str, Any]]:
    """Template AKTIF klien untuk file_type upload: baris ber-file_type sama apa
    adanya + varian ber-file_type sama dari baris 'Multi' (dipecah jadi template
    virtual lewat _template_dari_varian; id tetap milik baris aslinya supaya
    usage_count menunjuk ke 1 setting yang sama). Port dari branch hendra."""
    kandidat: List[Dict[str, Any]] = []
    for template in dbc.list_purchase_import_templates(client_id=management_client_id, hanya_aktif=True):
        if template.get("file_type") == file_type:
            kandidat.append(template)
        elif template.get("file_type") == FILE_TYPE_MULTI:
            for varian in (template.get("mapping_rules") or {}).get("variants", []):
                if varian.get("file_type") == file_type:
                    kandidat.append(_template_dari_varian(template, varian))
    return kandidat


def _cocokkan_template(content: bytes, file_type: str, management_client_id: str) -> Optional[Tuple[Dict[str, Any], Any]]:
    kandidat = _kandidat_template(management_client_id, file_type)
    if file_type == "Excel":
        # Varian buku kas kecil bulanan (AADL): dicocokkan lewat baris JUDUL semua sheet bulanan.
        ledger = [t for t in kandidat if (t.get("mapping_rules") or {}).get("format_type") == FORMAT_EXCEL_LEDGER]
        if ledger:
            cocok_ledger = _cocokkan_template_excel_ledger(content, ledger)
            if cocok_ledger is not None:
                return cocok_ledger
            id_ledger = {id(t) for t in ledger}
            kandidat = [t for t in kandidat if id(t) not in id_ledger]
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
        # Opsional (recipe "header_kolom": [awal, akhir], 1-based): hash hanya pada jendela kolom tabel.
        jendela = mapping_rules.get("header_kolom")
        if jendela and len(jendela) == 2:
            if _hash_baris(rows[idx][max(int(jendela[0]) - 1, 0):int(jendela[1])]) == template["column_signature_hash"]:
                return template, rows
            continue
        # Excel: lebar sheet (sel kosong di ujung baris header) bisa berubah antar penyimpanan
        # file, jadi hash dicoba juga setelah sel kosong di ujung dipangkas (NBM: 221 kolom).
        sig = template["column_signature_hash"]
        if _hash_baris(rows[idx]) == sig or _hash_baris(_pangkas_kosong_ujung(rows[idx])) == sig:
            return template, rows
    return None


# ============================================================
# 2) Ekstraksi: format_type 'grouped_purchase_report' -- laporan gaya
#    cetak (1 transaksi = 1 blok: header, label item, N item, subtotal,
#    footer Pot./Pajak/Biaya/Total Akhir, baris kosong).
# ============================================================

def _kosong(row: List[str]) -> bool:
    return all((c or "").strip() == "" for c in row)


def _pangkas_kosong_ujung(row: List[str]) -> List[str]:
    """Buang sel kosong di ujung kanan baris (hash header Excel tidak boleh bergantung pada lebar sheet)."""
    hasil = list(row)
    while hasil and not (hasil[-1] or "").strip():
        hasil.pop()
    return hasil


def _norm_teks(s: str) -> str:
    return " ".join((s or "").strip().lower().split())


def _alokasi(jumlah: float, basis: List[float]) -> List[float]:
    """Bagi `jumlah` proporsional terhadap `basis`, dibulatkan 2 desimal --
    sisa pembulatan masuk ke elemen terakhir supaya SUM(hasil) == jumlah."""
    if not basis:
        return []
    total_basis = sum(basis)
    if not jumlah:
        return [0.0] * len(basis)
    if total_basis <= 0:
        hasil = [0.0] * len(basis)
        hasil[-1] = round(jumlah, 2)
        return hasil
    hasil = [round(jumlah * b / total_basis, 2) for b in basis]
    hasil[-1] = round(hasil[-1] + (jumlah - sum(hasil)), 2)
    return hasil


def _susun_baris(items: List[Dict[str, Any]], subtotal_cetak: float, potongan: float, pajak: float, biaya: float, recipe: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Ubah item mentah + angka footer blok jadi baris
    PurchaseTransactionLine -- lihat docstring modul untuk aturannya."""
    akun = recipe.get("line_account") or {}
    akun_biaya = recipe.get("biaya_account") or akun
    catatan: List[str] = []

    lines: List[Dict[str, Any]] = []
    for it in items:
        gross = round(it["jumlah"] * it["harga"], 2)
        net = it["total"]
        # Pot. % per item -> discount; tanpa Pot. % pakai total cetak apa adanya
        # (harga cetak bisa sudah dibulatkan, jangan munculkan diskon semu).
        subtotal, discount = (gross, round(gross - net, 2)) if it["potongan_persen"] and gross >= net else (net, 0.0)
        lines.append({
            "item_code": (it["kode_item"] or None) and it["kode_item"][:50],
            "description": it["nama_item"] or it["kode_item"] or "Item",
            "quantity": it["jumlah"],
            "unit": (it["satuan"] or None) and it["satuan"][:20],
            "unit_price": it["harga"],
            "subtotal": subtotal,
            "discount": discount,
            "account_code": akun.get("account_code", ""),
            "account_name": akun.get("account_name"),
        })

    # selisih pembulatan item vs subtotal cetak -> baris terakhir
    selisih = round(subtotal_cetak - sum(l["subtotal"] - l["discount"] for l in lines), 2)
    if lines and selisih:
        if selisih > 0:
            lines[-1]["subtotal"] = round(lines[-1]["subtotal"] + selisih, 2)
        else:
            lines[-1]["discount"] = round(lines[-1]["discount"] - selisih, 2)
        catatan.append(f"Rounding difference {selisih:,.2f} between item totals and printed subtotal absorbed by the last line.")

    basis = [l["subtotal"] - l["discount"] for l in lines]
    for l, pot in zip(lines, _alokasi(potongan, basis)):
        l["discount"] = round(l["discount"] + pot, 2)
    basis_pajak = [l["subtotal"] - l["discount"] for l in lines]
    for l, tax in zip(lines, _alokasi(pajak, basis_pajak)):
        l["tax_amount"] = tax
        dasar = l["subtotal"] - l["discount"]
        l["tax_rate"] = round(tax / dasar * 100, 2) if dasar and tax else 0.0

    if biaya:
        lines.append({
            "item_code": None,
            "description": recipe.get("biaya_description", "Other Costs"),
            "quantity": 1,
            "unit": None,
            "unit_price": biaya,
            "subtotal": biaya,
            "discount": 0.0,
            "tax_amount": 0.0,
            "tax_rate": 0.0,
            "account_code": akun_biaya.get("account_code", ""),
            "account_name": akun_biaya.get("account_name"),
        })

    for l in lines:
        l["total"] = round(l["subtotal"] - l["discount"] + l["tax_amount"], 2)
    return lines, catatan


def _selesaikan_blok(
    *,
    purchase_no: str,
    tanggal: Optional[date],
    dept: str,
    vendor_code: str,
    vendor_name: str,
    items: List[Dict[str, Any]],
    subtotal_cetak: float,
    potongan: float,
    pajak: float,
    biaya: float,
    total_akhir: float,
    recipe: Dict[str, Any],
    errors: Optional[List[str]] = None,
    ketat: bool = False,
) -> Dict[str, Any]:
    """Susun 1 blok transaksi hasil ekstraksi (dipakai parser CSV dan PDF).

    errors  = masalah yang sudah ditemukan parser sebelum sini (blok jadi tidak valid).
    ketat   = pengecekan tambahan untuk PDF: jumlah total item harus = subtotal cetak
              (selain itu selisih diserap baris terakhir dan salah baca/duplikat item
              tidak ketahuan) dan qty x harga yang jauh meleset dari total item jadi
              peringatan (tanda salah baca kolom Jml/Harga).
    Peringatan (warnings) TIDAK membuat blok tidak valid.
    """
    errors = list(errors or [])
    warnings: List[str] = []
    if not purchase_no:
        errors.append("Transaction number is empty.")
    if tanggal is None and recipe.get("tanggal_wajib", True):
        errors.append("Date could not be read.")
    if not items:
        errors.append("Block has no item lines.")

    if ketat and items:
        jumlah_item = round(sum(it["total"] for it in items), 2)
        if abs(jumlah_item - subtotal_cetak) > _TOLERANSI_TOTAL + 0.5:
            errors.append(
                f"Sum of item totals {jumlah_item:,.2f} != printed subtotal {subtotal_cetak:,.2f} "
                "(an item line may be missing or duplicated)."
            )
        for it in items:
            harapan = it["jumlah"] * it["harga"] * (1 - (it["potongan_persen"] or 0) / 100.0)
            batas = max(2.0, it["jumlah"] * 0.5 + 1.0)  # harga cetak boleh sudah dibulatkan
            if abs(harapan - it["total"]) > batas:
                warnings.append(
                    f"Item {it.get('no', '?')}: quantity x price ({harapan:,.0f}) differs from printed total "
                    f"({it['total']:,.0f}) -- check quantity/price columns."
                )

    lines, catatan = _susun_baris(items, subtotal_cetak, potongan, pajak, biaya, recipe)
    total_baris = round(sum(l["total"] for l in lines), 2)

    if abs(total_baris - total_akhir) > _TOLERANSI_TOTAL:
        # POS mencetak "Biaya" tetapi tidak menjumlahkannya ke Total Akhir (SAU: OL BL-000001890-26).
        kebijakan = recipe.get("biaya_tidak_ikut_total", "warn")
        if kebijakan == "warn" and biaya and items:
            lines_tanpa_biaya, catatan_tanpa_biaya = _susun_baris(items, subtotal_cetak, potongan, pajak, 0.0, recipe)
            total_tanpa_biaya = round(sum(l["total"] for l in lines_tanpa_biaya), 2)
            if abs(total_tanpa_biaya - total_akhir) <= _TOLERANSI_TOTAL:
                warnings.append(
                    f"Printed Biaya {biaya:,.0f} is not included in the printed Total Akhir {total_akhir:,.0f}; "
                    "no 'Other Costs' line was created so the payable matches the printed total. "
                    "Verify against the original document."
                )
                lines, catatan, biaya, total_baris = lines_tanpa_biaya, catatan_tanpa_biaya, 0.0, total_tanpa_biaya
        if abs(total_baris - total_akhir) > _TOLERANSI_TOTAL:
            errors.append(f"Line total {total_baris:,.2f} != printed grand total {total_akhir:,.2f}.")

    return {
        "purchase_no": purchase_no,
        "purchase_date": tanggal,
        "dept": dept,
        "vendor_code": vendor_code,
        "vendor_name": vendor_name,
        "subtotal": subtotal_cetak,
        "potongan": potongan,
        "pajak": pajak,
        "biaya": biaya,
        "total_akhir": total_akhir,
        "lines": lines,
        "notes": [*catatan, *warnings],
        "warnings": warnings,
        "errors": errors,
    }


def _parse_grouped_purchase_report(rows: List[List[str]], recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "DD/MM/YYYY")
    head_cols = recipe["purchase_header"]["columns"]
    item_cols = recipe["item_columns"]
    sub_cols = recipe.get("block_subtotal_columns", {})
    footer_cols = recipe["block_footer_columns"]
    item_marker = recipe["item_header_marker"]["value"]
    footer_marker = recipe["block_footer_marker"]["value"]
    end_marker = recipe.get("end_of_data_marker", {}).get("value")
    delimiter = recipe.get("delimiter", ";")

    def gabung(row: List[str]) -> str:
        return delimiter.join(row)

    def angka(row: List[str], col: int) -> float:
        return _parse_angka(_ambil_kolom(row, col), number_format)

    hasil: List[Dict[str, Any]] = []
    i = recipe.get("block_start_row_index", 1) - 1
    n = len(rows)

    while i < n:
        row = rows[i]
        if end_marker and end_marker in gabung(row):
            break
        if _kosong(row):
            i += 1
            continue

        header = row
        i += 1
        if i < n and gabung(rows[i]).startswith(item_marker):
            i += 1

        items: List[Dict[str, Any]] = []
        subtotal_row: Optional[List[str]] = None
        while i < n and not gabung(rows[i]).startswith(footer_marker):
            r = rows[i]
            if end_marker and end_marker in gabung(r):
                break
            if _ambil_kolom(r, item_cols["no"]):
                items.append({
                    "kode_item": _ambil_kolom(r, item_cols["kode_item"]),
                    "nama_item": _ambil_kolom(r, item_cols["nama_item"]),
                    "jumlah": angka(r, item_cols["jumlah"]),
                    "satuan": _ambil_kolom(r, item_cols["satuan"]),
                    "harga": angka(r, item_cols["harga"]),
                    "potongan_persen": angka(r, item_cols["potongan_persen"]),
                    "total": angka(r, item_cols["total"]),
                })
            elif sub_cols and _ambil_kolom(r, sub_cols["subtotal"]):
                subtotal_row = r
            i += 1
        if i >= n or (end_marker and end_marker in gabung(rows[i])):
            break  # blok terpotong di akhir file -- hentikan, jangan buang exception

        footer = rows[i]
        potongan = angka(footer, footer_cols["potongan"])
        pajak = angka(footer, footer_cols["pajak"])
        biaya = angka(footer, footer_cols["biaya"])
        total_akhir = angka(footer, footer_cols["total_akhir"])
        subtotal_cetak = angka(subtotal_row, sub_cols["subtotal"]) if subtotal_row is not None else round(sum(it["total"] for it in items), 2)

        purchase_no = _ambil_kolom(header, head_cols["no_transaksi"])
        tanggal = _parse_tanggal(_ambil_kolom(header, head_cols["tanggal"]), date_format)
        errors: List[str] = []
        if not purchase_no:
            errors.append("Transaction number is empty.")
        if tanggal is None:
            errors.append("Date could not be read.")
        if not items:
            errors.append("Block has no item lines.")
        lines, catatan = _susun_baris(items, subtotal_cetak, potongan, pajak, biaya, recipe)
        total_baris = round(sum(l["total"] for l in lines), 2)
        if abs(total_baris - total_akhir) > _TOLERANSI_TOTAL:
            errors.append(f"Line total {total_baris:,.2f} != printed grand total {total_akhir:,.2f}.")

        hasil.append({
            "purchase_no": purchase_no,
            "purchase_date": tanggal,
            "dept": _ambil_kolom(header, head_cols["dept"]) if "dept" in head_cols else "",
            "vendor_code": _ambil_kolom(header, head_cols["kode_supplier"]),
            "vendor_name": _ambil_kolom(header, head_cols["nama_supplier"]),
            "subtotal": subtotal_cetak,
            "potongan": potongan,
            "pajak": pajak,
            "biaya": biaya,
            "total_akhir": total_akhir,
            "lines": lines,
            "notes": catatan,
            "errors": errors,
        })

        i += 1
        if i < n and _kosong(rows[i]):
            i += 1

    return hasil


# ============================================================
# 2c) Ekstraksi Excel flat: format_type 'flat_grouped_purchase_report' --
#     tabel 1 baris = 1 item, baris ber-kunci (No ref) sama = 1 transaksi.
#     Contoh: NBM, sheet DETAIL workbook AP_FAF.
# ============================================================

def _parse_flat_grouped_purchase_report(rows: List[List[str]], recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "YYYY-MM-DD")
    cols = recipe["columns"]
    validasi = recipe.get("validation") or {}
    tol_nota = float(validasi.get("total_nota_toleransi", _TOLERANSI_TOTAL))
    pengganti_desc = validasi.get("deskripsi_kosong_pengganti", "(no description)")
    pengganti_supplier = validasi.get("supplier_kosong_pengganti", "Unknown Supplier")
    peta_akun = {
        _norm_teks(k): v for k, v in (recipe.get("line_account_by_cost") or {}).items()
        if isinstance(v, dict) and v.get("account_code")
    }
    perlu_review = {_norm_teks(k) for k in (recipe.get("kategori_perlu_review") or [])}
    akun_default = recipe.get("line_account") or {}
    mulai = max(int(recipe.get("data_start_row_index", 2)) - 1, 0)

    def teks(row: List[str], kunci: str) -> str:
        return _ambil_kolom(row, cols[kunci]) if kunci in cols else ""

    def angka(row: List[str], kunci: str) -> float:
        return _parse_angka(teks(row, kunci), number_format) if kunci in cols else 0.0

    # 1) kelompokkan baris per kunci transaksi (urutan kemunculan pertama dipertahankan)
    grup: Dict[str, List[List[str]]] = {}
    for row in rows[mulai:]:
        if _kosong(row):
            continue
        kunci = re.sub(r"\s+", "", teks(row, "purchase_no")).upper()
        if not kunci:
            continue  # baris tanpa nomor transaksi tidak bisa dikelompokkan
        if not teks(row, "deskripsi") and not angka(row, "total"):
            continue  # baris template kosong
        grup.setdefault(kunci, []).append(row)

    hasil: List[Dict[str, Any]] = []
    for kunci, baris in grup.items():
        total_blok = round(sum(angka(r, "total") for r in baris), 2)
        if total_blok <= 0:
            continue  # transaksi bertotal 0 (baris template/batal) tidak dibuat
        peringatan: List[str] = []

        # tanggal: nilai terisi pertama; boleh kosong (tanggal_wajib=false)
        teks_tanggal = [teks(r, "tanggal") for r in baris if teks(r, "tanggal")]
        tanggal = _parse_tanggal(teks_tanggal[0], date_format) if teks_tanggal else None
        if teks_tanggal and tanggal is None:
            peringatan.append(f"Date '{teks_tanggal[0]}' could not be read; left empty.")
        tanggal_lain = {t for t in (_parse_tanggal(x, date_format) for x in teks_tanggal) if t}
        if len(tanggal_lain) > 1:
            peringatan.append(
                "Rows of this transaction have different dates (" + ", ".join(sorted(d.isoformat() for d in tanggal_lain)) + "); the first one was used."
            )

        # supplier: nilai terisi pertama
        nama_supplier = [teks(r, "supplier") for r in baris if teks(r, "supplier")]
        supplier = nama_supplier[0] if nama_supplier else ""
        if not supplier:
            supplier = pengganti_supplier
            peringatan.append(f"Supplier is empty; '{pengganti_supplier}' was used.")
        elif len({_norm_teks(x) for x in nama_supplier}) > 1:
            peringatan.append("Rows of this transaction have different suppliers (" + ", ".join(sorted({x for x in nama_supplier})) + "); the first one was used.")

        # item + akun per kategori Cost
        items: List[Dict[str, Any]] = []
        akun_item: List[Optional[Dict[str, Any]]] = []
        tanpa_peta = 0
        perlu_cek = 0
        for no, r in enumerate(baris, start=1):
            jumlah, harga, total = angka(r, "jumlah"), angka(r, "harga"), angka(r, "total")
            if jumlah <= 0 and total > 0:
                jumlah, harga = 1.0, total  # qty kosong: anggap 1 unit senilai total
            elif harga <= 0 and total > 0:
                harga = round(total / jumlah, 2)
            items.append({
                "no": str(no),
                "kode_item": "",
                "nama_item": teks(r, "deskripsi") or pengganti_desc,
                "jumlah": jumlah,
                "satuan": "",
                "harga": harga,
                "potongan_persen": 0.0,
                "total": total,
            })
            kategori = _norm_teks(teks(r, "kategori_cost"))
            akun = peta_akun.get(kategori)
            akun_item.append(akun)
            if akun is None:
                tanpa_peta += 1
            if kategori in perlu_review:
                perlu_cek += 1
        if tanpa_peta:
            peringatan.append(
                f"{tanpa_peta} line(s) have a blank/unknown Cost category; default account "
                f"{akun_default.get('account_code', '-')} was used."
            )
        if perlu_cek:
            peringatan.append(f"{perlu_cek} line(s) are in a category that may be a fixed asset or special item; review the account.")

        # Total Inv (total nota fisik) hanya pembanding
        total_nota = round(sum(angka(r, "total_nota") for r in baris), 2)
        if total_nota > 0 and abs(total_nota - total_blok) > tol_nota:
            peringatan.append(f"Sum of printed invoice totals {total_nota:,.0f} differs from the sum of item totals {total_blok:,.0f}.")

        # info pembayaran (hanya catatan, tidak mengubah status bayar)
        info: List[str] = []
        tgl_bayar = sorted({d.isoformat() for d in (_parse_tanggal(teks(r, "payment_date"), date_format) for r in baris if teks(r, "payment_date")) if d})
        if tgl_bayar:
            info.append("Payment date: " + ", ".join(tgl_bayar))
        bayar_oleh = sorted({teks(r, "payment_by") for r in baris if teks(r, "payment_by")})
        if bayar_oleh:
            info.append("Payment by: " + ", ".join(bayar_oleh))
        catatan_sumber = list(dict.fromkeys(teks(r, "note") for r in baris if teks(r, "note")))
        if catatan_sumber:
            info.append("Note: " + " | ".join(catatan_sumber))

        blok = _selesaikan_blok(
            purchase_no=kunci,
            tanggal=tanggal,
            dept="",
            vendor_code="",
            vendor_name=supplier,
            items=items,
            subtotal_cetak=total_blok,
            potongan=0.0,
            pajak=0.0,
            biaya=0.0,
            total_akhir=total_blok,
            recipe=recipe,
        )
        for baris_item, akun in zip(blok["lines"], akun_item):
            if akun:
                baris_item["account_code"] = akun["account_code"]
                baris_item["account_name"] = akun.get("account_name")
        blok["warnings"].extend(peringatan)
        blok["notes"].extend([*peringatan, *info])
        hasil.append(blok)
    return hasil


# ============================================================
# 2d) Excel BUKU KAS KECIL bulanan: format_type 'monthly_petty_cash_ledger'
#     1 workbook = 1 cabang, 1 sheet per bulan (klien AADL). Lihat docstring modul.
# ============================================================

FORMAT_EXCEL_LEDGER = "monthly_petty_cash_ledger"

_LEDGER_KOLOM_DEFAULT = {"no": 1, "tanggal": 2, "keterangan": 3, "debet": 4, "kredit": 5, "saldo": 6}
_SHEET_BUKAN_DATA = re.compile(r"^\s*(sheet\s*\d*(\s*\(\d+\))?|resume|meta|cek upload)\s*$", re.IGNORECASE)


class _LedgerSumber:
    """Pembungkus bytes workbook (pengganti "rows" untuk varian buku kas kecil, pola _PdfSumber):
    semua sheet bulanan dibaca oleh _parse_monthly_petty_cash_ledger."""

    def __init__(self, content: bytes):
        self.content = content


def _cocokkan_template_excel_ledger(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], "_LedgerSumber"]]:
    """Cocok kalau hash baris JUDUL (recipe.judul_row_index, default header_row_index) SALAH SATU
    sheet bulanan = column_signature_hash varian atau salah satu recipe.signature_alternatif.
    Judul dipakai (bukan baris header NO/TANGGAL/...) karena header-nya sama di beberapa cabang.
    Sel kosong di ujung baris dibuang dulu (lebar sheet beda-beda tiap bulan)."""
    try:
        wb = _buka_workbook_bulanan(content)
    except Exception as e:
        logger.warning(f"Gagal membuka workbook untuk pencocokan template buku kas kecil: {e}")
        return None
    try:
        hash_per_baris: Dict[int, set] = {}
        for template in kandidat:
            recipe = template.get("mapping_rules") or {}
            idx = int(recipe.get("judul_row_index") or template["header_row_index"])
            if idx not in hash_per_baris:
                hashes = set()
                for nama in wb.sheetnames:
                    if _bulan_dari_nama_sheet(nama)[0] is None:
                        continue
                    baris = next(wb[nama].iter_rows(min_row=idx, max_row=idx, values_only=True), None)
                    if baris is None:
                        continue
                    sel = _pangkas_kosong_ujung(["" if v is None else str(v) for v in baris])
                    if sel:
                        hashes.add(_hash_baris(sel))
                hash_per_baris[idx] = hashes
            diterima = {template["column_signature_hash"], *(recipe.get("signature_alternatif") or [])}
            if hash_per_baris[idx] & diterima:
                return template, _LedgerSumber(content)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Excel buku kas kecil: {e}")
    finally:
        wb.close()
    return None


def _nilai_angka_sel(v: Any, number_format: Dict[str, str]) -> float:
    if v is None or isinstance(v, bool):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    teks = str(v).strip()
    return _parse_angka(teks, number_format) if teks else 0.0


def _nilai_tanggal_sel(v: Any, date_format: str) -> Optional[date]:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    teks = str(v).strip() if v is not None else ""
    return _parse_tanggal(teks, date_format) if teks else None


def _cari_header_ledger(rows: List[List[Any]], header_row_index: int) -> Optional[int]:
    """Index (0-based) baris header (kolom A = 'NO'): di header_row_index kalau cocok, kalau tidak
    dicari di 15 baris teratas (kop sheet kadang bergeser satu baris)."""
    def cocok(i: int) -> bool:
        return 0 <= i < len(rows) and bool(rows[i]) and str(rows[i][0] or "").strip().lower() == "no"
    if cocok(header_row_index - 1):
        return header_row_index - 1
    return next((i for i in range(min(15, len(rows))) if cocok(i)), None)


def _blok_ditandai(cabang: str, pesan: str) -> Dict[str, Any]:
    """Baris TIDAK VALID berisi pesan (angka 0, tanpa nomor/tanggal) supaya hal yang perlu ditinjau
    terlihat di Source Data (status 'Butuh Review') dan tidak jadi transaksi -- bukan hilang diam-diam."""
    return {
        "purchase_no": "", "purchase_date": None, "dept": cabang, "vendor_code": "", "vendor_name": "",
        "subtotal": 0.0, "potongan": 0.0, "pajak": 0.0, "biaya": 0.0, "total_akhir": 0.0,
        "lines": [], "notes": [], "warnings": [], "errors": [pesan],
    }


def _parse_monthly_petty_cash_ledger(sumber: "_LedgerSumber", recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    kol = {**_LEDGER_KOLOM_DEFAULT, **(recipe.get("columns") or {})}
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "YYYY-MM-DD")
    cabang = (recipe.get("cabang_tetap") or "").strip()
    prefix = recipe.get("nomor_prefix") or "PC"
    vendor = recipe.get("vendor_default") or (f"Petty Cash {cabang}" if cabang else "Petty Cash")
    pengganti_desc = recipe.get("deskripsi_kosong_pengganti", "(no description)")
    header_row_index = int(recipe.get("header_row_index", 5))
    rx_baris_saldo = re.compile(recipe.get("abaikan_baris_jika_keterangan", r"^saldo"), re.IGNORECASE)
    rx_debet_masuk = re.compile(recipe.get("abaikan_debet_jika_keterangan", r"^terima"), re.IGNORECASE)
    aturan_kategori = [(a["kategori"], re.compile(a["pattern"], re.IGNORECASE), a.get("purchase_category")) for a in (recipe.get("kategori_rules") or [])]
    kategori_default = recipe.get("kategori_default", "Lainnya")
    kategori_pc_default = recipe.get("purchase_category_default")  # kategori Purchase (Utilities, Maintenance, ...)
    tanggal_kosong = recipe.get("tanggal_kosong", "kosong")  # "kosong" | "ikut_baris_sebelumnya"
    akun_kategori = {
        _norm_label(k): v for k, v in (recipe.get("line_account_by_kategori") or {}).items()
        if isinstance(v, dict) and v.get("account_code")
    }

    def sel(row: List[Any], kunci: str) -> Any:
        return row[kol[kunci] - 1] if len(row) >= kol[kunci] else None

    hasil: List[Dict[str, Any]] = []
    wb = _buka_workbook_bulanan(sumber.content)
    try:
        sheets, _ = _pilih_sheet_bulanan(wb, recipe)
        dipilih = {n for n, _, _ in sheets}
        for n in wb.sheetnames:
            if n not in dipilih and _bulan_dari_nama_sheet(n)[0] is None and not _SHEET_BUKAN_DATA.match(n):
                hasil.append(_blok_ditandai(cabang, f"Sheet '{n.strip()}' is not recognised as a monthly sheet (name pattern 'Agustus 2026') -- ignored, this month was NOT imported."))

        for nama, tahun, bulan in sheets:
            rows = _baris_sheet(wb[nama])
            hi = _cari_header_ledger(rows, header_row_index)
            if hi is None:
                hasil.append(_blok_ditandai(cabang, f"Sheet '{nama}': header row (NO / TANGGAL / KETERANGAN / DEBET / CREDIT) not found -- sheet skipped."))
                continue
            urut = 0
            tanggal_terakhir: Optional[date] = None  # untuk tanggal_kosong = ikut_baris_sebelumnya (per sheet)
            for i in range(hi + 1, len(rows)):
                r = rows[i]
                if all(v is None or str(v).strip() == "" for v in r):
                    continue
                ket = " ".join(str(sel(r, "keterangan") or "").split())
                if ket and rx_baris_saldo.match(ket):
                    continue  # Saldo Awal / Saldo Per ...
                debet = _nilai_angka_sel(sel(r, "debet"), number_format)
                kredit = _nilai_angka_sel(sel(r, "kredit"), number_format)
                posisi = f"sheet '{nama}', row {i + 1}"

                if kredit > 0 and debet > 0:
                    hasil.append(_blok_ditandai(cabang, f"{posisi}: '{ket}' has both Debit {debet:,.0f} and Credit {kredit:,.0f} -- not imported, review."))
                    continue
                if kredit <= 0:
                    if debet > 0 and not (ket and rx_debet_masuk.match(ket)):
                        pesan = f"'{ket}'" if ket else "an entry without description"
                        hasil.append(_blok_ditandai(cabang, f"{posisi}: Debit {debet:,.0f} ({pesan}) is not a purchase and was not imported (cash-in/correction) -- review."))
                    elif kredit < 0 and ket:
                        hasil.append(_blok_ditandai(cabang, f"{posisi}: negative Credit {kredit:,.0f} ('{ket}') -- not imported, review."))
                    continue  # pencairan dana, baris total/kosong, teks tanpa nominal

                if not ket and sel(r, "no") in (None, "") and sel(r, "tanggal") in (None, ""):
                    hasil.append(_blok_ditandai(cabang, f"{posisi}: Credit {kredit:,.0f} has no description, number or date (looks like a stray total) -- not imported, review."))
                    continue

                urut += 1
                nomor = f"{prefix}-{tahun}{bulan:02d}-{urut:03d}"
                peringatan: List[str] = []
                info: List[str] = []

                mentah = sel(r, "tanggal")
                tanggal = _nilai_tanggal_sel(mentah, date_format)
                if tanggal is not None:
                    if tanggal.year != tahun and tanggal.month == bulan:
                        try:
                            asli, tanggal = tanggal, tanggal.replace(year=tahun)
                            peringatan.append(f"Date {asli.isoformat()} has a different year than the sheet; corrected to {tanggal.isoformat()}.")
                        except ValueError:
                            pass
                    selisih = (tanggal.year - tahun) * 12 + tanggal.month - bulan
                    if selisih not in (0, -1):
                        peringatan.append(f"Date {tanggal.isoformat()} is outside the sheet period {tahun}-{bulan:02d}; verify.")
                    else:
                        tanggal_terakhir = tanggal
                elif mentah not in (None, ""):
                    peringatan.append(f"Date '{mentah}' could not be read; left empty.")
                elif tanggal_kosong == "ikut_baris_sebelumnya" and tanggal_terakhir is not None:
                    # Buku kas ditulis berurutan: baris tanpa tanggal ikut tanggal baris bertanggal di atasnya (sheet yang sama).
                    tanggal = tanggal_terakhir
                    info.append(f"Date not in the source; taken from the previous dated row ({tanggal.isoformat()}).")
                if not ket:
                    peringatan.append("Description is empty in the source.")

                kategori, kategori_pc = next(((nm, pc) for nm, rx, pc in aturan_kategori if rx.search(ket)), (kategori_default, kategori_pc_default))
                akun = akun_kategori.get(_norm_label(kategori))
                blok = _selesaikan_blok(
                    purchase_no=nomor,
                    tanggal=tanggal,
                    dept=cabang,
                    vendor_code="",
                    vendor_name=vendor,
                    items=[{
                        "no": str(urut), "kode_item": "", "nama_item": ket or pengganti_desc, "jumlah": 1.0,
                        "satuan": "", "harga": kredit, "potongan_persen": 0.0, "total": kredit,
                    }],
                    subtotal_cetak=kredit,
                    potongan=0.0,
                    pajak=0.0,
                    biaya=0.0,
                    total_akhir=kredit,
                    recipe=recipe,
                )
                if akun:
                    for baris_item in blok["lines"]:
                        baris_item["account_code"] = akun["account_code"]
                        baris_item["account_name"] = akun.get("account_name")
                if kategori_pc:
                    blok["category"] = kategori_pc
                blok["warnings"].extend(peringatan)
                blok["notes"].extend([*peringatan, *info, f"Category: {kategori}", f"Source: {posisi}"])
                hasil.append(blok)
    finally:
        wb.close()
    return hasil


def _ekstrak_dengan_template(rows: Any, template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type == "grouped_purchase_report":
        hasil = _parse_grouped_purchase_report(rows, mapping_rules)
    elif format_type == "flat_grouped_purchase_report":
        hasil = _parse_flat_grouped_purchase_report(rows, mapping_rules)
    elif format_type == FORMAT_EXCEL_LEDGER:
        hasil = _parse_monthly_petty_cash_ledger(rows, mapping_rules)
    else:
        raise ValueError(f"format_type '{format_type}' is not supported by the Purchase Import parser yet.")
    cabang_file = _cabang_dari_nama_file(mapping_rules, file_name)
    for t in hasil:
        if not t["dept"] and cabang_file:  # Dept. di isi file menang atas nama file
            t["dept"] = cabang_file
    return hasil


def _terapkan_akun_dept(lines: List[Dict[str, Any]], dept: str, recipe: Dict[str, Any]) -> None:
    """Baris yang masih memakai akun default (line_account / biaya_account)
    dipindah ke akun cabang dari line_account_by_dept, kalau ada."""
    akun_dept = (recipe.get("line_account_by_dept") or {}).get((dept or "").strip().upper())
    if not akun_dept:
        return
    default = {
        (recipe.get("line_account") or {}).get("account_code"),
        (recipe.get("biaya_account") or {}).get("account_code"),
    } - {None, ""}
    for l in lines:
        if l.get("account_code") in default:
            l["account_code"] = akun_dept.get("account_code", l["account_code"])
            l["account_name"] = akun_dept.get("account_name", l.get("account_name"))


def _pesan_gagal_simpan(error_db: str, t: Dict[str, Any]) -> str:
    """Terjemahkan error DB saat simpan transaksi jadi pesan yang bisa ditindaklanjuti user
    (sebelumnya selalu 'database error' generik sehingga penyebab di server tidak kelihatan)."""
    e = error_db or ""
    if "PERIOD_LOCKED" in e:
        return "Failed to save: " + e.split("PERIOD_LOCKED:", 1)[-1].strip()
    if "purchase_date" in e and ("null value" in e or "not-null" in e.lower()):
        return ("Failed to save: the invoice date is empty in the file and this server's database does not allow "
                "an empty purchase date yet (run migration backend/migrations/purchase/34-allow_null_purchase_date.py), "
                "or fill in the date in the file and upload again.")
    if "value too long" in e:
        return f"Failed to save: a text value is longer than the database column allows ({e})."
    if "duplicate key" in e:
        return "Failed to save: this purchase number already exists in the database."
    if "column" in e and "does not exist" in e:
        return f"Failed to save: the server database schema is out of date ({e}) -- run the latest migrations."
    return f"Failed to save transaction (database error: {e})." if e else "Failed to save transaction (database error)."


def _period_label(d: Optional[date]) -> str:
    # purchase_date boleh NULL (tanggal_wajib=false, migration purchase/34) -> label "No Date".
    return f"{_BULAN_EN[d.month - 1]} {d.year}" if d else "No Date"  # kolom period_label NOT NULL


# ============================================================
# ENDPOINT
# ============================================================

@router.post(
    "/import/upload",
    summary="Upload file laporan pembelian (CSV/Excel) + buat transaksi draft otomatis pakai template (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File diproses -- lihat ringkasan created/skipped di response. template_matched=false berarti belum ada template yang cocok, TIDAK ada transaksi yang dibuat."},
        400: {"description": "File terlalu besar."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
    },
)
async def upload_purchase_import(
    file: UploadFile = File(...),
    management_client_id: str = Form(..., description="ID management_clients -- klien yang laporannya sedang diupload, WAJIB."),
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return gagal(
            message=f"File size ({len(content) / (1024*1024):.1f} MB) exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
            errors={"code": "FILE_TOO_LARGE"},
            status_code=400,
        )

    file_type = _detect_file_type(file.filename or "file")
    client_id = current_user.get("id")  # management_users.id_user -- pemilik transaksi (akun yang login)
    created_by_name = current_user.get("nama") or current_user.get("username")

    cocok = None
    try:
        # dijalankan di threadpool: workbook besar (NBM DETAIL 221 kolom) butuh puluhan detik
        cocok = await run_in_threadpool(_cocokkan_template, content, file_type, management_client_id)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Purchase Import untuk file {file.filename}: {e}")

    if cocok is None:
        return sukses(
            data={"template_matched": False, "transactions_detected": 0, "created": 0, "transactions": []},
            message=(
                "No matching column pattern template found for this client & file format -- "
                "no transaction was created. Create a template first (see "
                "backend/migrations/seed_template_sau_pembelian_detail_csv.sql as an example)."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        blok = await run_in_threadpool(_ekstrak_dengan_template, rows, template, file.filename)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        return sukses(
            data={"template_matched": True, "transactions_detected": 0, "created": 0, "transactions": []},
            message=f"Template found but extraction failed: {e}",
            status_code=201,
        )

    recipe = dict(template.get("mapping_rules") or {})
    # Settings > Account Mapping company menimpa akun UMUM template (akun per
    # cabang line_account_by_dept tetap paling spesifik).
    akun_setting = dbc.akun_purchase_setting(management_client_id)
    for kunci_recipe, kunci_setting in (("line_account", "line"), ("biaya_account", "biaya"), ("ap_account", "ap"), ("tax_account", "tax")):
        if akun_setting.get(kunci_setting):
            recipe[kunci_recipe] = {k: akun_setting[kunci_setting][k] for k in ("account_code", "account_name")}
    currency = recipe.get("currency_default", "IDR")
    category = recipe.get("category_default", "Inventory")

    hasil_tx: List[Dict[str, Any]] = []
    created = 0
    skipped_invalid = 0
    skipped_duplicate = 0
    with_warnings = 0

    for t in blok:
        if t["errors"]:
            skipped_invalid += 1
            hasil_tx.append({"purchase_no": t["purchase_no"] or "-", "ok": False, "message": " ".join(t["errors"])})
            continue
        if dbc.get_purchase_transaction_by_client_and_no(client_id, t["purchase_no"]):
            skipped_duplicate += 1
            hasil_tx.append({"purchase_no": t["purchase_no"], "ok": False, "message": "This purchase number has already been imported previously."})
            continue

        cabang = f" ({t['dept']})" if t["dept"] else ""
        _terapkan_akun_dept(t["lines"], t["dept"], recipe)
        akun_ap = recipe.get("ap_account") or {}
        akun_pajak = recipe.get("tax_account") or {}
        ringkasan = (
            f"Subtotal {t['subtotal']:,.0f}; Discount {t['potongan']:,.0f}; Tax {t['pajak']:,.0f}; "
            f"Other Costs {t['biaya']:,.0f}; Grand Total {t['total_akhir']:,.0f}"
        )
        transaction_data = {
            "client_id": client_id,
            "management_client_id": management_client_id,
            "purchase_no": t["purchase_no"][:100],
            "purchase_date": t["purchase_date"],
            "vendor_name": (t["vendor_name"] or "-")[:255],
            "vendor_code": (t["vendor_code"] or None) and t["vendor_code"][:50],
            "source_doc_type": "Import",
            "source_ref": (file.filename or "")[:100] or None,
            "description": f"Purchase{cabang} - {t['vendor_name']}",
            "category": t.get("category") or category,  # kategori per baris (buku kas kecil AADL) menang
            "currency": currency,
            "payment_status": "unpaid",
            "status": "draft",
            "period_label": _period_label(t["purchase_date"]),
            "created_by_name": created_by_name,
            "notes": "; ".join([f"Dept: {t['dept']}" if t["dept"] else "", ringkasan, *t["notes"]]).strip("; "),
            "ap_account_code": akun_ap.get("account_code") or None,
            "ap_account_name": akun_ap.get("account_name") or None,
            "tax_account_code": akun_pajak.get("account_code") or None,
            "tax_account_name": akun_pajak.get("account_name") or None,
        }
        error_db: List[str] = []
        dibuat = dbc.create_purchase_transaction_with_lines(transaction_data, t["lines"], created_by=client_id, error_out=error_db)
        if dibuat is None:
            skipped_invalid += 1
            hasil_tx.append({"purchase_no": t["purchase_no"], "ok": False, "message": _pesan_gagal_simpan(error_db[0] if error_db else "", t)})
            continue
        created += 1
        peringatan = t.get("warnings") or []
        if peringatan:
            with_warnings += 1
        pesan = f"Successfully imported ({len(t['lines'])} lines, total {t['total_akhir']:,.0f})."
        if t["purchase_date"] is None:
            pesan += " Date is empty -- fill it in before posting."
        if peringatan:
            pesan += " Warning: " + " ".join(peringatan)
        hasil_tx.append({"purchase_no": t["purchase_no"], "ok": True, "message": pesan})

    dbc.touch_purchase_import_template_usage(template["id"])

    return sukses(
        data={
            "template_matched": True,
            "transactions_detected": len(blok),
            "created": created,
            "skipped_invalid": skipped_invalid,
            "skipped_duplicate": skipped_duplicate,
            "with_warnings": with_warnings,
            "transactions": hasil_tx,
        },
        message=f"{created} of {len(blok)} purchase transactions imported successfully using a previously learned template.",
        status_code=201,
    )


@router.get(
    "/import/templates",
    summary="Daftar Purchase Import Template aktif milik company (dipakai modal Mapping Rules tab Source Data)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_purchase_import_template(
    management_client_id: str = Query(..., description="ID management_clients -- company aktif (Switch Company)."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = [ringkas_import_template(t) for t in dbc.list_purchase_import_templates(client_id=management_client_id, hanya_aktif=True)]
    return sukses(data=data, message="OK")
