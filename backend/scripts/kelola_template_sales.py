"""
scripts/kelola_template_sales.py
================================
Cek & kelola baris di tabel financial_transaction_sales_import_templates
berdasarkan column_signature_hash dan/atau client_id -- menggantikan query
SQL manual yang perlu diketik ulang tiap kali.

Kenapa perlu: template tidak bisa langsung di-DELETE kalau sudah ada
financial_transaction_sales_source_files yang memakainya (FK template_id),
dan menghapusnya juga menghilangkan jejak file mana yang pernah memakainya.
Skrip ini menunjukkan dulu siapa yang memakai template, lalu menyediakan
2 jalan keluar yang aman.

DEFAULT-NYA HANYA MEMBACA (dry-run) -- tidak ada yang berubah di database
sampai --terapkan diberikan.

Aksi (--aksi):
    lihat        (default) tampilkan template, file upload yang memakainya, dan
                 contoh baris tidak valid. Tidak mengubah apa pun.
    pensiunkan   template dinonaktifkan (is_active=false) dan hash-nya digeser
                 jadi 'nonaktif-<id>' supaya UNIQUE (client_id, file_type,
                 hash) bebas dan seed bisa menyisipkan template baru. Riwayat
                 source_files TETAP utuh. Disarankan.
    hapus        template DIHAPUS PERMANEN setelah source_files yang memakainya
                 dilepas (template_id -> NULL). Jejak "file X memakai template
                 Y" hilang. Minta konfirmasi ketik HAPUS (lewati dengan --ya).

Cara pakai (dari folder backend, pakai Python venv project):
    venv\\Scripts\\python scripts\\kelola_template_sales.py --hash 9d847b64d3b8
    venv\\Scripts\\python scripts\\kelola_template_sales.py --client-id <uuid>
    venv\\Scripts\\python scripts\\kelola_template_sales.py --hash 9d847b64d3b8 --aksi pensiunkan
    venv\\Scripts\\python scripts\\kelola_template_sales.py --hash 9d847b64d3b8 --aksi pensiunkan --terapkan

Filter (minimal salah satu; kalau lebih dari satu, semuanya harus cocok):
    --hash          column_signature_hash, lengkap atau awalannya (min. 6 karakter hex)
    --client-id     management_clients.id (UUID)
    --template-id   id baris template (UUID)
    --file-type     CSV / Excel / Multi / ...
"""

import argparse
import re
import sys
import uuid
from pathlib import Path

# Console Windows default-nya cp1252 -> print() emoji melempar UnicodeEncodeError.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
_DOTENV_TERPASANG = True
try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" (db_client membaca
    # DATABASE_URL saat di-import).
    load_dotenv(dotenv_path=_ENV_PATH)
except ImportError:
    _DOTENV_TERPASANG = False

from sqlalchemy import text  # noqa: E402

from db_client import engine  # noqa: E402

TABEL = "financial_transaction_sales_import_templates"
AWALAN_NONAKTIF = "nonaktif-"
BATAS_FILE_DITAMPILKAN = 10
BATAS_BARIS_INVALID_DITAMPILKAN = 5


def _uuid_atau_keluar(nilai: str, nama_opsi: str) -> str:
    try:
        return str(uuid.UUID(nilai))
    except ValueError:
        sys.exit(f"❌ {nama_opsi} '{nilai}' bukan UUID yang valid.")


def _cari_template(conn, hash_awalan, client_id, template_id, file_type):
    baris = conn.execute(
        text(
            f"""
            SELECT t.id, t.client_id, m.nama_client, t.client_code, t.file_type,
                   t.is_active, t.usage_count, t.column_signature_hash, t.created_at
            FROM {TABEL} t
            LEFT JOIN management_clients m ON m.id = t.client_id
            WHERE (CAST(:hash_like AS text) IS NULL OR t.column_signature_hash ILIKE CAST(:hash_like AS text))
              AND (CAST(:client_id AS uuid) IS NULL OR t.client_id = CAST(:client_id AS uuid))
              AND (CAST(:template_id AS uuid) IS NULL OR t.id = CAST(:template_id AS uuid))
              AND (CAST(:file_type AS text) IS NULL OR t.file_type = CAST(:file_type AS text))
            ORDER BY m.nama_client, t.file_type, t.created_at
            """
        ),
        {
            "hash_like": f"{hash_awalan}%" if hash_awalan else None,
            "client_id": client_id,
            "template_id": template_id,
            "file_type": file_type,
        },
    ).mappings().all()
    return [dict(b) for b in baris]


