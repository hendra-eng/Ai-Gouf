-- seed_fs_note_templates.sql
-- =============================================================
-- Template note CALK / Notes to Financial Statements
-- (management_fs_note_templates, migrations/31-create_financial_statement_mapping.py)
-- -- Task Plan 20.
--
-- Lapisan framework CALK:
--   1. TEMPLATE (file ini, global)          -> struktur & narasi standar
--   2. NOTE KLIEN (management_client_fs_notes) -> disalin dari template saat
--      klien pertama kali membuka CALK; boleh diubah judul/narasi tetapnya,
--      dinonaktifkan, atau ditambah note custom
--   3. ISI PERIODE (management_client_fs_note_contents) -> narasi khusus 1
--      tanggal laporan + status draft/final
--   Tabel angka tiap note "account" ditarik otomatis dari GL: akun yang
--   note_key mapping-nya = note_key template ini (lihat
--   seed_fs_mapping_rules.sql / mapping per klien).
--
-- note_type: policy  = narasi saja
--            account = narasi + tabel angka dari GL (read-only, override ber-audit-trail)
-- Placeholder narasi: {company} {period_start} {period_end} {year}
--
-- Aman dijalankan ulang: template yang sudah ada diperbarui (note klien
-- yang sudah tersalin TIDAK ikut berubah).
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_fs_note_templates.sql

INSERT INTO management_fs_note_templates
    (note_key, title, statement, note_type, sort_order, default_narrative)
VALUES
    ('general_information', 'General Information', 'GENERAL', 'policy', 10,
     '{company} (the "Company") prepares these financial statements for the period ended {period_end}. Describe the Company''s establishment, domicile, principal activities and the date the financial statements were authorised for issue.'),
    ('basis_of_preparation', 'Basis of Preparation', 'GENERAL', 'policy', 20,
     'The financial statements have been prepared on the accrual basis using the historical cost convention and are presented in Indonesian Rupiah (IDR). Figures are derived from posted General Ledger transactions; draft transactions are excluded.'),
    ('accounting_policies', 'Material Accounting Policies', 'GENERAL', 'policy', 30,
     'Describe the material accounting policies applied, including revenue recognition, inventories, property, plant and equipment and depreciation, financial instruments, employee benefits and income taxes.'),
    ('cash', 'Cash and Cash Equivalents', 'BALANCE_SHEET', 'account', 100,
     'Cash and cash equivalents comprise cash on hand, cash in banks and short-term deposits with original maturities of three months or less, as at {period_end}.'),
    ('receivables', 'Trade and Other Receivables', 'BALANCE_SHEET', 'account', 110,
     'Trade receivables arise from the sale of goods and services in the ordinary course of business. Other receivables include amounts due from employees and other parties. Allowance for expected credit losses is presented as a deduction.'),
    ('inventories', 'Inventories', 'BALANCE_SHEET', 'account', 120,
     'Inventories are stated at the lower of cost and net realisable value.'),
    ('prepayments', 'Prepayments and Advances', 'BALANCE_SHEET', 'account', 130,
     'Prepayments and advances consist of expenses paid in advance and advances to suppliers.'),
    ('other_current_assets', 'Other Assets', 'BALANCE_SHEET', 'account', 140,
     'Other current and non-current assets not presented separately.'),
    ('investments', 'Investments', 'BALANCE_SHEET', 'account', 150,
     'Long-term investments held by the Company.'),
    ('fixed_assets', 'Property, Plant and Equipment', 'BALANCE_SHEET', 'account', 160,
     'Property, plant and equipment are stated at cost less accumulated depreciation and impairment losses. Depreciation is computed using the straight-line method over the estimated useful lives of the assets.'),
    ('payables', 'Trade and Other Payables', 'BALANCE_SHEET', 'account', 200,
     'Trade payables arise from purchases of goods and services from suppliers. Other payables include non-trade obligations.'),
    ('taxation', 'Taxation', 'BALANCE_SHEET', 'account', 210,
     'Prepaid taxes, taxes payable and income tax expense. Describe the reconciliation between accounting profit and taxable income where applicable.'),
    ('accruals', 'Accrued Expenses and Other Liabilities', 'BALANCE_SHEET', 'account', 220,
     'Accrued expenses, contract liabilities and other current liabilities.'),
    ('borrowings', 'Borrowings', 'BALANCE_SHEET', 'account', 230,
     'Bank loans and other borrowings, including their terms, interest rates and collateral.'),
    ('employee_benefits', 'Employee Benefit Obligations', 'BALANCE_SHEET', 'account', 240,
     'Post-employment benefit obligations recognised in accordance with the prevailing labour law.'),
    ('equity', 'Equity', 'EQUITY', 'account', 300,
     'Share capital, additional paid-in capital, retained earnings and other equity components. Current year earnings are computed from the statement of profit or loss.'),
    ('revenue', 'Revenue', 'PROFIT_LOSS', 'account', 400,
     'Revenue from contracts with customers for the period {period_start} to {period_end}, net of discounts and returns.'),
    ('cost_of_sales', 'Cost of Sales', 'PROFIT_LOSS', 'account', 410,
     'Cost of sales comprises the cost of goods and services sold during the period.'),
    ('operating_expenses', 'Operating Expenses', 'PROFIT_LOSS', 'account', 420,
     'Selling, general and administrative expenses, including depreciation.'),
    ('other_income_expense', 'Other Income and Expenses', 'PROFIT_LOSS', 'account', 430,
     'Interest income, finance costs and other non-operating income and expenses.'),
    ('related_parties', 'Related Party Transactions and Balances', 'GENERAL', 'account', 500,
     'Balances and transactions with shareholders, directors, key management and affiliated entities. Describe the nature of each relationship.')
ON CONFLICT (note_key) DO UPDATE SET
    title             = EXCLUDED.title,
    statement         = EXCLUDED.statement,
    note_type         = EXCLUDED.note_type,
    sort_order        = EXCLUDED.sort_order,
    default_narrative = EXCLUDED.default_narrative;
