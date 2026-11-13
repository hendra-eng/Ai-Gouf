"""
migrations/purchase/34-allow_null_purchase_date.py
====================================================
financial_transaction_purchase_transactions.purchase_date jadi BOLEH NULL.

Alasan: import Purchase (mis. NBM, sheet DETAIL) punya transaksi yang tanggal notanya
kosong di sumber; recipe `tanggal_wajib: false` membiarkannya kosong. Posting tetap
WAJIB bertanggal (db_client.post_purchase... menolak transaksi tanpa purchase_date
kecuali posting_date diisi).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- DROP NOT NULL pada kolom yang sudah
nullable tidak error. Tidak ada data yang diubah/dihapus.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\purchase\\34-allow_null_purchase_date.py
"""

import sys
from pathlib import Path

_DIR = Path(__file__).resolve().parent
for _p in (_DIR, _DIR.parent, _DIR.parent.parent):  # purchase/, migrations/ (_history), backend/ (db_client)
    sys.path.insert(0, str(_p))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=_DIR.parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_purchase_transactions"


def main() -> int:
    print("=" * 60)
    print("MIGRATION: purchase_date boleh NULL")
    print("=" * 60)
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"Tabel '{TABEL}' belum ada -- jalankan dulu migration purchase sebelumnya.")
            return 1
        try:
            connection.execute(text(f"ALTER TABLE {TABEL} ALTER COLUMN purchase_date DROP NOT NULL"))
            connection.commit()
            print("OK: purchase_date sekarang boleh NULL.")
        except (OperationalError, ProgrammingError) as e:
            connection.rollback()
            print(f"GAGAL: {e}")
            return 1
    catat_history(Path(__file__).name)
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())