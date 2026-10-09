"""
migrations/17-allow_unassigned_management_client_coa.py
=========================================================
Akun COA "unassigned": management_client_coa.client_id jadi BOLEH NULL,
supaya akun bisa dibuat dulu tanpa klien lalu kelak di-assign ke klien
(POST /api/v1/management/coa/assign -- lihat modules/management/coa_v1.py).

Perubahan:
1. ALTER COLUMN client_id DROP NOT NULL
2. UNIQUE INDEX parsial uq_management_client_coa_unassigned_acc_no
   (acc_no) WHERE client_id IS NULL AND deleted_at IS NULL -- UNIQUE
   (client_id, acc_no) yang sudah ada tidak berlaku antar baris NULL.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- DROP NOT NULL pada kolom yang
sudah nullable tidak error, index pakai IF NOT EXISTS. Tidak ada data yang
diubah/dihapus.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\17-allow_unassigned_management_client_coa.py
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

LANGKAH = [
    (
        "client_id management_client_coa boleh NULL",
        "ALTER TABLE management_client_coa ALTER COLUMN client_id DROP NOT NULL",
    ),
    (
        "unique acc_no di pool unassigned",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_management_client_coa_unassigned_acc_no "
        "ON management_client_coa (acc_no) WHERE client_id IS NULL AND deleted_at IS NULL",
    ),
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: akun COA unassigned (client_id nullable)")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if "management_client_coa" not in inspect(connection).get_table_names():
            print("❌ Tabel 'management_client_coa' belum ada -- jalankan dulu 16-create_management_client_coa.py.")
            return 1
        for nama, sql in LANGKAH:
            try:
                connection.execute(text(sql))
                connection.commit()
                print(f"✅ {nama}")
                hasil[nama] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ {nama}: {e}")
                hasil[nama] = False

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
