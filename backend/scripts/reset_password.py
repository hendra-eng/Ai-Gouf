"""
reset_passwords.py
===================
Script SEKALI PAKAI untuk reset password kelima akun (tahap_1 s/d tahap_5)
ke password yang sama, tanpa perlu hapus & buat ulang user-nya.

Kenapa perlu ini:
    seed_users.py otomatis SKIP user yang sudah ada di database (supaya
    tidak menimpa data begitu saja). Kalau user-user itu ternyata sudah
    dibuat lebih dulu dengan password LAIN (bukan yang sekarang tertulis
    di seed_users.py), maka login dengan password baru akan selalu gagal
    -- padahal usernya memang ada.

    Script ini reset password user yang SUDAH ADA ke password baru,
    tanpa menyentuh data lain (role, nama, dll tetap sama).

CARA PAKAI:
    1. Taruh file ini SEJAJAR dengan db_client.py dan seed_users.py
    2. (Opsional) Edit PASSWORD_BARU di bawah kalau mau beda dari default
    3. Jalankan sekali saja:
           python reset_passwords.py
    4. Setelah selesai, coba login lagi dengan password baru itu.
    5. File ini boleh dihapus setelah dipakai.
"""

import sys
from pathlib import Path

# File ini ada di backend/scripts/, tapi db_client.py & modules/ ada di
# backend/ (satu level di atas) -- tambahkan folder backend/ ke sys.path
# supaya import di bawah ini bisa ketemu, apapun folder aktif saat script
# dijalankan.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules import auth
import db_client as dbc

# ============================================================
# EDIT DI SINI KALAU MAU PASSWORD BEDA
# ============================================================
USERNAMES = [
    "junior_staff",
    "senior_staff",
    "supervisor",
    "manager",
    "partner",
]

PASSWORD_BARU = "Denpasar 123"


def main() -> None:
    if not dbc.cek_koneksi():
        print("❌ Database tidak aktif / tidak bisa dihubungi.")
        sys.exit(1)

    print("✅ Koneksi database OK.\n")
    print("=" * 60)
    print("RESET PASSWORD UNTUK SEMUA AKUN")
    print("=" * 60)

    password_hash_baru = auth.hash_password(PASSWORD_BARU)

    berhasil = []
    gagal = []

    for username in USERNAMES:
        existing = dbc.get_user_by_username(username)
        if not existing:
            print(f"⚠️  User '{username}' TIDAK ditemukan di database -- dilewati "
                  f"(jalankan seed_users.py dulu kalau mau buat user ini).")
            gagal.append(username)
            continue

        ok = dbc.update_user_password(username, password_hash_baru)
        if ok:
            print(f"✅ Password '{username}' berhasil direset.")
            berhasil.append(username)
        else:
            print(f"❌ Gagal reset password '{username}' (cek log db_client).")
            gagal.append(username)

    print("\n" + "=" * 60)
    if berhasil:
        print("DAFTAR LOGIN TERBARU (password sama untuk semua):")
        print("=" * 60)
        for username in berhasil:
            print(f"  username: {username:<14} | password: {PASSWORD_BARU}")
    if gagal:
        print(f"\n⚠️  User yang GAGAL / tidak ditemukan: {gagal}")
    print("=" * 60)


if __name__ == "__main__":
    main()