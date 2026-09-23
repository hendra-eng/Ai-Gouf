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
from decimal import Decimal
from typing import Optional, List, Dict, Any

import pandas as pd
from sqlalchemy import (
    create_engine, Column, Integer, BigInteger, String, DateTime,
    Text, Float, Boolean, ForeignKey, ForeignKeyConstraint, text, UniqueConstraint, Index,
    Numeric, Date, func, JSON,  # dipakai hitung_signature_data_laporan() (MAX/COUNT agregat)
    LargeBinary,  # dipakai AuditEvidenceRow.file_content (bytea)
    Computed,  # dipakai financial_transaction_sales_invoices.outstanding_amount (GENERATED ALWAYS AS)
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship

# ============================================================
# KONFIGURASI DATABASE
# ============================================================

# [FIX] Backend sekarang FastAPI + React (bukan Streamlit lagi), jadi
# konfigurasi cukup dibaca langsung dari environment variable. Nilainya
# datang dari file .env yang di-load oleh load_dotenv() di main.py,
# SEBELUM modul ini di-import -- lihat catatan di main.py.
#
# [FIX v6] SEBELUMNYA baris ini fallback diam-diam ke
# "sqlite:///ai_gouf.db" kalau DATABASE_URL tidak ke-set (mis. file .env
# belum dibuat, salah lokasi, atau load_dotenv() gagal). Akibatnya
# backend tetap START NORMAL tanpa error apa pun, tapi diam-diam nulis
# semua data ke file SQLite lokal, bukan ke Supabase -- baru ketahuan
# belakangan setelah data "hilang"/tidak sinkron. Sekarang kalau
# DATABASE_URL tidak ada, langsung raise di sini supaya backend GAGAL
# START dengan jelas, bukan jalan diam-diam pakai config yang salah.
#
# Kalau memang mau sengaja pakai SQLite lokal (mis. dev tanpa server
# Postgres), set eksplisit di .env: DATABASE_URL=sqlite:///ai_gouf.db
# -- itu tetap didukung, yang dihapus cuma fallback DIAM-DIAMnya.
def get_database_url():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL tidak diset! Backend tidak lagi fallback diam-diam "
            "ke SQLite lokal. Buat file backend/.env (contoh di "
            "backend/.env.example) dan isi DATABASE_URL ke Supabase, atau "
            "set eksplisit ke sqlite:///ai_gouf.db kalau memang mau lokal."
        )
    return url

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
    assigned_accountant = Column("akuntan_penanggung_jawab", PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)    contact_name = Column("nama_pic", String(255), nullable=True)
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
    dibuat_oleh = Column("created_by", PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    diperbarui_oleh = Column("edited_by", PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)    # [BARU] hanya dipakai sementara untuk backfill migrasi -- lihat
    # migration_uuid_client_id.sql (old_client_id = id integer lama).
    old_client_id = Column(Integer, nullable=True)
    # [BARU] logo perusahaan (data URL base64, maks ~400KB) untuk kop
    # dokumen cetak -- lihat root/ddl-table & clients_v1.py.
    logo = Column(Text, nullable=True)

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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("coa.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("account_roles.id"), nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("coa.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    approved_by = Column(String(100), nullable=True)
    posted_by = Column(String(100), nullable=True)
    posted_at = Column(DateTime, nullable=True)
    reversed_from_id = Column(PG_UUID(as_uuid=False), ForeignKey("journal_entries.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column("edited_at", DateTime, default=datetime.now, onupdate=datetime.now)


class JournalLine(Base):
    """Baris debit/kredit resmi. Nilai uang memakai NUMERIC, bukan Float.

    [SESUAI DB] Tabel fisik journal_lines TIDAK punya kolom account_code,
    account_name, standard_account_id, standard_account_code, account_role, dan
    kolom waktunya bernama `dibuat_at`. Akun kini selalu lewat `coa_id`
    (NOT NULL). Atribut lama (account_code/account_name/...) tetap tersedia
    sebagai property supaya kode pemanggil tidak perlu berubah: dibaca dari
    relasi `coa`; nilai yang di-set saat konstruksi tidak disimpan ke DB.
    """
    __tablename__ = "journal_lines"
    __table_args__ = (
        UniqueConstraint("journal_entry_id", "line_no", name="uq_journal_line_entry_no"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    journal_entry_id = Column(PG_UUID(as_uuid=False), ForeignKey("journal_entries.id"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    line_no = Column(Integer, nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("coa.id"), nullable=False)
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
    created_at = Column(DateTime(timezone=True), default=datetime.now)  # [SESUAI DB] dulu bernama dibuat_at, sudah distandarkan jadi created_at

    coa = relationship("Coa", lazy="joined", foreign_keys=[coa_id])

    # ---- property kompatibilitas (tidak ada kolom fisiknya) ----
    @property
    def account_code(self):
        v = self.__dict__.get("_compat_account_code")
        if v is not None:
            return v
        return self.coa.no_akun if self.coa is not None else None

    @account_code.setter
    def account_code(self, value):
        self.__dict__["_compat_account_code"] = value

    @property
    def account_name(self):
        v = self.__dict__.get("_compat_account_name")
        if v is not None:
            return v
        return self.coa.nama_akun if self.coa is not None else None

    @account_name.setter
    def account_name(self, value):
        self.__dict__["_compat_account_name"] = value

    @property
    def standard_account_id(self):
        return self.__dict__.get("_compat_standard_account_id")

    @standard_account_id.setter
    def standard_account_id(self, value):
        self.__dict__["_compat_standard_account_id"] = value

    @property
    def standard_account_code(self):
        return self.__dict__.get("_compat_standard_account_code")

    @standard_account_code.setter
    def standard_account_code(self, value):
        self.__dict__["_compat_standard_account_code"] = value

    @property
    def account_role(self):
        return self.__dict__.get("_compat_account_role")

    @account_role.setter
    def account_role(self, value):
        self.__dict__["_compat_account_role"] = value


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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    id_user = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=False)    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    updated_at = Column("edited_at", DateTime(timezone=True), server_default=text("now()"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)

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
    # [BARU] kolom audit & relasi client tunggal, ditambahkan di migrasi
    # management_users terbaru.
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=True)    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)


# [DIHAPUS] class ManagementClient & ManagementAuditTrail (dari playground-willi)
# duplikat pemetaan ke tabel yang sama dengan Client (di atas) & AuditLog (di
# bawah) -- dikonsolidasikan ke Client/AuditLog karena keduanya jauh lebih
# terintegrasi (dipakai main.py + 16 relationship lain). Fungsi CRUD
# create_management_client/list_management_clients/dst di bawah sekarang
# jalan di atas Client, bukan class terpisah lagi.


# ============================================================
# TRANSACTIONS > SALES -- DDL: root/ddl-table (bagian
# "FITUR TRANSACTIONS > SALES"), lihat komentar panjang di sana untuk
# alasan desain (kenapa 1 tabel invoice dipakai 3 tab sekaligus, kenapa
# tidak ada tabel customer master, dst). client_id di SELURUH tabel di
# bawah reference ke management_users(id_user) -- BUKAN management_clients
# ataupun clients(id) lama -- karena akun client (client_lv_1..9, lihat
# RBAC.md) direpresentasikan sebagai baris management_users itu sendiri.
# ============================================================

class SalesSourceFile(Base):
    """File yang diupload di tab "Source Data" + hasil ekstraksi/mapping AI."""
    __tablename__ = "financial_transaction_sales_source_files"
    __table_args__ = (
        Index("idx_sales_source_files_client", "client_id"),
        Index("idx_sales_source_files_management_client", "management_client_id"),
        Index("idx_sales_source_files_template", "template_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    # [BARU] Klien (perusahaan) yang laporannya sedang diupload -- WAJIB
    # diisi user lewat dropdown saat upload (lihat SALES_IMPORT_TEMPLATES.md
    # di root). BEDA dari client_id di atas (management_users, akun yang
    # login/upload) -- ini dipakai sebagai key pencocokan/pembuatan
    # template di SalesImportTemplate.
    management_client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    file_name = Column(String(255), nullable=False)
    file_type = Column(String(20), nullable=True)
    storage_path = Column(Text, nullable=True)
    period_label = Column(String(50), nullable=True)
    customer_hint = Column(String(255), nullable=True)
    rows_detected = Column(Integer, nullable=False, default=0)
    rows_valid = Column(Integer, nullable=False, default=0)
    rows_invalid = Column(Integer, nullable=False, default=0)
    duplicate_count = Column(Integer, nullable=False, default=0)
    status_ekstraksi = Column(String(20), nullable=False, default="Diproses")
    status_mapping = Column(String(20), nullable=False, default="Diproses")
    confidence_score = Column(Numeric(5, 2), nullable=True)
    dpp_total = Column(Numeric(24, 2), nullable=False, default=0)
    ppn_total = Column(Numeric(24, 2), nullable=False, default=0)
    grand_total = Column(Numeric(24, 2), nullable=False, default=0)
    extraction_duration_ms = Column(Integer, nullable=True)
    ai_model_version = Column(String(50), nullable=True)
    mapping_rules = Column(JSONB, nullable=True)
    # [BARU] Template pola kolom yang dipakai/cocok untuk file ini (lihat
    # SalesImportTemplate di bawah) -- NULL kalau belum ada template yang
    # cocok, atau kalau file jenis ini (mis. PDF) belum didukung
    # pembelajaran pola.
    template_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_import_templates.id"), nullable=True)
    processed_by = Column(String(255), nullable=True)
    uploaded_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    uploaded_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesSourceRow(Base):
    """Baris mentah per file (hasil parsing sebelum jadi invoice resmi)."""
    __tablename__ = "financial_transaction_sales_source_rows"
    __table_args__ = (
        UniqueConstraint("source_file_id", "row_no", name="uq_sales_source_rows_file_row"),
        Index("idx_sales_source_rows_file", "source_file_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    source_file_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_source_files.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    row_no = Column(Integer, nullable=False)
    tanggal = Column(Date, nullable=True)
    no_invoice = Column(String(100), nullable=True)
    nama_customer = Column(String(255), nullable=True)
    cabang = Column(String(100), nullable=True)
    dpp = Column(Numeric(24, 2), nullable=False, default=0)
    ppn = Column(Numeric(24, 2), nullable=False, default=0)
    total = Column(Numeric(24, 2), nullable=False, default=0)
    is_valid = Column(Boolean, nullable=False, default=True)
    validation_notes = Column(Text, nullable=True)
    is_duplicate_candidate = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesInvoice(Base):
    """Entitas inti: satu baris = satu invoice/transaksi penjualan. Dipakai
    bersama oleh tab Sales Transaction, Journal Preview, dan Posted."""
    __tablename__ = "financial_transaction_sales_invoices"
    __table_args__ = (
        UniqueConstraint("client_id", "invoice_no", name="uq_sales_invoices_client_no"),
        Index("idx_sales_invoices_client_status", "client_id", "posting_status"),
        Index("idx_sales_invoices_client_date", "client_id", "invoice_date"),
        Index("idx_sales_invoices_client_cabang", "client_id", "cabang"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    invoice_no = Column(String(100), nullable=False)
    invoice_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    customer_name = Column(String(255), nullable=False)
    customer_npwp = Column(String(30), nullable=True)
    description = Column(Text, nullable=True)
    transaction_type = Column(String(50), nullable=True)
    project_name = Column(String(255), nullable=True)
    sales_person = Column(String(255), nullable=True)
    term_of_payment = Column(String(50), nullable=True)
    # Cabang tempat transaksi terjadi (teks bebas, mis. "Jakarta"). NULL =
    # belum ditentukan. Ditambahkan lewat migrations/add_cabang_to_sales_invoices.py.
    cabang = Column(String(100), nullable=True)
    dpp = Column(Numeric(24, 2), nullable=False, default=0)
    ppn = Column(Numeric(24, 2), nullable=False, default=0)
    pph = Column(Numeric(24, 2), nullable=False, default=0)
    gross_amount = Column(Numeric(24, 2), nullable=False, default=0)
    paid_amount = Column(Numeric(24, 2), nullable=False, default=0)
    outstanding_amount = Column(Numeric(24, 2), Computed("gross_amount - paid_amount", persisted=True))
    tax_invoice_status = Column(String(30), nullable=False, default="Belum Terbit Faktur")
    posting_status = Column(String(20), nullable=False, default="Draft")
    reconcile_status = Column(String(20), nullable=False, default="Unreconciled")
    journal_sync_status = Column(String(20), nullable=False, default="Pending")
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    source_row_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_source_rows.id"), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    posted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesAccountMapping(Base):
    """Pemetaan akun (Piutang/Pendapatan/PPN/PPh) per invoice -- 1:1, tab
    "Accounting Classification" di Journal Preview."""
    __tablename__ = "financial_transaction_sales_account_mappings"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    invoice_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_invoices.id", ondelete="CASCADE"), nullable=False, unique=True)
    piutang_account_code = Column(String(50), nullable=False)
    piutang_account_name = Column(String(200), nullable=True)
    pendapatan_account_code = Column(String(50), nullable=False)
    pendapatan_account_name = Column(String(200), nullable=True)
    ppn_account_code = Column(String(50), nullable=True)
    ppn_account_name = Column(String(200), nullable=True)
    pph_account_code = Column(String(50), nullable=True)
    pph_account_name = Column(String(200), nullable=True)
    is_ai_suggested = Column(Boolean, nullable=False, default=True)
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    mapped_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    mapped_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesException(Base):
    """Antrean review tab "Exceptions" -- transaksi/baris sumber yang
    perlu ditinjau manusia sebelum lanjut diposting."""
    __tablename__ = "financial_transaction_sales_exceptions"
    __table_args__ = (
        Index("idx_sales_exceptions_client_status", "client_id", "status"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    invoice_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_invoices.id"), nullable=True)
    source_row_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_source_rows.id"), nullable=True)
    exception_type = Column(String(100), nullable=False)
    priority = Column(String(10), nullable=False, default="Medium")
    status = Column(String(20), nullable=False, default="Open")
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    ai_suggestion = Column(Text, nullable=True)
    source_snippet = Column(JSONB, nullable=True)
    assigned_to = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesActivityLog(Base):
    """Jejak aktivitas khusus modul Sales (mis. "Aktivitas Posting
    Terbaru" di tab Posted) -- levelnya per-invoice/per-jurnal, beda dari
    management_audit_trails yang levelnya per-user/menu."""
    __tablename__ = "financial_transaction_sales_activity_log"
    __table_args__ = (
        Index("idx_sales_activity_log_invoice", "invoice_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    invoice_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_invoices.id"), nullable=True)
    event_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)
    performed_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class SalesImportTemplate(Base):
    """Pola kolom file laporan penjualan (CSV/Excel) yang sudah "dipelajari"
    untuk 1 klien -- dipakai ulang otomatis (tanpa panggil AI lagi) begitu
    file berikutnya dari klien+format yang sama diupload. Lihat
    SALES_IMPORT_TEMPLATES.md di root untuk alur lengkapnya.

    client_id di sini SENGAJA reference ke management_clients (BUKAN
    management_users seperti tabel Sales lain) -- pola kolom laporan
    adalah properti PERUSAHAAN klien itu sendiri, bukan akun yang
    kebetulan login & upload.
    """
    __tablename__ = "financial_transaction_sales_import_templates"
    __table_args__ = (
        UniqueConstraint("client_id", "file_type", "column_signature_hash", name="uq_sales_import_templates_signature"),
        Index("idx_sales_import_templates_client", "client_id"),
        Index("idx_sales_import_templates_client_code", "client_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    client_code = Column(String(50), nullable=False)
    file_type = Column(String(20), nullable=False)
    sheet_name = Column(String(255), nullable=True)
    header_row_index = Column(Integer, nullable=False, default=1)
    data_start_row_index = Column(Integer, nullable=False, default=2)
    column_signature_hash = Column(String(64), nullable=False)
    header_columns = Column(JSONB, nullable=False)
    mapping_rules = Column(JSONB, nullable=False)
    detected_by = Column(String(20), nullable=False, default="ai")
    ai_model_version = Column(String(50), nullable=True)
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    usage_count = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


# ============================================================
# FITUR TRANSACTIONS > JOURNAL ENTRY (DDL: root/ddl-table bagian "FITUR
# TRANSACTIONS > JOURNAL ENTRY", frontend: src/app/transactions/
# journal-entry/*). Pola sama persis dengan 6 tabel Sales di atas --
# client_id reference ke management_users(id_user), audit columns
# created_at/by, edited_at/by, deleted_at/by.
# ============================================================

class JournalEntrySourceRecord(Base):
    """Registri transaksi dari modul lain (Sales/Purchase/Payroll/Bank/
    Cash/Expense/Inventory/Fixed Assets/Tax/Manual) yang berpotensi/sudah
    dijadikan Journal Entry -- tab "Source Data"."""
    __tablename__ = "financial_transaction_journal_entry_source_records"
    __table_args__ = (
        UniqueConstraint("client_id", "source_code", name="uq_je_source_records_client_code"),
        Index("idx_je_source_records_client_status", "client_id", "mapping_status"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    source_code = Column(String(100), nullable=False)
    source_type = Column(String(20), nullable=False)
    source_date = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    amount = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="IDR")
    related_account_code = Column(String(50), nullable=True)
    related_account_name = Column(String(200), nullable=True)
    party_name = Column(String(255), nullable=True)
    mapping_status = Column(String(20), nullable=False, default="Imported")
    sync_status = Column(String(20), nullable=False, default="Manual")
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class JournalEntryDraft(Base):
    """Entitas inti: header Journal Entry (draft sampai benar-benar
    diposting ke journal_entries native/Accounting Core V2). Dipakai
    bersama oleh tab JE Transaction, Journal Preview, Exceptions (via
    query), dan Posted."""
    __tablename__ = "financial_transaction_journal_entry_drafts"
    __table_args__ = (
        UniqueConstraint("client_id", "je_number", name="uq_je_drafts_client_number"),
        Index("idx_je_drafts_client_status", "client_id", "status"),
        Index("idx_je_drafts_client_date", "client_id", "entry_date"),
        Index("idx_je_drafts_source_record", "source_record_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    je_number = Column(String(100), nullable=False)
    entry_date = Column(Date, nullable=False)
    posting_date = Column(Date, nullable=True)
    period_label = Column(String(50), nullable=False)
    description = Column(Text, nullable=True)
    source_type = Column(String(20), nullable=False, default="Manual")
    source_reference = Column(String(100), nullable=True)
    source_record_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_journal_entry_source_records.id"), nullable=True)
    total_debit = Column(Numeric(24, 2), nullable=False, default=0)
    total_credit = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="IDR")
    status = Column(String(20), nullable=False, default="draft")
    created_by_name = Column(String(255), nullable=True)
    reviewed_by_name = Column(String(255), nullable=True)
    approved_by_name = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    posted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class JournalEntryDraftLine(Base):
    """Baris debit/kredit per draft (tab Journal Preview & detail panel).
    Begitu draft diposting, baris ini DICERMINKAN jadi journal_lines resmi
    (Accounting Core V2), bukan dipindah/dihapus -- draft tetap tersimpan
    sbg riwayat."""
    __tablename__ = "financial_transaction_journal_entry_draft_lines"
    __table_args__ = (
        UniqueConstraint("draft_id", "line_no", name="uq_je_draft_lines_draft_no"),
        Index("idx_je_draft_lines_draft", "draft_id"),
        Index("idx_je_draft_lines_client_account", "client_id", "account_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    draft_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_journal_entry_drafts.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    line_no = Column(Integer, nullable=False)
    account_code = Column(String(50), nullable=False)
    account_name = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    debit = Column(Numeric(24, 2), nullable=False, default=0)
    credit = Column(Numeric(24, 2), nullable=False, default=0)
    cost_center = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class JournalEntryActivityLog(Base):
    """Jejak aktivitas khusus modul Journal Entry (tab Overview -> "Recent
    Activity"). Sama perannya dgn SalesActivityLog -- append-only."""
    __tablename__ = "financial_transaction_journal_entry_activity_log"
    __table_args__ = (
        Index("idx_je_activity_log_draft", "draft_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    draft_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_journal_entry_drafts.id"), nullable=True)
    je_number = Column(String(100), nullable=True)
    event_type = Column(String(50), nullable=False)
    description = Column(Text, nullable=False)
    status_snapshot = Column(String(20), nullable=True)
    performed_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class JournalEntryImportTemplate(Base):
    """Pola kolom file laporan jurnal (CSV/Excel) yang sudah "dipelajari"
    untuk 1 klien -- dipakai ulang otomatis (tanpa mengulang analisis
    manual) begitu file berikutnya dari klien+format yang sama diupload.
    Bentuk & peran PERSIS sama dengan SalesImportTemplate (lihat
    SALES_IMPORT_TEMPLATES.md di root untuk alur lengkapnya), cuma versi
    Journal Entry -- sengaja tabel TERPISAH (bukan dipakai bersama dengan
    financial_transaction_sales_import_templates) supaya pola kolom Sales
    dan Journal Entry tidak saling bentrok/mencemari pencocokan satu sama
    lain walau kebetulan sama-sama milik klien yang sama.

    client_id di sini SENGAJA reference ke management_clients (BUKAN
    management_users seperti 4 tabel Journal Entry lain) -- pola kolom
    laporan adalah properti PERUSAHAAN klien itu sendiri, bukan akun yang
    kebetulan login & upload. Alasan sama persis dengan SalesImportTemplate.
    """
    __tablename__ = "financial_transaction_journal_entry_import_templates"
    __table_args__ = (
        UniqueConstraint("client_id", "file_type", "column_signature_hash", name="uq_je_import_templates_signature"),
        Index("idx_je_import_templates_client", "client_id"),
        Index("idx_je_import_templates_client_code", "client_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    client_code = Column(String(50), nullable=False)
    file_type = Column(String(20), nullable=False)
    sheet_name = Column(String(255), nullable=True)
    header_row_index = Column(Integer, nullable=False, default=1)
    data_start_row_index = Column(Integer, nullable=False, default=2)
    column_signature_hash = Column(String(64), nullable=False)
    header_columns = Column(JSONB, nullable=False)
    mapping_rules = Column(JSONB, nullable=False)
    detected_by = Column(String(20), nullable=False, default="ai")
    ai_model_version = Column(String(50), nullable=True)
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    usage_count = Column(Integer, nullable=False, default=0)
    last_used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


# ============================================================
# FITUR TRANSACTIONS > PURCHASE (DDL: root/ddl-table bagian "FITUR
# TRANSACTIONS > PURCHASE", frontend: src/app/transactions/purchase/*).
# Pola gabungan Sales (entitas inti 1 tabel dipakai lintas-tab) & Journal
# Entry (source record registri + child lines + exceptions bertabel
# sendiri) -- lihat komentar lengkap di kepala bagian DDL-nya.
# ============================================================

class PurchaseSourceRecord(Base):
    """Registri transaksi sumber (PO/Vendor Invoice/Goods Receipt/dst)
    yang berpotensi/sudah dijadikan Purchase Transaction -- tab "Source
    Data"."""
    __tablename__ = "financial_transaction_purchase_source_records"
    __table_args__ = (
        UniqueConstraint("client_id", "source_code", name="uq_purchase_source_records_client_code"),
        Index("idx_purchase_source_records_client_status", "client_id", "status"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    source_code = Column(String(100), nullable=False)
    source_type = Column(String(30), nullable=False)
    vendor_name = Column(String(255), nullable=False)
    vendor_code = Column(String(50), nullable=True)
    source_date = Column(Date, nullable=True)
    invoice_number = Column(String(100), nullable=True)
    po_number = Column(String(100), nullable=True)
    description = Column(Text, nullable=True)
    amount = Column(Numeric(24, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(24, 2), nullable=False, default=0)
    total_amount = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="USD")
    status = Column(String(20), nullable=False, default="Imported")
    validation_status = Column(String(20), nullable=False, default="Pending Validation")
    period_label = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class PurchaseTransaction(Base):
    """Entitas inti: header Purchase Transaction. Dipakai bersama oleh tab
    Purchase Transaction, Purchase Preview, dan Posted."""
    __tablename__ = "financial_transaction_purchase_transactions"
    __table_args__ = (
        UniqueConstraint("client_id", "purchase_no", name="uq_purchase_transactions_client_no"),
        Index("idx_purchase_transactions_client_status", "client_id", "status"),
        Index("idx_purchase_transactions_client_date", "client_id", "purchase_date"),
        Index("idx_purchase_transactions_client_vendor", "client_id", "vendor_name"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    purchase_no = Column(String(100), nullable=False)
    purchase_date = Column(Date, nullable=False)
    invoice_date = Column(Date, nullable=True)
    invoice_number = Column(String(100), nullable=True)
    po_number = Column(String(100), nullable=True)
    vendor_name = Column(String(255), nullable=False)
    vendor_code = Column(String(50), nullable=True)
    source_doc_type = Column(String(30), nullable=False, default="Manual")
    source_ref = Column(String(100), nullable=True)
    source_record_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_source_records.id"), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=True)
    subtotal = Column(Numeric(24, 2), nullable=False, default=0)
    discount = Column(Numeric(24, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(24, 2), nullable=False, default=0)
    total = Column(Numeric(24, 2), nullable=False, default=0)
    accounts_payable = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="USD")
    payment_status = Column(String(20), nullable=False, default="unpaid")
    payment_terms = Column(String(50), nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), nullable=False, default="draft")
    period_label = Column(String(50), nullable=False)
    created_by_name = Column(String(255), nullable=True)
    approved_by_name = Column(String(255), nullable=True)
    posted_by_name = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    posting_date = Column(Date, nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class PurchaseTransactionLine(Base):
    """Baris item/jasa per transaksi (tab Purchase Transaction detail
    panel, Purchase Preview line items, Posted detail). Begitu transaksi
    diposting, baris ini DICERMINKAN jadi journal_lines resmi (Accounting
    Core V2), bukan dipindah/dihapus."""
    __tablename__ = "financial_transaction_purchase_transaction_lines"
    __table_args__ = (
        UniqueConstraint("transaction_id", "line_no", name="uq_purchase_transaction_lines_tx_no"),
        Index("idx_purchase_transaction_lines_tx", "transaction_id"),
        Index("idx_purchase_transaction_lines_client_account", "client_id", "account_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    transaction_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_transactions.id", ondelete="CASCADE"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    line_no = Column(Integer, nullable=False)
    item_code = Column(String(50), nullable=True)
    description = Column(Text, nullable=False)
    quantity = Column(Numeric(18, 4), nullable=False, default=0)
    unit = Column(String(20), nullable=True)
    unit_price = Column(Numeric(24, 2), nullable=False, default=0)
    discount = Column(Numeric(24, 2), nullable=False, default=0)
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(24, 2), nullable=False, default=0)
    subtotal = Column(Numeric(24, 2), nullable=False, default=0)
    total = Column(Numeric(24, 2), nullable=False, default=0)
    account_code = Column(String(50), nullable=False)
    account_name = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class PurchaseException(Base):
    """Antrean review tab "Exceptions" -- transaksi/source record
    pembelian yang perlu ditinjau manusia sebelum lanjut diposting.
    vendor_name/invoice_number/purchase_date/amount/currency adalah
    snapshot (denormalized), bukan join -- lihat catatan di DDL."""
    __tablename__ = "financial_transaction_purchase_exceptions"
    __table_args__ = (
        Index("idx_purchase_exceptions_client_status", "client_id", "status"),
        Index("idx_purchase_exceptions_transaction", "transaction_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    transaction_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_transactions.id"), nullable=True)
    source_record_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_source_records.id"), nullable=True)
    exception_type = Column(String(100), nullable=False)
    severity = Column(String(10), nullable=False, default="Medium")
    status = Column(String(30), nullable=False, default="Open")
    vendor_name = Column(String(255), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    purchase_date = Column(Date, nullable=True)
    amount = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="USD")
    description = Column(Text, nullable=False)
    detected_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    assigned_to = Column(String(255), nullable=True)
    resolution = Column(Text, nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    period_label = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class UserClientAccess(Base):
    """Pembatasan client per user. tahap_5 dapat full access; role lain wajib mapping di production."""
    __tablename__ = "user_client_access"
    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_user_client_access"),
        Index("idx_user_client_access_user", "user_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id"), nullable=False)    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    name = Column(String(200), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class PurchaseTransactionRow(Base):
    """Header transaksi Purchase (satu invoice/tagihan vendor)."""
    __tablename__ = "finance_transaction_purchase_transaction"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=False)  # mis. "PUR-2026-09-0001"
    vendor_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_transaction_purchase_vendor.id"), nullable=True)
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
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)
    # [SESUAI DB] kolom manual_status sudah ada di tabel fisik 3_Financial (nullable).
    manual_status = Column(String(30), nullable=True)


class PurchaseLineItemRow(Base):
    """Rincian barang/jasa per purchase_id (banyak baris per transaksi)."""
    __tablename__ = "finance_transaction_purchase_line_items"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class PurchaseJournalLineRow(Base):
    """
    Draf jurnal per purchase_id (satu baris = satu leg debit/kredit).
    Nama tabel fisik "purchase_journal_lines" -- lihat catatan rename di
    atas modul ini (sebelumnya salah dibuat sebagai "journal_entries").
    """
    __tablename__ = "finance_transaction_purchase_journal_lines"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    purchase_id = Column(String(100), nullable=True)
    reason = Column(String(255), nullable=True)
    severity = Column(String(30), nullable=True)
    exception_status = Column(String(30), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


# ============================================================
# DOCUMENTS -- schema "7_Management", tabel "management_documents"
# ============================================================
# [BARU] Tabel khusus untuk halaman Documents (src/app/documents/*), dibuat
# manual oleh user lewat Supabase SQL Editor -- sama pola dengan modul
# Purchase. Sebelum ini halaman Documents cuma menebak-nebak data dari
# tabel generik "hasil" (lihat komentar lama di
# src/app/documents/lib/useDocumentsData.ts). Field di sini sudah 1:1
# dengan tipe frontend FinancialDocument (src/lib/documentsMockData.tsx).
class DocumentRow(Base):
    __tablename__ = "management_documents"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=True)  # DocumentType: Invoice/Receipt/Bank Statement/dst
    file_format = Column(String(20), nullable=True)  # PDF/Excel/Image/CSV/Word
    file_size = Column(String(30), nullable=True)  # mis. "2.4 MB" -- disimpan sebagai teks, bukan angka
    storage_url = Column(Text, nullable=True)  # link file asli (mis. Supabase Storage), boleh kosong
    uploaded_by = Column(String(100), nullable=True)
    status = Column(String(30), nullable=True)  # Processed/Pending Review/Needs Attention/Archived
    tags = Column(String(255), nullable=True)  # disimpan sebagai 1 string dipisah koma, bukan array
    related_record = Column(String(200), nullable=True)  # mis. nomor invoice/PO terkait
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def ambil_data_documents(client_id: str) -> List[Dict[str, Any]]:
    """
    [BARU] Ambil seluruh baris tabel Documents (schema "7_Management") milik
    satu client. Dipetakan ke tipe FinancialDocument di frontend oleh
    src/app/documents/lib/documentsDbBridge.ts -- kalau nama/tipe field di
    sini diubah, sesuaikan juga di sana.
    """
    session = SessionLocal()
    try:
        rows = session.query(DocumentRow).filter(
            DocumentRow.client_id == client_id
        ).order_by(DocumentRow.created_at.desc()).all()

        def _iso(d):
            return d.isoformat() if d else None

        return [
            {
                "id": str(d.id),
                "name": d.name,
                "category": d.category,
                "file_format": d.file_format,
                "file_size": d.file_size,
                "storage_url": d.storage_url,
                "uploaded_by": d.uploaded_by,
                "status": d.status,
                "tags": d.tags,
                "related_record": d.related_record,
                "created_at": _iso(d.created_at),
                "updated_at": _iso(d.updated_at),
            }
            for d in rows
        ]
    finally:
        session.close()


# ============================================================
# REPORTS -- schema "7_Management", tabel "report_registry" & "report_schedule"
# ============================================================
# [BARU] Tabel khusus untuk halaman Reports (src/app/reports/*), dibuat
# manual oleh user lewat Supabase SQL Editor -- sama pola dengan Documents.
# Sebelum ini halaman Reports HANYA menggabung 3 sumber otomatis (riwayat
# generate Laporan Keuangan, CALK, PPh Badan -- lihat
# useReportsData.ts) dan tidak punya tempat utk kategori 'management',
# 'ar-ap', 'budget', 'audit', 'custom' (dipertahankan dari data contoh).
# report_registry mengisi celah itu: daftar laporan APAPUN kategorinya yang
# dicatat manual/oleh proses lain. report_schedule = jadwal laporan berkala
# (tab "Report Scheduler"), sebelumnya cuma state lokal di browser
# (initialScheduledReports), tidak pernah tersimpan ke database.
class ReportRegistryRow(Base):
    __tablename__ = "management_report_registry"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(50), nullable=False)  # financial-statements/management/tax/ar-ap/budget/audit/custom
    period = Column(String(50), nullable=True)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    formats = Column(String(100), nullable=True)  # disimpan sebagai 1 string dipisah koma, bukan array
    status = Column(String(30), nullable=True)  # ready/generating/scheduled/error
    file_size = Column(String(30), nullable=True)
    tags = Column(String(255), nullable=True)  # disimpan sebagai 1 string dipisah koma, bukan array
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class ReportScheduleRow(Base):
    __tablename__ = "management_report_schedule"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    report_name = Column(String(200), nullable=False)
    frequency = Column(String(20), nullable=False)  # Daily/Weekly/Monthly/Quarterly/Yearly
    recipients = Column(Text, nullable=True)  # 1 string dipisah koma (daftar email)
    format = Column(String(20), nullable=True)  # PDF/Excel/CSV/Word
    next_run = Column(Date, nullable=True)
    status = Column(String(20), nullable=True)  # Active/Paused/Error
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def ambil_data_report_registry(client_id: str) -> List[Dict[str, Any]]:
    """Daftar laporan tercatat manual/proses lain -- lihat komentar modul di atas."""
    session = SessionLocal()
    try:
        rows = session.query(ReportRegistryRow).filter(
            ReportRegistryRow.client_id == client_id
        ).order_by(ReportRegistryRow.created_at.desc()).all()

        def _iso(d):
            return d.isoformat() if d else None

        return [
            {
                "id": str(r.id), "name": r.name, "description": r.description,
                "category": r.category, "period": r.period,
                "created_by": r.created_by, "formats": r.formats,
                "status": r.status, "file_size": r.file_size, "tags": r.tags,
                "created_at": _iso(r.created_at), "updated_at": _iso(r.updated_at),
            }
            for r in rows
        ]
    finally:
        session.close()


def ambil_data_report_schedule(client_id: str) -> List[Dict[str, Any]]:
    """Jadwal laporan berkala (tab "Report Scheduler") -- lihat komentar modul di atas."""
    session = SessionLocal()
    try:
        rows = session.query(ReportScheduleRow).filter(
            ReportScheduleRow.client_id == client_id
        ).order_by(ReportScheduleRow.next_run).all()

        def _iso_date(d):
            return d.isoformat() if d else None

        return [
            {
                "id": str(r.id), "report_name": r.report_name,
                "frequency": r.frequency, "recipients": r.recipients,
                "format": r.format, "next_run": _iso_date(r.next_run),
                "status": r.status,
            }
            for r in rows
        ]
    finally:
        session.close()


# [BARU] Nilai kolom yang dibolehkan -- dipakai modules/management/documents_v1.py & reports_v1.py.
DOCUMENT_CATEGORY_VALID = {"Invoice", "Receipt", "Bank Statement", "Tax Document", "Contract", "Audit Evidence", "Financial Report", "Other"}
DOCUMENT_FORMAT_VALID = {"PDF", "Excel", "Image", "CSV", "Word"}
DOCUMENT_STATUS_VALID = {"Processed", "Pending Review", "Needs Attention", "Archived"}
REPORT_CATEGORY_VALID = {"financial-statements", "management", "tax", "ar-ap", "budget", "audit", "custom"}
REPORT_STATUS_VALID = {"ready", "generating", "scheduled", "error"}
REPORT_FORMAT_VALID = {"PDF", "Excel", "CSV", "Word"}
REPORT_FREQUENCY_VALID = {"Daily", "Weekly", "Monthly", "Quarterly", "Yearly"}
REPORT_SCHEDULE_STATUS_VALID = {"Active", "Paused", "Error"}


def tambah_dokumen(
    client_id: str, name: str, category: Optional[str] = None, file_format: Optional[str] = None,
    file_size: Optional[str] = None, storage_url: Optional[str] = None, tags: Optional[str] = None,
    related_record: Optional[str] = None, uploaded_by: Optional[str] = None,
) -> Dict[str, Any]:
    """[BARU] Catat 1 dokumen baru (tombol "Upload" di halaman Documents).

    File fisiknya sendiri TIDAK disimpan di sini -- `storage_url` diisi
    frontend setelah upload ke storage terpisah (mis. Supabase Storage).
    Kalau `storage_url` kosong, baris tetap dibuat (status default
    'Pending Review') supaya metadata dokumen tidak hilang; frontend boleh
    PATCH storage_url belakangan setelah upload selesai.
    """
    _ar_uuid(client_id, "Client")
    nama = (name or "").strip()
    if not nama:
        raise ValueError("Nama dokumen tidak boleh kosong.")
    if category and category not in DOCUMENT_CATEGORY_VALID:
        raise ValueError(f"Kategori tidak dikenal. Nilai sah: {sorted(DOCUMENT_CATEGORY_VALID)}.")
    if file_format and file_format not in DOCUMENT_FORMAT_VALID:
        raise ValueError(f"Format file tidak dikenal. Nilai sah: {sorted(DOCUMENT_FORMAT_VALID)}.")

    session = SessionLocal()
    try:
        row = DocumentRow(
            id=uuid.uuid4(), client_id=client_id, name=nama, category=category,
            file_format=file_format, file_size=(file_size or "").strip()[:30] or None,
            storage_url=storage_url, uploaded_by=(uploaded_by or "").strip()[:100] or None,
            status="Pending Review", tags=(tags or "").strip()[:255] or None,
            related_record=(related_record or "").strip()[:200] or None,
            created_at=datetime.now(), updated_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "name": row.name, "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_status_dokumen(client_id: str, document_id: str, status: str) -> Dict[str, Any]:
    """[BARU] Ubah status dokumen (mis. tandai 'Archived'/'Processed' setelah direview manual)."""
    _ar_uuid(client_id, "Client")
    doc_uuid = _ar_uuid(document_id, "Document")
    status_bersih = (status or "").strip()
    if status_bersih not in DOCUMENT_STATUS_VALID:
        raise ValueError(f"Status tidak dikenal. Nilai sah: {sorted(DOCUMENT_STATUS_VALID)}.")

    session = SessionLocal()
    try:
        row = session.query(DocumentRow).filter(
            DocumentRow.id == doc_uuid, DocumentRow.client_id == client_id
        ).with_for_update().first()
        if row is None:
            raise ValueError("Dokumen tidak ditemukan untuk client ini.")
        row.status = status_bersih
        row.updated_at = datetime.now()
        session.commit()
        return {"id": str(row.id), "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_report_registry(
    client_id: str, name: str, category: str, description: Optional[str] = None,
    period: Optional[str] = None, formats: Optional[str] = None, tags: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """[BARU] Catat 1 laporan baru ke registry (tombol "Create Report")."""
    _ar_uuid(client_id, "Client")
    nama = (name or "").strip()
    if not nama:
        raise ValueError("Nama laporan tidak boleh kosong.")
    kategori = (category or "").strip()
    if kategori not in REPORT_CATEGORY_VALID:
        raise ValueError(f"Kategori tidak dikenal. Nilai sah: {sorted(REPORT_CATEGORY_VALID)}.")
    if formats:
        for f in [x.strip() for x in formats.split(",") if x.strip()]:
            if f not in REPORT_FORMAT_VALID:
                raise ValueError(f"Format '{f}' tidak dikenal. Nilai sah: {sorted(REPORT_FORMAT_VALID)}.")

    session = SessionLocal()
    try:
        row = ReportRegistryRow(
            id=uuid.uuid4(), client_id=client_id, name=nama, description=description,
            category=kategori, period=(period or "").strip()[:50] or None,
            created_by=created_by, formats=formats, status="ready",
            tags=(tags or "").strip()[:255] or None,
            created_at=datetime.now(), updated_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "name": row.name, "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_report_schedule(
    client_id: str, report_name: str, frequency: str, recipients: Optional[str] = None,
    format: Optional[str] = None, next_run: Any = None,
) -> Dict[str, Any]:
    """[BARU] Buat 1 jadwal laporan berkala baru (tombol "Add Schedule")."""
    _ar_uuid(client_id, "Client")
    nama = (report_name or "").strip()
    if not nama:
        raise ValueError("Nama laporan tidak boleh kosong.")
    freq = (frequency or "").strip()
    if freq not in REPORT_FREQUENCY_VALID:
        raise ValueError(f"Frekuensi tidak dikenal. Nilai sah: {sorted(REPORT_FREQUENCY_VALID)}.")
    if format and format not in REPORT_FORMAT_VALID:
        raise ValueError(f"Format tidak dikenal. Nilai sah: {sorted(REPORT_FORMAT_VALID)}.")
    tgl_next_run = _ar_tanggal(next_run, "Next run") if next_run else None

    session = SessionLocal()
    try:
        row = ReportScheduleRow(
            id=uuid.uuid4(), client_id=client_id, report_name=nama, frequency=freq,
            recipients=recipients, format=format, next_run=tgl_next_run, status="Active",
            created_at=datetime.now(), updated_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "report_name": row.report_name, "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_status_report_schedule(client_id: str, schedule_id: str, status: str) -> Dict[str, Any]:
    """[BARU] Ubah status jadwal laporan (tombol "Pause"/"Resume" di tab Report Scheduler)."""
    _ar_uuid(client_id, "Client")
    sched_uuid = _ar_uuid(schedule_id, "Schedule")
    status_bersih = (status or "").strip()
    if status_bersih not in REPORT_SCHEDULE_STATUS_VALID:
        raise ValueError(f"Status tidak dikenal. Nilai sah: {sorted(REPORT_SCHEDULE_STATUS_VALID)}.")

    session = SessionLocal()
    try:
        row = session.query(ReportScheduleRow).filter(
            ReportScheduleRow.id == sched_uuid, ReportScheduleRow.client_id == client_id
        ).with_for_update().first()
        if row is None:
            raise ValueError("Jadwal laporan tidak ditemukan untuk client ini.")
        row.status = status_bersih
        row.updated_at = datetime.now()
        session.commit()
        return {"id": str(row.id), "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============================================================
# ACCOUNTS RECEIVABLE (AR) -- schema "3_Financial"
# ============================================================
# [BARU] Sebelumnya halaman Account Receivable (ARContent.tsx) tidak punya
# tabel sendiri sama sekali -- customer & invoice diturunkan langsung dari
# transaksi kelompok Sales lewat src/app/transactions/lib/arBridge.ts.
# Sekarang user sudah bikin 4 tabel AR resmi lewat Supabase (customer
# master + invoice + payment + collection note), jadi disambungkan di sini
# sebagai SUMBER KEDUA -- kalau client aktif sudah punya data di tabel ini,
# dipakai; kalau belum, tetap fallback ke arBridge.ts (pola "isSampleData"
# yang sama dengan modul Purchase/Tax/Budget). Lihat
# src/app/accounts-receivable/lib/arDbBridge.ts untuk sisi frontend.
class ARCustomerRow(Base):
    """Customer master modul AR (bukan customer umum -- khusus piutang)."""
    __tablename__ = "finance_account_receivable_ar_customer"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    customer_key = Column(String(100), nullable=False)
    name = Column(String(200), nullable=False)
    industry = Column(String(100), nullable=True)
    credit_limit = Column(Numeric(24, 2), nullable=False, default=0)
    account_manager = Column(String(100), nullable=True)
    payment_terms_days = Column(Integer, nullable=False, default=30)
    npwp = Column(String(30), nullable=True)
    alamat = Column(Text, nullable=True)
    aktif = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class ARInvoiceRow(Base):
    """Invoice/tagihan ke customer. Sisa tagihan dihitung dari ar_payment,
    BUKAN kolom tersimpan -- lihat ambil_data_ar()."""
    __tablename__ = "finance_account_receivable_ar_invoice"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    customer_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_account_receivable_ar_customer.id"), nullable=False)    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
    invoice_number = Column(String(100), nullable=False)
    invoice_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    amount = Column(Numeric(24, 2), nullable=False)
    # 'Disputed' / 'Written Off' -- override manual, status lain (Paid/
    # Overdue/Open/dst) dihitung otomatis dari due_date + ar_payment.
    manual_status = Column(String(20), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class ARPaymentRow(Base):
    """Pembayaran invoice. Satu invoice boleh punya banyak baris (cicilan)."""
    __tablename__ = "finance_account_receivable_ar_payment"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    invoice_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_account_receivable_ar_invoice.id"), nullable=False)    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(24, 2), nullable=False)
    method = Column(String(50), nullable=True)
    reference = Column(String(100), nullable=True)
    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class ARCollectionNoteRow(Base):
    """Catatan follow-up penagihan (telepon/email/kunjungan/dispute/dll)."""
    __tablename__ = "finance_account_receivable_ar_collection_note"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    customer_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_account_receivable_ar_customer.id"), nullable=False)
    invoice_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_account_receivable_ar_invoice.id"), nullable=True)    note_type = Column(String(50), nullable=False, default="general")
    content = Column(Text, nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


def ambil_data_ar(client_id: str) -> Dict[str, Any]:
    """
    [BARU] Ambil seluruh data modul Account Receivable (customer, invoice,
    payment, collection_note) milik satu client sebagai dict of
    list-of-dict -- pola sama dengan ambil_data_purchase(). Perhitungan
    status/outstanding/aging TIDAK dilakukan di sini (data mentah saja);
    dipetakan ke tipe Invoice/Customer frontend oleh
    src/app/accounts-receivable/lib/arDbBridge.ts.
    """
    session = SessionLocal()
    try:
        customer_rows = session.query(ARCustomerRow).filter(
            ARCustomerRow.client_id == client_id
        ).all()
        invoice_rows = session.query(ARInvoiceRow).filter(
            ARInvoiceRow.client_id == client_id
        ).order_by(ARInvoiceRow.invoice_date).all()
        payment_rows = session.query(ARPaymentRow).filter(
            ARPaymentRow.client_id == client_id
        ).order_by(ARPaymentRow.payment_date.desc(), ARPaymentRow.created_at.desc()).all()
        note_rows = session.query(ARCollectionNoteRow).filter(
            ARCollectionNoteRow.client_id == client_id
        ).order_by(ARCollectionNoteRow.created_at.desc()).all()

        def _iso(d):
            return d.isoformat() if d else None

        def _num(v):
            return float(v) if v is not None else 0.0

        return {
            "customer": [
                {
                    "id": str(c.id),
                    "customer_key": c.customer_key,
                    "name": c.name,
                    "industry": c.industry,
                    "credit_limit": _num(c.credit_limit),
                    "account_manager": c.account_manager,
                    "payment_terms_days": c.payment_terms_days,
                    "npwp": c.npwp,
                    "alamat": c.alamat,
                    "aktif": bool(c.aktif),
                }
                for c in customer_rows
            ],
            "invoice": [
                {
                    "id": str(i.id),
                    "customer_id": str(i.customer_id),
                    "invoice_number": i.invoice_number,
                    "invoice_date": _iso(i.invoice_date),
                    "due_date": _iso(i.due_date),
                    "amount": _num(i.amount),
                    "manual_status": i.manual_status,
                    "journal_entry_id": i.journal_entry_id,
                }
                for i in invoice_rows
            ],
            "payment": [
                {
                    "id": str(p.id),
                    "invoice_id": str(p.invoice_id),
                    "payment_date": _iso(p.payment_date),
                    "amount": _num(p.amount),
                    "method": p.method,
                    "reference": p.reference,
                    "created_by": p.created_by,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "journal_entry_id": p.journal_entry_id,
                }
                for p in payment_rows
            ],
            "collection_note": [
                {
                    "id": str(n.id),
                    "customer_id": str(n.customer_id),
                    "invoice_id": str(n.invoice_id) if n.invoice_id else None,
                    "note_type": n.note_type,
                    "content": n.content,
                    "created_by": n.created_by,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for n in note_rows
            ],
        }
    finally:
        session.close()


# ------------------------------------------------------------------
# [BARU] AR -- operasi TULIS (catat pembayaran, catatan penagihan, status
# manual invoice). Dipakai endpoint POST/PATCH /api/client/{id}/ar/... di
# main.py. Semua fungsi raise ValueError dengan pesan siap tampil ke user
# (main.py mengubahnya jadi HTTP 400). Database sendiri TIDAK membatasi total
# pembayaran, jadi aturan "tidak boleh melebihi sisa tagihan" dijaga di sini.
# ------------------------------------------------------------------
AR_MANUAL_STATUS_VALID = {"Disputed", "Written Off"}


def _ar_uuid(nilai: Any, label: str) -> uuid.UUID:
    try:
        return nilai if isinstance(nilai, uuid.UUID) else uuid.UUID(str(nilai))
    except (ValueError, AttributeError, TypeError):
        raise ValueError(f"{label} tidak valid.")


def _ar_tanggal(nilai: Any, label: str) -> date:
    if isinstance(nilai, datetime):
        return nilai.date()
    if isinstance(nilai, date):
        return nilai
    try:
        return datetime.strptime(str(nilai)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"{label} tidak valid (format YYYY-MM-DD).")


def catat_pembayaran_ar(
    client_id: str, invoice_id: str, payment_date: Any, amount: Any,
    method: Optional[str] = None, reference: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Catat satu pembayaran (boleh cicilan) untuk satu invoice AR.

    Aturan: nominal > 0; tanggal tidak boleh di masa depan / sebelum tanggal
    invoice; invoice bukan 'Written Off'; nominal tidak boleh melebihi sisa
    tagihan. Baris invoice dikunci (FOR UPDATE) supaya dua pembayaran yang
    masuk bersamaan tidak sama-sama lolos cek sisa tagihan.
    """
    from decimal import Decimal, InvalidOperation

    _ar_uuid(client_id, "Client")
    inv_uuid = _ar_uuid(invoice_id, "Invoice")
    try:
        nominal = Decimal(str(amount)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Nominal pembayaran tidak valid.")
    if nominal <= 0:
        raise ValueError("Nominal pembayaran harus lebih dari 0.")
    tgl = _ar_tanggal(payment_date, "Tanggal pembayaran")
    if tgl > date.today():
        raise ValueError("Tanggal pembayaran tidak boleh di masa depan.")

    session = SessionLocal()
    try:
        inv = session.query(ARInvoiceRow).filter(
            ARInvoiceRow.id == inv_uuid, ARInvoiceRow.client_id == client_id
        ).with_for_update().first()
        if inv is None:
            raise ValueError("Invoice tidak ditemukan untuk client ini.")
        if inv.manual_status == "Written Off":
            raise ValueError("Invoice sudah di-write-off, tidak bisa menerima pembayaran.")
        if tgl < inv.invoice_date:
            raise ValueError("Tanggal pembayaran tidak boleh sebelum tanggal invoice.")
        sudah_dibayar = session.query(func.coalesce(func.sum(ARPaymentRow.amount), 0)).filter(
            ARPaymentRow.invoice_id == inv.id
        ).scalar() or 0
        sisa = Decimal(str(inv.amount)) - Decimal(str(sudah_dibayar))
        if sisa <= 0:
            raise ValueError("Invoice ini sudah lunas.")
        if nominal > sisa:
            raise ValueError("Nominal melebihi sisa tagihan (sisa Rp " + f"{sisa:,.0f}".replace(",", ".") + ").")

        row = ARPaymentRow(
            id=uuid.uuid4(), client_id=client_id, invoice_id=inv.id, payment_date=tgl,
            amount=nominal, method=(method or "").strip()[:50] or None,
            reference=(reference or "").strip()[:100] or None,
            created_by=(created_by or "").strip()[:100] or None, created_at=datetime.now(),
        )
        session.add(row)
        inv.updated_at = datetime.now()
        session.commit()
        return {
            "id": str(row.id), "invoice_id": str(inv.id), "invoice_number": inv.invoice_number,
            "payment_date": tgl.isoformat(), "amount": float(nominal),
            "sisa_tagihan": float(sisa - nominal), "lunas": (sisa - nominal) <= 0,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_catatan_ar(
    client_id: str, customer_id: str, content: str, invoice_id: Optional[str] = None,
    note_type: Optional[str] = None, created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Tambah catatan penagihan (per customer, atau per invoice kalau invoice_id diisi)."""
    _ar_uuid(client_id, "Client")
    cust_uuid = _ar_uuid(customer_id, "Customer")
    isi = (content or "").strip()
    if not isi:
        raise ValueError("Isi catatan tidak boleh kosong.")
    if len(isi) > 4000:
        raise ValueError("Isi catatan terlalu panjang (maks 4000 karakter).")

    session = SessionLocal()
    try:
        cust = session.query(ARCustomerRow).filter(
            ARCustomerRow.id == cust_uuid, ARCustomerRow.client_id == client_id
        ).first()
        if cust is None:
            raise ValueError("Customer tidak ditemukan untuk client ini.")
        inv_uuid = None
        if invoice_id:
            inv_uuid = _ar_uuid(invoice_id, "Invoice")
            inv = session.query(ARInvoiceRow).filter(
                ARInvoiceRow.id == inv_uuid, ARInvoiceRow.client_id == client_id,
                ARInvoiceRow.customer_id == cust.id,
            ).first()
            if inv is None:
                raise ValueError("Invoice tidak ditemukan untuk customer ini.")
        row = ARCollectionNoteRow(
            id=uuid.uuid4(), client_id=client_id, customer_id=cust.id, invoice_id=inv_uuid,
            note_type=(note_type or "").strip()[:50] or "General", content=isi,
            created_by=(created_by or "").strip()[:100] or None, created_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {
            "id": str(row.id), "customer_id": str(row.customer_id),
            "invoice_id": str(row.invoice_id) if row.invoice_id else None,
            "note_type": row.note_type, "content": row.content, "created_by": row.created_by,
            "created_at": row.created_at.isoformat(),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_status_invoice_ar(
    client_id: str, invoice_id: str, manual_status: Optional[str],
    alasan: Optional[str] = None, created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Set / hapus penanda manual invoice: 'Disputed', 'Written Off', atau
    None (hapus penanda -> status kembali dihitung otomatis). Perubahan dicatat
    otomatis sebagai catatan penagihan bertipe 'Status' supaya ada jejaknya."""
    _ar_uuid(client_id, "Client")
    inv_uuid = _ar_uuid(invoice_id, "Invoice")
    status_baru = (manual_status or "").strip() or None
    if status_baru is not None and status_baru not in AR_MANUAL_STATUS_VALID:
        raise ValueError(f"Status tidak dikenal. Nilai sah: {sorted(AR_MANUAL_STATUS_VALID)} atau kosong.")
    alasan_bersih = (alasan or "").strip()[:500]

    session = SessionLocal()
    try:
        inv = session.query(ARInvoiceRow).filter(
            ARInvoiceRow.id == inv_uuid, ARInvoiceRow.client_id == client_id
        ).with_for_update().first()
        if inv is None:
            raise ValueError("Invoice tidak ditemukan untuk client ini.")
        status_lama = inv.manual_status
        if status_baru == status_lama:
            raise ValueError("Status invoice sudah sama, tidak ada yang diubah.")
        if status_baru == "Written Off":
            sudah_dibayar = session.query(func.coalesce(func.sum(ARPaymentRow.amount), 0)).filter(
                ARPaymentRow.invoice_id == inv.id
            ).scalar() or 0
            if _ar_angka_lunas(sudah_dibayar, inv.amount):
                raise ValueError("Invoice sudah lunas, tidak ada sisa tagihan yang bisa di-write-off.")
        inv.manual_status = status_baru
        inv.updated_at = datetime.now()
        label = status_baru or "penanda dihapus (status dihitung otomatis)"
        isi = f"Status invoice {inv.invoice_number}: {status_lama or 'otomatis'} → {label}."
        if alasan_bersih:
            isi += f" Alasan: {alasan_bersih}"
        session.add(ARCollectionNoteRow(
            id=uuid.uuid4(), client_id=client_id, customer_id=inv.customer_id, invoice_id=inv.id,
            note_type="Status", content=isi, created_by=(created_by or "").strip()[:100] or None,
            created_at=datetime.now(),
        ))
        session.commit()
        return {"id": str(inv.id), "invoice_number": inv.invoice_number,
                "manual_status": inv.manual_status, "status_lama": status_lama}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _ar_angka_lunas(a: Any, b: Any) -> bool:
    """True kalau total dibayar `a` >= nominal invoice `b` (pembulatan 2 desimal, hindari galat float)."""
    from decimal import Decimal
    return Decimal(str(a)).quantize(Decimal("0.01")) >= Decimal(str(b)).quantize(Decimal("0.01"))


PURCHASE_STATUS_VALID = {
    "draft", "pending_review", "approved", "pending_posting",
    "posted", "rejected", "exception", "cancelled",
}
PURCHASE_EXCEPTION_STATUS_VALID = {
    "Open", "Under Review", "Requires Correction", "Resolved", "Ignored",
}

# [SESUAI DB] Kolom status di tabel fisik berisi label tampilan ("Pending Review",
# "Approved", "Posted", "Exception", ...), sedangkan kode lama membandingkan &
# menulis snake_case ("pending_review"). Semua perbandingan sekarang lewat
# _norm_status_purchase(), dan penulisan memakai label yang sama dengan DB.
PURCHASE_STATUS_LABEL_DB = {
    "draft": "Draft", "pending_review": "Pending Review", "approved": "Approved",
    "pending_posting": "Pending Posting", "posted": "Posted", "rejected": "Rejected",
    "exception": "Exception", "cancelled": "Cancelled",
}


def _norm_status_purchase(s: Optional[str]) -> str:
    """'Pending Review' / 'pending-review' / 'pending_review' -> 'pending_review'."""
    return "_".join(str(s or "").strip().lower().replace("-", " ").replace("_", " ").split())



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
    status = _norm_status_purchase(status)
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

        t_old_status = _norm_status_purchase(t.status)
        t.status = PURCHASE_STATUS_LABEL_DB.get(status, status)
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
    target_status = _norm_status_purchase(target_status)
    from_status = _norm_status_purchase(from_status) if from_status else None
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
                if from_status and _norm_status_purchase(t.status) != from_status:
                    dilewati += 1
                    continue
                t.status = PURCHASE_STATUS_LABEL_DB.get(target_status, target_status)
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
# MODUL ACCOUNTS PAYABLE (BARU) -- menyambungkan halaman AP ke tabel resmi,
# pola SAMA seperti AR (lihat ambil_data_ar() di atas): vendor & bill BUKAN
# tabel baru (dipakai ulang dari modul Purchase -- financial_transaction_
# purchase_vendor sbg vendor master, financial_transaction_purchase_
# transaction sbg bill), sedangkan payment & note ADALAH 2 tabel baru yang
# user buat manual di Supabase khusus utk AP. Lihat
# src/app/accounts-payable/lib/apDbBridge.ts utk sisi frontend (mapping ke
# Bill[]/Vendor[] dipakai ulang dari src/app/transactions/lib/apBridge.ts).
# ============================================================

class APPaymentRow(Base):
    """Pembayaran tagihan vendor. status='Scheduled' = rencana bayar saja
    (belum mengurangi sisa tagihan), status='Paid' = sudah benar-benar
    dibayar (baru dijumlahkan sbg `paid`)."""
    __tablename__ = "finance_account_payable_ap_payment"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    bill_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_transaction_purchase_transaction.id"), nullable=False)    payment_date = Column(Date, nullable=False)
    amount = Column(Numeric(24, 2), nullable=False)
    status = Column(String(20), nullable=False, default="Paid")
    method = Column(String(50), nullable=True)
    reference_no = Column(String(100), nullable=True)
    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
    recorded_by = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class APNoteRow(Base):
    """Catatan internal per vendor (atau per bill kalau bill_id diisi)."""
    __tablename__ = "finance_account_payable_ap_note"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    vendor_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_transaction_purchase_vendor.id"), nullable=False)
    bill_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_transaction_purchase_transaction.id"), nullable=True)    content = Column(Text, nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


def ambil_data_ap(client_id: str) -> Dict[str, Any]:
    """[BARU] Data mentah modul AP milik satu client -- vendor & bill dari
    tabel Purchase, payment & note dari 2 tabel AP -- pola sama dengan
    ambil_data_ar(). Perhitungan status/outstanding/aging TIDAK dilakukan di
    sini (dipetakan ke Bill[]/Vendor[] oleh apDbBridge.ts)."""
    session = SessionLocal()
    try:
        vendor_rows = session.query(PurchaseVendor).filter(
            PurchaseVendor.client_id == client_id
        ).all()
        bill_rows = session.query(PurchaseTransactionRow).filter(
            PurchaseTransactionRow.client_id == client_id
        ).order_by(PurchaseTransactionRow.purchase_date).all()
        payment_rows = session.query(APPaymentRow).filter(
            APPaymentRow.client_id == client_id
        ).order_by(APPaymentRow.payment_date.desc(), APPaymentRow.created_at.desc()).all()
        note_rows = session.query(APNoteRow).filter(
            APNoteRow.client_id == client_id
        ).order_by(APNoteRow.created_at.desc()).all()

        def _iso(d):
            return d.isoformat() if d else None

        def _num(v):
            return float(v) if v is not None else 0.0

        return {
            "vendor": [
                {"id": str(v.id), "name": v.name}
                for v in vendor_rows
            ],
            "bill": [
                {
                    "id": str(b.id),
                    "purchase_id": b.purchase_id,
                    "vendor_id": str(b.vendor_id) if b.vendor_id else None,
                    "invoice_no": b.invoice_no,
                    "category": b.category,
                    "purchase_date": _iso(b.purchase_date),
                    "due_date": _iso(b.due_date),
                    "total_payable": _num(b.total_payable),
                    "payment_status": b.payment_status,
                    "status": b.status,
                    "manual_status": b.manual_status,
                }
                for b in bill_rows
            ],
            "payment": [
                {
                    "id": str(p.id),
                    "bill_id": str(p.bill_id),
                    "payment_date": _iso(p.payment_date),
                    "amount": _num(p.amount),
                    "status": p.status,
                    "method": p.method,
                    "reference_no": p.reference_no,
                    "recorded_by": p.recorded_by,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "journal_entry_id": p.journal_entry_id,
                }
                for p in payment_rows
            ],
            "note": [
                {
                    "id": str(n.id),
                    "vendor_id": str(n.vendor_id),
                    "bill_id": str(n.bill_id) if n.bill_id else None,
                    "content": n.content,
                    "created_by": n.created_by,
                    "created_at": n.created_at.isoformat() if n.created_at else None,
                }
                for n in note_rows
            ],
        }
    finally:
        session.close()


# ------------------------------------------------------------------
# [BARU] AP -- operasi TULIS, pola SAMA dengan AR (lihat catat_pembayaran_ar/
# tambah_catatan_ar di atas): validasi, kunci baris bill (FOR UPDATE) sebelum
# menghitung sisa tagihan, raise ValueError dengan pesan siap tampil.
# ------------------------------------------------------------------
AP_MANUAL_STATUS_VALID = {"Disputed", "On Hold"}
AP_PAYMENT_STATUS_VALID = {"Scheduled", "Paid", "Cancelled"}


def _ap_uuid(nilai: Any, label: str) -> uuid.UUID:
    try:
        return nilai if isinstance(nilai, uuid.UUID) else uuid.UUID(str(nilai))
    except (ValueError, AttributeError, TypeError):
        raise ValueError(f"{label} tidak valid.")


def _ap_tanggal(nilai: Any, label: str) -> date:
    if isinstance(nilai, datetime):
        return nilai.date()
    if isinstance(nilai, date):
        return nilai
    try:
        return datetime.strptime(str(nilai)[:10], "%Y-%m-%d").date()
    except ValueError:
        raise ValueError(f"{label} tidak valid (format YYYY-MM-DD).")


def catat_pembayaran_ap(
    client_id: str, bill_id: str, payment_date: Any, amount: Any,
    status: Optional[str] = "Paid", method: Optional[str] = None,
    reference_no: Optional[str] = None, recorded_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Catat pembayaran (atau jadwal pembayaran) satu bill/tagihan vendor.

    Aturan: nominal > 0; tanggal pembayaran 'Paid' tidak boleh di masa depan;
    bill bukan 'On Hold'; kalau status='Paid', nominal tidak boleh melebihi
    sisa tagihan ('Scheduled' hanya rencana, tidak dicek terhadap sisa)."""
    from decimal import Decimal, InvalidOperation

    _ap_uuid(client_id, "Client")
    bill_uuid = _ap_uuid(bill_id, "Bill")
    status_dipakai = (status or "Paid").strip()
    if status_dipakai not in AP_PAYMENT_STATUS_VALID:
        raise ValueError(f"Status pembayaran tidak valid (pilihan: {', '.join(sorted(AP_PAYMENT_STATUS_VALID))}).")
    try:
        nominal = Decimal(str(amount)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Nominal pembayaran tidak valid.")
    if nominal <= 0:
        raise ValueError("Nominal pembayaran harus lebih dari 0.")
    tgl = _ap_tanggal(payment_date, "Tanggal pembayaran")
    if status_dipakai == "Paid" and tgl > date.today():
        raise ValueError("Tanggal pembayaran tidak boleh di masa depan.")

    session = SessionLocal()
    try:
        bill = session.query(PurchaseTransactionRow).filter(
            PurchaseTransactionRow.id == bill_uuid, PurchaseTransactionRow.client_id == client_id
        ).with_for_update().first()
        if bill is None:
            raise ValueError("Tagihan (bill) tidak ditemukan untuk client ini.")
        if bill.manual_status == "On Hold" and status_dipakai == "Paid":
            raise ValueError("Tagihan sedang di-hold, tidak bisa dicatat lunas.")
        total_payable = Decimal(str(bill.total_payable or 0))
        if status_dipakai == "Paid":
            sudah_dibayar = session.query(func.coalesce(func.sum(APPaymentRow.amount), 0)).filter(
                APPaymentRow.bill_id == bill.id, APPaymentRow.status == "Paid"
            ).scalar() or 0
            sisa = total_payable - Decimal(str(sudah_dibayar))
            if sisa <= 0:
                raise ValueError("Tagihan ini sudah lunas.")
            if nominal > sisa:
                raise ValueError("Nominal melebihi sisa tagihan (sisa Rp " + f"{sisa:,.0f}".replace(",", ".") + ").")

        row = APPaymentRow(
            id=uuid.uuid4(), client_id=client_id, bill_id=bill.id, payment_date=tgl,
            amount=nominal, status=status_dipakai, method=(method or "").strip()[:50] or None,
            reference_no=(reference_no or "").strip()[:100] or None,
            recorded_by=(recorded_by or "").strip()[:100] or None, created_at=datetime.now(),
        )
        session.add(row)
        bill.updated_at = datetime.now()
        # Sinkron payment_status ringkas di header bill (dipakai halaman lain
        # yang masih baca kolom ini langsung, mis. modul Purchase).
        if status_dipakai == "Paid":
            sisa_baru = total_payable - Decimal(str(session.query(func.coalesce(func.sum(APPaymentRow.amount), 0)).filter(
                APPaymentRow.bill_id == bill.id, APPaymentRow.status == "Paid"
            ).scalar() or 0))
            bill.payment_status = "Paid" if sisa_baru <= 0 else "Partial"
        session.commit()
        return {
            "id": str(row.id), "bill_id": str(bill.id), "purchase_id": bill.purchase_id,
            "payment_date": tgl.isoformat(), "amount": float(nominal), "status": status_dipakai,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_catatan_ap(
    client_id: str, vendor_id: str, content: str, bill_id: Optional[str] = None,
    created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Tambah catatan internal per vendor (atau per bill kalau bill_id diisi)."""
    _ap_uuid(client_id, "Client")
    vendor_uuid = _ap_uuid(vendor_id, "Vendor")
    isi = (content or "").strip()
    if not isi:
        raise ValueError("Isi catatan tidak boleh kosong.")
    if len(isi) > 4000:
        raise ValueError("Isi catatan terlalu panjang (maks 4000 karakter).")

    session = SessionLocal()
    try:
        vendor = session.query(PurchaseVendor).filter(
            PurchaseVendor.id == vendor_uuid, PurchaseVendor.client_id == client_id
        ).first()
        if vendor is None:
            raise ValueError("Vendor tidak ditemukan untuk client ini.")
        bill_uuid = None
        if bill_id:
            bill_uuid = _ap_uuid(bill_id, "Bill")
            bill = session.query(PurchaseTransactionRow).filter(
                PurchaseTransactionRow.id == bill_uuid, PurchaseTransactionRow.client_id == client_id
            ).first()
            if bill is None:
                raise ValueError("Bill tidak ditemukan untuk client ini.")

        row = APNoteRow(
            id=uuid.uuid4(), client_id=client_id, vendor_id=vendor.id, bill_id=bill_uuid,
            content=isi, created_by=(created_by or "").strip()[:100] or None, created_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "vendor_id": str(vendor.id), "created_at": row.created_at.isoformat()}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_status_bill_ap(
    client_id: str, bill_id: str, manual_status: Optional[str],
    alasan: Optional[str] = None, created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Set/hapus manual_status ('Disputed'/'On Hold') satu bill Purchase.
    manual_status=None menghapus override (kembali ke status otomatis).
    Perubahan dicatat otomatis sebagai APNoteRow supaya ada jejaknya --
    pola sama dengan ubah_status_invoice_ar()."""
    _ap_uuid(client_id, "Client")
    bill_uuid = _ap_uuid(bill_id, "Bill")
    status_baru = (manual_status or "").strip() or None
    if status_baru is not None and status_baru not in AP_MANUAL_STATUS_VALID:
        raise ValueError(f"Status tidak valid (pilihan: {', '.join(sorted(AP_MANUAL_STATUS_VALID))}, atau kosongkan).")
    alasan_bersih = (alasan or "").strip()[:500]

    session = SessionLocal()
    try:
        bill = session.query(PurchaseTransactionRow).filter(
            PurchaseTransactionRow.id == bill_uuid, PurchaseTransactionRow.client_id == client_id
        ).with_for_update().first()
        if bill is None:
            raise ValueError("Tagihan (bill) tidak ditemukan untuk client ini.")
        status_lama = bill.manual_status
        if status_baru == status_lama:
            raise ValueError("Status tagihan sudah sama, tidak ada yang diubah.")
        bill.manual_status = status_baru
        bill.updated_at = datetime.now()
        if bill.vendor_id:
            label = status_baru or "penanda dihapus (status dihitung otomatis)"
            isi = f"Status tagihan {bill.purchase_id}: {status_lama or 'otomatis'} → {label}."
            if alasan_bersih:
                isi += f" Alasan: {alasan_bersih}"
            session.add(APNoteRow(
                id=uuid.uuid4(), client_id=client_id, vendor_id=bill.vendor_id, bill_id=bill.id,
                content=isi, created_by=(created_by or "").strip()[:100] or None, created_at=datetime.now(),
            ))
        session.commit()
        return {"id": str(bill.id), "purchase_id": bill.purchase_id,
                "manual_status": bill.manual_status, "status_lama": status_lama}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============================================================
# MODUL BUDGET & FORECAST (BARU) -- 2 tabel dibuat manual oleh user lewat
# Supabase di schema "5_Planning": forecast_assumption (asumsi budget per
# client/tahun -- dipakai ForecastAssumptions.tsx & budgetBridge.ts sbg
# pengganti konstanta hardcoded BUDGET_ASSUMPTIONS) dan scenario (skenario
# custom tersimpan -- dipakai ScenarioPlanning.tsx sbg tambahan atas 3
# skenario bawaan Base/Optimistic/Conservative yang tetap dihitung dari
# actual run-rate, bukan diganti).
# ============================================================

class ForecastAssumptionRow(Base):
    """Asumsi budget per client per tahun (1 baris per client+tahun --
    'Apply' di ForecastAssumptions.tsx melakukan upsert ke baris ini)."""
    __tablename__ = "planning_budget_forecast_assumption"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    tahun = Column(Integer, nullable=False)
    revenue_growth_pct = Column(Numeric, nullable=True)
    cogs_pct = Column(Numeric, nullable=True)
    payroll_growth_pct = Column(Numeric, nullable=True)
    opex_growth_pct = Column(Numeric, nullable=True)
    collection_rate_pct = Column(Numeric, nullable=True)
    tax_rate_pct = Column(Numeric, nullable=True)
    capex = Column(Numeric, nullable=True)
    interest_expense = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class ScenarioRow(Base):
    """Skenario planning custom yang disimpan user (tombol "New Scenario"
    di ScenarioPlanning.tsx) -- banyak baris per client/tahun."""
    __tablename__ = "planning_budget_forecast_scenario"

    id = Column(PG_UUID(as_uuid=True), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    tahun = Column(Integer, nullable=False)
    nama_skenario = Column(String(100), nullable=False)
    revenue_growth_pct = Column(Numeric, nullable=True)
    cogs_pct = Column(Numeric, nullable=True)
    opex_growth_pct = Column(Numeric, nullable=True)
    tax_rate_pct = Column(Numeric, nullable=True)
    is_base_case = Column(Boolean, nullable=False, default=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def _forecast_num(v):
    return float(v) if v is not None else None


# [BARU -- tuntaskan Budget & Forecast] Default dipakai HANYA sekali, saat
# baris forecast_assumption client+tahun ybs belum pernah ada sama sekali,
# supaya "Budget" di halaman selalu dihitung dari tabel (bukan lagi dari
# konstanta hardcoded BUDGET_ASSUMPTIONS di budgetBridge.ts). Angkanya SAMA
# dengan BUDGET_ASSUMPTIONS lama (revenue +8%, opex +5%) supaya perilaku
# halaman tidak berubah tiba-tiba utk client yang sudah lama pakai --
# bedanya sekarang tersimpan sbg baris asli, bisa dilihat & diubah lewat
# ForecastAssumptions.tsx seperti asumsi manapun juga.
_DEFAULT_FORECAST_ASSUMPTION = {
    "revenue_growth_pct": 8.0,
    "cogs_pct": None,  # None = frontend pakai delta rasio COGS lama (-1pp) sbg fallback
    "payroll_growth_pct": 0.0,
    "opex_growth_pct": 5.0,
    "collection_rate_pct": 95.0,
    "tax_rate_pct": None,  # None = frontend pakai PPh badan aktual (PL_CORE.incomeTax)
    "capex": 0.0,
    "interest_expense": None,  # None = frontend pakai interest expense aktual
}


def ambil_forecast_assumption(client_id: str, tahun: int) -> Optional[Dict[str, Any]]:
    """[BARU] Asumsi budget tersimpan client utk 1 tahun. Kalau baris belum
    ada sama sekali, DIBUAT sekali dengan nilai default (lihat
    _DEFAULT_FORECAST_ASSUMPTION di atas) supaya Budget & Forecast SELALU
    punya sumber tabel, bukan cuma fallback JS di frontend. Dipakai GET
    /api/client/{id}/forecast-assumption."""
    _ap_uuid(client_id, "Client")
    session = SessionLocal()
    try:
        row = session.query(ForecastAssumptionRow).filter(
            ForecastAssumptionRow.client_id == client_id, ForecastAssumptionRow.tahun == tahun
        ).first()
        if row is None:
            row = ForecastAssumptionRow(
                id=uuid.uuid4(), client_id=client_id, tahun=tahun, created_at=datetime.now(),
                **_DEFAULT_FORECAST_ASSUMPTION,
            )
            session.add(row)
            session.commit()
        return {
            "tahun": row.tahun,
            "revenue_growth_pct": _forecast_num(row.revenue_growth_pct),
            "cogs_pct": _forecast_num(row.cogs_pct),
            "payroll_growth_pct": _forecast_num(row.payroll_growth_pct),
            "opex_growth_pct": _forecast_num(row.opex_growth_pct),
            "collection_rate_pct": _forecast_num(row.collection_rate_pct),
            "tax_rate_pct": _forecast_num(row.tax_rate_pct),
            "capex": _forecast_num(row.capex),
            "interest_expense": _forecast_num(row.interest_expense),
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def simpan_forecast_assumption(client_id: str, tahun: int, **nilai) -> Dict[str, Any]:
    """[BARU] Upsert asumsi budget client utk 1 tahun (1 baris per
    client+tahun). `nilai` menerima key sesuai kolom tabel (semua opsional).
    Dipakai POST /api/client/{id}/forecast-assumption -> tombol Apply."""
    _ap_uuid(client_id, "Client")
    kolom_valid = {
        "revenue_growth_pct", "cogs_pct", "payroll_growth_pct", "opex_growth_pct",
        "collection_rate_pct", "tax_rate_pct", "capex", "interest_expense",
    }
    tidak_dikenal = set(nilai) - kolom_valid
    if tidak_dikenal:
        raise ValueError(f"Field tidak dikenal: {', '.join(sorted(tidak_dikenal))}")

    session = SessionLocal()
    try:
        row = session.query(ForecastAssumptionRow).filter(
            ForecastAssumptionRow.client_id == client_id, ForecastAssumptionRow.tahun == tahun
        ).first()
        if row is None:
            row = ForecastAssumptionRow(id=uuid.uuid4(), client_id=client_id, tahun=tahun, created_at=datetime.now())
            session.add(row)
        for k in kolom_valid:
            if k in nilai:
                setattr(row, k, nilai[k])
        session.commit()
        return {"tahun": tahun, **{k: _forecast_num(getattr(row, k)) for k in kolom_valid}}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def daftar_scenario(client_id: str, tahun: int) -> List[Dict[str, Any]]:
    """[BARU] Daftar skenario custom tersimpan client utk 1 tahun. Dipakai
    GET /api/client/{id}/scenarios."""
    session = SessionLocal()
    try:
        rows = session.query(ScenarioRow).filter(
            ScenarioRow.client_id == client_id, ScenarioRow.tahun == tahun
        ).order_by(ScenarioRow.created_at).all()
        return [
            {
                "id": str(r.id),
                "nama_skenario": r.nama_skenario,
                "revenue_growth_pct": _forecast_num(r.revenue_growth_pct),
                "cogs_pct": _forecast_num(r.cogs_pct),
                "opex_growth_pct": _forecast_num(r.opex_growth_pct),
                "tax_rate_pct": _forecast_num(r.tax_rate_pct),
                "is_base_case": bool(r.is_base_case),
                "created_by": r.created_by,
            }
            for r in rows
        ]
    finally:
        session.close()


def tambah_scenario(
    client_id: str, tahun: int, nama_skenario: str, revenue_growth_pct: Optional[float] = None,
    cogs_pct: Optional[float] = None, opex_growth_pct: Optional[float] = None,
    tax_rate_pct: Optional[float] = None, is_base_case: bool = False, created_by: Optional[str] = None,
) -> Dict[str, Any]:
    """[BARU] Simpan skenario custom baru. Dipakai POST /api/client/{id}/scenarios
    -> tombol "New Scenario"."""
    _ap_uuid(client_id, "Client")
    nama_bersih = (nama_skenario or "").strip()
    if not nama_bersih:
        raise ValueError("Nama skenario tidak boleh kosong.")
    if len(nama_bersih) > 100:
        raise ValueError("Nama skenario terlalu panjang (maks 100 karakter).")

    session = SessionLocal()
    try:
        row = ScenarioRow(
            id=uuid.uuid4(), client_id=client_id, tahun=tahun, nama_skenario=nama_bersih,
            revenue_growth_pct=revenue_growth_pct, cogs_pct=cogs_pct, opex_growth_pct=opex_growth_pct,
            tax_rate_pct=tax_rate_pct, is_base_case=bool(is_base_case),
            created_by=(created_by or "").strip()[:100] or None,
            created_at=datetime.now(), updated_at=datetime.now(),
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "nama_skenario": row.nama_skenario}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def hapus_scenario(client_id: str, scenario_id: str) -> Dict[str, Any]:
    """[BARU] Hapus 1 skenario custom. Dipakai DELETE /api/client/{id}/scenarios/{scenario_id}."""
    _ap_uuid(client_id, "Client")
    scenario_uuid = _ap_uuid(scenario_id, "Scenario")

    session = SessionLocal()
    try:
        row = session.query(ScenarioRow).filter(
            ScenarioRow.id == scenario_uuid, ScenarioRow.client_id == client_id
        ).first()
        if row is None:
            raise ValueError("Skenario tidak ditemukan untuk client ini.")
        session.delete(row)
        session.commit()
        return {"id": scenario_id, "dihapus": True}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ============================================================
# MODUL OVERVIEW (BARU) -- 2 tabel dibuat manual oleh user lewat Supabase
# di schema "2_Overview": overview_management_branches (daftar
# cabang per client, dipakai dropdown "Branch" di halaman Financial
# Overview) dan overview_financial_budget (angka Anggaran P&L
# per client/cabang/tahun/bulan, dipakai mode "Budget" di KPIBentoGrid --
# menggantikan konstanta hardcoded BUDGET di src/lib/financialData.tsx).
# ============================================================

class ManagementBranch(Base):
    """Daftar cabang per client -- sumber dropdown Branch di Financial Overview."""
    __tablename__ = "overview_management_branches"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    nama_cabang = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class OverviewFinancialBudget(Base):
    """
    Anggaran P&L per bulan (opsional per cabang). Struktur field sengaja
    identik dengan PL_CORE di useProfitLossData.ts (revenue, cogs, op_ex,
    da, interest, tax) supaya grossProfit/ebitda/netProfit bisa dihitung
    dengan rumus yang SAMA: grossProfit = revenue - cogs,
    ebitda = grossProfit - op_ex, netProfit = revenue - (cogs+op_ex+da+interest+tax).
    """
    __tablename__ = "overview_financial_budget"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    branch_id = Column(PG_UUID(as_uuid=False), ForeignKey("overview_management_branches.id"), nullable=True)    tahun = Column(Integer, nullable=False)
    bulan = Column(Integer, nullable=False)
    revenue = Column(Numeric, nullable=True)
    cogs = Column(Numeric, nullable=True)
    op_ex = Column(Numeric, nullable=True)
    da = Column(Numeric, nullable=True)
    interest = Column(Numeric, nullable=True)
    tax = Column(Numeric, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def daftar_branches(client_id: str) -> List[Dict[str, Any]]:
    """[BARU] Daftar cabang milik satu client -- dipakai dropdown Branch
    di Financial Overview (GET /api/client/{client_id}/branches)."""
    session = SessionLocal()
    try:
        rows = session.query(ManagementBranch).filter(
            ManagementBranch.client_id == client_id
        ).order_by(ManagementBranch.nama_cabang).all()
        return [{"id": str(b.id), "nama_cabang": b.nama_cabang} for b in rows]
    finally:
        session.close()


def ambil_financial_budget(
    client_id: str, tahun: int, bulan_sampai: int = 12, branch_id: Optional[str] = None
) -> Dict[str, Any]:
    """
    [BARU] Jumlahkan Anggaran P&L client dari bulan 1 s.d. `bulan_sampai`
    (YTD, sama seperti cara PL_CORE aktual diakumulasi di
    useProfitLossData.ts), lalu turunkan grossProfit/ebitda/netProfit.
    `branch_id` opsional -- kalau diisi, hanya baris cabang itu yang
    dijumlahkan; kalau kosong, semua cabang + baris tanpa cabang (client
    level) ikut dijumlahkan ("All Branches").
    Dipakai GET /api/client/{client_id}/financial-budget.
    """
    session = SessionLocal()
    try:
        q = session.query(OverviewFinancialBudget).filter(
            OverviewFinancialBudget.client_id == client_id,
            OverviewFinancialBudget.tahun == tahun,
            OverviewFinancialBudget.bulan >= 1,
            OverviewFinancialBudget.bulan <= bulan_sampai,
        )
        if branch_id:
            q = q.filter(OverviewFinancialBudget.branch_id == branch_id)
        rows = q.all()

        def _num(v):
            return float(v) if v is not None else 0.0

        revenue = sum(_num(r.revenue) for r in rows)
        cogs = sum(_num(r.cogs) for r in rows)
        op_ex = sum(_num(r.op_ex) for r in rows)
        da = sum(_num(r.da) for r in rows)
        interest = sum(_num(r.interest) for r in rows)
        tax = sum(_num(r.tax) for r in rows)
        gross_profit = revenue - cogs
        ebitda = gross_profit - op_ex
        net_profit = revenue - (cogs + op_ex + da + interest + tax)

        return {
            "tahun": tahun,
            "bulan_sampai": bulan_sampai,
            "ada_data": len(rows) > 0,
            "revenue": revenue,
            "cogs": cogs,
            "grossProfit": gross_profit,
            "operatingExpenses": op_ex,
            "da": da,
            "ebitda": ebitda,
            "interest": interest,
            "tax": tax,
            "netProfit": net_profit,
        }
    finally:
        session.close()


# ============================================================
# MODUL FINANCIAL STATEMENTS (BARU) -- 3 tabel dibuat manual lewat Supabase
# di schema "3_Financial", dipakai halaman /financial-statements/*:
#   - ..._profit and loss_finance_budget_li  -> kolom "Budget" di kartu
#     "Profitability vs Budget" (Profit & Loss). Baris per client/tahun/
#     bulan/kategori (Revenue, COGS, Gross Profit, Operating Expenses,
#     EBITDA, Net Profit), nominal dalam RUPIAH penuh.
#   - ..._profit and loss_finance_insights   -> panel "AI Performance
#     Insights" (Profit & Loss). Kolom `modul` membedakan halaman asal
#     insight ("profit_loss"; "cash_flow" bisa dipakai nanti).
#   - ..._Cash Flow_cash_flow_forecast       -> grafik & tabel "Cash Flow
#     Forecast" / "Projected Cash Position" (Cash Flow), nominal RUPIAH.
# Nama tabel memang mengandung spasi/huruf besar -- SQLAlchemy otomatis
# memberi tanda kutip, jadi string di __tablename__ harus PERSIS sama.
# ============================================================

class PLBudgetLine(Base):
    """Anggaran P&L per bulan per kategori (satu baris = satu kategori)."""
    __tablename__ = "finance_financial_statement_profit_loss_budget_line"

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    tahun = Column(Integer, nullable=False)
    bulan = Column(Integer, nullable=False)
    kategori = Column(String, nullable=False)
    nominal_budget = Column(Numeric, nullable=True)
    dibuat_oleh = Column("created_by", PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class PLInsight(Base):
    """Insight P&L (teks) per client -- sumber AIInsightsPanel."""
    __tablename__ = "finance_financial_statement_profit_loss_insights"

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    modul = Column(String, nullable=False)
    periode = Column(String, nullable=True)
    judul = Column(String, nullable=False)
    deskripsi = Column(Text, nullable=True)
    metric = Column(String, nullable=True)
    severity = Column(String, nullable=True)
    dibuat_at = Column("created_at", DateTime(timezone=True), nullable=True)


class CashFlowForecastRow(Base):
    """Proyeksi arus kas bulanan per client (nominal Rupiah penuh)."""
    __tablename__ = "finance_financial_statement_cash_flow_forecast"

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    tahun = Column(Integer, nullable=False)
    bulan = Column(Integer, nullable=False)
    begin_cash = Column(Numeric, nullable=True)
    operating_cf = Column(Numeric, nullable=True)
    investing_cf = Column(Numeric, nullable=True)
    financing_cf = Column(Numeric, nullable=True)
    net_change = Column(Numeric, nullable=True)
    end_cash = Column(Numeric, nullable=True)
    dibuat_oleh = Column("created_by", PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def ambil_pl_budget(client_id: str, tahun: int, bulan_sampai: int = 12) -> Dict[str, Any]:
    """
    [BARU] Jumlahkan anggaran P&L per kategori dari bulan 1 s.d.
    `bulan_sampai` (YTD). Bentuk hasilnya SENGAJA sama dengan
    ambil_financial_budget() supaya frontend bisa menukar sumbernya tanpa
    mengubah cara membaca hasil. Gross Profit/EBITDA dipakai apa adanya
    dari baris tersimpan; kalau barisnya tidak ada, diturunkan dari
    Revenue/COGS/Operating Expenses. Dipakai GET
    /api/client/{client_id}/pl-budget.
    """
    session = SessionLocal()
    try:
        rows = session.query(
            PLBudgetLine.kategori, func.sum(PLBudgetLine.nominal_budget)
        ).filter(
            PLBudgetLine.client_id == client_id,
            PLBudgetLine.tahun == tahun,
            PLBudgetLine.bulan >= 1,
            PLBudgetLine.bulan <= bulan_sampai,
        ).group_by(PLBudgetLine.kategori).all()

        nilai = {k: (float(v) if v is not None else 0.0) for k, v in rows}
        revenue = nilai.get("Revenue", 0.0)
        cogs = nilai.get("COGS", 0.0)
        gross_profit = nilai.get("Gross Profit", revenue - cogs)
        op_ex = nilai.get("Operating Expenses", 0.0)
        ebitda = nilai.get("EBITDA", gross_profit - op_ex)
        net_profit = nilai.get("Net Profit", 0.0)

        return {
            "tahun": tahun,
            "bulan_sampai": bulan_sampai,
            "ada_data": len(rows) > 0,
            "revenue": revenue,
            "cogs": cogs,
            "grossProfit": gross_profit,
            "operatingExpenses": op_ex,
            "ebitda": ebitda,
            "netProfit": net_profit,
        }
    finally:
        session.close()


def daftar_pl_insights(client_id: str, modul: str = "profit_loss") -> List[Dict[str, Any]]:
    """[BARU] Insight P&L milik client (urut sesuai id). `severity` di luar
    positive/negative/warning/neutral dinormalkan ke 'neutral' supaya
    AIInsightsPanel tidak error. Dipakai GET /api/client/{id}/pl-insights."""
    severity_valid = {"positive", "negative", "warning", "neutral"}
    session = SessionLocal()
    try:
        rows = session.query(PLInsight).filter(
            PLInsight.client_id == client_id,
            PLInsight.modul == modul,
        ).order_by(PLInsight.id).all()
        return [
            {
                "id": r.id,
                "title": r.judul,
                "description": r.deskripsi or "",
                "metric": r.metric or "",
                "severity": r.severity if r.severity in severity_valid else "neutral",
                "periode": r.periode,
                "modul": r.modul,
            }
            for r in rows
        ]
    finally:
        session.close()


def daftar_cash_flow_forecast(client_id: str, tahun: Optional[int] = None) -> List[Dict[str, Any]]:
    """[BARU] Proyeksi arus kas bulanan client, urut tahun lalu bulan.
    Nominal dikembalikan dalam Rupiah penuh (frontend yang membaginya ke
    Jt, sama seperti hook Cash Flow lain). Dipakai GET
    /api/client/{id}/cash-flow-forecast."""
    def _num(v):
        return float(v) if v is not None else 0.0

    session = SessionLocal()
    try:
        q = session.query(CashFlowForecastRow).filter(CashFlowForecastRow.client_id == client_id)
        if tahun:
            q = q.filter(CashFlowForecastRow.tahun == tahun)
        rows = q.order_by(CashFlowForecastRow.tahun, CashFlowForecastRow.bulan).all()
        return [
            {
                "tahun": r.tahun,
                "bulan": r.bulan,
                "begin_cash": _num(r.begin_cash),
                "operating_cf": _num(r.operating_cf),
                "investing_cf": _num(r.investing_cf),
                "financing_cf": _num(r.financing_cf),
                "net_change": _num(r.net_change),
                "end_cash": _num(r.end_cash),
            }
            for r in rows
        ]
    finally:
        session.close()


# ============================================================
# MODUL ASSETS (BARU) -- tabel "asset_fixed_assets" dibuat
# manual oleh user lewat Supabase, schema "4_Assets_Equity". Ini
# menggantikan sumber lama Fixed Asset Register/Depreciation di halaman
# Assets (dulu dari hasil upload file "Aset Tetap" di public.hasil --
# lihat assetRegisterBridge.ts di frontend). Akumulasi penyusutan, nilai
# buku, dan status "fully-depreciated" SENGAJA tidak disimpan sebagai
# kolom -- dihitung di sini dari cost, residual_value, useful_life_years,
# purchase_date, depreciation_method, sesuai komentar tabelnya di Supabase.
# Tabel ini TIDAK dipakai untuk KPI/grafik total Assets di
# useAssetsData.ts (itu tetap dari saldo neraca/COA) -- hanya untuk
# register per-unit (Fixed Asset Register & Depreciation).
# ============================================================

class FixedAsset(Base):
    __tablename__ = "asset_fixed_assets"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    asset_code = Column(String, nullable=True)
    name = Column(String, nullable=False)
    category = Column(String, nullable=True)
    purchase_date = Column(Date, nullable=True)
    cost = Column(Numeric, nullable=True)
    residual_value = Column(Numeric, nullable=True)
    useful_life_years = Column(Integer, nullable=True)
    depreciation_method = Column(String, nullable=True)
    location = Column(String, nullable=True)
    department = Column(String, nullable=True)
    status = Column(String, nullable=True)
    disposal_date = Column(Date, nullable=True)
    disposal_value = Column(Numeric, nullable=True)
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("coa.id"), nullable=True)
    needs_review = Column(Boolean, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def ambil_fixed_assets(client_id: str) -> Dict[str, Any]:
    """
    [BARU] Register aset tetap PER-UNIT client, dipetakan ke bentuk yang
    dipakai assetRegisterBridge.ts (Fixed Asset Register & Depreciation di
    halaman Assets). Akumulasi penyusutan/nilai buku/penyusutan bulanan
    DIHITUNG di sini (bukan kolom tersimpan):
      - Straight-line : (cost - residual_value) / (useful_life_years*12),
        dikali jumlah bulan sejak purchase_date (dibatasi umur ekonomis).
      - Declining-balance : saldo menurun ganda disederhanakan per bulan
        (rate = 2 / (useful_life_years*12) dari nilai buku berjalan),
        tidak pernah turun di bawah residual_value.
    `status` fisik dari kolom (active/maintenance/inactive/disposed) tetap
    dihormati untuk 'maintenance'/'disposed'; selain itu diturunkan jadi
    'fully-depreciated' kalau nilai buku sudah habis, atau 'active'.
    Dipakai GET /api/client/{client_id}/assets.
    """
    session = SessionLocal()
    try:
        rows = session.query(FixedAsset).filter(
            FixedAsset.client_id == client_id
        ).order_by(FixedAsset.purchase_date).all()

        today = date.today()
        assets: List[Dict[str, Any]] = []

        for r in rows:
            cost = float(r.cost or 0)
            residual = float(r.residual_value or 0)
            life_years = r.useful_life_years
            depreciable = max(cost - residual, 0.0)

            months_elapsed = 0
            if r.purchase_date:
                months_elapsed = (today.year - r.purchase_date.year) * 12 + (today.month - r.purchase_date.month)
                if today.day < r.purchase_date.day:
                    months_elapsed -= 1
                months_elapsed = max(0, months_elapsed)

            monthly_dep = 0.0
            accumulated = 0.0
            if life_years and life_years > 0 and depreciable > 0:
                total_months = life_years * 12
                capped_months = min(months_elapsed, total_months)
                if (r.depreciation_method or "Straight-line") == "Declining-balance":
                    monthly_rate = min(1.0, 2.0 / total_months)
                    book_value = cost
                    for _ in range(capped_months):
                        if book_value <= residual:
                            break
                        dep_this_month = book_value * monthly_rate
                        if book_value - dep_this_month < residual:
                            dep_this_month = book_value - residual
                        book_value -= dep_this_month
                    accumulated = cost - book_value
                    monthly_dep = book_value * monthly_rate if book_value > residual else 0.0
                else:
                    monthly_dep = depreciable / total_months
                    accumulated = min(monthly_dep * capped_months, depreciable)

            nbv = round(cost - accumulated, 2)
            is_fully_depreciated = bool(life_years) and depreciable > 0 and accumulated >= depreciable - 1

            if r.status == "disposed":
                status_out = "disposed"
            elif r.status == "maintenance":
                status_out = "maintenance"
            elif is_fully_depreciated:
                status_out = "fully-depreciated"
            else:
                status_out = "active"

            assets.append({
                "id": r.asset_code or str(r.id),
                "dbId": str(r.id),
                "name": r.name,
                "category": r.category or "Lainnya",
                "purchaseDate": r.purchase_date.isoformat() if r.purchase_date else None,
                "cost": cost,
                "residualValue": residual,
                "usefulLifeYears": life_years,
                "method": r.depreciation_method or "Straight-line",
                "accumulatedDepreciation": round(accumulated, 2),
                "netBookValue": nbv,
                "monthlyDepreciation": round(monthly_dep, 2),
                "status": status_out,
                "physicalStatus": r.status,
                "location": r.location,
                "department": r.department,
                "needsReview": bool(r.needs_review),
            })

        return {"assets": assets, "ada_data": len(assets) > 0}
    finally:
        session.close()


ASSET_STATUS_VALID = {"active", "maintenance", "inactive", "disposed"}
ASSET_DEPRECIATION_METHOD_VALID = {"Straight-line", "Declining-balance"}


def tambah_fixed_asset(
    client_id: str, name: str, category: Optional[str] = None, purchase_date: Any = None,
    cost: Any = 0, residual_value: Any = 0, useful_life_years: Optional[int] = None,
    depreciation_method: Optional[str] = None, location: Optional[str] = None,
    department: Optional[str] = None,
) -> Dict[str, Any]:
    """[BARU] Tambah aset tetap baru (tombol "Add Asset" di Fixed Asset
    Register). asset_code dibuat otomatis (urutan berjalan per client)."""
    from decimal import Decimal, InvalidOperation

    _ar_uuid(client_id, "Client")
    nama = (name or "").strip()
    if not nama:
        raise ValueError("Nama aset tidak boleh kosong.")
    metode = (depreciation_method or "Straight-line").strip()
    if metode not in ASSET_DEPRECIATION_METHOD_VALID:
        raise ValueError(f"Metode penyusutan tidak dikenal. Nilai sah: {sorted(ASSET_DEPRECIATION_METHOD_VALID)}.")
    try:
        cost_dec = Decimal(str(cost)).quantize(Decimal("0.01"))
        residual_dec = Decimal(str(residual_value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Cost / residual value tidak valid.")
    if cost_dec < 0 or residual_dec < 0:
        raise ValueError("Cost / residual value tidak boleh negatif.")
    if residual_dec > cost_dec:
        raise ValueError("Residual value tidak boleh melebihi cost.")
    tgl_beli = _ar_tanggal(purchase_date, "Tanggal pembelian") if purchase_date else None

    session = SessionLocal()
    try:
        jumlah = session.query(func.count(FixedAsset.id)).filter(FixedAsset.client_id == client_id).scalar() or 0
        kode = f"FA-{str(client_id)[:4].upper()}-{jumlah + 1:03d}"
        row = FixedAsset(
            id=str(uuid.uuid4()), client_id=client_id, asset_code=kode, name=nama,
            category=(category or "").strip()[:100] or None, purchase_date=tgl_beli,
            cost=cost_dec, residual_value=residual_dec, useful_life_years=useful_life_years,
            depreciation_method=metode, location=(location or "").strip()[:100] or None,
            department=(department or "").strip()[:100] or None, status="active",
            needs_review=False,
        )
        session.add(row)
        session.commit()
        return {"id": str(row.id), "asset_code": row.asset_code, "name": row.name}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_fixed_asset(client_id: str, asset_id: str, **fields: Any) -> Dict[str, Any]:
    """[BARU] Ubah field aset tetap yang ada (tombol "Edit" di Fixed Asset
    Register). `fields` hanya berisi kolom yang benar-benar dikirim
    frontend (partial update) -- lihat api_ubah_fixed_asset() di main.py
    untuk daftar field yang diizinkan."""
    from decimal import Decimal, InvalidOperation

    _ar_uuid(client_id, "Client")
    asset_uuid = _ar_uuid(asset_id, "Asset")

    session = SessionLocal()
    try:
        row = session.query(FixedAsset).filter(
            FixedAsset.id == str(asset_uuid), FixedAsset.client_id == client_id
        ).with_for_update().first()
        if row is None:
            raise ValueError("Aset tidak ditemukan untuk client ini.")

        if "name" in fields:
            nama = (fields["name"] or "").strip()
            if not nama:
                raise ValueError("Nama aset tidak boleh kosong.")
            row.name = nama
        if "category" in fields:
            row.category = (fields["category"] or "").strip()[:100] or None
        if "location" in fields:
            row.location = (fields["location"] or "").strip()[:100] or None
        if "department" in fields:
            row.department = (fields["department"] or "").strip()[:100] or None
        if "purchase_date" in fields:
            row.purchase_date = _ar_tanggal(fields["purchase_date"], "Tanggal pembelian") if fields["purchase_date"] else None
        if "cost" in fields:
            try:
                row.cost = Decimal(str(fields["cost"])).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError, TypeError):
                raise ValueError("Cost tidak valid.")
        if "residual_value" in fields:
            try:
                row.residual_value = Decimal(str(fields["residual_value"])).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError, TypeError):
                raise ValueError("Residual value tidak valid.")
        if row.residual_value is not None and row.cost is not None and row.residual_value > row.cost:
            raise ValueError("Residual value tidak boleh melebihi cost.")
        if "useful_life_years" in fields:
            row.useful_life_years = fields["useful_life_years"]
        if "depreciation_method" in fields:
            metode = (fields["depreciation_method"] or "Straight-line").strip()
            if metode not in ASSET_DEPRECIATION_METHOD_VALID:
                raise ValueError(f"Metode penyusutan tidak dikenal. Nilai sah: {sorted(ASSET_DEPRECIATION_METHOD_VALID)}.")
            row.depreciation_method = metode
        if "needs_review" in fields:
            row.needs_review = bool(fields["needs_review"])
        if "status" in fields:
            status_baru = (fields["status"] or "active").strip()
            if status_baru not in ASSET_STATUS_VALID:
                raise ValueError(f"Status tidak dikenal. Nilai sah: {sorted(ASSET_STATUS_VALID)}.")
            if status_baru == "disposed":
                raise ValueError("Gunakan endpoint dispose khusus untuk menandai aset sebagai disposed.")
            row.status = status_baru
        row.updated_at = datetime.now()
        session.commit()
        return {"id": str(row.id), "asset_code": row.asset_code, "name": row.name}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def disposisi_fixed_asset(
    client_id: str, asset_id: str, disposal_date: Any, disposal_value: Any = 0,
) -> Dict[str, Any]:
    """[BARU] Tandai aset sebagai disposed (dijual/dibuang), dgn tanggal &
    nilai disposal. Tidak bisa dibatalkan lewat endpoint biasa (perubahan
    permanen, sesuai sifat disposal aset tetap)."""
    from decimal import Decimal, InvalidOperation

    _ar_uuid(client_id, "Client")
    asset_uuid = _ar_uuid(asset_id, "Asset")
    tgl = _ar_tanggal(disposal_date, "Tanggal disposal")
    try:
        nilai = Decimal(str(disposal_value or 0)).quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        raise ValueError("Nilai disposal tidak valid.")
    if nilai < 0:
        raise ValueError("Nilai disposal tidak boleh negatif.")

    session = SessionLocal()
    try:
        row = session.query(FixedAsset).filter(
            FixedAsset.id == str(asset_uuid), FixedAsset.client_id == client_id
        ).with_for_update().first()
        if row is None:
            raise ValueError("Aset tidak ditemukan untuk client ini.")
        if row.status == "disposed":
            raise ValueError("Aset ini sudah berstatus disposed.")
        if row.purchase_date and tgl < row.purchase_date:
            raise ValueError("Tanggal disposal tidak boleh sebelum tanggal pembelian.")
        row.status = "disposed"
        row.disposal_date = tgl
        row.disposal_value = nilai
        row.updated_at = datetime.now()
        session.commit()
        return {"id": str(row.id), "asset_code": row.asset_code, "status": row.status}
    except Exception:
        session.rollback()
        raise
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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


def ambil_bank_cash_by_id(bank_cash_id: str, client_id: str) -> Optional[Dict[str, Any]]:
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


def update_bank_cash(bank_cash_id: str, client_id: str, user: str, **fields) -> Optional[Dict[str, Any]]:
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


def tolak_bank_cash(bank_cash_id: str, client_id: str, user: str, alasan: Optional[str] = None) -> bool:
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
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
    core_journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
    core_journal_line_id = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=False, default=datetime.now, onupdate=datetime.now)

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
# masing-masing merujuk ke tabel sumbernya sendiri (financial_transaction_
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

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    bank_cash_id = Column(PG_UUID(as_uuid=False), ForeignKey("finance_transaction_bank_cash.id"), nullable=True)    event_type = Column(String(50), nullable=False)  # "CREATED"/"UPDATED"/"POSTING"/"REJECTED"
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)  # no_dokumen / voucher terkait
    performed_by = Column(String(255), nullable=False)  # nama user, atau 'System'
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    # [SESUAI DB] kolom audit tambahan yang sudah ada di tabel fisik 3_Financial.
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class FinanceTransactionOtherActivityLog(Base):
    """Log aktivitas satu ENTRI finance_transaction_other (sepasang leg
    debet+kredit yang berbagi je_id yang sama) -- satu baris log per
    kejadian per je_id, BUKAN per leg."""
    __tablename__ = "finance_transaction_other_activity_log"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    je_id = Column(String(50), nullable=True)  # bukan FK -- je_id tidak unik (2 baris/leg per je_id)
    event_type = Column(String(50), nullable=False)  # "CREATED"/"UPDATED"/"POSTING"/"VOIDED"
    description = Column(Text, nullable=False)
    reference_no = Column(String(100), nullable=True)  # voucher_no / reference terkait
    performed_by = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.now)
    # [SESUAI DB] kolom audit tambahan yang sudah ada di tabel fisik 3_Financial.
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class PurchaseActivityLogRow(Base):
    """[BARU] Log aktivitas satu transaksi financial_transaction_purchase_
    transaction -- satu baris log per kejadian (submit for review/
    approve/reject/post to GL/exception status change dsb). Tabel dibuat
    manual oleh user lewat Supabase SQL Editor, skema mirip
    finance_transaction_bank_cash_activity_log di atas -- lihat DDL yang
    diberikan terpisah."""
    __tablename__ = "finance_transaction_purchase_activity_log"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    purchase_row_id = Column(PG_UUID(as_uuid=True), ForeignKey("finance_transaction_purchase_transaction.id"), nullable=True)    event_type = Column(String(50), nullable=False)  # "SUBMITTED"/"APPROVED"/"REJECTED"/"POSTED"/"RETURNED"/"EXCEPTION_UPDATED"
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

    `role` di DB tersimpan langsung sebagai string ("tahap_N"/"super_admin"/
    "client_lv_N", lihat modules/auth/core.py LEVELS/CLIENT_LEVELS) -- tidak
    ada konversi int<->string lagi."""
    return {
        "id": user.id_user,
        "username": user.username,
        "password_hash": user.password_hash,
        "role": user.role,
        "nama": user.nama_user,
        "aktif": user.deleted_at is None,
    }


def create_user(username: str, password_hash: str, role: str, nama: Optional[str] = None) -> bool:
    """Buat user baru. `nama_user` wajib diisi di DB -- fallback ke username kalau nama tidak dikirim.

    `role` disimpan apa adanya sebagai string ("tahap_N"/"super_admin"/
    "client_lv_N")."""
    session = SessionLocal()
    try:
        user = User(
            username=username,
            password_hash=password_hash,
            role=role,
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
        user.role = role
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
    finally:
        session.close()


# ============================================================
# FUNGSI MANAGEMENT_CLIENTS -- profil klien (RBAC client_id, data
# perusahaan). Lihat root/ddl-table & modules/management/clients_v1.py.
# Kolom yang di-set SERVER SENDIRI (created_by/edited_by/created_at/
# edited_at/deleted_at/deleted_by) SENGAJA tidak diterima dari payload
# CRUD_FIELDS -- lihat clients_v1.py.
# ============================================================

CRUD_FIELDS_MANAGEMENT_CLIENT = [
    "client_code", "nama_client", "tipe_badan_usaha", "npwp", "nomor_akta_nib",
    "status_pkp", "klasifikasi_lapangan_usaha", "email", "no_telepon",
    "no_handphone", "nama_pic", "jabatan_pic", "alamat", "kota", "provinsi",
    "kode_pos", "industry", "tahun_buku_mulai", "mata_uang_default", "status",
    "akuntan_penanggung_jawab", "tanggal_mulai_kerjasama", "logo",
]

# CRUD_FIELDS_MANAGEMENT_CLIENT dipakai sejak fitur ini dibuat di atas class
# ManagementClient (dihapus, lihat catatan dekat class Client) yang atribut
# Python-nya = nama kolom fisik apa adanya. Sekarang jalan di atas class
# Client yang atributnya DIALIASKAN (lihat docstring class Client) -- map di
# bawah menerjemahkan nama field CRUD_FIELDS_MANAGEMENT_CLIENT (dipakai
# clients_v1.py & response API) ke nama atribut Python di Client, HANYA
# untuk yang namanya beda. Field yang tidak disebut di sini namanya identik
# di Client.
_CLIENT_FIELD_ALIAS = {
    "nama_client": "nama",
    "no_handphone": "nomor_wa",
    "nama_pic": "contact_name",
    "alamat": "address",
    "kota": "lokasi",
    "status": "status_kerjasama",
    "akuntan_penanggung_jawab": "assigned_accountant",
}


def _client_attr(kolom: str) -> str:
    return _CLIENT_FIELD_ALIAS.get(kolom, kolom)


def _management_client_ke_dict(mc: "Client") -> Dict[str, Any]:
    data = {kolom: getattr(mc, _client_attr(kolom)) for kolom in CRUD_FIELDS_MANAGEMENT_CLIENT}
    data.update({
        "id": mc.id,
        "created_at": mc.dibuat_at,
        "created_by": mc.dibuat_oleh,
        "edited_at": mc.diperbarui_at,
        "edited_by": mc.diperbarui_oleh,
        "aktif": mc.deleted_at is None,
    })
    return data


def create_management_client(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Buat client baru. `data` hanya boleh berisi key dari CRUD_FIELDS_MANAGEMENT_CLIENT."""
    session = SessionLocal()
    try:
        kwargs = {_client_attr(k): v for k, v in data.items() if k in CRUD_FIELDS_MANAGEMENT_CLIENT}
        mc = Client(**kwargs, dibuat_oleh=created_by)
        session.add(mc)
        session.flush()  # kirim INSERT & isi id/created_at (server_default) ke objek TANPA expire attribute lain (beda dari commit)
        hasil = _management_client_ke_dict(mc)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create management_client: {e}")
        return None
    finally:
        session.close()


def get_management_client_by_id(client_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    """Ambil 1 management_client berdasarkan id. Soft-deleted disembunyikan kecuali termasuk_nonaktif=True."""
    session = SessionLocal()
    try:
        query = session.query(Client).filter(Client.id == client_id)
        if not termasuk_nonaktif:
            query = query.filter(Client.deleted_at.is_(None))
        mc = query.first()
        return _management_client_ke_dict(mc) if mc else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def list_management_clients(termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    """Daftar semua management_client. Soft-deleted disembunyikan kecuali termasuk_nonaktif=True."""
    session = SessionLocal()
    try:
        query = session.query(Client)
        if not termasuk_nonaktif:
            query = query.filter(Client.deleted_at.is_(None))
        return [_management_client_ke_dict(mc) for mc in query.order_by(Client.dibuat_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def update_management_client(client_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Update sebagian/semua kolom management_client. `data` hanya boleh berisi key dari CRUD_FIELDS_MANAGEMENT_CLIENT."""
    session = SessionLocal()
    try:
        mc = session.query(Client).filter(
            Client.id == client_id, Client.deleted_at.is_(None)
        ).first()
        if not mc:
            return None
        for kolom, nilai in data.items():
            if kolom in CRUD_FIELDS_MANAGEMENT_CLIENT:
                setattr(mc, _client_attr(kolom), nilai)
        mc.diperbarui_at = datetime.now()
        mc.diperbarui_oleh = updated_by
        # Dibaca SEBELUM commit -- expire_on_commit bikin akses attribute
        # SETELAH commit perlu reload dari DB, dan reload itu (session.refresh
        # atau akses expired attribute) kena bug tipe UUID di beberapa dialect.
        # Semua nilai di bawah sudah final di memory (tidak ada onupdate= di
        # level DB untuk tabel ini), jadi aman dibaca sebelum commit.
        hasil = _management_client_ke_dict(mc)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error update management_client: {e}")
        return None
    finally:
        session.close()


def soft_delete_management_client(client_id: str, deleted_by: Optional[str] = None) -> bool:
    """Nonaktifkan (soft-delete) management_client -- data tidak dihapus permanen."""
    session = SessionLocal()
    try:
        mc = session.query(Client).filter(
            Client.id == client_id, Client.deleted_at.is_(None)
        ).first()
        if not mc:
            return False
        mc.deleted_at = datetime.now()
        mc.deleted_by = deleted_by
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error soft-delete management_client: {e}")
        return False
    finally:
        session.close()


# ============================================================
# TRANSACTIONS > SALES -- CRUD (lihat model di atas & DDL root/ddl-table)
# ============================================================
# Ke-6 tabel Sales sengaja punya bentuk kolom audit yang SAMA persis
# (id, created_at/created_by, edited_at/edited_by, deleted_at/deleted_by)
# -- beda dengan management_users/management_audit_trails yang pakai
# updated_at/updated_by. Daripada menulis ulang create/get/list/update/
# soft-delete 6x (30 fungsi hampir identik), dipakai helper generic di
# bawah (pola yang sama seperti _bulk_upsert() di atas), lalu tiap tabel
# tetap punya fungsi bernama sendiri (dipanggil dari modules/transactions)
# supaya pemanggil tidak perlu tahu soal model/fields secara langsung.

def _sales_row_ke_dict(obj, fields: List[str]) -> Dict[str, Any]:
    data = {kolom: getattr(obj, kolom) for kolom in fields}
    data.update({
        "id": obj.id,
        "created_at": obj.created_at,
        "created_by": obj.created_by,
        "edited_at": obj.edited_at,
        "edited_by": obj.edited_by,
        "aktif": obj.deleted_at is None,
    })
    return data


def _sales_crud_create(model, fields: List[str], data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = model(**{k: v for k, v in data.items() if k in fields}, created_by=created_by)
        session.add(obj)
        session.flush()  # kirim INSERT & isi id/created_at (server_default) tanpa expire attribute lain
        hasil = _sales_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _sales_crud_get_by_id(model, fields: List[str], row_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model).filter(model.id == row_id)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        obj = query.first()
        return _sales_row_ke_dict(obj, fields) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def _sales_crud_list(model, fields: List[str], filters: Optional[Dict[str, Any]] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model)
        for kolom, nilai in (filters or {}).items():
            if nilai is not None:
                query = query.filter(getattr(model, kolom) == nilai)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        return [_sales_row_ke_dict(obj, fields) for obj in query.order_by(model.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def _sales_crud_update(model, fields: List[str], row_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return None
        for kolom, nilai in data.items():
            if kolom in fields:
                setattr(obj, kolom, nilai)
        obj.edited_at = datetime.now()
        obj.edited_by = updated_by
        hasil = _sales_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error update {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _sales_crud_soft_delete(model, row_id: str, deleted_by: Optional[str] = None) -> bool:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return False
        obj.deleted_at = datetime.now()
        obj.deleted_by = deleted_by
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error soft-delete {model.__tablename__}: {e}")
        return False
    finally:
        session.close()


# --- 1) financial_transaction_sales_source_files ---

CRUD_FIELDS_SALES_SOURCE_FILE = [
    "client_id", "management_client_id", "file_name", "file_type", "storage_path", "period_label",
    "customer_hint", "rows_detected", "rows_valid", "rows_invalid",
    "duplicate_count", "status_ekstraksi", "status_mapping", "confidence_score",
    "dpp_total", "ppn_total", "grand_total", "extraction_duration_ms",
    "ai_model_version", "mapping_rules", "template_id", "processed_by", "uploaded_at", "uploaded_by",
]

def create_sales_source_file(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesSourceFile, CRUD_FIELDS_SALES_SOURCE_FILE, data, created_by)

def get_sales_source_file_by_id(source_file_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesSourceFile, CRUD_FIELDS_SALES_SOURCE_FILE, source_file_id, termasuk_nonaktif)

def list_sales_source_files(client_id: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _sales_crud_list(SalesSourceFile, CRUD_FIELDS_SALES_SOURCE_FILE, {"client_id": client_id}, termasuk_nonaktif)

def update_sales_source_file(source_file_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(SalesSourceFile, CRUD_FIELDS_SALES_SOURCE_FILE, source_file_id, data, updated_by)

def soft_delete_sales_source_file(source_file_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(SalesSourceFile, source_file_id, deleted_by)


# --- 2) financial_transaction_sales_source_rows ---

CRUD_FIELDS_SALES_SOURCE_ROW = [
    "source_file_id", "client_id", "row_no", "tanggal", "no_invoice",
    "nama_customer", "cabang", "dpp", "ppn", "total", "is_valid", "validation_notes",
    "is_duplicate_candidate",
]

def create_sales_source_row(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesSourceRow, CRUD_FIELDS_SALES_SOURCE_ROW, data, created_by)

def get_sales_source_row_by_id(source_row_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesSourceRow, CRUD_FIELDS_SALES_SOURCE_ROW, source_row_id, termasuk_nonaktif)

def list_sales_source_rows(source_file_id: Optional[str] = None, client_id: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _sales_crud_list(SalesSourceRow, CRUD_FIELDS_SALES_SOURCE_ROW, {"source_file_id": source_file_id, "client_id": client_id}, termasuk_nonaktif)

def update_sales_source_row(source_row_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(SalesSourceRow, CRUD_FIELDS_SALES_SOURCE_ROW, source_row_id, data, updated_by)

def soft_delete_sales_source_row(source_row_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(SalesSourceRow, source_row_id, deleted_by)


# --- 3) financial_transaction_sales_invoices ---

CRUD_FIELDS_SALES_INVOICE = [
    "client_id", "invoice_no", "invoice_date", "due_date", "customer_name",
    "customer_npwp", "description", "transaction_type", "project_name",
    "sales_person", "term_of_payment", "cabang", "dpp", "ppn", "pph", "gross_amount",
    "paid_amount", "tax_invoice_status", "posting_status", "reconcile_status",
    "journal_sync_status", "journal_entry_id", "source_row_id", "posted_at", "posted_by",
]

def _sales_invoice_ke_dict(obj: "SalesInvoice") -> Dict[str, Any]:
    data = _sales_row_ke_dict(obj, CRUD_FIELDS_SALES_INVOICE)
    data["outstanding_amount"] = obj.outstanding_amount
    return data

def create_sales_invoice(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        invoice = SalesInvoice(
            **{k: v for k, v in data.items() if k in CRUD_FIELDS_SALES_INVOICE},
            created_by=created_by,
        )
        session.add(invoice)
        session.commit()  # butuh commit (bukan sekadar flush) supaya outstanding_amount (GENERATED) ikut dihitung DB
        session.refresh(invoice)
        return _sales_invoice_ke_dict(invoice)
    except Exception as e:
        session.rollback()
        print(f"Error create financial_transaction_sales_invoices: {e}")
        return None
    finally:
        session.close()

def get_sales_invoice_by_id(invoice_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(SalesInvoice).filter(SalesInvoice.id == invoice_id)
        if not termasuk_nonaktif:
            query = query.filter(SalesInvoice.deleted_at.is_(None))
        invoice = query.first()
        return _sales_invoice_ke_dict(invoice) if invoice else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def get_sales_invoice_by_source_row_id(source_row_id: str) -> Optional[Dict[str, Any]]:
    """Cek apakah 1 source_row SUDAH pernah "dinaikkan" jadi invoice --
    dipakai endpoint promote-to-invoices (modules/transactions/
    sales_import_v1.py) supaya idempoten (aman dipanggil ulang, tidak
    membuat invoice dobel utk baris yang sama)."""
    session = SessionLocal()
    try:
        obj = session.query(SalesInvoice).filter(
            SalesInvoice.source_row_id == source_row_id,
            SalesInvoice.deleted_at.is_(None),
        ).first()
        return _sales_invoice_ke_dict(obj) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def get_sales_invoice_by_client_and_no(client_id: Optional[str], invoice_no: str) -> Optional[Dict[str, Any]]:
    """Dipakai untuk pre-check UniqueConstraint(client_id, invoice_no) SEBELUM
    insert, supaya endpoint bisa membalas 409 yang jelas (pola sama seperti
    dbc.get_user_by_username() di POST /api/v1/auth/register), bukan
    menunggu IntegrityError generik dari database."""
    session = SessionLocal()
    try:
        obj = session.query(SalesInvoice).filter(
            SalesInvoice.client_id == client_id,
            SalesInvoice.invoice_no == invoice_no,
            SalesInvoice.deleted_at.is_(None),
        ).first()
        return _sales_invoice_ke_dict(obj) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def list_sales_invoices(client_id: Optional[str] = None, posting_status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(SalesInvoice)
        if client_id is not None:
            query = query.filter(SalesInvoice.client_id == client_id)
        if posting_status is not None:
            query = query.filter(SalesInvoice.posting_status == posting_status)
        if not termasuk_nonaktif:
            query = query.filter(SalesInvoice.deleted_at.is_(None))
        return [_sales_invoice_ke_dict(obj) for obj in query.order_by(SalesInvoice.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

def update_sales_invoice(invoice_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        invoice = session.query(SalesInvoice).filter(
            SalesInvoice.id == invoice_id, SalesInvoice.deleted_at.is_(None)
        ).first()
        if not invoice:
            return None
        for kolom, nilai in data.items():
            if kolom in CRUD_FIELDS_SALES_INVOICE:
                setattr(invoice, kolom, nilai)
        invoice.edited_at = datetime.now()
        invoice.edited_by = updated_by
        session.commit()  # commit dulu (bukan flush) supaya outstanding_amount ikut dihitung ulang DB
        session.refresh(invoice)
        return _sales_invoice_ke_dict(invoice)
    except Exception as e:
        session.rollback()
        print(f"Error update financial_transaction_sales_invoices: {e}")
        return None
    finally:
        session.close()

def soft_delete_sales_invoice(invoice_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(SalesInvoice, invoice_id, deleted_by)


# --- 4) financial_transaction_sales_account_mappings ---

CRUD_FIELDS_SALES_ACCOUNT_MAPPING = [
    "client_id", "invoice_id", "piutang_account_code", "piutang_account_name",
    "pendapatan_account_code", "pendapatan_account_name", "ppn_account_code",
    "ppn_account_name", "pph_account_code", "pph_account_name",
    "is_ai_suggested", "ai_confidence", "mapped_by", "mapped_at",
]

def create_sales_account_mapping(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesAccountMapping, CRUD_FIELDS_SALES_ACCOUNT_MAPPING, data, created_by)

def get_sales_account_mapping_by_id(mapping_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesAccountMapping, CRUD_FIELDS_SALES_ACCOUNT_MAPPING, mapping_id, termasuk_nonaktif)

def get_sales_account_mapping_by_invoice(invoice_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    """Ambil mapping akun milik 1 invoice (relasinya 1:1, lihat UniqueConstraint invoice_id)."""
    session = SessionLocal()
    try:
        query = session.query(SalesAccountMapping).filter(SalesAccountMapping.invoice_id == invoice_id)
        if not termasuk_nonaktif:
            query = query.filter(SalesAccountMapping.deleted_at.is_(None))
        obj = query.first()
        return _sales_row_ke_dict(obj, CRUD_FIELDS_SALES_ACCOUNT_MAPPING) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def list_sales_account_mappings(client_id: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _sales_crud_list(SalesAccountMapping, CRUD_FIELDS_SALES_ACCOUNT_MAPPING, {"client_id": client_id}, termasuk_nonaktif)

def update_sales_account_mapping(mapping_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(SalesAccountMapping, CRUD_FIELDS_SALES_ACCOUNT_MAPPING, mapping_id, data, updated_by)

def soft_delete_sales_account_mapping(mapping_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(SalesAccountMapping, mapping_id, deleted_by)


# --- 5) financial_transaction_sales_exceptions ---

CRUD_FIELDS_SALES_EXCEPTION = [
    "client_id", "invoice_id", "source_row_id", "exception_type", "priority",
    "status", "ai_confidence", "ai_suggestion", "source_snippet",
    "assigned_to", "resolved_at", "resolved_by",
]

def create_sales_exception(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesException, CRUD_FIELDS_SALES_EXCEPTION, data, created_by)

def get_sales_exception_by_id(exception_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesException, CRUD_FIELDS_SALES_EXCEPTION, exception_id, termasuk_nonaktif)

def list_sales_exceptions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _sales_crud_list(SalesException, CRUD_FIELDS_SALES_EXCEPTION, {"client_id": client_id, "status": status}, termasuk_nonaktif)

def update_sales_exception(exception_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(SalesException, CRUD_FIELDS_SALES_EXCEPTION, exception_id, data, updated_by)

def soft_delete_sales_exception(exception_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(SalesException, exception_id, deleted_by)


# --- 6) financial_transaction_sales_activity_log ---
# Append-only (tidak ada update/soft-delete -- jejak aktivitas seharusnya
# tidak diubah/dihapus setelah tercatat).

CRUD_FIELDS_SALES_ACTIVITY_LOG = [
    "client_id", "invoice_id", "event_type", "description", "reference_no", "performed_by",
]

def create_sales_activity_log(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesActivityLog, CRUD_FIELDS_SALES_ACTIVITY_LOG, data, created_by)

def get_sales_activity_log_by_id(log_id: str) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesActivityLog, CRUD_FIELDS_SALES_ACTIVITY_LOG, log_id, termasuk_nonaktif=True)

def list_sales_activity_logs(client_id: Optional[str] = None, invoice_id: Optional[str] = None) -> List[Dict[str, Any]]:
    return _sales_crud_list(SalesActivityLog, CRUD_FIELDS_SALES_ACTIVITY_LOG, {"client_id": client_id, "invoice_id": invoice_id}, termasuk_nonaktif=True)


# --- 7) financial_transaction_sales_import_templates ---
# Lihat SALES_IMPORT_TEMPLATES.md (root) untuk alur lengkapnya. client_id
# di sini reference ke management_clients (BEDA dari 6 tabel Sales lain
# yang reference ke management_users) -- lihat catatan di ORM model.

CRUD_FIELDS_SALES_IMPORT_TEMPLATE = [
    "client_id", "client_code", "file_type", "sheet_name",
    "header_row_index", "data_start_row_index", "column_signature_hash",
    "header_columns", "mapping_rules", "detected_by", "ai_model_version",
    "ai_confidence", "is_active",
]

def create_sales_import_template(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(SalesImportTemplate, CRUD_FIELDS_SALES_IMPORT_TEMPLATE, data, created_by)

def get_sales_import_template_by_id(template_id: str) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(SalesImportTemplate, CRUD_FIELDS_SALES_IMPORT_TEMPLATE, template_id, termasuk_nonaktif=True)

def list_sales_import_templates(client_id: Optional[str] = None, file_type: Optional[str] = None, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Daftar template pola kolom -- dipakai untuk mencocokkan file baru
    (lihat _cocokkan_template di modules/transactions/sales_import_v1.py)
    dan untuk halaman kelola template (kalau dibangun nanti)."""
    session = SessionLocal()
    try:
        query = session.query(SalesImportTemplate).filter(SalesImportTemplate.deleted_at.is_(None))
        if client_id is not None:
            query = query.filter(SalesImportTemplate.client_id == client_id)
        if file_type is not None:
            query = query.filter(SalesImportTemplate.file_type == file_type)
        if hanya_aktif:
            query = query.filter(SalesImportTemplate.is_active.is_(True))
        return [_sales_row_ke_dict(obj, CRUD_FIELDS_SALES_IMPORT_TEMPLATE) for obj in query.order_by(SalesImportTemplate.usage_count.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

def touch_sales_import_template_usage(template_id: str) -> bool:
    """Naikkan usage_count +1 & set last_used_at=now() -- dipanggil setiap
    kali template ini berhasil dipakai mencocokkan file baru."""
    session = SessionLocal()
    try:
        obj = session.query(SalesImportTemplate).filter(SalesImportTemplate.id == template_id).first()
        if not obj:
            return False
        obj.usage_count = (obj.usage_count or 0) + 1
        obj.last_used_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error touch usage sales_import_template: {e}")
        return False
    finally:
        session.close()


# ============================================================
# FITUR TRANSACTIONS > JOURNAL ENTRY -- CRUD 4 tabel
# financial_transaction_journal_entry_* (DDL: root/ddl-table). Bentuk
# kolom audit SAMA persis dengan 6 tabel Sales (id, created_at/by,
# edited_at/by, deleted_at/by), jadi helper generic-nya juga sama polanya
# dengan _sales_crud_* di atas -- sengaja dipisah nama (bukan dipakai
# ulang lintas fitur) supaya tiap fitur tetap berdiri sendiri kalau salah
# satunya perlu berubah bentuk kolom audit-nya belakangan.

def _je_row_ke_dict(obj, fields: List[str]) -> Dict[str, Any]:
    data = {kolom: getattr(obj, kolom) for kolom in fields}
    data.update({
        "id": obj.id,
        "created_at": obj.created_at,
        "created_by": obj.created_by,
        "edited_at": obj.edited_at,
        "edited_by": obj.edited_by,
        "aktif": obj.deleted_at is None,
    })
    return data


def _je_crud_create(model, fields: List[str], data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = model(**{k: v for k, v in data.items() if k in fields}, created_by=created_by)
        session.add(obj)
        session.flush()
        hasil = _je_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _je_crud_get_by_id(model, fields: List[str], row_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model).filter(model.id == row_id)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        obj = query.first()
        return _je_row_ke_dict(obj, fields) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def _je_crud_list(model, fields: List[str], filters: Optional[Dict[str, Any]] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model)
        for kolom, nilai in (filters or {}).items():
            if nilai is not None:
                query = query.filter(getattr(model, kolom) == nilai)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        return [_je_row_ke_dict(obj, fields) for obj in query.order_by(model.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def _je_crud_update(model, fields: List[str], row_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return None
        for kolom, nilai in data.items():
            if kolom in fields:
                setattr(obj, kolom, nilai)
        obj.edited_at = datetime.now()
        obj.edited_by = updated_by
        hasil = _je_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error update {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _je_crud_soft_delete(model, row_id: str, deleted_by: Optional[str] = None) -> bool:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return False
        obj.deleted_at = datetime.now()
        obj.deleted_by = deleted_by
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error soft-delete {model.__tablename__}: {e}")
        return False
    finally:
        session.close()


# --- 1) financial_transaction_journal_entry_source_records ---

CRUD_FIELDS_JE_SOURCE_RECORD = [
    "client_id", "source_code", "source_type", "source_date", "description",
    "amount", "currency", "related_account_code", "related_account_name",
    "party_name", "mapping_status", "sync_status",
]

def create_je_source_record(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_create(JournalEntrySourceRecord, CRUD_FIELDS_JE_SOURCE_RECORD, data, created_by)

def get_je_source_record_by_id(source_record_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _je_crud_get_by_id(JournalEntrySourceRecord, CRUD_FIELDS_JE_SOURCE_RECORD, source_record_id, termasuk_nonaktif)

def get_je_source_record_by_client_and_code(client_id: Optional[str], source_code: str) -> Optional[Dict[str, Any]]:
    """Pre-check UniqueConstraint(client_id, source_code) sebelum insert,
    pola sama seperti get_sales_invoice_by_client_and_no()."""
    session = SessionLocal()
    try:
        obj = session.query(JournalEntrySourceRecord).filter(
            JournalEntrySourceRecord.client_id == client_id,
            JournalEntrySourceRecord.source_code == source_code,
            JournalEntrySourceRecord.deleted_at.is_(None),
        ).first()
        return _je_row_ke_dict(obj, CRUD_FIELDS_JE_SOURCE_RECORD) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def list_je_source_records(client_id: Optional[str] = None, source_type: Optional[str] = None, mapping_status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _je_crud_list(
        JournalEntrySourceRecord, CRUD_FIELDS_JE_SOURCE_RECORD,
        {"client_id": client_id, "source_type": source_type, "mapping_status": mapping_status},
        termasuk_nonaktif,
    )

def update_je_source_record(source_record_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_update(JournalEntrySourceRecord, CRUD_FIELDS_JE_SOURCE_RECORD, source_record_id, data, updated_by)

def soft_delete_je_source_record(source_record_id: str, deleted_by: Optional[str] = None) -> bool:
    return _je_crud_soft_delete(JournalEntrySourceRecord, source_record_id, deleted_by)


# --- 2) financial_transaction_journal_entry_drafts ---

CRUD_FIELDS_JE_DRAFT = [
    "client_id", "je_number", "entry_date", "posting_date", "period_label",
    "description", "source_type", "source_reference", "source_record_id",
    "total_debit", "total_credit", "currency", "status", "created_by_name",
    "reviewed_by_name", "approved_by_name", "notes", "journal_entry_id",
    "posted_at", "posted_by",
]

def create_je_draft(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_create(JournalEntryDraft, CRUD_FIELDS_JE_DRAFT, data, created_by)

def get_je_draft_by_id(draft_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _je_crud_get_by_id(JournalEntryDraft, CRUD_FIELDS_JE_DRAFT, draft_id, termasuk_nonaktif)

def get_je_draft_by_client_and_number(client_id: Optional[str], je_number: str) -> Optional[Dict[str, Any]]:
    """Pre-check UniqueConstraint(client_id, je_number) sebelum insert."""
    session = SessionLocal()
    try:
        obj = session.query(JournalEntryDraft).filter(
            JournalEntryDraft.client_id == client_id,
            JournalEntryDraft.je_number == je_number,
            JournalEntryDraft.deleted_at.is_(None),
        ).first()
        return _je_row_ke_dict(obj, CRUD_FIELDS_JE_DRAFT) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def list_je_drafts(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _je_crud_list(
        JournalEntryDraft, CRUD_FIELDS_JE_DRAFT,
        {"client_id": client_id, "status": status},
        termasuk_nonaktif,
    )

def update_je_draft(draft_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_update(JournalEntryDraft, CRUD_FIELDS_JE_DRAFT, draft_id, data, updated_by)

def soft_delete_je_draft(draft_id: str, deleted_by: Optional[str] = None) -> bool:
    return _je_crud_soft_delete(JournalEntryDraft, draft_id, deleted_by)


# --- 3) financial_transaction_journal_entry_draft_lines ---

CRUD_FIELDS_JE_DRAFT_LINE = [
    "draft_id", "client_id", "line_no", "account_code", "account_name",
    "description", "debit", "credit", "cost_center",
]

def create_je_draft_line(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_create(JournalEntryDraftLine, CRUD_FIELDS_JE_DRAFT_LINE, data, created_by)

def get_je_draft_line_by_id(line_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _je_crud_get_by_id(JournalEntryDraftLine, CRUD_FIELDS_JE_DRAFT_LINE, line_id, termasuk_nonaktif)

def list_je_draft_lines(draft_id: Optional[str] = None, client_id: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _je_crud_list(
        JournalEntryDraftLine, CRUD_FIELDS_JE_DRAFT_LINE,
        {"draft_id": draft_id, "client_id": client_id},
        termasuk_nonaktif,
    )

def update_je_draft_line(line_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_update(JournalEntryDraftLine, CRUD_FIELDS_JE_DRAFT_LINE, line_id, data, updated_by)

def soft_delete_je_draft_line(line_id: str, deleted_by: Optional[str] = None) -> bool:
    return _je_crud_soft_delete(JournalEntryDraftLine, line_id, deleted_by)


# --- 4) financial_transaction_journal_entry_activity_log ---
# Append-only (tidak ada update/soft-delete -- jejak aktivitas seharusnya
# tidak diubah/dihapus setelah tercatat), pola sama seperti
# SalesActivityLog.

CRUD_FIELDS_JE_ACTIVITY_LOG = [
    "client_id", "draft_id", "je_number", "event_type", "description",
    "status_snapshot", "performed_by",
]

def create_je_activity_log(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_create(JournalEntryActivityLog, CRUD_FIELDS_JE_ACTIVITY_LOG, data, created_by)

def get_je_activity_log_by_id(log_id: str) -> Optional[Dict[str, Any]]:
    return _je_crud_get_by_id(JournalEntryActivityLog, CRUD_FIELDS_JE_ACTIVITY_LOG, log_id, termasuk_nonaktif=True)

def list_je_activity_logs(client_id: Optional[str] = None, draft_id: Optional[str] = None) -> List[Dict[str, Any]]:
    return _je_crud_list(
        JournalEntryActivityLog, CRUD_FIELDS_JE_ACTIVITY_LOG,
        {"client_id": client_id, "draft_id": draft_id},
        termasuk_nonaktif=True,
    )


# --- 5) financial_transaction_journal_entry_import_templates ---
# Pola sama persis dengan financial_transaction_sales_import_templates
# (lihat SALES_IMPORT_TEMPLATES.md) -- client_id reference ke
# management_clients (BEDA dari 4 tabel Journal Entry lain di atas yang
# reference ke management_users), jadi TIDAK dipakaikan _je_crud_list biasa
# (list_sales_import_templates juga custom, ordering by usage_count).

CRUD_FIELDS_JE_IMPORT_TEMPLATE = [
    "client_id", "client_code", "file_type", "sheet_name",
    "header_row_index", "data_start_row_index", "column_signature_hash",
    "header_columns", "mapping_rules", "detected_by", "ai_model_version",
    "ai_confidence", "is_active",
]

def create_je_import_template(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _je_crud_create(JournalEntryImportTemplate, CRUD_FIELDS_JE_IMPORT_TEMPLATE, data, created_by)

def get_je_import_template_by_id(template_id: str) -> Optional[Dict[str, Any]]:
    return _je_crud_get_by_id(JournalEntryImportTemplate, CRUD_FIELDS_JE_IMPORT_TEMPLATE, template_id, termasuk_nonaktif=True)

def list_je_import_templates(client_id: Optional[str] = None, file_type: Optional[str] = None, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Daftar template pola kolom Journal Entry -- dipakai untuk mencocokkan
    file baru (lihat _cocokkan_template di modules/transactions/
    journal_entry_import_v1.py)."""
    session = SessionLocal()
    try:
        query = session.query(JournalEntryImportTemplate).filter(JournalEntryImportTemplate.deleted_at.is_(None))
        if client_id is not None:
            query = query.filter(JournalEntryImportTemplate.client_id == client_id)
        if file_type is not None:
            query = query.filter(JournalEntryImportTemplate.file_type == file_type)
        if hanya_aktif:
            query = query.filter(JournalEntryImportTemplate.is_active.is_(True))
        return [_je_row_ke_dict(obj, CRUD_FIELDS_JE_IMPORT_TEMPLATE) for obj in query.order_by(JournalEntryImportTemplate.usage_count.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

def touch_je_import_template_usage(template_id: str) -> bool:
    """Naikkan usage_count +1 & set last_used_at=now() -- dipanggil setiap
    kali template ini berhasil dipakai mencocokkan file baru."""
    session = SessionLocal()
    try:
        obj = session.query(JournalEntryImportTemplate).filter(JournalEntryImportTemplate.id == template_id).first()
        if not obj:
            return False
        obj.usage_count = (obj.usage_count or 0) + 1
        obj.last_used_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error touch usage je_import_template: {e}")
        return False
    finally:
        session.close()


def create_je_draft_with_lines(
    draft_data: Dict[str, Any],
    lines_data: List[Dict[str, Any]],
    created_by: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Buat 1 draft Journal Entry + SELURUH baris debit/kredit-nya dalam SATU
    transaksi (atomik) -- dipakai tombol "New Journal Entry" (input manual)
    di JE Transaction, supaya tidak ada draft "yatim" tanpa baris kalau
    request kedua (buat baris) gagal di tengah jalan seperti yang bisa
    terjadi kalau dipanggil sebagai 2 request terpisah (POST /drafts lalu
    N x POST /draft-lines). Juga sekalian mencatat activity_log "Created"
    (event yang sama yang WAJIB muncul di tab Overview -> Recent Activity
    begitu user membuat JE baru lewat UI).

    total_debit/total_credit di draft_data DIABAIKAN kalau ada -- dihitung
    ULANG dari SUM(lines) di sini supaya header tidak bisa "bohong" beda
    dari baris aslinya."""
    session = SessionLocal()
    try:
        total_debit = sum(Decimal(str(l.get("debit") or 0)) for l in lines_data)
        total_credit = sum(Decimal(str(l.get("credit") or 0)) for l in lines_data)

        draft = JournalEntryDraft(
            **{k: v for k, v in draft_data.items() if k in CRUD_FIELDS_JE_DRAFT and k not in ("total_debit", "total_credit")},
            total_debit=total_debit,
            total_credit=total_credit,
            created_by=created_by,
        )
        session.add(draft)
        session.flush()  # isi draft.id sebelum dipakai FK baris di bawah

        for idx, line in enumerate(lines_data, start=1):
            session.add(JournalEntryDraftLine(
                **{k: v for k, v in line.items() if k in CRUD_FIELDS_JE_DRAFT_LINE and k != "line_no"},
                draft_id=draft.id,
                client_id=draft.client_id,
                line_no=line.get("line_no") or idx,
                created_by=created_by,
            ))

        session.add(JournalEntryActivityLog(
            client_id=draft.client_id,
            draft_id=draft.id,
            je_number=draft.je_number,
            event_type="Created",
            description=f"Journal entry {draft.je_number} dibuat manual.",
            status_snapshot=draft.status,
            performed_by=draft_data.get("created_by_name") or "System",
            created_by=created_by,
        ))

        session.commit()
        session.refresh(draft)
        hasil = _je_row_ke_dict(draft, CRUD_FIELDS_JE_DRAFT)
        hasil["lines"] = [
            _je_row_ke_dict(l, CRUD_FIELDS_JE_DRAFT_LINE)
            for l in session.query(JournalEntryDraftLine)
                .filter(JournalEntryDraftLine.draft_id == draft.id)
                .order_by(JournalEntryDraftLine.line_no)
                .all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create draft+lines financial_transaction_journal_entry_drafts: {e}")
        return None
    finally:
        session.close()


# ============================================================
# FITUR TRANSACTIONS > PURCHASE -- CRUD 4 tabel
# financial_transaction_purchase_* (DDL: root/ddl-table). Bentuk kolom
# audit SAMA persis dengan Sales/Journal Entry (id, created_at/by,
# edited_at/by, deleted_at/by), helper generic-nya juga pola yang sama --
# sengaja dipisah nama (_purchase_crud_*, bukan dipakai ulang lintas
# fitur) supaya tiap fitur tetap berdiri sendiri, sama alasannya dengan
# _je_crud_* vs _sales_crud_*.

def _purchase_row_ke_dict(obj, fields: List[str]) -> Dict[str, Any]:
    data = {kolom: getattr(obj, kolom) for kolom in fields}
    data.update({
        "id": obj.id,
        "created_at": obj.created_at,
        "created_by": obj.created_by,
        "edited_at": obj.edited_at,
        "edited_by": obj.edited_by,
        "aktif": obj.deleted_at is None,
    })
    return data


def _purchase_crud_create(model, fields: List[str], data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = model(**{k: v for k, v in data.items() if k in fields}, created_by=created_by)
        session.add(obj)
        session.flush()
        hasil = _purchase_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _purchase_crud_get_by_id(model, fields: List[str], row_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model).filter(model.id == row_id)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        obj = query.first()
        return _purchase_row_ke_dict(obj, fields) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def _purchase_crud_list(model, fields: List[str], filters: Optional[Dict[str, Any]] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model)
        for kolom, nilai in (filters or {}).items():
            if nilai is not None:
                query = query.filter(getattr(model, kolom) == nilai)
        if not termasuk_nonaktif:
            query = query.filter(model.deleted_at.is_(None))
        return [_purchase_row_ke_dict(obj, fields) for obj in query.order_by(model.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


def _purchase_crud_update(model, fields: List[str], row_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return None
        for kolom, nilai in data.items():
            if kolom in fields:
                setattr(obj, kolom, nilai)
        obj.edited_at = datetime.now()
        obj.edited_by = updated_by
        hasil = _purchase_row_ke_dict(obj, fields)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error update {model.__tablename__}: {e}")
        return None
    finally:
        session.close()


def _purchase_crud_soft_delete(model, row_id: str, deleted_by: Optional[str] = None) -> bool:
    session = SessionLocal()
    try:
        obj = session.query(model).filter(model.id == row_id, model.deleted_at.is_(None)).first()
        if not obj:
            return False
        obj.deleted_at = datetime.now()
        obj.deleted_by = deleted_by
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error soft-delete {model.__tablename__}: {e}")
        return False
    finally:
        session.close()


# --- 1) financial_transaction_purchase_source_records ---

CRUD_FIELDS_PURCHASE_SOURCE_RECORD = [
    "client_id", "source_code", "source_type", "vendor_name", "vendor_code",
    "source_date", "invoice_number", "po_number", "description", "amount",
    "tax_amount", "total_amount", "currency", "status", "validation_status",
    "period_label",
]

def create_purchase_source_record(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseSourceRecord, CRUD_FIELDS_PURCHASE_SOURCE_RECORD, data, created_by)

def get_purchase_source_record_by_id(source_record_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseSourceRecord, CRUD_FIELDS_PURCHASE_SOURCE_RECORD, source_record_id, termasuk_nonaktif)

def get_purchase_source_record_by_client_and_code(client_id: Optional[str], source_code: str) -> Optional[Dict[str, Any]]:
    """Pre-check UniqueConstraint(client_id, source_code) sebelum insert,
    pola sama seperti get_je_source_record_by_client_and_code()."""
    session = SessionLocal()
    try:
        obj = session.query(PurchaseSourceRecord).filter(
            PurchaseSourceRecord.client_id == client_id,
            PurchaseSourceRecord.source_code == source_code,
            PurchaseSourceRecord.deleted_at.is_(None),
        ).first()
        return _purchase_row_ke_dict(obj, CRUD_FIELDS_PURCHASE_SOURCE_RECORD) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def list_purchase_source_records(client_id: Optional[str] = None, source_type: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    hasil = _purchase_crud_list(
        PurchaseSourceRecord, CRUD_FIELDS_PURCHASE_SOURCE_RECORD,
        {"client_id": client_id, "source_type": source_type, "status": status},
        termasuk_nonaktif,
    )
    # relatedPurchaseId (frontend) TIDAK disimpan sebagai kolom (hindari FK
    # sirkular, lihat catatan di DDL) -- dicari lewat reverse query 1x per
    # panggilan, bukan per-baris (N+1), lalu ditempel ke tiap record.
    if hasil:
        session = SessionLocal()
        try:
            ids = [r["id"] for r in hasil]
            baris = session.query(PurchaseTransaction.id, PurchaseTransaction.source_record_id).filter(
                PurchaseTransaction.source_record_id.in_(ids),
                PurchaseTransaction.deleted_at.is_(None),
            ).all()
            peta = {src_id: tx_id for tx_id, src_id in baris}
            for r in hasil:
                r["related_transaction_id"] = peta.get(r["id"])
        except Exception:
            session.rollback()
            for r in hasil:
                r["related_transaction_id"] = None
        finally:
            session.close()
    return hasil

def update_purchase_source_record(source_record_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_update(PurchaseSourceRecord, CRUD_FIELDS_PURCHASE_SOURCE_RECORD, source_record_id, data, updated_by)

def soft_delete_purchase_source_record(source_record_id: str, deleted_by: Optional[str] = None) -> bool:
    return _purchase_crud_soft_delete(PurchaseSourceRecord, source_record_id, deleted_by)


# --- 2) financial_transaction_purchase_transactions ---

CRUD_FIELDS_PURCHASE_TRANSACTION = [
    "client_id", "purchase_no", "purchase_date", "invoice_date", "invoice_number",
    "po_number", "vendor_name", "vendor_code", "source_doc_type", "source_ref",
    "source_record_id", "description", "category", "subtotal", "discount",
    "tax_amount", "total", "accounts_payable", "currency", "payment_status",
    "payment_terms", "due_date", "status", "period_label", "created_by_name",
    "approved_by_name", "posted_by_name", "notes", "journal_entry_id",
    "posting_date", "posted_at",
]

def create_purchase_transaction(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseTransaction, CRUD_FIELDS_PURCHASE_TRANSACTION, data, created_by)

def get_purchase_transaction_by_id(transaction_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseTransaction, CRUD_FIELDS_PURCHASE_TRANSACTION, transaction_id, termasuk_nonaktif)

def get_purchase_transaction_by_client_and_no(client_id: Optional[str], purchase_no: str) -> Optional[Dict[str, Any]]:
    """Pre-check UniqueConstraint(client_id, purchase_no) sebelum insert,
    pola sama seperti get_sales_invoice_by_client_and_no()."""
    session = SessionLocal()
    try:
        obj = session.query(PurchaseTransaction).filter(
            PurchaseTransaction.client_id == client_id,
            PurchaseTransaction.purchase_no == purchase_no,
            PurchaseTransaction.deleted_at.is_(None),
        ).first()
        return _purchase_row_ke_dict(obj, CRUD_FIELDS_PURCHASE_TRANSACTION) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()

def list_purchase_transactions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _purchase_crud_list(
        PurchaseTransaction, CRUD_FIELDS_PURCHASE_TRANSACTION,
        {"client_id": client_id, "status": status},
        termasuk_nonaktif,
    )

def update_purchase_transaction(transaction_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_update(PurchaseTransaction, CRUD_FIELDS_PURCHASE_TRANSACTION, transaction_id, data, updated_by)

def soft_delete_purchase_transaction(transaction_id: str, deleted_by: Optional[str] = None) -> bool:
    return _purchase_crud_soft_delete(PurchaseTransaction, transaction_id, deleted_by)


# --- 3) financial_transaction_purchase_transaction_lines ---

CRUD_FIELDS_PURCHASE_TRANSACTION_LINE = [
    "transaction_id", "client_id", "line_no", "item_code", "description",
    "quantity", "unit", "unit_price", "discount", "tax_rate", "tax_amount",
    "subtotal", "total", "account_code", "account_name",
]

def create_purchase_transaction_line(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseTransactionLine, CRUD_FIELDS_PURCHASE_TRANSACTION_LINE, data, created_by)

def get_purchase_transaction_line_by_id(line_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseTransactionLine, CRUD_FIELDS_PURCHASE_TRANSACTION_LINE, line_id, termasuk_nonaktif)

def list_purchase_transaction_lines(transaction_id: Optional[str] = None, client_id: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _purchase_crud_list(
        PurchaseTransactionLine, CRUD_FIELDS_PURCHASE_TRANSACTION_LINE,
        {"transaction_id": transaction_id, "client_id": client_id},
        termasuk_nonaktif,
    )

def update_purchase_transaction_line(line_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_update(PurchaseTransactionLine, CRUD_FIELDS_PURCHASE_TRANSACTION_LINE, line_id, data, updated_by)

def soft_delete_purchase_transaction_line(line_id: str, deleted_by: Optional[str] = None) -> bool:
    return _purchase_crud_soft_delete(PurchaseTransactionLine, line_id, deleted_by)


# --- 4) financial_transaction_purchase_exceptions ---

CRUD_FIELDS_PURCHASE_EXCEPTION = [
    "client_id", "transaction_id", "source_record_id", "exception_type",
    "severity", "status", "vendor_name", "invoice_number", "purchase_date",
    "amount", "currency", "description", "detected_at", "assigned_to",
    "resolution", "resolved_at", "period_label",
]

def create_purchase_exception(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION, data, created_by)

def get_purchase_exception_by_id(exception_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION, exception_id, termasuk_nonaktif)

def list_purchase_exceptions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False) -> List[Dict[str, Any]]:
    return _purchase_crud_list(
        PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION,
        {"client_id": client_id, "status": status},
        termasuk_nonaktif,
    )

def update_purchase_exception(exception_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_update(PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION, exception_id, data, updated_by)

def soft_delete_purchase_exception(exception_id: str, deleted_by: Optional[str] = None) -> bool:
    return _purchase_crud_soft_delete(PurchaseException, exception_id, deleted_by)


def create_purchase_transaction_with_lines(
    transaction_data: Dict[str, Any],
    lines_data: List[Dict[str, Any]],
    created_by: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Buat 1 Purchase Transaction + SELURUH baris item/jasa-nya dalam SATU
    transaksi (atomik) -- pola sama persis alasannya dengan
    create_je_draft_with_lines() (supaya tidak ada transaksi "yatim" tanpa
    baris kalau salah satu insert baris gagal di tengah jalan).

    subtotal/discount/tax_amount/total di transaction_data DIABAIKAN kalau
    ada -- dihitung ULANG dari SUM(lines) di sini supaya header tidak bisa
    "bohong" beda dari baris aslinya (pola sama dengan total_debit/
    total_credit di create_je_draft_with_lines). accounts_payable default
    ikut total kalau tidak dikirim eksplisit."""
    session = SessionLocal()
    try:
        subtotal = sum(Decimal(str(l.get("subtotal") or 0)) for l in lines_data)
        discount = sum(Decimal(str(l.get("discount") or 0)) for l in lines_data)
        tax_amount = sum(Decimal(str(l.get("tax_amount") or 0)) for l in lines_data)
        total = sum(Decimal(str(l.get("total") or 0)) for l in lines_data)
        accounts_payable = Decimal(str(transaction_data.get("accounts_payable"))) if transaction_data.get("accounts_payable") is not None else total

        tx = PurchaseTransaction(
            **{k: v for k, v in transaction_data.items() if k in CRUD_FIELDS_PURCHASE_TRANSACTION and k not in ("subtotal", "discount", "tax_amount", "total", "accounts_payable")},
            subtotal=subtotal,
            discount=discount,
            tax_amount=tax_amount,
            total=total,
            accounts_payable=accounts_payable,
            created_by=created_by,
        )
        session.add(tx)
        session.flush()  # isi tx.id sebelum dipakai FK baris di bawah

        for idx, line in enumerate(lines_data, start=1):
            session.add(PurchaseTransactionLine(
                **{k: v for k, v in line.items() if k in CRUD_FIELDS_PURCHASE_TRANSACTION_LINE and k != "line_no"},
                transaction_id=tx.id,
                client_id=tx.client_id,
                line_no=line.get("line_no") or idx,
                created_by=created_by,
            ))

        session.commit()
        session.refresh(tx)
        hasil = _purchase_row_ke_dict(tx, CRUD_FIELDS_PURCHASE_TRANSACTION)
        hasil["lines"] = [
            _purchase_row_ke_dict(l, CRUD_FIELDS_PURCHASE_TRANSACTION_LINE)
            for l in session.query(PurchaseTransactionLine)
                .filter(PurchaseTransactionLine.transaction_id == tx.id)
                .order_by(PurchaseTransactionLine.line_no)
                .all()
        ]
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error create transaction+lines financial_transaction_purchase_transactions: {e}")
        return None
    finally:
        session.close()


# ============================================================
# FUNGSI TAMBAHAN CLIENT
# ============================================================

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

# ============================================================
# MODUL TAX & COMPLIANCE (BARU) -- 2 tabel dibuat manual oleh user lewat
# Supabase, schema "5_Planning": fiscal_correction (rekonsiliasi
# akuntansi vs fiskal per kategori/bulan -- sumber TaxReconciliation.tsx)
# dan tax_compliance_task (checklist tugas kepatuhan pajak custom --
# sumber ComplianceTasks.tsx). Kewajiban pajak (PPN/PPh) ITU SENDIRI TETAP
# diturunkan dari jurnal transaksi (lihat taxBridge.ts di frontend,
# kategori transaksi 'Tax') -- dua tabel ini melengkapi bagian yang TIDAK
# bisa diturunkan dari jurnal: koreksi fiskal manual & checklist tugas.
# ============================================================

class FiscalCorrection(Base):
    __tablename__ = "planning_tax_compliance_fiscal_correction"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    tahun = Column(Integer, nullable=False)
    bulan = Column(Integer, nullable=False)
    kategori = Column(String, nullable=False)
    accounting_value = Column(Numeric, nullable=True)
    tax_value = Column(Numeric, nullable=True)
    keterangan = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class TaxComplianceTask(Base):
    __tablename__ = "planning_tax_compliance_task"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    task_name = Column(String, nullable=False)
    tax_type = Column(String, nullable=True)
    period = Column(String, nullable=True)
    owner = Column(String, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String, nullable=True)
    priority = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


def ambil_fiscal_correction(client_id: str, tahun: int) -> Dict[str, Any]:
    """[BARU] Koreksi fiskal tersimpan (satu tahun penuh) -- sumber
    TaxReconciliation.tsx. Kalau client aktif belum punya baris apapun utk
    tahun ini, ada_data=False supaya frontend tetap pakai placeholder lama
    (asumsi akuntansi = fiskal, status 'Reconciled').
    Dipakai GET /api/client/{client_id}/fiscal-correction."""
    session = SessionLocal()
    try:
        rows = session.query(FiscalCorrection).filter(
            FiscalCorrection.client_id == client_id,
            FiscalCorrection.tahun == tahun,
        ).order_by(FiscalCorrection.bulan.desc(), FiscalCorrection.kategori).all()

        def _num(v):
            return float(v) if v is not None else 0.0

        data = [{
            "id": str(r.id), "bulan": r.bulan, "kategori": r.kategori,
            "accountingValue": _num(r.accounting_value), "taxValue": _num(r.tax_value),
            "keterangan": r.keterangan,
        } for r in rows]
        return {"ada_data": len(data) > 0, "corrections": data}
    finally:
        session.close()


def daftar_tax_tasks(client_id: str) -> Dict[str, Any]:
    """[BARU] Daftar task kepatuhan pajak CUSTOM tersimpan (bukan yang
    auto-generated dari obligasi belum lunas -- itu tetap dihitung di
    frontend dari taxBridge.ts). Dipakai GET
    /api/client/{client_id}/tax-compliance-tasks."""
    session = SessionLocal()
    try:
        rows = session.query(TaxComplianceTask).filter(
            TaxComplianceTask.client_id == client_id,
        ).order_by(TaxComplianceTask.created_at.desc()).all()
        return {"tasks": [{
            "id": str(r.id), "taskName": r.task_name, "taxType": r.tax_type, "period": r.period,
            "owner": r.owner, "dueDate": r.due_date.isoformat() if r.due_date else None,
            "status": r.status, "priority": r.priority,
        } for r in rows]}
    finally:
        session.close()


def tambah_tax_task(client_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """[BARU] Tambah 1 task kepatuhan pajak custom -- tombol "Add Task" di
    ComplianceTasks.tsx. Dipakai POST
    /api/client/{client_id}/tax-compliance-tasks."""
    session = SessionLocal()
    try:
        row = TaxComplianceTask(
            id=str(uuid.uuid4()),
            client_id=client_id,
            task_name=data.get("taskName"),
            tax_type=data.get("taxType"),
            period=data.get("period"),
            owner=data.get("owner") or "Unassigned",
            due_date=data.get("dueDate"),
            status=data.get("status") or "Not Started",
            priority=data.get("priority") or "Medium",
            created_at=datetime.utcnow(),
        )
        session.add(row)
        session.commit()
        return {
            "id": row.id, "taskName": row.task_name, "taxType": row.tax_type, "period": row.period,
            "owner": row.owner, "dueDate": row.due_date, "status": row.status, "priority": row.priority,
        }
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_status_tax_task(client_id: str, task_id: str, status: str) -> Dict[str, Any]:
    """[BARU] Ubah status task kepatuhan pajak custom (klik utk memajukan
    status di ComplianceTasks.tsx). Dipakai PATCH
    /api/client/{client_id}/tax-compliance-tasks/{task_id}."""
    session = SessionLocal()
    try:
        row = session.query(TaxComplianceTask).filter(
            TaxComplianceTask.id == task_id,
            TaxComplianceTask.client_id == client_id,
        ).first()
        if not row:
            return {"berhasil": False, "pesan": "Task tidak ditemukan"}
        row.status = status
        row.updated_at = datetime.utcnow()
        session.commit()
        return {"berhasil": True}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def hapus_tax_task(client_id: str, task_id: str) -> Dict[str, Any]:
    """[BARU] Hapus task kepatuhan pajak custom. Dipakai DELETE
    /api/client/{client_id}/tax-compliance-tasks/{task_id}."""
    session = SessionLocal()
    try:
        row = session.query(TaxComplianceTask).filter(
            TaxComplianceTask.id == task_id,
            TaxComplianceTask.client_id == client_id,
        ).first()
        if not row:
            return {"berhasil": False, "pesan": "Task tidak ditemukan"}
        session.delete(row)
        session.commit()
        return {"berhasil": True}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

# ============================================================
# MODUL AUDIT (BARU) -- 4 tabel dibuat manual oleh user lewat Supabase,
# schema "6_Intelligence": audit_finding (temuan audit + risk/status/
# root cause/rekomendasi/tanggapan manajemen), audit_stage (progres
# tahapan audit tahunan), audit_activity (log aktivitas per finding/
# client -- auto-tercatat setiap ada perubahan finding/evidence), dan
# audit_evidence (lampiran file per finding -- disimpan sbg bytea
# LANGSUNG di Postgres, TIDAK pakai Supabase Storage, supaya tidak
# nambah dependency baru). Sumber src/app/audit/page.tsx -- sebelumnya
# findings/auditStages/auditActivities di halaman itu SENGAJA array
# statis kosong karena belum ada tabel. Lihat
# src/app/audit/lib/auditBridge.ts untuk sisi frontend.
# ============================================================

class AuditFindingRow(Base):
    __tablename__ = "intelligence_audit_finding"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    finding_no = Column(Integer, nullable=False)
    area = Column(String, nullable=True)
    description = Column(Text, nullable=False)
    account = Column(String, nullable=True)
    amount = Column(Numeric, nullable=True)
    risk = Column(String, nullable=False)
    assigned_to = Column(String, nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String, nullable=False)
    root_cause = Column(Text, nullable=True)
    recommendation = Column(Text, nullable=True)
    management_response = Column(Text, nullable=True)
    likelihood = Column(Integer, nullable=False)
    impact = Column(Integer, nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class AuditStageRow(Base):
    __tablename__ = "intelligence_audit_stage"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    label = Column(String, nullable=False)
    stage_date = Column(Date, nullable=True)
    done = Column(Boolean, nullable=False)
    is_current = Column(Boolean, nullable=False)
    sort_order = Column(Integer, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=True)
    updated_at = Column("edited_at", DateTime(timezone=True), nullable=True)


class AuditActivityRow(Base):
    __tablename__ = "intelligence_audit_activity"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    finding_id = Column(PG_UUID(as_uuid=False), ForeignKey("intelligence_audit_finding.id"), nullable=True)    user_name = Column(String, nullable=False)
    action = Column(String, nullable=False)
    activity_type = Column(String, nullable=False)
    activity_date = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=True)


class AuditEvidenceRow(Base):
    __tablename__ = "intelligence_audit_evidence"

    id = Column(PG_UUID(as_uuid=False), primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    finding_id = Column(PG_UUID(as_uuid=False), ForeignKey("intelligence_audit_finding.id"), nullable=False)    file_name = Column(String, nullable=False)
    file_size = Column(BigInteger, nullable=True)
    uploaded_by = Column(String, nullable=True)
    uploaded_at = Column(DateTime(timezone=True), nullable=True)
    mime_type = Column(String, nullable=True)
    file_content = Column(LargeBinary, nullable=True)


AUDIT_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024  # [BARU] batas ukuran 1 file evidence


def _audit_num(v):
    return float(v) if v is not None else 0.0


def _audit_iso_date(d):
    return d.isoformat() if d else None


def _audit_iso_dt(dt):
    return dt.isoformat() if dt else None


def ambil_data_audit(client_id: str) -> Dict[str, Any]:
    """[BARU] Data mentah modul Audit (finding, stage, activity, evidence
    -- METADATA saja, isi file TIDAK diikutkan supaya payload ringan)
    untuk satu client, schema "6_Intelligence". Dipetakan ke tipe
    AuditFinding/Stage/Activity/Evidence di frontend oleh
    src/app/audit/lib/auditBridge.ts. Dipakai GET
    /api/client/{client_id}/audit."""
    session = SessionLocal()
    try:
        finding_rows = session.query(AuditFindingRow).filter(
            AuditFindingRow.client_id == client_id,
        ).order_by(AuditFindingRow.finding_no).all()
        stage_rows = session.query(AuditStageRow).filter(
            AuditStageRow.client_id == client_id,
        ).order_by(AuditStageRow.sort_order).all()
        activity_rows = session.query(AuditActivityRow).filter(
            AuditActivityRow.client_id == client_id,
        ).order_by(AuditActivityRow.activity_date.desc()).all()
        evidence_rows = session.query(AuditEvidenceRow).filter(
            AuditEvidenceRow.client_id == client_id,
        ).order_by(AuditEvidenceRow.uploaded_at.desc()).all()

        return {
            "findings": [{
                "id": str(f.id), "findingNo": f.finding_no, "area": f.area,
                "description": f.description, "account": f.account,
                "amount": _audit_num(f.amount), "risk": f.risk,
                "assignedTo": f.assigned_to, "dueDate": _audit_iso_date(f.due_date),
                "status": f.status, "rootCause": f.root_cause,
                "recommendation": f.recommendation,
                "managementResponse": f.management_response,
                "likelihood": f.likelihood, "impact": f.impact,
            } for f in finding_rows],
            "stages": [{
                "id": str(s.id), "label": s.label, "date": _audit_iso_date(s.stage_date),
                "done": s.done, "current": s.is_current, "sortOrder": s.sort_order,
            } for s in stage_rows],
            "activities": [{
                "id": str(a.id), "findingId": str(a.finding_id) if a.finding_id else None,
                "user": a.user_name, "action": a.action, "type": a.activity_type,
                "date": _audit_iso_dt(a.activity_date),
            } for a in activity_rows],
            "evidence": [{
                "id": str(e.id), "findingId": str(e.finding_id), "fileName": e.file_name,
                "fileSize": e.file_size, "uploadedBy": e.uploaded_by,
                "uploadedAt": _audit_iso_dt(e.uploaded_at), "mimeType": e.mime_type,
            } for e in evidence_rows],
        }
    finally:
        session.close()


def tambah_audit_finding(client_id: str, data: Dict[str, Any], user: str) -> Dict[str, Any]:
    """[BARU] Tambah 1 temuan audit baru (tombol "New Finding" di
    src/app/audit/page.tsx). Nomor finding (finding_no) diambil MAX+1
    per client. Otomatis mencatat 1 baris audit_activity type="finding".
    Dipakai POST /api/client/{client_id}/audit/findings."""
    session = SessionLocal()
    try:
        max_no = session.query(func.max(AuditFindingRow.finding_no)).filter(
            AuditFindingRow.client_id == client_id,
        ).scalar()
        finding_no = (max_no or 0) + 1
        new_id = str(uuid.uuid4())
        now = datetime.utcnow()
        row = AuditFindingRow(
            id=new_id, client_id=client_id, finding_no=finding_no,
            area=data.get("area"), description=data["description"],
            account=data.get("account"), amount=data.get("amount") or 0,
            risk=data.get("risk") or "Medium", assigned_to=data.get("assignedTo"),
            due_date=data.get("dueDate"), status=data.get("status") or "Open",
            root_cause=data.get("rootCause"), recommendation=data.get("recommendation"),
            management_response=data.get("managementResponse"),
            likelihood=data.get("likelihood") or 3, impact=data.get("impact") or 3,
            created_by=user, created_at=now, updated_at=now,
        )
        session.add(row)
        session.flush()
        activity = AuditActivityRow(
            id=str(uuid.uuid4()), client_id=client_id, finding_id=row.id,
            user_name=user, action=f"membuat temuan baru: {row.description[:80]}",
            activity_type="finding", activity_date=now, created_at=now,
        )
        session.add(activity)
        session.commit()
        return {"id": str(row.id), "findingNo": row.finding_no}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_audit_finding(client_id: str, finding_id: str, fields: Dict[str, Any], user: str) -> Optional[Dict[str, Any]]:
    """[BARU] Ubah field temuan audit yang ada -- dipakai tombol Review/
    Resolve/Escalate di FindingDrawer, atau isi Management Response
    (src/app/audit/page.tsx). Otomatis mencatat 1 baris audit_activity
    dengan type sesuai perubahan (status -> Resolved jadi type
    "resolved", management_response terisi jadi type "response", selain
    itu type "test"). Dipakai PATCH
    /api/client/{client_id}/audit/findings/{finding_id}."""
    session = SessionLocal()
    try:
        row = session.query(AuditFindingRow).filter(
            AuditFindingRow.id == finding_id, AuditFindingRow.client_id == client_id,
        ).first()
        if not row:
            return None

        field_map = {
            "risk": "risk", "rootCause": "root_cause",
            "recommendation": "recommendation", "assignedTo": "assigned_to",
            "dueDate": "due_date", "likelihood": "likelihood", "impact": "impact",
        }
        action_label = "memperbarui temuan"
        activity_type = "test"
        if "status" in fields:
            row.status = fields["status"]
            action_label = f"mengubah status jadi {fields['status']}"
            activity_type = "resolved" if fields["status"] == "Resolved" else "finding"
        if "managementResponse" in fields:
            row.management_response = fields["managementResponse"]
            action_label = "menambahkan tanggapan manajemen"
            activity_type = "response"
        for key, col in field_map.items():
            if key in fields:
                setattr(row, col, fields[key])
        row.updated_at = datetime.utcnow()

        activity = AuditActivityRow(
            id=str(uuid.uuid4()), client_id=client_id, finding_id=row.id,
            user_name=user, action=action_label, activity_type=activity_type,
            activity_date=datetime.utcnow(), created_at=datetime.utcnow(),
        )
        session.add(activity)
        session.commit()
        return {"id": str(row.id), "status": row.status}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def tambah_audit_evidence(client_id: str, finding_id: str, file_name: str, file_size: int,
                           mime_type: Optional[str], file_content: bytes, user: str) -> Dict[str, Any]:
    """[BARU] Upload 1 file evidence utk 1 temuan (tombol "Add Evidence"
    di FindingDrawer). File disimpan langsung sbg bytea di Postgres
    (bukan Supabase Storage). Otomatis mencatat 1 baris audit_activity
    type="evidence". Dipakai POST
    /api/client/{client_id}/audit/findings/{finding_id}/evidence."""
    session = SessionLocal()
    try:
        finding = session.query(AuditFindingRow).filter(
            AuditFindingRow.id == finding_id, AuditFindingRow.client_id == client_id,
        ).first()
        if not finding:
            raise ValueError("Temuan audit tidak ditemukan untuk client ini.")
        # [BARU] Validasi sebelum disimpan sbg bytea -- file kosong/tanpa nama
        # atau file terlalu besar (>10 MB) TIDAK ditulis ke database.
        if not (file_name or "").strip():
            raise ValueError("Nama file tidak valid.")
        if not file_content:
            raise ValueError("File kosong.")
        if file_size > AUDIT_EVIDENCE_MAX_BYTES:
            raise ValueError(f"Ukuran file melebihi batas {AUDIT_EVIDENCE_MAX_BYTES // (1024 * 1024)} MB.")
        now = datetime.utcnow()
        row = AuditEvidenceRow(
            id=str(uuid.uuid4()), client_id=client_id, finding_id=finding_id,
            file_name=file_name, file_size=file_size, uploaded_by=user,
            uploaded_at=now, mime_type=mime_type, file_content=file_content,
        )
        session.add(row)
        session.flush()
        activity = AuditActivityRow(
            id=str(uuid.uuid4()), client_id=client_id, finding_id=finding_id,
            user_name=user, action=f"melampirkan bukti: {file_name}",
            activity_type="evidence", activity_date=now, created_at=now,
        )
        session.add(activity)
        session.commit()
        return {"id": str(row.id), "fileName": row.file_name, "fileSize": row.file_size}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ambil_audit_evidence_file(evidence_id: str, client_id: str) -> Optional[Dict[str, Any]]:
    """[BARU] Ambil isi 1 file evidence (utk tombol download). Dipakai
    GET /api/client/{client_id}/audit/evidence/{evidence_id}/file."""
    session = SessionLocal()
    try:
        row = session.query(AuditEvidenceRow).filter(
            AuditEvidenceRow.id == evidence_id, AuditEvidenceRow.client_id == client_id,
        ).first()
        if not row:
            return None
        return {
            "fileName": row.file_name,
            "mimeType": row.mime_type or "application/octet-stream",
            "content": row.file_content,
        }
    finally:
        session.close()


def hapus_audit_evidence(evidence_id: str, client_id: str) -> Dict[str, Any]:
    """[BARU] Hapus 1 file evidence. Dipakai DELETE
    /api/client/{client_id}/audit/evidence/{evidence_id}."""
    session = SessionLocal()
    try:
        row = session.query(AuditEvidenceRow).filter(
            AuditEvidenceRow.id == evidence_id, AuditEvidenceRow.client_id == client_id,
        ).first()
        if not row:
            raise LookupError("Evidence tidak ditemukan untuk client ini.")
        session.delete(row)
        session.commit()
        return {"berhasil": True}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ubah_audit_stage(client_id: str, stage_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """[BARU] Tandai 1 tahapan audit selesai/sedang-berjalan (klik di
    Audit Progress bar, src/app/audit/page.tsx). Kalau current=True
    diset utk satu stage, stage lain milik client yg sama otomatis
    dilepas current-nya (supaya cuma 1 yang aktif). Dipakai PATCH
    /api/client/{client_id}/audit/stage/{stage_id}."""
    session = SessionLocal()
    try:
        row = session.query(AuditStageRow).filter(
            AuditStageRow.id == stage_id, AuditStageRow.client_id == client_id,
        ).first()
        if not row:
            return None
        if "done" in fields:
            row.done = fields["done"]
        if fields.get("current"):
            session.query(AuditStageRow).filter(
                AuditStageRow.client_id == client_id, AuditStageRow.id != stage_id,
            ).update({"is_current": False})
            row.is_current = True
        elif "current" in fields:
            row.is_current = fields["current"]
        row.updated_at = datetime.utcnow()
        session.commit()
        return {"id": str(row.id), "done": row.done, "current": row.is_current}
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()