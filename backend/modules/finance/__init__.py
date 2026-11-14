"""
modules/finance/
=================
Fitur domain "Finance" (grup sidebar Transactions > Cash & Bank):
    bank_reconciliation_v1.py -- Reconciliation Bank Feed -> invoice Purchase/Sales:
                        catat pembayaran (financial_transaction_bank_cash_payments) +
                        jurnal Kas vs Hutang/Piutang DRAFT. /api/v1/finance/bank-reconciliation/...
    bank_cash_exceptions_v1.py -- catatan penanganan tab Exceptions Cash & Bank
                        (financial_transaction_bank_cash_exceptions).
                        /api/v1/finance/bank-cash/exceptions/...

[DIHAPUS 2026-10-04 -- migrations/23-drop_legacy_and_finance_tables.py]
purchase_v1, bank_cash_v1, other_v1, profit_loss_v1, cash_flow_v1, dan
bank_feed_v1 beserta tabel finance_* / bank_feed_mutation-nya dibuang
untuk dibangun ulang.
"""

from .bank_reconciliation_v1 import router as bank_reconciliation_router  # noqa: F401 [BARU]
