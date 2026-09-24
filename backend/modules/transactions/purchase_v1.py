"""
modules/transactions/purchase_v1.py
=====================================
Fitur "Transactions > Purchase" versi REST API standar:
/api/v1/transactions/purchase/...

Mengikuti standar YANG SAMA dengan modules/transactions/sales_v1.py &
modules/transactions/journal_entry_v1.py (yang sendirinya mengikuti
modules/auth/v1.py & modules/management/clients_v1.py -- lihat file-file
itu untuk alasan detailnya):

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

Data disimpan di 4 tabel `financial_transaction_purchase_*` (DDL: root/
ddl-table bagian "FITUR TRANSACTIONS > PURCHASE", ORM: db_client.py::
PurchaseSourceRecord/PurchaseTransaction/PurchaseTransactionLine/
PurchaseException). client_id di SELURUH tabel reference ke
management_users(id_user) (akun client_lv_1..9, lihat RBAC.md), BUKAN
management_clients ataupun clients(id) lama. Soft-delete lewat kolom
deleted_at/deleted_by.

Entitas inti (financial_transaction_purchase_transactions) dipakai
bersama oleh tab Purchase Transaction, Purchase Preview, dan Posted --
sama seperti financial_transaction_sales_invoices, TAPI multi-baris per
transaksi (lihat PurchaseTransactionLine) -- sama seperti financial_
transaction_journal_entry_draft_lines. Tab "Source Data" isinya registri
(bukan upload file), tab "Exceptions" punya tabel tersendiri (severity/
assignedTo/resolution SUNGGUHAN dipakai UI purchaseData.ts, bukan
fabrikasi) -- lihat komentar lengkap di kepala DDL-nya.

Modul ini TIDAK menyediakan endpoint "post ke Accounting Core" -- endpoint
di sini murni CRUD tabel staging/transaksi, sama persis cakupannya dengan
sales_v1.py/journal_entry_v1.py.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("transactions_purchase_v1")

router = APIRouter(prefix="/api/v1/transactions/purchase", tags=["transactions-purchase-v1"])


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

class PurchaseSourceRecordCreateRequest(BaseModel):
    client_id: Optional[str] = None
    source_code: str = Field(..., min_length=1, max_length=100)
    source_type: str = Field(..., max_length=30, description="Purchase Order/Vendor Invoice/Goods Receipt/Service Receipt/Supplier Bill/Expense Claim/Recurring Purchase/Manual")
    vendor_name: str = Field(..., min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    amount: float = 0
    tax_amount: float = 0
    total_amount: float = 0
    currency: str = Field("USD", max_length=10)
    status: str = Field("Imported", max_length=20, description="Mapped/Pending Mapping/Validation Error/Imported")
    validation_status: str = Field("Pending Validation", max_length=20, description="Valid/Pending Validation/Invalid")
    period_label: str = Field(..., max_length=50)


class PurchaseSourceRecordUpdateRequest(BaseModel):
    """Semua field opsional -- update bersifat partial."""
    client_id: Optional[str] = None
    source_code: Optional[str] = Field(None, min_length=1, max_length=100)
    source_type: Optional[str] = Field(None, max_length=30)
    vendor_name: Optional[str] = Field(None, min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    amount: Optional[float] = None
    tax_amount: Optional[float] = None
    total_amount: Optional[float] = None
    currency: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=20)
    validation_status: Optional[str] = Field(None, max_length=20)
    period_label: Optional[str] = Field(None, max_length=50)


# ============================================================
# SKEMA REQUEST -- 2) Transactions (header)
# ============================================================

class PurchaseTransactionCreateRequest(BaseModel):
    client_id: Optional[str] = None
    purchase_no: str = Field(..., min_length=1, max_length=100)
    purchase_date: date
    invoice_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    vendor_name: str = Field(..., min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_doc_type: str = Field("Manual", max_length=30)
    source_ref: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    subtotal: float = 0
    discount: float = 0
    tax_amount: float = 0
    total: float = 0
    accounts_payable: float = 0
    currency: str = Field("USD", max_length=10)
    payment_status: str = Field("unpaid", max_length=20)
    payment_terms: Optional[str] = Field(None, max_length=50)
    due_date: Optional[date] = None
    status: str = Field("draft", max_length=20, description="draft/pending_review/approved/pending_posting/posted/rejected/exception/cancelled")
    period_label: str = Field(..., max_length=50)
    created_by_name: Optional[str] = Field(None, max_length=255)
    approved_by_name: Optional[str] = Field(None, max_length=255)
    posted_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    journal_entry_id: Optional[UUID] = None
    posting_date: Optional[date] = None
    posted_at: Optional[datetime] = None


class PurchaseTransactionUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    purchase_no: Optional[str] = Field(None, min_length=1, max_length=100)
    purchase_date: Optional[date] = None
    invoice_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    vendor_name: Optional[str] = Field(None, min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_doc_type: Optional[str] = Field(None, max_length=30)
    source_ref: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    subtotal: Optional[float] = None
    discount: Optional[float] = None
    tax_amount: Optional[float] = None
    total: Optional[float] = None
    accounts_payable: Optional[float] = None
    currency: Optional[str] = Field(None, max_length=10)
    payment_status: Optional[str] = Field(None, max_length=20)
    payment_terms: Optional[str] = Field(None, max_length=50)
    due_date: Optional[date] = None
    status: Optional[str] = Field(None, max_length=20)
    period_label: Optional[str] = Field(None, max_length=50)
    created_by_name: Optional[str] = Field(None, max_length=255)
    approved_by_name: Optional[str] = Field(None, max_length=255)
    posted_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    journal_entry_id: Optional[UUID] = None
    posting_date: Optional[date] = None
    posted_at: Optional[datetime] = None


# ============================================================
# SKEMA REQUEST -- 2b) Transaction + Lines sekaligus (atomik)
# ============================================================

class PurchaseTransactionLineInput(BaseModel):
    """Baris item/jasa di dalam payload buat-transaksi-sekaligus -- TANPA
    transaction_id/client_id (otomatis diisi dari header oleh backend,
    bukan dikirim client)."""
    line_no: Optional[int] = None  # NULL -> diisi otomatis sesuai urutan array (1-based)
    item_code: Optional[str] = Field(None, max_length=50)
    description: str = Field(..., min_length=1)
    quantity: float = 0
    unit: Optional[str] = Field(None, max_length=20)
    unit_price: float = 0
    discount: float = 0
    tax_rate: float = 0
    tax_amount: float = 0
    subtotal: float = 0
    total: float = 0
    account_code: str = Field(..., max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)


class PurchaseTransactionWithLinesCreateRequest(BaseModel):
    client_id: Optional[str] = None
    purchase_no: str = Field(..., min_length=1, max_length=100)
    purchase_date: date
    invoice_date: Optional[date] = None
    invoice_number: Optional[str] = Field(None, max_length=100)
    po_number: Optional[str] = Field(None, max_length=100)
    vendor_name: str = Field(..., min_length=1, max_length=255)
    vendor_code: Optional[str] = Field(None, max_length=50)
    source_doc_type: str = Field("Manual", max_length=30)
    source_ref: Optional[str] = Field(None, max_length=100)
    source_record_id: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = Field(None, max_length=50)
    accounts_payable: Optional[float] = None
    currency: str = Field("USD", max_length=10)
    payment_status: str = Field("unpaid", max_length=20)
    payment_terms: Optional[str] = Field(None, max_length=50)
    due_date: Optional[date] = None
    status: str = Field("draft", max_length=20)
    period_label: str = Field(..., max_length=50)
    created_by_name: Optional[str] = Field(None, max_length=255)
    notes: Optional[str] = None
    lines: List[PurchaseTransactionLineInput] = Field(..., min_length=1, description="Minimal 1 baris item/jasa.")


# ============================================================
# SKEMA REQUEST -- 3) Transaction Lines
# ============================================================

class PurchaseTransactionLineCreateRequest(BaseModel):
    transaction_id: str
    client_id: Optional[str] = None
    line_no: int
    item_code: Optional[str] = Field(None, max_length=50)
    description: str = Field(..., min_length=1)
    quantity: float = 0
    unit: Optional[str] = Field(None, max_length=20)
    unit_price: float = 0
    discount: float = 0
    tax_rate: float = 0
    tax_amount: float = 0
    subtotal: float = 0
    total: float = 0
    account_code: str = Field(..., max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)


class PurchaseTransactionLineUpdateRequest(BaseModel):
    client_id: Optional[str] = None
    line_no: Optional[int] = None
    item_code: Optional[str] = Field(None, max_length=50)
    description: Optional[str] = Field(None, min_length=1)
    quantity: Optional[float] = None
    unit: Optional[str] = Field(None, max_length=20)
    unit_price: Optional[float] = None
    discount: Optional[float] = None
    tax_rate: Optional[float] = None
    tax_amount: Optional[float] = None
    subtotal: Optional[float] = None
    total: Optional[float] = None
    account_code: Optional[str] = Field(None, max_length=50)
    account_name: Optional[str] = Field(None, max_length=200)


# ============================================================
# SKEMA REQUEST -- 4) Exceptions
# ============================================================

class PurchaseExceptionCreateRequest(BaseModel):
    client_id: Optional[str] = None
    transaction_id: Optional[str] = None
    source_record_id: Optional[str] = None
    exception_type: str = Field(..., max_length=100)
    severity: str = Field("Medium", max_length=10, description="Critical/High/Medium/Low")
    status: str = Field("Open", max_length=30, description="Open/Under Review/Requires Correction/Resolved/Ignored")
    vendor_name: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    purchase_date: Optional[date] = None
    amount: float = 0
    currency: str = Field("USD", max_length=10)
    description: str
    detected_at: Optional[datetime] = None
    assigned_to: Optional[str] = Field(None, max_length=255)
    resolution: Optional[str] = None
    resolved_at: Optional[datetime] = None
    period_label: str = Field(..., max_length=50)


class PurchaseExceptionUpdateRequest(BaseModel):
    transaction_id: Optional[str] = None
    source_record_id: Optional[str] = None
    exception_type: Optional[str] = Field(None, max_length=100)
    severity: Optional[str] = Field(None, max_length=10)
    status: Optional[str] = Field(None, max_length=30)
    vendor_name: Optional[str] = Field(None, max_length=255)
    invoice_number: Optional[str] = Field(None, max_length=100)
    purchase_date: Optional[date] = None
    amount: Optional[float] = None
    currency: Optional[str] = Field(None, max_length=10)
    description: Optional[str] = None
    detected_at: Optional[datetime] = None
    assigned_to: Optional[str] = Field(None, max_length=255)
    resolution: Optional[str] = None
    resolved_at: Optional[datetime] = None
    period_label: Optional[str] = Field(None, max_length=50)


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
    payload: PurchaseSourceRecordCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_purchase_source_record_by_client_and_code(payload.client_id, payload.source_code):
        return gagal(
            message="This source_code is already used for this client_id.",
            errors={"code": "DUPLICATE_SOURCE_CODE", "field": "source_code"},
            status_code=409,
        )
    dibuat = dbc.create_purchase_source_record(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create source record (database error).", status_code=500)
    return sukses(data=dibuat, message="Source record created successfully.", status_code=201)


@router.get(
    "/source-records",
    summary="Daftar transaksi sumber (tab Source Data)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_source_record(
    client_id: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="Mapped/Pending Mapping/Validation Error/Imported"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_purchase_source_records(client_id=client_id, source_type=source_type, status=status_filter, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/source-records/{source_record_id}",
    summary="Detail 1 transaksi sumber",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_source_record(
    source_record_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_purchase_source_record_by_id(source_record_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/source-records/{source_record_id}",
    summary="Update transaksi sumber (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_source_record(
    source_record_id: str,
    payload: PurchaseSourceRecordUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_purchase_source_record(source_record_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Source record updated successfully.")


@router.delete(
    "/source-records/{source_record_id}",
    summary="Nonaktifkan (soft-delete) transaksi sumber (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_source_record(
    source_record_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_purchase_source_record(source_record_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Source record not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Source record deactivated successfully.")


# ============================================================
# ENDPOINTS -- 2) Transactions (entitas inti: Purchase Transaction /
# Purchase Preview / Posted)
# ============================================================

@router.post(
    "/transactions",
    summary="Buat transaksi pembelian baru -- header saja (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Transaction created successfully."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        409: {"description": "purchase_no sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_transaction(
    payload: PurchaseTransactionCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    if dbc.get_purchase_transaction_by_client_and_no(payload.client_id, payload.purchase_no):
        return gagal(
            message="This purchase_no is already used for this client_id.",
            errors={"code": "DUPLICATE_PURCHASE_NO", "field": "purchase_no"},
            status_code=409,
        )
    dibuat = dbc.create_purchase_transaction(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create transaction (database error).", status_code=500)
    return sukses(data=dibuat, message="Transaction created successfully.", status_code=201)


@router.post(
    "/transactions/full",
    summary="Buat transaksi pembelian + seluruh baris item/jasanya sekaligus, atomik (khusus Supervisor ke atas)",
    responses={
        201: {"description": "Transaction + lines berhasil dibuat."},
        401: {"description": "Unauthorized."},
        403: {"description": "Forbidden."},
        409: {"description": "purchase_no sudah dipakai untuk client_id ini."},
        422: {"description": "Payload tidak valid."},
    },
)
def buat_transaction_dengan_baris(
    payload: PurchaseTransactionWithLinesCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    """BEDA dari POST /transactions biasa (cuma bikin header kosong) --
    endpoint ini membuat header + SEMUA baris item/jasa dalam SATU
    transaksi database (lihat dbc.create_purchase_transaction_with_lines),
    supaya tidak ada transaksi "yatim" tanpa baris kalau salah satu insert
    baris gagal di tengah jalan. subtotal/discount/tax_amount/total header
    dihitung ULANG dari SUM(lines), bukan dari input client."""
    if dbc.get_purchase_transaction_by_client_and_no(payload.client_id, payload.purchase_no):
        return gagal(
            message="This purchase_no is already used for this client_id.",
            errors={"code": "DUPLICATE_PURCHASE_NO", "field": "purchase_no"},
            status_code=409,
        )
    transaction_data = payload.model_dump(exclude={"lines"})
    lines_data = [l.model_dump() for l in payload.lines]
    dibuat = dbc.create_purchase_transaction_with_lines(transaction_data, lines_data, created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create transaction (database error).", status_code=500)
    return sukses(data=dibuat, message="Transaction created successfully.", status_code=201)


@router.get(
    "/transactions",
    summary="Daftar transaksi pembelian (tab Purchase Transaction/Preview/Posted)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_transaction(
    client_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="draft/pending_review/approved/pending_posting/posted/rejected/exception/cancelled"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_purchase_transactions(client_id=client_id, status=status_filter, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/transactions/{transaction_id}",
    summary="Detail 1 transaksi pembelian",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_transaction(
    transaction_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_purchase_transaction_by_id(transaction_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Transaction not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/transactions/{transaction_id}",
    summary="Update transaksi pembelian (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_transaction(
    transaction_id: str,
    payload: PurchaseTransactionUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_purchase_transaction(transaction_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Transaction not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Transaction updated successfully.")


@router.delete(
    "/transactions/{transaction_id}",
    summary="Nonaktifkan (soft-delete) transaksi pembelian (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_transaction(
    transaction_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_purchase_transaction(transaction_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Transaction not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Transaction deactivated successfully.")


# ============================================================
# ENDPOINTS -- 3) Transaction Lines
# ============================================================

@router.post(
    "/transaction-lines",
    summary="Tambah baris item/jasa ke transaksi yang sudah ada (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_transaction_line(
    payload: PurchaseTransactionLineCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_purchase_transaction_line(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create transaction line (database error).", status_code=500)
    return sukses(data=dibuat, message="Transaction line created successfully.", status_code=201)


@router.get(
    "/transaction-lines",
    summary="Daftar baris item/jasa (filter per transaction)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_transaction_line(
    transaction_id: Optional[str] = Query(None),
    client_id: Optional[str] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_purchase_transaction_lines(transaction_id=transaction_id, client_id=client_id, termasuk_nonaktif=termasuk_nonaktif)
    return sukses(data=data, message="OK")


@router.get(
    "/transaction-lines/{line_id}",
    summary="Detail 1 baris item/jasa",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_transaction_line(
    line_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_purchase_transaction_line_by_id(line_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Transaction line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/transaction-lines/{line_id}",
    summary="Update baris item/jasa (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_transaction_line(
    line_id: str,
    payload: PurchaseTransactionLineUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_purchase_transaction_line(line_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Transaction line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Transaction line updated successfully.")


@router.delete(
    "/transaction-lines/{line_id}",
    summary="Nonaktifkan (soft-delete) baris item/jasa (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_transaction_line(
    line_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_purchase_transaction_line(line_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Transaction line not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Transaction line deactivated successfully.")


# ============================================================
# ENDPOINTS -- 4) Exceptions
# ============================================================

@router.post(
    "/exceptions",
    summary="Buat antrean review Exceptions (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_exception(
    payload: PurchaseExceptionCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    dibuat = dbc.create_purchase_exception(payload.model_dump(), created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Failed to create exception (database error).", status_code=500)
    return sukses(data=dibuat, message="Exception created successfully.", status_code=201)


@router.get(
    "/exceptions",
    summary="Daftar antrean review (tab Exceptions)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_exception(
    client_id: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status", description="Open/Under Review/Requires Correction/Resolved/Ignored"),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_purchase_exceptions(client_id=client_id, status=status_filter, termasuk_nonaktif=termasuk_nonaktif)
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
    data = dbc.get_purchase_exception_by_id(exception_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Exception not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/exceptions/{exception_id}",
    summary="Update / resolve exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_exception(
    exception_id: str,
    payload: PurchaseExceptionUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    diupdate = dbc.update_purchase_exception(exception_id, payload.model_dump(exclude_unset=True), updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Exception not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Exception updated successfully.")


@router.delete(
    "/exceptions/{exception_id}",
    summary="Nonaktifkan (soft-delete) exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_exception(
    exception_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_purchase_exception(exception_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Exception not found.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Exception deactivated successfully.")