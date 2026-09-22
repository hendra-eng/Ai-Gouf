"""
modules/transactions/journal_entry_v1.py
==========================================
Fitur "Transactions > Journal Entry" versi REST API standar:
/api/v1/transactions/journal-entries/...

Mengikuti standar YANG SAMA dengan modules/transactions/sales_v1.py (yang
sendirinya mengikuti modules/auth/v1.py & modules/management/clients_v1.py
-- lihat file-file itu untuk alasan detailnya):

    - Routing versi: /api/[version]/[group]/[fitur].
    - Response SELALU pakai amplop standar {status, message, data, errors}
      -- modules/api_response.py.
    - Autentikasi (WAJIB header "Authorization: Bearer <token>" yang
      valid, ATAU cookie httpOnly "gouf_session") ditegakkan di MIDDLEWARE
      `jwt_v1_middleware` (modules/auth/v1.py), yang sudah menjaga SELURUH
      grup /api/v1/** -- paket ini tidak perlu middleware sendiri.
    - Endpoint yang mengubah data (create/update/delete) dibatasi
      `Depends(_require_level_v1(3))` -- Supervisor ke atas -- SAMA
      seperti mayoritas endpoint mutasi data akuntansi lain di main.py.
      Endpoint baca (list/detail) cukup token valid (any authenticated
      user).

Data disimpan di 4 tabel `financial_transaction_journal_entry_*` (DDL:
root/ddl-table bagian "FITUR TRANSACTIONS > JOURNAL ENTRY", ORM:
db_client.py::JournalEntrySourceRecord/JournalEntryDraft/
JournalEntryDraftLine/JournalEntryActivityLog). client_id di SELURUH
tabel reference ke management_users(id_user) (akun client_lv_1..9, lihat
RBAC.md), BUKAN management_clients ataupun clients(id) lama. Soft-delete
lewat kolom deleted_at/deleted_by, kecuali
financial_transaction_journal_entry_activity_log yang append-only (tidak
ada update/soft-delete -- jejak aktivitas tidak boleh diubah).

Draft (financial_transaction_journal_entry_drafts) adalah tahap SEBELUM
diposting -- begitu benar-benar diposting ke jurnal resmi (Accounting
Core V2), `journal_entry_id` diisi sebagai pointer ke journal_entries(id)
(pola sama seperti financial_transaction_sales_invoices.journal_entry_id).
Modul ini TIDAK menyediakan endpoint "post ke Accounting Core" -- itu
tetap lewat POST /api/client/{id}/journal-entries (modules/
accounting_core.py) yang sudah ada; endpoint di sini murni CRUD tabel
staging/draft, sama persis cakupannya dengan sales_v1.py untuk tabel
Sales.

Tab "Exceptions" SENGAJA TIDAK punya endpoint/tabel tersendiri -- lihat
catatan di root/ddl-table & src/app/transactions/journal-entry/
exceptions/page.tsx ("Real, derivable exception detection -- no
fabricated severity/assignee fields"). Exception di-derive lewat query
GET /drafts?status=exception (atau status=rejected) di frontend, bukan
resource API terpisah.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("transactions_journal_entry_v1")

router = APIRouter(prefix="/api/v1/transactions/journal-entries", tags=["transactions-journal-entry-v1"])


def _require_level_v1(min_tahap: int):
    """Versi `auth.require_level()` yang kompatibel dengan alur cookie httpOnly.

    Sama persis alasannya dengan `_require_level_v1` di
    modules/transactions/sales_v1.py -- `auth.require_level()` bergantung
    ke `auth.get_current_user`, yang tidak membaca cookie httpOnly
    "gouf_session" (cuma header Authorization), jadi `current_user["id"]`
    yang dipakai sebagai created_by/updated_by di endpoint ini dibangun
    dari `get_current_user_v1` (baca `request.state.user`, diisi
    `jwt_v1_middleware` yang SUDAH mendukung fallback cookie itu)."""

    def _dependency(current_user: Dict[str, Any] = Depends(get_current_user_v1)) -> Dict[str, Any]:
        if auth.role_level(current_user.get("role")) < min_tahap:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Fitur ini khusus untuk Tahap {min_tahap} ke atas. "
                    f"Akun kamu: {auth.role_label(current_user.get('role'))}."
                ),
            )
        return current_user

    return _dependency


# ============================================================
# SKEMA REQUEST -- 1) Source Records
# ============================================================

class JeSourceRecordCreateRequest(BaseModel):
    client_id: Optional[str] = None
    source_code: str = Field(..., min_length=1, max_length=100)
    source_type: str = Field(..., max_length=20)
    source_date: Optional[date] = None
    description: Optional[str] = None
    amount: float = 0
    currency: str = Field("USD", max_length=10)
    related_account_code: Optional[str] = Field(None, max_length=50)
    related_account_name: Optional[str] = Field(None, max_length=200)
    party_name: Optional[str] = Field(None, max_length=255)
    mapping_status: str = Field("Imported", max_length=20)
    sync_status: str = Field("Manual", max_length=20)


class JeSourceRecordUpdateRequest(BaseModel):
    """Semua field opsional -- update bersifat partial."""
    client_id: Optional[str] = None
    source_code: Optional[str] = Field(None, min_length=1, max_length=100)
    source_type: Optional[str] = Field(None, max_length=20)
    source_date: Optional[date] = None
    description: Optional[str] = None
    amount: Optional[float] = None
    currency: Optional[str] = Field(None, max_length=10)
    related_account_code: Optional[str] = Field(None, max_length=50)
    related_account_name: Optional[str] = Field(None, max_length=200)
    party_name: Optional[str] = Field(None, max_length=255)
    mapping_status: Optional[str] = Field(None, max_length=20)
    sync_status: Optional[str] = Field(None, max_length=20)


# ============================================================
# SKEMA REQUEST -- 2) Drafts (header Journal Entry)
# ============================================================

class JeDraftCreateRequest(BaseModel):
    client_id: Optional[str] = None
    je_number: str = Field(..., min_length=1, max_length=100)
    entry_date: date
    posting_date: Optional[date] = None
    period_label: str = Field(..., max_length=50)
    description: Optional[str] = None
    source_type: str = Field("Manual", max_length=20)
    source_reference: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    total_debit: float = 0
    total_credit: float = 0
    currency: str = Field("USD", max_length=10)
    status: str = Field("draft", max_length=20, description="draft/pending/approved/posted/rejected/exception")
    created_by_name: Optional[str] = Field(None, max_length=255)
    reviewed_by_name: Optional[str] = Field(None, max_length=255)
    approved_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    journal_entry_id: Optional[int] = None
    posted_at: Optional[datetime] = None
    posted_by: Optional[str] = None


class JeDraftUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    je_number: Optional[str] = Field(None, min_length=1, max_length=100)
    entry_date: Optional[date] = None
    posting_date: Optional[date] = None
    period_label: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = None
    source_type: Optional[str] = Field(None, max_length=20)
    source_reference: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    total_debit: Optional[float] = None
    total_credit: Optional[float] = None
    currency: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=20)
    created_by_name: Optional[str] = Field(None, max_length=255)
    reviewed_by_name: Optional[str] = Field(None, max_length=255)
    approved_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    journal_entry_id: Optional[int] = None
    posted_at: Optional[datetime] = None
    posted_by: Optional[str] = None


# ============================================================
# SKEMA REQUEST -- 2b) Draft + Lines sekaligus (atomik, "New Journal Entry")
# ============================================================

class JeDraftLineInput(BaseModel):
    """Baris debit/kredit di dalam payload buat-draft-sekaligus -- TANPA
    draft_id/client_id (otomatis diisi dari header oleh backend, bukan
    dikirim client)."""
    line_no: Optional[int] = None  # NULL -> diisi otomatis sesuai urutan array (1-based)
    account_code: str = Field(..., max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    debit: float = 0
    credit: float = 0
    cost_center: Optional[str] = Field(None, max_length=100)


class JeDraftWithLinesCreateRequest(BaseModel):
    client_id: Optional[str] = None
    je_number: str = Field(..., min_length=1, max_length=100)
    entry_date: date
    posting_date: Optional[date] = None
    period_label: str = Field(..., max_length=50)
    description: Optional[str] = None
    source_type: str = Field("Manual", max_length=20)
    source_reference: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    currency: str = Field("USD", max_length=10)
    status: str = Field("draft", max_length=20, description="draft/pending/approved/posted/rejected/exception")
    created_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    lines: List[JeDraftLineInput] = Field(..., min_length=2, description="Minimal 2 baris (debit & kredit).")


# ============================================================
# SKEMA REQUEST -- 3) Draft Lines
# ============================================================

class JeDraftLineCreateRequest(BaseModel):
    draft_id: str
    client_id: Optional[str] = None
    line_no: int
    account_code: str = Field(..., max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    debit: float = 0
    credit: float = 0
    cost_center: Optional[str] = Field(None, max_length=100)


class JeDraftLineUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    line_no: Optional[int] = None
    account_code: Optional[str] = Field(None, max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = None
    debit: Optional[float] = None
    credit: Optional[float] = None
    cost_center: Optional[str] = Field(None, max_length=100)


# ============================================================
# SKEMA REQUEST -- 4) Activity Log (append-only)
# ============================================================

class JeActivityLogCreateRequest(BaseModel):
    client_id: Optional[str] = None
    draft_id: Optional[str] = None
    je_number: Optional[str] = Field(None, max_length=100)
    event_type: str = Field(..., max_length=50)
    description: str
    status_snapshot: Optional[str] = Field(None, max_length=20)
    performed_by: str = Field(..., max_length=255)


# ============================================================
# ENDPOINTS -- 1) Source Records (tab Source Data)
# ============================================================

@router.post(
    "/source-records",
    summary="Registrasi transaksi sumber tab Source Data (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Source record created successfully."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        403: {"description": "Akun tidak memenuhi level minimal (Tahap 3 / Supervisor)."},
        409: {"description": "source_code sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_source_record(
    payload: JeSourceRecordCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_je_source_record_by_client_and_code(payload.client_id, payload.source_code):
        return gagal(
            message="This source_code is already used for this client_id.",
            errors={"code": "DUPLICATE_SOURCE_CODE", "field": "source_code"},
            status_code=409,
        )
    dibuat = dbc.create_je_source_record(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create source record (database error).", status_code=500)
    return sukses(data=dibuat, message="Source record created successfully.", status_code=201)


@router.get(
    "/source-records",
    summary="Daftar transaksi sumber (tab Source Data)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}},
)
def daftar_source_record(
    client_id: Optional[str] = Query(None, description="Filter berdasarkan client_id (management_users.id_user)."),
    source_type: Optional[str] = Query(None, description="Sales/Purchase/Payroll/Bank/Cash/Expense/Inventory/Fixed Assets/Tax/Manual"),
    mapping_status: Optional[str] = Query(None, description="Mapped/Pending Mapping/Validation Error/Imported"),
    termasuk_nonaktif: bool = Query(False, description="Sertakan yang sudah di-soft-delete."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_source_records(
        client_id=client_id, source_type=source_type, mapping_status=mapping_status, termasuk_nonaktif=termasuk_nonaktif,
    )
    return sukses(data=data, message="OK")


@router.get(
    "/source-records/{source_record_id}",
    summary="Detail 1 transaksi sumber",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_record(
    source_record_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_source_record_by_id(source_record_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-records/{source_record_id}",
    summary="Update transaksi sumber (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_record(
    source_record_id: str,
    payload: JeSourceRecordUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_je_source_record(source_record_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source record updated successfully.")


@router.delete(
    "/source-records/{source_record_id}",
    summary="Nonaktifkan (soft-delete) transaksi sumber (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_record(
    source_record_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_je_source_record(source_record_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source record deactivated successfully.")


# ============================================================
# ENDPOINTS -- 2) Drafts (entitas inti: JE Transaction / Journal Preview /
# Exceptions (via query status) / Posted)
# ============================================================

@router.post(
    "/drafts",
    summary="Buat draft Journal Entry baru (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Draft berhasil dibuat."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        409: {"description": "je_number sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_draft(
    payload: JeDraftCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_je_draft_by_client_and_number(payload.client_id, payload.je_number):
        return gagal(
            message="This je_number is already used for this client_id.",
            errors={"code": "DUPLICATE_JE_NUMBER", "field": "je_number"},
            status_code=409,
        )
    dibuat = dbc.create_je_draft(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create Journal Entry draft (database error).", status_code=500)
    return sukses(data=dibuat, message="Journal Entry draft created successfully.", status_code=201)


@router.post(
    "/drafts/full",
    summary="Buat draft Journal Entry + seluruh baris debit/kreditnya sekaligus, atomik (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Draft + baris berhasil dibuat."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        409: {"description": "je_number sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid, atau total debit != total credit (harus balance)."},
    },
)
def buat_draft_dengan_baris(
    payload: JeDraftWithLinesCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    """Dipakai tombol "New Journal Entry" (input manual multi-baris) di tab
    JE Transaction -- BEDA dari POST /drafts biasa (cuma bikin header
    kosong) karena endpoint ini membuat header + SEMUA baris + activity log
    "Created" dalam SATU transaksi database (lihat
    dbc.create_je_draft_with_lines), supaya tidak ada draft "yatim" tanpa
    baris kalau salah satu insert baris gagal di tengah jalan."""
    if dbc.get_je_draft_by_client_and_number(payload.client_id, payload.je_number):
        return gagal(
            message="This je_number is already used for this client_id.",
            errors={"code": "DUPLICATE_JE_NUMBER", "field": "je_number"},
            status_code=409,
        )

    total_debit = sum(l.debit for l in payload.lines)
    total_credit = sum(l.credit for l in payload.lines)
    if abs(total_debit - total_credit) > 0.01:
        return gagal(
            message=f"Journal entry is not balanced: total debit {total_debit:,.2f} != total credit {total_credit:,.2f}.",
            errors={"code": "UNBALANCED_ENTRY", "total_debit": total_debit, "total_credit": total_credit},
            status_code=422,
        )
    for idx, line in enumerate(payload.lines, start=1):
        if line.debit > 0 and line.credit > 0:
            return gagal(
                message=f"Line {idx}: cannot fill both debit and credit.",
                errors={"code": "INVALID_LINE", "line_no": idx},
                status_code=422,
            )
        if line.debit == 0 and line.credit == 0:
            return gagal(
                message=f"Line {idx}: debit or credit is required (both cannot be 0).",
                errors={"code": "INVALID_LINE", "line_no": idx},
                status_code=422,
            )

    draft_data = payload.model_dump(exclude={"lines"})
    lines_data = [l.model_dump() for l in payload.lines]
    dibuat = dbc.create_je_draft_with_lines(draft_data, lines_data, created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create Journal Entry draft (database error).", status_code=500)
    return sukses(data=dibuat, message="Journal Entry created successfully.", status_code=201)


@router.get(
    "/drafts",
    summary="Daftar draft Journal Entry (tab JE Transaction/Journal Preview/Exceptions/Posted)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_draft(
    client_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="draft/pending/approved/posted/rejected/exception"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_drafts(client_id=client_id, status=status_filter, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/drafts/{draft_id}",
    summary="Detail 1 draft Journal Entry",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_draft(
    draft_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_draft_by_id(draft_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Journal Entry draft not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/drafts/{draft_id}",
    summary="Update draft Journal Entry (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_draft(
    draft_id: str,
    payload: JeDraftUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_je_draft(draft_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Journal Entry draft not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Journal Entry draft updated successfully.")


@router.delete(
    "/drafts/{draft_id}",
    summary="Nonaktifkan (soft-delete) draft Journal Entry (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_draft(
    draft_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_je_draft(draft_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Journal Entry draft not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Journal Entry draft deactivated successfully.")


# ============================================================
# ENDPOINTS -- 3) Draft Lines (baris debit/kredit, tab Journal Preview &
# detail panel)
# ============================================================

@router.post(
    "/draft-lines",
    summary="Tambah baris debit/kredit ke draft (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_draft_line(
    payload: JeDraftLineCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_je_draft_line(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create draft line (database error).", status_code=500)
    return sukses(data=dibuat, message="Draft line created successfully.", status_code=201)


@router.get(
    "/draft-lines",
    summary="Daftar baris debit/kredit (filter per draft)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_draft_line(
    draft_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_draft_lines(draft_id=draft_id, client_id=client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/draft-lines/{line_id}",
    summary="Detail 1 baris debit/kredit",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_draft_line(
    line_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_draft_line_by_id(line_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Draft line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/draft-lines/{line_id}",
    summary="Update baris debit/kredit (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_draft_line(
    line_id: str,
    payload: JeDraftLineUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_je_draft_line(line_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Draft line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Draft line updated successfully.")


@router.delete(
    "/draft-lines/{line_id}",
    summary="Nonaktifkan (soft-delete) baris debit/kredit (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_draft_line(
    line_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_je_draft_line(line_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Draft line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Draft line deactivated successfully.")


# ============================================================
# ENDPOINTS -- 4) Activity Log (append-only, tab Overview -> "Recent
# Activity")
# ============================================================

@router.post(
    "/activity-log",
    summary="Catat jejak aktivitas Journal Entry (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_activity_log(
    payload: JeActivityLogCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    """Append-only -- TIDAK ada endpoint update/delete untuk activity log
    (jejak aktivitas tidak boleh diubah/dihapus setelah tercatat)."""
    dibuat = dbc.create_je_activity_log(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to record activity log (database error).", status_code=500)
    return sukses(data=dibuat, message="Activity log recorded successfully.", status_code=201)


@router.get(
    "/activity-log",
    summary="Daftar jejak aktivitas Journal Entry",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_activity_log(
    client_id: Optional[str] = Query(None),
    draft_id: Optional[str] = Query(None),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_je_activity_logs(client_id=client_id, draft_id=draft_id)
    return sukses(data=data, message="OK")


@router.get(
    "/activity-log/{log_id}",
    summary="Detail 1 jejak aktivitas",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_activity_log(
    log_id: str,
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_je_activity_log_by_id(log_id)
    if data is None:
        return gagal(message="Activity log not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")