def _file_pemakai(conn, template_id):
    return [
        dict(b)
        for b in conn.execute(
            text(
                """
                SELECT id, file_name, status_ekstraksi, rows_detected, rows_valid,
                       rows_invalid, uploaded_at
                FROM financial_transaction_sales_source_files
                WHERE template_id = CAST(:tid AS uuid)
                ORDER BY uploaded_at DESC
                """
            ),
            {"tid": str(template_id)},
        ).mappings()
    ]


def _baris_invalid(conn, template_id):
    return [
        dict(b)
        for b in conn.execute(
            text(
                """
                SELECT f.file_name, r.row_no, r.no_invoice, r.tanggal, r.validation_notes
                FROM financial_transaction_sales_source_rows r
                JOIN financial_transaction_sales_source_files f ON f.id = r.source_file_id
                WHERE f.template_id = CAST(:tid AS uuid) AND r.is_valid = false
                ORDER BY f.uploaded_at DESC, r.row_no
                LIMIT :batas
                """
            ),
            {"tid": str(template_id), "batas": BATAS_BARIS_INVALID_DITAMPILKAN},
        ).mappings()
    ]


def _tampilkan_template(conn, t) -> list:
    """Cetak ringkasan 1 template + file pemakainya. Return daftar file pemakai."""
    sudah_nonaktif = str(t["column_signature_hash"]).startswith(AWALAN_NONAKTIF)
    print("-" * 70)
    print(f"Template : {t['id']}")
    print(f"  Klien      : {t['nama_client'] or '(klien tidak ditemukan)'}  [{t['client_id']}]  kode={t['client_code']}")
    print(f"  Tipe file  : {t['file_type']}")
    print(f"  Aktif      : {t['is_active']}{'  (SUDAH DIPENSIUNKAN)' if sudah_nonaktif else ''}")
    print(f"  usage_count: {t['usage_count']}")
    print(f"  Hash       : {t['column_signature_hash']}")
    print(f"  Dibuat     : {t['created_at']}")

    pemakai = _file_pemakai(conn, t["id"])
    print(f"  File upload yang memakai template ini: {len(pemakai)}")
    for f in pemakai[:BATAS_FILE_DITAMPILKAN]:
        print(
            f"    - {f['file_name']} | {f['status_ekstraksi']} | "
            f"baris={f['rows_detected']} valid={f['rows_valid']} invalid={f['rows_invalid']} | {f['uploaded_at']:%Y-%m-%d %H:%M}"
        )
    if len(pemakai) > BATAS_FILE_DITAMPILKAN:
        print(f"    ... dan {len(pemakai) - BATAS_FILE_DITAMPILKAN} file lainnya")

    if any((f["rows_invalid"] or 0) > 0 for f in pemakai):
        print(f"  Contoh baris TIDAK VALID (maks {BATAS_BARIS_INVALID_DITAMPILKAN}) -- inilah yang membuat status 'Butuh Review':")
        for b in _baris_invalid(conn, t["id"]):
            print(f"    - {b['file_name']} baris {b['row_no']} | invoice={b['no_invoice']} | tgl={b['tanggal']} | {b['validation_notes']}")
    return pemakai


def _pensiunkan(conn, t) -> str:
    if str(t["column_signature_hash"]).startswith(AWALAN_NONAKTIF):
        return "dilewati (sudah dipensiunkan)"
    conn.execute(
        text(
            f"""
            UPDATE {TABEL}
            SET is_active = false,
                column_signature_hash = :hash_baru,
                edited_at = now()
            WHERE id = CAST(:tid AS uuid)
            """
        ),
        {"tid": str(t["id"]), "hash_baru": f"{AWALAN_NONAKTIF}{t['id']}"},
    )
    return "dipensiunkan (is_active=false, hash digeser)"


def _hapus(conn, t) -> str:
    dilepas = conn.execute(
        text(
            """
            UPDATE financial_transaction_sales_source_files
            SET template_id = NULL
            WHERE template_id = CAST(:tid AS uuid)
            """
        ),
        {"tid": str(t["id"])},
    ).rowcount
    conn.execute(text(f"DELETE FROM {TABEL} WHERE id = CAST(:tid AS uuid)"), {"tid": str(t["id"])})
    return f"DIHAPUS ({dilepas} source_files dilepas dari template ini)"


