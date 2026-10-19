"""
migrations/38-create_management_payroll_tables.py
==================================================
Fitur Payroll (halaman /payroll): 3 tabel BARU (grup management_payroll_*):

    management_payroll_settings   -- 1 baris per klien, pengaturan di kolom JSONB
    management_payroll_employees  -- master karyawan per klien (soft delete)
    management_payroll_runs       -- 1 baris per klien per periode (YYYY-MM),
                                     snapshot per karyawan di kolom JSONB `lines`

Ditambah index unik parsial: NIP unik per klien untuk karyawan yang belum
dihapus (deleted_at IS NULL).

ORM: db_client.py (ManagementPayrollSetting / ManagementPayrollEmployee /
ManagementPayrollRun). API: modules/management/payroll_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\38-create_management_payroll_tables.py
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

INDEX_NIP = "uq_management_payroll_employees_client_nip_aktif"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel management_payroll_*")
    print("=" * 60)

    from db_client import (
        Base,
        ManagementPayrollEmployee,
        ManagementPayrollRun,
        ManagementPayrollSetting,
    )

    tabel_orm = [ManagementPayrollSetting, ManagementPayrollEmployee, ManagementPayrollRun]
    hasil = {}
    with engine.connect() as connection:
        ada = set(inspect(connection).get_table_names())
        for model in tabel_orm:
            nama = model.__tablename__
            if nama in ada:
                print(f"⏭️  Tabel '{nama}' sudah ada, skip.")
                hasil[f"buat tabel {nama}"] = True
                continue
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[model.__table__])
                connection.commit()
                print(f"✅ Tabel '{nama}' berhasil dibuat.")
                hasil[f"buat tabel {nama}"] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{nama}': {e}")
                hasil[f"buat tabel {nama}"] = False

        try:
            connection.execute(text(
                f"CREATE UNIQUE INDEX IF NOT EXISTS {INDEX_NIP} "
                "ON management_payroll_employees (client_id, lower(nip)) WHERE deleted_at IS NULL"
            ))
            connection.commit()
            print(f"✅ Index '{INDEX_NIP}' siap.")
            hasil[f"index {INDEX_NIP}"] = True
        except (OperationalError, ProgrammingError) as e:
            connection.rollback()
            print(f"❌ Gagal buat index '{INDEX_NIP}': {e}")
            hasil[f"index {INDEX_NIP}"] = False

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
