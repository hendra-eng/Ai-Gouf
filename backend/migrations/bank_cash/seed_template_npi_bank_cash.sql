-- seed_template_npi_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings,
-- migration 36) untuk klien NPI (PT Nusa Penida Investments), hasil analisis
-- file contoh:
--   dataset/Bank Cash/NPI/NPI_OCBC.pdf
--   dataset/Bank Cash/NPI/NPI_MANDIRI.pdf
--
-- Hasil ekstraksi (modules/transactions/bank_statement_extractor.py) atas
-- kedua file contoh periode Juni 2026 -- SEMUA "verified" 100%: saldo
-- berjalan per baris cocok + total resmi di dokumen cocok:
--
--   | File            | Jalur | Baris | Saldo awal    | Saldo akhir   | Cek resmi                                       |
--   |-----------------|-------|-------|---------------|---------------|-------------------------------------------------|
--   | OCBC (IDR)      | grid  |    60 |     23.065,00 |    728.335,00 | Total Debit / Total Credit + saldo akhir        |
--   | Mandiri (Kopra) | words |   431 | 42.894.694,93 | 51.408.327,55 | total + No. of Debit 281 / No. of Credit 150    |
--
-- BENTUK FILE per template:
--   OCBC    -- PDF OCBC (Velocity), tabel bergaris -> jalur grid. Kolom:
--              Transaction Date | Value Date | Reference No. | Cheque No. |
--              Description | Debit | Credit | Balance. Tanggal "dd/mm/yyyy"
--              (jam di bawahnya diabaikan), Value Date & Cheque No. diabaikan.
--              Ringkasan di header TIAP halaman (Opening/Closing Balance, Total
--              Debit/Credit), periode "FROM : 2026-06-01 TO : 2026-06-30".
--              Nama bank TIDAK tercetak sebagai teks (hanya logo) -> label
--              "OCBC" diambil dari template (mapping_rules.bank_name).
--   Mandiri -- PDF Kopra by Mandiri, layout SAMA dengan Mandiri SAU (signature
--              header sama) -- sel rata-tengah vertikal digabung per blok,
--              ringkasan di halaman 1. Template dibuat ulang per klien karena
--              template disimpan per client_id.
--
-- MAPPING BANK (akun COA NPI, lihat seed_coa_npi.sql):
--   OCBC    rek. 163800007094 (IDR) -> 1-1102 OCBC IDR #7094
--   Mandiri rek. 1750003319273      -> 1-1103 Mandiri Resto #9273
-- Rekening lain NPI (Mandiri #265 / Shop #5108 / Deli #5058 / Deli Grocery,
-- OCBC EURO) belum punya contoh file -> mapping-nya otomatis tersimpan saat
-- pertama kali di-upload dengan akun dipilih manual di Bank Feed.
-- Upload di Bank Feed dengan pilihan akun "Auto-detect" memakai mapping ini
-- (urutan cocok: nomor rekening > kata kunci judul > template > nama bank).
--
-- column_signature_hash = SHA-256 dari header tabel yang dinormalisasi
-- (bank_statement_extractor.signature_header). mapping_rules = format
-- Aturan.ke_dict (columns/role, amount_mode, default_direction,
-- number_format, date_order, method, bank_name).
--
-- KLIEN: dicari lewat nama_client ('NPI' / 'PT NUSA PENIDA INVESTMENTS'), GAGAL
-- dengan pesan jelas kalau belum ada. Akun COA dicari lewat acc_no di
-- management_client_coa klien itu (GAGAL kalau COA NPI belum di-seed).
-- client_id / client_code / coa id TIDAK di-hardcode.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py seed_template_npi_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT DO NOTHING supaya run-2x gagal jelas
-- (UNIQUE uq_bank_cash_import_templates_signature), bukan diam-diam ke-skip.
-- Untuk menjalankan ulang, hapus dulu:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS')
--      AND t.column_signature_hash IN (
--        '5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4',
--        'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31');

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_coa_ocbc    UUID;
    v_coa_mandiri UUID;
    v_tpl_ocbc    UUID;
    v_tpl_mandiri UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari nama_client IN (''NPI'', ''PT NUSA PENIDA INVESTMENTS'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_ocbc    FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1102' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mandiri FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1103' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_ocbc IS NULL OR v_coa_mandiri IS NULL THEN
        RAISE EXCEPTION 'Akun COA NPI 1-1102 (OCBC IDR #7094) / 1-1103 (Mandiri Resto #9273) belum lengkap -- jalankan dulu seed_coa_npi.sql.';
    END IF;

    -- ---------------------------------------------------------
    -- Template ekstraksi
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'OCBC - Account Statement IDR (PDF)', 'PDF', NULL, 1, 2,
        '5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4',
        '["Transaction Date", "Value Date", "Reference No.", "Cheque No.", "Description", "Debit", "Credit", "Balance"]'::jsonb,
        '{"columns": [{"header": "Transaction Date", "role": "date"}, {"header": "Value Date", "role": "ignore"}, {"header": "Reference No.", "role": "reference"}, {"header": "Cheque No.", "role": "ignore"}, {"header": "Description", "role": "description"}, {"header": "Debit", "role": "debit"}, {"header": "Credit", "role": "credit"}, {"header": "Balance", "role": "balance"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "grid", "bank_name": "OCBC"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_ocbc;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'Mandiri - Kopra Account Statement (PDF)', 'PDF', NULL, 1, 2,
        'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31',
        '["Posting Date", "Remark", "Reference No.", "Debit", "Credit", "Balance"]'::jsonb,
        '{"columns": [{"header": "Posting Date", "role": "date"}, {"header": "Remark", "role": "description"}, {"header": "Reference No.", "role": "reference"}, {"header": "Debit", "role": "debit"}, {"header": "Credit", "role": "credit"}, {"header": "Balance", "role": "balance"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "words", "bank_name": "Mandiri"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_mandiri;

    -- ---------------------------------------------------------
    -- Mapping bank -> akun COA
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'OCBC', '163800007094', NULL, v_coa_ocbc, v_tpl_ocbc,
         'Rekening OCBC IDR a.n. PT. NUSA PENIDA INVESTMENTS.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1750003319273', NULL, v_coa_mandiri, v_tpl_mandiri,
         'Rekening Mandiri KCP Legian (Kopra) a.n. NUSA PENIDA INVESTME -- resto.', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name, t.template_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- LEFT JOIN financial_transaction_bank_cash_import_templates t ON t.id = m.template_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(c.nama_client) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS') AND m.deleted_at IS NULL;
