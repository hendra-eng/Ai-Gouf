-- seed_template_nbm_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings,
-- migration 36) untuk klien NBM (PT Nawasanga Bertatap Muka), hasil analisis
-- file contoh:
--   dataset/Bank Cash/NBM/NBM_BCA.pdf
--   dataset/Bank Cash/NBM/NBM_BCA.csv
--   dataset/Bank Cash/NBM/NBM__BRI.pdf
--   dataset/Bank Cash/NBM/NBM__BRI.csv
--
-- Hasil ekstraksi (modules/transactions/bank_statement_extractor.py) -- SEMUA
-- "verified" 100% (saldo berjalan per baris cocok + total resmi kalau ada):
--
--   | File          | Rekening        | Periode  | Jalur | Baris | Saldo awal    | Saldo akhir   | Cek resmi                              |
--   |---------------|-----------------|----------|-------|-------|---------------|---------------|----------------------------------------|
--   | BCA PDF       | 5325107836      | Jun 2026 | words |    34 | 50.536.392,99 | 59.299.617,95 | MUTASI CR 31 / DB 3 + total            |
--   | BCA CSV       | 1350838208      | Jun 2026 | table |   344 | 19.233.714,86 | 18.907.777,71 | Mutasi Debet 123 / Kredit 221 + total  |
--   | BRI PDF       | 059001001642303 | Jun 2026 | words |    80 | 44.315.363,60 | 40.371.281,60 | total debet/kredit (blok kolom footer) |
--   | BRI CSV       | 59001001642303  | Agu 2026 | table |   103 | 63.834.752,60 | 58.801.680,60 | saldo sebelum + sesudah tiap baris     |
--
-- BENTUK FILE per template:
--   BCA PDF -- rekening koran Tahapan Xpresi, layout SAMA dengan BCA SAU (signature
--              header sama): 1 kolom MUTASI + penanda "DB", tanggal "dd/mm".
--   BCA CSV -- export KlikBCA Bisnis "Informasi Rekening - Mutasi Rekening": judul
--              (No. rekening / Nama / Periode) di baris 1-6, HEADER baris 7, data
--              mulai baris 8. Kolom Jumlah berakhiran "CR"/"DB", ringkasan di bawah
--              tabel ("Saldo Awal", "Mutasi Debet : x","123", ...). Nama bank tidak
--              tercetak -> label "BCA" dari template.
--   BRI PDF -- Laporan Transaksi Finansial (IBBIZ), layout SAMA dengan BRI SAU.
--              Ringkasan blok kolom langsung di bawah transaksi terakhir.
--   BRI CSV -- export core banking BRI (ID, NOREK, TGL_TRAN, ... SALDO_AWAL_MUTASI,
--              MUTASI_DEBET, MUTASI_KREDIT, SALDO_AKHIR_MUTASI, ... REMARK_CUSTOM),
--              tanpa judul & ringkasan. SALDO_AWAL_MUTASI = saldo SEBELUM transaksi
--              (peran "balance_before" -> saldo awal dari baris pertama),
--              SALDO_AKHIR_MUTASI = saldo berjalan. DESK_TRAN = keterangan (termasuk
--              "AMT:..MDR:.." nominal bruto & MDR QRIS/EDC). Nomor rekening dari
--              kolom NOREK (nol di depan hilang -> mapping dicocokkan tanpa nol depan),
--              periode = tanggal transaksi pertama s/d terakhir. Label "BRI" dari template.
--
-- MAPPING BANK (akun COA NBM, lihat seed_coa_nbm.sql):
--   BCA rek. 5325107836      -> 1-10006 BCA # 5325107836
--   BCA rek. 1350838208      -> 1-10007 BCA # 1350838208
--   BRI rek. 059001001642303 -> 1-10008 BRI # 059001001642303 (PDF & CSV)
-- Rekening BRI # 059001001757302 (1-10011) belum ada contoh file -> mapping-nya
-- tersimpan otomatis saat pertama kali di-upload dengan akun dipilih manual.
-- Upload di Bank Feed dengan pilihan akun "Auto-detect" memakai mapping ini
-- (urutan cocok: nomor rekening > kata kunci judul > template > nama bank).
--
-- column_signature_hash = SHA-256 dari header tabel yang dinormalisasi
-- (bank_statement_extractor.signature_header). mapping_rules = format
-- Aturan.ke_dict (columns/role, amount_mode, default_direction,
-- number_format, date_order, method, bank_name).
--
-- KLIEN: dicari lewat nama_client ('NBM' / 'PT NAWASANGA BERTATAP MUKA'), GAGAL
-- dengan pesan jelas kalau belum ada. Akun COA dicari lewat acc_no di
-- management_client_coa klien itu (GAGAL kalau COA NBM belum di-seed).
-- client_id / client_code / coa id TIDAK di-hardcode.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py seed_template_nbm_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT DO NOTHING supaya run-2x gagal jelas
-- (UNIQUE uq_bank_cash_import_templates_signature), bukan diam-diam ke-skip.
-- Untuk menjalankan ulang, hapus dulu:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA')
--      AND t.column_signature_hash IN (
--        '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0',
--        'f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9',
--        'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457',
--        'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf');

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_bca_5325 UUID;
    v_coa_bca_1350 UUID;
    v_coa_bri      UUID;
    v_tpl_bca_pdf  UUID;
    v_tpl_bca_csv  UUID;
    v_tpl_bri_pdf  UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client IN (''NBM'', ''PT NAWASANGA BERTATAP MUKA'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bca_5325 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10006' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bca_1350 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10007' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bri      FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10008' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bca_5325 IS NULL OR v_coa_bca_1350 IS NULL OR v_coa_bri IS NULL THEN
        RAISE EXCEPTION 'Akun COA NBM 1-10006 (BCA # 5325107836) / 1-10007 (BCA # 1350838208) / 1-10008 (BRI # 059001001642303) belum lengkap -- jalankan dulu seed_coa_nbm.sql.';
    END IF;

    -- ---------------------------------------------------------
    -- Template ekstraksi
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BCA - Rekening Tahapan (PDF)', 'PDF', NULL, 1, 2,
        '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0',
        '["TANGGAL", "KETERANGAN", "CBG", "MUTASI", "SALDO"]'::jsonb,
        '{"columns": [{"header": "TANGGAL", "role": "date"}, {"header": "KETERANGAN", "role": "description"}, {"header": "CBG", "role": "reference"}, {"header": "MUTASI", "role": "amount"}, {"header": "SALDO", "role": "balance"}], "amount_mode": "single", "default_direction": "credit", "number_format": "en", "date_order": "dmy", "method": "words", "bank_name": "BCA"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_bca_pdf;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BCA - KlikBCA Mutasi Rekening (CSV)', 'CSV', 'CSV', 7, 8,
        'f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9',
        '["Tanggal Transaksi", "Keterangan", "Cabang", "Jumlah", "Saldo"]'::jsonb,
        '{"columns": [{"header": "Tanggal Transaksi", "role": "date"}, {"header": "Keterangan", "role": "description"}, {"header": "Cabang", "role": "reference"}, {"header": "Jumlah", "role": "amount"}, {"header": "Saldo", "role": "balance"}], "amount_mode": "single", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "table", "bank_name": "BCA"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_bca_csv;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BRI - Laporan Transaksi Finansial IBBIZ (PDF)', 'PDF', NULL, 1, 2,
        'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457',
        '["Tanggal Transaksi", "Uraian Transaksi", "Teller", "Debet", "Kredit", "Saldo"]'::jsonb,
        '{"columns": [{"header": "Tanggal Transaksi", "role": "date"}, {"header": "Uraian Transaksi", "role": "description"}, {"header": "Teller", "role": "reference"}, {"header": "Debet", "role": "debit"}, {"header": "Kredit", "role": "credit"}, {"header": "Saldo", "role": "balance"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "words", "bank_name": "BRI"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_bri_pdf;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BRI - Export Mutasi Core Banking (CSV)', 'CSV', 'CSV', 1, 2,
        'dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf',
        '["ID", "NOREK", "TGL_TRAN", "TGL_EFEKTIF", "JAM_TRAN", "SEQ", "DESK_TRAN", "SALDO_AWAL_MUTASI", "MUTASI_DEBET", "MUTASI_KREDIT", "SALDO_AKHIR_MUTASI", "GLSIGN", "TRUSER", "KODE_TRAN", "KODE_TRAN_TELLER", "TRREMK", "TLBDS1", "TLBDS2", "REMARK_CUSTOM"]'::jsonb,
        '{"columns": [{"header": "ID", "role": "ignore"}, {"header": "NOREK", "role": "ignore"}, {"header": "TGL_TRAN", "role": "date"}, {"header": "TGL_EFEKTIF", "role": "ignore"}, {"header": "JAM_TRAN", "role": "ignore"}, {"header": "SEQ", "role": "reference"}, {"header": "DESK_TRAN", "role": "description"}, {"header": "SALDO_AWAL_MUTASI", "role": "balance_before"}, {"header": "MUTASI_DEBET", "role": "debit"}, {"header": "MUTASI_KREDIT", "role": "credit"}, {"header": "SALDO_AKHIR_MUTASI", "role": "balance"}, {"header": "GLSIGN", "role": "ignore"}, {"header": "TRUSER", "role": "ignore"}, {"header": "KODE_TRAN", "role": "ignore"}, {"header": "KODE_TRAN_TELLER", "role": "ignore"}, {"header": "TRREMK", "role": "ignore"}, {"header": "TLBDS1", "role": "ignore"}, {"header": "TLBDS2", "role": "ignore"}, {"header": "REMARK_CUSTOM", "role": "reference"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "table", "bank_name": "BRI"}'::jsonb,
        'manual', 100.00, true, 0
    );

    -- ---------------------------------------------------------
    -- Mapping bank -> akun COA (dicocokkan per nomor rekening; BRI PDF & CSV
    -- = 1 rekening yang sama, CSV tanpa nol di depan)
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BCA', '5325107836', NULL, v_coa_bca_5325, v_tpl_bca_pdf,
         'Tahapan Xpresi BCA KCP PD Indah Office Tower 5 a.n. PRADHIVI AYUNDA B MONINGKA.', true, 0),
        (v_client_id, v_client_code, 'BCA', '1350838208', NULL, v_coa_bca_1350, v_tpl_bca_csv,
         'Rekening BCA a.n. NAWASANGA BERTATAP MUKA (export KlikBCA Bisnis CSV).', true, 0),
        (v_client_id, v_client_code, 'BRI', '059001001642303', NULL, v_coa_bri, v_tpl_bri_pdf,
         'Giro Special Rate BRI KC Denpasar Ubud a.n. NAWASANGA BERTATAP MUKA (PDF IBBIZ & export CSV).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name, t.template_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- LEFT JOIN financial_transaction_bank_cash_import_templates t ON t.id = m.template_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(c.nama_client) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA') AND m.deleted_at IS NULL;
