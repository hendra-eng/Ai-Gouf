-- seed_template_nbm_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien NBM
-- (PT Nawasanga Bertatap Muka), format MULTI seperti seed Sales/SAU:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. BCA - Rekening Tahapan Xpresi (PDF)         rek. 5325107836      -> COA 1-10006
--   2. BCA - KlikBCA Mutasi Rekening (CSV)         rek. 1350838208      -> COA 1-10007
--   3. BRI - Laporan Transaksi Finansial IBBIZ (PDF)  rek. 059001001642303 / 059001001757302
--   4. BRI - Export Mutasi Core Banking (CSV)      rek. 059001001642303 / 059001001757302
--      (PDF & CSV BRI = rekening yang sama; 642303 -> COA 1-10008, 757302 -> COA 1-10011)
--
-- SUMBER ISI: menggantikan seed_template_nbm_bank_cash.sql (4 baris terpisah). Diuji ulang terhadap
-- 12 file contoh Juni-Agustus 2026 lewat bank_statement_parser.ekstrak_rekening_koran (jalur yang sama
-- dengan endpoint /statements/preview & /upload). Semua status "verified", 0 selisih saldo berjalan:
--
--   | File                                  | Baris | Cek terhadap                                           |
--   |---------------------------------------|-------|--------------------------------------------------------|
--   | 5325107836_{JUN,JUL,AUG}_2026.pdf     | 34/36/44 | ringkasan resmi: total CR/DB + jumlah baris + saldo  |
--   | NBM_BCA_1350838208_2026{06,07,08}.csv | 344/389/375 | ringkasan resmi: Mutasi Debet/Kredit + jumlah + saldo |
--   | NBM__BRI_059001001642303_202606.pdf   | 80    | blok ringkasan: saldo awal/total debet/total kredit/akhir |
--   | NBM_BRI_059001001757302_202606.pdf    | 82    | idem                                                   |
--   | NBM_BRI_*_2026{07,08}.csv (2 rek.)    | 100/103/86/85 | saldo berjalan + sambungan saldo antar bulan   |
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian PDF BCA & BRI membawa mapping_rules.recipe (bca_pdf | bri_pdf). Tanpa recipe parser generik
--     SALAH baca BCA (hasil uji: 1 selisih saldo berjalan; total debit meleset Rp9.002 dan total kredit Rp10.000
--     per file karena biaya adm / bunga terbaca arah keliru) dan tidak meng-identifikasi template BRI PDF. Varian CSV sengaja TANPA recipe (jalur tabel generik sudah verified).
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu (nol di depan
--     diabaikan). Penting karena mutasi BRI memuat teks "ATMSTRPRM ... 1350838208" = rekening BCA NBM.
--     Tanpa perbaikan itu file BRI salah masuk ke akun BCA 1-10007.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_bca_pdf>:<hash_bca_csv>:<hash_bri_pdf>:<hash_bri_csv>")
--   = 22181a87dfbae9fc0ddadfdce2b3de978c32bd57018c92ecb8c2a5eac4902443
--
-- AKUN COA (seed_coa_nbm.sql): 1-10006 BCA #5325107836, 1-10007 BCA #1350838208,
-- 1-10008 BRI #059001001642303, 1-10011 BRI #059001001757302. Klien dicari lewat nama_client = 'PT NAWASANGA BERTATAP MUKA' (sesuai data klien di VPS)
-- ('NBM' / 'PT NAWASANGA BERTATAP MUKA'); GAGAL jelas kalau klien atau akun COA belum ada.
-- client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_nbm_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT NAWASANGA BERTATAP MUKA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT NAWASANGA BERTATAP MUKA';
-- JANGAN jalankan bersama seed_template_nbm_bank_cash.sql (seed lama, 4 baris terpisah, tanpa recipe):
-- nomor rekening di bank mapping unik dan akan bentrok. Kalau seed lama sudah pernah dijalankan,
-- hapus dulu dengan dua DELETE di atas.

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_bca_5325 UUID;
    v_coa_bca_1350 UUID;
    v_coa_bri_1642 UUID;
    v_coa_bri_1757 UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT NAWASANGA BERTATAP MUKA'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT NAWASANGA BERTATAP MUKA') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT NAWASANGA BERTATAP MUKA di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client = ''PT NAWASANGA BERTATAP MUKA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bca_5325 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10006' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bca_1350 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10007' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bri_1642 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10008' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bri_1757 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10011' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bca_5325 IS NULL OR v_coa_bca_1350 IS NULL OR v_coa_bri_1642 IS NULL OR v_coa_bri_1757 IS NULL THEN
        RAISE EXCEPTION 'Akun COA NBM 1-10006 (BCA # 5325107836) / 1-10007 (BCA # 1350838208) / 1-10008 (BRI # 059001001642303) / 1-10011 (BRI # 059001001757302) belum lengkap -- jalankan dulu seed_coa_nbm.sql.';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'NBM - Multi Format (BCA, BRI; PDF & CSV)', 'Multi', NULL, 1, 2,
        '22181a87dfbae9fc0ddadfdce2b3de978c32bd57018c92ecb8c2a5eac4902443',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien NBM untuk import rekening koran Cash & Bank > Source Data. 4 varian: BCA Tahapan Xpresi (PDF), BCA KlikBCA (CSV), BRI IBBIZ (PDF), BRI core banking (CSV) untuk 4 rekening (BCA 5325107836, BCA 1350838208, BRI 059001001642303, BRI 059001001757302). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "column_signature_hash": "a0c6dff260fef25439c5c1661a4ccc807894f981d023cb45410277f438ade91a",
      "variant_name": "BCA - Rekening Tahapan Xpresi (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "TANGGAL",
        "KETERANGAN",
        "CBG",
        "MUTASI",
        "SALDO"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "TANGGAL",
            "role": "date"
          },
          {
            "header": "KETERANGAN",
            "role": "description"
          },
          {
            "header": "CBG",
            "role": "reference"
          },
          {
            "header": "MUTASI",
            "role": "amount"
          },
          {
            "header": "SALDO",
            "role": "balance"
          }
        ],
        "amount_mode": "single",
        "default_direction": "credit",
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "BCA",
        "date_format": "DD/MM (tahun dari baris 'PERIODE : <BULAN> <TAHUN>' di header tiap halaman)",
        "detect": {
          "account_number_regex": "NO\\.?\\s*REKENING\\s*:\\s*(\\d+)",
          "filename_regex": "^(\\d{10})_(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)_(\\d{4})"
        },
        "validation_expected": {
          "source": "ringkasan di halaman terakhir (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR)",
          "samples": [
            {
              "file": "5325107836_JUN_2026.pdf",
              "opening_balance": "50536392.99",
              "closing_balance": "59299617.95",
              "total_credit": "48773400.95",
              "count_credit": 31,
              "total_debit": "40010175.99",
              "count_debit": 3
            },
            {
              "file": "5325107836_JUL_2026.pdf",
              "opening_balance": "59299617.95",
              "closing_balance": "37210252.60",
              "total_credit": "34920761.06",
              "count_credit": 31,
              "total_debit": "57010126.41",
              "count_debit": 5
            },
            {
              "file": "5325107836_AUG_2026.pdf",
              "opening_balance": "37210252.60",
              "closing_balance": "67605122.13",
              "total_credit": "56522757.66",
              "count_credit": 32,
              "total_debit": "26127888.13",
              "count_debit": 12
            }
          ]
        },
        "catatan_analisis": "Rekening Tahapan Xpresi BCA (Jun-Agu 2026, 5-6 halaman, 34-44 baris). Tanggal 'dd/mm', nominal MUTASI satu kolom dengan sufiks 'DB' = debit (tanpa sufiks = kredit), saldo hanya tercetak di baris terakhir tiap hari. Header sama dengan BCA Giro SAU sehingga memakai resep yang sama. Baris 'SALDO AWAL' bukan mutasi; BUNGA (kredit) dan PAJAK BUNGA (DB) ikut diimpor. Parser generik SALAH untuk file ini (selisih saldo + arah debit/kredit), karena itu recipe wajib.",
        "recipe": "bca_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "column_signature_hash": "d179a1d3eb58b32f115532c9bd6a1ae5dd36c115281e9cde6eeb1ad2802b38d4",
      "variant_name": "BCA - KlikBCA Mutasi Rekening (CSV)",
      "file_type": "CSV",
      "sheet_name": "CSV",
      "header_row_index": 7,
      "data_start_row_index": 8,
      "header_columns": [
        "Tanggal Transaksi",
        "Keterangan",
        "Cabang",
        "Jumlah",
        "Saldo"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Tanggal Transaksi",
            "role": "date"
          },
          {
            "header": "Keterangan",
            "role": "description"
          },
          {
            "header": "Cabang",
            "role": "reference"
          },
          {
            "header": "Jumlah",
            "role": "amount"
          },
          {
            "header": "Saldo",
            "role": "balance"
          }
        ],
        "amount_mode": "single",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "BCA",
        "date_format": "DD/MM atau DD/MM/YYYY (bulan Juli memakai tahun penuh; tahun dari baris 'Periode : dd/mm/yyyy - dd/mm/yyyy')",
        "detect": {
          "account_number_regex": "No\\.\\s*rekening\\s*:\\s*(\\d+)",
          "filename_regex": "^NBM_BCA_(\\d+)_(\\d{6})"
        },
        "validation_expected": {
          "source": "ringkasan di bawah tabel (Saldo Awal / Mutasi Debet / Mutasi Kredit / Saldo Akhir)",
          "samples": [
            {
              "file": "NBM_BCA_1350838208_202606.csv",
              "opening_balance": "19233714.86",
              "closing_balance": "18907777.71",
              "total_debit": "318567713.55",
              "count_debit": 123,
              "total_credit": "318241776.40",
              "count_credit": 221
            },
            {
              "file": "NBM_BCA_1350838208_202607.csv",
              "opening_balance": "18907777.71",
              "closing_balance": "9937071.76",
              "total_debit": "369309933.35",
              "count_debit": 111,
              "total_credit": "360339227.40",
              "count_credit": 278
            },
            {
              "file": "NBM_BCA_1350838208_202608.csv",
              "opening_balance": "9937071.76",
              "closing_balance": "15800170.32",
              "total_debit": "398723051.44",
              "count_debit": 115,
              "total_credit": "404586150.00",
              "count_credit": 260
            }
          ]
        },
        "catatan_analisis": "Export KlikBCA Bisnis 'Informasi Rekening - Mutasi Rekening': judul di baris 1-6, HEADER baris 7, data mulai baris 8, kolom Jumlah berakhiran 'CR'/'DB', ringkasan di bawah tabel (tidak diimpor). Nama bank tidak tercetak -> label 'BCA' dari template. Format tanggal berbeda antar bulan (Jun/Agu 'dd/mm', Jul 'dd/mm/yyyy') dua-duanya terbaca. Agustus: baris data pertama 'KARTU KREDIT ...' sempat dikira sub-header oleh parser generik (0 baris terbaca) -- diperbaiki di _cari_header (bank_statement_parser.py)."
      }
    },
    {
      "column_signature_hash": "df8df3dc192a5c31fb339351a25e3d16ff9c5f7f08222b72bacc9f04158f885c",
      "variant_name": "BRI - Laporan Transaksi Finansial IBBIZ (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "Tanggal Transaksi",
        "Uraian Transaksi",
        "Teller",
        "Debet",
        "Kredit",
        "Saldo"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Tanggal Transaksi",
            "role": "date"
          },
          {
            "header": "Uraian Transaksi",
            "role": "description"
          },
          {
            "header": "Teller",
            "role": "reference"
          },
          {
            "header": "Debet",
            "role": "debit"
          },
          {
            "header": "Kredit",
            "role": "credit"
          },
          {
            "header": "Saldo",
            "role": "balance"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "BRI",
        "date_format": "DD/MM/YY HH:MM:SS",
        "detect": {
          "account_number_regex": "No\\.\\s*Rekening\\s*:\\s*(\\d+)",
          "filename_regex": "^NBM_{1,2}BRI_(\\d+)_(\\d{6})"
        },
        "validation_expected": {
          "source": "blok ringkasan di halaman terakhir (Saldo Awal / Total Transaksi Debet / Total Transaksi Kredit / Saldo Akhir)",
          "samples": [
            {
              "file": "NBM__BRI_059001001642303_202606.pdf",
              "account": "059001001642303",
              "rows": 80,
              "opening_balance": "44315363.60",
              "closing_balance": "40371281.60",
              "total_debit": "131272114.00",
              "total_credit": "127328032.00"
            },
            {
              "file": "NBM_BRI_059001001757302_202606.pdf",
              "account": "059001001757302",
              "rows": 82,
              "opening_balance": "8714499.00",
              "closing_balance": "12058188.00",
              "total_debit": "25769232.00",
              "total_credit": "29112921.00"
            }
          ]
        },
        "catatan_analisis": "Laporan Transaksi Finansial (IBBIZ) Giro Special Rate BRI KC Denpasar Ubud, 4 halaman, layout sama dengan BRI SAU. Debet & Kredit dua kolom, saldo tercetak di tiap baris, keterangan bisa 2 baris (BI-Fast, BRIVA) dan ditempel ke transaksi di atasnya. Nomor rekening di header memakai nol di depan (059001...), sedangkan CSV BRI tanpa nol (59001...).",
        "recipe": "bri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py; template ikut ter-identifikasi (parser generik membaca benar tapi template tidak ter-match)."
      }
    },
    {
      "column_signature_hash": "3f571c5308b08f67f45b913818ed0279dc093e3d62c9023b13b6e0d3596b36cc",
      "variant_name": "BRI - Export Mutasi Core Banking (CSV)",
      "file_type": "CSV",
      "sheet_name": "CSV",
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "ID",
        "NOREK",
        "TGL_TRAN",
        "TGL_EFEKTIF",
        "JAM_TRAN",
        "SEQ",
        "DESK_TRAN",
        "SALDO_AWAL_MUTASI",
        "MUTASI_DEBET",
        "MUTASI_KREDIT",
        "SALDO_AKHIR_MUTASI",
        "GLSIGN",
        "TRUSER",
        "KODE_TRAN",
        "KODE_TRAN_TELLER",
        "TRREMK",
        "TLBDS1",
        "TLBDS2",
        "REMARK_CUSTOM"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "ID",
            "role": "ignore"
          },
          {
            "header": "NOREK",
            "role": "ignore"
          },
          {
            "header": "TGL_TRAN",
            "role": "date"
          },
          {
            "header": "TGL_EFEKTIF",
            "role": "ignore"
          },
          {
            "header": "JAM_TRAN",
            "role": "ignore"
          },
          {
            "header": "SEQ",
            "role": "reference"
          },
          {
            "header": "DESK_TRAN",
            "role": "description"
          },
          {
            "header": "SALDO_AWAL_MUTASI",
            "role": "balance_before"
          },
          {
            "header": "MUTASI_DEBET",
            "role": "debit"
          },
          {
            "header": "MUTASI_KREDIT",
            "role": "credit"
          },
          {
            "header": "SALDO_AKHIR_MUTASI",
            "role": "balance"
          },
          {
            "header": "GLSIGN",
            "role": "ignore"
          },
          {
            "header": "TRUSER",
            "role": "ignore"
          },
          {
            "header": "KODE_TRAN",
            "role": "ignore"
          },
          {
            "header": "KODE_TRAN_TELLER",
            "role": "ignore"
          },
          {
            "header": "TRREMK",
            "role": "ignore"
          },
          {
            "header": "TLBDS1",
            "role": "ignore"
          },
          {
            "header": "TLBDS2",
            "role": "ignore"
          },
          {
            "header": "REMARK_CUSTOM",
            "role": "reference"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "BRI",
        "date_format": "YYYY-MM-DD HH:MM:SS",
        "detect": {
          "filename_regex": "^NBM_{1,2}BRI_(\\d+)_(\\d{6})",
          "catatan": "Nomor rekening ada di kolom NOREK (nol di depan hilang); pemetaan akun dicocokkan tanpa nol di depan."
        },
        "validation_expected": {
          "source": "tidak ada ringkasan resmi di CSV; divalidasi lewat saldo berjalan (SALDO_AWAL_MUTASI -> SALDO_AKHIR_MUTASI tiap baris) dan sambungan saldo antar bulan",
          "samples": [
            {
              "file": "NBM__BRI_059001001642303_202607.csv",
              "rows": 100,
              "opening_balance": "40371281.60",
              "closing_balance": "63834752.60",
              "total_debit": "140579585.00",
              "total_credit": "164043056.00"
            },
            {
              "file": "NBM__BRI_059001001642303_202608.csv",
              "rows": 103,
              "opening_balance": "63834752.60",
              "closing_balance": "58801680.60",
              "total_debit": "169318044.00",
              "total_credit": "164284972.00"
            },
            {
              "file": "NBM_BRI_059001001757302_202607.csv",
              "rows": 86,
              "opening_balance": "12058188.00",
              "closing_balance": "21327737.00",
              "total_debit": "23535600.00",
              "total_credit": "32805149.00"
            },
            {
              "file": "NBM_BRI_059001001757302_202608.csv",
              "rows": 85,
              "opening_balance": "21327737.00",
              "closing_balance": "13270935.00",
              "total_debit": "41032500.00",
              "total_credit": "32975698.00"
            }
          ]
        },
        "catatan_analisis": "Export core banking BRI tanpa judul & ringkasan. SALDO_AWAL_MUTASI = saldo SEBELUM transaksi (peran balance_before -> saldo awal dari baris pertama), SALDO_AKHIR_MUTASI = saldo berjalan. DESK_TRAN = keterangan, memuat 'AMT:<bruto>MDR:<biaya>' untuk setlement QRIS/EDC. Saldo akhir Juni (dari PDF) tersambung persis ke saldo awal Juli, dan Juli ke Agustus, untuk kedua rekening."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BCA', '5325107836', NULL, v_coa_bca_5325, v_tpl_multi,
         'Tahapan Xpresi BCA KCP PD Indah Office Tower 5 a.n. PRADHIVI AYUNDA B MONINGKA (PDF).', true, 0),
        (v_client_id, v_client_code, 'BCA', '1350838208', NULL, v_coa_bca_1350, v_tpl_multi,
         'Rekening BCA a.n. NAWASANGA BERTATAP MUKA (export KlikBCA Bisnis CSV).', true, 0),
        (v_client_id, v_client_code, 'BRI', '059001001642303', NULL, v_coa_bri_1642, v_tpl_multi,
         'Giro Special Rate BRI KC Denpasar Ubud a.n. NAWASANGA BERTATAP MUKA (PDF IBBIZ & CSV core banking; CSV tanpa nol di depan).', true, 0),
        (v_client_id, v_client_code, 'BRI', '059001001757302', NULL, v_coa_bri_1757, v_tpl_multi,
         'Giro Special Rate BRI KC Denpasar Ubud a.n. NAWASANGA BERTATAP MUKA, rekening kedua (PDF IBBIZ & CSV core banking).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT NAWASANGA BERTATAP MUKA' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT NAWASANGA BERTATAP MUKA' AND m.deleted_at IS NULL;