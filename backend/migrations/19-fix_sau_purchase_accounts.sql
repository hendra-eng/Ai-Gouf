-- 19-fix_sau_purchase_accounts.sql
-- =============================================================
-- Akun posting Purchase SAU disesuaikan dengan master COA SAU
-- (management_client_coa, seed_coa_sau.sql). Sebelumnya:
--   - baris pembelian -> 11400001 "PERSEDIAAN BARANG DAGANG" (ASUMSI, tidak ada di COA SAU)
--   - Hutang Usaha    -> 2100 (hardcode, tidak ada di COA SAU)
--   - PPN Masukan     -> 1300 (hardcode, tidak ada di COA SAU)
-- Sekarang:
--   - baris per cabang (Dept.): CRS 11500001, NGY 11500002, OL 11500003,
--     PCL 11500004; cabang lain -> 11500099 PERSEDIAAN
--   - Hutang Usaha 21200001 HUTANG USAHA
--   - PPN Masukan  11300998 PAJAK MASUKAN
--
-- Yang diubah:
--   1. mapping_rules template "Data Pembelian Detail" SAU (line_account,
--      biaya_account, line_account_by_dept, ap_account, tax_account) --
--      upload berikutnya otomatis pakai akun ini.
--   2. Purchase Transaction SAU hasil import yang BELUM diposting: kolom
--      ap_account_* / tax_account_* + akun baris 11400001 -> akun cabang.
--
-- PRASYARAT: migrations 18-add_posting_accounts_to_purchase_transactions.py
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py 19-fix_sau_purchase_accounts.sql
--
-- Idempotensi: aman dijalankan ulang (hanya menimpa ke nilai yang sama).

DO $do$
DECLARE
    v_client_id UUID;
    v_akun_dept JSONB := '{
        "CRS": {"account_code": "11500001", "account_name": "PERSEDIAAN CRS"},
        "NGY": {"account_code": "11500002", "account_name": "PERSEDIAAN NGY"},
        "OL":  {"account_code": "11500003", "account_name": "PERSEDIAAN OL"},
        "PCL": {"account_code": "11500004", "account_name": "PERSEDIAAN PCL"}
    }'::jsonb;
    v_akun_default JSONB := '{"account_code": "11500099", "account_name": "PERSEDIAAN"}'::jsonb;
BEGIN
    SELECT id INTO v_client_id
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients.';
    END IF;

    -- 1) Template import
    UPDATE financial_transaction_purchase_import_templates
       SET mapping_rules = mapping_rules
             || jsonb_build_object(
                  'line_account', v_akun_default,
                  'biaya_account', v_akun_default,
                  'line_account_by_dept', v_akun_dept,
                  'ap_account', '{"account_code": "21200001", "account_name": "HUTANG USAHA"}'::jsonb,
                  'tax_account', '{"account_code": "11300998", "account_name": "PAJAK MASUKAN"}'::jsonb
                ),
           edited_at = now()
     WHERE client_id = v_client_id
       AND column_signature_hash = 'f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64'
       AND deleted_at IS NULL;

    -- 2a) Akun Hutang & PPN transaksi SAU hasil import yang belum diposting
    UPDATE financial_transaction_purchase_transactions
       SET ap_account_code = '21200001', ap_account_name = 'HUTANG USAHA',
           tax_account_code = '11300998', tax_account_name = 'PAJAK MASUKAN',
           edited_at = now()
     WHERE management_client_id = v_client_id
       AND source_doc_type = 'Import'
       AND lower(status) <> 'posted'
       AND deleted_at IS NULL;

    -- 2b) Akun baris: 11400001 -> persediaan cabang (Dept. dibaca dari notes "Dept: XXX")
    UPDATE financial_transaction_purchase_transaction_lines l
       SET account_code = COALESCE(v_akun_dept -> d.dept ->> 'account_code', v_akun_default ->> 'account_code'),
           account_name = COALESCE(v_akun_dept -> d.dept ->> 'account_name', v_akun_default ->> 'account_name'),
           edited_at = now()
      FROM (
            SELECT id, upper(substring(notes from '^Dept: ([^;]+)')) AS dept
              FROM financial_transaction_purchase_transactions
             WHERE management_client_id = v_client_id
               AND source_doc_type = 'Import'
               AND lower(status) <> 'posted'
               AND deleted_at IS NULL
           ) d
     WHERE l.transaction_id = d.id
       AND l.account_code = '11400001'
       AND l.deleted_at IS NULL;
END
$do$;

-- Verifikasi:
-- SELECT account_code, account_name, count(*) FROM financial_transaction_purchase_transaction_lines
-- WHERE deleted_at IS NULL GROUP BY 1, 2;
