"""
modules/transactions/sales_v1.py
==================================
Fitur "Transactions > Sales" versi REST API standar:
/api/v1/transactions/sales/...

Mengikuti standar YANG SAMA dengan modules/auth/v1.py & modules/management/
clients_v1.py (lihat file-file itu untuk alasan detailnya):

    - Routing versi: /api/[version]/[group]/[fitur].
    - Response SELALU pakai amplop standar {status, message, data, errors}
      -- modules/api_response.py.
    - Autentikasi (WAJIB header "Authorization: Bearer <token>" yang
      valid, ATAU cookie httpOnly "gouf_session") ditegakkan di MIDDLEWARE
      `jwt_v1_middleware` (modules/auth/v1.py), yang sudah menjaga SELURUH
      grup /api/v1/** -- paket ini tidak perlu middleware sendiri.
    - Endpoint yang mengubah data (create/update/delete) dibatasi
      `Depends(_require_level_v1(3))` -- Supervisor ke atas -- SAMA
      seperti mayoritas endpoint mutasi data akuntansi lain di main.py
      (Depends(auth.require_level(3))). Endpoint baca (list/detail) cukup
      token valid (any authenticated user).

Data disimpan di 6 tabel `financial_transaction_sales_*` (DDL: root/
ddl-table bagian "FITUR TRANSACTIONS > SALES", ORM: db_client.py::
SalesSourceFile/SalesSourceRow/SalesInvoice/SalesAccountMapping/
SalesException/SalesActivityLog). client_id di SELURUH tabel reference
ke management_users(id_user) (akun client_lv_1..9, lihat RBAC.md),
BUKAN management_clients ataupun clients(id) lama. Soft-delete lewat
kolom deleted_at/deleted_by (pola sama seperti management_clients),
kecuali financial_transaction_sales_activity_log yang append-only (tidak
ada update/soft-delete -- jejak aktivitas tidak boleh diubah).
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

logger = get_module_logger("transactions_sales_v1")

router = APIRouter(prefix="/api/v1/transactions/sales", tags=["transactions-sales-v1"])


def _require_level_v1(min_tahap: int):
    """Versi `auth.require_level()` yang kompatibel dengan alur cookie httpOnly.

    Sama persis alasannya dengan `_require_level_v1` di
    modules/management/clients_v1.py -- `auth.require_level()` bergantung
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
# SKEMA REQUEST -- 1) Source Files
# ============================================================

class SalesSourceFileCreateRequest(BaseModel):
    client_id: Optional[str] = None
    # [BARU] Klien (management_clients) yang laporannya sedang diupload --
    # WAJIB dipilih user lewat dropdown saat upload (lihat root/
    # SALES_IMPORT_TEMPLATES.md). Dipakai sebagai key pencocokan/pembuatan
    # template pola kolom, terpisah dari client_id di atas (management_users,
    # akun yang login/upload).
    management_client_id: str
    file_name: str = Field(..., min_length=1, max_length=255)
    file_type: Optional[str] = Field(None, max_length=20)
    storage_path: Optional[str] = None
    period_label: Optional[str] = Field(None, max_length=50)
    customer_hint: Optional[str] = Field(None, max_length=255)
    rows_detected: int = 0
    rows_valid: int = 0
    rows_invalid: int = 0
    duplicate_count: int = 0
    status_ekstraksi: str = Field("Diproses", max_length=20)
    status_mapping: str = Field("Diproses", max_length=20)
    confidence_score: Optional[float] = None
    dpp_total: float = 0
    ppn_total: float = 0
    grand_total: float = 0
    extraction_duration_ms: Optional[int] = None
    ai_model_version: Optional[str] = Field(None, max_length=50)
    mapping_rules: Optional[Dict[str, Any]] = None
    template_id: Optional[str] = None
    processed_by: Optional[str] = Field(None, max_length=255)
    uploaded_at: Optional[datetime] = None
    uploaded_by: Optional[str] = None


