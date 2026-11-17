"""
migrations/54-add_bank_cash_auto_rule_auto_approve.py
=====================================================
Rekonsiliasi Cash & Bank: kolom BARU financial_transaction_bank_cash_auto_rules.auto_approve
(boolean default false). true = transaksi hasil aturan itu langsung berstatus APPROVED, bukan DRAFT.
Hanya untuk aturan dengan nominal persis (amounts). POST tetap manual (Manager+) di Journal Preview.

Butuh migration 52 (tabel aturan). AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\54-add_bank_cash_auto_rule_auto_approve.py
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

TABEL = "financial_transaction_bank_cash_auto_rules"
KOLOM = "auto_approve"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: kolom auto_approve di bank cash auto rules")
    print("=" * 60)
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel {TABEL} belum ada -- jalankan dulu migrations/52-add_bank_cash_auto_rules.py.")
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
