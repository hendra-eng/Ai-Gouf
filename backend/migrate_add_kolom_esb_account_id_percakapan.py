"""
Migration: tambah kolom esb_account_id ke tabel percakapan.

Kenapa perlu ini:
Model Percakapan di db_client.py (baris ~558) sudah mendefinisikan
`esb_account_id = Column(Integer, ForeignKey("esb_accounts.id"), nullable=True)`,
tapi kolom itu belum pernah benar-benar dibuat di database (migrasinya
belum pernah dijalankan) -- SQLAlchemy tetap generate query yang
menyebut kolom itu (karena definisi modelnya sudah ada), sehingga
muncul error:
    psycopg2.errors.UndefinedColumn: column percakapan.esb_account_id
    does not exist

Aman dijalankan berkali-kali (idempotent) -- kalau kolom sudah ada,
script ini tidak melakukan apa-apa, cukup lapor lalu keluar.

Cara pakai (dari folder backend, venv aktif):
    python migrate_add_kolom_esb_account_id_percakapan.py
"""
import os
import sys

from dotenv import load_dotenv
from sqlalchemy import create_engine, text, inspect

# .env ada satu folder di atas scripts/ (folder backend) -- muat dari situ,
# BUKAN dari cwd, supaya tetap benar dipanggil dari folder mana pun (sama
# seperti catatan di akuntansi_ai.py soal load_dotenv() harus dari dir
# file ini sendiri, bukan cwd, kalau tidak diam-diam jatuh ke sqlite).
_DIR_INI = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_DIR_INI, ".env"))


def main():
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("[GAGAL] DATABASE_URL tidak ditemukan di .env -- migrasi dibatalkan "
              "(tidak mau diam-diam jalan ke sqlite lokal).")
        sys.exit(1)

    engine = create_engine(database_url, echo=False)
    inspector = inspect(engine)

    if "percakapan" not in inspector.get_table_names():
        print("[GAGAL] Tabel 'percakapan' tidak ditemukan di database ini. "
              "Cek DATABASE_URL sudah menunjuk ke database yang benar.")
        sys.exit(1)

    kolom_sekarang = [k["name"] for k in inspector.get_columns("percakapan")]
    if "esb_account_id" in kolom_sekarang:
        print("[LEWATI] Kolom 'esb_account_id' sudah ada di tabel 'percakapan'. "
              "Tidak ada yang perlu dilakukan.")
        return

    print("Menambahkan kolom 'esb_account_id' ke tabel 'percakapan' ...")
    with engine.begin() as conn:
        # Cocok persis dengan definisi model: Integer, nullable, FK ke
        # esb_accounts.id. ON DELETE tidak diisi eksplisit di model
        # (default RESTRICT/NO ACTION di Postgres) -- dibiarkan sama di sini,
        # bukan ditambah ON DELETE CASCADE/SET NULL yang tidak diminta.
        conn.execute(text("""
            ALTER TABLE percakapan
            ADD COLUMN esb_account_id INTEGER
            REFERENCES esb_accounts(id)
        """))
        # Index di kolom FK -- praktik umum di Postgres (FK TIDAK otomatis
        # dapat index, beda dari primary key), supaya query
        # `WHERE esb_account_id = ...` / `IS NULL` (dipakai daftar_percakapan()
        # dgn jalur="client"/"esb_account") tidak full table scan begitu
        # tabel percakapan membesar.
        conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_percakapan_esb_account_id
            ON percakapan (esb_account_id)
        """))

    print("[SUKSES] Kolom 'esb_account_id' berhasil ditambahkan + index dibuat.")


if __name__ == "__main__":
    main()