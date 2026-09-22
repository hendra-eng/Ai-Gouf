"""
modules/transactions/journal_entry_import_v1.py
==================================================
Upload file laporan jurnal (CSV/Excel) + ekstraksi otomatis lewat Journal
Entry Import Template -- versi Journal Entry dari
modules/transactions/sales_import_v1.py (bentuk & alur SENGAJA dibuat
separarel mungkin dengan modul itu, lihat root/SALES_IMPORT_TEMPLATES.md
untuk konsep templatenya secara umum). Endpoint tunggal:

    POST /api/v1/transactions/journal-entries/import/upload
    (multipart/form-data: file, management_client_id)

Alur (ringkas):

    1. Baca file mentah (bytes), tentukan file_type dari ekstensi.
    2. Ambil semua template AKTIF milik (management_client_id, file_type)
       dari financial_transaction_journal_entry_import_templates.
    3. Untuk tiap kandidat template: decode file pakai
       encoding+delimiter/sheet_name template itu, ambil baris di posisi
       header_row_index-nya, hash (SHA-256, dinormalisasi) -- kalau SAMA
       dengan column_signature_hash template, itu templatenya. Fungsi baca
       file & hash-nya DIPAKAI ULANG dari sales_import_v1 (algoritma sama
       persis, tidak ada alasan duplikasi).
    4. KETEMU template -> ekstrak baris pakai resep mapping_rules
       (format_type 'flat_grouped_by_voucher': baris-baris dengan nilai
       kolom kunci -- biasanya VOUCHER -- yang sama digabung jadi 1
       journal entry multi-baris), lalu buat draft + lines LANGSUNG lewat
       dbc.create_je_draft_with_lines (fungsi atomik yang sama dipakai
       endpoint POST /drafts/full & ImportJournalModal.tsx sisi frontend)
       -- BEDA dari Sales yang punya tahap staging (source_rows) sebelum
       "dipromosikan" ke invoices, karena data jurnal di sini SUDAH
       berbentuk pasangan debit/kredit yang siap jadi journal entry, tidak
       perlu tahap mapping akun terpisah.
    5. TIDAK ketemu template -> BELUM ada inferensi AI terpasang (sama
       seperti Sales di fase ini) -- endpoint mengembalikan
       template_matched=false TANPA membuat draft apa pun, supaya
       frontend bisa fallback ke jalur lain (mis. parsing alias kolom
       generik yang sudah ada di ImportJournalModal.tsx) atau memberi
       tahu user untuk membuat template baru dulu.

File TIDAK disimpan ke disk -- diproses di memory saja, konsisten dengan
sales_import_v1.py.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, File, Form, UploadFile

import db_client as dbc
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger
from .journal_entry_v1 import _require_level_v1  # dependency level-3 yang sama, hindari duplikasi
from .sales_import_v1 import (  # algoritma baca-file & signature SAMA PERSIS, tidak ada alasan duplikasi
    MAX_UPLOAD_BYTES,
    _ambil_kolom,
    _baca_file_jadi_baris,
    _detect_file_type,
    _hash_baris,
    _parse_angka,
    _parse_tanggal,
)

logger = get_module_logger("transactions_journal_entry_import_v1")

router = APIRouter(prefix="/api/v1/transactions/journal-entries", tags=["transactions-journal-entry-v1"])

_BULAN_ID = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


# ============================================================
# 1) Cocokkan file ke template yang sudah ada (versi sederhana dari
#    sales_import_v1._cocokkan_template -- belum ada kebutuhan varian
#    "Multi" untuk Journal Entry sejauh ini, tinggal ditambah kalau perlu).
# ============================================================

def _kandidat_template(management_client_id: str, file_type: str) -> List[Dict[str, Any]]:
    return [
        t for t in dbc.list_je_import_templates(client_id=management_client_id, hanya_aktif=True)
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
# 2) Ekstraksi: format_type 'flat_grouped_by_voucher' -- tabel flat,
#    baris-baris dengan nilai kolom kunci (mapping_rules.columns.voucher)
#    yang sama digabung jadi 1 journal entry multi-baris.
# ============================================================

def _cari_kolom(header: List[str], nama: str) -> Optional[int]:
    """Cari index kolom via NAMA (dinormalisasi trim+collapse-spasi+lower),
    bukan posisi -- lebih kebal terhadap file berikutnya yang urutan
    kolomnya sedikit berubah selama nama headernya tetap sama."""
    target = " ".join(nama.strip().lower().split())
    for i, h in enumerate(header):
        if " ".join((h or "").strip().lower().split()) == target:
            return i
    return None


def _parse_flat_grouped_by_voucher(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    """Kembalikan {"groups": [...], "skipped_no_key": int} -- lihat
    docstring modul untuk penjelasan format_type ini. Tiap group:
    {je_number, entry_date, description, source_type, lines: [...],
    total_debit, total_credit, balanced, errors: [...]}."""
    recipe = template["mapping_rules"]
    kolom = recipe["columns"]
    header_idx = template["header_row_index"] - 1
    data_idx = template["data_start_row_index"] - 1
    if header_idx < 0 or header_idx >= len(rows):
        return {"groups": [], "skipped_no_key": 0}
    header = rows[header_idx]

    idx = {key: _cari_kolom(header, nama) for key, nama in kolom.items()}
    key_field = recipe.get("je_number_source", "voucher")
    i_key = idx.get(key_field)
    if i_key is None:
        raise ValueError(f"Kolom kunci '{kolom.get(key_field)}' (field '{key_field}') tidak ditemukan di header file.")

    number_format = recipe.get("number_format", {})
    i_tanggal = idx.get(recipe.get("entry_date_source", "tanggal"))
    i_deskripsi = idx.get(recipe.get("description_source", "deskripsi"))
    i_deskripsi_fallback = idx.get(recipe.get("description_fallback_source", ""))
    i_akun_kode = idx.get(recipe.get("account_code_source", "kode_akun"))
    i_akun_nama = idx.get(recipe.get("account_name_source", "akun_deskripsi"))
    i_debit = idx.get(recipe.get("debit_source", "debit"))
    i_credit = idx.get(recipe.get("credit_source", "credit"))
    i_cost_center = idx.get(recipe.get("cost_center_source", ""))

    groups: "Dict[str, Dict[str, Any]]" = {}
    skipped_no_key = 0
    for row in rows[data_idx:]:
        if all((c or "").strip() == "" for c in row):
            continue
        key = _ambil_kolom(row, i_key + 1) if i_key is not None else ""
        if not key:
            skipped_no_key += 1
            continue
        g = groups.get(key)
        if g is None:
            g = groups[key] = {
                "je_number": key,
                "entry_date_raw": _ambil_kolom(row, i_tanggal + 1) if i_tanggal is not None else "",
                "description": (_ambil_kolom(row, i_deskripsi + 1) if i_deskripsi is not None else "")
                    or (_ambil_kolom(row, i_deskripsi_fallback + 1) if i_deskripsi_fallback is not None else ""),
                "source_type": recipe.get("source_type_default", "Import"),
                "lines": [],
            }
        g["lines"].append({
            "account_code": _ambil_kolom(row, i_akun_kode + 1) if i_akun_kode is not None else "",
            "account_name": (_ambil_kolom(row, i_akun_nama + 1) if i_akun_nama is not None else "") or None,
            "description": (_ambil_kolom(row, i_deskripsi + 1) if i_deskripsi is not None else "") or None,
            "debit": _parse_angka(_ambil_kolom(row, i_debit + 1) if i_debit is not None else "", number_format),
            "credit": _parse_angka(_ambil_kolom(row, i_credit + 1) if i_credit is not None else "", number_format),
            "cost_center": (_ambil_kolom(row, i_cost_center + 1) if i_cost_center is not None else "") or None,
        })

    date_format = recipe.get("date_format", "YYYY-MM-DD")
    min_lines = recipe.get("min_lines_per_group", 2)
    hasil = []
    for je_number, g in groups.items():
        total_debit = round(sum(l["debit"] for l in g["lines"]), 2)
        total_credit = round(sum(l["credit"] for l in g["lines"]), 2)
        entry_date = _parse_tanggal(g["entry_date_raw"], date_format)
        errors = []
        if entry_date is None:
            errors.append("Date could not be read.")
        if len(g["lines"]) < min_lines:
            errors.append(f"Minimum {min_lines} lines per journal entry.")
        if any(not l["account_code"] for l in g["lines"]):
            errors.append("There is a line without an account code.")
        if any(l["debit"] > 0 and l["credit"] > 0 for l in g["lines"]):
            errors.append("There is a line with both debit & credit filled in.")
        balanced = abs(total_debit - total_credit) < 0.01 and total_debit > 0
        if not balanced:
            errors.append(f"Not balanced (Debit {total_debit:,.2f} != Credit {total_credit:,.2f}).")
        hasil.append({
            "je_number": je_number,
            "entry_date": entry_date,
            "description": g["description"] or None,
            "source_type": g["source_type"],
            "lines": g["lines"],
            "total_debit": total_debit,
            "total_credit": total_credit,
            "balanced": balanced and not errors,
            "errors": errors,
        })
    return {"groups": hasil, "skipped_no_key": skipped_no_key}


def _ekstrak_dengan_template(rows: List[List[str]], template: Dict[str, Any]) -> Dict[str, Any]:
    mapping_rules = template.get("mapping_rules") or {}
    format_type = mapping_rules.get("format_type")
    if format_type == "flat_grouped_by_voucher":
        return _parse_flat_grouped_by_voucher(rows, template)
    raise ValueError(f"format_type '{format_type}' belum didukung parser Journal Entry Import.")


def _period_label(d: date) -> str:
    return f"{_BULAN_ID[d.month - 1]} {d.year}"


# ============================================================
# ENDPOINT
# ============================================================

@router.post(
    "/import/upload",
    summary="Upload file laporan jurnal (CSV/Excel) + buat draft otomatis pakai template (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File diproses -- lihat ringkasan created/skipped di response. template_matched=false berarti belum ada template yang cocok, TIDAK ada draft yang dibuat."},
        400: {"description": "Tipe file tidak didukung, atau file terlalu besar."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
    },
)
async def upload_journal_entry_import(
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
    client_id = current_user.get("id")  # management_users.id_user -- pemilik draft yang dibuat (akun yang login)
    created_by_name = current_user.get("nama") or current_user.get("username")

    cocok = None
    try:
        cocok = _cocokkan_template(content, file_type, management_client_id)
    except Exception as e:
        logger.warning(f"Gagal mencocokkan template Journal Entry Import untuk file {file.filename}: {e}")

    if cocok is None:
        return sukses(
            data={"template_matched": False, "groups_detected": 0, "created": 0, "drafts": []},
            message=(
                "No matching column pattern template found for this client & file format -- "
                "no draft was created. Create a new template first (see "
                "backend/migrations/seed_template_sau_jurnal_kas_kasir_excel.sql as an example) "
                "before this file type can be extracted automatically."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        ekstrak = _ekstrak_dengan_template(rows, template)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        return sukses(
            data={"template_matched": True, "groups_detected": 0, "created": 0, "drafts": []},
            message=f"Template found but extraction failed: {e}",
            status_code=201,
        )

    groups = ekstrak["groups"]
    currency = (template.get("mapping_rules") or {}).get("currency_default", "IDR")

    drafts_result: List[Dict[str, Any]] = []
    created = 0
    skipped_unbalanced = 0
    skipped_duplicate = 0

    for g in groups:
        if not g["balanced"]:
            skipped_unbalanced += 1
            drafts_result.append({"je_number": g["je_number"], "ok": False, "message": "; ".join(g["errors"])})
            continue
        if dbc.get_je_draft_by_client_and_number(client_id, g["je_number"]):
            skipped_duplicate += 1
            drafts_result.append({"je_number": g["je_number"], "ok": False, "message": "This je_number has already been imported previously for this client."})
            continue

        draft_data = {
            "client_id": client_id,
            "je_number": g["je_number"],
            "entry_date": g["entry_date"],
            "period_label": _period_label(g["entry_date"]),
            "description": g["description"],
            "source_type": g["source_type"],
            "source_reference": file.filename,
            "currency": currency,
            "status": "draft",
            "created_by_name": created_by_name,
        }
        dibuat = dbc.create_je_draft_with_lines(draft_data, g["lines"], created_by=client_id)
        if dibuat is None:
            drafts_result.append({"je_number": g["je_number"], "ok": False, "message": "Failed to save draft (database error)."})
            continue
        created += 1
        drafts_result.append({"je_number": g["je_number"], "ok": True, "message": f"Successfully imported ({len(g['lines'])} lines)."})

    dbc.touch_je_import_template_usage(template["id"])

    return sukses(
        data={
            "template_matched": True,
            "groups_detected": len(groups),
            "skipped_no_key_rows": ekstrak["skipped_no_key"],
            "created": created,
            "skipped_unbalanced": skipped_unbalanced,
            "skipped_duplicate": skipped_duplicate,
            "drafts": drafts_result,
        },
        message=f"{created} of {len(groups)} journal entries imported successfully using a previously learned template.",
        status_code=201,
    )
