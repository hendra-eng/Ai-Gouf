"""
migrations/sync_management_tables_ddl.py
=========================================
Sinkronisasi skema DB dengan DDL terbaru di root/ddl-table untuk 3 tabel
manajemen (`management_users`, `management_audit_trails`,
`management_clients`):

1. `management_clients` -- tabel BARU (belum pernah dibuat). Dibuat kalau
   belum ada (CREATE TABLE IF NOT EXISTS, lewat ORM
   `Client.__table__`).
2. `management_audit_trails` -- sudah ada di DDL sebelumnya tapi belum
   pernah punya model ORM. Dibuat kalau belum ada di DB (untuk instalasi
   yang belum sempat membuatnya manual di Supabase).
3. Kolom BARU yang ditambahkan ke DDL:
   - `management_users`: created_by, updated_by, deleted_by (uuid),
     client_id (uuid, FK ke management_clients.id)
   - `management_audit_trails`: created_by, updated_by, deleted_by (uuid)
   Ditambah lewat ALTER TABLE ADD COLUMN kalau kolomnya belum ada.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel/kolom yang sudah ada
di-skip, tidak ada data yang dihapus atau ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\sync_management_tables_ddl.py
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


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _kolom_ada(connection, table: str, kolom: str) -> bool:
    if not _tabel_ada(connection, table):
        return False
    inspector = inspect(connection)
    return kolom in [c["name"] for c in inspector.get_columns(table)]


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
    """CREATE TABLE IF NOT EXISTS lewat ORM, supaya index/constraint ikut dibuat."""
    if _tabel_ada(connection, table_name):
        print(f"⏭️  Tabel '{table_name}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{table_name}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        connection.rollback()
        return False


def _tambah_kolom_jika_belum_ada(connection, table: str, kolom: str, ddl_type: str) -> bool:
    if _kolom_ada(connection, table, kolom):
        print(f"⏭️  Kolom '{table}.{kolom}' sudah ada, skip.")
        return True
    if not _tabel_ada(connection, table):
        print(f"⏭️  Tabel '{table}' belum ada, skip tambah kolom '{kolom}' (akan ikut dibuat lewat CREATE TABLE).")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {kolom} {ddl_type}"))
        connection.commit()
        print(f"✅ Kolom '{table}.{kolom}' ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "duplicate column" in msg or "already exists" in msg:
            print(f"⏭️  Kolom '{table}.{kolom}' sudah ada (terdeteksi via error), skip.")
            connection.rollback()
            return True
        print(f"❌ Gagal tambah kolom '{table}.{kolom}': {e}")
        connection.rollback()
        return False


def _tambah_fk_jika_belum_ada(connection, table: str, constraint_name: str, ddl_fk: str) -> bool:
    try:
        sudah_ada = connection.execute(text(
            "SELECT 1 FROM pg_constraint WHERE conname = :nama"
        ), {"nama": constraint_name}).first()
    except (OperationalError, ProgrammingError):
        # Bukan Postgres (mis. SQLite lokal) -- pg_constraint tidak ada, skip diam-diam.
        connection.rollback()
        return True
    if sudah_ada:
        print(f"⏭️  Constraint '{constraint_name}' sudah ada, skip.")
        return True
    try:
        connection.execute(text(f"ALTER TABLE {table} ADD CONSTRAINT {constraint_name} {ddl_fk}"))
        connection.commit()
        print(f"✅ Constraint '{constraint_name}' ditambahkan.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Constraint '{constraint_name}' sudah ada (terdeteksi via error), skip.")
            connection.rollback()
            return True
        print(f"❌ Gagal tambah constraint '{constraint_name}': {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: sinkronisasi management_users / management_audit_trails / management_clients dengan ddl-table")
    print("=" * 60)

    # [DIUBAH] ManagementClient/ManagementAuditTrail sudah dihapus dari
    # db_client.py (duplikat pemetaan tabel dengan Client/AuditLog) --
    # dikonsolidasikan ke Client/AuditLog, lihat catatan di db_client.py.
    from db_client import Client, AuditLog

    hasil = {}
    with engine.connect() as connection:
        # 1) Tabel baru management_clients HARUS dibuat duluan -- kolom
        #    management_users.client_id di bawah punya FK ke tabel ini.
        hasil["buat tabel management_clients"] = _buat_tabel_jika_belum_ada(
            connection, "management_clients", Client
        )
        hasil["buat tabel management_audit_trails"] = _buat_tabel_jika_belum_ada(
            connection, "management_audit_trails", AuditLog
        )

        # 2) Kolom baru di management_users
        for kolom, tipe in [
            ("created_by", "uuid"),
            ("updated_by", "uuid"),
            ("deleted_by", "uuid"),
            ("client_id", "uuid"),
        ]:
            hasil[f"management_users.{kolom}"] = _tambah_kolom_jika_belum_ada(
                connection, "management_users", kolom, tipe
            )
        hasil["FK management_users.client_id -> management_clients.id"] = _tambah_fk_jika_belum_ada(
            connection,
            "management_users",
            "management_users_client_id_fkey",
            "FOREIGN KEY (client_id) REFERENCES management_clients(id)",
        )

        # 3) Kolom baru di management_audit_trails (kalau tabelnya sudah
        #    ada dari sebelumnya, tanpa kolom-kolom audit ini).
        for kolom, tipe in [
            ("created_by", "uuid"),
            ("updated_by", "uuid"),
            ("deleted_by", "uuid"),
        ]:
            hasil[f"management_audit_trails.{kolom}"] = _tambah_kolom_jika_belum_ada(
                connection, "management_audit_trails", kolom, tipe
            )

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<55}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
