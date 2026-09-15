"""
buat_admin_awal.py
===================
Bikin 1 user role tahap_5 (Partner/Admin) langsung ke database.

Kenapa perlu script terpisah: endpoint POST /api/v1/auth/register
sengaja dibatasi HANYA bisa dipanggil oleh user yang SUDAH login
sebagai tahap_5 (lihat modules/auth/v1.py) -- jadi untuk user
tahap_5 PERTAMA (belum ada siapa-siapa di tabel users), tidak ada
token untuk memanggil endpoint itu. Script ini yang membuka jalan
pertama kali; setelah itu, tahap_5 baru boleh dibuat lewat endpoint
/api/v1/auth/register seperti biasa.

Cara pakai:
    cd backend
    python buat_admin_awal.py --username admin --nama "Nama Admin"

Password diminta lewat prompt tersembunyi (tidak ikut ke shell
history). Aman dijalankan berkali-kali -- kalau username sudah ada,
script berhenti tanpa mengubah apa pun.
"""

import argparse
import getpass

from dotenv import load_dotenv
from pathlib import Path

_ENV_PATH = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)

import db_client as dbc  # noqa: E402  (import setelah load_dotenv, wajib)
from modules import auth  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description="Buat user tahap_5 (Partner/Admin) pertama di database.")
    parser.add_argument("--username", required=True, help="Username login, mis. admin")
    parser.add_argument("--nama", default=None, help="Nama lengkap (opsional, untuk tampilan)")
    args = parser.parse_args()

    print(f"Memakai DATABASE_URL: {dbc.DATABASE_URL.split('@')[-1] if '@' in dbc.DATABASE_URL else dbc.DATABASE_URL}")

    if not dbc.cek_koneksi():
        print("[GAGAL] Tidak bisa connect ke database. Cek DATABASE_URL di .env.")
        raise SystemExit(1)

    if dbc.get_user_by_username(args.username):
        print(f"[BATAL] Username '{args.username}' sudah ada di database. Tidak ada yang diubah.")
        raise SystemExit(1)

    password = getpass.getpass("Password (min. 8 karakter): ")
    if len(password) < 8:
        print("[GAGAL] Password minimal 8 karakter.")
        raise SystemExit(1)
    konfirmasi = getpass.getpass("Ulangi password: ")
    if password != konfirmasi:
        print("[GAGAL] Password & konfirmasi tidak sama.")
        raise SystemExit(1)

    hashed = auth.hash_password(password)
    berhasil = dbc.create_user(
        username=args.username,
        password_hash=hashed,
        role="tahap_5",
        nama=args.nama,
    )
    if not berhasil:
        print("[GAGAL] create_user mengembalikan False (lihat log error di atas).")
        raise SystemExit(1)

    print(f"[SELESAI] User '{args.username}' (role tahap_5) berhasil dibuat.")
    print("Login lewat POST /api/v1/auth/login untuk dapat JWT token.")


if __name__ == "__main__":
    main()
