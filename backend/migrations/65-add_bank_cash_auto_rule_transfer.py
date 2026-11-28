"""
migrations/65-add_bank_cash_auto_rule_transfer.py
=================================================
Rekonsiliasi Cash & Bank: ATURAN TRANSFER antar akun bank sendiri (mis. BCA -> BRI).

  financial_transaction_bank_cash_auto_rules:
    - kind sekarang boleh 'transfer' (selain 'account' dan 'invoice').
      counter_coa_id = akun BANK/KAS lawan. Nominal (amounts / max_amount) boleh kosong.
    - kolom BARU require_pair BOOLEAN default true: aturan hanya mencatat kalau baris pasangan di akun lawan
      sudah ada dan pasti (nominal sama, arah berlawanan, <= 5 hari, tanpa kandidat setara).
  Hasil aturan = SATU jurnal transfer DRAFT + baris pasangan ditautkan tanpa jurnal baru (tidak ada jurnal ganda).

Butuh migration 52 dan 55. AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv/bin/python migrations/65-add_bank_cash_auto_rule_transfer.py
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


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: aturan transfer antar akun bank")
    print("=" * 60)
    with engine.connect() as connection:
        insp = inspect(connection)
        if TABEL not in insp.get_table_names():
            print(f"❌ Tabel {TABEL} belum ada -- jalankan dulu migration 52 dan 55.")
            return 1
        kolom = {c["name"] for c in insp.get_columns(TABEL)}
        if "kind" not in kolom:
            print("❌ Kolom kind belum ada -- jalankan dulu migrations/55-add_bank_cash_auto_match_controls.py.")
            return 1
        raw = connection.connection
        try:
            with raw.cursor() as cur:
                if "require_pair" in kolom:
                    print("⏭️  kolom require_pair sudah ada, skip.")
                else:
                    cur.execute(f"ALTER TABLE {TABEL} ADD COLUMN require_pair BOOLEAN NOT NULL DEFAULT true;")
                    print("✅ kolom require_pair ditambahkan.")
                cur.execute(f"ALTER TABLE {TABEL} DROP CONSTRAINT IF EXISTS ck_bank_cash_auto_rule_kind;")
                cur.execute(
                    f"ALTER TABLE {TABEL} ADD CONSTRAINT ck_bank_cash_auto_rule_kind "
                    "CHECK (kind IN ('account', 'invoice', 'transfer'));"
                )
                cur.execute(f"ALTER TABLE {TABEL} DROP CONSTRAINT IF EXISTS ck_bank_cash_auto_rule_nominal;")
                cur.execute(
                    f"ALTER TABLE {TABEL} ADD CONSTRAINT ck_bank_cash_auto_rule_nominal "
                    "CHECK (amounts IS NOT NULL OR max_amount IS NOT NULL OR kind IN ('invoice', 'transfer'));"
                )
            raw.commit()
            print("✅ constraint kind & nominal siap.")
        except Exception as e:
            raw.rollback()
            print(f"❌ Gagal: {e}")
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
