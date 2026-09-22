"""
modules/planning/tax_compliance_v1.py
=======================================
Fitur halaman Tax & Compliance: fiscal_correction (rekonsiliasi
akuntansi vs fiskal, TaxReconciliation.tsx) dan tax_compliance_task
(checklist tugas kepatuhan custom, ComplianceTasks.tsx), schema
5_Planning. Kewajiban pajak (PPN/PPh) sendiri tetap dari jurnal
transaksi (taxBridge.ts, tidak lewat endpoint ini).

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/planning/__init__.py untuk catatan lengkap
kenapa pemindahan ini menghapus registrasi lama di main.py (bukan
menambah path baru seperti pola modules/management/).
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("planning_tax_compliance_v1")

router = APIRouter(prefix="/api/v1/planning", tags=["tax-compliance"])


# ============================================================
# SKEMA
# ============================================================

class FiscalCorrectionRowSkema(BaseModel):
    """Satu baris koreksi fiskal -- lihat ambil_fiscal_correction()."""
    id: str
    bulan: int
    kategori: str
    accountingValue: float = 0
    taxValue: float = 0
    keterangan: Optional[str] = None


class FiscalCorrectionResponse(BaseModel):
    ada_data: bool
    corrections: List[FiscalCorrectionRowSkema]


class TaxTaskSkema(BaseModel):
    """Satu task kepatuhan pajak custom -- lihat daftar_tax_tasks()/tambah_tax_task()."""
    id: str
    taskName: str
    taxType: Optional[str] = None
    period: Optional[str] = None
    owner: Optional[str] = None
    dueDate: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class DaftarTaxTasksResponse(BaseModel):
    tasks: List[TaxTaskSkema]


class TambahTaxTaskResponse(BaseModel):
    berhasil: bool
    task: TaxTaskSkema


class UbahHapusTaxTaskResponse(BaseModel):
    """Dipakai bareng utk PATCH (ubah status) & DELETE (hapus) task --
    keduanya cuma balikin {berhasil} lewat ubah_status_tax_task()/hapus_tax_task()."""
    berhasil: bool
    pesan: Optional[str] = None


class TambahTaxTaskRequest(BaseModel):
    """Body POST /api/v1/planning/addTaxComplianceTask -> tombol "Add Task"."""
    taskName: str
    taxType: Optional[str] = None
    period: Optional[str] = None
    owner: Optional[str] = None
    dueDate: Optional[date] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class UbahStatusTaxTaskRequest(BaseModel):
    """Body PATCH /api/v1/planning/updateTaxComplianceTaskStatus."""
    status: str


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getFiscalCorrection", response_model=FiscalCorrectionResponse)
def api_fiscal_correction(client_id: str, tahun: Optional[int] = None, user: dict = Depends(auth.get_current_user)):
    """Koreksi fiskal tersimpan -- sumber TaxReconciliation.tsx."""
    tahun_dipakai = tahun or date.today().year
    return dbc.ambil_fiscal_correction(client_id, tahun_dipakai)


@router.get("/getTaxComplianceTasks", response_model=DaftarTaxTasksResponse)
def api_daftar_tax_tasks(client_id: str, user: dict = Depends(auth.get_current_user)):
    """Daftar task kepatuhan pajak custom -- sumber ComplianceTasks.tsx."""
    return dbc.daftar_tax_tasks(client_id)


@router.post("/addTaxComplianceTask", response_model=TambahTaxTaskResponse)
def api_tambah_tax_task(
    client_id: str, req: TambahTaxTaskRequest,
    user: dict = Depends(auth.require_level(2)),  # Senior Staff ke atas
):
    hasil = dbc.tambah_tax_task(client_id, req.model_dump())
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="tambah_tax_task",
        detail={"task_name": req.taskName},
    )
    return {"berhasil": True, "task": hasil}


@router.patch("/updateTaxComplianceTaskStatus", response_model=UbahHapusTaxTaskResponse)
def api_ubah_status_tax_task(
    client_id: str, task_id: str, req: UbahStatusTaxTaskRequest,
    user: dict = Depends(auth.get_current_user),
):
    hasil = dbc.ubah_status_tax_task(client_id, task_id, req.status)
    if not hasil.get("berhasil"):
        raise HTTPException(status_code=404, detail=hasil.get("pesan", "Task tidak ditemukan"))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="ubah_status_tax_task",
        detail={"task_id": task_id, "status": req.status},
    )
    return hasil


@router.delete("/deleteTaxComplianceTask", response_model=UbahHapusTaxTaskResponse)
def api_hapus_tax_task(
    client_id: str, task_id: str, user: dict = Depends(auth.require_level(2)),  # Senior Staff ke atas
):
    hasil = dbc.hapus_tax_task(client_id, task_id)
    if not hasil.get("berhasil"):
        raise HTTPException(status_code=404, detail=hasil.get("pesan", "Task tidak ditemukan"))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="hapus_tax_task",
        detail={"task_id": task_id},
    )
    return hasil