"""
migrations/27-create_management_setting_purchase.py
=====================================================
Fitur Management > Settings > Purchase: tabel BARU management_setting_purchase
(grup management_setting_*), 1 baris per klien:

    preferred_purchase_term                VARCHAR(50)  -- Net 30, Cash on Delivery, ..., Custom
    activate_supplier_in_purchase_request  BOOLEAN NOT NULL DEFAULT false
    shipping                               BOOLEAN NOT NULL DEFAULT false
    discount                               BOOLEAN NOT NULL DEFAULT false
    discount_per_lines                     BOOLEAN NOT NULL DEFAULT false
    deposit                                BOOLEAN NOT NULL DEFAULT false
    default_purchase_message               TEXT
    + client_id (FK management_clients, UNIQUE) & kolom audit.

Klien yang belum punya baris = semua default (lihat settings_v1.py). Baris
dibuat saat pertama kali disimpan (upsert PUT). Lihat ORM
db_client.py::ManagementSettingPurchase.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\27-create_management_setting_purchase.py
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

TABEL = "management_setting_purchase"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel management_setting_purchase")
    print("=" * 60)

    from db_client import Base, ManagementSettingPurchase

    hasil = {}
    with engine.connect() as connection:
        if TABEL in inspect(connection).get_table_names():
            print(f"⏭️  Tabel '{TABEL}' sudah ada, skip.")
            hasil[f"buat tabel {TABEL}"] = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[ManagementSettingPurchase.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL}' berhasil dibuat.")
                hasil[f"buat tabel {TABEL}"] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL}': {e}")
                hasil[f"buat tabel {TABEL}"] = False

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
