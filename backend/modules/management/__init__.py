"""
modules/management/
====================
Kumpulan fitur domain "Management" (grup sidebar: Reports, Clients,
Documents) lewat REST API standar /api/v1/management/...

Setiap fitur di folder ini punya file sendiri, mengikuti pola yang sama
dengan modules/auth/v1.py (APIRouter + amplop response {status,message,
data,errors} dari modules/api_response.py + autentikasi lewat
get_current_user_v1 dari modules/auth/v1.py). Autentikasi JWT ditegakkan
lewat middleware yang SAMA dengan modules/auth/v1.py::jwt_v1_middleware
(mengunci SELURUH grup /api/v1/**, bukan cuma /api/v1/auth/), jadi tidak
perlu middleware terpisah untuk paket ini.

    clients_v1.py   -- CRUD management_clients (tabel management_* di
                        root/ddl-table)
    documents_v1.py -- Documents (upload/list/ubah status dokumen)
    reports_v1.py   -- Reports (registry laporan + jadwal laporan berkala)
"""

from . import clients_v1  # noqa: F401
