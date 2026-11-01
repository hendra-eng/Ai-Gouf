#!/usr/bin/env python3
"""
sinkron_soul.py -- tarik ingatan tiap AI dari Supabase (tabel ai_agen_ingatan) lalu tulis ke
~/.hermes/profiles/<agen>/SOUL.md, supaya bot Telegram (Hermes) memakai isi database.

Pakai (dari folder backend, venv backend aktif, supaya sqlalchemy + DATABASE_URL tersedia):
    python sinkron_soul.py                 # nexus omni kilo lumen matrix
    python sinkron_soul.py nexus omni      # hanya yang disebut
    python sinkron_soul.py --penuh nexus   # sertakan juga Pengetahuan Aplikasi (sangat panjang)

SOUL.md lama dicadangkan dulu ke SOUL.md.bak-<waktu>. Setelah dijalankan: restart gateway Hermes.
"""
import os, re, sys, shutil, time
from pathlib import Path

try:
    from dotenv import load_dotenv
    for p in (Path(".env"), Path("backend/.env")):
        if p.exists():
            load_dotenv(p); break
except ImportError:
    pass

from sqlalchemy import create_engine, text

URL = os.environ.get("DATABASE_URL")
if not URL:
    sys.exit("DATABASE_URL tidak ditemukan. Jalankan dari folder backend (yang berisi .env).")

penuh = "--penuh" in sys.argv
agen_dipilih = [a.lower() for a in sys.argv[1:] if not a.startswith("--")] or ["nexus", "omni", "kilo", "lumen", "matrix"]
BESAR = ("[Pengetahuan Aplikasi]", "[Ingatan dari Obrolan dengan Pengguna]")

eng = create_engine(URL, pool_pre_ping=True)
with eng.connect() as c:
    for agen in agen_dipilih:
        r = c.execute(text("select isi, hewan, ruangan, bagian from ai_agen_ingatan where agen=:a and aktif"), {"a": agen}).first()
        if not r:
            print(f"[lewati] {agen}: tidak ada di ai_agen_ingatan"); continue
        isi = r[0]
        if not penuh:
            bag = re.split(r"\n\n(?=\[[^\]\n]+\]\n?)", isi)
            isi = "\n\n".join(b for b in bag if not b.startswith(BESAR))
        folder = Path.home() / ".hermes" / "profiles" / agen
        if not folder.exists():
            print(f"[lewati] {agen}: folder profile {folder} tidak ada"); continue
        soul = folder / "SOUL.md"
        if soul.exists():
            shutil.copy(soul, folder / f"SOUL.md.bak-{time.strftime('%Y%m%d-%H%M%S')}")
        soul.write_text(f"# {agen.capitalize()}\n\nIni identitas dan ingatan pribadiku (disinkronkan dari database Supabase, tabel ai_agen_ingatan).\n\n{isi}\n", encoding="utf-8")
        print(f"[ok] {agen}: {len(isi)} karakter -> {soul}")
print("Selesai. Restart gateway: Ctrl+C lalu hermes gateway run")