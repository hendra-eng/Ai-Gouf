"""
modules/assets_and_equity/
============================
Kumpulan fitur domain "Assets & Equity" (grup sidebar: Assets,
Liabilities, Equity) lewat REST API /api/v1/asset/...:

    fixed_assets_v1.py -- Fixed Asset Register & Depreciation (tabel
                           asset_fixed_assets, schema 4_Assets_Equity),
                           khusus halaman Assets. Dipindah apa adanya
                           dari main.py, TIDAK diubah auth (masih
                           Depends(auth.get_current_user)
                           / Depends(auth.require_level(3)) dari
                           modules/auth/core.py, BUKAN get_current_user_v1)
                           maupun bentuk response-nya (masih response_model
                           Pydantic langsung, BUKAN amplop {status,message,
                           data,errors}) supaya frontend (assetRegisterBridge.ts)
                           tidak perlu diubah sama sekali.

Path endpoint TETAP /api/v1/asset/... (BUKAN /api/v1/assets_and_equity/...
atau /api/v1/assets-equity/...) -- nama folder cuma soal organisasi kode,
tidak perlu ikut nama URL lama.

Beda dengan modules/management/ & modules/overview/: karena path
/api/v1/asset/... di file lama SUDAH pakai konvensi v1 (bukan path
lama gaya /api/client/...), pemindahan ini MENGHAPUS registrasi lama di
main.py (bukan cuma menambah yang baru) -- kalau tidak, akan ada 2
handler bentrok di path yang sama. Perilaku (path, auth, response)
tetap identik, cuma lokasi kodenya yang pindah.

Catatan: KPI/grafik total Assets (useAssetsData.ts) TIDAK termasuk di
sini -- itu tetap dihitung dari saldo neraca/COA, bukan dari tabel
asset_fixed_assets. Liabilities & Equity BELUM punya file di sini --
kedua halaman itu masih murni dihitung di frontend (neracaBridge.ts +
TransactionsContext), belum ada tabel/endpoint backend khusus. Kalau
nanti dibuatkan, tambahkan file baru di folder ini (mis.
liabilities_v1.py, equity_v1.py) mengikuti pola yang sama.
"""

from .fixed_assets_v1 import router  # noqa: F401