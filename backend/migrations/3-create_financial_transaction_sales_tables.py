"""
migrations/create_financial_transaction_sales_tables.py
=========================================================
Membuat 7 tabel fitur "Transactions > Sales" (DDL: root/ddl-table, bagian
"FITUR TRANSACTIONS > SALES") -- menampung data yang sekarang masih
mock/local state di halaman src/app/transactions/sales/*:

    0. financial_transaction_sales_import_templates
    1. financial_transaction_sales_source_files
    2. financial_transaction_sales_source_rows
    3. financial_transaction_sales_invoices
    4. financial_transaction_sales_account_mappings
    5. financial_transaction_sales_exceptions
    6. financial_transaction_sales_activity_log

Urutan CREATE TABLE di atas WAJIB (bukan cuma penomoran) -- tabel 1-6
punya FOREIGN KEY ke tabel sebelumnya (source_files -> import_templates,
source_rows -> source_files, invoices -> source_rows, account_mappings/
exceptions/activity_log -> invoices), jadi tabel yang direferensikan harus
sudah ada duluan.

[FIX] Tabel ke-0 (import_templates) SENGAJA ditambahkan ke migration INI
(bukan cuma di migrations/create_sales_import_templates.py) -- kalau
migration ini dijalankan duluan di database kosong TANPA tabel
import_templates lebih dulu ada, CREATE TABLE financial_transaction_sales_
source_files gagal ("relation financial_transaction_sales_import_templates
does not exist") karena kolom template_id-nya FK ke situ, dan kegagalan itu
merambat ke 5 tabel lain yang bergantung ke source_files secara berantai.
Menaruhnya di sini juga (bukan cuma mengandalkan urutan run script yang
benar) membuat migration ini AMAN dijalankan sendirian, di urutan apa pun
relatif terhadap create_sales_import_templates.py -- keduanya sama-sama
idempoten (skip kalau tabelnya sudah ada), jadi tidak masalah kalau
create_sales_import_templates.py sudah lebih dulu membuatnya.

client_id di SELURUH 6 tabel Sales (BUKAN import_templates, lihat catatan
di db_client.py::SalesImportTemplate) reference ke management_users
(id_user) (bukan management_clients ataupun clients lama) -- lihat catatan
di ORM model (db_client.py) & di kepala DDL-nya sendiri untuk alasannya.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS
lewat ORM, tabel yang sudah ada di-skip, tidak ada data yang
dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\3-create_financial_transaction_sales_tables.py
"""

import sys
from pathlib import Path

# Console Windows default-nya cp1252 -> print() emoji (🔄 ✅ ❌) melempar
# UnicodeEncodeError. Paksa UTF-8 supaya skrip jalan di terminal apa pun.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

# [FIX] Kalau python-dotenv tidak ter-install (mis. skrip dijalankan pakai
# Python global, bukan venv) .env tidak terbaca dan db_client diam-diam jatuh
# ke fallback SQLite -- model ini memakai JSONB (khusus PostgreSQL), jadi
# CREATE TABLE gagal dengan error yang menyesatkan. Hentikan lebih awal.
import os
if not os.environ.get("DATABASE_URL"):
    sys.exit(
        "❌ DATABASE_URL tidak terbaca dari backend/.env.\n"
        "   Jalankan pakai Python venv project (butuh python-dotenv):\n"
        "   venv\\Scripts\\python migrations\\3-create_financial_transaction_sales_tables.py"
    )

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
    """CREATE TABLE IF NOT EXISTS lewat ORM, supaya index/constraint/kolom
    GENERATED ikut dibuat persis seperti definisi model."""
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
    print("🔄 MIGRATION: buat tabel financial_transaction_sales_* (Transactions > Sales)")
    print("=" * 60)

    from db_client import (
        SalesImportTemplate,
        SalesSourceFile,
        SalesSourceRow,
        SalesInvoice,
        SalesAccountMapping,
        SalesException,
        SalesActivityLog,
    )

    urutan_tabel = [
        ("financial_transaction_sales_import_templates", SalesImportTemplate),
        ("financial_transaction_sales_source_files", SalesSourceFile),
        ("financial_transaction_sales_source_rows", SalesSourceRow),
        ("financial_transaction_sales_invoices", SalesInvoice),
        ("financial_transaction_sales_account_mappings", SalesAccountMapping),
        ("financial_transaction_sales_exceptions", SalesException),
        ("financial_transaction_sales_activity_log", SalesActivityLog),
    ]

    hasil = {}
    with engine.connect() as connection:
        for nama_tabel, orm_class in urutan_tabel:
            hasil[f"buat tabel {nama_tabel}"] = _buat_tabel_jika_belum_ada(connection, nama_tabel, orm_class)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
