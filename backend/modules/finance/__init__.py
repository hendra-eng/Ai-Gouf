"""
modules/finance/
=================
Fitur domain "Finance" (grup sidebar Transactions > Cash & Bank):
    bank_cash_exceptions_v1.py -- catatan penanganan tab Exceptions Cash & Bank
                        (financial_transaction_bank_cash_exceptions).
                        /api/v1/finance/bank-cash/exceptions/...

[DIHAPUS 2026-10-04 -- migrations/23-drop_legacy_and_finance_tables.py]
purchase_v1, bank_cash_v1, other_v1, profit_loss_v1, cash_flow_v1, dan
bank_feed_v1 beserta tabel finance_* / bank_feed_mutation-nya dibuang
untuk dibangun ulang.

[DIHAPUS 2026-10-10] bank_reconciliation_v1.py (bergantung pada tabel
financial_transaction_bank_cash_payments yang tidak pernah ada di DB ini) --
Cash & Bank dibangun ulang di modules/transactions/bank_cash_v1.py
(migrations/34-create_bank_cash_tables.py).
"""