class SalesSourceFileUpdateRequest(BaseModel):
    """Semua field opsional -- update bersifat partial."""
    client_id: Optional[str] = None
    management_client_id: Optional[str] = None
    file_name: Optional[str] = Field(None, min_length=1, max_length=255)
    file_type: Optional[str] = Field(None, max_length=20)
    storage_path: Optional[str] = None
    period_label: Optional[str] = Field(None, max_length=50)
    customer_hint: Optional[str] = Field(None, max_length=255)
    rows_detected: Optional[int] = None
    rows_valid: Optional[int] = None
    rows_invalid: Optional[int] = None
    duplicate_count: Optional[int] = None
    status_ekstraksi: Optional[str] = Field(None, max_length=20)
    status_mapping: Optional[str] = Field(None, max_length=20)
    confidence_score: Optional[float] = None
    dpp_total: Optional[float] = None
    ppn_total: Optional[float] = None
    grand_total: Optional[float] = None
    extraction_duration_ms: Optional[int] = None
    ai_model_version: Optional[str] = Field(None, max_length=50)
    mapping_rules: Optional[Dict[str, Any]] = None
    template_id: Optional[str] = None
    processed_by: Optional[str] = Field(None, max_length=255)
    uploaded_at: Optional[datetime] = None
    uploaded_by: Optional[str] = None


# ============================================================
# SKEMA REQUEST -- 2) Source Rows
# ============================================================

class SalesSourceRowCreateRequest(BaseModel):
    source_file_id: str
    client_id: Optional[str] = None
    row_no: int
    tanggal: Optional[date] = None
    no_invoice: Optional[str] = Field(None, max_length=100)
    nama_customer: Optional[str] = Field(None, max_length=255)
    cabang: Optional[str] = Field(None, max_length=100)
    dpp: float = 0
    ppn: float = 0
    total: float = 0
    is_valid: bool = True
    validation_notes: Optional[str] = None
    is_duplicate_candidate: bool = False


class SalesSourceRowUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    row_no: Optional[int] = None
    tanggal: Optional[date] = None
    no_invoice: Optional[str] = Field(None, max_length=100)
    nama_customer: Optional[str] = Field(None, max_length=255)
    cabang: Optional[str] = Field(None, max_length=100)
    dpp: Optional[float] = None
    ppn: Optional[float] = None
    total: Optional[float] = None
    is_valid: Optional[bool] = None
    validation_notes: Optional[str] = None
    is_duplicate_candidate: Optional[bool] = None


# ============================================================
# SKEMA REQUEST -- 3) Invoices
# ============================================================

class SalesInvoiceCreateRequest(BaseModel):
    client_id: Optional[str] = None
    invoice_no: str = Field(..., min_length=1, max_length=100)
    invoice_date: date
    due_date: Optional[date] = None
    customer_name: str = Field(..., min_length=1, max_length=255)
    customer_npwp: Optional[str] = Field(None, max_length=30)
    description: Optional[str] = None
    transaction_type: Optional[str] = Field(None, max_length=50)
    project_name: Optional[str] = Field(None, max_length=255)
    sales_person: Optional[str] = Field(None, max_length=255)
    term_of_payment: Optional[str] = Field(None, max_length=50)
    cabang: Optional[str] = Field(None, max_length=100)
    dpp: float = 0
    ppn: float = 0
    pph: float = 0
    gross_amount: float = 0
    paid_amount: float = 0
    tax_invoice_status: str = Field("Belum Terbit Faktur", max_length=30)
    posting_status: str = Field("Draft", max_length=20)
    reconcile_status: str = Field("Unreconciled", max_length=20)
    journal_sync_status: str = Field("Pending", max_length=20)
    journal_entry_id: Optional[int] = None
    source_row_id: Optional[str] = None
    posted_at: Optional[datetime] = None
    posted_by: Optional[str] = None


class SalesInvoiceUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    invoice_no: Optional[str] = Field(None, min_length=1, max_length=100)
    invoice_date: Optional[date] = None
    due_date: Optional[date] = None
    customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    customer_npwp: Optional[str] = Field(None, max_length=30)
    description: Optional[str] = None
    transaction_type: Optional[str] = Field(None, max_length=50)
    project_name: Optional[str] = Field(None, max_length=255)
    sales_person: Optional[str] = Field(None, max_length=255)
    term_of_payment: Optional[str] = Field(None, max_length=50)
    cabang: Optional[str] = Field(None, max_length=100)
    dpp: Optional[float] = None
    ppn: Optional[float] = None
    pph: Optional[float] = None
    gross_amount: Optional[float] = None
    paid_amount: Optional[float] = None
    tax_invoice_status: Optional[str] = Field(None, max_length=30)
    posting_status: Optional[str] = Field(None, max_length=20)
    reconcile_status: Optional[str] = Field(None, max_length=20)
    journal_sync_status: Optional[str] = Field(None, max_length=20)
    journal_entry_id: Optional[int] = None
    source_row_id: Optional[str] = None
    posted_at: Optional[datetime] = None
    posted_by: Optional[str] = None


# ============================================================
# SKEMA REQUEST -- 4) Account Mappings
# ============================================================

class SalesAccountMappingCreateRequest(BaseModel):
    client_id: Optional[str] = None
    invoice_id: str
    piutang_account_code: str = Field(..., max_length=50)
    piutang_account_name: Optional[str] = Field(None, max_length=200)
    pendapatan_account_code: str = Field(..., max_length=50)
    pendapatan_account_name: Optional[str] = Field(None, max_length=200)
    ppn_account_code: Optional[str] = Field(None, max_length=50)
    ppn_account_name: Optional[str] = Field(None, max_length=200)
    pph_account_code: Optional[str] = Field(None, max_length=50)
    pph_account_name: Optional[str] = Field(None, max_length=200)
    is_ai_suggested: bool = True
    ai_confidence: Optional[float] = None
    mapped_by: Optional[str] = None
    mapped_at: Optional[datetime] = None


class SalesAccountMappingUpdateRequest(BaseModel):
    piutang_account_code: Optional[str] = Field(None, max_length=50)
    piutang_account_name: Optional[str] = Field(None, max_length=200)
    pendapatan_account_code: Optional[str] = Field(None, max_length=50)
    pendapatan_account_name: Optional[str] = Field(None, max_length=200)
    ppn_account_code: Optional[str] = Field(None, max_length=50)
    ppn_account_name: Optional[str] = Field(None, max_length=200)
    pph_account_code: Optional[str] = Field(None, max_length=50)
    pph_account_name: Optional[str] = Field(None, max_length=200)
    is_ai_suggested: Optional[bool] = None
    ai_confidence: Optional[float] = None
    mapped_by: Optional[str] = None
    mapped_at: Optional[datetime] = None


# ============================================================
# SKEMA REQUEST -- 5) Exceptions
# ============================================================

class SalesExceptionCreateRequest(BaseModel):
    client_id: Optional[str] = None
    invoice_id: Optional[str] = None
    source_row_id: Optional[str] = None
    exception_type: str = Field(..., max_length=100)
    priority: str = Field("Medium", max_length=10)
    status: str = Field("Open", max_length=20)
    ai_confidence: Optional[float] = None
    ai_suggestion: Optional[str] = None
    source_snippet: Optional[Dict[str, Any]] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None


class SalesExceptionUpdateRequest(BaseModel):
    invoice_id: Optional[str] = None
    source_row_id: Optional[str] = None
    exception_type: Optional[str] = Field(None, max_length=100)
    priority: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=20)
    ai_confidence: Optional[float] = None
    ai_suggestion: Optional[str] = None
    source_snippet: Optional[Dict[str, Any]] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None


# ============================================================
# SKEMA REQUEST -- 6) Activity Log (append-only)
# ============================================================

class SalesActivityLogCreateRequest(BaseModel):
    client_id: Optional[str] = None
    invoice_id: Optional[str] = None
    event_type: str = Field(..., max_length=50)
    description: str
    reference_no: Optional[str] = Field(None, max_length=100)
    performed_by: str = Field(..., max_length=255)


# ============================================================
# ENDPOINTS -- 1) Source Files
# ============================================================

