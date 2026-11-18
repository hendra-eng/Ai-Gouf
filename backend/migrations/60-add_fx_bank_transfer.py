"""
migrations/59-add_fx_bank_transfer.py
=====================================
Fase 3B/3C fitur kurs: rekening kas/bank VALAS, transfer antar rekening beda mata uang, dan revaluasi saldo bank valas
-- modul modules/finance/fx_bank_v1.py (/api/v1/finance/fx-bank/...) + perluasan fx_revaluation_v1.py.

Yang dibuat:
  - tabel finance_fx_bank_accounts  (dari ORM FxBankAccount): penanda rekening kas/bank valas + saldo valas awal
  - tabel finance_fx_transfers      (dari ORM FxTransfer): transfer antar mata uang
  - kolom financial_transaction_bank_cash_transactions.fx_amount / fx_rate: nominal VALAS transaksi di rekening valas

Prasyarat: migration 56, 57, 58. Akun FX Gain/Loss terealisasi & belum terealisasi diatur di
Settings > Account Mapping > Foreign Exchange.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\59-add_fx_bank_transfer.py
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

T_TX = "financial_transaction_bank_cash_transactions"
TABEL_BARU = ("finance_fx_bank_accounts", "finance_fx_transfers")
KOLOM = [("fx_amount", "NUMERIC(24,2)"), ("fx_rate", "NUMERIC(24,6)")]
CONSTRAINT = f"""
ALTER TABLE {T_TX} DROP CONSTRAINT IF EXISTS ck_bank_cash_tx_fx;
ALTER TABLE {T_TX} ADD CONSTRAINT ck_bank_cash_tx_fx CHECK ((fx_amount IS NULL OR fx_amount > 0) AND (fx_rate IS NULL OR fx_rate > 0));
"""


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
    print("🔄 MIGRATION: rekening bank valas + transfer antar mata uang")
    print("=" * 60)

    from db_client import Base, FxBankAccount, FxTransfer

    hasil = {}
    with engine.connect() as connection:
        ada_tabel = set(inspect(connection).get_table_names())
        if T_TX not in ada_tabel:
            print(f"❌ Tabel {T_TX} belum ada -- jalankan migration sebelumnya dulu.")
            return 1
        for model in (FxBankAccount, FxTransfer):
            nama = model.__table__.name
            if nama in ada_tabel:
                print(f"⏭️  Tabel '{nama}' sudah ada, skip.")
                hasil[nama] = True
                continue
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[model.__table__])
                connection.commit()
                print(f"✅ Tabel '{nama}' berhasil dibuat.")
                hasil[nama] = True
            except Exception as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{nama}': {e}")
                hasil[nama] = False
        ada = {c["name"] for c in inspect(connection).get_columns(T_TX)}
        for nama, tipe in KOLOM:
            label = f"{T_TX}.{nama}"
            if nama in ada:
                print(f"⏭️  {label} sudah ada, skip.")
                hasil[label] = True
            else:
                hasil[label] = _jalankan_sql(connection, label, f"ALTER TABLE {T_TX} ADD COLUMN {nama} {tipe};")
        hasil["constraint"] = _jalankan_sql(connection, "constraint valas header", CONSTRAINT)

    print()
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<80}: {'✅' if v else '❌'}")
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
