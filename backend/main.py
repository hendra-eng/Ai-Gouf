"""
main.py
=======
Backend FastAPI untuk AI Gouf Consulting.

CARA MENJALANKAN (development):
    cd backend
    python -m venv venv
    source venv/bin/activate        # Windows: venv\\Scripts\\activate
    pip install -r requirements.txt
    # Buat file .env di folder ini (lihat .env.example) sebelum jalan --
    # isinya DATABASE_URL (Supabase), JWT_SECRET_KEY, DEEPSEEK_API_KEY.
    uvicorn main:app --reload --port 8000

============================================================
[FIX v4] Tambah load_dotenv() di baris PALING ATAS, SEBELUM import
akuntansi_ai / db_client / modules.auth. Tanpa ini, isi file .env
(DATABASE_URL ke Supabase, JWT_SECRET_KEY, DEEPSEEK_API_KEY) TIDAK
PERNAH terbaca otomatis -- padahal python-dotenv sudah ada di
requirements.txt sejak awal, cuma belum pernah benar-benar dipanggil.
Dulu di Streamlit ini otomatis kebaca lewat st.secrets/secrets.toml;
sekarang gantinya file .env + load_dotenv() ini.

URUTAN PENTING: load_dotenv() harus dipanggil SEBELUM `import db_client
as dbc` dan `from modules import auth`, karena db_client.py membaca
os.environ.get("DATABASE_URL") saat pertama kali di-import (jadi
koneksi ke Supabase dibuat saat itu juga), dan modules/auth.py membaca
JWT_SECRET_KEY dengan cara yang sama. Kalau load_dotenv() dipanggil
sesudah kedua import itu, sudah kelambatan -- keduanya akan pakai
default yang salah (sqlite lokal / secret key tidak aman).
============================================================
"""

from dotenv import load_dotenv
from pathlib import Path as _PathAwal

# [FIX v5] Sebelumnya load_dotenv() dipanggil tanpa argumen, yang berarti
# python-dotenv cuma mencari file .env mulai dari CURRENT WORKING
# DIRECTORY (folder tempat command `uvicorn` diketik) ke atas. Kalau
# kamu jalankan uvicorn dari folder lain -- misal root "migrasi-react"
# alih-alih "migrasi-react\backend" (gampang kejadian di terminal VS
# Code, yang defaultnya buka di root workspace) -- file .env di folder
# backend TIDAK PERNAH ketemu. load_dotenv() lalu diam-diam tidak
# melakukan apa-apa (tanpa error), sehingga DATABASE_URL/JWT_SECRET_KEY/
# DEEPSEEK_API_KEY semuanya balik ke default (DATABASE_URL jatuh ke
# fallback "sqlite:///ai_gouf.db" di db_client.py) -- data pun nyasar
# ke SQLite lokal, bukan Supabase, TANPA ada error yang kelihatan.
#
# Sekarang path .env dihitung dari lokasi file main.py ini SENDIRI
# (bukan dari cwd), jadi hasilnya konsisten mau uvicorn dijalankan dari
# folder mana pun.
_ENV_PATH = _PathAwal(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=_ENV_PATH)  # [FIX v5] WAJIB paling atas, sebelum import db_client / modules.auth

if not _ENV_PATH.exists():
    # Jangan diam saja kalau file .env-nya sendiri tidak ketemu --
    # ini kemungkinan besar kesalahan setup (file belum dibuat / typo
    # nama file), bukan cuma soal cwd.
    print(f"[PERINGATAN] File .env tidak ditemukan di: {_ENV_PATH}")
    print("DATABASE_URL, JWT_SECRET_KEY, dan DEEPSEEK_API_KEY kemungkinan akan pakai nilai default yang salah.")

import asyncio
import base64
import io
import json
import math
import os
import queue
import threading
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import openpyxl
import pandas as pd
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse, Response
from pydantic import BaseModel
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

import akuntansi_ai as ak
import db_client as dbc
from modules import (
    accounting_export, accounting_core, ai_analysis, auth,
    cross_matching,
    deteksi_kesalahan_pembelian as dkp, history,
    kertas_kerja,  # [BARU] Generator Kertas Kerja Laporan Keuangan dari PDF rekening koran
    ai_file_reader,  # [BARU] Kirim file (teks/gambar/PDF) langsung ke Claude API, tanpa parsing manual
    cache_cleanup,  # [BARU -- POIN 1] Pembersihan terjadwal cache ekstraksi PDF & Office (TTL + LRU)
    excel_export_worker,  # [BARU -- POINT 2] Generate Excel hasil proses lewat ProcessPoolExecutor
)
from modules.kertas_kerja_router import router as kertas_kerja_router  # [BARU] Endpoint Kertas Kerja Laporan Keuangan
from modules.tax_router import router as tax_router
from modules.tax_case_router import router as tax_case_router
from modules import tax_scheduler
from modules.auth import v1 as auth_v1  # [BARU] Fitur Auth REST API standar: /api/v1/auth/...
from modules.management import documents_v1 as management_documents_v1  # [BARU] /api/v1/management/documents/...
from modules.management import reports_v1 as management_reports_v1  # [BARU] /api/v1/management/reports/...
from modules.assets_and_equity import fixed_assets_v1 as asset_fixed_assets_v1  # [DIPINDAH] /api/v1/asset/... (halaman Assets) -- pindahan apa adanya dari main.py
from modules.finance import bank_cash_exceptions_v1 as finance_bank_cash_exceptions_v1  # [BARU] /api/v1/finance/bank-cash/exceptions (GET|POST|/upsert|/{id} GET/PUT/DELETE) -- catatan penanganan tab Exceptions Cash & Bank
from modules.finance import bank_reconciliation_v1 as finance_bank_reconciliation_v1  # [BARU] /api/v1/finance/bank-reconciliation/suggest|match|auto-match|unmatch|payments|journal-preview
from modules.management import clients_v1 as management_clients_v1  # [BARU] CRUD management_clients: /api/v1/management/clients/...
from modules.management import coa_v1 as management_coa_v1  # [BARU] master COA per klien: /api/v1/management/coa/...
from modules.management import opening_balance_v1 as management_opening_balance_v1  # [BARU] saldo awal COA per tahun buku & cabang: /api/v1/management/opening-balances/...
from modules.management import settings_v1 as management_settings_v1  # [BARU] Management > Settings: /api/v1/management/settings/...
from modules.management import coa_industry_v1 as management_coa_industry_v1  # [BARU] template COA per industri: /api/v1/management/coa-industries
from modules.transactions import sales_v1 as transactions_sales_v1  # [BARU] CRUD financial_transaction_sales_*: /api/v1/transactions/sales/...
from modules.transactions import sales_import_v1 as transactions_sales_import_v1  # [BARU] upload file + ekstraksi otomatis pakai Sales Import Template
from modules.transactions import journal_entry_v1 as transactions_journal_entry_v1  # [BARU] CRUD financial_transaction_journal_entry_*: /api/v1/transactions/journal-entries/...
from modules.transactions import journal_entry_import_v1 as transactions_journal_entry_import_v1  # [BARU] upload file + ekstraksi otomatis pakai Journal Entry Import Template
from modules.transactions import purchase_v1 as transactions_purchase_v1  # [BARU] CRUD financial_transaction_purchase_*: /api/v1/transactions/purchase/...
from modules.transactions import purchase_import_v1 as transactions_purchase_import_v1  # [BARU] upload file + ekstraksi otomatis pakai Purchase Import Template
from modules.financial_statements import v1 as financial_statements_v1  # [BARU] Laporan keuangan dari transaksi posted: /api/v1/financial-statements/...
from modules.financial_statements import general_ledger_v1 as reports_general_ledger_v1  # [BARU] Reports > General Ledger: /api/v1/reports/general-ledger
from modules.financial_statements import statements_v1 as reports_fs_statements_v1  # [BARU] FS berbasis mapping COA: /api/v1/reports/financial-statements/...
from modules.financial_statements import fs_mapping_v1 as management_fs_mapping_v1  # [BARU] master mapping FS per klien: /api/v1/management/fs-mapping
from modules.api_response import gagal as _gagal_v1  # [BARU] amplop response {status,message,data,errors}

# [FIX v5] Konfirmasi eksplisit di terminal, database mana yang BENAR-BENAR
# kepakai saat startup -- supaya "diam-diam jatuh ke sqlite lokal" tidak
# bisa lolos tanpa ketahuan lagi. Password/detail koneksi disensor,
# cukup tunjukkan jenis DB + host-nya saja.
#
# [FIX v6] Kalau DATABASE_URL benar-benar tidak diset, `import db_client
# as dbc` di atas SUDAH raise RuntimeError duluan (lihat get_database_url()
# di db_client.py) -- baris-baris di bawah ini cuma jalan kalau
# DATABASE_URL memang ada isinya (baik itu Postgres/Supabase, ATAU
# sqlite:///... yang SENGAJA diset eksplisit di .env).
_db_url_terpakai = os.environ.get("DATABASE_URL", "")
if _db_url_terpakai.startswith("sqlite"):
    print(f"[DB] Memakai SQLite LOKAL: {_db_url_terpakai}  <-- BUKAN Supabase! Cek .env kalau ini tidak diinginkan.")
else:
    # Contoh: postgresql://postgres:xxxx@host.supabase.co:5432/postgres
    # -> tampilkan cuma bagian setelah "@" (host + db), sensor user:password.
    _bagian_setelah_at = _db_url_terpakai.split("@")[-1] if "@" in _db_url_terpakai else "(format tidak dikenali)"
    print(f"[DB] Memakai Postgres/Supabase, host: {_bagian_setelah_at}")

app = FastAPI(
    title="AI Gouf Consulting API",
    openapi_tags=[
        {
            "name": "auth-v1",
            "description": (
                "REST API standar untuk autentikasi (/api/v1/auth/...): "
                "register (khusus Partner/Admin), login (dapat JWT), dan "
                "profil user yang sedang login. Endpoint selain /login "
                "wajib header `Authorization: Bearer <token>` -- klik "
                "tombol Authorize di atas untuk mengisi token sekali, lalu "
                "otomatis dipakai di semua percobaan endpoint di grup ini."
            ),
        },
        {
            "name": "clients",
            "description": "CRUD daftar client (management_clients) -- dipakai selector client aktif di seluruh halaman.",
        },
        {
            "name": "purchase",
            "description": "Halaman Purchase: vendor, tagihan, source data, line items, exceptions, activity log (schema 3_Financial).",
        },
        {
            "name": "bank-cash",
            "description": "Halaman Bank & Cash: transaksi kas/bank client (finance_transaction_bank_cash, schema 3_Financial).",
        },
        {
            "name": "other",
            "description": "Halaman Other: entri jurnal umum di luar Purchase/Bank & Cash (finance_transaction_other, schema 3_Financial).",
        },
        {
            "name": "ar",
            "description": "Halaman Accounts Receivable: customer, invoice, pembayaran, catatan penagihan (schema 3_Financial).",
        },
        {
            "name": "ap",
            "description": "Halaman Accounts Payable: vendor & bill (dipakai ulang dari modul Purchase) + pembayaran & catatan AP (schema 3_Financial).",
        },
        {
            "name": "overview",
            "description": "Halaman Financial Overview: daftar cabang & Anggaran (Budget) P&L per cabang/bulan (schema 2_Overview).",
        },
        {
            "name": "budget-forecast",
            "description": "Halaman Budget & Forecast: asumsi budget tahunan & skenario custom tersimpan (schema 5_Planning).",
        },
        {
            "name": "tax-compliance",
            "description": "Halaman Tax & Compliance: koreksi fiskal & tugas kepatuhan pajak (fiscal_correction, tax_compliance_task).",
        },
        {
            "name": "audit",
            "description": "Halaman Audit: temuan, bukti (evidence), dan tahapan audit trail (4 tabel Intelligence_Audit_*).",
        },
        {
            "name": "financial-statements",
            "description": "Halaman Financial Statements: Anggaran P&L, insight AI, dan proyeksi cash flow (3 tabel \"financial statement\" schema 3_Financial).",
        },
        {
            "name": "assets",
            "description": "Halaman Assets: register aset tetap & penyusutan (asset_fixed_assets, schema 4_Assets_Equity).",
        },
        {
            "name": "documents",
            "description": "Halaman Documents: metadata dokumen client (management_documents, schema 7_Management).",
        },
        {
            "name": "reports",
            "description": "Halaman Reports: daftar laporan tercatat & jadwal laporan berkala (report_registry, report_schedule, schema 7_Management).",
        },
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        # [BARU] Frontend "Agent AI" sekarang di-port ke dalam Dashboard
        # Next.js (default dev server port 3000), bukan lagi project Vite
        # yang lama (5173/5174) -- tanpa origin ini browser akan menolak
        # semua request dari Dashboard ke backend ini (CORS error di
        # console, walau backend-nya hidup & benar).
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        # [BARU] Dashboard "Gouf Consulting" ini sebenarnya jalan di port
        # 4028 (lihat package.json: "next start -p 4028"), bukan 3000 --
        # ditambahkan supaya browser tidak menolak request LANGSUNG ke
        # backend ini (tanpa lewat proxy rewrites Next.js) dari origin
        # yang sesungguhnya dipakai. Dipakai khusus oleh
        # ImportRekeningKoranModal.tsx untuk upload PDF/Excel besar yang
        # butuh waktu lama diproses -- lihat komentar di modal itu kenapa
        # ia sengaja tidak lewat proxy /api/... Next.js.
        "http://localhost:4028",
        "http://127.0.0.1:4028",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# [BARU] Gerbang autentikasi JWT untuk grup REST API standar /api/v1/**
# (fitur auth baru -- lihat modules/auth_v1.py). Endpoint LAMA (/api/login,
# /api/client, /tax/..., dst) tidak disentuh middleware ini sama sekali,
# tetap jalan seperti sebelumnya lewat Depends(auth.get_current_user)/
# require_level masing-masing.
app.add_middleware(BaseHTTPMiddleware, dispatch=auth_v1.jwt_v1_middleware)


@app.middleware("http")
async def _enforce_client_data_isolation(request: Request, call_next):
    """Security boundary untuk seluruh route /api/client/{client_id}/...

    Development tetap dapat memakai ALLOW_ANONYMOUS_DEV=true. Production
    membutuhkan JWT dan, untuk role selain tahap_5, mapping user_client_access.
    Ini dipasang sebagai middleware supaya endpoint lama maupun baru otomatis
    mendapat perlindungan tanpa harus mengubah struktur setiap route.
    """
    path = request.url.path
    if path.startswith("/api/client/"):
        parts = [x for x in path.split("/") if x]
        # /api/client/<id>/... => parts = [api, client, <id>, ...]
        # [DIPERBAIKI] Sebelumnya cek ini pakai `parts[2].isdigit()` --
        # peninggalan dari zaman client_id masih integer. Semua client_id
        # sekarang UUID (lihat management_clients.id), jadi .isdigit() SELALU
        # False dan blok pengecekan akses di bawah ini TIDAK PERNAH jalan --
        # setiap request ke ~60 endpoint /api/client/{id}/... lolos tanpa
        # user_has_client_access() sama sekali. Diganti jadi: selama ada
        # segmen ke-3 di path (ID apapun bentuknya), selalu jalankan
        # pengecekan -- user_has_client_access() sendiri menerima client_id
        # sebagai string apa adanya (lihat db_client.py), jadi tidak perlu
        # int(...) atau validasi format UUID di sini.
        if len(parts) >= 3 and parts[2]:
            client_id = parts[2]
            user = auth.user_from_authorization_header(request.headers.get("Authorization"))
            if user is None:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "Login diperlukan untuk mengakses data client."},
                    headers={"WWW-Authenticate": "Bearer"},
                )
            if not dbc.user_has_client_access(user.get("id"), client_id, user.get("role")):
                return JSONResponse(
                    status_code=403,
                    content={"detail": "User tidak memiliki akses ke client ini."},
                )
    return await call_next(request)


# [BARU] Normalisasi error ke amplop standar {status,message,data,errors}
# TAPI HANYA untuk path /api/v1/... (fitur auth baru). Endpoint lama tetap
# dapat bentuk error bawaan FastAPI seperti sebelumnya (frontend yang sudah
# ada mem-parsing bentuk lama itu, mengubahnya di luar scope permintaan ini).
@app.exception_handler(RequestValidationError)
async def _validation_exception_handler_v1(request: Request, exc: RequestValidationError):
    if request.url.path.startswith("/api/v1/"):
        return _gagal_v1(message="Data yang dikirim tidak valid.", errors=exc.errors(), status_code=422)
    return await request_validation_exception_handler(request, exc)


@app.exception_handler(StarletteHTTPException)
async def _http_exception_handler_v1(request: Request, exc: StarletteHTTPException):
    if request.url.path.startswith("/api/v1/"):
        return _gagal_v1(message=str(exc.detail), status_code=exc.status_code)
    return await http_exception_handler(request, exc)


FOLDER_HASIL = Path(__file__).parent / "hasil_output"
FOLDER_HASIL.mkdir(exist_ok=True)

# ============================================================
# [BARU -- Point 3] CACHE HASIL GENERATE LAPORAN 18-SHEET
# ============================================================
# Masalah yang diperbaiki: sebelum ini, tiap kali user klik "Generate"
# (baik unduh Excel maupun preview JSON) untuk client+tahun yang SAMA,
# _susun_data_export_18_sheet() menghitung ULANG SEMUANYA dari nol --
# query jurnal ribuan baris, susun lampiran SPT rinci, susun tren
# piutang/utang, dst -- padahal kalau tidak ada data baru masuk sejak
# generate terakhir, hasilnya PASTI SAMA PERSIS.
#
# Cache di sini SENGAJA disimpan per-proses (dict biasa + lock), BUKAN
# lewat file/Redis -- cukup untuk deployment 1 proses uvicorn seperti
# sekarang (lihat catatan cara jalan di kepala file ini). Kalau nanti
# di-scale ke banyak worker/proses, cache ini perlu dipindah ke
# penyimpanan bersama (mis. tabel DB atau Redis) supaya konsisten
# antar proses -- dicatat di sini supaya tidak lupa kalau saatnya tiba.
#
# Validasi cache-hit BUKAN pakai TTL waktu (mis. "cache berlaku 5
# menit") -- itu rawan menyajikan laporan basi kalau kebetulan ada
# upload/koreksi PERSIS di jendela waktu itu. Sebagai gantinya dipakai
# SIGNATURE data (lihat db_client.hitung_signature_data_laporan()):
# hash ringan dari COUNT+MAX(timestamp) jurnal_posting & COA client
# ini. Selama signature-nya SAMA dengan saat hasil terakhir dihitung,
# datanya dijamin belum berubah -- cache aman dipakai berapa lama pun.
_CACHE_EXPORT_18_SHEET: Dict[str, Dict[str, Any]] = {}
_LOCK_CACHE_EXPORT_18_SHEET = threading.Lock()

# Batas jumlah entri cache supaya dict ini tidak tumbuh tanpa henti
# kalau banyak client/tahun berbeda-beda dipakai (memory leak). Entri
# TERLAMA (berdasar waktu terakhir ditulis) dibuang duluan kalau
# kepenuhan -- cukup sebagai pagar kasar, bukan LRU presisi.
_BATAS_ENTRI_CACHE_EXPORT_18_SHEET = 200


app.include_router(tax_router, prefix="/tax", tags=["tax-research"])
app.include_router(tax_case_router, prefix="/tax/cases", tags=["tax-case-law"])
app.include_router(kertas_kerja_router, prefix="/kertas-kerja", tags=["kertas-kerja"])  # [BARU]
app.include_router(auth_v1.router)  # [BARU] /api/v1/auth/register|login|me -- prefix sudah di router-nya sendiri
app.include_router(management_documents_v1.router)  # [BARU] /api/v1/management/documents/... -- prefix sudah di router-nya sendiri
app.include_router(management_reports_v1.router)  # [BARU] /api/v1/management/reports/... -- prefix sudah di router-nya sendiri
app.include_router(asset_fixed_assets_v1.router)  # [DIPINDAH] /api/v1/asset/getFixedAssets|addFixedAsset|updateFixedAsset|disposeFixedAsset
app.include_router(finance_bank_cash_exceptions_v1.router)  # [BARU] /api/v1/finance/bank-cash/exceptions -- prefix sudah di router-nya sendiri
app.include_router(finance_bank_reconciliation_v1.router)  # [BARU] prefix sudah di router-nya sendiri
app.include_router(management_clients_v1.router)  # [BARU] /api/v1/management/clients/... -- prefix sudah di router-nya sendiri
app.include_router(management_coa_v1.router)  # [BARU] /api/v1/management/coa/... -- prefix sudah di router-nya sendiri
app.include_router(management_opening_balance_v1.router)  # [BARU] /api/v1/management/opening-balances/... -- prefix sudah di router-nya sendiri
app.include_router(management_settings_v1.router)  # [BARU] /api/v1/management/settings/users|accountants|purchase|product|account-mapping
app.include_router(management_coa_industry_v1.router)  # [BARU] /api/v1/management/coa-industries -- pilihan Industry + template COA
app.include_router(transactions_sales_v1.router)  # [BARU] /api/v1/transactions/sales/... -- prefix sudah di router-nya sendiri
app.include_router(transactions_sales_import_v1.router)  # [BARU] /api/v1/transactions/sales/source-files/upload
app.include_router(transactions_journal_entry_v1.router)  # [BARU] /api/v1/transactions/journal-entries/... -- prefix sudah di router-nya sendiri
app.include_router(transactions_journal_entry_import_v1.router)  # [BARU] /api/v1/transactions/journal-entries/import/upload
app.include_router(transactions_purchase_v1.router)  # [BARU] /api/v1/transactions/purchase/... -- prefix sudah di router-nya sendiri
app.include_router(transactions_purchase_import_v1.router)  # [BARU] /api/v1/transactions/purchase/import/upload
app.include_router(financial_statements_v1.router)  # [BARU] /api/v1/financial-statements/... -- prefix sudah di router-nya sendiri
app.include_router(reports_general_ledger_v1.router)  # [BARU] /api/v1/reports/general-ledger -- prefix sudah di router-nya sendiri
app.include_router(reports_fs_statements_v1.router)  # [BARU] /api/v1/reports/financial-statements/balance-sheet|profit-loss|changes-in-equity|cash-flow|segments|notes
app.include_router(management_fs_mapping_v1.router)  # [BARU] /api/v1/management/fs-mapping -- mapping FS per klien


@app.on_event("startup")
def _startup_buat_tabel_db():
    # [FIX] init_db() (Base.metadata.create_all) sebelumnya tidak pernah
    # dipanggil di mana pun -- kalau database masih kosong/tabel baru
    # (mis. "percakapan", "pesan_chat") belum ada, semua endpoint yang
    # menyentuhnya akan error. create_all() aman dipanggil berkali-kali:
    # tabel yang sudah ada tidak akan diubah/dihapus.
    try:
        dbc.init_db()
        accounting_core.ensure_seed_data()
    except Exception as e:  # noqa: BLE001
        print(f"[PERINGATAN] Gagal inisialisasi tabel database saat startup: {e}")


# Scheduler latar belakang: pembersihan cache ekstraksi PDF & Office
# (modules/cache_cleanup.py). [DIUBAH 2026-10-04] Job reminder deadline SPT
# dibuang bersama tabel reminder_deadline_spt (migration 23).
_scheduler = BackgroundScheduler(timezone="Asia/Jakarta")


@app.on_event("startup")
def _startup_scheduler_cache():
    try:
        jam_cache = int(os.environ.get("CACHE_CLEANUP_JAM", "3"))
        menit_cache = int(os.environ.get("CACHE_CLEANUP_MENIT", "0"))
        cache_cleanup.daftarkan_job_pembersihan_cache(_scheduler, jam=jam_cache, menit=menit_cache)
        _scheduler.start()
    except Exception as e:  # noqa: BLE001
        print(f"[PERINGATAN] Gagal menyalakan scheduler cache cleanup: {e}")


