"""
modules/planning/budget_forecast_v1.py
========================================
Fitur halaman Budget & Forecast: forecast_assumption & scenario (schema
5_Planning). Halaman ini tetap menghitung "Actual" dari P&L asli dan
skenario Base/Optimistic/Conservative bawaan dari run-rate -- 2 tabel
di sini menggantikan konstanta hardcoded BUDGET_ASSUMPTIONS (Apply di
ForecastAssumptions.tsx) dan menambah skenario custom tersimpan (New
Scenario di ScenarioPlanning.tsx).

ambil_forecast_assumption() (db_client.py) membuat baris default
otomatis kalau client belum pernah Apply, jadi GET getForecastAssumption
TIDAK PERNAH mengembalikan assumption: null utk client_id yang valid.

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

logger = get_module_logger("planning_budget_forecast_v1")

router = APIRouter(prefix="/api/v1/planning", tags=["budget-forecast"])


# ============================================================
# SKEMA
# ============================================================

class ForecastAssumptionSkema(BaseModel):
    tahun: int
    revenue_growth_pct: Optional[float] = None
    cogs_pct: Optional[float] = None
    payroll_growth_pct: Optional[float] = None
    opex_growth_pct: Optional[float] = None
    collection_rate_pct: Optional[float] = None
    tax_rate_pct: Optional[float] = None
    capex: Optional[float] = None
    interest_expense: Optional[float] = None


class AmbilForecastAssumptionResponse(BaseModel):
    tahun: int
    assumption: Optional[ForecastAssumptionSkema] = None


class SimpanForecastAssumptionRequest(BaseModel):
    """Body POST /api/v1/planning/saveForecastAssumption. Semua field
    opsional -- hanya yang dikirim yang di-upsert."""
    tahun: Optional[int] = None
    revenue_growth_pct: Optional[float] = None
    cogs_pct: Optional[float] = None
    payroll_growth_pct: Optional[float] = None
    opex_growth_pct: Optional[float] = None
    collection_rate_pct: Optional[float] = None
    tax_rate_pct: Optional[float] = None
    capex: Optional[float] = None
    interest_expense: Optional[float] = None


class SimpanForecastAssumptionResponse(BaseModel):
    berhasil: bool
    assumption: ForecastAssumptionSkema


class ScenarioSkema(BaseModel):
    id: str
    nama_skenario: str
    revenue_growth_pct: Optional[float] = None
    cogs_pct: Optional[float] = None
    opex_growth_pct: Optional[float] = None
    tax_rate_pct: Optional[float] = None
    is_base_case: bool
    created_by: Optional[str] = None


class DaftarScenarioResponse(BaseModel):
    tahun: int
    scenarios: List[ScenarioSkema]


class TambahScenarioRequest(BaseModel):
    """Body POST /api/v1/planning/addScenario -> tombol "New Scenario"."""
    tahun: Optional[int] = None
    nama_skenario: str
    revenue_growth_pct: Optional[float] = None
    cogs_pct: Optional[float] = None
    opex_growth_pct: Optional[float] = None
    tax_rate_pct: Optional[float] = None
    is_base_case: bool = False


class ScenarioRingkasSkema(BaseModel):
    id: str
    nama_skenario: str


class TambahScenarioResponse(BaseModel):
    berhasil: bool
    scenario: ScenarioRingkasSkema


class HapusScenarioResponse(BaseModel):
    berhasil: bool
    id: str
    dihapus: bool


# ============================================================
# ENDPOINTS -- Forecast Assumption
# ============================================================

@router.get("/getForecastAssumption", response_model=AmbilForecastAssumptionResponse)
def api_ambil_forecast_assumption(
    client_id: str, tahun: Optional[int] = None, user: dict = Depends(auth.get_current_user)
):
    """Asumsi budget tersimpan client utk 1 tahun -- dibuat otomatis dgn
    nilai default kalau ini kali pertama client ybs diminta (lihat
    _DEFAULT_FORECAST_ASSUMPTION di db_client.py), jadi tidak pernah null
    lagi untuk client_id yang valid."""
    tahun_dipakai = tahun or date.today().year
    try:
        assumption = dbc.ambil_forecast_assumption(client_id, tahun_dipakai)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"tahun": tahun_dipakai, "assumption": assumption}


@router.post("/saveForecastAssumption", response_model=SimpanForecastAssumptionResponse)
def api_simpan_forecast_assumption(
    client_id: str, req: SimpanForecastAssumptionRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """Upsert asumsi budget client (tombol Apply di ForecastAssumptions.tsx)."""
    tahun_dipakai = req.tahun or date.today().year
    nilai = {k: v for k, v in req.model_dump().items() if k != "tahun" and v is not None}
    try:
        hasil = dbc.simpan_forecast_assumption(client_id, tahun_dipakai, **nilai)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="simpan_forecast_assumption",
        detail={"tahun": tahun_dipakai, **nilai},
    )
    return {"berhasil": True, "assumption": hasil}


# ============================================================
# ENDPOINTS -- Scenario
# ============================================================

@router.get("/getScenarios", response_model=DaftarScenarioResponse)
def api_daftar_scenario(client_id: str, tahun: Optional[int] = None, user: dict = Depends(auth.get_current_user)):
    """Daftar skenario custom tersimpan client utk 1 tahun."""
    tahun_dipakai = tahun or date.today().year
    return {"tahun": tahun_dipakai, "scenarios": dbc.daftar_scenario(client_id, tahun_dipakai)}


@router.post("/addScenario", response_model=TambahScenarioResponse)
def api_tambah_scenario(
    client_id: str, req: TambahScenarioRequest,
    user: dict = Depends(auth.require_level(2)),  # Senior Staff ke atas
):
    tahun_dipakai = req.tahun or date.today().year
    try:
        hasil = dbc.tambah_scenario(
            client_id=client_id, tahun=tahun_dipakai, nama_skenario=req.nama_skenario,
            revenue_growth_pct=req.revenue_growth_pct, cogs_pct=req.cogs_pct,
            opex_growth_pct=req.opex_growth_pct, tax_rate_pct=req.tax_rate_pct,
            is_base_case=req.is_base_case, created_by=user.get("nama") or user.get("username", "unknown"),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="tambah_scenario",
        detail={"tahun": tahun_dipakai, "nama_skenario": req.nama_skenario},
    )
    return {"berhasil": True, "scenario": hasil}


@router.delete("/deleteScenario", response_model=HapusScenarioResponse)
def api_hapus_scenario(
    client_id: str, scenario_id: str, user: dict = Depends(auth.require_level(2)),  # Senior Staff ke atas
):
    try:
        hasil = dbc.hapus_scenario(client_id, scenario_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"), aksi="hapus_scenario",
        detail={"scenario_id": scenario_id},
    )
    return {"berhasil": True, **hasil}