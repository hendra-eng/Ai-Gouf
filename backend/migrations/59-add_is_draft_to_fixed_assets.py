r"""
migrations/59-add_is_draft_to_fixed_assets.py
=============================================
Fixed Assets > tab Draft: kolom asset_fixed_assets.is_draft (boolean, default false).

Aset draft disimpan dari form Add Asset (checkbox "Save as draft"), tampil hanya di tab Draft,
dan TIDAK ikut register/KPI/penyusutan/disposal/laporan/saldo awal sampai checkbox dilepas.

AMAN DIPANGGIL BERKALI-KALI (idempoten).

Cara pakai:
    cd backend
    venv\Scripts\python migrations\59-add_is_draft_to_fixed_assets.py
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

from _history import catat_history
from db_client import engine

SQL = [
    "ALTER TABLE asset_fixed_assets ADD COLUMN IF NOT EXISTS is_draft boolean NOT NULL DEFAULT false",
    "CREATE INDEX IF NOT EXISTS idx_asset_fixed_assets_client_draft ON asset_fixed_assets (client_id, is_draft) "
    "WHERE deleted_at IS NULL",
]


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: asset_fixed_assets.is_draft (tab Draft Fixed Assets)")
    print("=" * 60)
    with engine.connect() as connection:
        try:
            for q in SQL:
                connection.execute(text(q))
            connection.commit()
            print("✅ Kolom is_draft + index siap.")
            ok = True
        except Exception as e:
            connection.rollback()
            print(f"❌ Gagal: {e}")
            ok = False

    print("=" * 60)
    if ok:
        print("✅ SEMUA migration berhasil!")
        catat_history(Path(__file__).name)
        return 0
    print("⚠️  Migration gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    sys.exit(main())
