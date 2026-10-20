"""
migrations/purchase/34-allow_null_purchase_date.py
==================================================
financial_transaction_purchase_transactions.purchase_date jadi BOLEH NULL.

Alasan: import Purchase (mis. NBM, sheet DETAIL) punya transaksi yang tanggal notanya
kosong di sumber; recipe `tanggal_wajib: false` membiarkannya kosong. Posting tetap
WAJIB bertanggal.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- DROP NOT NULL pada kolom yang sudah
nullable tidak error. Tidak ada data yang diubah/dihapus.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\purchase\\34-allow_null_purchase_date.py
"""

import sys
from pathlib import Path

# File ini ada di migrations/purchase/ -> _history ada di migrations/, db_client & .env di backend/.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_purchase_transactions"

SQL = f"ALTER TABLE {TABEL} ALTER COLUMN purchase_date DROP NOT NULL;"


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Commit lewat koneksi DBAPI mentah (lihat catatan di migrations/34-create_bank_cash_tables.py).
    raw = connection.connection
    try:
        with raw.cursor() as cur:
            cur.execute(sql)
        raw.commit()
        print(f"✅ {label} siap.")
        return True
    except Exception as e:
        raw.rollback()
        print(f"❌ Gagal {label}: {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: purchase_date boleh NULL")
    print("=" * 60)
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada -- jalankan dulu migration Purchase sebelumnya.")
            return 1
        ok = _jalankan_sql(connection, "purchase_date boleh NULL", SQL)
    if ok:
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Migration gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
