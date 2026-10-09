"""
migrations/28-create_management_setting_product.py
====================================================
Fitur Management > Settings > Product (goods & services). Menambahkan 3 tabel
BARU di grup management_setting_*:

    management_setting_product             1 baris per klien (Subfeature settings):
        stock_info_on_sales_purchases  BOOLEAN NOT NULL DEFAULT false
        product_variant                BOOLEAN NOT NULL DEFAULT false
    management_setting_product_categories  master product category: name + amount
    management_setting_product_units       master product unit:     name + amount

amount = NUMERIC(18,2) diinput manual oleh user. Kategori/unit pakai soft
delete (deleted_at); nama unik per klien (case-insensitive) di antara baris
yang belum dihapus -> unique index parsial di bawah. Lihat ORM
db_client.py::ManagementSettingProduct(Category|Unit) & router
modules/management/settings_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\28-create_management_setting_product.py
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

TABEL_SETTING = "management_setting_product"
TABEL_KATEGORI = "management_setting_product_categories"
TABEL_UNIT = "management_setting_product_units"

INDEX_UNIK = [
    (
        f"unique nama {TABEL_KATEGORI}",
        f"CREATE UNIQUE INDEX IF NOT EXISTS uq_management_setting_product_categories_name "
        f"ON {TABEL_KATEGORI} (client_id, lower(name)) WHERE deleted_at IS NULL",
    ),
    (
        f"unique nama {TABEL_UNIT}",
        f"CREATE UNIQUE INDEX IF NOT EXISTS uq_management_setting_product_units_name "
        f"ON {TABEL_UNIT} (client_id, lower(name)) WHERE deleted_at IS NULL",
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


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tabel settings product (category, unit, subfeature)")
    print("=" * 60)

    from db_client import ManagementSettingProduct, ManagementSettingProductCategory, ManagementSettingProductUnit

    hasil = {}
    with engine.connect() as connection:
        for nama, orm in (
            (TABEL_SETTING, ManagementSettingProduct),
            (TABEL_KATEGORI, ManagementSettingProductCategory),
            (TABEL_UNIT, ManagementSettingProductUnit),
        ):
            hasil[f"buat tabel {nama}"] = _buat_tabel(connection, nama, orm)
        if all(hasil.values()):
            for label, sql in INDEX_UNIK:
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
