-- seed_template_birawa_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien BIRAWA
-- (PT Bina Rancang Wasisa), format MULTI seperti seed NBM/SAU:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. Permata - Transaction Inquiry eBusiness (PDF)   rek. 00702328993 (IDR)  -> COA 113993 (Bank Permata 8993)
--
-- SUMBER ISI: 3 file contoh Juni-Agustus 2026 (RK_Birawa_Jun_26.pdf, RK_Permata_Jul_26_-_Birawa.pdf,
-- RK_Permata_-_Birawa2608.pdf), diuji lewat bank_statement_parser.ekstrak_rekening_koran (jalur yang sama
-- dengan endpoint /statements/preview & /upload). Ketiganya status "verified", 0 selisih saldo, 0 warning:
--
--   | File                            | Baris | Cek terhadap                                                          |
--   |---------------------------------|-------|-----------------------------------------------------------------------|
--   | RK_Birawa_Jun_26.pdf            | 66    | saldo awal/akhir + 'Total' per tanggal + 16 checkpoint 'Ledger Balance' |
--   | RK_Permata_Jul_26_-_Birawa.pdf  | 72    | idem (18 checkpoint)                                                  |
--   | RK_Permata_-_Birawa2608.pdf     | 68    | idem (19 checkpoint)                                                  |
--   Saldo akhir Juni = saldo awal Juli, dan Juli = saldo awal Agustus (tersambung persis).
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian ini membawa mapping_rules.recipe = 'permata_pdf'. RECIPE INI BARU: harus sudah ada di
--     backend/modules/transactions/bank_statement_recipes.py (fungsi _parse_permata + entri RESEP
--     "permata_pdf" + opsi dedupe di _halaman_pdf) SEBELUM seed ini dipakai. Tanpa recipe, parser
--     generik hanya membaca 23 dari 72 baris Juli dan template tidak ter-identifikasi.
--   * Saldo tidak tercetak per baris di PDF Permata; recipe memakai 'Ledger Balance per <tgl>' sebagai
--     checkpoint di baris terakhir tiap tanggal, dan mencocokkan baris 'Total' per tanggal dengan jumlah baris.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu
--     (00702328993 -> 702328993, nol di depan diabaikan).
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_permata_pdf>") (satu varian)
--   = 4d12ec4a2d048978bb9be68662a0f2acb7520ce21d2ef3416f2255330bab1c61
--
-- AKUN COA: 113993 'Bank Permata 8993' (sheet 'COA BIRAWA' di dataset/COA/COA_Clients_GOUF.xlsx).
-- PERLU: seed COA Birawa belum ada di migrations/coa/ (baru ada nbm, npi, sau). Tambahkan BIRAWA ke
-- KLIEN di migrations/generate_seed_coa.py lalu jalankan, dan jalankan seed COA-nya SEBELUM seed ini.
-- Klien dicari lewat client_code = 'BIRAWA' (bukan nama klien); GAGAL jelas kalau klien atau akun COA belum ada.
-- client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_birawa_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.client_code)) = 'BIRAWA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'BIRAWA';

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_permata  UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'BIRAWA'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien BIRAWA belum ada di management_clients (dicari client_code = ''BIRAWA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_permata FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '113993' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_permata IS NULL THEN
        RAISE EXCEPTION 'Akun COA Birawa 113993 (Bank Permata 8993 / rek. 00702328993) belum ada -- buat seed COA Birawa dulu (generate_seed_coa.py, tambahkan BIRAWA ke KLIEN) lalu jalankan.';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'BIRAWA - Multi Format (Permata; PDF)', 'Multi', NULL, 1, 2,
        '4d12ec4a2d048978bb9be68662a0f2acb7520ce21d2ef3416f2255330bab1c61',
        '[]'::jsonb,
        $json${
          "format_type": "multi_format",
          "description": "1 setting klien Birawa (PT Bina Rancang Wasisa) untuk import rekening koran Cash & Bank > Source Data. 1 varian: Permata eBusiness 'Transaction Inquiry' (PDF) untuk rekening Permata 00702328993 (IDR). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
          "variants": [
            {
              "column_signature_hash": "975d4005cc1465e0bd73bb41abc0c3ef1c1c08fe0e5d22914c72c0c0c3abc420",
              "variant_name": "Permata - Transaction Inquiry eBusiness (PDF)",
              "file_type": "PDF",
              "sheet_name": null,
              "header_row_index": 1,
              "data_start_row_index": 2,
              "header_columns": [
                "No.",
                "Post Date",
                "Eff Date",
                "Ref No",
                "Description",
                "Debit",
                "Credit"
              ],
              "mapping_rules": {
                "columns": [
                  {
                    "header": "No.",
                    "role": "ignore"
                  },
                  {
                    "header": "Post Date",
                    "role": "date"
                  },
                  {
                    "header": "Eff Date",
                    "role": "ignore"
                  },
                  {
                    "header": "Ref No",
                    "role": "reference"
                  },
                  {
                    "header": "Description",
                    "role": "description"
                  },
                  {
                    "header": "Debit",
                    "role": "debit"
                  },
                  {
                    "header": "Credit",
                    "role": "credit"
                  }
                ],
                "amount_mode": "split",
                "default_direction": null,
                "number_format": "en",
                "date_order": "dmy",
                "method": "words",
                "bank_name": "Permata",
                "date_format": "DD-Mon-YYYY (contoh 01-Jul-2026); tanggal yang dipakai = Post Date (bunga & pajak bunga Post Date akhir bulan, Eff Date tanggal 1 bulan berikutnya)",
                "detect": {
                  "account_number_regex": "Account\\s*:\\s*(\\d+)/",
                  "catatan": "Nama file contoh tidak seragam (RK_Birawa_Jun_26.pdf, RK_Permata_Jul_26_-_Birawa.pdf, RK_Permata_-_Birawa2608.pdf) -> TIDAK dipakai untuk deteksi; nomor rekening dibaca dari header 'Account : 00702328993/BINA RANCANG WASISA ( IDR )'. Nol di depan diabaikan saat mencocokkan mapping."
                },
                "validation_expected": {
                  "source": "saldo awal ('Opening Ledger Balance'), saldo penutup ('Closing Ledger Balance'), baris 'Ledger Balance per <tgl>' (checkpoint tiap tanggal) dan baris 'Total' per tanggal; tidak ada ringkasan total sebulan (total bulan = jumlah 'Total' per tanggal)",
                  "samples": [
                    {
                      "file": "RK_Birawa_Jun_26.pdf",
                      "account": "00702328993",
                      "rows": 66,
                      "opening_balance": "1818205910.00",
                      "closing_balance": "1761142784.00",
                      "total_debit": "8319160708.00",
                      "total_credit": "8262097582.00"
                    },
                    {
                      "file": "RK_Permata_Jul_26_-_Birawa.pdf",
                      "account": "00702328993",
                      "rows": 72,
                      "opening_balance": "1761142784.00",
                      "closing_balance": "1434359722.00",
                      "total_debit": "8980114473.00",
                      "total_credit": "8653331411.00"
                    },
                    {
                      "file": "RK_Permata_-_Birawa2608.pdf",
                      "account": "00702328993",
                      "rows": 68,
                      "opening_balance": "1434359722.00",
                      "closing_balance": "1003071197.00",
                      "total_debit": "10160486379.00",
                      "total_credit": "9729197854.00"
                    }
                  ]
                },
                "catatan_analisis": "Permata eBusiness 'Transaction Inquiry' (Jun-Agu 2026, 66-72 baris, 6-7 halaman). Kolom: No., Post Date, Eff Date, Transaction Code, Cheque Number, Ref No, Customer Ref No, Description, Debit, Credit. Debit & Credit dua kolom, SALDO TIDAK tercetak per baris: hanya 'Ledger Balance per <tgl>' (saldo sebelum mutasi tanggal itu), 'Opening/Closing Ledger Balance' dan 'Total' per tanggal. Kolom No. menempel ke Post Date ('101-Jul-2026' = No 1 + 01-Jul-2026). Deskripsi bisa 6-8 baris dan baris transaksi bisa terpotong di pergantian halaman. Lapisan teks PDF dobel (tiap huruf kolom Ref/Deskripsi tercetak 2x: 'BBiiaayyaa') -> recipe membaca dengan dedupe_chars. Baris 'PENDAPATAN BUNGA' (kredit) dan 'PAJAK ATAS BUNGA' (debit) ikut diimpor. Parser generik TIDAK cukup: hanya 23 dari 72 baris Juli terbaca dan template tidak ter-identifikasi.",
                "recipe": "permata_pdf",
                "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (_parse_permata). Kalau header file tidak cocok, parser generik tetap jalan."
              }
            }
          ]
        }$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'Permata', '00702328993', NULL, v_coa_permata, v_tpl_multi,
         'Rekening Permata a.n. BINA RANCANG WASISA PT (Permata eBusiness Transaction Inquiry, PDF; IDR).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(c.client_code) = 'BIRAWA' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(c.client_code) = 'BIRAWA' AND m.deleted_at IS NULL;