"""
Accounting Core untuk Gouf Accounting -- taxonomy standar & account role.

[DIBONGKAR 2026-10-04 -- migrations/23-drop_legacy_and_finance_tables.py]
Ledger journal_entries/journal_lines, sync dari jurnal_posting legacy &
tabel finance_*, serta mapping COA legacy (`coa`) sudah dibuang. Yang
tersisa hanya seed taxonomy universal (management_standard_accounts &
management_account_roles, di-rename di migration 24),
dipanggil saat startup main.py. Jurnal resmi sekarang ada di
financial_transaction_journal_entry_drafts (lihat
modules/transactions/journal_entry_v1.py & modules/financial_statements/).
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from typing import Any

import db_client as dbc

MONEY_QUANT = Decimal("0.01")


# Taxonomy awal bersifat universal/broad. Client tetap memiliki nomor/nama
# akun sendiri; mapping ke kode ini dilakukan lewat CoaStandardMapping.
DEFAULT_STANDARD_ACCOUNTS = [
    ("STD.ASSET.CASH", "Cash and Cash Equivalents", "ASET", "Kas & Bank", "DEBET", "BALANCE_SHEET", "Current Assets", "Cash and Cash Equivalents"),
    ("STD.ASSET.AR", "Trade Accounts Receivable", "ASET", "Piutang", "DEBET", "BALANCE_SHEET", "Current Assets", "Trade Receivables"),
    ("STD.ASSET.INVENTORY", "Inventory", "ASET", "Persediaan", "DEBET", "BALANCE_SHEET", "Current Assets", "Inventories"),
    ("STD.ASSET.PREPAID", "Prepaid Expenses", "ASET", "Biaya Dibayar Dimuka", "DEBET", "BALANCE_SHEET", "Current Assets", "Prepayments"),
    ("STD.ASSET.FIXED", "Property Plant and Equipment", "ASET", "Aset Tetap", "DEBET", "BALANCE_SHEET", "Non-current Assets", "Property Plant and Equipment"),
    ("STD.ASSET.ACCUM_DEP", "Accumulated Depreciation", "ASET", "Akumulasi Penyusutan", "KREDIT", "BALANCE_SHEET", "Non-current Assets", "Accumulated Depreciation"),
    ("STD.ASSET.TAX_PREPAID", "Prepaid Taxes", "ASET", "Pajak Dibayar Dimuka", "DEBET", "BALANCE_SHEET", "Current Assets", "Prepaid Taxes"),
    ("STD.ASSET.VAT_INPUT", "Input VAT", "ASET", "PPN Masukan", "DEBET", "BALANCE_SHEET", "Current Assets", "Recoverable Taxes"),
    ("STD.LIABILITY.AP", "Trade Accounts Payable", "LIABILITAS", "Hutang Usaha", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Trade Payables"),
    ("STD.LIABILITY.VAT_OUTPUT", "Output VAT Payable", "LIABILITAS", "Pajak", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Taxes Payable"),
    ("STD.LIABILITY.WHT", "Withholding Tax Payable", "LIABILITAS", "Pajak", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Taxes Payable"),
    ("STD.LIABILITY.ACCRUED", "Accrued Expenses", "LIABILITAS", "Akrual", "KREDIT", "BALANCE_SHEET", "Current Liabilities", "Accrued Expenses"),
    ("STD.EQUITY.CAPITAL", "Paid-in Capital", "EKUITAS", "Modal", "KREDIT", "BALANCE_SHEET", "Equity", "Paid-in Capital"),
    ("STD.EQUITY.RETAINED", "Retained Earnings", "EKUITAS", "Saldo Laba", "KREDIT", "BALANCE_SHEET", "Equity", "Retained Earnings"),
    ("STD.REVENUE.PRODUCT", "Product Revenue", "PENDAPATAN", "Pendapatan Produk", "KREDIT", "PROFIT_LOSS", "Revenue", "Product Revenue"),
    ("STD.REVENUE.SERVICE", "Service Revenue", "PENDAPATAN", "Pendapatan Jasa", "KREDIT", "PROFIT_LOSS", "Revenue", "Service Revenue"),
    ("STD.EXPENSE.COGS", "Cost of Goods Sold", "BEBAN", "HPP", "DEBET", "PROFIT_LOSS", "Cost of Revenue", "Cost of Goods Sold"),
    ("STD.EXPENSE.PAYROLL", "Payroll Expense", "BEBAN", "Beban Gaji", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Payroll"),
    ("STD.EXPENSE.RENT", "Rent Expense", "BEBAN", "Beban Sewa", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Rent"),
    ("STD.EXPENSE.SOFTWARE", "Software and Subscription Expense", "BEBAN", "Beban Software", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Software and Subscriptions"),
    ("STD.EXPENSE.DEP", "Depreciation Expense", "BEBAN", "Penyusutan", "DEBET", "PROFIT_LOSS", "Operating Expenses", "Depreciation"),
    ("STD.OTHER.FX_GAIN", "Foreign Exchange Gain", "PENDAPATAN", "Pendapatan Lain", "KREDIT", "PROFIT_LOSS", "Other Income", "Foreign Exchange Gain"),
    ("STD.OTHER.FX_LOSS", "Foreign Exchange Loss", "BEBAN", "Beban Lain", "DEBET", "PROFIT_LOSS", "Other Expenses", "Foreign Exchange Loss"),
]

DEFAULT_ACCOUNT_ROLES = [
    ("CASH_DEFAULT", "Default Cash Account", "Default akun kas"),
    ("BANK_DEFAULT", "Default Bank Account", "Default akun bank"),
    ("AR_CONTROL", "Accounts Receivable Control", "Control account piutang usaha"),
    ("AP_CONTROL", "Accounts Payable Control", "Control account hutang usaha"),
    ("INPUT_VAT", "Input VAT", "PPN Masukan"),
    ("OUTPUT_VAT", "Output VAT", "PPN Keluaran"),
    ("INVENTORY_CONTROL", "Inventory Control", "Control account persediaan"),
    ("PREPAID_EXPENSE", "Prepaid Expense", "Biaya dibayar dimuka"),
    ("FIXED_ASSET_DEFAULT", "Default Fixed Asset", "Default akun aktiva tetap"),
    ("ACCUM_DEPRECIATION", "Accumulated Depreciation", "Akumulasi penyusutan"),
    ("DEPRECIATION_EXPENSE", "Depreciation Expense", "Beban penyusutan"),
    ("PREPAID_TAX", "Prepaid Tax", "Pajak dibayar dimuka"),
    ("WHT_PAYABLE", "Withholding Tax Payable", "Hutang PPh/withholding"),
    ("RETAINED_EARNINGS", "Retained Earnings", "Saldo laba"),
    ("CURRENT_YEAR_EARNINGS", "Current Year Earnings", "Laba/rugi tahun berjalan"),
    ("FX_GAIN", "FX Gain", "Keuntungan selisih kurs"),
    ("FX_LOSS", "FX Loss", "Kerugian selisih kurs"),
]


def _money(value: Any) -> Decimal:
    if value in (None, ""):
        return Decimal("0.00")
    try:
        return Decimal(str(value)).quantize(MONEY_QUANT, rounding=ROUND_HALF_UP)
    except (InvalidOperation, ValueError, TypeError):
        return Decimal("0.00")


def ensure_seed_data() -> None:
    """Seed taxonomy/account-role universal. Aman dipanggil berkali-kali."""
    session = dbc.SessionLocal()
    try:
        existing_std = {x.standard_code for x in session.query(dbc.StandardAccount).all()}
        for row in DEFAULT_STANDARD_ACCOUNTS:
            if row[0] in existing_std:
                continue
            session.add(dbc.StandardAccount(
                standard_code=row[0], standard_name=row[1], account_class=row[2],
                account_subtype=row[3], normal_balance=row[4], fs_statement=row[5],
                fs_group=row[6], fs_line=row[7], active=True,
            ))
        existing_roles = {x.role_code for x in session.query(dbc.AccountRole).all()}
        for code, name, description in DEFAULT_ACCOUNT_ROLES:
            if code not in existing_roles:
                session.add(dbc.AccountRole(role_code=code, role_name=name, description=description, active=True))
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
