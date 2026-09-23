"""
migrations/consolidate_schemas_to_public.py
============================================
[REVISI] Versi awal file ini untuk MEMINDAHKAN tabel dari 7 schema
bernomor (1_app..7_Management) ke schema public (ALTER TABLE ... SET
SCHEMA) -- dipakai untuk database LAMA yang tabelnya sudah pernah
dibuat manual lewat Supabase Table Editor di schema bernomor.

Untuk database BARU / KOSONG (mis. project Supabase baru yang mau
ditanam di cloud dan belum punya tabel sama sekali), migration "pindah
schema" itu tidak relevan -- tidak ada apa pun untuk dipindah. Yang
dibutuhkan justru MEMBUAT seluruh struktur tabel dari nol, langsung di
schema public, mengikuti definisi model SQLAlchemy di db_client.py
(satu-satunya sumber kebenaran struktur tabel aplikasi ini).

File ini membuat 36 tabel FITUR (bukan tabel core/sistem) -- cuma yang
dikerjakan Hendra: Overview, Transactions [Bank & Cash/Other/
Purchase], AR/AP, Budget & Forecast, Tax & Compliance, Audit,
Financial Statements, Assets, Documents/Reports -- langsung di schema
public, lewat SQLAlchemy Base.metadata.create_all -- urutan CREATE
TABLE (tabel yang direferensikan foreign key dibuat lebih dulu)
DIHITUNG OTOMATIS oleh SQLAlchemy.

⚠️  ASUMSI PENTING: SELURUH 36 tabel di bawah punya foreign key ke
    management_clients(id) (dan finance_transaction_purchase_
    activity_log juga FK ke finance_transaction_purchase_transaction).
    Tabel management_clients (dan tabel core/sistem lain: management_
    users, coa, journal_entries, dst) TIDAK dibuat oleh file ini --
    HARUS sudah ada lebih dulu di database target, kalau belum,
    CREATE TABLE bakal gagal dengan error "relation management_clients
    does not exist".

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- checkfirst=True, tabel yang
sudah ada otomatis di-skip, tidak ada data yang dihapus/ditimpa.

Cara pakai (di database/project Supabase baru yang masih kosong):
    cd backend
    python migrations/consolidate_schemas_to_public.py
    (Windows: venv\\Scripts\\python migrations\\consolidate_schemas_to_public.py)
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine, Base


# Daftar tabel FITUR (bukan core/sistem) yang dikerjakan Hendra --
# 36 tabel, dikelompokkan per fitur/halaman supaya gampang ditelusuri.
TABEL_APLIKASI = [
    # --- Overview ---
    "overview_management_branches", "overview_financial_budget",
    # --- Sales/ESB lama ---
    "esb_accounts", "hasil_esb",
    # --- Transaksi: Bank & Cash ---
    "finance_transaction_bank_cash", "finance_transaction_bank_cash_activity_log",
    # --- Transaksi: Other ---
    "finance_transaction_other", "finance_transaction_other_activity_log",
    # --- Transaksi: Purchase ---
    "finance_transaction_purchase_vendor", "finance_transaction_purchase_transaction",
    "finance_transaction_purchase_line_items", "finance_transaction_purchase_source_data",
    "finance_transaction_purchase_journal_lines", "finance_transaction_purchase_exceptions",
    "finance_transaction_purchase_activity_log",
    # --- AR / AP ---
    "finance_account_receivable_ar_customer", "finance_account_receivable_ar_invoice",
    "finance_account_receivable_ar_payment", "finance_account_receivable_ar_collection_note",
    "finance_account_payable_ap_payment", "finance_account_payable_ap_note",
    # --- Budget & Forecast ---
    "planning_budget_forecast_assumption", "planning_budget_forecast_scenario",
    # --- Tax & Compliance ---
    "planning_tax_compliance_fiscal_correction", "planning_tax_compliance_task",
    # --- Audit (Intelligence) ---
    "intelligence_audit_finding", "intelligence_audit_stage",
    "intelligence_audit_activity", "intelligence_audit_evidence",
    # --- Financial Statements ---
    "finance_financial_statement_profit_loss_insights",
    "finance_financial_statement_cash_flow_forecast",
    "finance_financial_statement_profit_loss_budget_line",
    # --- Assets ---
    "asset_fixed_assets",
    # --- Documents / Reports ---
    "management_documents", "management_report_registry", "management_report_schedule",
]


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def main() -> int:
    print("=" * 70)
    print("🔄 MIGRATION: buat 36 tabel fitur (Overview..Documents/Reports) di schema public")
    print("=" * 70)

    tabel_objek = []
    tidak_ditemukan = []
    for nama in TABEL_APLIKASI:
        if nama in Base.metadata.tables:
            tabel_objek.append(Base.metadata.tables[nama])
        else:
            tidak_ditemukan.append(nama)

    if tidak_ditemukan:
        print(f"⚠️  {len(tidak_ditemukan)} nama tabel tidak ditemukan modelnya di db_client.py, dilewati: {tidak_ditemukan}")

    with engine.connect() as connection:
        sudah_ada = [t.name for t in tabel_objek if _tabel_ada(connection, t.name)]
        belum_ada = [t.name for t in tabel_objek if t.name not in sudah_ada]

        print(f"⏭️  {len(sudah_ada)} tabel sudah ada, di-skip.")
        print(f"🆕 {len(belum_ada)} tabel akan dibuat...")
        print()

        try:
            # create_all otomatis meng-urutkan tabel sesuai foreign key
            # dependency antar tabel dalam daftar ini -- tidak perlu
            # ditulis urut manual.
            Base.metadata.create_all(bind=connection.engine, tables=tabel_objek, checkfirst=True)
            connection.commit()
            for nama in belum_ada:
                print(f"✅ Tabel '{nama}' berhasil dibuat.")
        except (OperationalError, ProgrammingError) as e:
            connection.rollback()
            print(f"❌ Gagal membuat sebagian/seluruh tabel: {e}")
            print("   Jalankan ulang script ini -- tabel yang sudah sempat dibuat akan otomatis di-skip.")
            return 1

    print()
    print("=" * 70)
    print(f"📋 RINGKASAN: {len(tabel_objek)} tabel target | {len(sudah_ada)} sudah ada sebelumnya | {len(belum_ada)} baru dibuat")
    print("=" * 70)
    print("✅ SEMUA migration berhasil!")
    return 0


if __name__ == "__main__":
    sys.exit(main())