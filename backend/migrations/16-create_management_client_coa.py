"""
migrations/16-create_management_client_coa.py
===============================================
Menambahkan tabel BARU `management_client_coa` -- master Chart of Accounts
per klien (management_clients), fitur Management > COA.

Struktur kolom mengikuti sheet "COA <KODE>" di
dataset/COA/COA_Clients_GOUF.xlsx (ACC NO, ACCOUNT NAME, ACCOUNT
CLASSIFICATION, ACCOUNT HEAD, ACCOUNT SUB, DESCRIPTION, INTERNATIONAL
STANDARD GROUP, STANDARD ACCOUNT CODE, IFRS TAXONOMY REFERENCE, IFRS SOURCE)
+ normal_balance (diturunkan) + kolom audit standar. Lihat ORM
db_client.py::ManagementClientCoa & DDL di root/ddl-table.

TERPISAH dari tabel `coa` lama (FK ke `clients` integer).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS lewat
ORM, tabel yang sudah ada di-skip, tidak ada data yang dihapus/ditimpa.

Setelah ini, jalankan seed COA 3 klien (SAU, NPI, NBM):
    venv\\Scripts\\python migrations\\run_seed.py seed_coa_sau.sql
    venv\\Scripts\\python migrations\\run_seed.py seed_coa_npi.sql
    venv\\Scripts\\python migrations\\run_seed.py seed_coa_nbm.sql

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\16-create_management_client_coa.py
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
    print("🔄 MIGRATION: buat tabel management_client_coa")
    print("=" * 60)

    from db_client import ManagementClientCoa

    hasil = {}
    with engine.connect() as connection:
        hasil["buat tabel management_client_coa"] = _buat_tabel_jika_belum_ada(
            connection, "management_client_coa", ManagementClientCoa
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
