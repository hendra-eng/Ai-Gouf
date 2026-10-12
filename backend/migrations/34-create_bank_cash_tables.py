"""
migrations/34-create_bank_cash_tables.py
========================================
Fitur Transactions > Cash & Bank (dibangun ulang, menggantikan rancangan
financial_transaction_bank_cash_payments milik playground-hendra yang
DDL-nya tidak pernah ada di database ini).

Menambahkan:

    financial_transaction_bank_cash_statements         1 file rekening koran (Bank Feed) per akun bank
    financial_transaction_bank_cash_mutations          baris mutasi rekening koran; status unmatched/matched/ignored
    financial_transaction_bank_cash_transactions       header Cash Receipt / Cash Payment (draft -> approved -> posted -> reversed)
    financial_transaction_bank_cash_transaction_lines  baris lawan: pelunasan invoice Sales/Purchase atau akun bebas

    + FK mutations.transaction_id -> transactions.id (dua tabel saling merujuk,
      jadi dipasang setelah keduanya dibuat)
    + CHECK constraint nilai status/arah/jenis baris
    + Trigger KUNCI PERIODE (fungsi fn_tolak_periode_terkunci dari
      migration 33): transaksi posted/reversed bertanggal <= tanggal kunci
      tidak bisa dibuat/diubah/dihapus; pembalikan transaksi lama tetap
      boleh asal tanggal pembaliknya di periode terbuka.

CATATAN URUTAN (database baru, mis. VPS): tabel dibuat dari ORM db_client.py
versi TERKINI, dan BankCashStatement di sana sudah punya kolom template_id
(FK -> financial_transaction_bank_cash_import_templates, aslinya dari
migration 35). Karena itu tabel template ikut dibuat di sini LEBIH DULU --
tanpa itu CREATE TABLE statements gagal "relation ... import_templates does
not exist" dan tabel lain berantai gagal. Migration 35 tetap dijalankan
sesudahnya (skip tabel/kolom yang sudah ada, pasang CHECK constraint-nya).

Tabel financial_transaction_bank_cash_exceptions (tab Exceptions) sudah ada
dan tetap dipakai apa adanya -- bank_mutation_ref sekarang berisi id mutasi.

Lihat ORM db_client.py::BankCashStatement/Mutation/Transaction/TransactionLine
& router modules/transactions/bank_cash_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\34-create_bank_cash_tables.py
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

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL_TEMPLATE = "financial_transaction_bank_cash_import_templates"
TABEL_STATEMENT = "financial_transaction_bank_cash_statements"
TABEL_MUTASI = "financial_transaction_bank_cash_mutations"
TABEL_TRANSAKSI = "financial_transaction_bank_cash_transactions"
TABEL_BARIS = "financial_transaction_bank_cash_transaction_lines"

CONSTRAINT = [
    (
        "fk mutasi -> transaksi",
        "fk_bank_cash_mutation_transaction",
        f"ALTER TABLE {TABEL_MUTASI} ADD CONSTRAINT fk_bank_cash_mutation_transaction "
        f"FOREIGN KEY (transaction_id) REFERENCES {TABEL_TRANSAKSI}(id) ON DELETE SET NULL",
    ),
    (
        "ck status mutasi",
        "ck_bank_cash_mutation_status",
        f"ALTER TABLE {TABEL_MUTASI} ADD CONSTRAINT ck_bank_cash_mutation_status "
        "CHECK (status IN ('unmatched', 'matched', 'ignored'))",
    ),
    (
        "ck nominal mutasi",
        "ck_bank_cash_mutation_amount",
        f"ALTER TABLE {TABEL_MUTASI} ADD CONSTRAINT ck_bank_cash_mutation_amount "
        "CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))",
    ),
    (
        "ck arah transaksi",
        "ck_bank_cash_transaction_direction",
        f"ALTER TABLE {TABEL_TRANSAKSI} ADD CONSTRAINT ck_bank_cash_transaction_direction "
        "CHECK (direction IN ('receipt', 'payment'))",
    ),
    (
        "ck status transaksi",
        "ck_bank_cash_transaction_status",
        f"ALTER TABLE {TABEL_TRANSAKSI} ADD CONSTRAINT ck_bank_cash_transaction_status "
        "CHECK (status IN ('draft', 'approved', 'posted', 'reversed'))",
    ),
    (
        "ck jenis & sumber transaksi",
        "ck_bank_cash_transaction_kind",
        f"ALTER TABLE {TABEL_TRANSAKSI} ADD CONSTRAINT ck_bank_cash_transaction_kind "
        "CHECK (kind IN ('invoice', 'non_invoice') AND source IN ('bank_feed', 'manual') AND amount > 0)",
    ),
    (
        "ck pembalikan transaksi",
        "ck_bank_cash_transaction_reversal",
        f"ALTER TABLE {TABEL_TRANSAKSI} ADD CONSTRAINT ck_bank_cash_transaction_reversal "
        "CHECK (status <> 'reversed' OR (reversal_date IS NOT NULL AND reversal_date >= tx_date))",
    ),
    (
        "ck jenis baris",
        "ck_bank_cash_line_type",
        f"ALTER TABLE {TABEL_BARIS} ADD CONSTRAINT ck_bank_cash_line_type CHECK ("
        "(line_type = 'sales_invoice' AND sales_invoice_id IS NOT NULL AND purchase_transaction_id IS NULL) OR "
        "(line_type = 'purchase' AND purchase_transaction_id IS NOT NULL AND sales_invoice_id IS NULL) OR "
        "(line_type = 'account' AND sales_invoice_id IS NULL AND purchase_transaction_id IS NULL))",
    ),
    (
        "ck nominal baris",
        "ck_bank_cash_line_amount",
        f"ALTER TABLE {TABEL_BARIS} ADD CONSTRAINT ck_bank_cash_line_amount "
        "CHECK (debit >= 0 AND credit >= 0 AND (debit > 0) <> (credit > 0))",
    ),
]

# Header: posted & reversed sama-sama sudah masuk GL (reversed = jurnal asal
# di tx_date + pembalik di reversal_date). Pembalikan (posted -> reversed tanpa
# mengubah kolom jurnal) hanya mengecek tanggal pembaliknya, supaya transaksi
# di tahun yang sudah ditutup tetap bisa dibalik di periode terbuka.
FUNGSI_KUNCI = r"""
CREATE OR REPLACE FUNCTION fn_kunci_periode_kas_bank() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF lower(OLD.status) IN ('posted', 'reversed') AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.tx_date, 'Cash & Bank ' || OLD.tx_number);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.tx_date, lower(OLD.status), OLD.client_id, OLD.deleted_at, OLD.amount, OLD.bank_account_code, OLD.tx_number, OLD.reversal_date)
           IS NOT DISTINCT FROM
           (NEW.tx_date, lower(NEW.status), NEW.client_id, NEW.deleted_at, NEW.amount, NEW.bank_account_code, NEW.tx_number, NEW.reversal_date) THEN
            RETURN NEW;
        END IF;
        IF lower(OLD.status) = 'posted' AND lower(NEW.status) = 'reversed'
           AND (OLD.tx_date, OLD.client_id, OLD.deleted_at, OLD.amount, OLD.bank_account_code, OLD.tx_number)
               IS NOT DISTINCT FROM
               (NEW.tx_date, NEW.client_id, NEW.deleted_at, NEW.amount, NEW.bank_account_code, NEW.tx_number) THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.tx_number);
            RETURN NEW;
        END IF;
        IF lower(OLD.status) IN ('posted', 'reversed') AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.tx_date, 'Cash & Bank ' || OLD.tx_number);
            IF lower(OLD.status) = 'reversed' THEN
                PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.reversal_date, 'Reversal of ' || OLD.tx_number);
            END IF;
        END IF;
    END IF;
    IF lower(NEW.status) IN ('posted', 'reversed') AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.tx_date, 'Cash & Bank ' || NEW.tx_number);
        IF lower(NEW.status) = 'reversed' THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.tx_number);
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_kas_bank_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT t.client_id, t.tx_date, t.tx_number FROM financial_transaction_bank_cash_transactions t
         WHERE t.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.transaction_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.transaction_id END)
           AND lower(t.status) IN ('posted', 'reversed') AND t.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.client_id, r.tx_date, 'Cash & Bank ' || r.tx_number);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

