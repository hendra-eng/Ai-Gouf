"""
modules/planning/
==================
Kumpulan fitur domain "Planning" (sidebar: Budget & Forecast, Tax &
Compliance, Financial Analytics) lewat REST API /api/v1/planning/...:

    tax_compliance_v1.py -- Fitur halaman Tax & Compliance: koreksi
                             fiskal (fiscal_correction, rekonsiliasi
                             akuntansi vs fiskal -- TaxReconciliation.tsx)
                             & checklist tugas kepatuhan pajak custom
                             (tax_compliance_task -- ComplianceTasks.tsx),
                             schema 5_Planning.
    budget_forecast_v1.py -- Fitur halaman Budget & Forecast: asumsi
                             budget tahunan tersimpan (forecast_assumption
                             -- Apply di ForecastAssumptions.tsx) &
                             skenario custom tersimpan (scenario -- New
                             Scenario di ScenarioPlanning.tsx), schema
                             5_Planning. "Actual" & skenario Base/
                             Optimistic/Conservative bawaan tetap
                             dihitung dari P&L asli, bukan dari tabel ini.

Dipindah apa adanya dari main.py, TIDAK diubah auth (masih
Depends(auth.get_current_user) / Depends(auth.require_level(2)) dari
modules/auth/core.py, BUKAN get_current_user_v1) maupun bentuk
response-nya (masih response_model Pydantic langsung, BUKAN amplop
{status,message,data,errors}) supaya frontend tidak perlu diubah sama
sekali. Path endpoint TETAP /api/v1/planning/... (BUKAN
/api/v1/planning/tax-compliance/...) -- sengaja tidak diubah, ikut
path lama di main.py persis.

Sama seperti modules/asset/: karena path di file lama SUDAH pakai
konvensi v1, pemindahan ini MENGHAPUS registrasi lama di main.py
(bukan cuma menambah yang baru) -- kalau tidak, akan ada 2 handler
bentrok di path yang sama. Perilaku (path, auth, response) tetap
identik, cuma lokasi kodenya yang pindah.

Catatan: kewajiban pajak (PPN/PPh) sendiri TIDAK termasuk di sini --
itu tetap dihitung dari jurnal transaksi (taxBridge.ts di frontend),
bukan lewat endpoint ini. Kalau nanti Financial Analytics juga
dipindah, tambahkan file baru di folder ini (mis.
financial_analytics_v1.py) mengikuti pola yang sama.
"""

from .tax_compliance_v1 import router as tax_compliance_router  # noqa: F401
from .budget_forecast_v1 import router as budget_forecast_router  # noqa: F401