-- seed_fs_mapping_rules.sql
-- =============================================================
-- Aturan mapping DEFAULT laporan keuangan (management_fs_mapping_rules,
-- migrations/31-create_financial_statement_mapping.py) -- Task Plan 16-20.
--
-- Dicocokkan ke management_client_coa.standard_account_code (lapisan
-- semantik standar lintas klien, IFRS-aligned, sumber
-- dataset/COA/COA_Clients_GOUF.xlsx & COA_Industry.xlsx) dengan PREFIX
-- TERPANJANG: aturan 'std_asset_current_cash' berlaku untuk
-- std_asset_current_cash_bank/_on_hand/_petty/_transit, tapi
-- 'std_asset_current_receivable_trade' mengalahkan
-- 'std_asset_current_receivable'. TIDAK memakai nama/kode akun klien, jadi
-- akun baru yang punya standard_account_code otomatis ikut ter-mapping.
--
-- Kolom:
--   cash_flow_category  CASH      = kas & setara kas (pembentuk saldo kas)
--                       OPERATING = perubahan modal kerja (metode tidak langsung)
--                       NON_CASH  = penyesuaian non-kas (penyusutan, dll)
--                       INVESTING / FINANCING
--                       NULL      = akun laba rugi (masuk lewat laba bersih)
--   equity_component    kolom Statement of Changes in Equity
--   note_key            note CALK (management_fs_note_templates.note_key)
--
-- Per klien, mapping ini disalin/di-override di management_client_fs_mappings
-- (halaman Financial Statements > Mapping). Aman dijalankan ulang: aturan
-- yang sudah ada diperbarui.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_fs_mapping_rules.sql

INSERT INTO management_fs_mapping_rules
    (standard_account_code, cash_flow_category, cash_flow_line, equity_component, note_key, description)
