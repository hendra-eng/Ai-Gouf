# db_client.py - Kode database client yang benar
"""
db_client.py
============
Client database untuk menyimpan hasil analisis per client.
"""

import hashlib
import json
import os
import uuid
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict, Any

import pandas as pd
from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String, DateTime,
    Text, Float, Boolean, ForeignKey, ForeignKeyConstraint, text, UniqueConstraint, Index,
    Numeric, Date, func, JSON,  # dipakai hitung_signature_data_laporan() (MAX/COUNT agregat)
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
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

# [FIX -- Supabase dihapus] Sebelumnya create_engine() tidak punya
# connect_timeout sama sekali. Kalau DATABASE_URL kebetulan masih
# menunjuk ke host Postgres/Supabase yang sudah tidak ada (mis. project
# Supabase sudah dihapus tapi .env belum sempat diupdate), SETIAP satu
# panggilan dbc.xxx() (ambil_client, simpan_hasil, log_audit, dst -- ada
# belasan per upload 1 file PDF, lihat _proses_dan_simpan_satu_file di
# main.py) akan mencoba connect & menggantung lama sebelum gagal, lalu
# panggilan berikutnya menggantung lagi -- inilah yang membuat proses
# file PDF terasa "berulang-ulang dan sangat lama". connect_timeout di
# bawah ini membuat percobaan koneksi ke host yang tidak bisa dihubungi
# gagal dalam hitungan detik, bukan menggantung tanpa batas. Hanya
# berlaku utk dialect postgresql (opsi ini tidak dikenal oleh driver
# sqlite3, jadi harus dicabang berdasar engine yg akan dibuat).
_connect_args = {"connect_timeout": 5} if DATABASE_URL.startswith("postgresql") else {}

