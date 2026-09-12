"""Migrate/bootstrap Accounting Core V2.

Aman dijalankan berkali-kali. Script ini:
1. Membuat tabel additive baru (journal_entries, journal_lines, taxonomy,
   account roles, mapping, user_client_access) melalui Base.metadata.create_all.
2. Men-seed Standard Accounting Taxonomy dan Account Roles universal.
3. Opsional: mirror seluruh jurnal_posting existing ke Accounting Core V2.

Contoh:
    cd backend
    python scripts/migrate_accounting_core_v2.py --sync-legacy

Gunakan DATABASE_URL yang sama dengan environment aplikasi.
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import db_client as dbc  # noqa: E402
from modules import accounting_core  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap Accounting Core V2")
    parser.add_argument(
        "--sync-legacy",
        action="store_true",
        help="Mirror semua jurnal_posting existing ke journal_entries/journal_lines.",
    )
    parser.add_argument(
        "--client-id",
        type=int,
        default=None,
        help="Jika diisi bersama --sync-legacy, hanya sinkronkan satu client.",
    )
    args = parser.parse_args()

    print(f"DATABASE_URL={dbc.DATABASE_URL}")
    dbc.init_db()
    accounting_core.ensure_seed_data()
    print("OK: tabel Accounting Core V2 + taxonomy/account roles siap.")

    if not args.sync_legacy:
        return 0

    clients = dbc.daftar_client()
    if args.client_id is not None:
        clients = [c for c in clients if int(c.get("id") or 0) == args.client_id]
        if not clients:
            print(f"Client {args.client_id} tidak ditemukan.")
            return 2

    total = 0
    for client in clients:
        client_id = int(client["id"])
        synced = accounting_core.sync_legacy_to_core(client_id)
        total += synced
        print(f"client={client_id} {client.get('nama')}: {synced} legacy journal mirrored")

    print(f"Selesai. Total legacy row diproses: {total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
