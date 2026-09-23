"""
migrations/13-drop_unused_tables.py
===================================
Bersih-bersih BE: DROP tabel yang sudah tidak dipakai sama sekali oleh
kode backend.

Hasil audit (2026-09-23) -- tiap tabel di database dicek: apakah punya
ORM model di db_client.py, apakah model/nama tabelnya dipakai kode yang
ter-import dari main.py, dan apakah ada tabel lain yang FK ke sana:

    users  -- tabel login LAMA. Sudah digantikan management_users sejak
              migrations/2-add_management_users_auth.py (isinya sudah
              disalin ke sana). Tidak punya ORM model lagi (class User
              sekarang = management_users), tidak ada query mentah yang
              membacanya, dan tidak ada FK yang mengarah ke tabel ini.
              Migration 2 memang sengaja membiarkannya ("hapus manual
              nanti kalau sudah yakin tidak diperlukan lagi").

Tabel lain yang SENGAJA TIDAK di-drop walau barisnya masih 0:
- Tabel legacy (clients, coa, hasil, jurnal_posting, percakapan, dst) --
  masih dipakai endpoint lama di main.py yang dipanggil FE, dan aturan
  Accounting Core V2 melarang legacy di-drop di rollout awal.
- management_audit_trails -- belum ada kode yang baca/tulis, TAPI ini
  bagian dari desain DDL di root/ddl-table (fitur audit trail yang belum
  dibangun), jadi tidak dianggap "sampah".

Pengaman sebelum DROP `users`: setiap username di tabel lama WAJIB sudah
ada di management_users. Kalau ada yang belum, migration BERHENTI (tidak
ada yang di-drop) -- jalankan dulu migration 2 untuk memindahkannya.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah tidak ada
di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\13-drop_unused_tables.py
"""

import sys
from pathlib import Path

# Console Windows default-nya cp1252 -> print() emoji melempar
# UnicodeEncodeError. Paksa UTF-8 (pola sama dengan migration lain).
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

import os
if not os.environ.get("DATABASE_URL"):
    sys.exit(
        "❌ DATABASE_URL tidak terbaca dari backend/.env.\n"
        "   Jalankan pakai Python venv project (butuh python-dotenv):\n"
        "   venv\\Scripts\\python migrations\\13-drop_unused_tables.py"
    )

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine
from _history import catat_history


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _users_lama_sudah_dipindah(connection) -> bool:
    """True kalau semua username di `users` (lama) sudah ada di management_users."""
    belum = connection.execute(text(
        "SELECT u.username FROM users u "
        "WHERE NOT EXISTS (SELECT 1 FROM management_users m WHERE m.username = u.username)"
    )).fetchall()
    if belum:
        print(f"❌ {len(belum)} user di tabel 'users' lama belum ada di management_users: "
              f"{', '.join(r[0] for r in belum)}")
        print("   Jalankan dulu migrations/2-add_management_users_auth.py.")
        return False
    return True


def _drop_users_lama(connection) -> bool:
    if not _tabel_ada(connection, "users"):
        print("⏭️  Tabel 'users' (lama) sudah tidak ada, skip.")
        return True
    if not _users_lama_sudah_dipindah(connection):
        return False
    try:
        connection.execute(text("DROP TABLE users"))
        connection.commit()
        print("✅ Tabel 'users' (lama) berhasil di-drop.")
        return True
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal drop tabel 'users': {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: drop tabel yang tidak dipakai BE")
    print("=" * 60)

    hasil = {}
    with engine.connect() as connection:
        hasil["drop tabel users (lama)"] = _drop_users_lama(connection)

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
    sys.exit(main())
