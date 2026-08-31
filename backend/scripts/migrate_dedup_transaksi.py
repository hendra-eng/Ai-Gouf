"""
scripts/migrate_dedup_transaksi.py
====================================
Migrasi SEKALI JALAN untuk fitur dedup upload rekening koran:

  1. Tambah kolom `kode_bank` & `transaction_hash` ke tabel `jurnal_posting`
     yang SUDAH ADA (Base.metadata.create_all() di db_client.init_db()
     TIDAK menambah kolom ke tabel yang sudah ada -- cuma bikin tabel yang
     belum ada -- jadi kolom baru WAJIB ditambah manual lewat ALTER TABLE).
  2. Buat tabel `upload_batches` (tabel baru -- otomatis dibuat lewat
     Base.metadata.create_all() asal model UploadBatch sudah ditempel ke
     db_client.py sesuai patches/db_client_TAMBAHAN.py).
  3. (Opsional, direkomendasikan) Backfill kode_bank & transaction_hash
     utk baris jurnal_posting rekening_koran yang SUDAH ADA sebelum
     migrasi ini -- supaya deteksi duplikat langsung "melihat" histori
     lama, bukan cuma upload-upload berikutnya.

Aman dijalankan berkali-kali (idempotent) -- pakai `IF NOT EXISTS` /
cek kolom dulu sebelum ALTER, dan backfill cuma menyentuh baris yang
transaction_hash-nya masih NULL.

Cara pakai:
    cd backend
    python scripts/migrate_dedup_transaksi.py
"""

from __future__ import annotations

import sys

sys.path.insert(0, ".")  # supaya "import db_client" jalan kalau dipanggil dari folder backend/

import db_client as dbc  # noqa: E402
from sqlalchemy import text  # noqa: E402


def _kolom_sudah_ada(session, nama_tabel: str, nama_kolom: str) -> bool:
    """Cek keberadaan kolom secara portable (bukan cuma Postgres) lewat
    information_schema kalau tersedia, fallback ke PRAGMA utk SQLite."""
    dialect = session.bind.dialect.name
    if dialect == "sqlite":
        hasil = session.execute(text(f"PRAGMA table_info({nama_tabel})")).fetchall()
        return any(row[1] == nama_kolom for row in hasil)
    hasil = session.execute(
        text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = :tabel AND column_name = :kolom"
        ),
        {"tabel": nama_tabel, "kolom": nama_kolom},
    ).fetchall()
    return len(hasil) > 0


def tambah_kolom_jurnal_posting():
    print("== Langkah 1: kolom baru di jurnal_posting ==")
    session = dbc.SessionLocal()
    try:
        if not _kolom_sudah_ada(session, "jurnal_posting", "kode_bank"):
            session.execute(text("ALTER TABLE jurnal_posting ADD COLUMN kode_bank VARCHAR(20)"))
            session.commit()
            print("  ✅ Kolom 'kode_bank' ditambahkan.")
        else:
            print("  ⏭️  Kolom 'kode_bank' sudah ada, dilewati.")

        if not _kolom_sudah_ada(session, "jurnal_posting", "transaction_hash"):
            session.execute(text("ALTER TABLE jurnal_posting ADD COLUMN transaction_hash VARCHAR(64)"))
            session.commit()
            print("  ✅ Kolom 'transaction_hash' ditambahkan.")
        else:
            print("  ⏭️  Kolom 'transaction_hash' sudah ada, dilewati.")

        # Index terpisah (aman kalau ADD COLUMN di atas tidak otomatis
        # bikin index tergantung dialect DB).
        try:
            session.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_jurnal_posting_kode_bank "
                "ON jurnal_posting (kode_bank)"
            ))
            session.execute(text(
                "CREATE INDEX IF NOT EXISTS ix_jurnal_posting_transaction_hash "
                "ON jurnal_posting (transaction_hash)"
            ))
            session.commit()
            print("  ✅ Index kode_bank & transaction_hash siap.")
        except Exception as e:  # noqa: BLE001
            print(f"  ⚠️  Gagal bikin index (mungkin dialect tidak dukung 'IF NOT EXISTS' pada index): {e}")
            session.rollback()
    finally:
        session.close()


