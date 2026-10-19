"""
modules/transactions/journal_entry_import_v1.py
==================================================
Upload file laporan jurnal (CSV/Excel) + ekstraksi otomatis lewat Journal
Entry Import Template + daftar file/baris untuk tab "Source Data" Journal Entry
-- versi Journal Entry dari modules/transactions/purchase_import_v1.py (bentuk &
alur SENGAJA dibuat separarel mungkin; lihat root/SALES_IMPORT_TEMPLATES.md
untuk konsep templatenya secara umum). Endpoint:

    POST   /api/v1/transactions/journal-entries/import/upload
    GET    /api/v1/transactions/journal-entries/source-files
    GET    /api/v1/transactions/journal-entries/source-files/{id}
    PUT    /api/v1/transactions/journal-entries/source-files/{id}
    DELETE /api/v1/transactions/journal-entries/source-files/{id}
    GET    /api/v1/transactions/journal-entries/source-rows?source_file_id=
    POST   /api/v1/transactions/journal-entries/source-files/{id}/promote-to-journals

Alur (ringkas):

    1. Upload: baca file mentah, tentukan file_type, cocokkan ke template AKTIF
       milik (management_client_id, file_type) lewat hash baris header (fungsi
       baca file & hash DIPAKAI ULANG dari sales_import_v1).
    2. KETEMU template -> ekstrak baris pakai resep mapping_rules (format_type
       'flat_grouped_by_voucher': baris-baris dengan VOUCHER yang sama digabung
       jadi 1 journal entry multi-baris). Hasilnya dicatat di
       financial_transaction_journal_entry_source_files (daftar file) + 1 baris
       staging per journal entry di ..._source_rows (File Preview). BELUM ada
       draft JE di tahap ini.
    3. TIDAK ketemu template -> file tetap dicatat sebagai 'Needs Review' tanpa
       baris (template_matched=false) supaya frontend bisa fallback ke parsing
       lokal di ImportJournalModal.tsx atau memberi tahu user membuat template.
    4. "Create Journal" (promote-to-journals): baris VALID & belum pernah
       dipromosikan naik jadi draft JE lewat dbc.create_je_draft_with_lines
       (fungsi atomik yang sama dipakai New Journal Entry) -> muncul di tab
       JE Transaction -> Journal Preview -> Exceptions / Posted. Idempoten.

File TIDAK disimpan ke disk -- diproses di memory saja, konsisten dengan
sales_import_v1.py & purchase_import_v1.py.
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
# STAGING -- 1 journal entry (voucher) -> 1 baris source_rows
# ============================================================

def _susun_baris_staging(
    groups: List[Dict[str, Any]],
    template: Dict[str, Any],
    management_client_id: str,
    file_name: Optional[str],
    user_id: Optional[str],
    created_by_name: Optional[str],
) -> List[Dict[str, Any]]:
    """Ubah group hasil ekstraksi jadi baris financial_transaction_journal_entry_source_rows.

    is_valid = group lolos semua validasi (tanggal terbaca, minimal N baris, akun terisi,
    debit = kredit). is_duplicate_candidate = je_number sudah dipakai draft milik user ini
    (draft JE unik per (client_id=user, je_number)) -- baris tetap tampil, tapi promote akan
    melewatinya sebagai 'number conflict'."""
    currency = (template.get("mapping_rules") or {}).get("currency_default", "IDR")
    hasil: List[Dict[str, Any]] = []
    for no, g in enumerate(groups, start=1):
        valid = bool(g["balanced"])
        duplikat = bool(g["je_number"]) and dbc.get_je_draft_by_client_and_number(user_id, g["je_number"]) is not None

        payload: Optional[Dict[str, Any]] = None
        if valid:
            payload = {
                # Isi ini dipakai apa adanya saat promote (entry_date disimpan ISO string;
                # client_id diisi id user yang menekan Create Journal).
                "draft": {
                    "management_client_id": management_client_id,
                    "je_number": g["je_number"][:100],
                    "entry_date": g["entry_date"].isoformat(),
                    "period_label": _period_label(g["entry_date"]),
                    "description": g["description"],
                    "source_type": (g["source_type"] or "Import")[:20],
                    "source_reference": (file_name or "")[:100] or None,
                    "currency": currency,
                    "status": "draft",
                    "created_by_name": created_by_name,
                },
                "lines": g["lines"],
            }

        hasil.append({
            "row_no": no,
            "tanggal": g["entry_date"],
            "je_number": (g["je_number"] or None) and g["je_number"][:100],
            "description": g["description"],
            "source_type": (g["source_type"] or None) and g["source_type"][:20],
            "line_count": len(g["lines"]),
            "debit_total": g["total_debit"],
            "credit_total": g["total_credit"],
            "is_valid": valid,
            "validation_notes": "; ".join(g["errors"]) or None,
            "is_duplicate_candidate": duplikat,
            "payload": payload,
        })
    return hasil


def _label_periode(tanggal: List[date]) -> Optional[str]:
    if not tanggal:
        return None
    awal, akhir = min(tanggal), max(tanggal)
    if (awal.year, awal.month) == (akhir.year, akhir.month):
        return _period_label(awal)
    return f"{_period_label(awal)} - {_period_label(akhir)}"


# ============================================================
# ENDPOINT -- Upload
# ============================================================

@router.post(
    "/import/upload",
    summary="Upload file laporan jurnal (CSV/Excel) + ekstraksi otomatis pakai template ke staging Source Data (khusus Supervisor ke atas)",
    responses={
        201: {"description": "File dicatat di daftar Source Data -- template cocok -> journal entry diekstrak ke source rows (BELUM jadi draft JE); tidak cocok -> ditandai 'Needs Review'."},
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
    mulai = time.perf_counter()
    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        return gagal(
            message=f"File size ({len(content) / (1024*1024):.1f} MB) exceeds the {MAX_UPLOAD_BYTES // (1024*1024)} MB limit.",
            errors={"code": "FILE_TOO_LARGE"},
            status_code=400,
        )

    file_type = _detect_file_type(file.filename or "file")
    user_id = current_user.get("id")  # management_users.id -- akun yang login (pemilik draft saat promote)
    diproses_oleh = current_user.get("nama") or current_user.get("username")

    dasar_file = {
        "client_id": management_client_id,  # kolom client_id di tabel source = company (sama seperti Purchase)
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
        logger.warning(f"Gagal mencocokkan template Journal Entry Import untuk file {file.filename}: {e}")

    if cocok is None:
        source_file = dbc.create_je_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Needs Review", "status_mapping": "Needs Review",
        }, created_by=user_id)
        if source_file is None:
            return gagal(message="Failed to save source file (database error).", status_code=500)
        return sukses(
            data={**source_file, "template_matched": False, "rows_extracted": 0, "groups_detected": 0, "created": 0, "drafts": []},
            message=(
                "No matching column pattern template found for this client & file format -- "
                "the file was saved as 'Needs Review' and no entries were extracted. Create a new template first (see "
                "backend/migrations/journal_entry/seed_template_sau_jurnal_kas_kasir_excel.sql as an example) "
                "before this file type can be extracted automatically."
            ),
            status_code=201,
        )

    template, rows = cocok
    try:
        ekstrak = await run_in_threadpool(_ekstrak_dengan_template, rows, template)
    except Exception as e:
        logger.error(f"Gagal ekstraksi file {file.filename} pakai template {template['id']}: {e}")
        source_file = dbc.create_je_source_file({
            **dasar_file, "rows_detected": 0, "status_ekstraksi": "Failed", "status_mapping": "Failed", "template_id": template["id"],
        }, created_by=user_id)
        return sukses(
            data={**(source_file or {}), "template_matched": True, "rows_extracted": 0, "groups_detected": 0, "created": 0, "drafts": [], "note": f"Template found but extraction failed: {e}"},
            message=f"Template found but extraction failed: {e}",
            status_code=201,
        )

    baris = await run_in_threadpool(
        _susun_baris_staging, ekstrak["groups"], template, management_client_id, file.filename, user_id, diproses_oleh,
    )

    rows_valid = sum(1 for r in baris if r["is_valid"])
    rows_invalid = len(baris) - rows_valid

    source_file = dbc.create_je_source_file({
        **dasar_file,
        "period_label": _label_periode([r["tanggal"] for r in baris if r["tanggal"]]),
        "rows_detected": len(baris),
        "rows_valid": rows_valid,
        "rows_invalid": rows_invalid,
        "duplicate_count": sum(1 for r in baris if r["is_duplicate_candidate"]),
        "status_ekstraksi": "Completed" if baris and rows_invalid == 0 else "Needs Review",
        "status_mapping": "Completed" if baris else "Needs Review",
        "confidence_score": template.get("ai_confidence"),
        "debit_total": round(sum(r["debit_total"] for r in baris), 2),
        "credit_total": round(sum(r["credit_total"] for r in baris), 2),
        "extraction_duration_ms": int((time.perf_counter() - mulai) * 1000),
        "ai_model_version": template.get("ai_model_version"),
        "mapping_rules": template.get("mapping_rules"),
        "template_id": template["id"],
    }, created_by=user_id)
    if source_file is None:
        return gagal(message="Failed to save source file (database error).", status_code=500)

    if baris:
        n_tersimpan = await run_in_threadpool(dbc.create_je_source_rows_bulk, baris, source_file["id"], management_client_id, user_id)
        if n_tersimpan != len(baris):
            await run_in_threadpool(
                dbc.update_je_source_file, source_file["id"],
                {"status_ekstraksi": "Failed", "status_mapping": "Failed", "rows_detected": 0}, user_id,
            )
            return gagal(
                message="Extraction succeeded but saving the rows to the database failed (database error).",
                errors={"code": "BULK_INSERT_FAILED"}, status_code=500,
            )

    await run_in_threadpool(dbc.touch_je_import_template_usage, template["id"])

    # Ringkasan per journal entry -- dipakai langkah "result" di ImportJournalModal.
    ringkasan = [
        {
            "je_number": r["je_number"] or "-",
            "ok": r["is_valid"],
            "message": (
                f"Staged ({r['line_count']} lines) -- ready for Create Journal."
                if r["is_valid"] and not r["is_duplicate_candidate"]
                else (f"Staged, but this je_number already exists for your account." if r["is_valid"] else (r["validation_notes"] or "Invalid."))
            ),
        }
        for r in baris
    ]

    return sukses(
        data={
            **source_file,
            "template_matched": True,
            "rows_extracted": len(baris),
            "groups_detected": len(baris),
            "skipped_no_key_rows": ekstrak["skipped_no_key"],
            "created": 0,
            "drafts": ringkasan,
        },
        message=f"File extracted using a previously learned template ({len(baris)} journal entries staged -- use 'Create Journal' to create them).",
        status_code=201,
    )


# ============================================================
# ENDPOINT -- Daftar file & baris (tab Source Data)
# ============================================================

class JeSourceFileUpdateRequest(BaseModel):
    mapping_rules: Optional[Dict[str, Any]] = None
    status_mapping: Optional[str] = None
    status_ekstraksi: Optional[str] = None
    period_label: Optional[str] = None


@router.get(
    "/source-files",
    summary="Daftar file sumber Journal Entry (tab Source Data), difilter per company aktif",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_file(
    management_client_id: Optional[str] = Query(None, description="Filter company (management_clients.id) dari dropdown Switch Company."),
    client_id: Optional[str] = Query(None, description="Alias management_client_id (kompatibel dengan salesStore/purchaseStore)."),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_source_files(management_client_id=management_client_id or client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-files/{source_file_id}",
    summary="Detail 1 file sumber Journal Entry",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_file(
    source_file_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_source_file_by_id(source_file_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-files/{source_file_id}",
    summary="Update file sumber Journal Entry (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_file(
    source_file_id: str,
    payload: JeSourceFileUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_je_source_file(source_file_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source file updated.")


@router.delete(
    "/source-files/{source_file_id}",
    summary="Nonaktifkan (soft-delete) file sumber Journal Entry -- journal entry yang sudah dibuat dari file ini TIDAK ikut terhapus",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_file(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_je_source_file(source_file_id, deleted_by=current_user.get("id"))
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
    # payload (header + baris debit/kredit lengkap) tidak dikirim -- berat & tidak dipakai panel preview.
    data = dbc.list_je_source_rows(source_file_id=source_file_id, termasuk_nonaktif=termasuk_nonaktif, dengan_payload=False)
    return sukses(data=data, message="OK")


# ============================================================
# PROMOTE -- naikkan source_rows valid jadi draft Journal Entry
# ============================================================
# SENGAJA endpoint TERPISAH (bukan otomatis saat upload), sama seperti
# promote-to-transactions di Purchase: baris tidak valid / je_number-nya
# bentrok dengan draft yang sudah ada TIDAK ikut naik, supaya data akuntansi
# tidak tercemar data yang belum ditinjau. Idempoten -- baris yang sudah
# punya draft_id dilewati. Draft dimiliki user yang menekan tombol (client_id
# = id user, sama seperti draft dari New Journal Entry) supaya muncul di tab
# JE Transaction milik user itu.

@router.post(
    "/source-files/{source_file_id}/promote-to-journals",
    summary="Naikkan baris valid hasil ekstraksi jadi draft Journal Entry (khusus Supervisor ke atas)",
    responses={
        200: {"description": "Selesai diproses -- lihat ringkasan created/skipped di response."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        404: {"description": "Source file tidak ditemukan."},
    },
)
def promote_source_file_to_journals(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    source_file = dbc.get_je_source_file_by_id(source_file_id, termasuk_nonaktif=False)
    if source_file is None:
        return gagal(message="Source file not found.", errors={"code": "NOT_FOUND"}, status_code=404)

    user_id = current_user.get("id")
    nama_user = current_user.get("nama") or current_user.get("username")
    rows = dbc.list_je_source_rows(source_file_id=source_file_id, termasuk_nonaktif=False, dengan_payload=True)

    dibuat = 0
    dilewati_tidak_valid = 0
    dilewati_sudah_pernah = 0
    dilewati_nomor_bentrok = 0

    for row in rows:
        if not row.get("is_valid"):
            dilewati_tidak_valid += 1
            continue
        if row.get("draft_id"):
            dilewati_sudah_pernah += 1
            continue
        payload = row.get("payload") or {}
        draft = dict(payload.get("draft") or {})
        baris_jurnal = payload.get("lines") or []
        je_number = row.get("je_number")
        if not draft or not baris_jurnal or not je_number:
            dilewati_tidak_valid += 1
            continue
        if dbc.get_je_draft_by_client_and_number(user_id, je_number):
            dilewati_nomor_bentrok += 1
            continue

        try:
            draft["entry_date"] = date.fromisoformat(str(draft.get("entry_date"))[:10])
        except ValueError:
            dilewati_tidak_valid += 1
            continue
        draft["client_id"] = user_id
        draft["created_by_name"] = nama_user or draft.get("created_by_name")

        draft_baru = dbc.create_je_draft_with_lines(draft, baris_jurnal, created_by=user_id)
        if draft_baru is None:
            dilewati_nomor_bentrok += 1  # gagal simpan (mis. race condition nomor ganda) -- dihitung dilewati, bukan error keras
            continue
        dbc.update_je_source_row(row["id"], {"draft_id": draft_baru["id"]}, updated_by=user_id)
        dibuat += 1

    ringkasan = {
        "total_rows": len(rows),
        "journals_created": dibuat,
        "skipped_invalid": dilewati_tidak_valid,
        "skipped_already_promoted": dilewati_sudah_pernah,
        "skipped_number_conflict": dilewati_nomor_bentrok,
    }
    return sukses(
        data=ringkasan,
        message=(
            f"{dibuat} journal entries created from {len(rows)} rows "
            f"({dilewati_tidak_valid} invalid, {dilewati_sudah_pernah} already promoted, "
            f"{dilewati_nomor_bentrok} number conflicts)."
        ),
    )