"""
Import COA dari file Excel (COA_Sewa_Scaffolding.xlsx) ke client_id=3.

Cara pakai:
    1. Taruh file ini DAN COA_Sewa_Scaffolding.xlsx di folder backend/
       (sejajar db_client.py).
    2. Jalankan: python import_coa_client3.py
"""

from dotenv import load_dotenv
load_dotenv()

import openpyxl
import db_client

CLIENT_ID = 3
FILE_COA = "COA_Sewa_Scaffolding.xlsx"

wb = openpyxl.load_workbook(FILE_COA, data_only=True)
ws = wb["COA"]

rows = list(ws.iter_rows(values_only=True))
header = [str(h).strip() if h else "" for h in rows[0]]

idx = {h: i for i, h in enumerate(header)}

berhasil = 0
gagal = 0
for row in rows[1:]:
    if row[idx["Account No."]] is None:
        continue
    no_akun = str(row[idx["Account No."]]).strip()
    nama_akun = str(row[idx["Account Name"]]).strip()
    kategori = row[idx["Class"]]
    normal_saldo = row[idx["Normal Balance"]]
    keterangan = row[idx["Notes"]]

    ok = db_client.tambah_akun_coa(
        client_id=CLIENT_ID,
        no_akun=no_akun,
        nama_akun=nama_akun,
        kategori=kategori,
        normal_saldo=normal_saldo,
        keterangan=keterangan,
    )
    if ok:
        berhasil += 1
        print(f"✅ {no_akun} - {nama_akun}")
    else:
        gagal += 1
        print(f"❌ Gagal: {no_akun} - {nama_akun}")

print(f"\nSelesai. Berhasil: {berhasil}, Gagal: {gagal}")