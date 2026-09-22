"""
modules/finance/cash_flow_v1.py
=================================
Halaman Cash Flow, sumber tabel schema Supabase "3_Financial":
forecast Cash Flow (CashFlowForecastRow). Lihat komentar di db_client.py
(CashFlowForecastRow) untuk detail struktur tabel.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/finance/__init__.py untuk catatan lengkap.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_cash_flow_v1")

router = APIRouter(prefix="/api/v1/finance", tags=["financial-statements"])


# ============================================================
# SKEMA
# ============================================================

class CashFlowForecastItemSkema(BaseModel):
    tahun: int
    bulan: int
    begin_cash: float
    operating_cf: float
    investing_cf: float
    financing_cf: float
    net_change: float
    end_cash: float


class CashFlowForecastResponse(BaseModel):
    forecast: List[CashFlowForecastItemSkema]


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getCashFlowForecast", response_model=CashFlowForecastResponse)
def api_cash_flow_forecast(
    client_id: str,
    tahun: Optional[int] = None,
    user: dict = Depends(auth.get_current_user),
):
    """Proyeksi arus kas bulanan utk grafik "Cash Flow Forecast" & tabel
    "Projected Cash Position" halaman Cash Flow (nominal Rupiah penuh)."""
    return {"forecast": dbc.daftar_cash_flow_forecast(client_id, tahun)}