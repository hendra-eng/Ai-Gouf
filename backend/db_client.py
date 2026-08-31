# db_client.py - Kode database client yang benar
"""
db_client.py
============
Client database untuk menyimpan hasil analisis per client.
"""

import hashlib
import json
import os
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

import pandas as pd
from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime,
    Text, Float, Boolean, ForeignKey, ForeignKeyConstraint, text, UniqueConstraint, Index,
    func,  # dipakai hitung_signature_data_laporan() (MAX/COUNT agregat)
)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

# ============================================================
# KONFIGURASI DATABASE
# ============================================================

# [FIX] Backend sekarang FastAPI + React (bukan Streamlit lagi), jadi
# konfigurasi cukup dibaca langsung dari environment variable. Nilainya
# datang dari file .env yang di-load oleh load_dotenv() di main.py,
# SEBELUM modul ini di-import -- lihat catatan di main.py.
def get_database_url():
    return os.environ.get("DATABASE_URL", "sqlite:///ai_gouf.db")

DATABASE_URL = get_database_url()
Base = declarative_base()
engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_recycle=280)
SessionLocal = sessionmaker(bind=engine)


# ============================================================
# [FIX -- POINT 4] BULK UPSERT HELPER (dialect-aware)
# ============================================================
# Sebelumnya beberapa fungsi simpan_* melakukan 1 SELECT + 1 INSERT/UPDATE
# per baris di dalam loop Python (N+1 pattern) -- untuk COA/jurnal besar
# (ratusan akun x 12 bulan, atau ribuan baris rekening koran) ini jadi
# ratusan/ribuan round-trip ke database per panggilan, walau semuanya
# di-commit dalam 1 transaksi. Helper ini menggantikannya dengan SATU
# statement INSERT ... ON CONFLICT DO UPDATE yang mencakup semua baris
# sekaligus -- didukung native oleh SQLite (3.24+) & PostgreSQL (termasuk
# Supabase, lihat DATABASE_URL di atas), jadi dipilih berdasarkan
# engine.dialect.name supaya jalan di kedua environment (lokal & produksi)
# tanpa cabang kode manual di tiap fungsi pemanggil.
def _bulk_upsert(session, model, rows: List[Dict[str, Any]], index_elements: List[str],
                  update_cols: List[str]) -> int:
    """
    Insert-atau-update banyak baris sekaligus dalam 1 statement.

    model: kelas ORM (mis. RiwayatSaldoBulanan)
    rows: list of dict, tiap dict = 1 baris (harus mencakup semua kolom
          NOT NULL termasuk kolom index_elements)
    index_elements: nama kolom yang membentuk unique constraint (dipakai
          untuk deteksi konflik) -- HARUS sama persis dengan
          UniqueConstraint/PrimaryKey yang ada di model
    update_cols: nama kolom yang di-update kalau baris sudah ada
          (index_elements sendiri tidak perlu disertakan di sini)

    Return: jumlah baris yang diproses (insert atau update).
    """
    if not rows:
        return 0
    dialect = engine.dialect.name
    if dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        stmt = pg_insert(model.__table__).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(stmt)
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        stmt = sqlite_insert(model.__table__).values(rows)
        stmt = stmt.on_conflict_do_update(
            index_elements=index_elements,
            set_={col: getattr(stmt.excluded, col) for col in update_cols},
        )
        session.execute(stmt)
    else:
        # Fallback dialect lain yang tidak didukung ON CONFLICT native --
        # tetap benar secara hasil, walau kembali ke pola per-baris lama.
        for row in rows:
            filters = [getattr(model, k) == row[k] for k in index_elements]
            existing = session.query(model).filter(*filters).first()
            if existing:
                for col in update_cols:
                    setattr(existing, col, row[col])
            else:
                session.add(model(**row))
    return len(rows)

# ============================================================
# MODEL DATABASE
# ============================================================

