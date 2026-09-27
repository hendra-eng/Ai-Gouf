"""
migrations/15-create_purchase_import_templates.py
===================================================
Menambahkan tabel BARU `financial_transaction_purchase_import_templates`
-- fitur "belajar pola" import file laporan pembelian (CSV/Excel) untuk
modul Transactions > Purchase, versi Purchase dari Sales Import Templates
& Journal Entry Import Templates (lihat root/SALES_IMPORT_TEMPLATES.md --
bentuk tabel & alurnya PERSIS sama, cuma beda domain).

Tabel ini SENGAJA TERPISAH dari template Sales/Journal Entry supaya pola
kolom antar fitur tidak saling bentrok walau milik klien yang sama.

client_id reference ke management_clients(id) (BUKAN management_users
seperti 4 tabel financial_transaction_purchase_* lain) -- lihat ORM model
db_client.py::PurchaseImportTemplate.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS lewat
ORM, tabel yang sudah ada di-skip, tidak ada data yang dihapus/ditimpa.

Setelah ini, jalankan seed template SAU:
    venv\\Scripts\\python migrations\\run_seed.py seed_template_sau_pembelian_detail_csv.sql

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\15-create_purchase_import_templates.py
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
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat tabel financial_transaction_purchase_import_templates")
    print("=" * 60)

    from db_client import PurchaseImportTemplate

    hasil = {}
    with engine.connect() as connection:
        hasil["buat tabel financial_transaction_purchase_import_templates"] = _buat_tabel_jika_belum_ada(
            connection, "financial_transaction_purchase_import_templates", PurchaseImportTemplate
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
