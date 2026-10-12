"""
migrations/33-create_year_end_closing.py
==========================================
Fitur Management > Year-End Closing (tutup buku tahunan + kunci periode).

Menambahkan:

    management_client_fiscal_closings       1 baris per klien + tahun buku:
        status closed/reopened, jurnal penutup (pindah laba ke Retained
        Earnings) & jurnal pembaliknya, snapshot angka saat ditutup.
    management_client_fiscal_closing_logs   audit trail close/reopen (append-only).

    fn_tanggal_kunci_periode(klien)  -> tanggal akhir periode tertutup terakhir.
    Trigger KUNCI PERIODE di tabel transaksi yang dibaca Financial Statements:
        financial_transaction_journal_entry_drafts (+ _draft_lines)
        financial_transaction_sales_invoices (+ _sales_account_mappings)
        financial_transaction_purchase_transactions (+ _transaction_lines)
    Transaksi POSTED bertanggal <= tanggal kunci tidak bisa dibuat, diubah
    (kolom yang memengaruhi jurnal), di-unpost, atau dihapus. Kolom non-jurnal
    (mis. paid_amount invoice yang dibayar di tahun berikutnya) tetap boleh.
    Pesan error berawalan "PERIOD_LOCKED:" -- ditangkap db_client.py & main.py
    jadi respon 409 yang jelas.

Lihat ORM db_client.py::ManagementClientFiscalClosing(Log) & router
modules/management/year_end_closing_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- function/trigger di-CREATE OR
REPLACE / DROP IF EXISTS, tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\33-create_year_end_closing.py
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

TABEL_CLOSING = "management_client_fiscal_closings"
TABEL_LOG = "management_client_fiscal_closing_logs"

CONSTRAINT = [
    (
        "ck status closing",
        "ck_management_client_fiscal_closing_status",
        f"ALTER TABLE {TABEL_CLOSING} ADD CONSTRAINT ck_management_client_fiscal_closing_status "
        "CHECK (status IN ('closed', 'reopened'))",
    ),
    (
        "ck periode closing",
        "ck_management_client_fiscal_closing_period",
        f"ALTER TABLE {TABEL_CLOSING} ADD CONSTRAINT ck_management_client_fiscal_closing_period "
        "CHECK (period_start <= period_end AND fiscal_year BETWEEN 1900 AND 2999)",
    ),
    (
        "ck aksi log",
        "ck_management_client_fiscal_closing_log_action",
        f"ALTER TABLE {TABEL_LOG} ADD CONSTRAINT ck_management_client_fiscal_closing_log_action "
        "CHECK (action IN ('close', 'reopen'))",
    ),
]

FUNGSI_DASAR = r"""
CREATE OR REPLACE FUNCTION fn_tanggal_kunci_periode(p_client uuid) RETURNS date
LANGUAGE sql STABLE AS $$
    SELECT max(period_end) FROM management_client_fiscal_closings
     WHERE client_id = p_client AND status = 'closed'
$$;

CREATE OR REPLACE FUNCTION fn_tolak_periode_terkunci(p_client uuid, p_tanggal date, p_dokumen text) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_kunci date;
BEGIN
    IF p_client IS NULL OR p_tanggal IS NULL THEN
        RETURN;
    END IF;
    v_kunci := fn_tanggal_kunci_periode(p_client);
    IF v_kunci IS NOT NULL AND p_tanggal <= v_kunci THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: % dated % falls in a closed period (books closed through %). Re-open the fiscal year in Management > Year-End Closing first.',
            p_dokumen, to_char(p_tanggal, 'DD Mon YYYY'), to_char(v_kunci, 'DD Mon YYYY')
            USING ERRCODE = 'P0001';
    END IF;
