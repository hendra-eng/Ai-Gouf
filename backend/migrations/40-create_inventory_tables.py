"""
migrations/40-create_inventory_tables.py
========================================
Inventory (grup Assets & Equity) -- modul modules/assets_and_equity/
inventory_v1.py, UI dataset/picture/Template UI/Inventory/1-8.jpeg.

Membuat 8 tabel (dari ORM di db_client.py):

    asset_inventory_warehouses        gudang / lokasi stok
    asset_inventory_categories        kategori item + akun COA (persediaan, HPP, selisih)
    asset_inventory_items             master item
    asset_inventory_documents         dokumen stok: opening / receipt / issue / adjustment / transfer
    asset_inventory_document_lines    baris dokumen
    asset_inventory_movements         kartu stok (dari dokumen posted)
    asset_inventory_journals          jurnal INV-YYYY-#### (sumber GL "inventory")
    asset_inventory_journal_lines     baris jurnal

+ CHECK nilai status/tipe, trigger kunci periode (Year-End Closing) untuk
  jurnal Inventory (butuh fn_tolak_periode_terkunci dari migration 33).

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\40-create_inventory_tables.py
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
ALTER TABLE asset_inventory_items DROP CONSTRAINT IF EXISTS ck_inventory_item_nilai;
ALTER TABLE asset_inventory_items ADD CONSTRAINT ck_inventory_item_nilai
    CHECK (status IN ('active', 'inactive') AND min_stock >= 0 AND (reorder_qty IS NULL OR reorder_qty >= 0));

ALTER TABLE asset_inventory_documents DROP CONSTRAINT IF EXISTS ck_inventory_document_nilai;
ALTER TABLE asset_inventory_documents ADD CONSTRAINT ck_inventory_document_nilai
    CHECK (doc_type IN ('opening', 'receipt', 'issue', 'adjustment', 'transfer')
           AND status IN ('draft', 'posted', 'void')
           AND (source_type IS NULL OR source_type IN ('purchase', 'sales'))
           AND (doc_type <> 'transfer' OR (to_warehouse_id IS NOT NULL AND to_warehouse_id <> warehouse_id)));

ALTER TABLE asset_inventory_document_lines DROP CONSTRAINT IF EXISTS ck_inventory_document_line_qty;
ALTER TABLE asset_inventory_document_lines ADD CONSTRAINT ck_inventory_document_line_qty
    CHECK (quantity <> 0 AND (unit_cost IS NULL OR unit_cost >= 0));

ALTER TABLE asset_inventory_movements DROP CONSTRAINT IF EXISTS ck_inventory_movement_nilai;
ALTER TABLE asset_inventory_movements ADD CONSTRAINT ck_inventory_movement_nilai
    CHECK (qty_in >= 0 AND qty_out >= 0 AND value_in >= 0 AND value_out >= 0 AND unit_cost >= 0);

ALTER TABLE asset_inventory_journals DROP CONSTRAINT IF EXISTS ck_inventory_journal_nilai;
ALTER TABLE asset_inventory_journals ADD CONSTRAINT ck_inventory_journal_nilai
    CHECK (journal_type IN ('receipt', 'issue', 'adjustment') AND status IN ('posted', 'reversed') AND amount >= 0);

ALTER TABLE asset_inventory_journal_lines DROP CONSTRAINT IF EXISTS ck_inventory_journal_line_nilai;
ALTER TABLE asset_inventory_journal_lines ADD CONSTRAINT ck_inventory_journal_line_nilai
    CHECK (debit >= 0 AND credit >= 0 AND NOT (debit > 0 AND credit > 0));
"""
FUNGSI_KUNCI = """
CREATE OR REPLACE FUNCTION fn_kunci_periode_persediaan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Inventory journal ' || OLD.journal_no);
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
        PERFORM fn_tolak_periode_terkunci(OLD.client_id, OLD.journal_date, 'Inventory journal ' || OLD.journal_no);
    END IF;
    PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.journal_date, 'Inventory journal ' || NEW.journal_no);
    IF NEW.reversal_date IS NOT NULL THEN
        PERFORM fn_tolak_periode_terkunci(NEW.client_id, NEW.reversal_date, 'Reversal of ' || NEW.journal_no);
    END IF;
    RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION fn_kunci_periode_persediaan_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT j.client_id, j.journal_date, j.journal_no FROM asset_inventory_journals j
         WHERE j.id IN (CASE WHEN TG_OP <> 'INSERT' THEN OLD.journal_id END, CASE WHEN TG_OP <> 'DELETE' THEN NEW.journal_id END)
    LOOP
        PERFORM fn_tolak_periode_terkunci(r.client_id, r.journal_date, 'Inventory journal ' || r.journal_no);
    END LOOP;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
END $$;
"""

TRIGGER = [
    ("asset_inventory_journals", "trg_kunci_periode_persediaan", "fn_kunci_periode_persediaan"),
    ("asset_inventory_journal_lines", "trg_kunci_periode_persediaan_line", "fn_kunci_periode_persediaan_line"),
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
    print("🔄 MIGRATION: Inventory (gudang, kategori, item, dokumen stok, kartu stok, jurnal)")
    print("=" * 60)

    from db_client import (InventoryCategory, InventoryDocument, InventoryDocumentLine, InventoryItem, InventoryJournal,
                           InventoryJournalLine, InventoryMovement, InventoryWarehouse)

    hasil = {}
    with engine.connect() as connection:
        for orm in (InventoryWarehouse, InventoryCategory, InventoryItem, InventoryDocument, InventoryDocumentLine,
                    InventoryMovement, InventoryJournal, InventoryJournalLine):
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
                hasil["function trigger kunci periode inventory"] = _jalankan_sql(
                    connection, "function trigger kunci periode inventory", FUNGSI_KUNCI)
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