engine = create_engine(
    DATABASE_URL, echo=False, pool_pre_ping=True, pool_recycle=280,
    connect_args=_connect_args,
)
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
    """
    [DIUBAH] Tabel `clients` di Supabase ternyata sudah dibuat manual lebih
    dulu dengan skema data legal perusahaan Indonesia (NIB, status PKP,
    klasifikasi lapangan usaha/KLU, dst) -- BUKAN skema generik lama di
    bawah. Supaya SEMUA fungsi lain di file ini (tambah_client,
    daftar_client, ambil_client, dst) dan semua endpoint di main.py TETAP
    JALAN TANPA DIUBAH, nama atribut Python di sini sengaja DIPERTAHANKAN
    sama seperti sebelumnya (nama, nomor_wa, industry, dst) -- yang
    berubah HANYA nama kolom fisik di database (argumen pertama Column()),
    lewat fitur aliasing bawaan SQLAlchemy.

    Kolom `lokasi` (skema lama) dipetakan ke `kota` (skema baru) sebagai
    padanan paling dekat -- kalau nanti butuh provinsi/kode_pos juga,
    tambahkan atribut baru terpisah (lihat kolom tambahan di bawah).

    Kolom `tipe` (skema lama -- dulu berarti jenis LAYANAN "accounting"
    vs "pajak") SENGAJA TIDAK dipetakan ke `tipe_badan_usaha` (skema baru
    -- berarti bentuk BADAN USAHA "PT"/"CV", konsep yang beda sama
    sekali). Untuk sementara `tipe` tidak lagi tersimpan ke database
    (nilainya cuma default di sisi Python) -- filter dbc.daftar_client(
    tipe=...) jadi tidak actually memfilter apa pun sampai kolom ini
    diputuskan mau diisi dari mana. Kalau nanti dibutuhkan lagi, tambah
    kolom baru khusus (mis. `tipe_layanan`) di tabel `clients`.

    Kolom `status` (skema lama -- berarti status KESEHATAN finansial
    client: Healthy/Stable/Attention Required/Critical, dipakai badge
    warna di halaman Clients) BEDA KONSEP dari `status` di skema baru
    (berarti status AKTIF/tidak-nya kerjasama, nilainya "aktif"). Supaya
    tidak saling menimpa, kolom fisik "status" TIDAK dipetakan ke atribut
    `status` lama -- lihat `status_kerjasama` di bawah untuk versi barunya.
    Atribut `status` (health) untuk sementara TIDAK tersimpan ke database
    (selalu None / fallback "Stable" di frontend) sampai dihitung otomatis
    dari data keuangan asli (health score), sesuai catatan yang sudah ada
    di clientsStore.tsx.
    """
    # [DIUBAH -- migrasi ke management_clients] Tabel `clients` (PK integer)
    # sudah digantikan total oleh `management_clients` (PK uuid), selaras
    # dengan `management_users`. Nama atribut Python di sini DIPERTAHANKAN
    # sama seperti sebelumnya (nama, nomor_wa, industry, dst) lewat
    # aliasing kolom, supaya kode lain (tambah_client, daftar_client,
    # endpoint main.py, dst) tetap jalan -- yang beda cuma nama tabel/
    # kolom fisik dan tipe primary key (uuid, bukan integer lagi). Lihat
    # migration_uuid_client_id.sql untuk migrasi datanya.
    __tablename__ = "management_clients"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_code = Column(String(50), nullable=True)
    nama = Column("nama_client", String(255), nullable=False)
    lokasi = Column("kota", String(255), nullable=True)
    # [DIUBAH] Tidak lagi kolom fisik di DB -- lihat docstring di atas.
    tipe = "accounting"
    nomor_wa = Column("no_handphone", String(255), nullable=True)
    email = Column(String(255), nullable=True)
    industry = Column(String(255), nullable=True)
    # [DIUBAH] Health status (UI) TIDAK dipetakan ke kolom fisik "status"
    # -- lihat docstring. Tetap ada sebagai atribut Python (selalu None)
    # supaya kode lain yang baca client.status tidak error.
    status = None
    # [DIUBAH] akuntan_penanggung_jawab sekarang uuid, merujuk ke
    # management_users.id_user (dulu varchar nama bebas).
    assigned_accountant = Column("akuntan_penanggung_jawab", PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    contact_name = Column("nama_pic", String(255), nullable=True)
    npwp = Column(String(20), nullable=True)
    address = Column("alamat", Text, nullable=True)
    dibuat_at = Column("created_at", DateTime(timezone=True), server_default=text("now()"), nullable=True)
    diperbarui_at = Column("edited_at", DateTime(timezone=True), nullable=True)

    # [BARU] Kolom tambahan yang sudah ada di tabel Supabase, belum
    # dipakai UI lama tapi tersedia untuk ditampilkan belakangan.
    nama_panggilan = None  # [DIHAPUS] tidak ada lagi di management_clients
    tipe_badan_usaha = Column(String(255), nullable=True)
    nomor_akta_nib = Column(String(255), nullable=True)
    status_pkp = Column(Boolean, nullable=True)
    klasifikasi_lapangan_usaha = Column(String(255), nullable=True)
    no_telepon = Column(String(255), nullable=True)
    jabatan_pic = Column(String(255), nullable=True)
    provinsi = Column(String(255), nullable=True)
    kode_pos = Column(String(255), nullable=True)
    tahun_buku_mulai = Column(String(10), nullable=True)
    mata_uang_default = Column(String(10), nullable=True)
    # Status AKTIF/tidak-nya kerjasama (skema baru) -- beda dari health
    # status "status" (lama) yang sengaja tidak dipetakan, lihat docstring.
    status_kerjasama = Column("status", String(10), nullable=True)
    tanggal_mulai_kerjasama = Column(DateTime, nullable=True)
    # [DIUBAH] created_by/edited_by/deleted_by sekarang uuid -> management_users
    dibuat_oleh = Column("created_by", PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    diperbarui_oleh = Column("edited_by", PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    # [BARU] hanya dipakai sementara untuk backfill migrasi -- lihat
    # migration_uuid_client_id.sql (old_client_id = id integer lama).
    old_client_id = Column(Integer, nullable=True)

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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    # [FIX] JurnalPosting punya ForeignKeyConstraint gabungan ke
    # (hasil.id, hasil.client_id) -- Postgres/Supabase MEWAJIBKAN ada
    # UNIQUE constraint persis di kombinasi kolom itu di tabel yang
    # dirujuk, kalau tidak create_all() gagal dgn error "there is no
    # unique constraint matching given keys for referenced table hasil"
    # dan (krn create_all satu transaksi) SEMUA tabel lain ikut batal
    # dibuat, termasuk 'clients'. id sudah unique sendiri (primary key),
    # jadi constraint gabungan ini tidak mengubah perilaku data sama
    # sekali -- cuma memenuhi syarat teknis Postgres utk FK gabungan itu.
    __table_args__ = (
        UniqueConstraint("id", "client_id", name="uq_hasil_id_client_id"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    __table_args__ = {"schema": "app"}

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    # [BARU - filter Cabang Financial Overview] Tag cabang/lokasi akun ini,
    # nullable & opsional (spt segment/arus_kas di atas) -- SENGAJA diisi
    # per AKUN (bukan per baris jurnal), supaya tidak menambah langkah
    # manual apa pun ke alur upload/posting jurnal sehari-hari. Sekali akun
    # ditandai (mis. "Kas - Jakarta" -> cabang="Jakarta"), SEMUA jurnal yang
    # menyentuh akun itu otomatis ikut cabang tsb tanpa input tambahan.
    # None/kosong = akun umum/HO, dianggap MILIK SEMUA cabang (tidak
    # disaring hilang) supaya angka tidak "hilang" sebelum COA ditag.
    # Dipakai oleh laporan_keuangan.py::filter_jurnal_per_cabang() utk
    # endpoint kpi-bento (lihat main.py). Nilai bebas teks, FE saat ini
    # pakai "Jakarta"/"Surabaya" (lihat OverviewContent.tsx).
    cabang = Column(String(100), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    # [BARU - persist edit/posting halaman Transaksi frontend] Sebelumnya
    # status pembayaran ke vendor (field paymentStatus/dueDate/paidAmount di
    # Transaction frontend, lihat src/app/transactions/components/
    # transactionData.ts) TIDAK PERNAH tersimpan ke database sama sekali --
    # murni state React lokal di halaman Transaksi/Expense, hilang begitu
    # halaman di-refresh. jatuh_tempo di atas sudah ada (dipetakan ke
    # dueDate), tapi payment_status & paid_amount belum ada kolomnya sampai
    # sekarang. Lihat scripts/migrate_add_kolom_payment_status.py untuk
    # ALTER TABLE pada database yang sudah ada.
    payment_status = Column(String(20), nullable=True)  # 'Belum Dibayar'/'Sebagian Dibayar'/'Lunas', NULL = belum pernah diisi
    paid_amount = Column(Float, nullable=True)

    client = relationship("Client")



# ============================================================
# ACCOUNTING CORE V2 — additive, tidak mengganti tabel legacy
# ============================================================

class StandardAccount(Base):
    """Taxonomy akun universal sistem. Nomor/nama akun client tetap di tabel Coa."""
    __tablename__ = "standard_accounts"

    id = Column(Integer, primary_key=True)
    standard_code = Column(String(100), unique=True, nullable=False, index=True)
    standard_name = Column(String(200), nullable=False)
    account_class = Column(String(30), nullable=False)  # ASET/LIABILITAS/EKUITAS/PENDAPATAN/BEBAN
    account_subtype = Column(String(100), nullable=True)
    normal_balance = Column(String(10), nullable=True)
    fs_statement = Column(String(30), nullable=True)  # BALANCE_SHEET / PROFIT_LOSS
    fs_group = Column(String(100), nullable=True)
    fs_line = Column(String(150), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class AccountRole(Base):
    """Semantic role yang dipakai posting engine, bukan nomor akun hard-coded."""
    __tablename__ = "account_roles"

    id = Column(Integer, primary_key=True)
    role_code = Column(String(80), unique=True, nullable=False, index=True)
    role_name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class CoaStandardMapping(Base):
    """Mapping COA asli client ke StandardAccount."""
    __tablename__ = "coa_standard_mapping"
    __table_args__ = (
        UniqueConstraint("client_id", "coa_id", name="uq_coa_standard_mapping_client_coa"),
        Index("idx_coa_standard_mapping_client", "client_id"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    coa_id = Column(Integer, ForeignKey("app.coa.id"), nullable=False)
    standard_account_id = Column(Integer, ForeignKey("standard_accounts.id"), nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    mapped_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class CompanyAccountRole(Base):
    """Mapping AccountRole universal ke akun aktual masing-masing company/client."""
    __tablename__ = "company_account_roles"
    __table_args__ = (
        UniqueConstraint("client_id", "role_id", name="uq_company_account_role"),
        Index("idx_company_account_roles_client", "client_id"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("account_roles.id"), nullable=False)
    coa_id = Column(Integer, ForeignKey("app.coa.id"), nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    assigned_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class JournalEntry(Base):
    """Header jurnal resmi. Satu entry dapat memiliki banyak JournalLine."""
    __tablename__ = "journal_entries"
    __table_args__ = (
        UniqueConstraint("client_id", "journal_no", name="uq_journal_entry_client_no"),
        UniqueConstraint("client_id", "legacy_posting_id", name="uq_journal_entry_legacy_posting"),
        Index("idx_journal_entry_client_status_date", "client_id", "status", "posting_date"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    journal_no = Column(String(80), nullable=False)
    source_module = Column(String(50), nullable=False, default="GENERAL_JOURNAL")
    source_transaction_id = Column(String(100), nullable=True)
    legacy_posting_id = Column(Integer, ForeignKey("jurnal_posting.id"), nullable=True)
    document_date = Column(Date, nullable=True)
    posting_date = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    reference = Column(String(150), nullable=True)
    status = Column(String(20), nullable=False, default="DRAFT")
    currency = Column(String(10), nullable=False, default="IDR")
    exchange_rate = Column(Numeric(20, 6), nullable=False, default=1)
    created_by = Column(String(100), nullable=True)
    approved_by = Column(String(100), nullable=True)
    posted_by = Column(String(100), nullable=True)
    posted_at = Column(DateTime, nullable=True)
    reversed_from_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class JournalLine(Base):
    """Baris debit/kredit resmi. Nilai uang memakai NUMERIC, bukan Float."""
    __tablename__ = "journal_lines"
    __table_args__ = (
        UniqueConstraint("journal_entry_id", "line_no", name="uq_journal_line_entry_no"),
        Index("idx_journal_line_client_account", "client_id", "account_code"),
        {"schema": "app"},
    )

    id = Column(Integer, primary_key=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    line_no = Column(Integer, nullable=False)
    coa_id = Column(Integer, ForeignKey("app.coa.id"), nullable=True)
    account_code = Column(String(50), nullable=False)
    account_name = Column(String(200), nullable=True)
    standard_account_id = Column(Integer, ForeignKey("standard_accounts.id"), nullable=True)
    standard_account_code = Column(String(100), nullable=True)
    account_role = Column(String(80), nullable=True)
    description = Column(Text, nullable=True)
    debit = Column(Numeric(24, 2), nullable=False, default=0)
    credit = Column(Numeric(24, 2), nullable=False, default=0)
    partner_name = Column(String(200), nullable=True)
    tax_code = Column(String(50), nullable=True)
    branch = Column(String(100), nullable=True)
    department = Column(String(100), nullable=True)
    cost_center = Column(String(100), nullable=True)
    project = Column(String(100), nullable=True)
    reconciliation_no = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.now)


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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    periode = Column(String(20), nullable=False)  # mis. "2026-07"
    tanggal_mulai = Column(String(20), nullable=True)
    tanggal_akhir = Column(String(20), nullable=True)
    data = Column(Text, nullable=False)  # JSON: {neraca, laba_rugi, perubahan_ekuitas, arus_kas, calk, meta}
    dibuat_oleh = Column(String(100), nullable=True)
    dibuat_at = Column(DateTime, default=datetime.now)

    client = relationship("Client")


class AuditLog(Base):
    # [DIUBAH -- migrasi ke management_audit_trails] `audit_log` (lama)
    # digantikan `management_audit_trails`. Struktur beda konsep (dulu
    # per-client: client_id/aksi/detail; sekarang per-user: id_user/ip/
    # action/menu) -- atas permintaan user, client_id DITAMBAHKAN ke
    # management_audit_trails supaya tracking "aksi di client mana"
    # tidak hilang. Nama atribut Python (user, aksi, detail, dibuat_at)
    # dipertahankan lewat aliasing supaya kode lama yang memanggil
    # catat_audit_log(...) tidak perlu diubah semua.
    __tablename__ = "management_audit_trails"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    id_user = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
    # [DIUBAH] "user" (dulu: nama/username string bebas) TIDAK PUNYA
    # padanan kolom lagi -- management_audit_trails pakai id_user (uuid,
    # FK ke management_users) sebagai identitas pelaku, bukan string
    # nama bebas. Kode lama yang men-set audit.user = "<nama>" perlu
    # diubah kirim id_user (uuid) langsung; atribut ini sengaja
    # dikosongkan (bukan dialiaskan ke kolom lain) supaya tidak
    # tersimpan salah tempat.
    user = None
    aksi = Column("action", String(255), nullable=True)
    menu = Column(String(255), nullable=True)
    ip = Column(String(255), nullable=True)
    # [DIHAPUS] "detail" (JSON bebas) tidak ada kolom padanan di
    # management_audit_trails -- untuk sementara TIDAK tersimpan ke DB
    # (selalu None) sampai diputuskan mau disimpan di kolom mana.
    detail = None
    dibuat_at = Column("timestamp", DateTime, nullable=False, default=datetime.now)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)


class User(Base):
    """Menggantikan tabel `users` (lama) -- lihat root/ddl-table untuk DDL
    aslinya. Primary key UUID (`id_user`, default gen_random_uuid() di
    sisi Postgres), bukan lagi integer auto-increment. Tidak ada kolom
    `aktif` boolean lagi -- dipakai pola soft-delete via `deleted_at`
    (NULL = aktif, terisi = nonaktif/dihapus).

    Kolom `username`/`password_hash` SENGAJA ditambahkan ke DDL aslinya
    (tidak ada di draft ddl-table pertama) -- tanpa itu tidak ada cara
    tabel ini dipakai untuk login. Lihat migrations/xxx_management_users_auth.sql.
    """
    __tablename__ = "management_users"
    # [DIUBAH] Tabel dipindah dari schema public ke schema app (lihat
    # move_management_tables_to_app_schema.sql) -- ditambahkan di sini
    # supaya ORM ikut mencari/menyimpan ke app.management_users, bukan
    # public.management_users lagi.
    __table_args__ = {"schema": "app"}

    id_user = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    username = Column(String(100), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    nama_user = Column(String(255), nullable=False)
    alamat_user = Column(String(255), nullable=True)
    telp_user = Column(String(255), nullable=True)
    # [DIUBAH] role sekarang INTEGER (1-5, dulu "tahap_N" varchar) --
    # lihat helper role_int_ke_tahap()/role_tahap_ke_int() di bawah dan
    # adapter di modules/auth/core.py yang tetap memakai string "tahap_N"
    # supaya logic RBAC lama tidak perlu diubah semua.
    role = Column(Integer, nullable=False, default=1)
    access = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"), onupdate=datetime.now, nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    # [BARU] kolom audit & relasi client tunggal, ditambahkan di migrasi
    # management_users terbaru.
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)


def role_int_ke_tahap(role_int: int) -> str:
    """Adapter: integer DB (1-5) -> string "tahap_N" yang dipakai LEVELS di
    modules/auth/core.py. Dipanggil setiap kali User.role dibaca untuk JWT/RBAC."""
    if role_int is None:
        return "tahap_1"
    return f"tahap_{int(role_int)}"


def role_tahap_ke_int(role_tahap: str) -> int:
    """Kebalikan role_int_ke_tahap() -- dipakai saat menyimpan role ke DB."""
    if not role_tahap:
        return 1
    try:
        return int(str(role_tahap).split("_")[-1])
    except (ValueError, IndexError):
        return 1


class UserClientAccess(Base):
    """Pembatasan client per user. tahap_5 dapat full access; role lain wajib mapping di production."""
    __tablename__ = "user_client_access"
    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_user_client_access"),
        Index("idx_user_client_access_user", "user_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_users.id_user"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    access_role = Column(String(50), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)


# [BARU] Riwayat percakapan chat, mirip sidebar "Chat History" di
# ChatGPT/Claude -- supaya percakapan tidak hilang begitu tab browser
# ditutup dan user bisa membuka lagi obrolan lama.
class Percakapan(Base):
    __tablename__ = "percakapan"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), nullable=False)  # pemilik percakapan
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
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
# MODUL PURCHASE (BARU) -- tabel dibuat manual oleh user lewat Supabase
# SQL Editor (purchase_tables.sql), BUKAN lewat init_db()/create_all() --
# jadi model di bawah ini hanya MEMETAKAN tabel yang sudah ada (kolom
# harus PERSIS sama dengan skema fisik di Supabase, dicek langsung via
# information_schema.columns oleh user). PK-nya uuid (bukan Integer
# serial seperti tabel lain di file ini), jadi pakai PG_UUID.
#
# CATATAN: tabel fisik awalnya bernama "journal_entries" (bentrok dengan
# tabel resmi JournalEntry di atas, Accounting Core V2) -- sudah di-rename
# manual oleh user jadi "purchase_journal_lines" sebelum model ini dibuat.
# ============================================================

class PurchaseVendor(Base):
    """Vendor/supplier khusus modul Purchase."""
    __tablename__ = "finance_transaction_purchase_vendor"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class PurchaseTransactionRow(Base):
    """Header transaksi Purchase (satu invoice/tagihan vendor)."""
    __tablename__ = "finance_transaction_purchase_transaction"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=False)  # mis. "PUR-2026-09-0001"
    vendor_id = Column(PG_UUID(as_uuid=True), ForeignKey("app.finance_transaction_purchase_vendor.id"), nullable=True)
    invoice_no = Column(String(100), nullable=True)
    po_number = Column(String(100), nullable=True)
    category = Column(String(100), nullable=True)
    period = Column(String(50), nullable=True)
    payment_terms = Column(String(100), nullable=True)
    currency = Column(String(10), nullable=True)
    source = Column(String(100), nullable=True)
    purchase_date = Column(Date, nullable=True)
    invoice_date = Column(Date, nullable=True)
    posting_date = Column(Date, nullable=True)
    due_date = Column(Date, nullable=True)
    subtotal = Column(Numeric(24, 2), nullable=True)
    discount = Column(Numeric(24, 2), nullable=True)
    tax = Column(Numeric(24, 2), nullable=True)
    total_payable = Column(Numeric(24, 2), nullable=True)
    payment_status = Column(String(30), nullable=True)
    status = Column(String(30), nullable=True)
    prepared_by = Column(String(100), nullable=True)
    approved_by = Column(String(100), nullable=True)
    posted_by = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class PurchaseLineItemRow(Base):
    """Rincian barang/jasa per purchase_id (banyak baris per transaksi)."""
    __tablename__ = "finance_transaction_purchase_line_items"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=False)
    item_code = Column(String(100), nullable=True)
    item_name = Column(String(200), nullable=True)
    qty = Column(Numeric(18, 2), nullable=True)
    unit = Column(String(30), nullable=True)
    unit_price = Column(Numeric(24, 2), nullable=True)
    discount = Column(Numeric(24, 2), nullable=True)
    tax_rate = Column(Numeric(6, 2), nullable=True)
    tax_amount = Column(Numeric(24, 2), nullable=True)
    subtotal = Column(Numeric(24, 2), nullable=True)
    total = Column(Numeric(24, 2), nullable=True)
    gl_account = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class PurchaseSourceDataRow(Base):
    """Dokumen sumber (PO/invoice/dsb) sebelum dipetakan jadi purchase_transaction."""
    __tablename__ = "finance_transaction_purchase_source_data"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    source_id = Column(String(100), nullable=True)
    type = Column(String(50), nullable=True)
    vendor = Column(String(200), nullable=True)
    date = Column(Date, nullable=True)
    invoice_no = Column(String(100), nullable=True)
    po_number = Column(String(100), nullable=True)
    amount = Column(Numeric(24, 2), nullable=True)
    tax = Column(Numeric(24, 2), nullable=True)
    total = Column(Numeric(24, 2), nullable=True)
    purchase_ref = Column(String(100), nullable=True)  # purchase_id yang sudah kepetakan, kalau ada
    validation = Column(String(50), nullable=True)
    status = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


class PurchaseJournalLineRow(Base):
    """
    Draf jurnal per purchase_id (satu baris = satu leg debit/kredit).
    Nama tabel fisik "purchase_journal_lines" -- lihat catatan rename di
    atas modul ini (sebelumnya salah dibuat sebagai "journal_entries").
    """
    __tablename__ = "finance_transaction_purchase_journal_lines"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=False)
    account_code = Column(String(50), nullable=True)
    account_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    debit = Column(Numeric(24, 2), nullable=True)
    credit = Column(Numeric(24, 2), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class PurchaseExceptionRow(Base):
    """Exception/pengecualian per purchase_id (butuh review akuntan)."""
    __tablename__ = "finance_transaction_purchase_exceptions"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=True)
    reason = Column(String(255), nullable=True)
    severity = Column(String(30), nullable=True)
    exception_status = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)


PURCHASE_STATUS_VALID = {
    "draft", "pending_review", "approved", "pending_posting",
    "posted", "rejected", "exception", "cancelled",
}
PURCHASE_EXCEPTION_STATUS_VALID = {
    "Open", "Under Review", "Requires Correction", "Resolved", "Ignored",
}


def _purchase_transaction_ke_dict(t: "PurchaseTransactionRow") -> Dict[str, Any]:
    return {
        "id": str(t.id),
        "purchase_id": t.purchase_id,
        "status": t.status,
        "payment_status": t.payment_status,
        "approved_by": t.approved_by,
        "posted_by": t.posted_by,
        "posting_date": t.posting_date.isoformat() if t.posting_date else None,
        "description": t.description,
    }


def update_purchase_status(
    purchase_row_id: str, client_id: str, user: str, status: str,
    alasan: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """[BARU] Ubah status satu transaksi Purchase (dipakai tombol Submit for
    Review/Approve/Reject/Post to GL/Return for Correction di halaman
    Journal Preview & tombol View di halaman Transaction). Pola identik
    update_bank_cash() tapi kolom status Purchase punya lebih banyak nilai
    (lihat PURCHASE_STATUS_VALID) jadi tidak diterjemahkan lewat
    _map_status_frontend_ke_backend -- dipakai apa adanya dari frontend."""
    if status not in PURCHASE_STATUS_VALID:
        raise ValueError(f"Status '{status}' tidak dikenal. Nilai sah: {sorted(PURCHASE_STATUS_VALID)}")

    session = SessionLocal()
    try:
        t = session.query(PurchaseTransactionRow).filter(
            PurchaseTransactionRow.id == purchase_row_id,
            PurchaseTransactionRow.client_id == client_id,
        ).first()
        if t is None:
            return None

        t_old_status = t.status
        t.status = status
        t.updated_at = datetime.now()
        if status == "approved":
            t.approved_by = user
        elif status == "posted":
            t.posted_by = user
            t.posting_date = datetime.now().date()
        elif status == "rejected" and alasan:
            t.description = f"{t.description or ''} [Ditolak: {alasan}]".strip()

        if status == "approved":
            _event_type, _desc = "APPROVED", "Transaksi disetujui"
        elif status == "posted":
            _event_type, _desc = "POSTED", "Transaksi diposting ke General Ledger"
        elif status == "rejected":
            _event_type, _desc = "REJECTED", f"Transaksi ditolak{f': {alasan}' if alasan else ''}"
        elif status == "pending_review" and t_old_status == "approved":
            _event_type, _desc = "RETURNED", "Dikembalikan untuk perbaikan"
        elif status == "pending_review":
            _event_type, _desc = "SUBMITTED", "Diajukan untuk review"
        else:
            _event_type, _desc = "STATUS_CHANGED", f"Status diubah jadi {status}"
        _catat_log_purchase(
            session, client_id, t.id, _event_type, _desc, user,
            reference_no=t.purchase_id,
        )

        session.commit()
        session.refresh(t)
        return _purchase_transaction_ke_dict(t)
    except ValueError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error update purchase status: {e}")
        return None
    finally:
        session.close()


def bulk_update_purchase_status(
    client_id: str, ids: List[str], user: str, target_status: str,
    from_status: Optional[str] = None,
) -> Dict[str, int]:
    """[BARU] Ubah status banyak transaksi Purchase sekaligus -- dipakai
    tombol "Bulk Approve" di halaman Transaction. Kalau `from_status`
    diisi, hanya baris yang sedang berstatus itu yang diproses (baris lain
    dilewati, bukan error), pola identik posting_massal_bank_cash_by_ids()."""
    if target_status not in PURCHASE_STATUS_VALID:
        raise ValueError(f"Status '{target_status}' tidak dikenal.")
    if not ids:
        return {"diperbarui": 0, "dilewati": 0, "tidak_ditemukan": 0}

    _UKURAN_BATCH_IN = 500
    session = SessionLocal()
    try:
        ditemukan_ids: set = set()
        diperbarui = 0
        dilewati = 0
        sekarang = datetime.now()

        for awal in range(0, len(ids), _UKURAN_BATCH_IN):
            kelompok_id = ids[awal:awal + _UKURAN_BATCH_IN]
            q = session.query(PurchaseTransactionRow).filter(
                PurchaseTransactionRow.client_id == client_id,
                PurchaseTransactionRow.id.in_(kelompok_id),
            )
            rows = q.all()
            for t in rows:
                ditemukan_ids.add(str(t.id))
                if from_status and t.status != from_status:
                    dilewati += 1
                    continue
                t.status = target_status
                t.updated_at = sekarang
                if target_status == "approved":
                    t.approved_by = user
                elif target_status == "posted":
                    t.posted_by = user
                    t.posting_date = sekarang.date()
                diperbarui += 1

                _catat_log_purchase(
                    session, client_id, t.id,
                    target_status.upper() if target_status in ("approved", "posted", "rejected") else "STATUS_CHANGED",
                    f"Status diubah jadi {target_status} (bulk update)", user,
                    reference_no=t.purchase_id,
                )

        tidak_ditemukan = len(set(ids) - ditemukan_ids)
        session.commit()
        return {"diperbarui": diperbarui, "dilewati": dilewati, "tidak_ditemukan": tidak_ditemukan}
    except Exception as e:
        session.rollback()
        print(f"Error bulk update purchase status: {e}")
        return {"diperbarui": 0, "dilewati": 0, "tidak_ditemukan": 0}
    finally:
        session.close()


def update_purchase_exception_status(
    exception_id: str, client_id: str, exception_status: str, user: str = "System",
) -> Optional[Dict[str, Any]]:
    """[BARU] Ubah status satu exception Purchase -- dipakai tombol Start
    Review/Flag/Mark Resolved/Begin Correction/Ignore di halaman
    Exceptions. Sebelumnya cuma diubah di state React lokal (resolveMap),
    jadi hilang lagi begitu halaman di-refresh."""
    if exception_status not in PURCHASE_EXCEPTION_STATUS_VALID:
        raise ValueError(f"Status '{exception_status}' tidak dikenal. Nilai sah: {sorted(PURCHASE_EXCEPTION_STATUS_VALID)}")

    session = SessionLocal()
    try:
        e = session.query(PurchaseExceptionRow).filter(
            PurchaseExceptionRow.id == exception_id,
            PurchaseExceptionRow.client_id == client_id,
        ).first()
        if e is None:
            return None
        e.exception_status = exception_status
        e.updated_at = datetime.now()

        purchase_row_id = None
        if e.purchase_id:
            t = session.query(PurchaseTransactionRow).filter(
                PurchaseTransactionRow.purchase_id == e.purchase_id,
                PurchaseTransactionRow.client_id == client_id,
            ).first()
            if t is not None:
                purchase_row_id = t.id
        _catat_log_purchase(
            session, client_id, purchase_row_id, "EXCEPTION_UPDATED",
            f"Status exception diubah jadi {exception_status}", user,
            reference_no=e.purchase_id,
        )

        session.commit()
        session.refresh(e)
        return {"id": str(e.id), "exception_status": e.exception_status}
    except ValueError:
        session.rollback()
        raise
    except Exception as ex:
        session.rollback()
        print(f"Error update purchase exception status: {ex}")
        return None
    finally:
        session.close()


def ambil_data_purchase(client_id: str) -> Dict[str, Any]:
    """
    [BARU] Ambil seluruh data modul Purchase (vendor, purchase_transaction,
    purchase_line_items, source_data, purchase_journal_lines, exceptions)
    milik satu client sebagai dict of list-of-dict. Dipetakan ke tipe
    PurchaseTransaction/PurchaseLine/PurchaseSourceRecord/PurchaseException
    di frontend oleh src/app/transactions/purchase/purchasebridge.ts --
    kalau nama/tipe field di sini diubah, sesuaikan juga di sana.
    """
    session = SessionLocal()
    try:
        vendor_rows = session.query(PurchaseVendor).filter(
            PurchaseVendor.client_id == client_id
        ).all()
        transaksi_rows = session.query(PurchaseTransactionRow).filter(
            PurchaseTransactionRow.client_id == client_id
        ).order_by(PurchaseTransactionRow.purchase_date).all()
        line_item_rows = session.query(PurchaseLineItemRow).filter(
            PurchaseLineItemRow.client_id == client_id
        ).all()
        source_rows = session.query(PurchaseSourceDataRow).filter(
            PurchaseSourceDataRow.client_id == client_id
        ).order_by(PurchaseSourceDataRow.date).all()
        jurnal_rows = session.query(PurchaseJournalLineRow).filter(
            PurchaseJournalLineRow.client_id == client_id
        ).all()
        exception_rows = session.query(PurchaseExceptionRow).filter(
            PurchaseExceptionRow.client_id == client_id
        ).all()

        def _iso(d):
            return d.isoformat() if d else None

        def _num(v):
            return float(v) if v is not None else 0.0

        return {
            "vendor": [
                {"id": str(v.id), "name": v.name}
                for v in vendor_rows
            ],
            "purchase_transaction": [
                {
                    "id": str(t.id),
                    "purchase_id": t.purchase_id,
                    "vendor_id": str(t.vendor_id) if t.vendor_id else None,
                    "invoice_no": t.invoice_no,
                    "po_number": t.po_number,
                    "category": t.category,
                    "period": t.period,
                    "payment_terms": t.payment_terms,
                    "currency": t.currency,
                    "source": t.source,
                    "purchase_date": _iso(t.purchase_date),
                    "invoice_date": _iso(t.invoice_date),
                    "posting_date": _iso(t.posting_date),
                    "due_date": _iso(t.due_date),
                    "subtotal": _num(t.subtotal),
                    "discount": _num(t.discount),
                    "tax": _num(t.tax),
                    "total_payable": _num(t.total_payable),
                    "payment_status": t.payment_status,
                    "status": t.status,
                    "prepared_by": t.prepared_by,
                    "approved_by": t.approved_by,
                    "posted_by": t.posted_by,
                    "description": t.description,
                    "created_at": _iso(t.created_at),
                    "updated_at": _iso(t.updated_at),
                }
                for t in transaksi_rows
            ],
            "purchase_line_items": [
                {
                    "id": str(li.id),
                    "purchase_id": li.purchase_id,
                    "item_code": li.item_code,
                    "item_name": li.item_name,
                    "qty": _num(li.qty),
                    "unit": li.unit,
                    "unit_price": _num(li.unit_price),
                    "discount": _num(li.discount),
                    "tax_rate": _num(li.tax_rate),
                    "tax_amount": _num(li.tax_amount),
                    "subtotal": _num(li.subtotal),
                    "total": _num(li.total),
                    "gl_account": li.gl_account,
                }
                for li in line_item_rows
            ],
            "source_data": [
                {
                    "id": str(s.id),
                    "source_id": s.source_id,
                    "type": s.type,
                    "vendor": s.vendor,
                    "date": _iso(s.date),
                    "invoice_no": s.invoice_no,
                    "po_number": s.po_number,
                    "amount": _num(s.amount),
                    "tax": _num(s.tax),
                    "total": _num(s.total),
                    "purchase_ref": s.purchase_ref,
                    "validation": s.validation,
                    "status": s.status,
                }
                for s in source_rows
            ],
            "purchase_journal_lines": [
                {
                    "id": str(j.id),
                    "purchase_id": j.purchase_id,
                    "account_code": j.account_code,
                    "account_name": j.account_name,
                    "description": j.description,
                    "debit": _num(j.debit),
                    "credit": _num(j.credit),
                }
                for j in jurnal_rows
            ],
            "exceptions": [
                {
                    "id": str(e.id),
                    "purchase_id": e.purchase_id,
                    "reason": e.reason,
                    "severity": e.severity,
                    "exception_status": e.exception_status,
                    "created_at": _iso(e.created_at),
                }
                for e in exception_rows
            ],
        }
    finally:
        session.close()


# ============================================================
# MODUL BANK & CASH (BARU) -- tabel "finance_transaction_bank_cash" dibuat
# manual oleh user lewat Supabase SQL Editor (bukan lewat init_db()/
# create_all()), skemanya SENGAJA dibuat identik dengan JurnalPosting di
# atas (jurnal_posting) -- bedanya tabel ini KHUSUS menampung entri jurnal
# kelompok Cash Payment & Cash Receipt (dibedakan lewat kolom
# `jenis_dokumen`, nilai 'cash_payment'/'cash_receipt'), TERPISAH dari
# jurnal_posting umum (Sales/Expense/Other) -- lihat bankCashBridge.ts di
# frontend utk pemetaan balik ke Transaction.
# ============================================================

STATUS_BANK_CASH_VALID = {"draft", "terposting", "ditolak"}
JENIS_DOKUMEN_BANK_CASH_VALID = {"cash_payment", "cash_receipt"}


class FinanceTransactionBankCash(Base):
    """Entri jurnal Cash Payment & Cash Receipt (satu baris = satu pasang debet+kredit)."""
    __tablename__ = "finance_transaction_bank_cash"
    __table_args__ = {"schema": "app"}

    id = Column(BigInteger, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    hasil_id = Column(Integer, nullable=True)
    jenis_dokumen = Column(String(50), nullable=True)  # 'cash_payment' | 'cash_receipt'
    tanggal = Column(String(20), nullable=True)
    keterangan = Column(Text, nullable=True)
    lawan_transaksi = Column(String(200), nullable=True)
    no_dokumen = Column(String(100), nullable=True)
    project_unit = Column(String(100), nullable=True)
    jatuh_tempo = Column(String(20), nullable=True)
    no_akun_debet = Column(String(50), nullable=False)
    nama_akun_debet = Column(String(200), nullable=True)
    jml_debet = Column(Float, nullable=False, default=0)
    no_akun_kredit = Column(String(50), nullable=False)
    nama_akun_kredit = Column(String(200), nullable=True)
    jml_kredit = Column(Float, nullable=False, default=0)
    status = Column(String(20), nullable=False, default="draft")  # draft/terposting/ditolak
    sumber_placeholder = Column(Boolean, nullable=False, default=False)
    voucher = Column(String(50), nullable=True)
    periode_voucher = Column(String(10), nullable=True)
    baris_asal = Column(Integer, nullable=True)
    kode_bank = Column(String(20), nullable=True)
    transaction_hash = Column(String(64), nullable=True)
    diposting_oleh = Column(String(100), nullable=True)
    diposting_at = Column(DateTime, nullable=True)
    dibuat_at = Column(DateTime, nullable=False, default=datetime.now)
    payment_status = Column(String(20), nullable=True)
    paid_amount = Column(Float, nullable=True)

    client = relationship("Client")


def _bank_cash_ke_dict(j: "FinanceTransactionBankCash") -> Dict[str, Any]:
    return {
        "id": j.id, "hasil_id": j.hasil_id, "jenis_dokumen": j.jenis_dokumen,
        "tanggal": j.tanggal, "keterangan": j.keterangan,
        "lawan_transaksi": j.lawan_transaksi, "no_dokumen": j.no_dokumen,
        "project_unit": j.project_unit, "jatuh_tempo": j.jatuh_tempo,
        "no_akun_debet": j.no_akun_debet, "nama_akun_debet": j.nama_akun_debet,
        "jml_debet": j.jml_debet,
        "no_akun_kredit": j.no_akun_kredit, "nama_akun_kredit": j.nama_akun_kredit,
        "jml_kredit": j.jml_kredit,
        "status": j.status, "sumber_placeholder": j.sumber_placeholder,
        "voucher": j.voucher, "periode_voucher": j.periode_voucher,
        "payment_status": j.payment_status, "paid_amount": j.paid_amount,
        "diposting_oleh": j.diposting_oleh,
        "diposting_at": j.diposting_at.isoformat() if j.diposting_at else None,
        "dibuat_at": j.dibuat_at.isoformat() if j.dibuat_at else None,
    }


def daftar_bank_cash(client_id: str, status: Optional[str] = None,
                      limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Ambil seluruh baris Cash Payment + Cash Receipt milik client (tanpa
    batas kalau limit=None -- sama seperti daftar_jurnal_posting)."""
    session = SessionLocal()
    try:
        query = session.query(FinanceTransactionBankCash).filter(
            FinanceTransactionBankCash.client_id == client_id
        )
        if status:
            query = query.filter(FinanceTransactionBankCash.status == status)
        query = query.order_by(FinanceTransactionBankCash.dibuat_at.desc())
        if limit is not None and limit > 0:
            query = query.limit(limit)
        return [_bank_cash_ke_dict(j) for j in query.all()]
    except Exception as e:
        session.rollback()
        print(f"Error daftar bank cash: {e}")
        return []
    finally:
        session.close()


def ambil_bank_cash_by_id(bank_cash_id: int, client_id: str) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        j = session.query(FinanceTransactionBankCash).filter(
            FinanceTransactionBankCash.id == bank_cash_id,
            FinanceTransactionBankCash.client_id == client_id,
        ).first()
        return _bank_cash_ke_dict(j) if j else None
    except Exception as e:
        session.rollback()
        print(f"Error ambil bank cash by id: {e}")
        return None
    finally:
        session.close()


def update_bank_cash(bank_cash_id: int, client_id: str, user: str, **fields) -> Optional[Dict[str, Any]]:
    """Edit satu baris Bank & Cash yang sudah ada -- pola identik
    update_jurnal_posting()."""
    KOLOM_BOLEH_DIUBAH = {
        "tanggal", "keterangan", "lawan_transaksi", "no_dokumen", "project_unit",
        "jatuh_tempo", "no_akun_debet", "nama_akun_debet", "jml_debet",
        "no_akun_kredit", "nama_akun_kredit", "jml_kredit",
        "payment_status", "paid_amount",
    }
    session = SessionLocal()
    try:
        j = session.query(FinanceTransactionBankCash).filter(
            FinanceTransactionBankCash.id == bank_cash_id,
            FinanceTransactionBankCash.client_id == client_id,
        ).first()
        if j is None:
            return None

        for kolom in KOLOM_BOLEH_DIUBAH:
            if kolom in fields:
                setattr(j, kolom, fields[kolom])

        if "status" in fields and fields["status"] is not None:
            status_baru = fields["status"]
            if status_baru not in STATUS_BANK_CASH_VALID:
                raise ValueError(f"Status '{status_baru}' tidak dikenal backend.")
            j.status = status_baru
            if status_baru == "terposting":
                j.diposting_oleh = user
                j.diposting_at = datetime.now()

        if not j.no_akun_debet or not j.no_akun_kredit:
            raise ValueError("Kode akun debet dan kredit tidak boleh kosong.")

        j.sumber_placeholder = ("/" in j.no_akun_debet) or ("/" in j.no_akun_kredit)

        # [BARU] catat ke activity log -- "POSTING" kalau status baru saja
        # diubah jadi terposting, selain itu "UPDATED"
        _event_type = "POSTING" if ("status" in fields and fields["status"] == "terposting") else "UPDATED"
        _desc = "Transaksi diposting" if _event_type == "POSTING" else "Data transaksi diperbarui"
        _catat_log_bank_cash(
            session, client_id, bank_cash_id, _event_type, _desc, user,
            reference_no=j.no_dokumen or j.voucher,
        )

        session.commit()
        session.refresh(j)
        return _bank_cash_ke_dict(j)
    except ValueError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error update bank cash: {e}")
        return None
    finally:
        session.close()


def buat_bank_cash_manual(
    client_id: str, user: str, jenis_dokumen: str, tanggal: str, keterangan: str,
    no_akun_debet: str, nama_akun_debet: Optional[str], jml_debet: float,
    no_akun_kredit: str, nama_akun_kredit: Optional[str], jml_kredit: float,
    lawan_transaksi: Optional[str] = None, no_dokumen: Optional[str] = None,
    project_unit: Optional[str] = None, jatuh_tempo: Optional[str] = None,
    status: str = "draft", payment_status: Optional[str] = None,
    paid_amount: Optional[float] = None,
) -> Optional[int]:
    """Buat baris Bank & Cash baru secara manual -- dipakai tombol
    "+ Jurnal Baru" di halaman Cash Payment/Cash Receipt. `jenis_dokumen`
    WAJIB 'cash_payment' atau 'cash_receipt' (menentukan sub-halaman mana
    baris ini akan muncul di frontend, lihat bankCashBridge.ts)."""
    if jenis_dokumen not in JENIS_DOKUMEN_BANK_CASH_VALID:
        raise ValueError(f"jenis_dokumen '{jenis_dokumen}' tidak dikenal.")
    session = SessionLocal()
    try:
        j = FinanceTransactionBankCash(
            client_id=client_id,
            hasil_id=None,
            jenis_dokumen=jenis_dokumen,
            tanggal=tanggal,
            keterangan=keterangan,
            lawan_transaksi=lawan_transaksi,
            no_dokumen=no_dokumen,
            project_unit=project_unit,
            jatuh_tempo=jatuh_tempo,
            no_akun_debet=no_akun_debet,
            nama_akun_debet=nama_akun_debet,
            jml_debet=jml_debet,
            no_akun_kredit=no_akun_kredit,
            nama_akun_kredit=nama_akun_kredit,
            jml_kredit=jml_kredit,
            status=status if status in STATUS_BANK_CASH_VALID else "draft",
            sumber_placeholder=("/" in no_akun_debet) or ("/" in no_akun_kredit),
            payment_status=payment_status,
            paid_amount=paid_amount,
            dibuat_at=datetime.now(),
        )
        if j.status == "terposting":
            j.diposting_oleh = user
            j.diposting_at = datetime.now()
        session.add(j)
        session.flush()  # supaya j.id terisi sebelum dipakai activity log

        # [BARU] catat ke activity log
        _catat_log_bank_cash(
            session, client_id, j.id, "CREATED",
            f"Transaksi {jenis_dokumen} baru dibuat" + (f" (No. {no_dokumen})" if no_dokumen else ""),
            user, reference_no=no_dokumen,
        )

        session.commit()
        session.refresh(j)
        return j.id
    except ValueError:
        raise
    except Exception as e:
        session.rollback()
        print(f"Error buat bank cash manual: {e}")
        return None
    finally:
        session.close()


def posting_massal_bank_cash_by_ids(client_id: str, ids: List[int], user: str) -> Dict[str, int]:
    """Posting banyak baris 'draft' Bank & Cash sekaligus jadi 'terposting'
    -- pola identik konfirmasi_posting_by_ids()."""
    if not ids:
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}

    _UKURAN_BATCH_IN = 500
    session = SessionLocal()
    try:
        ditemukan_ids: set = set()
        diposting = 0
        dilewati = 0
        sekarang = datetime.now()

        for awal in range(0, len(ids), _UKURAN_BATCH_IN):
            kelompok_id = ids[awal:awal + _UKURAN_BATCH_IN]
            rows = session.query(FinanceTransactionBankCash).filter(
                FinanceTransactionBankCash.client_id == client_id,
                FinanceTransactionBankCash.id.in_(kelompok_id),
                FinanceTransactionBankCash.status == "draft",
            ).all()
            for j in rows:
                ditemukan_ids.add(j.id)
                if j.sumber_placeholder:
                    dilewati += 1
                    continue
                j.status = "terposting"
                j.diposting_oleh = user
                j.diposting_at = sekarang
                diposting += 1

                # [BARU] catat ke activity log
                _catat_log_bank_cash(
                    session, client_id, j.id, "POSTING",
                    "Transaksi diposting (posting massal)", user,
                    reference_no=j.no_dokumen or j.voucher,
                )

        tidak_ditemukan = len(set(ids) - ditemukan_ids)
        session.commit()
        return {"diposting": diposting, "dilewati_placeholder": dilewati, "tidak_ditemukan": tidak_ditemukan}
    except Exception as e:
        session.rollback()
        print(f"Error posting massal bank cash: {e}")
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}
    finally:
        session.close()


def tolak_bank_cash(bank_cash_id: int, client_id: str, user: str, alasan: Optional[str] = None) -> bool:
    """Tandai satu baris Bank & Cash sebagai 'ditolak' (dipakai tombol
    Hapus, sama seperti tolak_posting_jurnal untuk jurnal_posting)."""
    session = SessionLocal()
    try:
        j = session.query(FinanceTransactionBankCash).filter(
            FinanceTransactionBankCash.id == bank_cash_id,
            FinanceTransactionBankCash.client_id == client_id,
        ).first()
        if j is None:
            return False
        j.status = "ditolak"
        j.diposting_oleh = user
        j.diposting_at = datetime.now()
        if alasan:
            j.keterangan = f"{j.keterangan or ''} [Ditolak: {alasan}]".strip()

        # [BARU] catat ke activity log
        _catat_log_bank_cash(
            session, client_id, bank_cash_id, "REJECTED",
            f"Transaksi ditolak{f': {alasan}' if alasan else ''}",
            user, reference_no=j.no_dokumen or j.voucher,
        )

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tolak bank cash: {e}")
        return False
    finally:
        session.close()


# ============================================================
# [BARU] MODUL OTHER (JURNAL LAIN-LAIN) -- tabel
# "finance_transaction_other" dibuat manual oleh user lewat Supabase SQL
# Editor (bukan lewat init_db()/create_all()), skemanya SUDAH mengikuti
# bentuk final Transaction di frontend (satu baris = SATU KAKI/leg jurnal,
# bukan sepasang debet+kredit dalam satu baris seperti
# finance_transaction_bank_cash) -- dua baris dengan je_id yang sama adalah
# sepasang leg debet+kredit dari satu entri jurnal yang sama. Tabel ini
# KHUSUS menampung entri jurnal kelompok "Other" (lihat halaman
# src/app/transactions/other/page.tsx), menggantikan sumber lama yang lewat
# jurnal_posting umum + tebakan kategori/nama akun -- lihat otherBridge.ts
# di frontend utk pemetaan balik ke Transaction.
#
# je_id di sini SELALU berformat "OTH-<suffix>" (mis. "OTH-1", dibuat lewat
# _buat_je_id_other() di bawah) -- prefix ini dipakai frontend
# (extractOtherJeId() di otherBridge.ts) untuk membedakan baris dari tabel
# ini vs baris jurnal_posting biasa ("JE-<id>") atau bank & cash ("BC-<id>").
# ============================================================

STATUS_FINANCE_OTHER_VALID = {"Unposted", "Posted", "Draft", "Reconciled", "Voided"}


class FinanceTransactionOther(Base):
    """Satu baris = satu kaki (leg) jurnal kelompok Other. Kolom sudah 1:1
    dengan interface Transaction di frontend (snake_case <-> camelCase)."""
    __tablename__ = "finance_transaction_other"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=False)
    tx_id = Column(String(50), nullable=True)
    je_id = Column(String(50), nullable=True)
    date = Column(Date, nullable=True)
    account_code = Column(String(50), nullable=True)
    account_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    debit = Column(Numeric, nullable=False, default=0)
    credit = Column(Numeric, nullable=False, default=0)
    reference = Column(String(100), nullable=True)
    party = Column(String(200), nullable=True)
    category = Column(String(100), nullable=True)
    type = Column(String(20), nullable=True)  # 'debit' | 'credit'
    status = Column(String(20), nullable=True)  # Unposted/Posted/Draft/Reconciled/Voided (ala frontend, tanpa terjemahan)
    notes = Column(Text, nullable=True)
    voucher_no = Column(String(100), nullable=True)
    saldo_akhir = Column(Numeric, nullable=False, default=0)
    cek = Column(Boolean, nullable=False, default=False)
    source_module = Column(String(50), nullable=True)
    standard_account_code = Column(String(50), nullable=True)
    account_role = Column(String(50), nullable=True)
    core_journal_entry_id = Column(Integer, nullable=True)
    core_journal_line_id = Column(Integer, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now, onupdate=datetime.now)

    client = relationship("Client")


def _finance_other_ke_dict(o: "FinanceTransactionOther") -> Dict[str, Any]:
    return {
        "id": str(o.id), "tx_id": o.tx_id, "je_id": o.je_id,
        "date": o.date.isoformat() if hasattr(o.date, "isoformat") else o.date,
        "account_code": o.account_code, "account_name": o.account_name,
        "description": o.description, "debit": float(o.debit or 0), "credit": float(o.credit or 0),
        "reference": o.reference, "party": o.party, "category": o.category, "type": o.type,
        "status": o.status, "notes": o.notes, "voucher_no": o.voucher_no,
        "saldo_akhir": float(o.saldo_akhir or 0), "cek": bool(o.cek),
        "source_module": o.source_module, "standard_account_code": o.standard_account_code,
        "account_role": o.account_role,
        "core_journal_entry_id": o.core_journal_entry_id, "core_journal_line_id": o.core_journal_line_id,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "updated_at": o.updated_at.isoformat() if o.updated_at else None,
    }


def daftar_finance_other(client_id: str, status: Optional[str] = None,
                          limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Ambil seluruh baris (kedua leg) Other milik client (tanpa batas
    kalau limit=None -- sama seperti daftar_bank_cash)."""
    session = SessionLocal()
    try:
        query = session.query(FinanceTransactionOther).filter(
            FinanceTransactionOther.client_id == client_id
        )
        if status:
            query = query.filter(FinanceTransactionOther.status == status)
        query = query.order_by(FinanceTransactionOther.created_at.desc())
        if limit is not None and limit > 0:
            query = query.limit(limit)
        return [_finance_other_ke_dict(o) for o in query.all()]
    except Exception as e:
        session.rollback()
        print(f"Error daftar finance other: {e}")
        return []
    finally:
        session.close()


def _buat_je_id_other() -> str:
    """je_id baru unik berformat "OTH-<8 hex>" -- lihat catatan format di
    komentar modul di atas."""
    return f"OTH-{uuid.uuid4().hex[:8]}"


def update_finance_other_by_je_id(je_id: str, client_id: str, user: str, **fields) -> Optional[List[Dict[str, Any]]]:
    """Edit KEDUA baris (leg debet + leg kredit) yang berbagi je_id yang
    sama sekaligus -- dipanggil dari 1 PATCH TransactionEditModal yang
    menyunting sepasang leg. `debit_leg`/`credit_leg` (dict opsional) berisi
    field yang KHUSUS beda per leg (account_code/account_name/debit/credit);
    field lain di `fields` berlaku ke KEDUA baris."""
    KOLOM_BERSAMA = {
        "date", "description", "reference", "party", "category", "notes", "voucher_no",
    }
    session = SessionLocal()
    try:
        rows = session.query(FinanceTransactionOther).filter(
            FinanceTransactionOther.je_id == je_id,
            FinanceTransactionOther.client_id == client_id,
        ).all()
        if not rows:
            return None

        debit_leg = fields.pop("debit_leg", None) or {}
        credit_leg = fields.pop("credit_leg", None) or {}
        status_baru = fields.pop("status", None)
        if status_baru is not None and status_baru not in STATUS_FINANCE_OTHER_VALID:
            raise ValueError(f"Status '{status_baru}' tidak dikenal backend.")

        for o in rows:
            for kolom in KOLOM_BERSAMA:
                if kolom in fields and fields[kolom] is not None:
                    setattr(o, kolom, fields[kolom])
            if status_baru is not None:
                o.status = status_baru
            leg_fields = debit_leg if o.type == "debit" else credit_leg
            for kolom in ("account_code", "account_name", "debit", "credit"):
                if kolom in leg_fields and leg_fields[kolom] is not None:
                    setattr(o, kolom, leg_fields[kolom])
            o.updated_at = datetime.now()

        # [BARU] catat ke activity log -- "POSTING" kalau status baru saja
        # diubah jadi Posted, selain itu "UPDATED"
        _event_type = "POSTING" if status_baru == "Posted" else "UPDATED"
        _desc = "Entri jurnal diposting" if _event_type == "POSTING" else "Data entri jurnal diperbarui"
        _catat_log_finance_other(
            session, client_id, je_id, _event_type, _desc, user,
            reference_no=rows[0].voucher_no if rows else None,
        )

        session.commit()
        return [_finance_other_ke_dict(o) for o in rows]
    except ValueError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error update finance other: {e}")
        return None
    finally:
        session.close()


def buat_finance_other_manual(
    client_id: str, tanggal: str, description: str,
    account_code_debet: str, account_name_debet: Optional[str], jml_debet: float,
    account_code_kredit: str, account_name_kredit: Optional[str], jml_kredit: float,
    reference: Optional[str] = None, party: Optional[str] = None, category: Optional[str] = None,
    notes: Optional[str] = None, voucher_no: Optional[str] = None,
    status: str = "Unposted", user: Optional[str] = None,
) -> Optional[str]:
    """Buat entri Other baru (2 baris: leg debet + leg kredit berbagi je_id
    baru) -- dipakai tombol "+ Jurnal Baru" di halaman Other. Jurnal harus
    balance (debet == kredit).

    [BARU] `user` dipakai untuk mencatat siapa yang membuat entri ini ke
    finance_transaction_other_activity_log -- lihat _catat_log_finance_other()
    di bawah. Parameter opsional (default None -> dicatat sebagai 'System')
    supaya tetap kompatibel kalau ada pemanggil lama yang belum mengirim ini.
    """
    if round(jml_debet, 2) != round(jml_kredit, 2):
        raise ValueError(f"Jurnal tidak balance: Debet {jml_debet:,.0f} vs Kredit {jml_kredit:,.0f}.")
    if jml_debet <= 0:
        raise ValueError("Nominal jurnal harus lebih besar dari 0.")
    if status not in STATUS_FINANCE_OTHER_VALID:
        status = "Unposted"

    je_id = _buat_je_id_other()
    session = SessionLocal()
    try:
        sekarang = datetime.now()
        leg_debet = FinanceTransactionOther(
            client_id=client_id, tx_id=f"TXN-{je_id}-D", je_id=je_id, date=tanggal,
            account_code=account_code_debet, account_name=account_name_debet, description=description,
            debit=jml_debet, credit=0, reference=reference, party=party, category=category, type="debit",
            status=status, notes=notes, voucher_no=voucher_no, saldo_akhir=0, cek=False,
            source_module="GENERAL_JOURNAL", created_at=sekarang, updated_at=sekarang,
        )
        leg_kredit = FinanceTransactionOther(
            client_id=client_id, tx_id=f"TXN-{je_id}-K", je_id=je_id, date=tanggal,
            account_code=account_code_kredit, account_name=account_name_kredit, description=description,
            debit=0, credit=jml_kredit, reference=reference, party=party, category=category, type="credit",
            status=status, notes=notes, voucher_no=voucher_no, saldo_akhir=0, cek=False,
            source_module="GENERAL_JOURNAL", created_at=sekarang, updated_at=sekarang,
        )
        session.add(leg_debet)
        session.add(leg_kredit)

        # [BARU] catat ke activity log (satu baris log untuk seluruh entri,
        # bukan per leg)
        _catat_log_finance_other(
            session, client_id, je_id, "CREATED",
            f"Entri jurnal Other baru dibuat ({je_id})", user,
            reference_no=voucher_no or reference,
        )

        session.commit()
        return je_id
    except ValueError:
        raise
    except Exception as e:
        session.rollback()
        print(f"Error buat finance other manual: {e}")
        return None
    finally:
        session.close()


def posting_massal_finance_other_by_je_ids(client_id: str, je_ids: List[str], user: str) -> Dict[str, int]:
    """Posting banyak ENTRI (sepasang leg per je_id) 'Unposted' Other
    sekaligus jadi 'Posted' -- pola identik posting_massal_bank_cash_by_ids,
    cuma dikelompokkan per je_id (bukan per baris) karena satu entri = 2 baris."""
    if not je_ids:
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}

    session = SessionLocal()
    try:
        rows = session.query(FinanceTransactionOther).filter(
            FinanceTransactionOther.client_id == client_id,
            FinanceTransactionOther.je_id.in_(je_ids),
            FinanceTransactionOther.status == "Unposted",
        ).all()
        ditemukan_je_ids = {o.je_id for o in rows}
        for o in rows:
            o.status = "Posted"
            o.updated_at = datetime.now()

        # [BARU] catat ke activity log -- satu baris log per je_id (bukan
        # per leg), meski setiap je_id punya 2 baris di `rows`
        for _je_id in ditemukan_je_ids:
            _catat_log_finance_other(
                session, client_id, _je_id, "POSTING",
                "Entri jurnal diposting (posting massal)", user,
            )

        session.commit()
        tidak_ditemukan = len(set(je_ids) - ditemukan_je_ids)
        return {"diposting": len(ditemukan_je_ids), "dilewati_placeholder": 0, "tidak_ditemukan": tidak_ditemukan}
    except Exception as e:
        session.rollback()
        print(f"Error posting massal finance other: {e}")
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}
    finally:
        session.close()


def tolak_finance_other_by_je_id(je_id: str, client_id: str, user: str, alasan: Optional[str] = None) -> bool:
    """Tandai kedua leg satu entri Other (berbagi je_id) sebagai 'Voided' --
    dipakai tombol Hapus di halaman Other. Pola identik tolak_bank_cash."""
    session = SessionLocal()
    try:
        rows = session.query(FinanceTransactionOther).filter(
            FinanceTransactionOther.je_id == je_id,
            FinanceTransactionOther.client_id == client_id,
        ).all()
        if not rows:
            return False
        for o in rows:
            o.status = "Voided"
            o.updated_at = datetime.now()
            if alasan:
                o.notes = f"{o.notes or ''} [Ditolak: {alasan}]".strip()

        # [BARU] catat ke activity log -- satu baris log untuk seluruh
        # entri (bukan per leg)
        _catat_log_finance_other(
            session, client_id, je_id, "VOIDED",
            f"Entri jurnal di-void{f': {alasan}' if alasan else ''}", user,
            reference_no=rows[0].voucher_no if rows else None,
        )

        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error tolak finance other: {e}")
        return False
    finally:
        session.close()


# ============================================================
# [BARU] ACTIVITY LOG -- Bank & Cash dan Other
# ============================================================
# Dua tabel ini dibuat manual oleh user lewat Supabase SQL Editor,
# skemanya SENGAJA dibuat mirip financial_transaction_sales_activity_log
# (activity log modul Sales yang sudah ada lebih dulu) -- bedanya
# masing-masing merujuk ke tabel sumbernya sendiri (finance_transaction_
# bank_cash / finance_transaction_other), BUKAN ke sales invoice.
#
# Satu baris di sini = SATU kejadian/event pada satu transaksi Bank &
# Cash atau Other (dibuat, diedit, diposting, ditolak/di-void) --
# ditulis lewat _catat_log_bank_cash()/_catat_log_finance_other() di
# DALAM session yang sama dengan operasi utamanya, SEBELUM
# session.commit(), supaya log dan perubahan datanya selalu satu
# transaksi (kalau salah satu gagal, keduanya rollback bareng).
# ============================================================

class FinanceTransactionBankCashActivityLog(Base):
    """Log aktivitas satu baris finance_transaction_bank_cash (Cash
    Payment/Cash Receipt) -- satu baris log per kejadian."""
    __tablename__ = "finance_transaction_bank_cash_activity_log"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
    bank_cash_id = Column(BigInteger, ForeignKey("app.finance_transaction_bank_cash.id"), nullable=True)
    event_type = Column(String(50), nullable=False)  # "CREATED"/"UPDATED"/"POSTING"/"REJECTED"
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)  # no_dokumen / voucher terkait
    performed_by = Column(String(255), nullable=False)  # nama user, atau 'System'
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)


class FinanceTransactionOtherActivityLog(Base):
    """Log aktivitas satu ENTRI finance_transaction_other (sepasang leg
    debet+kredit yang berbagi je_id yang sama) -- satu baris log per
    kejadian per je_id, BUKAN per leg."""
    __tablename__ = "finance_transaction_other_activity_log"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
    je_id = Column(String(50), nullable=True)  # bukan FK -- je_id tidak unik (2 baris/leg per je_id)
    event_type = Column(String(50), nullable=False)  # "CREATED"/"UPDATED"/"POSTING"/"VOIDED"
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)  # voucher_no / reference terkait
    performed_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)


class PurchaseActivityLogRow(Base):
    """[BARU] Log aktivitas satu transaksi finance_transaction_purchase_
    transaction -- satu baris log per kejadian (submit for review/
    approve/reject/post to GL/exception status change dsb). Tabel dibuat
    manual oleh user lewat Supabase SQL Editor, skema mirip
    finance_transaction_bank_cash_activity_log di atas -- lihat DDL yang
    diberikan terpisah."""
    __tablename__ = "finance_transaction_purchase_activity_log"
    __table_args__ = {"schema": "app"}

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("app.management_clients.id"), nullable=True)
    purchase_row_id = Column(PG_UUID(as_uuid=True), ForeignKey("app.finance_transaction_purchase_transaction.id"), nullable=True)
    event_type = Column(String(50), nullable=False)  # "SUBMITTED"/"APPROVED"/"REJECTED"/"POSTED"/"RETURNED"/"EXCEPTION_UPDATED"
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)  # purchase_id (mis. "PUR-2026-09-0001")
    performed_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)


def _catat_log_bank_cash(session, client_id, bank_cash_id, event_type, description, user, reference_no=None):
    """Insert satu baris ke finance_transaction_bank_cash_activity_log.
    WAJIB dipanggil di DALAM session yang sama dengan operasi utamanya,
    SEBELUM session.commit() -- lihat catatan modul di atas."""
    session.add(FinanceTransactionBankCashActivityLog(
        client_id=client_id,
        bank_cash_id=bank_cash_id,
        event_type=event_type,
        description=description,
        reference_no=reference_no,
        performed_by=user or "System",
    ))


def _catat_log_finance_other(session, client_id, je_id, event_type, description, user, reference_no=None):
    """Insert satu baris ke finance_transaction_other_activity_log (SATU
    baris log per je_id per kejadian, bukan per leg). Sama seperti
    _catat_log_bank_cash, WAJIB dipanggil sebelum session.commit()."""
    session.add(FinanceTransactionOtherActivityLog(
        client_id=client_id,
        je_id=je_id,
        event_type=event_type,
        description=description,
        reference_no=reference_no,
        performed_by=user or "System",
    ))


def _catat_log_purchase(session, client_id, purchase_row_id, event_type, description, user, reference_no=None):
    """[BARU] Insert satu baris ke finance_transaction_purchase_activity_log.
    WAJIB dipanggil di DALAM session yang sama dengan operasi utamanya,
    SEBELUM session.commit() -- pola identik _catat_log_bank_cash()."""
    session.add(PurchaseActivityLogRow(
        client_id=client_id,
        purchase_row_id=purchase_row_id,
        event_type=event_type,
        description=description,
        reference_no=reference_no,
        performed_by=user or "System",
    ))


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
    industry: Optional[str] = None,
    status: Optional[str] = None,
    assigned_accountant: Optional[str] = None,
    contact_name: Optional[str] = None,
    npwp: Optional[str] = None,
    address: Optional[str] = None,
) -> Optional[int]:
    """Tambah client baru. Semua field profil (industry/status/dll) opsional,
    bisa diisi belakangan lewat update_profil_client()."""
    session = SessionLocal()
    try:
        client = Client(
            nama=nama, lokasi=lokasi, tipe=tipe, nomor_wa=nomor_wa, email=email,
            industry=industry, status=status, assigned_accountant=assigned_accountant,
            contact_name=contact_name, npwp=npwp, address=address,
        )
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
        # [DIUBAH] `tipe` (jenis layanan "accounting"/"pajak") tidak lagi
        # kolom fisik di database (lihat docstring class Client) -- filter
        # ini untuk sementara TIDAK memfilter apa pun, semua client tetap
        # dikembalikan berapa pun nilai `tipe` yang diminta pemanggil.

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
                "industry": c.industry,
                "status": c.status,
                "assigned_accountant": c.assigned_accountant,
                "contact_name": c.contact_name,
                "npwp": c.npwp,
                "address": c.address,
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


def ambil_client(client_id: str) -> Optional[Dict[str, Any]]:
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


def ubah_tipe_client(client_id: str, tipe_baru: str) -> bool:
    """
    [DIUBAH] `tipe` (jenis layanan "accounting"/"pajak") tidak lagi kolom
    fisik di database (lihat docstring class Client) -- fungsi ini untuk
    sementara jadi no-op (tidak benar-benar mengubah apa pun tersimpan),
    tapi tetap dipertahankan supaya endpoint/pemanggil lama yang memanggil
    fungsi ini tidak error. Return True selama client_id-nya valid.
    """
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            return False
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
    client_id: str,
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


def ambil_esb_accounts_client(client_id: str, hanya_aktif: bool = False) -> List[Dict[str, Any]]:
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
    client_id: str,
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
    client_id: str,
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
    client_id: str,
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
    client_id: str,
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
    client_id: str,
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
    client_id: Optional[str],
    user: str,
    aksi: str,
    detail: Optional[Dict[str, Any]] = None,
) -> bool:
    """Catat satu entri riwayat perubahan (audit trail).

    [DIUBAH -- migrasi ke management_audit_trails] Tabel baru pakai
    `id_user` (uuid, FK ke management_users) sebagai identitas pelaku,
    bukan string nama bebas seperti `audit_log` (lama). Supaya ~20 titik
    pemanggil log_audit(client_id, user.get("username", ...), ...) di
    main.py TIDAK perlu diubah satu-satu, fungsi ini sekarang mencari
    id_user dari `user` (username) dulu sebelum insert.

    CATATAN: kolom `detail` (JSON bebas, dulu ada di audit_log) TIDAK
    ADA padanannya di management_audit_trails -- parameter detail masih
    diterima supaya pemanggil lama tidak error, tapi isinya TIDAK
    tersimpan ke DB. Kalau detail penting untuk ditelusuri lagi nanti,
    kolom baru perlu ditambahkan ke management_audit_trails dulu.
    """
    session = SessionLocal()
    try:
        id_user = None
        if user:
            row = session.query(User.id_user).filter(User.username == user).first()
            if row:
                id_user = row[0]
        if id_user is None:
            print(f"Warning log_audit: username '{user}' tidak ditemukan di management_users, audit trail dilewati")
            return False
        entry = AuditLog(
            id_user=id_user,
            client_id=client_id,
            aksi=aksi,
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
    client_id: Optional[str] = None,
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
            # [DIUBAH] "user" & "detail" tidak lagi tersimpan sebagai
            # kolom (lihat catatan di log_audit()/class AuditLog) --
            # username di-lookup balik dari id_user; detail selalu {}.
            username = None
            if entry.id_user:
                u = session.query(User.username).filter(User.id_user == entry.id_user).first()
                username = u[0] if u else None
            results.append({
                "id": entry.id,
                "client_id": entry.client_id,
                "user": username,
                "aksi": entry.aksi,
                "detail": {},
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

def _user_ke_dict(user: "User") -> Dict[str, Any]:
    """Bentuk dict balikan dipertahankan sama seperti sebelum pindah ke
    management_users (id/nama/aktif), supaya modules/auth/*.py & pemanggil
    lain tidak perlu ikut berubah. `id` sekarang UUID (str), bukan int.

    [DIUBAH] `role` di DB sekarang integer (1-5) -- dikonversi balik ke
    string "tahap_N" di sini (lewat role_int_ke_tahap()) supaya SEMUA
    logic RBAC lama di modules/auth/core.py (LEVELS, dict "tahap_1".."tahap_5")
    tidak perlu diubah sama sekali."""
    return {
        "id": user.id_user,
        "username": user.username,
        "password_hash": user.password_hash,
        "role": role_int_ke_tahap(user.role),
        "nama": user.nama_user,
        "aktif": user.deleted_at is None,
    }


def create_user(username: str, password_hash: str, role: str, nama: Optional[str] = None) -> bool:
    """Buat user baru. `nama_user` wajib diisi di DB -- fallback ke username kalau nama tidak dikirim.

    [DIUBAH] `role` parameter tetap string "tahap_N" seperti sebelumnya
    (supaya pemanggil lama tidak perlu berubah) -- dikonversi ke integer
    di sini sebelum disimpan (lihat role_tahap_ke_int())."""
    session = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=password_hash,
            role=role_tahap_ke_int(role),
            nama_user=nama or username,
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
        return _user_ke_dict(user)
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
        return [_user_ke_dict(u) for u in users]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def update_user_role(username: str, role: str) -> bool:
    """Update role user. `role` tetap string "tahap_N" (lihat create_user())."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        user.role = role_tahap_ke_int(role)
        session.commit()
        return True
    except Exception:
        session.rollback()
        return False
    finally:
        session.close()


def get_user_by_id(user_id: str) -> Optional[Dict[str, Any]]:
    """Ambil user berdasarkan ID (UUID string)."""
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.id_user == user_id).first()
        if not user:
            return None
        return _user_ke_dict(user)
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
    """Aktifkan/nonaktifkan user tanpa menghapus datanya (mis. saat karyawan resign).

    Diterjemahkan ke pola soft-delete management_users: aktif=True -> deleted_at
    dikosongkan, aktif=False -> deleted_at diisi waktu sekarang.
    """
    session = SessionLocal()
    try:
        user = session.query(User).filter(User.username == username).first()
        if not user:
            return False
        user.deleted_at = None if aktif else datetime.now()
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


def delete_client(client_id: str) -> bool:
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


def hapus_semua_hasil_client(client_id: str, jenis: Optional[str] = None) -> int:
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


def hitung_hasil_client(client_id: str, jenis: Optional[str] = None) -> int:
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
    client_id: Optional[str] = None,
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
    client_id: Optional[str] = None,
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
    client_id: str,
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
    client_id: str,
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
    client_id: Optional[str] = None,
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
    client_id: Optional[str] = None,
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
    client_id: str,
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
    client_id: Optional[str] = None,
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
    client_id: str,
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
    client_id: Optional[str] = None,
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

def update_kontak_client(client_id: str, nomor_wa: Optional[str] = None, email: Optional[str] = None) -> bool:
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


def update_profil_client(
    client_id: str,
    industry: Optional[str] = None,
    status: Optional[str] = None,
    assigned_accountant: Optional[str] = None,
    contact_name: Optional[str] = None,
    npwp: Optional[str] = None,
    address: Optional[str] = None,
) -> bool:
    """Update field profil client (halaman Clients di dashboard). Kirim
    None utk field yang tidak mau diubah; kirim "" utk mengosongkan."""
    session = SessionLocal()
    try:
        row = session.query(Client).filter(Client.id == client_id).first()
        if row is None:
            return False
        if industry is not None:
            row.industry = industry or None
        if status is not None:
            row.status = status or None
        if assigned_accountant is not None:
            row.assigned_accountant = assigned_accountant or None
        if contact_name is not None:
            row.contact_name = contact_name or None
        if npwp is not None:
            row.npwp = npwp or None
        if address is not None:
            row.address = address or None
        row.diperbarui_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error update profil client: {e}")
        return False
    finally:
        session.close()


# ============================================================
# [BARU] FUNGSI REMINDER DEADLINE SPT
# ============================================================
# Dipanggil dari main.py /api/proses-file setelah ak.proses_file_spt()
# supaya setiap kewajiban lapor/setor per NPWP+jenis+periode tercatat
# sbg 1 baris yang bisa dipantau scheduler harian (lihat modules/
# notifikasi.py -- jalankan_pengecekan_reminder_spt()).

def simpan_reminder_deadline_spt(client_id: str, daftar_item: List[Dict[str, Any]]) -> int:
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


def daftar_reminder_spt_client(client_id: str, hanya_belum_selesai: bool = True) -> List[Dict[str, Any]]:
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

def simpan_coa_bulk(client_id: str, daftar_akun: List[Dict[str, Any]], ganti_semua: bool = True) -> int:
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


def ambil_coa_client(client_id: str, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Ambil seluruh COA milik satu client, terurut berdasarkan no_akun."""
    session = SessionLocal()
    try:
        query = session.query(Coa).filter(Coa.client_id == client_id)
        if hanya_aktif:
            query = query.filter(Coa.aktif.is_(True))
        akun_rows = query.order_by(Coa.no_akun).all()

        # [ACCOUNTING CORE V2] Enrich COA dengan standard taxonomy + account roles.
        # Additive: pemanggil lama yang hanya membaca field lama tetap aman.
        mappings = session.query(CoaStandardMapping, StandardAccount).join(
            StandardAccount, CoaStandardMapping.standard_account_id == StandardAccount.id
        ).filter(
            CoaStandardMapping.client_id == client_id,
            CoaStandardMapping.active.is_(True),
        ).all()
        mapping_by_coa = {m.coa_id: std for m, std in mappings}

        roles = session.query(CompanyAccountRole, AccountRole).join(
            AccountRole, CompanyAccountRole.role_id == AccountRole.id
        ).filter(
            CompanyAccountRole.client_id == client_id,
            CompanyAccountRole.active.is_(True),
            AccountRole.active.is_(True),
        ).all()
        roles_by_coa: Dict[int, List[str]] = {}
        for car, role in roles:
            roles_by_coa.setdefault(car.coa_id, []).append(role.role_code)

        hasil = []
        for a in akun_rows:
            std = mapping_by_coa.get(a.id)
            hasil.append({
                "id": a.id, "no_akun": a.no_akun, "nama_akun": a.nama_akun,
                "kategori": (std.account_class if std else a.kategori),
                "sub_kategori": (std.account_subtype if std and std.account_subtype else a.sub_kategori),
                "normal_saldo": (std.normal_balance if std and std.normal_balance else a.normal_saldo),
                "saldo_awal": a.saldo_awal,
                "segment": a.segment, "arus_kas": a.arus_kas,
                "keterangan": a.keterangan,
                "lawan_transaksi_saldo_awal": a.lawan_transaksi_saldo_awal,
                "project_unit_saldo_awal": a.project_unit_saldo_awal,
                "cabang": a.cabang,
                "aktif": a.aktif,
                "standard_account_code": std.standard_code if std else None,
                "standard_account_name": std.standard_name if std else None,
                "fs_statement": std.fs_statement if std else None,
                "fs_group": std.fs_group if std else None,
                "fs_line": std.fs_line if std else None,
                "account_roles": sorted(roles_by_coa.get(a.id, [])),
            })
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil COA client: {e}")
        return []
    finally:
        session.close()


def cari_akun_coa(client_id: str, no_akun: str) -> Optional[Dict[str, Any]]:
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


def tambah_akun_coa(client_id: str, no_akun: str, nama_akun: str, kategori: Optional[str] = None,
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

def ambil_blok_nomor_voucher(client_id: str, kode_bank: str, periode: str, jumlah: int) -> range:
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


def ambil_nomor_voucher_terakhir(client_id: str, kode_bank: str, periode: str) -> int:
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


def reset_voucher_counter(client_id: str, kode_bank: str, periode: str) -> bool:
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

    KETERBATASAN (didokumentasikan, bukan bug baru): ambil KATA TERAKHIR
    saja. Bekerja baik untuk "BANK BRI" -> "BRI", tapi salah untuk nama
    sheet/bank yang tidak mengikuti pola itu, mis. "Rekening Utama Kantor"
    -> "KANTOR" (bukan nama bank sama sekali). Lihat
    _deteksi_kode_bank_robust() di bawah -- dipakai duluan oleh
    beri_nomor_voucher_draf_jurnal(), fungsi INI cuma jadi fallback
    TERAKHIR kalau deteksi robust & Claude sama-sama tidak bisa memutuskan.
    """
    kata = str(nama_bank).strip().upper().split()
    return kata[-1] if kata else "BANK"


# [BARU] Daftar bank umum Indonesia untuk deteksi kode bank yang lebih
# andal daripada _kode_bank_dari_nama_lokal() (yang cuma ambil kata
# terakhir). Urutan tidak penting -- dicocokkan sebagai substring ke nama
# bank/sheet apa adanya (huruf besar semua). Tambah entri baru di sini
# kalau ada bank lain yang sering muncul di rekening koran client.
_DAFTAR_BANK_DIKENAL = [
    "BCA", "MANDIRI", "BNI", "BRI", "CIMB", "PERMATA", "BTN", "BSI",
    "DANAMON", "PANIN", "OCBC", "MAYBANK", "UOB", "BUKOPIN", "MEGA",
    "SINARMAS", "COMMONWEALTH", "HSBC", "STANDARD CHARTERED", "CITIBANK",
    "DBS", "ARTHA GRAHA", "JAGO", "SEABANK", "NEO COMMERCE", "ALLO",
]


def _deteksi_kode_bank_robust(nama_bank: Optional[str]) -> Optional[str]:
    """
    [BARU] Coba cocokkan nama_bank (nama sheet/bank mentah dari file yang
    diupload) ke _DAFTAR_BANK_DIKENAL lewat substring match (mis. "Bank
    BCA Cabang Sudirman" -> "BCA", "PT XYZ - Rek. Mandiri" -> "MANDIRI").
    Ini yang dicoba PERTAMA sebelum _kode_bank_dari_nama_lokal() (ambil
    kata terakhir) -- jauh lebih tahan terhadap format nama sheet yang
    bervariasi.

    Return None kalau tidak ada satu pun nama bank dikenal yang cocok --
    caller (beri_nomor_voucher_draf_jurnal) akan lanjut coba Claude
    (kalau pakai_ai=True), baru kalau itu juga gagal jatuh ke
    _kode_bank_dari_nama_lokal() sebagai upaya terakhir.
    """
    n = str(nama_bank or "").strip().upper()
    if not n:
        return None
    for kandidat in _DAFTAR_BANK_DIKENAL:
        if kandidat in n:
            return kandidat
    return None


_SYSTEM_PROMPT_DETEKSI_BANK = (
    "Kamu membantu sistem akuntansi mengenali kode bank singkat dari nama "
    "sheet/label rekening koran yang tidak baku. Balas HANYA dengan kode "
    "bank singkat huruf besar tanpa spasi (contoh: BCA, MANDIRI, BNI, BRI, "
    "CIMB), tanpa penjelasan apa pun. Kalau teks yang diberikan sama "
    "sekali tidak mengandung petunjuk nama bank (mis. cuma nama cabang, "
    "nama file, atau nama kantor), balas persis dengan kata "
    "TIDAK_DIKETAHUI."
)


def _deteksi_kode_bank_dengan_claude(nama_bank: str, keterangan_contoh: Optional[str], client_id: Optional[str]) -> Optional[str]:
    """
    [BARU] Fallback Claude -- HANYA dipanggil kalau _deteksi_kode_bank_robust()
    gagal (nama bank tidak cocok ke daftar dikenal). Pakai
    modules.claude_client.panggil_claude_teks() (Claude API ASLI --
    BUKAN panggil_claude_terstruktur() yang sejak refactor lain sekarang
    selalu ke Groq, lihat catatan di claude_client.py). Import dilakukan
    DI DALAM fungsi (bukan di top-level file) supaya tidak menambah
    dependency wajib modules/ di db_client.py untuk kode yang tidak
    memanggil fallback ini sama sekali (mis. saat ANTHROPIC_API_KEY
    belum di-set/tidak dipakai).

    Return kode bank (string) kalau Claude yakin, atau None kalau Claude
    bilang TIDAK_DIKETAHUI / panggilan API gagal (exception APA PUN
    ditelan di sini -- pemanggil harus tetap dapat nomor voucher walau
    Claude down, lihat beri_nomor_voucher_draf_jurnal()).
    """
    try:
        from modules.claude_client import panggil_claude_teks, ClaudeError
    except Exception:
        return None

    prompt = f'Nama sheet/label rekening koran: "{nama_bank}"'
    if keterangan_contoh:
        prompt += f'\nContoh keterangan transaksi di sheet ini: "{keterangan_contoh}"'

    try:
        jawaban = panggil_claude_teks(
            prompt,
            modul_pemanggil="db_client_deteksi_kode_bank_voucher",
            client_id=str(client_id) if client_id is not None else None,
            system_prompt=_SYSTEM_PROMPT_DETEKSI_BANK,
            max_tokens=20,
        )
    except ClaudeError as e:
        print(f"[voucher] Claude gagal deteksi kode bank untuk '{nama_bank}': {e}")
        return None
    except Exception as e:
        print(f"[voucher] Error tak terduga saat deteksi kode bank via Claude: {e}")
        return None

    kode = jawaban.strip().upper().split()[0] if jawaban and jawaban.strip() else ""
    # Validasi ringan: kode bank wajar itu pendek & cuma huruf/angka --
    # tolak kalau Claude malah balas kalimat penuh (harusnya tidak terjadi
    # krn system prompt sudah tegas, tapi jangan percaya buta ke output AI).
    if not kode or kode == "TIDAK_DIKETAHUI" or len(kode) > 15 or not kode.replace("_", "").isalnum():
        return None
    return kode


def beri_nomor_voucher_draf_jurnal(
    client_id: str,
    draf_jurnal: List[Dict[str, Any]],
    jenis_dokumen: str,
    pakai_ai: bool = False,
) -> List[str]:
    """
    [BARU] Beri nomor voucher PERMANEN (dari counter database yang sama
    dengan tarik_draf_jurnal_ke_posting()) ke tiap baris draf_jurnal,
    TANPA menyimpan baris itu ke tabel jurnal_posting -- dipakai oleh
    /api/proses-file (main.py::_proses_dan_simpan_satu_file) supaya
    halaman Transaksi dapat voucher permanen & tidak tabrakan/reset tiap
    sesi browser, TANPA ikut mengaktifkan kembali seluruh pipeline
    posting/audit/dedup yang sengaja dilepas saat Supabase dihapus.

    Dipanggil juga oleh tarik_draf_jurnal_ke_posting() di bawah (jalur
    Agent AI / konfirmasi batch) supaya logika penomoran SATU sumber,
    tidak dobel ditulis di dua tempat.

    Urutan deteksi kode bank per baris (baru -> lama):
      1. _deteksi_kode_bank_robust() -- cocokkan ke daftar bank dikenal.
      2. Kalau gagal & pakai_ai=True -- tanya Claude API
         (_deteksi_kode_bank_dengan_claude()).
      3. Kalau Claude juga gagal/tidak dipakai -- fallback lama
         _kode_bank_dari_nama_lokal() (ambil kata terakhir), SUPAYA
         baris tetap dapat voucher (tidak pernah gagal total gara-gara
         nama bank ambigu) -- tapi baris ini ditandai di `catatan`
         untuk direview manual.

    Mutasi `draf_jurnal` IN-PLACE: menambah/menimpa key "voucher" dan
    "periode_voucher" di tiap baris yang lolos filter (baris tanpa
    no_akun_debet/no_akun_kredit dilewati, sama seperti filter di
    tarik_draf_jurnal_ke_posting -- baris itu memang tidak akan pernah
    disimpan, jadi jangan buang nomor voucher untuknya). Baris yang perlu
    direview manual (kode bank hasil tebakan kasar) dapat tambahan teks
    di `catatan`.

    Berlaku untuk jenis_dokumen == "rekening_koran" (semua baris dapat
    voucher lewat deteksi kode bank -- lihat blok di bawah) DAN
    "jurnal_penjualan_kasir" (HANYA baris yang no_invoice-nya kosong di
    PDF sumber -- lihat blok kedua setelah loop rekening_koran; baris
    yang sudah punya no_invoice asli TIDAK disentuh, karena nomor asli
    dari dokumen kasir/POS itu sendiri sudah dipakai sebagai voucher oleh
    frontend, lihat drafJurnalPenjualanToTransactions() di
    ImportRekeningKoranModal.tsx). Jenis dokumen lain dibiarkan tidak
    tersentuh sama sekali.

    Return: list pesan peringatan (baris yang kode banknya cuma hasil
    tebakan kasar) -- kosong kalau semua baris berhasil dikenali dengan
    pasti.
    """
    peringatan: List[str] = []
    if not draf_jurnal or jenis_dokumen not in ("rekening_koran", "jurnal_penjualan_kasir"):
        return peringatan

    # [BARU] Jalur jurnal_penjualan_kasir: TIDAK butuh deteksi bank sama
    # sekali (bukan mutasi rekening) -- cukup isi voucher pengganti utk
    # baris yang no_invoice-nya kosong di PDF, pakai counter permanen yang
    # sama (VoucherCounter) supaya nomornya tidak berubah kalau file yang
    # sama diupload ulang. Prefix tetap "PJK" (Penjualan Kasir) utk semua
    # baris jenis ini -- tidak ada konsep "bank" di sini.
    if jenis_dokumen == "jurnal_penjualan_kasir":
        kelompok_pjk: Dict[str, List[int]] = {}
        for i, baris in enumerate(draf_jurnal):
            if baris.get("no_invoice"):
                continue  # sudah ada nomor asli dari PDF, jangan ditimpa
            periode = _periode_voucher_dari_tanggal(baris.get("tanggal"))
            kelompok_pjk.setdefault(periode, []).append(i)

        for periode, idx_list in kelompok_pjk.items():
            blok = ambil_blok_nomor_voucher(client_id, "PJK", periode, len(idx_list))
            for i, nomor in zip(idx_list, blok):
                draf_jurnal[i]["voucher"] = f"PJK-{periode}-{nomor}"
                draf_jurnal[i]["periode_voucher"] = periode
        return peringatan

    kelompok: Dict[tuple, List[int]] = {}
    kode_bank_per_baris: Dict[int, str] = {}

    for i, baris in enumerate(draf_jurnal):
        no_debet = str(baris.get("no_akun_debet") or "")
        no_kredit = str(baris.get("no_akun_kredit") or "")
        if not no_debet or not no_kredit:
            continue

        nama_bank_mentah = baris.get("bank") or "BANK"
        kode_bank = _deteksi_kode_bank_robust(nama_bank_mentah)
        if kode_bank is None and pakai_ai:
            kode_bank = _deteksi_kode_bank_dengan_claude(
                nama_bank_mentah, baris.get("keterangan"), client_id,
            )
        if kode_bank is None:
            kode_bank = _kode_bank_dari_nama_lokal(nama_bank_mentah)
            pesan = (
                f'Baris {baris.get("baris", i + 1)}: kode bank "{kode_bank}" '
                f'dari label "{nama_bank_mentah}" hasil tebakan kasar (bukan '
                f'dari daftar bank dikenal maupun Claude) -- mohon cek nomor '
                f'voucher baris ini secara manual.'
            )
            peringatan.append(pesan)
            catatan_lama = baris.get("catatan")
            baris["catatan"] = (catatan_lama + " | " if catatan_lama else "") + (
                "Kode bank pada nomor voucher hasil tebakan otomatis — mohon dicek."
            )

        kode_bank_per_baris[i] = kode_bank
        periode = _periode_voucher_dari_tanggal(baris.get("tanggal"))
        kelompok.setdefault((kode_bank, periode), []).append(i)

    for (kode_bank, periode), idx_list in kelompok.items():
        blok = ambil_blok_nomor_voucher(client_id, kode_bank, periode, len(idx_list))
        for i, nomor in zip(idx_list, blok):
            draf_jurnal[i]["voucher"] = f"{kode_bank}-{periode}-{nomor}"
            draf_jurnal[i]["periode_voucher"] = periode
            # [BARU] Simpan kode bank YANG BENAR-BENAR DIPAKAI untuk mint
            # voucher ini (bisa beda dari _kode_bank_dari_nama_lokal() kalau
            # deteksi robust/Claude di atas pilih kode lain) -- supaya
            # pemanggil (mis. kolom JurnalPosting.kode_bank di
            # tarik_draf_jurnal_ke_posting) tidak perlu menebak ulang dan
            # berisiko tidak konsisten dengan prefix voucher yang sudah jadi.
            draf_jurnal[i]["kode_bank_voucher"] = kode_bank

    return peringatan


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


def cari_upload_batch_by_file_hash(client_id: str, file_hash: str) -> Optional[Dict[str, Any]]:
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


def ambil_batch_aktif(client_id: str, kode_bank: str, periode: str) -> Optional[Dict[str, Any]]:
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


def daftar_upload_batch_client(client_id: str, limit: int = 100) -> List[Dict[str, Any]]:
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


def ambil_hash_transaksi_aktif(client_id: str, kode_bank: str, periode: str) -> set:
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
    client_id: str,
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


def tarik_draf_jurnal_ke_posting(client_id: str, hasil_id: int, jenis_dokumen: str,
                                  draf_jurnal: List[Dict[str, Any]],
                                  sudah_diberi_nomor: bool = False) -> int:
    """
    Salin baris-baris draf_jurnal (dari hasil proses_file_xxx) ke antrean
    jurnal_posting berstatus 'draft', supaya muncul di layar review
    akuntan. Dipanggil otomatis oleh main.py setiap kali /api/proses-file
    menyimpan hasil yang mengandung draf_jurnal.

    [BARU -- fix temuan #1] `sudah_diberi_nomor`: kalau True, LEWATI
    panggilan beri_nomor_voucher_draf_jurnal() di bawah -- dipakai oleh
    _proses_dan_simpan_satu_file() (main.py) yang SUDAH memint nomor
    voucher untuk draf_jurnal ini sebelumnya (lewat pemanggilan terpisah,
    dengan `pakai_ai` sesuai pilihan user di request upload). Tanpa flag
    ini, baris yang sama akan diberi nomor voucher DUA KALI (sekali oleh
    pemanggil, sekali lagi di sini) -- membuang nomor dari counter
    permanen (VoucherCounter) untuk voucher yang tidak pernah dipakai, dan
    voucher yang akhirnya tersimpan ke jurnal_posting jadi voucher
    generasi KEDUA, bukan yang sudah ditampilkan ke user di respons
    upload. Default tetap False supaya pemanggil lama (jalur Agent AI/
    konfirmasi batch di /api/proses-file/stream) tidak berubah perilaku.

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

        # [DIUBAH] Tahap 1+2 (deteksi kode bank + reservasi blok nomor)
        # dipindah ke beri_nomor_voucher_draf_jurnal() -- SATU sumber
        # logika, dipakai bersama oleh jalur ini (Agent AI/konfirmasi
        # batch) DAN oleh /api/proses-file (lihat main.py). pakai_ai
        # sengaja False di sini (perilaku lama, tidak berubah) --
        # nyalakan lewat parameter baru kalau nanti jalur ini juga mau
        # dibantu Claude untuk baris kode bank yang ambigu.
        # [FIX -- temuan #1] Kalau sudah_diberi_nomor=True, pemanggil
        # (_proses_dan_simpan_satu_file di main.py) SUDAH memint voucher
        # untuk draf_jurnal ini -- lihat docstring parameter di atas.
        # Lewati supaya tidak dobel mint.
        if not sudah_diberi_nomor:
            beri_nomor_voucher_draf_jurnal(client_id, draf_jurnal, jenis_dokumen, pakai_ai=False)
        voucher_per_baris: List[Optional[str]] = [
            (baris.get("voucher") if pakai_voucher else None) for baris in draf_jurnal
        ]
        periode_per_baris: List[Optional[str]] = [
            (baris.get("periode_voucher") if pakai_voucher else None) for baris in draf_jurnal
        ]

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
                # [DIUBAH] Baca kode_bank yang BENAR-BENAR dipakai untuk mint
                # voucher (diisi beri_nomor_voucher_draf_jurnal() di atas),
                # bukan menebak ulang dengan _kode_bank_dari_nama_lokal() --
                # dulu keduanya selalu sama karena cuma ada 1 metode deteksi,
                # sekarang bisa beda kalau deteksi robust/Claude pilih kode lain.
                kode_bank=(baris.get("kode_bank_voucher") if pakai_voucher else None),
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


def daftar_jurnal_posting(client_id: str, status: Optional[str] = "draft",
                           limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """
    Ambil baris jurnal_posting client (default: yang masih 'draft', perlu direview).

    [FIX -- baris hilang diam-diam saat import besar] Sebelumnya `limit`
    punya default tetap (500, lalu sempat dinaikkan ke 20000) -- angka
    berapa pun yang dipilih akan KEMBALI memotong data secara diam-diam
    begitu jumlah baris client tumbuh melewatinya (mis. import rekening
    koran multi-tahun, puluhan ribu baris). Sekarang default None berarti
    BENAR-BENAR TANPA BATAS -- `.limit()` SQLAlchemy cuma dipanggil kalau
    pemanggil eksplisit memberi angka (mis. untuk keperluan preview
    ringan/paginasi di tempat lain yang memang sengaja mau baris terbatas).
    Halaman Transaksi (lewat GET /api/client/{id}/jurnal-posting di
    main.py) TIDAK mengirim limit sama sekali -- jadi selalu ambil semua
    baris, berapa pun banyaknya.
    """
    session = SessionLocal()
    try:
        query = session.query(JurnalPosting).filter(JurnalPosting.client_id == client_id)
        if status:
            query = query.filter(JurnalPosting.status == status)
        query = query.order_by(JurnalPosting.dibuat_at.desc())
        if limit is not None and limit > 0:
            query = query.limit(limit)
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
                # [BARU] lihat komentar kolom payment_status/paid_amount di
                # model JurnalPosting di atas.
                "payment_status": j.payment_status, "paid_amount": j.paid_amount,
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


def ambil_jurnal_posting_by_id(posting_id: int, client_id: str) -> Optional[Dict[str, Any]]:
    """[BARU] Ambil SATU baris jurnal_posting milik client tertentu --
    dipakai endpoint edit (PATCH) untuk validasi kepemilikan (posting_id ini
    benar milik client_id ini) sebelum mengubah apa pun, dan untuk
    mengembalikan bentuk terbaru baris itu ke frontend setelah diedit."""
    session = SessionLocal()
    try:
        j = session.query(JurnalPosting).filter(
            JurnalPosting.id == posting_id, JurnalPosting.client_id == client_id
        ).first()
        if j is None:
            return None
        return {
            "id": j.id, "hasil_id": j.hasil_id, "jenis_dokumen": j.jenis_dokumen,
            "tanggal": j.tanggal, "keterangan": j.keterangan,
            "lawan_transaksi": j.lawan_transaksi, "no_dokumen": j.no_dokumen,
            "project_unit": j.project_unit, "jatuh_tempo": j.jatuh_tempo,
            "no_akun_debet": j.no_akun_debet, "nama_akun_debet": j.nama_akun_debet,
            "jml_debet": j.jml_debet,
            "no_akun_kredit": j.no_akun_kredit, "nama_akun_kredit": j.nama_akun_kredit,
            "jml_kredit": j.jml_kredit,
            "status": j.status, "sumber_placeholder": j.sumber_placeholder,
            "voucher": j.voucher, "periode_voucher": j.periode_voucher,
            "payment_status": j.payment_status, "paid_amount": j.paid_amount,
            "diposting_oleh": j.diposting_oleh,
            "diposting_at": j.diposting_at.isoformat() if j.diposting_at else None,
            "dibuat_at": j.dibuat_at.isoformat() if j.dibuat_at else None,
        }
    except Exception as e:
        session.rollback()
        print(f"Error ambil jurnal posting by id: {e}")
        return None
    finally:
        session.close()


# Nilai status jurnal_posting yang sah -- dijaga di satu tempat supaya
# update_jurnal_posting() & endpoint PATCH di main.py konsisten menolak
# nilai lain (mis. typo atau status lama 'Unposted'/'Reconciled'/'Voided'
# ala frontend yang TIDAK ADA representasinya di backend, lihat catatan di
# jurnalBridge.ts::STATUS_MAP).
STATUS_JURNAL_VALID = {"draft", "terposting", "ditolak"}


def update_jurnal_posting(posting_id: int, client_id: str, user: str, **fields) -> Optional[Dict[str, Any]]:
    """
    [BARU] Edit SATU baris jurnal_posting yang SUDAH ADA -- dipakai halaman
    Transaksi (TransactionEditModal, tombol "Simpan Perubahan") supaya
    hasil edit BENAR-BENAR tersimpan ke database, bukan cuma state React
    lokal seperti sebelumnya.

    Beda dari konfirmasi_posting_jurnal(): fungsi itu SELALU memaksa
    status jadi 'terposting' (dipakai jalur "Posting" khusus). Fungsi ini
    murni MENGUBAH ISI baris (tanggal/akun/nominal/dst) TANPA memaksa status
    berubah -- status ikut diubah HANYA kalau eksplisit diberikan lewat
    fields['status'], dan hanya menerima 3 nilai sah backend (lihat
    STATUS_JURNAL_VALID) -- endpoint di main.py yang menerjemahkan status
    ala frontend (Unposted/Posted/Draft/Reconciled/Voided) ke salah satu
    dari 3 nilai ini sebelum sampai sini.

    Hanya field yang ADA di `fields` (kunci disertakan) yang diubah --
    beda dari konfirmasi_posting_jurnal yang skip nilai falsy (0/""/None
    semua dilewati). Di sini None secara eksplisit BERARTI "kosongkan
    kolom ini", supaya user bisa menghapus isi field opsional (mis.
    catatan/lawan_transaksi) lewat form edit -- makanya dipakai **fields
    + 'in fields' check, bukan cek truthy seperti konfirmasi_posting_jurnal.

    Return: dict baris terbaru (lihat ambil_jurnal_posting_by_id) kalau
    berhasil, None kalau baris tidak ditemukan/bukan milik client_id ini.
    """
    KOLOM_BOLEH_DIUBAH = {
        "tanggal", "keterangan", "lawan_transaksi", "no_dokumen", "project_unit",
        "jatuh_tempo", "no_akun_debet", "nama_akun_debet", "jml_debet",
        "no_akun_kredit", "nama_akun_kredit", "jml_kredit",
        "payment_status", "paid_amount",
    }
    session = SessionLocal()
    try:
        j = session.query(JurnalPosting).filter(
            JurnalPosting.id == posting_id, JurnalPosting.client_id == client_id
        ).first()
        if j is None:
            return None

        for kolom in KOLOM_BOLEH_DIUBAH:
            if kolom in fields:
                setattr(j, kolom, fields[kolom])

        if "status" in fields and fields["status"] is not None:
            status_baru = fields["status"]
            if status_baru not in STATUS_JURNAL_VALID:
                raise ValueError(f"Status '{status_baru}' tidak dikenal backend.")
            j.status = status_baru
            if status_baru == "terposting":
                j.diposting_oleh = user
                j.diposting_at = datetime.now()

        # akun debet/kredit tidak boleh kosong sama sekali (constraint NOT
        # NULL di model) -- kalau field ini eksplisit diisi string kosong
        # lewat form edit, tolak di sini supaya pesan errornya jelas
        # (bukan IntegrityError mentah dari SQLAlchemy).
        if not j.no_akun_debet or not j.no_akun_kredit:
            raise ValueError("Kode akun debet dan kredit tidak boleh kosong.")

        j.sumber_placeholder = ("/" in j.no_akun_debet) or ("/" in j.no_akun_kredit)

        session.commit()
        session.refresh(j)
        hasil = {
            "id": j.id, "hasil_id": j.hasil_id, "jenis_dokumen": j.jenis_dokumen,
            "tanggal": j.tanggal, "keterangan": j.keterangan,
            "lawan_transaksi": j.lawan_transaksi, "no_dokumen": j.no_dokumen,
            "project_unit": j.project_unit, "jatuh_tempo": j.jatuh_tempo,
            "no_akun_debet": j.no_akun_debet, "nama_akun_debet": j.nama_akun_debet,
            "jml_debet": j.jml_debet,
            "no_akun_kredit": j.no_akun_kredit, "nama_akun_kredit": j.nama_akun_kredit,
            "jml_kredit": j.jml_kredit,
            "status": j.status, "sumber_placeholder": j.sumber_placeholder,
            "voucher": j.voucher, "periode_voucher": j.periode_voucher,
            "payment_status": j.payment_status, "paid_amount": j.paid_amount,
            "diposting_oleh": j.diposting_oleh,
            "diposting_at": j.diposting_at.isoformat() if j.diposting_at else None,
            "dibuat_at": j.dibuat_at.isoformat() if j.dibuat_at else None,
        }
        return hasil
    except ValueError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        print(f"Error update jurnal posting: {e}")
        return None
    finally:
        session.close()


def buat_jurnal_manual(
    client_id: str, user: str, tanggal: str, keterangan: str,
    no_akun_debet: str, nama_akun_debet: Optional[str],
    jml_debet: float,
    no_akun_kredit: str, nama_akun_kredit: Optional[str],
    jml_kredit: float,
    lawan_transaksi: Optional[str] = None, no_dokumen: Optional[str] = None,
    project_unit: Optional[str] = None,
    jatuh_tempo: Optional[str] = None, status: str = "draft",
    payment_status: Optional[str] = None, paid_amount: Optional[float] = None,
) -> Optional[int]:
    """
    [BARU] Buat baris jurnal_posting BARU secara manual -- dipakai tombol
    "+ Jurnal Baru" di halaman Transaksi & 5 sub halamannya. Sebelumnya
    tombol ini cuma menambah satu baris ke state React lokal (hilang saat
    refresh) -- sekarang benar-benar tersimpan ke database lewat fungsi ini.

    hasil_id sengaja NULL (jurnal manual tidak berasal dari file upload
    manapun) dan jenis_dokumen diisi 'manual' supaya baris ini bisa
    dibedakan dari hasil upload di riwayat/audit.

    Baris dengan no_akun_debet/no_akun_kredit sama-sama wajib diisi
    (constraint NOT NULL di model) -- endpoint di main.py yang menegakkan
    validasi "jurnal harus double-entry lengkap" (dua akun + nominal sama
    besar) sebelum memanggil fungsi ini; fungsi ini murni menyimpan.

    Return: id baris baru kalau berhasil, None kalau gagal.
    """
    session = SessionLocal()
    try:
        j = JurnalPosting(
            client_id=client_id,
            hasil_id=None,
            jenis_dokumen="manual",
            tanggal=tanggal,
            keterangan=keterangan,
            lawan_transaksi=lawan_transaksi,
            no_dokumen=no_dokumen,
            project_unit=project_unit,
            jatuh_tempo=jatuh_tempo,
            no_akun_debet=no_akun_debet,
            nama_akun_debet=nama_akun_debet,
            jml_debet=jml_debet,
            no_akun_kredit=no_akun_kredit,
            nama_akun_kredit=nama_akun_kredit,
            jml_kredit=jml_kredit,
            status=status if status in STATUS_JURNAL_VALID else "draft",
            sumber_placeholder=("/" in no_akun_debet) or ("/" in no_akun_kredit),
            payment_status=payment_status,
            paid_amount=paid_amount,
            dibuat_at=datetime.now(),
        )
        if j.status == "terposting":
            j.diposting_oleh = user
            j.diposting_at = datetime.now()
        session.add(j)
        session.commit()
        session.refresh(j)
        return j.id
    except Exception as e:
        session.rollback()
        print(f"Error buat jurnal manual: {e}")
        return None
    finally:
        session.close()


def konfirmasi_posting_by_ids(client_id: str, posting_ids: List[int], user: str) -> Dict[str, int]:
    """
    [BARU] Sama tujuannya dengan konfirmasi_posting_massal() (posting
    banyak baris 'draft' sekaligus jadi 'terposting'), tapi dipilih lewat
    DAFTAR posting_id eksplisit, bukan satu hasil_id. Dibutuhkan karena
    tombol "Posting Semua" di halaman Transaksi (dan versi per-kelompok di
    5 sub halaman) beroperasi atas baris-baris yang sedang tampil di layar
    (bisa berasal dari BANYAK hasil_id berbeda -- gabungan beberapa kali
    upload -- atau dibatasi ke satu kelompok Sales/Expense/dll, sesuatu
    yang backend tidak punya konsepnya sama sekali), bukan "semua draft
    milik satu file upload" seperti konfirmasi_posting_massal().

    Baris placeholder (sumber_placeholder=True) tetap dilewati sama seperti
    konfirmasi_posting_massal() -- alasan sama: akun lawannya belum pasti,
    tidak boleh ikut diposting otomatis.

    [FIX -- posting massal gagal diam-diam untuk data sangat besar]
    Sebelumnya SEMUA posting_ids dimasukkan ke SATU query `id.in_(...)`.
    SQLite (dan beberapa database lain) punya batas jumlah parameter per
    query (SQLITE_MAX_VARIABLE_NUMBER, umumnya ~999) -- begitu user
    mengimpor & posting puluhan ribu baris sekaligus (mis. tombol
    "Posting Semua" dipakai atas seluruh tabel Transaksi), query ini akan
    gagal total dengan `too many SQL variables`, ketangkap oleh except di
    bawah, dan mengembalikan diposting=0 tanpa penjelasan ke frontend --
    persis pola silent-failure yang sama dengan temuan limit 500 di
    daftar_jurnal_posting(). Sekarang posting_ids diproses per KELOMPOK
    kecil (_UKURAN_BATCH_IN id sekaligus) supaya tidak pernah menyentuh
    batas itu, berapa pun banyaknya baris yang mau diposting sekaligus.

    Return: {"diposting": ..., "dilewati_placeholder": ..., "tidak_ditemukan": ...}
    """
    if not posting_ids:
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}

    _UKURAN_BATCH_IN = 500  # jauh di bawah batas SQLite (~999) supaya aman di semua konfigurasi
    session = SessionLocal()
    try:
        ditemukan_ids: set = set()
        diposting = 0
        dilewati = 0
        sekarang = datetime.now()

        for awal in range(0, len(posting_ids), _UKURAN_BATCH_IN):
            kelompok_id = posting_ids[awal:awal + _UKURAN_BATCH_IN]
            rows = session.query(JurnalPosting).filter(
                JurnalPosting.client_id == client_id,
                JurnalPosting.id.in_(kelompok_id),
                JurnalPosting.status == "draft",
            ).all()
            for j in rows:
                ditemukan_ids.add(j.id)
                if j.sumber_placeholder:
                    dilewati += 1
                    continue
                j.status = "terposting"
                j.diposting_oleh = user
                j.diposting_at = sekarang
                diposting += 1

        tidak_ditemukan = len(set(posting_ids) - ditemukan_ids)
        session.commit()
        return {"diposting": diposting, "dilewati_placeholder": dilewati, "tidak_ditemukan": tidak_ditemukan}
    except Exception as e:
        session.rollback()
        print(f"Error konfirmasi posting by ids: {e}")
        return {"diposting": 0, "dilewati_placeholder": 0, "tidak_ditemukan": 0}
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


def konfirmasi_posting_massal(client_id: str, hasil_id: int, user: str) -> Dict[str, int]:
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


def ambil_jurnal_posting_by_hasil(client_id: str, hasil_id: int) -> List[Dict[str, Any]]:
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


def ambil_jurnal_terposting(client_id: str, tanggal_mulai: Optional[str] = None,
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


def hitung_jurnal_perlu_posting(client_id: str) -> int:
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

def simpan_laporan_keuangan(client_id: str, periode: str, data: Dict[str, Any],
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


def ambil_laporan_keuangan_terbaru(client_id: str, periode: str) -> Optional[Dict[str, Any]]:
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


def daftar_riwayat_laporan_keuangan(client_id: str, periode: Optional[str] = None) -> List[Dict[str, Any]]:
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
def hitung_signature_data_laporan(client_id: str, tahun: Optional[int] = None) -> str:
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
    client_id: str,
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


def ambil_riwayat_saldo_bulanan(client_id: str, no_akun: str, tahun: int) -> List[Dict[str, Any]]:
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
    client_id: str, tahun: int, no_akun: Optional[str] = None, kategori: Optional[str] = None,
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
    client_id: str, tahun: int, pola_no_akun: Optional[str] = None, kategori: Optional[str] = None,
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

# ============================================================
# ACCOUNTING CORE / SECURITY HELPERS
# ============================================================

def user_has_client_access(user_id: Optional[str], client_id: str, role: Optional[str] = None) -> bool:
    """Return True jika user boleh mengakses client. tahap_5 & super_admin
    (lihat RBAC.md) = superuser, selalu lolos ke SEMUA client.

    Untuk role selain itu, production harus memiliki baris aktif di
    user_client_access. Development anonymous user (id=0, tahap_5) tetap bisa
    bekerja ketika ALLOW_ANONYMOUS_DEV aktif di modules/auth/core.py.

    user_id sekarang UUID (str) -- id user dev anonymous (0) SENGAJA bukan
    UUID valid, tapi tidak pernah dipakai untuk query di sini karena
    role-nya selalu "tahap_5" (short-circuit di baris pertama di atas).
    """
    if role in ("tahap_5", "super_admin"):
        return True
    if not user_id:
        return False
    session = SessionLocal()
    try:
        row = session.query(UserClientAccess).filter(
            UserClientAccess.user_id == user_id,
            UserClientAccess.client_id == client_id,
            UserClientAccess.active.is_(True),
        ).first()
        return row is not None
    except Exception:
        session.rollback()
        return False
    finally:
        session.close()


def set_user_client_access(user_id: str, client_id: str, active: bool = True,
                           access_role: Optional[str] = None) -> bool:
    session = SessionLocal()
    try:
        row = session.query(UserClientAccess).filter(
            UserClientAccess.user_id == user_id,
            UserClientAccess.client_id == client_id,
        ).first()
        if row is None:
            row = UserClientAccess(user_id=user_id, client_id=client_id, active=active, access_role=access_role)
            session.add(row)
        else:
            row.active = active
            row.access_role = access_role or row.access_role
        session.commit()
        return True
    except Exception:
        session.rollback()
        return False
    finally:
        session.close()


def get_user_client_access(user_id: Optional[str], client_id: str) -> Optional[Dict[str, Any]]:
    """Baris akses AKTIF milik 1 user ke 1 client tertentu, atau None kalau
    tidak ada -- dipakai modules/auth/core.py::require_client_level() untuk
    baca access_role (org_owner..viewer, lihat RBAC.md) user ini di client
    ini secara spesifik (beda dari user_has_client_access() yang cuma
    balikin True/False tanpa peduli access_role-nya apa)."""
    if not user_id:
        return None
    session = SessionLocal()
    try:
        row = session.query(UserClientAccess).filter(
            UserClientAccess.user_id == user_id,
            UserClientAccess.client_id == client_id,
            UserClientAccess.active.is_(True),
        ).first()
        if row is None:
            return None
        return {"access_role": row.access_role, "active": row.active}
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def daftar_akses_client(client_id: str) -> List[Dict[str, Any]]:
    """Semua user (yang aksesnya masih aktif) yang punya akses ke 1 client
    tertentu -- kebalikan dari daftar_user_client_access() (yang per-user,
    dipakai company switcher). Dipakai GET /api/client/{client_id}/access
    untuk menampilkan siapa saja yang sudah diberi akses & access_role apa."""
    session = SessionLocal()
    try:
        rows = session.query(UserClientAccess, User).join(
            User, UserClientAccess.user_id == User.id_user
        ).filter(
            UserClientAccess.client_id == client_id,
            UserClientAccess.active.is_(True),
        ).all()
        return [
            {
                "user_id": access.user_id,
                "username": u.username,
                "nama": u.nama_user,
                "access_role": access.access_role,
            }
            for access, u in rows
        ]
    finally:
        session.close()


def daftar_user_client_access(user_id: str) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        rows = session.query(UserClientAccess, Client).join(
            Client, UserClientAccess.client_id == Client.id
        ).filter(UserClientAccess.user_id == user_id, UserClientAccess.active.is_(True)).all()
        return [
            {"client_id": access.client_id, "client_name": client.nama, "access_role": access.access_role}
            for access, client in rows
        ]
    finally:
        session.close()