"""
migrations/add_columns_for_14_sheets.py
========================================
Migration untuk menambah kolom/tabel yang diperlukan oleh export 14 sheet
Excel:

- coa.segment                     VARCHAR(50)
- coa.arus_kas                    VARCHAR(20)
- jurnal_posting.lawan_transaksi  VARCHAR(200)
- tabel baru: riwayat_saldo_bulanan

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- kolom/tabel yang sudah ada
di-skip, tidak ada data yang dihapus atau ditimpa.

Cara pakai:
    python run_migration.py
"""

import sys
from pathlib import Path

# Bisa dijalankan langsung dari root backend (file ini sejajar dengan
# db_client.py) ATAU dari dalam folder migrations/ -- kedua kasus
# ditangani dengan menambahkan folder parent ke sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


def kolom_ada(connection, table_name: str, column_name: str) -> bool:
    """Cek apakah kolom sudah ada di tabel tertentu (SQLite/PostgreSQL/MySQL)."""
    inspector = inspect(connection)
    if table_name not in inspector.get_table_names():
        return False
    columns = [col["name"] for col in inspector.get_columns(table_name)]
    return column_name in columns


def _tambah_kolom(connection, table: str, column: str, ddl_type: str) -> bool:
    if kolom_ada(connection, table, column):
        print(f"⏭️  Kolom '{table}.{column}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl_type}"))
        connection.commit()
        print(f"✅ Kolom '{table}.{column}' berhasil ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"⏭️  Kolom '{table}.{column}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal tambah kolom '{table}.{column}': {e}")
        return False


def tambah_tabel_riwayat_saldo_bulanan(connection) -> bool:
    """Buat tabel riwayat_saldo_bulanan kalau belum ada."""
    table = "riwayat_saldo_bulanan"
    inspector = inspect(connection)
    if table in inspector.get_table_names():
        print(f"⏭️  Tabel '{table}' sudah ada, skip.")
        return True
    try:
        # Import lokal supaya Base.metadata sudah lengkap (termasuk model
        # RiwayatSaldoBulanan) sebelum create_all dipanggil untuk tabel ini saja.
        from db_client import Base, RiwayatSaldoBulanan  # noqa: F401
        Base.metadata.create_all(bind=connection.engine, tables=[RiwayatSaldoBulanan.__table__])
        print(f"✅ Tabel '{table}' berhasil dibuat (beserta index & unique constraint).")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table}': {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: Tambah kolom/tabel untuk export 14 sheet Excel")
    print("=" * 60)

    import os
    db_url = os.environ.get("DATABASE_URL", "sqlite:///ai_gouf.db")
    db_type = "PostgreSQL/Supabase" if "postgres" in db_url else "SQLite" if "sqlite" in db_url else "Unknown"
    print(f"📊 Database type: {db_type}")
    print()

    hasil = {}
    with engine.connect() as connection:
        hasil["coa.segment"] = _tambah_kolom(connection, "coa", "segment", "VARCHAR(50)")
        hasil["coa.arus_kas"] = _tambah_kolom(connection, "coa", "arus_kas", "VARCHAR(20)")
        hasil["jurnal_posting.lawan_transaksi"] = _tambah_kolom(
            connection, "jurnal_posting", "lawan_transaksi", "VARCHAR(200)"
        )
        hasil["riwayat_saldo_bulanan (tabel)"] = tambah_tabel_riwayat_saldo_bulanan(connection)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<40}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())