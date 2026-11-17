"""
migrations/55-add_bank_cash_auto_match_controls.py
==================================================
Rekonsiliasi Cash & Bank -- kontrol auto-rekonsil yang bisa diatur accounting (permintaan klien, gaya Jurnal.id):

  financial_transaction_bank_cash_settings (1 baris per klien), kolom BARU:
    auto_match_ar / auto_match_ap / auto_match_rules   on/off per jenis auto-match (default true = perilaku lama)
    auto_approve_ar / auto_approve_ap                  hasil match invoice langsung APPROVED (default false)
    auto_include_low_confidence                        baris confidence rendah ikut diproses, selalu DRAFT (default false)

  financial_transaction_bank_cash_auto_rules, kolom BARU:
    kind, keyword_mode, exclude_keywords, reference_keywords, counterparty_keywords,
    min_amount, amount_tolerance, priority
  + counter_coa_id jadi boleh NULL (aturan invoice tidak punya akun lawan)
  + constraint nominal: aturan invoice tidak wajib punya amounts / max_amount.

Semua default mempertahankan perilaku lama. Butuh migration 51, 52, 54.
AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\55-add_bank_cash_auto_match_controls.py
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

T_SET = "financial_transaction_bank_cash_settings"
T_RULE = "financial_transaction_bank_cash_auto_rules"

KOLOM_SET = {
    "auto_match_ar": "BOOLEAN NOT NULL DEFAULT true",
    "auto_match_ap": "BOOLEAN NOT NULL DEFAULT true",
    "auto_match_rules": "BOOLEAN NOT NULL DEFAULT true",
    "auto_approve_ar": "BOOLEAN NOT NULL DEFAULT false",
    "auto_approve_ap": "BOOLEAN NOT NULL DEFAULT false",
    "auto_include_low_confidence": "BOOLEAN NOT NULL DEFAULT false",
}
KOLOM_RULE = {
    "kind": "VARCHAR(10) NOT NULL DEFAULT 'account'",
    "keyword_mode": "VARCHAR(5) NOT NULL DEFAULT 'any'",
    "exclude_keywords": "TEXT",
    "reference_keywords": "TEXT",
    "counterparty_keywords": "TEXT",
    "min_amount": "NUMERIC(24,2)",
    "amount_tolerance": "NUMERIC(24,2)",
    "priority": "INTEGER NOT NULL DEFAULT 100",
}


def _tambah_kolom(raw, tabel: str, kolom: dict, ada: set) -> None:
    with raw.cursor() as cur:
        for nama, ddl in kolom.items():
            if nama in ada:
                print(f"⏭️  {tabel}.{nama} sudah ada, skip.")
                continue
            cur.execute(f"ALTER TABLE {tabel} ADD COLUMN {nama} {ddl};")
            print(f"✅ {tabel}.{nama} ditambahkan.")


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: kontrol auto-rekonsil Cash & Bank")
    print("=" * 60)
    with engine.connect() as connection:
        tabel_ada = set(inspect(connection).get_table_names())
        for t, hint in ((T_SET, "51"), (T_RULE, "52")):
            if t not in tabel_ada:
                print(f"❌ Tabel {t} belum ada -- jalankan dulu migration {hint}.")
                return 1
        kol_set = {c["name"] for c in inspect(connection).get_columns(T_SET)}
        kol_rule = {c["name"] for c in inspect(connection).get_columns(T_RULE)}
        raw = connection.connection
        try:
            _tambah_kolom(raw, T_SET, KOLOM_SET, kol_set)
            _tambah_kolom(raw, T_RULE, KOLOM_RULE, kol_rule)
            with raw.cursor() as cur:
                cur.execute(f"ALTER TABLE {T_RULE} ALTER COLUMN counter_coa_id DROP NOT NULL;")
                cur.execute(f"ALTER TABLE {T_RULE} DROP CONSTRAINT IF EXISTS ck_bank_cash_auto_rule_nominal;")
                cur.execute(
                    f"ALTER TABLE {T_RULE} ADD CONSTRAINT ck_bank_cash_auto_rule_nominal "
                    "CHECK (amounts IS NOT NULL OR max_amount IS NOT NULL OR kind = 'invoice');"
                )
                cur.execute(f"ALTER TABLE {T_RULE} DROP CONSTRAINT IF EXISTS ck_bank_cash_auto_rule_kind;")
                cur.execute(
                    f"ALTER TABLE {T_RULE} ADD CONSTRAINT ck_bank_cash_auto_rule_kind "
                    "CHECK (kind IN ('account', 'invoice'));"
                )
            raw.commit()
            print("✅ constraint & kolom aturan siap.")
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
