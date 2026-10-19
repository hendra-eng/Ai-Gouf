"""
migrations/39-add_status_history_to_payroll_runs.py
====================================================
Payroll: tambah kolom `status_history` (JSONB, default '[]') di
management_payroll_runs -- riwayat perubahan status (approve, bayar, dan
BUKA KEMBALI beserta alasannya). Lihat modules/management/payroll_v1.py.

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- tidak ada data yang dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\39-add_status_history_to_payroll_runs.py
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

from sqlalchemy import text
from sqlalchemy.exc import OperationalError, ProgrammingError

from _history import catat_history
from db_client import engine


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: management_payroll_runs.status_history")
    print("=" * 60)
    try:
        with engine.connect() as connection:
            connection.execute(text(
                "ALTER TABLE management_payroll_runs "
                "ADD COLUMN IF NOT EXISTS status_history jsonb NOT NULL DEFAULT '[]'::jsonb"
            ))
            connection.commit()
        print("✅ Kolom 'status_history' siap.")
    except (OperationalError, ProgrammingError) as e:
        print(f"❌ Gagal: {e}")
        print("⚠️  Ada migration yang gagal. Periksa error di atas.")
        return 1
    print("✅ SEMUA migration berhasil!")
    catat_history(Path(__file__).name)
    return 0


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
