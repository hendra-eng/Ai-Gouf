"""
seed_users.py
=============
Buat 5 akun login, satu untuk tiap tahapan (tahap_1 s/d tahap_5).

Untuk SEKARANG kelimanya akan bisa akses semua fitur yang sama persis
(belum ada pembatasan konten per tahap) -- itu memang ditentukan lewat
kode di app.py/auth.py, bukan lewat script ini. Begitu kamu sudah
tentukan tahap mana yang boleh akses apa, kode gating-nya menyusul
(pakai auth.require_stage(n)).

CARA PAKAI:
    1. Pastikan database (Postgres) aktif & bisa diakses dari db_client.py
    2. (Opsional) Edit dict USERNAMES / variabel PASSWORD di bawah kalau
       mau username atau password beda dari default
    3. Jalankan sekali saja:
           python seed_users.py
    4. Kelima akun akan dibuat dengan password yang SAMA (lihat PASSWORD
       di bawah). Kalau mau ganti username/password nanti, ganti di sini
       lalu jalankan ulang -- user yang sudah ada otomatis dilewati
       (skip), tidak akan ditimpa/dobel.
"""

import io
import os
import sys

# Paksa stdout/stderr pakai UTF-8, supaya print() dengan emoji (✅/❌/dst)
# tidak crash di Windows (PowerShell/cmd default-nya cp1252), termasuk saat
# output di-redirect ke file (mis. `python seed_users.py > hasil.txt 2>&1`).
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
for _stream_name in ("stdout", "stderr"):
    _stream = getattr(sys, _stream_name)
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    else:
        # Fallback untuk stream lama yang tidak punya reconfigure()
        setattr(
            sys,
            _stream_name,
            io.TextIOWrapper(_stream.buffer, encoding="utf-8", errors="replace"),
        )

from pathlib import Path

# File ini ada di backend/scripts/, tapi db_client.py & modules/ ada di
# backend/ (satu level di atas) -- tambahkan folder backend/ ke sys.path
# supaya import di bawah ini bisa ketemu, apapun folder aktif saat script
# dijalankan.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from modules import auth
import db_client as dbc

# ============================================================
# EDIT DI SINI KALAU MAU USERNAME / PASSWORD BEDA
# ============================================================
USERNAMES = {
    "tahap_1": "junior_staff",
    "tahap_2": "senior_staff",
    "tahap_3": "supervisor",
    "tahap_4": "manager",
    "tahap_5": "partner",
}

# Password yang sama untuk semua akun (biar gampang diingat/dibagikan).
PASSWORD = "Denpasar 123"


def main() -> None:
    if not dbc.cek_koneksi():
        print("❌ Database tidak aktif / tidak bisa dihubungi. "
              "Pastikan Postgres jalan & koneksi di db_client.py sudah benar.")
        sys.exit(1)

    print("Memastikan tabel database (termasuk tabel 'users') sudah dibuat...")
    try:
        dbc.init_db()
    except Exception as e:
        print(f"❌ Gagal membuat/memastikan tabel database: {e}")
        sys.exit(1)
    print("✅ Tabel siap.\n")

    print("=" * 60)
    print("MEMBUAT AKUN PER TAHAP")
    print("=" * 60)

    dibuat = []
    for role_code, username in USERNAMES.items():
        existing = dbc.get_user_by_username(username)
        if existing:
            print(f"⏭️  Skip '{username}' — sudah ada di database (role: {existing.get('role')}).")
            continue

        password_hash = auth.hash_password(PASSWORD)
        nama = auth.role_label(role_code)

        ok = dbc.create_user(username, password_hash, role_code, nama)
        if ok:
            dibuat.append((username, role_code))
            print(f"✅ Dibuat: {username}  (role: {role_code})")
        else:
            print(f"❌ Gagal membuat '{username}' (cek log db_client untuk detail).")

    if dibuat:
        print("\n" + "=" * 60)
        print("DAFTAR LOGIN (password sama untuk semua):")
        print("=" * 60)
        for username, role_code in dibuat:
            print(f"  {auth.role_label(role_code):<35} | username: {username:<14} | password: {PASSWORD}")
        print("=" * 60)
    else:
        print("\nTidak ada user baru yang dibuat (semua username sudah ada).")


if __name__ == "__main__":
    main()