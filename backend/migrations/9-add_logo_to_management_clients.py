"""
migrations/add_logo_to_management_clients.py
============================================
Migration untuk fitur logo klien (dipakai kop PDF Journal Entry, dan
dokumen cetak lain ke depannya) -- menambah kolom `logo` ke tabel
management_clients:

- management_clients.logo   TEXT NULL   (data URL gambar base64, mis.
                                          "data:image/png;base64,....")

Kolom NULL = klien belum punya logo (semua klien lama otomatis begini,
tidak ada data yang diubah). Logo diisi lewat form Add/Edit Client di
halaman Clients (atau API PUT /api/v1/management/clients/{id}).

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- kolom yang sudah ada di-skip,
tidak ada data yang dihapus atau ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\add_logo_to_management_clients.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine

TABEL = "management_clients"
KOLOM = "logo"


def _kolom_ada(connection, table: str, column: str) -> bool:
    inspector = inspect(connection)
    if table not in inspector.get_table_names():
        return False
    return column in [col["name"] for col in inspector.get_columns(table)]


def _tambah_kolom_logo(connection) -> bool:
    if _kolom_ada(connection, TABEL, KOLOM):
        print(f"⏭️  Kolom '{TABEL}.{KOLOM}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {TABEL} ADD COLUMN {KOLOM} TEXT"))
        connection.commit()
        print(f"✅ Kolom '{TABEL}.{KOLOM}' berhasil ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        connection.rollback()
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"⏭️  Kolom '{TABEL}.{KOLOM}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal tambah kolom '{TABEL}.{KOLOM}': {e}")
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: tambah kolom logo ke management_clients")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        if TABEL not in inspect(connection).get_table_names():
            print(f"❌ Tabel '{TABEL}' belum ada -- jalankan dulu migrations/add_management_users_auth.py")
            return 1
        hasil[f"{TABEL}.{KOLOM}"] = _tambah_kolom_logo(connection)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
