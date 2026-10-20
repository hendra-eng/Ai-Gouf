"""
migrations/_reset_seed_template.py
==================================
Logika bersama script reset template per folder seed:
    migrations/sales/reset_seed_template_sales.py
    migrations/purchase/reset_seed_template_purchase.py
    migrations/journal_entry/reset_seed_template_journal_entry.py
    migrations/bank_cash/reset_seed_template_bank_cash.py

Alur (SATU transaksi -- 1 langkah gagal = tidak ada yang berubah):
    1. Cek klien tiap seed: seed mencari klien lewat NAMA
       (upper(trim(nama_client)) = '...', karena client_code di VPS pernah
       dobel). Nama harus ada TEPAT 1 di management_clients:
         - belum ada -> BERHENTI, kecuali --skip-missing-client (seed dilewati);
         - DOBEL     -> SELALU berhenti (template bisa menempel ke klien salah).
    2. Lepas rujukan FK dari tabel LAIN ke tabel yang dikosongkan -- dicari
       otomatis dari pg_constraint (mis. *_source_files.template_id,
       bank_cash_statements.template_id): kolom nullable di-NULL-kan (data
       upload tetap utuh). Kalau ada FK NOT NULL yang masih punya data ->
       BERHENTI (tidak pernah memakai TRUNCATE ... CASCADE yang ikut
       menghapus data upload).
    3. DELETE semua isi tabel template (urutan sesuai konfigurasi; TRUNCATE
       tidak bisa dipakai selama ada FK yang merujuk).
    4. Jalankan semua file *.sql (yang tidak kosong) di folder, urut nama file.
    --dry-run = semua langkah dijalankan lalu ROLLBACK.

Seed yang berhasil dicatat ke migrations/history-migration.md sebagai
"<folder>/<nama file>" (lihat _history.py).
"""

import argparse
import re
import sys
from pathlib import Path
from typing import List

FOLDER_MIGRATIONS = Path(__file__).resolve().parent
FOLDER_BACKEND = FOLDER_MIGRATIONS.parent
sys.path.insert(0, str(FOLDER_MIGRATIONS))
sys.path.insert(0, str(FOLDER_BACKEND))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" (lihat migrations/run_seed.py).
    load_dotenv(dotenv_path=FOLDER_BACKEND / ".env")
except ImportError:
    pass

from _history import catat_history
from db_client import engine

# Pola pencarian klien di dalam seed: ... upper(trim(nama_client)) = 'CV SUMBER ALODIE UTAMA'
_POLA_NAMA_KLIEN = re.compile(r"upper\s*\(\s*trim\s*\(\s*nama_client\s*\)\s*\)\s*=\s*'([^']+)'", re.IGNORECASE)

_SQL_FK_MASUK = """
SELECT c.conrelid::regclass::text, a.attname, NOT a.attnotnull
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND c.confrelid = %s::regclass AND array_length(c.conkey, 1) = 1
"""


def _konsol_utf8() -> None:
    # Console Windows default-nya cp1252 -> print() emoji melempar UnicodeEncodeError.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _tanpa_komentar(sql: str) -> str:
    return "\n".join(b for b in sql.splitlines() if not b.lstrip().startswith("--"))


def _daftar_seed(folder: Path):
    """[(path, nama_klien | None)] semua *.sql (yang tidak kosong) di folder, urut nama file."""
    hasil = []
    for p in sorted(folder.glob("*.sql")):
        if p.stat().st_size == 0:
            continue
        nama = {k.strip().upper() for k in _POLA_NAMA_KLIEN.findall(_tanpa_komentar(p.read_text(encoding="utf-8")))}
        hasil.append((p, nama.pop() if len(nama) == 1 else None))
    return hasil


def _cetak_notice(conn, mulai: int) -> int:
    """Tampilkan RAISE NOTICE / WARNING dari Postgres sejak indeks `mulai`."""
    for n in conn.notices[mulai:]:
        print(f"      {n.strip()}")
    return len(conn.notices)


