-- seed_coa_ym.sql
-- =============================================================
-- Master COA klien YM -> tabel management_client_coa (69 akun).
-- DIHASILKAN OTOMATIS oleh migrations/generate_seed_coa.py dari
-- dataset/COA/COA_Clients_GOUF.xlsx sheet "COA YM" -- JANGAN diedit
-- manual, ubah Excel-nya lalu generate ulang.
--
-- normal_balance diturunkan dari ACCOUNT CLASSIFICATION (+ akun kontra),
-- lihat generate_seed_coa.py::normal_balance().
--
-- KLIEN: dicari lewat nama_client IN ('YM', 'PT YONISO MASIKARA', 'PT. YONISO MANASIKARA'), GAGAL dengan pesan
-- jelas kalau belum ada. client_id/client_code TIDAK di-hardcode.
--
-- PRASYARAT: venv\Scripts\python migrations\16-create_management_client_coa.py
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_coa_ym.sql
--
-- Idempotensi: ON CONFLICT (client_id, acc_no) DO UPDATE -- aman dijalankan
-- ulang; isi akun ditimpa dari Excel, akun yang di-soft-delete tetap terhapus.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('YM', 'PT YONISO MASIKARA', 'PT. YONISO MANASIKARA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien YM belum ada di management_clients (dicari nama_client IN (''YM'', ''PT YONISO MASIKARA'', ''PT. YONISO MANASIKARA'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    INSERT INTO management_client_coa (
        client_id, client_code, acc_no, account_name, account_classification, account_head, account_sub, description, international_standard_group, standard_account_code, ifrs_taxonomy_reference, ifrs_source, normal_balance
    )
    SELECT v_client_id, v_client_code, v.*
    FROM (VALUES
        ('10001', 'Kas Kecil', 'ASSET', 'CURRENT ASSET', 'CASH & CASH EQUIVALENTS', 'Petty cash and cash on hand used for daily operational transactions.', 'Assets > Current assets > Cash and cash equivalents', 'std_asset_current_cash_petty', 'Cash and cash equivalents', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10002', 'Bank BNI', 'ASSET', 'CURRENT ASSET', 'CASH & CASH EQUIVALENTS', 'Cash held in bank accounts, including foreign-currency bank balances.', 'Assets > Current assets > Cash and cash equivalents', 'std_asset_current_cash_bank', 'Cash and cash equivalents', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10012', 'Bank Mandiri', 'ASSET', 'CURRENT ASSET', 'CASH & CASH EQUIVALENTS', 'Cash held in bank accounts, including foreign-currency bank balances.', 'Assets > Current assets > Cash and cash equivalents', 'std_asset_current_cash_bank', 'Cash and cash equivalents', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10013', 'Bank Silang', 'ASSET', 'CURRENT ASSET', 'CASH & CASH EQUIVALENTS', 'Cash held in bank accounts, including foreign-currency bank balances.', 'Assets > Current assets > Cash and cash equivalents', 'std_asset_current_cash_bank', 'Cash and cash equivalents', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10003', 'Piutang Usaha', 'ASSET', 'CURRENT ASSET', 'TRADE RECEIVABLES', 'Amounts receivable from customers arising from ordinary operating activities.', 'Assets > Current assets > Trade and other receivables', 'std_asset_current_receivable_trade', 'Trade and other current receivables', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10004', 'Piutang Pihak Istimewa', 'ASSET', 'CURRENT ASSET', 'OTHER RECEIVABLES', 'Other current receivables not classified as trade receivables.', 'Assets > Current assets > Trade and other receivables', 'std_asset_current_receivable_other', 'Trade and other current receivables', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10005', 'Persediaan', 'ASSET', 'CURRENT ASSET', 'INVENTORIES', 'Inventories, supplies, raw materials, or goods held for sale or consumption.', 'Assets > Current assets > Inventories', 'std_asset_current_inventory', 'Inventories', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10006', 'Tanah dan Bangunan', 'ASSET', 'NON-CURRENT ASSET', 'PROPERTY, PLANT & EQUIPMENT', 'Land held for operational use.', 'Assets > Non-current assets > Property, plant and equipment', 'std_asset_noncurrent_ppe_land', 'Property, plant and equipment', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10007', 'Peralatan', 'ASSET', 'NON-CURRENT ASSET', 'PROPERTY, PLANT & EQUIPMENT', 'Machinery, office equipment, kitchen equipment, furniture, fixtures, and other operational equipment.', 'Assets > Non-current assets > Property, plant and equipment', 'std_asset_noncurrent_ppe_equipment', 'Property, plant and equipment', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10008', 'Kendaraan', 'ASSET', 'NON-CURRENT ASSET', 'PROPERTY, PLANT & EQUIPMENT', 'Vehicles used in operations.', 'Assets > Non-current assets > Property, plant and equipment', 'std_asset_noncurrent_ppe_vehicle', 'Property, plant and equipment', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10009', 'Aktiva Tetap Lainnya', 'ASSET', 'NON-CURRENT ASSET', 'PROPERTY, PLANT & EQUIPMENT', 'Machinery, office equipment, kitchen equipment, furniture, fixtures, and other operational equipment.', 'Assets > Non-current assets > Property, plant and equipment', 'std_asset_noncurrent_ppe_equipment', 'Property, plant and equipment', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('10010', 'Akumulasi Penyusutan', 'ASSET', 'NON-CURRENT ASSET', 'ACCUMULATED DEPRECIATION', 'Contra-asset accumulated depreciation related to property, plant and equipment.', 'Assets > Non-current assets > Property, plant and equipment', 'std_asset_noncurrent_ppe_accum_depreciation', 'Accumulated depreciation and impairment', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('10011', 'Pre Opening Expense', 'EXPENSE', 'OPERATING EXPENSE', 'PRE-OPERATING EXPENSE', 'Pre-opening or pre-operational costs expensed as incurred unless capitalization criteria are met.', 'Expenses > Operating expenses', 'std_expense_operating_preoperating', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('20001', 'Utang Usaha', 'LIABILITY', 'CURRENT LIABILITY', 'TRADE PAYABLES', 'Amounts payable to suppliers for goods and services received in the ordinary course of business.', 'Liabilities > Current liabilities > Trade and other payables', 'std_liability_current_payable_trade', 'Trade and other current payables', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('20002', 'Utang Biaya', 'LIABILITY', 'CURRENT LIABILITY', 'ACCRUED EXPENSES', 'Expenses incurred but not yet invoiced or paid.', 'Liabilities > Current liabilities > Trade and other payables', 'std_liability_current_accrued_expense', 'Accruals and other current payables', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('20003', 'Utang Pajak', 'LIABILITY', 'CURRENT LIABILITY', 'TAX PAYABLES', 'Income tax withholding, installments, or corporate income tax payable.', 'Liabilities > Current liabilities > Current tax liabilities', 'std_liability_current_tax_income_payable', 'Current tax liabilities', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('20004', 'Utang Lainnya', 'LIABILITY', 'CURRENT LIABILITY', 'OTHER PAYABLES', 'Other short-term payables and unsettled liabilities.', 'Liabilities > Current liabilities > Trade and other payables', 'std_liability_current_payable_other', 'Trade and other current payables', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('21001', 'Utang Pemegang Saham', 'LIABILITY', 'NON-CURRENT LIABILITY', 'RELATED PARTY BORROWINGS', 'Borrowings from shareholders or related parties, generally non-current unless contractually due within twelve months.', 'Liabilities > Non-current liabilities > Borrowings / related-party liabilities', 'std_liability_noncurrent_borrowing_related_party', 'Non-current borrowings', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('21002', 'Utang Bank', 'LIABILITY', 'CURRENT LIABILITY', 'BORROWINGS', 'Short-term loans, overdrafts, and current portions of borrowings.', 'Liabilities > Current liabilities > Borrowings', 'std_liability_current_borrowing', 'Current borrowings', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('30001', 'Modal Awal', 'EQUITY', 'EQUITY', 'SHARE CAPITAL', 'Issued and paid-in share capital or owners'' capital.', 'Equity > Share capital', 'std_equity_share_capital', 'Issued capital', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('30002', 'Modal di Setor', 'EQUITY', 'EQUITY', 'OTHER EQUITY', 'Other equity balances not separately classified.', 'Equity > Other equity', 'std_equity_other', 'Other equity', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('30003', 'Laba Ditahan', 'EQUITY', 'EQUITY', 'RETAINED EARNINGS', 'Accumulated retained earnings or accumulated losses from prior periods.', 'Equity > Retained earnings', 'std_equity_retained_earnings', 'Retained earnings', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('30004', 'Rugi/Laba Ditahan Tahun Lalu', 'EQUITY', 'EQUITY', 'RETAINED EARNINGS', 'Accumulated retained earnings or accumulated losses from prior periods.', 'Equity > Retained earnings', 'std_equity_retained_earnings', 'Retained earnings', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('30005', 'Laba Tahun Berjalan', 'EQUITY', 'EQUITY', 'CURRENT PERIOD EARNINGS', 'Current period profit or loss carried within equity before closing.', 'Equity > Retained earnings / current period result', 'std_equity_current_period_earnings', 'Retained earnings / profit or loss', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('A', 'REVENUE', 'REVENUE', 'OPERATING REVENUE', 'OTHER OPERATING REVENUE', 'Other revenue generated from ordinary operating activities.', 'Income > Revenue', 'std_revenue_operating_other', 'Revenue', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('40001', 'Pendapatan Diving', 'REVENUE', 'OPERATING REVENUE', 'OTHER OPERATING REVENUE', 'Other revenue generated from ordinary operating activities.', 'Income > Revenue', 'std_revenue_operating_other', 'Revenue', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('40002', 'Pendapatan Room', 'REVENUE', 'OPERATING REVENUE', 'HOSPITALITY REVENUE', 'Room, accommodation, and related hospitality revenue.', 'Income > Revenue', 'std_revenue_operating_hospitality', 'Revenue', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('40003', 'Pendapatan Extra', 'REVENUE', 'OPERATING REVENUE', 'OTHER OPERATING REVENUE', 'Other revenue generated from ordinary operating activities.', 'Income > Revenue', 'std_revenue_operating_other', 'Revenue', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'CREDIT'),
        ('50000', 'HPP', 'COST OF SALES', 'COST OF REVENUE', 'OTHER COST OF SALES', 'Other direct costs attributable to generating revenue.', 'Expenses > Cost of sales / cost of revenue', 'std_cost_of_sales_other', 'Cost of sales', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('B', 'EXPENSES :', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50001', 'Salary', 'EXPENSE', 'OPERATING EXPENSE', 'SALARIES & WAGES', 'Salaries, wages, payroll, and regular employee compensation.', 'Expenses > Employee benefits expense', 'std_expense_operating_salary_wages', 'Employee benefits expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50002', 'Bonus/Lembur/Tunjangan/THR', 'EXPENSE', 'OPERATING EXPENSE', 'BONUS & OVERTIME', 'Bonuses, overtime, incentives, and holiday allowances.', 'Expenses > Employee benefits expense', 'std_expense_operating_bonus_overtime', 'Employee benefits expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50003', 'BPJS Kesehatan', 'EXPENSE', 'OPERATING EXPENSE', 'EMPLOYEE BENEFITS', 'Employee benefits, allowances, social security, health, and welfare costs.', 'Expenses > Employee benefits expense', 'std_expense_operating_employee_benefits', 'Employee benefits expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50031', 'BPJS Ketenagakerjaan', 'EXPENSE', 'OPERATING EXPENSE', 'EMPLOYEE BENEFITS', 'Employee benefits, allowances, social security, health, and welfare costs.', 'Expenses > Employee benefits expense', 'std_expense_operating_employee_benefits', 'Employee benefits expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50032', 'Tunjangan Pajak', 'EXPENSE', 'OPERATING EXPENSE', 'EMPLOYEE BENEFITS', 'Employee benefits, allowances, social security, health, and welfare costs.', 'Expenses > Employee benefits expense', 'std_expense_operating_employee_benefits', 'Employee benefits expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50004', 'Biaya Listrik dan Air', 'EXPENSE', 'OPERATING EXPENSE', 'UTILITIES', 'Electricity, water, gas, power, and other utility costs.', 'Expenses > Operating expenses', 'std_expense_operating_utilities', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50005', 'Biaya Telepon dan Pulsa', 'EXPENSE', 'OPERATING EXPENSE', 'COMMUNICATION & INTERNET', 'Telephone, internet, communication, and connectivity costs.', 'Expenses > Operating expenses', 'std_expense_operating_communication', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50006', 'Biaya Internet', 'EXPENSE', 'OPERATING EXPENSE', 'COMMUNICATION & INTERNET', 'Telephone, internet, communication, and connectivity costs.', 'Expenses > Operating expenses', 'std_expense_operating_communication', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50007', 'Biaya Restoran Food', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50008', 'Biaya Restoran Beverage and Gas (Fuel)', 'EXPENSE', 'OPERATING EXPENSE', 'TRANSPORT & TRAVEL', 'Fuel, toll, parking, transportation, vehicle operating costs, and business travel.', 'Expenses > Operating expenses', 'std_expense_operating_transport_travel', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50009', 'Biaya Spa', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50010', 'Biaya Diving (Karcis Tour, Retribusi dan Parkir)', 'EXPENSE', 'OPERATING EXPENSE', 'TRANSPORT & TRAVEL', 'Fuel, toll, parking, transportation, vehicle operating costs, and business travel.', 'Expenses > Operating expenses', 'std_expense_operating_transport_travel', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50024', 'Biaya Land (Karcis Tour, Tol, Retribusi dan Parkir)', 'EXPENSE', 'OPERATING EXPENSE', 'TRANSPORT & TRAVEL', 'Fuel, toll, parking, transportation, vehicle operating costs, and business travel.', 'Expenses > Operating expenses', 'std_expense_operating_transport_travel', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50011', 'Biaya Eat For Guest and Driver', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50012', 'Biaya Kebutuhan Kantor', 'EXPENSE', 'OPERATING EXPENSE', 'OFFICE & ADMINISTRATION', 'Office supplies, stationery, printing, administration, and general office costs.', 'Expenses > Operating expenses', 'std_expense_operating_office_admin', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50013', 'Biaya Laundry', 'EXPENSE', 'OPERATING EXPENSE', 'LAUNDRY & LINEN', 'Laundry, linen, and related hospitality operating costs.', 'Expenses > Operating expenses', 'std_expense_operating_laundry_linen', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50014', 'Biaya Religion', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50015', 'B. Perlengkapan dan Kebersihan Lingkungan', 'EXPENSE', 'OPERATING EXPENSE', 'CLEANING & SECURITY', 'Cleaning, security, waste removal, and related facility-support costs.', 'Expenses > Operating expenses', 'std_expense_operating_cleaning_security', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50016', 'Biaya Bahan Bakar Minyak (KAPAL)', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50017', 'Biaya Bahan Bakar Minyak (MOBIL & SEPEDA)', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50018', 'Biaya Donation / Sumbangan, Iuran Banjar', 'EXPENSE', 'OPERATING EXPENSE', 'DONATION & COMMUNITY', 'Donations and community-related expenditure.', 'Expenses > Other operating expenses', 'std_expense_operating_donation', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50019', 'Biaya Pemeliharaan Bangunan', 'EXPENSE', 'OPERATING EXPENSE', 'REPAIR & MAINTENANCE', 'Repair, maintenance, and upkeep of buildings, vehicles, equipment, and facilities.', 'Expenses > Operating expenses', 'std_expense_operating_repair_maintenance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50020', 'Biaya Pemeliharaan Peralatan', 'EXPENSE', 'OPERATING EXPENSE', 'REPAIR & MAINTENANCE', 'Repair, maintenance, and upkeep of buildings, vehicles, equipment, and facilities.', 'Expenses > Operating expenses', 'std_expense_operating_repair_maintenance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50021', 'Biaya Pemeliharaan Kapal', 'EXPENSE', 'OPERATING EXPENSE', 'REPAIR & MAINTENANCE', 'Repair, maintenance, and upkeep of buildings, vehicles, equipment, and facilities.', 'Expenses > Operating expenses', 'std_expense_operating_repair_maintenance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50022', 'Biaya Pemeliharaan Kendaraan', 'EXPENSE', 'OPERATING EXPENSE', 'REPAIR & MAINTENANCE', 'Repair, maintenance, and upkeep of buildings, vehicles, equipment, and facilities.', 'Expenses > Operating expenses', 'std_expense_operating_repair_maintenance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50023', 'Biaya Pemeliharaan Kolam Renang', 'EXPENSE', 'OPERATING EXPENSE', 'REPAIR & MAINTENANCE', 'Repair, maintenance, and upkeep of buildings, vehicles, equipment, and facilities.', 'Expenses > Operating expenses', 'std_expense_operating_repair_maintenance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50025', 'Biaya Sewa Kos, Peralatan, Kendaraan, Dll.', 'EXPENSE', 'OPERATING EXPENSE', 'RENT EXPENSE', 'Rent and operating lease expenses not capitalized under applicable accounting requirements.', 'Expenses > Operating expenses', 'std_expense_operating_rent', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50026', 'Biaya Merchandiser', 'EXPENSE', 'OPERATING EXPENSE', 'MARKETING & PROMOTION', 'Advertising, promotion, marketing, sales commission, and partnership costs.', 'Expenses > Operating expenses', 'std_expense_operating_marketing', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50027', 'Biaya Administrasi dan Transfer Bank', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50028', 'Biaya Komisi', 'EXPENSE', 'OPERATING EXPENSE', 'MARKETING & PROMOTION', 'Advertising, promotion, marketing, sales commission, and partnership costs.', 'Expenses > Operating expenses', 'std_expense_operating_marketing', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50029', 'Biaya Homestay', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('50030', 'Biaya Lain-Lain', 'EXPENSE', 'OPERATING EXPENSE', 'OTHER OPERATING EXPENSE', 'Other operating expense not separately classified.', 'Expenses > Operating expenses', 'std_expense_operating_other', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60001', 'Biaya Amortisasi Sewa Tanah', 'EXPENSE', 'OPERATING EXPENSE', 'AMORTISATION', 'Amortisation expense for intangible assets, leasehold rights, or deferred costs where applicable.', 'Expenses > Depreciation and amortisation expense', 'std_expense_operating_amortisation', 'Depreciation and amortisation expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60002', 'Biaya Penyusutan Bangunan', 'EXPENSE', 'OPERATING EXPENSE', 'DEPRECIATION', 'Depreciation expense for property, plant and equipment.', 'Expenses > Depreciation and amortisation expense', 'std_expense_operating_depreciation', 'Depreciation and amortisation expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60003', 'Biaya Asuransi', 'EXPENSE', 'OPERATING EXPENSE', 'INSURANCE', 'Insurance premiums and related insurance expense.', 'Expenses > Operating expenses', 'std_expense_operating_insurance', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60004', 'Biaya Keperluan Pribadi Ibu Laila', 'EXPENSE', 'OTHER / NON-OPERATING EXPENSE', 'OWNER / PERSONAL EXPENSE', 'Personal or owner-related expenditure requiring review for accounting and tax treatment.', 'Expenses > Other expenses', 'std_expense_other_owner_personal', 'Other expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60005', 'Biaya Perijinan', 'EXPENSE', 'OPERATING EXPENSE', 'TAXES & LICENSES', 'Non-income taxes, licenses, permits, and levies expensed in operations.', 'Expenses > Operating expenses', 'std_expense_operating_tax_license', 'Other operating expenses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('60006', 'Laba/Rugi Selisih Kurs', 'OTHER EXPENSE', 'NON-OPERATING EXPENSE', 'FOREIGN EXCHANGE LOSS', 'Realized or unrealized foreign exchange losses.', 'Expenses > Other expenses', 'std_other_expense_fx_loss', 'Foreign exchange losses', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT'),
        ('70001', 'Biaya Pajak', 'INCOME TAX', 'INCOME TAX EXPENSE', 'INCOME TAX EXPENSE', 'Current and deferred income tax expense recognized in profit or loss.', 'Expenses > Income tax expense', 'std_income_tax_expense', 'Income tax expense', 'https://www.ifrs.org/issued-standards/ifrs-taxonomy/', 'DEBIT')
    ) AS v(acc_no, account_name, account_classification, account_head, account_sub, description, international_standard_group, standard_account_code, ifrs_taxonomy_reference, ifrs_source, normal_balance)
    ON CONFLICT (client_id, acc_no) DO UPDATE SET
        account_name = EXCLUDED.account_name,
        account_classification = EXCLUDED.account_classification,
        account_head = EXCLUDED.account_head,
        account_sub = EXCLUDED.account_sub,
        description = EXCLUDED.description,
        international_standard_group = EXCLUDED.international_standard_group,
        standard_account_code = EXCLUDED.standard_account_code,
        ifrs_taxonomy_reference = EXCLUDED.ifrs_taxonomy_reference,
        ifrs_source = EXCLUDED.ifrs_source,
        normal_balance = EXCLUDED.normal_balance,
        client_code = EXCLUDED.client_code,
        edited_at = now();
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT m.nama_client, count(*) FROM management_client_coa c
-- JOIN management_clients m ON m.id = c.client_id
-- WHERE c.deleted_at IS NULL GROUP BY m.nama_client;
