"""
migrations/36-create_bank_cash_bank_mappings.py
===============================================
Mapping bank / rekening -> akun kas-bank COA untuk Bank Feed (Cash & Bank):

    financial_transaction_bank_cash_bank_mappings   BARU -- 1 baris per rekening
        (atau per laporan kas) milik klien: bank_name, account_number (digit),
        match_keyword (teks judul dokumen), template_id (template ekstraksi),
        bank_coa_id (akun management_client_coa tujuan mutasi).

File rekening koran yang di-upload tanpa memilih akun ("Auto-detect") dicocokkan
ke mapping ini (lihat modules/transactions/bank_cash_v1.py::_cari_mapping_bank);
upload dengan akun yang dipilih manual otomatis mencatat mapping baru kalau
nomor rekening/bank-nya belum terdaftar.

Seed data SAU (BCA/BRI/Mandiri/Kas Kasir): migrations/seed_template_sau_bank_cash.sql.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\36-create_bank_cash_bank_mappings.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_bank_cash_bank_mappings"
TABEL_TEMPLATE = "financial_transaction_bank_cash_import_templates"


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
    print("🔄 MIGRATION: Cash & Bank bank mapping (bank/rekening -> akun COA)")
    print("=" * 60)

    from db_client import BankCashBankMapping

    hasil = {}
    with engine.connect() as connection:
        if TABEL_TEMPLATE not in inspect(connection).get_table_names():
            print("❌ Tabel template Cash & Bank belum ada -- jalankan dulu migrations/35-create_bank_cash_import_templates.py.")
            return 1
        hasil[f"buat tabel {TABEL}"] = _buat_tabel(connection, TABEL, BankCashBankMapping)

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