class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True)
    nama = Column(String(200), nullable=False)
    lokasi = Column(String(200), nullable=True)
    tipe = Column(String(50), nullable=False, default="accounting")  # "accounting" atau "pajak"
    # [BARU] Kontak client -- dipakai sistem reminder deadline SPT utk kirim
    # notifikasi WA/email proaktif sebelum jatuh tempo. Nullable krn client
    # lama belum tentu punya data ini (isi belakangan lewat endpoint kontak).
    nomor_wa = Column(String(30), nullable=True)  # format internasional mis. 6281234567890
    email = Column(String(200), nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    hasil = relationship("Hasil", back_populates="client")
    # [BARU] Akun integrasi ESB (POS/kasir) milik client ini -- lihat
    # class EsbAccount di bawah. Satu client bisa punya lebih dari satu
    # akun ESB (mis. beda outlet), makanya bentuknya list (one-to-many).
    esb_accounts = relationship("EsbAccount", back_populates="client")


# [BARU] Tabel esb_accounts sudah ada duluan di Supabase (dibuat manual),
# model ini cuma "menjembatani" supaya kode Python bisa baca/tulis ke sana.
# Berisi kredensial integrasi API ke sistem POS/kasir ESB per client --
# lihat catatan soal ESB di modules/file_detector.py.
class EsbAccount(Base):
    __tablename__ = "esb_accounts"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    account_name = Column(String(200), nullable=False)
    esb_type = Column(String(50), nullable=True)
    api_base_url = Column(String(500), nullable=True)
    consumer_key = Column(String(255), nullable=True)
    consumer_secret = Column(String(255), nullable=True)  # SENSITIF -- jangan pernah dikirim balik ke frontend apa adanya
    is_active = Column(Boolean, default=True)
    is_default = Column(Boolean, default=False)
    auto_discover = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    client = relationship("Client", back_populates="esb_accounts")


class Hasil(Base):
    __tablename__ = "hasil"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    jenis = Column(String(50), nullable=False)  # "bank", "jual", "penilaian", "piutang"
    conv_id = Column(String(50), nullable=True)
    data = Column(Text, nullable=True)  # JSON string
    dibaca_at = Column(DateTime, default=datetime.now)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client", back_populates="hasil")


# [BARU] Tabel terpisah untuk hasil yang spesifik milik 1 akun ESB
# (bukan hasil umum client -- lihat tabel 'hasil' di atas). Dipisah jadi
# tabel sendiri (bukan kolom esb_account_id di 'hasil') supaya jelas dan
# konsisten dengan pola esb_accounts yang juga tabel terpisah dari clients.
class HasilEsb(Base):
    __tablename__ = "hasil_esb"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    esb_account_id = Column(Integer, ForeignKey("esb_accounts.id"), nullable=False)
    jenis = Column(String(50), nullable=False)  # "bank", "jual", "penilaian", "piutang"
    conv_id = Column(String(50), nullable=True)
    data = Column(Text, nullable=True)  # JSON string
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")
    esb_account = relationship("EsbAccount")


class Coa(Base):
    """
    [BARU] Chart of Accounts PERMANEN per client -- sebelumnya COA cuma
    dibaca ulang dari sheet 'COA' tiap kali ada file diupload (tidak
    pernah disimpan), jadi tidak konsisten antar upload dan tidak bisa
    dipakai sebagai sumber kebenaran untuk menyusun Neraca/Laba Rugi
    (butuh peta akun -> kategori yang stabil).

    kategori WAJIB salah satu dari: ASET, LIABILITAS, EKUITAS,
    PENDAPATAN, BEBAN -- ini yang menentukan akun masuk ke Neraca atau
    Laba Rugi, dan di sisi Neraca yang mana. Divalidasi di modules/coa.py.
    """
    __tablename__ = "coa"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    no_akun = Column(String(50), nullable=False)
    nama_akun = Column(String(200), nullable=False)
    kategori = Column(String(20), nullable=True)   # ASET/LIABILITAS/EKUITAS/PENDAPATAN/BEBAN
    sub_kategori = Column(String(100), nullable=True)  # mis. "Aset Lancar", "Beban Operasional"
    normal_saldo = Column(String(10), nullable=True)   # DEBET/KREDIT
    saldo_awal = Column(Float, nullable=True, default=0)
    # [BARU - export 14 sheet] segment/arus_kas dipakai sheet "COA" &
    # laporan Arus Kas rinci; keduanya nullable karena COA lama belum
    # tentu diisi -- lihat migrations/add_columns_for_14_sheets.py.
    segment = Column(String(50), nullable=True)   # mis. "OPR"/"INV"/"FIN"
    arus_kas = Column(String(20), nullable=True)  # "OPERASI"/"INVESTASI"/"PENDANAAN"
    # [BARU] Catatan bebas per akun, dipakai sheet "COA" utk kolom
    # "Keterangan" (mis. "Kas kecil dan kas operasional") -- murni
    # dokumentasi, tidak dipakai logika laporan mana pun.
    keterangan = Column(Text, nullable=True)
    # [BARU - sheet Neraca Saldo Awal] Sebelumnya kolom "Lawan Transaksi"
    # & "Project/Asset Unit" di sheet Neraca Saldo Awal HARDCODE
    # "Pemilik"/"HO" utk SEMUA baris (lihat accounting_export.py) --
    # salah kalau akun asetnya macam-macam (mis. excavator vs
    # scaffolding vs modal per pemilik, lihat contoh user). Dua kolom
    # ini nullable, diisi per akun (opsional, lewat form COA) supaya
    # sheet Neraca Saldo Awal otomatis menyesuaikan data perusahaan yang
    # sebenarnya -- kalau kosong, export tetap jalan dengan fallback "-".
    lawan_transaksi_saldo_awal = Column(String(100), nullable=True)
    project_unit_saldo_awal = Column(String(100), nullable=True)
    aktif = Column(Boolean, default=True)
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    client = relationship("Client")


class JurnalPosting(Base):
    """
    [BARU] Antrean review & buku besar resmi per client.

    Kenapa perlu tabel terpisah dari 'hasil': draf_jurnal yang tersimpan
    di tabel 'hasil' untuk 13 dari 15 jenis dokumen (semua KECUALI
    rekening_koran & penjualan) berisi akun PLACEHOLDER generik
    (mis. "KAS", "PENDAPATAN/PIUTANG/LAIN", "PIUTANG/KAS") -- bukan
    nomor akun COA asli, karena butuh keputusan manusia (akuntan) akun
    lawannya yang tepat itu apa.

    Baris di sini punya siklus hidup:
      draft       -> baru ditarik dari draf_jurnal, akun masih placeholder
      terposting  -> sudah dikonfirmasi/dikoreksi akuntan, SIAP dipakai
                     sebagai sumber Neraca/Laba Rugi/dst
      ditolak     -> dianggap tidak valid (mis. duplikat, salah deteksi)

    Hanya baris berstatus 'terposting' yang dipakai
    modules/laporan_keuangan.py untuk menyusun 5 laporan standar.

    [FIX] hasil_id direferensikan lewat ForeignKeyConstraint komposit
    (hasil_id, client_id) -> hasil(id, client_id), BUKAN ForeignKey biasa
    di kolom hasil_id saja -- karena tabel 'hasil' di database aktual
    (Supabase) adalah partitioned table dengan PRIMARY KEY komposit
    (id, client_id), jadi tidak ada constraint unique di kolom id saja.
    """
    __tablename__ = "jurnal_posting"
    __table_args__ = (
        ForeignKeyConstraint(
            ["hasil_id", "client_id"],
            ["hasil.id", "hasil.client_id"],
        ),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    hasil_id = Column(Integer, nullable=True)
    jenis_dokumen = Column(String(50), nullable=True)
    tanggal = Column(String(20), nullable=True)
    keterangan = Column(Text, nullable=True)
    # [BARU - export 14 sheet] nama pelanggan/vendor lawan transaksi per
    # baris, dipakai sheet "GL 2025" -- nullable krn baris lama tidak
    # punya nilai ini. Diisi manual/koreksi akuntan saat posting, BUKAN
    # ditebak otomatis dari keterangan.
    lawan_transaksi = Column(String(200), nullable=True)
    # [BARU - fix GL 2025] tiga kolom ini sebelumnya tidak ada sama sekali
    # di model, padahal accounting_export.export_14_sheet_lengkap() sudah
    # mencoba membacanya (selalu None/kosong sebelum fix ini). Sama seperti
    # lawan_transaksi: diisi manual/koreksi akuntan saat posting lewat
    # konfirmasi_posting_jurnal(), BUKAN ditebak otomatis dari draf_jurnal,
    # karena field sumber per 15 jenis dokumen tidak konsisten namanya
    # (nomor_faktur/no_invoice/nomor_bukti/dst -- lihat catatan alias di
    # accounting_export.py). Lihat scripts/migrate_add_kolom_gl_2025.py
    # untuk ALTER TABLE pada database yang sudah ada.
    no_dokumen = Column(String(100), nullable=True)      # dipakai sheet GL utk "No. Dokumen" & "Invoice/Referensi"
    project_unit = Column(String(100), nullable=True)    # dipakai sheet GL utk "Project/Unit"
    jatuh_tempo = Column(String(20), nullable=True)      # dipakai sheet GL utk "Jatuh Tempo" (format bebas spt kolom tanggal)
    no_akun_debet = Column(String(50), nullable=False)
    nama_akun_debet = Column(String(200), nullable=True)
    jml_debet = Column(Float, nullable=False, default=0)
    no_akun_kredit = Column(String(50), nullable=False)
    nama_akun_kredit = Column(String(200), nullable=True)
    jml_kredit = Column(Float, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="draft")  # draft/terposting/ditolak
    sumber_placeholder = Column(Boolean, default=False)  # True kalau akun asal masih placeholder
    # [BARU - Prioritas #7] Voucher di-generate & disimpan SAAT baris ini
    # dibuat (di tarik_draf_jurnal_ke_posting(), untuk jenis_dokumen
    # "rekening_koran"), BUKAN belakangan saat export -- supaya:
    #  (a) nomor voucher permanen sejak baris masuk sistem, tidak berubah
    #      lagi walau di-export berkali-kali atau statusnya masih draft,
    #  (b) file Excel format-akuntan & tabel resmi jurnal_posting SELALU
    #      sinkron -- tidak ada dua "sumber kebenaran" yang beda.
    # NULL untuk 14 jenis dokumen lain yang belum pakai skema voucher ini.
    voucher = Column(String(50), nullable=True)
    periode_voucher = Column(String(10), nullable=True)  # format "MMYY", mis. "0726" -- disimpan biar gampang audit/filter tanpa parsing ulang tanggal
    # [BARU - Prioritas #7] Nomor baris asli (field "baris" di draf_jurnal,
    # 1-based dari urutan df_hasil) -- dipakai utk mencocokkan balik baris
    # jurnal_posting ini ke baris df_hasil yang dibaca ulang dari tabel
    # 'hasil' saat export. SENGAJA pakai posisi baris, BUKAN pencocokan
    # berbasis konten (tanggal+keterangan+akun) -- rekening koran sering
    # punya beberapa transaksi IDENTIK (mis. beberapa "TRANSFER MASUK"
    # nominal sama di hari yang sama), yang bikin pencocokan konten ambigu.
    baris_asal = Column(Integer, nullable=True)
    # [BARU - dedup upload] Kode bank SENDIRI (bukan cuma tersirat lewat
    # prefix voucher) -- dipakai modules/dedup_transaksi.py utk query
    # cepat "transaksi aktif kombinasi bank+periode ini apa saja" tanpa
    # parsing string voucher (yang bisa NULL utk 14 jenis dokumen lain).
    kode_bank = Column(String(20), nullable=True, index=True)
    # [BARU - dedup upload] Fingerprint SHA-256 baris ini (lihat
    # modules/dedup_transaksi.py::buat_signature_baris() -- formula
    # HARUS identik dgn _buat_transaction_hash_baris() di bawah).
    # Dipakai utk mendeteksi baris yang sudah pernah masuk sistem
    # sebelum upload rekening koran BARU/revisi ditarik ke posting,
    # supaya tidak dobel hitung & tidak membakar nomor voucher baru
    # utk transaksi yang sebenarnya sudah ada vouchernya.
    transaction_hash = Column(String(64), nullable=True, index=True)
    diposting_oleh = Column(String(100), nullable=True)
    diposting_at = Column(DateTime, nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


class RiwayatSaldoBulanan(Base):
    """
    [BARU - export 14 sheet] Snapshot saldo per akun per bulan, dipakai
    sheet "Ringkasan" untuk menampilkan tren Piutang/Utang per bulan.

    Sistem sebelumnya cuma menyimpan hasil upload AR/AP aging yang
    TERBARU (bukan snapshot tiap bulan), jadi tren bulanan tidak bisa
    disusun tanpa tabel ini. Baris di sini diisi tiap kali laporan
    bulanan digenerate (lihat db_client.simpan_riwayat_saldo_bulanan(),
    dipanggil dari endpoint generate laporan bulanan di main.py).
    """
    __tablename__ = "riwayat_saldo_bulanan"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    no_akun = Column(String(50), nullable=False)
    nama_akun = Column(String(200), nullable=False)
    kategori = Column(String(20), nullable=True)
    sub_kategori = Column(String(100), nullable=True)
    tahun = Column(Integer, nullable=False)
    bulan = Column(Integer, nullable=False)  # 1-12
    saldo_akhir = Column(Float, nullable=False, default=0)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")

    __table_args__ = (
        Index("idx_riwayat_saldo_client_akun_tahun", "client_id", "no_akun", "tahun"),
        UniqueConstraint("client_id", "no_akun", "tahun", "bulan",
                          name="uq_riwayat_saldo_client_akun_bulan"),
    )


class VoucherCounter(Base):
    """
    [BARU - Prioritas #4] Counter nomor voucher PERSISTEN per
    client + bank + periode -- menggantikan `urutan_voucher: Dict[str, int]`
    lokal di accounting_export.py yang sebelumnya SELALU mulai dari 0 lagi
    tiap kali export_rekening_koran_format_akuntan() dipanggil (jadi kalau
    akuntan upload ulang/revisi rekening koran bulan yang sama, nomor
    voucher dobel dengan file sebelumnya).

    [BERUBAH - Prioritas #7] Counter ini sekarang HANYA diambil dari SATU
    tempat: tarik_draf_jurnal_ke_posting() (dipanggil sekali saat upload
    lewat /api/proses-file). accounting_export.py TIDAK LAGI memanggil
    ambil_blok_nomor_voucher() sendiri saat export ke Excel -- ia hanya
    membaca voucher yang sudah tersimpan di jurnal_posting, supaya nomor
    di Excel selalu identik dengan yang tercatat di database.

    Satu baris di sini = satu counter untuk kombinasi
    (client_id, kode_bank, periode). "nomor_terakhir" adalah nomor urut
    TERAKHIR yang sudah dipakai -- nomor voucher berikutnya = nomor_terakhir + 1.

    periode disimpan dalam format "MMYY" (mis. "0726" untuk Juli 2026) --
    SENGAJA dibuat SAMA PERSIS dengan format yang tercetak di nomor voucher
    itu sendiri (mis. "BRI-0726-1"), supaya baris di tabel ini gampang
    ditelusuri manual kalau perlu audit/reset, tanpa perlu konversi format.

    UniqueConstraint memastikan tidak mungkin ada 2 baris counter utk
    kombinasi client+bank+periode yang sama (row itulah yang di-lock &
    di-update tiap kali ada voucher baru, lihat ambil_blok_nomor_voucher()).
    """
    __tablename__ = "voucher_counter"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    kode_bank = Column(String(20), nullable=False)   # mis. "BRI", "MANDIRI", "BCA"
    periode = Column(String(10), nullable=False)     # format "MMYY", mis. "0726"
    nomor_terakhir = Column(Integer, nullable=False, default=0)
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    client = relationship("Client")

    __table_args__ = (
        UniqueConstraint("client_id", "kode_bank", "periode", name="uq_voucher_counter_client_bank_periode"),
    )


class UploadBatch(Base):
    """
    [BARU - dedup upload] Satu baris = satu KELOMPOK (client_id,
    kode_bank, periode) dari satu file rekening koran yang diupload.
    Satu file upload bisa menghasilkan BEBERAPA baris UploadBatch kalau
    filenya multi-sheet/multi-bank/multi-bulan (lihat
    modules/dedup_transaksi.py::kelompokkan_draf_jurnal()).

    Dipakai utk 2 hal:
      1. Deteksi upload ulang/revisi -- ambil_batch_aktif() dipanggil
         SEBELUM baris baru ditarik ke jurnal_posting, dibandingkan lewat
         fingerprint (transaction_hash) baris-barisnya.
      2. Riwayat/audit upload -- daftar_upload_batch_client() menampilkan
         histori "kapan bank apa periode apa diupload, oleh siapa, hasil
         akhirnya apa" independen dari histori per-baris jurnal_posting.

    status:
      "aktif"               -- upload normal, baris-barisnya sudah masuk
                                jurnal_posting (baru ATAU revisi yang
                                sudah dikonfirmasi akuntan).
      "menunggu_konfirmasi" -- terdeteksi indikasi duplikat/revisi,
                                DITAHAN dulu (baris draf_jurnal-nya
                                disimpan di draf_jurnal_json), belum
                                ditarik ke jurnal_posting sama sekali.
                                Akuntan harus konfirmasi lewat endpoint
                                /api/upload-batch/{id}/konfirmasi.
      "dibatalkan"           -- akuntan menolak upload ini sepenuhnya
                                saat konfirmasi (mis. memang salah upload
                                ulang, tidak ada yang perlu ditarik).
      "revisi_diganti"       -- batch LAMA yang datanya sudah "ditimpa"
                                oleh batch baru yang lebih lengkap
                                (ditandai lewat tandai_batch_diganti()).

    file_hash: SHA-256 SELURUH file (bukan per baris) -- deteksi upload
    ulang file yang PERSIS SAMA, jauh lebih murah daripada bandingkan
    fingerprint per baris satu-satu (lihat cari_upload_batch_by_file_hash()).

    draf_jurnal_json: HANYA diisi kalau status == "menunggu_konfirmasi"
    -- snapshot draf_jurnal (list of dict) milik kelompok bank+periode
    ini, supaya endpoint konfirmasi bisa menariknya ke jurnal_posting
    belakangan tanpa akuntan perlu upload ulang filenya. Dikosongkan
    (None) begitu batch berpindah ke status lain, supaya tabel tidak
    membengkak menyimpan snapshot yang sudah tidak relevan.

    [FIX] hasil_id direferensikan lewat ForeignKeyConstraint komposit,
    sama seperti JurnalPosting -- lihat catatan [FIX] di class itu.
    """
    __tablename__ = "upload_batches"
    __table_args__ = (
        ForeignKeyConstraint(
            ["hasil_id", "client_id"],
            ["hasil.id", "hasil.client_id"],
        ),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    hasil_id = Column(Integer, nullable=True)
    jenis_dokumen = Column(String(50), nullable=False, default="rekening_koran")
    kode_bank = Column(String(20), nullable=False)
    periode = Column(String(10), nullable=False)  # format "MMYY"
    nama_file = Column(String(300), nullable=True)
    file_hash = Column(String(64), nullable=True, index=True)
    jumlah_baris_total = Column(Integer, nullable=False, default=0)
    jumlah_baris_baru = Column(Integer, nullable=False, default=0)
    jumlah_baris_overlap = Column(Integer, nullable=False, default=0)
    status_deteksi = Column(String(30), nullable=True)  # BARU/REVISI_SEBAGIAN/DUPLIKAT_PENUH/FILE_IDENTIK
    status = Column(String(30), nullable=False, default="aktif", index=True)
    draf_jurnal_json = Column(Text, nullable=True)
    diganti_oleh_batch_id = Column(Integer, ForeignKey("upload_batches.id"), nullable=True)
    diupload_oleh = Column(String(100), nullable=True)
    dikonfirmasi_oleh = Column(String(100), nullable=True)
    dikonfirmasi_at = Column(DateTime, nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")

    # [CATATAN] SENGAJA tidak ada UniqueConstraint di sini -- riwayat
    # boleh berisi banyak baris utk kombinasi (client_id, kode_bank,
    # periode) yang sama (satu per upload/revisi). "Batch aktif" utk
    # kombinasi itu ditentukan lewat query (status == "aktif", diambil
    # yang dibuat_at PALING BARU) di ambil_batch_aktif() di bawah, bukan
    # lewat constraint DB -- karena SATU kombinasi bisa berpindah status
    # aktif berkali-kali seiring waktu (revisi demi revisi).


class LaporanKeuangan(Base):
    """
    [BARU] Snapshot 5 Laporan Keuangan Standar per client per periode
    (Neraca, Laba Rugi, Perubahan Ekuitas, Arus Kas, CALK), hasil generate
    dari modules/laporan_keuangan.py. Disimpan sebagai snapshot (bukan
    dihitung ulang tiap dibuka) supaya ada histori resmi tiap tutup buku
    dan tidak berubah diam-diam kalau data mentah direvisi belakangan --
    revisi harus generate ulang secara eksplisit.
    """
    __tablename__ = "laporan_keuangan"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    periode = Column(String(20), nullable=False)  # mis. "2026-07"
    tanggal_mulai = Column(String(20), nullable=True)
    tanggal_akhir = Column(String(20), nullable=True)
    data = Column(Text, nullable=False)  # JSON: {neraca, laba_rugi, perubahan_ekuitas, arus_kas, calk, meta}
    dibuat_oleh = Column(String(100), nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    user = Column(String(100), nullable=False)
    aksi = Column(String(100), nullable=False)
    detail = Column(Text, nullable=True)  # JSON string
    dibuat_at = Column(DateTime, default=datetime.now)


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(50), nullable=False, default="tahap_1")
    nama = Column(String(200), nullable=True)
    aktif = Column(Boolean, default=True)
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


# [BARU] Riwayat percakapan chat, mirip sidebar "Chat History" di
# ChatGPT/Claude -- supaya percakapan tidak hilang begitu tab browser
# ditutup dan user bisa membuka lagi obrolan lama.
class Percakapan(Base):
    __tablename__ = "percakapan"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), nullable=False)  # pemilik percakapan
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    # [BARU] Kalau diisi, percakapan ini spesifik soal 1 akun ESB tertentu
    # (jalur terpisah dari percakapan umum soal client) -- lihat
    # daftar_percakapan(jalur=...) di bawah.
    esb_account_id = Column(Integer, ForeignKey("esb_accounts.id"), nullable=True)
    judul = Column(String(200), nullable=False, default="Percakapan Baru")
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    pesan = relationship("PesanChat", back_populates="percakapan", cascade="all, delete-orphan")


class PesanChat(Base):
    __tablename__ = "pesan_chat"

    id = Column(Integer, primary_key=True)
    percakapan_id = Column(Integer, ForeignKey("percakapan.id"), nullable=False)
    role = Column(String(20), nullable=False)  # "user" atau "assistant"
    content = Column(Text, nullable=False)
    dibuat_at = Column(DateTime, default=datetime.now)

    percakapan = relationship("Percakapan", back_populates="pesan")


# [BARU] Hasil analisis lanjutan pakai AI (DeepSeek) di atas data yang
# sudah tersimpan di tabel 'hasil'. Beda dari 'hasil' (yang isinya hasil
# ekstraksi/kategorisasi mentah per dokumen), 'hasil_analisis' isinya
# insight/ringkasan yang di-generate AI dari kumpulan hasil tsb -- lihat
# modules/ai_analysis.py.
class HasilAnalisis(Base):
    __tablename__ = "hasil_analisis"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    # Isi kalau analisis ini spesifik 1 akun ESB, sama seperti pola di
    # tabel 'hasil' dan 'percakapan'. None -> analisis umum seluruh client.
    esb_account_id = Column(Integer, ForeignKey("esb_accounts.id"), nullable=True)
    jenis_analisis = Column(String(100), nullable=False)  # mis. "ringkasan_keuangan", "deteksi_anomali"
    prompt = Column(Text, nullable=True)  # prompt yang dikirim ke DeepSeek, buat audit/debug
    hasil = Column(Text, nullable=True)  # JSON string, output dari AI
    model_ai = Column(String(100), nullable=False, default="deepseek-chat")
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


# [BARU] Feedback koreksi user terhadap prediksi pola (kategori/akun yang
# disarankan sistem, lalu dikoreksi manual oleh user). Ini persist ke DB
# supaya tidak hilang saat redeploy -- sebelumnya cuma tersimpan lokal di
# feedback_data/user_feedback.jsonl (lihat integrasi di modul yang menulis
# file itu; fungsi simpan_pola_augmentasi di bawah dipanggil dari sana).
# Data di sini juga jadi bahan augmentasi supaya pola makin akurat.
class PolaAugmentasi(Base):
    __tablename__ = "pola_augmentasi"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=True)
    jenis = Column(String(50), nullable=True)  # "bank", "jual", dst -- jenis dokumen terkait
    data_asli = Column(Text, nullable=True)  # JSON: prediksi/kategori asli dari sistem
    koreksi = Column(Text, nullable=True)  # JSON: koreksi dari user
    username = Column(String(100), nullable=True)  # siapa yang kasih feedback
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


# [BARU] Mekanisme "tanya balik ke akuntan" -- lihat
# akuntansi_ai.cari_baris_perlu_klarifikasi(). Beda dari PolaAugmentasi
# (yang mencatat feedback SETELAH terjadi), tabel ini menyimpan
# pertanyaan yang MASIH PENDING menunggu dijawab akuntan lewat dashboard
# React, baru setelah dijawab statusnya "answered" -- dan jawabannya
# otomatis ikut dicatat juga ke PolaAugmentasi (lihat
# jawab_pertanyaan_klarifikasi di bawah) supaya transaksi serupa
# berikutnya bisa dikenali otomatis oleh pelajari_pola().
# Sesuai keputusan: yang menjawab akuntan internal saja (bukan klien
# lewat WA), dan kalau AI sempat menebak, tebakannya tetap ditampilkan
# (kolom tebakan_kategori) sambil ditandai butuh_konfirmasi_saja=True.
class PertanyaanKlarifikasi(Base):
    __tablename__ = "pertanyaan_klarifikasi"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    conv_id = Column(String(50), nullable=True)
    jenis = Column(String(50), nullable=False)  # "rekening_koran", "penjualan", dst
    baris_index = Column(Integer, nullable=True)  # index baris asli di df, utk update balik
    konteks = Column(Text, nullable=True)  # JSON: tanggal/keterangan/nominal/arah dll
    pertanyaan = Column(Text, nullable=False)
    tebakan_kategori = Column(String(255), nullable=True)
    butuh_konfirmasi_saja = Column(Boolean, default=False)
    status = Column(String(20), nullable=False, default="pending")  # "pending" / "answered"
    jawaban = Column(Text, nullable=True)
    dijawab_oleh = Column(String(100), nullable=True)  # username akuntan yg jawab
    dibuat_at = Column(DateTime, default=datetime.now)
    dijawab_at = Column(DateTime, nullable=True)

    client = relationship("Client")


# [FIX] Tabel ini SEBELUMNYA TIDAK ADA sama sekali di db_client.py, padahal
# main.py sudah memanggil dbc.buat_alert_anomali() / dbc.daftar_alert_anomali()
# / dbc.tandai_alert_anomali() (di /api/proses-file & /api/alert-anomali) --
# akibatnya endpoint2 itu pasti AttributeError kalau dijalankan. Sekalian
# dipakai juga sbg "kotak masuk" in-app utk reminder deadline SPT (tipe_alert
# "deadline_lapor_spt" / "deadline_setor_spt"), supaya cuma ada SATU pusat
# notifikasi in-app -- bukan dua sistem terpisah.
class AlertAnomali(Base):
    __tablename__ = "alert_anomali"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    jenis = Column(String(50), nullable=False)  # "rekening_koran", "penjualan", "spt_masa", dst
    tipe_alert = Column(String(50), nullable=False)  # "nominal_ekstrim" / "pola_mencurigakan" /
                                                      # "deadline_lapor_spt" / "deadline_setor_spt"
    pesan = Column(Text, nullable=False)
    conv_id = Column(String(50), nullable=True)
    baris_index = Column(Integer, nullable=True)
    konteks = Column(Text, nullable=True)  # JSON
    skor = Column(Float, nullable=True)
    status = Column(String(20), nullable=False, default="baru")  # "baru"/"dilihat"/"diabaikan"
    diproses_oleh = Column(String(100), nullable=True)
    diproses_at = Column(DateTime, nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


# [BARU] Reminder/deadline proaktif SPT -- lihat akuntansi_ai.proses_spt().
# Setiap baris SPT hasil upload (per NPWP+jenis+periode) diextract jadi 1
# baris "kewajiban" di sini (lapor & setor dicatat terpisah krn tanggal
# batasnya beda), supaya scheduler harian bisa query LANGSUNG tanpa parse
# ulang JSON besar di tabel `hasil`, dan supaya kita bisa lacak milestone
# reminder mana saja yang SUDAH dikirim (hindari spam WA/email berulang
# tiap hari utk kewajiban yang sama).
class ReminderDeadlineSpt(Base):
    __tablename__ = "reminder_deadline_spt"

    id = Column(Integer, primary_key=True)
    client_id = Column(Integer, ForeignKey("clients.id"), nullable=False)
    npwp = Column(String(30), nullable=True)
    kategori_spt = Column(String(50), nullable=True)  # kode dari KATEGORI_SPT
    jenis_spt_label = Column(String(200), nullable=True)  # label utk ditampilkan/dikirim
    bulan_pajak = Column(Integer, nullable=True)
    tahun_pajak = Column(Integer, nullable=True)
    jenis_deadline = Column(String(10), nullable=False)  # "lapor" atau "setor"
    tanggal_batas = Column(DateTime, nullable=False)
    selesai = Column(Boolean, default=False)  # True kalau sudah_lapor/status bukan kurang bayar lagi
    milestone_terkirim = Column(Text, nullable=True)  # JSON list, mis. ["h-3_inapp","h-3_wa","h-1_inapp"]
    dibuat_at = Column(DateTime, default=datetime.now)
    diperbarui_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

    client = relationship("Client")


# ============================================================
# FUNGSI INISIALISASI
# ============================================================

def init_db():
    """Buat semua tabel jika belum ada."""
    Base.metadata.create_all(engine)


def cek_koneksi() -> bool:
    """Cek apakah koneksi database berhasil."""
    session = SessionLocal()
    try:
        session.execute(text("SELECT 1"))
        return True
    except Exception:
        session.rollback()
        return False


# ============================================================
# FUNGSI CLIENT
# ============================================================
    finally:
        session.close()

def tambah_client(
    nama: str,
    lokasi: Optional[str] = None,
    tipe: str = "accounting",
    nomor_wa: Optional[str] = None,
    email: Optional[str] = None,
) -> Optional[int]:
    """Tambah client baru. nomor_wa/email opsional, bisa diisi belakangan
    lewat update_kontak_client()."""
    session = SessionLocal()
    try:
        client = Client(nama=nama, lokasi=lokasi, tipe=tipe, nomor_wa=nomor_wa, email=email)
        session.add(client)
        session.commit()
        client_id = client.id
        return client_id
    except Exception as e:
        session.rollback()
        print(f"Error tambah client: {e}")
        return None
    finally:
        session.close()


def daftar_client(tipe: Optional[str] = None, punya_esb: Optional[bool] = None) -> List[Dict[str, Any]]:
    """Daftar semua client, opsional filter tipe, dan opsional filter
    berdasarkan status integrasi ESB:
        punya_esb=True  -> hanya client yang sudah punya >=1 akun ESB
        punya_esb=False -> hanya client yang BELUM punya akun ESB sama sekali
        punya_esb=None  -> semua client (default, perilaku lama tidak berubah)
    """
    session = SessionLocal()
    try:
        query = session.query(Client)
        if tipe:
            query = query.filter(Client.tipe == tipe)

        if punya_esb is True:
            query = query.filter(Client.esb_accounts.any())
        elif punya_esb is False:
            query = query.filter(~Client.esb_accounts.any())

        clients = query.all()
        result = [
            {
                "id": c.id,
                "nama": c.nama,
                "lokasi": c.lokasi,
                "tipe": c.tipe,
                "nomor_wa": c.nomor_wa,
                "email": c.email,
                "dibuat_at": c.dibuat_at.isoformat() if c.dibuat_at else None,
                "jumlah_akun_esb": len(c.esb_accounts),
            }
            for c in clients
        ]
        return result
    except Exception as e:
        session.rollback()
        print(f"Error daftar client: {e}")
        return []
    finally:
        session.close()


def ambil_client(client_id: int) -> Optional[Dict[str, Any]]:
    """Ambil data client berdasarkan ID."""
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            return None
        result = {
            "id": client.id,
            "nama": client.nama,
            "lokasi": client.lokasi,
            "tipe": client.tipe,
            "nomor_wa": client.nomor_wa,
            "email": client.email,
            "dibuat_at": client.dibuat_at.isoformat() if client.dibuat_at else None,
        }
        return result
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def ubah_tipe_client(client_id: int, tipe_baru: str) -> bool:
    """Ubah tipe client."""
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            return False
        client.tipe = tipe_baru
        session.commit()
        return True
    except Exception:
        session.rollback()
        return False


# ============================================================
# [BARU] FUNGSI ESB ACCOUNTS (integrasi API POS/kasir per client)
# ============================================================
# consumer_secret SENGAJA tidak pernah dikembalikan apa adanya oleh fungsi
# manapun di bawah -- selalu di-mask jadi "••••1234" (4 karakter terakhir
# saja) supaya aman dikirim ke frontend/API response, sama seperti
# password_hash yang tidak pernah dikirim balik di fungsi User.
    finally:
        session.close()

def _mask_secret(secret: Optional[str]) -> Optional[str]:
    if not secret:
        return None
    if len(secret) <= 4:
        return "•" * len(secret)
    return "•" * (len(secret) - 4) + secret[-4:]


def tambah_esb_account(
    client_id: int,
    account_name: str,
    esb_type: Optional[str] = None,
    api_base_url: Optional[str] = None,
    consumer_key: Optional[str] = None,
    consumer_secret: Optional[str] = None,
    is_active: bool = True,
    is_default: bool = False,
    auto_discover: bool = False,
) -> Optional[int]:
    """Tambah akun integrasi ESB baru untuk satu client."""
    session = SessionLocal()
    try:
        akun = EsbAccount(
            client_id=client_id, account_name=account_name, esb_type=esb_type,
            api_base_url=api_base_url, consumer_key=consumer_key,
            consumer_secret=consumer_secret, is_active=is_active,
            is_default=is_default, auto_discover=auto_discover,
        )
        session.add(akun)
        session.commit()
        akun_id = akun.id
        return akun_id
    except Exception as e:
        session.rollback()
        print(f"Error tambah esb account: {e}")
        return None
    finally:
        session.close()


def ambil_esb_accounts_client(client_id: int, hanya_aktif: bool = False) -> List[Dict[str, Any]]:
    """Ambil semua akun ESB milik satu client. consumer_secret di-mask."""
    session = SessionLocal()
    try:
        query = session.query(EsbAccount).filter(EsbAccount.client_id == client_id)
        if hanya_aktif:
            query = query.filter(EsbAccount.is_active.is_(True))

        hasil = [{
            "id": a.id,
            "client_id": a.client_id,
            "account_name": a.account_name,
            "esb_type": a.esb_type,
            "api_base_url": a.api_base_url,
            "consumer_key": a.consumer_key,
            "consumer_secret_mask": _mask_secret(a.consumer_secret),
            "is_active": a.is_active,
            "is_default": a.is_default,
            "auto_discover": a.auto_discover,
        } for a in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil esb accounts: {e}")
        return []
    finally:
        session.close()


def daftar_client_dengan_esb(tipe: Optional[str] = None) -> List[Dict[str, Any]]:
    """Shortcut: client yang SUDAH punya minimal 1 akun ESB."""
    return daftar_client(tipe=tipe, punya_esb=True)


def daftar_client_tanpa_esb(tipe: Optional[str] = None) -> List[Dict[str, Any]]:
    """Shortcut: client yang BELUM punya akun ESB sama sekali."""
    return daftar_client(tipe=tipe, punya_esb=False)


def hapus_esb_account(esb_account_id: int) -> bool:
    session = SessionLocal()
    try:
        akun = session.query(EsbAccount).filter(EsbAccount.id == esb_account_id).first()
        if not akun:
            return False
        session.delete(akun)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error hapus esb account: {e}")
        return False


# ============================================================
# FUNGSI HASIL
# ============================================================
    finally:
        session.close()

def simpan_hasil(
    client_id: int,
    conv_id: str,
    jenis: str,
    data: Any,
) -> bool:
    """
    Simpan hasil analisis UMUM CLIENT ke database (bukan spesifik akun ESB
    -- untuk itu pakai simpan_hasil_esb()).
    data: bisa dict, list, atau pandas DataFrame
    """
    session = SessionLocal()
    try:

        # Konversi data ke JSON
        if isinstance(data, pd.DataFrame):
            data_json = data.to_json(orient="records", date_format="iso")
        elif isinstance(data, (dict, list)):
            data_json = json.dumps(data, default=str, ensure_ascii=False)
        else:
            data_json = str(data)

        hasil = Hasil(
            client_id=client_id,
            conv_id=conv_id,
            jenis=jenis,
            data=data_json,
        )
        session.add(hasil)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error simpan hasil: {e}")
        return False
    finally:
        session.close()


def simpan_dataframe_ke_db(
    client_id: int,
    conv_id: str,
    jenis: str,
    df: pd.DataFrame,
) -> int:
    """
    Simpan dataframe ke database, return jumlah baris yang disimpan.
    """
    if df is None or df.empty:
        return 0

    session = SessionLocal()
    try:
        # [FIX -- POINT 4] session.add() per baris di dalam df.iterrows()
        # diganti bulk_save_objects() -- sama seperti fix di
        # tarik_draf_jurnal_ke_posting() di atas, supaya dataframe besar
        # (ribuan baris) tidak jadi ribuan round-trip DB terpisah.
        objek_baru = [
            Hasil(
                client_id=client_id,
                conv_id=conv_id,
                jenis=jenis,
                data=json.dumps(row.to_dict(), default=str, ensure_ascii=False),
            )
            for _, row in df.iterrows()
        ]
        session.bulk_save_objects(objek_baru)
        count = len(objek_baru)
        session.commit()
        return count
    except Exception as e:
        session.rollback()
        print(f"Error simpan dataframe: {e}")
        return 0
    finally:
        session.close()


def ambil_hasil_client(
    client_id: int,
    jenis: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Ambil hasil UMUM CLIENT untuk client tertentu (bukan hasil akun ESB
    -- untuk itu pakai ambil_hasil_esb() / ambil_hasil_esb_client())."""
    session = SessionLocal()
    try:
        query = session.query(Hasil).filter(Hasil.client_id == client_id)
        if jenis:
            query = query.filter(Hasil.jenis == jenis)
        query = query.order_by(Hasil.dibuat_at.desc()).limit(limit)

        results = []
        for h in query.all():
            data = {}
            if h.data:
                try:
                    data = json.loads(h.data)
                except Exception:
                    data = {"raw": h.data}
            results.append({
                "id": h.id,
                "jenis": h.jenis,
                "data": data,
                "dibuat_at": h.dibuat_at.isoformat() if h.dibuat_at else None,
            })
        return results
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil: {e}")
        return []
    finally:
        session.close()


def ambil_hasil_by_id(hasil_id: int) -> Optional[Dict[str, Any]]:
    """
    [BARU - Prioritas #7] Ambil SATU baris 'hasil' berdasarkan id-nya
    langsung (bukan filter client_id+jenis+limit seperti ambil_hasil_client).
    Dipakai endpoint export-format-akuntan supaya bisa membaca ULANG
    df_hasil rekening koran yang SUDAH tersimpan dari upload sebelumnya
    (lewat /api/proses-file), tanpa perlu upload file lagi / parse ulang.
    """
    session = SessionLocal()
    try:
        h = session.query(Hasil).filter(Hasil.id == hasil_id).first()
        if h is None:
            return None
        data = {}
        if h.data:
            try:
                data = json.loads(h.data)
            except Exception:
                data = {"raw": h.data}
        hasil = {
            "id": h.id, "client_id": h.client_id, "jenis": h.jenis, "data": data,
            "dibuat_at": h.dibuat_at.isoformat() if h.dibuat_at else None,
        }
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil by id: {e}")
        return None


# ============================================================
# FUNGSI HASIL ESB (tabel terpisah, khusus per akun ESB)
# ============================================================
    finally:
        session.close()

def simpan_hasil_esb(
    client_id: int,
    esb_account_id: int,
    conv_id: str,
    jenis: str,
    data: Any,
) -> bool:
    """Simpan hasil analisis yang SPESIFIK milik 1 akun ESB (tabel
    hasil_esb, terpisah dari hasil umum client di tabel hasil)."""
    session = SessionLocal()
    try:

        if isinstance(data, pd.DataFrame):
            data_json = data.to_json(orient="records", date_format="iso")
        elif isinstance(data, (dict, list)):
            data_json = json.dumps(data, default=str, ensure_ascii=False)
        else:
            data_json = str(data)

        hasil = HasilEsb(
            client_id=client_id,
            esb_account_id=esb_account_id,
            conv_id=conv_id,
            jenis=jenis,
            data=data_json,
        )
        session.add(hasil)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error simpan hasil esb: {e}")
        return False
    finally:
        session.close()


def ambil_hasil_esb(
    esb_account_id: int,
    jenis: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Ambil hasil untuk 1 akun ESB tertentu."""
    session = SessionLocal()
    try:
        query = session.query(HasilEsb).filter(HasilEsb.esb_account_id == esb_account_id)
        if jenis:
            query = query.filter(HasilEsb.jenis == jenis)
        query = query.order_by(HasilEsb.dibuat_at.desc()).limit(limit)

        results = []
        for h in query.all():
            data = {}
            if h.data:
                try:
                    data = json.loads(h.data)
                except Exception:
                    data = {"raw": h.data}
            results.append({
                "id": h.id,
                "esb_account_id": h.esb_account_id,
                "jenis": h.jenis,
                "data": data,
                "dibuat_at": h.dibuat_at.isoformat() if h.dibuat_at else None,
            })
        return results
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil esb: {e}")
        return []
    finally:
        session.close()


def ambil_hasil_esb_client(
    client_id: int,
    jenis: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """Ambil hasil dari SEMUA akun ESB milik 1 client (gabungan, tidak
    dipisah per akun ESB). Untuk 1 akun ESB spesifik, pakai ambil_hasil_esb()."""
    session = SessionLocal()
    try:
        query = session.query(HasilEsb).filter(HasilEsb.client_id == client_id)
        if jenis:
            query = query.filter(HasilEsb.jenis == jenis)
        query = query.order_by(HasilEsb.dibuat_at.desc()).limit(limit)

        results = []
        for h in query.all():
            data = {}
            if h.data:
                try:
                    data = json.loads(h.data)
                except Exception:
                    data = {"raw": h.data}
            results.append({
                "id": h.id,
                "esb_account_id": h.esb_account_id,
                "jenis": h.jenis,
                "data": data,
                "dibuat_at": h.dibuat_at.isoformat() if h.dibuat_at else None,
            })
        return results
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil esb client: {e}")
        return []
    finally:
        session.close()


def hapus_hasil_esb(hasil_esb_id: int) -> bool:
    """Hapus satu baris hasil_esb berdasarkan ID."""
    session = SessionLocal()
    try:
        hasil = session.query(HasilEsb).filter(HasilEsb.id == hasil_esb_id).first()
        if not hasil:
            return False
        session.delete(hasil)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error hapus hasil esb: {e}")
        return False
    finally:
        session.close()


def hitung_hasil_esb(esb_account_id: int, jenis: Optional[str] = None) -> int:
    """Hitung jumlah baris hasil milik 1 akun ESB."""
    session = SessionLocal()
    try:
        query = session.query(HasilEsb).filter(HasilEsb.esb_account_id == esb_account_id)
        if jenis:
            query = query.filter(HasilEsb.jenis == jenis)
        jumlah = query.count()
        return jumlah
    except Exception:
        session.rollback()
        return 0


# ============================================================
# FUNGSI AUDIT LOG (dipakai oleh modules/history.py)
# ============================================================
    finally:
        session.close()

def log_audit(
    client_id: Optional[int],
    user: str,
    aksi: str,
    detail: Optional[Dict[str, Any]] = None,
) -> bool:
    """Catat satu entri riwayat perubahan (audit trail)."""
    session = SessionLocal()
    try:
        entry = AuditLog(
            client_id=client_id,
            user=user,
            aksi=aksi,
            detail=json.dumps(detail or {}, default=str, ensure_ascii=False),
        )
        session.add(entry)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error log audit: {e}")
        return False
    finally:
        session.close()


def get_audit_history(
    client_id: Optional[int] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Ambil riwayat perubahan terbaru, opsional filter per client."""
    session = SessionLocal()
    try:
        query = session.query(AuditLog)
        if client_id is not None:
            query = query.filter(AuditLog.client_id == client_id)
        query = query.order_by(AuditLog.dibuat_at.desc()).limit(limit)

        results = []
        for entry in query.all():
            detail = {}
            if entry.detail:
                try:
                    detail = json.loads(entry.detail)
                except Exception:
                    detail = {"raw": entry.detail}
            results.append({
                "id": entry.id,
                "client_id": entry.client_id,
                "user": entry.user,
                "aksi": entry.aksi,
                "detail": detail,
                "dibuat_at": entry.dibuat_at.isoformat() if entry.dibuat_at else None,
            })
        return results
    except Exception as e:
        session.rollback()
        print(f"Error get audit history: {e}")
        return []


# ============================================================
# FUNGSI USER
# ============================================================
    finally:
        session.close()

def create_user(username: str, password_hash: str, role: str, nama: Optional[str] = None) -> bool:
    """Buat user baru."""
    session = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=password_hash,
            role=role,
            nama=nama,
        )
        session.add(user)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error create user: {e}")
        return False
    finally:
        session.close()


def get_user_by_username(username: str) -> Optional[Dict[str, Any]]:
    """Ambil user berdasarkan username."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return None
        result = {
            "id": user.id,
            "username": user.username,
            "password_hash": user.password_hash,
            "role": user.role,
            "nama": user.nama,
            "aktif": user.aktif,
        }
        return result
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def list_users() -> List[Dict[str, Any]]:
    """Daftar semua user."""
    session = SessionLocal()
    try:
        users = session.query(User).all()
        result = [
            {
                "id": u.id,
                "username": u.username,
                "role": u.role,
                "nama": u.nama,
                "aktif": u.aktif,
            }
            for u in users
        ]
        return result
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def update_user_role(username: str, role: str) -> bool:
    """Update role user."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        user.role = role
        session.commit()
        return True
    except Exception:
        session.rollback()
        return False
    finally:
        session.close()


def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """Ambil user berdasarkan ID."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.id == user_id).first()
        if not user:
            return None
        result = {
            "id": user.id,
            "username": user.username,
            "password_hash": user.password_hash,
            "role": user.role,
            "nama": user.nama,
            "aktif": user.aktif,
        }
        return result
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def update_user_password(username: str, password_hash_baru: str) -> bool:
    """Ganti password (hash) user yang sudah ada."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        user.password_hash = password_hash_baru
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error update password: {e}")
        return False
    finally:
        session.close()


def set_user_aktif(username: str, aktif: bool) -> bool:
    """Aktifkan/nonaktifkan user tanpa menghapus datanya (mis. saat karyawan resign)."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        user.aktif = aktif
        session.commit()
        return True
    except Exception:
        session.rollback()
        return False
    finally:
        session.close()


def delete_user(username: str) -> bool:
    """Hapus user secara permanen dari database."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        session.delete(user)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error delete user: {e}")
        return False


# ============================================================
# FUNGSI TAMBAHAN CLIENT
# ============================================================
    finally:
        session.close()

def get_client_by_nama(nama: str) -> Optional[Dict[str, Any]]:
    """Cari client berdasarkan nama persis."""
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.nama == nama).first()
        if not client:
            return None
        result = {
            "id": client.id,
            "nama": client.nama,
            "lokasi": client.lokasi,
            "tipe": client.tipe,
            "dibuat_at": client.dibuat_at.isoformat() if client.dibuat_at else None,
        }
        return result
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def delete_client(client_id: int) -> bool:
    """Hapus client. Hasil analisis terkait (tabel 'hasil' dan 'hasil_esb')
    ikut dihapus dulu supaya tidak melanggar foreign key ke 'clients'."""
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            return False
        session.query(Hasil).filter(Hasil.client_id == client_id).delete()
        session.query(HasilEsb).filter(HasilEsb.client_id == client_id).delete()
        session.delete(client)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error delete client: {e}")
        return False


# ============================================================
# FUNGSI TAMBAHAN HASIL
# ============================================================
    finally:
        session.close()

def hapus_hasil(hasil_id: int) -> bool:
    """Hapus satu baris hasil analisis berdasarkan ID."""
    session = SessionLocal()
    try:
        hasil = session.query(Hasil).filter(Hasil.id == hasil_id).first()
        if not hasil:
            return False
        session.delete(hasil)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error hapus hasil: {e}")
        return False
    finally:
        session.close()


def hapus_semua_hasil_client(client_id: int, jenis: Optional[str] = None) -> int:
    """Hapus semua hasil milik satu client, opsional filter per jenis.
    Return jumlah baris yang dihapus."""
    session = SessionLocal()
    try:
        query = session.query(Hasil).filter(Hasil.client_id == client_id)
        if jenis:
            query = query.filter(Hasil.jenis == jenis)
        jumlah = query.delete()
        session.commit()
        return jumlah
    except Exception as e:
        session.rollback()
        print(f"Error hapus semua hasil: {e}")
        return 0
    finally:
        session.close()


def hitung_hasil_client(client_id: int, jenis: Optional[str] = None) -> int:
    """Hitung jumlah baris hasil milik satu client, opsional filter per jenis."""
    session = SessionLocal()
    try:
        query = session.query(Hasil).filter(Hasil.client_id == client_id)
        if jenis:
            query = query.filter(Hasil.jenis == jenis)
        jumlah = query.count()
        return jumlah
    except Exception:
        session.rollback()
        return 0


# ============================================================
# FUNGSI PERCAKAPAN CHAT (riwayat chat, mirip ChatGPT/Claude)
# ============================================================
    finally:
        session.close()

def buat_percakapan(
    username: str,
    client_id: Optional[int] = None,
    esb_account_id: Optional[int] = None,
    judul: str = "Percakapan Baru",
) -> Optional[int]:
    """Buat sesi percakapan baru, return id-nya (dipakai frontend sebagai
    conv_id/percakapan_id). Isi esb_account_id kalau percakapan ini spesifik
    soal 1 akun ESB tertentu (jalur terpisah dari percakapan umum client)."""
    session = SessionLocal()
    try:
        p = Percakapan(username=username, client_id=client_id, esb_account_id=esb_account_id, judul=judul)
        session.add(p)
        session.commit()
        p_id = p.id
        return p_id
    except Exception as e:
        session.rollback()
        print(f"Error buat percakapan: {e}")
        return None
    finally:
        session.close()


def daftar_percakapan(
    username: str,
    client_id: Optional[int] = None,
    esb_account_id: Optional[int] = None,
    jalur: Optional[str] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """List percakapan milik user, terbaru dulu -- untuk sidebar riwayat chat.

    `jalur` (opsional) memisahkan 2 jenis riwayat:
        jalur="client"      -> hanya percakapan umum soal client (esb_account_id kosong)
        jalur="esb_account"  -> hanya percakapan spesifik soal akun ESB
        jalur=None (default) -> semua percakapan, tidak dipisah
    `client_id`/`esb_account_id` tetap bisa dipakai bareng `jalur` untuk
    filter lebih spesifik (mis. jalur="esb_account" + esb_account_id=3).
    """
    session = SessionLocal()
    try:
        query = session.query(Percakapan).filter(Percakapan.username == username)
        if client_id is not None:
            query = query.filter(Percakapan.client_id == client_id)
        if esb_account_id is not None:
            query = query.filter(Percakapan.esb_account_id == esb_account_id)

        if jalur == "client":
            query = query.filter(Percakapan.esb_account_id.is_(None))
        elif jalur == "esb_account":
            query = query.filter(Percakapan.esb_account_id.isnot(None))

        query = query.order_by(Percakapan.diperbarui_at.desc()).limit(limit)

        hasil = [{
            "id": p.id,
            "judul": p.judul,
            "client_id": p.client_id,
            "esb_account_id": p.esb_account_id,
            "jalur": "esb_account" if p.esb_account_id is not None else "client",
            "dibuat_at": p.dibuat_at.isoformat() if p.dibuat_at else None,
            "diperbarui_at": p.diperbarui_at.isoformat() if p.diperbarui_at else None,
        } for p in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar percakapan: {e}")
        return []
    finally:
        session.close()


def ambil_pesan_percakapan(percakapan_id: int) -> List[Dict[str, Any]]:
    """Ambil semua pesan (urut kronologis) dalam satu percakapan."""
    session = SessionLocal()
    try:
        query = session.query(PesanChat).filter(
            PesanChat.percakapan_id == percakapan_id
        ).order_by(PesanChat.dibuat_at.asc())

        hasil = [{
            "id": m.id,
            "role": m.role,
            "content": m.content,
            "dibuat_at": m.dibuat_at.isoformat() if m.dibuat_at else None,
        } for m in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil pesan percakapan: {e}")
        return []
    finally:
        session.close()


def simpan_pesan_chat(percakapan_id: int, role: str, content: str) -> bool:
    """Simpan satu pesan (user atau assistant) ke percakapan, dan sentuh
    diperbarui_at supaya percakapan naik ke atas daftar (paling baru dulu)."""
    session = SessionLocal()
    try:
        pesan = PesanChat(percakapan_id=percakapan_id, role=role, content=content)
        session.add(pesan)

        p = session.query(Percakapan).filter(Percakapan.id == percakapan_id).first()
        if p:
            p.diperbarui_at = datetime.now()

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error simpan pesan chat: {e}")
        return False
    finally:
        session.close()


def ubah_judul_percakapan(percakapan_id: int, judul_baru: str) -> bool:
    """Ubah judul percakapan (mis. hasil auto-generate dari pesan pertama)."""
    session = SessionLocal()
    try:
        p = session.query(Percakapan).filter(Percakapan.id == percakapan_id).first()
        if not p:
            return False
        p.judul = judul_baru[:200]
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error ubah judul percakapan: {e}")
        return False
    finally:
        session.close()


def hapus_percakapan(percakapan_id: int) -> bool:
    """Hapus percakapan beserta seluruh isi pesannya."""
    session = SessionLocal()
    try:
        p = session.query(Percakapan).filter(Percakapan.id == percakapan_id).first()
        if not p:
            return False
        session.delete(p)  # cascade menghapus semua PesanChat terkait
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error hapus percakapan: {e}")
        return False


# ============================================================
# FUNGSI HASIL ANALISIS (AI / DeepSeek)
# ============================================================
    finally:
        session.close()

def simpan_hasil_analisis(
    client_id: int,
    jenis_analisis: str,
    hasil: Any,
    prompt: Optional[str] = None,
    model_ai: str = "deepseek-chat",
    esb_account_id: Optional[int] = None,
) -> Optional[int]:
    """Simpan output analisis AI (DeepSeek) ke database, return id-nya."""
    session = SessionLocal()
    try:
        if isinstance(hasil, (dict, list)):
            hasil_json = json.dumps(hasil, default=str, ensure_ascii=False)
        else:
            hasil_json = str(hasil)

        row = HasilAnalisis(
            client_id=client_id,
            esb_account_id=esb_account_id,
            jenis_analisis=jenis_analisis,
            prompt=prompt,
            hasil=hasil_json,
            model_ai=model_ai,
        )
        session.add(row)
        session.commit()
        row_id = row.id
        return row_id
    except Exception as e:
        session.rollback()
        print(f"Error simpan hasil analisis: {e}")
        return None
    finally:
        session.close()


def ambil_hasil_analisis_by_id(analisis_id: int) -> Optional[Dict[str, Any]]:
    """
    [FASE 5 -- roadmap CALK] Ambil SATU baris 'hasil_analisis' berdasarkan
    id-nya langsung -- pola SAMA PERSIS dengan ambil_hasil_by_id() (tabel
    Hasil), cuma versi tabel HasilAnalisis. Dipakai endpoint
    GET .../calk/{calk_id}/download supaya bisa membaca ULANG path
    docx/pdf yang sudah tersimpan dari POST .../calk/generate sebelumnya,
    tanpa perlu generate ulang.
    """
    session = SessionLocal()
    try:
        r = session.query(HasilAnalisis).filter(HasilAnalisis.id == analisis_id).first()
        if r is None:
            return None
        data = {}
        if r.hasil:
            try:
                data = json.loads(r.hasil)
            except Exception:
                data = {"raw": r.hasil}
        return {
            "id": r.id, "client_id": r.client_id, "jenis_analisis": r.jenis_analisis,
            "hasil": data, "model_ai": r.model_ai,
            "dibuat_at": r.dibuat_at.isoformat() if r.dibuat_at else None,
        }
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil analisis by id: {e}")
        return None
    finally:
        session.close()


def ambil_hasil_analisis_client(
    client_id: int,
    jenis_analisis: Optional[str] = None,
    esb_account_id: Optional[int] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Ambil riwayat hasil analisis AI untuk satu client, terbaru dulu."""
    session = SessionLocal()
    try:
        query = session.query(HasilAnalisis).filter(HasilAnalisis.client_id == client_id)
        if jenis_analisis:
            query = query.filter(HasilAnalisis.jenis_analisis == jenis_analisis)
        if esb_account_id is not None:
            query = query.filter(HasilAnalisis.esb_account_id == esb_account_id)
        query = query.order_by(HasilAnalisis.dibuat_at.desc()).limit(limit)

        hasil = []
        for r in query.all():
            data = {}
            if r.hasil:
                try:
                    data = json.loads(r.hasil)
                except Exception:
                    data = {"raw": r.hasil}
            hasil.append({
                "id": r.id,
                "jenis_analisis": r.jenis_analisis,
                "hasil": data,
                "model_ai": r.model_ai,
                "esb_account_id": r.esb_account_id,
                "dibuat_at": r.dibuat_at.isoformat() if r.dibuat_at else None,
            })
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil hasil analisis: {e}")
        return []
    finally:
        session.close()


# ============================================================
# FUNGSI POLA AUGMENTASI (feedback koreksi user, persisten)
# ============================================================

def simpan_pola_augmentasi(
    jenis: str,
    data_asli: Any,
    koreksi: Any,
    client_id: Optional[int] = None,
    username: Optional[str] = None,
) -> Optional[int]:
    """Simpan 1 feedback koreksi user (prediksi sistem vs koreksi user)
    ke database secara permanen. Dipanggil dari titik yang sama yang
    sebelumnya menulis ke feedback_data/user_feedback.jsonl."""
    session = SessionLocal()
    try:

        def _ke_json(x):
            if isinstance(x, (dict, list)):
                return json.dumps(x, default=str, ensure_ascii=False)
            return str(x)

        row = PolaAugmentasi(
            client_id=client_id,
            jenis=jenis,
            data_asli=_ke_json(data_asli),
            koreksi=_ke_json(koreksi),
            username=username,
        )
        session.add(row)
        session.commit()
        row_id = row.id
        return row_id
    except Exception as e:
        session.rollback()
        print(f"Error simpan pola augmentasi: {e}")
        return None
    finally:
        session.close()


def ambil_pola_augmentasi(
    client_id: Optional[int] = None,
    jenis: Optional[str] = None,
    limit: int = 500,
) -> List[Dict[str, Any]]:
    """Ambil riwayat feedback koreksi user, terbaru dulu. Dipakai untuk
    bahan augmentasi/pelatihan ulang pola."""
    session = SessionLocal()
    try:
        query = session.query(PolaAugmentasi)
        if client_id is not None:
            query = query.filter(PolaAugmentasi.client_id == client_id)
        if jenis:
            query = query.filter(PolaAugmentasi.jenis == jenis)
        query = query.order_by(PolaAugmentasi.dibuat_at.desc()).limit(limit)

        def _parse(x):
            if not x:
                return {}
            try:
                return json.loads(x)
            except Exception:
                return {"raw": x}

        hasil = [{
            "id": r.id,
            "client_id": r.client_id,
            "jenis": r.jenis,
            "data_asli": _parse(r.data_asli),
            "koreksi": _parse(r.koreksi),
            "username": r.username,
            "dibuat_at": r.dibuat_at.isoformat() if r.dibuat_at else None,
        } for r in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil pola augmentasi: {e}")
        return []

# ============================================================
# [BARU] FUNGSI PERTANYAAN KLARIFIKASI (mekanisme tanya balik)
# ============================================================
# Dipanggil dari main.py /api/proses-file setelah ak.cari_baris_perlu_klarifikasi()
# menemukan baris yang perlu ditanyakan ke akuntan.
    finally:
        session.close()

def buat_pertanyaan_klarifikasi(
    client_id: int,
    jenis: str,
    pertanyaan: str,
    conv_id: Optional[str] = None,
    baris_index: Optional[int] = None,
    konteks: Optional[dict] = None,
    tebakan_kategori: Optional[str] = None,
    butuh_konfirmasi_saja: bool = False,
) -> Optional[int]:
    """Simpan 1 pertanyaan klarifikasi berstatus 'pending'. Return id-nya,
    atau None kalau gagal."""
    session = SessionLocal()
    try:
        row = PertanyaanKlarifikasi(
            client_id=client_id,
            conv_id=conv_id,
            jenis=jenis,
            baris_index=baris_index,
            konteks=json.dumps(konteks, default=str, ensure_ascii=False) if konteks else None,
            pertanyaan=pertanyaan,
            tebakan_kategori=tebakan_kategori,
            butuh_konfirmasi_saja=bool(butuh_konfirmasi_saja),
        )
        session.add(row)
        session.commit()
        row_id = row.id
        return row_id
    except Exception as e:
        session.rollback()
        print(f"Error buat pertanyaan klarifikasi: {e}")
        return None
    finally:
        session.close()


def daftar_pertanyaan_klarifikasi(
    client_id: Optional[int] = None,
    status: Optional[str] = "pending",
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Ambil daftar pertanyaan klarifikasi, terbaru dulu. status=None
    berarti ambil semua status (pending & answered)."""
    session = SessionLocal()
    try:
        query = session.query(PertanyaanKlarifikasi)
        if client_id is not None:
            query = query.filter(PertanyaanKlarifikasi.client_id == client_id)
        if status:
            query = query.filter(PertanyaanKlarifikasi.status == status)
        query = query.order_by(PertanyaanKlarifikasi.dibuat_at.desc()).limit(limit)

        def _parse(x):
            if not x:
                return {}
            try:
                return json.loads(x)
            except Exception:
                return {"raw": x}

        hasil = [{
            "id": r.id,
            "client_id": r.client_id,
            "conv_id": r.conv_id,
            "jenis": r.jenis,
            "baris_index": r.baris_index,
            "konteks": _parse(r.konteks),
            "pertanyaan": r.pertanyaan,
            "tebakan_kategori": r.tebakan_kategori,
            "butuh_konfirmasi_saja": r.butuh_konfirmasi_saja,
            "status": r.status,
            "jawaban": r.jawaban,
            "dijawab_oleh": r.dijawab_oleh,
            "dibuat_at": r.dibuat_at.isoformat() if r.dibuat_at else None,
            "dijawab_at": r.dijawab_at.isoformat() if r.dijawab_at else None,
        } for r in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar pertanyaan klarifikasi: {e}")
        return []
    finally:
        session.close()


def jawab_pertanyaan_klarifikasi(
    pertanyaan_id: int,
    jawaban: str,
    username: str,
) -> bool:
    """Simpan jawaban akuntan, tandai status 'answered', DAN otomatis
    catat sbg feedback koreksi ke tabel pola_augmentasi (lewat
    simpan_pola_augmentasi yg sudah ada) supaya transaksi serupa
    berikutnya bisa langsung dikenali pelajari_pola() tanpa nanya lagi."""
    session = SessionLocal()
    try:
        row = session.query(PertanyaanKlarifikasi).filter(
            PertanyaanKlarifikasi.id == pertanyaan_id
        ).first()
        if row is None:
            return False

        row.jawaban = jawaban
        row.status = "answered"
        row.dijawab_oleh = username
        row.dijawab_at = datetime.now()

        client_id_row = row.client_id
        jenis_row = row.jenis

        # [BARU] Bawa juga konteks terstruktur (keterangan/arah/cara_bayar/
        # no_akun_* yang sudah AI tebak sebelumnya) -- bukan cuma
        # tebakan_kategori+pertanyaan seperti sebelumnya -- supaya
        # akuntansi_ai.bangun_pola_dari_feedback_klarifikasi() (retraining
        # #3) punya cukup info untuk bikin pasangan jurnal lengkap dari
        # jawaban akuntan, bukan cuma teks pertanyaan yang sulit diparse balik.
        try:
            konteks_row = json.loads(row.konteks) if row.konteks else {}
        except (json.JSONDecodeError, TypeError):
            konteks_row = {}

        data_asli = {
            "tebakan_kategori": row.tebakan_kategori,
            "pertanyaan": row.pertanyaan,
            "keterangan": konteks_row.get("keterangan"),
            "arah": konteks_row.get("arah"),
            "cara_bayar": konteks_row.get("cara_bayar"),
            "no_akun_debet": konteks_row.get("no_akun_debet"),
            "nama_akun_debet": konteks_row.get("nama_akun_debet"),
            "no_akun_kredit": konteks_row.get("no_akun_kredit"),
            "nama_akun_kredit": konteks_row.get("nama_akun_kredit"),
        }

        session.commit()
    except Exception as e:
        session.rollback()
        print(f"Error jawab pertanyaan klarifikasi: {e}")
        return False
    finally:
        session.close()

    # Dipisah dari transaksi commit di atas: kalaupun baris feedback ini
    # gagal tersimpan, jawaban akuntan yg sudah commit di atas TETAP aman.
    try:
        simpan_pola_augmentasi(
            jenis=jenis_row,
            data_asli=data_asli,
            koreksi={"jawaban": jawaban},
            client_id=client_id_row,
            username=username,
        )
    except Exception as e:
        print(f"Warning: gagal catat feedback pola dari klarifikasi: {e}")

    # [BARU] Audit trail: jawaban klarifikasi mengubah kategori/akun yang
    # tadinya "ditebak AI" jadi keputusan resmi akuntan -- wajib tercatat
    # siapa-menjawab-apa-kapan, terutama karena hasilnya juga jadi bahan
    # retraining pola (bisa mempengaruhi transaksi client lain di masa depan).
    try:
        log_audit(
            client_id=client_id_row,
            user=username,
            aksi="jawab_klarifikasi",
            detail={
                "pertanyaan_id": pertanyaan_id,
                "jenis": jenis_row,
                "tebakan_kategori": data_asli.get("tebakan_kategori"),
                "jawaban": jawaban,
            },
        )
    except Exception as e:
        print(f"Warning: gagal catat audit log klarifikasi: {e}")

    return True


# ============================================================
# [FIX] FUNGSI ALERT ANOMALI -- sebelumnya dipanggil dari main.py tapi
# tidak pernah didefinisikan di sini sama sekali (lihat catatan di atas
# model AlertAnomali). Sekaligus dipakai sbg kotak masuk in-app utk
# reminder deadline SPT.
# ============================================================

def buat_alert_anomali(
    client_id: int,
    jenis: str,
    tipe_alert: str,
    pesan: str,
    conv_id: Optional[str] = None,
    baris_index: Optional[int] = None,
    konteks: Optional[dict] = None,
    skor: Optional[float] = None,
) -> Optional[int]:
    """Simpan 1 alert berstatus 'baru'. Return id-nya, atau None kalau gagal."""
    session = SessionLocal()
    try:
        row = AlertAnomali(
            client_id=client_id,
            jenis=jenis,
            tipe_alert=tipe_alert,
            pesan=pesan,
            conv_id=conv_id,
            baris_index=baris_index,
            konteks=json.dumps(konteks, default=str, ensure_ascii=False) if konteks else None,
            skor=skor,
        )
        session.add(row)
        session.commit()
        row_id = row.id
        return row_id
    except Exception as e:
        session.rollback()
        print(f"Error buat alert anomali: {e}")
        return None
    finally:
        session.close()


def daftar_alert_anomali(
    client_id: Optional[int] = None,
    status: Optional[str] = "baru",
    tipe_alert: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    """Daftar alert, terbaru dulu. status=None -> semua status."""
    session = SessionLocal()
    try:
        query = session.query(AlertAnomali)
        if client_id is not None:
            query = query.filter(AlertAnomali.client_id == client_id)
        if status:
            query = query.filter(AlertAnomali.status == status)
        if tipe_alert:
            query = query.filter(AlertAnomali.tipe_alert == tipe_alert)
        query = query.order_by(AlertAnomali.dibuat_at.desc()).limit(limit)

        def _parse(x):
            if not x:
                return {}
            try:
                return json.loads(x)
            except Exception:
                return {"raw": x}

        hasil = [{
            "id": r.id,
            "client_id": r.client_id,
            "jenis": r.jenis,
            "tipe_alert": r.tipe_alert,
            "pesan": r.pesan,
            "conv_id": r.conv_id,
            "baris_index": r.baris_index,
            "konteks": _parse(r.konteks),
            "skor": r.skor,
            "status": r.status,
            "diproses_oleh": r.diproses_oleh,
            "diproses_at": r.diproses_at.isoformat() if r.diproses_at else None,
            "dibuat_at": r.dibuat_at.isoformat() if r.dibuat_at else None,
        } for r in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar alert anomali: {e}")
        return []
    finally:
        session.close()


def tandai_alert_anomali(alert_id: int, status: str, username: str) -> bool:
    """Tandai 1 alert sbg 'dilihat' atau 'diabaikan'."""
    if status not in ("dilihat", "diabaikan"):
        return False
    session = SessionLocal()
    try:
        row = session.query(AlertAnomali).filter(AlertAnomali.id == alert_id).first()
        if row is None:
            return False
        row.status = status
        row.diproses_oleh = username
        row.diproses_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tandai alert anomali: {e}")
        return False


# ============================================================
# [BARU] FUNGSI KONTAK CLIENT (utk reminder WA/email)
# ============================================================
    finally:
        session.close()

def update_kontak_client(client_id: int, nomor_wa: Optional[str] = None, email: Optional[str] = None) -> bool:
    """Update nomor WA dan/atau email client. Kirim None utk field yang
    tidak mau diubah (bukan dikosongkan) -- utk sengaja mengosongkan,
    kirim string kosong ""."""
    session = SessionLocal()
    try:
        row = session.query(Client).filter(Client.id == client_id).first()
        if row is None:
            return False
        if nomor_wa is not None:
            row.nomor_wa = nomor_wa or None
        if email is not None:
            row.email = email or None
        row.diperbarui_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error update kontak client: {e}")
        return False


# ============================================================
# [BARU] FUNGSI REMINDER DEADLINE SPT
# ============================================================
# Dipanggil dari main.py /api/proses-file setelah ak.proses_file_spt()
# supaya setiap kewajiban lapor/setor per NPWP+jenis+periode tercatat
# sbg 1 baris yang bisa dipantau scheduler harian (lihat modules/
# notifikasi.py -- jalankan_pengecekan_reminder_spt()).
    finally:
        session.close()

def simpan_reminder_deadline_spt(client_id: int, daftar_item: List[Dict[str, Any]]) -> int:
    """Upsert daftar kewajiban SPT (lapor & setor) utk 1 client. Setiap
    item dict berisi: npwp, kategori_spt, jenis_spt_label, bulan_pajak,
    tahun_pajak, jenis_deadline ("lapor"/"setor"), tanggal_batas (date/
    datetime), selesai (bool). Kalau kombinasi (client_id, npwp,
    kategori_spt, bulan_pajak, tahun_pajak, jenis_deadline) sudah ada,
    baris di-UPDATE (tanggal_batas & selesai) TANPA mereset
    milestone_terkirim -- supaya reminder yang sudah terkirim tidak
    dikirim ulang cuma krn file yang sama diupload lagi. Return jumlah
    baris yang berhasil diproses."""
    if not daftar_item:
        return 0
    berhasil = 0
    session = SessionLocal()
    try:
        for item in daftar_item:
            tanggal_batas = item.get("tanggal_batas")
            if not tanggal_batas:
                continue
            if isinstance(tanggal_batas, date) and not isinstance(tanggal_batas, datetime):
                tanggal_batas = datetime.combine(tanggal_batas, datetime.min.time())

            existing = session.query(ReminderDeadlineSpt).filter(
                ReminderDeadlineSpt.client_id == client_id,
                ReminderDeadlineSpt.npwp == item.get("npwp"),
                ReminderDeadlineSpt.kategori_spt == item.get("kategori_spt"),
                ReminderDeadlineSpt.bulan_pajak == item.get("bulan_pajak"),
                ReminderDeadlineSpt.tahun_pajak == item.get("tahun_pajak"),
                ReminderDeadlineSpt.jenis_deadline == item.get("jenis_deadline"),
            ).first()

            if existing:
                existing.tanggal_batas = tanggal_batas
                existing.jenis_spt_label = item.get("jenis_spt_label") or existing.jenis_spt_label
                existing.selesai = bool(item.get("selesai", False))
                existing.diperbarui_at = datetime.now()
            else:
                session.add(ReminderDeadlineSpt(
                    client_id=client_id,
                    npwp=item.get("npwp"),
                    kategori_spt=item.get("kategori_spt"),
                    jenis_spt_label=item.get("jenis_spt_label"),
                    bulan_pajak=item.get("bulan_pajak"),
                    tahun_pajak=item.get("tahun_pajak"),
                    jenis_deadline=item.get("jenis_deadline"),
                    tanggal_batas=tanggal_batas,
                    selesai=bool(item.get("selesai", False)),
                ))
            berhasil += 1
        session.commit()
        return berhasil
    except Exception as e:
        session.rollback()
        print(f"Error simpan reminder deadline SPT: {e}")
        return berhasil
    finally:
        session.close()


def ambil_reminder_jatuh_tempo(hari_dari: int, hari_sampai: int) -> List[Dict[str, Any]]:
    """Ambil semua kewajiban SPT yang BELUM selesai dengan tanggal_batas
    antara (hari_ini + hari_dari) s/d (hari_ini + hari_sampai) hari,
    lengkap dgn kontak client (nomor_wa/email) utk dikirim notifikasi.
    Pakai hari_dari negatif utk termasuk yang SUDAH lewat jatuh tempo
    (mis. hari_dari=-9999, hari_sampai=0 -> semua yang sudah/hari ini
    jatuh tempo dan belum selesai -> reminder "H0/terlambat")."""
    session = SessionLocal()
    try:
        hari_ini = datetime.now().date()
        batas_awal = datetime.combine(hari_ini + timedelta(days=hari_dari), datetime.min.time())
        batas_akhir = datetime.combine(hari_ini + timedelta(days=hari_sampai), datetime.max.time())

        query = session.query(ReminderDeadlineSpt, Client).join(
            Client, ReminderDeadlineSpt.client_id == Client.id
        ).filter(
            ReminderDeadlineSpt.selesai == False,  # noqa: E712
            ReminderDeadlineSpt.tanggal_batas >= batas_awal,
            ReminderDeadlineSpt.tanggal_batas <= batas_akhir,
        )

        hasil = []
        for r, c in query.all():
            hasil.append({
                "id": r.id,
                "client_id": r.client_id,
                "client_nama": c.nama,
                "nomor_wa": c.nomor_wa,
                "email": c.email,
                "npwp": r.npwp,
                "kategori_spt": r.kategori_spt,
                "jenis_spt_label": r.jenis_spt_label,
                "bulan_pajak": r.bulan_pajak,
                "tahun_pajak": r.tahun_pajak,
                "jenis_deadline": r.jenis_deadline,
                "tanggal_batas": r.tanggal_batas.isoformat() if r.tanggal_batas else None,
                "milestone_terkirim": json.loads(r.milestone_terkirim) if r.milestone_terkirim else [],
            })
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil reminder jatuh tempo: {e}")
        return []
    finally:
        session.close()


def tandai_milestone_terkirim(reminder_id: int, milestone: str) -> bool:
    """Catat bahwa milestone reminder tertentu (mis. 'h-3_wa', 'h-1_inapp',
    'h0_wa') sudah terkirim utk 1 baris ReminderDeadlineSpt -- dicek dulu
    di modules/notifikasi.py sebelum kirim ulang, supaya tidak spam."""
    session = SessionLocal()
    try:
        row = session.query(ReminderDeadlineSpt).filter(ReminderDeadlineSpt.id == reminder_id).first()
        if row is None:
            return False
        daftar = json.loads(row.milestone_terkirim) if row.milestone_terkirim else []
        if milestone not in daftar:
            daftar.append(milestone)
        row.milestone_terkirim = json.dumps(daftar, ensure_ascii=False)
        row.diperbarui_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tandai milestone terkirim: {e}")
        return False
    finally:
        session.close()


def daftar_reminder_spt_client(client_id: int, hanya_belum_selesai: bool = True) -> List[Dict[str, Any]]:
    """Daftar semua kewajiban SPT 1 client, terdekat jatuh tempo dulu --
    utk kalender deadline di dashboard client (terpisah dari kotak masuk
    alert, supaya bisa lihat SEMUA kewajiban walau belum waktunya
    di-reminder)."""
    session = SessionLocal()
    try:
        query = session.query(ReminderDeadlineSpt).filter(ReminderDeadlineSpt.client_id == client_id)
        if hanya_belum_selesai:
            query = query.filter(ReminderDeadlineSpt.selesai == False)  # noqa: E712
        query = query.order_by(ReminderDeadlineSpt.tanggal_batas.asc())

        hasil = [{
            "id": r.id,
            "npwp": r.npwp,
            "kategori_spt": r.kategori_spt,
            "jenis_spt_label": r.jenis_spt_label,
            "bulan_pajak": r.bulan_pajak,
            "tahun_pajak": r.tahun_pajak,
            "jenis_deadline": r.jenis_deadline,
            "tanggal_batas": r.tanggal_batas.isoformat() if r.tanggal_batas else None,
            "selesai": r.selesai,
            "milestone_terkirim": json.loads(r.milestone_terkirim) if r.milestone_terkirim else [],
        } for r in query.all()]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar reminder SPT client: {e}")
        return []


# ============================================================
# [BARU] FUNGSI COA PERMANEN PER CLIENT
# ============================================================
    finally:
        session.close()

def simpan_coa_bulk(client_id: int, daftar_akun: List[Dict[str, Any]], ganti_semua: bool = True) -> int:
    """
    Simpan banyak akun COA sekaligus untuk satu client (mis. hasil import
    dari sheet 'COA' file Excel, atau input manual dari UI).

    Args:
        client_id: id client
        daftar_akun: list of dict, tiap dict minimal punya "no_akun" &
            "nama_akun", boleh juga "kategori", "sub_kategori",
            "normal_saldo", "saldo_awal"
        ganti_semua: kalau True (default), COA lama client ini DIHAPUS dulu
            sebelum diisi ulang (dipakai saat import ulang dari file).
            Kalau False, akun baru ditambahkan tanpa menghapus yang lama
            (no_akun yang sudah ada akan diperbarui, bukan diduplikasi).

    Returns:
        int jumlah akun yang berhasil disimpan
    """
    session = SessionLocal()
    try:

        if ganti_semua:
            session.query(Coa).filter(Coa.client_id == client_id).delete()
            session.flush()
            count = 0
            for akun in daftar_akun:
                no_akun = str(akun.get("no_akun") or "").strip()
                nama_akun = str(akun.get("nama_akun") or "").strip()
                if not no_akun or not nama_akun:
                    continue
                session.add(Coa(
                    client_id=client_id,
                    no_akun=no_akun,
                    nama_akun=nama_akun,
                    kategori=(akun.get("kategori") or None),
                    sub_kategori=akun.get("sub_kategori"),
                    normal_saldo=akun.get("normal_saldo"),
                    saldo_awal=_angka(akun.get("saldo_awal")),  # [FIX] NaN-safe
                    segment=akun.get("segment"),      # [BARU]
                    arus_kas=akun.get("arus_kas"),    # [BARU]
                    keterangan=akun.get("keterangan"),  # [BARU]
                    lawan_transaksi_saldo_awal=akun.get("lawan_transaksi_saldo_awal"),  # [BARU]
                    project_unit_saldo_awal=akun.get("project_unit_saldo_awal"),  # [BARU]
                ))
                count += 1
        else:
            existing = {
                a.no_akun: a for a in
                session.query(Coa).filter(Coa.client_id == client_id).all()
            }
            count = 0
            for akun in daftar_akun:
                no_akun = str(akun.get("no_akun") or "").strip()
                nama_akun = str(akun.get("nama_akun") or "").strip()
                if not no_akun or not nama_akun:
                    continue
                if no_akun in existing:
                    a = existing[no_akun]
                    a.nama_akun = nama_akun
                    a.kategori = akun.get("kategori") or a.kategori
                    a.sub_kategori = akun.get("sub_kategori") or a.sub_kategori
                    a.normal_saldo = akun.get("normal_saldo") or a.normal_saldo
                    if akun.get("saldo_awal") is not None:
                        a.saldo_awal = _angka(akun.get("saldo_awal"))  # [FIX] NaN-safe
                    if akun.get("segment") is not None:      # [BARU]
                        a.segment = akun.get("segment")
                    if akun.get("arus_kas") is not None:      # [BARU]
                        a.arus_kas = akun.get("arus_kas")
                    if akun.get("keterangan") is not None:    # [BARU]
                        a.keterangan = akun.get("keterangan")
                    if akun.get("lawan_transaksi_saldo_awal") is not None:  # [BARU]
                        a.lawan_transaksi_saldo_awal = akun.get("lawan_transaksi_saldo_awal")
                    if akun.get("project_unit_saldo_awal") is not None:  # [BARU]
                        a.project_unit_saldo_awal = akun.get("project_unit_saldo_awal")
                else:
                    session.add(Coa(
                        client_id=client_id,
                        no_akun=no_akun,
                        nama_akun=nama_akun,
                        kategori=(akun.get("kategori") or None),
                        sub_kategori=akun.get("sub_kategori"),
                        normal_saldo=akun.get("normal_saldo"),
                        saldo_awal=_angka(akun.get("saldo_awal")),  # [FIX] NaN-safe
                        segment=akun.get("segment"),      # [BARU]
                        arus_kas=akun.get("arus_kas"),    # [BARU]
                        keterangan=akun.get("keterangan"),  # [BARU]
                        lawan_transaksi_saldo_awal=akun.get("lawan_transaksi_saldo_awal"),  # [BARU]
                        project_unit_saldo_awal=akun.get("project_unit_saldo_awal"),  # [BARU]
                    ))
                count += 1

        session.commit()
        return count
    except Exception as e:
        session.rollback()
        print(f"Error simpan COA bulk: {e}")
        return 0
    finally:
        session.close()


def ambil_coa_client(client_id: int, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Ambil seluruh COA milik satu client, terurut berdasarkan no_akun."""
    session = SessionLocal()
    try:
        query = session.query(Coa).filter(Coa.client_id == client_id)
        if hanya_aktif:
            query = query.filter(Coa.aktif.is_(True))
        hasil = [
            {
                "id": a.id, "no_akun": a.no_akun, "nama_akun": a.nama_akun,
                "kategori": a.kategori, "sub_kategori": a.sub_kategori,
                "normal_saldo": a.normal_saldo, "saldo_awal": a.saldo_awal,
                "segment": a.segment, "arus_kas": a.arus_kas,  # [BARU]
                "keterangan": a.keterangan,  # [BARU]
                "lawan_transaksi_saldo_awal": a.lawan_transaksi_saldo_awal,  # [BARU]
                "project_unit_saldo_awal": a.project_unit_saldo_awal,  # [BARU]
                "aktif": a.aktif,
            }
            for a in query.order_by(Coa.no_akun).all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil COA client: {e}")
        return []
    finally:
        session.close()


def cari_akun_coa(client_id: int, no_akun: str) -> Optional[Dict[str, Any]]:
    """Cari satu akun COA client berdasarkan no_akun persis."""
    session = SessionLocal()
    try:
        a = session.query(Coa).filter(
            Coa.client_id == client_id, Coa.no_akun == str(no_akun)
        ).first()
        if a is None:
            return None
        hasil = {
            "id": a.id, "no_akun": a.no_akun, "nama_akun": a.nama_akun,
            "kategori": a.kategori, "sub_kategori": a.sub_kategori,
            "normal_saldo": a.normal_saldo, "saldo_awal": a.saldo_awal,
        }
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error cari akun COA: {e}")
        return None
    finally:
        session.close()


def ambil_akun_coa_by_id(akun_id: int) -> Optional[Dict[str, Any]]:
    """Ambil satu akun COA berdasarkan id baris. Dipakai untuk mengambil
    snapshot "sebelum" saat update/hapus, untuk audit trail."""
    session = SessionLocal()
    try:
        a = session.query(Coa).filter(Coa.id == akun_id).first()
        if a is None:
            return None
        hasil = {
            "id": a.id, "client_id": a.client_id, "no_akun": a.no_akun,
            "nama_akun": a.nama_akun, "kategori": a.kategori,
            "sub_kategori": a.sub_kategori, "normal_saldo": a.normal_saldo,
            "saldo_awal": a.saldo_awal, "segment": a.segment,  # [BARU]
            "arus_kas": a.arus_kas, "keterangan": a.keterangan,  # [BARU]
            "aktif": a.aktif,
        }
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil akun COA by id: {e}")
        return None
    finally:
        session.close()


def tambah_akun_coa(client_id: int, no_akun: str, nama_akun: str, kategori: Optional[str] = None,
                     sub_kategori: Optional[str] = None, normal_saldo: Optional[str] = None,
                     saldo_awal: float = 0, segment: Optional[str] = None,
                     arus_kas: Optional[str] = None, keterangan: Optional[str] = None,
                     lawan_transaksi_saldo_awal: Optional[str] = None,
                     project_unit_saldo_awal: Optional[str] = None) -> bool:
    """Tambah satu akun COA baru untuk client (dipakai dari form 'tambah akun' di UI)."""
    session = SessionLocal()
    try:
        session.add(Coa(
            client_id=client_id, no_akun=str(no_akun).strip(), nama_akun=str(nama_akun).strip(),
            kategori=kategori, sub_kategori=sub_kategori, normal_saldo=normal_saldo,
            saldo_awal=_angka(saldo_awal),  # [FIX] NaN-safe
            segment=segment, arus_kas=arus_kas,  # [BARU]
            keterangan=keterangan,  # [BARU]
            lawan_transaksi_saldo_awal=lawan_transaksi_saldo_awal,  # [BARU]
            project_unit_saldo_awal=project_unit_saldo_awal,  # [BARU]
        ))
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tambah akun COA: {e}")
        return False
    finally:
        session.close()


def update_akun_coa(akun_id: int, **field_baru) -> bool:
    """Update field akun COA (mis. kategori, nama_akun) berdasarkan id baris."""
    session = SessionLocal()
    try:
        a = session.query(Coa).filter(Coa.id == akun_id).first()
        if a is None:
            return False
        for k, v in field_baru.items():
            if hasattr(a, k) and v is not None:
                setattr(a, k, v)
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error update akun COA: {e}")
        return False
    finally:
        session.close()


def hapus_akun_coa(akun_id: int) -> bool:
    """Nonaktifkan (soft-delete) satu akun COA -- tidak dihapus fisik supaya
    histori jurnal_posting yang sudah memakai akun ini tetap bisa ditelusuri."""
    session = SessionLocal()
    try:
        a = session.query(Coa).filter(Coa.id == akun_id).first()
        if a is None:
            return False
        a.aktif = False
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error hapus akun COA: {e}")
        return False


# ============================================================
# [BARU - Prioritas #4] FUNGSI COUNTER NOMOR VOUCHER PERSISTEN
# ============================================================
# Lihat docstring class VoucherCounter di atas untuk latar belakang bug
# yang diperbaiki (nomor voucher mulai dari 1 lagi tiap kali fungsi export
# dipanggil). Dipakai oleh modules/accounting_export.py.
    finally:
        session.close()

def ambil_blok_nomor_voucher(client_id: int, kode_bank: str, periode: str, jumlah: int) -> range:
    """
    Reservasi 'jumlah' nomor voucher BERURUTAN sekaligus untuk kombinasi
    (client_id, kode_bank, periode), dan LANGSUNG SIMPAN ke database
    (atomic increment) -- supaya panggilan berikutnya (mis. upload ulang/
    revisi rekening koran bulan yang sama) melanjutkan dari nomor
    terakhir yang tersimpan, bukan mulai dari 1 lagi.

    Sengaja mengambil 'jumlah' sekaligus (bukan 1 nomor per panggilan DB)
    supaya export satu file dengan ratusan/ribuan baris rekening koran
    tidak perlu buka transaksi DB terpisah per baris -- cukup 1 round-trip
    per bank per file.

    periode: format "MMYY", mis. "0726" untuk Juli 2026 -- HARUS sama
    persis dengan format yang dipakai di teks nomor voucher itu sendiri
    (accounting_export._kode_bank_dari_nama + f"{bulan:02d}{tahun[-2:]}"),
    supaya baris di tabel voucher_counter gampang ditelusuri manual.

    Return: range() berisi nomor-nomor voucher yang boleh dipakai
    berurutan, mis. range(15, 25) untuk 10 nomor kalau nomor terakhir
    tersimpan sebelumnya adalah 14. range kosong (range(0,0)) kalau
    jumlah <= 0 -- tidak menyentuh DB sama sekali dalam kasus ini.

    Thread/proses-safe: di PostgreSQL (produksi) pakai row lock
    (SELECT ... FOR UPDATE) supaya dua request paralel utk client+bank+
    periode yang SAMA tidak pernah dapat blok nomor yang tumpang tindih.
    Di SQLite (dev lokal) with_for_update() dilewati (SQLite tidak
    mendukungnya) -- cukup aman karena SQLite sendiri mengunci seluruh
    file saat ada write, jadi tidak akan terjadi race condition di level
    OS, hanya tidak seefisien Postgres untuk banyak write paralel.
    """
    if jumlah <= 0:
        return range(0, 0)

    session = SessionLocal()
    try:
        query = session.query(VoucherCounter).filter_by(
            client_id=client_id, kode_bank=kode_bank, periode=periode,
        )
        if engine.dialect.name != "sqlite":
            query = query.with_for_update()
        counter = query.first()

        if counter is None:
            counter = VoucherCounter(
                client_id=client_id, kode_bank=kode_bank, periode=periode, nomor_terakhir=0,
            )
            session.add(counter)
            session.flush()  # supaya row ini sudah "ada" & (di Postgres) terkunci sebelum increment

        nomor_mulai = counter.nomor_terakhir + 1
        counter.nomor_terakhir += jumlah
        nomor_selesai = counter.nomor_terakhir
        session.commit()
        return range(nomor_mulai, nomor_selesai + 1)
    except Exception as e:
        session.rollback()
        print(f"Error ambil blok nomor voucher (client={client_id}, bank={kode_bank}, periode={periode}): {e}")
        raise
    finally:
        session.close()


def ambil_nomor_voucher_terakhir(client_id: int, kode_bank: str, periode: str) -> int:
    """Lihat nomor voucher terakhir yang SUDAH terpakai (tanpa mereservasi
    nomor baru) -- utk keperluan tampilan/audit di frontend, mis. menampilkan
    'Voucher terakhir bulan ini: BRI-0726-42' sebelum akuntan upload file baru."""
    session = SessionLocal()
    try:
        counter = session.query(VoucherCounter).filter_by(
            client_id=client_id, kode_bank=kode_bank, periode=periode,
        ).first()
        return counter.nomor_terakhir if counter else 0
    except Exception as e:
        session.rollback()
        print(f"Error ambil nomor voucher terakhir: {e}")
        return 0
    finally:
        session.close()


def reset_voucher_counter(client_id: int, kode_bank: str, periode: str) -> bool:
    """
    Reset counter voucher ke 0 utk kombinasi client+bank+periode tertentu.

    SENGAJA dipisah sbg fungsi manual/eksplisit (bukan otomatis) -- reset
    yang tidak disengaja akan bikin nomor voucher dobel dgn file yang sudah
    pernah di-export sebelumnya utk periode yg sama. Sediakan endpoint API
    khusus utk ini (dgn konfirmasi jelas di UI) kalau memang dibutuhkan,
    mis. utk kasus "upload sebelumnya salah total, mulai ulang dari 0".
    """
    session = SessionLocal()
    try:
        counter = session.query(VoucherCounter).filter_by(
            client_id=client_id, kode_bank=kode_bank, periode=periode,
        ).first()
        if counter is None:
            return False
        counter.nomor_terakhir = 0
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error reset voucher counter: {e}")
        return False


# ============================================================
# [BARU] FUNGSI JURNAL POSTING (antrean review -> buku besar resmi)
# ============================================================
    finally:
        session.close()

def _angka(v) -> float:
    """
    [FIX] Konversi nilai ke float dengan aman -- None/NaN/inf semua
    dianggap 0.0. Kode lama di file ini pakai pola
    `float(x.get("jml_debet") or 0)`, yang TIDAK aman untuk NaN:
    `float('nan') or 0` mengembalikan `nan` itu sendiri (NaN dianggap
    truthy di Python, beda dari None/0/""), jadi fallback "or 0"-nya
    tidak pernah kepakai kalau nilainya NaN.

    Ini SANGAT penting di sini secara khusus: tarik_draf_jurnal_ke_posting()
    memakai fungsi ini untuk isi kolom jml_debet/jml_kredit di
    JurnalPosting -- yaitu jurnal yang SUDAH PERMANEN tersimpan di
    database dan jadi sumber Neraca/Laba Rugi (modules/laporan_keuangan.py).
    Tanpa fix ini, 1 baris dengan jml_debet/jml_kredit NaN akan
    TERSIMPAN sebagai NaN secara permanen (kolom Float di SQLite/Postgres
    menerima NaN tanpa error) -- lalu MERACUNI seluruh total saldo akun
    itu di setiap laporan yang dibuat setelahnya, tanpa ada error yang
    kelihatan sama sekali.
    """
    if v is None:
        return 0.0
    try:
        f = float(v)
    except (TypeError, ValueError):
        return 0.0
    if pd.isna(f) or f in (float("inf"), float("-inf")):
        return 0.0
    return f


def _kode_bank_dari_nama_lokal(nama_bank: str) -> str:
    """
    [Prioritas #7] Duplikat SENGAJA dari accounting_export._kode_bank_dari_nama()
    -- db_client.py tidak boleh import dari modules/ (risiko circular import,
    karena beberapa modules/*.py sudah import db_client). Kalau logika kode
    bank di accounting_export.py diubah, logika ini WAJIB diubah juga supaya
    voucher yang di-mint di sini (saat draft dibuat) tetap konsisten dengan
    prefix yang dipakai saat export (mis. "BRI-0726-1").
    """
    kata = str(nama_bank).strip().upper().split()
    return kata[-1] if kata else "BANK"


def _periode_voucher_dari_tanggal(tanggal_str, default_bulan: int = None, default_tahun: int = None) -> str:
    """[Prioritas #7] Format "MMYY" dari tanggal baris (mis. "0726" utk Juli
    2026). Fallback ke default_bulan/tahun (mis. bulan file diupload) atau
    bulan berjalan kalau tanggal baris tidak bisa diparse -- baris TETAP
    dapat voucher (tidak boleh gagal cuma karena 1 tanggal aneh), hanya
    mungkin masuk periode yg sedikit meleset & perlu dicek manual."""
    import pandas as _pd
    t = _pd.to_datetime(tanggal_str, errors="coerce")
    if _pd.isna(t):
        bulan = default_bulan or datetime.now().month
        tahun = default_tahun or datetime.now().year
    else:
        bulan, tahun = t.month, t.year
    return f"{bulan:02d}{str(tahun)[-2:]}"


# ============================================================
# FUNGSI UPLOAD BATCH (dedup upload rekening koran)
# ============================================================

def _buat_transaction_hash_baris(baris: Dict[str, Any]) -> str:
    """
    [dedup upload] Duplikat SENGAJA dari
    modules/dedup_transaksi.buat_signature_baris() -- db_client.py
    tidak boleh import dari modules/ (risiko circular import, sama
    seperti alasan _kode_bank_dari_nama_lokal() di atas). KALAU FORMULA
    DI modules/dedup_transaksi.py DIUBAH, FORMULA DI SINI WAJIB DIUBAH
    JUGA -- kalau tidak, hash yang dihitung saat evaluasi (sebelum baris
    disimpan) tidak akan cocok dgn hash yang benar-benar tersimpan di
    kolom jurnal_posting.transaction_hash, dan deteksi duplikat jadi
    tidak berfungsi sama sekali (selalu menganggap semua baris baru).
    """
    import hashlib

    def _nominal(v):
        try:
            if v is None or (isinstance(v, float) and pd.isna(v)):
                return "0.00"
            return f"{float(v):.2f}"
        except (TypeError, ValueError):
            return "0.00"

    def _tanggal(v):
        t = pd.to_datetime(v, errors="coerce")
        if pd.isna(t):
            return str(v or "")
        return t.strftime("%Y-%m-%d")

    def _keterangan(v):
        if v is None:
            return ""
        import re
        return re.sub(r"\s+", " ", str(v).strip().lower())

    bagian = [
        _tanggal(baris.get("tanggal")),
        str(baris.get("bank") or "").strip().upper(),
        _keterangan(baris.get("keterangan")),
        _nominal(baris.get("jml_debet")),
        _nominal(baris.get("jml_kredit")),
        _nominal(baris.get("saldo")),
    ]
    return hashlib.sha256("|".join(bagian).encode("utf-8")).hexdigest()


def cari_upload_batch_by_file_hash(client_id: int, file_hash: str) -> Optional[Dict[str, Any]]:
    """Cek apakah file dgn hash ini PERNAH diupload utk client ini
    (status apapun -- termasuk yang lama sudah 'revisi_diganti', supaya
    tetap terdeteksi walau batch lamanya sudah tidak aktif lagi)."""
    if not file_hash:
        return None
    session = SessionLocal()
    try:
        b = (
            session.query(UploadBatch)
            .filter(UploadBatch.client_id == client_id, UploadBatch.file_hash == file_hash)
            .order_by(UploadBatch.dibuat_at.desc())
            .first()
        )
        hasil = _upload_batch_ke_dict(b) if b else None
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error cari upload batch by file hash: {e}")
        return None
    finally:
        session.close()


def ambil_batch_aktif(client_id: int, kode_bank: str, periode: str) -> Optional[Dict[str, Any]]:
    """Batch TERAKTIF (status == 'aktif', paling baru) utk kombinasi
    client+bank+periode ini -- ini yang jadi 'sumber kebenaran' saat
    membandingkan upload baru."""
    session = SessionLocal()
    try:
        b = (
            session.query(UploadBatch)
            .filter(
                UploadBatch.client_id == client_id,
                UploadBatch.kode_bank == kode_bank,
                UploadBatch.periode == periode,
                UploadBatch.status == "aktif",
            )
            .order_by(UploadBatch.dibuat_at.desc())
            .first()
        )
        hasil = _upload_batch_ke_dict(b) if b else None
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil batch aktif: {e}")
        return None
    finally:
        session.close()


def ambil_upload_batch_by_id(batch_id: int) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        b = session.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
        hasil = _upload_batch_ke_dict(b, sertakan_draf_jurnal=True) if b else None
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil upload batch by id: {e}")
        return None
    finally:
        session.close()


def daftar_upload_batch_client(client_id: int, limit: int = 100) -> List[Dict[str, Any]]:
    """Riwayat upload rekening koran per client -- utk tab 'Riwayat
    Upload' di UI, independen dari riwayat per-baris jurnal_posting."""
    session = SessionLocal()
    try:
        rows = (
            session.query(UploadBatch)
            .filter(UploadBatch.client_id == client_id)
            .order_by(UploadBatch.dibuat_at.desc())
            .limit(limit)
            .all()
        )
        hasil = [_upload_batch_ke_dict(b) for b in rows]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar upload batch client: {e}")
        return []
    finally:
        session.close()


def ambil_hash_transaksi_aktif(client_id: int, kode_bank: str, periode: str) -> set:
    """Kumpulan transaction_hash SEMUA baris jurnal_posting yang masih
    'berlaku' (status draft ATAU terposting -- BUKAN yang sudah
    'ditolak', krn baris ditolak dianggap tidak pernah benar-benar
    tercatat) utk kombinasi client+bank+periode ini. Dipakai
    modules/dedup_transaksi.py utk bandingkan fingerprint baris baru."""
    session = SessionLocal()
    try:
        rows = (
            session.query(JurnalPosting.transaction_hash)
            .filter(
                JurnalPosting.client_id == client_id,
                JurnalPosting.kode_bank == kode_bank,
                JurnalPosting.periode_voucher == periode,
                JurnalPosting.status != "ditolak",
                JurnalPosting.transaction_hash.isnot(None),
            )
            .all()
        )
        return {r[0] for r in rows}
    except Exception as e:
        session.rollback()
        print(f"Error ambil hash transaksi aktif: {e}")
        return set()
    finally:
        session.close()


def catat_upload_batch(
    client_id: int,
    kode_bank: str,
    periode: str,
    status: str,
    hasil_id: Optional[int] = None,
    nama_file: Optional[str] = None,
    file_hash: Optional[str] = None,
    jumlah_baris_total: int = 0,
    jumlah_baris_baru: int = 0,
    jumlah_baris_overlap: int = 0,
    status_deteksi: Optional[str] = None,
    draf_jurnal: Optional[List[Dict[str, Any]]] = None,
    diupload_oleh: Optional[str] = None,
) -> Optional[int]:
    """Catat satu baris riwayat upload utk kombinasi (client, bank,
    periode). Return id batch yang baru dibuat (dipakai frontend utk
    endpoint konfirmasi kalau status == 'menunggu_konfirmasi'), atau
    None kalau gagal (TIDAK melempar exception -- pencatatan batch
    tidak boleh menggagalkan alur upload utamanya)."""
    session = SessionLocal()
    try:
        draf_json = None
        if draf_jurnal is not None:
            draf_json = json.dumps(draf_jurnal, default=str, ensure_ascii=False)
        batch = UploadBatch(
            client_id=client_id,
            hasil_id=hasil_id,
            kode_bank=kode_bank,
            periode=periode,
            nama_file=nama_file,
            file_hash=file_hash,
            jumlah_baris_total=jumlah_baris_total,
            jumlah_baris_baru=jumlah_baris_baru,
            jumlah_baris_overlap=jumlah_baris_overlap,
            status_deteksi=status_deteksi,
            status=status,
            draf_jurnal_json=draf_json,
            diupload_oleh=diupload_oleh,
        )
        session.add(batch)
        session.commit()
        batch_id = batch.id
        return batch_id
    except Exception as e:
        session.rollback()
        print(f"Error catat upload batch: {e}")
        return None
    finally:
        session.close()


def perbarui_status_upload_batch(
    batch_id: int,
    status: str,
    user: Optional[str] = None,
    kosongkan_draf_jurnal: bool = True,
) -> bool:
    """Ubah status batch (mis. 'menunggu_konfirmasi' -> 'aktif'/
    'dibatalkan'). draf_jurnal_json DIKOSONGKAN begitu batch tidak lagi
    'menunggu_konfirmasi' (snapshot itu sudah tidak relevan lagi -- kalau
    aktif, datanya sudah pindah ke jurnal_posting; kalau dibatalkan,
    memang tidak dipakai)."""
    session = SessionLocal()
    try:
        b = session.query(UploadBatch).filter(UploadBatch.id == batch_id).first()
        if b is None:
            return False
        b.status = status
        if user:
            b.dikonfirmasi_oleh = user
            b.dikonfirmasi_at = datetime.now()
        if kosongkan_draf_jurnal and status != "menunggu_konfirmasi":
            b.draf_jurnal_json = None
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error perbarui status upload batch: {e}")
        return False
    finally:
        session.close()


def tandai_batch_diganti(batch_lama_id: int, batch_baru_id: int) -> bool:
    """Tandai batch LAMA sebagai 'revisi_diganti' oleh batch BARU --
    dipanggil saat akuntan mengonfirmasi revisi (bukan duplikat murni).
    Batch lama TETAP ada di riwayat (tidak dihapus), cuma statusnya
    berubah supaya ambil_batch_aktif() berikutnya mengambil yang baru."""
    session = SessionLocal()
    try:
        lama = session.query(UploadBatch).filter(UploadBatch.id == batch_lama_id).first()
        if lama is None:
            return False
        lama.status = "revisi_diganti"
        lama.diganti_oleh_batch_id = batch_baru_id
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tandai batch diganti: {e}")
        return False
    finally:
        session.close()


def _upload_batch_ke_dict(b: "UploadBatch", sertakan_draf_jurnal: bool = False) -> Dict[str, Any]:
    hasil = {
        "id": b.id,
        "client_id": b.client_id,
        "hasil_id": b.hasil_id,
        "jenis_dokumen": b.jenis_dokumen,
        "kode_bank": b.kode_bank,
        "periode": b.periode,
        "nama_file": b.nama_file,
        "file_hash": b.file_hash,
        "jumlah_baris_total": b.jumlah_baris_total,
        "jumlah_baris_baru": b.jumlah_baris_baru,
        "jumlah_baris_overlap": b.jumlah_baris_overlap,
        "status_deteksi": b.status_deteksi,
        "status": b.status,
        "diganti_oleh_batch_id": b.diganti_oleh_batch_id,
        "diupload_oleh": b.diupload_oleh,
        "dikonfirmasi_oleh": b.dikonfirmasi_oleh,
        "dikonfirmasi_at": b.dikonfirmasi_at.isoformat() if b.dikonfirmasi_at else None,
        "dibuat_at": b.dibuat_at.isoformat() if b.dibuat_at else None,
    }
    if sertakan_draf_jurnal and b.draf_jurnal_json:
        try:
            hasil["draf_jurnal"] = json.loads(b.draf_jurnal_json)
        except Exception:
            hasil["draf_jurnal"] = []
    return hasil


def tarik_draf_jurnal_ke_posting(client_id: int, hasil_id: int, jenis_dokumen: str,
                                  draf_jurnal: List[Dict[str, Any]]) -> int:
    """
    Salin baris-baris draf_jurnal (dari hasil proses_file_xxx) ke antrean
    jurnal_posting berstatus 'draft', supaya muncul di layar review
    akuntan. Dipanggil otomatis oleh main.py setiap kali /api/proses-file
    menyimpan hasil yang mengandung draf_jurnal.

    "sumber_placeholder" ditandai True kalau no_akun_debet ATAU
    no_akun_kredit-nya masih mengandung "/" (pola penanda placeholder yang
    dipakai konsisten di semua proses_file_xxx, mis. "PIUTANG/KAS",
    "PENDAPATAN/PIUTANG/LAIN") -- supaya UI bisa menyorot baris yang
    PASTI butuh keputusan akuntan sebelum diposting.

    [BARU - Prioritas #7] Untuk jenis_dokumen == "rekening_koran" khusus:
    setiap baris LANGSUNG diberi nomor voucher permanen di sini (bukan
    belakangan saat export ke Excel), diambil dari counter persisten
    (lihat ambil_blok_nomor_voucher()/VoucherCounter). Baris dikelompokkan
    dulu per (kode_bank, periode) supaya reservasi nomor dilakukan per
    kelompok (1 query per bank per bulan yang muncul di file), bukan 1
    query per baris -- tetap efisien walau filenya ribuan baris.

    Returns:
        int jumlah baris yang berhasil ditarik ke antrean
    """
    if not draf_jurnal:
        return 0
    session = None
    try:
        pakai_voucher = (jenis_dokumen == "rekening_koran")

        voucher_per_baris: List[Optional[str]] = [None] * len(draf_jurnal)
        periode_per_baris: List[Optional[str]] = [None] * len(draf_jurnal)

        if pakai_voucher:
            # --- Tahap 1: kelompokkan index baris per (kode_bank, periode) ---
            kelompok: Dict[tuple, List[int]] = {}
            for i, baris in enumerate(draf_jurnal):
                no_debet = str(baris.get("no_akun_debet") or "")
                no_kredit = str(baris.get("no_akun_kredit") or "")
                if not no_debet or not no_kredit:
                    continue  # sama seperti filter di bawah -- baris kosong tidak akan disimpan, jangan buang nomor voucher untuknya
                kode_bank = _kode_bank_dari_nama_lokal(baris.get("bank") or "BANK")
                periode = _periode_voucher_dari_tanggal(baris.get("tanggal"))
                kelompok.setdefault((kode_bank, periode), []).append(i)

            # --- Tahap 2: reservasi blok nomor sekaligus per kelompok ---
            for (kode_bank, periode), idx_list in kelompok.items():
                blok = ambil_blok_nomor_voucher(client_id, kode_bank, periode, len(idx_list))
                for i, nomor in zip(idx_list, blok):
                    voucher_per_baris[i] = f"{kode_bank}-{periode}-{nomor}"
                    periode_per_baris[i] = periode

        session = SessionLocal()
        # [FIX -- POINT 4] Sebelumnya session.add() dipanggil per baris di
        # dalam loop -- SQLAlchemy ORM mengirim 1 statement INSERT
        # terpisah per objek walau commit()-nya cuma sekali di akhir
        # (round-trip ke DB tetap sebanyak jumlah baris). Untuk rekening
        # koran ribuan baris ini jadi ribuan round-trip per upload.
        # Diganti bulk_save_objects() -- SQLAlchemy mengirimnya sebagai
        # batch (executemany di level driver), bukan 1 per 1. Objek
        # JurnalPosting tetap dibuat sama seperti sebelumnya, hanya cara
        # memasukkannya ke session yang berubah.
        objek_baru = []
        count = 0
        for i, baris in enumerate(draf_jurnal):
            no_debet = str(baris.get("no_akun_debet") or "")
            no_kredit = str(baris.get("no_akun_kredit") or "")
            if not no_debet or not no_kredit:
                continue
            placeholder = ("/" in no_debet) or ("/" in no_kredit)
            # [BARU - dedup upload] Fingerprint & kode bank baris ini,
            # HANYA dihitung utk rekening_koran -- sama seperti
            # voucher/periode_voucher, karena baris jenis dokumen lain
            # tidak (belum) punya konsep bank+periode yang relevan utk
            # dedup ini. Formula HARUS identik dgn
            # modules/dedup_transaksi.buat_signature_baris(), lihat
            # catatan di _buat_transaction_hash_baris() di atas.
            hash_baris = _buat_transaction_hash_baris(baris) if pakai_voucher else None
            objek_baru.append(JurnalPosting(
                client_id=client_id,
                hasil_id=hasil_id,
                jenis_dokumen=jenis_dokumen,
                tanggal=str(baris.get("tanggal") or "") or None,
                keterangan=baris.get("keterangan") or baris.get("catatan"),
                no_akun_debet=no_debet,
                nama_akun_debet=baris.get("nama_akun_debet"),
                jml_debet=_angka(baris.get("jml_debet")),  # [FIX] NaN-safe
                no_akun_kredit=no_kredit,
                nama_akun_kredit=baris.get("nama_akun_kredit"),
                jml_kredit=_angka(baris.get("jml_kredit")) or _angka(baris.get("jml_debet")),  # [FIX] NaN-safe
                status="draft",
                sumber_placeholder=placeholder,
                voucher=voucher_per_baris[i],
                periode_voucher=periode_per_baris[i],
                baris_asal=baris.get("baris"),
                kode_bank=(_kode_bank_dari_nama_lokal(baris.get("bank") or "BANK") if pakai_voucher else None),
                transaction_hash=hash_baris,
            ))
            count += 1
        session.bulk_save_objects(objek_baru)
        session.commit()
        return count
    except Exception as e:
        if session:
            session.rollback()
        print(f"Error tarik draf jurnal ke posting: {e}")
        return 0
    finally:
        if session:
            session.close()


def daftar_jurnal_posting(client_id: int, status: Optional[str] = "draft",
                           limit: int = 500) -> List[Dict[str, Any]]:
    """Ambil baris jurnal_posting client (default: yang masih 'draft', perlu direview)."""
    session = SessionLocal()
    try:
        query = session.query(JurnalPosting).filter(JurnalPosting.client_id == client_id)
        if status:
            query = query.filter(JurnalPosting.status == status)
        query = query.order_by(JurnalPosting.dibuat_at.desc()).limit(limit)
        hasil = [
            {
                "id": j.id, "hasil_id": j.hasil_id, "jenis_dokumen": j.jenis_dokumen,
                "tanggal": j.tanggal, "keterangan": j.keterangan,
                # [BARU - fix GL 2025] disertakan supaya UI review bisa
                # menampilkan & mengisi nilai saat ini sebelum akuntan
                # posting (lihat konfirmasi_posting_jurnal()).
                "lawan_transaksi": j.lawan_transaksi, "no_dokumen": j.no_dokumen,
                "project_unit": j.project_unit, "jatuh_tempo": j.jatuh_tempo,
                "no_akun_debet": j.no_akun_debet, "nama_akun_debet": j.nama_akun_debet,
                "jml_debet": j.jml_debet,
                "no_akun_kredit": j.no_akun_kredit, "nama_akun_kredit": j.nama_akun_kredit,
                "jml_kredit": j.jml_kredit,
                "status": j.status, "sumber_placeholder": j.sumber_placeholder,
                "voucher": j.voucher, "periode_voucher": j.periode_voucher,
                "diposting_oleh": j.diposting_oleh,
                "diposting_at": j.diposting_at.isoformat() if j.diposting_at else None,
                "dibuat_at": j.dibuat_at.isoformat() if j.dibuat_at else None,
            }
            for j in query.all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar jurnal posting: {e}")
        return []
    finally:
        session.close()


def konfirmasi_posting_jurnal(posting_id: int, user: str,
                               no_akun_debet: Optional[str] = None, nama_akun_debet: Optional[str] = None,
                               no_akun_kredit: Optional[str] = None, nama_akun_kredit: Optional[str] = None,
                               tanggal: Optional[str] = None, keterangan: Optional[str] = None,
                               lawan_transaksi: Optional[str] = None, no_dokumen: Optional[str] = None,
                               project_unit: Optional[str] = None, jatuh_tempo: Optional[str] = None) -> bool:
    """
    Konfirmasi satu baris jurnal_posting jadi 'terposting' -- dipanggil
    saat akuntan menekan tombol "Posting" di UI review. Kalau akun
    debet/kredit masih placeholder, akuntan WAJIB mengisi no_akun_debet/
    no_akun_kredit yang sebenarnya lewat parameter ini (endpoint di
    main.py yang menegakkan validasi ini, fungsi ini murni menyimpan).

    [BARU - fix GL 2025] lawan_transaksi/no_dokumen/project_unit/
    jatuh_tempo ditambahkan di sini -- sebelumnya kolom-kolom ini (kalau
    ada) tidak pernah bisa diisi lewat jalur manapun, jadi selalu kosong
    di sheet GL 2025 hasil export walau kolomnya sudah ditulis di Excel.
    """
    session = SessionLocal()
    try:
        j = session.query(JurnalPosting).filter(JurnalPosting.id == posting_id).first()
        if j is None:
            return False

        if no_akun_debet:
            j.no_akun_debet = no_akun_debet
        if nama_akun_debet:
            j.nama_akun_debet = nama_akun_debet
        if no_akun_kredit:
            j.no_akun_kredit = no_akun_kredit
        if nama_akun_kredit:
            j.nama_akun_kredit = nama_akun_kredit
        if tanggal:
            j.tanggal = tanggal
        if keterangan:
            j.keterangan = keterangan
        if lawan_transaksi:
            j.lawan_transaksi = lawan_transaksi
        if no_dokumen:
            j.no_dokumen = no_dokumen
        if project_unit:
            j.project_unit = project_unit
        if jatuh_tempo:
            j.jatuh_tempo = jatuh_tempo

        j.status = "terposting"
        j.sumber_placeholder = ("/" in j.no_akun_debet) or ("/" in j.no_akun_kredit)
        j.diposting_oleh = user
        j.diposting_at = datetime.now()

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error konfirmasi posting jurnal: {e}")
        return False
    finally:
        session.close()


def tolak_posting_jurnal(posting_id: int, user: str, alasan: Optional[str] = None) -> bool:
    """Tandai satu baris jurnal_posting sebagai 'ditolak' (mis. duplikat/salah deteksi)."""
    session = SessionLocal()
    try:
        j = session.query(JurnalPosting).filter(JurnalPosting.id == posting_id).first()
        if j is None:
            return False
        j.status = "ditolak"
        j.diposting_oleh = user
        j.diposting_at = datetime.now()
        if alasan:
            j.keterangan = f"{j.keterangan or ''} [Ditolak: {alasan}]".strip()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tolak posting jurnal: {e}")
        return False
    finally:
        session.close()


def konfirmasi_posting_massal(client_id: int, hasil_id: int, user: str) -> Dict[str, int]:
    """
    [BARU - Prioritas #7] Konfirmasi SEMUA baris jurnal_posting berstatus
    'draft' milik SATU hasil_id (= satu file upload) sekaligus, jadi
    'terposting'. Dibutuhkan karena satu rekening koran bisa berisi
    ratusan/ribuan baris -- endpoint konfirmasi per-baris yang sudah ada
    (konfirmasi_posting_jurnal) tetap dipertahankan utk koreksi manual
    1 baris, tapi tidak realistis dipakai satu-satu utk seluruh file.

    HANYA baris yang TIDAK placeholder (sumber_placeholder=False) yang
    ikut diposting massal -- baris dgn akun placeholder (butuh keputusan
    manusia akun lawannya apa) sengaja DILEWATI dan tetap 'draft', supaya
    tidak ada asumsi otomatis "akun sembarang asal keburu posting".
    Baris placeholder itu tetap harus dikonfirmasi satu-satu lewat
    konfirmasi_posting_jurnal() setelah akuntan mengisi akun yang benar.

    Return: {"diposting": jumlah baris yg berhasil diposting,
             "dilewati_placeholder": jumlah baris draft yg dilewati krn masih placeholder}
    """
    session = SessionLocal()
    try:
        rows = session.query(JurnalPosting).filter(
            JurnalPosting.client_id == client_id,
            JurnalPosting.hasil_id == hasil_id,
            JurnalPosting.status == "draft",
        ).all()

        diposting = 0
        dilewati = 0
        sekarang = datetime.now()
        for j in rows:
            if j.sumber_placeholder:
                dilewati += 1
                continue
            j.status = "terposting"
            j.diposting_oleh = user
            j.diposting_at = sekarang
            diposting += 1

        session.commit()
        return {"diposting": diposting, "dilewati_placeholder": dilewati}
    except Exception as e:
        session.rollback()
        print(f"Error konfirmasi posting massal: {e}")
        return {"diposting": 0, "dilewati_placeholder": 0}
    finally:
        session.close()


def ambil_jurnal_posting_by_hasil(client_id: int, hasil_id: int) -> List[Dict[str, Any]]:
    """
    [BARU - Prioritas #7] Ambil SEMUA baris jurnal_posting utk SATU
    hasil_id, apa pun statusnya (draft/terposting/ditolak) -- dipakai
    endpoint export-format-akuntan utk menggabungkan voucher & status
    posting terkini ke df_hasil yang dibaca ulang dari tabel 'hasil'.

    Key pencocokan ke df_hasil: kolom "baris_asal" (posisi baris asli,
    1-based, sama dengan field "baris" di draf_jurnal / index+1 di
    df_hasil) -- lihat catatan di kolom JurnalPosting.baris_asal kenapa
    ini dipakai, bukan pencocokan berbasis konten.
    """
    session = SessionLocal()
    try:
        rows = session.query(JurnalPosting).filter(
            JurnalPosting.client_id == client_id, JurnalPosting.hasil_id == hasil_id,
        ).all()
        hasil = [
            {
                "baris_asal": j.baris_asal,
                "voucher": j.voucher, "status": j.status,
                "sumber_placeholder": j.sumber_placeholder,
            }
            for j in rows
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil jurnal posting by hasil: {e}")
        return []
    finally:
        session.close()


def ambil_jurnal_terposting(client_id: int, tanggal_mulai: Optional[str] = None,
                             tanggal_akhir: Optional[str] = None,
                             hanya_terposting: bool = True) -> List[Dict[str, Any]]:
    """
    Ambil baris jurnal milik client -- INI sumber data resmi untuk
    modules/laporan_keuangan.py menyusun 5 Laporan Keuangan Standar.
    Filter tanggal dilakukan di Python (bukan query SQL) karena kolom
    'tanggal' disimpan sbg string bebas format supaya fleksibel menerima
    berbagai format tanggal dari 15 jenis dokumen sumber.

    [BARU] hanya_terposting: bool = True (default -- dipertahankan untuk
    kompatibilitas pemanggil lama/lain yang mungkin masih sengaja mau
    filter ketat, tapi SEMUA endpoint generate laporan yang sudah ada
    (export-14-sheet, laporan-keuangan/generate, pph-badan/generate,
    laporan-bulanan/generate) sekarang memanggil dengan hanya_terposting=
    False secara eksplisit).

    Kalau False: ambil status 'draft' MAUPUN 'terposting' sekaligus
    (status 'ditolak' tetap SELALU dikecualikan -- baris yang sudah
    ditandai duplikat/salah deteksi tidak boleh ikut ke laporan apa pun,
    terlepas dari flag ini). Ini menghapus kebutuhan akuntan
    mengonfirmasi-posting manual dulu sebelum data bisa masuk ke laporan
    keuangan apa pun -- baris yang akunnya masih placeholder tetap ikut
    apa adanya, ditandai lewat field "keterangan_perlu_dikoreksi" per akun
    (lihat hitung_saldo_per_akun() di laporan_keuangan.py, dan kolom
    "Status Validasi" di sheet GL <tahun> untuk versi per-baris di
    accounting_export.py), bukan lewat filter status database seperti
    sebelumnya.
    """
    session = SessionLocal()
    try:
        query = session.query(JurnalPosting).filter(JurnalPosting.client_id == client_id)
        if hanya_terposting:
            query = query.filter(JurnalPosting.status == "terposting")
        else:
            query = query.filter(JurnalPosting.status != "ditolak")
        rows = query.order_by(JurnalPosting.tanggal).all()

        hasil = [
            {
                "id": j.id, "jenis_dokumen": j.jenis_dokumen, "tanggal": j.tanggal,
                "keterangan": j.keterangan,
                # [BARU - export 14 sheet] disertakan supaya sheet "GL 2025"
                # bisa menampilkan lawan transaksi per baris -- kolomnya
                # sudah ada di model JurnalPosting sejak lama tapi belum
                # pernah diikutkan di sini.
                "lawan_transaksi": j.lawan_transaksi,
                # [BARU - fix GL 2025] no_dokumen/project_unit/jatuh_tempo
                # sebelumnya tidak ada di model sama sekali -- sheet GL
                # 2025 hasil export selalu kosong/salah utk kolom-kolom
                # ini (No. Dokumen & Invoice/Referensi malah salah pakai
                # nomor voucher). diposting_oleh disertakan utk kolom
                # "Disiapkan Oleh", status utk kolom "Status".
                "no_dokumen": j.no_dokumen, "project_unit": j.project_unit,
                "jatuh_tempo": j.jatuh_tempo, "diposting_oleh": j.diposting_oleh,
                "status": j.status,
                # [BARU - hanya_terposting=False] dibutuhkan accounting_export.py
                # untuk mengisi kolom "Status Validasi" per baris di sheet
                # GL <tahun> -- sebelumnya field ini tidak pernah ikut
                # dikembalikan fungsi ini sama sekali (cuma dipakai internal
                # di db_client.py sendiri lewat konfirmasi_posting_massal()).
                "sumber_placeholder": j.sumber_placeholder,
                "no_akun_debet": j.no_akun_debet, "nama_akun_debet": j.nama_akun_debet,
                "jml_debet": j.jml_debet,
                "no_akun_kredit": j.no_akun_kredit, "nama_akun_kredit": j.nama_akun_kredit,
                "jml_kredit": j.jml_kredit,
                "voucher": j.voucher,
            }
            for j in rows
        ]

        if tanggal_mulai or tanggal_akhir:
            import pandas as _pd
            def _dalam_rentang(tgl_str):
                t = _pd.to_datetime(tgl_str, errors="coerce")
                if _pd.isna(t):
                    return True  # tanggal tidak jelas -> tetap ikutkan, jangan diam-diam dibuang
                if tanggal_mulai and t < _pd.to_datetime(tanggal_mulai):
                    return False
                if tanggal_akhir and t > _pd.to_datetime(tanggal_akhir):
                    return False
                return True
            hasil = [h for h in hasil if _dalam_rentang(h["tanggal"])]

        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil jurnal terposting: {e}")
        return []
    finally:
        session.close()


def hitung_jurnal_perlu_posting(client_id: int) -> int:
    """Jumlah baris jurnal_posting client yang masih berstatus 'draft' (badge notifikasi di UI)."""
    session = SessionLocal()
    try:
        n = session.query(JurnalPosting).filter(
            JurnalPosting.client_id == client_id, JurnalPosting.status == "draft"
        ).count()
        return n
    except Exception as e:
        session.rollback()
        print(f"Error hitung jurnal perlu posting: {e}")
        return 0


# ============================================================
# [BARU] FUNGSI SNAPSHOT LAPORAN KEUANGAN
# ============================================================
    finally:
        session.close()

def simpan_laporan_keuangan(client_id: int, periode: str, data: Dict[str, Any],
                             dibuat_oleh: Optional[str] = None,
                             tanggal_mulai: Optional[str] = None,
                             tanggal_akhir: Optional[str] = None) -> Optional[int]:
    """Simpan snapshot 5 Laporan Keuangan Standar (hasil generate) untuk satu periode."""
    session = SessionLocal()
    try:
        lap = LaporanKeuangan(
            client_id=client_id, periode=periode,
            tanggal_mulai=tanggal_mulai, tanggal_akhir=tanggal_akhir,
            data=json.dumps(data, default=str, ensure_ascii=False),
            dibuat_oleh=dibuat_oleh,
        )
        session.add(lap)
        session.commit()
        lap_id = lap.id
        return lap_id
    except Exception as e:
        session.rollback()
        print(f"Error simpan laporan keuangan: {e}")
        return None
    finally:
        session.close()


def ambil_laporan_keuangan_terbaru(client_id: int, periode: str) -> Optional[Dict[str, Any]]:
    """Ambil snapshot laporan keuangan TERBARU untuk satu client+periode (kalau pernah di-generate ulang)."""
    session = SessionLocal()
    try:
        lap = (
            session.query(LaporanKeuangan)
            .filter(LaporanKeuangan.client_id == client_id, LaporanKeuangan.periode == periode)
            .order_by(LaporanKeuangan.dibuat_at.desc())
            .first()
        )
        if lap is None:
            return None
        hasil = {
            "id": lap.id, "periode": lap.periode,
            "tanggal_mulai": lap.tanggal_mulai, "tanggal_akhir": lap.tanggal_akhir,
            "data": json.loads(lap.data), "dibuat_oleh": lap.dibuat_oleh,
            "dibuat_at": lap.dibuat_at.isoformat() if lap.dibuat_at else None,
        }
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil laporan keuangan terbaru: {e}")
        return None
    finally:
        session.close()


def daftar_riwayat_laporan_keuangan(client_id: int, periode: Optional[str] = None) -> List[Dict[str, Any]]:
    """Daftar semua snapshot laporan keuangan client (histori tiap kali di-generate ulang)."""
    session = SessionLocal()
    try:
        query = session.query(LaporanKeuangan).filter(LaporanKeuangan.client_id == client_id)
        if periode:
            query = query.filter(LaporanKeuangan.periode == periode)
        query = query.order_by(LaporanKeuangan.dibuat_at.desc())
        hasil = [
            {
                "id": lap.id, "periode": lap.periode,
                "tanggal_mulai": lap.tanggal_mulai, "tanggal_akhir": lap.tanggal_akhir,
                "dibuat_oleh": lap.dibuat_oleh,
                "dibuat_at": lap.dibuat_at.isoformat() if lap.dibuat_at else None,
            }
            for lap in query.all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error daftar riwayat laporan keuangan: {e}")
        return []
    finally:
        session.close()


# [DIKEMBALIKAN] Fungsi ini sempat hilang dari db_client.py -- dibutuhkan
# oleh cache export 18-sheet di main.py (lihat _kunci_cache_export_18_sheet
# / _ambil_cache_export_18_sheet / _simpan_cache_export_18_sheet di sana).
# Docstring di bawah direkonstruksi ulang (bukan salinan kata-per-kata dari
# versi asli), tapi logic hash-nya persis sama dengan yang sudah pernah
# dipakai sebelumnya -- tolong dicek ulang sekali kalau masih ada salinan
# db_client.py versi lama untuk memastikan tidak ada penyesuaian lanjutan
# yang ikut hilang.
def hitung_signature_data_laporan(client_id: int, tahun: Optional[int] = None) -> str:
    """
    Hitung signature ringan (hash) dari data yang memengaruhi laporan
    client ini -- dipakai buat validasi cache-hit di endpoint export
    18-sheet (main.py). Sumbernya: jumlah + timestamp terakhir
    JurnalPosting (dibuat & diposting), jumlah + timestamp terakhir
    perubahan COA, dan id laporan keuangan terbaru untuk tahun terkait.
    Selama signature-nya sama dengan yang dipakai saat hasil terakhir
    dihitung, data dijamin belum berubah dan cache aman dipakai.
    """
    session = SessionLocal()
    try:
        q_jurnal = session.query(
            func.count(JurnalPosting.id),
            func.max(JurnalPosting.dibuat_at),
            func.max(JurnalPosting.diposting_at),
        ).filter(JurnalPosting.client_id == client_id)
        if tahun:
            q_jurnal = q_jurnal.filter(JurnalPosting.tanggal.like(f"{tahun}-%"))
        jml_jurnal, max_dibuat, max_diposting = q_jurnal.one()

        jml_coa, max_coa = session.query(
            func.count(Coa.id), func.max(Coa.diperbarui_at),
        ).filter(Coa.client_id == client_id).one()

        lap_terbaru = None
        if tahun:
            lap_terbaru = (
                session.query(func.max(LaporanKeuangan.id))
                .filter(
                    LaporanKeuangan.client_id == client_id,
                    LaporanKeuangan.periode == str(tahun),
                )
                .scalar()
            )

        bahan = (
            f"{jml_jurnal}|{max_dibuat}|{max_diposting}|"
            f"{jml_coa}|{max_coa}|{lap_terbaru}"
        )
        return hashlib.sha256(bahan.encode("utf-8")).hexdigest()[:16]
    except Exception as e:
        print(f"Error hitung signature data laporan: {e}")
        # [PENTING] Kalau gagal hitung signature, JANGAN diam-diam anggap
        # "tidak berubah" -- kembalikan signature unik (selalu beda) tiap
        # kali dipanggil, supaya pemanggil (cache di main.py) selalu
        # dianggap cache-miss dan hitung ulang dari nol. Lebih baik lambat
        # (fallback aman) daripada cepat tapi bisa menyajikan laporan basi.
        return f"error-{datetime.now().timestamp()}"
    finally:
        session.close()


# ============================================================
# [BARU - export 14 sheet] RIWAYAT SALDO BULANAN
# ============================================================
# Snapshot saldo per akun per bulan, dipakai sheet "Ringkasan" untuk
# tren Piutang/Utang per bulan. Diisi tiap kali laporan bulanan
# digenerate (lihat endpoint generate laporan bulanan di main.py).

def simpan_riwayat_saldo_bulanan(
    client_id: int,
    saldo_per_akun: Dict[str, Dict[str, Any]],
    tahun: int,
    bulan: int,
) -> int:
    """
    Simpan/perbarui snapshot saldo per akun untuk 1 bulan. Idempoten:
    kombinasi (client_id, no_akun, tahun, bulan) di-UPSERT, bukan
    ditambah baru tiap kali dipanggil ulang.

    [FIX -- POINT 4] Sebelumnya loop ini melakukan 1 SELECT + 1
    INSERT/UPDATE per akun (N+1) -- untuk COA besar (ratusan akun),
    dipanggil 12x per generate laporan bulanan, ini ratusan-ribuan
    round-trip DB per generate. Diganti jadi 1 statement bulk upsert
    lewat _bulk_upsert() (ON CONFLICT DO UPDATE, cocok dengan
    UniqueConstraint uq_riwayat_saldo_client_akun_bulan di model ini).
    """
    if not saldo_per_akun:
        return 0
    session = SessionLocal()
    try:
        rows = [
            {
                "client_id": client_id,
                "no_akun": str(no_akun),
                "nama_akun": info.get("nama_akun", no_akun),
                "kategori": info.get("kategori"),
                "sub_kategori": info.get("sub_kategori"),
                "tahun": tahun,
                "bulan": bulan,
                "saldo_akhir": _angka(info.get("saldo_akhir", 0)),
            }
            for no_akun, info in saldo_per_akun.items()
        ]
        count = _bulk_upsert(
            session, RiwayatSaldoBulanan, rows,
            index_elements=["client_id", "no_akun", "tahun", "bulan"],
            update_cols=["nama_akun", "kategori", "sub_kategori", "saldo_akhir"],
        )
        session.commit()
        return count
    except Exception as e:
        session.rollback()
        print(f"Error simpan riwayat saldo bulanan: {e}")
        return 0
    finally:
        session.close()


def ambil_riwayat_saldo_bulanan(client_id: int, no_akun: str, tahun: int) -> List[Dict[str, Any]]:
    """Ambil saldo per bulan untuk 1 akun dalam 1 tahun."""
    session = SessionLocal()
    try:
        rows = session.query(RiwayatSaldoBulanan).filter(
            RiwayatSaldoBulanan.client_id == client_id,
            RiwayatSaldoBulanan.no_akun == str(no_akun),
            RiwayatSaldoBulanan.tahun == tahun,
        ).order_by(RiwayatSaldoBulanan.bulan).all()
        hasil = [
            {"bulan": r.bulan, "saldo_akhir": r.saldo_akhir,
             "nama_akun": r.nama_akun, "kategori": r.kategori}
            for r in rows
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil riwayat saldo bulanan: {e}")
        return []
    finally:
        session.close()


def ambil_riwayat_saldo_bulanan_client(
    client_id: int, tahun: int, no_akun: Optional[str] = None, kategori: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Ambil riwayat saldo bulanan untuk seluruh client dalam 1 tahun."""
    session = SessionLocal()
    try:
        query = session.query(RiwayatSaldoBulanan).filter(
            RiwayatSaldoBulanan.client_id == client_id,
            RiwayatSaldoBulanan.tahun == tahun,
        )
        if no_akun:
            query = query.filter(RiwayatSaldoBulanan.no_akun == str(no_akun))
        if kategori:
            query = query.filter(RiwayatSaldoBulanan.kategori == kategori)
        query = query.order_by(RiwayatSaldoBulanan.no_akun, RiwayatSaldoBulanan.bulan)
        hasil = [
            {
                "no_akun": r.no_akun, "nama_akun": r.nama_akun, "kategori": r.kategori,
                "sub_kategori": r.sub_kategori, "bulan": r.bulan, "saldo_akhir": r.saldo_akhir,
            }
            for r in query.all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil riwayat saldo bulanan client: {e}")
        return []
    finally:
        session.close()


def ambil_riwayat_saldo_bulanan_akun_tren(
    client_id: int, tahun: int, pola_no_akun: Optional[str] = None, kategori: Optional[str] = None,
) -> Dict[str, Dict[str, Any]]:
    """Ambil tren saldo bulanan dikelompokkan per akun (untuk grafik tren)."""
    session = SessionLocal()
    try:
        query = session.query(RiwayatSaldoBulanan).filter(
            RiwayatSaldoBulanan.client_id == client_id,
            RiwayatSaldoBulanan.tahun == tahun,
        )
        if pola_no_akun:
            query = query.filter(RiwayatSaldoBulanan.no_akun.like(pola_no_akun))
        if kategori:
            query = query.filter(RiwayatSaldoBulanan.kategori == kategori)
        query = query.order_by(RiwayatSaldoBulanan.no_akun, RiwayatSaldoBulanan.bulan)

        hasil: Dict[str, Dict[str, Any]] = {}
        for r in query.all():
            if r.no_akun not in hasil:
                hasil[r.no_akun] = {"nama_akun": r.nama_akun, "kategori": r.kategori, "data": []}
            hasil[r.no_akun]["data"].append({"bulan": r.bulan, "saldo_akhir": r.saldo_akhir})
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil riwayat saldo bulanan tren: {e}")
        return {}
    finally:
        session.close()