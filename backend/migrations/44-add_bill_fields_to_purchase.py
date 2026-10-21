"""
migrations/44-add_bill_fields_to_purchase.py
============================================
Purchase > Create Bill (form manual, modules/transactions/purchase_bill_v1.py).

Kolom baru:
    financial_transaction_purchase_transactions
        tax_type       varchar(20)  -- ppn_11 / ppn_12 / non_ppn (NULL = transaksi lama / import)
        tax_inclusive  bool         -- harga item sudah termasuk pajak
    financial_transaction_purchase_transaction_lines
        discount_type  varchar(10)  -- percent / amount (NULL = transaksi lama / import)
        discount_value numeric(24,4) -- nilai diskon sesuai input user (persen atau rupiah)

Kolom lama (discount, tax_rate, tax_amount, subtotal, total) tetap jadi
sumber angka jurnal -- kolom baru ini cuma supaya form edit Bill bisa
menampilkan ulang input user apa adanya.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\44-add_bill_fields_to_purchase.py
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
ALTER TABLE financial_transaction_purchase_transactions ADD COLUMN IF NOT EXISTS tax_type varchar(20);
ALTER TABLE financial_transaction_purchase_transactions ADD COLUMN IF NOT EXISTS tax_inclusive boolean NOT NULL DEFAULT false;
ALTER TABLE financial_transaction_purchase_transaction_lines ADD COLUMN IF NOT EXISTS discount_type varchar(10);
ALTER TABLE financial_transaction_purchase_transaction_lines ADD COLUMN IF NOT EXISTS discount_value numeric(24, 4);
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
    print("🔄 MIGRATION: kolom Create Bill (Purchase)")
    print("=" * 60)
    with engine.connect() as connection:
        ok = _jalankan_sql(connection, "kolom tax_type / tax_inclusive / discount_type / discount_value", KOLOM)
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
