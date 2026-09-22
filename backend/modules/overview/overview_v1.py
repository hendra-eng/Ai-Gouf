"""
modules/overview/overview_v1.py
================================
Fitur Overview (halaman Financial Overview): Branches + Financial Budget.
Sumber tabel: overview_management_branches & overview_financial_budget,
schema "2_Overview". Lihat db_client.py::daftar_branches() /
ambil_financial_budget() untuk detail query & perhitungan.

DIPINDAH APA ADANYA dari main.py (endpoint GET /api/v1/overview/getBranches,
GET /api/v1/overview/getFinancialBudget, & GET /api/client/{id}/kpi-bento)
-- SENGAJA belum diubah ke pola modules/auth/v1.py (amplop {status,message,
data,errors} + get_current_user_v1):
- Masih pakai Depends(auth.get_current_user) (sistem lama), karena token
  yang dipakai OverviewContent.tsx/KPIBentoGrid.tsx sekarang berasal dari
  login lama (POST /api/login), bukan /api/v1/auth/login.
- response_model Pydantic tetap bentuk lama (bukan amplop), supaya kedua
  komponen frontend itu TIDAK PERLU diubah sama sekali cuma karena file
  ini dipindah folder.

Upgrade ke pola v1 penuh (amplop + get_current_user_v1) BISA dilakukan
belakangan, mengikuti pola modules/management/documents_v1.py (endpoint
lama dibiarkan, endpoint v1 baru ditambah terpisah) -- di luar scope
pemindahan folder ini.

CATATAN soal getKpiBento (di bawah): rute-nya dipindah ke sini karena
dipakai halaman Overview (KPIBentoGrid.tsx, 8 kartu mode "Actual"), TAPI
logic hitungnya (lapkeu.susun_kpi_bento_dashboard) SENGAJA TIDAK ikut
dipindah -- fungsi itu masih tinggal di modules/laporan_keuangan.py
karena juga dipakai halaman Financial Statements. Kalau nanti
laporan_keuangan.py dipindah ke modules/finance/, import di bawah
("from .. import laporan_keuangan as lapkeu") tinggal disesuaikan
path-nya, tidak perlu ubah logic apa pun di file ini.
"""

from __future__ import annotations

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

import db_client as dbc
from .. import accounting_core
from .. import laporan_keuangan as lapkeu
from ..auth import get_current_user
from ..logging_config import get_module_logger

logger = get_module_logger("overview_v1")

# Endpoint dengan path /api/v1/overview/... (getBranches, getFinancialBudget)
router = APIRouter(prefix="/api/v1/overview", tags=["overview"])

# getKpiBento path-nya BEDA pola (/api/client/{client_id}/kpi-bento, gaya
# lama) -- dipisah routernya sendiri (tanpa prefix /api/v1/overview) supaya
# URL tetap sama persis kayak sebelumnya, frontend tidak perlu diubah.
router_legacy = APIRouter(tags=["overview"])


# ─── Branches ───────────────────────────────────────────────────────────
class BranchSkema(BaseModel):
    id: str
    nama_cabang: str


class DaftarBranchesResponse(BaseModel):
    branches: List[BranchSkema]


@router.get("/getBranches", response_model=DaftarBranchesResponse)
def api_daftar_branches(client_id: str, user: dict = Depends(get_current_user)):
    """Daftar cabang milik client -- sumber dropdown "Branch" di
    OverviewContent.tsx (menggantikan opsi hardcoded Jakarta/Surabaya)."""
    return {"branches": dbc.daftar_branches(client_id)}


# ─── Financial Budget ───────────────────────────────────────────────────
class FinancialBudgetResponse(BaseModel):
    tahun: int
    bulan_sampai: int
    ada_data: bool
    revenue: float
    cogs: float
    grossProfit: float
    operatingExpenses: float
    da: float
    ebitda: float
    interest: float
    tax: float
    netProfit: float


@router.get("/getFinancialBudget", response_model=FinancialBudgetResponse)
def api_financial_budget(
    client_id: str,
    tahun: Optional[int] = None,
    bulan_sampai: int = 12,
    branch_id: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Anggaran P&L (YTD s.d. `bulan_sampai`) untuk mode "Budget" di
    KPIBentoGrid.tsx -- menggantikan konstanta hardcoded BUDGET di
    src/lib/financialData.tsx. `branch_id` opsional (UUID dari
    /branches), kosong = semua cabang digabung."""
    tahun_dipakai = tahun or date.today().year
    return dbc.ambil_financial_budget(client_id, tahun_dipakai, bulan_sampai, branch_id)


# ─── KPI Bento (8 kartu Actual) ─────────────────────────────────────────
@router_legacy.get("/api/client/{client_id}/kpi-bento")
def api_kpi_bento_dashboard(
    client_id: str,
    tahun: Optional[int] = None,
    cabang: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    """Angka 8 kartu KPIBentoGrid.tsx (Revenue/Net Profit/Gross Profit/
    Cash & Bank/AR/AP/EBITDA/Tax Payable), dihitung real-time dari jurnal
    terposting + COA client tahun berjalan (atau `tahun` kalau diisi).

    `cabang` opsional (mis. "Jakarta"/"Surabaya", cocok dgn dropdown
    OverviewContent.tsx) -- kalau diisi, jurnal disaring dulu lewat
    lapkeu.filter_jurnal_per_cabang() berdasarkan tag Coa.cabang per akun
    SEBELUM dihitung ke 8 kartu. Kosong/None/"All Branches" = tidak
    difilter (semua cabang digabung, perilaku lama)."""
    tahun_dipakai = tahun or date.today().year
    # Accounting Core V2: Dashboard Actual hanya memakai journal lines POSTED.
    jurnal = accounting_core.list_posted_lines(
        client_id,
        tanggal_mulai=f"{tahun_dipakai}-01-01",
        tanggal_akhir=f"{tahun_dipakai}-12-31",
    )
    coa = dbc.ambil_coa_client(client_id)
    jurnal = lapkeu.filter_jurnal_per_cabang(jurnal, coa, cabang)
    return lapkeu.susun_kpi_bento_dashboard(jurnal, coa, tahun=tahun_dipakai)