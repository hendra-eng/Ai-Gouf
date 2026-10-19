"""
modules/transactions/purchase_import_v1.py
=============================================
Upload file laporan pembelian (CSV/PDF/Excel) + ekstraksi otomatis lewat
Purchase Import Template -- versi Purchase dari
modules/transactions/journal_entry_import_v1.py (alur SENGAJA dibuat
separalel mungkin, lihat root/SALES_IMPORT_TEMPLATES.md untuk konsep
templatenya). Endpoint upload:

    POST /api/v1/transactions/purchase/import/upload
    (multipart/form-data: file, management_client_id)

Alur (ringkas) -- SAMA dengan Sales Source Data (sales_import_v1.py):

    1. Baca file mentah (bytes), tentukan file_type dari ekstensi.
    2. Ambil semua template AKTIF milik (management_client_id, file_type)
       dari financial_transaction_purchase_import_templates. Baris template
       ber-file_type 'Multi' (1 setting klien untuk beberapa format file,
       mis. seed_template_sau_multi_format_purchase.sql) dipecah jadi
       template virtual per varian di mapping_rules.variants -- varian yang
       file_type-nya sama dengan file upload ikut jadi kandidat (algoritma
       SAMA dengan Sales: _kandidat_template di sales_import_v1.py).
       Varian CSV, PDF dan Excel sudah bisa diproses (Excel: format_type
       'flat_grouped_purchase_report', lihat _parse_flat_grouped_purchase_report).
    3. Cocokkan baris header_row_index ke column_signature_hash -- fungsi
       baca file & hash DIPAKAI ULANG dari sales_import_v1 (algoritma sama).
    4. KETEMU template -> ekstrak blok transaksi pakai resep mapping_rules
       (format_type 'grouped_purchase_report' untuk CSV, lihat
       _parse_grouped_purchase_report; 'grouped_purchase_report_pdf' untuk
       PDF, lihat _parse_grouped_purchase_report_pdf), lalu SIMPAN sebagai
       STAGING:
         - 1 baris di financial_transaction_purchase_source_files (daftar
           file di tab Source Data + angka AI Extraction Summary), dan
         - 1 baris per transaksi di financial_transaction_purchase_source_rows
           (File Preview + Data Quality Check; `payload` = header + item).
       Di tahap ini BELUM ada Purchase Transaction -- sama seperti Sales
       yang belum membuat invoice saat upload.
    5. TIDAK ketemu template -> file tetap dicatat sebagai 'Butuh Review'
       (rows_detected=0, template_matched=false), tidak ada baris staging.
    6. Tombol "Buat Transaksi" di tab Source Data memanggil
           POST /api/v1/transactions/purchase/source-files/{id}/promote-to-transactions
       yang menaikkan baris VALID jadi Purchase Transaction (status 'draft')
       + baris itemnya lewat dbc.create_purchase_transaction_with_lines.
       Baru dari titik ini data muncul di tab Purchase Transaction ->
       Purchase Preview (approve) -> Posted / Exceptions / Overview.
       Baris tidak valid, sudah pernah dipromosikan, atau nomor transaksinya
       bentrok dengan transaksi yang sudah ada TIDAK ikut naik.

Endpoint lain tab Source Data: GET/PUT/DELETE /source-files[/{id}] dan
GET /source-rows?source_file_id=...

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
    PENGECUALIAN (peringatan, bukan penolakan): kalau selisihnya persis
    sebesar "Biaya :" cetak, artinya POS mencetak Biaya tetapi TIDAK
    memasukkannya ke "Total Akhir" (contoh SAU: OL BL-000001890-26, Biaya
    150). Blok tetap valid, baris "Other Costs" tidak dibuat (supaya
    Hutang = Total Akhir cetak), dan peringatannya masuk ke
    validation_notes + notes transaksi. Dimatikan lewat recipe
    "biaya_tidak_ikut_total": "reject" (default "warn").

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

PDF (format_type 'grouped_purchase_report_pdf'): alurnya SAMA, tetapi PDF
tidak punya baris/sel, jadi dibaca sebagai KATA + POSISI (x0, x1, top) dari
text layer lewat pdfplumber (x_tolerance 2, y_tolerance 0,3 -- toleransi kecil
supaya band header tabel di puncak halaman lanjutan tidak menyatu dengan baris
lanjutan item). Kolom angka rata kanan -> dikenali lewat x1. Aturan pergantian
halaman (item/header tercetak 2x, footer/lanjutan item di halaman berikutnya,
ringkasan akhir terbelah) ada di recipe `page_break_rules`. PDF hasil scan
(tanpa text layer) tidak didukung -> 'Butuh Review'. Untuk PDF, tiap blok juga
dicek lebih ketat (jumlah total item harus = subtotal cetak; qty x harga yang
jauh meleset dari total item jadi peringatan) karena salah baca kolom tidak
akan ketahuan oleh pengecekan Total Akhir saja.

Excel (format_type 'flat_grouped_purchase_report', contoh NBM sheet DETAIL): tabel
FLAT -- 1 baris = 1 item, baris dengan kolom kunci (No ref) sama = 1 transaksi
pembelian. Tidak ada subtotal/footer/pajak: total transaksi = SUM(total item).
Aturan resep (semua opsional kecuali columns):
    - columns                : posisi kolom 1-based (tanggal, deskripsi, kategori_cost,
                               jumlah, harga, total, total_nota, supplier, purchase_no,
                               payment_date, payment_by, note)
    - tanggal_wajib=false    : transaksi TANPA tanggal tetap valid (purchase_date NULL;
                               posting wajib mengisi tanggal dulu)
    - line_account_by_cost   : akun per kategori Cost (kunci = teks Cost di-trim + huruf
                               kecil); tidak ada di peta -> line_account (default)
    - kategori_perlu_review  : kategori yang memunculkan peringatan (mis. aset tetap)
    - validation             : total_nota_toleransi (peringatan bila Total Inv beda dari
                               jumlah item), deskripsi_kosong_pengganti,
                               supplier_kosong_pengganti
    Blok bertotal <= 0 dan baris tanpa kunci/isi dilewati. Peringatan tidak membuat
    transaksi tidak valid.

Excel BUKU KAS KECIL bulanan (format_type 'monthly_petty_cash_ledger', klien AADL): 1 workbook =
1 cabang, 1 sheet per bulan ("Januari 2026"), kolom NO | TANGGAL | KETERANGAN | DEBET | CREDIT |
SALDO. TIDAK ada nomor nota, supplier, maupun pajak. Cara baca:
    - 1 baris CREDIT (pengeluaran) = 1 transaksi pembelian, 1 baris item, vendor generik
      ("Petty Cash <Cabang>"), nomor <prefix>-<YYYYMM>-<urut> (urut = urutan baris pengeluaran di
      sheet; kolom NO tidak dipakai karena sering ganda)
    - DEBET berawalan "Terima ..." (pencairan dana) dan baris Saldo Awal / Saldo Per dilewati;
      DEBET lain (mis. "Koreksi ...") jadi baris TIDAK VALID supaya terlihat di Source Data
    - tanggal boleh kosong (tanggal_wajib=false; tanggal_kosong="ikut_baris_sebelumnya" mengisi
      baris tanpa tanggal dengan tanggal baris bertanggal di atasnya, per sheet); tahun salah ketik (2025-01-05 di sheet Januari
      2026) dikoreksi ke tahun sheet; tanggal di luar bulan sheet diberi peringatan
    - kategori dari kata kunci (kategori_rules) -> catatan transaksi; akun per kategori
      (line_account_by_kategori) dan per cabang (line_account_by_dept) bila diisi, kalau tidak
      ikut Settings > Account Mapping
    - pencocokan template lewat hash baris JUDUL (judul_row_index) sheet bulanan, bukan baris
      header, karena header sama di beberapa cabang (lihat _cocokkan_template_excel_ledger)

Excel BUKU BIAYA FLAT (format_type 'flat_expense_ledger', klien EVITA): 1 sheet berisi tabel
pengeluaran harian -- kolom Tanggal | Periode | Kategori Biaya | Akun Bank | Jenis Transaksi |
Kode Transaksi | Jumlah. TIDAK ada nomor nota, supplier, qty maupun pajak, dan "Kode Transaksi" hanyalah
keterangan bebas (sering ganda), jadi baris TIDAK dikelompokkan. Cara baca:
    - 1 baris "Uang Keluar" bernilai > 0 = 1 transaksi pembelian, 1 baris item, vendor generik per
      Akun Bank ("<vendor_default> - BCA"), nomor <prefix>-<YYYYMM>-<urut> (urut = urutan baris di
      sheet per bulan tanggalnya)
    - "Uang Masuk" (mis. bunga bank) dan jumlah negatif/nol BUKAN pembelian: jadi baris TIDAK VALID
      (terlihat di Source Data, tidak jadi transaksi). Resep "uang_masuk"/"jumlah_negatif" = "abaikan"
      melewatinya tanpa jejak
    - baris sisa template (hanya tanggal/periode terisi, tanpa kategori/keterangan/jumlah) dilewati
    - akun per Kategori Biaya (line_account_by_kategori), kategori Purchase (purchase_category_by_kategori),
      akun Cr per Akun Bank (ap_account_by_bank -- paling spesifik, menimpa Settings > Account Mapping)
    - kategori_perlu_review (mis. pelunasan pajak/prive/aset) -> peringatan; kolom catatan (opsional,
      recipe.columns.catatan) masuk catatan transaksi
    - pencocokan template: hash baris header HANYA pada jendela kolom recipe.header_kolom [awal, akhir]
      (kolom di kiri/kanan tabel berisi menu & rumus yang berubah-ubah)

File TIDAK disimpan ke disk -- diproses di memory saja.
"""

