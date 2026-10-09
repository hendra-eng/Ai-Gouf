"""
migrations/18-add_posting_accounts_to_purchase_transactions.py
================================================================
Alur Approve -> Post Purchase Transaction + akun posting per transaksi.

Sebelumnya jurnal Purchase (tab Preview & baris GL di
db_client.ambil_baris_jurnal_posted_transaksi) memakai akun HARDCODE
Hutang Usaha "2100" & PPN Masukan "1300" -- tidak ada di COA klien mana pun
(mis. SAU: Hutang Usaha 21200001, Pajak Masukan 11300998). Sekarang akun itu
disimpan per transaksi (diisi dari template import / input user), fallback ke
akun lama kalau kosong.

Kolom BARU di financial_transaction_purchase_transactions (semua nullable):
    ap_account_code / ap_account_name     akun Hutang Usaha (Cr)
    tax_account_code / tax_account_name   akun PPN Masukan (Dr)
    approved_at                           kapan di-approve (status 'approved')

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- ADD COLUMN IF NOT EXISTS, tidak
ada data yang diubah. Perbaikan akun 85 draft SAU hasil upload dilakukan
terpisah lewat migrations/19-fix_sau_purchase_accounts.py.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\18-add_posting_accounts_to_purchase_transactions.py
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

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine

TABEL = "financial_transaction_purchase_transactions"
KOLOM = [
    ("ap_account_code", "VARCHAR(50)"),
    ("ap_account_name", "VARCHAR(255)"),
    ("tax_account_code", "VARCHAR(50)"),
    ("tax_account_name", "VARCHAR(255)"),
    ("approved_at", "TIMESTAMPTZ"),
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: akun posting & approved_at di Purchase Transaction")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada -- jalankan dulu 12-create_financial_transaction_purchase_tables.py.")
            return 1
        for nama, tipe in KOLOM:
            try:
                connection.execute(text(f"ALTER TABLE {TABEL} ADD COLUMN IF NOT EXISTS {nama} {tipe}"))
                connection.commit()
                print(f"✅ Kolom '{TABEL}.{nama}' siap.")
                hasil[f"kolom {nama}"] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal menambah kolom '{nama}': {e}")
                hasil[f"kolom {nama}"] = False

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
