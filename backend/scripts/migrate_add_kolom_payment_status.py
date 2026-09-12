"""
scripts/migrate_add_kolom_payment_status.py

Migrasi ALTER TABLE untuk database yang SUDAH ADA.

Menambahkan 2 kolom ke tabel jurnal_posting yang sudah ada di model
JurnalPosting (modules/db_client.py) tapi tidak akan otomatis muncul di
database lama -- Base.metadata.create_all(engine) (dipanggil saat startup)
HANYA membuat tabel yang belum ada sama sekali, TIDAK menambah kolom baru
ke tabel yang sudah ada.

Tanpa migrasi ini, SETIAP query ke jurnal_posting (termasuk yang dipakai
halaman Transaksi utama untuk menampilkan hasil import) langsung gagal
dengan:
    sqlite3.OperationalError: no such column: jurnal_posting.payment_status
-- backend menangkap error ini diam-diam dan mengembalikan list kosong,
sehingga halaman Transaksi selalu jatuh ke data contoh statis walau data
asli sudah berhasil tersimpan di tabel lain (hasil upload/dedup).

Kolom yang ditambahkan (semua nullable, aman untuk data lama):
  - payment_status  VARCHAR(20)  -- status pembayaran (mis. 'Lunas', 'Belum Lunas')
  - paid_amount     FLOAT        -- nominal yang sudah dibayar

Idempotent: aman dijalankan berkali-kali, kolom yang sudah ada dilewati.

Cara pakai:
    python scripts/migrate_add_kolom_payment_status.py
"""
from __future__ import annotations

import sys

from sqlalchemy import inspect, text

from db_client import engine


KOLOM_BARU = [
    ("payment_status", "VARCHAR(20)"),
    ("paid_amount", "FLOAT"),
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

    print("\nMigrasi selesai. Kolom jurnal_posting sekarang lengkap untuk payment_status/paid_amount.")


if __name__ == "__main__":
    try:
        jalankan_migrasi()
    except Exception as e:
        print(f"Migrasi GAGAL: {e}", file=sys.stderr)
        sys.exit(1)