"""
migrations/26-add_status_type_to_management_users.py
======================================================
Fitur Management > Settings > User Management: tambah 2 kolom ke
management_users:

    is_active  BOOLEAN NOT NULL DEFAULT true   -- status Aktif / Nonaktif.
               User nonaktif TIDAK bisa login (modules/auth/core.py::authenticate).
    is_member  BOOLEAN NOT NULL DEFAULT false  -- type Member / Non-member.

Semua user yang sudah ada otomatis is_active = true (tidak ada yang terkunci)
dan is_member = false.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- ADD COLUMN IF NOT EXISTS, tidak
ada data yang diubah/dihapus.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\26-add_status_type_to_management_users.py
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

TABEL = "management_users"
LANGKAH = [
    ("kolom is_active", f"ALTER TABLE {TABEL} ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true"),
    ("kolom is_member", f"ALTER TABLE {TABEL} ADD COLUMN IF NOT EXISTS is_member BOOLEAN NOT NULL DEFAULT false"),
    ("index client_id", f"CREATE INDEX IF NOT EXISTS idx_management_users_client_id ON {TABEL} (client_id)"),
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: status & type di management_users")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada.")
            return 1
        for nama, sql in LANGKAH:
            try:
                connection.execute(text(sql))
                connection.commit()
                print(f"✅ {nama} siap.")
                hasil[nama] = True
            except (OperationalError, ProgrammingError) as e:
                connection.rollback()
                print(f"❌ Gagal {nama}: {e}")
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
