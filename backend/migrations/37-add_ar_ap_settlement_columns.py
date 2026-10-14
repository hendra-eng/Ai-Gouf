"""
migrations/37-add_ar_ap_settlement_columns.py
=============================================
Accounts Receivable & Accounts Payable (modules/finance/receivables_payables_v1.py).

Penerimaan pelanggan (Record Receipt) dan pembayaran vendor (Record Payment)
TIDAK punya tabel sendiri: keduanya disimpan sebagai transaksi Cash & Bank
(financial_transaction_bank_cash_transactions + _transaction_lines, migration 34)
dengan source 'ar' / 'ap', supaya jurnal, kunci periode, pelunasan invoice
(Sales.paid_amount / Purchase.payment_status) dan GL/FS tetap satu jalur.

Menambahkan ke financial_transaction_bank_cash_transactions:

    payment_method   varchar(30)  bank_transfer / cash / cheque / giro / virtual_account / credit_card / other
    reference_date   date         tanggal bukti transfer / cek
    currency         varchar(10)  default 'IDR'

    + CHECK ck_bank_cash_transaction_kind diganti: source boleh 'ar' / 'ap'
      selain 'bank_feed' / 'manual'.
    + index (client_id, source) untuk tab Collections / Payments.

Database baru (mis. VPS): migration 34 membuat tabel dari ORM terkini, jadi
kolom di atas sudah ada -- migration ini skip kolomnya dan hanya mengganti
constraint. AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\37-add_ar_ap_settlement_columns.py
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

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_bank_cash_transactions"

KOLOM = [
    ("payment_method", "VARCHAR(30)"),
    ("reference_date", "DATE"),
    ("currency", "VARCHAR(10) NOT NULL DEFAULT 'IDR'"),
]

CONSTRAINT_JENIS = f"""
ALTER TABLE {TABEL} DROP CONSTRAINT IF EXISTS ck_bank_cash_transaction_kind;
ALTER TABLE {TABEL} ADD CONSTRAINT ck_bank_cash_transaction_kind
  CHECK (kind IN ('invoice', 'non_invoice') AND source IN ('bank_feed', 'manual', 'ar', 'ap') AND amount > 0);
"""

INDEX_SUMBER = f"CREATE INDEX IF NOT EXISTS idx_bank_cash_transaction_client_source ON {TABEL} (client_id, source);"


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
    print("🔄 MIGRATION: kolom Record Receipt / Payment (AR & AP) di transaksi Cash & Bank")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel {TABEL} belum ada -- jalankan dulu migrations/34-create_bank_cash_tables.py.")
            return 1
        ada = {c["name"] for c in inspect(connection).get_columns(TABEL)}
        for nama, tipe in KOLOM:
            label = f"kolom {nama}"
            if nama in ada:
                print(f"⏭️  {label} sudah ada, skip.")
                hasil[label] = True
            else:
                hasil[label] = _jalankan_sql(connection, label, f"ALTER TABLE {TABEL} ADD COLUMN {nama} {tipe};")
        hasil["ck source boleh 'ar' / 'ap'"] = _jalankan_sql(connection, "ck source boleh 'ar' / 'ap'", CONSTRAINT_JENIS)
        hasil["index client_id + source"] = _jalankan_sql(connection, "index client_id + source", INDEX_SUMBER)

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
