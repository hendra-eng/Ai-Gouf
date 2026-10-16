"""
modules/assets_and_equity/
============================
Fitur domain "Assets & Equity" (grup sidebar: Fixed Assets, Inventory,
Liabilities, Equity). Tabel grup ini memakai awalan `asset_`.

    fixed_assets_v1.py -- Fixed Assets: kategori, register, penyusutan
                          bulanan, disposal, jurnal FA (sumber GL
                          "fixed_asset"), laporan. /api/v1/asset/fixed-assets/...
                          Tabel asset_fixed_asset_* + asset_fixed_assets
                          (migrations/39-create_fixed_asset_tables.py).
    inventory_v1.py    -- Inventory: gudang, kategori, item, dokumen stok
                          (opening/receipt/issue/adjustment/transfer), kartu
                          stok rata-rata bergerak, jurnal INV (sumber GL
                          "inventory"), laporan. /api/v1/asset/inventory/...
                          Tabel asset_inventory_* (migrations/40-*.py).

Semua endpoint memakai get_current_user_v1 / _require_level_v1 dan amplop
{status, message, data, errors} (modules/api_response.py), sama dengan
modul Cash & Bank / AR-AP.
"""

from .fixed_assets_v1 import router  # noqa: F401
