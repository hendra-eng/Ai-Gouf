r"""
migrations/62-journal_entry_id_to_uuid.py
=========================================
Kolom journal_entry_id di 3 tabel transaksi -> uuid (sesuai ORM db_client).

Migration 10 membuat kolom ini integer (FK ke journal_entries lama, sudah di-drop migration 23).
Sejak merge hendra (347616a) ORM mendeklarasikannya PG_UUID, sehingga SETIAP insert lewat ORM
mengirim "NULL::UUID" ke kolom integer dan Postgres menolak:
    column "journal_entry_id" is of type integer but expression is of type uuid
Dampak: posting opening balance (dan insert JE / sales / purchase lewat ORM) -> 500.

Kolom ini tidak dipakai lagi (ledger lama sudah di-drop) dan nilainya kosong. Tabel yang
kolomnya MASIH berisi nilai TIDAK diubah (dilaporkan) supaya tidak ada data yang hilang.

AMAN DIPANGGIL BERKALI-KALI (idempoten: tabel yang sudah uuid dilewati).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\62-journal_entry_id_to_uuid.py
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

TABEL = [
    "financial_transaction_journal_entry_drafts",
    "financial_transaction_sales_invoices",
    "financial_transaction_purchase_transactions",
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: journal_entry_id integer -> uuid (3 tabel transaksi)")
    print("=" * 60)
    ok = True
    with engine.connect() as connection:
        try:
            for t in TABEL:
                tipe = connection.execute(text(
                    "SELECT data_type FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :t AND column_name = 'journal_entry_id'"
                ), {"t": t}).scalar()
                if tipe is None:
                    print(f"⏭️  {t}: kolom journal_entry_id tidak ada, dilewati.")
                    continue
                if tipe == "uuid":
                    print(f"⏭️  {t}: sudah uuid.")
                    continue
                terisi = connection.execute(text(f"SELECT count(*) FROM {t} WHERE journal_entry_id IS NOT NULL")).scalar()
                if terisi:
                    print(f"❌ {t}: {terisi} baris masih berisi journal_entry_id ({tipe}) -- TIDAK diubah, cek manual.")
                    ok = False
                    continue
                # FK lama ke journal_entries (kalau masih ada) ikut dilepas -- tabelnya sudah di-drop.
                for (fk,) in connection.execute(text(
                    "SELECT conname FROM pg_constraint WHERE conrelid = CAST(:t AS regclass) AND contype = 'f' "
                    "AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (journal_entry_id)%'"
                ), {"t": t}):
                    connection.execute(text(f'ALTER TABLE {t} DROP CONSTRAINT "{fk}"'))
                connection.execute(text(f"ALTER TABLE {t} ALTER COLUMN journal_entry_id TYPE uuid USING NULL"))
                print(f"✅ {t}: {tipe} -> uuid.")
            connection.commit()
        except Exception as e:
            connection.rollback()
            print(f"❌ Gagal: {e}")
            ok = False

    print("=" * 60)
    if ok:
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Migration belum tuntas. Periksa pesan di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
