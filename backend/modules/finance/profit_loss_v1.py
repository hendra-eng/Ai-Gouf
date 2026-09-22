"""
modules/finance/profit_loss_v1.py
===================================
Halaman Profit & Loss, sumber 2 tabel schema Supabase "3_Financial":
budget P&L (PLBudgetLine) & insight P&L (PLInsight). Lihat komentar di
db_client.py (PLBudgetLine/PLInsight) untuk detail struktur tabel.

Dipindah APA ADANYA dari main.py (path, auth, response model TIDAK
diubah) -- lihat modules/finance/__init__.py untuk catatan lengkap.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import db_client as dbc
from ..auth import core as auth
from ..logging_config import get_module_logger

logger = get_module_logger("finance_profit_loss_v1")

router = APIRouter(prefix="/api/v1/finance", tags=["financial-statements"])


# ============================================================
# SKEMA
# ============================================================

class PLBudgetResponse(BaseModel):
    tahun: int
    bulan_sampai: int
    ada_data: bool
    revenue: float
    cogs: float
    grossProfit: float
    operatingExpenses: float
    ebitda: float
    netProfit: float


class PLInsightSkema(BaseModel):
    id: int
    title: str
    description: str
    metric: str
    severity: str
    periode: Optional[str] = None
    modul: Optional[str] = None


class PLInsightsResponse(BaseModel):
    modul: str
    insights: List[PLInsightSkema]


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/getProfitLossBudget", response_model=PLBudgetResponse)
def api_pl_budget(
    client_id: str,
    tahun: Optional[int] = None,
    bulan_sampai: int = 12,
    user: dict = Depends(auth.get_current_user),
):
    """Anggaran P&L (YTD s.d. `bulan_sampai`) untuk kolom "Budget" di kartu
    "Profitability vs Budget" halaman Profit & Loss. Bentuk respons sama
    dengan /financial-budget."""
    tahun_dipakai = tahun or date.today().year
    return dbc.ambil_pl_budget(client_id, tahun_dipakai, bulan_sampai)


@router.get("/getProfitLossInsights", response_model=PLInsightsResponse)
def api_pl_insights(
    client_id: str,
    modul: str = "profit_loss",
    user: dict = Depends(auth.get_current_user),
):
    """Insight P&L utk panel "AI Performance Insights". `modul` memilih
    kelompok insight di tabel (default "profit_loss")."""
    return {"modul": modul, "insights": dbc.daftar_pl_insights(client_id, modul)}