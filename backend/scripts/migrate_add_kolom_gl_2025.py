"""
scripts/migrate_add_kolom_gl_2025.py

[BARU - fix GL 2025] Migrasi ALTER TABLE untuk database yang SUDAH ADA.

Menambahkan 3 kolom ke tabel jurnal_posting yang baru ditambahkan ke model
JurnalPosting (modules/db_client.py) tapi tidak akan otomatis muncul di
database lama -- Base.metadata.create_all(engine) (dipanggil saat startup)
HANYA membuat tabel yang belum ada sama sekali, TIDAK menambah kolom baru
ke tabel yang sudah ada. Tanpa migrasi ini, deploy fix ini ke database
produksi/dev yang sudah berjalan akan langsung error
"no such column: jurnal_posting.no_dokumen" dsb. begitu kode baru mencoba
membaca/menulis kolom tersebut.

Kolom yang ditambahkan (semua nullable, aman untuk data lama):
  - no_dokumen    VARCHAR(100)  -- No. Dokumen & Invoice/Referensi di sheet GL
  - project_unit  VARCHAR(100)  -- Project/Unit di sheet GL
  - jatuh_tempo   VARCHAR(20)   -- Jatuh Tempo di sheet GL

Idempotent: aman dijalankan berkali-kali, kolom yang sudah ada dilewati.

Cara pakai:
    python scripts/migrate_add_kolom_gl_2025.py
"""
from __future__ import annotations

import sys

from sqlalchemy import inspect, text

from modules.db_client import engine


KOLOM_BARU = [
    ("no_dokumen", "VARCHAR(100)"),
    ("project_unit", "VARCHAR(100)"),
    ("jatuh_tempo", "VARCHAR(20)"),
]

TABEL = "jurnal_posting"


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
                print(f"[LEWAT] Kolom '{nama_kolom}' sudah ada di '{TABEL}'.")
                continue
            print(f"[TAMBAH] ALTER TABLE {TABEL} ADD COLUMN {nama_kolom} {tipe_sql} ...")
            conn.execute(text(f"ALTER TABLE {TABEL} ADD COLUMN {nama_kolom} {tipe_sql}"))
            print(f"[SELESAI] Kolom '{nama_kolom}' berhasil ditambahkan.")

    print("\nMigrasi selesai. Kolom jurnal_posting sekarang lengkap untuk sheet GL 2025.")


if __name__ == "__main__":
    try:
        jalankan_migrasi()
    except Exception as e:
        print(f"Migrasi GAGAL: {e}", file=sys.stderr)
        sys.exit(1)