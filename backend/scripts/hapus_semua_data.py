r"""
scripts/hapus_semua_data.py
===========================
Kosongkan SEMUA tabel (schema public) KECUALI tabel user login
(management_users) -- klien, template ekstraksi, COA, pengaturan, master,
transaksi, saldo awal, tutup buku, audit trail, semuanya hilang. Untuk hapus
data TRANSAKSI saja (master & pengaturan tetap), pakai scripts/hapus_data_transaksi.py.

--keep-templates: pertahankan template ekstraksi/import menu transaksi
    financial_transaction_{sales,purchase,journal_entry,bank_cash}_import_templates
beserta management_clients & management_user_client_access (template terikat ke
klien, client_id NOT NULL). Bank mapping (bank -> akun COA) tetap terhapus karena
COA-nya terhapus.

Tabel referensi SISTEM (isi seed, bukan data klien) tetap dipertahankan
kecuali --with-reference, karena dipakai generator COA & laporan keuangan:
    management_standard_accounts, management_coa_standard_mapping,
    management_account_roles, management_fs_mapping_rules,
    management_fs_note_templates, management_coa_industry_templates,
    management_coa_industry_template_accounts

Karena klien ikut terhapus (tanpa --keep-templates), akun user tetap bisa login
tapi management_users.client_id dikosongkan & akses user ke klien hilang -- user
level klien (client_lv_N) perlu di-assign ulang ke klien baru.

Cara kerja (SATU transaksi -- 1 langkah gagal = tidak ada yang berubah):
    1. FK dari tabel yang DIPERTAHANKAN ke tabel yang dikosongkan
       (mis. management_users.client_id -> management_clients) dilepas
       sementara; kolomnya di-NULL-kan (kolom NOT NULL berisi data -> berhenti).
    2. TRUNCATE ... RESTART IDENTITY semua tabel lain sekaligus. TRUNCATE tidak
       memicu trigger baris (kunci periode, kunci mapping akun), jadi tidak perlu
       membuka tutup buku dulu.
    3. FK yang dilepas dipasang kembali.
    --dry-run = semua langkah dijalankan lalu ROLLBACK.

Cara pakai (dari folder backend):
    venv\Scripts\python scripts\hapus_semua_data.py --dry-run
    venv\Scripts\python scripts\hapus_semua_data.py              (ketik nama database untuk konfirmasi)
    Opsi: --keep-templates  --with-reference  --yes
"""

import argparse
import sys
from pathlib import Path

FOLDER_BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FOLDER_BACKEND))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" (lihat migrations/run_seed.py).
    load_dotenv(dotenv_path=FOLDER_BACKEND / ".env")
except ImportError:
    pass

from db_client import engine  # noqa: E402

TABEL_USER = ("management_users",)
TABEL_TEMPLATE = (
    "financial_transaction_sales_import_templates",
    "financial_transaction_purchase_import_templates",
    "financial_transaction_journal_entry_import_templates",
    "financial_transaction_bank_cash_import_templates",
    # template butuh kliennya (client_id NOT NULL) -> klien & akses user ke klien ikut tetap
    "management_clients",
    "management_user_client_access",
)
TABEL_REFERENSI = (
    "management_standard_accounts",
    "management_coa_standard_mapping",
    "management_account_roles",
    "management_fs_mapping_rules",
    "management_fs_note_templates",
    "management_coa_industry_templates",
    "management_coa_industry_template_accounts",
)

_SQL_FK_KELUAR = """
SELECT c.conname, c.conrelid::regclass::text, c.confrelid::regclass::text, a.attname,
       NOT a.attnotnull, pg_get_constraintdef(c.oid)
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
 WHERE c.contype = 'f' AND c.conrelid = %s::regclass
"""


def _konsol_utf8() -> None:
    # Console Windows default-nya cp1252 -> print() emoji melempar UnicodeEncodeError.
    for _stream in (sys.stdout, sys.stderr):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass


def _q(nama: str) -> str:
    return '"' + nama.replace('"', '""') + '"'


