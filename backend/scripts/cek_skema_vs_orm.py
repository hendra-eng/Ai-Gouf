"""
scripts/cek_skema_vs_orm.py
===========================
Bandingkan model ORM (db_client.Base) dengan skema database yang sedang dipakai
(.env DATABASE_URL), lalu tampilkan tabel/kolom yang ADA di kode tapi BELUM ADA
di database -- tanda migration yang belum dijalankan di server itu.

Riwayat migration hanya dicatat di migrations/history-migration.md (file, bukan
DB), jadi script ini cara cepat mengecek server (mis. VPS) mana yang tertinggal.

HANYA MEMBACA, tidak mengubah apa pun.

Cara pakai:
    cd backend
    venv\\Scripts\\python scripts\\cek_skema_vs_orm.py
"""

import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=BACKEND / ".env")
except ImportError:
    pass

from sqlalchemy import inspect

from db_client import Base, engine


def _cari_migration(tabel: str, kolom: str = None) -> list:
    """Cari file migration yang menyebut tabel (+kolom) -- petunjuk mana yang perlu dijalankan."""
    hasil = []
    for f in sorted((BACKEND / "migrations").rglob("*.py")):
        if f.name.startswith("_"):
            continue
        teks = f.read_text(encoding="utf-8", errors="ignore")
        if tabel not in teks:
            continue
        if kolom and not re.search(rf"\b{re.escape(kolom)}\b", teks):
            continue
        hasil.append(str(f.relative_to(BACKEND)).replace("\\", "/"))
    return hasil


def main() -> int:
    insp = inspect(engine)
    tabel_db = set(insp.get_table_names())
    kurang = 0
    for tabel, t in sorted(Base.metadata.tables.items()):
        if tabel not in tabel_db:
            kurang += 1
            print(f"[TABLE MISSING] {tabel}")
            for m in _cari_migration(tabel)[-3:]:
                print(f"      -> {m}")
            continue
        kolom_db = {c["name"] for c in insp.get_columns(tabel)}
        for c in t.columns:
            if c.name not in kolom_db:
                kurang += 1
                print(f"[COLUMN MISSING] {tabel}.{c.name}")
                for m in _cari_migration(tabel, c.name)[-3:]:
                    print(f"      -> {m}")
    if kurang:
        print(f"\n{kurang} table/column(s) missing. Run the migrations listed above (in number order).")
        return 1
    print("Database schema matches the ORM models -- no missing tables/columns.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
