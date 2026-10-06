"""
migrations/29-create_management_setting_account_mappings.py
=============================================================
Fitur Management > Settings > Account Mapping: tabel BARU
management_setting_account_mappings (grup management_setting_*).

Bentuk key-value, 1 baris per klien + mapping_key:

    client_id    UUID  FK management_clients
    mapping_key  VARCHAR(60)  -- sales_revenue, purchase_cogs, account_receivable, ...
    coa_id       UUID  FK management_client_coa (akun milik klien yang sama)
    + UNIQUE (client_id, mapping_key) & kolom audit.

Daftar mapping_key & grupnya (Sales, Purchase, AR/AP, Inventory, Others)
didefinisikan di modules/management/settings_v1.py::ACCOUNT_MAPPING_GROUPS,
jadi menambah input baru tidak butuh migration lagi. Lihat ORM
db_client.py::ManagementSettingAccountMapping.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\29-create_management_setting_account_mappings.py
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

TABEL = "management_setting_account_mappings"
INDEX = (
    "index coa_id",
    f"CREATE INDEX IF NOT EXISTS idx_management_setting_account_mappings_coa ON {TABEL} (coa_id)",
)


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel management_setting_account_mappings")
    print("=" * 60)

    from db_client import Base, ManagementSettingAccountMapping

    hasil = {}
    with engine.connect() as connection:
        if TABEL in inspect(connection).get_table_names():
            print(f"⏭️  Tabel '{TABEL}' sudah ada, skip.")
            hasil[f"buat tabel {TABEL}"] = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[ManagementSettingAccountMapping.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL}' berhasil dibuat.")
                hasil[f"buat tabel {TABEL}"] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL}': {e}")
                hasil[f"buat tabel {TABEL}"] = False
        if all(hasil.values()):
            label, sql = INDEX
            try:
                connection.execute(text(sql))
                connection.commit()
                print(f"✅ {label} siap.")
                hasil[label] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal {label}: {e}")
                hasil[label] = False

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
