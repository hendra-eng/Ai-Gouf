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

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, UploadFile

import db_client as dbc
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .purchase_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi
from .sales_import_v1 import (  # algoritma baca-file & signature SAMA PERSIS, tidak ada alasan duplikasi
    MAX_UPLOAD_BYTES,
    _ambil_kolom,
    _baca_file_jadi_baris,
    _cabang_dari_nama_file,
    _detect_file_type,
    _hash_baris,
    _parse_angka,
    _parse_tanggal,
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
    return [
        t for t in dbc.list_purchase_import_templates(client_id=management_client_id, hanya_aktif=True)
        if t.get("file_type") == file_type
    ]


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
    client_id = management_client_id  # kolom client_id di DB = FK ke management_clients (BUKAN id user)
    user_id = current_user.get("id")  # management_users.id -- akun yang login (untuk created_by)
    created_by_name = current_user.get("nama") or current_user.get("username")

    cocok = None
    try:
        cocok = _cocokkan_template(content, file_type, management_client_id)
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
        blok = _ekstrak_dengan_template(rows, template, file.filename)
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
        }
        dibuat = dbc.create_purchase_transaction_with_lines(transaction_data, t["lines"], created_by=user_id)
        if dibuat is None:
            hasil_tx.append({"purchase_no": t["purchase_no"], "ok": False, "message": "Failed to save transaction (database error)."})
            continue
        created += 1
        hasil_tx.append({"purchase_no": t["purchase_no"], "ok": True, "message": f"Successfully imported ({len(t['lines'])} lines, total {t['total_akhir']:,.0f})."})

    dbc.touch_purchase_import_template_usage(template["id"])

    return sukses(
        data={
            "template_matched": True,
            "transactions_detected": len(blok),
            "created": created,
            "skipped_invalid": skipped_invalid,
            "skipped_duplicate": skipped_duplicate,
            "transactions": hasil_tx,
        },
        message=f"{created} of {len(blok)} purchase transactions imported successfully using a previously learned template.",
        status_code=201,
    )