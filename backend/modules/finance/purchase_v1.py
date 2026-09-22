"""
modules/finance/purchase_v1.py
================================
Halaman Purchase (vendor, tagihan, source data, line items, exceptions,
activity log), sumber 6 tabel schema Supabase "3_Financial": vendor,
purchase_transaction, purchase_line_items, purchase_source_data,
purchase_journal_lines, purchase_exceptions. Lihat
db_client.py::ambil_data_purchase() untuk detail query.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/finance/__init__.py untuk catatan lengkap
kenapa pemindahan ini menghapus registrasi lama di main.py (bukan
menambah path baru).

VendorSkema di sini DIPAKAI ULANG oleh modul Accounts Payable yang masih
tinggal di main.py (Vendor & Bill dipakai ulang dari Purchase) -- lihat
catatan di modules/finance/__init__.py.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_purchase_v1")

router = APIRouter(prefix="/api/v1/transaction", tags=["purchase"])


# ============================================================
# SKEMA
# ============================================================
# [BARU] Skema response (Pydantic) modul Purchase -- dipetakan 1:1 dari
# bentuk dict yang dikembalikan dbc.ambil_data_purchase(), supaya field &
# tipenya tercantum di /docs (OpenAPI), bukan cuma "Response" generik.
# ============================================================

class VendorSkema(BaseModel):
    id: str
    name: str


class PurchaseTransactionSkema(BaseModel):
    id: str
    purchase_id: Optional[str] = None
    vendor_id: Optional[str] = None
    invoice_no: Optional[str] = None
    po_number: Optional[str] = None
    category: Optional[str] = None
    period: Optional[str] = None
    payment_terms: Optional[str] = None
    currency: Optional[str] = None
    source: Optional[str] = None
    purchase_date: Optional[str] = None
    invoice_date: Optional[str] = None
    posting_date: Optional[str] = None
    due_date: Optional[str] = None
    subtotal: float = 0
    discount: float = 0
    tax: float = 0
    total_payable: float = 0
    payment_status: Optional[str] = None
    status: Optional[str] = None
    prepared_by: Optional[str] = None
    approved_by: Optional[str] = None
    posted_by: Optional[str] = None
    description: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class PurchaseLineItemSkema(BaseModel):
    id: str
    purchase_id: Optional[str] = None
    item_code: Optional[str] = None
    item_name: Optional[str] = None
    qty: float = 0
    unit: Optional[str] = None
    unit_price: float = 0
    discount: float = 0
    tax_rate: float = 0
    tax_amount: float = 0
    subtotal: float = 0
    total: float = 0
    gl_account: Optional[str] = None


class PurchaseSourceDataSkema(BaseModel):
    id: str
    source_id: Optional[str] = None
    type: Optional[str] = None
    vendor: Optional[str] = None
    date: Optional[str] = None
    invoice_no: Optional[str] = None
    po_number: Optional[str] = None
    amount: float = 0
    tax: float = 0
    total: float = 0
    purchase_ref: Optional[str] = None
    validation: Optional[str] = None
    status: Optional[str] = None


class PurchaseJournalLineSkema(BaseModel):
    id: str
    purchase_id: Optional[str] = None
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    description: Optional[str] = None
    debit: float = 0
    credit: float = 0


class PurchaseExceptionSkema(BaseModel):
    id: str
    purchase_id: Optional[str] = None
    reason: Optional[str] = None
    severity: Optional[str] = None
    exception_status: Optional[str] = None
    created_at: Optional[str] = None


class DataPurchaseResponse(BaseModel):
    vendor: List[VendorSkema]
    purchase_transaction: List[PurchaseTransactionSkema]
    purchase_line_items: List[PurchaseLineItemSkema]
    source_data: List[PurchaseSourceDataSkema]
    purchase_journal_lines: List[PurchaseJournalLineSkema]
    exceptions: List[PurchaseExceptionSkema]


class UpdatePurchaseStatusRequest(BaseModel):
    """Body PATCH ubah status satu transaksi Purchase -- lihat
    api_update_purchase_status()."""
    status: str
    alasan: Optional[str] = None


class UpdatePurchaseStatusResponse(BaseModel):
    berhasil: bool
    purchase: PurchaseTransactionSkema


class BulkUpdatePurchaseStatusResponse(BaseModel):
    berhasil: bool
    diperbarui: int
    dilewati: int
    tidak_ditemukan: int


class PurchaseExceptionStatusUpdateSkema(BaseModel):
    """Hasil ubah status exception -- bentuk ringkas, BUKAN
    PurchaseExceptionSkema penuh, lihat update_purchase_exception_status()."""
    id: str
    exception_status: str


class UpdatePurchaseExceptionStatusResponse(BaseModel):
    berhasil: bool
    exception: PurchaseExceptionStatusUpdateSkema


class BulkUpdatePurchaseStatusRequest(BaseModel):
    ids: List[str]
    target_status: str
    from_status: Optional[str] = None


class UpdatePurchaseExceptionStatusRequest(BaseModel):
    exception_status: str


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getPurchase", response_model=DataPurchaseResponse)
def api_data_purchase(client_id: str, user: dict = Depends(auth.get_current_user)):
    """
    [BARU] Data mentah modul Purchase (vendor, purchase_transaction,
    purchase_line_items, source_data, purchase_journal_lines, exceptions)
    untuk satu client -- tabel dibuat manual oleh user lewat Supabase SQL
    Editor. Frontend memetakan hasilnya ke tipe PurchaseTransaction/dst
    lewat src/app/transactions/purchase/purchasebridge.ts.
    """
    return dbc.ambil_data_purchase(client_id)


@router.patch("/updatePurchaseStatus", response_model=UpdatePurchaseStatusResponse)
def api_update_purchase_status(
    client_id: str, purchase_row_id: str, req: UpdatePurchaseStatusRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """[BARU] Ubah status satu transaksi Purchase -- dipakai tombol Submit
    for Review/Approve/Reject/Post to GL/Return for Correction di halaman
    Journal Preview (src/app/transactions/purchase/preview/page.tsx)."""
    try:
        hasil = dbc.update_purchase_status(
            purchase_row_id, client_id, user.get("username", "unknown"),
            req.status, alasan=req.alasan,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if hasil is None:
        raise HTTPException(status_code=404, detail="Transaksi Purchase tidak ditemukan untuk client ini.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="update_purchase_status",
        detail={"purchase_row_id": purchase_row_id, "status": req.status, "alasan": req.alasan},
    )
    return {"berhasil": True, "purchase": hasil}


@router.post("/bulkUpdatePurchaseStatus", response_model=BulkUpdatePurchaseStatusResponse)
def api_bulk_update_purchase_status(
    client_id: str, req: BulkUpdatePurchaseStatusRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """[BARU] Ubah status banyak transaksi Purchase sekaligus -- dipakai
    tombol "Bulk Approve" di halaman Transaction
    (src/app/transactions/purchase/transaction/page.tsx)."""
    try:
        hasil = dbc.bulk_update_purchase_status(
            client_id, req.ids, user.get("username", "unknown"),
            req.target_status, from_status=req.from_status,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="bulk_update_purchase_status",
        detail={"jumlah_diminta": len(req.ids), "target_status": req.target_status, **hasil},
    )
    return {"berhasil": True, **hasil}


@router.patch("/updatePurchaseExceptionStatus", response_model=UpdatePurchaseExceptionStatusResponse)
def api_update_purchase_exception_status(
    client_id: str, exception_id: str, req: UpdatePurchaseExceptionStatusRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """[BARU] Ubah status satu exception Purchase -- dipakai tombol Start
    Review/Flag/Mark Resolved/Begin Correction/Ignore di halaman Exceptions
    (src/app/transactions/purchase/exceptions/page.tsx). Sebelumnya cuma
    diubah di state React lokal, sekarang tersimpan permanen ke Supabase."""
    try:
        hasil = dbc.update_purchase_exception_status(exception_id, client_id, req.exception_status, user=user.get("username", "unknown"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if hasil is None:
        raise HTTPException(status_code=404, detail="Exception Purchase tidak ditemukan untuk client ini.")

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="update_purchase_exception_status",
        detail={"exception_id": exception_id, "exception_status": req.exception_status},
    )
    return {"berhasil": True, "exception": hasil}