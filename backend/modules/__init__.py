"""
modules/__init__.py
====================
Package untuk modul-modul tambahan AI Gouf Consulting

Modul yang tersedia:
- backup: Auto-backup & restore data
- dashboard: Monitoring real-time
- encryption: Enkripsi data sensitif (PII)
- export: Multi-format export (Excel, CSV, JSON, PDF)
- feedback: AI training feedback loop
- logging_config: Logging terstruktur
- progress: Progress bar & monitoring
- rules: Validation rules engine
- settings: User preferences
- validation: Data validation
- auth: Login & Role-Based Access Control (RBAC)               [BARU]
- charts: Dashboard visual (grafik) dengan Plotly                [BARU]
- accounting_export: Jurnal Umum, Buku Besar, Neraca Saldo        [BARU]
- filters: Filter & pencarian lanjutan                            [BARU]
- history: Riwayat perubahan / audit trail                       [BARU]
- templates: Template & preset jurnal                             [BARU]
- file_detector: Deteksi jenis file (Jurnal Penjualan, Rekonsiliasi
  Kas Masuk, Rekap Transaksi POS) independen dari nama PT/file    [BARU]
- pph_badan: Perhitungan PPh Badan Pasal 17 + fasilitas Pasal 31E [BARU]
- fiscal_reconciliation: Jembatan Aset Tetap -> koreksi fiskal
  untuk PPh Badan 31E                                             [BARU]
"""

__version__ = "1.1.0"
__author__ = "AI Gouf Consulting"

# Import utama untuk kemudahan akses
from .backup import BackupManager, auto_backup, restore_backup, list_backups
from .dashboard import get_live_stats, DashboardStats
from .encryption import encrypt_data, decrypt_data, encrypt_file, decrypt_file
from .export import ExportManager, export_jurnal, export_to_excel, export_to_pdf, export_to_csv, export_to_json
from .feedback import FeedbackCollector, collect_feedback, retrain_with_feedback
from .logging_config import setup_logging, get_logger, log_info, log_warning, log_error
from .progress import ProgressTracker, batch_process_with_progress
from .rules import ValidationRule, VALIDATION_RULES, validate_all_rules
from .settings import UserSettings, load_settings, save_settings, get_setting
from .validation import DataValidator, validate_coa, validate_transaction

# ---- Modul baru ----
# Catatan: auth.py sudah ditulis ulang untuk FastAPI (JWT), bukan lagi
# st.session_state. Fungsi UI Streamlit lama (require_login, is_logged_in,
# logout, render_user_badge_sidebar, dst) SUDAH TIDAK ADA -- diganti
# get_current_user/require_level/require_roles (dependency FastAPI).
from .auth import (
    authenticate, hash_password, verify_password, role_label, role_level,
    buat_token, decode_token, get_current_user, require_level, require_roles,
    ROLES,
)
from .charts import (
    chart_tren_transaksi_harian, chart_distribusi_akun, chart_perbandingan_bank,
    chart_arus_kas_kumulatif, chart_status_kategorisasi, buat_semua_chart,
)
from .accounting_export import (
    generate_jurnal_umum, generate_buku_besar, generate_neraca_saldo,
    cek_neraca_saldo_balance, export_paket_akuntansi_lengkap,
    # [BARU] Export 18-sheet lengkap (COA, Buku Bantu, Trial Balance/Laba
    # Rugi/Balance Sheet Bulanan, PPh Badan, Lampiran SPT rinci, GL,
    # Neraca Saldo Awal, Ringkasan) -- lihat main.py endpoint POST
    # /api/client/{client_id}/export-18-sheet.
    export_18_sheet_lengkap, generate_neraca_saldo_awal_virtual, get_tren_saldo_per_bulan,
)
from .filters import filter_dataframe, opsi_bank, opsi_sumber_kategori
from .history import catat_riwayat, ambil_riwayat, bandingkan_perubahan
from .templates import (
    daftar_template, tambah_template, hapus_template,
    cari_template_cocok, terapkan_template,
)
from .file_detector import (
    deteksi_jenis_file, deteksi_banyak_file, HasilDeteksi,
    JENIS_SALES_JOURNAL, JENIS_CASH_RECONCILIATION, JENIS_POS_TRANSACTION,
    JENIS_TIDAK_DIKENALI, LABEL_JENIS,
)
from .laporan_keuangan import (
    generate_5_laporan_keuangan, peta_akun_dari_coa, hitung_saldo_per_akun,
    susun_neraca, susun_laba_rugi, susun_perubahan_ekuitas,
    susun_arus_kas_sederhana, susun_calk_otomatis,
    susun_lampiran_spt_bs, susun_lampiran_spt_pnl, susun_lampiran_spt_ekuitas,
    susun_lampiran_spt_lengkap, susun_laporan_bulanan_setahun,
    # [BARU] Versi RINCI per kode akun (dipakai export 18-sheet, beda
    # dengan versi total-per-kategori di atas) + jadwal penyusutan 12
    # bulan untuk sheet "Buku Bantu Aktiva Tetap".
    susun_lampiran_spt_bs_rinci, susun_lampiran_spt_pnl_rinci,
    susun_lampiran_spt_ekuitas_rinci, susun_lampiran_spt_lengkap_rinci,
    susun_jadwal_penyusutan_bulanan,
)
# [BARU] PPh Badan Pasal 31E + jembatan rekonsiliasi fiskal dari Aset Tetap.
# Diimpor sebagai submodul (bukan fungsi satu-satu) karena main.py memanggilnya
# lewat "pph_badan.hitung_pph_pasal_31e(...)" / "fiscal_reconciliation.ringkas_..."
# -- bukan "from modules import hitung_pph_pasal_31e".
from . import pph_badan, fiscal_reconciliation

