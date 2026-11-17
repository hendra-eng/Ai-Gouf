"""
migrations/57-add_foreign_currency_ar_ap.py
===========================================
Fase 2 fitur kurs: mata uang asing di invoice AR / bill AP + pelunasan dengan selisih kurs terealisasi.

Kolom BARU (semua nullable / berdefault, data lama tidak berubah):
  financial_transaction_sales_invoices
      currency         varchar(10)   NOT NULL default 'IDR'
      exchange_rate    numeric(24,6) NOT NULL default 1      -- IDR per 1 unit mata uang asing, kurs pencatatan
      foreign_amount   numeric(24,2) NULL                    -- total tagihan dalam mata uang asing (NULL = invoice IDR)
  financial_transaction_purchase_transactions   (currency sudah ada)
      exchange_rate    numeric(24,6) NOT NULL default 1
      foreign_amount   numeric(24,2) NULL
  financial_transaction_bank_cash_transaction_lines
      fx_amount        numeric(24,2) NULL                    -- nominal valas yang dilunasi baris ini
      fx_rate          numeric(24,6) NULL                    -- kurs pelunasan (IDR per 1 unit)
      is_fx_difference boolean NOT NULL default false        -- baris selisih kurs terealisasi (akun FX Gain/Loss)

Aturan data: SEMUA nominal utama (dpp/ppn/gross_amount/paid_amount, total/accounts_payable, debit/credit) tetap IDR,
jadi GL, aging, dan laporan keuangan tidak berubah. Kolom valas hanya MENAMBAH informasi.

Akun FX Gain/Loss terealisasi TIDAK disimpan di sini: diatur di Settings > Account Mapping
(grup "Foreign Exchange": fx_gain_realized, fx_loss_realized) -- tanpa migration.

WAJIB dijalankan SEBELUM backend baru dipakai (ORM sudah membaca kolom baru).
AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\57-add_foreign_currency_ar_ap.py
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

T_SALES = "financial_transaction_sales_invoices"
T_PURCHASE = "financial_transaction_purchase_transactions"
T_BARIS = "financial_transaction_bank_cash_transaction_lines"

KOLOM = {
    T_SALES: [
        ("currency", "VARCHAR(10) NOT NULL DEFAULT 'IDR'"),
        ("exchange_rate", "NUMERIC(24,6) NOT NULL DEFAULT 1"),
        ("foreign_amount", "NUMERIC(24,2)"),
    ],
    T_PURCHASE: [
        ("exchange_rate", "NUMERIC(24,6) NOT NULL DEFAULT 1"),
        ("foreign_amount", "NUMERIC(24,2)"),
    ],
    T_BARIS: [
        ("fx_amount", "NUMERIC(24,2)"),
        ("fx_rate", "NUMERIC(24,6)"),
        ("is_fx_difference", "BOOLEAN NOT NULL DEFAULT false"),
    ],
}

CONSTRAINT = f"""
ALTER TABLE {T_SALES} DROP CONSTRAINT IF EXISTS ck_sales_invoice_exchange_rate;
ALTER TABLE {T_SALES} ADD CONSTRAINT ck_sales_invoice_exchange_rate CHECK (exchange_rate > 0);
ALTER TABLE {T_PURCHASE} DROP CONSTRAINT IF EXISTS ck_purchase_exchange_rate;
ALTER TABLE {T_PURCHASE} ADD CONSTRAINT ck_purchase_exchange_rate CHECK (exchange_rate > 0);
ALTER TABLE {T_BARIS} DROP CONSTRAINT IF EXISTS ck_bank_cash_line_fx;
ALTER TABLE {T_BARIS} ADD CONSTRAINT ck_bank_cash_line_fx
  CHECK ((is_fx_difference = false OR line_type = 'account')
         AND (fx_rate IS NULL OR fx_rate > 0)
         AND (fx_amount IS NULL OR fx_amount >= 0));
"""

INDEX = f"""
CREATE INDEX IF NOT EXISTS idx_sales_invoices_currency ON {T_SALES} (management_client_id, currency) WHERE currency <> 'IDR';
CREATE INDEX IF NOT EXISTS idx_bank_cash_line_fx ON {T_BARIS} (transaction_id) WHERE is_fx_difference;
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
    print("🔄 MIGRATION: mata uang asing di AR / AP + selisih kurs terealisasi")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        tabel_ada = set(inspect(connection).get_table_names())
        for tabel, daftar in KOLOM.items():
            if tabel not in tabel_ada:
                print(f"❌ Tabel {tabel} belum ada -- jalankan migration sebelumnya dulu.")
                return 1
            ada = {c["name"] for c in inspect(connection).get_columns(tabel)}
            for nama, tipe in daftar:
                label = f"{tabel}.{nama}"
                if nama in ada:
                    print(f"⏭️  {label} sudah ada, skip.")
                    hasil[label] = True
                else:
                    hasil[label] = _jalankan_sql(connection, label, f"ALTER TABLE {tabel} ADD COLUMN {nama} {tipe};")
        hasil["constraint"] = _jalankan_sql(connection, "constraint valas", CONSTRAINT)
        hasil["index"] = _jalankan_sql(connection, "index valas", INDEX)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
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