def _cek_koneksi_postgres() -> None:
    if engine.dialect.name == "postgresql":
        print(f"🔌 Database: {engine.url.render_as_string(hide_password=True)}")
        return
    print(f"❌ Database yang terhubung: {engine.url.render_as_string(hide_password=True)}")
    print("   Skrip ini butuh PostgreSQL. Diagnosis:")
    print(f"   - Python yang dipakai : {sys.executable}")
    print(f"   - python-dotenv       : {'terpasang' if _DOTENV_TERPASANG else 'TIDAK TERPASANG  <-- penyebab (bukan venv project?)'}")
    print(f"   - {_ENV_PATH} : {'ada' if _ENV_PATH.exists() else 'TIDAK ADA  <-- penyebab'}")
    sys.exit(1)


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Cek/kelola template import sales berdasarkan hash atau client_id (default: hanya membaca).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Detail & contoh: lihat docstring di kepala file ini.",
    )
    ap.add_argument("--hash", dest="hash", help="column_signature_hash (lengkap atau awalan, min. 6 hex)")
    ap.add_argument("--client-id", help="management_clients.id (UUID)")
    ap.add_argument("--template-id", help="id baris template (UUID)")
    ap.add_argument("--file-type", help="CSV / Excel / Multi / ...")
    ap.add_argument("--aksi", choices=["lihat", "pensiunkan", "hapus"], default="lihat")
    ap.add_argument("--terapkan", action="store_true", help="benar-benar menulis ke database (tanpa ini = dry-run)")
    ap.add_argument("--ya", action="store_true", help="lewati konfirmasi ketik HAPUS (hanya untuk --aksi hapus)")
    ap.add_argument("--semua", action="store_true", help="izinkan aksi ubah/hapus ke LEBIH DARI 1 template yang cocok")
    args = ap.parse_args()

    if not any([args.hash, args.client_id, args.template_id]):
        ap.error("Isi minimal salah satu dari --hash, --client-id, atau --template-id.")

    hash_awalan = None
    if args.hash:
        hash_awalan = args.hash.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{6,64}", hash_awalan):
            sys.exit("❌ --hash harus hex (0-9, a-f) sepanjang 6-64 karakter.")
    client_id = _uuid_atau_keluar(args.client_id, "--client-id") if args.client_id else None
    template_id = _uuid_atau_keluar(args.template_id, "--template-id") if args.template_id else None

    print("=" * 70)
    print(f"🔎 KELOLA TEMPLATE SALES -- aksi: {args.aksi}{'  (DRY-RUN)' if args.aksi != 'lihat' and not args.terapkan else ''}")
    print("=" * 70)
    _cek_koneksi_postgres()

    with engine.connect() as conn:
        templates = _cari_template(conn, hash_awalan, client_id, template_id, args.file_type)
        if not templates:
            print("Tidak ada template yang cocok dengan filter tersebut.")
            return 1
        print(f"Ditemukan {len(templates)} template.")
        for t in templates:
            _tampilkan_template(conn, t)

    if args.aksi == "lihat":
        print("-" * 70)
        print("Tidak ada perubahan (aksi 'lihat'). Pakai --aksi pensiunkan / hapus untuk mengubah.")
        return 0

    if len(templates) > 1 and not args.semua:
        print("-" * 70)
        print(f"❌ {len(templates)} template cocok. Persempit filter (--template-id / --file-type / hash lengkap),")
        print("   atau tambahkan --semua kalau memang ingin aksi ini ke semuanya.")
        return 1

    if not args.terapkan:
        print("-" * 70)
        print(f"DRY-RUN: aksi '{args.aksi}' akan dijalankan ke {len(templates)} template di atas. Tidak ada yang berubah.")
        print("Tambahkan --terapkan untuk menjalankannya.")
        return 0

    if args.aksi == "hapus" and not args.ya:
        print("-" * 70)
        print("⚠️  HAPUS = permanen. Jejak file upload -> template ini hilang (source_files.template_id jadi NULL).")
        try:
            jawaban = input("Ketik HAPUS untuk melanjutkan: ").strip()
        except EOFError:
            jawaban = ""
        if jawaban != "HAPUS":
            print("Dibatalkan, tidak ada yang berubah.")
            return 1

    # 1 transaksi untuk semua template: gagal di tengah -> semuanya di-rollback.
    aksi = _pensiunkan if args.aksi == "pensiunkan" else _hapus
    try:
        with engine.begin() as conn:
            hasil = [(t, aksi(conn, t)) for t in templates]
    except Exception as e:  # noqa: BLE001
        pesan = str(e).strip().splitlines()[0] if str(e).strip() else repr(e)
        print(f"❌ Gagal (tidak ada yang tersimpan): {pesan}")
        return 1

    print("-" * 70)
    for t, ket in hasil:
        print(f"✅ {t['id']} ({t['nama_client']} / {t['file_type']}): {ket}")
    if args.aksi == "pensiunkan":
        print("Lanjut: jalankan seed-nya lagi lewat migrations/run_seed.py kalau perlu template baru.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
