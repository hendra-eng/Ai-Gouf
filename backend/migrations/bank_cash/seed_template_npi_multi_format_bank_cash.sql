-- seed_template_npi_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / kas (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien NPI
-- (PT Nusa Penida Investments), format MULTI seperti seed SAU/NBM:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. OCBC       - Account Statement IDR (PDF)          rek. 163800007094
--   2. Mandiri    - Kopra Account Statement (PDF)        rek. 1450017315108, 1450018412482, 1750003319273
--   3. Petty Cash - Laporan Belanja Harian (Excel)       tanpa nomor rekening (kata kunci 'petty')
--
-- SUMBER ISI: menggantikan seed_template_npi_bank_cash.sql (2 baris terpisah, hash dari modul
-- lama bank_statement_extractor yang sudah tidak ada). Diuji ulang terhadap 4 file contoh lewat
-- bank_statement_parser.ekstrak_rekening_koran (jalur yang sama dengan /statements/preview & /upload):
--
--   | File                                        | Baris | Hasil                                                   |
--   |---------------------------------------------|-------|---------------------------------------------------------|
--   | NPI_OCBC_IDR_163800007094_202608.pdf        |     6 | verified 100%: saldo awal/akhir, total debit & kredit   |
--   | NPI_MANDIRI_1450017315108_202608.pdf        |   136 | verified 100%: total + 64 debit / 72 kredit + saldo     |
--   | NPI_MANDIRI_DELI_1450018412482_202608.pdf   |   115 | verified 100%: total + 35 debit / 80 kredit + saldo     |
--   | NPI_Petty_Cash_202609.xlsx                  | 264*  | *per SHEET bulanan -- LIHAT CATATAN PETTY CASH di bawah |
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian Mandiri membawa mapping_rules.recipe = mandiri_pdf. Tanpa recipe parser generik hanya
--     membaca 3 baris (rek. 5108) dan 7 baris (rek. 2482) dari 136 / 115 baris sebenarnya.
--   * Varian OCBC TANPA recipe: tabel bergaris -> jalur grid generik sudah verified.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu. Mapping
--     Petty Cash memakai match_keyword 'petty' (nama file NPI_Petty_Cash_*; tidak ada nomor rekening).
--
-- CATATAN PETTY CASH (baca sebelum dipakai):
--   Workbook NPI_Petty_Cash_202609.xlsx berisi 60+ sheet (2022-2026, termasuk ekspor Xero). Parser
--   generik memakai aturan template dari sheet PERTAMA yang lolos deteksi (sheet 'xero apr' =
--   April 2024), jadi workbook UTUH terbaca salah (187 baris April 2024, unverified). Varian ini baru
--   benar kalau file hanya berisi SATU sheet bulanan (diuji sheet 58/59/60: total belanja = jumlah
--   baris 'transfer ...' di sheet). Untuk workbook utuh dibutuhkan recipe baru (mis. petty_cash_xlsx).
--   Hanya kas KELUAR (belanja bertanggal) yang terbaca; dana masuk harian tidak punya tanggal.
--
-- PEMETAAN AKUN (seed_coa_npi.sql):
--   OCBC    163800007094  -> 1-1102 OCBC IDR #7094
--   Mandiri 1450017315108 -> 1-1106 Mandiri Shop #5108
--   Mandiri 1450018412482 -> 1-1109 Mandiri Deli Grocery (482)   <-- KONFIRMASI: ada juga 1-1107 'Mandiri Deli #5058'
--   Mandiri 1750003319273 -> 1-1103 Mandiri Resto #9273          <-- dari seed lama (Juni 2026), BELUM diuji ulang
--   Petty Cash (keyword)  -> 1-1101 Petty cash
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_ocbc>:<hash_mandiri>:<hash_petty>")
-- = 1fe28d4108dfa266a3db04a0eaad8cd2410a7287829c4993d05a309155d895bc
--
-- Klien dicari lewat nama_client = 'PT NUSA PENIDA INVESTMENTS' (sesuai data klien di VPS); GAGAL jelas kalau klien
-- atau akun COA belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_npi_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT NUSA PENIDA INVESTMENTS';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT NUSA PENIDA INVESTMENTS';
-- JANGAN jalankan bersama seed_template_npi_bank_cash.sql (seed lama, 2 baris terpisah, tanpa recipe):
-- nomor rekening di bank mapping unik dan akan bentrok. Kalau seed lama sudah pernah dijalankan,
-- hapus dulu dengan dua DELETE di atas, lalu hapus file seed lama.

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_petty    UUID;
    v_coa_ocbc     UUID;
    v_coa_resto    UUID;
    v_coa_shop     UUID;
    v_coa_deli     UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT NUSA PENIDA INVESTMENTS'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT NUSA PENIDA INVESTMENTS') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT NUSA PENIDA INVESTMENTS di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari nama_client = ''PT NUSA PENIDA INVESTMENTS''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_petty FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1101' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_ocbc  FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1102' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_resto FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1103' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_shop  FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1106' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_deli  FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-1109' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_petty IS NULL OR v_coa_ocbc IS NULL OR v_coa_resto IS NULL OR v_coa_shop IS NULL OR v_coa_deli IS NULL THEN
        RAISE EXCEPTION 'Akun COA NPI 1-1101 (Petty cash) / 1-1102 (OCBC IDR #7094) / 1-1103 (Mandiri Resto #9273) / 1-1106 (Mandiri Shop #5108) / 1-1109 (Mandiri Deli Grocery 482) belum lengkap -- jalankan dulu seed_coa_npi.sql.';
    END IF;

    -- ---------------------------------------------------------
    -- Template ekstraksi (1 baris Multi)
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'NPI - Multi Format (OCBC, Mandiri, Petty Cash)', 'Multi', NULL, 1, 2,
        '1fe28d4108dfa266a3db04a0eaad8cd2410a7287829c4993d05a309155d895bc',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien NPI untuk import rekening koran / kas Cash & Bank > Source Data. 3 varian: OCBC IDR (PDF), Mandiri Kopra (PDF, dipakai semua rekening Mandiri), Petty Cash (Excel, 1 sheet bulanan). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "variant_name": "OCBC - Account Statement IDR (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "2f97aaf399733b13eaa08367c219b24abd7d3759afb10f3361937db6e7d4d4ab",
      "header_columns": [
        "Transaction Date",
        "Value Date",
        "Reference No.",
        "Cheque No.",
        "Description",
        "Debit",
        "Credit",
        "Balance"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Transaction Date",
            "role": "date"
          },
          {
            "header": "Value Date",
            "role": "ignore"
          },
          {
            "header": "Reference No.",
            "role": "reference"
          },
          {
            "header": "Cheque No.",
            "role": "ignore"
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
        "method": "grid",
        "bank_name": "OCBC",
        "date_format": "DD/MM/YYYY (jam di baris bawahnya diabaikan); angka format en: 15,000,000.00",
        "detect": {
          "account_number_regex": "Account No\\s*:\\s*(\\d+)",
          "filename_regex": "^NPI_OCBC_(?:[A-Z]+_)?(\\d+)_(\\d{6})",
          "catatan": "Nama bank OCBC hanya berupa logo (bukan teks); label diambil dari nama file / bank_name template. Nomor rekening di dokumen sama dengan nama file."
        },
        "validation_expected": {
          "source": "kotak ringkasan di header halaman (Opening/Closing Balance, Total Debit, Total Credit); jumlah baris dihitung dari hasil ekstraksi",
          "samples": [
            {
              "file": "NPI_OCBC_IDR_163800007094_202608.pdf",
              "account": "163800007094",
              "rows": 6,
              "count_debit": 3,
              "count_credit": 3,
              "opening_balance": "110977.00",
              "closing_balance": "125957.00",
              "total_debit": "15385079.00",
              "total_credit": "15400059.00"
            }
          ]
        },
        "catatan_analisis": "Contoh: NPI_OCBC_IDR_163800007094_202608.pdf (Agustus 2026, 1 halaman, 6 baris = 3 debit + 3 kredit). Tabel bergaris -> jalur grid parser generik (tanpa recipe). Hasil uji: saldo berjalan 0 selisih, total debit/kredit & saldo akhir sama persis dengan kotak ringkasan. Kolom Value Date & Cheque No. diabaikan; Reference No. ikut tercetak di akhir keterangan."
      }
    },
    {
      "variant_name": "Mandiri - Kopra Account Statement (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "3988ff8bc0377c4fd98f1ebfc6eced1838aee71d2b51e80ccf1ba530da02e52a",
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
          "account_number_regex": "(?s)Account No\\.\\s+Account Name\\s+Alias\\s+(\\d+)",
          "filename_regex": "^NPI_MANDIRI(?:_[A-Z]+)?_(\\d+)_(\\d{6})",
          "catatan": "Layout Kopra sama persis dengan Mandiri SAU (header sama -> hash sama). Satu varian dipakai semua rekening Mandiri NPI; akun COA dipilih lewat bank mapping (nomor rekening dokumen)."
        },
        "validation_expected": {
          "source": "Account Statement Summary di halaman 1 (Opening/Closing Balance, No. of Debit/Credit, Total Amount Debited/Credited)",
          "samples": [
            {
              "file": "NPI_MANDIRI_1450017315108_202608.pdf",
              "account": "1450017315108",
              "pages": 14,
              "rows": 136,
              "count_debit": 64,
              "count_credit": 72,
              "opening_balance": "482756.83",
              "closing_balance": "2637698.64",
              "total_debit": "64638318.45",
              "total_credit": "66793260.26"
            },
            {
              "file": "NPI_MANDIRI_DELI_1450018412482_202608.pdf",
              "account": "1450018412482",
              "pages": 12,
              "rows": 115,
              "count_debit": 35,
              "count_credit": 80,
              "opening_balance": "1866867.26",
              "closing_balance": "6017286.95",
              "total_debit": "50040467.92",
              "total_credit": "54190887.61"
            }
          ]
        },
        "catatan_analisis": "Contoh Agustus 2026: rek. 1450017315108 (14 hal, 136 baris) dan rek. 1450018412482 (12 hal, 115 baris). Dengan recipe mandiri_pdf kedua file verified 100%: jumlah baris, total debit/kredit, saldo akhir sama dengan Summary, 0 selisih saldo berjalan. TANPA recipe parser generik hanya membaca 3 dan 7 baris. Sel rata-tengah vertikal -> tanggal, remark & nominal satu transaksi tercetak di baris visual berbeda (digabung per blok); potongan remark bisa tumpah ke ATAS header di halaman berikutnya (mis. hal. 7 dan 11 rek. 5108). Reference No. bernilai '-' = kosong. Baris 31/08 23:59:00 (Biaya Adm, Saldo Min, Bunga, Pajak) adalah mutasi biasa.",
        "recipe": "mandiri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "variant_name": "Petty Cash - Laporan Belanja Harian (Excel, 1 sheet bulanan)",
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "9c7463e0d3a3c47da2a70b3ebf1d2c5489f20f0f80a6b7f7dca3d2e9ff03d9b3",
      "header_columns": [
        "DATE",
        "UNIT",
        "PRICE",
        "TOTAL",
        "sum",
        "cek"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "DATE",
            "role": "date"
          },
          {
            "header": "",
            "role": "description"
          },
          {
            "header": "UNIT",
            "role": "ignore"
          },
          {
            "header": "PRICE",
            "role": "ignore"
          },
          {
            "header": "TOTAL",
            "role": "amount"
          },
          {
            "header": "sum",
            "role": "ignore"
          },
          {
            "header": "cek",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          },
          {
            "header": "",
            "role": "ignore"
          }
        ],
        "amount_mode": "single",
        "default_direction": "debit",
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "Petty Cash",
        "date_format": "sel tanggal Excel (datetime); baris tanpa tanggal (subtotal harian, blok transfer) dilewati",
        "detect": {
          "filename_regex": "^NPI_Petty_Cash_(\\d{6})",
          "match_keyword": "petty",
          "catatan": "Tanpa nomor rekening. Bank mapping memakai match_keyword 'petty' (cocok dengan nama file NPI_Petty_Cash_*)."
        },
        "validation_expected": {
          "source": "jumlah baris 'transfer N <bulan>' (dana masuk harian) di bagian bawah tiap sheet bulanan; harus sama dengan total belanja bulan itu. Tidak ada saldo awal/akhir ('rest money' = 0).",
          "samples": [
            {
              "sheet": "58",
              "periode": "2026-07",
              "rows": 384,
              "total_debit": "45937500.00"
            },
            {
              "sheet": "59",
              "periode": "2026-08",
              "rows": 264,
              "total_debit": "41367000.00"
            },
            {
              "sheet": "60",
              "periode": "2026-09",
              "rows": 282,
              "total_debit": "38195000.00"
            }
          ]
        },
        "catatan_analisis": "HANYA BENAR kalau file berisi SATU sheet bulanan. Workbook utuh NPI_Petty_Cash_202609.xlsx berisi 60+ sheet (2022-2026, termasuk sheet ekspor Xero) dan parser generik memakai aturan template dari sheet PERTAMA yang lolos deteksi (sheet 'xero apr' = April 2024), jadi workbook utuh terbaca salah (187 baris April 2024, unverified). Butuh recipe khusus (petty_cash_xlsx) yang memilih sheet bulan berjalan sebelum varian ini layak untuk workbook utuh. Hasil uji per sheet tunggal: total belanja terekstrak = jumlah baris 'transfer ...' di sheet untuk Jan-Sep 2026 (Jul 384 baris, Agu 264 baris, Sep 282 baris). Peran kolom dipetakan menurut POSISI (14 kolom) karena kolom B (nama barang) tidak punya header: berlaku untuk sheet Jul-Sep 2026 (juga Des 2025-Feb 2026); sheet Mar-Jun 2026 lebih lebar (21 kolom) -> tanggal & nominal tetap benar tapi keterangan kosong. Hanya kas KELUAR (belanja) yang berbentuk baris bertanggal; dana masuk harian ('transfer 3 agustus', dst.) tidak punya tanggal sehingga tidak terbaca. Baris belanja terakhir sebuah sheet bisa ikut tersambung teks blok di bawahnya ('NAME PRODUCT CASH SALE IN THE MORNING') pada keterangannya."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    -- ---------------------------------------------------------
    -- Mapping bank -> akun COA
    -- ---------------------------------------------------------
    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'OCBC', '163800007094', NULL, v_coa_ocbc, v_tpl_multi,
         'Rekening OCBC IDR a.n. PT. NUSA PENIDA INVESTMENTS (PDF Account Statement).', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1450017315108', NULL, v_coa_shop, v_tpl_multi,
         'Rekening Mandiri Kopra a.n. NUSA PENIDA INVESTME -- Shop (#5108).', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1450018412482', NULL, v_coa_deli, v_tpl_multi,
         'Rekening Mandiri Kopra a.n. NUSA PENIDA INVESTME -- Deli Grocery (482). Konfirmasi: COA 1-1107 Mandiri Deli #5058 adalah rekening lain.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1750003319273', NULL, v_coa_resto, v_tpl_multi,
         'Rekening Mandiri KCP Legian (Kopra) a.n. NUSA PENIDA INVESTME -- resto (#9273). Dari seed lama (Juni 2026), belum diuji ulang.', true, 0),
        (v_client_id, v_client_code, 'Petty Cash', NULL, 'petty', v_coa_petty, v_tpl_multi,
         'Laporan belanja Petty Cash bulanan (Excel). Berlaku untuk file 1 sheet bulanan; workbook utuh butuh recipe.', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT NUSA PENIDA INVESTMENTS' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, m.match_keyword, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT NUSA PENIDA INVESTMENTS' AND m.deleted_at IS NULL;