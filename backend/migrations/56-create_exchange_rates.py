"""
migrations/56-create_exchange_rates.py
======================================
Master kurs (Management > Exchange Rates) -- modul
modules/management/exchange_rates_v1.py.

Membuat tabel management_exchange_rates (dari ORM ExchangeRate di db_client.py):
GLOBAL, 1 baris = IDR per 1 unit mata uang pada satu tanggal, per jenis kurs
(middle / buy / sell / tax). Unik per (currency, rate_date, rate_type).

Mengisi kurs awal TIDAK dilakukan di sini -- input manual, impor tempel, atau tombol
"Fetch rates" di halaman Exchange Rates.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\56-create_exchange_rates.py
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

TABEL = "management_exchange_rates"


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: master kurs (management_exchange_rates)")
    print("=" * 60)

    from db_client import Base, ExchangeRate

    with engine.connect() as connection:
        if TABEL in inspect(connection).get_table_names():
            print(f"⏭️  Tabel '{TABEL}' sudah ada, skip.")
            ok = True
        else:
            try:
                Base.metadata.create_all(bind=connection.engine, tables=[ExchangeRate.__table__])
                connection.commit()
                print(f"✅ Tabel '{TABEL}' berhasil dibuat.")
                ok = True
            except Exception as e:
                connection.rollback()
                print(f"❌ Gagal buat tabel '{TABEL}': {e}")
                ok = False

    print("=" * 60)
    if ok:
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Migration gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
