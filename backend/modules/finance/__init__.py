"""
modules/finance/
=================
Kumpulan fitur domain "Finance" (grup sidebar Transactions: Purchase,
Bank & Cash, Other) lewat REST API /api/v1/transaction/... -- 8 tabel
Supabase schema "3_Financial" dibuat manual oleh user lewat Supabase SQL
Editor:

    purchase_v1.py     -- Halaman Purchase: vendor, tagihan (purchase
                        transaction), line items, source data, journal
                        lines, exceptions. Tabel: vendor,
                        purchase_transaction, purchase_line_items,
                        purchase_source_data, purchase_journal_lines,
                        purchase_exceptions. Frontend:
                        src/app/transactions/purchase/purchasebridge.ts.
    bank_cash_v1.py    -- Halaman Cash Payment & Cash Receipt. Tabel:
                        finance_transaction_bank_cash. Frontend:
                        bankCashBridge.ts.
    other_v1.py        -- Halaman Other (jurnal umum di luar Purchase/Bank
                        & Cash). Tabel: finance_transaction_other.
                        Frontend: otherBridge.ts.
    profit_loss_v1.py  -- Halaman Profit & Loss: anggaran P&L (budget) &
                        insight P&L. Tabel: PLBudgetLine, PLInsight
                        (lihat db_client.py).
    cash_flow_v1.py    -- Halaman Cash Flow: proyeksi arus kas bulanan.
                        Tabel: CashFlowForecastRow (lihat db_client.py).

Dipindah apa adanya dari main.py, TIDAK diubah auth (masih
Depends(auth.get_current_user) / Depends(auth.require_level(3)) dari
modules/auth/core.py, BUKAN get_current_user_v1) maupun bentuk
response-nya (masih response_model Pydantic langsung, BUKAN amplop
{status,message,data,errors}) supaya frontend tidak perlu diubah sama
sekali.

Path endpoint TETAP seperti semula: purchase_v1.py, bank_cash_v1.py, &
other_v1.py pakai /api/v1/transaction/... (bukan /api/v1/finance/purchase/
dsb), sedangkan profit_loss_v1.py & cash_flow_v1.py pakai
/api/v1/finance/... (mengikuti path lama masing-masing di main.py) --
sama seperti modules/asset/, nama folder cuma soal organisasi kode,
tidak perlu ikut nama URL lama. Karena path di file lama SUDAH pakai
konvensi v1, pemindahan ini MENGHAPUS registrasi lama di main.py (bukan
cuma menambah yang baru) -- kalau tidak, akan ada 2 handler bentrok di
path yang sama.

Catatan lintas-modul:
- VendorSkema didefinisikan di purchase_v1.py tapi DIPAKAI ULANG oleh
  modul Accounts Payable (DataAPResponse di main.py, karena Vendor & Bill
  dipakai ulang dari Purchase) -- main.py meng-import VendorSkema dari
  modules.finance.purchase_v1, BUKAN mendefinisikan ulang.
- bank_cash_v1.py punya salinan sendiri _map_status_frontend_ke_backend
  (sama persis isinya dengan yang di main.py) karena endpoint
  jurnal-posting umum (/api/client/{id}/jurnal-posting/{id}, bagian
  modul Transaction umum yang BELUM dipindah) juga masih memakainya di
  main.py. Kalau nanti modul Transaction umum ikut dipindah (mis. ke
  modules/transactions/), pindahkan definisi aslinya ke sana dan cukup
  di-import dari sini supaya tidak dobel.
- Accounts Receivable (AR) & Accounts Payable (AP) SENGAJA belum
  dipindah ke sini walau path-nya /api/v1/finance/... -- itu beda
  domain (Finance grup sidebar Reports/AR-AP), belum diminta dipindah.

Kewajiban pajak (PPN/PPh) TIDAK termasuk di sini -- itu dihitung dari
jurnal transaksi (taxBridge.ts di frontend).
"""

from .purchase_v1 import router as purchase_router  # noqa: F401
from .bank_cash_v1 import router as bank_cash_router  # noqa: F401
from .other_v1 import router as other_router  # noqa: F401
from .profit_loss_v1 import router as profit_loss_router  # noqa: F401
from .cash_flow_v1 import router as cash_flow_router  # noqa: F401