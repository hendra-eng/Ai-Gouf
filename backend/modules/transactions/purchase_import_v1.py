"""
modules/transactions/purchase_import_v1.py
=============================================
Upload file laporan pembelian (CSV/Excel) + ekstraksi otomatis lewat
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
       Saat ini baru varian CSV yang bisa diproses; varian PDF/Excel
       belum punya parser di Purchase (kandidat PDF diabaikan).
    3. Cocokkan baris header_row_index ke column_signature_hash -- fungsi
       baca file & hash DIPAKAI ULANG dari sales_import_v1 (algoritma sama).
    4. KETEMU template -> ekstrak blok transaksi pakai resep mapping_rules
       (format_type 'grouped_purchase_report', lihat
       _parse_grouped_purchase_report), lalu SIMPAN sebagai STAGING:
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

import time
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

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
    _ambil_kolom,
    _baca_file_jadi_baris,
    _cabang_dari_nama_file,
    _detect_file_type,
    _hash_baris,
    _parse_angka,
    _parse_tanggal,
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


def _cocokkan_template(content: bytes, file_type: str, management_client_id: str) -> Optional[Tuple[Dict[str, Any], List[List[str]]]]:
    for template in _kandidat_template(management_client_id, file_type):
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
# 2) Ekstraksi: format_type 'grouped_purchase_report' -- laporan gaya
#    cetak (1 transaksi = 1 blok: header, label item, N item, subtotal,
#    footer Pot./Pajak/Biaya/Total Akhir, baris kosong).
# ============================================================

def _kosong(row: List[str]) -> bool:
    return all((c or "").strip() == "" for c in row)


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


def _ekstrak_dengan_template(rows: List[List[str]], template: Dict[str, Any], file_name: Optional[str] = None) -> List[Dict[str, Any]]:
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type != "grouped_purchase_report":
        raise ValueError(f"format_type '{format_type}' is not supported by the Purchase Import parser yet.")
    hasil = _parse_grouped_purchase_report(rows, mapping_rules)
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
        duplikat = bool(t["purchase_no"]) and (t["purchase_no"] in nomor_ada or t["purchase_no"] in nomor_di_file)
        if t["purchase_no"]:
            nomor_di_file.add(t["purchase_no"])

        payload: Optional[Dict[str, Any]] = None
        if valid:
            _terapkan_akun_dept(t["lines"], t["dept"], recipe)
            akun_ap = recipe.get("ap_account") or {}
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
                    "purchase_date": t["purchase_date"].isoformat(),
                    "vendor_name": (t["vendor_name"] or "-")[:255],
                    "vendor_code": (t["vendor_code"] or None) and t["vendor_code"][:50],
                    "source_doc_type": "Import",
                    "source_ref": (file_name or "")[:100] or None,
                    "description": f"Purchase{cabang} - {t['vendor_name']}",
                    "category": category,
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
            "validation_notes": " ".join(catatan_validasi) or None,
            "is_duplicate_candidate": duplikat,
            "payload": payload,
        })
    return hasil


@router.post(
    "/import/upload",
    summary="Upload file laporan pembelian (CSV/Excel) + ekstraksi otomatis pakai template ke staging Source Data (khusus Supervisor ke atas)",
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
            transaksi["purchase_date"] = date.fromisoformat(str(transaksi["purchase_date"])[:10])
        except (KeyError, ValueError):
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
