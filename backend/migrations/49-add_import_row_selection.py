"""
migrations/49-add_import_row_selection.py
=========================================
Approve batch import opening balance dengan SELECT DATA (pilih baris / all):
approver boleh menyetujui sebagian baris saja. Baris yang tidak dipilih
ditandai is_excluded = true dan TIDAK diterapkan (tidak jadi saldo awal,
akun/aset/dokumen/stok tidak dibuat). Lihat
modules/management/opening_balance_import_v1.py (approve_import, _baris_terpilih).

    management_client_coa_opening_balance_import_rows.is_excluded  boolean NOT NULL DEFAULT false

Baris batch lama otomatis false (= semua baris diterapkan, sama seperti sebelumnya).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\49-add_import_row_selection.py
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

from _history import catat_history
from db_client import engine

KOLOM = """
ALTER TABLE management_client_coa_opening_balance_import_rows
    ADD COLUMN IF NOT EXISTS is_excluded boolean NOT NULL DEFAULT false;
"""


def _jalankan_sql(connection, label: str, sql: str) -> bool:
    # Commit lewat koneksi DBAPI mentah (lihat catatan di migration 34).
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
    print("🔄 MIGRATION: select data saat approve batch import opening balance")
    print("=" * 60)
    with engine.connect() as connection:
        ok = _jalankan_sql(connection, "kolom is_excluded", KOLOM)
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
