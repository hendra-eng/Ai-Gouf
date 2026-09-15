"""
migrations/add_management_users_auth.py
========================================
Migration untuk memindahkan sistem login dari tabel `users` (lama) ke
`management_users` (DDL baru di root/ddl-table, ditulis manual oleh
user lewat Supabase/Postgres SQL editor).

DDL asli `management_users` TIDAK punya kolom `username`/`password_hash`
-- tanpa itu tabel tidak bisa dipakai untuk login. Migration ini:

1. Menambah kolom `username` (unique) & `password_hash` ke
   `management_users` (kolom yang HARUS ada supaya bisa dipakai login,
   tapi tidak ada di draft DDL awal).
2. Mengubah `user_client_access.user_id` dari INTEGER (FK ke
   `users.id`) menjadi UUID (FK ke `management_users.id_user`) --
   tabel ini kosong (0 baris) saat migration ini ditulis, jadi aman
   diubah tipenya langsung.
3. Memindahkan baris yang SUDAH ada di tabel `users` (lama) ke
   `management_users`, kalau username-nya belum ada di sana --
   password_hash disalin apa adanya (bcrypt hash, bukan plaintext)
   supaya user tidak perlu reset password.

Tabel `users` (lama) SENGAJA TIDAK dihapus/di-drop oleh migration ini
-- dibiarkan apa adanya (orphaned) supaya tidak ada risiko kehilangan
data secara tidak sengaja. Hapus manual nanti kalau sudah yakin tidak
diperlukan lagi.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\add_management_users_auth.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- db_client.py membaca
    # DATABASE_URL dari environment SAAT DIIMPOR, jadi .env harus sudah
    # ter-load duluan, atau engine akan diam-diam jatuh ke sqlite lokal.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


def _kolom_ada(connection, table: str, kolom: str) -> bool:
    inspector = inspect(connection)
    if table not in inspector.get_table_names():
        return False
    return kolom in [c["name"] for c in inspector.get_columns(table)]


def tambah_kolom_auth(connection) -> bool:
    """Tambah username + password_hash ke management_users kalau belum ada."""
    ok = True
    if not _kolom_ada(connection, "management_users", "username"):
        try:
            connection.execute(text(
                "ALTER TABLE management_users ADD COLUMN username VARCHAR(100)"
            ))
            connection.commit()
            print("✅ Kolom 'management_users.username' ditambahkan.")
        except (OperationalError, ProgrammingError) as e:
            print(f"❌ Gagal tambah kolom username: {e}")
            connection.rollback()
            ok = False
    else:
        print("⏭️  Kolom 'management_users.username' sudah ada, skip.")

    if not _kolom_ada(connection, "management_users", "password_hash"):
        try:
            connection.execute(text(
                "ALTER TABLE management_users ADD COLUMN password_hash VARCHAR(255)"
            ))
            connection.commit()
            print("✅ Kolom 'management_users.password_hash' ditambahkan.")
        except (OperationalError, ProgrammingError) as e:
            print(f"❌ Gagal tambah kolom password_hash: {e}")
            connection.rollback()
            ok = False
    else:
        print("⏭️  Kolom 'management_users.password_hash' sudah ada, skip.")

    # UNIQUE constraint di username -- dicek dulu lewat information_schema
    # karena "ADD CONSTRAINT IF NOT EXISTS" tidak didukung semua versi Postgres.
    try:
        sudah_ada = connection.execute(text(
            "SELECT 1 FROM pg_constraint WHERE conname = 'management_users_username_key'"
        )).first()
        if not sudah_ada:
            connection.execute(text(
                "ALTER TABLE management_users ADD CONSTRAINT management_users_username_key UNIQUE (username)"
            ))
            connection.commit()
            print("✅ UNIQUE constraint 'management_users.username' ditambahkan.")
        else:
            print("⏭️  UNIQUE constraint username sudah ada, skip.")
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print("⏭️  UNIQUE constraint username sudah ada (terdeteksi via error), skip.")
        else:
            print(f"❌ Gagal tambah UNIQUE constraint username: {e}")
            ok = False
        connection.rollback()

    return ok


def migrasi_fk_user_client_access(connection) -> bool:
    """Ubah user_client_access.user_id dari INTEGER (FK ke users) jadi UUID (FK ke management_users)."""
    inspector = inspect(connection)
    if "user_client_access" not in inspector.get_table_names():
        print("⏭️  Tabel 'user_client_access' belum ada, skip (akan dibuat otomatis dengan tipe UUID).")
        return True

    kolom = {c["name"]: c["type"] for c in inspector.get_columns("user_client_access")}
    tipe_sekarang = str(kolom.get("user_id", "")).lower()
    if "uuid" in tipe_sekarang:
        print("⏭️  'user_client_access.user_id' sudah bertipe UUID, skip.")
        return True

    jumlah_baris = connection.execute(text("SELECT COUNT(*) FROM user_client_access")).scalar()
    if jumlah_baris and jumlah_baris > 0:
        print(
            f"❌ 'user_client_access' punya {jumlah_baris} baris data dengan user_id INTEGER lama -- "
            "migration ini TIDAK mengubah tipe kolom secara otomatis supaya tidak menghapus data. "
            "Kosongkan/migrasikan manual dulu baris-baris itu, lalu jalankan ulang migration ini."
        )
        return False

    try:
        for fk in inspector.get_foreign_keys("user_client_access"):
            if fk.get("referred_table") == "users":
                connection.execute(text(
                    f'ALTER TABLE user_client_access DROP CONSTRAINT "{fk["name"]}"'
                ))
        connection.execute(text(
            "ALTER TABLE user_client_access ALTER COLUMN user_id TYPE uuid USING NULL"
        ))
        connection.execute(text(
            "ALTER TABLE user_client_access "
            "ADD CONSTRAINT user_client_access_user_id_fkey "
            "FOREIGN KEY (user_id) REFERENCES management_users(id_user)"
        ))
        connection.commit()
        print("✅ 'user_client_access.user_id' diubah ke UUID + FK ke management_users.")
        return True
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal migrasi user_client_access.user_id: {e}")
        connection.rollback()
        return False


def migrasi_data_users_lama(connection) -> bool:
    """Salin baris dari tabel `users` (lama) ke `management_users`, kalau username belum ada di sana."""
    inspector = inspect(connection)
    if "users" not in inspector.get_table_names():
        print("⏭️  Tabel 'users' (lama) tidak ada, skip (tidak ada yang perlu dimigrasikan).")
        return True

    try:
        baris_lama = connection.execute(text(
            "SELECT username, password_hash, role, nama FROM users"
        )).mappings().all()
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal baca tabel 'users' lama: {e}")
        connection.rollback()
        return False

    if not baris_lama:
        print("⏭️  Tabel 'users' (lama) kosong, tidak ada yang dimigrasikan.")
        return True

    dipindah = 0
    for baris in baris_lama:
        sudah_ada = connection.execute(text(
            "SELECT 1 FROM management_users WHERE username = :u"
        ), {"u": baris["username"]}).first()
        if sudah_ada:
            print(f"⏭️  User '{baris['username']}' sudah ada di management_users, skip.")
            continue
        connection.execute(text(
            "INSERT INTO management_users (username, password_hash, nama_user, role) "
            "VALUES (:username, :password_hash, :nama_user, :role)"
        ), {
            "username": baris["username"],
            "password_hash": baris["password_hash"],
            "nama_user": baris["nama"] or baris["username"],
            "role": baris["role"],
        })
        dipindah += 1
        print(f"✅ User '{baris['username']}' dipindahkan ke management_users (password_hash disalin apa adanya).")
    connection.commit()
    if dipindah == 0:
        print("⏭️  Tidak ada user baru yang perlu dipindahkan.")
    return True


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: management_users jadi tabel auth (ganti `users`)")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        hasil["management_users.username + password_hash"] = tambah_kolom_auth(connection)
        hasil["user_client_access.user_id -> UUID"] = migrasi_fk_user_client_access(connection)
        hasil["migrasi data users lama"] = migrasi_data_users_lama(connection)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<45}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
