"""
migrations/14-add_management_client_id_to_transactions.py
===========================================================
Tambah kolom `management_client_id` (FK management_clients.id, nullable)
ke header 3 fitur Transactions, supaya laporan Financial Statements bisa
difilter per client (dropdown "Switch Company" di Topbar):

    1. financial_transaction_sales_invoices
    2. financial_transaction_journal_entry_drafts
    3. financial_transaction_purchase_transactions

Sebelumnya tabel-tabel ini cuma punya client_id = akun yang login
(management_users), jadi data semua client tercampur.

Backfill data lama:
    - Sales invoice: dari source_row -> source_file.management_client_id
      (setiap invoice hasil upload pasti punya jejak ini).
    - JE draft hasil import (source_type 'Import%'): kalau SEMUA template
      import JE milik tepat SATU client, draft import tanpa client diisi
      client tsb. Kalau template-nya milik >1 client, tidak bisa dipastikan
      -> dibiarkan NULL (tidak muncul di laporan client mana pun) & dilaporkan.
    - Purchase: tidak ada jejak client -> dibiarkan NULL.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- kolom/index/FK yang sudah ada
di-skip, backfill cuma mengisi baris yang masih NULL.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\14-add_management_client_id_to_transactions.py
"""

import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import os
if not os.environ.get("DATABASE_URL"):
    sys.exit(
        "❌ DATABASE_URL tidak terbaca dari backend/.env.\n"
        "   Jalankan pakai Python venv project (butuh python-dotenv):\n"
        "   venv\\Scripts\\python migrations\\14-add_management_client_id_to_transactions.py"
    )

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine
from _history import catat_history

TABEL = [
    ("financial_transaction_sales_invoices", "fk_sales_invoices_management_client", "idx_sales_invoices_management_client"),
    ("financial_transaction_journal_entry_drafts", "fk_je_drafts_management_client", "idx_je_drafts_management_client"),
    ("financial_transaction_purchase_transactions", "fk_purchase_transactions_management_client", "idx_purchase_transactions_management_client"),
]


def _tambah_kolom(connection, tabel: str, nama_fk: str, nama_index: str) -> bool:
    insp = inspect(connection)
    if tabel not in insp.get_table_names():
        print(f"⏭️  Tabel '{tabel}' belum ada, skip (jalankan migration pembuatnya dulu).")
        return True
    try:
        if "management_client_id" not in [c["name"] for c in insp.get_columns(tabel)]:
            connection.execute(text(f"ALTER TABLE {tabel} ADD COLUMN management_client_id UUID"))
            print(f"✅ Kolom '{tabel}.management_client_id' ditambahkan.")
        else:
            print(f"⏭️  Kolom '{tabel}.management_client_id' sudah ada, skip.")
        if nama_fk not in [fk.get("name") for fk in insp.get_foreign_keys(tabel)]:
            connection.execute(text(
                f"ALTER TABLE {tabel} ADD CONSTRAINT {nama_fk} "
                f"FOREIGN KEY (management_client_id) REFERENCES management_clients(id)"
            ))
            print(f"✅ FK '{nama_fk}' ditambahkan.")
        connection.execute(text(f"CREATE INDEX IF NOT EXISTS {nama_index} ON {tabel} (management_client_id)"))
        connection.commit()
        return True
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal menambah kolom di '{tabel}': {e}")
        connection.rollback()
        return False


def _backfill(connection) -> bool:
    try:
        n = connection.execute(text("""
            UPDATE financial_transaction_sales_invoices i
               SET management_client_id = f.management_client_id
              FROM financial_transaction_sales_source_rows r
              JOIN financial_transaction_sales_source_files f ON f.id = r.source_file_id
             WHERE i.source_row_id = r.id AND i.management_client_id IS NULL
        """)).rowcount
        print(f"✅ Backfill Sales invoice: {n} baris.")

        pemilik = [r[0] for r in connection.execute(text(
            "SELECT DISTINCT client_id FROM financial_transaction_journal_entry_import_templates WHERE deleted_at IS NULL"
        )).fetchall()]
        if len(pemilik) == 1:
            n = connection.execute(text("""
                UPDATE financial_transaction_journal_entry_drafts
                   SET management_client_id = :cid
                 WHERE management_client_id IS NULL AND source_type LIKE 'Import%'
            """), {"cid": pemilik[0]}).rowcount
            print(f"✅ Backfill JE draft hasil import: {n} baris -> client {pemilik[0]}.")
        else:
            print(f"⚠️  Template import JE dimiliki {len(pemilik)} client -- draft import lama tidak di-backfill otomatis.")

        sisa = {
            t: connection.execute(text(f"SELECT COUNT(*) FROM {t} WHERE management_client_id IS NULL")).scalar()
            for t, _, _ in TABEL
        }
        for t, jumlah in sisa.items():
            if jumlah:
                print(f"ℹ️  {t}: {jumlah} baris masih tanpa client (tidak akan muncul di Financial Statements client mana pun).")
        connection.commit()
        return True
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal backfill: {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: management_client_id di header transaksi (Sales/JE/Purchase)")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        for tabel, nama_fk, nama_index in TABEL:
            hasil[f"kolom {tabel}.management_client_id"] = _tambah_kolom(connection, tabel, nama_fk, nama_index)
        if all(hasil.values()):
            hasil["backfill data lama"] = _backfill(connection)

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
    sys.exit(main())