def main() -> int:
    _konsol_utf8()
    parser = argparse.ArgumentParser(description="Kosongkan semua tabel kecuali user login.")
    parser.add_argument("--dry-run", action="store_true", help="jalankan semuanya lalu ROLLBACK (tidak ada yang tersimpan)")
    parser.add_argument("--keep-templates", action="store_true", help="pertahankan template ekstraksi + klien")
    parser.add_argument("--with-reference", action="store_true", help="ikut kosongkan tabel referensi sistem (seed)")
    parser.add_argument("--yes", action="store_true", help="tanpa konfirmasi (untuk mode simpan)")
    args = parser.parse_args()

    print("=" * 64)
    print(f"💣 HAPUS SEMUA DATA (kecuali user login) {'(DRY RUN — akan di-ROLLBACK)' if args.dry_run else ''}")
    print("=" * 64)
    if engine.dialect.name != "postgresql":
        print(f"❌ Database yang terhubung bukan PostgreSQL: {engine.url.render_as_string(hide_password=True)}")
        return 1
    print(f"🔌 Database: {engine.url.render_as_string(hide_password=True)}")
    nama_db = engine.url.database

    simpan = (set(TABEL_USER) | (set(TABEL_TEMPLATE) if args.keep_templates else set())
              | (set() if args.with_reference else set(TABEL_REFERENSI)))
    conn = engine.raw_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' "
                    "AND table_type = 'BASE TABLE' ORDER BY 1")
        semua = [t for (t,) in cur.fetchall()]
        if not set(TABEL_USER) <= set(semua):
            print("❌ Tabel management_users tidak ditemukan — database salah? TIDAK ADA YANG DIUBAH.")
            return 1
        kosongkan = [t for t in semua if t not in simpan]

        print("\n📋 Akan DIKOSONGKAN:")
        total = 0
        for t in kosongkan:
            cur.execute(f"SELECT count(*) FROM {_q(t)}")
            n = cur.fetchone()[0]
            total += n
            if n:
                print(f"   🗑️  {t:<58} {n:>8} baris")
        print(f"   ({len(kosongkan)} tabel, total {total} baris; tabel kosong tidak ditampilkan)")
        print("\n🛡️  Dipertahankan:")
        for t in sorted(simpan & set(semua)):
            cur.execute(f"SELECT count(*) FROM {_q(t)}")
            print(f"   - {t:<58} {cur.fetchone()[0]:>8} baris")

        # FK dari tabel yang dipertahankan ke tabel yang dikosongkan.
        lepas = []
        for t in sorted(simpan & set(semua)):
            cur.execute(_SQL_FK_KELUAR, (t,))
            for nama, tabel, induk, kolom, nullable, definisi in cur.fetchall():
                if induk.strip('"') in simpan:
                    continue
                cur.execute(f"SELECT count(*) FROM {_q(tabel)} WHERE {_q(kolom)} IS NOT NULL")
                n = cur.fetchone()[0]
                if n and not nullable:
                    print(f"\n⛔ {tabel}.{kolom} (NOT NULL) merujuk {induk} dan berisi {n} baris. TIDAK ADA YANG DIUBAH.")
                    return 1
                lepas.append((nama, tabel, kolom, definisi, n))
        for nama, tabel, kolom, _, n in lepas:
            if n:
                print(f"🔗 {tabel}.{kolom}: {n} baris akan dikosongkan (rujukan ke tabel yang dihapus)")

        if not kosongkan:
            print("\n(tidak ada tabel yang perlu dikosongkan)")
            return 0
        if not args.dry_run and not args.yes:
            jawab = input(f'\n⚠️  Data di atas hilang PERMANEN. Ketik nama database "{nama_db}" untuk melanjutkan: ').strip()
            if jawab != nama_db:
                print("Dibatalkan. TIDAK ADA YANG DIUBAH.")
                return 1

        print()
        try:
            for nama, tabel, kolom, _, n in lepas:
                cur.execute(f"ALTER TABLE {_q(tabel)} DROP CONSTRAINT {_q(nama)}")
                if n:
                    cur.execute(f"UPDATE {_q(tabel)} SET {_q(kolom)} = NULL WHERE {_q(kolom)} IS NOT NULL")
                    print(f"   🔗 {cur.rowcount} baris {tabel}.{kolom} dikosongkan")
            cur.execute("TRUNCATE " + ", ".join(_q(t) for t in kosongkan) + " RESTART IDENTITY")
            print(f"   🗑️  {len(kosongkan)} tabel dikosongkan")
            for nama, tabel, _, definisi, _ in lepas:
                cur.execute(f"ALTER TABLE {_q(tabel)} ADD CONSTRAINT {_q(nama)} {definisi}")
            if lepas:
                print(f"   🔒 {len(lepas)} foreign key dipasang kembali")
        except Exception as e:  # noqa: BLE001
            conn.rollback()
            pesan = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)
            print(f"\n❌ Gagal: {pesan}")
            print("   Semua perubahan di-ROLLBACK — TIDAK ADA YANG DIUBAH.")
            return 1

        if args.dry_run:
            conn.rollback()
            print("\n🧪 DRY RUN selesai — semua perubahan di-ROLLBACK, tidak ada yang tersimpan.")
            return 0
        conn.commit()
    finally:
        conn.close()

    print("\n✅ Semua data dihapus. User login tetap ada.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
