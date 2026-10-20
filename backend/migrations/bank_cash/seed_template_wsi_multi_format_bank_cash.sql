-- seed_template_wsi_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien WSI
-- (PT Well Star Indonesia), format MULTI seperti seed NBM/NPI/SAU:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. OCBC    - Account Statement IDR & USD (PDF)         rek. 163800002368 (mata uang IDR dan USD)
--   2. Mandiri - Kopra Account Statement (PDF)             rek. 1750003270294, 1750036677788
--
-- SUMBER ISI: diuji terhadap 4 file contoh Agustus 2026:
--
--   | File                                   | Baris | Hasil                                                     |
--   |----------------------------------------|-------|-----------------------------------------------------------|
--   | WSI_OCBC_IDR_163800002368_202608.pdf   |     8 | 3 debit / 5 kredit; total + saldo awal/akhir = kotak ringkasan |
--   | WSI_OCBC_USD_163800002368_202608.pdf   |    34 | 31 debit / 3 kredit; total + saldo awal/akhir = kotak ringkasan |
--   | WSI_MANDIRI_1750003270294_202608.pdf   |   147 | 118 debit / 29 kredit; total + saldo = Account Statement Summary |
--   | WSI_MANDIRI_1750036677788_202608.pdf   |    15 | 10 debit / 5 kredit; total + saldo = Account Statement Summary |
--   Saldo berjalan 0 selisih di keempat file. Varian Mandiri diuji LANGSUNG lewat recipe mandiri_pdf
--   (bank_statement_recipes). Varian OCBC (jalur grid generik, tanpa recipe) diuji lewat ekstraksi tabel
--   pdfplumber dengan hasil yang sama; jalankan sekali lewat /statements/preview untuk konfirmasi akhir.
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian Mandiri membawa mapping_rules.recipe = mandiri_pdf (layout Kopra identik dengan SAU/NPI).
--     Tanpa recipe parser generik hanya membaca sebagian kecil baris.
--   * Varian OCBC TANPA recipe: tabel bergaris -> jalur grid generik (sama dengan OCBC NPI).
--   * REKENING OCBC IDR & USD BERNOMOR SAMA (163800002368). Indeks unik
--     uq_bank_cash_bank_mappings_account_aktif melarang dua mapping dengan account_number yang sama
--     per klien, dan _cari_mapping mendahulukan nomor rekening dokumen. Karena itu kedua mapping OCBC
--     dibuat TANPA account_number dan dicocokkan lewat match_keyword pada NAMA FILE:
--       'ocbc_idr_163800002368'  -> akun OCBC IDR
--       'ocbc_usd_163800002368'  -> akun OCBC USD
--     => file OCBC WAJIB bernama WSI_OCBC_IDR_163800002368_<YYYYMM>.pdf / WSI_OCBC_USD_163800002368_<YYYYMM>.pdf.
--     Kalau nama file diganti, pilih akun kas/bank secara manual di dialog upload.
--     JANGAN centang "simpan mapping" saat upload OCBC: itu membuat mapping ber-account_number
--     163800002368 yang akan mengambil alih KEDUA file OCBC.
--   * Nominal USD disimpan apa adanya (tabel mutasi tidak punya kolom mata uang / kurs).
--
-- PEMETAAN AKUN (dibaca dari management_client_coa klien WSI):
--   OCBC    163800002368 IDR -> 1-1104  Bank OCBC - IDR #2368
--   OCBC    163800002368 USD -> 1-1105  Bank OCBC - USD #2368   <-- KONFIRMASI: ada juga 1-1001C 'OCBC USD'
--   Mandiri 1750003270294    -> 1-1001D Bank Mandiri - IDR #0294
--   Mandiri 1750036677788    -> 1-1103  Bank Mandiri - IDR #7788
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- header OCBC & Mandiri identik dengan seed NPI sehingga hash varian sama:
--   OCBC    2f97aaf399733b13eaa08367c219b24abd7d3759afb10f3361937db6e7d4d4ab
--   Mandiri 3988ff8bc0377c4fd98f1ebfc6eced1838aee71d2b51e80ccf1ba530da02e52a
-- level baris = SHA-256("<hash_ocbc>:<hash_mandiri>")
--   = a9a18ef122f7e8e7c9ec081d6df20748c724cd5bba4777d5d7f91848551e339f
--
-- Klien dicari lewat nama_client = 'PT WELL STAR INDONESIA' (sesuai data klien di VPS); GAGAL jelas kalau klien atau akun COA
-- belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_wsi_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT WELL STAR INDONESIA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT WELL STAR INDONESIA';

