"""
modules/transactions/__init__.py
==================================
Paket "transactions" -- fitur REST API standar (/api/v1/transactions/...)
untuk tabel-tabel transaksi di root/ddl-table, mengikuti pola yang sama
dengan modules/auth/ dan modules/management/ (lihat modules/auth/v1.py):

    - Routing versi: /api/v1/transactions/[fitur]
    - Response pakai amplop standar {status, message, data, errors}
      (modules/api_response.py)
    - Autentikasi JWT ditegakkan lewat middleware yang SAMA dengan
      modules/auth/v1.py::jwt_v1_middleware (mengunci SELURUH grup
      /api/v1/**), jadi tidak perlu middleware terpisah untuk paket ini.

    modules/transactions/sales_v1.py -- CRUD 6 tabel
    financial_transaction_sales_* (fitur Transactions > Sales).
    modules/transactions/sales_import_v1.py -- upload file + ekstraksi
    otomatis pakai Sales Import Template (lihat root/
    SALES_IMPORT_TEMPLATES.md).
"""

from . import sales_v1  # noqa: F401
from . import sales_import_v1  # noqa: F401
