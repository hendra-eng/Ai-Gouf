"""
scripts/migrate_add_kolom_coa_keterangan.py
=============================================
Migrasi ALTER TABLE untuk database yang SUDAH ADA -- menambah kolom
"keterangan" ke tabel coa (lihat db_client.py::Coa). Kolom ini dipakai
untuk mengisi catatan bebas per akun, sesuai kolom "Keterangan" di sheet
'COA' file Excel model.

Aman dijalankan berkali-kali (dicek dulu apakah kolom sudah ada).

Cara pakai:
    cd backend
    python scripts/migrate_add_kolom_coa_keterangan.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text  # noqa: E402
from db_client import engine  # noqa: E402


def kolom_sudah_ada(conn, tabel: str, kolom: str) -> bool:
    hasil = conn.execute(text(f"PRAGMA table_info({tabel})"))
    return any(row[1] == kolom for row in hasil)


def main() -> None:
    with engine.connect() as conn:
        if kolom_sudah_ada(conn, "coa", "keterangan"):
            print("Kolom 'keterangan' sudah ada di tabel coa -- lewati.")
            return
        conn.execute(text("ALTER TABLE coa ADD COLUMN keterangan TEXT"))
        conn.commit()
        print("Berhasil menambah kolom 'keterangan' ke tabel coa.")


if __name__ == "__main__":
    main()