@app.on_event("shutdown")
def _shutdown_scheduler_cache():
    try:
        _scheduler.shutdown(wait=False)
    except Exception:
        pass


# [BARU] Scheduler tugas latar belakang fitur riset pajak (mis. cek
# ulang peraturan berstatus belum diverifikasi) -- lihat
# modules/tax_scheduler.py. Sebelumnya modul ini sudah ditulis lengkap
# tapi belum pernah dipanggil dari main.py sama sekali, jadi job-nya
# tidak pernah jalan. Dipisah dari _scheduler (reminder SPT) di atas
# karena memang dua scheduler APScheduler yang berbeda tujuan.
@app.on_event("startup")
def _startup_tax_scheduler():
    try:
        tax_scheduler.start_scheduler()
    except Exception as e:  # noqa: BLE001
        print(f"[PERINGATAN] Gagal menyalakan tax scheduler: {e}")


@app.on_event("shutdown")
def _shutdown_tax_scheduler():
    try:
        tax_scheduler.stop_scheduler()
    except Exception:
        pass


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        # [FIX -- JALUR SEMENTARA GROQ] Sebelumnya cuma cek DEEPSEEK_API_KEY,
        # jadi kalau DeepSeek kosong/gagal tapi GROQ_API_KEY aktif (jalur
        # sementara, lihat _konfigurasi_provider_chat() di akuntansi_ai.py),
        # endpoint ini salah lapor ai_aktif=False padahal chat tetap jalan.
        "ai_aktif": bool(ak._konfigurasi_provider_chat()),
        # [DIUBAH -- KATEGORISASI SEPENUHNYA CLAUDE OPUS] Sempat lewat Groq
        # sepenuhnya (Claude & DeepSeek tidak dipakai sama sekali), sekarang
        # dibalik lagi: _konfigurasi_provider_kategorisasi() di akuntansi_ai.py
        # HANYA berisi Claude (model Opus, lihat ambil_model_kategorisasi_claude()),
        # Groq & DeepSeek sudah tidak dipakai sama sekali di jalur kategorisasi.
        # Nilainya true kalau ANTHROPIC_API_KEY terisi.
        "kategorisasi_aktif": bool(ak._konfigurasi_provider_kategorisasi()),
        "database_aktif": dbc.cek_koneksi(),  # [FIX v4] cek cepat Supabase konek atau tidak
    }


@app.post("/api/login")
def login(username: str = Form(...), password: str = Form(...)):
    user = auth.authenticate(username, password)
    if not user:
        raise HTTPException(status_code=401, detail="Username atau password salah.")
    token = auth.buat_token(user)
    return {
        "token": token,
        "username": user["username"],
        "role": user["role"],
        "nama": user.get("nama"),
    }


class ClientSkema(BaseModel):
    """Satu client -- lihat daftar_client(). `dibuat_at`/`jumlah_akun_esb`
    kosong di respons POST (endpoint tambah client tidak mengembalikan
    keduanya, cukup echo data yang baru disimpan)."""
    id: str
    nama: str
    lokasi: Optional[str] = None
    tipe: Optional[str] = None
    nomor_wa: Optional[str] = None
    email: Optional[str] = None
    industry: Optional[str] = None
    status: Optional[str] = None
    assigned_accountant: Optional[str] = None
    contact_name: Optional[str] = None
    npwp: Optional[str] = None
    address: Optional[str] = None
    dibuat_at: Optional[str] = None
    jumlah_akun_esb: Optional[int] = None

class DaftarClientResponse(BaseModel):
    clients: List[ClientSkema]

class HapusClientResponse(BaseModel):
    berhasil: bool


@app.get("/api/client", tags=["clients"], response_model=DaftarClientResponse)
def api_daftar_client(
    tipe: Optional[str] = None,
    punya_esb: Optional[bool] = None,
    user: dict = Depends(auth.require_level(3)), 
):
    """[BARU] Tambah query param `punya_esb` (true/false) untuk filter
    client yang sudah/belum punya integrasi ESB, mis:
        GET /api/client?punya_esb=true   -> client yang sudah ada akun ESB
        GET /api/client?punya_esb=false  -> client yang belum ada akun ESB
    """
    clients = dbc.daftar_client(tipe, punya_esb=punya_esb)
    # tahap_5 & super_admin (lihat RBAC.md) adalah administrator lintas
    # client. Role di bawahnya hanya boleh melihat client yang secara
    # eksplisit diberikan melalui tabel user_client_access. Ini mencegah
    # user menebak client_id atau melihat metadata semua client dari
    # company switcher.
    #
    # [FIX -- crash 500 utk semua role non-admin] client_id SEKARANG UUID
    # (management_clients.id), bukan integer lagi -- `int(...)` di sini
    # akan melempar ValueError utk UUID apapun ("invalid literal for
    # int()"), jadi endpoint ini SELALU 500 utk siapapun yang bukan
    # tahap_5/super_admin. Dibandingkan sebagai string apa adanya.
    if user.get("role") not in ("tahap_5", "super_admin"):
        allowed_ids = {
            str(x["client_id"]) for x in dbc.daftar_user_client_access(str(user.get("id") or ""))
        }
        clients = [c for c in clients if str(c.get("id") or "") in allowed_ids]
    return {"clients": clients}


@app.post("/api/client", tags=["clients"], response_model=ClientSkema)
def api_tambah_client(
    nama: str = Form(...),
    lokasi: Optional[str] = Form(None),
    tipe: str = Form("accounting"),
    # [BARU] nomor_wa/email opsional saat bikin client -- dipakai sistem
    # reminder deadline SPT utk kirim notifikasi WA/email. Bisa juga diisi
    # belakangan lewat PUT /api/client/{client_id}/kontak.
    nomor_wa: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    # [BARU] Field profil dipakai halaman Clients di dashboard (sebelumnya
    # cuma tersimpan di localStorage, sekarang permanen lewat backend).
    industry: Optional[str] = Form(None),
    status: Optional[str] = Form(None),
    assigned_accountant: Optional[str] = Form(None),
    contact_name: Optional[str] = Form(None),
    npwp: Optional[str] = Form(None),
    address: Optional[str] = Form(None),
    user: dict = Depends(auth.require_level(3)),  
):
    client_id = dbc.tambah_client(
        nama, lokasi, tipe, nomor_wa=nomor_wa, email=email,
        industry=industry, status=status, assigned_accountant=assigned_accountant,
        contact_name=contact_name, npwp=npwp, address=address,
    )
    if client_id is None:
        raise HTTPException(status_code=500, detail="Gagal menambah client.")
    if user.get("role") not in ("tahap_5", "super_admin") and user.get("id") is not None:
        # "client_lv_1" (org_owner) = level paling senior di CLIENT_LEVELS
        # (lihat RBAC.md & modules/auth/core.py) -- staf yang bikin client
        # ini otomatis jadi pemegang akses penuh KHUSUS untuk client tsb.
        dbc.set_user_client_access(str(user["id"]), client_id, active=True, access_role="client_lv_1")
    return {
        "id": client_id, "nama": nama, "lokasi": lokasi, "tipe": tipe,
        "nomor_wa": nomor_wa, "email": email, "industry": industry, "status": status,
        "assigned_accountant": assigned_accountant, "contact_name": contact_name,
        "npwp": npwp, "address": address,
    }


class UpdateProfilClientRequest(BaseModel):
    industry: Optional[str] = None
    status: Optional[str] = None
    assigned_accountant: Optional[str] = None
    contact_name: Optional[str] = None
    npwp: Optional[str] = None
    address: Optional[str] = None


@app.put("/api/client/{client_id}/profil")
def api_update_profil_client(
    client_id: str,
    req: UpdateProfilClientRequest,
    user: dict = Depends(auth.require_level(3)),
):
    """Update field profil client (industry/status/assigned_accountant/
    contact_name/npwp/address) -- dipakai halaman Clients di dashboard."""
    berhasil = dbc.update_profil_client(
        client_id, industry=req.industry, status=req.status,
        assigned_accountant=req.assigned_accountant, contact_name=req.contact_name,
        npwp=req.npwp, address=req.address,
    )
    if not berhasil:
        raise HTTPException(status_code=404, detail="Client tidak ditemukan.")
    return {"berhasil": True}


class UpdateKontakClientRequest(BaseModel):
    nomor_wa: Optional[str] = None  # format internasional mis. "6281234567890"
    email: Optional[str] = None


@app.put("/api/client/{client_id}/kontak")
def api_update_kontak_client(
    client_id: str,
    req: UpdateKontakClientRequest,
    user: dict = Depends(auth.require_level(3)),
):
    """Isi/ubah nomor WA & email client -- wajib diisi supaya client ini
    bisa dapat reminder deadline SPT lewat WA (in-app tetap jalan tanpa
    ini, tapi WA tidak akan terkirim kalau nomor_wa kosong)."""
    berhasil = dbc.update_kontak_client(client_id, nomor_wa=req.nomor_wa, email=req.email)
    if not berhasil:
        raise HTTPException(status_code=404, detail="Client tidak ditemukan.")
    return {"berhasil": True}


@app.delete("/api/client/{client_id}", tags=["clients"], response_model=HapusClientResponse)
def api_hapus_client(
    client_id: str,
    user: dict = Depends(auth.require_level(3)),
):
    """[BARU] Hapus client -- dipakai menu titik-3 (Edit/Delete) di
    halaman Clients dashboard. dbc.delete_client() sudah menghapus dulu
    baris 'hasil'/'hasil_esb' terkait supaya tidak melanggar foreign key
    ke 'clients' sebelum baris client-nya sendiri dihapus."""
    berhasil = dbc.delete_client(client_id)
    if not berhasil:
        raise HTTPException(status_code=404, detail="Client tidak ditemukan.")
    return {"berhasil": True}


# ============================================================
# [BARU] AKUN ESB (integrasi API POS/kasir) per client
# ============================================================


