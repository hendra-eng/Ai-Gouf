"""
migrations/51-add_bank_cash_adjustment.py
=========================================
Rekonsiliasi Cash & Bank: ADJUSTMENT selisih kecil (biaya admin bank / diskon / pembulatan)
saat mutasi bank dicocokkan ke invoice (modules/transactions/bank_cash_willi.py).

  1. Tabel BARU financial_transaction_bank_cash_settings (1 baris per klien):
       adjustment_enabled  boolean       default true
       adjustment_limit    numeric(24,2) default 100   -- batas selisih PER MATCH (rupiah)
  2. Kolom BARU di financial_transaction_bank_cash_transaction_lines:
       is_adjustment        boolean     default false
       adjustment_category  varchar(30) bank_fee / discount / rounding
       adjustment_type      varchar(10) expense / income
     + CHECK ck_bank_cash_line_adjustment: baris adjustment harus line_type 'account'
       dan bertipe expense/income.
  3. Index parsial untuk laporan total adjustment per periode.

Akun tujuan selisih TIDAK disimpan di sini: diatur di Settings > Account Mapping
(grup "Bank & Cash": bank_adjustment_expense, bank_adjustment_income) -- tanpa migration.

WAJIB dijalankan SEBELUM backend baru dipakai (ORM sudah membaca kolom baru).
AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\51-add_bank_cash_adjustment.py
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

TABEL_SETTING = "financial_transaction_bank_cash_settings"
TABEL_BARIS = "financial_transaction_bank_cash_transaction_lines"

KOLOM_BARIS = [
    ("is_adjustment", "BOOLEAN NOT NULL DEFAULT false"),
    ("adjustment_category", "VARCHAR(30)"),
    ("adjustment_type", "VARCHAR(10)"),
]

CONSTRAINT_ADJUSTMENT = f"""
ALTER TABLE {TABEL_BARIS} DROP CONSTRAINT IF EXISTS ck_bank_cash_line_adjustment;
ALTER TABLE {TABEL_BARIS} ADD CONSTRAINT ck_bank_cash_line_adjustment
  CHECK (is_adjustment = false OR (line_type = 'account' AND adjustment_type IN ('expense', 'income')));
"""

INDEX_ADJUSTMENT = (
    f"CREATE INDEX IF NOT EXISTS idx_bank_cash_line_adjustment ON {TABEL_BARIS} (transaction_id) "
    f"WHERE is_adjustment;"
)


def _jalankan_sql(connection, label: str, sql: str) -> bool:
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
    print("🔄 MIGRATION: adjustment selisih kecil rekonsiliasi Cash & Bank")
    print("=" * 60)

    from db_client import Base, BankCashSetting

    hasil = {}
    with engine.connect() as connection:
        if TABEL_BARIS not in inspect(connection).get_table_names():
            print(f"❌ Tabel {TABEL_BARIS} belum ada -- jalankan dulu migrations/34-create_bank_cash_tables.py.")
            return 1

        if TABEL_SETTING in inspect(connection).get_table_names():
            print(f"⏭️  Tabel '{TABEL_SETTING}' sudah ada, skip.")
            hasil[f"tabel {TABEL_SETTING}"] = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[BankCashSetting.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL_SETTING}' berhasil dibuat.")
                hasil[f"tabel {TABEL_SETTING}"] = True
            except Exception as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL_SETTING}': {e}")
                hasil[f"tabel {TABEL_SETTING}"] = False

        ada = {c["name"] for c in inspect(connection).get_columns(TABEL_BARIS)}
        for nama, tipe in KOLOM_BARIS:
            label = f"kolom {nama}"
            if nama in ada:
                print(f"⏭️  {label} sudah ada, skip.")
                hasil[label] = True
            else:
                hasil[label] = _jalankan_sql(connection, label, f"ALTER TABLE {TABEL_BARIS} ADD COLUMN {nama} {tipe};")
        hasil["ck baris adjustment"] = _jalankan_sql(connection, "ck baris adjustment", CONSTRAINT_ADJUSTMENT)
        hasil["index adjustment"] = _jalankan_sql(connection, "index adjustment", INDEX_ADJUSTMENT)

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
