# db_client.py - Kode database client yang benar
"""
db_client.py
============
Client database untuk menyimpan hasil analisis per client.
"""

import os
import uuid
from datetime import datetime, date
from decimal import Decimal
from typing import Optional, List, Dict, Any

import pandas as pd
from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime,
    Text, Boolean, ForeignKey, text, UniqueConstraint, Index,
    Numeric, Date, func, JSON, or_, select,
    Computed,  # dipakai financial_transaction_sales_invoices.outstanding_amount (GENERATED ALWAYS AS)
)
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.exc import IntegrityError  # [BARU] dipakai upsert_bank_cash_exception (tabrakan unique index)
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# ============================================================
# KONFIGURASI DATABASE
# ============================================================

# [FIX] Backend sekarang FastAPI + React (bukan Streamlit lagi), jadi
# konfigurasi cukup dibaca langsung dari environment variable. Nilainya
# datang dari file .env yang di-load oleh load_dotenv() di main.py,
# SEBELUM modul ini di-import -- lihat catatan di main.py.
#
# DATABASE_URL wajib mengarah ke Supabase -- tidak ada fallback ke
# database lain. Kalau tidak di-set, backend gagal start dengan jelas
# (bukan jalan diam-diam pakai config yang salah).
def get_database_url():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError(
            "DATABASE_URL tidak diset! Buat file backend/.env (contoh di "
            "backend/.env.example) dan isi DATABASE_URL ke Supabase kamu."
        )
    return url

DATABASE_URL = get_database_url()
Base = declarative_base()

