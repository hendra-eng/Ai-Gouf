"""
migrations/46-add_opening_balance_flag_to_sales_purchase.py
===========================================================
COA > Opening Balance > Import Opening AR / Opening AP: invoice customer &
bill vendor yang masih outstanding per tanggal cut-off disimpan sebagai
dokumen Sales / Purchase POSTED supaya langsung ikut di AR / AP (aging,
statement, pelunasan lewat Cash & Bank), tapi DITANDAI:

    is_opening_balance  boolean  -- true = dokumen saldo awal. TIDAK dibaca
                                    GL / Financial Statements (saldonya sudah
                                    ada di jurnal opening balance) dan tidak
                                    tampil di daftar Sales / Purchase.
    opening_import_id   uuid     -- batch import asalnya
                                    (management_client_coa_opening_balance_imports).

Kolom ditambah ke financial_transaction_sales_invoices &
financial_transaction_purchase_transactions. Lihat
modules/management/opening_balance_import_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\46-add_opening_balance_flag_to_sales_purchase.py
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

from _history import catat_history
from db_client import engine

KOLOM = """
ALTER TABLE financial_transaction_sales_invoices ADD COLUMN IF NOT EXISTS is_opening_balance boolean NOT NULL DEFAULT false;
ALTER TABLE financial_transaction_sales_invoices ADD COLUMN IF NOT EXISTS opening_import_id uuid
    REFERENCES management_client_coa_opening_balance_imports(id);
ALTER TABLE financial_transaction_purchase_transactions ADD COLUMN IF NOT EXISTS is_opening_balance boolean NOT NULL DEFAULT false;
ALTER TABLE financial_transaction_purchase_transactions ADD COLUMN IF NOT EXISTS opening_import_id uuid
    REFERENCES management_client_coa_opening_balance_imports(id);
CREATE INDEX IF NOT EXISTS idx_sales_invoices_opening_import ON financial_transaction_sales_invoices (opening_import_id)
    WHERE opening_import_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_purchase_transactions_opening_import ON financial_transaction_purchase_transactions (opening_import_id)
    WHERE opening_import_id IS NOT NULL;
"""


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Commit lewat koneksi DBAPI mentah (lihat catatan di migration 34).
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
    print("🔄 MIGRATION: penanda dokumen saldo awal di Sales / Purchase")
    print("=" * 60)
    with engine.connect() as connection:
        ok = _jalankan_sql(connection, "kolom is_opening_balance / opening_import_id", KOLOM)
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