END $$;
"""

# --- Header: cek baris LAMA (kalau posted) & baris BARU (kalau posted). ---
# UPDATE hanya dicek kalau kolom yang memengaruhi jurnal berubah.
FUNGSI_HEADER = r"""
CREATE OR REPLACE FUNCTION fn_kunci_periode_je() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF lower(OLD.status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.entry_date, 'Journal ' || OLD.je_number);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.entry_date, lower(OLD.status), OLD.management_client_id, OLD.deleted_at, OLD.total_debit, OLD.total_credit, OLD.source_type, OLD.je_number)
           IS NOT DISTINCT FROM
           (NEW.entry_date, lower(NEW.status), NEW.management_client_id, NEW.deleted_at, NEW.total_debit, NEW.total_credit, NEW.source_type, NEW.je_number) THEN
            RETURN NEW;
        END IF;
        IF lower(OLD.status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.entry_date, 'Journal ' || OLD.je_number);
        END IF;
    END IF;
    IF lower(NEW.status) = 'posted' AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.management_client_id, NEW.entry_date, 'Journal ' || NEW.je_number);
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_sales() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF lower(OLD.posting_status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.invoice_date, 'Sales invoice ' || OLD.invoice_no);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.invoice_date, lower(OLD.posting_status), OLD.management_client_id, OLD.deleted_at, OLD.dpp, OLD.ppn, OLD.gross_amount, OLD.cabang, OLD.project_name, OLD.invoice_no)
           IS NOT DISTINCT FROM
           (NEW.invoice_date, lower(NEW.posting_status), NEW.management_client_id, NEW.deleted_at, NEW.dpp, NEW.ppn, NEW.gross_amount, NEW.cabang, NEW.project_name, NEW.invoice_no) THEN
            RETURN NEW;
        END IF;
        IF lower(OLD.posting_status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.invoice_date, 'Sales invoice ' || OLD.invoice_no);
        END IF;
    END IF;
    IF lower(NEW.posting_status) = 'posted' AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.management_client_id, NEW.invoice_date, 'Sales invoice ' || NEW.invoice_no);
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF lower(OLD.status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.purchase_date, 'Purchase ' || OLD.purchase_no);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF (OLD.purchase_date, lower(OLD.status), OLD.management_client_id, OLD.deleted_at, OLD.subtotal, OLD.discount, OLD.tax_amount, OLD.total, OLD.accounts_payable, OLD.ap_account_code, OLD.tax_account_code, OLD.purchase_no)
           IS NOT DISTINCT FROM
           (NEW.purchase_date, lower(NEW.status), NEW.management_client_id, NEW.deleted_at, NEW.subtotal, NEW.discount, NEW.tax_amount, NEW.total, NEW.accounts_payable, NEW.ap_account_code, NEW.tax_account_code, NEW.purchase_no) THEN
            RETURN NEW;
        END IF;
        IF lower(OLD.status) = 'posted' AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.management_client_id, OLD.purchase_date, 'Purchase ' || OLD.purchase_no);
        END IF;
    END IF;
    IF lower(NEW.status) = 'posted' AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.management_client_id, NEW.purchase_date, 'Purchase ' || NEW.purchase_no);
    END IF;
    RETURN NEW;
END $$;
"""

# --- Baris: tolak semua insert/update/delete kalau induknya posted & terkunci. ---
FUNGSI_BARIS = r"""
CREATE OR REPLACE FUNCTION fn_kunci_periode_je_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT d.management_client_id, d.entry_date, d.je_number FROM financial_transaction_journal_entry_drafts d
         WHERE d.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.draft_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.draft_id END)
           AND lower(d.status) = 'posted' AND d.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.management_client_id, r.entry_date, 'Journal ' || r.je_number);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_sales_mapping() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT i.management_client_id, i.invoice_date, i.invoice_no FROM financial_transaction_sales_invoices i
         WHERE i.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.invoice_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.invoice_id END)
           AND lower(i.posting_status) = 'posted' AND i.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.management_client_id, r.invoice_date, 'Sales invoice ' || r.invoice_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_purchase_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT t.management_client_id, t.purchase_date, t.purchase_no FROM financial_transaction_purchase_transactions t
         WHERE t.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.transaction_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.transaction_id END)
           AND lower(t.status) = 'posted' AND t.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.management_client_id, r.purchase_date, 'Purchase ' || r.purchase_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

# (tabel, nama trigger, fungsi)
TRIGGER = [
    ("financial_transaction_journal_entry_drafts", "trg_kunci_periode_je", "fn_kunci_periode_je"),
    ("financial_transaction_journal_entry_draft_lines", "trg_kunci_periode_je_line", "fn_kunci_periode_je_line"),
    ("financial_transaction_sales_invoices", "trg_kunci_periode_sales", "fn_kunci_periode_sales"),
    ("financial_transaction_sales_account_mappings", "trg_kunci_periode_sales_mapping", "fn_kunci_periode_sales_mapping"),
    ("financial_transaction_purchase_transactions", "trg_kunci_periode_purchase", "fn_kunci_periode_purchase"),
    ("financial_transaction_purchase_transaction_lines", "trg_kunci_periode_purchase_line", "fn_kunci_periode_purchase_line"),
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
    print("🔄 MIGRATION: Year-End Closing + kunci periode")
    print("=" * 60)

    from db_client import ManagementClientFiscalClosing, ManagementClientFiscalClosingLog

    hasil = {}
    with engine.connect() as connection:
        hasil[f"buat tabel {TABEL_CLOSING}"] = _buat_tabel(connection, TABEL_CLOSING, ManagementClientFiscalClosing)
        hasil[f"buat tabel {TABEL_LOG}"] = _buat_tabel(connection, TABEL_LOG, ManagementClientFiscalClosingLog)
        if all(hasil.values()):
            for label, nama, ddl in CONSTRAINT:
                hasil[label] = _pasang_constraint(connection, label, nama, ddl)
            hasil["function dasar kunci periode"] = _jalankan_sql(connection, "function dasar kunci periode", FUNGSI_DASAR)
            hasil["function trigger header"] = _jalankan_sql(connection, "function trigger header", FUNGSI_HEADER)
            hasil["function trigger baris"] = _jalankan_sql(connection, "function trigger baris", FUNGSI_BARIS)
            ada_tabel = set(inspect(connection).get_table_names())
            for tabel, trg, fn in TRIGGER:
                label = f"trigger {trg}"
                if tabel not in ada_tabel:
                    print(f"⚠️  Tabel '{tabel}' tidak ada, {label} dilewati.")
                    continue
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