# Dibuat ulang tiap migration jalan supaya predikatnya selalu sama dengan ORM
# (versi awal belum mengecualikan transaksi 'reversed').
INDEX_MUTASI_AKTIF = f"""
DROP INDEX IF EXISTS uq_bank_cash_transaction_mutation_aktif;
CREATE UNIQUE INDEX uq_bank_cash_transaction_mutation_aktif ON {TABEL_TRANSAKSI} (mutation_id)
 WHERE deleted_at IS NULL AND mutation_id IS NOT NULL AND status <> 'reversed';
"""

TRIGGER = [
    (TABEL_TRANSAKSI, "trg_kunci_periode_kas_bank", "fn_kunci_periode_kas_bank"),
    (TABEL_BARIS, "trg_kunci_periode_kas_bank_line", "fn_kunci_periode_kas_bank_line"),
]


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


def _pasang_constraint(connection, label: str, nama: str, ddl: str) -> bool:
    ada = connection.execute(text("SELECT 1 FROM pg_constraint WHERE conname = :n"), {"n": nama}).first()
    if ada:
        print(f"⏭️  {label} sudah ada, skip.")
        return True
    try:
        connection.execute(text(ddl))
        connection.commit()
        print(f"✅ {label} terpasang.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        print(f"❌ Gagal pasang {label}: {e}")
        return False


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Cursor DBAPI mentah TANPA parameter: '%' di plpgsql tidak dianggap
    # placeholder oleh driver. Commit WAJIB lewat koneksi DBAPI itu juga --
    # connection.commit() milik SQLAlchemy tidak melakukan apa-apa kalau
    # SQLAlchemy sendiri belum membuka transaksi, sehingga DDL di sini dulu
    # ikut ter-rollback saat koneksi ditutup (trigger tidak pernah terpasang).
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
    print("🔄 MIGRATION: Cash & Bank (Bank Feed + transaksi kas/bank)")
    print("=" * 60)

    from db_client import (BankCashImportTemplate, BankCashMutation, BankCashStatement, BankCashTransaction,
                           BankCashTransactionLine)

    hasil = {}
    with engine.connect() as connection:
        for nama, orm in (
            (TABEL_TEMPLATE, BankCashImportTemplate),   # dirujuk FK statements.template_id (lihat docstring)
            (TABEL_STATEMENT, BankCashStatement),
            (TABEL_MUTASI, BankCashMutation),
            (TABEL_TRANSAKSI, BankCashTransaction),
            (TABEL_BARIS, BankCashTransactionLine),
        ):
            hasil[f"buat tabel {nama}"] = _buat_tabel(connection, nama, orm)

        if all(hasil.values()):
            for label, nama, ddl in CONSTRAINT:
                hasil[label] = _pasang_constraint(connection, label, nama, ddl)
            hasil["index 1 mutasi = 1 transaksi aktif"] = _jalankan_sql(
                connection, "index 1 mutasi = 1 transaksi aktif", INDEX_MUTASI_AKTIF
            )

            ada_fungsi_dasar = connection.execute(
                text("SELECT 1 FROM pg_proc WHERE proname = 'fn_tolak_periode_terkunci'")
            ).first()
            if not ada_fungsi_dasar:
                print("❌ Fungsi fn_tolak_periode_terkunci belum ada -- jalankan dulu migrations/33-create_year_end_closing.py.")
                hasil["fungsi dasar kunci periode (migration 33)"] = False
            else:
                hasil["function trigger kunci periode kas & bank"] = _jalankan_sql(
                    connection, "function trigger kunci periode kas & bank", FUNGSI_KUNCI
                )
                for tabel, trg, fn in TRIGGER:
                    label = f"trigger {trg}"
                    hasil[label] = _jalankan_sql(
                        connection, label,
                        f"DROP TRIGGER IF EXISTS {trg} ON {tabel}; "
                        f"CREATE TRIGGER {trg} BEFORE INSERT OR UPDATE OR DELETE ON {tabel} "
                        f"FOR EACH ROW EXECUTE FUNCTION {fn}();",
                    )

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
