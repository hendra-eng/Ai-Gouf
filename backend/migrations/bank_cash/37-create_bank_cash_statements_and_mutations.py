"""
migrations/bank_cash/37-create_bank_cash_statements_and_mutations.py
====================================================================
Membuat 2 tabel untuk Cash & Bank > Source Data:
  - financial_transaction_bank_cash_statements  (1 baris = 1 file rekening koran yang diimport)
  - financial_transaction_bank_cash_mutations   (1 baris = 1 mutasi / baris rekening koran)

Tabel dibuat dari ORM db_client.py (BankCashStatement / BankCashMutation).
Tabel template ikut dibuat lebih dulu kalau belum ada (dirujuk FK
statements.template_id). Kedua tabel ini JUGA dibuat oleh
migrations/34-create_bank_cash_tables.py (lengkap dengan CHECK constraint &
trigger kunci periode) -- kalau 34 sudah dijalankan, file ini cuma skip.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ada di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\bank_cash\\37-create_bank_cash_statements_and_mutations.py
"""

import sys
from pathlib import Path

# File ini ada di migrations/bank_cash/ -> _history ada di migrations/, db_client & .env di backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine


def _buat_tabel(connection, nama: str, orm_class) -> bool:
    if nama in inspect(connection).get_table_names():
        print(f"⏭️  Tabel '{nama}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{nama}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        if "already exists" in str(e).lower():
            print(f"⏭️  Tabel '{nama}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{nama}': {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel bank_cash_statements + bank_cash_mutations")
    print("=" * 60)

    from db_client import BankCashImportTemplate, BankCashMutation, BankCashStatement

    hasil = {}
    with engine.connect() as connection:
        # Urutan penting: statements -> FK template, mutations -> FK statements.
        for nama, orm in (
            ("financial_transaction_bank_cash_import_templates", BankCashImportTemplate),
            ("financial_transaction_bank_cash_statements", BankCashStatement),
            ("financial_transaction_bank_cash_mutations", BankCashMutation),
        ):
            hasil[f"tabel {nama}"] = _buat_tabel(connection, nama, orm)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<60}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