@router.post(
    "/source-files",
    summary="Registrasi file upload tab Source Data (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Source file berhasil dibuat."},
        401: {"description": "Token tidak dikirim / tidak valid."},
        403: {"description": "Akun tidak memenuhi level minimal (Tahap 3 / Supervisor)."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_source_file(
    payload: SalesSourceFileCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_sales_source_file(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat source file (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Source file berhasil dibuat.", status_code=201)


@router.get(
    "/source-files",
    summary="Daftar source file (tab Source Data)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}},
)
def daftar_source_file(
    client_id: Optional[str] = Query(None, description="Filter berdasarkan client_id (management_users.id_user)."),
    termasuk_nonaktif: bool = Query(False, description="Sertakan yang sudah di-soft-delete."),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_source_files(client_id=client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-files/{source_file_id}",
    summary="Detail 1 source file",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_file(
    source_file_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_source_file_by_id(source_file_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source file tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-files/{source_file_id}",
    summary="Update source file (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_file(
    source_file_id: str,
    payload: SalesSourceFileUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_sales_source_file(source_file_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source file tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source file berhasil diupdate.")


@router.delete(
    "/source-files/{source_file_id}",
    summary="Nonaktifkan (soft-delete) source file (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Token tidak dikirim / tidak valid."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_file(
    source_file_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_sales_source_file(source_file_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source file tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source file berhasil dinonaktifkan.")


# ============================================================
# ENDPOINTS -- 2) Source Rows
# ============================================================

@router.post(
    "/source-rows",
    summary="Buat baris preview hasil parsing file (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_source_row(
    payload: SalesSourceRowCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_sales_source_row(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat source row (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Source row berhasil dibuat.", status_code=201)


@router.get(
    "/source-rows",
    summary="Daftar baris preview (filter per source_file)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_row(
    source_file_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_source_rows(source_file_id=source_file_id, client_id=client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-rows/{source_row_id}",
    summary="Detail 1 baris preview",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_row(
    source_row_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_source_row_by_id(source_row_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source row tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-rows/{source_row_id}",
    summary="Update baris preview (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_row(
    source_row_id: str,
    payload: SalesSourceRowUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_sales_source_row(source_row_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source row tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source row berhasil diupdate.")


@router.delete(
    "/source-rows/{source_row_id}",
    summary="Nonaktifkan (soft-delete) baris preview (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_row(
    source_row_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_sales_source_row(source_row_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source row tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source row berhasil dinonaktifkan.")


# ============================================================
# ENDPOINTS -- 3) Invoices (entitas inti: Sales Transaction / Journal
# Preview / Posted)
# ============================================================

@router.post(
    "/invoices",
    summary="Buat invoice penjualan baru (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Invoice berhasil dibuat."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        409: {"description": "invoice_no sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_invoice(
    payload: SalesInvoiceCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_sales_invoice_by_client_and_no(payload.client_id, payload.invoice_no):
        return gagal(
            message="invoice_no ini sudah dipakai untuk client_id ini.",
            errors={"code": "DUPLICATE_INVOICE_NO", "field": "invoice_no"},
            status_code=409,
        )
    dibuat = dbc.create_sales_invoice(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat invoice (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Invoice berhasil dibuat.", status_code=201)


@router.get(
    "/invoices",
    summary="Daftar invoice penjualan (tab Sales Transaction/Journal Preview/Posted)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_invoice(
    client_id: Optional[str] = Query(None),
    posting_status: Optional[str] = Query(None, description="Draft/Review/Approved/Posted/Partial/Paid"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_invoices(client_id=client_id, posting_status=posting_status, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/invoices/{invoice_id}",
    summary="Detail 1 invoice penjualan",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_invoice(
    invoice_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_invoice_by_id(invoice_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Invoice tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/invoices/{invoice_id}",
    summary="Update invoice penjualan (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_invoice(
    invoice_id: str,
    payload: SalesInvoiceUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_sales_invoice(invoice_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Invoice tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Invoice berhasil diupdate.")


@router.delete(
    "/invoices/{invoice_id}",
    summary="Nonaktifkan (soft-delete) invoice (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_invoice(
    invoice_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_sales_invoice(invoice_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Invoice tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Invoice berhasil dinonaktifkan.")


# ============================================================
# ENDPOINTS -- 4) Account Mappings (Accounting Classification)
# ============================================================

@router.post(
    "/account-mappings",
    summary="Simpan pemetaan akun 1 invoice (khusus Supervisor ke atas)",
    responses={
        201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."},
        409: {"description": "Invoice ini sudah punya mapping (relasi 1:1)."}, 422: {"description": "Payload tidak valid."},
    },
)
def buat_account_mapping(
    payload: SalesAccountMappingCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_sales_account_mapping_by_invoice(payload.invoice_id):
        return gagal(
            message="Invoice ini sudah punya account mapping (relasinya 1:1).",
            errors={"code": "DUPLICATE_MAPPING", "field": "invoice_id"},
            status_code=409,
        )
    dibuat = dbc.create_sales_account_mapping(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat account mapping (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Account mapping berhasil dibuat.", status_code=201)


@router.get(
    "/account-mappings",
    summary="Daftar pemetaan akun",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_account_mapping(
    client_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_account_mappings(client_id=client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/account-mappings/{mapping_id}",
    summary="Detail 1 pemetaan akun",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_account_mapping(
    mapping_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_account_mapping_by_id(mapping_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Account mapping tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.get(
    "/invoices/{invoice_id}/account-mapping",
    summary="Pemetaan akun milik 1 invoice (relasi 1:1)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Invoice ini belum punya mapping."}},
)
def account_mapping_by_invoice(
    invoice_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_account_mapping_by_invoice(invoice_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Invoice ini belum punya account mapping.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/account-mappings/{mapping_id}",
    summary="Update pemetaan akun (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_account_mapping(
    mapping_id: str,
    payload: SalesAccountMappingUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_sales_account_mapping(mapping_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Account mapping tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Account mapping berhasil diupdate.")


@router.delete(
    "/account-mappings/{mapping_id}",
    summary="Nonaktifkan (soft-delete) pemetaan akun (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_account_mapping(
    mapping_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_sales_account_mapping(mapping_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Account mapping tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Account mapping berhasil dinonaktifkan.")


# ============================================================
# ENDPOINTS -- 5) Exceptions
# ============================================================

@router.post(
    "/exceptions",
    summary="Buat antrean review Exceptions (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_exception(
    payload: SalesExceptionCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_sales_exception(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat exception (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Exception berhasil dibuat.", status_code=201)


@router.get(
    "/exceptions",
    summary="Daftar antrean review (tab Exceptions)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_exception(
    client_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="Open/In Review/Resolved"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_exceptions(client_id=client_id, status=status_filter, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/exceptions/{exception_id}",
    summary="Detail 1 exception",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_exception(
    exception_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_sales_exception_by_id(exception_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/exceptions/{exception_id}",
    summary="Update / resolve exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_exception(
    exception_id: str,
    payload: SalesExceptionUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_sales_exception(exception_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Exception berhasil diupdate.")


@router.delete(
    "/exceptions/{exception_id}",
    summary="Nonaktifkan (soft-delete) exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_exception(
    exception_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_sales_exception(exception_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Exception berhasil dinonaktifkan.")


# ============================================================
# ENDPOINTS -- 6) Activity Log (append-only, tab Posted)
# ============================================================

@router.post(
    "/activity-log",
    summary="Catat jejak aktivitas Sales (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_activity_log(
    payload: SalesActivityLogCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    """Append-only -- TIDAK ada endpoint update/delete untuk activity log
    (jejak aktivitas tidak boleh diubah/dihapus setelah tercatat)."""
    dibuat = dbc.create_sales_activity_log(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal mencatat activity log (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Activity log berhasil dicatat.", status_code=201)


@router.get(
    "/activity-log",
    summary="Daftar jejak aktivitas Sales",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_activity_log(
    client_id: Optional[str] = Query(None),
    invoice_id: Optional[str] = Query(None),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_sales_activity_logs(client_id=client_id, invoice_id=invoice_id)
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
    data = dbc.get_sales_activity_log_by_id(log_id)
    if data is None:
        return gagal(message="Activity log tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")
