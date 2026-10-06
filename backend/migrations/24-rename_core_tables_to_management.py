"""
migrations/24-rename_core_tables_to_management.py
==================================================
Standarisasi nama tabel inti (task-claude.md, 2026-10-04): tambah awalan
`management_` ke 5 tabel yang tersisa dari Accounting Core lama:

    account_roles          -> management_account_roles
    coa_standard_mapping   -> management_coa_standard_mapping
    company_account_roles  -> management_company_account_roles
    standard_accounts      -> management_standard_accounts
    user_client_access     -> management_user_client_access

ALTER TABLE ... RENAME mempertahankan data, index, dan FK (FK yang
merujuk tabel ini otomatis ikut nama baru). Sequence kolom serial `id`
ikut di-rename supaya konsisten (<tabel>_id_seq).

__tablename__ di db_client.py sudah diganti di commit yang sama. Kalau
backend sempat di-restart dengan kode baru SEBELUM migration ini jalan,
create_all() akan membuat tabel management_* baru yang KOSONG -- tabel
kosong itu dibuang dulu lalu tabel lama di-rename. Kalau tabel baru
ternyata sudah BERISI data, migration BERHENTI (tidak ada yang diubah).

Semua langkah dalam SATU transaksi: gagal satu, batal semua.
AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tabel yang sudah ber-nama baru
di-skip.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\24-rename_core_tables_to_management.py
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
        "   venv\\Scripts\\python migrations\\24-rename_core_tables_to_management.py"
    )

from sqlalchemy import inspect, text
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine
from _history import catat_history

TABEL_LAMA = [
    "account_roles",
    "coa_standard_mapping",
    "company_account_roles",
    "standard_accounts",
    "user_client_access",
]


def _jumlah_baris(connection, tabel: str) -> int:
    return connection.execute(text(f'SELECT COUNT(*) FROM "{tabel}"')).scalar()


def _rename_sequence_id(connection, tabel_baru: str) -> None:
    """Rename sequence kolom serial `id` (kalau ada) jadi <tabel_baru>_id_seq."""
    seq = connection.execute(
        text("SELECT pg_get_serial_sequence(:t, 'id')"), {"t": tabel_baru}
    ).scalar()
    target = f"public.{tabel_baru}_id_seq"
    if seq and seq != target:
        connection.execute(text(f"ALTER SEQUENCE {seq} RENAME TO {tabel_baru}_id_seq"))


def _rencana(connection) -> list:
    """List (lama, baru, buang_baru_kosong). Raise ValueError kalau tidak aman."""
    ada = set(inspect(connection).get_table_names())
    rencana = []
    for lama in TABEL_LAMA:
        baru = f"management_{lama}"
        if lama not in ada:
            if baru in ada:
                print(f"⏭️  '{lama}' sudah jadi '{baru}', skip.")
            else:
                print(f"⚠️  '{lama}' maupun '{baru}' tidak ada, skip.")
            continue
        buang_baru = False
        if baru in ada:
            n = _jumlah_baris(connection, baru)
            if n:
                raise ValueError(
                    f"'{lama}' dan '{baru}' sama-sama ada dan '{baru}' berisi {n} baris -- "
                    "cek manual dulu mana yang benar."
                )
            buang_baru = True
        rencana.append((lama, baru, buang_baru))
    return rencana


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: rename tabel inti -> awalan management_")
    print("=" * 60)

    with engine.connect() as connection:
        try:
            rencana = _rencana(connection)
        except ValueError as e:
            print(f"❌ {e}")
            return 1

        try:
            for lama, baru, buang_baru in rencana:
                if buang_baru:
                    print(f"🧹 '{baru}' kosong (dibuat create_all) -- dibuang dulu.")
                    connection.execute(text(f'DROP TABLE "{baru}"'))
                connection.execute(text(f'ALTER TABLE "{lama}" RENAME TO "{baru}"'))
                _rename_sequence_id(connection, baru)
                print(f"✅ {lama} -> {baru}")
            connection.commit()
        except (OperationalError, ProgrammingError) as e:
            connection.rollback()
            print(f"❌ Gagal rename (semua dibatalkan): {e}")
            return 1

        ada = set(inspect(connection).get_table_names())
        sisa = [t for t in TABEL_LAMA if t in ada]

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    if sisa:
        print(f"❌ Masih ada tabel nama lama: {', '.join(sisa)}")
        return 1
    print(f"✅ {len(rencana)} tabel di-rename.")
    catat_history(Path(__file__).name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
