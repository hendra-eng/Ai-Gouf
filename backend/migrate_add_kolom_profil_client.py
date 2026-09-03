"""
Migration: tambah kolom profil client (nomor_wa, email, industry, status,
assigned_accountant, contact_name, npwp, address) ke tabel `clients`.

Kenapa perlu ini:
Model Client di db_client.py sudah mendefinisikan kolom-kolom profil di
atas (dipakai halaman Clients di dashboard supaya data tersimpan permanen,
bukan cuma di localStorage), tapi kolom itu belum pernah benar-benar
dibuat di database yang sedang kamu pakai -- init_db() / create_all()
HANYA membuat tabel yang belum ada, TIDAK meng-ALTER tabel yang sudah
ada. Akibatnya setiap kali tambah client, INSERT ke kolom yang tidak
ada ini gagal (error "no such column" / "UndefinedColumn"), request
di-rollback, dan client yang baru ditambahkan tidak pernah benar-benar
tersimpan -- makanya hilang lagi tiap project dibuka ulang.

Aman dijalankan berkali-kali (idempotent) -- kolom yang sudah ada akan
dilewati begitu saja.

Cara pakai (dari folder backend, venv aktif):
    python migrate_add_kolom_profil_client.py

Kalau DATABASE_URL tidak diset di .env, script ini otomatis memakai
database SQLite lokal (sqlite:///ai_gouf.db) -- sama seperti default
di db_client.py -- supaya kolom ditambahkan ke database yang benar-benar
dipakai backend saat ini.
"""
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect

_DIR_INI = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_DIR_INI, ".env"))

# Definisi kolom yang wajib ada di tabel `clients`, harus persis sama
# dengan class Client di db_client.py. Tipe SQL ditulis dalam bentuk
# yang valid baik di SQLite maupun PostgreSQL/Supabase.
KOLOM_WAJIB = [
    ("nomor_wa", "VARCHAR(30)"),
    ("email", "VARCHAR(200)"),
    ("industry", "VARCHAR(100)"),
    ("status", "VARCHAR(30)"),
    ("assigned_accountant", "VARCHAR(200)"),
    ("contact_name", "VARCHAR(200)"),
    ("npwp", "VARCHAR(30)"),
    ("address", "TEXT"),
]


def main():
    database_url = os.environ.get("DATABASE_URL", "sqlite:///ai_gouf.db")
    print(f"Memakai database: {database_url.split('@')[-1] if '@' in database_url else database_url}")

    engine = create_engine(database_url, echo=False)
    inspector = inspect(engine)

    if "clients" not in inspector.get_table_names():
        print("[GAGAL] Tabel 'clients' tidak ditemukan di database ini. "
              "Jalankan buat_tabel_awal.py dulu untuk membuat tabelnya.")
        sys.exit(1)

    kolom_sekarang = {k["name"] for k in inspector.get_columns("clients")}
    kolom_kurang = [(nama, tipe) for nama, tipe in KOLOM_WAJIB if nama not in kolom_sekarang]

    if not kolom_kurang:
        print("[LEWATI] Semua kolom profil client sudah ada. Tidak ada yang perlu dilakukan.")
        return

    print(f"Menambahkan {len(kolom_kurang)} kolom yang hilang ke tabel 'clients': "
          f"{', '.join(nama for nama, _ in kolom_kurang)} ...")

    with engine.begin() as conn:
        for nama, tipe in kolom_kurang:
            conn.execute(text(f"ALTER TABLE clients ADD COLUMN {nama} {tipe}"))
            print(f"  [OK] Kolom '{nama}' ditambahkan.")

    print("[SUKSES] Semua kolom profil client sudah lengkap. "
          "Silakan restart backend lalu coba tambah client lagi.")


if __name__ == "__main__":
    main()