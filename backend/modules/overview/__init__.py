"""
modules/overview/
==================
Kumpulan fitur domain "Overview" (halaman Financial Overview / dashboard
utama) yang sumber datanya schema Supabase "2_Overview":

    overview_v1.py -- Branches (dropdown cabang), Financial Budget
                       (anggaran P&L YTD per client/tahun/cabang), dan
                       KPI Bento (8 kartu Actual di KPIBentoGrid.tsx).
                       Dipindah apa adanya dari main.py, TIDAK diubah
                       auth maupun bentuk response-nya (masih pakai
                       Depends(auth.get_current_user) & response_model
                       Pydantic langsung, BUKAN amplop {status,message,
                       data,errors} seperti modules/auth/v1.py) supaya
                       frontend (OverviewContent.tsx, KPIBentoGrid.tsx)
                       tidak perlu diubah sama sekali.

                       Dua router diekspor: `router` (prefix
                       /api/v1/overview/..., untuk getBranches &
                       getFinancialBudget) dan `router_legacy` (path lama
                       /api/client/{id}/kpi-bento, untuk getKpiBento --
                       logic hitungnya sendiri TETAP di
                       modules/laporan_keuangan.py, cuma rute-nya yang
                       pindah ke sini karena dipakai halaman Overview).

Catatan: modules/dashboard.py & modules/charts.py TIDAK termasuk di sini
walau namanya mirip "dashboard" -- keduanya untuk fitur Live Dashboard
(GET /api/client/{id}/dashboard, riwayat proses dokumen), sumber datanya
BUKAN schema 2_Overview.
"""

from .overview_v1 import router, router_legacy  # noqa: F401