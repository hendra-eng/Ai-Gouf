"""
migrate_add_kolom_saldo_awal_lawan_unit.py

Migrasi idempoten: menambah 2 kolom baru ke tabel `coa` --
lawan_transaksi_saldo_awal dan project_unit_saldo_awal.

Kenapa perlu migrasi manual: Base.metadata.create_all() (dipakai saat
startup) HANYA membuat tabel yang belum ada, tidak menambah kolom baru
ke tabel yang sudah ada -- jadi database lama (yang sudah punya tabel
`coa`) perlu di-ALTER manual sekali ini.

Kolom ini dipakai sheet "Neraca Saldo Awal" pada export laporan
keuangan supaya kolom "Lawan Transaksi" & "Project/Asset Unit" bisa
diisi berbeda-beda per akun (mis. akun excavator vs akun modal per
pemilik), bukan lagi hardcode "Pemilik"/"HO" untuk semua akun.

Jalankan sekali dari folder backend:
    python migrate_add_kolom_saldo_awal_lawan_unit.py
"""
import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, text, inspect

# [FIX] Sama seperti main.py -- DATABASE_URL cuma kebaca kalau
# load_dotenv() dipanggil DULU, sebelum baca os.environ. Path .env
# dihitung dari lokasi file INI SENDIRI (bukan dari cwd) supaya tetap
# ketemu mau script dijalankan dari folder mana pun.
try:
    from dotenv import load_dotenv
    _ENV_PATH = Path(__file__).resolve().parent / ".env"
    load_dotenv(dotenv_path=_ENV_PATH)
except ImportError:
    print("[PERINGATAN] python-dotenv tidak terpasang -- .env tidak dibaca, "
          "DATABASE_URL harus di-set manual lewat environment variable.")


def get_database_url() -> str:
    return os.environ.get("DATABASE_URL", "sqlite:///ai_gouf.db")


KOLOM_BARU = {
    "lawan_transaksi_saldo_awal": "VARCHAR(100)",
    "project_unit_saldo_awal": "VARCHAR(100)",
}


def main() -> None:
    database_url = get_database_url()
    print(f"Menyambung ke: {database_url}")
    if database_url.startswith("sqlite"):
        print("[PERINGATAN] Ini fallback SQLite lokal, bukan DATABASE_URL "
              "dari .env -- kemungkinan .env tidak ketemu/tidak kebaca. "
              "Pastikan file .env ada di folder yang sama dengan script ini "
              "dan berisi baris DATABASE_URL=... (Supabase).")
    engine = create_engine(database_url, echo=False)

    inspector = inspect(engine)
    if "coa" not in inspector.get_table_names():
        print("Tabel 'coa' belum ada -- tidak ada yang perlu dimigrasi "
              "(kolom akan otomatis ada saat tabel dibuat pertama kali).")
        return

    kolom_sekarang = {c["name"] for c in inspector.get_columns("coa")}

    with engine.begin() as conn:
        for nama_kolom, tipe_sql in KOLOM_BARU.items():
            if nama_kolom in kolom_sekarang:
                print(f"[LEWATI] Kolom '{nama_kolom}' sudah ada di tabel coa.")
                continue
            print(f"[TAMBAH] Menambah kolom '{nama_kolom}' ({tipe_sql}) ke tabel coa ...")
            conn.execute(text(f"ALTER TABLE coa ADD COLUMN {nama_kolom} {tipe_sql}"))
            print(f"[OK] Kolom '{nama_kolom}' berhasil ditambahkan.")

    print("Migrasi selesai.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"Migrasi GAGAL: {e}")
        sys.exit(1)