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

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
_DOTENV_TERPASANG = True
try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=_ENV_PATH)
except ImportError:
    _DOTENV_TERPASANG = False  # dilaporkan di main() kalau DB-nya ternyata SQLite

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
        print("   Seed ini butuh PostgreSQL. Diagnosis:")
        print(f"   - Python yang dipakai : {sys.executable}")
        print(f"   - python-dotenv       : {'terpasang' if _DOTENV_TERPASANG else 'TIDAK TERPASANG  <-- penyebab (bukan venv project?)'}")
        if _ENV_PATH.exists():
            ada_url = any(
                baris.strip().startswith("DATABASE_URL=")
                for baris in _ENV_PATH.read_text(encoding="utf-8", errors="replace").splitlines()
            )
            print(f"   - {_ENV_PATH} : ada, {'berisi' if ada_url else 'TIDAK berisi  <-- penyebab,'} DATABASE_URL (tanpa # di depan)")
        else:
            print(f"   - {_ENV_PATH} : TIDAK ADA  <-- penyebab")
        print("   Kalau ketiganya normal, cek variabel DATABASE_URL di sesi terminal ini")
        print("   (cmd `echo %DATABASE_URL%` / PowerShell `$env:DATABASE_URL` / bash `echo $DATABASE_URL`).")
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
        # 23505 = unique_violation. Seed sengaja tanpa ON CONFLICT, jadi ini
        # tandanya seed SUDAH pernah dijalankan di database ini.
        if getattr(e, "pgcode", None) == "23505":
            detail = getattr(getattr(e, "diag", None), "message_detail", None)
            if detail:
                print(f"   {detail}")
            print("   Artinya data seed ini SUDAH ada di database ini (mungkin sudah pernah")
            print("   dijalankan). Cek dulu isinya; jangan dijalankan ulang kalau sudah benar.")
            print("   Kalau resep direvisi, lihat blok 'Idempotensi' di kepala file .sql.")
        return 1
    finally:
        conn.close()

    print(f"✅ Seed '{sql_path.name}' berhasil dijalankan.")
    catat_history(sql_path.name)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
