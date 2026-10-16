"""
migrations/39-create_fixed_asset_tables.py
==========================================
Fixed Assets (grup Assets & Equity) -- modul modules/assets_and_equity/
fixed_assets_v1.py, UI dataset/picture/Template UI/Fix Assets/1-6.jpeg.

Tabel baru (dari ORM di db_client.py):

    asset_fixed_asset_categories          kategori aset + metode/umur/residu default + akun COA
    asset_fixed_asset_depreciation_runs   batch penyusutan bulanan (DEP-YYYY-MM)
    asset_fixed_asset_depreciation_lines  penyusutan per aset dalam batch
    asset_fixed_asset_disposals           pelepasan aset (DSP-YYYY-###)
    asset_fixed_asset_journals            jurnal posted FA-YYYY-#### (sumber GL "fixed_asset")
    asset_fixed_asset_journal_lines       baris jurnal
    asset_fixed_asset_report_logs         riwayat laporan yang di-generate

Tabel lama asset_fixed_assets (dibuat manual di Supabase) DITAMBAH kolom:
category_id, branch, custodian, description, serial_number, supplier,
reference, useful_life_months, depreciation_start_date,
opening_accumulated_depreciation, accum_coa_id, expense_coa_id,
acquisition_journal_id, created_by(_name), edited_by, deleted_at/by
+ default id/created_at, index unik (client_id, asset_code).

+ CHECK nilai status/metode, trigger kunci periode (Year-End Closing) untuk
  jurnal FA (butuh fungsi fn_tolak_periode_terkunci dari migration 33).

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\39-create_fixed_asset_tables.py
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

KOLOM_ASET = """
ALTER TABLE asset_fixed_assets ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE asset_fixed_assets ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES asset_fixed_asset_categories(id);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS branch varchar(100);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS custodian varchar(255);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS serial_number varchar(100);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS supplier varchar(255);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS reference varchar(100);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS useful_life_months integer;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS depreciation_start_date date;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS opening_accumulated_depreciation numeric(24, 2) NOT NULL DEFAULT 0;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS accum_coa_id uuid;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS expense_coa_id uuid;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS acquisition_journal_id uuid;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS created_by_name varchar(255);
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS edited_by uuid;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS deleted_by uuid;
-- Data lama: umur tahun -> bulan, tanggal mulai = tanggal perolehan.
UPDATE asset_fixed_assets SET useful_life_months = useful_life_years * 12
 WHERE useful_life_months IS NULL AND useful_life_years IS NOT NULL;
UPDATE asset_fixed_assets SET depreciation_start_date = purchase_date
 WHERE depreciation_start_date IS NULL AND purchase_date IS NOT NULL;
UPDATE asset_fixed_assets SET depreciation_method = CASE lower(depreciation_method)
        WHEN 'straight-line' THEN 'straight_line' WHEN 'declining-balance' THEN 'declining_balance' ELSE depreciation_method END
 WHERE depreciation_method IS NOT NULL;
UPDATE asset_fixed_assets SET status = 'inactive' WHERE status = 'maintenance';
CREATE INDEX IF NOT EXISTS idx_fixed_assets_client ON asset_fixed_assets (client_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fixed_assets_client_code
    ON asset_fixed_assets (client_id, asset_code) WHERE deleted_at IS NULL;
"""

CHECK = """
ALTER TABLE asset_fixed_asset_categories DROP CONSTRAINT IF EXISTS ck_fixed_asset_category_nilai;
ALTER TABLE asset_fixed_asset_categories ADD CONSTRAINT ck_fixed_asset_category_nilai
    CHECK (depreciation_method IN ('straight_line', 'declining_balance', 'none')
           AND (useful_life_months IS NULL OR useful_life_months > 0) AND residual_rate >= 0 AND residual_rate < 100);

ALTER TABLE asset_fixed_assets DROP CONSTRAINT IF EXISTS ck_fixed_asset_nilai;
ALTER TABLE asset_fixed_assets ADD CONSTRAINT ck_fixed_asset_nilai
    CHECK ((status IS NULL OR status IN ('active', 'under_construction', 'inactive', 'disposed'))
           AND (depreciation_method IS NULL OR depreciation_method IN ('straight_line', 'declining_balance', 'none'))
           AND (cost IS NULL OR cost >= 0) AND (residual_value IS NULL OR residual_value >= 0)
           AND (useful_life_months IS NULL OR useful_life_months > 0) AND opening_accumulated_depreciation >= 0);

ALTER TABLE asset_fixed_asset_depreciation_runs DROP CONSTRAINT IF EXISTS ck_fixed_asset_dep_run_status;
ALTER TABLE asset_fixed_asset_depreciation_runs ADD CONSTRAINT ck_fixed_asset_dep_run_status
    CHECK (status IN ('draft', 'approved', 'posted', 'reversed') AND total_amount >= 0);

ALTER TABLE asset_fixed_asset_depreciation_lines DROP CONSTRAINT IF EXISTS ck_fixed_asset_dep_line_amount;
ALTER TABLE asset_fixed_asset_depreciation_lines ADD CONSTRAINT ck_fixed_asset_dep_line_amount CHECK (amount > 0);

ALTER TABLE asset_fixed_asset_disposals DROP CONSTRAINT IF EXISTS ck_fixed_asset_disposal_nilai;
ALTER TABLE asset_fixed_asset_disposals ADD CONSTRAINT ck_fixed_asset_disposal_nilai
    CHECK (method IN ('sold', 'scrapped', 'lost', 'transferred', 'donated')
           AND status IN ('draft', 'pending', 'approved', 'rejected', 'posted', 'reversed') AND proceeds >= 0);

ALTER TABLE asset_fixed_asset_journals DROP CONSTRAINT IF EXISTS ck_fixed_asset_journal_nilai;
ALTER TABLE asset_fixed_asset_journals ADD CONSTRAINT ck_fixed_asset_journal_nilai
    CHECK (journal_type IN ('acquisition', 'depreciation', 'disposal', 'adjustment')
           AND status IN ('posted', 'reversed') AND amount >= 0);

ALTER TABLE asset_fixed_asset_journal_lines DROP CONSTRAINT IF EXISTS ck_fixed_asset_journal_line_nilai;
ALTER TABLE asset_fixed_asset_journal_lines ADD CONSTRAINT ck_fixed_asset_journal_line_nilai
    CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));

