"""
migrations/bank_cash/36-create_bank_cash_import_templates_and_bank_mappings.py
=============================================================================
Menambahkan 2 tabel BARU untuk tab "Source Data" Bank & Cash:

  - financial_transaction_bank_cash_import_templates : pola ekstraksi
    rekening koran / laporan kas (PDF/Excel/CSV) per klien. file_type 'Multi'
    = 1 baris yang membawa array mapping_rules->'variants' (1 varian per bank).
  - financial_transaction_bank_cash_bank_mappings    : mapping bank/rekening ->
    akun kas-bank COA klien (FK ke management_client_coa), opsional menunjuk
    template_id.

WAJIB dijalankan SEBELUM seed migrations/bank_cash/seed_template_*_bank_cash.sql
(seed mengisi kedua tabel ini). Urutan: 16 (COA) -> seed_coa_<kode> -> 36 (ini)
-> seed template bank cash.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ada di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\bank_cash\\36-create_bank_cash_import_templates_and_bank_mappings.py
"""

import sys
from pathlib import Path

# File ini ada di migrations/<subfolder>/ -> _history ada di migrations/, db_client & .env di backend/.
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


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
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
        connection.rollback()
        if "already exists" in str(e).lower():
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel bank_cash_import_templates + bank_cash_bank_mappings")
    print("=" * 60)

    from db_client import BankCashBankMapping, BankCashImportTemplate

    hasil = {}
    with engine.connect() as connection:
        # Urutan penting: bank_mappings punya FK ke import_templates.
        hasil["buat tabel financial_transaction_bank_cash_import_templates"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_bank_cash_import_templates", BankCashImportTemplate
        )
        hasil["buat tabel financial_transaction_bank_cash_bank_mappings"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_bank_cash_bank_mappings", BankCashBankMapping
        )

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
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