# connect_timeout: percobaan koneksi ke host yang tidak bisa dihubungi
# akan gagal dalam hitungan detik, bukan menggantung tanpa batas. Hanya
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
    # management_users.id (dulu varchar nama bebas).
    assigned_accountant = Column("akuntan_penanggung_jawab", PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
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
    dibuat_oleh = Column("created_by", PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    diperbarui_oleh = Column("edited_by", PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    # old_client_id (kolom backfill sementara di Supabase playground-hendra)
    # sengaja TIDAK dipetakan -- kolomnya tidak ada di DB playground-willi.
    # [BARU] logo perusahaan (data URL base64, maks ~400KB) untuk kop
    # dokumen cetak -- lihat root/ddl-table & clients_v1.py.
    logo = Column(Text, nullable=True)



# ============================================================
# ACCOUNTING CORE V2 — additive, tidak mengganti tabel legacy
# ============================================================

class StandardAccount(Base):
    """Taxonomy akun universal sistem. Nomor/nama akun client tetap di tabel Coa."""
    __tablename__ = "management_standard_accounts"

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
    __tablename__ = "management_account_roles"

    id = Column(Integer, primary_key=True)
    role_code = Column(String(80), unique=True, nullable=False, index=True)
    role_name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class CoaStandardMapping(Base):
    """Mapping COA asli client ke StandardAccount."""
    __tablename__ = "management_coa_standard_mapping"
    __table_args__ = (
        UniqueConstraint("client_id", "coa_id", name="uq_coa_standard_mapping_client_coa"),
        Index("idx_coa_standard_mapping_client", "client_id"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), nullable=False)
    standard_account_id = Column(Integer, ForeignKey("management_standard_accounts.id"), nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    mapped_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


class CompanyAccountRole(Base):
    """Mapping AccountRole universal ke akun aktual masing-masing company/client."""
    __tablename__ = "management_company_account_roles"
    __table_args__ = (
        UniqueConstraint("client_id", "role_id", name="uq_company_account_role"),
        Index("idx_company_account_roles_client", "client_id"),
    )

    id = Column(Integer, primary_key=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    role_id = Column(Integer, ForeignKey("management_account_roles.id"), nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), nullable=False)
    active = Column(Boolean, default=True, nullable=False)
    effective_from = Column(Date, nullable=True)
    effective_to = Column(Date, nullable=True)
    assigned_by = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.now)
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)


    # [CATATAN] SENGAJA tidak ada UniqueConstraint di sini -- riwayat
    # boleh berisi banyak baris utk kombinasi (client_id, kode_bank,
    # periode) yang sama (satu per upload/revisi). "Batch aktif" utk
    # kombinasi itu ditentukan lewat query (status == "aktif", diambil
    # yang dibuat_at PALING BARU) di ambil_batch_aktif() di bawah, bukan
    # lewat constraint DB -- karena SATU kombinasi bisa berpindah status
    # aktif berkali-kali seiring waktu (revisi demi revisi).


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
    id_user = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)

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

    # PK fisik di DB playground-willi bernama "id_user". (Di Supabase
    # playground-hendra kolom ini sudah di-rename jadi "id" -- kalau DB
    # disatukan ke sana, ganti jadi Column("id", ...) + semua FK
    # "management_users.id_user" -> "management_users.id".)
    id_user = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    username = Column(String(100), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    nama_user = Column(String(255), nullable=False)
    alamat_user = Column(String(255), nullable=True)
    telp_user = Column(String(255), nullable=True)
    role = Column(String(50), nullable=False)
    access = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    # Kolom fisik di DB playground-willi: updated_at (di Supabase hendra: edited_at).
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    # [BARU] kolom audit & relasi client tunggal, ditambahkan di migrasi
    # management_users terbaru.
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    # Kolom fisik di DB playground-willi: updated_by (di Supabase hendra: edited_by).
    updated_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    # [BARU -- migrations/26] Settings > User Management. is_active=false -> tidak bisa login.
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    is_member = Column(Boolean, nullable=False, default=False, server_default=text("false"))


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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    # [BARU] Klien (perusahaan, management_clients) pemilik transaksi -- dipakai
    # filter per client di Financial Statements. BEDA dari client_id di atas
    # (management_users, akun yang login). Lihat migrations/14-*.py.
    management_client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True, index=True)
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
    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    # [BARU] Klien (perusahaan, management_clients) pemilik transaksi -- dipakai
    # filter per client di Financial Statements. BEDA dari client_id di atas
    # (management_users, akun yang login). Lihat migrations/14-*.py.
    management_client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True, index=True)
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
    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    currency = Column(String(10), nullable=False, default="IDR")
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    # [BARU] Klien (perusahaan, management_clients) pemilik transaksi -- dipakai
    # filter per client di Financial Statements. BEDA dari client_id di atas
    # (management_users, akun yang login). Lihat migrations/14-*.py.
    management_client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True, index=True)
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
    currency = Column(String(10), nullable=False, default="IDR")
    payment_status = Column(String(20), nullable=False, default="unpaid")
    payment_terms = Column(String(50), nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String(20), nullable=False, default="draft")
    period_label = Column(String(50), nullable=False)
    created_by_name = Column(String(255), nullable=True)
    approved_by_name = Column(String(255), nullable=True)
    posted_by_name = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    journal_entry_id = Column(PG_UUID(as_uuid=False), nullable=True)
    posting_date = Column(Date, nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    # [BARU - migration 18] Akun posting per transaksi (Cr Hutang Usaha, Dr PPN
    # Masukan) -- dari template import / input user. NULL = fallback ke
    # _AKUN_DEFAULT_PURCHASE. approved_at diisi saat status -> 'approved'.
    ap_account_code = Column(String(50), nullable=True)
    ap_account_name = Column(String(255), nullable=True)
    tax_account_code = Column(String(50), nullable=True)
    tax_account_name = Column(String(255), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
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
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    transaction_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_transactions.id"), nullable=True)
    source_record_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_source_records.id"), nullable=True)
    exception_type = Column(String(100), nullable=False)
    severity = Column(String(10), nullable=False, default="Medium")
    status = Column(String(30), nullable=False, default="Open")
    vendor_name = Column(String(255), nullable=True)
    invoice_number = Column(String(100), nullable=True)
    purchase_date = Column(Date, nullable=True)
    amount = Column(Numeric(24, 2), nullable=False, default=0)
    currency = Column(String(10), nullable=False, default="IDR")
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


class PurchaseImportTemplate(Base):
    """Pola kolom file laporan pembelian (CSV/Excel) yang sudah "dipelajari"
    untuk 1 klien -- versi Purchase dari SalesImportTemplate &
    JournalEntryImportTemplate (bentuk kolom PERSIS sama, lihat
    SALES_IMPORT_TEMPLATES.md di root untuk alurnya). Sengaja tabel
    TERPISAH supaya pola kolom Sales/Journal Entry/Purchase tidak saling
    bentrok walau milik klien yang sama.

    client_id reference ke management_clients (BUKAN management_users
    seperti 4 tabel financial_transaction_purchase_* lain) -- pola kolom
    laporan adalah properti PERUSAHAAN klien, bukan akun yang upload."""
    __tablename__ = "financial_transaction_purchase_import_templates"
    __table_args__ = (
        UniqueConstraint("client_id", "file_type", "column_signature_hash", name="uq_purchase_import_templates_signature"),
        Index("idx_purchase_import_templates_client", "client_id"),
        Index("idx_purchase_import_templates_client_code", "client_code"),
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
# MANAGEMENT > COA -- DDL: root/ddl-table (bagian "FITUR MANAGEMENT > COA")
# ============================================================

class ManagementClientCoa(Base):
    """[BARU] Master Chart of Accounts per klien (management_clients).

    Sumber awal: dataset/COA/COA_Clients_GOUF.xlsx (sheet "COA <KODE>"),
    di-seed lewat migrations/seed_coa_*.sql. Kolom mengikuti persis kolom
    sheet tsb: nomor & nama akun ASLI klien (acc_no/account_name) + lapisan
    semantik standar lintas-klien (classification/head/sub/standard_account_code,
    IFRS-aligned) -- jadi 1001, 1-1000 dan 110101 di 3 klien berbeda bisa
    punya standard_account_code yang sama.

    TERPISAH dari tabel `coa` lama (FK ke `clients` integer, dipakai modul
    akuntansi/upload lama) -- tabel ini FK ke management_clients (UUID),
    sama seperti fitur Transactions yang baru.

    normal_balance (DEBIT/CREDIT) TIDAK ada di Excel -- diturunkan dari
    account_classification + akun kontra (akumulasi penyusutan, cadangan
    kerugian piutang, potongan/retur pembelian, potongan penjualan, prive),
    lihat migrations/generate_seed_coa.py::normal_balance().

    client_id BOLEH NULL = akun "unassigned": dibuat dulu tanpa klien, lalu
    kelak di-assign ke klien lewat POST /api/v1/management/coa/assign (baris
    yang sama diisi client_id-nya, bukan disalin). UNIQUE (client_id, acc_no)
    tidak berlaku antar baris NULL di Postgres, jadi keunikan acc_no di pool
    unassigned dijaga di API (modules/management/coa_v1.py). Lihat
    migrations/17-allow_unassigned_management_client_coa.py.
    """
    __tablename__ = "management_client_coa"
    __table_args__ = (
        UniqueConstraint("client_id", "acc_no", name="uq_management_client_coa_client_acc_no"),
        # UNIQUE di atas tidak berlaku antar client_id NULL -> jaga acc_no unik di pool unassigned.
        Index(
            "uq_management_client_coa_unassigned_acc_no", "acc_no", unique=True,
            postgresql_where=text("client_id IS NULL AND deleted_at IS NULL"),
        ),
        Index("idx_management_client_coa_client", "client_id"),
        Index("idx_management_client_coa_standard_code", "standard_account_code"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)  # NULL = unassigned
    client_code = Column(String(50), nullable=True)
    acc_no = Column(String(50), nullable=False)
    account_name = Column(String(255), nullable=False)
    account_classification = Column(String(30), nullable=False)  # ASSET/LIABILITY/EQUITY/REVENUE/COST OF SALES/EXPENSE/OTHER INCOME/OTHER EXPENSE/INCOME TAX
    account_head = Column(String(50), nullable=True)             # mis. CURRENT ASSET, OPERATING EXPENSE
    account_sub = Column(String(100), nullable=True)             # mis. CASH & CASH EQUIVALENTS
    normal_balance = Column(String(10), nullable=True)           # DEBIT/CREDIT
    description = Column(Text, nullable=True)
    international_standard_group = Column(String(255), nullable=True)
    standard_account_code = Column(String(100), nullable=True)   # mis. std_asset_current_cash_bank
    ifrs_taxonomy_reference = Column(String(255), nullable=True)
    ifrs_source = Column(String(255), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementClientCoaOpeningBalance(Base):
    """Header saldo awal (opening balance) COA: 1 set per klien + tahun buku +
    cabang. Saat di-post, set ini menghasilkan 1 jurnal POSTED (source_type
    "Opening Balance") di financial_transaction_journal_entry_drafts supaya
    Financial Statements otomatis membacanya sebagai saldo awal. Lihat
    modules/management/opening_balance_v1.py & migrations/25-*.py.

    branch NULL = tanpa cabang (kantor pusat / konsolidasi). Selisih debit vs
    kredit diparkir ke suspense_coa_id (akun penampung) saat posting."""
    __tablename__ = "management_client_coa_opening_balances"
    __table_args__ = (
        Index("idx_management_client_coa_ob_client_year", "client_id", "fiscal_year"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    as_of_date = Column(Date, nullable=False)                 # tanggal cut-off = tanggal jurnal
    branch = Column(String(100), nullable=True)               # NULL = tanpa cabang
    suspense_coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_coa.id"), nullable=True)
    reference = Column(String(255), nullable=True)            # mis. "Neraca audited 2024"
    notes = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="draft", server_default=text("'draft'"))  # draft/posted/locked
    revision = Column(Integer, nullable=False, default=0, server_default=text("0"))  # naik tiap kali di-post ulang
    journal_entry_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_journal_entry_drafts.id"), nullable=True)
    posted_at = Column(DateTime(timezone=True), nullable=True)
    posted_by = Column(PG_UUID(as_uuid=False), nullable=True)
    locked_at = Column(DateTime(timezone=True), nullable=True)
    locked_by = Column(PG_UUID(as_uuid=False), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementClientCoaOpeningBalanceLine(Base):
    """Baris saldo awal: 1 akun COA, isi debit ATAU kredit (salah satu 0)."""
    __tablename__ = "management_client_coa_opening_balance_lines"
    __table_args__ = (
        UniqueConstraint("opening_balance_id", "coa_id", name="uq_management_client_coa_ob_line_coa"),
        Index("idx_management_client_coa_ob_line_header", "opening_balance_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    opening_balance_id = Column(
        PG_UUID(as_uuid=False),
        ForeignKey("management_client_coa_opening_balances.id", ondelete="CASCADE"),
        nullable=False,
    )
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_coa.id"), nullable=False)
    debit = Column(Numeric(24, 2), nullable=False, default=0, server_default=text("0"))
    credit = Column(Numeric(24, 2), nullable=False, default=0, server_default=text("0"))
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementSettingPurchase(Base):
    """Management > Settings > Purchase: variabel default fitur purchase,
    1 baris per klien (company). Lihat modules/management/settings_v1.py
    (GET/PUT /api/v1/management/settings/purchase) & migrations/27-*.py.

    preferred_purchase_term: salah satu PURCHASE_TERMS di settings_v1.py
    (Net 30, Cash on Delivery, ..., Custom). Flag boolean menyalakan bagian
    form purchase (supplier di Purchase Request, shipping, diskon, diskon per
    baris, deposit)."""
    __tablename__ = "management_setting_purchase"
    __table_args__ = (
        UniqueConstraint("client_id", name="uq_management_setting_purchase_client"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    preferred_purchase_term = Column(String(50), nullable=True)
    activate_supplier_in_purchase_request = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    shipping = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    discount = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    discount_per_lines = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    deposit = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    default_purchase_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementSettingProduct(Base):
    """Management > Settings > Product > Subfeature settings: 1 baris per
    klien. Lihat modules/management/settings_v1.py (GET/PUT
    /api/v1/management/settings/product) & migrations/28-*.py."""
    __tablename__ = "management_setting_product"
    __table_args__ = (
        UniqueConstraint("client_id", name="uq_management_setting_product_client"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    stock_info_on_sales_purchases = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    product_variant = Column(Boolean, nullable=False, default=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementSettingProductCategory(Base):
    """Settings > Product > Basic setting: master product category per klien
    (nama + amount diinput manual). Soft delete lewat deleted_at; nama unik
    per klien (case-insensitive) di antara baris yang belum dihapus --
    unique index parsial dipasang migrations/28-*.py."""
    __tablename__ = "management_setting_product_categories"
    __table_args__ = (
        Index("idx_management_setting_product_categories_client", "client_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    name = Column(String(150), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementSettingProductUnit(Base):
    """Settings > Product > Basic setting: master product unit (satuan) per
    klien, struktur sama dengan ManagementSettingProductCategory."""
    __tablename__ = "management_setting_product_units"
    __table_args__ = (
        Index("idx_management_setting_product_units_client", "client_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    name = Column(String(150), nullable=False)
    amount = Column(Numeric(18, 2), nullable=False, default=0, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementSettingAccountMapping(Base):
    """Management > Settings > Account Mapping: akun COA default per fungsi
    (Sales Revenue, Account Receivable, Inventory, ...) per klien. Bentuk
    key-value: 1 baris = 1 mapping_key -> 1 akun management_client_coa milik
    klien yang sama. Mapping yang dikosongkan = barisnya dihapus.

    Katalog mapping_key (grup Sales/Purchase/AR-AP/Inventory/Others) ada di
    modules/management/settings_v1.py::ACCOUNT_MAPPING_GROUPS -- menambah
    input baru cukup di sana, tanpa migration. Lihat migrations/29-*.py."""
    __tablename__ = "management_setting_account_mappings"
    __table_args__ = (
        UniqueConstraint("client_id", "mapping_key", name="uq_management_setting_account_mappings_client_key"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    mapping_key = Column(String(60), nullable=False)          # mis. sales_revenue, account_payable
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_coa.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


# ============================================================
# FINANCIAL STATEMENTS -- mapping laporan keuangan & CALK
# (Task Plan 16-20, migrations/31-create_financial_statement_mapping.py).
# Laporan dibangun dari GL posted + COA klien; tabel di bawah menyimpan
# mapping per akun (cash flow, komponen ekuitas, note CALK, override
# seksi/baris laporan) dan framework CALK (template -> note per klien ->
# isi per periode + override angka ber-audit-trail). Mesin hitungnya
# modules/financial_statements/mapped.py.
# ============================================================

class ManagementFsMappingRule(Base):
    """Aturan mapping DEFAULT lintas klien, dicocokkan ke
    management_client_coa.standard_account_code dengan PREFIX TERPANJANG
    (mis. aturan 'std_asset_current_cash' berlaku untuk
    std_asset_current_cash_bank/_petty/...). Di-seed lewat
    migrations/seed_fs_mapping_rules.sql. Tidak memakai nama akun klien."""
    __tablename__ = "management_fs_mapping_rules"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    standard_account_code = Column(String(100), nullable=False, unique=True)  # prefix
    cash_flow_category = Column(String(20), nullable=True)   # CASH/OPERATING/INVESTING/FINANCING/NON_CASH (NULL utk akun laba rugi)
    cash_flow_line = Column(String(150), nullable=True)
    equity_component = Column(String(40), nullable=True)     # share_capital/additional_paid_in_capital/retained_earnings/...
    note_key = Column(String(60), nullable=True)             # management_fs_note_templates.note_key
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class ManagementClientFsMapping(Base):
    """Mapping laporan keuangan per akun COA milik 1 klien -- "master per
    client". Kolom NULL = ikut default (COA head/sub atau aturan
    ManagementFsMappingRule). Baris dibuat lewat tombol "Apply defaults" /
    edit manual di halaman Financial Statements > Mapping."""
    __tablename__ = "management_client_fs_mappings"
    __table_args__ = (
        UniqueConstraint("client_id", "coa_id", name="uq_management_client_fs_mappings_client_coa"),
        Index("idx_management_client_fs_mappings_client", "client_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    coa_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_coa.id", ondelete="CASCADE"), nullable=False)
    fs_section = Column(String(40), nullable=True)           # override seksi laporan (current_assets, revenue, ...)
    fs_line = Column(String(150), nullable=True)             # override label baris laporan
    equity_component = Column(String(40), nullable=True)
    cash_flow_category = Column(String(20), nullable=True)
    cash_flow_line = Column(String(150), nullable=True)
    note_key = Column(String(60), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementFsNoteTemplate(Base):
    """Template note CALK global (Cash & Cash Equivalents, Receivables, ...).
    Di-seed lewat migrations/seed_fs_note_templates.sql. Narasi boleh
    memakai placeholder {company}, {period_start}, {period_end}, {year}."""
    __tablename__ = "management_fs_note_templates"

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    note_key = Column(String(60), nullable=False, unique=True)
    title = Column(String(200), nullable=False)
    statement = Column(String(30), nullable=False)           # GENERAL/BALANCE_SHEET/PROFIT_LOSS/EQUITY/CASH_FLOW
    note_type = Column(String(20), nullable=False)           # policy (narasi saja) / account (narasi + tabel angka)
    sort_order = Column(Integer, nullable=False, default=0)
    default_narrative = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class ManagementClientFsNote(Base):
    """Note CALK milik 1 klien (salinan template, atau note custom kalau
    template_id NULL). narrative = narasi tetap klien (berlaku semua
    periode, NULL = pakai narasi template)."""
    __tablename__ = "management_client_fs_notes"
    __table_args__ = (
        UniqueConstraint("client_id", "note_key", name="uq_management_client_fs_notes_client_key"),
        Index("idx_management_client_fs_notes_client", "client_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    template_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_fs_note_templates.id"), nullable=True)
    note_key = Column(String(60), nullable=False)
    title = Column(String(200), nullable=False)
    statement = Column(String(30), nullable=False)
    note_type = Column(String(20), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)
    narrative = Column(Text, nullable=True)
    is_enabled = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementClientFsNoteContent(Base):
    """Isi note khusus 1 periode (tanggal laporan): narasi periode +
    status draft/final. Mengalahkan narasi klien & template."""
    __tablename__ = "management_client_fs_note_contents"
    __table_args__ = (
        UniqueConstraint("client_note_id", "period_end", name="uq_management_client_fs_note_contents_note_period"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_note_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_fs_notes.id", ondelete="CASCADE"), nullable=False)
    period_end = Column(Date, nullable=False)
    narrative = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="draft", server_default=text("'draft'"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementClientFsNoteOverride(Base):
    """Controlled override angka hasil sistem di tabel note (per akun per
    periode). Wajib alasan; dihapus = soft-delete. Riwayat lengkap di
    ManagementClientFsNoteAudit."""
    __tablename__ = "management_client_fs_note_overrides"
    __table_args__ = (
        Index(
            "uq_management_client_fs_note_overrides_aktif", "client_note_id", "period_end", "row_key", unique=True,
            postgresql_where=text("deleted_at IS NULL"),
        ),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_note_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_fs_notes.id", ondelete="CASCADE"), nullable=False)
    period_end = Column(Date, nullable=False)
    row_key = Column(String(50), nullable=False)             # acc_no
    system_value = Column(Numeric(24, 2), nullable=True)     # angka sistem saat override dibuat
    override_value = Column(Numeric(24, 2), nullable=False)
    reason = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), nullable=True)


class ManagementClientFsNoteAudit(Base):
    """Audit trail CALK (append-only): ubah narasi, ubah pengaturan note,
    pasang/hapus override."""
    __tablename__ = "management_client_fs_note_audit"
    __table_args__ = (
        Index("idx_management_client_fs_note_audit_note", "client_note_id", "created_at"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    client_note_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_client_fs_notes.id", ondelete="CASCADE"), nullable=False)
    period_end = Column(Date, nullable=True)
    action = Column(String(40), nullable=False)              # narrative_update/note_update/override_set/override_remove/note_create
    field = Column(String(60), nullable=True)
    old_value = Column(Text, nullable=True)
    new_value = Column(Text, nullable=True)
    reason = Column(Text, nullable=True)
    user_id = Column(PG_UUID(as_uuid=False), nullable=True)
    user_name = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class ManagementCoaIndustryTemplate(Base):
    """Master industri (KBLI 2020 kategori A..U) + template COA default-nya.
    Sumber: dataset/COA/COA_Industry.xlsx sheet "COA_JENIS INDUSTRY", dimuat
    migrations/30-*.py. industry_name_en = pilihan "Industry" di form client
    (management_clients.industry menyimpan teks ini). template_sheet = nama
    sheet asal akun-akunnya (ManagementCoaIndustryTemplateAccount)."""
    __tablename__ = "management_coa_industry_templates"
    __table_args__ = (
        UniqueConstraint("kbli_category", name="uq_management_coa_industry_templates_kbli"),
        UniqueConstraint("industry_name_en", name="uq_management_coa_industry_templates_name_en"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    kbli_category = Column(String(5), nullable=False)             # A..U
    industry_name_id = Column(String(255), nullable=True)         # INDUSTRY (INDONESIA)
    industry_name_en = Column(String(150), nullable=False)        # INDUSTRY (ENGLISH)
    template_sheet = Column(String(100), nullable=False)          # mis. "COA A AGRI"
    universal_accounts = Column(Integer, nullable=True)
    industry_specific_accounts = Column(Integer, nullable=True)
    total_template_accounts = Column(Integer, nullable=True)
    recommended_use = Column(Text, nullable=True)
    framework_note = Column(Text, nullable=True)
    official_source = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default=text("true"))
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)


class ManagementCoaIndustryTemplateAccount(Base):
    """Akun default 1 template industri -- kolom sama dengan
    management_client_coa supaya bisa disalin apa adanya saat client baru
    dibuat (db_client.salin_coa_template_industri)."""
    __tablename__ = "management_coa_industry_template_accounts"
    __table_args__ = (
        UniqueConstraint("template_id", "acc_no", name="uq_management_coa_industry_template_accounts_acc_no"),
        Index("idx_management_coa_industry_template_accounts_template", "template_id"),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    template_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_coa_industry_templates.id", ondelete="CASCADE"), nullable=False)
    sort_order = Column(Integer, nullable=False, default=0)       # urutan baris di sheet
    acc_no = Column(String(50), nullable=False)
    account_name = Column(String(255), nullable=False)
    account_classification = Column(String(30), nullable=False)
    account_head = Column(String(50), nullable=True)
    account_sub = Column(String(100), nullable=True)
    normal_balance = Column(String(10), nullable=True)            # DEBIT/CREDIT, diturunkan dari klasifikasi
    description = Column(Text, nullable=True)
    international_standard_group = Column(String(255), nullable=True)
    standard_account_code = Column(String(100), nullable=True)
    ifrs_taxonomy_reference = Column(String(255), nullable=True)
    ifrs_source = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)


class UserClientAccess(Base):
    """Pembatasan client per user. tahap_5 dapat full access; role lain wajib mapping di production."""
    __tablename__ = "management_user_client_access"
    __table_args__ = (
        UniqueConstraint("user_id", "client_id", name="uq_user_client_access"),
        Index("idx_user_client_access_user", "user_id"),
    )

    id = Column(Integer, primary_key=True)
    user_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=False)
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=False)
    access_role = Column(String(50), nullable=True)
    active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.now)


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


SOURCE_DATA_STATUS_VALID = {"Imported", "Pending Mapping", "Mapped", "Validation Error"}
SOURCE_DATA_VALIDATION_VALID = {"Valid", "Pending Validation", "Invalid"}


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


# ============================================================
# MODUL BUDGET & FORECAST (BARU) -- 2 tabel dibuat manual oleh user lewat
# Supabase di schema "5_Planning": forecast_assumption (asumsi budget per
# client/tahun -- dipakai ForecastAssumptions.tsx & budgetBridge.ts sbg
# pengganti konstanta hardcoded BUDGET_ASSUMPTIONS) dan scenario (skenario
# custom tersimpan -- dipakai ScenarioPlanning.tsx sbg tambahan atas 3
# skenario bawaan Base/Optimistic/Conservative yang tetap dihitung dari
# actual run-rate, bukan diganti).
# ============================================================


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


# ============================================================
# MODUL OVERVIEW (BARU) -- 2 tabel dibuat manual oleh user lewat Supabase
# di schema "2_Overview": overview_management_branches (daftar
# cabang per client, dipakai dropdown "Branch" di halaman Financial
# Overview) dan overview_financial_budget (angka Anggaran P&L
# per client/cabang/tahun/bulan, dipakai mode "Budget" di KPIBentoGrid --
# menggantikan konstanta hardcoded BUDGET di src/lib/financialData.tsx).
# ============================================================


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
    coa_id = Column(PG_UUID(as_uuid=False), nullable=True)
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


# ============================================================
# [BARU] MODUL BANK FEED -- tabel "bank_feed_mutation" (lihat
# migrations/12-create_bank_feed_mutation_table.py), menampung mutasi
# rekening koran MENTAH (sebelum dijurnal) untuk tab "Bank Feed" &
# "Reconciliation" di halaman Cash & Bank. TERPISAH dari
# finance_transaction_bank_cash (yang sudah berbentuk jurnal double-entry
# lengkap) -- baris di sini murni "tanggal segini, uang masuk/keluar
# sekian" seperti apa adanya di rekening koran, lalu dicocokkan manual/
# otomatis ke satu baris Cash Payment/Cash Receipt yang sudah tercatat
# (matched_tx_id menyimpan id Transaction frontend, prefix "BC-"/"JE-" --
# lihat bankCashBridge.ts). Ekstraksi baris mentahnya REUSE
# ak.proses_file_rekening_koran() yang sudah ada (field mutasi_debet/
# mutasi_kredit per baris draf_jurnal) -- lihat modules/finance/
# bank_feed_v1.py, tidak ada parser baru yang ditulis.
# ============================================================

STATUS_BANK_FEED_VALID = {"unmatched", "matched"}


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


def _buat_je_id_other() -> str:
    """je_id baru unik berformat "OTH-<8 hex>" -- lihat catatan format di
    komentar modul di atas."""
    return f"OTH-{uuid.uuid4().hex[:8]}"


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


class FinanceTransactionBankCashException(Base):
    """[BARU] Catatan PENANGANAN exception tab "Exceptions" di Cash & Bank.

    Tabel ini SENGAJA hanya menyimpan status penanganan (Open / In Review /
    Resolved, assigned_to, resolved_at/by), BUKAN salinan masalahnya --
    deteksi masalah (amount mismatch, duplicate, mutasi unmatched, akun
    lawan kosong, dst) dihitung ulang dari Bank Feed + Reconciliation
    setiap tab dibuka, lalu dicocokkan ke baris tabel ini lewat
    (client_id, bank_mutation_ref, exception_type). Masalah yang sudah
    tidak terdeteksi lagi otomatis hilang dari daftar walau barisnya di
    sini masih ada.

    Tabel dibuat manual lewat Supabase (bukan init_db()/create_all()).
    client_id -> management_clients (SAMA seperti finance_transaction_
    bank_cash), BUKAN management_users seperti tabel exceptions Sales.
    bank_mutation_ref berupa teks (id mutasi Bank Feed / no transaksi
    kas-bank), bukan FK -- Bank Feed tidak disimpan permanen dan Cash
    Payment/Receipt tidak punya satu tabel tunggal.
    """
    __tablename__ = "financial_transaction_bank_cash_exceptions"
    __table_args__ = (
        Index("idx_bank_cash_exceptions_client_status", "client_id", "status"),
        Index("idx_bank_cash_exceptions_mutation_ref", "bank_mutation_ref"),
        # [BARU] Sudah ada di DB (uq_bank_cash_exceptions_key_aktif): 1 baris aktif per kunci upsert.
        Index("uq_bank_cash_exceptions_key_aktif", "client_id", "bank_mutation_ref", "exception_type",
              unique=True, postgresql_where=text("deleted_at IS NULL")),
    )

    id = Column(PG_UUID(as_uuid=False), primary_key=True, server_default=text("gen_random_uuid()"))
    client_id = Column(PG_UUID(as_uuid=False), ForeignKey("management_clients.id"), nullable=True)
    bank_mutation_ref = Column(String(100), nullable=False)
    linked_sales_invoice_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_sales_invoices.id"), nullable=True)
    linked_purchase_transaction_id = Column(PG_UUID(as_uuid=False), ForeignKey("financial_transaction_purchase_transactions.id"), nullable=True)
    exception_type = Column(String(100), nullable=False)
    source = Column(String(30), nullable=False)  # 'Reconciliation' | 'Classification'
    priority = Column(String(10), nullable=False, default="Medium")
    status = Column(String(20), nullable=False, default="Open")
    ai_confidence = Column(Numeric(5, 2), nullable=True)
    ai_suggestion = Column(Text, nullable=True)
    source_snippet = Column(JSONB, nullable=True)
    assigned_to = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    notes = Column(Text, nullable=True)  # [BARU] catatan penanganan (diisi user)
    created_at = Column(DateTime(timezone=True), server_default=text("now()"), nullable=False)
    created_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    edited_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(PG_UUID(as_uuid=False), ForeignKey("management_users.id_user"), nullable=True)


# ============================================================
# [BARU] financial_transaction_bank_cash_exceptions -- catatan penanganan
# exception tab "Exceptions" Cash & Bank (lihat
# FinanceTransactionBankCashException di atas). Memakai helper CRUD
# generic _sales_crud_*() (sudah generic: model + daftar field), jadi
# perilakunya (soft-delete, created_by/edited_by, urutan created_at desc)
# sama persis dengan exceptions Sales.
# ============================================================

CRUD_FIELDS_BANK_CASH_EXCEPTION = [
    "client_id", "bank_mutation_ref", "linked_sales_invoice_id",
    "linked_purchase_transaction_id", "exception_type", "source", "priority",
    "status", "ai_confidence", "ai_suggestion", "source_snippet",
    "assigned_to", "resolved_at", "resolved_by", "notes",
]

def create_bank_cash_exception(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(FinanceTransactionBankCashException, CRUD_FIELDS_BANK_CASH_EXCEPTION, data, created_by)

def get_bank_cash_exception_by_id(exception_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(FinanceTransactionBankCashException, CRUD_FIELDS_BANK_CASH_EXCEPTION, exception_id, termasuk_nonaktif)

def list_bank_cash_exceptions(
    client_id: str,
    status: Optional[str] = None,
    bank_mutation_ref: Optional[str] = None,
    source: Optional[str] = None,
    termasuk_nonaktif: bool = False,
) -> List[Dict[str, Any]]:
    return _sales_crud_list(
        FinanceTransactionBankCashException, CRUD_FIELDS_BANK_CASH_EXCEPTION,
        {"client_id": client_id, "status": status, "bank_mutation_ref": bank_mutation_ref, "source": source},
        termasuk_nonaktif,
    )

def update_bank_cash_exception(exception_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(FinanceTransactionBankCashException, CRUD_FIELDS_BANK_CASH_EXCEPTION, exception_id, data, updated_by)

def soft_delete_bank_cash_exception(exception_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(FinanceTransactionBankCashException, exception_id, deleted_by)

def upsert_bank_cash_exception(data: Dict[str, Any], user_id: Optional[str] = None, _ulang: bool = False) -> Optional[Dict[str, Any]]:
    """Cocokkan baris penanganan berdasarkan (client_id, bank_mutation_ref,
    exception_type) -- kunci yang sama dipakai tab Exceptions untuk
    menggabungkan hasil deteksi dengan status penanganan. Ada -> update
    field yang dikirim saja; belum ada -> buat baru (default status
    'Open'). Hasilnya dict baris + kunci "_dibuat" (True kalau baru
    dibuat) supaya router bisa membalas 201 vs 200."""
    session = SessionLocal()
    try:
        obj = session.query(FinanceTransactionBankCashException).filter(
            FinanceTransactionBankCashException.client_id == data.get("client_id"),
            FinanceTransactionBankCashException.bank_mutation_ref == data.get("bank_mutation_ref"),
            FinanceTransactionBankCashException.exception_type == data.get("exception_type"),
            FinanceTransactionBankCashException.deleted_at.is_(None),
        ).first()
        dibuat = obj is None
        if dibuat:
            obj = FinanceTransactionBankCashException(
                **{k: v for k, v in data.items() if k in CRUD_FIELDS_BANK_CASH_EXCEPTION},
                created_by=user_id,
            )
            session.add(obj)
            session.flush()
        else:
            for kolom, nilai in data.items():
                if kolom in CRUD_FIELDS_BANK_CASH_EXCEPTION:
                    setattr(obj, kolom, nilai)
            obj.edited_at = datetime.now()
            obj.edited_by = user_id
        hasil = _sales_row_ke_dict(obj, CRUD_FIELDS_BANK_CASH_EXCEPTION)
        session.commit()
        hasil["_dibuat"] = dibuat
        return hasil
    except IntegrityError:
        # [BARU] Dua request bersamaan membuat baris yang sama -> unique index menolak
        # yang kedua. Ulangi sekali: kali ini barisnya sudah ada, jadi jalur update.
        session.rollback()
        if not _ulang:
            return upsert_bank_cash_exception(data, user_id, _ulang=True)
        print(f"Error upsert {FinanceTransactionBankCashException.__tablename__}: tabrakan unique berulang")
        return None
    except Exception as e:
        session.rollback()
        print(f"Error upsert {FinanceTransactionBankCashException.__tablename__}: {e}")
        return None
    finally:
        session.close()


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


def daftar_client_dengan_esb(tipe: Optional[str] = None) -> List[Dict[str, Any]]:
    """Shortcut: client yang SUDAH punya minimal 1 akun ESB."""
    return daftar_client(tipe=tipe, punya_esb=True)


def daftar_client_tanpa_esb(tipe: Optional[str] = None) -> List[Dict[str, Any]]:
    """Shortcut: client yang BELUM punya akun ESB sama sekali."""
    return daftar_client(tipe=tipe, punya_esb=False)


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
        # Nonaktif kalau di-soft-delete ATAU is_active=false (Settings > User Management).
        "aktif": user.deleted_at is None and user.is_active is not False,
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


def salin_coa_template_industri(session, client_id: str, industry: Optional[str], client_code: Optional[str] = None,
                                created_by: Optional[str] = None) -> Dict[str, Any]:
    """Isi management_client_coa 1 client dari template COA industrinya
    (management_coa_industry_templates.industry_name_en = industry, tidak
    case-sensitive). Akun yang acc_no-nya sudah ada di client dilewati.
    TIDAK commit -- dipanggil di dalam transaksi pemanggil.
    Hasil: {"template": nama sheet | None, "created": jumlah akun dibuat}."""
    nama = (industry or "").strip()
    if not nama:
        return {"template": None, "created": 0}
    tpl = session.query(ManagementCoaIndustryTemplate).filter(
        func.lower(ManagementCoaIndustryTemplate.industry_name_en) == nama.lower(),
        ManagementCoaIndustryTemplate.is_active.is_(True),
    ).first()
    if tpl is None:
        return {"template": None, "created": 0}
    sudah = {r[0] for r in session.query(ManagementClientCoa.acc_no).filter(ManagementClientCoa.client_id == client_id).all()}
    akun = session.query(ManagementCoaIndustryTemplateAccount).filter(
        ManagementCoaIndustryTemplateAccount.template_id == tpl.id
    ).order_by(ManagementCoaIndustryTemplateAccount.sort_order).all()
    dibuat = 0
    for a in akun:
        if a.acc_no in sudah:
            continue
        session.add(ManagementClientCoa(
            client_id=client_id, client_code=client_code, acc_no=a.acc_no, account_name=a.account_name,
            account_classification=a.account_classification, account_head=a.account_head,
            account_sub=a.account_sub, normal_balance=a.normal_balance, description=a.description,
            international_standard_group=a.international_standard_group,
            standard_account_code=a.standard_account_code, ifrs_taxonomy_reference=a.ifrs_taxonomy_reference,
            ifrs_source=a.ifrs_source, is_active=True, created_by=created_by,
        ))
        sudah.add(a.acc_no)
        dibuat += 1
    return {"template": tpl.template_sheet, "created": dibuat}


def create_management_client(data: Dict[str, Any], created_by: Optional[str] = None,
                             isi_coa_template: bool = True) -> Optional[Dict[str, Any]]:
    """Buat client baru. `data` hanya boleh berisi key dari CRUD_FIELDS_MANAGEMENT_CLIENT.
    isi_coa_template=True -> COA client langsung diisi dari template industri
    yang dipilih (salin_coa_template_industri), dalam transaksi yang SAMA.
    Hasil memuat "coa_template" = {"template", "created"}."""
    session = SessionLocal()
    try:
        kwargs = {_client_attr(k): v for k, v in data.items() if k in CRUD_FIELDS_MANAGEMENT_CLIENT}
        mc = Client(**kwargs, dibuat_oleh=created_by)
        session.add(mc)
        session.flush()  # kirim INSERT & isi id/created_at (server_default) ke objek TANPA expire attribute lain (beda dari commit)
        hasil = _management_client_ke_dict(mc)
        hasil["coa_template"] = (
            salin_coa_template_industri(session, mc.id, data.get("industry"), data.get("client_code"), created_by)
            if isi_coa_template else {"template": None, "created": 0}
        )
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
# MANAGEMENT > COA -- CRUD management_client_coa (lihat model
# ManagementClientCoa & modules/management/coa_v1.py). create/get/update/
# soft-delete memakai helper generic _sales_crud_* di bawah (kolom audit
# tabel ini sama persis).
# ============================================================

CRUD_FIELDS_MANAGEMENT_CLIENT_COA = [
    "client_id", "client_code", "acc_no", "account_name", "account_classification",
    "account_head", "account_sub", "normal_balance", "description",
    "international_standard_group", "standard_account_code",
    "ifrs_taxonomy_reference", "ifrs_source", "is_active",
]


def _filter_client_coa(query, client_id: Optional[str]):
    """client_id None = akun unassigned (client_id IS NULL)."""
    if client_id is None:
        return query.filter(ManagementClientCoa.client_id.is_(None))
    return query.filter(ManagementClientCoa.client_id == client_id)


def list_management_client_coa(
    client_id: Optional[str],
    search: Optional[str] = None,
    account_classification: Optional[str] = None,
    hanya_aktif: bool = False,
    termasuk_nonaktif: bool = False,
    limit: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """COA 1 klien (client_id None = akun unassigned), terurut acc_no.
    `search` mencocokkan acc_no ATAU account_name (case-insensitive,
    substring) -- dipakai autocomplete Account Name di New Journal Entry
    & pencarian akun unassigned."""
    session = SessionLocal()
    try:
        query = _filter_client_coa(session.query(ManagementClientCoa), client_id)
        if not termasuk_nonaktif:
            query = query.filter(ManagementClientCoa.deleted_at.is_(None))
        if hanya_aktif:
            query = query.filter(ManagementClientCoa.is_active.is_(True))
        if account_classification:
            query = query.filter(ManagementClientCoa.account_classification == account_classification.upper())
        if search and search.strip():
            pola = f"%{search.strip()}%"
            query = query.filter(
                (ManagementClientCoa.acc_no.ilike(pola)) | (ManagementClientCoa.account_name.ilike(pola))
            )
        query = query.order_by(ManagementClientCoa.acc_no)
        if limit:
            query = query.limit(limit)
        return [_sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA) for obj in query.all()]
    except Exception as e:
        session.rollback()
        print(f"Error list management_client_coa: {e}")
        return []
    finally:
        session.close()


def get_management_client_coa_by_id(coa_id: str, termasuk_nonaktif: bool = False) -> Optional[Dict[str, Any]]:
    return _sales_crud_get_by_id(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, coa_id, termasuk_nonaktif)


def cari_management_client_coa_by_acc_no(client_id: Optional[str], acc_no: str) -> Optional[Dict[str, Any]]:
    """1 akun berdasarkan (client_id, acc_no) persis -- TERMASUK yang sudah
    di-soft-delete (lihat field `aktif`), karena UNIQUE (client_id, acc_no)
    tetap berlaku untuk baris yang dihapus. client_id None = pool unassigned
    (bisa >1 baris dgn acc_no sama kalau ada yang terhapus -> yang aktif
    diutamakan)."""
    session = SessionLocal()
    try:
        obj = _filter_client_coa(session.query(ManagementClientCoa), client_id).filter(
            ManagementClientCoa.acc_no == acc_no
        ).order_by(ManagementClientCoa.deleted_at.desc().nullsfirst()).first()
        return _sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA) if obj else None
    except Exception:
        session.rollback()
        return None
    finally:
        session.close()


def create_management_client_coa(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_create(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, data, created_by)


def update_management_client_coa(coa_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _sales_crud_update(ManagementClientCoa, CRUD_FIELDS_MANAGEMENT_CLIENT_COA, coa_id, data, updated_by)


def restore_management_client_coa(coa_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Hidupkan lagi akun yang sudah di-soft-delete sekaligus timpa isinya --
    dipakai saat user membuat akun dengan acc_no yang dulu pernah dihapus."""
    session = SessionLocal()
    try:
        obj = session.query(ManagementClientCoa).filter(ManagementClientCoa.id == coa_id).first()
        if not obj:
            return None
        for kolom, nilai in data.items():
            if kolom in CRUD_FIELDS_MANAGEMENT_CLIENT_COA:
                setattr(obj, kolom, nilai)
        obj.deleted_at = None
        obj.deleted_by = None
        obj.edited_at = datetime.now()
        obj.edited_by = updated_by
        hasil = _sales_row_ke_dict(obj, CRUD_FIELDS_MANAGEMENT_CLIENT_COA)
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error restore management_client_coa: {e}")
        return None
    finally:
        session.close()


def soft_delete_management_client_coa(coa_id: str, deleted_by: Optional[str] = None) -> bool:
    return _sales_crud_soft_delete(ManagementClientCoa, coa_id, deleted_by)


def assign_management_client_coa(
    coa_ids: List[str], client_id: str, client_code: Optional[str], assigned_by: Optional[str] = None
) -> Dict[str, List[Dict[str, Any]]]:
    """Assign akun unassigned (client_id NULL) ke 1 klien -- baris YANG SAMA
    diisi client_id-nya (akun keluar dari pool unassigned). 1 transaksi.

    Per akun:
      - tidak ada / sudah dihapus / sudah punya klien -> skipped
      - acc_no sudah dipakai akun AKTIF klien tujuan   -> skipped
      - acc_no dipakai akun klien tujuan yang SUDAH DIHAPUS -> baris terhapus
        itu dihidupkan lagi dengan isi akun unassigned, lalu akun unassigned
        di-soft-delete (UNIQUE (client_id, acc_no) tidak memberi pilihan lain;
        pola sama dengan POST create yang menghidupkan akun terhapus).
    Return {"assigned": [...akun], "skipped": [{id, acc_no, account_name, reason}]}.
    """
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"assigned": [], "skipped": []}
    try:
        rows = session.query(ManagementClientCoa).filter(ManagementClientCoa.id.in_(coa_ids)).all()
        by_id = {r.id: r for r in rows}
        existing = {
            r.acc_no: r for r in session.query(ManagementClientCoa).filter(
                ManagementClientCoa.client_id == client_id
            ).all()
        }
        sekarang = datetime.now()
        for coa_id in dict.fromkeys(coa_ids):  # buang id dobel, urutan dipertahankan
            obj = by_id.get(coa_id)
            if obj is None or obj.deleted_at is not None:
                hasil["skipped"].append({"id": coa_id, "acc_no": None, "account_name": None, "reason": "Akun tidak ditemukan."})
                continue
            if obj.client_id is not None:
                hasil["skipped"].append({"id": coa_id, "acc_no": obj.acc_no, "account_name": obj.account_name,
                                         "reason": "Akun sudah terhubung ke klien lain."})
                continue
            bentrok = existing.get(obj.acc_no)
            if bentrok is not None and bentrok.deleted_at is None:
                hasil["skipped"].append({"id": coa_id, "acc_no": obj.acc_no, "account_name": obj.account_name,
                                         "reason": f"ACC NO sudah dipakai akun '{bentrok.account_name}' di klien ini."})
                continue
            if bentrok is not None:
                for kolom in CRUD_FIELDS_MANAGEMENT_CLIENT_COA:
                    if kolom not in ("client_id", "client_code"):
                        setattr(bentrok, kolom, getattr(obj, kolom))
                bentrok.client_code = client_code
                bentrok.deleted_at = None
                bentrok.deleted_by = None
                bentrok.edited_at = sekarang
                bentrok.edited_by = assigned_by
                obj.deleted_at = sekarang
                obj.deleted_by = assigned_by
                target = bentrok
            else:
                obj.client_id = client_id
                obj.client_code = client_code
                obj.edited_at = sekarang
                obj.edited_by = assigned_by
                existing[obj.acc_no] = obj
                target = obj
            hasil["assigned"].append(_sales_row_ke_dict(target, CRUD_FIELDS_MANAGEMENT_CLIENT_COA))
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error assign management_client_coa: {e}")
        raise
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

def create_sales_source_rows_bulk(rows: List[Dict[str, Any]], source_file_id: str, client_id: Optional[str], created_by: Optional[str] = None, chunk_size: int = 1000) -> int:
    """Insert massal baris source_rows dalam SATU transaksi (menggantikan create_sales_source_row
    satu-per-satu yang ~0,3 dtk/baris ke Supabase -> file 10rb+ baris butuh berjam-jam dan
    memblokir server). Semua-atau-tidak-sama-sekali: gagal di tengah = rollback, return 0."""
    if not rows:
        return 0
    session = SessionLocal()
    try:
        payload = []
        for r in rows:
            item = {k: v for k, v in r.items() if k in CRUD_FIELDS_SALES_SOURCE_ROW}
            item["source_file_id"] = source_file_id
            item["client_id"] = client_id
            item["created_by"] = created_by
            payload.append(item)
        for i in range(0, len(payload), chunk_size):
            session.bulk_insert_mappings(SalesSourceRow, payload[i:i + chunk_size])
        session.commit()
        return len(payload)
    except Exception as e:
        session.rollback()
        print(f"Error bulk create {SalesSourceRow.__tablename__}: {e}")
        return 0
    finally:
        session.close()

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
    "client_id", "management_client_id", "invoice_no", "invoice_date", "due_date", "customer_name",
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


def list_sales_invoices(client_id: Optional[str] = None, posting_status: Optional[str] = None, termasuk_nonaktif: bool = False,
                        management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """client_id = id_user (management_users, akun yang login); management_client_id =
    company (management_clients) -- filter yang dipakai semua tab Sales."""
    session = SessionLocal()
    try:
        query = session.query(SalesInvoice)
        if client_id is not None:
            query = query.filter(SalesInvoice.client_id == client_id)
        if management_client_id is not None:
            query = query.filter(SalesInvoice.management_client_id == management_client_id)
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


# ------------------------------------------------------------
# Settings > Account Mapping (management_setting_account_mappings)
# ------------------------------------------------------------
# Akun default per fungsi yang diatur user di /settings/account-mapping
# (katalog key: modules/management/settings_v1.py::ACCOUNT_MAPPING_GROUPS).
# Dipakai sebagai akun default company oleh:
#   - Sales    : akun_default_sales()  -> account_receivable, sales_revenue, sales_tax_payable
#   - Purchase : akun_purchase_setting() -> account_payable, purchase_tax_receivable,
#                purchase_cogs (baris item), purchase_shipping (baris Other Costs)
#   - Opening Balance : opening_balance_equity = akun penampung (suspense) default
# Urutan prioritas: akun spesifik cabang di template import > Account Mapping >
# akun umum template import > default global.

def akun_mapping_setting(management_client_id: Optional[str], session=None) -> Dict[str, Dict[str, Any]]:
    """{mapping_key: {"coa_id", "account_code", "account_name"}} milik 1
    klien. Akun COA yang sudah dihapus diabaikan. {} kalau belum diatur."""
    if not management_client_id:
        return {}
    milik_sendiri = session is None
    session = session or SessionLocal()
    try:
        rows = (
            session.query(ManagementSettingAccountMapping.mapping_key, ManagementClientCoa)
            .join(ManagementClientCoa, ManagementClientCoa.id == ManagementSettingAccountMapping.coa_id)
            .filter(
                ManagementSettingAccountMapping.client_id == management_client_id,
                ManagementClientCoa.client_id == management_client_id,
                ManagementClientCoa.deleted_at.is_(None),
            )
            .all()
        )
        return {
            key: {"coa_id": coa.id, "account_code": coa.acc_no, "account_name": coa.account_name}
            for key, coa in rows
        }
    except Exception as e:
        print(f"Error akun_mapping_setting: {e}")
        return {}
    finally:
        if milik_sendiri:
            session.close()


def akun_purchase_setting(management_client_id: Optional[str], session=None) -> Dict[str, Optional[Dict[str, Any]]]:
    """Akun Purchase dari Account Mapping klien: {"ap", "tax", "line",
    "biaya"} -> {account_code, account_name} atau None kalau belum diatur."""
    m = akun_mapping_setting(management_client_id, session=session)
    return {
        "ap": m.get("account_payable"),
        "tax": m.get("purchase_tax_receivable"),
        "line": m.get("purchase_cogs"),
        "biaya": m.get("purchase_shipping"),
    }


def lengkapi_akun_purchase(transaction: Any, lines: List[Any], akun: Dict[str, Optional[Dict[str, Any]]]) -> bool:
    """Isi akun Purchase yang MASIH KOSONG (ap_account_*, tax_account_*,
    account_code baris) dari akun_purchase_setting(). Akun yang sudah terisi
    tidak diubah. transaction/lines boleh dict atau ORM object.
    True kalau ada yang diisi."""
    def ambil(o, k):
        return o.get(k) if isinstance(o, dict) else getattr(o, k, None)

    def isi(o, k, v):
        if isinstance(o, dict):
            o[k] = v
        else:
            setattr(o, k, v)

    diubah = False
    for prefix, kunci in (("ap_account", "ap"), ("tax_account", "tax")):
        a = akun.get(kunci)
        if a and not (ambil(transaction, f"{prefix}_code") or "").strip():
            isi(transaction, f"{prefix}_code", a["account_code"])
            isi(transaction, f"{prefix}_name", a["account_name"])
            diubah = True
    a = akun.get("line")
    if a:
        for l in lines:
            if not (ambil(l, "account_code") or "").strip():
                isi(l, "account_code", a["account_code"])
                isi(l, "account_name", a["account_name"])
                diubah = True
    return diubah


# ------------------------------------------------------------
# Akun jurnal Sales per klien (mengikuti master COA klien)
# ------------------------------------------------------------
# Akun default disimpan di mapping_rules template import Sales klien
# (pola sama dengan Purchase -- lihat purchase_import_v1.py):
#   piutang_account              {account_code, account_name}  Dr Piutang
#   pendapatan_account           {account_code, account_name}  Cr Pendapatan (default)
#   pendapatan_account_by_cabang {"CRS": {...}, ...}           Cr Pendapatan per cabang
#   ppn_account                  {account_code, account_name}  Cr PPN Keluaran
# Tiap invoice tetap punya mapping sendiri (financial_transaction_sales_account_mappings)
# yang dibuat otomatis dari default ini dan bisa diubah user di Journal Preview.

def akun_default_sales(management_client_id: Optional[str], cabang: Optional[str] = None, session=None) -> Optional[Dict[str, tuple]]:
    """{"piutang": (kode, nama), "pendapatan": (...), "ppn": (...)} untuk 1
    klien, atau None kalau piutang/pendapatan belum bisa ditentukan.

    Prioritas: pendapatan per cabang di template > Settings > Account Mapping
    (account_receivable / sales_revenue / sales_tax_payable) > akun umum
    template import Sales."""
    if not management_client_id:
        return None
    milik_sendiri = session is None
    session = session or SessionLocal()
    try:
        rules: Dict[str, Any] = {}
        for (mr,) in session.query(SalesImportTemplate.mapping_rules).filter(
            SalesImportTemplate.client_id == management_client_id,
            SalesImportTemplate.deleted_at.is_(None),
        ).order_by(SalesImportTemplate.created_at).all():
            if isinstance(mr, dict) and mr.get("piutang_account") and mr.get("pendapatan_account"):
                rules = mr
                break
        setting = akun_mapping_setting(management_client_id, session=session)
        pendapatan = ((rules.get("pendapatan_account_by_cabang") or {}).get((cabang or "").strip().upper())
                      or setting.get("sales_revenue") or rules.get("pendapatan_account"))
        akun = {
            "piutang": setting.get("account_receivable") or rules.get("piutang_account"),
            "pendapatan": pendapatan,
            "ppn": setting.get("sales_tax_payable") or rules.get("ppn_account"),
        }
        if not akun["piutang"] or not akun["pendapatan"]:
            return None
        return {k: (v.get("account_code"), v.get("account_name")) if v else None for k, v in akun.items()}
    except Exception as e:
        print(f"Error akun_default_sales: {e}")
        return None
    finally:
        if milik_sendiri:
            session.close()


def pastikan_mapping_sales(invoice_id: str, dibuat_oleh: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Mapping akun invoice; kalau belum ada, dibuat dari akun_default_sales()
    klien. None = belum ada mapping DAN klien belum punya akun default."""
    ada = get_sales_account_mapping_by_invoice(invoice_id)
    if ada:
        return ada
    inv = get_sales_invoice_by_id(invoice_id)
    if not inv:
        return None
    akun = akun_default_sales(inv.get("management_client_id"), inv.get("cabang"))
    if not akun:
        return None
    return create_sales_account_mapping({
        "client_id": inv.get("client_id"),
        "invoice_id": invoice_id,
        "piutang_account_code": akun["piutang"][0], "piutang_account_name": akun["piutang"][1],
        "pendapatan_account_code": akun["pendapatan"][0], "pendapatan_account_name": akun["pendapatan"][1],
        "ppn_account_code": akun["ppn"][0] if akun["ppn"] else None,
        "ppn_account_name": akun["ppn"][1] if akun["ppn"] else None,
        "is_ai_suggested": False,
        "mapped_by": dibuat_oleh,
    }, created_by=dibuat_oleh)


def validasi_posting_sales(invoice_id: str) -> List[str]:
    """Alasan invoice TIDAK boleh diposting (kosong = boleh). Kalau klien
    punya master COA, invoice wajib punya mapping akun & semua akunnya
    (piutang, pendapatan, PPN kalau ada PPN, PPh kalau diisi) ada di COA."""
    inv = get_sales_invoice_by_id(invoice_id)
    if not inv or not inv.get("management_client_id"):
        return []
    session = SessionLocal()
    try:
        coa = {r[0] for r in session.query(ManagementClientCoa.acc_no).filter(
            ManagementClientCoa.client_id == inv["management_client_id"],
            ManagementClientCoa.deleted_at.is_(None),
        ).all()}
    finally:
        session.close()
    if not coa:
        return []
    m = get_sales_account_mapping_by_invoice(invoice_id)
    if not m:
        return ["Accounts are not mapped yet -- set the accounts in Journal Preview first."]
    dipakai = {m["piutang_account_code"], m["pendapatan_account_code"]}
    if float(inv.get("ppn") or 0) > 0 or not float(inv.get("dpp") or 0):
        # PPN ikut jurnal kalau ada (atau kalau dpp kosong -> dihitung dari gross).
        dipakai.add(m.get("ppn_account_code") or _AKUN_DEFAULT_SALES["ppn"][0])
    if m.get("pph_account_code"):
        dipakai.add(m["pph_account_code"])
    tidak_ada = sorted(k for k in dipakai if k and k not in coa)
    if tidak_ada:
        return [f"Account(s) not found in the client's chart of accounts: {', '.join(tidak_ada)}."]
    return []


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

def list_sales_exceptions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False,
                          management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    if management_client_id is None:
        return _sales_crud_list(SalesException, CRUD_FIELDS_SALES_EXCEPTION, {"client_id": client_id, "status": status}, termasuk_nonaktif)
    # Tabel exception tidak punya kolom company sendiri -> lewat invoice ATAU source row -> source file.
    session = SessionLocal()
    try:
        query = (
            session.query(SalesException)
            .outerjoin(SalesInvoice, SalesInvoice.id == SalesException.invoice_id)
            .outerjoin(SalesSourceRow, SalesSourceRow.id == SalesException.source_row_id)
            .outerjoin(SalesSourceFile, SalesSourceFile.id == SalesSourceRow.source_file_id)
            .filter(or_(SalesInvoice.management_client_id == management_client_id,
                        SalesSourceFile.management_client_id == management_client_id))
        )
        if client_id is not None:
            query = query.filter(SalesException.client_id == client_id)
        if status is not None:
            query = query.filter(SalesException.status == status)
        if not termasuk_nonaktif:
            query = query.filter(SalesException.deleted_at.is_(None))
        return [_sales_row_ke_dict(obj, CRUD_FIELDS_SALES_EXCEPTION) for obj in query.order_by(SalesException.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

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

def list_sales_activity_logs(client_id: Optional[str] = None, invoice_id: Optional[str] = None,
                             management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    if management_client_id is None:
        return _sales_crud_list(SalesActivityLog, CRUD_FIELDS_SALES_ACTIVITY_LOG, {"client_id": client_id, "invoice_id": invoice_id}, termasuk_nonaktif=True)
    # Log tidak punya kolom company sendiri -> lewat invoice-nya.
    session = SessionLocal()
    try:
        query = (
            session.query(SalesActivityLog)
            .join(SalesInvoice, SalesInvoice.id == SalesActivityLog.invoice_id)
            .filter(SalesInvoice.management_client_id == management_client_id)
        )
        if client_id is not None:
            query = query.filter(SalesActivityLog.client_id == client_id)
        if invoice_id is not None:
            query = query.filter(SalesActivityLog.invoice_id == invoice_id)
        return [_sales_row_ke_dict(obj, CRUD_FIELDS_SALES_ACTIVITY_LOG) for obj in query.order_by(SalesActivityLog.created_at.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()


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
    "client_id", "management_client_id", "je_number", "entry_date", "posting_date", "period_label",
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
# FITUR TRANSACTIONS > OTHER -- memakai tabel Journal Entry (source_type="Other")
# ------------------------------------------------------------
# Jurnal halaman Other disimpan di financial_transaction_journal_entry_drafts
# (+ _draft_lines) dengan source_type = "Other". Status 'posted' otomatis
# dibaca Buku Besar / Financial Statements (lihat ambil_baris_jurnal_posted_
# transaksi, bagian "1) Journal Entry"). Alur status:
#   draft/pending/exception --approve--> approved --post--> posted
#   draft/pending/exception/approved --reject--> rejected --reopen--> draft
# ============================================================

JE_STATUS_BISA_APPROVE = ("draft", "pending", "exception")
JE_STATUS_BISA_POST = ("approved",)
JE_STATUS_BISA_REJECT = ("draft", "pending", "exception", "approved")
JE_STATUS_BISA_REOPEN = ("rejected",)
JE_STATUS_BISA_EDIT = ("draft", "pending", "exception", "rejected")
JE_STATUS_BISA_HAPUS = ("draft", "pending", "exception", "rejected")
_TOLERANSI_BALANCE_JE = Decimal("0.01")


def _validasi_posting_je_draft(session, draft: "JournalEntryDraft", lines: List["JournalEntryDraftLine"]) -> List[str]:
    """Alasan draft JE TIDAK boleh diposting (list kosong = boleh)."""
    alasan: List[str] = []
    if len(lines) < 2:
        return ["Journal needs at least 2 lines."]
    tanpa_akun = [l.line_no for l in lines if not (l.account_code or "").strip()]
    if tanpa_akun:
        alasan.append(f"Line(s) {', '.join(map(str, tanpa_akun))} have no account code.")
    dua_sisi = [l.line_no for l in lines if Decimal(str(l.debit or 0)) > 0 and Decimal(str(l.credit or 0)) > 0]
    if dua_sisi:
        alasan.append(f"Line(s) {', '.join(map(str, dua_sisi))} fill both debit and credit.")
    kosong = [l.line_no for l in lines if Decimal(str(l.debit or 0)) == 0 and Decimal(str(l.credit or 0)) == 0]
    if kosong:
        alasan.append(f"Line(s) {', '.join(map(str, kosong))} have no amount.")
    debit = sum((Decimal(str(l.debit or 0)) for l in lines), Decimal(0))
    kredit = sum((Decimal(str(l.credit or 0)) for l in lines), Decimal(0))
    if abs(debit - kredit) > _TOLERANSI_BALANCE_JE:
        alasan.append(f"Journal is not balanced (debit {debit:,.2f} vs credit {kredit:,.2f}).")
    if debit == 0:
        alasan.append("Journal total is zero.")
    # Kalau klien punya master COA, semua akun jurnal WAJIB ada di COA-nya.
    if draft.management_client_id:
        coa = {
            r[0] for r in session.query(ManagementClientCoa.acc_no).filter(
                ManagementClientCoa.client_id == draft.management_client_id,
                ManagementClientCoa.deleted_at.is_(None),
            ).all()
        }
        if coa:
            tidak_ada = sorted({l.account_code for l in lines if l.account_code and l.account_code not in coa})
            if tidak_ada:
                alasan.append(f"Account(s) not found in the client's chart of accounts: {', '.join(tidak_ada)}.")
    return alasan


def _log_je(session, draft: "JournalEntryDraft", event_type: str, deskripsi: str, oleh_nama: Optional[str], oleh_id: Optional[str]) -> None:
    session.add(JournalEntryActivityLog(
        client_id=draft.client_id, draft_id=draft.id, je_number=draft.je_number,
        event_type=event_type, description=deskripsi, status_snapshot=draft.status,
        performed_by=oleh_nama or "System", created_by=oleh_id,
    ))


def list_je_drafts_with_lines(
    client_id: Optional[str] = None,
    source_type: Optional[str] = None,
    status: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Daftar draft JE LENGKAP dengan baris debit/kreditnya (1 query untuk
    semua baris, bukan N+1) -- dipakai 6 tab halaman Other."""
    session = SessionLocal()
    try:
        q = session.query(JournalEntryDraft).filter(JournalEntryDraft.deleted_at.is_(None))
        if client_id:
            q = q.filter(JournalEntryDraft.client_id == client_id)
        if source_type:
            q = q.filter(JournalEntryDraft.source_type == source_type)
        if status:
            q = q.filter(func.lower(JournalEntryDraft.status) == status.lower())
        drafts = q.order_by(JournalEntryDraft.entry_date.desc(), JournalEntryDraft.je_number.desc()).all()
        if not drafts:
            return []
        lines_per: Dict[str, List[Dict[str, Any]]] = {}
        for l in session.query(JournalEntryDraftLine).filter(
            JournalEntryDraftLine.draft_id.in_([d.id for d in drafts]),
            JournalEntryDraftLine.deleted_at.is_(None),
        ).order_by(JournalEntryDraftLine.draft_id, JournalEntryDraftLine.line_no).all():
            lines_per.setdefault(l.draft_id, []).append(_je_row_ke_dict(l, CRUD_FIELDS_JE_DRAFT_LINE))
        hasil = []
        for d in drafts:
            row = _je_row_ke_dict(d, CRUD_FIELDS_JE_DRAFT)
            row["lines"] = lines_per.get(d.id, [])
            hasil.append(row)
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error list draft+lines financial_transaction_journal_entry_drafts: {e}")
        return []
    finally:
        session.close()


def ubah_status_je_drafts(
    draft_ids: List[str],
    aksi: str,
    oleh_nama: Optional[str],
    oleh_id: Optional[str] = None,
    posting_date: Optional[date] = None,
    alasan: Optional[str] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Ubah status banyak draft JE sekaligus (1 transaksi DB). Draft yang tidak
    memenuhi syarat dilewati (`skipped` + alasan), sisanya tetap diproses.

    approve : draft/pending/exception -> approved
    post    : approved -> posted (divalidasi: >=2 baris, akun lengkap, tiap baris
              satu sisi, debit = kredit, akun ada di COA klien); posting_date
              default = entry_date
    reject  : draft/pending/exception/approved -> rejected (alasan -> notes)
    reopen  : rejected -> draft
    """
    if aksi not in ("approve", "post", "reject", "reopen"):
        raise ValueError("aksi harus 'approve', 'post', 'reject' atau 'reopen'.")
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"done": [], "skipped": []}
    try:
        drafts = {
            d.id: d for d in session.query(JournalEntryDraft).filter(
                JournalEntryDraft.id.in_(draft_ids), JournalEntryDraft.deleted_at.is_(None)
            ).all()
        }
        lines_per: Dict[str, List[JournalEntryDraftLine]] = {}
        if drafts and aksi == "post":
            for l in session.query(JournalEntryDraftLine).filter(
                JournalEntryDraftLine.draft_id.in_(list(drafts)), JournalEntryDraftLine.deleted_at.is_(None)
            ).order_by(JournalEntryDraftLine.line_no).all():
                lines_per.setdefault(l.draft_id, []).append(l)

        sekarang = datetime.now()
        for draft_id in dict.fromkeys(draft_ids):
            d = drafts.get(draft_id)
            if d is None:
                hasil["skipped"].append({"id": draft_id, "je_number": None, "reason": "Journal not found."})
                continue
            status_lama = (d.status or "").lower()
            if aksi == "approve":
                if status_lama not in JE_STATUS_BISA_APPROVE:
                    hasil["skipped"].append({"id": draft_id, "je_number": d.je_number, "reason": f"Status '{d.status}' cannot be approved."})
                    continue
                d.status = "approved"
                d.approved_by_name = oleh_nama
                _log_je(session, d, "Approved", f"Journal {d.je_number} approved.", oleh_nama, oleh_id)
            elif aksi == "post":
                if status_lama not in JE_STATUS_BISA_POST:
                    pesan = "Approve the journal first." if status_lama in JE_STATUS_BISA_APPROVE else f"Status '{d.status}' cannot be posted."
                    hasil["skipped"].append({"id": draft_id, "je_number": d.je_number, "reason": pesan})
                    continue
                masalah = _validasi_posting_je_draft(session, d, lines_per.get(draft_id, []))
                if masalah:
                    hasil["skipped"].append({"id": draft_id, "je_number": d.je_number, "reason": " ".join(masalah)})
                    continue
                d.status = "posted"
                d.posted_at = sekarang
                d.posted_by = oleh_id
                d.posting_date = posting_date or d.posting_date or d.entry_date
                _log_je(session, d, "Posted", f"Journal {d.je_number} posted to the general ledger.", oleh_nama, oleh_id)
            elif aksi == "reject":
                if status_lama not in JE_STATUS_BISA_REJECT:
                    hasil["skipped"].append({"id": draft_id, "je_number": d.je_number, "reason": f"Status '{d.status}' cannot be rejected."})
                    continue
                d.status = "rejected"
                if alasan:
                    d.notes = alasan
                _log_je(session, d, "Rejected", f"Journal {d.je_number} rejected." + (f" Reason: {alasan}" if alasan else ""), oleh_nama, oleh_id)
            else:  # reopen
                if status_lama not in JE_STATUS_BISA_REOPEN:
                    hasil["skipped"].append({"id": draft_id, "je_number": d.je_number, "reason": f"Status '{d.status}' cannot be reopened."})
                    continue
                d.status = "draft"
                d.approved_by_name = None
                _log_je(session, d, "Reopened", f"Journal {d.je_number} reopened as draft.", oleh_nama, oleh_id)
            d.edited_at = sekarang
            d.edited_by = oleh_id
            hasil["done"].append(_je_row_ke_dict(d, CRUD_FIELDS_JE_DRAFT))
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error {aksi} journal entry drafts: {e}")
        raise
    finally:
        session.close()


def update_je_draft_with_lines(
    draft_id: str,
    draft_data: Dict[str, Any],
    lines_data: Optional[List[Dict[str, Any]]],
    oleh_nama: Optional[str] = None,
    updated_by: Optional[str] = None,
) -> Dict[str, Any]:
    """Edit header (+ ganti seluruh baris kalau `lines_data` diisi) draft JE
    yang belum diposting, atomik. Mengembalikan {"ok": bool, "reason": str|None,
    "data": dict|None}. Baris lama dihapus permanen lalu diganti baris baru
    (UniqueConstraint(draft_id, line_no) membuat soft-delete tidak cocok);
    jejaknya tercatat di activity log."""
    session = SessionLocal()
    try:
        d = session.query(JournalEntryDraft).filter(
            JournalEntryDraft.id == draft_id, JournalEntryDraft.deleted_at.is_(None)
        ).first()
        if d is None:
            return {"ok": False, "reason": "NOT_FOUND", "data": None}
        if (d.status or "").lower() not in JE_STATUS_BISA_EDIT:
            return {"ok": False, "reason": f"Status '{d.status}' cannot be edited.", "data": None}

        bolehkan = {"entry_date", "posting_date", "period_label", "description", "source_reference", "notes", "currency", "je_number"}
        for k, v in draft_data.items():
            if k in bolehkan:
                setattr(d, k, v)

        if lines_data is not None:
            session.query(JournalEntryDraftLine).filter(JournalEntryDraftLine.draft_id == d.id).delete(synchronize_session=False)
            session.flush()
            for idx, line in enumerate(lines_data, start=1):
                session.add(JournalEntryDraftLine(
                    **{k: v for k, v in line.items() if k in CRUD_FIELDS_JE_DRAFT_LINE and k not in ("line_no", "draft_id", "client_id")},
                    draft_id=d.id, client_id=d.client_id, line_no=idx, created_by=updated_by,
                ))
            d.total_debit = sum((Decimal(str(l.get("debit") or 0)) for l in lines_data), Decimal(0))
            d.total_credit = sum((Decimal(str(l.get("credit") or 0)) for l in lines_data), Decimal(0))

        d.edited_at = datetime.now()
        d.edited_by = updated_by
        _log_je(session, d, "Edited", f"Journal {d.je_number} edited.", oleh_nama, updated_by)
        session.commit()
        session.refresh(d)
        row = _je_row_ke_dict(d, CRUD_FIELDS_JE_DRAFT)
        row["lines"] = [
            _je_row_ke_dict(l, CRUD_FIELDS_JE_DRAFT_LINE)
            for l in session.query(JournalEntryDraftLine).filter(JournalEntryDraftLine.draft_id == d.id)
            .order_by(JournalEntryDraftLine.line_no).all()
        ]
        return {"ok": True, "reason": None, "data": row}
    except IntegrityError as e:
        session.rollback()
        print(f"Error update draft+lines (integrity): {e}")
        return {"ok": False, "reason": "DUPLICATE_JE_NUMBER", "data": None}
    except Exception as e:
        session.rollback()
        print(f"Error update draft+lines financial_transaction_journal_entry_drafts: {e}")
        return {"ok": False, "reason": "DB_ERROR", "data": None}
    finally:
        session.close()


def hapus_je_drafts(draft_ids: List[str], oleh_nama: Optional[str], oleh_id: Optional[str]) -> Dict[str, List[Dict[str, Any]]]:
    """Soft-delete banyak draft JE -- HANYA yang belum diposting/approved."""
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"done": [], "skipped": []}
    try:
        sekarang = datetime.now()
        for d in session.query(JournalEntryDraft).filter(
            JournalEntryDraft.id.in_(draft_ids), JournalEntryDraft.deleted_at.is_(None)
        ).all():
            if (d.status or "").lower() not in JE_STATUS_BISA_HAPUS:
                hasil["skipped"].append({"id": d.id, "je_number": d.je_number, "reason": f"Status '{d.status}' cannot be deleted."})
                continue
            d.deleted_at = sekarang
            d.deleted_by = oleh_id
            _log_je(session, d, "Deleted", f"Journal {d.je_number} deleted.", oleh_nama, oleh_id)
            hasil["done"].append({"id": d.id, "je_number": d.je_number})
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error hapus journal entry drafts: {e}")
        raise
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


def _purchase_crud_list(model, fields: List[str], filters: Optional[Dict[str, Any]] = None, termasuk_nonaktif: bool = False,
                        kondisi_tambahan: Optional[List[Any]] = None) -> List[Dict[str, Any]]:
    session = SessionLocal()
    try:
        query = session.query(model)
        for kolom, nilai in (filters or {}).items():
            if nilai is not None:
                query = query.filter(getattr(model, kolom) == nilai)
        for kondisi in kondisi_tambahan or []:
            query = query.filter(kondisi)
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

def _filter_company_purchase(management_client_id: Optional[str]):
    """Subquery id transaksi purchase milik 1 company (management_clients.id)
    -- dipakai filter company untuk source_records & exceptions, yang (beda
    dari purchase_transactions) TIDAK punya kolom management_client_id
    sendiri. None kalau filter company tidak diminta."""
    if management_client_id is None:
        return None
    return select(PurchaseTransaction.id, PurchaseTransaction.source_record_id).where(
        PurchaseTransaction.management_client_id == management_client_id
    ).subquery()

def list_purchase_source_records(client_id: Optional[str] = None, source_type: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False,
                                 management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """client_id = id_user (akun yang login); management_client_id = company
    (dropdown "Switch Company") -- source record ikut company transaksi yang
    dibuat darinya (purchase_transactions.source_record_id). Source record
    yang belum jadi transaksi tidak punya company, jadi tidak ikut terfilter."""
    tx = _filter_company_purchase(management_client_id)
    hasil = _purchase_crud_list(
        PurchaseSourceRecord, CRUD_FIELDS_PURCHASE_SOURCE_RECORD,
        {"client_id": client_id, "source_type": source_type, "status": status},
        termasuk_nonaktif,
        kondisi_tambahan=None if tx is None else [PurchaseSourceRecord.id.in_(select(tx.c.source_record_id))],
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
    "client_id", "management_client_id", "purchase_no", "purchase_date", "invoice_date", "invoice_number",
    "po_number", "vendor_name", "vendor_code", "source_doc_type", "source_ref",
    "source_record_id", "description", "category", "subtotal", "discount",
    "tax_amount", "total", "accounts_payable", "currency", "payment_status",
    "payment_terms", "due_date", "status", "period_label", "created_by_name",
    "approved_by_name", "posted_by_name", "notes", "journal_entry_id",
    "posting_date", "posted_at",
    "ap_account_code", "ap_account_name", "tax_account_code", "tax_account_name", "approved_at",
]

def create_purchase_transaction(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    # Akun AP/PPN yang kosong diisi dari Settings > Account Mapping klien.
    data = dict(data)
    if data.get("management_client_id"):
        lengkapi_akun_purchase(data, [], akun_purchase_setting(data["management_client_id"]))
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

def list_purchase_transactions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False,
                               management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """client_id = id_user (akun yang login); management_client_id = company
    (dropdown "Switch Company") -- filter yang dipakai semua tab Purchase."""
    return _purchase_crud_list(
        PurchaseTransaction, CRUD_FIELDS_PURCHASE_TRANSACTION,
        {"client_id": client_id, "status": status, "management_client_id": management_client_id},
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

def list_purchase_exceptions(client_id: Optional[str] = None, status: Optional[str] = None, termasuk_nonaktif: bool = False,
                             management_client_id: Optional[str] = None) -> List[Dict[str, Any]]:
    """management_client_id = company -- exception ikut company transaksinya
    (lewat transaction_id, atau source_record_id yang sudah jadi transaksi)."""
    tx = _filter_company_purchase(management_client_id)
    return _purchase_crud_list(
        PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION,
        {"client_id": client_id, "status": status},
        termasuk_nonaktif,
        kondisi_tambahan=None if tx is None else [or_(
            PurchaseException.transaction_id.in_(select(tx.c.id)),
            PurchaseException.source_record_id.in_(select(tx.c.source_record_id)),
        )],
    )

def update_purchase_exception(exception_id: str, data: Dict[str, Any], updated_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_update(PurchaseException, CRUD_FIELDS_PURCHASE_EXCEPTION, exception_id, data, updated_by)

def soft_delete_purchase_exception(exception_id: str, deleted_by: Optional[str] = None) -> bool:
    return _purchase_crud_soft_delete(PurchaseException, exception_id, deleted_by)


_AKUN_DEFAULT_PURCHASE = {
    "ppn_masukan": ("1300", "VAT Recoverable (Input Tax)"),
    "hutang": ("2100", "Accounts Payable"),
}


def akun_posting_purchase(tx: Any) -> Dict[str, tuple]:
    """Akun Cr Hutang Usaha & Dr PPN Masukan 1 Purchase Transaction (ORM
    object atau dict) -- kolom per transaksi (ap_account_* / tax_account_*),
    fallback ke _AKUN_DEFAULT_PURCHASE kalau kosong."""
    ambil = (lambda k: tx.get(k)) if isinstance(tx, dict) else (lambda k: getattr(tx, k, None))
    return {
        "ap": (ambil("ap_account_code"), ambil("ap_account_name") or "") if ambil("ap_account_code") else _AKUN_DEFAULT_PURCHASE["hutang"],
        "tax": (ambil("tax_account_code"), ambil("tax_account_name") or "") if ambil("tax_account_code") else _AKUN_DEFAULT_PURCHASE["ppn_masukan"],
    }


# Status yang boleh di-approve / di-post (alur Approve -> Post, lihat
# modules/transactions/purchase_v1.py POST /transactions/approve & /post).
PURCHASE_STATUS_BISA_APPROVE = ("draft", "pending_review", "exception")
PURCHASE_STATUS_BISA_POST = ("approved", "pending_posting")
_TOLERANSI_BALANCE_PURCHASE = Decimal("1")


def _validasi_posting_purchase(session, tx: "PurchaseTransaction", lines: List["PurchaseTransactionLine"]) -> List[str]:
    """Alasan transaksi TIDAK boleh diposting (list kosong = boleh)."""
    alasan: List[str] = []
    if not lines:
        return ["Transaction has no item lines."]
    tanpa_akun = [l.line_no for l in lines if not (l.account_code or "").strip()]
    if tanpa_akun:
        alasan.append(f"Line(s) {', '.join(map(str, tanpa_akun))} have no account code.")

    debit = sum((Decimal(str(l.subtotal or 0)) - Decimal(str(l.discount or 0))) for l in lines) + Decimal(str(tx.tax_amount or 0))
    kredit = Decimal(str(tx.accounts_payable or 0))
    if abs(debit - kredit) > _TOLERANSI_BALANCE_PURCHASE:
        alasan.append(f"Journal is not balanced (debit {debit:,.2f} vs accounts payable {kredit:,.2f}).")

    # Kalau klien punya master COA, semua akun jurnal WAJIB ada di COA-nya.
    if tx.management_client_id:
        coa = {
            r[0] for r in session.query(ManagementClientCoa.acc_no).filter(
                ManagementClientCoa.client_id == tx.management_client_id,
                ManagementClientCoa.deleted_at.is_(None),
            ).all()
        }
        if coa:
            akun = akun_posting_purchase(tx)
            dipakai = {l.account_code for l in lines if l.account_code} | {akun["ap"][0]}
            if Decimal(str(tx.tax_amount or 0)) > 0:
                dipakai.add(akun["tax"][0])
            tidak_ada = sorted(k for k in dipakai if k not in coa)
            if tidak_ada:
                alasan.append(f"Account(s) not found in the client's chart of accounts: {', '.join(tidak_ada)}.")
    return alasan


def ubah_status_purchase_transactions(
    transaction_ids: List[str],
    aksi: str,
    oleh_nama: Optional[str],
    oleh_id: Optional[str] = None,
    posting_date: Optional[date] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Approve (`aksi`='approve') atau Post (`aksi`='post') banyak Purchase
    Transaction sekaligus, 1 transaksi DB. Transaksi yang tidak memenuhi
    syarat dilewati (`skipped` + alasan), sisanya tetap diproses.

    approve: status draft/pending_review/exception -> approved (approved_by_name, approved_at)
    post   : status approved/pending_posting -> posted (posted_by_name, posted_at,
             posting_date default = purchase_date) -- divalidasi dulu lewat
             _validasi_posting_purchase (baris & akun lengkap, balance, akun ada di COA klien).
    """
    if aksi not in ("approve", "post"):
        raise ValueError("aksi harus 'approve' atau 'post'.")
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"done": [], "skipped": []}
    try:
        txs = {
            t.id: t for t in session.query(PurchaseTransaction).filter(
                PurchaseTransaction.id.in_(transaction_ids), PurchaseTransaction.deleted_at.is_(None)
            ).all()
        }
        lines_per_tx: Dict[str, List[PurchaseTransactionLine]] = {}
        if txs:
            for l in session.query(PurchaseTransactionLine).filter(
                PurchaseTransactionLine.transaction_id.in_(list(txs)), PurchaseTransactionLine.deleted_at.is_(None)
            ).order_by(PurchaseTransactionLine.line_no).all():
                lines_per_tx.setdefault(l.transaction_id, []).append(l)

        sekarang = datetime.now()
        for tx_id in dict.fromkeys(transaction_ids):
            tx = txs.get(tx_id)
            if tx is None:
                hasil["skipped"].append({"id": tx_id, "purchase_no": None, "reason": "Transaction not found."})
                continue
            status_lama = (tx.status or "").lower()
            if aksi == "approve":
                if status_lama not in PURCHASE_STATUS_BISA_APPROVE:
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": f"Status '{tx.status}' cannot be approved."})
                    continue
                if not lines_per_tx.get(tx_id):
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": "Transaction has no item lines."})
                    continue
                tx.status = "approved"
                tx.approved_by_name = oleh_nama
                tx.approved_at = sekarang
            else:
                if status_lama not in PURCHASE_STATUS_BISA_POST:
                    alasan = "Approve the transaction first." if status_lama in PURCHASE_STATUS_BISA_APPROVE else f"Status '{tx.status}' cannot be posted."
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": alasan})
                    continue
                alasan = _validasi_posting_purchase(session, tx, lines_per_tx.get(tx_id, []))
                if alasan:
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": " ".join(alasan)})
                    continue
                tx.status = "posted"
                tx.posted_by_name = oleh_nama
                tx.posted_at = sekarang
                tx.posting_date = posting_date or tx.purchase_date
            tx.edited_at = sekarang
            tx.edited_by = oleh_id
            hasil["done"].append(_purchase_row_ke_dict(tx, CRUD_FIELDS_PURCHASE_TRANSACTION))
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error {aksi} purchase transactions: {e}")
        raise
    finally:
        session.close()


# --- 5) financial_transaction_purchase_import_templates ---
# Pola sama dengan CRUD_FIELDS_JE_IMPORT_TEMPLATE -- client_id di sini
# reference ke management_clients, list di-order by usage_count.

CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE = [
    "client_id", "client_code", "file_type", "sheet_name",
    "header_row_index", "data_start_row_index", "column_signature_hash",
    "header_columns", "mapping_rules", "detected_by", "ai_model_version",
    "ai_confidence", "is_active",
]

def create_purchase_import_template(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseImportTemplate, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE, data, created_by)

def get_purchase_import_template_by_id(template_id: str) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseImportTemplate, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE, template_id, termasuk_nonaktif=True)

def list_purchase_import_templates(client_id: Optional[str] = None, file_type: Optional[str] = None, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Daftar template pola kolom Purchase -- dipakai untuk mencocokkan file
    baru (lihat _cocokkan_template di modules/transactions/purchase_import_v1.py)."""
    session = SessionLocal()
    try:
        query = session.query(PurchaseImportTemplate).filter(PurchaseImportTemplate.deleted_at.is_(None))
        if client_id is not None:
            query = query.filter(PurchaseImportTemplate.client_id == client_id)
        if file_type is not None:
            query = query.filter(PurchaseImportTemplate.file_type == file_type)
        if hanya_aktif:
            query = query.filter(PurchaseImportTemplate.is_active.is_(True))
        return [_purchase_row_ke_dict(obj, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE) for obj in query.order_by(PurchaseImportTemplate.usage_count.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

def touch_purchase_import_template_usage(template_id: str) -> bool:
    """Naikkan usage_count +1 & set last_used_at=now() -- dipanggil setiap
    kali template ini berhasil dipakai mencocokkan file baru."""
    session = SessionLocal()
    try:
        obj = session.query(PurchaseImportTemplate).filter(PurchaseImportTemplate.id == template_id).first()
        if not obj:
            return False
        obj.usage_count = (obj.usage_count or 0) + 1
        obj.last_used_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error touch usage purchase_import_template: {e}")
        return False
    finally:
        session.close()


def list_purchase_nos_by_client(client_id: str, purchase_nos: List[str]) -> set:
    """Satu query: purchase_no (dari daftar) yang SUDAH ada untuk client ini
    (belum dihapus). Dipakai import massal supaya cek duplikat tidak 1 query
    per transaksi."""
    if not purchase_nos:
        return set()
    session = SessionLocal()
    try:
        rows = session.query(PurchaseTransaction.purchase_no).filter(
            PurchaseTransaction.client_id == client_id,
            PurchaseTransaction.purchase_no.in_(list(purchase_nos)),
            PurchaseTransaction.deleted_at.is_(None),
        ).all()
        return {r[0] for r in rows}
    except Exception as e:
        session.rollback()
        print(f"Error list_purchase_nos_by_client: {e}")
        return set()
    finally:
        session.close()


def create_purchase_transactions_bulk(items: List[Dict[str, Any]], created_by: Optional[str] = None) -> bool:
    """Simpan BANYAK Purchase Transaction + baris itemnya dalam SATU sesi &
    SATU commit (atomik: semua berhasil atau tidak ada yang masuk). ID
    dibuat di sisi aplikasi (uuid4) jadi tidak perlu flush per transaksi --
    insert baris memakai batch. Jauh lebih cepat daripada memanggil
    create_purchase_transaction_with_lines() per transaksi (1 sesi + beberapa
    round-trip ke Supabase per transaksi).

    items: [{"transaction": {...}, "lines": [{...}]}, ...]. Header dihitung
    ULANG dari SUM(lines), aturan sama dengan create_purchase_transaction_with_lines.
    Return True kalau semua tersimpan, False kalau gagal (sudah rollback)."""
    if not items:
        return True
    session = SessionLocal()
    try:
        for item in items:
            transaction_data = item["transaction"]
            lines_data = item["lines"]
            subtotal = sum(Decimal(str(l.get("subtotal") or 0)) for l in lines_data)
            discount = sum(Decimal(str(l.get("discount") or 0)) for l in lines_data)
            tax_amount = sum(Decimal(str(l.get("tax_amount") or 0)) for l in lines_data)
            total = sum(Decimal(str(l.get("total") or 0)) for l in lines_data)
            accounts_payable = Decimal(str(transaction_data.get("accounts_payable"))) if transaction_data.get("accounts_payable") is not None else total

            tx_id = str(uuid.uuid4())
            session.add(PurchaseTransaction(
                **{k: v for k, v in transaction_data.items() if k in CRUD_FIELDS_PURCHASE_TRANSACTION and k not in ("subtotal", "discount", "tax_amount", "total", "accounts_payable")},
                id=tx_id,
                subtotal=subtotal,
                discount=discount,
                tax_amount=tax_amount,
                total=total,
                accounts_payable=accounts_payable,
                created_by=created_by,
            ))
            for idx, line in enumerate(lines_data, start=1):
                session.add(PurchaseTransactionLine(
                    **{k: v for k, v in line.items() if k in CRUD_FIELDS_PURCHASE_TRANSACTION_LINE and k != "line_no"},
                    transaction_id=tx_id,
                    client_id=transaction_data.get("client_id"),
                    line_no=line.get("line_no") or idx,
                    created_by=created_by,
                ))
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error create_purchase_transactions_bulk: {e}")
        return False
    finally:
        session.close()


# Status yang boleh di-approve / di-post (alur Approve -> Post, lihat
# modules/transactions/purchase_v1.py POST /transactions/approve & /post).
PURCHASE_STATUS_BISA_APPROVE = ("draft", "pending_review", "exception")
PURCHASE_STATUS_BISA_POST = ("approved", "pending_posting")
_TOLERANSI_BALANCE_PURCHASE = Decimal("1")


def _validasi_posting_purchase(session, tx: "PurchaseTransaction", lines: List["PurchaseTransactionLine"]) -> List[str]:
    """Alasan transaksi TIDAK boleh diposting (list kosong = boleh)."""
    alasan: List[str] = []
    if not lines:
        return ["Transaction has no item lines."]
    tanpa_akun = [l.line_no for l in lines if not (l.account_code or "").strip()]
    if tanpa_akun:
        alasan.append(f"Line(s) {', '.join(map(str, tanpa_akun))} have no account code.")

    debit = sum((Decimal(str(l.subtotal or 0)) - Decimal(str(l.discount or 0))) for l in lines) + Decimal(str(tx.tax_amount or 0))
    kredit = Decimal(str(tx.accounts_payable or 0))
    if abs(debit - kredit) > _TOLERANSI_BALANCE_PURCHASE:
        alasan.append(f"Journal is not balanced (debit {debit:,.2f} vs accounts payable {kredit:,.2f}).")

    # Kalau klien punya master COA, semua akun jurnal WAJIB ada di COA-nya.
    if tx.management_client_id:
        coa = {
            r[0] for r in session.query(ManagementClientCoa.acc_no).filter(
                ManagementClientCoa.client_id == tx.management_client_id,
                ManagementClientCoa.deleted_at.is_(None),
            ).all()
        }
        if coa:
            akun = akun_posting_purchase(tx)
            dipakai = {l.account_code for l in lines if l.account_code} | {akun["ap"][0]}
            if Decimal(str(tx.tax_amount or 0)) > 0:
                dipakai.add(akun["tax"][0])
            tidak_ada = sorted(k for k in dipakai if k not in coa)
            if tidak_ada:
                alasan.append(f"Account(s) not found in the client's chart of accounts: {', '.join(tidak_ada)}.")
    return alasan


def ubah_status_purchase_transactions(
    transaction_ids: List[str],
    aksi: str,
    oleh_nama: Optional[str],
    oleh_id: Optional[str] = None,
    posting_date: Optional[date] = None,
) -> Dict[str, List[Dict[str, Any]]]:
    """Approve (`aksi`='approve') atau Post (`aksi`='post') banyak Purchase
    Transaction sekaligus, 1 transaksi DB. Transaksi yang tidak memenuhi
    syarat dilewati (`skipped` + alasan), sisanya tetap diproses.

    approve: status draft/pending_review/exception -> approved (approved_by_name, approved_at)
    post   : status approved/pending_posting -> posted (posted_by_name, posted_at,
             posting_date default = purchase_date) -- divalidasi dulu lewat
             _validasi_posting_purchase (baris & akun lengkap, balance, akun ada di COA klien).
    """
    if aksi not in ("approve", "post"):
        raise ValueError("aksi harus 'approve' atau 'post'.")
    session = SessionLocal()
    hasil: Dict[str, List[Dict[str, Any]]] = {"done": [], "skipped": []}
    try:
        txs = {
            t.id: t for t in session.query(PurchaseTransaction).filter(
                PurchaseTransaction.id.in_(transaction_ids), PurchaseTransaction.deleted_at.is_(None)
            ).all()
        }
        lines_per_tx: Dict[str, List[PurchaseTransactionLine]] = {}
        if txs:
            for l in session.query(PurchaseTransactionLine).filter(
                PurchaseTransactionLine.transaction_id.in_(list(txs)), PurchaseTransactionLine.deleted_at.is_(None)
            ).order_by(PurchaseTransactionLine.line_no).all():
                lines_per_tx.setdefault(l.transaction_id, []).append(l)

        sekarang = datetime.now()
        akun_setting_per_klien: Dict[str, Dict[str, Any]] = {}
        for tx_id in dict.fromkeys(transaction_ids):
            tx = txs.get(tx_id)
            if tx is None:
                hasil["skipped"].append({"id": tx_id, "purchase_no": None, "reason": "Transaction not found."})
                continue
            status_lama = (tx.status or "").lower()
            # Akun yang masih kosong (transaksi lama / input manual) diisi dari
            # Settings > Account Mapping sebelum divalidasi & diposting.
            if tx.management_client_id and status_lama in PURCHASE_STATUS_BISA_APPROVE + PURCHASE_STATUS_BISA_POST:
                if tx.management_client_id not in akun_setting_per_klien:
                    akun_setting_per_klien[tx.management_client_id] = akun_purchase_setting(tx.management_client_id, session=session)
                lengkapi_akun_purchase(tx, lines_per_tx.get(tx_id, []), akun_setting_per_klien[tx.management_client_id])
            if aksi == "approve":
                if status_lama not in PURCHASE_STATUS_BISA_APPROVE:
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": f"Status '{tx.status}' cannot be approved."})
                    continue
                if not lines_per_tx.get(tx_id):
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": "Transaction has no item lines."})
                    continue
                tx.status = "approved"
                tx.approved_by_name = oleh_nama
                tx.approved_at = sekarang
            else:
                if status_lama not in PURCHASE_STATUS_BISA_POST:
                    alasan = "Approve the transaction first." if status_lama in PURCHASE_STATUS_BISA_APPROVE else f"Status '{tx.status}' cannot be posted."
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": alasan})
                    continue
                alasan = _validasi_posting_purchase(session, tx, lines_per_tx.get(tx_id, []))
                if alasan:
                    hasil["skipped"].append({"id": tx_id, "purchase_no": tx.purchase_no, "reason": " ".join(alasan)})
                    continue
                tx.status = "posted"
                tx.posted_by_name = oleh_nama
                tx.posted_at = sekarang
                tx.posting_date = posting_date or tx.purchase_date
            tx.edited_at = sekarang
            tx.edited_by = oleh_id
            hasil["done"].append(_purchase_row_ke_dict(tx, CRUD_FIELDS_PURCHASE_TRANSACTION))
        session.commit()
        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error {aksi} purchase transactions: {e}")
        raise
    finally:
        session.close()


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
    ikut total kalau tidak dikirim eksplisit. Akun AP/PPN/baris yang kosong
    diisi dari Settings > Account Mapping klien (lengkapi_akun_purchase)."""
    session = SessionLocal()
    try:
        if transaction_data.get("management_client_id"):
            transaction_data = dict(transaction_data)
            lines_data = [dict(l) for l in lines_data]
            lengkapi_akun_purchase(
                transaction_data, lines_data,
                akun_purchase_setting(transaction_data["management_client_id"], session=session),
            )
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


# --- 5) financial_transaction_purchase_import_templates ---
# Pola sama dengan CRUD_FIELDS_JE_IMPORT_TEMPLATE -- client_id di sini
# reference ke management_clients, list di-order by usage_count.

CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE = [
    "client_id", "client_code", "file_type", "sheet_name",
    "header_row_index", "data_start_row_index", "column_signature_hash",
    "header_columns", "mapping_rules", "detected_by", "ai_model_version",
    "ai_confidence", "is_active",
]

def create_purchase_import_template(data: Dict[str, Any], created_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
    return _purchase_crud_create(PurchaseImportTemplate, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE, data, created_by)

def get_purchase_import_template_by_id(template_id: str) -> Optional[Dict[str, Any]]:
    return _purchase_crud_get_by_id(PurchaseImportTemplate, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE, template_id, termasuk_nonaktif=True)

def list_purchase_import_templates(client_id: Optional[str] = None, file_type: Optional[str] = None, hanya_aktif: bool = True) -> List[Dict[str, Any]]:
    """Daftar template pola kolom Purchase -- dipakai untuk mencocokkan file
    baru (lihat _cocokkan_template di modules/transactions/purchase_import_v1.py)."""
    session = SessionLocal()
    try:
        query = session.query(PurchaseImportTemplate).filter(PurchaseImportTemplate.deleted_at.is_(None))
        if client_id is not None:
            query = query.filter(PurchaseImportTemplate.client_id == client_id)
        if file_type is not None:
            query = query.filter(PurchaseImportTemplate.file_type == file_type)
        if hanya_aktif:
            query = query.filter(PurchaseImportTemplate.is_active.is_(True))
        return [_purchase_row_ke_dict(obj, CRUD_FIELDS_PURCHASE_IMPORT_TEMPLATE) for obj in query.order_by(PurchaseImportTemplate.usage_count.desc()).all()]
    except Exception:
        session.rollback()
        return []
    finally:
        session.close()

def touch_purchase_import_template_usage(template_id: str) -> bool:
    """Naikkan usage_count +1 & set last_used_at=now() -- dipanggil setiap
    kali template ini berhasil dipakai mencocokkan file baru."""
    session = SessionLocal()
    try:
        obj = session.query(PurchaseImportTemplate).filter(PurchaseImportTemplate.id == template_id).first()
        if not obj:
            return False
        obj.usage_count = (obj.usage_count or 0) + 1
        obj.last_used_at = datetime.now()
        session.commit()
        return True
    except Exception as e:
        session.rollback()
        print(f"Error touch usage purchase_import_template: {e}")
        return False
    finally:
        session.close()


# ============================================================
# FITUR FINANCIAL STATEMENTS -- sumber data buku besar (GL)
# ============================================================
# Laporan keuangan (modules/financial_statements/) dibangun dari tabel
# fitur Transactions yang SUDAH POSTED saja (aturan Accounting Core V2:
# draft tidak boleh bocor ke laporan Actual). 3 sumber dijadikan satu
# daftar baris jurnal datar {tanggal, account_code, debit, kredit, ...}:
#
#   1. Journal Entry  -- draft status 'posted' + draft_lines apa adanya.
#   2. Sales          -- invoice posting_status 'Posted', baris jurnalnya
#                        disusun PERSIS seperti tab Journal Preview Sales
#                        (SalesJournalPreview.tsx): Dr Piutang = gross,
#                        Cr Pendapatan = DPP, Cr PPN Keluaran = PPN, akun
#                        dari financial_transaction_sales_account_mappings
#                        (fallback ke akun default FE kalau belum dimapping).
#   3. Purchase       -- transaksi status 'posted', disusun PERSIS seperti
#                        tab Purchase Preview (purchase/preview/page.tsx):
#                        Dr akun tiap baris = subtotal - diskon, Dr PPN
#                        Masukan = tax_amount, Cr Hutang Usaha = accounts_payable.
#
# Posting Sales/Purchase TIDAK membuat draft Journal Entry, jadi ketiga
# sumber ini tidak saling dobel.

# Akun default -- harus sinkron dengan konstanta di FE yang disebut di atas.
_AKUN_DEFAULT_SALES = {
    "piutang": ("1120-01", "Piutang Usaha - IDR"),
    "pendapatan": ("4100-01", "Pendapatan Jasa Konsultasi"),
    "ppn": ("2100-01", "PPN Keluaran"),
}
_AKUN_DEFAULT_PURCHASE = {
    "ppn_masukan": ("1300", "VAT Recoverable (Input Tax)"),
    "hutang": ("2100", "Accounts Payable"),
}


def akun_posting_purchase(tx: Any) -> Dict[str, tuple]:
    """Akun Cr Hutang Usaha & Dr PPN Masukan 1 Purchase Transaction (ORM
    object atau dict) -- kolom per transaksi (migration 18), fallback ke
    _AKUN_DEFAULT_PURCHASE kalau kosong."""
    ambil = (lambda k: tx.get(k)) if isinstance(tx, dict) else (lambda k: getattr(tx, k, None))
    return {
        "ap": (ambil("ap_account_code"), ambil("ap_account_name") or "") if ambil("ap_account_code") else _AKUN_DEFAULT_PURCHASE["hutang"],
        "tax": (ambil("tax_account_code"), ambil("tax_account_name") or "") if ambil("tax_account_code") else _AKUN_DEFAULT_PURCHASE["ppn_masukan"],
    }


def _angka_gl(v: Any) -> float:
    return float(v) if v is not None else 0.0


def ambil_baris_jurnal_posted_transaksi(
    client_id: Optional[str] = None,
    sampai_tanggal: Optional[date] = None,
    management_client_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Semua baris jurnal POSTED s.d. `sampai_tanggal` (inklusif, None =
    semua), difilter per `management_client_id` (klien/perusahaan -- filter
    utama Financial Statements) dan/atau `client_id` (id_user
    management_users, akun yang login). Minimal salah satu WAJIB diisi.
    Tiap baris: sumber, jurnal_id, nomor, tanggal (date), keterangan, pihak,
    account_code, account_name, debit, kredit, segmen (dimensi untuk filter
    segment P&L: JE -> cost_center baris; Sales -> branch (cabang) & project;
    Purchase belum punya dimensi)."""
    if not client_id and not management_client_id:
        raise ValueError("client_id atau management_client_id wajib diisi.")

    def _filter_pemilik(model):
        syarat = []
        if client_id:
            syarat.append(model.client_id == client_id)
        if management_client_id:
            syarat.append(model.management_client_id == management_client_id)
        return syarat

    session = SessionLocal()
    hasil: List[Dict[str, Any]] = []
    try:
        # --- 1) Journal Entry ---
        q = session.query(JournalEntryDraft, JournalEntryDraftLine).join(
            JournalEntryDraftLine, JournalEntryDraftLine.draft_id == JournalEntryDraft.id
        ).filter(
            *_filter_pemilik(JournalEntryDraft),
            func.lower(JournalEntryDraft.status) == "posted",
            JournalEntryDraft.deleted_at.is_(None),
            JournalEntryDraftLine.deleted_at.is_(None),
        )
        if sampai_tanggal:
            q = q.filter(JournalEntryDraft.entry_date <= sampai_tanggal)
        for draft, line in q.order_by(JournalEntryDraft.entry_date, JournalEntryDraftLine.line_no).all():
            hasil.append({
                "sumber": "journal_entry",
                "jurnal_id": f"je:{draft.id}",
                "nomor": draft.je_number,
                "tanggal": draft.entry_date,
                "keterangan": line.description or draft.description,
                "pihak": draft.source_reference,
                "account_code": line.account_code,
                "account_name": line.account_name,
                "debit": _angka_gl(line.debit),
                "kredit": _angka_gl(line.credit),
                "segmen": {"cost_center": line.cost_center},
            })

        # --- 2) Sales ---
        default_klien_sales: Dict[tuple, Dict[str, tuple]] = {}
        q = session.query(SalesInvoice, SalesAccountMapping).outerjoin(
            SalesAccountMapping,
            (SalesAccountMapping.invoice_id == SalesInvoice.id) & SalesAccountMapping.deleted_at.is_(None),
        ).filter(
            *_filter_pemilik(SalesInvoice),
            func.lower(SalesInvoice.posting_status) == "posted",
            SalesInvoice.deleted_at.is_(None),
        )
        if sampai_tanggal:
            q = q.filter(SalesInvoice.invoice_date <= sampai_tanggal)
        for inv, mapping in q.order_by(SalesInvoice.invoice_date).all():
            gross = _angka_gl(inv.gross_amount)
            dpp = _angka_gl(inv.dpp) or round(gross / 1.11)
            ppn = _angka_gl(inv.ppn) or (gross - dpp)
            akun = {
                "piutang": (mapping.piutang_account_code, mapping.piutang_account_name) if mapping else None,
                "pendapatan": (mapping.pendapatan_account_code, mapping.pendapatan_account_name) if mapping else None,
                "ppn": (mapping.ppn_account_code, mapping.ppn_account_name) if mapping and mapping.ppn_account_code else None,
            }
            # Belum ada mapping -> akun default klien (template Sales), baru default global.
            if not mapping or None in akun.values():
                kunci_cache = (inv.management_client_id, (inv.cabang or "").upper())
                if kunci_cache not in default_klien_sales:
                    default_klien_sales[kunci_cache] = akun_default_sales(inv.management_client_id, inv.cabang, session=session) or {}
                akun = {k: v or default_klien_sales[kunci_cache].get(k) for k, v in akun.items()}
            akun = {k: v or _AKUN_DEFAULT_SALES[k] for k, v in akun.items()}
            dasar = {
                "sumber": "sales",
                "jurnal_id": f"sales:{inv.id}",
                "nomor": inv.invoice_no,
                "tanggal": inv.invoice_date,
                "keterangan": inv.description or f"Penjualan {inv.invoice_no}",
                "pihak": inv.customer_name,
                "segmen": {"branch": inv.cabang, "project": inv.project_name},
            }
            for kunci, debit, kredit in (("piutang", gross, 0.0), ("pendapatan", 0.0, dpp), ("ppn", 0.0, ppn)):
                if debit or kredit:
                    hasil.append({**dasar, "account_code": akun[kunci][0], "account_name": akun[kunci][1], "debit": debit, "kredit": kredit})

        # --- 3) Purchase ---
        q = session.query(PurchaseTransaction).filter(
            *_filter_pemilik(PurchaseTransaction),
            func.lower(PurchaseTransaction.status) == "posted",
            PurchaseTransaction.deleted_at.is_(None),
        )
        if sampai_tanggal:
            q = q.filter(PurchaseTransaction.purchase_date <= sampai_tanggal)
        transaksi = q.order_by(PurchaseTransaction.purchase_date).all()
        baris_per_tx: Dict[str, List[PurchaseTransactionLine]] = {}
        if transaksi:
            for line in session.query(PurchaseTransactionLine).filter(
                PurchaseTransactionLine.transaction_id.in_([t.id for t in transaksi]),
                PurchaseTransactionLine.deleted_at.is_(None),
            ).order_by(PurchaseTransactionLine.line_no).all():
                baris_per_tx.setdefault(line.transaction_id, []).append(line)
        for tx in transaksi:
            dasar = {
                "sumber": "purchase",
                "jurnal_id": f"purchase:{tx.id}",
                "nomor": tx.purchase_no,
                "tanggal": tx.purchase_date,
                "keterangan": tx.description or f"Pembelian {tx.purchase_no}",
                "pihak": tx.vendor_name,
                "segmen": {},
            }
            per_akun: Dict[str, List[Any]] = {}
            for line in baris_per_tx.get(tx.id, []):
                entri = per_akun.setdefault(line.account_code, [line.account_name, 0.0])
                entri[1] += _angka_gl(line.subtotal) - _angka_gl(line.discount)
            for kode, (nama, nilai) in per_akun.items():
                if nilai:
                    hasil.append({**dasar, "account_code": kode, "account_name": nama, "debit": nilai, "kredit": 0.0})
            if _angka_gl(tx.tax_amount) > 0:
                kode, nama = akun_posting_purchase(tx)["tax"]
                hasil.append({**dasar, "account_code": kode, "account_name": nama, "debit": _angka_gl(tx.tax_amount), "kredit": 0.0})
            if _angka_gl(tx.accounts_payable):
                kode, nama = akun_posting_purchase(tx)["ap"]
                hasil.append({**dasar, "account_code": kode, "account_name": nama, "debit": 0.0, "kredit": _angka_gl(tx.accounts_payable)})

        return hasil
    except Exception as e:
        session.rollback()
        print(f"Error ambil baris jurnal posted (financial statements): {e}")
        raise
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
    """Hapus client (management_clients)."""
    session = SessionLocal()
    try:
        client = session.query(Client).filter(Client.id == client_id).first()
        if not client:
            return False
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


# ============================================================
# FUNGSI POLA AUGMENTASI (feedback koreksi user, persisten)
# ============================================================


# ============================================================
# [FIX] FUNGSI ALERT ANOMALI -- sebelumnya dipanggil dari main.py tapi
# tidak pernah didefinisikan di sini sama sekali (lihat catatan di atas
# model AlertAnomali). Sekaligus dipakai sbg kotak masuk in-app utk
# reminder deadline SPT.
# ============================================================


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


# [BARU -- nomor 3, pencegahan] Kata kunci nama akun yang dianggap Kas/Bank.
# Dicek via "in" (substring, case-insensitive) terhadap nama_akun yang sudah
# di-lower() -- jadi "Bank Mandiri", "Kas Kecil", "Petty Cash Kantor",
# "Giro BCA", "Tabungan BRI", "Deposito Berjangka" semuanya kena.
#
# [DIUBAH -- sinkron dengan COA IFRS standar] Kata kunci ini HANYA dipakai
# kalau sub_kategori dari sumber data kosong/generik (lihat
# _SUB_KATEGORI_UMUM_ASET). Kalau sumber data sudah menyebut sub_kategori yang
# spesifik (mis. "SHORT-TERM FINANCIAL ASSETS" untuk akun "Deposito", atau
# "TRADE RECEIVABLES" untuk akun "Bank Transfer"), sub_kategori itu DIHORMATI
# dan tidak ditimpa jadi 'Kas' cuma karena namanya kebetulan mengandung kata
# "bank"/"deposito".
_KATA_KUNCI_AKUN_KAS_BANK = ('kas', 'bank', 'petty cash', 'giro', 'tabungan', 'deposito')

# [BARU -- sinkron dengan COA IFRS standar] Nilai sub_kategori dari sumber data
# (mis. sheet COA IFRS: kolom ACCOUNT SUB) yang artinya memang Kas & Bank.
# Semuanya dipetakan ke 'Kas' -- standar yang dibaca dropdown Bank Feed,
# laporan_keuangan.py, dan VIEW v_kas_bank_dari_jurnal. Ini termasuk akun
# kas/bank yang namanya TIDAK mengandung kata kunci di atas (mis. "BCA # 1234",
# "Pety Cash - Lokasi", "Money In Transit", "Setoran Dalam Perjalanan").
# Dibandingkan setelah upper() dan spasi berlebih dirapikan.
_SUB_KATEGORI_KAS_BANK_STANDAR = (
    'CASH & CASH EQUIVALENTS',
    'CASH AND CASH EQUIVALENTS',
    'KAS DAN SETARA KAS',
    'KAS & BANK',
    'KAS',
)

# [BARU] sub_kategori generik yang belum menunjukkan klasifikasi spesifik --
# hanya untuk nilai inilah kata kunci nama akun boleh menentukan 'Kas'.
_SUB_KATEGORI_UMUM_ASET = ('', 'ASET LANCAR', 'ASET', 'CURRENT ASSET', 'CURRENT ASSETS', 'LANCAR')


def _normalisasi_sub_kategori_kas_bank(
    nama_akun: Optional[str], kategori: Optional[str], sub_kategori: Optional[str]
) -> Optional[str]:
    """
    [BARU -- nomor 3, pencegahan] Auto-koreksi sub_kategori jadi 'Kas' untuk
    akun ASET Kas/Bank -- supaya standar yang sudah dipakai
    laporan_keuangan.py (perhitungan saldo Kas bulanan utk Neraca/Arus Kas)
    dan VIEW v_kas_bank_dari_jurnal (dasar halaman Cash & Bank) tidak rusak
    lagi kalau file import Excel/input manual COA sub_kategori-nya kosong,
    salah ketik, atau memakai istilah IFRS.

    Insiden sebelumnya (perbaikan manual, lihat migration
    standarisasi_sub_kategori_kas_bank_coa): 3 akun "Kas" di 3 client sempat
    ke-tag sub_kategori='Aset Lancar' padahal seharusnya 'Kas'. Perbaikan
    itu cuma membetulkan DATA YANG SUDAH ADA -- fungsi ini yang mencegah
    masalah yang sama muncul lagi tiap kali simpan_coa_bulk() dipanggil
    (import ulang dari Excel ATAUPUN input manual dari UI, lihat pemanggil
    di main.py).

    [DIUBAH -- sinkron dengan COA IFRS standar] Urutan aturan (hanya untuk
    akun kategori ASET/ASSET, dicek case-insensitive):
      1. sub_kategori sudah bernilai istilah Kas & Bank
         (_SUB_KATEGORI_KAS_BANK_STANDAR, mis. "CASH & CASH EQUIVALENTS")
         -> jadi 'Kas', TANPA melihat nama akun.
      2. sub_kategori kosong/generik (_SUB_KATEGORI_UMUM_ASET) DAN nama akun
         mengandung kata kunci Kas/Bank -> jadi 'Kas' (perilaku lama).
      3. selain itu -> sub_kategori asli dipakai apa adanya. Jadi "Deposito"
         ber-sub "SHORT-TERM FINANCIAL ASSETS" dan "Bank Transfer" ber-sub
         "TRADE RECEIVABLES" TIDAK lagi salah jadi Kas.
    Akun non-ASET (Liabilitas/Ekuitas/dst) TIDAK disentuh.
    """
    if not kategori or str(kategori).strip().upper() not in ('ASET', 'ASSET'):
        return sub_kategori
    sub_norm = ' '.join(str(sub_kategori or '').upper().split())
    if sub_norm in _SUB_KATEGORI_KAS_BANK_STANDAR:
        return 'Kas'
    if sub_norm in _SUB_KATEGORI_UMUM_ASET:
        nama = str(nama_akun or '').strip().lower()
        if any(kw in nama for kw in _KATA_KUNCI_AKUN_KAS_BANK):
            return 'Kas'
    return sub_kategori


_JENIS_KAS_VALID = ('bank', 'kas_tunai', 'kas_kecil', 'transit')

# [BARU] Kode standar IFRS (kolom STANDARD ACCOUNT CODE di Excel COA) -> jenis_kas.
_STD_CODE_KE_JENIS_KAS = {
    'std_asset_current_cash_bank': 'bank',
    'std_asset_current_cash_on_hand': 'kas_tunai',
    'std_asset_current_cash_petty': 'kas_kecil',
    'std_asset_current_cash_transit': 'transit',
}

# Nama bank yang lazim, dipakai hanya sebagai cadangan terakhir kalau
# keterangan/kode standar tidak ada (mis. nama akun "BCA # 1234").
_KATA_NAMA_BANK = (
    'bank', 'bca', 'bri', 'bni', 'mandiri', 'permata', 'ocbc', 'cimb', 'btn', 'bjb',
    'danamon', 'uob', 'niaga', 'bpd', 'maybank', 'panin', 'mega', 'wise', 'escrow',
)


def _tentukan_jenis_kas(
    sub_kategori: Optional[str],
    nama_akun: Optional[str],
    keterangan: Optional[str] = None,
    jenis_kas: Optional[str] = None,
    standard_code: Optional[str] = None,
) -> Optional[str]:
    """
    [BARU] Tentukan jenis akun Kas & Bank (bank / kas_tunai / kas_kecil /
    transit). Hanya untuk sub_kategori 'Kas'; selain itu None.
    Urutan: nilai eksplisit -> kode standar IFRS -> deskripsi IFRS di keterangan -> tebakan dari nama akun. Kalau tidak
    bisa ditentukan, hasilnya None (akun tidak muncul di dropdown bank,
    dan bisa diisi manual).
    """
    if str(sub_kategori or '').strip() != 'Kas':
        return None
    jk = str(jenis_kas or '').strip().lower()
    if jk in _JENIS_KAS_VALID:
        return jk
    nama = str(nama_akun or '').strip().lower()
    if 'transit' in nama or 'setoran dalam perjalanan' in nama:
        return 'transit'
    kode = str(standard_code or '').strip().lower()
    if kode in _STD_CODE_KE_JENIS_KAS:
        return _STD_CODE_KE_JENIS_KAS[kode]
    ket = str(keterangan or '').strip().lower()
    if ket.startswith('cash or bank funds in transit'):
        return 'transit'
    if ket.startswith('petty cash'):
        return 'kas_kecil'
    if ket.startswith('cash on hand'):
        return 'kas_tunai'
    if ket.startswith('cash held in bank'):
        return 'bank'
    if 'petty' in nama or 'pety' in nama or 'kas kecil' in nama:
        return 'kas_kecil'
    if any(k in nama.replace('#', ' ').split() or k in nama for k in _KATA_NAMA_BANK):
        return 'bank'
    if 'kas' in nama or 'cash' in nama:
        return 'kas_tunai'
    return None


def _jenis_kas_dari_akun(nama_akun: str, akun: Dict[str, Any]) -> Optional[str]:
    """[BARU] Turunkan jenis_kas dari satu dict akun import (setelah normalisasi sub_kategori)."""
    sub = _normalisasi_sub_kategori_kas_bank(nama_akun, akun.get("kategori"), akun.get("sub_kategori"))
    return _tentukan_jenis_kas(
        sub, nama_akun, akun.get("keterangan"), akun.get("jenis_kas"), akun.get("standard_account_code")
    )


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


# Nilai status jurnal_posting yang sah -- dijaga di satu tempat supaya
# update_jurnal_posting() & endpoint PATCH di main.py konsisten menolak
# nilai lain (mis. typo atau status lama 'Unposted'/'Reconciled'/'Voided'
# ala frontend yang TIDAK ADA representasinya di backend, lihat catatan di
# jurnalBridge.ts::STATUS_MAP).
STATUS_JURNAL_VALID = {"draft", "terposting", "ditolak"}


# ============================================================
# [BARU - export 14 sheet] RIWAYAT SALDO BULANAN
# ============================================================
# Snapshot saldo per akun per bulan, dipakai sheet "Ringkasan" untuk
# tren Piutang/Utang per bulan. Diisi tiap kali laporan bulanan
# digenerate (lihat endpoint generate laporan bulanan di main.py).


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


AUDIT_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024  # [BARU] batas ukuran 1 file evidence


def _audit_num(v):
    return float(v) if v is not None else 0.0


def _audit_iso_date(d):
    return d.isoformat() if d else None


def _audit_iso_dt(dt):
    return dt.isoformat() if dt else None