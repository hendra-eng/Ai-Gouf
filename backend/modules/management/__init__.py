"""
modules/management/__init__.py
================================
Paket "management" -- fitur REST API standar (/api/v1/management/...)
untuk tabel-tabel management_* di root/ddl-table (management_clients,
dst), mengikuti pola yang sama dengan modules/auth/ (lihat
modules/auth/v1.py):

    - Routing versi: /api/v1/management/[fitur]
    - Response pakai amplop standar {status, message, data, errors}
      (modules/api_response.py)
    - Autentikasi JWT ditegakkan lewat middleware yang SAMA dengan
      modules/auth/v1.py::jwt_v1_middleware (mengunci SELURUH grup
      /api/v1/**, bukan cuma /api/v1/auth/), jadi tidak perlu middleware
      terpisah untuk paket ini.

    modules/management/clients_v1.py -- CRUD management_clients.
"""

from . import clients_v1  # noqa: F401
