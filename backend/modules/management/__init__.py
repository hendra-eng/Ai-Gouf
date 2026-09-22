"""
modules/management/
====================
Kumpulan fitur domain "Management" (grup sidebar: Reports, Clients,
Documents) lewat REST API standar /api/v1/management/...

Setiap fitur di folder ini punya file sendiri, mengikuti pola yang sama
dengan modules/auth/v1.py (APIRouter + amplop response {status,message,
data,errors} dari modules/api_response.py + autentikasi lewat
get_current_user_v1 dari modules/auth/v1.py):

    documents_v1.py -- Documents (upload/list/ubah status dokumen)
    reports_v1.py   -- Reports (registry laporan + jadwal laporan berkala)

Catatan: kalau folder ini juga berisi clients_v1.py (fitur Clients) dari
kontributor lain, file itu HARUS mengikuti pola yang sama supaya semua
fitur di /api/v1/management/** konsisten bentuknya.
"""