DO $do$
DECLARE
    -- acc_no akun kas-bank WSI di management_client_coa (dicek langsung di DB)
    v_acc_ocbc_idr TEXT := '1-1104';   -- Bank OCBC - IDR #2368
    v_acc_ocbc_usd TEXT := '1-1105';   -- Bank OCBC - USD #2368 (KONFIRMASI: ada juga 1-1001C 'OCBC USD')
    v_acc_mdr_0294 TEXT := '1-1001D';  -- Bank Mandiri - IDR #0294
    v_acc_mdr_7788 TEXT := '1-1103';   -- Bank Mandiri - IDR #7788

    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_ocbc_idr UUID;
    v_coa_ocbc_usd UUID;
    v_coa_mdr_0294 UUID;
    v_coa_mdr_7788 UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT WELL STAR INDONESIA'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT WELL STAR INDONESIA') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT WELL STAR INDONESIA di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien WSI belum ada di management_clients (dicari nama_client = ''PT WELL STAR INDONESIA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_ocbc_idr FROM management_client_coa WHERE client_id = v_client_id AND acc_no = v_acc_ocbc_idr AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_ocbc_usd FROM management_client_coa WHERE client_id = v_client_id AND acc_no = v_acc_ocbc_usd AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mdr_0294 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = v_acc_mdr_0294 AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mdr_7788 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = v_acc_mdr_7788 AND deleted_at IS NULL LIMIT 1;

    IF v_coa_ocbc_idr IS NULL THEN RAISE EXCEPTION 'Akun COA WSI acc_no = ''%'' (OCBC IDR # 163800002368) tidak ditemukan -- isi v_acc_ocbc_idr di seed ini / jalankan dulu seed COA WSI.', v_acc_ocbc_idr; END IF;
    IF v_coa_ocbc_usd IS NULL THEN RAISE EXCEPTION 'Akun COA WSI acc_no = ''%'' (OCBC USD # 163800002368) tidak ditemukan -- isi v_acc_ocbc_usd di seed ini / jalankan dulu seed COA WSI.', v_acc_ocbc_usd; END IF;
    IF v_coa_mdr_0294 IS NULL THEN RAISE EXCEPTION 'Akun COA WSI acc_no = ''%'' (Mandiri # 1750003270294) tidak ditemukan -- isi v_acc_mdr_0294 di seed ini / jalankan dulu seed COA WSI.', v_acc_mdr_0294; END IF;
    IF v_coa_mdr_7788 IS NULL THEN RAISE EXCEPTION 'Akun COA WSI acc_no = ''%'' (Mandiri # 1750036677788) tidak ditemukan -- isi v_acc_mdr_7788 di seed ini / jalankan dulu seed COA WSI.', v_acc_mdr_7788; END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'WSI - Multi Format (OCBC, Mandiri; PDF)', 'Multi', NULL, 1, 2,
        'a9a18ef122f7e8e7c9ec081d6df20748c724cd5bba4777d5d7f91848551e339f',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien WSI untuk import rekening koran Cash & Bank > Source Data. 2 varian: OCBC Account Statement (PDF; rek. 163800002368 mata uang IDR dan USD) dan Mandiri Kopra Account Statement (PDF; rek. 1750003270294 dan 1750036677788). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "column_signature_hash": "2f97aaf399733b13eaa08367c219b24abd7d3759afb10f3361937db6e7d4d4ab",
      "variant_name": "OCBC - Account Statement IDR & USD (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
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
        "date_format": "DD/MM/YYYY (jam di baris bawahnya diabaikan); angka format en: 1,087,380.00",
        "detect": {
          "account_number_regex": "Account No\\s*:\\s*(\\d+)",
          "filename_regex": "^WSI_OCBC_(?:IDR|USD)_(\\d+)_(\\d{6})",
          "catatan": "Satu nomor rekening OCBC (163800002368) membawa DUA mata uang: IDR dan USD, masing-masing file & akun COA sendiri ('Account No : 163800002368 - IDR' / '- USD'). Nomor rekening unik per klien di bank mapping, jadi kedua mapping OCBC memakai match_keyword berbasis nama file (ocbc_idr_... / ocbc_usd_...), BUKAN account_number. Nama bank OCBC hanya logo; label dari bank_name template."
        },
        "validation_expected": {
          "source": "kotak ringkasan di header tiap halaman (Opening Balance, Closing Balance, Total Debit, Total Credit); jumlah baris dihitung dari hasil ekstraksi",
          "samples": [
            {
              "file": "WSI_OCBC_IDR_163800002368_202608.pdf",
              "account": "163800002368",
              "currency": "IDR",
              "pages": 1,
              "rows": 8,
              "count_debit": 3,
              "count_credit": 5,
              "opening_balance": "89293.00",
              "closing_balance": "9339.00",
              "total_debit": "1267391.00",
              "total_credit": "1187437.00"
            },
            {
              "file": "WSI_OCBC_USD_163800002368_202608.pdf",
              "account": "163800002368",
              "currency": "USD",
              "pages": 4,
              "rows": 34,
              "count_debit": 31,
              "count_credit": 3,
              "opening_balance": "6429.09",
              "closing_balance": "8862.99",
              "total_debit": "72525.23",
              "total_credit": "74959.13"
            }
          ]
        },
        "catatan_analisis": "OCBC 'ACCOUNT STATEMENT' (Agustus 2026) a.n. PT. WELL STAR INDONESIA, layout sama dengan OCBC NPI: tabel bergaris 8 kolom (Transaction Date | Value Date | Reference No. | Cheque No. | Description | Debit | Credit | Balance), jam transaksi di baris bawah tanggal, keterangan bisa 2-3 baris dalam satu sel. Value Date & Cheque No. diabaikan; Reference No. dipakai sebagai referensi. Debit & Kredit dua kolom, saldo tercetak di tiap baris. File IDR 1 halaman (8 baris = 3 debit + 5 kredit), file USD 4 halaman (34 baris = 31 debit + 3 kredit). Jalur grid generik tanpa recipe. Cek independen lewat pdfplumber (extract_tables): jumlah baris, total debit/kredit, saldo akhir sama dengan kotak ringkasan dan saldo berjalan 0 selisih untuk kedua file. CATATAN USD: di kotak ringkasan 'Ledger Balance' dan 'Available Balance' = 62.99 (saldo saat dicetak 01-Sep), BERBEDA dari 'Closing Balance' 8,862.99 (= saldo baris terakhir). Acuan validasi adalah Closing Balance. Nominal USD tersimpan apa adanya (tabel mutasi tidak punya kolom mata uang / kurs)."
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
          "account_number_regex": "(?s)Account No\\.\\s+Account Name\\s+Alias\\s+(\\d+)",
          "filename_regex": "^WSI_MANDIRI(?:_[A-Z]+)?_(\\d+)_(\\d{6})",
          "catatan": "Layout Kopra sama persis dengan Mandiri SAU/NPI (header sama -> hash sama). Satu varian dipakai semua rekening Mandiri WSI; akun COA dipilih lewat bank mapping (nomor rekening dokumen)."
        },
        "validation_expected": {
          "source": "Account Statement Summary di halaman 1 (Opening/Closing Balance, No. of Debit/Credit, Total Amount Debited/Credited)",
          "samples": [
            {
              "file": "WSI_MANDIRI_1750003270294_202608.pdf",
              "account": "1750003270294",
              "pages": 14,
              "rows": 147,
              "count_debit": 118,
              "count_credit": 29,
              "opening_balance": "272084.50",
              "closing_balance": "8102153.36",
              "total_debit": "227908958.33",
              "total_credit": "235739027.19"
            },
            {
              "file": "WSI_MANDIRI_1750036677788_202608.pdf",
              "account": "1750036677788",
              "pages": 2,
              "rows": 15,
              "count_debit": 10,
              "count_credit": 5,
              "opening_balance": "1037231.76",
              "closing_balance": "1113289.76",
              "total_debit": "31423942.00",
              "total_credit": "31500000.00"
            }
          ]
        },
        "catatan_analisis": "Contoh Agustus 2026: rek. 1750003270294 (14 hal, 147 baris) dan rek. 1750036677788 (2 hal, 15 baris), Branch Denpasar Dalung, a.n. WELL STAR INDONESIA. Dengan recipe mandiri_pdf kedua file cocok 100% dengan Summary: jumlah baris debit/kredit, total debit/kredit, saldo akhir, dan saldo berjalan 0 selisih (diuji langsung terhadap bank_statement_recipes._parse_mandiri). Sel rata-tengah vertikal -> tanggal, remark & nominal satu transaksi tercetak di baris visual berbeda (digabung per blok); sisa remark bisa tumpah ke ATAS header halaman berikutnya (mis. hal. 5, 9, 11, 13 rek. 0294). Reference No. bernilai '-' = kosong. Satu transaksi transfer online biasanya diikuti baris biaya terpisah (Rp2.500 / Rp3.500 / Rp5.000 / Rp6.500 / Rp5.400) -- tetap mutasi biasa. Baris 31/08 23:59:00 (Biaya Adm, Saldo Min, Bunga) juga mutasi biasa. Tanpa recipe parser generik tidak membaca layout ini dengan benar.",
        "recipe": "mandiri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        -- OCBC IDR & USD: nomor rekening SAMA -> account_number NULL, dicocokkan lewat kata kunci pada nama file.
        (v_client_id, v_client_code, 'OCBC', NULL, 'ocbc_idr_163800002368', v_coa_ocbc_idr, v_tpl_multi,
         'Rekening OCBC 163800002368 mata uang IDR a.n. PT. WELL STAR INDONESIA (PDF Account Statement). Dicocokkan lewat kata kunci nama file WSI_OCBC_IDR_163800002368_*.', true, 0),
        (v_client_id, v_client_code, 'OCBC', NULL, 'ocbc_usd_163800002368', v_coa_ocbc_usd, v_tpl_multi,
         'Rekening OCBC 163800002368 mata uang USD a.n. PT. WELL STAR INDONESIA (PDF Account Statement). Dicocokkan lewat kata kunci nama file WSI_OCBC_USD_163800002368_*. Nominal USD disimpan apa adanya.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1750003270294', NULL, v_coa_mdr_0294, v_tpl_multi,
         'Rekening Mandiri Kopra a.n. WELL STAR INDONESIA, Branch Denpasar Dalung (#0294) -- rekening operasional utama (147 baris Agustus 2026).', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1750036677788', NULL, v_coa_mdr_7788, v_tpl_multi,
         'Rekening Mandiri Kopra a.n. WELL STAR INDONESIA, Branch Denpasar Dalung (#7788) -- rekening transit dana dari NUSA PENIDA INVESTMENTS (15 baris Agustus 2026).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT WELL STAR INDONESIA' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, m.match_keyword, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT WELL STAR INDONESIA' AND m.deleted_at IS NULL;