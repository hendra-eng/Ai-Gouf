"""
migrations/47-auto_client_code_from_name.py
===========================================
client_code klien sekarang OTOMATIS = singkatan nama klien (huruf pertama tiap
kata tanpa bentuk badan usaha: "CV SUMBER ALODIE UTAMA" -> SAU, "PT WELL STAR
INDONESIA" -> WSI), unik (SAU, SAU2, ...) -- lihat db_client.buat_kode_klien.

Migration ini merapikan data LAMA:
    1. Kode yang DIGANTI: kosong, pola lama CLT-xxx / CLT-xxxx, atau DOBEL
       (case-insensitive; klien tertua mempertahankan kodenya, sisanya diganti).
       Kode lain yang sudah unik (mis. diketik manual "SAU") dipertahankan.
    2. Salinan client_code di tabel lain (disimpan per client_id) ikut diganti:
       management_client_coa + tabel template import sales / purchase /
       journal entry / bank & kas + bank mapping.
    3. Unique index uq_management_clients_client_code (upper(client_code),
       klien yang belum dihapus) supaya kode tidak bisa dobel lagi.

Semua dalam SATU transaksi. Jalankan dengan --dry-run dulu untuk melihat
rencana penggantian tanpa mengubah apa pun.

AMAN DIPANGGIL BERKALI-KALI (idempoten): jalan kedua tidak menemukan kode
yang perlu diganti.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\47-auto_client_code_from_name.py --dry-run
    venv\\Scripts\\python migrations\\47-auto_client_code_from_name.py
"""

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from _history import catat_history
from db_client import engine, singkatan_nama_klien

TABEL_SALINAN = [
    "management_client_coa",
    "financial_transaction_sales_import_templates",
    "financial_transaction_purchase_import_templates",
    "financial_transaction_journal_entry_import_templates",
    "financial_transaction_bank_cash_import_templates",
    "financial_transaction_bank_cash_bank_mappings",
]
POLA_KODE_LAMA = re.compile(r"^CLT-?\d+$", re.IGNORECASE)
INDEX_UNIK = (
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_management_clients_client_code "
    "ON management_clients (upper(client_code)) WHERE deleted_at IS NULL"
)


def _rencana(klien):
    """[(id, nama, kode_lama, kode_baru)] untuk klien yang kodenya harus diganti.
    `klien` = [(id, nama, kode, deleted)] urut created_at (tertua dulu).
    Klien AKTIF didahulukan (dapat kode bersih SAU), klien terhapus belakangan (SAU2)."""
    dipakai, perlu_ganti = set(), []
    for cid, nama, kode, _ in sorted(klien, key=lambda k: k[3]):   # sort stabil: aktif dulu, urutan created_at tetap
        k = (kode or "").strip().upper()
        if not k or POLA_KODE_LAMA.match(k) or k in dipakai:
            perlu_ganti.append((cid, nama, kode))
        else:
            dipakai.add(k)
    hasil = []
    for cid, nama, kode in perlu_ganti:
        dasar = singkatan_nama_klien(nama)
        baru, n = dasar, 2
        while baru in dipakai:
            baru, n = f"{dasar}{n}", n + 1
        dipakai.add(baru)
        hasil.append((cid, nama, kode, baru))
    return hasil


def main() -> int:
    parser = argparse.ArgumentParser(description="Ganti client_code lama (CLT-xxx / kosong / dobel) jadi singkatan nama klien.")
    parser.add_argument("--dry-run", action="store_true", help="tampilkan rencana lalu ROLLBACK")
    args = parser.parse_args()

    print("=" * 60)
    print(f"🔄 MIGRATION: client_code otomatis dari nama klien {'(DRY RUN)' if args.dry_run else ''}")
    print("=" * 60)
    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute("SELECT pg_advisory_xact_lock(hashtext('management_clients:client_code'))")
        cur.execute("SELECT id, nama_client, client_code, deleted_at IS NOT NULL FROM management_clients "
                    "ORDER BY created_at, id")
        klien = cur.fetchall()
        rencana = _rencana(klien)
        print(f"📋 {len(klien)} klien, {len(rencana)} kode perlu diganti:")
        for cid, nama, lama, baru in rencana:
            hapus = next(d for i, _, _, d in klien if i == cid)
            print(f"   - {nama[:45]:<45} {lama or '(kosong)':<10} -> {baru}{'  (klien terhapus)' if hapus else ''}")

        for cid, _, _, baru in rencana:
            cur.execute("UPDATE management_clients SET client_code = %s WHERE id = %s", (baru, cid))
            for t in TABEL_SALINAN:
                cur.execute(f"UPDATE {t} SET client_code = %s WHERE client_id = %s", (baru, cid))
        cur.execute(INDEX_UNIK)
        print("✅ Unique index uq_management_clients_client_code siap.")

        if args.dry_run:
            raw.rollback()
            print("🧪 DRY RUN — semua perubahan di-ROLLBACK.")
            return 0
        raw.commit()
    except Exception as e:  # noqa: BLE001
        raw.rollback()
        print(f"❌ Migration gagal (tidak ada yang tersimpan): {str(e).strip().splitlines()[0]}")
        return 1
    finally:
        raw.close()

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
