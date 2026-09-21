"""
migrations/add_cabang_to_sales_invoices.py
==========================================
Migration untuk fitur "Transactions > Sales" -- menambah kolom `cabang` ke
tabel financial_transaction_sales_invoices (dipakai tab Sales Transaction &
Posted untuk menampilkan + memfilter transaksi per cabang):

- financial_transaction_sales_invoices.cabang   VARCHAR(100) NULL
- index idx_sales_invoices_client_cabang        (client_id, cabang)

Kolom NULL = cabang belum ditentukan (semua invoice lama otomatis begini,
tidak ada data yang diubah). Nilainya diisi lewat form Tambah/Edit
Transaksi di tab Sales Transaction (atau lewat API PUT /invoices/{id}).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- kolom/index yang sudah ada
di-skip, tidak ada data yang dihapus atau ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\add_cabang_to_sales_invoices.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine

TABEL = "financial_transaction_sales_invoices"
KOLOM = "cabang"
NAMA_INDEX = "idx_sales_invoices_client_cabang"


def _kolom_ada(connection, table: str, column: str) -> bool:
    inspector = inspect(connection)
    if table not in inspector.get_table_names():
        return False
    return column in [col["name"] for col in inspector.get_columns(table)]


def _index_ada(connection, table: str, index_name: str) -> bool:
    inspector = inspect(connection)
    if table not in inspector.get_table_names():
        return False
    return index_name in [idx["name"] for idx in inspector.get_indexes(table)]


def _tambah_kolom_cabang(connection) -> bool:
    if _kolom_ada(connection, TABEL, KOLOM):
        print(f"⏭️  Kolom '{TABEL}.{KOLOM}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {TABEL} ADD COLUMN {KOLOM} VARCHAR(100)"))
        connection.commit()
        print(f"✅ Kolom '{TABEL}.{KOLOM}' berhasil ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"⏭️  Kolom '{TABEL}.{KOLOM}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal tambah kolom '{TABEL}.{KOLOM}': {e}")
        return False


def _tambah_index_cabang(connection) -> bool:
    if _index_ada(connection, TABEL, NAMA_INDEX):
        print(f"⏭️  Index '{NAMA_INDEX}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"CREATE INDEX {NAMA_INDEX} ON {TABEL} (client_id, {KOLOM})"))
        connection.commit()
        print(f"✅ Index '{NAMA_INDEX}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        if "already exists" in str(e).lower():
            print(f"⏭️  Index '{NAMA_INDEX}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat index '{NAMA_INDEX}': {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tambah kolom cabang ke financial_transaction_sales_invoices")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada -- jalankan dulu migrations/create_financial_transaction_sales_tables.py")
            return 1
        hasil[f"{TABEL}.{KOLOM}"] = _tambah_kolom_cabang(connection)
        hasil[f"index {NAMA_INDEX}"] = _tambah_index_cabang(connection)

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
