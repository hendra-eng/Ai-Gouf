"""
migrations/52-add_bank_cash_auto_rules.py
=========================================
Rekonsiliasi Cash & Bank: ATURAN OTOMATIS untuk mutasi tanpa invoice yang berulang
(biaya admin bank 2.500 / 6.500, bunga, pajak bunga, dst) + opsi auto-match saat upload.

  1. Tabel BARU financial_transaction_bank_cash_auto_rules
       (arah, kata kunci, nominal persis / batas nominal, akun lawan, kategori).
  2. Kolom BARU financial_transaction_bank_cash_settings.auto_match_on_upload
       boolean default false -- true = auto-match jalan sendiri setelah file di-upload.

Hasil aturan SELALU transaksi DRAFT (Approve -> Post tetap manual di Journal Preview).

WAJIB dijalankan SEBELUM backend baru dipakai (ORM sudah membaca tabel/kolom baru).
Butuh migration 51 (tabel settings). AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\52-add_bank_cash_auto_rules.py
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

TABEL_ATURAN = "financial_transaction_bank_cash_auto_rules"
TABEL_SETTING = "financial_transaction_bank_cash_settings"


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
    print("🔄 MIGRATION: aturan otomatis rekonsiliasi Cash & Bank")
    print("=" * 60)

    from db_client import Base, BankCashAutoRule

    hasil = {}
    with engine.connect() as connection:
        tabel = inspect(connection).get_table_names()
        if TABEL_SETTING not in tabel:
            print(f"❌ Tabel {TABEL_SETTING} belum ada -- jalankan dulu migrations/51-add_bank_cash_adjustment.py.")
            return 1

        if TABEL_ATURAN in tabel:
            print(f"⏭️  Tabel '{TABEL_ATURAN}' sudah ada, skip.")
            hasil[f"tabel {TABEL_ATURAN}"] = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[BankCashAutoRule.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL_ATURAN}' berhasil dibuat.")
                hasil[f"tabel {TABEL_ATURAN}"] = True
            except Exception as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL_ATURAN}': {e}")
                hasil[f"tabel {TABEL_ATURAN}"] = False

        ada = {c["name"] for c in inspect(connection).get_columns(TABEL_SETTING)}
        if "auto_match_on_upload" in ada:
            print("⏭️  kolom auto_match_on_upload sudah ada, skip.")
            hasil["kolom auto_match_on_upload"] = True
        else:
            hasil["kolom auto_match_on_upload"] = _jalankan_sql(
                connection, "kolom auto_match_on_upload",
                f"ALTER TABLE {TABEL_SETTING} ADD COLUMN auto_match_on_upload BOOLEAN NOT NULL DEFAULT false;",
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
