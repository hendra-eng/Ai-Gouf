"""
migrations/create_financial_transaction_journal_entry_tables.py
=================================================================
Membuat 4 tabel fitur "Transactions > Journal Entry" (DDL: root/ddl-table,
bagian "FITUR TRANSACTIONS > JOURNAL ENTRY") -- menampung data yang
sekarang masih mock/local state di halaman src/app/transactions/
journal-entry/*:

    1. financial_transaction_journal_entry_source_records
    2. financial_transaction_journal_entry_drafts
    3. financial_transaction_journal_entry_draft_lines
    4. financial_transaction_journal_entry_activity_log

Urutan CREATE TABLE di atas WAJIB (bukan cuma penomoran) -- tabel 2-4
punya FOREIGN KEY ke tabel sebelumnya (drafts -> source_records,
draft_lines -> drafts, activity_log -> drafts), jadi tabel yang
direferensikan harus sudah ada duluan.

`financial_transaction_journal_entry_drafts.journal_entry_id` mereferensi
`journal_entries(id)` (Accounting Core V2, native journal header) --
tabel itu HARUS sudah ada lebih dulu (lihat migrations/
migrate_accounting_core_v2.py). Kalau belum pernah dijalankan, jalankan
migrasi Accounting Core V2 itu dulu sebelum migration ini.

client_id di SELURUH 4 tabel reference ke management_users(id_user)
(BUKAN management_clients ataupun clients lama) -- pola sama persis
dengan 6 tabel financial_transaction_sales_* (lihat catatan di ORM model,
db_client.py).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS
lewat ORM, tabel yang sudah ada di-skip, tidak ada data yang
dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\create_financial_transaction_journal_entry_tables.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
    """CREATE TABLE IF NOT EXISTS lewat ORM, supaya index/constraint/kolom
    ikut dibuat persis seperti definisi model."""
    if _tabel_ada(connection, table_name):
        print(f"⏭️  Tabel '{table_name}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{table_name}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel financial_transaction_journal_entry_* (Transactions > Journal Entry)")
    print("=" * 60)

    from db_client import (
        JournalEntrySourceRecord,
        JournalEntryDraft,
        JournalEntryDraftLine,
        JournalEntryActivityLog,
    )

    urutan_tabel = [
        ("financial_transaction_journal_entry_source_records", JournalEntrySourceRecord),
        ("financial_transaction_journal_entry_drafts", JournalEntryDraft),
        ("financial_transaction_journal_entry_draft_lines", JournalEntryDraftLine),
        ("financial_transaction_journal_entry_activity_log", JournalEntryActivityLog),
    ]

    hasil = {}
    with engine.connect() as connection:
        for nama_tabel, orm_class in urutan_tabel:
            hasil[f"buat tabel {nama_tabel}"] = _buat_tabel_jika_belum_ada(connection, nama_tabel, orm_class)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
