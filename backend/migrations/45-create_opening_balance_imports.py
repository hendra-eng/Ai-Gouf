"""
migrations/45-create_opening_balance_imports.py
===============================================
COA > Opening Balance > tab Import Data (monitoring & approval per modul).
Menambahkan 2 tabel BARU:

    management_client_coa_opening_balance_imports      1 batch = 1 file upload
        untuk 1 modul (coa / ar / ap / inventory / asset) di 1 set opening
        balance. Status validated -> submitted -> approved / rejected,
        cancelled = dibatalkan pengunggah. Jejak maker-checker (uploaded /
        submitted / reviewed by) disimpan di header.
    management_client_coa_opening_balance_import_rows  baris hasil baca file
        (data JSONB yang sudah dinormalisasi + status valid/warning/error).

Lihat ORM db_client.py::ManagementClientCoaOpeningBalanceImport(Row) &
router modules/management/opening_balance_import_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\45-create_opening_balance_imports.py
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

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL_BATCH = "management_client_coa_opening_balance_imports"
TABEL_BARIS = "management_client_coa_opening_balance_import_rows"

CONSTRAINT = [
    (
        "ck modul batch",
        "ck_management_client_coa_ob_import_module",
        f"ALTER TABLE {TABEL_BATCH} ADD CONSTRAINT ck_management_client_coa_ob_import_module "
        "CHECK (module IN ('coa', 'ar', 'ap', 'inventory', 'asset'))",
    ),
    (
        "ck status batch",
        "ck_management_client_coa_ob_import_status",
        f"ALTER TABLE {TABEL_BATCH} ADD CONSTRAINT ck_management_client_coa_ob_import_status "
        "CHECK (status IN ('validated', 'submitted', 'approved', 'rejected', 'cancelled'))",
    ),
    (
        "ck status baris",
        "ck_management_client_coa_ob_import_row_status",
        f"ALTER TABLE {TABEL_BARIS} ADD CONSTRAINT ck_management_client_coa_ob_import_row_status "
        "CHECK (status IN ('valid', 'warning', 'error'))",
    ),
]


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


def _pasang_constraint(connection, label: str, nama: str, ddl: str) -> bool:
    ada = connection.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": nama}).first()
    if ada:
        print(f"⏭️  {label} sudah ada, skip.")
        return True
    try:
        connection.execute(text(ddl))
        connection.commit()
        print(f"✅ {label} terpasang.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"❌ Gagal pasang {label}: {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel import opening balance")
    print("=" * 60)

    from db_client import ManagementClientCoaOpeningBalanceImport, ManagementClientCoaOpeningBalanceImportRow

    hasil = {}
    with engine.connect() as connection:
        hasil[f"buat tabel {TABEL_BATCH}"] = _buat_tabel(connection, TABEL_BATCH, ManagementClientCoaOpeningBalanceImport)
        hasil[f"buat tabel {TABEL_BARIS}"] = _buat_tabel(connection, TABEL_BARIS, ManagementClientCoaOpeningBalanceImportRow)
        if all(hasil.values()):
            for label, nama, ddl in CONSTRAINT:
                hasil[label] = _pasang_constraint(connection, label, nama, ddl)

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
