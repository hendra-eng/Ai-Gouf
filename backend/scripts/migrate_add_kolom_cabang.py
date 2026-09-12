"""
scripts/migrate_add_kolom_cabang.py

[BARU - filter Cabang Financial Overview] Migrasi ALTER TABLE untuk
database yang SUDAH ADA.

Menambahkan kolom `cabang` ke tabel `coa` (model Coa di modules/db_client.py)
supaya bisa dipakai memfilter angka Financial Overview (KPIBentoGrid.tsx)
per cabang/lokasi, tanpa Base.metadata.create_all(engine) otomatis
menambahkannya ke database lama.

Kolom yang ditambahkan (nullable, aman untuk data lama -- akun lama tanpa
cabang otomatis dianggap milik SEMUA cabang, tidak ada data yang hilang):
  - cabang  VARCHAR(100)  -- tag cabang/lokasi per akun, opsional

Idempotent: aman dijalankan berkali-kali, kolom yang sudah ada dilewati.

Cara pakai:
    python scripts/migrate_add_kolom_cabang.py
"""
from __future__ import annotations

import sys

from sqlalchemy import inspect, text

from db_client import engine


KOLOM_BARU = [
    ("cabang", "VARCHAR(100)"),
]

TABEL = "coa"


def kolom_sudah_ada(nama_kolom: str) -> bool:
    inspector = inspect(engine)
    if TABEL not in inspector.get_table_names():
        return False
    kolom_ada = {c["name"] for c in inspector.get_columns(TABEL)}
    return nama_kolom in kolom_ada


def jalankan_migrasi() -> None:
    inspector = inspect(engine)
    if TABEL not in inspector.get_table_names():
        print(f"Tabel '{TABEL}' belum ada -- tidak ada yang perlu dimigrasikan "
              f"(akan dibuat otomatis dengan skema baru saat aplikasi start).")
        return

    with engine.begin() as conn:
        for nama_kolom, tipe_sql in KOLOM_BARU:
            if kolom_sudah_ada(nama_kolom):
                print(f"Kolom '{TABEL}.{nama_kolom}' sudah ada -- dilewati.")
                continue
            print(f"Menambahkan kolom '{TABEL}.{nama_kolom}' ({tipe_sql})...")
            conn.execute(text(f"ALTER TABLE {TABEL} ADD COLUMN {nama_kolom} {tipe_sql}"))
            print(f"  -> selesai.")

    print("Migrasi kolom cabang selesai.")


if __name__ == "__main__":
    try:
        jalankan_migrasi()
    except Exception as e:
        print(f"Migrasi GAGAL: {e}", file=sys.stderr)
        sys.exit(1)
