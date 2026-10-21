"""
migrations/42-create_other_journal_tables.py
============================================
Transactions > Other -- modul modules/transactions/other_v1.py, UI
dataset/picture/Template UI/other/1-7.png.

Membuat 2 tabel (dari ORM di db_client.py):

    financial_transaction_other_journals       header jurnal lain-lain OTH-YYYY-MM-####
    financial_transaction_other_journal_lines  baris akun

+ CHECK nilai status/kategori/debit-kredit.
+ Trigger kunci periode (Year-End Closing): jurnal berstatus posted/reversed di
  periode yang sudah ditutup tidak bisa diubah (butuh fn_tolak_periode_terkunci
  dari migration 33).

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\42-create_other_journal_tables.py
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

CHECK = """
ALTER TABLE financial_transaction_other_journals DROP CONSTRAINT IF EXISTS ck_other_journal_nilai;
ALTER TABLE financial_transaction_other_journals ADD CONSTRAINT ck_other_journal_nilai
    CHECK (status IN ('draft', 'approved', 'rejected', 'posted', 'reversed')
           AND category IN ('general', 'capex', 'accrual', 'prepaid', 'reclass', 'correction', 'payroll', 'uncategorized', 'other')
           AND source IN ('manual', 'import') AND total_debit >= 0 AND total_credit >= 0);

ALTER TABLE financial_transaction_other_journal_lines DROP CONSTRAINT IF EXISTS ck_other_journal_line_nilai;
ALTER TABLE financial_transaction_other_journal_lines ADD CONSTRAINT ck_other_journal_line_nilai
    CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));
"""

FUNGSI_KUNCI = """
CREATE OR REPLACE FUNCTION fn_kunci_periode_other() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status IN ('posted', 'reversed') THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Other journal ' || OLD.journal_no);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Membalik jurnal hanya menyentuh periode tanggal pembaliknya.
        IF OLD.status = 'posted' AND NEW.status = 'reversed' AND OLD.journal_date = NEW.journal_date THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
            RETURN NEW;
        END IF;
        IF OLD.status IN ('posted', 'reversed') AND OLD.deleted_at IS NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Other journal ' || OLD.journal_no);
        END IF;
    END IF;
    IF NEW.status IN ('posted', 'reversed') AND NEW.deleted_at IS NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.journal_date, 'Other journal ' || NEW.journal_no);
        IF NEW.status = 'reversed' THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_other_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT j.client_id, j.journal_date, j.journal_no FROM financial_transaction_other_journals j
         WHERE j.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.journal_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.journal_id END)
           AND j.status IN ('posted', 'reversed') AND j.deleted_at IS NULL
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.client_id, r.journal_date, 'Other journal ' || r.journal_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

TRIGGER = [
    ("financial_transaction_other_journals", "trg_kunci_periode_other", "fn_kunci_periode_other"),
    ("financial_transaction_other_journal_lines", "trg_kunci_periode_other_line", "fn_kunci_periode_other_line"),
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
    print("🔄 MIGRATION: Transactions > Other (jurnal lain-lain)")
    print("=" * 60)

    from db_client import OtherJournal, OtherJournalLine

    hasil = {}
    with engine.connect() as connection:
        for orm in (OtherJournal, OtherJournalLine):
            hasil[f"buat tabel {orm.__tablename__}"] = _buat_tabel(connection, orm.__tablename__, orm)
        if all(hasil.values()):
            hasil["check constraint"] = _jalankan_sql(connection, "check constraint", CHECK)
            ada = connection.execute(text("SELECT 1 FROM pg_proc WHERE proname = 'fn_tolak_periode_terkunci'")).first()
            if not ada:
                print("❌ Fungsi fn_tolak_periode_terkunci belum ada -- jalankan dulu migrations/33-create_year_end_closing.py.")
                hasil["fungsi dasar kunci periode (migration 33)"] = False
            else:
                hasil["function trigger kunci periode other"] = _jalankan_sql(connection, "function trigger kunci periode other", FUNGSI_KUNCI)
                for tabel, trg, fn in TRIGGER:
                    hasil[f"trigger {trg}"] = _jalankan_sql(
                        connection, f"trigger {trg}",
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