VALUES
    -- ---------------- ASET LANCAR ----------------
    ('std_asset_current_cash',                     'CASH',      'Cash and cash equivalents',                                 NULL, 'cash',                 'Kas, bank, kas kecil, kas dalam perjalanan'),
    ('std_asset_current_receivable_trade',         'OPERATING', '(Increase)/decrease in trade receivables',                  NULL, 'receivables',          'Piutang usaha'),
    ('std_asset_current_receivable_allowance',     'OPERATING', '(Increase)/decrease in trade receivables',                  NULL, 'receivables',          'Cadangan kerugian piutang (kontra)'),
    ('std_asset_current_receivable_related_party', 'OPERATING', '(Increase)/decrease in other receivables',                  NULL, 'related_parties',      'Piutang pihak berelasi'),
    ('std_asset_current_receivable',               'OPERATING', '(Increase)/decrease in other receivables',                  NULL, 'receivables',          'Piutang lain-lain (karyawan, dll)'),
    ('std_asset_current_inventory',                'OPERATING', '(Increase)/decrease in inventories',                        NULL, 'inventories',          'Persediaan'),
    ('std_asset_current_prepayment',               'OPERATING', '(Increase)/decrease in prepayments and advances',           NULL, 'prepayments',          'Biaya dibayar dimuka'),
    ('std_asset_current_advance',                  'OPERATING', '(Increase)/decrease in prepayments and advances',           NULL, 'prepayments',          'Uang muka'),
    ('std_asset_current_tax',                      'OPERATING', '(Increase)/decrease in prepaid taxes',                      NULL, 'taxation',             'Pajak dibayar dimuka / PPN masukan'),
    ('std_asset_current_other',                    'OPERATING', '(Increase)/decrease in other current assets',               NULL, 'other_current_assets', 'Aset lancar lainnya'),
    ('std_asset_current',                          'OPERATING', '(Increase)/decrease in other current assets',               NULL, 'other_current_assets', 'Fallback aset lancar'),
    -- ---------------- ASET TIDAK LANCAR ----------------
    ('std_asset_noncurrent_ppe_accum_depreciation', 'NON_CASH', 'Depreciation and amortisation',                             NULL, 'fixed_assets',         'Akumulasi penyusutan (kontra)'),
    ('std_asset_noncurrent_accum_amortization',    'NON_CASH',  'Depreciation and amortisation',                             NULL, 'fixed_assets',         'Akumulasi amortisasi (kontra)'),
    ('std_asset_noncurrent_impairment_allowance',  'NON_CASH',  'Impairment losses',                                         NULL, 'fixed_assets',         'Cadangan penurunan nilai (kontra)'),
    ('std_asset_noncurrent_ppe',                   'INVESTING', 'Acquisition of property, plant and equipment',              NULL, 'fixed_assets',         'Aset tetap'),
    ('std_asset_noncurrent_intangible',            'INVESTING', 'Acquisition of intangible assets',                          NULL, 'fixed_assets',         'Aset tak berwujud'),
    ('std_asset_noncurrent_investment',            'INVESTING', 'Placement of investments',                                  NULL, 'investments',          'Investasi jangka panjang'),
    ('std_asset_noncurrent',                       'INVESTING', 'Other non-current assets',                                  NULL, 'other_current_assets', 'Fallback aset tidak lancar'),
    -- ---------------- LIABILITAS JANGKA PENDEK ----------------
    ('std_liability_current_payable_trade',        'OPERATING', 'Increase/(decrease) in trade payables',                     NULL, 'payables',             'Hutang usaha'),
    ('std_liability_current_payable',              'OPERATING', 'Increase/(decrease) in other payables',                     NULL, 'payables',             'Hutang lain-lain'),
    ('std_liability_current_tax',                  'OPERATING', 'Increase/(decrease) in taxes payable',                      NULL, 'taxation',             'Hutang pajak (PPh, PPN keluaran, dll)'),
    ('std_liability_current_accrued',              'OPERATING', 'Increase/(decrease) in accrued expenses',                   NULL, 'accruals',             'Biaya masih harus dibayar'),
    ('std_liability_current_deferred_revenue',     'OPERATING', 'Increase/(decrease) in contract liabilities',               NULL, 'accruals',             'Pendapatan diterima dimuka'),
    ('std_liability_current_borrowing',            'FINANCING', 'Proceeds from/(repayment of) borrowings',                   NULL, 'borrowings',           'Pinjaman jangka pendek'),
    ('std_liability_current_other',                'OPERATING', 'Increase/(decrease) in other current liabilities',          NULL, 'accruals',             'Liabilitas lancar lainnya'),
    ('std_liability_current',                      'OPERATING', 'Increase/(decrease) in other current liabilities',          NULL, 'accruals',             'Fallback liabilitas lancar'),
    -- ---------------- LIABILITAS JANGKA PANJANG ----------------
    ('std_liability_noncurrent_borrowing_related_party', 'FINANCING', 'Proceeds from/(repayment of) related party borrowings', NULL, 'related_parties',    'Pinjaman pihak berelasi'),
    ('std_liability_noncurrent_borrowing',         'FINANCING', 'Proceeds from/(repayment of) borrowings',                   NULL, 'borrowings',           'Pinjaman jangka panjang'),
    ('std_liability_noncurrent_lease',             'FINANCING', 'Payment of lease liabilities',                              NULL, 'borrowings',           'Liabilitas sewa'),
    ('std_liability_noncurrent_employee_benefit',  'NON_CASH',  'Provision for employee benefits',                           NULL, 'employee_benefits',    'Liabilitas imbalan kerja'),
    ('std_liability_noncurrent',                   'FINANCING', 'Other non-current liabilities',                             NULL, 'borrowings',           'Fallback liabilitas jangka panjang'),
    -- ---------------- EKUITAS ----------------
    ('std_equity_share_capital',                   'FINANCING', 'Capital injection',                                         'share_capital',              'equity', 'Modal saham / modal disetor'),
    ('std_equity_additional_paid_in_capital',      'FINANCING', 'Capital injection',                                         'additional_paid_in_capital', 'equity', 'Tambahan modal disetor / agio'),
    ('std_equity_owner_drawing',                   'FINANCING', 'Owner drawings and dividends paid',                         'owner_drawings',             'equity', 'Prive'),
    ('std_equity_dividend',                        'FINANCING', 'Owner drawings and dividends paid',                         'owner_drawings',             'equity', 'Dividen'),
    ('std_equity_retained_earnings',               'NON_CASH',  'Retained earnings adjustments',                             'retained_earnings',          'equity', 'Saldo laba / laba ditahan'),
    ('std_equity_current_period_earnings',         'NON_CASH',  'Retained earnings adjustments',                             'current_year_earnings',      'equity', 'Laba tahun berjalan (dihitung otomatis dari laba rugi)'),
    ('std_equity_oci',                             'NON_CASH',  'Other comprehensive income',                                'oci',                        'equity', 'Penghasilan komprehensif lain'),
    ('std_equity_other',                           'FINANCING', 'Other equity movements',                                    'other_equity',               'equity', 'Ekuitas lainnya'),
    ('std_equity',                                 'FINANCING', 'Other equity movements',                                    'other_equity',               'equity', 'Fallback ekuitas'),
    -- ---------------- LABA RUGI (cash flow lewat laba bersih) ----------------
    ('std_revenue',                                NULL,        NULL,                                                        NULL, 'revenue',              'Pendapatan usaha'),
    ('std_cost_of_sales',                          NULL,        NULL,                                                        NULL, 'cost_of_sales',        'Beban pokok penjualan'),
    ('std_expense',                                NULL,        NULL,                                                        NULL, 'operating_expenses',   'Beban usaha'),
    ('std_other_income',                           NULL,        NULL,                                                        NULL, 'other_income_expense', 'Pendapatan lain-lain'),
    ('std_other_expense',                          NULL,        NULL,                                                        NULL, 'other_income_expense', 'Beban lain-lain'),
    ('std_income_tax',                             NULL,        NULL,                                                        NULL, 'taxation',             'Beban pajak penghasilan')
ON CONFLICT (standard_account_code) DO UPDATE SET
    cash_flow_category = EXCLUDED.cash_flow_category,
    cash_flow_line     = EXCLUDED.cash_flow_line,
    equity_component   = EXCLUDED.equity_component,
    note_key           = EXCLUDED.note_key,
    description        = EXCLUDED.description;