# Daftar semua yang diekspor
__all__ = [
    # Backup
    'BackupManager', 'auto_backup', 'restore_backup', 'list_backups',
    # Dashboard
    'get_live_stats', 'DashboardStats',
    # Encryption
    'encrypt_data', 'decrypt_data', 'encrypt_file', 'decrypt_file',
    # Export
    'ExportManager', 'export_jurnal', 'export_to_excel', 'export_to_pdf', 'export_to_csv', 'export_to_json',
    # Feedback
    'FeedbackCollector', 'collect_feedback', 'retrain_with_feedback',
    # Logging
    'setup_logging', 'get_logger', 'log_info', 'log_warning', 'log_error',
    # Progress
    'ProgressTracker', 'batch_process_with_progress',
    # Rules
    'ValidationRule', 'VALIDATION_RULES', 'validate_all_rules',
    # Settings
    'UserSettings', 'load_settings', 'save_settings', 'get_setting',
    # Validation
    'DataValidator', 'validate_coa', 'validate_transaction',
    # Auth / RBAC (versi FastAPI/JWT)
    'authenticate', 'hash_password', 'verify_password', 'role_label', 'role_level',
    'buat_token', 'decode_token', 'get_current_user', 'require_level', 'require_roles',
    'ROLES',
    # Charts
    'chart_tren_transaksi_harian', 'chart_distribusi_akun', 'chart_perbandingan_bank',
    'chart_arus_kas_kumulatif', 'chart_status_kategorisasi', 'buat_semua_chart',
    # Accounting export
    'generate_jurnal_umum', 'generate_buku_besar', 'generate_neraca_saldo',
    'cek_neraca_saldo_balance', 'export_paket_akuntansi_lengkap',
    'export_18_sheet_lengkap', 'generate_neraca_saldo_awal_virtual', 'get_tren_saldo_per_bulan',
    # Filters
    'filter_dataframe', 'opsi_bank', 'opsi_sumber_kategori',
    # History
    'catat_riwayat', 'ambil_riwayat', 'bandingkan_perubahan',
    # Templates
    'daftar_template', 'tambah_template', 'hapus_template',
    'cari_template_cocok', 'terapkan_template',
    # File detector
    'deteksi_jenis_file', 'deteksi_banyak_file', 'HasilDeteksi',
    'JENIS_SALES_JOURNAL', 'JENIS_CASH_RECONCILIATION', 'JENIS_POS_TRANSACTION',
    'JENIS_TIDAK_DIKENALI', 'LABEL_JENIS',
    # Laporan keuangan (5 laporan standar + lampiran SPT + laporan bulanan)
    'generate_5_laporan_keuangan', 'peta_akun_dari_coa', 'hitung_saldo_per_akun',
    'susun_neraca', 'susun_laba_rugi', 'susun_perubahan_ekuitas',
    'susun_arus_kas_sederhana', 'susun_calk_otomatis',
    'susun_lampiran_spt_bs', 'susun_lampiran_spt_pnl', 'susun_lampiran_spt_ekuitas',
    'susun_lampiran_spt_lengkap', 'susun_laporan_bulanan_setahun',
    'susun_lampiran_spt_bs_rinci', 'susun_lampiran_spt_pnl_rinci',
    'susun_lampiran_spt_ekuitas_rinci', 'susun_lampiran_spt_lengkap_rinci',
    'susun_jadwal_penyusutan_bulanan',
    # PPh Badan 31E + rekonsiliasi fiskal (submodul, lihat catatan import di atas)
    'pph_badan', 'fiscal_reconciliation',
]