def buat_tabel_upload_batches():
    print("== Langkah 2: tabel upload_batches ==")
    # Ini otomatis membuat SEMUA tabel yang belum ada (termasuk
    # upload_batches) berdasarkan model yang terdaftar ke Base -- aman
    # dipanggil walau tabel lain sudah ada (create_all tidak menimpa
    # tabel yang sudah ada, cuma yang belum ada).
    dbc.init_db()
    print("  ✅ Tabel 'upload_batches' siap (dibuat kalau belum ada).")


def backfill_hash_transaksi_lama(batas_baris: int = 20000):
    """
    Isi kode_bank & transaction_hash utk baris jurnal_posting jenis
    'rekening_koran' yang SUDAH ADA sebelum migrasi ini (transaction_hash
    masih NULL). Tanpa langkah ini, deteksi duplikat cuma "melihat" upload
    yang terjadi SETELAH migrasi -- upload lama tidak ikut dibandingkan.

    kode_bank diambil dari prefix `voucher` (format "KODEBANK-MMYY-N")
    kalau ada -- kalau voucher NULL (mis. baris placeholder yang belum
    sempat diposting), baris itu dilewati (tidak bisa dipastikan
    bank/periode-nya tanpa data mentah asli, aman dilewati -- baris itu
    tetap ada di jurnal_posting seperti biasa, cuma tidak ikut dicek
    dedup sampai ada upload baru utk bank/periode yang sama).
    """
    print("== Langkah 3 (opsional): backfill hash transaksi lama ==")
    session = dbc.SessionLocal()
    try:
        rows = (
            session.query(dbc.JurnalPosting)
            .filter(
                dbc.JurnalPosting.jenis_dokumen == "rekening_koran",
                dbc.JurnalPosting.transaction_hash.is_(None),
            )
            .limit(batas_baris)
            .all()
        )
        if not rows:
            print("  ⏭️  Tidak ada baris lama yang perlu di-backfill.")
            return

        diisi = 0
        dilewati = 0
        for j in rows:
            if not j.voucher:
                dilewati += 1
                continue
            kode_bank = j.voucher.split("-")[0]
            baris_setara = {
                "tanggal": j.tanggal,
                "bank": kode_bank,
                "keterangan": j.keterangan,
                "jml_debet": j.jml_debet,
                "jml_kredit": j.jml_kredit,
                # saldo tidak tersedia lagi di jurnal_posting (kolom ini
                # sengaja tidak disimpan permanen di sana) -- backfill
                # jadi sedikit lebih "longgar" dibanding hash baris baru
                # (yang bisa pakai saldo kalau tersedia di draf_jurnal),
                # tapi tetap jauh lebih baik daripada tidak ada dedup
                # sama sekali utk data lama.
            }
            j.kode_bank = kode_bank
            j.transaction_hash = dbc._buat_transaction_hash_baris(baris_setara)
            diisi += 1

        session.commit()
        print(f"  ✅ {diisi} baris di-backfill, {dilewati} baris dilewati (tidak ada nomor voucher).")
    except Exception as e:  # noqa: BLE001
        session.rollback()
        print(f"  ❌ Gagal backfill: {e}")
    finally:
        session.close()


if __name__ == "__main__":
    if not dbc.cek_koneksi():
        print("❌ Tidak bisa konek ke database -- cek DATABASE_URL di .env. Migrasi dibatalkan.")
        sys.exit(1)

    tambah_kolom_jurnal_posting()
    buat_tabel_upload_batches()
    backfill_hash_transaksi_lama()
    print("\n✅ Migrasi selesai.")