"""
migrations/48-create_other_transaction_tables.py
================================================
Other Transactions (grup Assets & Equity, awalan asset_) -- modul
modules/assets_and_equity/other_transactions_v1.py, UI
dataset/picture/Template UI/other/1-8.jpeg.

Membuat 6 tabel (dari ORM di db_client.py):

    asset_other_transaction_templates    template peristiwa bisnis (Employee Advance, Security Deposit, ...)
    asset_other_transaction_rules        aturan jurnal per template + sub jenis (akun default per peran)
    asset_other_transactions             header OT-YYYY-####
    asset_other_transaction_lines        baris jurnal hasil aturan
    asset_other_transaction_attachments  dokumen pendukung (bytea, maks 10 MB per file)
    asset_other_transaction_events       jejak aktivitas

+ CHECK nilai status / sumber / nominal.
+ Trigger kunci periode (Year-End Closing): transaksi posted/reversed di periode
  yang sudah ditutup tidak bisa diubah (butuh fn_tolak_periode_terkunci dari
  migration 33).
+ Salin jurnal lama financial_transaction_other_journals (migration 42) ke
  tabel baru sebagai jenis "other_event" (source 'legacy', id sama) --
  GL sekarang hanya membaca tabel baru, jadi jurnal lama tetap terhitung.
  Tabel lama TIDAK dihapus.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\48-create_other_transaction_tables.py
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

JENIS = ("employee_advance", "security_deposit", "loan_financing", "capital_injection",
         "intercompany", "refund_reimbursement", "other_event")
_daftar = ", ".join(f"'{j}'" for j in JENIS)

CHECK = f"""
ALTER TABLE asset_other_transaction_templates DROP CONSTRAINT IF EXISTS ck_other_tx_template_nilai;
ALTER TABLE asset_other_transaction_templates ADD CONSTRAINT ck_other_tx_template_nilai
    CHECK (type_key IN ({_daftar}));

ALTER TABLE asset_other_transactions DROP CONSTRAINT IF EXISTS ck_other_tx_nilai;
ALTER TABLE asset_other_transactions ADD CONSTRAINT ck_other_tx_nilai
    CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'posted', 'reversed')
           AND type_key IN ({_daftar})
           AND source IN ('manual', 'import', 'legacy')
           AND amount >= 0 AND extra_amount >= 0 AND extra_amount <= amount
           AND exchange_rate > 0 AND total_debit >= 0 AND total_credit >= 0);

ALTER TABLE asset_other_transaction_lines DROP CONSTRAINT IF EXISTS ck_other_tx_line_nilai;
ALTER TABLE asset_other_transaction_lines ADD CONSTRAINT ck_other_tx_line_nilai
    CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));

ALTER TABLE asset_other_transaction_attachments DROP CONSTRAINT IF EXISTS ck_other_tx_attachment_ukuran;
ALTER TABLE asset_other_transaction_attachments ADD CONSTRAINT ck_other_tx_attachment_ukuran
    CHECK (size_bytes >= 0 AND size_bytes <= 10485760);
"""

FUNGSI_KUNCI = """
CREATE OR REPLACE FUNCTION fn_kunci_periode_other_tx() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Other transaction ' || OLD.journal_no);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Membalik transaksi hanya menyentuh periode tanggal pembaliknya.
        IF OLD.status = 'posted' AND NEW.status = 'reversed' AND OLD.journal_date = NEW.journal_date THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
            RETURN NEW;
        END IF;
        IF OLD.status IN ('posted', 'reversed') AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Other transaction ' || OLD.journal_no);
        END IF;
    END IF;
    IF NEW.status IN ('posted', 'reversed') AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.journal_date, 'Other transaction ' || NEW.journal_no);
        IF NEW.status = 'reversed' THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_other_tx_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT t.client_id, t.journal_date, t.journal_no FROM asset_other_transactions t
         WHERE t.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.journal_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.journal_id END)
           AND t.status IN ('posted', 'reversed') AND t.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.client_id, r.journal_date, 'Other transaction ' || r.journal_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

TRIGGER = [
    ("asset_other_transactions", "trg_kunci_periode_other_tx", "fn_kunci_periode_other_tx"),
    ("asset_other_transaction_lines", "trg_kunci_periode_other_tx_line", "fn_kunci_periode_other_tx_line"),
]

