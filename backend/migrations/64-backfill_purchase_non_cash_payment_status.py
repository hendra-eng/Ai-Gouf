r"""
migrations/64-backfill_purchase_non_cash_payment_status.py
==========================================================
Status bayar baru Purchase: 'non_cash' (tampil "Non-Cash", pill ungu/violet).

Untuk jurnal penyesuaian yang diimpor lewat Purchase (mis. depresiasi aset UBD: Dr Depreciation Expense /
Cr Accum. Depre) -- tidak ada hutang & tidak pernah dibayar lewat Cash & Bank, jadi 'unpaid' menyesatkan.

Import baru otomatis diberi 'non_cash' (purchase_import_v1._status_bayar_awal). Migration ini memperbaiki
transaksi LAMA: payment_status 'unpaid' yang akun lawannya (ap_account_name) akumulasi penyusutan /
amortisasi -> 'non_cash'. Kolom payment_status VARCHAR(20) tanpa CHECK, jadi tidak ada perubahan skema.
PPh 21 / PPh 25 (Cr Tax Payable) TIDAK disentuh -- itu hutang pajak yang memang dibayar lewat Bank & Cash.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\64-backfill_purchase_non_cash_payment_status.py
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

from sqlalchemy import text

from _history import catat_history
from db_client import engine

SQL = """
UPDATE financial_transaction_purchase_transactions
   SET payment_status = 'non_cash', edited_at = now()
 WHERE deleted_at IS NULL
   AND lower(coalesce(payment_status, 'unpaid')) = 'unpaid'
   AND ap_account_name ~* '(accum|akumulasi|depre|penyusutan|amortis)'
"""


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: Purchase payment_status 'non_cash' (backfill)")
    print("=" * 60)
    with engine.connect() as connection:
        try:
            hasil = connection.execute(text(SQL))
            connection.commit()
            print(f"✅ {hasil.rowcount} transaksi diubah ke 'non_cash'.")
            ok = True
        except Exception as e:
            connection.rollback()
            print(f"❌ Gagal: {e}")
            ok = False

    print("=" * 60)
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
