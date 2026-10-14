-- seed_template_sau_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings,
-- migration 36) untuk klien SAU, hasil analisis file contoh:
--   dataset/Bank Cash/SAU/SAU_BCA.pdf
--   dataset/Bank Cash/SAU/SAU_BRI.pdf
--   dataset/Bank Cash/SAU/SAU_MANDIRI.pdf
--   dataset/Bank Cash/SAU/Laporan Data Kas Kasir Finance Juni 2026.xlsx
--
-- Hasil ekstraksi (modules/transactions/bank_statement_extractor.py) atas
-- keempat file contoh periode Juni 2026 -- SEMUA "verified" 100%: saldo
-- berjalan per baris cocok + total resmi di dokumen cocok:
--
--   | File            | Jalur | Baris | Saldo awal       | Saldo akhir      | Cek resmi                                   |
--   |-----------------|-------|-------|------------------|------------------|---------------------------------------------|
--   | BCA (giro)      | words | 1.422 | 1.754.636.519,17 | 1.253.226.731,28 | total DB/CR + jumlah baris DB 362 / CR 1060 |
--   | BRI (Britama)   | words |   288 |   358.569.812,67 |   384.245.578,67 | total debet/kredit (blok kolom di footer)   |
--   | Mandiri (Kopra) | words |   302 |   959.450.372,76 | 1.215.267.719,01 | total + No. of Debit 15 / Credit 287        |
--   | Kas Kasir Excel | table | 1.286 | 1.274.590.096    |   985.362.866    | Total Uang Masuk/Keluar (panel samping)     |
--
-- BENTUK FILE per template:
--   BCA     -- PDF tanpa garis tabel, 1 kolom MUTASI + penanda "DB" (tanpa
--              penanda = kredit), tanggal "dd/mm" (tahun dari "PERIODE : JUNI 2026"),
--              saldo hanya tercetak di baris terakhir per hari (divalidasi per segmen).
--   BRI     -- PDF, kolom Debet & Kredit terpisah, tanggal "dd/mm/yy hh:mm:ss",
--              header 2 baris (Indonesia + Inggris), ringkasan di halaman terakhir
--              berbentuk BLOK KOLOM (label di 1 baris, angka di baris bawahnya).
--   Mandiri -- PDF Kopra, sel rata-tengah VERTIKAL: tanggal, keterangan & nominal
--              1 transaksi tercetak di baris visual berbeda -> digabung per blok
--              (celah vertikal lebar = transaksi baru). Ringkasan di halaman 1
--              (Opening Balance / No. of Debit / Total Amount Debited, ...).
--   Kas Kasir -- Excel sheet "Data", judul di baris 1-3, baris 4 total (tanpa
--              label), HEADER di baris 5, data mulai baris 6. KAS MASUK = uang
--              masuk (credit), KAS KELUAR = uang keluar (debit), SALDO UANG FISIK
--              = saldo berjalan. Baris pertama "Modal Awal Bulan" = saldo pindahan
--              bulan lalu (nominal = saldo), BUKAN mutasi -> jadi saldo awal.
--              Kolom ACCOUNT (Revenue-Customer, Cost, Prive, ...) & NO. JURNAL
--              ikut ke keterangan mutasi. Panel ringkasan di kolom J-K (Saldo
--              Awal / Saldo Akhir / Total Uang Masuk / Total Uang Keluar) dipakai
--              untuk validasi. Dokumen ini tidak punya nama bank -> label "Kas
--              Kasir" diambil dari template.
--
-- MAPPING BANK (akun COA SAU, lihat seed_coa_sau.sql):
--   BCA     rek. 6281900118      -> 11200001 BANK BCA
--   Mandiri rek. 1290011863475   -> 11200002 BANK MANDIRI
--   BRI     rek. 140301000103562 -> 11200003 BANK BRI
--   Kas Kasir (judul "LAPORAN KAS KASIR" / template Kas Kasir) -> 11100002 KAS KASIR
-- Upload di Bank Feed dengan pilihan akun "Auto-detect" memakai mapping ini
-- (urutan cocok: nomor rekening > kata kunci judul > template > nama bank).
--
-- column_signature_hash = SHA-256 dari header tabel yang dinormalisasi
-- (bank_statement_extractor.signature_header: _norm per kolom, digabung "|",
-- kolom kosong di ujung kanan dibuang). mapping_rules = format
-- Aturan.ke_dict (columns/role, amount_mode, default_direction,
-- number_format, date_order, method, bank_name).
--
-- KLIEN: dicari lewat nama_client ('SAU' / 'CV SUMBER ALODIE UTAMA'), GAGAL
-- dengan pesan jelas kalau belum ada. Akun COA dicari lewat acc_no di
-- management_client_coa klien itu (GAGAL kalau COA SAU belum di-seed).
-- client_id / client_code / coa id TIDAK di-hardcode.
--
-- is_active & usage_count DISEBUTKAN EKSPLISIT (default di ORM sisi Python,
-- bukan DEFAULT kolom untuk tabel template).
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py seed_template_sau_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT DO NOTHING supaya run-2x gagal jelas
-- (UNIQUE uq_bank_cash_import_templates_signature), bukan diam-diam ke-skip.
-- Untuk menjalankan ulang (mis. setelah mapping_rules direvisi), hapus dulu:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.column_signature_hash IN (
--        '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0',
--        'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457',
--        'ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31',
--        '8dba4029b3cd2f33bd6e029efe6421766c2fd5baf786df2e55abad25390f4331');

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_coa_bca     UUID;
    v_coa_mandiri UUID;
    v_coa_bri     UUID;
    v_coa_kas     UUID;
    v_tpl_bca     UUID;
    v_tpl_bri     UUID;
    v_tpl_mandiri UUID;
    v_tpl_kas     UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = SAU). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bca     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200001' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mandiri FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200002' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bri     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200003' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_kas     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11100002' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bca IS NULL OR v_coa_mandiri IS NULL OR v_coa_bri IS NULL OR v_coa_kas IS NULL THEN
        RAISE EXCEPTION 'Akun COA SAU 11200001 (BANK BCA) / 11200002 (BANK MANDIRI) / 11200003 (BANK BRI) / 11100002 (KAS KASIR) belum lengkap -- jalankan dulu seed_coa_sau.sql.';
    END IF;

    -- ---------------------------------------------------------
    -- Template ekstraksi
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BCA - Rekening Giro (PDF)', 'PDF', NULL, 1, 2,
        '6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0',
        '["TANGGAL", "KETERANGAN", "CBG", "MUTASI", "SALDO"]'::jsonb,
        '{"columns": [{"header": "TANGGAL", "role": "date"}, {"header": "KETERANGAN", "role": "description"}, {"header": "CBG", "role": "reference"}, {"header": "MUTASI", "role": "amount"}, {"header": "SALDO", "role": "balance"}], "amount_mode": "single", "default_direction": "credit", "number_format": "en", "date_order": "dmy", "method": "words", "bank_name": "BCA"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_bca;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BRI - Britama Bisnis (PDF)', 'PDF', NULL, 1, 2,
        'a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457',
        '["Tanggal Transaksi", "Uraian Transaksi", "Teller", "Debet", "Kredit", "Saldo"]'::jsonb,
        '{"columns": [{"header": "Tanggal Transaksi", "role": "date"}, {"header": "Uraian Transaksi", "role": "description"}, {"header": "Teller", "role": "reference"}, {"header": "Debet", "role": "debit"}, {"header": "Kredit", "role": "credit"}, {"header": "Saldo", "role": "balance"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "words", "bank_name": "BRI"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_bri;

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

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'Kas Kasir - Laporan Kas Kasir Finance (Excel)', 'Excel', 'Data', 5, 6,
        '8dba4029b3cd2f33bd6e029efe6421766c2fd5baf786df2e55abad25390f4331',
        '["Tanggal", "NO. JURNAL", "KETERANGAN", "ACCOUNT", "KAS MASUK", "KAS KELUAR", "SALDO UANG FISIK", "Keterangan"]'::jsonb,
        '{"columns": [{"header": "Tanggal", "role": "date"}, {"header": "NO. JURNAL", "role": "reference"}, {"header": "KETERANGAN", "role": "description"}, {"header": "ACCOUNT", "role": "reference"}, {"header": "KAS MASUK", "role": "credit"}, {"header": "KAS KELUAR", "role": "debit"}, {"header": "SALDO UANG FISIK", "role": "balance"}, {"header": "Keterangan", "role": "reference"}], "amount_mode": "split", "default_direction": null, "number_format": "en", "date_order": "dmy", "method": "table", "bank_name": "Kas Kasir"}'::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_kas;

    -- ---------------------------------------------------------
    -- Mapping bank -> akun COA
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BCA', '6281900118', NULL, v_coa_bca, v_tpl_bca,
         'Rekening giro BCA KCP Arundina Cibubur a.n. SUMBER ALODIE UTAMA CV.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1290011863475', NULL, v_coa_mandiri, v_tpl_mandiri,
         'Rekening Mandiri KCP Jkt Cimanggis (Kopra) a.n. SUMBER ALODIE UTAMA.', true, 0),
        (v_client_id, v_client_code, 'BRI', '140301000103562', NULL, v_coa_bri, v_tpl_bri,
         'Britama Bisnis SME BRI KK Condet a.n. SUMBER ALODIE UTAMA.', true, 0),
        (v_client_id, v_client_code, 'Kas Kasir', NULL, 'LAPORAN KAS KASIR', v_coa_kas, v_tpl_kas,
         'Laporan Kas Kasir Finance bulanan (Excel) -- kas fisik kasir finance.', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT m.bank_name, m.account_number, m.match_keyword, a.acc_no, a.account_name, t.template_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- LEFT JOIN financial_transaction_bank_cash_import_templates t ON t.id = m.template_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE c.nama_client = 'SAU' AND m.deleted_at IS NULL;