def jalankan(folder: Path, judul: str, tabel_hapus: List[str]) -> int:
    """Reset tabel `tabel_hapus` (dihapus berurutan -- tabel yang merujuk lebih dulu)
    lalu jalankan semua seed di `folder`. Return exit code."""
    _konsol_utf8()
    parser = argparse.ArgumentParser(description=f"Reset template {judul} lalu jalankan semua seed di migrations/{folder.name}/.")
    parser.add_argument("--dry-run", action="store_true", help="jalankan semuanya lalu ROLLBACK (tidak ada yang tersimpan)")
    parser.add_argument("--skip-missing-client", action="store_true",
                        help="lewati seed yang kliennya belum ada di management_clients (default: berhenti)")
    parser.add_argument("--yes", action="store_true", help="tanpa konfirmasi (untuk mode simpan)")
    args = parser.parse_args()

    print("=" * 64)
    print(f"🔄 RESET TEMPLATE {judul.upper()} {'(DRY RUN — akan di-ROLLBACK)' if args.dry_run else ''}")
    print("=" * 64)
    if engine.dialect.name != "postgresql":
        print(f"❌ Database yang terhubung bukan PostgreSQL: {engine.url.render_as_string(hide_password=True)}")
        print("   Pastikan dijalankan dengan Python venv project & backend/.env berisi DATABASE_URL.")
        return 1
    print(f"🔌 Database: {engine.url.render_as_string(hide_password=True)}")

    seed = _daftar_seed(folder)
    if not seed:
        print(f"❌ Tidak ada file .sql berisi di {folder}.")
        return 1

    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT upper(trim(nama_client)), count(*), string_agg(coalesce(client_code, '-'), ', ') "
                    "FROM management_clients WHERE deleted_at IS NULL AND nama_client IS NOT NULL GROUP BY 1")
        klien_ada = {nama: (n, kode) for nama, n, kode in cur.fetchall()}

        print(f"\n📋 {len(seed)} file seed ditemukan:")
        dijalankan, dilewati, dobel = [], [], []
        for p, nama in seed:
            n, kode = klien_ada.get(nama, (0, None)) if nama else (None, None)
            if nama is None:
                status = "⚠️  nama klien tidak terbaca dari file — tetap dijalankan"
                dijalankan.append(p)
            elif n == 1:
                status = f"✅ {nama} ({kode})"
                dijalankan.append(p)
            elif n > 1:
                status = f"⛔ {nama} DOBEL {n}x di management_clients ({kode})"
                dobel.append((p, nama))
            else:
                status = f"❌ {nama} BELUM ADA di management_clients"
                dilewati.append((p, nama))
            print(f"   - {p.name:<52} {status}")

        if dobel:
            print(f"\n⛔ {len(dobel)} klien punya nama dobel: {', '.join(n for _, n in dobel)}. TIDAK ADA YANG DIUBAH.")
            print("   Hapus/gabungkan duplikatnya dulu di management_clients, lalu jalankan ulang.")
            return 1
        if dilewati and not args.skip_missing_client:
            print(f"\n❌ {len(dilewati)} seed butuh klien yang belum ada (nama_client: "
                  f"{', '.join(n for _, n in dilewati)}). TIDAK ADA YANG DIUBAH.")
            print("   Buat/samakan nama kliennya dulu di halaman Clients, atau jalankan ulang dengan")
            print("   --skip-missing-client untuk melewati seed tersebut.")
            return 1
        if not dijalankan:
            print("\n❌ Tidak ada seed yang bisa dijalankan. TIDAK ADA YANG DIUBAH.")
            return 1

        # Rujukan FK dari tabel LAIN ke tabel yang dikosongkan.
        rujukan = []   # (tabel, kolom, nullable, jumlah baris yang merujuk)
        for t in tabel_hapus:
            cur.execute(_SQL_FK_MASUK, (t,))
            for tabel, kolom, nullable in cur.fetchall():
                if tabel in tabel_hapus:
                    continue
                cur.execute(f"SELECT count(*) FROM {tabel} WHERE {kolom} IS NOT NULL")
                rujukan.append((tabel, kolom, nullable, cur.fetchone()[0]))
        wajib = [r for r in rujukan if not r[2] and r[3]]
        if wajib:
            print("\n⛔ Ada data yang WAJIB merujuk template (kolom NOT NULL) — tidak bisa dilepas tanpa menghapusnya:")
            for tabel, kolom, _, n in wajib:
                print(f"   - {tabel}.{kolom}: {n} baris")
            print("   TIDAK ADA YANG DIUBAH.")
            return 1

        print()
        for t in tabel_hapus:
            cur.execute(f"SELECT count(*) FROM {t}")
            print(f"🗑️  Akan dihapus: {cur.fetchone()[0]} baris {t}")
        for tabel, kolom, _, n in rujukan:
            if n:
                print(f"🔗 Akan dilepas: {n} baris {tabel}.{kolom} (datanya tetap)")
        if dilewati:
            print(f"⏭️  Dilewati (klien belum ada): {', '.join(p.name for p, _ in dilewati)}")
            print("   Template klien-klien ini TIDAK akan ada lagi setelah reset.")
        if not args.dry_run and not args.yes:
            if input('\nKetik "yes" untuk melanjutkan: ').strip().lower() != "yes":
                print("Dibatalkan. TIDAK ADA YANG DIUBAH.")
                return 1

        print()
        for tabel, kolom, _, n in rujukan:
            if n:
                cur.execute(f"UPDATE {tabel} SET {kolom} = NULL WHERE {kolom} IS NOT NULL")
                print(f"🔗 {cur.rowcount} baris {tabel}.{kolom} dilepas.")
        for t in tabel_hapus:
            cur.execute(f"DELETE FROM {t}")
            print(f"🗑️  {cur.rowcount} baris {t} dihapus.")
        notice = len(conn.notices)
        for p in dijalankan:
            print(f"🌱 {p.name}")
            try:
                cur.execute(p.read_text(encoding="utf-8"))
            except Exception as e:  # noqa: BLE001
                _cetak_notice(conn, notice)
                pesan = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)
                conn.rollback()
                print(f"\n❌ Seed {p.name} gagal: {pesan}")
                print("   Semua perubahan di-ROLLBACK — TIDAK ADA YANG DIUBAH.")
                return 1
            notice = _cetak_notice(conn, notice)

        print("\n📊 Isi tabel sesudah seed:")
        for t in reversed(tabel_hapus):
            cur.execute(f"SELECT client_code, count(*) FROM {t} GROUP BY 1 ORDER BY 1")
            isi = ", ".join(f"{k or '-'} {n}" for k, n in cur.fetchall()) or "(kosong)"
            print(f"   - {t}: {isi}")

        if args.dry_run:
            conn.rollback()
            print("\n🧪 DRY RUN selesai — semua perubahan di-ROLLBACK, tidak ada yang tersimpan.")
            return 0
        conn.commit()
    finally:
        conn.close()

    print(f"\n✅ Reset selesai: {len(dijalankan)} seed dijalankan.")
    for p in dijalankan:
        catat_history(f"{folder.name}/{p.name}")
    return 0
