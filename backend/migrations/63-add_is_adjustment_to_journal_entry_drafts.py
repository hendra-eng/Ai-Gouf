"""
migrations/63-add_is_adjustment_to_journal_entry_drafts.py
==========================================================
Penanda JURNAL PENYESUAIAN (adjusting entry) di Journal Entry, untuk report
Reports > Adjustment (src/app/reports/adjustment).

  Kolom BARU di financial_transaction_journal_entry_drafts:
       is_adjustment  boolean NOT NULL DEFAULT false
  + index parsial untuk membaca jurnal penyesuaian per klien/tanggal.

Kenapa kolom boolean, bukan source_type baru: jurnal penyesuaian bisa dibuat
manual ("Manual"), lewat import ("Import") atau "Other". source_type tetap
menjelaskan ASAL jurnal, is_adjustment menjelaskan JENIS jurnalnya -- dua hal
yang berbeda. Jurnal bertanda tetap masuk GL / Trial Balance / Financial
Statements seperti jurnal biasa (tidak ada perubahan angka di laporan lain).

Jurnal lama TIDAK diubah (default false). Tandai lewat form New Journal Entry
(checkbox "Adjusting entry") atau UPDATE manual.

WAJIB dijalankan SEBELUM backend baru dipakai (ORM sudah membaca kolom baru).
AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\63-add_is_adjustment_to_journal_entry_drafts.py
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

TABEL = "financial_transaction_journal_entry_drafts"
KOLOM = "is_adjustment"
INDEX = "idx_je_drafts_adjustment"


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
    print("🔄 MIGRATION: penanda jurnal penyesuaian (is_adjustment)")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        insp = inspect(connection)
        if TABEL not in insp.get_table_names():
            print(f"❌ Tabel {TABEL} belum ada -- jalankan dulu migrations/10-create_financial_transaction_journal_entry_tables.py.")
            return 1

        kolom_ada = {c["name"] for c in insp.get_columns(TABEL)}
        if KOLOM in kolom_ada:
            print(f"⏭️  Kolom '{KOLOM}' sudah ada, skip.")
            hasil[f"kolom {KOLOM}"] = True
        else:
            hasil[f"kolom {KOLOM}"] = _jalankan_sql(
                connection, f"kolom {KOLOM}",
                f"ALTER TABLE {TABEL} ADD COLUMN {KOLOM} BOOLEAN NOT NULL DEFAULT false;",
            )

        hasil[f"index {INDEX}"] = _jalankan_sql(
            connection, f"index {INDEX}",
            f"CREATE INDEX IF NOT EXISTS {INDEX} ON {TABEL} (management_client_id, entry_date) "
            f"WHERE is_adjustment AND deleted_at IS NULL;",
        )

    print()
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<40}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ Migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Ada langkah yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
