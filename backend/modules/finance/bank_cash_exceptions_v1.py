"""
modules/finance/bank_cash_exceptions_v1.py
============================================
Tab "Exceptions" di Cash & Bank (src/app/transactions/bank-cash/exceptions).
Sumber tabel: financial_transaction_bank_cash_exceptions (ORM:
db_client.py::FinanceTransactionBankCashException).

PENTING -- tabel ini hanya menyimpan status PENANGANAN, bukan salinan
masalahnya. Deteksi masalah (amount mismatch, duplicate, mutasi unmatched,
akun lawan kosong, jurnal tidak balance, dst) tetap dihitung ulang dari
Bank Feed + Reconciliation setiap tab dibuka; hasil deteksi lalu
digabung dengan baris di sini lewat kunci
(client_id, bank_mutation_ref, exception_type):

    - ada baris cocok    -> pakai status/assigned_to/resolved_* dari sini
    - tidak ada          -> dianggap Open baru (belum pernah ditangani)
    - masalah tidak lagi terdeteksi -> hilang dari daftar walau barisnya
      di sini masih ada (tidak perlu dibersihkan manual)

Endpoint /upsert dibuat untuk alur itu: begitu user pertama kali
meng-assign / mengubah status exception yang baru terdeteksi (belum punya
baris), frontend cukup memanggil satu endpoint tanpa perlu tahu apakah
barisnya sudah ada.

Pola & standar SAMA dengan modules/transactions/sales_v1.py (bagian
Exceptions): routing /api/v1/..., amplop {status,message,data,errors},
auth ditegakkan jwt_v1_middleware (Bearer ATAU cookie httpOnly
"gouf_session"), endpoint yang mengubah data dibatasi Supervisor ke atas
(tahap 3), endpoint baca cukup token valid. Beda dari Sales: client_id
merujuk management_clients (sama seperti finance_transaction_bank_cash),
dan wajib diisi.

Aturan resolved (dijaga di sini supaya frontend tidak perlu mengirimnya):
status jadi 'Resolved' -> resolved_at/resolved_by diisi otomatis (kecuali
dikirim eksplisit); status jadi selain 'Resolved' -> keduanya dikosongkan.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

import db_client as dbc
from ..auth import core as auth
from ..auth.v1 import get_current_user_v1
from ..api_response import gagal, sukses
from ..logging_config import get_module_logger

logger = get_module_logger("finance_bank_cash_exceptions_v1")

router = APIRouter(prefix="/api/v1/finance/bank-cash/exceptions", tags=["bank-cash-exceptions-v1"])

ExceptionStatus = Literal["Open", "In Review", "Resolved"]
ExceptionPriority = Literal["High", "Medium", "Low"]
ExceptionSource = Literal["Reconciliation", "Classification"]


def _require_level_v1(min_tahap: int):
    """Sama persis dengan _require_level_v1 di modules/transactions/sales_v1.py
    (kompatibel dengan alur cookie httpOnly -- lihat catatan di sana)."""

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
# SKEMA REQUEST
# ============================================================

class BankCashExceptionCreateRequest(BaseModel):
    client_id: str
    bank_mutation_ref: str = Field(..., min_length=1, max_length=100)
    linked_sales_invoice_id: Optional[str] = None
    linked_purchase_transaction_id: Optional[str] = None
    exception_type: str = Field(..., min_length=1, max_length=100)
    source: ExceptionSource
    priority: ExceptionPriority = "Medium"
    status: ExceptionStatus = "Open"
    ai_confidence: Optional[float] = Field(None, ge=0, le=100)
    ai_suggestion: Optional[str] = None
    source_snippet: Optional[Dict[str, Any]] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


class BankCashExceptionUpdateRequest(BaseModel):
    """Semua field opsional -- update bersifat partial (exclude_unset)."""
    bank_mutation_ref: Optional[str] = Field(None, min_length=1, max_length=100)
    linked_sales_invoice_id: Optional[str] = None
    linked_purchase_transaction_id: Optional[str] = None
    exception_type: Optional[str] = Field(None, min_length=1, max_length=100)
    source: Optional[ExceptionSource] = None
    priority: Optional[ExceptionPriority] = None
    status: Optional[ExceptionStatus] = None
    ai_confidence: Optional[float] = Field(None, ge=0, le=100)
    ai_suggestion: Optional[str] = None
    source_snippet: Optional[Dict[str, Any]] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


class BankCashExceptionUpsertRequest(BaseModel):
    """Kunci pencocokan: client_id + bank_mutation_ref + exception_type.
    Field lain opsional & hanya yang DIKIRIM yang ditimpa kalau barisnya
    sudah ada (untuk baris baru: default priority 'Medium', status 'Open')."""
    client_id: str
    bank_mutation_ref: str = Field(..., min_length=1, max_length=100)
    exception_type: str = Field(..., min_length=1, max_length=100)
    source: ExceptionSource
    linked_sales_invoice_id: Optional[str] = None
    linked_purchase_transaction_id: Optional[str] = None
    priority: Optional[ExceptionPriority] = None
    status: Optional[ExceptionStatus] = None
    ai_confidence: Optional[float] = Field(None, ge=0, le=100)
    ai_suggestion: Optional[str] = None
    source_snippet: Optional[Dict[str, Any]] = None
    assigned_to: Optional[str] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[str] = None
    notes: Optional[str] = Field(None, max_length=2000)


def _terapkan_aturan_resolved(fields: Dict[str, Any], current_user: Dict[str, Any]) -> None:
    """Jaga konsistensi status vs resolved_at/resolved_by (lihat docstring
    modul). Hanya berlaku kalau `status` ikut dikirim."""
    if "status" not in fields or fields["status"] is None:
        return
    if fields["status"] == "Resolved":
        if fields.get("resolved_at") is None:
            fields["resolved_at"] = datetime.now(timezone.utc)
        if fields.get("resolved_by") is None:
            fields["resolved_by"] = current_user.get("id")
    else:
        fields["resolved_at"] = None
        fields["resolved_by"] = None


# ============================================================
# ENDPOINTS
# ============================================================

@router.get(
    "",
    summary="Daftar catatan penanganan exception Cash & Bank milik 1 client",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}},
)
def daftar_exception(
    client_id: str = Query(..., description="management_clients.id"),
    status_filter: Optional[ExceptionStatus] = Query(None, alias="status"),
    bank_mutation_ref: Optional[str] = Query(None),
    source: Optional[ExceptionSource] = Query(None),
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.list_bank_cash_exceptions(
        client_id=client_id, status=status_filter, bank_mutation_ref=bank_mutation_ref,
        source=source, termasuk_nonaktif=termasuk_nonaktif,
    )
    return sukses(data=data, message="OK")


@router.post(
    "/upsert",
    summary="Simpan penanganan exception -- update kalau sudah ada, buat baru kalau belum (Supervisor ke atas)",
    responses={200: {"description": "Diupdate."}, 201: {"description": "Dibuat."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def upsert_exception(
    payload: BankCashExceptionUpsertRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    fields = payload.model_dump(exclude_unset=True)
    _terapkan_aturan_resolved(fields, current_user)
    hasil = dbc.upsert_bank_cash_exception(fields, user_id=current_user.get("id"))
    if hasil is None:
        return gagal(message="Gagal menyimpan exception (kesalahan database).", status_code=500)
    dibuat = bool(hasil.pop("_dibuat", False))
    return sukses(
        data=hasil,
        message="Exception berhasil dibuat." if dibuat else "Exception berhasil diupdate.",
        status_code=201 if dibuat else 200,
    )


@router.post(
    "",
    summary="Buat catatan penanganan exception (khusus Supervisor ke atas)",
    responses={201: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 422: {"description": "Payload tidak valid."}},
)
def buat_exception(
    payload: BankCashExceptionCreateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    fields = payload.model_dump()
    _terapkan_aturan_resolved(fields, current_user)
    dibuat = dbc.create_bank_cash_exception(fields, created_by=current_user.get("id"))
    if dibuat is None:
        return gagal(message="Gagal membuat exception (kesalahan database).", status_code=500)
    return sukses(data=dibuat, message="Exception berhasil dibuat.", status_code=201)


@router.get(
    "/{exception_id}",
    summary="Detail 1 catatan penanganan exception",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 404: {"description": "Tidak ditemukan."}},
)
def detail_exception(
    exception_id: str,
    termasuk_nonaktif: bool = Query(False),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    data = dbc.get_bank_cash_exception_by_id(exception_id, termasuk_nonaktif=termasuk_nonaktif)
    if data is None:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=data, message="OK")


@router.put(
    "/{exception_id}",
    summary="Update / resolve / assign exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def update_exception(
    exception_id: str,
    payload: BankCashExceptionUpdateRequest,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    fields = payload.model_dump(exclude_unset=True)
    _terapkan_aturan_resolved(fields, current_user)
    diupdate = dbc.update_bank_cash_exception(exception_id, fields, updated_by=current_user.get("id"))
    if diupdate is None:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(data=diupdate, message="Exception berhasil diupdate.")


@router.delete(
    "/{exception_id}",
    summary="Nonaktifkan (soft-delete) catatan penanganan exception (khusus Supervisor ke atas)",
    responses={200: {"description": "OK."}, 401: {"description": "Unauthorized."}, 403: {"description": "Forbidden."}, 404: {"description": "Tidak ditemukan."}},
)
def hapus_exception(
    exception_id: str,
    current_user: Dict[str, Any] = Depends(_require_level_v1(3)),
):
    berhasil = dbc.soft_delete_bank_cash_exception(exception_id, deleted_by=current_user.get("id"))
    if not berhasil:
        return gagal(message="Exception tidak ditemukan.", errors={"code": "NOT_FOUND"}, status_code=404)
    return sukses(message="Exception berhasil dinonaktifkan.")