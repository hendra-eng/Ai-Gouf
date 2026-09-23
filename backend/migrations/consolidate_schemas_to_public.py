"""
migrations/consolidate_schemas_to_public.py
============================================
Membuat 36 tabel FITUR yang sudah dikerjakan (Overview, Transactions
[Bank & Cash/Other/Purchase], AR/AP, Budget & Forecast, Tax &
Compliance, Audit, Financial Statements, Assets, Documents/Reports)
langsung di schema public database yang baru:

    Overview:
        0. overview_management_branches
        1. overview_financial_budget
    Sales/ESB lama:
        2. esb_accounts
        3. hasil_esb
    Transaksi > Bank & Cash:
        4. finance_transaction_bank_cash
        5. finance_transaction_bank_cash_activity_log
    Transaksi > Other:
        6. finance_transaction_other
        7. finance_transaction_other_activity_log
    Transaksi > Purchase:
        8. finance_transaction_purchase_vendor
        9. finance_transaction_purchase_transaction
        10. finance_transaction_purchase_line_items
        11. finance_transaction_purchase_source_data
        12. finance_transaction_purchase_journal_lines
        13. finance_transaction_purchase_exceptions
        14. finance_transaction_purchase_activity_log
    AR / AP:
        15. finance_account_receivable_ar_customer
        16. finance_account_receivable_ar_invoice
        17. finance_account_receivable_ar_payment
        18. finance_account_receivable_ar_collection_note
        19. finance_account_payable_ap_payment
        20. finance_account_payable_ap_note
    Budget & Forecast:
        21. planning_budget_forecast_assumption
        22. planning_budget_forecast_scenario
    Tax & Compliance:
        23. planning_tax_compliance_fiscal_correction
        24. planning_tax_compliance_task
    Audit (Intelligence):
        25. intelligence_audit_finding
        26. intelligence_audit_stage
        27. intelligence_audit_activity
        28. intelligence_audit_evidence
    Financial Statements:
        29. finance_financial_statement_profit_loss_insights
        30. finance_financial_statement_cash_flow_forecast
        31. finance_financial_statement_profit_loss_budget_line
    Assets:
        32. asset_fixed_assets
    Documents / Reports:
        33. management_documents
        34. management_report_registry
        35. management_report_schedule

Urutan CREATE TABLE di atas WAJIB (bukan cuma penomoran) -- beberapa
tabel punya FOREIGN KEY ke tabel sebelumnya dalam daftar ini:
overview_financial_budget -> overview_management_branches;
hasil_esb -> esb_accounts;
finance_transaction_bank_cash_activity_log -> finance_transaction_bank_cash;
finance_transaction_purchase_transaction -> finance_transaction_purchase_vendor;
finance_transaction_purchase_activity_log -> finance_transaction_purchase_transaction;
finance_account_receivable_ar_invoice -> ar_customer;
finance_account_receivable_ar_payment -> ar_invoice;
finance_account_receivable_ar_collection_note -> ar_customer & ar_invoice;
finance_account_payable_ap_payment / ap_note -> finance_transaction_purchase_vendor & _transaction;
intelligence_audit_activity / _evidence -> intelligence_audit_finding.
Jadi tabel yang direferensikan harus sudah ada duluan -- semua urutan
di atas sudah dipastikan aman.

⚠️  ASUMSI PENTING -- tabel di luar daftar ini yang WAJIB SUDAH ADA
    lebih dulu di database target (TIDAK dibuat oleh file ini):
    - management_clients (direferensikan hampir SEMUA 36 tabel di atas)
    - coa (direferensikan asset_fixed_assets)
    Kalau belum ada, CREATE TABLE bakal gagal dengan error "relation
    ... does not exist".

AMAN DIPANGGIL BERKALI-KALI (idempoten) -- CREATE TABLE IF NOT EXISTS
lewat ORM, tabel yang sudah ada di-skip, tidak ada data yang
dihapus/ditimpa.

Cara pakai:
    cd backend
    venv\\Scripts\\python migrations\\consolidate_schemas_to_public.py
"""

import sys
from pathlib import Path

# Console Windows default-nya cp1252 -> print() emoji (🔄 ✅ ❌) melempar
# UnicodeEncodeError. Paksa UTF-8 supaya skrip jalan di terminal apa pun.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv
    # WAJIB sebelum "from db_client import engine" -- lihat catatan yang
    # sama di migrations/add_management_users_auth.py.
    load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

# [FIX] Kalau python-dotenv tidak ter-install (mis. skrip dijalankan pakai
# Python global, bukan venv) .env tidak terbaca dan db_client diam-diam jatuh
# ke fallback SQLite -- sebagian model di sini memakai tipe kolom khusus
# PostgreSQL (UUID/JSONB/Numeric presisi tinggi), jadi CREATE TABLE gagal
# dengan error yang menyesatkan. Hentikan lebih awal.
import os
if not os.environ.get("DATABASE_URL"):
    sys.exit(
        "❌ DATABASE_URL tidak terbaca dari backend/.env.\n"
        "   Jalankan pakai Python venv project (butuh python-dotenv):\n"
        "   venv\\Scripts\\python migrations\\consolidate_schemas_to_public.py"
    )

from sqlalchemy import inspect
from sqlalchemy.exc import OperationalError, ProgrammingError

from db_client import engine


def _tabel_ada(connection, table: str) -> bool:
    return table in inspect(connection).get_table_names()


