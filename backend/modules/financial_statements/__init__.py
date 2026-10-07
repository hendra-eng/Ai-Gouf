"""
modules/financial_statements/__init__.py
==========================================
Paket "financial_statements" -- REST API standar /api/v1/financial-statements/...
untuk halaman src/app/financial-statements/* (Laba Rugi, Neraca, Arus Kas,
Perubahan Ekuitas, CALK), pola sama dengan modules/transactions/.

    modules/financial_statements/core.py -- mesin hitung (tanpa DB).
    modules/financial_statements/v1.py   -- router endpoint.
    modules/financial_statements/general_ledger_v1.py -- report General Ledger
        (/api/v1/reports/general-ledger, halaman Reports > General Ledger).

    modules/financial_statements/mapped.py        -- mesin FS BERBASIS MAPPING COA
        (Task Plan 16-20: BS, P&L, Changes in Equity, Cash Flow, CALK).
    modules/financial_statements/fs_store.py      -- akses DB mapping & CALK.
    modules/financial_statements/statements_v1.py -- /api/v1/reports/financial-statements/...
    modules/financial_statements/fs_mapping_v1.py -- /api/v1/management/fs-mapping
    modules/financial_statements/calk_docx.py     -- export CALK ke Word.
    core.py + v1.py (mesin lama berbasis kata kunci nama akun) tetap dipakai
    Overview/Analytics/Budget.

Sumber datanya tabel fitur Transactions yang sudah POSTED (lihat
db_client.ambil_baris_jurnal_posted_transaksi).
"""

from . import v1  # noqa: F401
from . import general_ledger_v1  # noqa: F401
from . import statements_v1  # noqa: F401
from . import fs_mapping_v1  # noqa: F401