@app.get("/api/client/{client_id}/audit-log")
def api_audit_log_client(
    client_id: str,
    limit: int = 200,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [BARU] Audit trail: riwayat siapa-mengubah-apa-kapan untuk 1 client --
    mencakup auto-fix data (aksi="auto_fix_data"), perubahan COA
    (tambah/update/hapus_akun_coa), jawaban klarifikasi, posting/tolak
    jurnal, dan generate laporan keuangan. Diurutkan dari yang terbaru.
    Lihat modules/history.py & db_client.py::log_audit/get_audit_history.
    """
    return {"audit_log": history.ambil_riwayat(client_id=client_id, limit=limit)}


# ============================================================
# [DIPINDAH] MODUL PURCHASE -- kini di modules/finance/purchase_v1.py
# (lihat modules/finance/__init__.py). Router didaftarkan lewat
# app.include_router(finance_purchase_v1.router) di bawah -- path, auth,
# & response TIDAK berubah.
#
# VendorSkema tetap dipakai di modul Accounts Payable (DataAPResponse di
# bawah, Vendor & Bill dipakai ulang dari Purchase) -- di-import dari
# modules.finance.purchase_v1, BUKAN didefinisikan ulang.
# ============================================================


class DocumentSkema(BaseModel):
    id: str
    name: str
    category: Optional[str] = None
    file_format: Optional[str] = None
    file_size: Optional[str] = None
    storage_url: Optional[str] = None
    uploaded_by: Optional[str] = None
    status: Optional[str] = None
    tags: Optional[str] = None
    related_record: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class DataDocumentsResponse(BaseModel):
    documents: List[DocumentSkema]


@app.get("/api/v1/management/getDocuments", tags=["documents"], response_model=DataDocumentsResponse)
def api_data_documents(client_id: str, user: dict = Depends(auth.get_current_user)):
    """
    [DIUBAH] Data mentah tabel Documents (schema "7_Management",
    "management_documents") untuk satu client -- tabel dibuat
    manual oleh user lewat Supabase SQL Editor, sama pola dengan modul
    Purchase. Frontend memetakan hasilnya ke tipe FinancialDocument lewat
    src/app/documents/lib/documentsDbBridge.ts.

    Path diubah dari /api/client/{client_id}/documents ke pola standar
    /api/[version]/[group]/[nama_fitur] -- client_id sekarang lewat query
    string (?client_id=...), bukan path segment, karena pola baru tidak
    menyisakan tempat untuk resource id di path.
    """
    return {"documents": dbc.ambil_data_documents(client_id)}


class ReportRegistryItemSkema(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    category: Optional[str] = None
    period: Optional[str] = None
    created_by: Optional[str] = None
    formats: Optional[str] = None
    status: Optional[str] = None
    file_size: Optional[str] = None
    tags: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None

class ReportRegistryResponse(BaseModel):
    report_registry: List[ReportRegistryItemSkema]


@app.get("/api/client/{client_id}/reports-registry", tags=["reports"], response_model=ReportRegistryResponse)
def api_data_reports_registry(client_id: str, user: dict = Depends(auth.get_current_user)):
    """
    [BARU] Data mentah tabel report_registry (schema "7_Management",
    "management_report_registry") untuk satu client -- laporan yang
    dicatat manual/oleh proses lain, di luar 3 sumber otomatis (Laporan
    Keuangan/CALK/PPh Badan). Digabung ke daftar reports oleh
    src/app/reports/lib/reportsDbBridge.ts.
    """
    return {"report_registry": dbc.ambil_data_report_registry(client_id)}


class ReportScheduleItemSkema(BaseModel):
    id: str
    report_name: str
    frequency: Optional[str] = None
    recipients: Optional[str] = None
    format: Optional[str] = None
    next_run: Optional[str] = None
    status: Optional[str] = None

class ReportScheduleResponse(BaseModel):
    report_schedule: List[ReportScheduleItemSkema]


@app.get("/api/client/{client_id}/report-schedule", tags=["reports"], response_model=ReportScheduleResponse)
def api_data_report_schedule(client_id: str, user: dict = Depends(auth.get_current_user)):
    """
    [BARU] Data mentah tabel report_schedule (schema "7_Management",
    "management_report_schedule") untuk satu client -- jadwal
    laporan berkala (tab "Report Scheduler"). Frontend memetakan hasilnya
    ke tipe ScheduledReport lewat src/app/reports/lib/reportsDbBridge.ts.
    """
    return {"report_schedule": dbc.ambil_data_report_schedule(client_id)}


# ============================================================
# [BARU] MODUL ACCOUNTS PAYABLE -- pola endpoint SAMA persis dengan AR di
# atas. Vendor & bill dipakai ulang dari modul Purchase; payment & note
# adalah 2 tabel baru khusus AP. Lihat db_client.py::ambil_data_ap() dkk.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL BUDGET & FORECAST -- kini di
# modules/planning/budget_forecast_v1.py (lihat modules/planning/__init__.py).
# Router didaftarkan lewat app.include_router(planning_budget_forecast_v1.router)
# di bawah -- path, auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL TAX & COMPLIANCE -- kini di
# modules/planning/tax_compliance_v1.py (lihat modules/planning/__init__.py).
# Router didaftarkan lewat app.include_router(planning_tax_compliance_v1.router)
# di bawah -- path, auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL AUDIT -- kini di modules/intelligence/audit_v1.py
# (lihat modules/intelligence/__init__.py). Router didaftarkan lewat
# app.include_router(intelligence_audit_v1.router) di bawah -- path,
# auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL PURCHASE (lanjutan: update status, bulk update,
# exception status) -- kini di modules/finance/purchase_v1.py (lihat
# modules/finance/__init__.py). Router didaftarkan lewat
# app.include_router(finance_purchase_v1.router) di bawah -- path,
# auth, & response TIDAK berubah.
# ============================================================


@app.get("/api/client/{client_id}/rekonsiliasi-lintas-dokumen")
def api_rekonsiliasi_lintas_dokumen(
    client_id: str,
    npwp_perusahaan: Optional[str] = None,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """[BARU] Rekonsiliasi lintas-dokumen (cross-matching) -- lihat
    modules/cross_matching.py. Menjalankan 3 pencocokan sekaligus dari data
    yang sudah tersimpan utk client ini: Bank vs Piutang, PPN Faktur vs SPT
    Masa PPN, dan Slip Gaji vs Absensi. Semua rule-based (bukan AI
    generatif) -- hasil "TIDAK_KETEMU"/"PERLU_DICEK" tetap wajib direview
    manusia, endpoint ini cuma mempercepat proses cari.

    npwp_perusahaan (opsional): kalau diisi, hanya faktur pajak dengan
    npwp_penjual == ini yang dihitung sbg PPN Keluaran perusahaan.
    """
    hasil = cross_matching.jalankan_rekonsiliasi_lintas_dokumen(
        client_id, dbc, npwp_perusahaan=npwp_perusahaan,
    )
    return _bersihkan_untuk_json(hasil)


class DeteksiKesalahanPembelianRequest(BaseModel):
    checks: List[str] = []  # kosong = jalankan semua 7 pengecekan


@app.post("/api/client/{client_id}/deteksi-kesalahan-pembelian")
def api_deteksi_kesalahan_pembelian(
    client_id: str,
    req: DeteksiKesalahanPembelianRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """[BARU] "Deteksi & pencegahan kesalahan" untuk data Pembelian
    (PO/Invoice) -- lihat modules/deteksi_kesalahan_pembelian.py. 7
    pengecekan rule-based (bukan AI generatif), user pilih salah satu/
    beberapa/semua lewat `checks` (kosong = semua):
      po_invoice, pph23_jasa, harga_tidak_wajar, supplier_baru,
      validasi_tanggal, rekap_supplier, cross_check_ap_aging.
    Hasil "PERLU_DICEK"/"PERLU REVIEW"/"SELISIH" tetap wajib direview
    manusia -- endpoint ini mempercepat proses cari, bukan menggantikan
    keputusan akuntan."""
    hasil = dkp.jalankan_deteksi_kesalahan_pembelian(client_id, dbc, checks=req.checks)
    return _bersihkan_untuk_json(hasil)


# ============================================================
# ANALISIS AI (Claude) -- tabel hasil_analisis
# [UBAH] Sebelumnya DeepSeek -- lihat catatan migrasi di masing-masing
# endpoint di bawah (api_buat_analisis_ai / api_buat_ringkasan_eksekutif).
# ============================================================


# ============================================================
# [BARU] RINGKASAN EKSEKUTIF (#4) -- versi ringkas laporan utk klien
# NON-AKUNTAN, terpisah dari detail teknis. Gabungan kartu angka (dihitung
# langsung dari data tersimpan, GRATIS/real-time) + narasi AI (opsional,
# [UBAH] manggil Claude -- sebelumnya DeepSeek, lihat catatan migrasi di
# api_buat_ringkasan_eksekutif() di bawah -- makanya dipisah jadi endpoint POST sendiri, bukan
# otomatis tiap kali kartu di-load lewat GET). Narasinya disimpan ke tabel
# hasil_analisis yang SAMA dengan analisis-ai di atas lewat
# jenis_analisis="ringkasan_eksekutif", jadi riwayatnya otomatis bisa
# diambil juga lewat GET /api/client/{client_id}/analisis-ai?jenis_analisis=
# ringkasan_eksekutif kalau suatu saat dibutuhkan, tanpa endpoint terpisah.
# ============================================================


# ============================================================
# [BARU] KPI BENTO DASHBOARD (8 kartu utama halaman Dashboard --
# KPIBentoGrid.tsx) -- endpoint ini, GET /api/v1/overview/getBranches, dan
# GET /api/v1/overview/getFinancialBudget SUDAH DIPINDAH ke
# modules/overview/overview_v1.py (router & router_legacy, didaftarkan di
# bawah lewat app.include_router). Logic hitungnya (lapkeu.
# susun_kpi_bento_dashboard) TETAP di modules/laporan_keuangan.py.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL FINANCIAL STATEMENTS -- kini di
# modules/finance/profit_loss_v1.py (getProfitLossBudget,
# getProfitLossInsights) & modules/finance/cash_flow_v1.py
# (getCashFlowForecast). Lihat modules/finance/__init__.py. Router
# didaftarkan lewat app.include_router(finance_profit_loss_v1.router) &
# app.include_router(finance_cash_flow_v1.router) di bawah -- path,
# auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL ASSETS -- Fixed Asset Register & Depreciation, kini
# di modules/asset/fixed_assets_v1.py (lihat modules/asset/__init__.py).
# Router didaftarkan lewat app.include_router(asset_fixed_assets_v1.router)
# di bawah -- path, auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [BARU] RIWAYAT PERCAKAPAN (sidebar chat history, mirip ChatGPT/Claude)
# ============================================================


def _bersihkan_untuk_json(nilai: Any) -> Any:
    if isinstance(nilai, pd.DataFrame):
        return _bersihkan_untuk_json(nilai.to_dict(orient="records"))
    if isinstance(nilai, dict):
        return {str(k): _bersihkan_untuk_json(v) for k, v in nilai.items()}
    if isinstance(nilai, (list, tuple)):
        return [_bersihkan_untuk_json(v) for v in nilai]
    if isinstance(nilai, (pd.Timestamp, datetime, date)):
        return str(nilai)
    if isinstance(nilai, float) and (math.isnan(nilai) or math.isinf(nilai)):
        return None
    if isinstance(nilai, pd.Series):
        return _bersihkan_untuk_json(nilai.tolist())
    try:
        import numpy as np
        if isinstance(nilai, np.generic):
            return nilai.item()
    except ImportError:
        pass
    if pd.isna(nilai) if not isinstance(nilai, (list, dict)) else False:
        return None
    return nilai


def _ada_isi(hasil: dict) -> bool:
    df_hasil = hasil.get("df")
    if df_hasil is not None and not df_hasil.empty:
        return True
    per_sheet = hasil.get("per_sheet")
    if per_sheet:
        return True
    return False


def _buat_excel_hasil(hasil_per_jenis: dict) -> Path:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    for kode, hasil in hasil_per_jenis.items():
        label = _PEMROSES_DOKUMEN.get(kode, (kode, None))[0]

        ws_ringkasan = wb.create_sheet(f"Ringkasan-{kode}"[:31])
        ws_ringkasan.append(["Ringkasan", label])
        for k, v in (hasil.get("ringkasan") or {}).items():
            ws_ringkasan.append([k, str(v)])

        masalah = hasil.get("masalah") or []
        ws_masalah = wb.create_sheet(f"Perlu Review-{kode}"[:31])
        # [FIX] kolom "Rekomendasi" ditambahkan -- proses_aset_tetap() (dan
        # jenis dokumen lain ke depannya) mengisi "rekomendasi" per baris
        # masalah (saran tindakan konkret, bukan cuma alasan), tapi sheet
        # export ini sebelumnya cuma baca "alasan" -- rekomendasinya jadi
        # tidak pernah sampai ke file Excel yang didownload staf/client,
        # padahal itu justru bagian paling berguna buat akuntan.
        ws_masalah.append(["Baris", "Alasan", "Rekomendasi"])
        for m in masalah:
            baris = m.get("baris")
            alasan_gabungan = " | ".join(m.get("alasan", []))
            rekomendasi_gabungan = " | ".join(m.get("rekomendasi", []))
            ws_masalah.append([baris, alasan_gabungan, rekomendasi_gabungan])

        draf = hasil.get("draf_jurnal") or []
        if draf:
            ws_jurnal = wb.create_sheet(f"Draf Jurnal-{kode}"[:31])
            kolom = list(draf[0].keys())
            ws_jurnal.append(kolom)
            for baris_jurnal in draf:
                ws_jurnal.append([str(baris_jurnal.get(k, "")) for k in kolom])

        # [BARU] Sheet tambahan generik -- dibaca kalau proses_xxx() menyediakan
        # key ini di hasil (saat ini baru proses_aset_tetap yang mengisi).
        # Ditulis generik (bukan khusus "if kode == 'aset_tetap'") supaya
        # jenis dokumen lain otomatis ikut ter-export kalau nanti diisi juga.
        rekon_fiskal = hasil.get("rekonsiliasi_fiskal") or []
        if rekon_fiskal:
            ws_fiskal = wb.create_sheet(f"Rekon Fiskal-{kode}"[:31])
            kolom = list(rekon_fiskal[0].keys())
            ws_fiskal.append(kolom)
            for baris_fiskal in rekon_fiskal:
                ws_fiskal.append([str(baris_fiskal.get(k, "")) for k in kolom])

        di_bawah_kapitalisasi = hasil.get("aset_di_bawah_batas_kapitalisasi") or []
        if di_bawah_kapitalisasi:
            ws_kap = wb.create_sheet(f"Batas Kapitalisasi-{kode}"[:31])
            kolom = list(di_bawah_kapitalisasi[0].keys())
            ws_kap.append(kolom)
            for baris_kap in di_bawah_kapitalisasi:
                ws_kap.append([str(baris_kap.get(k, "")) for k in kolom])

    nama_unik = f"{uuid.uuid4().hex}.xlsx"
    path_file = FOLDER_HASIL / nama_unik
    wb.save(path_file)
    return path_file


_PEMROSES_DOKUMEN = {
    # [FIX] 4 jenis baru -- sebelumnya cuma bisa jalan lewat app.py (Streamlit),
    # sekarang dibungkus proses_file_xxx() yang seragam di akuntansi_ai.py
    # supaya bisa dipanggil dari React/n8n lewat FastAPI juga.
    "rekening_koran": ("Rekening Koran / Mutasi Bank (Jurnal Koran)", ak.proses_file_rekening_koran),
    "penjualan": ("Data Penjualan (Invoice & POS/Kasir)", ak.proses_file_penjualan),
    # [BARU] Laporan "Data Penjualan Detail" PDF per-blok transaksi (No
    # Transaksi/Tanggal/Dept./Kode Pel./Nama Pelanggan/Alamat + tabel item
    # + baris Pot./Pajak/Biaya/Total Akhir) -- BEDA dari "penjualan" di
    # atas (yang butuh 1 baris rata per transaksi di sheet Excel/PDF
    # bergrid). Lihat ak._ekstrak_pdf_jual_kasir_berbasis_posisi().
    "jurnal_penjualan_kasir": ("Jurnal Penjualan Kasir (Laporan PDF Kasir/POS per-transaksi)", ak.proses_file_jurnal_penjualan_kasir),
    "penilaian_klien": ("Penilaian Klien/Maker", ak.proses_file_penilaian_klien),
    "buku_bantu_piutang": ("Buku Bantu Piutang (AR)", ak.proses_file_piutang),
    "laporan_keuangan": ("Laporan Keuangan Lengkap (31 Sheet)", ak.proses_file_laporan_keuangan),
    "faktur_pajak": ("Faktur Pajak (PPN)", ak.proses_file_faktur_pajak),
    "bukti_potong_pajak": ("Bukti Potong Pajak (PPh 21/23/4(2))", ak.proses_file_bukti_potong),
    "spt_masa": ("SPT Masa/Tahunan", ak.proses_file_spt),
    "slip_gaji": ("Slip Gaji Karyawan", ak.proses_file_slip_gaji),
    "bukti_kas": ("Bukti Kas Masuk/Keluar", ak.proses_file_bukti_kas),
    "kartu_stok": ("Kartu Stok", ak.proses_file_kartu_stok),
    "aset_tetap": ("Aset Tetap", ak.proses_file_aset_tetap),
    "pembelian": ("Pembelian", ak.proses_file_pembelian),
    "rekonsiliasi_bank": ("Rekonsiliasi Bank", ak.proses_file_rekonsiliasi_bank),
    "ap_aging": ("AP Aging (Utang Jatuh Tempo)", ak.proses_file_ap_aging),
    "absensi": ("Absensi Karyawan", ak.proses_file_absensi),
}


@app.get("/api/jenis-dokumen")
def daftar_jenis_dokumen():
    return {
        "jenis_didukung": [
            {"kode": kode, "label": label} for kode, (label, _fn) in _PEMROSES_DOKUMEN.items()
        ]
    }


@app.post("/api/deteksi-file")
async def deteksi_file(file: UploadFile = File(...), user: dict = Depends(auth.get_current_user)):
    try:
        isi = await file.read()
        buf = io.BytesIO(isi)
        buf.name = file.filename or "upload.xlsx"
        # [FIX -- GAP EVENT LOOP] ak.deteksi_semua_sheet() sync & CPU-bound
        # (parsing openpyxl penuh, bisa ribuan baris) -- dipanggil langsung
        # di sini akan MEMBLOKIR seluruh event loop FastAPI selama proses
        # berjalan, sehingga SEMUA user lain (bukan cuma yang deteksi file
        # ini) ikut menunggu request apa pun ke server. asyncio.to_thread()
        # melempar eksekusinya ke thread pool terpisah supaya event loop
        # tetap bebas melayani request lain. Pola identik dgn
        # /api/ai-baca-file (lihat modules/ai_file_reader.py).
        hasil = await asyncio.to_thread(ak.deteksi_semua_sheet, buf, file.filename or "upload.xlsx")
        return {"nama_file": file.filename, "terdeteksi": _bersihkan_untuk_json(hasil)}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gagal mendeteksi file: {e}") from e


# ============================================================
# [BARU] AI FILE READER -- kirim file (teks/gambar/PDF) LANGSUNG ke Claude
# API, tanpa parsing manual (pdfplumber/pytesseract/dll) di sisi backend.
# Lihat modules/ai_file_reader.py untuk detail & batasan (ukuran file,
# format didukung). Endpoint ini TERPISAH dari pipeline akuntansi_ai.py/
# kertas_kerja.py yang sudah ada -- tidak menggantikan atau mengubah
# apa pun di pipeline itu, murni fitur baru berdiri sendiri.
# ============================================================


def _cek_content_length_awal(request: Request) -> None:
    """
    [BARU] Pagar PERTAMA sebelum `await file.read()`/`await f.read()`
    dipanggil -- baca header `Content-Length` (ukuran TOTAL body request,
    termasuk overhead multipart/boundary utk endpoint banyak-file) dan
    tolak SEGERA (413) kalau sudah jelas jauh melebihi limit terbesar
    yang kita punya (lihat ai_file_reader.MAX_UPLOAD_BYTES_PRACHECK) --
    TANPA membaca body request ke memory sama sekali.

    Ini BUKAN pengganti validasi per-file yang sudah ada (_validasi_pdf/
    _validasi_gambar/_validasi_office di ai_file_reader.py, yang jalan
    SETELAH tipe file diketahui & isinya sudah di-read) -- itu tetap jalan
    seperti biasa & lebih presisi (per jenis file). Ini cuma penjaga awal
    murah utk kasus upload yang SUDAH PASTI kelewat besar (mis. client
    salah pilih file 500MB) -- tanpa pagar ini, server tetap akan
    membaca 500MB itu penuh ke memory dulu sebelum akhirnya menolak,
    yang boros & rawan dipakai utk isi memory server (bentuk DoS ringan)
    kalau banyak upload besar dikirim bersamaan.

    Kalau header Content-Length tidak ada (klien tidak mengirimnya, atau
    pakai chunked transfer) -- SENGAJA dilewati (bukan ditolak), karena
    tidak semua klien HTTP mengirim header ini; validasi presisi per-file
    setelah baca tetap jadi penjaga akhir yang sebenarnya.
    """
    content_length = request.headers.get("content-length")
    if content_length is None:
        return
    try:
        ukuran = int(content_length)
    except ValueError:
        return
    if ukuran > ai_file_reader.MAX_UPLOAD_BYTES_PRACHECK:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Ukuran upload ({ukuran / (1024*1024):.1f} MB) melebihi batas "
                f"{ai_file_reader.MAX_UPLOAD_BYTES_PRACHECK // (1024*1024)} MB -- "
                "ditolak sebelum file dibaca ke memory. Pecah file jadi beberapa "
                "bagian lebih kecil."
            ),
        )

@app.post("/api/ai-baca-file")
async def api_ai_baca_file(
    request: Request,
    file: UploadFile = File(...),
    pertanyaan: str = Form(...),
    user: dict = Depends(auth.get_current_user),
):
    """
    [BARU] Upload 1 file (teks: .md/.txt/.csv/.json/.html, gambar:
    .png/.jpg/.jpeg/.gif/.webp, PDF: .pdf, atau Office: .xlsx/.xlsm/.docx/
    .xls/.doc -- lihat modules/ai_file_reader.py) + pertanyaan bebas.
    Untuk teks/gambar/PDF: file diteruskan APA ADANYA ke Claude API (base64
    utk gambar/PDF, teks polos utk teks), Claude yang membaca langsung.
    Untuk Office (xlsx/xlsm/docx/xls/doc): file TIDAK bisa dikirim mentah
    ke Claude API (bukan format yang didukung), jadi diparsing dulu secara
    LOKAL (openpyxl/python-docx utk format modern, xlrd/textract utk .xls/
    .doc lama) -- hasil ekstraksinya (bukan file binernya) yang dikirim ke
    Claude. Hasil parsing Office di-cache di disk per hash isi file, jadi
    upload ulang file yang sama tidak diparsing dari nol lagi.

    Args (multipart/form-data):
        file: 1 file, maks ukuran mengikuti batas Anthropic API (PDF
            32MB/100 halaman, gambar 5MB) utk teks/gambar/PDF, atau limit
            kita sendiri 50MB utk file Office (lihat modules/ai_file_reader.py).
        pertanyaan: instruksi bebas, mis. "Ekstrak semua transaksi jadi
            tabel" atau "Ringkas dokumen ini".

    Returns JSON: {"nama_file": str, "jawaban": str}

    Error:
        400 kalau tipe file tidak didukung (lihat
            ai_file_reader.deteksi_tipe_file).
        500 kalau panggilan ke Claude API gagal (mis. API key belum
            diset, rate limit, network error).
    """
    nama_file = file.filename or "upload"
    _cek_content_length_awal(request)
    isi = await file.read()

    tipe = ai_file_reader.deteksi_tipe_file(nama_file)
    if tipe == "tidak_didukung":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Tipe file '{Path(nama_file).suffix}' tidak didukung oleh AI File Reader. "
                "Didukung: .md/.txt/.csv/.json/.html (teks), "
                ".png/.jpg/.jpeg/.gif/.webp (gambar), .pdf (dokumen), "
                ".xlsx/.xlsm/.docx/.pptx (Office modern), .xls/.doc (Office lama)."
            ),
        )

    try:
        # [FIX -- GAP EVENT LOOP] kirim_file_ke_ai() SYNC & CPU/network-bound
        # (parsing openpyxl/pandas + panggilan blocking ke Anthropic API) --
        # dipanggil langsung di sini akan MEMBLOKIR seluruh event loop
        # FastAPI selama proses berjalan, sehingga SEMUA user lain (bukan
        # cuma yang upload file) ikut menunggu request apa pun ke server.
        # asyncio.to_thread() melempar eksekusinya ke thread pool terpisah
        # supaya event loop tetap bebas melayani request lain secara
        # bersamaan. Exception dari dalam fungsi tetap diteruskan apa
        # adanya (ValueError/RuntimeError/dll) sehingga blok except di
        # bawah ini tidak perlu berubah.
        jawaban = await asyncio.to_thread(
            ai_file_reader.kirim_file_ke_ai, isi, nama_file, pertanyaan
        )
    except ValueError as e:
        # [FIX -- GAP] File melanggar limit resmi Claude API (PDF >32MB/
        # >100 halaman, gambar >5MB) -- ini kesalahan INPUT user, bukan
        # error server, jadi 400 dengan pesan jelas (lihat validasi di
        # ai_file_reader._validasi_pdf/_validasi_gambar), bukan 500 generik.
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # ANTHROPIC_API_KEY belum diset -- lihat _ambil_client() di ai_file_reader.py
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:  # noqa: BLE001 -- mis. error dari Anthropic API (rate limit, dll)
        raise HTTPException(status_code=500, detail=f"Gagal memproses file lewat AI: {e}")

    return {"nama_file": nama_file, "jawaban": jawaban}


# [BARU] Versi STREAMING dari /api/ai-baca-file -- jawaban dikirim
# bertahap (potongan teks) begitu diterima dari Claude API, bukan
# ditunggu sampai selesai penuh baru dikembalikan sekaligus. Berguna
# utk pertanyaan panjang/kompleks di atas file besar, supaya UI bisa
# menampilkan progress "mengetik" (mirip Claude AI sendiri) daripada
# spinner diam yang bisa terasa lama tanpa kepastian.
@app.post("/api/ai-baca-file-stream")
async def api_ai_baca_file_stream(
    request: Request,
    file: UploadFile = File(...),
    pertanyaan: str = Form(...),
    user: dict = Depends(auth.get_current_user),
):
    """
    Sama seperti /api/ai-baca-file (format file didukung sama persis),
    tapi response berupa STREAM teks polos (`text/plain`, chunked) --
    frontend baca `response.body` sebagai ReadableStream & tampilkan tiap
    potongan begitu tiba, bukan `await response.json()` yang nunggu
    semuanya kelar.

    [PENTING -- urutan validasi] Ekstraksi file (kalau Office) & validasi
    ukuran/tipe file dilakukan DI SINI, SEBELUM StreamingResponse dibuka --
    lihat catatan di ai_file_reader.siapkan_konten_pesan_dari_file(). Ini
    supaya file tidak valid tetap balik HTTPException 400/500 yang benar
    (bukan status 200 yang sudah kadung terkirim lalu stream putus di
    tengah tanpa status code yang masuk akal).

    Errors:
        400 kalau tipe file tidak didukung / melanggar limit ukuran.
        413 kalau Content-Length request sudah jelas kelewat besar
            (lihat _cek_content_length_awal) -- ditolak sebelum file
            dibaca ke memory sama sekali.
        500 kalau API key belum diset. Error yang terjadi SETELAH stream
            mulai jalan (rate limit/overload di tengah) TIDAK bisa lagi
            jadi HTTPException (status 200 sudah terkirim) -- stream akan
            terhenti begitu saja; frontend yang harus deteksi ini (sama
            pola dgn KertasKerjaPage.jsx: "stream berakhir tanpa selesai"
            -> tampilkan pesan error, minta coba lagi).
    """
    nama_file = file.filename or "upload"
    _cek_content_length_awal(request)
    isi = await file.read()

    tipe = ai_file_reader.deteksi_tipe_file(nama_file)
    if tipe == "tidak_didukung":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Tipe file '{Path(nama_file).suffix}' tidak didukung oleh AI File Reader. "
                "Didukung: .md/.txt/.csv/.json/.html (teks), "
                ".png/.jpg/.jpeg/.gif/.webp (gambar), .pdf (dokumen), "
                ".xlsx/.xlsm/.docx/.pptx (Office modern), .xls/.doc (Office lama)."
            ),
        )

    try:
        # [PENTING] Disiapkan (termasuk ekstraksi Office & validasi ukuran)
        # SEBELUM StreamingResponse dibuka -- lihat docstring di atas.
        # [FIX -- GAP EVENT LOOP] sama seperti /api/ai-baca-file: ini fungsi
        # sync CPU-bound (openpyxl/python-docx/pandas) -- dilempar ke
        # thread pool via asyncio.to_thread() supaya tidak memblokir event
        # loop selama parsing file Office besar berlangsung.
        content = await asyncio.to_thread(
            ai_file_reader.siapkan_konten_pesan_dari_file, isi, nama_file, pertanyaan
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        # mis. library python-pptx/xlrd/textract belum terinstall
        raise HTTPException(status_code=500, detail=str(e))

    def _generator_teks():
        try:
            # [FIX -- SEMENTARA] Routing Claude/Groq sekarang otomatis
            # berdasar tipe `content` (string vs list) di dalam
            # kirim_file_ke_ai_stream itu sendiri -- lihat docstring-nya.
            yield from ai_file_reader.kirim_file_ke_ai_stream(content)
        except Exception as e:  # noqa: BLE001 -- lihat catatan error di docstring
            ai_file_reader.logger.error(f"❌ Stream ai-baca-file terhenti di tengah untuk '{nama_file}': {e}")
            # Tetap yield pesan error sebagai teks biasa di akhir stream --
            # lebih baik daripada koneksi terputus tanpa penjelasan sama
            # sekali (frontend tetap bisa tampilkan potongan ini ke user).
            yield f"\n\n[Terputus: {e}]"

    return StreamingResponse(_generator_teks(), media_type="text/plain; charset=utf-8")


# [BARU] Versi banyak file dalam 1 pertanyaan (mis. "bandingkan file A dan
# B", "rekap semua rekening koran ini") -- lihat
# ai_file_reader.kirim_banyak_file_ke_ai untuk alasan & batasan lengkap
# (limit gambar per request, limit payload gabungan 32MB).
@app.post("/api/ai-baca-banyak-file")
async def api_ai_baca_banyak_file(
    request: Request,
    files: List[UploadFile] = File(...),
    pertanyaan: str = Form(...),
    user: dict = Depends(auth.get_current_user),
):
    """
    Upload BEBERAPA file (boleh campur teks/gambar/PDF/Office) + 1
    pertanyaan yang berlaku untuk semua file itu sekaligus -- berguna
    untuk kasus lintas-file yang tidak bisa dijawab dari 1 file saja
    (mis. "file mana yang datanya beda dengan yang lain", "gabungkan
    semua transaksi berikut", "bandingkan sheet penjualan bulan ini vs
    bulan lalu"). File Office (xlsx/xlsm/docx/xls/doc) diparsing lokal
    dulu (sama seperti /api/ai-baca-file, hasilnya di-cache) -- hasil
    ekstraksinya digabung ke prompt teks bareng file teks lain.

    Returns JSON: {"nama_file": [str, ...], "jawaban": str}

    Error:
        400 kalau ada file dengan tipe tidak didukung, atau ukuran/jumlah
            file melanggar limit Claude API (lihat
            ai_file_reader.kirim_banyak_file_ke_ai).
        500 kalau panggilan ke Claude API gagal.
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diupload.")

    _cek_content_length_awal(request)

    daftar_file: List[Tuple[bytes, str]] = []
    for f in files:
        nama_file = f.filename or "upload"
        isi = await f.read()
        daftar_file.append((isi, nama_file))

    try:
        # [FIX -- GAP EVENT LOOP] sama alasannya dgn /api/ai-baca-file:
        # kirim_banyak_file_ke_ai() sync, di dalamnya ada ThreadPoolExecutor
        # sendiri utk paralel ANTAR file -- tapi pemanggilan fungsi ini
        # SENDIRI ke thread tsb tetap BLOCKING dari sudut pandang event
        # loop (thread pemanggil menunggu executor.map selesai). to_thread()
        # di sini melempar seluruh pekerjaan (termasuk nunggu ThreadPoolExecutor
        # internal) ke luar event loop.
        jawaban = await asyncio.to_thread(
            ai_file_reader.kirim_banyak_file_ke_ai, daftar_file, pertanyaan
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gagal memproses file lewat AI: {e}")

    return {"nama_file": [nama for _, nama in daftar_file], "jawaban": jawaban}


# [FIX] Kode jenis dokumen yang fungsinya mendukung pembelajaran pola
# per-client (client_id diteruskan supaya pola tersimpan terpisah per client,
# bukan tercampur jadi satu pola global).
_JENIS_DENGAN_POLA_PER_CLIENT = {"rekening_koran", "penjualan", "jurnal_penjualan_kasir"}

# [BARU] Nama dasar file pola per jenis dokumen (dipakai ak._path_pola()) --
# sama persis dengan yang dipakai di dalam ak.proses_file_rekening_koran /
# ak.proses_file_penjualan, supaya alert anomali di bawah membaca pola yang
# BARU SAJA dipelajari & disimpan dari upload file ini.
_POLA_PER_JENIS = {
    "rekening_koran": "pola_bank",
    "penjualan": "pola_penjualan",
    # [BARU] terpisah dari "pola_penjualan" -- lihat catatan di
    # ak.proses_file_jurnal_penjualan_kasir() kenapa pola-nya tidak
    # digabung dengan proses_file_penjualan biasa.
    "jurnal_penjualan_kasir": "pola_penjualan_kasir",
}


def _proses_semua_jenis(
    isi: bytes,
    nama_file: str,
    jenis_dokumen: Optional[str],
    client_id: Optional[str] = None,
    on_progress: Optional[Callable[..., None]] = None,
    pakai_ai: bool = True,
):
    """
    [FIX] Tambah parameter on_progress opsional (default None) -- dipanggil
    tiap kali satu jenis dokumen SELESAI dicoba (berhasil/gagal/dilewati),
    dengan signature on_progress(kode, label, status, **extra). Dipakai
    oleh /api/proses-file/stream utk kirim event SSE per jenis dokumen;
    pemanggil lama (/api/proses-file, /api/proses-dan-buat-excel) tidak
    perlu berubah sama sekali krn default-nya None (tidak melapor apa-apa,
    perilaku identik dengan sebelum fitur ini ada).
    """
    def _lapor(kode, label, status, **extra):
        if on_progress is not None:
            try:
                on_progress(kode, label, status, **extra)
            except Exception as e:  # noqa: BLE001
                # Progress reporting TIDAK BOLEH menggagalkan pemrosesan
                # file itu sendiri -- kalau gagal lapor progress, cukup
                # dicatat di terminal, jangan sampai melempar exception ke
                # atas dan membatalkan proses file yg sedang berjalan.
                print(f"[PERINGATAN] Gagal lapor progress ({kode}): {e}")

    def _buat_buffer():
        b = io.BytesIO(isi)
        b.name = nama_file
        return b

    def _panggil(fungsi, kode):
        if kode == "jurnal_penjualan_kasir":
            # [BARU] PDF laporan kasir tidak pernah punya sheet COA sendiri
            # di dalam filenya (beda dari rekening_koran/penjualan yang
            # bisa terima Excel dgn sheet COA terpisah) -- COA permanen
            # client dari DB diteruskan di sini supaya akun Kas/Piutang/
            # Penjualan bisa dikenali dari kata kunci COA yang sesungguhnya,
            # bukan selalu jatuh ke label generik. client_id=None (proses
            # tanpa konteks client) -> df_coa_client kosong, fungsi tetap
            # jalan (fallback label generik / AI kalau pakai_ai=True).
            # [DIUBAH 2026-10-04] Tabel `coa` legacy sudah di-drop (migration
            # 23) -- df_coa_client selalu None, fungsi pakai fallback-nya.
            df_coa_client = None
            return fungsi(
                _buat_buffer(), nama_file, client_id=client_id, pakai_ai=pakai_ai,
                df_coa_client=df_coa_client,
            )
        if kode in _JENIS_DENGAN_POLA_PER_CLIENT:
            # [BARU] pakai_ai diteruskan ke rekening_koran & penjualan --
            # dua-duanya sama-sama terima kwarg ini (lihat
            # ak.proses_file_rekening_koran / ak.proses_file_penjualan).
            return fungsi(_buat_buffer(), nama_file, client_id=client_id, pakai_ai=pakai_ai)
        if kode == "slip_gaji":
            # [FIX] Sebelumnya histori_gaji_sebelumnya/histori_gaji_terbaru
            # (utk deteksi anomali gaji ANTAR-PERIODE lintas upload bulan
            # berbeda -- lihat docstring ak.proses_slip_gaji()) tidak pernah
            # disambungkan di sini, jadi anomali antar-bulan hanya kedeteksi
            # kalau semua bulan kebetulan ada dalam SATU file/upload yang
            # sama. Sekarang histori per-client dibaca sebelum proses, lalu
            # digabung & disimpan lagi setelah proses -- persis pola yang
            # sudah dipakai utk pola_bank/pola_penjualan di atas. Kalau
            # client_id None (mis. proses tanpa konteks client), histori
            # jatuh ke file global bersama (ak._path_pola sudah handle ini),
            # tetap tidak error, cuma tidak per-client.
            path_histori = ak._path_pola("histori_gaji", client_id)
            histori_lama = ak.muat_histori_gaji(path_histori)
            hasil = fungsi(_buat_buffer(), nama_file, histori_gaji_sebelumnya=histori_lama or None)
            histori_baru = hasil.get("histori_gaji_terbaru") or {}
            if histori_baru:
                # Gabung (bukan timpa total) -- karyawan yang TIDAK ada di
                # file bulan ini (mis. resign/belum digaji bulan ini) tetap
                # mempertahankan histori terakhirnya, bukan hilang.
                histori_gabungan = {**histori_lama, **histori_baru}
                try:
                    ak.simpan_histori_gaji(histori_gabungan, path_histori)
                except OSError as e:  # noqa: BLE001
                    # Kegagalan simpan histori TIDAK BOLEH menggagalkan hasil
                    # proses slip gaji yang sudah berhasil dihitung -- cukup
                    # dicatat, anomali antar-periode bulan depan saja yang
                    # kena dampak (reset), bukan proses upload ini.
                    print(f"[PERINGATAN] Gagal simpan histori gaji ke {path_histori}: {e}")
            return hasil
        return fungsi(_buat_buffer(), nama_file)

    hasil_semua: dict = {}
    error_per_jenis: dict = {}

    if jenis_dokumen:
        if jenis_dokumen not in _PEMROSES_DOKUMEN:
            raise HTTPException(
                status_code=400,
                detail=f"jenis_dokumen '{jenis_dokumen}' tidak dikenali. "
                       f"Lihat /api/jenis-dokumen untuk daftar yang valid.",
            )
        label, fungsi = _PEMROSES_DOKUMEN[jenis_dokumen]
        _lapor(jenis_dokumen, label, "processing")
        try:
            hasil_semua[jenis_dokumen] = _panggil(fungsi, jenis_dokumen)
            _lapor(jenis_dokumen, label, "done")
        except Exception as e:  # noqa: BLE001
            _lapor(jenis_dokumen, label, "error", pesan=str(e))
            raise HTTPException(
                status_code=500, detail=f"Gagal memproses sebagai {label}: {e}"
            ) from e
    else:
        for kode, (label, fungsi) in _PEMROSES_DOKUMEN.items():
            _lapor(kode, label, "processing")
            try:
                hasil = _panggil(fungsi, kode)
                if _ada_isi(hasil):
                    hasil_semua[kode] = hasil
                    _lapor(kode, label, "done")
                else:
                    _lapor(kode, label, "skip")
            except Exception as e:  # noqa: BLE001
                error_per_jenis[kode] = f"{type(e).__name__}: {e}"
                _lapor(kode, label, "skip", pesan=str(e))

    return hasil_semua, error_per_jenis


def _proses_dan_simpan_satu_file(
    isi: bytes,
    nama_file: str,
    jenis_dokumen: Optional[str],
    client_id: Optional[str],
    conv_id: Optional[str],
    esb_account_id: Optional[int],
    konfirmasi_duplikat: bool,
    user: dict,
    pakai_ai: bool = True,
) -> dict:
    """
    Parse satu file (_proses_semua_jenis) lalu kembalikan hasilnya.

    [DIUBAH 2026-10-04 -- migrations/23-drop_legacy_and_finance_tables.py]
    Penyimpanan ke tabel legacy (hasil/hasil_esb, jurnal_posting,
    upload_batches, voucher_counter) sudah dibuang bersama tabelnya --
    fungsi ini sekarang TANPA DATABASE. Nama & parameter dipertahankan
    supaya caller tidak berubah; client_id/conv_id/esb_account_id/
    konfirmasi_duplikat/user tidak dipakai lagi.
    """
    hasil_semua, error_per_jenis = _proses_semua_jenis(isi, nama_file, jenis_dokumen, client_id=None, pakai_ai=pakai_ai)
    if not hasil_semua:
        return {
            "nama_file": nama_file,
            "hasil": {},
            "tidak_terdeteksi": True,
            "pesan": "Tidak ada jenis dokumen yang dikenali di file ini.",
            "detail_error": error_per_jenis or None,
        }
    return {
        "nama_file": nama_file,
        "hasil": _bersihkan_untuk_json(hasil_semua),
        "tidak_terdeteksi": False,
        "peringatan_voucher": None,
        "deteksi_duplikat": None,
    }


@app.post("/api/proses-file")
async def proses_file(
    file: UploadFile = File(...),
    # [FIX] Sebelumnya jenis_dokumen/client_id/conv_id/esb_account_id
    # dideklarasikan sebagai default biasa (Optional[str] = None), yang
    # membuat FastAPI menganggapnya QUERY PARAMETER (?client_id=1&...),
    # BUKAN bagian dari form-data multipart. Padahal frontend React kirim
    # semua field ini lewat FormData.append(...) bersamaan dgn file-nya --
    # akibatnya field-field ini tidak pernah kebaca oleh backend (selalu
    # None), dan kalau frontend mewajibkan salah satunya, request malah
    # bisa gagal total dengan 422 Unprocessable Entity tanpa pesan jelas
    # di UI ("tidak menampilkan apa-apa"). Form(None) memaksa FastAPI
    # membaca field ini dari body form-data yang sama dengan file.
    jenis_dokumen: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    conv_id: Optional[str] = Form(None),
    esb_account_id: Optional[int] = Form(None),
    # [BARU - dedup upload] Kalau True, akuntan SUDAH melihat
    # peringatan duplikat/revisi (dari respons upload sebelumnya
    # yang punya konfirmasi_diperlukan=True) dan memilih tetap
    # LANJUTKAN SEMUA baris apa adanya. Default False -- upload
    # normal (tanpa duplikat) tidak terpengaruh sama sekali.
    konfirmasi_duplikat: bool = Form(False),
    # [BARU] Toggle kategorisasi AI (Claude/Groq) untuk baris yang tidak
    # kecocokan pola historis maupun kata kunci COA. Default True (perilaku
    # lama, tidak berubah untuk pemanggil yang sudah ada). Kalau False,
    # baris begitu langsung ditandai "Belum Terkategori - perlu review
    # manual" TANPA memanggil API AI sama sekali -- berguna untuk instalasi
    # yang sengaja tidak mau bergantung ke API key pihak ketiga, atau untuk
    # upload besar supaya tidak menunggu lama/timeout menunggu banyak
    # panggilan AI berurutan (lihat _panggil_kategorisasi_dengan_fallback).
    pakai_ai: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    isi = await file.read()
    nama_file = file.filename or "upload.xlsx"
    # [BARU] Sebelumnya endpoint ini TIDAK membungkus exception apa pun --
    # kalau _proses_dan_simpan_satu_file() gagal di tengah jalan (mis. PDF
    # rekening koran yang gagal diparsing pdfplumber, error dari DB, dll),
    # FastAPI membalas 500 KOSONG tanpa body JSON, sehingga frontend
    # (ImportRekeningKoranModal.tsx: `detail.detail || 'Server membalas
    # status 500'`) cuma bisa tampilkan pesan generik itu -- pesan error
    # ASLI (kenapa gagalnya) hilang, cuma ada di log server. Sekarang
    # dibungkus try/except yang sama polanya dengan endpoint lain
    # (/api/deteksi-file dkk di atas) supaya pesan errornya ikut terkirim
    # ke UI lewat field `detail`.
    try:
        # [FIX -- GAP EVENT LOOP] _proses_dan_simpan_satu_file() sync & berat
        # (parsing penuh + beberapa write ke DB) -- lihat catatan identik di
        # /api/deteksi-file di atas. Dibungkus asyncio.to_thread supaya tidak
        # memblokir event loop -- endpoint ini yang PALING SERING dipakai utk
        # upload harian, jadi paling penting dibenerin duluan.
        return await asyncio.to_thread(
            _proses_dan_simpan_satu_file,
            isi, nama_file, jenis_dokumen, client_id, conv_id, esb_account_id,
            konfirmasi_duplikat, user, pakai_ai,
        )
    except HTTPException:
        raise
    except Exception as e:
        # [FIX] main.py tidak punya `logger` module-level (pola logging di
        # sini pakai `print`, lihat contoh lain di _proses_dan_simpan_satu_file
        # di atas) -- pakai logger.exception() di sini akan NameError.
        print(f"[ERROR] Gagal memproses file '{nama_file}' di /api/proses-file: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal memproses file: {e}")


# ============================================================
# [BARU] UPLOAD BANYAK FILE SEKALIGUS (BATCH)
# ============================================================
# Beda dari /api/proses-file (1 file): endpoint ini terima BEBERAPA file
# dalam satu request, lalu:
#   1. TAHAP DETEKSI -- tiap file discan dulu (ak.deteksi_semua_sheet(),
#      TANPA efek samping/simpan apa pun) supaya tahu jenis dokumen apa
#      yang ada di masing-masing file SEBELUM memutuskan apa-apa.
#   2. TAHAP RENCANA -- dari hasil deteksi semua file, disusun urutan
#      pemrosesan (data referensi/master seperti Aset Tetap & Piutang/
#      Utang lebih dulu, baru transaksi seperti Rekening Koran/Penjualan
#      yang bisa dicocokkan ke data referensi itu) + catatan kalau ada
#      jenis dokumen yang sama muncul di lebih dari 1 file (potensi
#      duplikat/revisi -- akuntan perlu tahu sebelum lanjut).
#   3. TAHAP EKSEKUSI -- file diproses satu-satu SESUAI URUTAN RENCANA
#      lewat _proses_dan_simpan_satu_file() (logic yang sama dengan
#      /api/proses-file, jadi hasil per file 100% konsisten) -- satu file
#      gagal TIDAK menggagalkan file lain dalam batch yang sama.
#   4. LINTAS FILE -- kalau batch ini menghasilkan Rekening Koran DAN
#      Buku Bantu Piutang sekaligus, otomatis dicocokkan
#      (cross_matching.cocokkan_bank_piutang) supaya penerimaan di bank
#      langsung ditautkan ke invoice yang sesuai, tanpa akuntan harus
#      upload ulang atau minta manual.

_URUTAN_PRIORITAS_JENIS = {
    # Angka lebih kecil = diproses lebih dulu. Data referensi/master
    # (belum tentu butuh dicocokkan ke apa pun) didahulukan; data
    # transaksional yang PALING diuntungkan oleh cross-matching
    # (rekening_koran <-> piutang) diletakkan paling akhir supaya semua
    # kandidat pencocokannya sudah tersimpan lebih dulu.
    "aset_tetap": 0,
    "buku_bantu_piutang": 1,
    "ap_aging": 1,
    "pembelian": 2,
    "penjualan": 3,
    "rekening_koran": 4,
}


def _susun_rencana_batch(deteksi_per_file: List[dict]) -> List[dict]:
    """
    deteksi_per_file: [{"nama_file": str, "sheets": list-hasil-deteksi_semua_sheet}]
    Return: list langkah terurut siap dieksekusi:
        [{"urutan": int, "nama_file": str, "jenis_terdeteksi": [kode, ...],
          "alasan": str}]
    plus catatan jenis yang muncul di >1 file (potensi duplikat).
    """
    kemunculan_jenis: Dict[str, List[str]] = {}
    langkah = []
    for entri in deteksi_per_file:
        jenis_di_file = sorted({
            s["kode"] for s in entri["sheets"]
            if s.get("kode") and s.get("sudah_ada_parser")
        })
        for kode in jenis_di_file:
            kemunculan_jenis.setdefault(kode, []).append(entri["nama_file"])
        if not jenis_di_file:
            alasan = "Tidak ada sheet yang dikenali/punya parser -- akan dilewati saat eksekusi."
        else:
            label_list = ", ".join(jenis_di_file)
            alasan = f"Terdeteksi sebagai: {label_list}."
        prioritas = min((_URUTAN_PRIORITAS_JENIS.get(k, 99) for k in jenis_di_file), default=99)
        langkah.append({
            "nama_file": entri["nama_file"],
            "jenis_terdeteksi": jenis_di_file,
            "alasan": alasan,
            "_prioritas": prioritas,
        })

    langkah.sort(key=lambda x: x["_prioritas"])
    for i, l in enumerate(langkah, 1):
        l["urutan"] = i
        del l["_prioritas"]

    duplikat_lintas_file = {
        kode: files for kode, files in kemunculan_jenis.items() if len(files) > 1
    }
    if duplikat_lintas_file:
        for l in langkah:
            for kode in l["jenis_terdeteksi"]:
                if kode in duplikat_lintas_file:
                    l["alasan"] += (
                        f" PERHATIAN: jenis '{kode}' juga ada di file lain dalam batch ini "
                        f"({', '.join(f for f in duplikat_lintas_file[kode] if f != l['nama_file'])}) "
                        f"-- cek apakah ini duplikat/revisi sebelum konfirmasi."
                    )
    return langkah


def _tahun_dari_draf_jurnal_list(daftar_draf_jurnal) -> set:
    """Ekstrak tahun (int) dari kolom 'tanggal' tiap baris draf_jurnal."""
    tahun_set = set()
    for baris in daftar_draf_jurnal or []:
        tanggal = baris.get("tanggal") if isinstance(baris, dict) else None
        if not tanggal:
            continue
        try:
            tahun_set.add(int(pd.to_datetime(tanggal).year))
        except Exception:  # noqa: BLE001
            continue
    return tahun_set


def _tahun_dari_hasil_json(hasil_json: dict) -> set:
    """hasil_json: {kode_jenis: {..., 'draf_jurnal': [...]}} -- hasil 1 file."""
    tahun_set = set()
    for data in (hasil_json or {}).values():
        if isinstance(data, dict):
            tahun_set |= _tahun_dari_draf_jurnal_list(data.get("draf_jurnal"))
    return tahun_set


def _tahun_dari_hasil_batch(hasil_per_file: List[dict]) -> set:
    """hasil_per_file: hasil dari proses_file_batch() -- gabungan banyak file."""
    tahun_set = set()
    for entri in hasil_per_file:
        tahun_set |= _tahun_dari_hasil_json(entri.get("hasil") or {})
    return tahun_set


# [BARU] 7 jenis dokumen yang berperan dalam laporan 18-sheet -- COA +
# 6 jenis file transaksi/pendukung. Dipakai oleh _cek_kelengkapan_
# dokumen_18_sheet() untuk menghitung berapa dari 7 ini yang sudah
# tersedia utk client ybs, BUKAN untuk memaksa ke-7 nya wajib ada.
_JENIS_DOKUMEN_18_SHEET: Dict[str, str] = {
    "coa": "Chart of Account (COA)",
    "rekening_koran": "Rekening Koran / Mutasi Bank",
    "penjualan": "Data Penjualan (Invoice & POS/Kasir)",
    "pembelian": "Pembelian",
    "aset_tetap": "Aset Tetap",
    "buku_bantu_piutang": "Buku Bantu Piutang (AR)",
    "ap_aging": "AP Aging (Utang Jatuh Tempo)",
}

# [BARU] Ambang jumlah jenis dokumen (dari 7 di atas) yang harus SUDAH
# TERSEDIA (baik dari upload lama yang tersimpan di database, maupun
# dari batch yang baru saja diproses) sebelum laporan 18-sheet otomatis
# digenerate. AI ini tidak cuma dipakai untuk laporan keuangan -- jadi
# begitu minimal jumlah ini terpenuhi, laporan TETAP dibuat apa adanya
# (bagian dari jenis yang belum diupload dibiarkan kosong di file-nya),
# bukan menunggu ke-7 jenis lengkap dulu.
_AMBANG_JUMLAH_JENIS_UNTUK_AUTO_18_SHEET = 3


@app.post("/api/client/{client_id}/proses-file-batch")
async def proses_file_batch(
    client_id: str,
    files: List[UploadFile] = File(...),
    jenis_dokumen: Optional[str] = Form(None),
    conv_id: Optional[str] = Form(None),
    konfirmasi_duplikat: bool = Form(False),
    # [BARU -- PARITAS KECEPATAN DGN /api/proses-file] Sebelumnya endpoint
    # batch ini TIDAK PERNAH meneruskan pakai_ai ke
    # _proses_dan_simpan_satu_file()/_jalankan_generate_kertas_kerja(),
    # jadi diam-diam selalu jalan dengan pakai_ai=True (default fungsi
    # tsb) -- tiap baris yang tidak cocok pola historis/kata kunci COA
    # memanggil API AI (Groq) SATU PER SATU, jauh lebih lambat dari
    # /api/proses-file yang dipakai halaman Transaksi (di sana frontend
    # eksplisit kirim pakai_ai=false secara default). Sekarang endpoint
    # batch ini juga default False -- perilaku (kecepatan) sama dengan
    # halaman Transaksi kecuali user memang mau AI dinyalakan.
    pakai_ai: bool = Form(False),
    # [BARU -- PARITAS KECEPATAN] Auto-generate laporan 18-sheet penuh
    # (COA+jurnal+laporan keuangan+lampiran SPT+laporan bulanan+aset
    # tetap+PPh Badan+piutang/hutang+tren saldo+NARASI AI+susun Excel --
    # lihat _auto_generate_laporan_18_sheet) sebelumnya SELALU jalan
    # otomatis di akhir tiap batch upload -- termasuk sub-tahap
    # "narasi_ai" yang manggil Claude API lagi, di luar pakai_ai di atas.
    # Ini paling berat dari semua tahap batch ini. Sekarang default OFF
    # -- laporan tetap bisa dibuat kapan saja lewat panel "Buat Laporan
    # Keuangan Lengkap (18 Sheet)" di HasilTerpadu.jsx (endpoint terpisah
    # /api/client/{client_id}/export-18-sheet), jadi tidak ada fitur yang
    # hilang, cuma tidak lagi otomatis nempel di SETIAP upload.
    auto_generate_laporan: bool = Form(False),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diupload.")

    conv_id_final = conv_id or datetime.now().isoformat()

    # -- Baca semua file dulu (butuh isinya utuh utk tahap deteksi & eksekusi) --
    file_bytes: Dict[str, bytes] = {}
    for f in files:
        nama = f.filename or f"upload_{len(file_bytes) + 1}.xlsx"
        file_bytes[nama] = await f.read()

    # [BARU] PDF rekening koran -> working paper (Kertas Kerja), dipisah
    # dari batch SEBELUM tahap deteksi. Alasan: ak.deteksi_semua_sheet()
    # (tahap deteksi di bawah) HANYA paham struktur sheet Excel -- PDF
    # selalu dilabeli "tidak ada sheet dikenali" (tampil sbg "tidak
    # dikenali" di rencana) padahal sebenarnya BISA diproses lewat jalur
    # PDF khusus kertas_kerja.py. Supaya rencana tidak lagi salah tampil,
    # DAN supaya PDF rekening koran menghasilkan working paper (bukan ikut
    # numpuk ke _auto_generate_laporan_18_sheet di step 5), file .pdf
    # dikeluarkan dari file_bytes di sini dan diproses terpisah lewat
    # kertas_kerja.generate_kertas_kerja() (SEKALIGUS semua PDF dalam
    # batch ini, konsisten dgn desain kertas_kerja.py yg memang mendukung
    # multi bulan/bank sekaligus digabung jadi satu GL/working paper).
    nama_file_pdf_batch = [n for n in file_bytes if n.lower().endswith(".pdf")]
    file_bytes_pdf = {n: file_bytes.pop(n) for n in nama_file_pdf_batch}

    kertas_kerja_hasil = None
    if file_bytes_pdf:
        try:
            df_coa_kk, peringatan_coa_kk = _siapkan_df_coa_untuk_kertas_kerja(client_id, None, None)
            daftar_file_pdf_kk: List[Tuple[Any, str]] = []
            for nama_file_pdf, isi_pdf in file_bytes_pdf.items():
                buf = io.BytesIO(isi_pdf)
                buf.name = nama_file_pdf
                daftar_file_pdf_kk.append((buf, nama_file_pdf))
            kertas_kerja_hasil = await asyncio.to_thread(
                _jalankan_generate_kertas_kerja,
                client_id, daftar_file_pdf_kk, df_coa_kk, peringatan_coa_kk,
                [], pakai_ai, user,
            )
        except HTTPException as e:
            kertas_kerja_hasil = {
                "status": "gagal",
                "pesan": e.detail if isinstance(e.detail, str) else str(e.detail),
                "file": nama_file_pdf_batch,
            }
        except Exception as e:  # noqa: BLE001
            kertas_kerja_hasil = {
                "status": "gagal", "pesan": f"Gagal generate kertas kerja: {e}",
                "file": nama_file_pdf_batch,
            }

    if not file_bytes:
        # Semua file dalam batch ini adalah PDF (sudah ditangani di atas
        # via kertas_kerja) -- tidak ada file lain yang perlu lewat jalur
        # deteksi/eksekusi/laporan 18-sheet di bawah, langsung kembalikan.
        dbc.log_audit(
            client_id=client_id, user=user.get("username", "unknown"),
            aksi="proses_file_batch",
            detail={"jumlah_file": len(files), "jumlah_file_pdf_kertas_kerja": len(nama_file_pdf_batch)},
        )
        return {
            "jumlah_file": len(files),
            "rencana": [],
            "hasil_per_file": [],
            "cross_matching": None,
            "laporan_18_sheet": [],
            "kertas_kerja": kertas_kerja_hasil,
        }

    # -- 1. TAHAP DETEKSI (tanpa efek samping) --
    # [FIX -- GAP EVENT LOOP] Sama alasannya dgn /api/deteksi-file --
    # ak.deteksi_semua_sheet() sync/berat, dipanggil BERKALI-KALI di loop
    # ini (1x per file dalam batch). Tiap panggilan dibungkus to_thread
    # SATU-SATU (bukan seluruh loop sekaligus jadi 1 thread) supaya
    # penanganan error per-file tetap presisi sama seperti sebelumnya.
    deteksi_per_file = []
    for nama_file, isi in file_bytes.items():
        buf = io.BytesIO(isi)
        buf.name = nama_file
        try:
            sheets = await asyncio.to_thread(ak.deteksi_semua_sheet, buf, nama_file)
        except Exception as e:  # noqa: BLE001
            sheets = []
            print(f"[PERINGATAN] Gagal deteksi {nama_file}: {e}")
        deteksi_per_file.append({"nama_file": nama_file, "sheets": sheets})

    # -- 2. TAHAP RENCANA --
    rencana = _susun_rencana_batch(deteksi_per_file)

    # -- 3. TAHAP EKSEKUSI, sesuai urutan rencana --
    hasil_per_file = []
    hasil_mentah_per_file: Dict[str, dict] = {}
    for langkah in rencana:
        nama_file = langkah["nama_file"]
        isi = file_bytes[nama_file]
        try:
            # [FIX -- GAP EVENT LOOP] Sama pola dgn /api/proses-file --
            # dibungkus to_thread PER FILE (bukan seluruh loop sekaligus)
            # supaya try/except per-file di bawah ini tetap menangkap error
            # 1 file tanpa menggagalkan file lain dalam batch, persis
            # seperti perilaku sebelumnya.
            hasil = await asyncio.to_thread(
                _proses_dan_simpan_satu_file,
                isi, nama_file, jenis_dokumen, client_id, conv_id_final, None,
                konfirmasi_duplikat, user, pakai_ai,
            )
            hasil_per_file.append({"nama_file": nama_file, "urutan": langkah["urutan"], **hasil})
            hasil_mentah_per_file[nama_file] = hasil
        except Exception as e:  # noqa: BLE001
            # [PENTING] Satu file gagal TIDAK menggagalkan file lain dalam
            # batch -- dicatat sebagai error per file, batch tetap lanjut.
            hasil_per_file.append({
                "nama_file": nama_file, "urutan": langkah["urutan"],
                "error": str(e), "tidak_terdeteksi": True,
            })

    # -- 4. LINTAS FILE: cocokkan bank <-> piutang otomatis kalau keduanya ada --
    cross_matching_hasil = None
    hasil_bank = next(
        (h["hasil"].get("rekening_koran") for h in hasil_per_file
         if h.get("hasil") and h["hasil"].get("rekening_koran")), None,
    )
    hasil_piutang = next(
        (h["hasil"].get("buku_bantu_piutang") for h in hasil_per_file
         if h.get("hasil") and h["hasil"].get("buku_bantu_piutang")), None,
    )
    if hasil_bank and hasil_piutang:
        try:
            df_bank = hasil_bank.get("df")
            df_piutang = hasil_piutang.get("df")
            # [FIX -- BUG "'list' object has no attribute 'empty'"]
            # df_bank/df_piutang di sini adalah hasil serialisasi JSON
            # (list of dict, lihat catatan di fiscal_reconciliation.py),
            # BUKAN pandas DataFrame lagi -- padahal
            # cross_matching.cocokkan_bank_piutang() mengasumsikan
            # DataFrame (memanggil .empty, .copy(), dst). Convert balik
            # ke DataFrame di sini sebelum dipanggil.
            if not isinstance(df_bank, pd.DataFrame):
                df_bank = pd.DataFrame(df_bank or [])
            if not isinstance(df_piutang, pd.DataFrame):
                df_piutang = pd.DataFrame(df_piutang or [])
            # [FIX -- GAP EVENT LOOP] cocokkan_bank_piutang() sync, bisa
            # berat kalau df_bank/df_piutang besar (cross-join/matching
            # baris demi baris) -- dibungkus to_thread sama alasannya
            # dgn pemanggilan lain di endpoint ini.
            hasil_cocok = await asyncio.to_thread(cross_matching.cocokkan_bank_piutang, df_bank, df_piutang)
            # [FIX] cocokkan_bank_piutang() mengembalikan DICT
            # {"hasil": [...], "mutasi_bank_masuk_belum_terpakai": [...],
            # "ringkasan": {...}} -- BUKAN DataFrame -- versi lama di sini
            # memperlakukannya seolah DataFrame (df_cocok["cocok_piutang"],
            # .columns) sehingga jumlah_cocok selalu diam-diam bernilai 0.
            daftar_hasil_cocok = (hasil_cocok or {}).get("hasil", [])
            jumlah_cocok = sum(1 for r in daftar_hasil_cocok if r.get("status") == "MATCHED")
            cross_matching_hasil = {
                "dilakukan": True,
                "jumlah_baris_bank_cocok_ke_piutang": jumlah_cocok,
                "ringkasan": (hasil_cocok or {}).get("ringkasan"),
            }
        except Exception as e:  # noqa: BLE001
            cross_matching_hasil = {"dilakukan": False, "error": str(e)}

    # -- 5. [BARU] AUTO-GENERATE LAPORAN 14-SHEET (lihat docstring
    # _auto_generate_laporan_18_sheet) --
    # [FIX -- GAP EVENT LOOP] Generate workbook 18-sheet itu kerja berat
    # (openpyxl susun banyak sheet dari data DB) -- dibungkus to_thread
    # sama alasannya dgn pemanggilan lain di endpoint batch ini.
    # [BARU -- PARITAS KECEPATAN] Sekarang cuma jalan kalau diminta
    # eksplisit (auto_generate_laporan=True) -- lihat catatan di param
    # auto_generate_laporan di atas.
    # [DIUBAH 2026-10-04] Auto laporan 18-sheet dibuang (sumbernya tabel
    # legacy jurnal_posting/laporan_keuangan sudah di-drop, migration 23).
    laporan_18_sheet = []

    dbc.log_audit(
        client_id=client_id, user=user.get("username", "unknown"),
        aksi="proses_file_batch",
        detail={
            "jumlah_file": len(files),
            "jumlah_file_pdf_kertas_kerja": len(nama_file_pdf_batch),
            "rencana": [{"urutan": l["urutan"], "nama_file": l["nama_file"],
                         "jenis_terdeteksi": l["jenis_terdeteksi"]} for l in rencana],
            "tahun_laporan_auto": [l.get("tahun") for l in laporan_18_sheet if l.get("status") == "berhasil"],
        },
    )

    return {
        "jumlah_file": len(files),
        "rencana": rencana,
        "hasil_per_file": hasil_per_file,
        "cross_matching": cross_matching_hasil,
        "laporan_18_sheet": laporan_18_sheet,
        "kertas_kerja": kertas_kerja_hasil,
    }


# ============================================================
# [BARU] VERSI STREAMING (SSE) DARI /proses-file-batch
# ============================================================
# Dipakai ChatPage.jsx (lihat frontend/src/lib/api.js::
# prosesFileBatchStream()) supaya SETIAP tahap -- mulai dari file yang
# BARU SAJA diterima dari user, sampai ke sub-tahap internal generate
# laporan 18-sheet (COA, jurnal, laporan keuangan, dst) -- tampil
# sebagai daftar langkah di chat (komponen ProcessingSteps.jsx), mirip
# panel "Menjalankan N perintah..." ala Claude Code. Alur logic PERSIS
# SAMA dengan proses_file_batch() di atas (sengaja TIDAK diduplikasi
# beda logic-nya, cuma dibungkus ulang jadi sinkron + lapor progress per
# tahap) -- kalau proses_file_batch() di atas diubah, endpoint ini juga
# perlu disesuaikan.
@app.post("/api/client/{client_id}/proses-file-batch/stream")
async def proses_file_batch_stream(
    client_id: str,
    files: List[UploadFile] = File(...),
    jenis_dokumen: Optional[str] = Form(None),
    conv_id: Optional[str] = Form(None),
    konfirmasi_duplikat: bool = Form(False),
    # [BARU -- PARITAS KECEPATAN] Sama seperti proses_file_batch() di
    # atas (versi non-stream) -- lihat catatan lengkap di sana. Default
    # False supaya kecepatan sama dengan halaman Transaksi (/api/proses-
    # file, yang defaultnya juga false) kecuali user memang mau AI.
    pakai_ai: bool = Form(False),
    # [BARU -- PARITAS KECEPATAN] Sama seperti proses_file_batch() --
    # default OFF, laporan 18-sheet (termasuk sub-tahap narasi_ai yang
    # manggil Claude API) tidak lagi otomatis nempel di setiap upload.
    auto_generate_laporan: bool = Form(False),
    user: dict = Depends(auth.require_level(3)),
):
    """
    Versi streaming (SSE) dari POST .../proses-file-batch. Urutan step
    yang dikirim (field "step" tiap event "progress"):

        1. "baca_file"        -- file yang diterima dari user (PALING AWAL)
        2. "kertas_kerja"     -- HANYA kalau ada PDF rekening koran di batch
        3. "deteksi"          -- deteksi jenis dokumen tiap file
        4. "rencana"          -- urutan pemrosesan disusun
        5. "eksekusi:<nama_file>" -- satu step PER FILE, diklasifikasi & disimpan
        6. "cross_matching"   -- HANYA kalau ada Rekening Koran + Piutang
        7. "18sheet:<sub_step>" -- sub-tahap internal generate 18-sheet,
           diteruskan APA ADANYA dari _susun_data_export_18_sheet() /
           _bangun_export_18_sheet() (on_progress) -- mis.
           "18sheet:coa", "18sheet:jurnal", "18sheet:laporan_keuangan",
           "18sheet:lampiran_spt", "18sheet:laporan_bulanan",
           "18sheet:aset_tetap", "18sheet:pph_badan",
           "18sheet:piutang_hutang", "18sheet:tren_saldo",
           "18sheet:narasi_ai", "18sheet:generate_excel" (atau
           "18sheet:cache" kalau hasil diambil dari cache, lihat
           _bangun_export_18_sheet).

    Tiap step muncul 2x (status "processing" lalu "done"/"skip"/"error")
    KECUALI beberapa yang instan (mis. "rencana"). Ganti teks "label" di
    fungsi ini / _susun_data_export_18_sheet() / _auto_generate_
    laporan_18_sheet() sesuai nama yang kamu mau tampilkan ke user --
    "step" (id) sengaja dipisah dari "label" (teks) supaya bisa diganti
    bebas tanpa mengubah logic frontend.

    Event terakhir sebelum "[DONE]" bertipe "result", skemanya PERSIS
    SAMA dengan response /api/client/{client_id}/proses-file-batch biasa
    ({jumlah_file, rencana, hasil_per_file, cross_matching,
    laporan_18_sheet, kertas_kerja}) -- frontend cukup ganti CARA
    MEMANGGIL (baca event SSE bertahap lewat prosesFileBatchStream()),
    logika MEMBACA hasil akhir TIDAK berubah dari prosesFileBatch().
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diupload.")

    conv_id_final = conv_id or datetime.now().isoformat()

    # File dibaca (await, di event loop) SEBELUM masuk ke thread --
    # UploadFile/SpooledTemporaryFile FastAPI tidak aman dipakai dari
    # thread lain sekaligus event loop async secara bersamaan, sama pola
    # dengan endpoint stream lain (lihat api_generate_kertas_kerja_stream).
    file_bytes: Dict[str, bytes] = {}
    for f in files:
        nama = f.filename or f"upload_{len(file_bytes) + 1}.xlsx"
        file_bytes[nama] = await f.read()

    q: "queue.Queue" = queue.Queue()

    def jalankan():
        try:
            # -- 0. [BARU] Step PALING AWAL yang diminta: laporkan file apa
            # saja yang baru saja diterima dari user, SEBELUM diproses
            # apa pun.
            daftar_nama_file = list(file_bytes.keys())
            q.put({
                "type": "progress", "step": "baca_file",
                "label": f"Membaca {len(daftar_nama_file)} file dari Anda: {', '.join(daftar_nama_file)}",
                "status": "processing",
            })
            fb = dict(file_bytes)  # copy lokal -- aman diubah (di-pop) di thread ini
            q.put({
                "type": "progress", "step": "baca_file",
                "label": f"Membaca {len(daftar_nama_file)} file dari Anda",
                "status": "done",
            })

            # -- 0.5. PDF rekening koran -> Kertas Kerja, dipisah dulu dari
            # batch (sama seperti proses_file_batch(), lihat komentar
            # panjang di sana untuk alasannya).
            nama_file_pdf_batch = [n for n in fb if n.lower().endswith(".pdf")]
            file_bytes_pdf = {n: fb.pop(n) for n in nama_file_pdf_batch}

            kertas_kerja_hasil = None
            if file_bytes_pdf:
                q.put({
                    "type": "progress", "step": "kertas_kerja",
                    "label": f"Menyusun Kertas Kerja dari {len(file_bytes_pdf)} PDF rekening koran",
                    "status": "processing",
                })
                try:
                    df_coa_kk, peringatan_coa_kk = _siapkan_df_coa_untuk_kertas_kerja(client_id, None, None)
                    daftar_file_pdf_kk: List[Tuple[Any, str]] = []
                    for nama_file_pdf, isi_pdf in file_bytes_pdf.items():
                        buf = io.BytesIO(isi_pdf)
                        buf.name = nama_file_pdf
                        daftar_file_pdf_kk.append((buf, nama_file_pdf))
                    kertas_kerja_hasil = _jalankan_generate_kertas_kerja(
                        client_id, daftar_file_pdf_kk, df_coa_kk, peringatan_coa_kk,
                        [], pakai_ai, user,
                    )
                    q.put({
                        "type": "progress", "step": "kertas_kerja",
                        "label": f"Menyusun Kertas Kerja dari {len(file_bytes_pdf)} PDF rekening koran",
                        "status": "done",
                    })
                except HTTPException as e:
                    pesan_gagal = e.detail if isinstance(e.detail, str) else str(e.detail)
                    kertas_kerja_hasil = {"status": "gagal", "pesan": pesan_gagal, "file": nama_file_pdf_batch}
                    q.put({
                        "type": "progress", "step": "kertas_kerja",
                        "label": "Menyusun Kertas Kerja", "status": "error", "pesan": pesan_gagal,
                    })
                except Exception as e:  # noqa: BLE001
                    kertas_kerja_hasil = {
                        "status": "gagal", "pesan": f"Gagal generate kertas kerja: {e}",
                        "file": nama_file_pdf_batch,
                    }
                    q.put({
                        "type": "progress", "step": "kertas_kerja",
                        "label": "Menyusun Kertas Kerja", "status": "error", "pesan": str(e),
                    })

            if not fb:
                # Semua file dalam batch ini PDF (sudah ditangani di atas) --
                # tidak ada jalur deteksi/eksekusi/18-sheet, langsung kirim
                # hasil akhir.
                dbc.log_audit(
                    client_id=client_id, user=user.get("username", "unknown"),
                    aksi="proses_file_batch_stream",
                    detail={"jumlah_file": len(files), "jumlah_file_pdf_kertas_kerja": len(nama_file_pdf_batch)},
                )
                q.put({
                    "type": "result",
                    "jumlah_file": len(files), "rencana": [], "hasil_per_file": [],
                    "cross_matching": None, "laporan_18_sheet": [], "kertas_kerja": kertas_kerja_hasil,
                })
                return

            # -- 1. TAHAP DETEKSI --
            q.put({
                "type": "progress", "step": "deteksi",
                "label": f"Mendeteksi jenis dokumen dari {len(fb)} file",
                "status": "processing",
            })
            deteksi_per_file = []
            for nama_file, isi in fb.items():
                buf = io.BytesIO(isi)
                buf.name = nama_file
                try:
                    sheets = ak.deteksi_semua_sheet(buf, nama_file)
                except Exception as e:  # noqa: BLE001
                    sheets = []
                    print(f"[PERINGATAN] Gagal deteksi {nama_file}: {e}")
                deteksi_per_file.append({"nama_file": nama_file, "sheets": sheets})
            q.put({
                "type": "progress", "step": "deteksi",
                "label": f"Mendeteksi jenis dokumen dari {len(fb)} file",
                "status": "done",
            })

            # -- 2. TAHAP RENCANA --
            q.put({
                "type": "progress", "step": "rencana",
                "label": "Menyusun rencana urutan pemrosesan",
                "status": "processing",
            })
            rencana = _susun_rencana_batch(deteksi_per_file)
            q.put({
                "type": "progress", "step": "rencana",
                "label": "Menyusun rencana urutan pemrosesan",
                "status": "done",
            })

            # -- 3. TAHAP EKSEKUSI, sesuai urutan rencana -- [BARU] satu
            # step PER FILE (bukan 1 step besar) supaya user lihat file
            # mana yang sedang diproses.
            hasil_per_file = []
            for langkah in rencana:
                nama_file = langkah["nama_file"]
                isi = fb[nama_file]
                q.put({
                    "type": "progress", "step": f"eksekusi:{nama_file}",
                    "label": f'Memproses "{nama_file}"', "status": "processing",
                })
                try:
                    hasil = _proses_dan_simpan_satu_file(
                        isi, nama_file, jenis_dokumen, client_id, conv_id_final, None,
                        konfirmasi_duplikat, user, pakai_ai,
                    )
                    hasil_per_file.append({"nama_file": nama_file, "urutan": langkah["urutan"], **hasil})
                    q.put({
                        "type": "progress", "step": f"eksekusi:{nama_file}",
                        "label": f'Memproses "{nama_file}"', "status": "done",
                    })
                except Exception as e:  # noqa: BLE001
                    # [PENTING] Satu file gagal TIDAK menggagalkan file lain
                    # dalam batch -- dicatat sebagai error per file, batch
                    # tetap lanjut (sama seperti proses_file_batch()).
                    hasil_per_file.append({
                        "nama_file": nama_file, "urutan": langkah["urutan"],
                        "error": str(e), "tidak_terdeteksi": True,
                    })
                    q.put({
                        "type": "progress", "step": f"eksekusi:{nama_file}",
                        "label": f'Memproses "{nama_file}"', "status": "error", "pesan": str(e),
                    })

            # -- 4. LINTAS FILE: cocokkan bank <-> piutang otomatis kalau
            # keduanya ada di batch ini --
            cross_matching_hasil = None
            hasil_bank = next(
                (h["hasil"].get("rekening_koran") for h in hasil_per_file
                 if h.get("hasil") and h["hasil"].get("rekening_koran")), None,
            )
            hasil_piutang_cm = next(
                (h["hasil"].get("buku_bantu_piutang") for h in hasil_per_file
                 if h.get("hasil") and h["hasil"].get("buku_bantu_piutang")), None,
            )
            if hasil_bank and hasil_piutang_cm:
                q.put({
                    "type": "progress", "step": "cross_matching",
                    "label": "Mencocokkan Rekening Koran dengan Buku Bantu Piutang",
                    "status": "processing",
                })
                try:
                    df_bank = hasil_bank.get("df")
                    df_piutang = hasil_piutang_cm.get("df")
                    # [FIX -- BUG "'list' object has no attribute 'empty'"]
                    # df_bank/df_piutang di sini adalah hasil serialisasi
                    # JSON (list of dict), BUKAN pandas DataFrame lagi --
                    # padahal cross_matching.cocokkan_bank_piutang()
                    # mengasumsikan DataFrame (memanggil .empty, .copy(),
                    # dst). Convert balik ke DataFrame sebelum dipanggil.
                    if not isinstance(df_bank, pd.DataFrame):
                        df_bank = pd.DataFrame(df_bank or [])
                    if not isinstance(df_piutang, pd.DataFrame):
                        df_piutang = pd.DataFrame(df_piutang or [])
                    hasil_cocok = cross_matching.cocokkan_bank_piutang(df_bank, df_piutang)
                    # [FIX] cocokkan_bank_piutang() mengembalikan DICT
                    # {"hasil": [...], "mutasi_bank_masuk_belum_terpakai":
                    # [...], "ringkasan": {...}} -- BUKAN DataFrame --
                    # versi lama memperlakukannya seolah DataFrame
                    # (df_cocok["cocok_piutang"], .columns) sehingga
                    # jumlah_cocok selalu diam-diam bernilai 0.
                    daftar_hasil_cocok = (hasil_cocok or {}).get("hasil", [])
                    jumlah_cocok = sum(1 for r in daftar_hasil_cocok if r.get("status") == "MATCHED")
                    cross_matching_hasil = {
                        "dilakukan": True,
                        "jumlah_baris_bank_cocok_ke_piutang": jumlah_cocok,
                        "ringkasan": (hasil_cocok or {}).get("ringkasan"),
                    }
                    q.put({
                        "type": "progress", "step": "cross_matching",
                        "label": f"Mencocokkan Rekening Koran dengan Buku Bantu Piutang ({jumlah_cocok} baris cocok)",
                        "status": "done",
                    })
                except Exception as e:  # noqa: BLE001
                    cross_matching_hasil = {"dilakukan": False, "error": str(e)}
                    q.put({
                        "type": "progress", "step": "cross_matching",
                        "label": "Mencocokkan Rekening Koran dengan Buku Bantu Piutang",
                        "status": "error", "pesan": str(e),
                    })

            # -- 5. LAPORAN 18-SHEET
            # [DIUBAH 2026-10-04] Auto laporan 18-sheet dibuang (sumbernya
            # tabel legacy sudah di-drop, migration 23). Tetap kirim 1 event
            # "skip" supaya UI (ProcessingSteps.jsx) tahu tahap ini dilewati.
            laporan_18_sheet = []
            q.put({
                "type": "progress", "step": "18sheet",
                "label": "Laporan 18-Sheet tidak dibuat otomatis.",
                "status": "skip",
            })

            dbc.log_audit(
                client_id=client_id, user=user.get("username", "unknown"),
                aksi="proses_file_batch_stream",
                detail={
                    "jumlah_file": len(files),
                    "jumlah_file_pdf_kertas_kerja": len(nama_file_pdf_batch),
                    "rencana": [{"urutan": l["urutan"], "nama_file": l["nama_file"],
                                 "jenis_terdeteksi": l["jenis_terdeteksi"]} for l in rencana],
                    "tahun_laporan_auto": [l.get("tahun") for l in laporan_18_sheet if l.get("status") == "berhasil"],
                },
            )

            q.put({
                "type": "result",
                "jumlah_file": len(files),
                "rencana": rencana,
                "hasil_per_file": hasil_per_file,
                "cross_matching": cross_matching_hasil,
                "laporan_18_sheet": laporan_18_sheet,
                "kertas_kerja": kertas_kerja_hasil,
            })
        except Exception as e:  # noqa: BLE001
            q.put({"type": "error", "pesan": str(e)})
        finally:
            q.put(None)  # sinyal: tidak ada event lagi

    threading.Thread(target=jalankan, daemon=True).start()

    def event_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield _format_sse_progress(**item)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/api/client/{client_id}/bootstrap-pola-bank")
async def api_bootstrap_pola_bank(
    client_id: str,
    files: List[UploadFile] = File(...),
    min_samples: int = Form(2),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [BARU] "Suapi" pola_bank_client_{client_id}.json dari rekening koran
    bulan-bulan lalu yang SUDAH DIJURNAL LENGKAP oleh akuntan -- lihat
    ak.proses_file_bootstrap_pola_bank() untuk detail lengkap.

    Beda dari /api/proses-file:
    - TIDAK menjalankan kategorisasi/AI sama sekali (murni belajar pola).
    - TIDAK disimpan ke tabel `hasil` (bukan "hasil upload" biasa) --
      output-nya cuma pola_bank_client_{client_id}.json + 1 entri audit log.
    - Boleh terima BEBERAPA file sekaligus (mis. rekening koran Jan+Feb+Mar
      dalam satu request) -- diproses berurutan, tiap file menggabung ke
      pola yang sudah tersimpan dari file sebelumnya (bukan saling menimpa).
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file yang diupload.")

    ringkasan_per_file = []
    total_pola_baru = 0
    total_pola_diperbarui = 0
    total_baris_dibaca = 0
    total_baris_dipakai = 0

    for file in files:
        isi = await file.read()
        nama_file = file.filename or "upload.xlsx"
        buf = io.BytesIO(isi)
        buf.name = nama_file
        try:
            # [FIX -- GAP EVENT LOOP] proses_file_bootstrap_pola_bank() sync
            # & berat (parsing rekening koran penuh), dipanggil berkali-kali
            # di loop ini (1x per file). Dibungkus to_thread per file, sama
            # pola dgn /api/proses-file-batch di atas.
            hasil = await asyncio.to_thread(
                ak.proses_file_bootstrap_pola_bank,
                buf, nama_file, client_id=client_id, min_samples=min_samples,
            )
        except Exception as e:  # noqa: BLE001
            ringkasan_per_file.append({"nama_file": nama_file, "error": str(e)})
            continue

        total_pola_baru += hasil["jumlah_pola_baru"]
        total_pola_diperbarui += hasil["jumlah_pola_diperbarui"]
        total_baris_dibaca += hasil["jumlah_baris_dibaca"]
        total_baris_dipakai += hasil["jumlah_baris_dipakai"]
        ringkasan_per_file.append({
            "nama_file": nama_file,
            "jumlah_baris_dibaca": hasil["jumlah_baris_dibaca"],
            "jumlah_baris_dipakai": hasil["jumlah_baris_dipakai"],
            "jumlah_pola_baru": hasil["jumlah_pola_baru"],
            "jumlah_pola_diperbarui": hasil["jumlah_pola_diperbarui"],
            "detail_pola_baru": hasil["detail_pola_baru"],
            "detail_pola_diperbarui": hasil["detail_pola_diperbarui"],
            "sheet_dilewati": hasil["sheet_dilewati"],
        })

    # Audit trail -- satu entri per REQUEST (bisa berisi banyak file
    # sekaligus), bukan per file, supaya tidak membanjiri log audit client.
    dbc.log_audit(
        client_id=client_id,
        user=user.get("username", "unknown"),
        aksi="bootstrap_pola_bank",
        detail={
            "jumlah_file": len(files),
            "total_pola_baru": total_pola_baru,
            "total_pola_diperbarui": total_pola_diperbarui,
            "total_baris_dibaca": total_baris_dibaca,
            "total_baris_dipakai": total_baris_dipakai,
            "per_file": [
                {k: v for k, v in f.items() if k not in ("detail_pola_baru", "detail_pola_diperbarui")}
                for f in ringkasan_per_file
            ],
        },
    )

    pola_sekarang = ak.muat_pola(ak._path_pola("pola_bank", client_id))

    return {
        "client_id": client_id,
        "total_pola_baru": total_pola_baru,
        "total_pola_diperbarui": total_pola_diperbarui,
        "total_baris_dibaca": total_baris_dibaca,
        "total_baris_dipakai": total_baris_dipakai,
        "total_pola_tersimpan_sekarang": len(pola_sekarang.aturan),
        "per_file": ringkasan_per_file,
    }


# ============================================================
# [BARU] KERTAS KERJA LAPORAN KEUANGAN (working paper) DARI PDF
# REKENING KORAN -- LANGKAH 1 dari alur "kertas kerja dulu, baru user
# konfirmasi generate laporan 18-sheet" (lihat modules/kertas_kerja.py
# untuk detail pipeline PDF -> GL -> Bank_Control -> Bank_Posting_Summary
# -> TB/BS/PNL_Monthly -> file .xlsx).
#
# Endpoint ini BARU membuat working paper-nya saja & mengembalikan
# ringkasan status (jumlah transaksi per confidence, status per bulan) --
# BELUM memanggil generate laporan 18-sheet final. Langkah konfirmasi
# user + endpoint generate laporan final menyusul terpisah.
# ============================================================

def _siapkan_df_coa_untuk_kertas_kerja(
    client_id: str, coa_bytes: Optional[bytes], nama_coa_file: Optional[str],
) -> Tuple[pd.DataFrame, List[str]]:
    """
    [FIX -- Supabase dihapus, TANPA DATABASE] Sebelumnya fungsi ini punya
    fallback ke `dbc.ambil_coa_client(client_id)` kalau coa_file tidak
    diupload. Fallback itu DIHAPUS SELURUHNYA -- COA sekarang HANYA
    berasal dari file Excel yang diupload di request yang sama (parameter
    coa_file). Kalau tidak diupload, kertas kerja tetap digenerate (tidak
    error), tapi TANPA pemetaan akun (label generik apa adanya dari PDF,
    tidak dipetakan ke skema Statement/FS Group) -- upload coa_file kalau
    butuh pemetaan akun yang rapi.
    """
    if not coa_bytes:
        return pd.DataFrame(), [
            "Tidak ada file COA yang diupload di request ini -- kertas kerja "
            "digenerate TANPA pemetaan akun (label generik apa adanya). "
            "Sertakan file Excel COA skema kertas kerja lewat parameter "
            "coa_file kalau butuh pemetaan akun yang rapi.",
        ]

    try:
        wb_coa = openpyxl.load_workbook(io.BytesIO(coa_bytes), data_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"File COA '{nama_coa_file}' gagal dibaca sebagai Excel: {e}",
        )
    df_coa = kertas_kerja.muat_coa_kertas_kerja(wb_coa)
    if df_coa.empty:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Sheet 'COA' tidak ditemukan atau kosong di file '{nama_coa_file}'. "
                "Pastikan ada sheet bernama mengandung 'COA' dengan header "
                "Account No./Account Name/Normal Balance/Statement/FS Group/Notes."
            ),
        )
    return df_coa, []


@app.post("/api/client/{client_id}/generate-kertas-kerja")
async def api_generate_kertas_kerja(
    client_id: str,
    files: List[UploadFile] = File(...),
    coa_file: Optional[UploadFile] = File(None),
    pakai_ai: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [BARU] Generate "Kertas Kerja Laporan Keuangan" (working paper Excel)
    dari PDF rekening koran client -- LANGKAH 1 dari alur konfirmasi
    (lihat komentar di atas blok endpoint ini).

    Args (multipart/form-data):
        files: 1 atau banyak file PDF rekening koran (boleh lintas
            bulan/bank sekaligus, akan digabung jadi satu GL).
        coa_file: opsional, file Excel COA skema kertas kerja. Kalau
            tidak diisi, COA diambil dari database client (fallback,
            lihat _siapkan_df_coa_untuk_kertas_kerja).
        pakai_ai: default True -- teruskan ke akuntansi_ai.proses_dataframe
            untuk klasifikasi transaksi bank (AI + pola historis). Set
            False kalau hanya ingin memakai pola historis client saja
            (lebih cepat/murah, cocok untuk uji coba awal).

    Returns JSON:
        client_id, tahun (ditebak dari transaksi GL), nama_file,
        file_base64 (working paper .xlsx), ringkasan (lihat
        kertas_kerja.ringkasan_status_kertas_kerja), peringatan
        (gabungan semua peringatan proses, termasuk dari sumber COA).
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file PDF rekening koran yang diupload.")

    # [FIX -- Supabase dihapus, TANPA DATABASE] Validasi dbc.ambil_client()
    # dihapus -- client_id sekarang cuma dipakai sbg label/konteks (mis.
    # nama file hasil), TIDAK divalidasi ke database. Kalau client_id
    # salah/tidak ada, proses tetap jalan (tidak 404), karena tidak ada
    # lagi yang dicek ke database sama sekali di jalur file PDF ini.

    coa_bytes = await coa_file.read() if coa_file is not None else None
    df_coa, peringatan_coa = _siapkan_df_coa_untuk_kertas_kerja(
        client_id, coa_bytes, coa_file.filename if coa_file else None,
    )

    daftar_file_pdf: List[Tuple[Any, str]] = []
    nama_file_ditolak: List[str] = []
    for f in files:
        nama_file = f.filename or "upload.pdf"
        if not nama_file.lower().endswith(".pdf"):
            nama_file_ditolak.append(nama_file)
            continue
        isi = await f.read()
        buf = io.BytesIO(isi)
        buf.name = nama_file
        daftar_file_pdf.append((buf, nama_file))

    if not daftar_file_pdf:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tidak ada file PDF yang valid untuk diproses "
                f"(file ditolak karena bukan .pdf: {nama_file_ditolak})."
            ),
        )

    # [FIX -- DEDUP] Badan logic (generate + tulis Excel + log audit) sekarang
    # ada di _jalankan_generate_kertas_kerja() (lihat blok versi stream di
    # bawah), dipakai ulang persis sama di sini -- sebelumnya kode ini
    # ter-duplikasi di 2 tempat, berisiko drift diam-diam kalau salah satu
    # diperbaiki tapi yang lain lupa.
    # [FIX -- GAP EVENT LOOP] _jalankan_generate_kertas_kerja() sync & berat
    # (ekstraksi PDF + klasifikasi AI + tulis Excel, bisa beberapa menit --
    # lihat catatan panjang di atas fungsinya). Versi /stream di bawah SUDAH
    # menjalankan ini di thread terpisah demi SSE; versi blocking ini
    # sebelumnya TIDAK, padahal fungsinya sendiri sudah didesain aman
    # dipanggil dari thread ("aman dipanggil dari thread biasa" -- lihat
    # docstring _jalankan_generate_kertas_kerja). Dibungkus to_thread di sini
    # supaya endpoint non-stream ini juga tidak memblokir event loop.
    return await asyncio.to_thread(
        _jalankan_generate_kertas_kerja,
        client_id, daftar_file_pdf, df_coa, peringatan_coa,
        nama_file_ditolak, pakai_ai, user,
    )


# ============================================================
# [BARU] VERSI STREAMING (SSE) DARI /generate-kertas-kerja
# ============================================================
# MASALAH: PDF rekening koran multi-halaman/multi-bulan bisa makan waktu
# beberapa menit (ekstraksi PDF + klasifikasi AI) -- endpoint blocking di
# atas (api_generate_kertas_kerja) menahan 1 koneksi HTTP selama itu, dan
# reverse proxy/browser BIASANYA timeout di 60-120 detik untuk koneksi yang
# tidak ada aktivitas data. Solusinya PERSIS pola yang sudah dipakai di
# /api/proses-file/stream di atas (lihat komentar lengkap di sana): jalankan
# kertas_kerja.generate_kertas_kerja() (kode SINKRON/blocking -- pandas,
# pdfplumber, requests ke DeepSeek) di THREAD terpisah, kirim event progress
# lewat queue ke browser sebagai SSE selagi thread masih jalan. Karena selalu
# ada byte yang dikirim tiap event progress, koneksi tidak pernah "diam" --
# ini yang membuat reverse proxy tidak menganggapnya timeout, BUKAN karena
# prosesnya jadi lebih cepat (durasi total tetap sama, cuma tidak lagi
# 1 request blocking tanpa respons apa pun sampai selesai).
#
# Endpoint BLOCKING lama (api_generate_kertas_kerja) SENGAJA TIDAK dihapus/
# diubah -- frontend yang belum sempat pindah ke versi stream tetap jalan
# seperti biasa. Badan logic (persiapan COA, validasi file, generate,
# tulis Excel, log audit) SENGAJA disatukan ke _jalankan_generate_kertas_kerja()
# di bawah supaya TIDAK ada logic yang di-duplikasi antara 2 endpoint ini --
# keduanya cuma beda cara mengirim hasil balik ke browser (JSON sekali vs
# event SSE bertahap).
def _jalankan_generate_kertas_kerja(
    client_id: str,
    daftar_file_pdf: List[Tuple[Any, str]],
    df_coa: pd.DataFrame,
    peringatan_coa: List[str],
    nama_file_ditolak: List[str],
    pakai_ai: bool,
    user: dict,
    progress_callback: Optional[Any] = None,
    tahun_override: Optional[int] = None,
) -> Dict[str, Any]:
    """Badan logic generate kertas kerja, dipakai ulang oleh endpoint
    blocking (api_generate_kertas_kerja) maupun versi stream (di bawah).
    Melempar HTTPException persis seperti sebelumnya kalau gagal -- ini
    aman dipanggil dari thread biasa (bukan cuma dari request handler
    FastAPI), HTTPException di sini cuma dipakai sebagai exception class
    yang sudah bawa status_code+detail, bukan benar2 di-raise ke FastAPI.

    Args tambahan:
        progress_callback: [BARU] diteruskan apa adanya ke
            kertas_kerja.generate_kertas_kerja() -- dipakai
            api_generate_kertas_kerja_per_file_stream() di bawah untuk
            melaporkan progress SSE per file PDF. None (default) untuk
            2 endpoint lama yang tidak butuh progress per-file.
        tahun_override: [BARU] kalau diisi, dipakai APA ADANYA sebagai
            tahun kertas kerja, menimpa tebakan otomatis dari
            tentukan_tahun_dari_gl() -- tebakan otomatis TETAP dijalankan
            (bukan dilewati) supaya peringatan "transaksi lintas tahun"
            tetap muncul kalau relevan, cuma nilai tahun akhirnya yang
            ditimpa oleh pilihan user.
    """
    try:
        hasil, peringatan = kertas_kerja.generate_kertas_kerja(
            daftar_file_pdf, df_coa, client_id=client_id, pakai_ai=pakai_ai,
            peringatan_awal=peringatan_coa, progress_callback=progress_callback,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Gagal generate kertas kerja: {e}")

    if nama_file_ditolak:
        hasil.peringatan.append(
            f"File berikut dilewati karena bukan PDF: {nama_file_ditolak}."
        )

    tahun, peringatan_tahun = kertas_kerja.tentukan_tahun_dari_gl(hasil.gl)
    hasil.peringatan.extend(peringatan_tahun)
    if tahun_override:
        tahun = tahun_override

    isi_excel = kertas_kerja.tulis_kertas_kerja_excel(hasil, tahun, identitas={})
    ringkasan = kertas_kerja.ringkasan_status_kertas_kerja(hasil)
    nama_file_output = f"Kertas_Kerja_Laporan_Keuangan_{tahun}.xlsx"

    # [FIX -- Supabase dihapus, TANPA DATABASE] dbc.log_audit() dihapus --
    # tidak ada lagi audit trail yang ditulis ke database untuk proses
    # generate kertas kerja ini.

    return {
        "client_id": client_id,
        "tahun": tahun,
        "nama_file": nama_file_output,
        "file_base64": base64.b64encode(isi_excel).decode("ascii"),
        "ringkasan": ringkasan,
        "peringatan": hasil.peringatan,
    }


@app.post("/api/client/{client_id}/generate-kertas-kerja/stream")
async def api_generate_kertas_kerja_stream(
    client_id: str,
    files: List[UploadFile] = File(...),
    coa_file: Optional[UploadFile] = File(None),
    pakai_ai: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [BARU] Versi streaming (SSE) dari POST .../generate-kertas-kerja --
    lihat komentar blok di atas untuk alasan lengkap. Event terakhir
    sebelum "[DONE]" bertipe "result" dan skemanya PERSIS SAMA dengan
    response endpoint blocking (client_id, tahun, nama_file, file_base64,
    ringkasan, peringatan) -- jadi frontend cukup ganti CARA MEMANGGIL
    (baca event SSE bertahap), logika MEMBACA hasil akhir tidak berubah.

    File PDF & COA dibaca (await f.read()) DI SINI, SEBELUM masuk ke
    thread -- UploadFile/SpooledTemporaryFile FastAPI tidak aman dipakai
    dari thread lain sekaligus async event loop, jadi semua isi file
    sudah harus jadi bytes biasa dulu sebelum thread mulai (sama seperti
    pola di proses_file_stream di atas).
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file PDF rekening koran yang diupload.")

    # [FIX -- Supabase dihapus, TANPA DATABASE] Validasi dbc.ambil_client()
    # dihapus -- client_id sekarang cuma dipakai sbg label/konteks (mis.
    # nama file hasil), TIDAK divalidasi ke database. Kalau client_id
    # salah/tidak ada, proses tetap jalan (tidak 404), karena tidak ada
    # lagi yang dicek ke database sama sekali di jalur file PDF ini.

    coa_bytes = await coa_file.read() if coa_file is not None else None
    nama_coa_file = coa_file.filename if coa_file else None

    daftar_isi_pdf: List[Tuple[bytes, str]] = []
    nama_file_ditolak: List[str] = []
    for f in files:
        nama_file = f.filename or "upload.pdf"
        if not nama_file.lower().endswith(".pdf"):
            nama_file_ditolak.append(nama_file)
            continue
        isi = await f.read()
        daftar_isi_pdf.append((isi, nama_file))

    if not daftar_isi_pdf:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tidak ada file PDF yang valid untuk diproses "
                f"(file ditolak karena bukan .pdf: {nama_file_ditolak})."
            ),
        )

    q: "queue.Queue" = queue.Queue()

    def jalankan():
        try:
            q.put({"type": "progress", "step": "coa", "label": "Menyiapkan Chart of Accounts", "status": "processing"})
            try:
                df_coa, peringatan_coa = _siapkan_df_coa_untuk_kertas_kerja(client_id, coa_bytes, nama_coa_file)
            except HTTPException as e:
                q.put({"type": "error", "pesan": str(e.detail)})
                return
            q.put({"type": "progress", "step": "coa", "label": "Menyiapkan Chart of Accounts", "status": "done"})

            # File dibungkus ulang jadi BytesIO baru per file di sini (bukan
            # di request handler) -- BytesIO murni in-memory, aman dipakai
            # lintas thread selama tidak diakses 2 thread BERSAMAAN, dan di
            # sini cuma thread ini yang menyentuhnya.
            daftar_file_pdf: List[Tuple[Any, str]] = []
            for isi, nama_file in daftar_isi_pdf:
                buf = io.BytesIO(isi)
                buf.name = nama_file
                daftar_file_pdf.append((buf, nama_file))

            q.put({
                "type": "progress", "step": "ekstraksi_klasifikasi",
                "label": f"Mengekstrak & mengklasifikasi transaksi dari {len(daftar_file_pdf)} file PDF"
                         + (" (dibantu AI)" if pakai_ai else " (tanpa AI, pola & kata kunci saja)"),
                "status": "processing",
            })
            try:
                hasil_akhir = _jalankan_generate_kertas_kerja(
                    client_id, daftar_file_pdf, df_coa, peringatan_coa,
                    nama_file_ditolak, pakai_ai, user,
                )
            except HTTPException as e:
                q.put({"type": "error", "pesan": str(e.detail)})
                return
            q.put({
                "type": "progress", "step": "ekstraksi_klasifikasi",
                "label": "Mengekstrak & mengklasifikasi transaksi", "status": "done",
            })

            q.put({"type": "progress", "step": "excel", "label": "Menyusun file Excel kertas kerja", "status": "done"})
            q.put({"type": "result", **hasil_akhir})
        except Exception as e:  # noqa: BLE001
            q.put({"type": "error", "pesan": str(e)})
        finally:
            q.put(None)  # sinyal: tidak ada event lagi

    threading.Thread(target=jalankan, daemon=True).start()

    def event_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield _format_sse_progress(**item)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ============================================================
# [BARU] VERSI STREAMING (SSE) PER-FILE DARI /generate-kertas-kerja
# ============================================================
# Dipakai KertasKerjaPage.jsx (lihat frontend/src/lib/api.js::
# generateKertasKerjaStream()) -- BEDA dari /generate-kertas-kerja/stream
# di atas: endpoint di atas melapor progress PER TAHAP (COA -> ekstraksi
# -> excel), endpoint ini melapor progress PER FILE PDF (queued ->
# processing -> done/cache_hit/error per file), karena
# susun_gl_dari_pdf_rekening_koran() memproses semua file itu PARALEL --
# untuk batch banyak bulan/bank, progress per-tahap terasa "diam" lama di
# 1 tahap ("ekstraksi_klasifikasi") tanpa user tahu file mana yang sudah/
# belum selesai.
#
# Path & skema event SENGAJA disamakan PERSIS dengan yang sudah ditulis
# di frontend (lihat catatan integrasi di api.js) supaya tidak perlu
# ubah frontend sama sekali:
#   {"type": "progress", "file": nama, "status": "queued"|"processing"|
#    "done"|"cache_hit"|"error", "pesan"?: str}
#   {"type": "result", client_id, tahun, nama_file, file_base64,
#    ringkasan, peringatan}   -- skema IDENTIK dgn endpoint blocking
#   {"type": "error", "pesan": str}
#
# Badan logic (COA, validasi file, generate, tulis Excel, log audit) tetap
# lewat _jalankan_generate_kertas_kerja() yang sama (lihat blok di atas) --
# cuma di sini progress_callback (dan tahun_override, lihat Form "tahun")
# diisi supaya event per-file ikut mengalir ke `q` selagi
# kertas_kerja.generate_kertas_kerja() masih berjalan di thread terpisah.
@app.post("/api/client/{client_id}/kertas-kerja/generate/stream")
async def api_generate_kertas_kerja_per_file_stream(
    client_id: str,
    files: List[UploadFile] = File(...),
    coa_file: Optional[UploadFile] = File(None),
    tahun: Optional[int] = Form(None),
    pakai_ai: bool = Form(True),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    [BARU] Versi SSE dari generate kertas kerja dengan progress PER FILE
    PDF -- lihat komentar blok di atas untuk skema event & alasan lengkap.

    Args (multipart/form-data): sama seperti /generate-kertas-kerja,
    ditambah `tahun` opsional (int) -- kalau diisi, dipakai apa adanya
    sebagai tahun kertas kerja (menimpa tebakan otomatis dari
    tentukan_tahun_dari_gl, lihat _jalankan_generate_kertas_kerja).
    """
    if not files:
        raise HTTPException(status_code=400, detail="Tidak ada file PDF rekening koran yang diupload.")

    # [FIX -- Supabase dihapus, TANPA DATABASE] Validasi dbc.ambil_client()
    # dihapus -- client_id sekarang cuma dipakai sbg label/konteks (mis.
    # nama file hasil), TIDAK divalidasi ke database. Kalau client_id
    # salah/tidak ada, proses tetap jalan (tidak 404), karena tidak ada
    # lagi yang dicek ke database sama sekali di jalur file PDF ini.

    coa_bytes = await coa_file.read() if coa_file is not None else None
    nama_coa_file = coa_file.filename if coa_file else None

    daftar_isi_pdf: List[Tuple[bytes, str]] = []
    nama_file_ditolak: List[str] = []
    for f in files:
        nama_file = f.filename or "upload.pdf"
        if not nama_file.lower().endswith(".pdf"):
            nama_file_ditolak.append(nama_file)
            continue
        isi = await f.read()
        daftar_isi_pdf.append((isi, nama_file))

    if not daftar_isi_pdf:
        raise HTTPException(
            status_code=400,
            detail=(
                "Tidak ada file PDF yang valid untuk diproses "
                f"(file ditolak karena bukan .pdf: {nama_file_ditolak})."
            ),
        )

    q: "queue.Queue" = queue.Queue()

    def jalankan():
        try:
            # Lapor "queued" untuk SEMUA file PDF yang valid di depan, sebelum
            # COA/thread pool mulai -- supaya UI langsung menampilkan daftar
            # lengkap file dengan status awal, bukan muncul satu-satu belakangan.
            for _, nama_file in daftar_isi_pdf:
                q.put({"type": "progress", "file": nama_file, "status": "queued"})

            # [FIX -- GAP] File yang ditolak (bukan .pdf) sebelumnya TIDAK
            # pernah dilaporkan lewat SSE sama sekali -- di frontend
            # (KertasKerjaPage.jsx) file itu sudah ditampilkan dengan status
            # awal "queued" (di-set lokal begitu tombol Generate ditekan,
            # untuk SEMUA file yang dipilih user termasuk yang bukan PDF),
            # dan karena tidak ada event progress lanjutan untuk namanya,
            # baris itu akan macet selamanya di "Menunggu" walau proses lain
            # sudah selesai. Sekarang dilaporkan "error" segera di sini,
            # sebelum tahap COA/ekstraksi mulai.
            for nama_file in nama_file_ditolak:
                q.put({
                    "type": "progress", "file": nama_file, "status": "error",
                    "pesan": "Bukan file PDF -- hanya rekening koran PDF yang diterima.",
                })

            try:
                df_coa, peringatan_coa = _siapkan_df_coa_untuk_kertas_kerja(client_id, coa_bytes, nama_coa_file)
            except HTTPException as e:
                q.put({"type": "error", "pesan": str(e.detail)})
                return

            # File dibungkus ulang jadi BytesIO baru per file DI SINI (bukan
            # di request handler) -- sama seperti alasan di endpoint stream
            # per-tahap di atas: BytesIO murni in-memory, aman lintas thread
            # selama tidak diakses 2 thread BERSAMAAN.
            daftar_file_pdf: List[Tuple[Any, str]] = []
            for isi, nama_file in daftar_isi_pdf:
                buf = io.BytesIO(isi)
                buf.name = nama_file
                daftar_file_pdf.append((buf, nama_file))

            def _lapor_progress_file(nama_file_pdf: str, status: str, pesan: Optional[str] = None) -> None:
                # Dipanggil dari thread WORKER milik ThreadPoolExecutor di
                # dalam susun_gl_dari_pdf_rekening_koran (PDF_PARALEL_MAKS
                # worker sekaligus, BUKAN cuma thread `jalankan` ini) --
                # queue.Queue.put() thread-safe, jadi aman dipanggil dari
                # banyak worker bersamaan tanpa lock tambahan di sini.
                item: Dict[str, Any] = {"type": "progress", "file": nama_file_pdf, "status": status}
                if pesan:
                    item["pesan"] = pesan
                q.put(item)

            try:
                hasil_akhir = _jalankan_generate_kertas_kerja(
                    client_id, daftar_file_pdf, df_coa, peringatan_coa,
                    nama_file_ditolak, pakai_ai, user,
                    progress_callback=_lapor_progress_file, tahun_override=tahun,
                )
            except HTTPException as e:
                q.put({"type": "error", "pesan": str(e.detail)})
                return

            q.put({"type": "result", **hasil_akhir})
        except Exception as e:  # noqa: BLE001
            q.put({"type": "error", "pesan": str(e)})
        finally:
            q.put(None)  # sinyal: tidak ada event lagi

    threading.Thread(target=jalankan, daemon=True).start()

    def event_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield _format_sse_progress(**item)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ============================================================
# [BARU] LANGKAH 2: KONFIRMASI KERTAS KERJA -> LAPORAN 18-SHEET
# ============================================================
# Menutup gap #1 (jembatan konfirmasi -> 18-sheet, lihat komentar blok
# /generate-kertas-kerja di atas) DAN gap #2 (re-upload kertas kerja yang
# sudah dikoreksi) SEKALIGUS lewat SATU endpoint stateless: terima file
# kertas kerja .xlsx (boleh dikirim balik apa adanya oleh frontend begitu
# user klik "Ya, lanjut", ATAU versi yang sudah dikoreksi user di sheet
# Adjustments/Opening_Balance -- endpoint ini SELALU baca ulang dari file,
# jadi kedua kasus otomatis diperlakukan sama), baca ulang 4 sheet-nya
# lewat fungsi kertas_kerja.baca_*_dari_kertas_kerja() yang sudah ada,
# susun data lewat kertas_kerja.susun_data_export_18_sheet_dari_kertas_kerja()
# (jembatan yang sudah ada, TIDAK diubah), lalu serialize ke laporan
# 18-sheet final lewat accounting_export.export_18_sheet_lengkap()/
# export_18_sheet_sebagai_json() -- TIDAK ada perubahan sama sekali di
# accounting_export.py, karena bentuk data_export sudah persis sama
# dengan yang dipakai _susun_data_export_18_sheet() versi database.
#
# Desain sengaja stateless (tidak simpan HasilKertasKerja di memori server
# antar-request /generate-kertas-kerja -> endpoint ini) -- lihat catatan
# di docstring kertas_kerja.baca_gl_dari_kertas_kerja().

def _baca_kertas_kerja_untuk_bridge(
    isi_file: bytes, nama_file: str,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame, int, List[str]]:
    """
    Baca 4 sheet (COA, GL, Adjustments, Opening_Balance) dari 1 file kertas
    kerja yang diupload, plus tebak tahun dari GL -- dipakai bareng oleh
    endpoint Excel & JSON di bawah (pola sama seperti
    _susun_data_export_18_sheet dipakai bareng _bangun_export_18_sheet &
    _bangun_preview_18_sheet_json).

    Setiap fungsi baca_*_dari_kertas_kerja() (kecuali muat_coa_kertas_kerja,
    yang menerima objek Workbook) membuka workbook-nya SENDIRI dari
    file_like yang diberikan (lihat modules/kertas_kerja.py) -- di sini
    masing-masing sengaja dikasih io.BytesIO(isi_file) BARU (bukan 1
    buffer yang di-seek ulang) supaya tidak saling mengganggu posisi baca.
    """
    try:
        wb_coa = openpyxl.load_workbook(io.BytesIO(isi_file), data_only=True)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=400,
            detail=f"File '{nama_file}' gagal dibaca sebagai Excel: {e}",
        )

    df_coa = kertas_kerja.muat_coa_kertas_kerja(wb_coa)
    if df_coa.empty:
        raise HTTPException(
            status_code=400,
            detail="Sheet 'COA' tidak ditemukan atau kosong di file kertas kerja yang diupload.",
        )

    try:
        df_gl = kertas_kerja.baca_gl_dari_kertas_kerja(io.BytesIO(isi_file))
        df_adjustments = kertas_kerja.baca_adjustments_dari_kertas_kerja(io.BytesIO(isi_file))
        df_opening = kertas_kerja.baca_opening_balance_dari_kertas_kerja(io.BytesIO(isi_file))
    except ValueError as e:
        # ValueError = sheet wajib tidak ditemukan/kosong -- pesan sudah
        # jelas dari kertas_kerja.py sendiri, teruskan apa adanya sbg 400
        # (sama seperti pola di /generate-kertas-kerja).
        raise HTTPException(status_code=400, detail=str(e))

    tahun, peringatan_tahun = kertas_kerja.tentukan_tahun_dari_gl(df_gl)
    return df_gl, df_coa, df_adjustments, df_opening, tahun, peringatan_tahun


class KonfirmasiKertasKerjaKe18SheetRequest(BaseModel):
    """
    [KETERBATASAN -- SENGAJA] Field yang ADA di Export18SheetRequest tapi
    TIDAK didukung di sini (kompensasi_kerugian_fiskal, kredit_pajak,
    skema_pajak, tambahan_peredaran_bruto_lainnya,
    retur_pengurangan_peredaran_bruto, keterangan_peredaran_bruto,
    metode_penyusutan, tahun_sebelumnya) memang belum diekspos --
    kertas_kerja.susun_data_export_18_sheet_dari_kertas_kerja() belum
    menerima parameter itu, dan PPh Badan 31E dihitung dengan koreksi
    fiskal default 0 (lihat KETERBATASAN di docstring fungsi itu).
    Akuntan WAJIB cek ulang pph_hasil secara manual sebelum SPT
    difinalkan -- sama seperti disclaimer yang sudah ada di kertas kerja
    bank-only ini.
    """
    nama_perusahaan: Optional[str] = None
    prive_atau_dividen: float = 0
    setoran_modal_baru: float = 0
    penyesuaian_ekuitas_manual: float = 0


def _bangun_data_export_18_sheet_dari_kertas_kerja(
    client_id: str, isi_file: bytes, nama_file: str,
    req: "KonfirmasiKertasKerjaKe18SheetRequest", user: dict,
) -> Tuple[dict, List[str]]:
    """Badan logic bareng utk endpoint Excel & JSON di bawah -- baca file,
    susun data_export lewat jembatan yang sudah ada, log audit."""
    df_gl, df_coa, df_adjustments, df_opening, tahun, peringatan_tahun = _baca_kertas_kerja_untuk_bridge(
        isi_file, nama_file,
    )

    data_export = kertas_kerja.susun_data_export_18_sheet_dari_kertas_kerja(
        df_gl=df_gl, df_coa=df_coa, df_adjustments=df_adjustments, df_opening=df_opening,
        tahun=tahun, nama_perusahaan=req.nama_perusahaan,
        prive_atau_dividen=req.prive_atau_dividen, setoran_modal_baru=req.setoran_modal_baru,
        penyesuaian_ekuitas_manual=req.penyesuaian_ekuitas_manual,
    )

    # [FIX -- Supabase dihapus, TANPA DATABASE] dbc.log_audit() dihapus --
    # tidak ada lagi audit trail yang ditulis ke database di sini.
    return data_export, peringatan_tahun


@app.post("/api/client/{client_id}/kertas-kerja/konfirmasi-ke-18-sheet")
async def api_konfirmasi_kertas_kerja_ke_18_sheet(
    client_id: str,
    file: UploadFile = File(...),
    nama_perusahaan: Optional[str] = Form(None),
    prive_atau_dividen: float = Form(0),
    setoran_modal_baru: float = Form(0),
    penyesuaian_ekuitas_manual: float = Form(0),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas -- sama seperti generate-kertas-kerja
):
    """
    [BARU] LANGKAH 2 dari alur "kertas kerja dulu, baru konfirmasi generate
    18-sheet" (lihat komentar blok endpoint /generate-kertas-kerja di atas).

    Menerima file kertas kerja .xlsx -- BOLEH file yang barusan didownload
    dari /generate-kertas-kerja lalu dikirim balik apa adanya (user klik
    "Ya, lanjut" tanpa edit apapun), ATAU versi yang sudah dikoreksi user
    di sheet Adjustments/Opening_Balance (menutup gap #2 sekaligus, tanpa
    endpoint terpisah) -- endpoint ini SELALU baca ulang dari file, jadi
    kedua kasus diperlakukan identik.

    Tidak butuh state dari request /generate-kertas-kerja sebelumnya
    (stateless -- lihat catatan di kertas_kerja.baca_gl_dari_kertas_kerja).

    Args (multipart/form-data):
        file: file kertas kerja .xlsx (wajib ada sheet COA/GL/
            Adjustments/Opening_Balance -- persis hasil /generate-kertas-kerja
            atau /generate-kertas-kerja yang sudah dikoreksi manual).
        nama_perusahaan, prive_atau_dividen, setoran_modal_baru,
            penyesuaian_ekuitas_manual: sama seperti field bernama sama di
            Export18SheetRequest (lihat KonfirmasiKertasKerjaKe18SheetRequest
            utk field yang SENGAJA belum didukung).

    Catatan: client_id di URL TIDAK divalidasi terhadap isi file kertas
    kerja (cuma dipakai utk cek client ada & log audit) -- pastikan file
    yang diupload memang milik client yang benar.

    Returns: file .xlsx laporan 18-sheet final siap download. Kalau
    transaksi GL ternyata mencakup >1 tahun, peringatannya dikirim lewat
    header response `X-Peringatan-Tahun` (opsional dibaca frontend).
    """
    # [FIX -- Supabase dihapus, TANPA DATABASE] Validasi dbc.ambil_client()
    # dihapus -- client_id cuma label, tidak divalidasi ke database.

    nama_file = file.filename or "kertas_kerja.xlsx"
    if not nama_file.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="File yang diupload harus berformat .xlsx.")
    isi_file = await file.read()

    req = KonfirmasiKertasKerjaKe18SheetRequest(
        nama_perusahaan=nama_perusahaan, prive_atau_dividen=prive_atau_dividen,
        setoran_modal_baru=setoran_modal_baru, penyesuaian_ekuitas_manual=penyesuaian_ekuitas_manual,
    )

    try:
        # [FIX -- GAP EVENT LOOP] Dua tahap berat di sini: (1) baca+susun
        # data export dari kertas kerja, (2) generate workbook 18-sheet
        # (accounting_export.export_18_sheet_lengkap -- openpyxl susun
        # banyak sheet). Keduanya sync, dibungkus to_thread masing-masing
        # supaya event loop tidak terblokir selama proses ini jalan.
        data_export, peringatan_tahun = await asyncio.to_thread(
            _bangun_data_export_18_sheet_dari_kertas_kerja,
            client_id, isi_file, nama_file, req, user,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Gagal menyusun laporan 18-sheet dari kertas kerja: {e}",
        )

    isi_excel = await asyncio.to_thread(accounting_export.export_18_sheet_lengkap, data_export)
    tahun = data_export.get("periode", "")

    headers = {
        "Content-Disposition": f'attachment; filename="Laporan_Keuangan_{tahun}_18_Sheet.xlsx"',
    }
    if peringatan_tahun:
        # Header non-standar, opsional dibaca frontend -- aman diabaikan
        # kalau frontend belum baca header ini.
        headers["X-Peringatan-Tahun"] = " | ".join(peringatan_tahun)

    return StreamingResponse(
        io.BytesIO(isi_excel),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.post("/api/client/{client_id}/kertas-kerja/konfirmasi-ke-18-sheet-json")
async def api_konfirmasi_kertas_kerja_ke_18_sheet_json(
    client_id: str,
    file: UploadFile = File(...),
    nama_perusahaan: Optional[str] = Form(None),
    prive_atau_dividen: float = Form(0),
    setoran_modal_baru: float = Form(0),
    penyesuaian_ekuitas_manual: float = Form(0),
    user: dict = Depends(auth.require_level(3)),
):
    """
    [BARU] Versi JSON dari POST .../kertas-kerja/konfirmasi-ke-18-sheet --
    supaya frontend bisa tampilkan preview ke-18 sheet LANGSUNG DI LAYAR
    dulu sebelum user download file-nya (pola sama dgn export-18-sheet-json,
    lihat _bangun_preview_18_sheet_json). Parameter sama persis dengan
    versi Excel di atas.
    """
    # [FIX -- Supabase dihapus, TANPA DATABASE] Validasi dbc.ambil_client()
    # dihapus -- client_id cuma label, tidak divalidasi ke database.

    nama_file = file.filename or "kertas_kerja.xlsx"
    if not nama_file.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="File yang diupload harus berformat .xlsx.")
    isi_file = await file.read()

    req = KonfirmasiKertasKerjaKe18SheetRequest(
        nama_perusahaan=nama_perusahaan, prive_atau_dividen=prive_atau_dividen,
        setoran_modal_baru=setoran_modal_baru, penyesuaian_ekuitas_manual=penyesuaian_ekuitas_manual,
    )

    try:
        # [FIX -- GAP EVENT LOOP] Sama alasannya dgn versi Excel di atas.
        data_export, peringatan_tahun = await asyncio.to_thread(
            _bangun_data_export_18_sheet_dari_kertas_kerja,
            client_id, isi_file, nama_file, req, user,
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise HTTPException(
            status_code=500,
            detail=f"Gagal menyusun laporan 18-sheet dari kertas kerja: {e}",
        )

    hasil_json = await asyncio.to_thread(accounting_export.export_18_sheet_sebagai_json, data_export)
    hasil_json["peringatan_tahun"] = peringatan_tahun
    return hasil_json


# ============================================================
# [BARU - Prioritas #6, jalur langsung] UPLOAD FILE HASIL KOREKSI
# ============================================================
# Melengkapi /api/client/{id}/retrain-pola (yang menarik dari jawaban
# fitur klarifikasi di UI): endpoint ini membaca LANGSUNG file Excel
# hasil export format akuntan yang sudah dikoreksi manual oleh akuntan
# (kolom NO AKUN di baris kuning/merah sudah diisi/dibetulkan), untuk
# akuntan yang terbiasa mengedit file kerja Excel-nya sendiri.

@app.post("/api/client/{client_id}/upload-hasil-koreksi")
async def api_upload_hasil_koreksi(
    client_id: str,
    file: UploadFile = File(...),
    min_samples: int = Form(1),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    Upload file HASIL EXPORT format akuntan (dari endpoint
    export-format-akuntan) yang sudah dikoreksi manual oleh akuntan --
    baris kuning/merah sudah diisi/dibetulkan kode akunnya. Baris yang
    valid (kode akun ada & ditemukan di sheet COA file itu sendiri)
    dipelajari jadi pola baru, digabung ke pola_bank_client_{id}.json
    yang sudah ada -- SAMA seperti /api/client/{id}/retrain-pola, cuma
    sumber datanya file Excel langsung, bukan jawaban klarifikasi di UI.
    """
    isi = await file.read()
    nama_file = file.filename or "hasil_koreksi.xlsx"
    buf = io.BytesIO(isi)
    buf.name = nama_file
    try:
        # [FIX -- GAP EVENT LOOP] proses_file_hasil_koreksi_akuntan() sync
        # & berat (parsing Excel + pelajari pola) -- dibungkus to_thread
        # sama alasannya dgn endpoint upload lain.
        hasil = await asyncio.to_thread(
            ak.proses_file_hasil_koreksi_akuntan,
            buf, nama_file, client_id=client_id, min_samples=min_samples,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    dbc.log_audit(
        client_id=client_id,
        user=user.get("username", "unknown"),
        aksi="upload_hasil_koreksi_akuntan",
        detail={
            "nama_file": nama_file,
            "jumlah_baris_dibaca": hasil["jumlah_baris_dibaca"],
            "jumlah_baris_dipakai": hasil["jumlah_baris_dipakai"],
            "jumlah_pola_baru": hasil["jumlah_pola_baru"],
            "jumlah_pola_diperbarui": hasil["jumlah_pola_diperbarui"],
        },
    )
    return {"client_id": client_id, "nama_file": nama_file, **hasil}


# ============================================================
# [BARU - Prioritas #3] METRIK KATEGORISASI OTOMATIS
# ============================================================
# Supaya "seberapa dekat hasil otomatis ke hasil manual akuntan" bisa
# diukur LANGSUNG begitu rekening koran mentah diupload -- tanpa
# akuntan/kamu perlu hitung baris satu-satu.


@app.get("/api/client/{client_id}/pola-bank")
def api_lihat_pola_bank(client_id: str, user: dict = Depends(auth.get_current_user)):
    """
    [BARU] Lihat isi pola_bank_client_{client_id}.json apa adanya -- untuk
    verifikasi hasil bootstrap (item di atas) atau pola yang terkumpul dari
    upload rutin, tanpa perlu upload file apa pun.
    """
    pola = ak.muat_pola(ak._path_pola("pola_bank", client_id))
    daftar = [
        {
            "signature": sig, "arah": arah,
            "akun_debet": f"{a['no_akun_debet']} - {a['nama_akun_debet']}",
            "akun_kredit": f"{a['no_akun_kredit']} - {a['nama_akun_kredit']}",
            "jumlah_contoh": a.get("jumlah_contoh"),
            "confidence_score": a.get("confidence_score"),
            "is_valid": a.get("is_valid"),
            "last_updated": a.get("last_updated"),
        }
        for (sig, arah), a in pola.aturan.items()
    ]
    daftar.sort(key=lambda x: x["signature"])
    return {"client_id": client_id, "jumlah_pola": len(daftar), "pola": daftar}


# ============================================================
# [BARU - Prioritas #6] LATIH ULANG POLA DARI FEEDBACK KLARIFIKASI
# ============================================================
# Menutup loop feedback: akuntan menjawab pertanyaan klarifikasi lewat
# /api/klarifikasi/{id}/jawab (jawaban otomatis tercatat ke tabel
# pola_augmentasi -- lihat dbc.jawab_pertanyaan_klarifikasi), tapi
# ak.latih_ulang_pola_dari_feedback() yang MENGOLAH feedback itu jadi
# pola baru belum pernah dipanggil dari endpoint mana pun. Semua fungsi
# berat SUDAH ada (ak.bangun_pola_dari_feedback_klarifikasi,
# ak.latih_ulang_pola_dari_feedback, dbc.ambil_pola_augmentasi,
# dbc.ambil_coa_client) -- endpoint ini murni menyambungkannya, tidak
# menambah logic baru di akuntansi_ai.py/db_client.py.


# ============================================================
# [BARU] RIWAYAT VERSI & ROLLBACK POLA
# ============================================================
# Melengkapi endpoint retrain-pola di atas: setiap kali pola_bank/
# pola_penjualan client ini DITIMPA -- baik lewat retrain-pola di atas,
# bootstrap, atau upload rutin (proses_file_rekening_koran/penjualan) --
# ak.simpan_pola() di akuntansi_ai.py OTOMATIS menyimpan snapshot versi
# sebelumnya ke pola_data/versi_pola/. 2 endpoint di bawah ini HANYA
# menyambungkan fungsi yang sudah ada di sana (ak.daftar_versi_pola,
# ak.rollback_pola) -- tidak ada logic baru di akuntansi_ai.py.
#
# Kegunaan utama: kalau 1 jawaban klarifikasi/koreksi akuntan yang barusan
# di-retrain ternyata SALAH (typo, salah pilih akun), supervisor bisa
# membatalkannya tanpa perlu investigasi manual atau kehilangan pola lain
# yang sudah benar sebelumnya.

@app.get("/api/client/{client_id}/pola/{jenis}/riwayat")
def api_riwayat_pola(
    client_id: str,
    jenis: str,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    """
    Daftar riwayat perubahan pola_bank/pola_penjualan client ini, TERBARU
    DULU -- dipakai UI utk menampilkan histori sebelum supervisor memutuskan
    mau rollback ke titik mana (lihat endpoint rollback di bawah).

    jenis harus salah satu dari _JENIS_DENGAN_POLA_PER_CLIENT
    ("rekening_koran" atau "penjualan").

    CATATAN BACA (diteruskan dari ak.daftar_versi_pola docstring): field
    "sumber_perubahan" pada tiap entri adalah label PERUBAHAN YANG DIBATALKAN
    kalau rollback dilakukan ke snapshot itu -- BUKAN label siapa yang
    membuat state snapshot tsb. Entri PALING ATAS (terbaru) = "batalkan
    perubahan paling terakhir terjadi".
    """
    if jenis not in _JENIS_DENGAN_POLA_PER_CLIENT:
        raise HTTPException(
            status_code=400,
            detail=f"jenis tidak dikenal: {jenis!r}. Pilih dari {sorted(_JENIS_DENGAN_POLA_PER_CLIENT)}.",
        )
    path_pola = ak._path_pola(_POLA_PER_JENIS[jenis], client_id)
    riwayat = ak.daftar_versi_pola(path_pola)
    return {"client_id": client_id, "jenis": jenis, "jumlah_versi": len(riwayat), "riwayat": riwayat}


class RollbackPolaRequest(BaseModel):
    nama_file_snapshot: Optional[str] = None  # None = otomatis batalkan perubahan terakhir


@app.post("/api/client/{client_id}/pola/{jenis}/rollback")
def api_rollback_pola(
    client_id: str,
    jenis: str,
    req: RollbackPolaRequest,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas -- sama dgn retrain-pola
):
    """
    Kembalikan pola_bank/pola_penjualan client ini ke salah satu titik di
    riwayat (GET /riwayat di atas).

    req.nama_file_snapshot=None (default) = batalkan HANYA perubahan
    TERAKHIR yang terjadi -- kasus paling umum: 1 klarifikasi/koreksi
    barusan ternyata salah input. Untuk mundur lebih jauh, ambil salah
    satu "nama_file_snapshot" dari GET /riwayat lalu kirim eksplisit di
    sini.

    Rollback SENDIRI otomatis tercatat lagi sbg snapshot baru (lihat
    ak.rollback_pola docstring di akuntansi_ai.py) -- jadi salah pilih versi
    saat rollback pun masih bisa dibatalkan lagi, tidak destruktif.
    """
    if jenis not in _JENIS_DENGAN_POLA_PER_CLIENT:
        raise HTTPException(
            status_code=400,
            detail=f"jenis tidak dikenal: {jenis!r}. Pilih dari {sorted(_JENIS_DENGAN_POLA_PER_CLIENT)}.",
        )
    path_pola = ak._path_pola(_POLA_PER_JENIS[jenis], client_id)
    hasil = ak.rollback_pola(path_pola, nama_file_snapshot=req.nama_file_snapshot)
    if not hasil["sukses"]:
        # Riwayat kosong / snapshot tidak ditemukan -- kesalahan permintaan
        # user (client_id/jenis/nama_file_snapshot tidak cocok apapun),
        # bukan error server.
        raise HTTPException(status_code=404, detail=hasil["pesan"])

    dbc.log_audit(
        client_id=client_id,
        user=user.get("username", "unknown"),
        aksi="rollback_pola",
        detail={
            "jenis": jenis,
            "nama_file_snapshot_diminta": req.nama_file_snapshot,
            "hasil": hasil,
        },
    )

    return {"client_id": client_id, "jenis": jenis, **hasil}


# ============================================================
# [BARU] METRIK AKURASI TERPUSAT -- lihat ak.hitung_tren_akurasi /
# ak.catat_metrik_akurasi di akuntansi_ai.py.
# ============================================================
# Endpoint ini MURNI baca (tidak menulis apa pun) -- data yang dibaca
# sudah otomatis tercatat sejak sekarang setiap kali endpoint
# /api/client/{id}/retrain-pola di atas dipanggil (ak.latih_ulang_pola_
# dari_feedback sudah memanggil ak.catat_metrik_akurasi di dalamnya).
# Tidak perlu retroaktif -- histori mulai terbentuk dari titik ini ke
# depan; retrain-pola yang sudah pernah dijalankan SEBELUM fungsi ini
# ada tidak tercatat (datanya sudah hilang, tidak ada cara mengambil lagi).
#
# Dipakai UI utk menjawab "AI-nya makin akurat atau makin ngaco bulan
# ini?" per client -- sebelumnya pertanyaan ini tidak bisa dijawab sama
# sekali, cuma ada skor kualitas DATA (metrik-kategorisasi di atas),
# bukan skor akurasi KEPUTUSAN AI dari waktu ke waktu.

@app.get("/api/client/{client_id}/metrik-akurasi")
def api_metrik_akurasi(
    client_id: str,
    jenis: Optional[str] = None,  # "rekening_koran" | "penjualan" | None (gabungan keduanya)
    n_bulan_terakhir: int = 6,
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas -- sama seperti retrain-pola
):
    """
    Tren akurasi kategorisasi AI per bulan untuk client ini, dihitung dari
    histori konfirmasi ("AI benar, akuntan tidak perlu koreksi") vs koreksi
    ("AI salah, akuntan membetulkan") yang terkumpul tiap kali retrain-pola
    dijalankan.

    jenis=None (default) menggabungkan rekening_koran + penjualan jadi satu
    tren -- kirim jenis eksplisit kalau supervisor mau lihat per jenis
    dokumen terpisah.

    Response "tren" bisa "NAIK" / "TURUN" / "STABIL" (dibanding bulan
    sebelumnya) atau "DATA_BELUM_CUKUP" kalau belum ada 2 bulan data.
    """
    if jenis is not None and jenis not in _JENIS_DENGAN_POLA_PER_CLIENT:
        raise HTTPException(
            status_code=400,
            detail=f"jenis tidak dikenal: {jenis!r}. Pilih dari {sorted(_JENIS_DENGAN_POLA_PER_CLIENT)}.",
        )

    if jenis is not None:
        hasil = ak.hitung_tren_akurasi(client_id, jenis=jenis, n_bulan_terakhir=n_bulan_terakhir)
        return {"client_id": client_id, "jenis": jenis, **hasil}

    # jenis=None -- gabungkan rekening_koran + penjualan jadi satu tren
    # bulanan (dijumlahkan per bulan), plus detail per-jenis terpisah utk
    # supervisor yang mau drill-down.
    per_jenis = {
        j: ak.hitung_tren_akurasi(client_id, jenis=j, n_bulan_terakhir=n_bulan_terakhir)
        for j in sorted(_JENIS_DENGAN_POLA_PER_CLIENT)
    }
    gabungan_per_bulan: Dict[str, Dict[str, int]] = {}
    for hasil_jenis in per_jenis.values():
        for entri in hasil_jenis["per_bulan"]:
            agg = gabungan_per_bulan.setdefault(entri["bulan"], {"jumlah_konfirmasi": 0, "jumlah_koreksi": 0})
            agg["jumlah_konfirmasi"] += entri["jumlah_konfirmasi"]
            agg["jumlah_koreksi"] += entri["jumlah_koreksi"]

    per_bulan_gabungan = []
    for bulan in sorted(gabungan_per_bulan.keys()):
        agg = gabungan_per_bulan[bulan]
        total = agg["jumlah_konfirmasi"] + agg["jumlah_koreksi"]
        per_bulan_gabungan.append({
            "bulan": bulan, "total": total,
            "jumlah_konfirmasi": agg["jumlah_konfirmasi"], "jumlah_koreksi": agg["jumlah_koreksi"],
            "akurasi_persen": round(agg["jumlah_konfirmasi"] / total * 100, 2) if total else None,
        })

    tren_gabungan, selisih_gabungan = "DATA_BELUM_CUKUP", None
    valid = [b for b in per_bulan_gabungan if b["akurasi_persen"] is not None]
    if len(valid) >= 2:
        selisih_gabungan = round(valid[-1]["akurasi_persen"] - valid[-2]["akurasi_persen"], 2)
        tren_gabungan = "NAIK" if selisih_gabungan > 1.0 else ("TURUN" if selisih_gabungan < -1.0 else "STABIL")

    total_konfirmasi_semua = sum(b["jumlah_konfirmasi"] for b in per_bulan_gabungan)
    total_koreksi_semua = sum(b["jumlah_koreksi"] for b in per_bulan_gabungan)
    total_semua = total_konfirmasi_semua + total_koreksi_semua

    return {
        "client_id": client_id,
        "jenis": None,
        "per_bulan": per_bulan_gabungan,
        "akurasi_keseluruhan": round(total_konfirmasi_semua / total_semua * 100, 2) if total_semua else None,
        "tren": tren_gabungan,
        "selisih_persen_poin": selisih_gabungan,
        "per_jenis": per_jenis,
    }


def _format_sse_progress(**kwargs) -> str:
    """Bungkus satu event progress jadi 1 baris SSE. Field 'type' selalu
    ada: 'progress' (satu langkah update), 'result' (hasil akhir, skema
    IDENTIK dengan response /api/proses-file biasa), atau 'error' (gagal
    total, mis. file tidak bisa dibuka sama sekali)."""
    return f"data: {json.dumps(kwargs, ensure_ascii=False, default=str)}\n\n"


@app.post("/api/proses-file/stream")
async def proses_file_stream(
    file: UploadFile = File(...),
    jenis_dokumen: Optional[str] = Form(None),
    client_id: Optional[str] = Form(None),
    conv_id: Optional[str] = Form(None),
    esb_account_id: Optional[int] = Form(None),
    user: dict = Depends(auth.require_level(3)),
):
    """
    [BARU] Versi streaming (SSE) dari /api/proses-file -- supaya frontend
    bisa menampilkan progress step-by-step ("Membaca file...", "Mendeteksi
    Rekening Koran...", "Menyimpan hasil...", dst) alih-alih loading kosong
    lalu hasil muncul sekaligus di akhir.

    Event terakhir sebelum "[DONE]" bertipe "result" dan skemanya PERSIS
    SAMA dengan response /api/proses-file biasa ({nama_file, hasil,
    tidak_terdeteksi}) -- jadi frontend cukup ganti CARA MEMANGGIL endpoint
    ini (baca event SSE, bukan satu Promise), logika MEMBACA hasil di akhir
    tidak perlu berubah.

    Kenapa pakai thread terpisah (bukan langsung jalan di event loop
    FastAPI): _proses_semua_jenis, penyimpanan ke DB (db_client.py), dan
    deteksi anomali semuanya kode SINKRON/blocking (pandas, requests ke AI,
    query DB biasa) -- BUKAN async. Kalau dijalankan langsung di sini,
    Python akan menjalankannya sampai selesai dulu sebelum sempat yield
    event apa pun ke browser -- persis masalah "loading diam lalu muncul
    sekaligus" yang mau diperbaiki. Callback on_progress menaruh tiap event
    ke queue (q); event_generator() di bawah membaca queue itu terus-
    menerus SELAGI thread masih jalan, sehingga event benar-benar terkirim
    real-time ke browser.
    """
    isi = await file.read()
    nama_file = file.filename or "upload.xlsx"
    q: "queue.Queue" = queue.Queue()

    def jalankan():
        def on_progress(kode, label, status, **extra):
            q.put({"type": "progress", "step": kode, "label": label, "status": status, **extra})

        try:
            q.put({"type": "progress", "step": "baca_file", "label": "Membaca file", "status": "done"})

            # [BARU] PDF rekening koran -> working paper (Kertas Kerja),
            # BUKAN alur "proses semua jenis dokumen" + auto laporan
            # 18-sheet di bawah. Sebelumnya endpoint ini selalu memicu
            # _auto_generate_laporan_18_sheet() untuk SEMUA jenis dokumen
            # begitu tahun & COA client tersedia -- padahal untuk PDF
            # rekening koran akuntan butuh working paper (GL + Bank_Control
            # + Bank_Posting_Summary + TB/BS/PNL_Monthly, lihat
            # modules/kertas_kerja.py) supaya bisa DIKOREKSI DULU, bukan
            # laporan final langsung jadi dari klasifikasi mentah.
            # Dicek dari EKSTENSI FILE saja (bukan hasil deteksi jenis
            # dokumen) supaya tidak perlu jalankan _proses_semua_jenis()
            # dulu baru ketahuan ini rekening koran -- PDF yang diupload
            # lewat kotak chat SELALU diasumsikan rekening koran, konsisten
            # dengan satu-satunya jenis dokumen PDF yang didukung
            # kertas_kerja.py saat ini. Hanya berlaku kalau ada client_id
            # aktif (working paper butuh COA client); kalau tidak ada
            # client_id, tetap jatuh ke alur lama di bawah.
            if nama_file.lower().endswith(".pdf") and client_id is not None:
                q.put({
                    "type": "progress", "step": "kertas_kerja_coa",
                    "label": "Menyiapkan COA untuk kertas kerja", "status": "processing",
                })
                df_coa, peringatan_coa = _siapkan_df_coa_untuk_kertas_kerja(client_id, None, None)
                q.put({
                    "type": "progress", "step": "kertas_kerja_coa",
                    "label": "Menyiapkan COA untuk kertas kerja", "status": "done",
                })

                buf = io.BytesIO(isi)
                buf.name = nama_file

                def on_progress_pdf(nama_file_pdf, status, pesan=None):
                    q.put({
                        "type": "progress", "step": "kertas_kerja_pdf",
                        "label": f"Ekstraksi {nama_file_pdf}", "status": status,
                        "pesan": pesan,
                    })

                # [FIX -- DEDUP] Pakai ulang _jalankan_generate_kertas_kerja()
                # yang sudah ada (dipakai juga oleh /generate-kertas-kerja
                # dan /generate-kertas-kerja/stream) -- supaya logic generate
                # + tulis Excel + log audit TIDAK ter-duplikasi di 3 tempat.
                hasil_kk = _jalankan_generate_kertas_kerja(
                    client_id, [(buf, nama_file)], df_coa, peringatan_coa,
                    nama_file_ditolak=[], pakai_ai=True, user=user,
                    progress_callback=on_progress_pdf,
                )
                q.put({
                    "type": "result", "nama_file": nama_file,
                    "hasil": {}, "tidak_terdeteksi": False,
                    "kertas_kerja": hasil_kk,
                })
                return

            hasil_semua, error_per_jenis = _proses_semua_jenis(
                isi, nama_file, jenis_dokumen, client_id, on_progress=on_progress
            )

            if not hasil_semua:
                q.put({
                    "type": "result",
                    "nama_file": nama_file,
                    "hasil": {},
                    "tidak_terdeteksi": True,
                    "pesan": "Tidak ada jenis dokumen yang dikenali di file ini.",
                    "detail_error": error_per_jenis or None,
                })
                return

            hasil_json = _bersihkan_untuk_json(hasil_semua)

            # [DIUBAH 2026-10-04 -- migrations/23-drop_legacy_and_finance_tables.py]
            # Simpan ke riwayat client (hasil/jurnal_posting), reminder SPT,
            # pertanyaan klarifikasi, alert anomali & auto laporan 18-sheet
            # dibuang bersama tabelnya -- hasil parsing cuma dikembalikan.
            laporan_18_sheet = []

            q.put({
                "type": "result", "nama_file": nama_file, "hasil": hasil_json,
                "tidak_terdeteksi": False, "laporan_18_sheet": laporan_18_sheet,
            })
        except HTTPException as e:
            q.put({"type": "error", "pesan": str(e.detail)})
        except Exception as e:  # noqa: BLE001
            q.put({"type": "error", "pesan": str(e)})
        finally:
            q.put(None)  # sinyal: tidak ada event lagi

    threading.Thread(target=jalankan, daemon=True).start()

    def event_generator():
        while True:
            item = q.get()
            if item is None:
                break
            yield _format_sse_progress(**item)
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ============================================================
# [BARU] MEKANISME TANYA BALIK -- endpoint klarifikasi
# ============================================================
# Dijawab oleh akuntan internal lewat dashboard/chat React (bukan klien
# langsung lewat WA -- sesuai keputusan). Pertanyaannya sendiri dibuat
# otomatis di dalam /api/proses-file di atas, lewat
# ak.cari_baris_perlu_klarifikasi().


# ============================================================
# [BARU] ALERT ANOMALI -- endpoint (mirip mekanisme klarifikasi di atas)
# ============================================================
# Ditinjau oleh akuntan internal lewat dashboard React. Alert-nya sendiri
# dibuat otomatis di dalam /api/proses-file di atas, lewat
# ak.cari_anomali_untuk_alert() & ak.deteksi_pola_mencurigakan().


@app.post("/api/proses-dan-buat-excel")
async def proses_dan_buat_excel(
    file: UploadFile = File(...),
    # [FIX] Sama seperti /api/proses-file di atas -- jenis_dokumen harus
    # Form(None) supaya kebaca dari body form-data yang sama dengan file,
    # bukan dianggap query parameter oleh FastAPI.
    jenis_dokumen: Optional[str] = Form(None),
    user: dict = Depends(auth.require_level(3)),  # Supervisor ke atas
):
    isi = await file.read()
    nama_file = file.filename or "upload.xlsx"

    # [FIX -- GAP EVENT LOOP] _proses_semua_jenis() sync & berat (parsing
    # penuh) -- dibungkus to_thread sama alasannya dgn endpoint upload lain.
    hasil_semua, error_per_jenis = await asyncio.to_thread(
        _proses_semua_jenis, isi, nama_file, jenis_dokumen
    )

    if not hasil_semua:
        return {
            "nama_file": nama_file,
            "berhasil": False,
            "pesan": "Tidak ada jenis dokumen yang dikenali di file ini.",
            "detail_error": error_per_jenis or None,
        }

    # [FIX -- GAP EVENT LOOP + POINT 2] _buat_excel_hasil() (lama, di bawah)
    # murni CPU-bound (openpyxl susun banyak sheet, iter ribuan baris) --
    # THREAD saja TIDAK bikin ini benar-benar paralel (GIL-bound, lihat
    # benchmark di ai_file_reader.py: paralel-thread vs sequential nyaris
    # sama). Dipindah ke modules/excel_export_worker.py (modul LEAF, tanpa
    # import FastAPI/DB) supaya AMAN dijalankan lewat ProcessPoolExecutor --
    # lihat catatan lengkap di modul itu soal KENAPA tidak cukup didekor
    # to_thread di tempat, harus dipindah ke modul terpisah.
    # label_per_kode dikirim eksplisit (bukan dibaca ulang dari
    # _PEMROSES_DOKUMEN di dalam modul worker) supaya excel_export_worker.py
    # tidak perlu mengimpor apa pun dari main.py -- menghindari duplikasi
    # sekaligus risiko drift kalau _PEMROSES_DOKUMEN berubah.
    label_per_kode = {kode: lbl for kode, (lbl, _fn) in _PEMROSES_DOKUMEN.items()}
    path_file_hasil = await asyncio.to_thread(
        excel_export_worker.jalankan_buat_excel_hasil_di_proses,
        hasil_semua, str(FOLDER_HASIL), label_per_kode,
    )

    return {
        "nama_file": nama_file,
        "berhasil": True,
        "ringkasan_per_jenis": _bersihkan_untuk_json(
            {kode: h.get("ringkasan") for kode, h in hasil_semua.items()}
        ),
        "jumlah_perlu_review_per_jenis": {
            kode: len(h.get("masalah") or []) for kode, h in hasil_semua.items()
        },
        "nama_file_hasil": path_file_hasil.name,
        "path_unduh": f"/api/unduh/{path_file_hasil.name}",
    }


# ============================================================
# [BARU] EXPORT REKENING KORAN -- FORMAT KERJA AKUNTAN
# ============================================================
# Beda dari /api/proses-dan-buat-excel di atas (yang menulis Ringkasan/
# Perlu Review/Draf Jurnal sebagai teks datar lewat _buat_excel_hasil):
# endpoint ini menghasilkan file Excel format kerja akuntan yang SAMA
# persis strukturnya dengan file kerja rekonsiliasi bank yang biasa
# dipakai tim akuntan -- 1 sheet COA + 1 sheet per bank, nomor voucher
# berurutan, formula VLOOKUP ke COA, dan formula cek saldo berjalan.
# Lihat modules/accounting_export.py -> export_rekening_koran_format_akuntan().


# ============================================================
# [BARU] CHART OF ACCOUNTS (COA) PERMANEN PER CLIENT
# ============================================================


# ============================================================
# ACCOUNTING CORE V2 — multi-line journal, taxonomy & account role
# ============================================================


@app.get("/api/accounting/standard-accounts")
def api_standard_accounts(user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        rows = session.query(dbc.StandardAccount).filter(dbc.StandardAccount.active.is_(True)).order_by(dbc.StandardAccount.standard_code).all()
        return {"standard_accounts": [
            {
                "id": r.id, "standard_code": r.standard_code, "standard_name": r.standard_name,
                "account_class": r.account_class, "account_subtype": r.account_subtype,
                "normal_balance": r.normal_balance, "fs_statement": r.fs_statement,
                "fs_group": r.fs_group, "fs_line": r.fs_line,
            } for r in rows
        ]}
    finally:
        session.close()


@app.get("/api/accounting/account-roles")
def api_account_roles(user: dict = Depends(auth.get_current_user)):
    session = dbc.SessionLocal()
    try:
        rows = session.query(dbc.AccountRole).filter(dbc.AccountRole.active.is_(True)).order_by(dbc.AccountRole.role_code).all()
        return {"account_roles": [
            {"id": r.id, "role_code": r.role_code, "role_name": r.role_name, "description": r.description}
            for r in rows
        ]}
    finally:
        session.close()


class UserClientAccessRequest(BaseModel):
    user_id: str
    active: bool = True
    access_role: Optional[str] = None


@app.get("/api/client/{client_id}/access")
def api_daftar_client_access(
    client_id: str,
    user: dict = Depends(auth.require_roles(["tahap_5"])),
):
    """[BARU] Siapa saja yang punya akses ke client ini & access_role
    (org_owner..viewer, lihat RBAC.md) apa -- simetris dengan POST di bawah."""
    akses = dbc.daftar_akses_client(client_id)
    for a in akses:
        a["access_role_label"] = auth.client_role_label(a.get("access_role"))
    return {"client_id": client_id, "akses": akses}


@app.post("/api/client/{client_id}/access")
def api_set_client_access(
    client_id: str, req: UserClientAccessRequest,
    user: dict = Depends(auth.require_roles(["tahap_5"])),
):
    if req.access_role is not None and req.access_role not in auth.CLIENT_ROLE_CODES:
        raise HTTPException(
            status_code=422,
            detail=f"access_role tidak dikenal. Pilihan valid: {', '.join(auth.CLIENT_ROLE_CODES)}",
        )
    if not dbc.set_user_client_access(req.user_id, client_id, active=req.active, access_role=req.access_role):
        raise HTTPException(status_code=500, detail="Gagal memperbarui akses user-client.")
    return {
        "berhasil": True, "client_id": client_id, "user_id": req.user_id,
        "active": req.active, "access_role": req.access_role,
    }


# ============================================================
# [BARU] REVIEW & POSTING JURNAL (draf placeholder -> siap laporan)
# ============================================================


# [BARU - persist edit/posting halaman Transaksi frontend] Status ala
# frontend (Transaction['status'] di transactionData.ts) -> salah satu
# dari 3 nilai sah backend (lihat db_client.STATUS_JURNAL_VALID). 'Draft'
# TIDAK dipetakan ke sini secara sengaja -- backend tidak punya status
# "draft pending approval" yang beda dari "draft belum diposting", jadi
# 'Draft' dari frontend (kalau memang dikirim) diperlakukan sama seperti
# 'Unposted': tetap 'draft' di backend. Nilai yang tidak dikenal (typo dsb)
# ditolak 400 lewat _map_status_frontend_ke_backend, bukan diam-diam
# dijadikan draft, supaya kesalahan ketik/kirim tidak lolos tanpa disadari.
_STATUS_FRONTEND_KE_BACKEND = {
    "Unposted": "draft",
    "Draft": "draft",
    "Posted": "terposting",
    "Reconciled": "terposting",
    "Voided": "ditolak",
}


# ============================================================
# [DIPINDAH] MODUL BANK & CASH -- kini di modules/finance/bank_cash_v1.py
# (lihat modules/finance/__init__.py). Router didaftarkan lewat
# app.include_router(finance_bank_cash_v1.router) di bawah -- path,
# auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [DIPINDAH] MODUL OTHER (JURNAL LAIN-LAIN) -- kini di
# modules/finance/other_v1.py (lihat modules/finance/__init__.py).
# Router didaftarkan lewat app.include_router(finance_other_v1.router)
# di bawah -- path, auth, & response TIDAK berubah.
# ============================================================


# ============================================================
# [BARU] 5 LAPORAN KEUANGAN STANDAR
# ============================================================


# ============================================================
# [BARU] LAMPIRAN SPT TAHUNAN BADAN (A01-A09 / L01-L05 / E01-E04)
# ============================================================


# ============================================================
# [BARU] PPh BADAN PASAL 31E - ENDPOINT
# ============================================================


# ============================================================
# [FASE 5 -- roadmap CALK] CATATAN ATAS LAPORAN KEUANGAN (CALK)
# ============================================================
# [KEPUTUSAN poin 13 roadmap] Client model (db_client.py) TIDAK ditambah
# tabel/kolom baru utk data profil CALK (akta, notaris, susunan
# komisaris/direksi) -- dipakai ULANG tabel `hasil_analisis` yang SUDAH
# ADA (jenis_analisis="calk_profil"), pola sama persis dengan
# jenis_analisis="pph_badan_31e" yang sudah jalan. Alasan: field ini
# spesifik utk 1 fitur (CALK), jarang berubah, dan tabel generik ini
# sudah tepat guna (key jenis_analisis + JSON hasil) -- migrasi tabel
# baru cuma menambah risiko tanpa manfaat nyata dibanding dipakai ulang.
# Kalau nanti field ini dipakai fitur LAIN juga (bukan cuma CALK), baru
# pertimbangkan naik kelas jadi kolom permanen di tabel clients.


# ============================================================
# [BARU] LAPORAN BULANAN SETAHUN - ENDPOINT
# ============================================================


# [FIX -- THUNDERING HERD, 2026-09-26] Kalau snapshot laporan bulanan basi
# (atau belum ada), SEBELUM ini setiap GET/POST yang datang bersamaan
# langsung generate ulang sendiri-sendiri secara paralel -- tiap generate
# itu berat (query semua jurnal setahun, hitung 12 bulan, tulis 12 baris
# riwayat_saldo_bulanan). Kalau beberapa halaman/report dibuka bersamaan
# (mis. saat lagi ada proses lain jalan di background seperti import Bank
# Feed), bisa ada belasan generate PARALEL untuk client+tahun yang SAMA,
# rebutan CPU (GIL) & koneksi DB sampai sebagian request timeout
# (socket hang up) meski komputasinya sendiri akhirnya tetap selesai.
#
# Fix: satu threading.Lock per (client_id, tahun) -- request pertama yang
# dapat lock itu yang benar-benar generate; request lain yang datang
# bersamaan untuk kunci yang sama menunggu, lalu (double-checked locking)
# cek ulang cache dulu sebelum ikut generate -- kalau request pertama
# barusan sudah mengisi cache yang segar, mereka tinggal pakai itu, tidak
# generate lagi dari nol.
_lock_registry_lock = threading.Lock()
_laporan_bulanan_locks: Dict[str, threading.Lock] = {}


# ============================================================
# [BARU] RIWAYAT SALDO BULANAN - ENDPOINT (tren Piutang/Utang, dst)
# ============================================================


# ============================================================
# [BARU] JADWAL PENYUSUTAN 12 BULAN - EXPORT
# ============================================================


# ============================================================
# [BARU] EXPORT 14-SHEET LENGKAP
# ============================================================


@app.get("/api/template-laporan-keuangan")
def unduh_template_laporan_keuangan():
    """[FIX] Endpoint baru: download template Excel kosong 31 sheet standar
    laporan keuangan, untuk user yang belum punya file & mau mulai dari nol."""
    isi_bytes = ak.generate_template_31_sheet()
    return StreamingResponse(
        io.BytesIO(isi_bytes),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=template_laporan_keuangan_31_sheet.xlsx"},
    )


@app.get("/api/unduh/{nama_file}")
def unduh_file_hasil(nama_file: str, user: dict = Depends(auth.get_current_user)):
    nama_aman = Path(nama_file).name
    path_file = FOLDER_HASIL / nama_aman
    if not path_file.exists():
        raise HTTPException(status_code=404, detail="File tidak ditemukan (mungkin sudah dihapus).")
    return FileResponse(
        path_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="Hasil_Proses_Akuntansi.xlsx",
    )
