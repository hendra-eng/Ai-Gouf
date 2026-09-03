"""
buat_tabel_awal.py
===================
Jalankan file ini SEKALI setelah DATABASE_URL di .env sudah diarahkan
ke project Supabase yang baru, untuk membuat semua tabel yang
didefinisikan di db_client.py (termasuk kolom profil client yang baru:
industry, status, assigned_accountant, contact_name, npwp, address).

Cara pakai:
    cd backend
    python buat_tabel_awal.py

Aman dijalankan berkali-kali -- create_all() hanya membuat tabel yang
BELUM ada, tidak akan menghapus/menimpa tabel yang sudah ada.

CATATAN: kalau tabel `clients` sudah pernah dibuat SEBELUM kolom baru
ini ditambahkan ke model, create_all() TIDAK akan menambahkan kolom
baru ke tabel yang sudah ada (SQLAlchemy create_all cuma bikin tabel
yang belum ada, bukan ALTER TABLE). Kalau itu terjadi, jalankan ALTER
TABLE manual di SQL Editor Supabase:

    ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS status TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS assigned_accountant TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS npwp TEXT;
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS address TEXT;
"""

from dotenv import load_dotenv
from pathlib import Path

_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

if not _ENV_PATH.exists():
    print(f"[PERINGATAN] File .env tidak ditemukan di: {_ENV_PATH}")
    print("DATABASE_URL kemungkinan akan pakai default (sqlite lokal), bukan Supabase.")

import db_client as dbc  # noqa: E402  (import setelah load_dotenv, wajib)

print(f"Memakai DATABASE_URL: {dbc.DATABASE_URL.split('@')[-1] if '@' in dbc.DATABASE_URL else dbc.DATABASE_URL}")

if dbc.cek_koneksi():
    print("[OK] Koneksi database berhasil.")
else:
    print("[GAGAL] Tidak bisa connect ke database. Cek DATABASE_URL di .env.")
    raise SystemExit(1)

print("Membuat semua tabel (kalau belum ada)...")
dbc.init_db()
print("[SELESAI] Semua tabel sudah siap di database.")