def _buat_tabel_jika_belum_ada(connection, table_name: str, orm_class) -> bool:
    """CREATE TABLE IF NOT EXISTS lewat ORM, supaya index/constraint/kolom
    ikut dibuat persis seperti definisi model."""
    if _tabel_ada(connection, table_name):
        print(f"⏭️  Tabel '{table_name}' sudah ada, skip.")
        return True
    try:
        from db_client import Base
        Base.metadata.create_all(bind=connection.engine, tables=[orm_class.__table__])
        connection.commit()
        print(f"✅ Tabel '{table_name}' berhasil dibuat.")
        return True
    except (OperationalError, ProgrammingError) as e:
        msg = str(e).lower()
        if "already exists" in msg:
            print(f"⏭️  Tabel '{table_name}' sudah ada (terdeteksi via error), skip.")
            return True
        print(f"❌ Gagal buat tabel '{table_name}': {e}")
        connection.rollback()
        return False


def main() -> int:
    print("=" * 60)
    print("🔄 MIGRATION: buat 36 tabel fitur (Overview..Documents/Reports)")
    print("=" * 60)

    from db_client import (
        ManagementBranch,
        OverviewFinancialBudget,
        EsbAccount,
        HasilEsb,
        FinanceTransactionBankCash,
        FinanceTransactionBankCashActivityLog,
        FinanceTransactionOther,
        FinanceTransactionOtherActivityLog,
        PurchaseVendor,
        PurchaseTransactionRow,
        PurchaseLineItemRow,
        PurchaseSourceDataRow,
        PurchaseJournalLineRow,
        PurchaseExceptionRow,
        PurchaseActivityLogRow,
        ARCustomerRow,
        ARInvoiceRow,
        ARPaymentRow,
        ARCollectionNoteRow,
        APPaymentRow,
        APNoteRow,
        ForecastAssumptionRow,
        ScenarioRow,
        FiscalCorrection,
        TaxComplianceTask,
        AuditFindingRow,
        AuditStageRow,
        AuditActivityRow,
        AuditEvidenceRow,
        PLInsight,
        CashFlowForecastRow,
        PLBudgetLine,
        FixedAsset,
        DocumentRow,
        ReportRegistryRow,
        ReportScheduleRow,
    )

    urutan_tabel = [
        # --- Overview ---
        ("overview_management_branches", ManagementBranch),
        ("overview_financial_budget", OverviewFinancialBudget),
        # --- Sales/ESB lama ---
        ("esb_accounts", EsbAccount),
        ("hasil_esb", HasilEsb),
        # --- Transaksi: Bank & Cash ---
        ("finance_transaction_bank_cash", FinanceTransactionBankCash),
        ("finance_transaction_bank_cash_activity_log", FinanceTransactionBankCashActivityLog),
        # --- Transaksi: Other ---
        ("finance_transaction_other", FinanceTransactionOther),
        ("finance_transaction_other_activity_log", FinanceTransactionOtherActivityLog),
        # --- Transaksi: Purchase ---
        ("finance_transaction_purchase_vendor", PurchaseVendor),
        ("finance_transaction_purchase_transaction", PurchaseTransactionRow),
        ("finance_transaction_purchase_line_items", PurchaseLineItemRow),
        ("finance_transaction_purchase_source_data", PurchaseSourceDataRow),
        ("finance_transaction_purchase_journal_lines", PurchaseJournalLineRow),
        ("finance_transaction_purchase_exceptions", PurchaseExceptionRow),
        ("finance_transaction_purchase_activity_log", PurchaseActivityLogRow),
        # --- AR / AP ---
        ("finance_account_receivable_ar_customer", ARCustomerRow),
        ("finance_account_receivable_ar_invoice", ARInvoiceRow),
        ("finance_account_receivable_ar_payment", ARPaymentRow),
        ("finance_account_receivable_ar_collection_note", ARCollectionNoteRow),
        ("finance_account_payable_ap_payment", APPaymentRow),
        ("finance_account_payable_ap_note", APNoteRow),
        # --- Budget & Forecast ---
        ("planning_budget_forecast_assumption", ForecastAssumptionRow),
        ("planning_budget_forecast_scenario", ScenarioRow),
        # --- Tax & Compliance ---
        ("planning_tax_compliance_fiscal_correction", FiscalCorrection),
        ("planning_tax_compliance_task", TaxComplianceTask),
        # --- Audit (Intelligence) ---
        ("intelligence_audit_finding", AuditFindingRow),
        ("intelligence_audit_stage", AuditStageRow),
        ("intelligence_audit_activity", AuditActivityRow),
        ("intelligence_audit_evidence", AuditEvidenceRow),
        # --- Financial Statements ---
        ("finance_financial_statement_profit_loss_insights", PLInsight),
        ("finance_financial_statement_cash_flow_forecast", CashFlowForecastRow),
        ("finance_financial_statement_profit_loss_budget_line", PLBudgetLine),
        # --- Assets ---
        ("asset_fixed_assets", FixedAsset),
        # --- Documents / Reports ---
        ("management_documents", DocumentRow),
        ("management_report_registry", ReportRegistryRow),
        ("management_report_schedule", ReportScheduleRow),
    ]

    hasil = {}
    with engine.connect() as connection:
        for nama_tabel, orm_class in urutan_tabel:
            hasil[f"buat tabel {nama_tabel}"] = _buat_tabel_jika_belum_ada(connection, nama_tabel, orm_class)

    print()
    print("=" * 60)
    print("📋 RINGKASAN MIGRATION")
    print("=" * 60)
    for k, v in hasil.items():
        print(f"{k:<70}: {'✅' if v else '❌'}")
    print("=" * 60)

    if all(hasil.values()):
        print("✅ SEMUA migration berhasil!")
        return 0
    print("⚠️  Ada migration yang gagal. Periksa error di atas.")
    return 1


if __name__ == "__main__":
    sys.exit(main())