ALTER TABLE asset_fixed_asset_report_logs DROP CONSTRAINT IF EXISTS ck_fixed_asset_report_log_format;
ALTER TABLE asset_fixed_asset_report_logs ADD CONSTRAINT ck_fixed_asset_report_log_format
    CHECK (file_format IN ('pdf', 'xlsx', 'csv'));
"""

FUNGSI_KUNCI = """
CREATE OR REPLACE FUNCTION fn_kunci_periode_aset_tetap() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Fixed asset journal ' || OLD.journal_no);
        IF OLD.reversal_date IS NOT NULL THEN
            PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.reversal_date, 'Reversal of ' || OLD.journal_no);
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        -- Membalik jurnal hanya menyentuh periode tanggal pembaliknya.
        IF OLD.status = 'posted' AND NEW.status = 'reversed' AND OLD.journal_date = NEW.journal_date THEN
            PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
            RETURN NEW;
        END IF;
        PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Fixed asset journal ' || OLD.journal_no);
    END IF;
    PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.journal_date, 'Fixed asset journal ' || NEW.journal_no);
    IF NEW.reversal_date IS NOT NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_aset_tetap_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT j.client_id, j.journal_date, j.journal_no FROM asset_fixed_asset_journals j
         WHERE j.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.journal_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.journal_id END)
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.client_id, r.journal_date, 'Fixed asset journal ' || r.journal_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

TRIGGER = [
    ("asset_fixed_asset_journals", "trg_kunci_periode_aset_tetap", "fn_kunci_periode_aset_tetap"),
    ("asset_fixed_asset_journal_lines", "trg_kunci_periode_aset_tetap_line", "fn_kunci_periode_aset_tetap_line"),
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
    print("🔄 MIGRATION: Fixed Assets (kategori, register, penyusutan, disposal, jurnal)")
    print("=" * 60)

    from db_client import (FixedAsset, FixedAssetCategory, FixedAssetDepreciationLine, FixedAssetDepreciationRun,
                           FixedAssetDisposal, FixedAssetJournal, FixedAssetJournalLine, FixedAssetReportLog)

    hasil = {}
    with engine.connect() as connection:
        hasil["buat tabel asset_fixed_asset_categories"] = _buat_tabel(connection, FixedAssetCategory.__tablename__, FixedAssetCategory)
        if "asset_fixed_assets" not in inspect(connection).get_table_names():
            hasil["buat tabel asset_fixed_assets"] = _buat_tabel(connection, FixedAsset.__tablename__, FixedAsset)
        else:
            hasil["kolom baru asset_fixed_assets"] = _jalankan_sql(connection, "kolom baru asset_fixed_assets", KOLOM_ASET)
        for orm in (FixedAssetDepreciationRun, FixedAssetDepreciationLine, FixedAssetDisposal, FixedAssetJournal,
                    FixedAssetJournalLine, FixedAssetReportLog):
            hasil[f"buat tabel {orm.__tablename__}"] = _buat_tabel(connection, orm.__tablename__, orm)

        if all(hasil.values()):
            hasil["check constraint"] = _jalankan_sql(connection, "check constraint", CHECK)
            ada_fungsi_dasar = connection.execute(
                text("SELECT 1 FROM pg_proc WHERE proname = 'fn_tolak_periode_terkunci'")
            ).first()
            if not ada_fungsi_dasar:
                print("❌ Fungsi fn_tolak_periode_terkunci belum ada -- jalankan dulu migrations/33-create_year_end_closing.py.")
                hasil["fungsi dasar kunci periode (migration 33)"] = False
            else:
                hasil["function trigger kunci periode fixed assets"] = _jalankan_sql(
                    connection, "function trigger kunci periode fixed assets", FUNGSI_KUNCI)
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