from __future__ import annotations

import re
import time
from datetime import date, datetime
from io import BytesIO
from typing import Any, Dict, Iterator, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger
from .purchase_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi
from .sales_import_v1 import (  # algoritma baca-file & signature SAMA PERSIS, tidak ada alasan duplikasi
    FILE_TYPE_MULTI,
    MAX_UPLOAD_BYTES,
    _PdfSumber,
    _ambil_kolom,
    _baca_file_jadi_baris,
    _baris_sheet,
    _bulan_dari_nama_sheet,
    _buka_workbook_bulanan,
    _buang_cap_halaman,
    _cabang_dari_nama_file,
    _detect_file_type,
    _hash_baris,
    _kelompokkan_kata_jadi_baris,
    _norm_label,
    _norm_teks,
    _parse_angka,
    _parse_tanggal,
    _pilih_sheet_bulanan,
    _teks_baris,
    _template_dari_varian,
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
    """Template AKTIF milik klien yang cocok untuk file_type upload: baris
    ber-file_type sama apa adanya, ditambah varian ber-file_type sama dari
    baris 'Multi' (dipecah jadi template virtual lewat _template_dari_varian;
    id/client_id tetap milik baris aslinya supaya usage_count menunjuk ke 1
    setting yang sama)."""
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
    if file_type == "PDF":
        # PDF tidak punya baris/sel -- dicocokkan lewat band header tabel halaman 1,
        # dan mengembalikan _PdfSumber (bytes) sebagai pengganti "rows".
        return _cocokkan_template_pdf(content, _kandidat_template(management_client_id, file_type))
    kandidat = _kandidat_template(management_client_id, file_type)
    if file_type == "Excel":
        # Varian buku kas kecil bulanan (AADL): dicocokkan lewat baris judul semua sheet bulanan.
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
        # Opsional (recipe "header_kolom": [awal, akhir], 1-based): hash dihitung hanya pada jendela kolom
        # tabel -- sel di luar tabel (menu, rumus, hitungan) tidak boleh ikut signature (klien EVITA).
        jendela = mapping_rules.get("header_kolom")
        if jendela and len(jendela) == 2:
            baris_header = rows[idx][max(int(jendela[0]) - 1, 0):int(jendela[1])]
            if _hash_baris(baris_header) == template["column_signature_hash"]:
                return template, rows
            continue
        # Excel: lebar sheet (sel kosong di ujung baris header) bisa berubah antar penyimpanan
        # file, jadi hash dicoba juga setelah sel kosong di ujung dipangkas.
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

        hasil.append(_selesaikan_blok(
            purchase_no=_ambil_kolom(header, head_cols["no_transaksi"]),
            tanggal=_parse_tanggal(_ambil_kolom(header, head_cols["tanggal"]), date_format),
            dept=_ambil_kolom(header, head_cols["dept"]) if "dept" in head_cols else "",
            vendor_code=_ambil_kolom(header, head_cols["kode_supplier"]),
            vendor_name=_ambil_kolom(header, head_cols["nama_supplier"]),
            items=items,
            subtotal_cetak=subtotal_cetak,
            potongan=potongan,
            pajak=pajak,
            biaya=biaya,
            total_akhir=total_akhir,
            recipe=recipe,
        ))

        i += 1
        if i < n and _kosong(rows[i]):
            i += 1

    return hasil


# ============================================================
# 2b) Ekstraksi PDF: format_type 'grouped_purchase_report_pdf' -- laporan
#     yang SAMA dengan CSV, dicetak ke PDF. Dibaca sebagai KATA + POSISI.
# ============================================================

_PDF_X_TOLERANCE = 2.0       # pdfplumber extract_words(x_tolerance=...)
_PDF_Y_TOLERANCE = 0.3       # KECIL: band header tabel tumpang tindih dengan baris lanjutan item di puncak halaman
_PDF_TOLERANSI_BARIS = 3.0   # kata dengan selisih top <= 3 pt dianggap 1 baris
_PDF_TOLERANSI_X0 = 2.0      # pencocokan kata band header: teks sama + x0 +-2 pt
_RE_BULAT = re.compile(r"^\d+$")
_RE_ANGKA_KOLOM = re.compile(r"^-?[\d.,]+$")

# Cadangan kalau recipe tidak memuat anchors (nilai dari 4 PDF contoh SAU).
_BAND_TABEL_DEFAULT = [
    ("No", 20), ("Transaksi", 34), ("Tanggal", 110), ("Dept.", 175),
    ("Kode", 211), ("Supp.", 236), ("Nama", 274), ("Supplier", 301),
]
_BAND_ITEM_DEFAULT = [
    ("No.", 20), ("Kd.", 46), ("Item", 60), ("Nama", 110), ("Item", 133), ("Jml", 332),
    ("Satuan", 365), ("Harga", 439), ("Pot.", 468), ("%", 485), ("Total", 559),
]
_FOOTER_DEFAULT = (
    r"Pot\.\s*:\s*(-?[\d.]+)\s+Pajak\s*:\s*(-?[\d.]+)\s+(?:Biaya\s*:\s*(-?[\d.]+)\s+)?Total Akhir\s*:\s*(-?[\d.]+)"
)
# Cadangan longgar: nilai Biaya tanpa label di antara Pajak dan Total Akhir.
_RE_FOOTER_LONGGAR = re.compile(
    r"Pot\.\s*:\s*(-?[\d.,]+)\s+Pajak\s*:\s*(-?[\d.,]+)\s+(?:(?:Biaya\s*:\s*)?(-?[\d.,]+)\s+)?(?:Biaya\s*:\s*)?Total\s+Akhir\s*:\s*(-?[\d.,]+)",
    re.IGNORECASE,
)


def _iter_kata_pdf_purchase(content: bytes, hanya_halaman: Optional[int] = None) -> Iterator[Tuple[int, List[Dict[str, Any]]]]:
    """Hasilkan (nomor_halaman, kata) per halaman; kata = dict pdfplumber (text, x0, x1, top).
    SENGAJA pdfplumber (bukan pdfium seperti Sales): parser ini butuh x1 (kolom angka rata kanan)
    dan toleransi y kecil. Laporan pembelian puluhan halaman, jadi kecepatan bukan masalah."""
    import pdfplumber

    with pdfplumber.open(BytesIO(content)) as pdf:
        for no, page in enumerate(pdf.pages, start=1):
            try:
                kata = page.extract_words(x_tolerance=_PDF_X_TOLERANCE, y_tolerance=_PDF_Y_TOLERANCE)
            finally:
                page.flush_cache()
            yield no, kata
            if hanya_halaman is not None and no >= hanya_halaman:
                return


def _cocokkan_template_pdf(content: bytes, kandidat: List[Dict[str, Any]]) -> Optional[Tuple[Dict[str, Any], _PdfSumber]]:
    """Cocokkan PDF ke template: band header tabel ('No Transaksi | Tanggal | Dept. | Kode Supp. |
    Nama Supplier') harus ada di halaman 1 sebagai 1 baris, dan SHA-256 sel-selnya (algoritma sama
    dengan CSV: _hash_baris) harus = column_signature_hash varian. signature_rule.guard_judul_halaman_1
    (kalau ada) = judul yang wajib ada di halaman 1."""
    if not kandidat:
        return None
    try:
        _, kata = next(_iter_kata_pdf_purchase(content, hanya_halaman=1))
    except StopIteration:
        return None  # PDF tanpa halaman
    except Exception as e:
        logger.warning(f"Gagal membaca halaman 1 PDF: {e}")
        return None
    if not kata:
        return None  # tidak ada text layer (PDF scan) -- belum didukung
    teks_baris = [" " + _norm_teks(_teks_baris(b)) + " " for b in _kelompokkan_kata_jadi_baris(kata, _PDF_TOLERANSI_BARIS)]

    for template in kandidat:
        mapping_rules = template.get("mapping_rules") or {}
        if mapping_rules.get("format_type") != "grouped_purchase_report_pdf":
            continue
        sig = mapping_rules.get("signature_rule") or {}
        sel = sig.get("cells") or template.get("header_columns") or []
        if not sel:
            continue
        guard = sig.get("guard_judul_halaman_1")
        if guard and not any(_norm_teks(guard) in t for t in teks_baris):
            continue
        target = " " + " ".join(_norm_teks(c) for c in sel) + " "
        if not any(target in t for t in teks_baris):
            continue
        if _hash_baris(sel) == template["column_signature_hash"]:
            return template, _PdfSumber(content)
    return None


def _pola_band(recipe: Dict[str, Any], kunci: str, default: List[Tuple[str, float]]) -> List[Tuple[str, float]]:
    """Daftar (teks, x0) kata band header dari recipe.ignore.<kunci>.anchors_x0 ('Item#2' = 'Item' kedua)."""
    anchors = ((recipe.get("ignore") or {}).get(kunci) or {}).get("anchors_x0")
    if not anchors:
        return default
    return [(teks.split("#")[0], float(x0)) for teks, x0 in anchors.items()]


def _buang_band(baris: List[Dict[str, Any]], band: List[Tuple[str, float]]) -> List[Dict[str, Any]]:
    """Buang HANYA kata yang teks DAN x0-nya cocok dengan kata band (bukan seluruh baris): di puncak
    halaman lanjutan, baris lanjutan item bisa berada di baris yang sama dengan band header."""
    return [
        w for w in baris
        if not any(w["text"] == teks and abs(w["x0"] - x0) <= _PDF_TOLERANSI_X0 for teks, x0 in band)
    ]


def _rentang(cfg: Any, default: Tuple[float, float]) -> Tuple[float, float]:
    if isinstance(cfg, (list, tuple)) and len(cfg) == 2:
        return float(cfg[0]), float(cfg[1])
    return default


def _parse_grouped_purchase_report_pdf(sumber: _PdfSumber, recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Parser PDF laporan pembelian (1 transaksi = 1 blok) -- lihat docstring modul dan
    page_break_rules di recipe. Mesin status per BARIS (kata dikelompokkan lewat posisi top):

      header transaksi -> [lanjutan nama supplier] -> item (baris utama + baris lanjutan) ... ->
      subtotal -> footer "Pot. : X Pajak : Y [Biaya : Z] Total Akhir : T"

    Blok terbuka dari header sampai footer; footer/subtotal/lanjutan item boleh jatuh di halaman
    berikutnya. Berhenti di baris "TOTAL KESELURUHAN" (ringkasan akhir)."""
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "DD/MM/YYYY")
    head = recipe.get("purchase_header") or {}
    head_cols = head.get("columns_x0") or {}
    kol_head = {
        "no_transaksi": _rentang(head_cols.get("no_transaksi"), (0, 40)),
        "tanggal": _rentang(head_cols.get("tanggal"), (105, 170)),
        "dept": _rentang(head_cols.get("dept"), (170, 205)),
        "kode_supplier": _rentang(head_cols.get("kode_supplier"), (205, 270)),
        "nama_supplier": _rentang(head_cols.get("nama_supplier"), (270, 545)),
    }
    pola_no = re.compile(head.get("no_transaksi_pattern") or r"^[A-Z]{2,4}-\d{5,9}-\d{2}$")
    x_awal_nama_supplier = kol_head["nama_supplier"][0]

    ic = recipe.get("item_columns_x0") or {}
    kol_item = {
        "no_x0_max": _rentang((ic.get("no") or {}).get("x0"), (0, 40))[1],
        "kode_item": _rentang((ic.get("kode_item") or {}).get("x0"), (40, 106)),
        "nama_item": _rentang((ic.get("nama_item") or {}).get("x0"), (106, 330)),
        "satuan": _rentang((ic.get("satuan") or {}).get("x0"), (347, 420)),
        "jumlah": _rentang((ic.get("jumlah") or {}).get("x1"), (338, 347)),
        "harga": _rentang((ic.get("harga") or {}).get("x1"), (440, 470)),
        "potongan_persen": _rentang((ic.get("potongan_persen") or {}).get("x1"), (476, 505)),
        "total": _rentang((ic.get("total") or {}).get("x1"), (520, 600)),
    }
    x_lanjutan_maks = 300.0  # baris yang punya kata di x0 < 300 = item/lanjutan item; di luar itu = subtotal

    band_tabel = _pola_band(recipe, "table_header_band", _BAND_TABEL_DEFAULT)
    band_item = _pola_band(recipe, "item_header_band", _BAND_ITEM_DEFAULT)
    re_footer = re.compile((recipe.get("block_footer_marker") or {}).get("value") or _FOOTER_DEFAULT)
    end_marker = ((recipe.get("end_of_data_marker") or {}).get("value") or "TOTAL KESELURUHAN").upper()

    def angka(teks: str) -> float:
        return _parse_angka(teks, number_format)

    def kolom_header(w: Dict[str, Any]) -> Optional[str]:
        for nama, (lo, hi) in kol_head.items():
            if lo <= w["x0"] < hi:
                return nama
        return None

    def kolom_item(w: Dict[str, Any]) -> Optional[str]:
        # Kolom angka rata kanan -> pakai x1 (tepi kanan); kata harus berbentuk angka.
        if _RE_ANGKA_KOLOM.match(w["text"]):
            for nama in ("jumlah", "harga", "potongan_persen", "total"):
                lo, hi = kol_item[nama]
                if lo <= w["x1"] <= hi:
                    return nama
        if w["x0"] < kol_item["no_x0_max"]:
            return "no"
        for nama in ("satuan", "kode_item", "nama_item"):
            lo, hi = kol_item[nama]
            if lo <= w["x0"] < hi:
                return nama
        return None

    hasil: List[Dict[str, Any]] = []
    blok: Optional[Dict[str, Any]] = None  # blok terbuka (belum ada footer)

    def baru_item(no: int) -> Dict[str, Any]:
        return {"no": no, "kode": [], "nama": [], "satuan": [], "jumlah": None, "harga": None, "potongan_persen": None, "total": None}

    def isi_item(it: Dict[str, Any], kata: List[Dict[str, Any]]) -> None:
        for w in kata:
            k = kolom_item(w)
            if k in ("kode_item", "nama_item", "satuan"):
                it[{"kode_item": "kode", "nama_item": "nama", "satuan": "satuan"}[k]].append(w["text"])
            elif k in ("jumlah", "harga", "potongan_persen", "total"):
                if it[k] is None:  # kata angka pertama di kolom itu menang
                    it[k] = angka(w["text"])

    def tutup_blok(footer: Optional[Tuple[float, float, float, float]], paksa_error: Optional[str] = None) -> None:
        nonlocal blok
        b = blok
        blok = None
        if b is None:
            return
        errors: List[str] = [paksa_error] if paksa_error else []
        items: List[Dict[str, Any]] = []
        for it in b["items"]:
            if it["jumlah"] is None or it["total"] is None:
                errors.append(f"Item {it['no']}: quantity or total could not be read.")
            items.append({
                "no": it["no"],
                "kode_item": " ".join(it["kode"]),
                "nama_item": " ".join(it["nama"]),
                "jumlah": it["jumlah"] or 0.0,
                "satuan": " ".join(it["satuan"]),
                "harga": it["harga"] or 0.0,
                "potongan_persen": it["potongan_persen"] or 0.0,
                "total": it["total"] or 0.0,
            })
        potongan, pajak, biaya, total_akhir = footer if footer else (0.0, 0.0, 0.0, 0.0)
        subtotal_cetak = b["subtotal"] if b["subtotal"] is not None else round(sum(it["total"] for it in items), 2)
        if not footer and not paksa_error:
            errors.append("Block footer (Total Akhir) not found.")
        hasil.append(_selesaikan_blok(
            purchase_no=b["no_transaksi"],
            tanggal=_parse_tanggal(b["tanggal"], date_format),
            dept=b["dept"],
            vendor_code=b["kode_supplier"],
            vendor_name=b["nama_supplier"],
            items=items,
            subtotal_cetak=subtotal_cetak,
            potongan=potongan,
            pajak=pajak,
            biaya=biaya,
            total_akhir=total_akhir,
            recipe=recipe,
            errors=errors,
            ketat=True,
        ))

    selesai = False
    for _no_halaman, kata in _iter_kata_pdf_purchase(sumber.content):
        if selesai:
            break
        baris_halaman = _buang_cap_halaman(_kelompokkan_kata_jadi_baris(kata, _PDF_TOLERANSI_BARIS))
        for baris in baris_halaman:
            teks = _teks_baris(baris)
            if end_marker in teks.upper():
                selesai = True  # sisa file = ringkasan keseluruhan, bukan transaksi
                break

            # --- footer blok (dicek pada baris UTUH, sebelum kata band dibuang) ---
            m = re_footer.search(teks) or _RE_FOOTER_LONGGAR.search(teks)
            if m and blok is not None:
                g = m.groups()
                tutup_blok((angka(g[0]), angka(g[1]), angka(g[2]) if g[2] else 0.0, angka(g[3])))
                continue

            kata_bersih = _buang_band(_buang_band(baris, band_tabel), band_item)
            if not kata_bersih:
                continue  # baris band header saja

            pertama = kata_bersih[0]

            # --- header transaksi ---
            if pertama["x0"] < kol_head["no_transaksi"][1] and pola_no.match(pertama["text"]):
                kolom: Dict[str, List[str]] = {k: [] for k in kol_head}
                for w in kata_bersih:
                    k = kolom_header(w)
                    if k:
                        kolom[k].append(w["text"])
                nilai = {k: " ".join(v).strip() for k, v in kolom.items()}
                if blok is not None and blok["no_transaksi"] == nilai["no_transaksi"]:
                    # Header yang sama tercetak 2x (salinan di dasar halaman bisa tanpa Tanggal):
                    # JANGAN buka blok baru; isi/timpa kolom dari salinan yang lengkap.
                    for k, v in nilai.items():
                        if v:
                            blok[k] = v
                    continue
                if blok is not None:
                    tutup_blok(None)  # blok sebelumnya tidak pernah ketemu footer-nya
                blok = {**nilai, "items": [], "subtotal": None}
                continue

            if blok is None:
                continue  # kop halaman 1 / baris di luar blok

            ada_kata_kiri = any(w["x0"] < x_lanjutan_maks for w in kata_bersih)

            # --- lanjutan nama supplier: baris di bawah header, semua kata di kolom Nama Supplier, belum ada item ---
            if not blok["items"] and all(w["x0"] >= x_awal_nama_supplier for w in kata_bersih):
                blok["nama_supplier"] = (blok["nama_supplier"] + " " + " ".join(w["text"] for w in kata_bersih)).strip()
                continue

            # --- baris utama item: kata pertama (x0 < 40) = bilangan bulat ---
            if pertama["x0"] < kol_item["no_x0_max"] and _RE_BULAT.match(pertama["text"]):
                no_item = int(pertama["text"])
                if blok["items"] and blok["items"][-1]["no"] == no_item:
                    blok["items"][-1] = baru_item(no_item)  # item tercetak 2x di pergantian halaman: timpa dgn salinan kedua
                else:
                    blok["items"].append(baru_item(no_item))
                isi_item(blok["items"][-1], [w for w in kata_bersih[1:]])
                continue

            if not blok["items"]:
                continue

            terakhir = blok["items"][-1]
            if ada_kata_kiri:
                # baris lanjutan kode/nama item (bisa di halaman berikutnya) + angka yang kebetulan ikut di baris ini
                isi_item(terakhir, kata_bersih)
                continue

            # Baris tanpa kata di x0 < 300 = jumlah item total + subtotal -- kecuali item terakhir
            # masih kekurangan angka (angka kolom jatuh di baris terpisah dari baris utamanya).
            if terakhir["jumlah"] is None or terakhir["total"] is None:
                isi_item(terakhir, kata_bersih)
                continue
            for w in kata_bersih:
                if kolom_item(w) == "total" and blok["subtotal"] is None:
                    blok["subtotal"] = angka(w["text"])

    if blok is not None:
        tutup_blok(None)  # file berakhir saat blok masih terbuka
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


FORMAT_FLAT_EXPENSE = "flat_expense_ledger"


def _parse_flat_expense_ledger(rows: List[List[str]], recipe: Dict[str, Any]) -> List[Dict[str, Any]]:
    """1 baris 'Uang Keluar' > 0 = 1 transaksi pembelian (lihat docstring modul)."""
    number_format = recipe.get("number_format", {})
    date_format = recipe.get("date_format", "YYYY-MM-DD")
    cols = recipe["columns"]
    cabang = (recipe.get("cabang_tetap") or "").strip()
    prefix = recipe.get("nomor_prefix") or "EXP"
    vendor_default = recipe.get("vendor_default") or "Expense"
    pengganti_desc = recipe.get("deskripsi_kosong_pengganti", "(no description)")
    kategori_default = recipe.get("kategori_default", "Lainnya")
    mulai = max(int(recipe.get("data_start_row_index", 2)) - 1, 0)
    abaikan_masuk = recipe.get("uang_masuk", "tandai") == "abaikan"
    abaikan_negatif = recipe.get("jumlah_negatif", "tandai") == "abaikan"
    rx_masuk = re.compile(recipe.get("jenis_masuk_pattern", r"masuk"), re.IGNORECASE)
    akun_kategori = {
        _norm_label(k): v for k, v in (recipe.get("line_account_by_kategori") or {}).items()
        if isinstance(v, dict) and v.get("account_code")
    }
    kategori_pc = {_norm_label(k): v for k, v in (recipe.get("purchase_category_by_kategori") or {}).items() if v}
    perlu_review = {_norm_label(k) for k in (recipe.get("kategori_perlu_review") or [])}
    akun_bank = {
        _norm_label(k): v for k, v in (recipe.get("ap_account_by_bank") or {}).items()
        if isinstance(v, dict) and v.get("account_code")
    }

    def teks(row: List[str], kunci: str) -> str:
        return " ".join(_ambil_kolom(row, cols[kunci]).split()) if kunci in cols else ""

    hasil: List[Dict[str, Any]] = []
    urut_bulan: Dict[str, int] = {}
    for i in range(mulai, len(rows)):
        r = rows[i]
        if _kosong(r):
            continue
        posisi = f"row {i + 1}"
        mentah_tgl, kategori, bank = teks(r, "tanggal"), teks(r, "kategori_biaya"), teks(r, "akun_bank")
        jenis, ket, mentah_jml = teks(r, "jenis_transaksi"), teks(r, "kode_transaksi"), teks(r, "jumlah")
        if not (kategori or ket or mentah_jml or jenis or bank):
            continue  # sisa baris template: hanya tanggal/periode terisi
        jumlah = _parse_angka(mentah_jml, number_format)
        gambaran = f"'{ket}', {kategori or '-'}, {bank or '-'}"

        if jenis and rx_masuk.search(jenis):
            if not abaikan_masuk:
                hasil.append(_blok_ditandai(cabang, f"{posisi}: '{jenis}' {jumlah:,.0f} ({gambaran}) is not a purchase and was not imported (cash-in) -- review."))
            continue
        if jumlah < 0:
            if not abaikan_negatif:
                hasil.append(_blok_ditandai(cabang, f"{posisi}: negative amount {jumlah:,.0f} ({gambaran}) was not imported -- record the refund/reversal manually."))
            continue
        if jumlah == 0:
            if ket or kategori:
                hasil.append(_blok_ditandai(cabang, f"{posisi}: amount is empty or 0 ({gambaran}) -- not imported; if the cell holds a formula, re-save the file in Excel so its value is stored."))
            continue

        tanggal = _parse_tanggal(mentah_tgl, date_format) if mentah_tgl else None
        peringatan: List[str] = []
        errors: List[str] = []
        if mentah_tgl and tanggal is None:
            errors.append(f"Date '{mentah_tgl}' could not be read.")
        elif tanggal is None:
            errors.append("Date is empty.")
        bucket = f"{tanggal.year}{tanggal.month:02d}" if tanggal else "NODATE"
        urut_bulan[bucket] = urut_bulan.get(bucket, 0) + 1
        nomor = f"{prefix}-{bucket}-{urut_bulan[bucket]:04d}"

        if not kategori:
            peringatan.append(f"Cost category is empty; '{kategori_default}' was used.")
        nama_kategori = kategori or kategori_default
        kunci_kategori = _norm_label(nama_kategori)
        if akun_kategori and kunci_kategori not in akun_kategori:
            peringatan.append(f"Category '{nama_kategori}' has no account in line_account_by_kategori; the default account was used.")
        if kunci_kategori in perlu_review:
            peringatan.append(f"Category '{nama_kategori}' may be a liability settlement, owner draw or asset rather than an expense; review the account.")
        akun_ap = akun_bank.get(_norm_label(bank))
        if akun_bank and not akun_ap:
            peringatan.append(f"Bank '{bank or '-'}' has no entry in ap_account_by_bank; the default payable/cash account was used.")

        catatan_sumber = teks(r, "catatan")
        blok = _selesaikan_blok(
            purchase_no=nomor,
            tanggal=tanggal,
            dept=cabang,
            vendor_code="",
            vendor_name=f"{vendor_default} - {bank}" if bank else vendor_default,
            items=[{
                "no": "1", "kode_item": "", "nama_item": ket or pengganti_desc, "jumlah": 1.0,
                "satuan": "", "harga": jumlah, "potongan_persen": 0.0, "total": jumlah,
            }],
            subtotal_cetak=jumlah,
            potongan=0.0,
            pajak=0.0,
            biaya=0.0,
            total_akhir=jumlah,
            recipe=recipe,
            errors=errors,
        )
        akun = akun_kategori.get(kunci_kategori)
        if akun:
            for baris_item in blok["lines"]:
                baris_item["account_code"] = akun["account_code"]
                baris_item["account_name"] = akun.get("account_name")
        if kategori_pc.get(kunci_kategori):
            blok["category"] = kategori_pc[kunci_kategori]
        if akun_ap:
            blok["ap_account"] = {"account_code": akun_ap["account_code"], "account_name": akun_ap.get("account_name")}
        info = [f"Category: {nama_kategori}", f"Bank: {bank or '-'}", f"Source: {posisi}"]
        if catatan_sumber:
            info.append(f"Note: {catatan_sumber}")
        blok["warnings"].extend(peringatan)
        blok["notes"].extend([*peringatan, *info])
        hasil.append(blok)
    return hasil


def _ekstrak_dengan_template(rows: Any, template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    """rows = baris hasil decode (CSV) atau _PdfSumber (PDF)."""
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type == "grouped_purchase_report":
        hasil = _parse_grouped_purchase_report(rows, mapping_rules)
    elif format_type == "grouped_purchase_report_pdf":
        hasil = _parse_grouped_purchase_report_pdf(rows, mapping_rules)
    elif format_type == "flat_grouped_purchase_report":
        hasil = _parse_flat_grouped_purchase_report(rows, mapping_rules)
    elif format_type == FORMAT_EXCEL_LEDGER:
        hasil = _parse_monthly_petty_cash_ledger(rows, mapping_rules)
    elif format_type == FORMAT_FLAT_EXPENSE:
        hasil = _parse_flat_expense_ledger(rows, mapping_rules)
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


def _period_label(d: date) -> str:
    return f"{_BULAN_EN[d.month - 1]} {d.year}"


# ============================================================
# ENDPOINT -- Upload (staging)
# ============================================================

def _label_periode(tanggal: List[date]) -> Optional[str]:
    """'Oct 2026' kalau semua transaksi 1 bulan, 'Jul 2026 - Aug 2026' kalau lintas bulan."""
    if not tanggal:
        return None
    awal, akhir = _period_label(min(tanggal)), _period_label(max(tanggal))
    return awal if awal == akhir else f"{awal} - {akhir}"


def _susun_baris_staging(
    blok: List[Dict[str, Any]],
    template: Dict[str, Any],
    management_client_id: str,
    file_name: Optional[str],
    created_by_name: Optional[str],
) -> List[Dict[str, Any]]:
    """Ubah blok hasil ekstraksi jadi baris financial_transaction_purchase_source_rows.

    dpp = Total Akhir - Pajak (dasar sebelum pajak, sudah termasuk biaya lain & dikurangi
    potongan), ppn = Pajak, total = Total Akhir -> dpp + ppn = total, sama seperti kolom
    DPP/PPN/Total di Sales Source Data."""
    recipe = dict(template.get("mapping_rules") or {})
    # Settings > Account Mapping company menimpa akun UMUM template (akun per
    # cabang line_account_by_dept tetap paling spesifik).
    akun_setting = dbc.akun_purchase_setting(management_client_id)
    for kunci_recipe, kunci_setting in (("line_account", "line"), ("biaya_account", "biaya"), ("ap_account", "ap"), ("tax_account", "tax")):
        if akun_setting.get(kunci_setting):
            recipe[kunci_recipe] = {k: akun_setting[kunci_setting][k] for k in ("account_code", "account_name")}
    currency = recipe.get("currency_default", "IDR")
    category = recipe.get("category_default", "Inventory")

    nomor_ada = dbc.list_purchase_nos_by_client(management_client_id, [t["purchase_no"] for t in blok if t["purchase_no"]])
    nomor_di_file: set = set()

    hasil: List[Dict[str, Any]] = []
    for no, t in enumerate(blok, start=1):
        catatan_validasi = list(t["errors"])
        valid = not catatan_validasi
        peringatan = list(t.get("warnings") or [])  # tidak membuat baris tidak valid, tetap tampil di Data Quality
        duplikat = bool(t["purchase_no"]) and (t["purchase_no"] in nomor_ada or t["purchase_no"] in nomor_di_file)
        if t["purchase_no"]:
            nomor_di_file.add(t["purchase_no"])

        payload: Optional[Dict[str, Any]] = None
        if valid:
            _terapkan_akun_dept(t["lines"], t["dept"], recipe)
            akun_ap = t.get("ap_account") or recipe.get("ap_account") or {}  # per transaksi (mis. per Akun Bank) paling spesifik
            akun_pajak = recipe.get("tax_account") or {}
            cabang = f" ({t['dept']})" if t["dept"] else ""
            ringkasan = (
                f"Subtotal {t['subtotal']:,.0f}; Discount {t['potongan']:,.0f}; Tax {t['pajak']:,.0f}; "
                f"Other Costs {t['biaya']:,.0f}; Grand Total {t['total_akhir']:,.0f}"
            )
            payload = {
                # Isi ini dipakai apa adanya saat promote (purchase_date disimpan ISO string).
                "transaction": {
                    "client_id": management_client_id,
                    "management_client_id": management_client_id,
                    "purchase_no": t["purchase_no"][:100],
                    "purchase_date": t["purchase_date"].isoformat() if t["purchase_date"] else None,
                    "vendor_name": (t["vendor_name"] or "-")[:255],
                    "vendor_code": (t["vendor_code"] or None) and t["vendor_code"][:50],
                    "source_doc_type": "Import",
                    "source_ref": (file_name or "")[:100] or None,
                    "description": f"Purchase{cabang} - {t['vendor_name']}",
                    "category": t.get("category") or category,
                    "currency": currency,
                    "payment_status": "unpaid",
                    "status": "draft",
                    "period_label": _period_label(t["purchase_date"]) if t["purchase_date"] else None,
                    "created_by_name": created_by_name,
                    "notes": "; ".join([f"Dept: {t['dept']}" if t["dept"] else "", ringkasan, *t["notes"]]).strip("; "),
                    "ap_account_code": akun_ap.get("account_code") or None,
                    "ap_account_name": akun_ap.get("account_name") or None,
                    "tax_account_code": akun_pajak.get("account_code") or None,
                    "tax_account_name": akun_pajak.get("account_name") or None,
                },
                "lines": t["lines"],
                "totals": {
                    "subtotal": t["subtotal"], "potongan": t["potongan"], "pajak": t["pajak"],
                    "biaya": t["biaya"], "total_akhir": t["total_akhir"],
                },
            }

        hasil.append({
            "row_no": no,
            "tanggal": t["purchase_date"],
            "no_invoice": (t["purchase_no"] or None) and t["purchase_no"][:100],
            "nama_vendor": (t["vendor_name"] or None) and t["vendor_name"][:255],
            "vendor_code": (t["vendor_code"] or None) and t["vendor_code"][:50],
            "no_po": None,
            "cabang": (t["dept"] or None) and t["dept"][:100],
            "dpp": round(t["total_akhir"] - t["pajak"], 2),
            "ppn": round(t["pajak"], 2),
            "total": round(t["total_akhir"], 2),
            "is_valid": valid,
            "validation_notes": " ".join(catatan_validasi + peringatan) or None,
            "is_duplicate_candidate": duplikat,
            "payload": payload,
        })
    return hasil


@router.post(
    "/import/upload",
    summary="Upload file laporan pembelian (CSV/PDF/Excel) + ekstraksi otomatis pakai template ke staging Source Data (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File dicatat di daftar Source Data -- template cocok -> blok transaksi diekstrak ke source rows (BELUM jadi Purchase Transaction); tidak cocok -> ditandai 'Butuh Review'."},
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
    mulai = time.perf_counter()
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return gagal(
            message=f"File size ({len(content) / (1024*1024):.1f} MB) exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
            errors={"code": "FILE_TOO_LARGE"},
            status_code=400,
        )

    file_type = _detect_file_type(file.filename or "file")
    client_id = management_client_id  # kolom client_id di DB = FK ke management_clients (BUKAN id user)
    user_id = current_user.get("id")  # management_users.id -- akun yang login (untuk created_by/uploaded_by)
    diproses_oleh = current_user.get("nama") or current_user.get("username")

    dasar_file = {
        "client_id": client_id,
        "management_client_id": management_client_id,
        "file_name": file.filename,
        "file_type": file_type,
        "processed_by": diproses_oleh,
        "uploaded_by": user_id,
    }

    cocok = None
    try:
        cocok = await run_in_threadpool(_cocokkan_template, content, file_type, management_client_id)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Purchase Import untuk file {file.filename}: {e}")

    if cocok is None:
        source_file = dbc.create_purchase_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Butuh Review", "status_mapping": "Butuh Review",
        }, created_by=user_id)
        if source_file is None:
            return gagal(message="Failed to save source file (database error).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0, "transactions_detected": 0, "created": 0},
            message=(
                "No matching column pattern template found for this client & file format -- "
                "the file was saved as 'Butuh Review' and no rows were extracted. Create a template first (see "
                "backend/migrations/purchase/seed_template_sau_multi_format_purchase.sql as an example)."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        blok = await run_in_threadpool(_ekstrak_dengan_template, rows, template, file.filename)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        source_file = dbc.create_purchase_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Gagal", "status_mapping": "Gagal", "template_id": template["id"],
        }, created_by=user_id)
        return sukses(
            data={**(source_file or {}), "template_matched": True, "rows_extracted": 0, "transactions_detected": 0, "created": 0},
            message=f"Template found but extraction failed: {e}",
            status_code=201,
        )

    baris = await run_in_threadpool(_susun_baris_staging, blok, template, management_client_id, file.filename, diproses_oleh)

    rows_valid = sum(1 for r in baris if r["is_valid"])
    rows_invalid = len(baris) - rows_valid
    vendor = {r["nama_vendor"] for r in baris if r["nama_vendor"]}

    source_file = dbc.create_purchase_source_file({
        **dasar_file,
        "period_label": _label_periode([r["tanggal"] for r in baris if r["tanggal"]]),
        "vendor_hint": (next(iter(vendor)) if len(vendor) == 1 else ("Multi Vendor" if vendor else None)),
        "rows_detected": len(baris),
        "rows_valid": rows_valid,
        "rows_invalid": rows_invalid,
        "duplicate_count": sum(1 for r in baris if r["is_duplicate_candidate"]),
        "status_ekstraksi": "Berhasil" if rows_invalid == 0 else "Butuh Review",
        "status_mapping": "Berhasil",
        "confidence_score": template.get("ai_confidence"),
        "dpp_total": round(sum(r["dpp"] for r in baris), 2),
        "ppn_total": round(sum(r["ppn"] for r in baris), 2),
        "grand_total": round(sum(r["total"] for r in baris), 2),
        "extraction_duration_ms": int((time.perf_counter() - mulai) * 1000),
        "ai_model_version": template.get("ai_model_version"),
        "mapping_rules": template.get("mapping_rules"),
        "template_id": template["id"],
    }, created_by=user_id)
    if source_file is None:
        return gagal(message="Failed to save source file (database error).", status_code=500)

    if baris:
        n_tersimpan = await run_in_threadpool(dbc.create_purchase_source_rows_bulk, baris, source_file["id"], client_id, user_id)
        if n_tersimpan != len(baris):
            await run_in_threadpool(
                dbc.update_purchase_source_file, source_file["id"],
                {"status_ekstraksi": "Gagal", "status_mapping": "Gagal", "rows_detected": 0}, user_id,
            )
            return gagal(
                message="Extraction succeeded but saving the rows to the database failed (database error).",
                errors={"code": "BULK_INSERT_FAILED"}, status_code=500,
            )

    await run_in_threadpool(dbc.touch_purchase_import_template_usage, template["id"])

    return sukses(
        data={**source_file, "template_matched": True, "rows_extracted": len(baris), "transactions_detected": len(baris), "created": 0},
        message=f"File extracted using a previously learned template ({len(baris)} purchase transactions staged -- use 'Buat Transaksi' to create them).",
        status_code=201,
    )


# ============================================================
# ENDPOINT -- Daftar file & baris (tab Source Data)
# ============================================================

class PurchaseSourceFileUpdateRequest(BaseModel):
    mapping_rules: Optional[Dict[str, Any]] = None
    status_mapping: Optional[str] = None
    status_ekstraksi: Optional[str] = None
    vendor_hint: Optional[str] = None
    period_label: Optional[str] = None


@router.get(
    "/source-files",
    summary="Daftar file sumber Purchase (tab Source Data), difilter per company aktif",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_file(
    management_client_id: Optional[str] = Query(None, description="Filter company (management_clients.id) dari dropdown Switch Company."),
    client_id: Optional[str] = Query(None, description="Alias management_client_id (kompatibel dengan salesStore)."),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_purchase_source_files(management_client_id=management_client_id or client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-files/{source_file_id}",
    summary="Detail 1 file sumber Purchase",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_file(
    source_file_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_purchase_source_file_by_id(source_file_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-files/{source_file_id}",
    summary="Update file sumber Purchase -- mis. simpan Mapping Rules (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_file(
    source_file_id: str,
    payload: PurchaseSourceFileUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_purchase_source_file(source_file_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source file updated.")


@router.delete(
    "/source-files/{source_file_id}",
    summary="Nonaktifkan (soft-delete) file sumber Purchase -- transaksi yang sudah dibuat dari file ini TIDAK ikut terhapus",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_file(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_purchase_source_file(source_file_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source file deactivated.")


@router.get(
    "/source-rows",
    summary="Daftar baris preview hasil ekstraksi (filter per source_file) -- untuk panel File Preview & Data Quality Check",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_row(
    source_file_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    # payload (header + item lengkap) tidak dikirim -- berat & tidak dipakai panel preview.
    data = dbc.list_purchase_source_rows(source_file_id=source_file_id, termasuk_nonaktif=termasuk_nonaktif, dengan_payload=False)
    return sukses(data=data, message="OK")


# ============================================================
# PROMOTE -- naikkan source_rows valid jadi Purchase Transaction (draft)
# ============================================================
# SENGAJA endpoint TERPISAH (bukan otomatis saat upload), sama seperti
# promote-to-invoices di Sales: baris tidak valid / nomornya bentrok dengan
# transaksi yang sudah ada TIDAK ikut naik, supaya data akuntansi tidak
# tercemar data yang belum ditinjau. Idempoten -- baris yang sudah punya
# transaction_id dilewati.

@router.post(
    "/source-files/{source_file_id}/promote-to-transactions",
    summary="Naikkan baris valid hasil ekstraksi jadi Purchase Transaction draft (khusus Supervisor ke atas)",
    responses={
        200: {"description": "Selesai diproses -- lihat ringkasan created/skipped di response."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        404: {"description": "Source file tidak ditemukan."},
    },
)
def promote_source_file_to_transactions(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    source_file = dbc.get_purchase_source_file_by_id(source_file_id, termasuk_nonaktif=True)
    if source_file is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)

    user_id = current_user.get("id")
    nama_user = current_user.get("nama") or current_user.get("username")
    management_client_id = source_file.get("management_client_id")
    rows = dbc.list_purchase_source_rows(source_file_id=source_file_id, termasuk_nonaktif=False, dengan_payload=True)

    dibuat = 0
    dilewati_tidak_valid = 0
    dilewati_sudah_pernah = 0
    dilewati_nomor_bentrok = 0

    for row in rows:
        if not row.get("is_valid"):
            dilewati_tidak_valid += 1
            continue
        if row.get("transaction_id"):
            dilewati_sudah_pernah += 1
            continue
        payload = row.get("payload") or {}
        transaksi = dict(payload.get("transaction") or {})
        baris_item = payload.get("lines") or []
        no_transaksi = row.get("no_invoice")
        if not transaksi or not baris_item or not no_transaksi:
            dilewati_tidak_valid += 1
            continue
        if dbc.get_purchase_transaction_by_client_and_no(management_client_id, no_transaksi):
            dilewati_nomor_bentrok += 1
            continue

        try:
            tgl_teks = transaksi.get("purchase_date")
            # Tanggal kosong diperbolehkan (recipe tanggal_wajib=false) -> disimpan NULL.
            transaksi["purchase_date"] = date.fromisoformat(str(tgl_teks)[:10]) if tgl_teks else None
        except ValueError:
            dilewati_tidak_valid += 1
            continue
        transaksi["created_by_name"] = nama_user or transaksi.get("created_by_name")

        transaksi_baru = dbc.create_purchase_transaction_with_lines(transaksi, baris_item, created_by=user_id)
        if transaksi_baru is None:
            dilewati_nomor_bentrok += 1  # gagal simpan (mis. race condition nomor ganda) -- dihitung dilewati, bukan error keras
            continue
        dbc.update_purchase_source_row(row["id"], {"transaction_id": transaksi_baru["id"]}, updated_by=user_id)
        dibuat += 1

    if dibuat > 0:
        dbc.update_purchase_source_file(source_file_id, {"status_ekstraksi": "Berhasil"}, updated_by=user_id)

    ringkasan = {
        "total_baris": len(rows),
        "transaksi_dibuat": dibuat,
        "dilewati_tidak_valid": dilewati_tidak_valid,
        "dilewati_sudah_pernah_dipromosikan": dilewati_sudah_pernah,
        "dilewati_nomor_bentrok": dilewati_nomor_bentrok,
    }
    return sukses(
        data=ringkasan,
        message=(
            f"{dibuat} purchase transactions created from {len(rows)} rows "
            f"({dilewati_tidak_valid} invalid, {dilewati_sudah_pernah} already promoted, "
            f"{dilewati_nomor_bentrok} number conflicts)."
        ),
    )