"""
migrations/32-repoint_sales_client_id_fk_to_management_clients.py
==================================================================
Memindahkan FK client_id di 5 tabel Sales dari management_users(id_user)
ke management_clients(id):

    financial_transaction_sales_source_files
    financial_transaction_sales_source_rows
    financial_transaction_sales_account_mappings
    financial_transaction_sales_activity_log
    financial_transaction_sales_exceptions

Hasil merge playground-hendra (commit ab7d130 & 7086b34): model ORM di
db_client.py sudah menunjuk client_id -> management_clients, dan
sales_import_v1.py (upload & promote-to-invoices) mengisi client_id dengan
id KLIEN, bukan id user. Di Supabase playground-hendra constraint-nya sudah
diubah; di DB playground-willi BELUM, sehingga setiap upload file sales gagal:
    ForeignKeyViolation: financial_transaction_sales_source_files_client_id_fkey
    Key (client_id)=(<id klien>) is not present in table "management_users".
(dan promote-to-invoices ikut gagal di account_mappings).

Data lama (client_id = id user) di-remap ke id klien:
    source_files     <- management_client_id baris itu sendiri
    source_rows      <- management_client_id source_file induknya
    account_mappings <- management_client_id invoice-nya
    activity_log     <- management_client_id invoice-nya
    exceptions       <- management_client_id invoice-nya / source_file dari source_row-nya
Yang tidak bisa dipetakan di-set NULL (kolomnya nullable).

SENGAJA TIDAK menyentuh tabel purchase (purchase_source_records &
purchase_transaction_lines): purchase_import_v1.py masih mengisi client_id
dengan id user, jadi constraint ke management_users di DB masih benar.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang FK-nya sudah ke
management_clients dilewati. Semua langkah dalam 1 transaksi.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\32-repoint_sales_client_id_fk_to_management_clients.py
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

from sqlalchemy import text

from _history import catat_history
from db_client import engine

INV = "financial_transaction_sales_invoices"
SF = "financial_transaction_sales_source_files"
SR = "financial_transaction_sales_source_rows"

# (tabel, SQL remap data lama -> id klien)
TABEL = [
    (SF, f"UPDATE {SF} SET client_id = management_client_id"),
    (SR, f"UPDATE {SR} r SET client_id = f.management_client_id FROM {SF} f WHERE f.id = r.source_file_id"),
    ("financial_transaction_sales_account_mappings",
     f"UPDATE financial_transaction_sales_account_mappings m SET client_id = i.management_client_id "
     f"FROM {INV} i WHERE i.id = m.invoice_id"),
    ("financial_transaction_sales_activity_log",
     f"UPDATE financial_transaction_sales_activity_log l SET client_id = i.management_client_id "
     f"FROM {INV} i WHERE i.id = l.invoice_id"),
    ("financial_transaction_sales_exceptions",
     f"UPDATE financial_transaction_sales_exceptions e SET client_id = COALESCE("
     f"(SELECT i.management_client_id FROM {INV} i WHERE i.id = e.invoice_id), "
     f"(SELECT f.management_client_id FROM {SR} r JOIN {SF} f ON f.id = r.source_file_id WHERE r.id = e.source_row_id))"),
]

SQL_FK_CLIENT_ID = """
    SELECT p.conname, p.confrelid::regclass::text
    FROM pg_constraint p
    JOIN pg_attribute a ON a.attrelid = p.conrelid AND a.attnum = p.conkey[1]
    WHERE p.contype = 'f' AND p.conrelid = CAST(:tabel AS regclass) AND a.attname = 'client_id'
"""


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: FK client_id tabel Sales -> management_clients")
    print("=" * 60)

    try:
        with engine.begin() as conn:
            for tabel, sql_remap in TABEL:
                fks = conn.execute(text(SQL_FK_CLIENT_ID), {"tabel": tabel}).all()
                if any(ref == "management_clients" for _, ref in fks):
                    print(f"⏭️  {tabel}: FK sudah ke management_clients, skip.")
                    continue
                for conname, _ in fks:
                    conn.execute(text(f'ALTER TABLE {tabel} DROP CONSTRAINT "{conname}"'))
                n = conn.execute(text(sql_remap)).rowcount
                # Sisa yang tidak bisa dipetakan (mis. invoice sudah hilang) -> NULL.
                n_null = conn.execute(text(
                    f"UPDATE {tabel} SET client_id = NULL WHERE client_id IS NOT NULL "
                    f"AND client_id NOT IN (SELECT id FROM management_clients)"
                )).rowcount
                conn.execute(text(
                    f"ALTER TABLE {tabel} ADD CONSTRAINT {tabel[:50]}_client_id_fkey "
                    f"FOREIGN KEY (client_id) REFERENCES management_clients(id)"
                ))
                print(f"✅ {tabel}: FK dipindah, {n} baris di-remap, {n_null} baris di-NULL-kan.")
    except Exception as e:
        print(f"❌ Gagal (semua perubahan di-rollback): {e}")
        return 1

    print("=" * 60)
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
