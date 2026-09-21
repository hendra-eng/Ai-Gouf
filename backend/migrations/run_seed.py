"""
migrations/run_seed.py
======================
Menjalankan file seed/data SQL (mis. seed_template_nbm_multi_format.sql) ke
database dari DATABASE_URL di backend/.env, lalu mencatat nama filenya ke
migrations/history-migration.md (hanya kalau berhasil) -- lihat _history.py.

File .sql tidak bisa menulis ke file catatan sendiri kalau dijalankan lewat
psql, karena itu seed dijalankan lewat script ini.

Seluruh isi file dijalankan dalam 1 transaksi: kalau ada 1 statement gagal
(termasuk RAISE EXCEPTION di dalam blok DO), tidak ada yang tersimpan dan
nama file TIDAK dicatat.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\run_seed.py seed_template_nbm_multi_format.sql

Argumen boleh nama file saja (dicari di folder migrations/) atau path lengkap.
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

from _history import catat_history
from db_client import engine

# Console Windows default-nya cp1252 -> print() emoji melempar UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def main(argv) -> int:
    if len(argv) != 2:
        print("Pemakaian: python migrations/run_seed.py <file.sql>")
        return 2

    arg = Path(argv[1])
    sql_path = arg if arg.exists() else Path(__file__).resolve().parent / arg.name
    if not sql_path.exists():
        print(f"❌ File '{argv[1]}' tidak ditemukan.")
        return 1

    print("=" * 60)
    print(f"🌱 SEED: {sql_path.name}")
    print("=" * 60)

    # [FIX] Seed memakai blok DO $do$ ... (khusus PostgreSQL). Kalau .env tidak
    # terbaca (python-dotenv tidak ter-install / DATABASE_URL di terminal
    # menimpa .env) db_client diam-diam jatuh ke fallback SQLite dan errornya
    # menyesatkan: 'near "DO": syntax error'. Hentikan lebih awal + tampilkan
    # database yang sedang dipakai.
    if engine.dialect.name != "postgresql":
        print(f"❌ Database yang terhubung: {engine.url.render_as_string(hide_password=True)}")
        print("   Seed ini butuh PostgreSQL. Kemungkinan penyebab:")
        print("   - python-dotenv tidak ter-install di Python yang dipakai (bukan venv project)")
        print("   - variabel DATABASE_URL di sesi terminal ini menimpa backend/.env")
        print("     (cek: cmd `echo %DATABASE_URL%` / PowerShell `$env:DATABASE_URL`)")
        return 1
    print(f"🔌 Database: {engine.url.render_as_string(hide_password=True)}")

    sql = sql_path.read_text(encoding="utf-8")
    # raw_connection (psycopg2) -- bukan text() SQLAlchemy -- supaya blok
    # DO $do$ ... $do$ dan tanda ':' di dalam JSON tidak diparse sbg bind param.
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        cur.execute(sql)
        conn.commit()
    except Exception as e:  # noqa: BLE001
        conn.rollback()
        pesan = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)
        print(f"❌ Seed gagal (tidak ada yang tersimpan): {pesan}")
        return 1
    finally:
        conn.close()

    print(f"✅ Seed '{sql_path.name}' berhasil dijalankan.")
    catat_history(sql_path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
