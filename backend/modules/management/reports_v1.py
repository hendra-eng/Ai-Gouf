"""
modules/management/reports_v1.py
==================================
Fitur Reports versi REST API standar: /api/v1/management/reports/...

Sebelumnya logic Reports (baca saja, 2 tabel: report_registry &
report_schedule) masih di path LAMA main.py:
    GET /api/client/{client_id}/reports-registry
    GET /api/client/{client_id}/report-schedule
-- belum ada satu pun yang dipindah ke pola /api/v1/... apalagi ke folder
modules/management/, dan TIDAK ADA fitur tulis sama sekali. Akibatnya di
src/app/reports/components/ReportsPageClient.tsx tombol "Create Report"
dan "Add Schedule"/"Pause" masih murni state React lokal -- hilang kalau
halaman di-refresh atau client aktif diganti.

File ini menambahkan versi /api/v1/management/reports/... yang lengkap
(baca + tulis), dibungkus amplop standar, mengikuti pola modules/auth/v1.py
& modules/management/documents_v1.py. Endpoint lama di main.py SENGAJA
belum dihapus/diubah (di luar scope, berisiko frontend yang belum pindah
jadi 404) -- migrasi frontend ke path baru ini menyusul terpisah.

Autentikasi: get_current_user_v1 (JWT wajib lewat jwt_v1_middleware).
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

import db_client as dbc
from ..api_response import gagal, sukses
from ..auth.v1 import get_current_user_v1
from ..logging_config import get_module_logger

logger = get_module_logger("management_reports_v1")

router = APIRouter(prefix="/api/v1/management/reports", tags=["management-reports-v1"])


# ============================================================
# SKEMA REQUEST
# ============================================================

class TambahReportRegistryRequest(BaseModel):
    client_id: str
    name: str = Field(..., min_length=1, max_length=200)
    category: str  # financial-statements/management/tax/ar-ap/budget/audit/custom
    description: Optional[str] = None
    period: Optional[str] = None
    formats: Optional[str] = None  # dipisah koma, mis. "PDF,Excel"
    tags: Optional[str] = None  # dipisah koma


class TambahReportScheduleRequest(BaseModel):
    client_id: str
    report_name: str = Field(..., min_length=1, max_length=200)
    frequency: str  # Daily/Weekly/Monthly/Quarterly/Yearly
    recipients: Optional[str] = None  # daftar email, dipisah koma
    format: Optional[str] = None  # PDF/Excel/CSV/Word
    next_run: Optional[str] = None  # YYYY-MM-DD


class UbahStatusScheduleRequest(BaseModel):
    status: str  # Active/Paused/Error


# ============================================================
# ENDPOINTS -- Registry
# ============================================================

@router.get(
    "/registry",
    summary="Daftar laporan tercatat (Report Library) milik satu client",
)
def daftar_report_registry(
    client_id: str = Query(..., description="UUID client"),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    daftar: List[Dict[str, Any]] = dbc.ambil_data_report_registry(client_id)
    return sukses(data={"report_registry": daftar}, message="OK")


@router.post(
    "/registry",
    summary="Catat laporan baru (tombol \"Create Report\")",
    responses={
        201: {"description": "Laporan berhasil dicatat."},
        422: {"description": "Payload tidak valid (mis. kategori/format tidak dikenal)."},
    },
)
def tambah_report_registry(
    payload: TambahReportRegistryRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        hasil = dbc.tambah_report_registry(
            client_id=payload.client_id, name=payload.name, category=payload.category,
            description=payload.description, period=payload.period, formats=payload.formats,
            tags=payload.tags, created_by=current_user.get("id"),
        )
    except ValueError as e:
        return gagal(message=str(e), status_code=422)
    dbc.log_audit(
        client_id=payload.client_id, user=current_user.get("username", "unknown"),
        aksi="tambah_report_registry", detail={"name": payload.name, "category": payload.category},
    )
    return sukses(data=hasil, message="Laporan berhasil dicatat.", status_code=201)


# ============================================================
# ENDPOINTS -- Schedule
# ============================================================

@router.get(
    "/schedule",
    summary="Daftar jadwal laporan berkala (tab \"Report Scheduler\") milik satu client",
)
def daftar_report_schedule(
    client_id: str = Query(..., description="UUID client"),
    _current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    daftar: List[Dict[str, Any]] = dbc.ambil_data_report_schedule(client_id)
    return sukses(data={"report_schedule": daftar}, message="OK")


@router.post(
    "/schedule",
    summary="Buat jadwal laporan berkala baru (tombol \"Add Schedule\")",
    responses={
        201: {"description": "Jadwal berhasil dibuat."},
        422: {"description": "Payload tidak valid (mis. frequency/format tidak dikenal)."},
    },
)
def tambah_report_schedule(
    payload: TambahReportScheduleRequest,
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        hasil = dbc.tambah_report_schedule(
            client_id=payload.client_id, report_name=payload.report_name, frequency=payload.frequency,
            recipients=payload.recipients, format=payload.format, next_run=payload.next_run,
        )
    except ValueError as e:
        return gagal(message=str(e), status_code=422)
    dbc.log_audit(
        client_id=payload.client_id, user=current_user.get("username", "unknown"),
        aksi="tambah_report_schedule", detail={"report_name": payload.report_name, "frequency": payload.frequency},
    )
    return sukses(data=hasil, message="Jadwal laporan berhasil dibuat.", status_code=201)


@router.patch(
    "/schedule/{schedule_id}/status",
    summary="Ubah status jadwal laporan (tombol \"Pause\"/\"Resume\")",
    responses={
        200: {"description": "Status berhasil diubah."},
        404: {"description": "Jadwal tidak ditemukan untuk client ini."},
        422: {"description": "Status tidak dikenal."},
    },
)
def ubah_status_report_schedule(
    schedule_id: str,
    payload: UbahStatusScheduleRequest,
    client_id: str = Query(..., description="UUID client (pemilik jadwal)"),
    current_user: Dict[str, Any] = Depends(get_current_user_v1),
):
    try:
        hasil = dbc.ubah_status_report_schedule(client_id=client_id, schedule_id=schedule_id, status=payload.status)
    except ValueError as e:
        status_code = 404 if "tidak ditemukan" in str(e) else 422
        return gagal(message=str(e), status_code=status_code)
    dbc.log_audit(
        client_id=client_id, user=current_user.get("username", "unknown"),
        aksi="ubah_status_report_schedule", detail={"schedule_id": schedule_id, "status": payload.status},
    )
    return sukses(data=hasil, message="Status jadwal berhasil diubah.")