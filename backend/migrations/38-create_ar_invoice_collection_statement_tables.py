"""
migrations/38-create_ar_invoice_collection_statement_tables.py
==============================================================
Accounts Receivable: Create Invoice, tab Collections, tab Customer Statements
(modules/finance/receivables_ar_v1.py, UI dataset/picture/Template UI/
Account Receivable/4-8.jpeg).

Membuat 6 tabel (dari ORM di db_client.py):

    financial_ar_customers                       master customer (CUST-###, NPWP, alamat, kontak)
    financial_transaction_sales_invoice_details  detail 1:1 invoice dari Create Invoice
    financial_transaction_sales_invoice_lines    item invoice (produk/jasa, qty, harga, diskon, pajak)
    financial_ar_collection_accounts             status penagihan per customer (tab Collections)
    financial_ar_collection_activities           riwayat follow-up penagihan
    financial_ar_ap_statements                   log Customer / Vendor Statement (generate, email, download)

Invoice-nya sendiri TETAP di financial_transaction_sales_invoices (Draft ->
Review -> Approved -> Posted lewat Sales Journal Preview), jadi tabel Sales
tidak diubah.

+ index unik parsial (baris yang belum dihapus):
    financial_ar_customers (client_id, upper(name)) dan (client_id, code)
+ CHECK nilai status/metode.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\38-create_ar_invoice_collection_statement_tables.py
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

INDEX_DAN_CHECK = """
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_customers_client_name
    ON financial_ar_customers (client_id, upper(name)) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ar_customers_client_code
    ON financial_ar_customers (client_id, code) WHERE deleted_at IS NULL;

ALTER TABLE financial_transaction_sales_invoice_details DROP CONSTRAINT IF EXISTS ck_sales_invoice_detail_tax;
ALTER TABLE financial_transaction_sales_invoice_details ADD CONSTRAINT ck_sales_invoice_detail_tax
    CHECK (tax_type IN ('ppn_11', 'ppn_12', 'non_ppn'));

ALTER TABLE financial_transaction_sales_invoice_lines DROP CONSTRAINT IF EXISTS ck_sales_invoice_line_nilai;
ALTER TABLE financial_transaction_sales_invoice_lines ADD CONSTRAINT ck_sales_invoice_line_nilai
    CHECK (discount_type IN ('percent', 'amount') AND tax_code IN ('ppn_11', 'ppn_12', 'non_ppn')
           AND quantity > 0 AND unit_price >= 0 AND discount_value >= 0);

ALTER TABLE financial_ar_collection_accounts DROP CONSTRAINT IF EXISTS ck_ar_collection_account_status;
ALTER TABLE financial_ar_collection_accounts ADD CONSTRAINT ck_ar_collection_account_status
    CHECK (status IN ('to_contact', 'promised', 'escalated', 'resolved')
           AND (priority IS NULL OR priority IN ('high', 'medium', 'low')));

ALTER TABLE financial_ar_ap_statements DROP CONSTRAINT IF EXISTS ck_ar_ap_statement_nilai;
ALTER TABLE financial_ar_ap_statements ADD CONSTRAINT ck_ar_ap_statement_nilai
    CHECK (side IN ('ar', 'ap') AND date_from <= date_to
           AND delivery_status IN ('generated', 'sent', 'downloaded', 'failed'));
"""


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
    print("🔄 MIGRATION: AR Create Invoice, Collections, Customer Statements")
    print("=" * 60)

    from db_client import (ArApStatement, ArCollectionAccount, ArCollectionActivity, ArCustomer, SalesInvoiceDetail,
                           SalesInvoiceLine)

    hasil = {}
    with engine.connect() as connection:
        for orm in (ArCustomer, SalesInvoiceDetail, SalesInvoiceLine, ArCollectionAccount, ArCollectionActivity, ArApStatement):
            nama = orm.__tablename__
            hasil[f"buat tabel {nama}"] = _buat_tabel(connection, nama, orm)
        if all(hasil.values()):
            hasil["index unik & check constraint"] = _jalankan_sql(connection, "index unik & check constraint", INDEX_DAN_CHECK)

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
