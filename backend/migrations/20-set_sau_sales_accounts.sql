-- 20-set_sau_sales_accounts.sql
-- =============================================================
-- Akun jurnal Sales SAU mengikuti master COA SAU (seed_coa_sau.sql).
-- Sebelumnya semua invoice Sales memakai akun hardcode FE/backend
-- (1120-01 Piutang, 4100-01 Pendapatan, 2100-01 PPN Keluaran) yang tidak
-- ada di COA klien mana pun -- termasuk 2 invoice SAU yang sudah Posted.
--
-- Akun SAU:
--   Dr Piutang      11300003 PIUTANG USAHA
--   Cr Pendapatan   per cabang: CRS 41110001, NGY 41110002, OL 41110003,
--                   PCL 41110004; tanpa cabang -> 41110098 PENJUALAN
--   Cr PPN Keluaran 21400006 PAJAK KELUARAN
--
-- Yang diubah:
--   1. mapping_rules SEMUA template import Sales SAU (piutang_account,
--      pendapatan_account, pendapatan_account_by_cabang, ppn_account) --
--      dibaca db_client.akun_default_sales(); invoice baru otomatis dapat
--      mapping akun ini.
--   2. Invoice SAU yang belum punya account mapping dibuatkan mapping.
--      Invoice yang sudah Posted ikut -- jurnal GL dihitung live dari
--      mapping, jadi laporan keuangannya otomatis pindah ke akun COA SAU.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py 20-set_sau_sales_accounts.sql
--
-- Idempotensi: aman dijalankan ulang (template ditimpa nilai sama; mapping
-- hanya dibuat untuk invoice yang BELUM punya mapping -- mapping yang sudah
-- diubah user di Journal Preview tidak disentuh).

DO $do$
DECLARE
    v_client_id UUID;
    v_by_cabang JSONB := '{
        "CRS": {"account_code": "41110001", "account_name": "PENJUALAN CRS"},
        "NGY": {"account_code": "41110002", "account_name": "PENJUALAN NGY"},
        "OL":  {"account_code": "41110003", "account_name": "PENJUALAN OL"},
        "PCL": {"account_code": "41110004", "account_name": "PENJUALAN PCL"}
    }'::jsonb;
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

    -- 1) Template import Sales SAU
    UPDATE financial_transaction_sales_import_templates
       SET mapping_rules = mapping_rules || jsonb_build_object(
             'piutang_account', '{"account_code": "11300003", "account_name": "PIUTANG USAHA"}'::jsonb,
             'pendapatan_account', '{"account_code": "41110098", "account_name": "PENJUALAN"}'::jsonb,
             'pendapatan_account_by_cabang', v_by_cabang,
             'ppn_account', '{"account_code": "21400006", "account_name": "PAJAK KELUARAN"}'::jsonb
           ),
           edited_at = now()
     WHERE client_id = v_client_id
       AND deleted_at IS NULL;

    -- 2) Mapping untuk invoice SAU yang belum punya
    INSERT INTO financial_transaction_sales_account_mappings (
        client_id, invoice_id,
        piutang_account_code, piutang_account_name,
        pendapatan_account_code, pendapatan_account_name,
        ppn_account_code, ppn_account_name,
        is_ai_suggested
    )
    SELECT i.client_id, i.id,
           '11300003', 'PIUTANG USAHA',
           COALESCE(v_by_cabang -> upper(trim(i.cabang)) ->> 'account_code', '41110098'),
           COALESCE(v_by_cabang -> upper(trim(i.cabang)) ->> 'account_name', 'PENJUALAN'),
           '21400006', 'PAJAK KELUARAN',
           false
      FROM financial_transaction_sales_invoices i
     WHERE i.management_client_id = v_client_id
       AND i.deleted_at IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM financial_transaction_sales_account_mappings m
              WHERE m.invoice_id = i.id
           );
END
$do$;

-- Verifikasi:
-- SELECT pendapatan_account_code, count(*) FROM financial_transaction_sales_account_mappings
-- WHERE deleted_at IS NULL GROUP BY 1;
