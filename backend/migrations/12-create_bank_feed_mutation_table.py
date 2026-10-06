"""
migrations/12-create_bank_feed_mutation_table.py
=================================================
Membuat tabel "bank_feed_mutation" -- menampung mutasi rekening koran
MENTAH (sebelum dijurnal) untuk tab "Bank Feed" & "Reconciliation" di
halaman Cash & Bank (src/app/transactions/bank-cash/). Lihat model ORM
BankFeedMutation di db_client.py untuk skema lengkap & catatan desain.

TERPISAH dari finance_transaction_bank_cash (mengharuskan jurnal
double-entry) -- tabel ini murni baris "tanggal segini, uang masuk/keluar
sekian" seperti apa adanya di rekening koran.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS
lewat ORM, di-skip kalau tabel sudah ada, tidak ada data yang
dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\12-create_bank_feed_mutation_table.py
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
    print("🔄 MIGRATION: buat tabel bank_feed_mutation (Cash & Bank > Bank Feed)")
    print("=" * 60)

    from db_client import BankFeedMutation

    with engine.connect() as connection:
        ok = _buat_tabel_jika_belum_ada(connection, "bank_feed_mutation", BankFeedMutation)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    print(f"{'buat tabel bank_feed_mutation':<70}: {'✅' if ok else '❌'}")
    print("=" * 60)

    if ok:
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())