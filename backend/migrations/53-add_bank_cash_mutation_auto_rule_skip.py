"""
migrations/53-add_bank_cash_mutation_auto_rule_skip.py
======================================================
Rekonsiliasi Cash & Bank: kolom BARU financial_transaction_bank_cash_mutations.auto_rule_skip
(boolean default false). true = baris pernah di-unmatch / draft-nya dihapus / jurnalnya dibalik
oleh user, jadi aturan otomatis (migration 52) tidak mencatatnya ulang.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\53-add_bank_cash_mutation_auto_rule_skip.py
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

TABEL = "financial_transaction_bank_cash_mutations"
KOLOM = "auto_rule_skip"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: kolom auto_rule_skip di bank cash mutations")
    print("=" * 60)
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel {TABEL} belum ada -- jalankan dulu migrations/34-create_bank_cash_tables.py.")
            return 1
        if KOLOM in {c["name"] for c in inspect(connection).get_columns(TABEL)}:
            print(f"⏭️  kolom {KOLOM} sudah ada, skip.")
        else:
            raw = connection.connection
            try:
                with raw.cursor() as cur:
                    cur.execute(f"ALTER TABLE {TABEL} ADD COLUMN {KOLOM} BOOLEAN NOT NULL DEFAULT false;")
                raw.commit()
                print(f"✅ kolom {KOLOM} siap.")
            except Exception as e:
                raw.rollback()
                print(f"❌ Gagal menambah kolom {KOLOM}: {e}")
                return 1
    print("✅ SEMUA migration berhasil!")
    catat_history(Path(__file__).name)
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
