-- seed_template_ym_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien YM
-- (PT Yoniso Manasikara), format MULTI seperti seed NBM/Birawa:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. BNI - Account Statement BNIDirect (PDF)       rek. 159665205      -> COA 10002 (Bank BNI)
--   2. Mandiri - Kopra Account Statement (PDF)       rek. 1450015662063  -> COA 10012 (Bank Mandiri)
--
-- SUMBER ISI: 6 file contoh Juni-Agustus 2026 (YM_BNI_202606/07/08.pdf, YM_MANDIRI_202606/07/08.pdf), diuji lewat
-- bank_statement_parser.ekstrak_rekening_koran (jalur yang sama dengan endpoint /statements/preview & /upload).
-- Semua status "verified", 0 selisih saldo berjalan, total debit/kredit + jumlah baris sama dengan ringkasan dokumen:
--
--   | File                   | Baris | Cek terhadap                                                              |
--   |------------------------|-------|---------------------------------------------------------------------------|
--   | YM_BNI_202606.pdf      | 6     | Beginning/Closing Balance + Total Debit/Credit (Records) + jumlah baris   |
--   | YM_BNI_202607.pdf      | 22    | idem                                                                      |
--   | YM_BNI_202608.pdf      | 22    | idem                                                                      |
--   | YM_MANDIRI_202606.pdf  | 23    | Account Statement Summary (saldo awal/akhir, No. of Debit/Credit, total)  |
--   | YM_MANDIRI_202607.pdf  | 56    | idem                                                                      |
--   | YM_MANDIRI_202608.pdf  | 76    | idem                                                                      |
--   Saldo akhir Juni = saldo awal Juli, dan Juli = saldo awal Agustus (tersambung persis, kedua bank).
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian BNI membawa mapping_rules.recipe = 'bni_pdf'. RECIPE INI BARU: harus sudah ada di
--     backend/modules/transactions/bank_statement_recipes.py (fungsi _halaman_pdf_bni + _parse_bni + entri RESEP "bni_pdf")
--     SEBELUM seed ini dipakai. Tanpa recipe parser generik hanya membaca 1/6/4 dari 6/22/22 baris, tanpa arah
--     debit/kredit dan tanpa saldo (status unverified). Penyebab: kolom Amount PDF BNI tercetak dobel (angka asli
--     ditimpa "0.00" pada baris K), resep membuang karakter hantu itu.
--   * Varian Mandiri memakai recipe yang SUDAH ada (mandiri_pdf), sama dengan SAU/NPI.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu (nol di depan diabaikan).
--     Penting karena remark Mandiri memuat "15966520599102" (= rekening BNI YM + kode 99102) dan mutasi BNI memuat
--     "1450015662063" (= rekening Mandiri YM); tanpa prioritas nomor dokumen file bisa salah masuk akun.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_bni_pdf>:<hash_mandiri_pdf>")
--   = 5d86c2154a2a7229b5e9986cfda92b0d6592e347c8c5c2fc3a6a7fed35504c18
--
-- AKUN COA: 10002 'Bank BNI' dan 10012 'Bank Mandiri' (sheet 'COA YM' di dataset/COA/COA_Clients_GOUF.xlsx).
-- PERLU: seed COA YM belum ada di migrations/coa/ (baru ada nbm, npi, sau). Tambahkan YM ke KLIEN di
-- migrations/generate_seed_coa.py (mis. "YM": ["YM", "PT YONISO MANASIKARA", "PT. YONISO MANASIKARA"]) lalu jalankan,
-- dan jalankan seed COA-nya SEBELUM seed ini.
-- Klien dicari lewat nama_client = 'PT YONISO MANASIKARA' (sesuai data klien di VPS);
-- GAGAL jelas kalau klien atau akun COA belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_ym_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT YONISO MANASIKARA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT YONISO MANASIKARA';

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_bni      UUID;
    v_coa_mandiri  UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT YONISO MANASIKARA'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT YONISO MANASIKARA') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT YONISO MANASIKARA di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien YM belum ada di management_clients (dicari nama_client = ''PT YONISO MANASIKARA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bni     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '10002' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mandiri FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '10012' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bni IS NULL OR v_coa_mandiri IS NULL THEN
        RAISE EXCEPTION 'Akun COA YM 10002 (Bank BNI) / 10012 (Bank Mandiri) belum lengkap -- jalankan dulu seed COA YM (seed_coa_ym.sql, dihasilkan generate_seed_coa.py dari sheet COA YM).';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'YM - Multi Format (BNI, Mandiri; PDF)', 'Multi', NULL, 1, 2,
        '5d86c2154a2a7229b5e9986cfda92b0d6592e347c8c5c2fc3a6a7fed35504c18',
        '[]'::jsonb,
        $json${
          "format_type": "multi_format",
          "description": "1 setting klien YM untuk import rekening koran Cash & Bank > Source Data. 2 varian PDF: BNI Account Statement BNIDirect (rek. 159665205) dan Mandiri Kopra Account Statement (rek. 1450015662063). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
          "variants": [
            {
              "column_signature_hash": "5b6a0f7990b91d73934d6cf3c0f0d685a037dd3e1ffb188bc9d91cdba9cb14bc",
              "variant_name": "BNI - Account Statement BNIDirect (PDF)",
              "file_type": "PDF",
              "sheet_name": null,
              "header_row_index": 1,
              "data_start_row_index": 2,
              "header_columns": [
                "No",
                "Post Date",
                "Branch",
                "Journal No.",
                "Description",
                "Amount",
                "Db/Cr",
                "Balance"
              ],
              "mapping_rules": {
                "columns": [
                  {
                    "header": "No",
                    "role": "ignore"
                  },
                  {
                    "header": "Post Date",
                    "role": "date"
                  },
                  {
                    "header": "Branch",
                    "role": "ignore"
                  },
                  {
                    "header": "Journal No.",
                    "role": "reference"
                  },
                  {
                    "header": "Description",
                    "role": "description"
                  },
                  {
                    "header": "Amount",
                    "role": "amount"
                  },
                  {
                    "header": "Db/Cr",
                    "role": "dc_flag"
                  },
                  {
                    "header": "Balance",
                    "role": "balance"
                  }
                ],
                "amount_mode": "single",
                "default_direction": null,
                "number_format": "en",
                "date_order": "dmy",
                "method": "words",
                "bank_name": "BNI",
                "date_format": "DD/MM/YYYY (jam HH.MM.SS tercetak di baris bawah tanggal)",
                "detect": {
                  "account_number_regex": "^(\\d{6,})\\s*/\\s*PT",
                  "filename_regex": "^YM_BNI_(\\d{6})",
                  "catatan": "Nomor rekening ada di judul halaman ('159665205 / PT YONISO'); tidak ada di nama file. Di keterangan transaksi BNI tertulis '0159665205' (dengan nol di depan)."
                },
                "validation_expected": {
                  "source": "kotak ringkasan di atas tiap halaman (Beginning Balance / Closing Balance / Total Debit (Records) / Total Credit (Records))",
                  "samples": [
                    {
                      "file": "YM_BNI_202606.pdf",
                      "rows": 6,
                      "opening_balance": "49716236.00",
                      "closing_balance": "95429176.00",
                      "total_debit": "30473.00",
                      "count_debit": 2,
                      "total_credit": "45743413.00",
                      "count_credit": 4
                    },
                    {
                      "file": "YM_BNI_202607.pdf",
                      "rows": 22,
                      "opening_balance": "95429176.00",
                      "closing_balance": "74972688.00",
                      "total_debit": "95484797.00",
                      "count_debit": 18,
                      "total_credit": "75028309.00",
                      "count_credit": 4
                    },
                    {
                      "file": "YM_BNI_202608.pdf",
                      "rows": 22,
                      "opening_balance": "74972688.00",
                      "closing_balance": "90383453.00",
                      "total_debit": "102040440.00",
                      "count_debit": 18,
                      "total_credit": "117451205.00",
                      "count_credit": 4
                    }
                  ]
                },
                "catatan_analisis": "Account Statement BNIDirect giro PT YONISO (rek. 159665205), Jun-Agu 2026, 1-3 halaman (6/22/22 baris). Kolom: No | Post Date | Branch | Journal No. | Description | Amount | Db/Cr | Balance. SATU kolom Amount + penanda 'D' = debit / 'K' = kredit, saldo tercetak di tiap baris. Tanggal di baris atas sel, jam di baris bawahnya; keterangan rata-tengah vertikal dan bisa 1-5 baris (ditempel ke baris yang paling dekat). PERHATIAN: kolom Amount tercetak dobel (lapisan teks ganda): baris D = angka sama dua kali, baris K = angka asli ditimpa '0.00' sehingga parser generik membaca '1.00' sebagai '0.00 1' dan '67,428,216.00' sebagai '67,428,2106.00' (hasil uji generik: 1/6/4 dari 6/22/22 baris, tanpa arah & tanpa saldo). Resep membuang karakter '0' hantu itu. Cabang bisa tumpah ke halaman berikutnya (hanya kolom Branch). Baris 31/xx 08.00.00 (JASA GIRO/BUNGA, PPH, BIAYA ADM REK) adalah mutasi biasa. Transaksi 'PEMINDAHAN KE 1450015662063' = setoran ke rekening Mandiri YM sendiri.",
                "recipe": "bni_pdf",
                "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (_parse_bni). Resep BARU: harus sudah ada di backend/modules/transactions/bank_statement_recipes.py sebelum seed ini dipakai."
              }
            },
            {
              "column_signature_hash": "3988ff8bc0377c4fd98f1ebfc6eced1838aee71d2b51e80ccf1ba530da02e52a",
              "variant_name": "Mandiri - Kopra Account Statement (PDF)",
              "file_type": "PDF",
              "sheet_name": null,
              "header_row_index": 1,
              "data_start_row_index": 2,
              "header_columns": [
                "Posting Date",
                "Remark",
                "Reference No.",
                "Debit",
                "Credit",
                "Balance"
              ],
              "mapping_rules": {
                "columns": [
                  {
                    "header": "Posting Date",
                    "role": "date"
                  },
                  {
                    "header": "Remark",
                    "role": "description"
                  },
                  {
                    "header": "Reference No.",
                    "role": "reference"
                  },
                  {
                    "header": "Debit",
                    "role": "debit"
                  },
                  {
                    "header": "Credit",
                    "role": "credit"
                  },
                  {
                    "header": "Balance",
                    "role": "balance"
                  }
                ],
                "amount_mode": "split",
                "default_direction": null,
                "number_format": "en",
                "date_order": "dmy",
                "method": "words",
                "bank_name": "Mandiri",
                "date_format": "DD MMM YYYY, HH:mm:ss (bulan Inggris: Jan, Feb, Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec)",
                "detect": {
                  "account_number_regex": "Account No\\.\\s*(\\d+)",
                  "filename_regex": "^YM_MANDIRI_(\\d{6})",
                  "catatan": "Nomor rekening ada di dokumen ('Account No.'), tidak di nama file. Remark transaksi Mandiri memuat '15966520599102' = rekening BNI YM + kode 99102, jadi pemetaan akun WAJIB lewat nomor rekening dokumen (sudah begitu di bank_cash_v1._cari_mapping)."
                },
                "validation_expected": {
                  "source": "Account Statement Summary di halaman 1 (Opening/Closing Balance, No. of Debit/Credit, Total Amount Debited/Credited)",
                  "samples": [
                    {
                      "file": "YM_MANDIRI_202606.pdf",
                      "rows": 23,
                      "opening_balance": "31656243.68",
                      "closing_balance": "4459619.44",
                      "total_debit": "27199380.19",
                      "count_debit": 22,
                      "total_credit": "2755.95",
                      "count_credit": 1
                    },
                    {
                      "file": "YM_MANDIRI_202607.pdf",
                      "rows": 56,
                      "opening_balance": "4459619.44",
                      "closing_balance": "365995.34",
                      "total_debit": "65594145.00",
                      "count_debit": 45,
                      "total_credit": "61500520.90",
                      "count_credit": 11
                    },
                    {
                      "file": "YM_MANDIRI_202608.pdf",
                      "rows": 76,
                      "opening_balance": "365995.34",
                      "closing_balance": "356517.39",
                      "total_debit": "92559963.00",
                      "count_debit": 63,
                      "total_credit": "92550485.05",
                      "count_credit": 13
                    }
                  ]
                },
                "catatan_analisis": "Kopra by Mandiri Account Statement rek. 1450015662063 a.n. YONISO MANASIKARA (KCP Singaraja Seririt), Jun-Agu 2026, 3/6/8 halaman (23/56/76 baris). Layout SAMA dengan Mandiri SAU/NPI sehingga memakai resep yang sama (mandiri_pdf); tanpa resep parser generik tidak membaca sel rata-tengah vertikal. Hasil uji: jumlah baris, total debit/kredit, saldo awal & akhir sama persis dengan Summary, saldo berjalan 0 selisih; saldo akhir Juni = saldo awal Juli, Juli = Agustus. Kolom Reference No. bernilai '-' = kosong. Potongan remark bisa tumpah ke ATAS header tabel di halaman berikutnya (milik transaksi terakhir halaman sebelumnya). Baris tengah malam akhir bulan (Biaya Adm, Baya Saldo Min, Bunga, Pajak) adalah mutasi biasa.",
                "recipe": "mandiri_pdf",
                "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata). Kalau header file tidak cocok, parser generik tetap jalan."
              }
            }
          ]
        }$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BNI', '159665205', NULL, v_coa_bni, v_tpl_multi,
         'Giro BNI a.n. PT YONISO (Account Statement BNIDirect PDF). Di keterangan transaksi tertulis 0159665205.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1450015662063', NULL, v_coa_mandiri, v_tpl_multi,
         'Rekening Mandiri KCP Singaraja Seririt a.n. YONISO MANASIKARA (Kopra Account Statement PDF).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT YONISO MANASIKARA' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT YONISO MANASIKARA' AND m.deleted_at IS NULL;