"""
migrations/41-create_tax_compliance_tables.py
=============================================
Tax Compliance (grup Planning) -- modul modules/planning/tax_compliance_v1.py,
UI dataset/picture/Template UI/Tax Compliance/1-8.jpeg.

Membuat 6 tabel (dari ORM di db_client.py):

    planning_tax_account_mappings   akun COA per jenis pajak
    planning_tax_ledger             buku pajak (sinkron transaksi posted + adjustment manual)
    planning_tax_payments           setoran pajak (kode billing, NTPN, link Cash & Bank)
    planning_tax_filings            SPT Masa / Tahunan
    planning_tax_exceptions         temuan kepatuhan pajak
    planning_tax_reconciliations    snapshot rekonsiliasi Tax Ledger vs GL

+ CHECK nilai status/jenis.
+ Cash & Bank: source transaksi boleh 'tax' (Record Tax Payment membuat
  transaksi Cash Payment Dr hutang pajak / Cr bank lewat jalur bank_cash_v1).

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\41-create_tax_compliance_tables.py
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

JENIS = "('vat_output', 'vat_input', 'pph21', 'pph22', 'pph23', 'pph26', 'pph4_2', 'pph15', 'pph25', 'pph29', 'pph_credit', 'pbb', 'other')"
JENIS_BAYAR = "('vat', 'pph21', 'pph22', 'pph23', 'pph26', 'pph4_2', 'pph15', 'pph25', 'pph29', 'pbb', 'other')"

CHECK = f"""
ALTER TABLE planning_tax_account_mappings DROP CONSTRAINT IF EXISTS ck_tax_account_mapping_type;
ALTER TABLE planning_tax_account_mappings ADD CONSTRAINT ck_tax_account_mapping_type CHECK (tax_type IN {JENIS});

ALTER TABLE planning_tax_ledger DROP CONSTRAINT IF EXISTS ck_tax_ledger_nilai;
ALTER TABLE planning_tax_ledger ADD CONSTRAINT ck_tax_ledger_nilai
    CHECK (tax_type IN {JENIS} AND source_module IN ('sales', 'purchase', 'journal_entry', 'cash_bank', 'manual')
           AND (party_type IS NULL OR party_type IN ('customer', 'vendor', 'employee', 'other')));

ALTER TABLE planning_tax_payments DROP CONSTRAINT IF EXISTS ck_tax_payment_nilai;
ALTER TABLE planning_tax_payments ADD CONSTRAINT ck_tax_payment_nilai
    CHECK (tax_type IN {JENIS_BAYAR} AND status IN ('pending', 'paid', 'cancelled') AND amount > 0);

ALTER TABLE planning_tax_filings DROP CONSTRAINT IF EXISTS ck_tax_filing_nilai;
ALTER TABLE planning_tax_filings ADD CONSTRAINT ck_tax_filing_nilai
    CHECK (return_type IN ('ppn', 'pph21', 'unifikasi', 'annual_corporate', 'other') AND status IN ('draft', 'filed', 'not_required'));

ALTER TABLE planning_tax_exceptions DROP CONSTRAINT IF EXISTS ck_tax_exception_nilai;
ALTER TABLE planning_tax_exceptions ADD CONSTRAINT ck_tax_exception_nilai
    CHECK (severity IN ('high', 'medium', 'low') AND status IN ('open', 'in_review', 'on_hold', 'resolved', 'dismissed'));

ALTER TABLE financial_transaction_bank_cash_transactions DROP CONSTRAINT IF EXISTS ck_bank_cash_transaction_kind;
ALTER TABLE financial_transaction_bank_cash_transactions ADD CONSTRAINT ck_bank_cash_transaction_kind
  CHECK (kind IN ('invoice', 'non_invoice') AND source IN ('bank_feed', 'manual', 'ar', 'ap', 'tax') AND amount > 0);
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
    print("🔄 MIGRATION: Tax Compliance (ledger, payments, filings, exceptions, reconciliation)")
    print("=" * 60)

    from db_client import TaxAccountMapping, TaxException, TaxFiling, TaxLedgerEntry, TaxPayment, TaxReconciliation

    hasil = {}
    with engine.connect() as connection:
        for orm in (TaxAccountMapping, TaxLedgerEntry, TaxPayment, TaxFiling, TaxException, TaxReconciliation):
            hasil[f"buat tabel {orm.__tablename__}"] = _buat_tabel(connection, orm.__tablename__, orm)
        if all(hasil.values()):
            hasil["check constraint (+ Cash & Bank source 'tax')"] = _jalankan_sql(connection, "check constraint", CHECK)

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