# Jurnal OTH- lama -> jenis other_event. Header dulu (trigger baris butuh header),
# baris disalin apa adanya. ON CONFLICT supaya idempoten.
SALIN_LAMA = """
INSERT INTO asset_other_transactions (
    id, client_id, type_key, subtype, journal_no, journal_date, counterparty, description, notes,
    amount, total_debit, total_credit, requires_approval, source, status, details,
    approved_at, approved_by, approved_by_name, rejected_reason, posted_at, posted_by, posted_by_name,
    reversal_date, reversal_reason, reversed_at, reversed_by, reversed_by_name,
    created_at, created_by, created_by_name, edited_at, edited_by, deleted_at, deleted_by)
SELECT j.id, j.client_id, 'other_event', 'other_event', j.journal_no, j.journal_date, j.reference, j.description, j.review_note,
       GREATEST(j.total_debit, j.total_credit), j.total_debit, j.total_credit, true, 'legacy', j.status,
       jsonb_build_object('legacy_category', j.category, 'event_category', j.category),
       j.approved_at, j.approved_by, j.approved_by_name, j.rejected_reason, j.posted_at, j.posted_by, j.posted_by_name,
       j.reversal_date, j.reversal_reason, j.reversed_at, j.reversed_by, j.reversed_by_name,
       j.created_at, j.created_by, j.created_by_name, j.edited_at, j.edited_by, j.deleted_at, j.deleted_by
  FROM financial_transaction_other_journals j
ON CONFLICT (id) DO NOTHING;

INSERT INTO asset_other_transaction_lines (id, journal_id, line_no, coa_id, account_code, account_name, description, debit, credit)
SELECT l.id, l.journal_id, l.line_no, l.coa_id, l.account_code, l.account_name, l.description, l.debit, l.credit
  FROM financial_transaction_other_journal_lines l
  JOIN asset_other_transactions t ON t.id = l.journal_id AND t.source = 'legacy'
ON CONFLICT (id) DO NOTHING;
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
    print("🔄 MIGRATION: Other Transactions (asset_other_transaction_*)")
    print("=" * 60)

    from db_client import (OtherTransaction, OtherTransactionAttachment, OtherTransactionEvent,
                           OtherTransactionLine, OtherTransactionRule, OtherTransactionTemplate)

    hasil = {}
    with engine.connect() as connection:
        for orm in (OtherTransactionTemplate, OtherTransactionRule, OtherTransaction, OtherTransactionLine,
                    OtherTransactionAttachment, OtherTransactionEvent):
            hasil[f"buat tabel {orm.__tablename__}"] = _buat_tabel(connection, orm.__tablename__, orm)
        if all(hasil.values()):
            hasil["check constraint"] = _jalankan_sql(connection, "check constraint", CHECK)
            ada = connection.execute(text("SELECT 1 FROM pg_proc WHERE proname = 'fn_tolak_periode_terkunci'")).first()
            if not ada:
                print("❌ Fungsi fn_tolak_periode_terkunci belum ada -- jalankan dulu migrations/33-create_year_end_closing.py.")
                hasil["fungsi dasar kunci periode (migration 33)"] = False
            else:
                hasil["function trigger kunci periode other tx"] = _jalankan_sql(connection, "function trigger kunci periode other tx", FUNGSI_KUNCI)
                for tabel, trg, fn in TRIGGER:
                    hasil[f"trigger {trg}"] = _jalankan_sql(
                        connection, f"trigger {trg}",
                        f"DROP TRIGGER IF EXISTS {trg} ON {tabel}; "
                        f"CREATE TRIGGER {trg} BEFORE INSERT OR UPDATE OR DELETE ON {tabel} "
                        f"FOR EACH ROW EXECUTE FUNCTION {fn}();",
                    )
            if "financial_transaction_other_journals" in inspect(connection).get_table_names():
                # Salin dengan trigger kunci periode dimatikan sementara: jurnal lama di
                # periode yang sudah ditutup tetap harus ikut tersalin apa adanya.
                hasil["salin jurnal Other lama (migration 42)"] = _jalankan_sql(
                    connection, "salin jurnal Other lama",
                    "".join(f"ALTER TABLE {t} DISABLE TRIGGER {trg};\n" for t, trg, _ in TRIGGER) + SALIN_LAMA
                    + "".join(f"ALTER TABLE {t} ENABLE TRIGGER {trg};\n" for t, trg, _ in TRIGGER),
                )
            else:
                print("⏭️  Tabel jurnal Other lama tidak ada, tidak ada yang disalin.")

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
