"""
fix_users_table.py
===================
Script SEKALI PAKAI untuk memperbaiki tabel 'users' yang sudah terlanjur
dibuat dari versi kode lama (belum punya kolom 'diperbarui_at').

Kenapa perlu ini:
    init_db() di db_client.py pakai Base.metadata.create_all(engine),
    yang HANYA membuat tabel baru kalau belum ada -- tidak akan menambah
    kolom baru ke tabel yang sudah eksis. Jadi kalau tabel 'users' sudah
    dibuat sebelum kolom 'diperbarui_at' ada di kode, kolom itu perlu
    ditambahkan manual lewat ALTER TABLE.

CARA PAKAI:
    1. Taruh file ini SEJAJAR dengan db_client.py (folder yang sama)
    2. Jalankan sekali saja:
           python fix_users_table.py
    3. Setelah berhasil, jalankan lagi seed_users.py seperti biasa.
    4. File ini boleh dihapus setelah dipakai (tidak perlu disimpan
       jangka panjang).
"""

import sys
from pathlib import Path

# File ini ada di backend/scripts/, tapi db_client.py ada di backend/ (satu
# level di atas) -- tambahkan folder backend/ ke sys.path supaya import di
# bawah ini bisa ketemu, apapun folder aktif saat script dijalankan.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import db_client as dbc
from sqlalchemy import text, inspect


def main() -> None:
    if not dbc.cek_koneksi():
        print("❌ Database tidak aktif / tidak bisa dihubungi.")
        sys.exit(1)

    print("✅ Koneksi database OK.\n")

    inspector = inspect(dbc.engine)

    if "users" not in inspector.get_table_names():
        print("ℹ️  Tabel 'users' belum ada sama sekali -- akan dibuat "
              "otomatis lewat init_db(), tidak perlu perbaikan manual.")
        dbc.init_db()
        print("✅ Tabel 'users' berhasil dibuat dengan skema terbaru.")
        return

    existing_columns = {col["name"] for col in inspector.get_columns("users")}
    print(f"Kolom yang ADA sekarang di tabel 'users': {sorted(existing_columns)}\n")

    # Kolom yang WAJIB ada sesuai model User di db_client.py
    required_columns = {
        "diperbarui_at": "TIMESTAMP",
    }

    missing = {name: coltype for name, coltype in required_columns.items()
               if name not in existing_columns}

    if not missing:
        print("✅ Semua kolom yang dibutuhkan sudah ada. Tidak perlu perbaikan.")
        return

    print(f"⚠️  Kolom yang HILANG: {list(missing.keys())}")
    print("Menambahkan kolom yang hilang...\n")

    with dbc.engine.connect() as conn:
        for col_name, col_type in missing.items():
            try:
                conn.execute(text(
                    f'ALTER TABLE users ADD COLUMN IF NOT EXISTS '
                    f'{col_name} {col_type}'
                ))
                conn.commit()
                print(f"✅ Kolom '{col_name}' berhasil ditambahkan.")
            except Exception as e:
                print(f"❌ Gagal menambahkan kolom '{col_name}': {e}")
                sys.exit(1)

    print("\n✅ Selesai! Sekarang jalankan lagi: python seed_users.py")


if __name__ == "__main__":
    main()