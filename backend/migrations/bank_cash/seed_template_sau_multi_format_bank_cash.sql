-- seed_template_sau_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / kas (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk
-- klien SAU (CV Sumber Alodie Utama), format MULTI seperti seed Sales:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. BCA     - Rekening Giro (PDF)          rek. 6281900118
--   2. BRI     - Britama Bisnis (PDF)         rek. 140301000103562
--   3. Mandiri - Kopra Account Statement (PDF) rek. 1290011863475
--   4. Kas Kasir - Laporan Kas Kasir Finance (Excel, sheet "Data")
--
-- SUMBER ISI: resep tiap varian berasal dari seed_template_sau_bank_cash.sql lalu
-- DIUJI ULANG terhadap 4 file contoh periode AGUSTUS 2026 lewat bank_statement_recipes.py
-- (semua cocok 100% dengan ringkasan resmi di dokumen, saldo berjalan 0 selisih):
--   SAU_BCA_06281900118_202608.pdf            135 hal, 1.364 baris (CR 1.043 / DB 321)
--   SAU_BRI_1751950554900542085_202608.pdf     12 hal,   325 baris
--   SAU_MANDIRI_1290011863475_202608.pdf       27 hal,   309 baris (DB 20 / CR 289)
--   Laporan_Data_Kas_Kasir_Finance_Agustus_2026.xlsx  1.193 mutasi + baris Modal Awal Bulan
-- Angka validasi per varian ada di mapping_rules.validation_expected.
--
-- KUNCI INTEGRASI: tiap varian membawa mapping_rules.recipe (bca_pdf | bri_pdf | mandiri_pdf |
-- kas_kasir_xlsx). bank_statement_parser.ekstrak_rekening_koran() memanggil resep itu lebih dulu
-- kalau header file cocok dengan header_columns varian. Tanpa "recipe" parser generik yang jalan --
-- generik GAGAL untuk BCA (arah debit/kredit & saldo) dan Mandiri PDF, jadi seed ini dibutuhkan.
--
-- CATATAN: (1) nomor rekening di NAMA FILE BRI (1751950554900542085) beda dengan nomor di dalam
-- dokumen (140301000103562) -> mapping memakai nomor di dokumen. (2) Kas Kasir: baris
-- "Modal Awal Bulan" adalah saldo awal, bukan mutasi.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 dari header ternormalisasi
-- digabung '|'); level baris = SHA-256("<hash_bca>:<hash_bri>:<hash_mandiri>:<hash_kas>")
-- = cb986d899150d6496fd674ac4d14a4be353a0e29c08cfa68f5162b792cddcab6
--
-- AKUN COA (seed_coa_sau.sql): BCA 11200001, Mandiri 11200002, BRI 11200003, Kas Kasir 11100002.
-- Klien dicari lewat nama_client = 'CV SUMBER ALODIE UTAMA' (sesuai data klien di VPS); GAGAL jelas
-- kalau klien atau akun COA belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_sau_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'CV SUMBER ALODIE UTAMA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'CV SUMBER ALODIE UTAMA'
--      AND t.file_type = 'Multi' AND t.column_signature_hash = 'cb986d899150d6496fd674ac4d14a4be353a0e29c08cfa68f5162b792cddcab6';
-- Kalau seed lama (seed_template_sau_bank_cash.sql, 4 baris terpisah) sudah pernah
-- dijalankan, hapus dulu baris & mapping-nya -- jangan jalankan keduanya.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_coa_bca     UUID;
    v_coa_mandiri UUID;
    v_coa_bri     UUID;
    v_coa_kas     UUID;
    v_tpl_multi   UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'CV SUMBER ALODIE UTAMA'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'CV SUMBER ALODIE UTAMA') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama CV SUMBER ALODIE UTAMA di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = ''CV SUMBER ALODIE UTAMA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bca     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200001' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_mandiri FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200002' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bri     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11200003' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_kas     FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '11100002' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bca IS NULL OR v_coa_mandiri IS NULL OR v_coa_bri IS NULL OR v_coa_kas IS NULL THEN
        RAISE EXCEPTION 'Akun COA SAU 11200001 (BANK BCA) / 11200002 (BANK MANDIRI) / 11200003 (BANK BRI) / 11100002 (KAS KASIR) belum lengkap -- jalankan dulu seed_coa_sau.sql.';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'SAU - Multi Format (BCA, BRI, Mandiri, Kas Kasir)', 'Multi', NULL, 1, 2,
        'cb986d899150d6496fd674ac4d14a4be353a0e29c08cfa68f5162b792cddcab6',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien SAU untuk import rekening koran / kas Cash & Bank > Source Data. 4 varian: BCA giro (PDF), BRI Britama Bisnis (PDF), Mandiri Kopra (PDF), Kas Kasir Finance (Excel). Backend memilih varian yang file_type dan signature header-nya cocok. Akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening > kata kunci > template > nama bank).",
  "variants": [
    {
      "variant_name": "BCA - Rekening Giro (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "a0c6dff260fef25439c5c1661a4ccc807894f981d023cb45410277f438ade91a",
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
        "date_format": "DD/MM (tahun dari baris 'PERIODE : <BULAN> <TAHUN>' di header halaman)",
        "detect": {
          "account_number_regex": "NO\\.?\\s*RE\\s*KE\\s*NING\\s*:\\s*(\\d+)",
          "filename_regex": "^SAU_BCA_0*(\\d+)_(\\d{6})",
          "catatan": "Header & nomor rekening dicocokkan tanpa spasi/huruf besar-kecil (dinormalisasi), jadi PDF yang header-nya tercetak huruf terpisah spasi tetap cocok."
        },
        "validation_expected": {
          "opening_balance": "1726047117.43",
          "closing_balance": "1274223419.56",
          "total_credit": "13148496472.18",
          "count_credit": 1043,
          "total_debit": "13600320170.05",
          "count_debit": 321,
          "balance_checkpoints": 292,
          "source": "ringkasan di halaman terakhir (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR)"
        },
        "catatan_analisis": "Contoh: SAU_BCA_06281900118_202608.pdf (Agustus 2026, 135 halaman, 1.364 baris). Hasil uji prototipe: jumlah & total CR/DB sama persis dengan ringkasan resmi, 292 checkpoint saldo (saldo hanya tercetak di baris terakhir tiap hari) 0 selisih, saldo akhir cocok. Nominal ada di baris pertama transaksi; sufiks 'DB' = debit, tanpa sufiks = kredit. Nominal mutasi dan sufiks DB dibaca dari posisi kolom MUTASI; saldo dari kolom SALDO. Baris keterangan lanjutan (nama pengirim, TGH/QR/DDR) menempel ke transaksi di atasnya. Baris 'SALDO AWAL' bukan mutasi.",
        "recipe": "bca_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "variant_name": "BRI - Britama Bisnis (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "df8df3dc192a5c31fb339351a25e3d16ff9c5f7f08222b72bacc9f04158f885c",
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
        "date_format": "DD/MM/YY HH:mm:ss",
        "detect": {
          "account_number_regex": "No\\.\\s*Rekening\\s*:\\s*(\\d+)",
          "filename_regex": "^SAU_BRI_(\\d+)_(\\d{6})",
          "catatan": "Nomor rekening di NAMA FILE contoh (1751950554900542085) BERBEDA dengan nomor di dalam dokumen (140301000103562); mapping memakai nomor di dokumen, jangan nama file."
        },
        "validation_expected": {
          "opening_balance": "322212643.67",
          "closing_balance": "812209205.67",
          "total_debit": "912673668.00",
          "total_credit": "1402670230.00",
          "source": "tabel ringkasan di halaman terakhir (Saldo Awal / Total Transaksi Debet / Total Transaksi Kredit / Saldo Akhir)"
        },
        "catatan_analisis": "Contoh: SAU_BRI_1751950554900542085_202608.pdf (Agustus 2026, 12 halaman, 325 baris). Hasil uji: total debet & kredit sama persis dengan ringkasan resmi, saldo berjalan tiap baris 0 selisih, saldo akhir cocok. Uraian bisa 2 baris (BRIVA, BI-Fast) -> gabung ke baris tanggalnya. Transfer BI-Fast/biaya muncul sebagai 2 baris terpisah (nominal + biaya Rp2.500/3.000) dengan jam sama -> tetap 2 mutasi.",
        "recipe": "bri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan."
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
          "account_number_regex": "Account No\\.\\s*(\\d+)",
          "filename_regex": "^SAU_MANDIRI_(\\d+)_(\\d{6})",
          "catatan": "Nomor rekening ada di dokumen ('Account No.') dan nama file; sama."
        },
        "validation_expected": {
          "opening_balance": "1102947795.47",
          "closing_balance": "826664279.31",
          "total_debit": "1186794228.96",
          "count_debit": 20,
          "total_credit": "910510712.80",
          "count_credit": 289,
          "source": "Account Statement Summary di halaman 1"
        },
        "catatan_analisis": "Contoh: SAU_MANDIRI_1290011863475_202608.pdf (Agustus 2026, 27 halaman, 309 baris = 20 debit + 289 kredit). Hasil uji: jumlah baris & total debit/kredit sama persis dengan Summary, saldo berjalan 0 selisih, saldo akhir cocok. Sel rata-tengah vertikal: tanggal, remark & nominal satu transaksi tercetak di baris visual berbeda -> gabung per blok. Kolom Reference No. bernilai '-' = kosong. Potongan remark bisa tumpah ke ATAS header tabel di halaman berikutnya (contoh hal. 3, 8, 16, 19, 20, 25) -> milik transaksi terakhir halaman sebelumnya. Baris 31/08 23:59:00 (Biaya Adm, Bunga, Pajak) adalah mutasi biasa.",
        "recipe": "mandiri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "variant_name": "Kas Kasir - Laporan Kas Kasir Finance (Excel)",
      "file_type": "Excel",
      "sheet_name": "Data",
      "header_row_index": 5,
      "data_start_row_index": 6,
      "column_signature_hash": "e2ebc69da7329292b5a0a6a46c3cdbf91c273053b9e8d784a37db72420d1b2a6",
      "header_columns": [
        "Tanggal",
        "NO. JURNAL",
        "KETERANGAN",
        "ACCOUNT",
        "KAS MASUK",
        "KAS KELUAR",
        "SALDO UANG FISIK",
        "Keterangan"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Tanggal",
            "role": "date"
          },
          {
            "header": "NO. JURNAL",
            "role": "reference"
          },
          {
            "header": "KETERANGAN",
            "role": "description"
          },
          {
            "header": "ACCOUNT",
            "role": "reference"
          },
          {
            "header": "KAS MASUK",
            "role": "credit"
          },
          {
            "header": "KAS KELUAR",
            "role": "debit"
          },
          {
            "header": "SALDO UANG FISIK",
            "role": "balance"
          },
          {
            "header": "Keterangan",
            "role": "reference"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "Kas Kasir",
        "date_format": "sel tanggal Excel (datetime)",
        "detect": {
          "title_keyword": "LAPORAN KAS KASIR",
          "filename_regex": "^Laporan_Data_Kas_Kasir_Finance_(\\w+)_(\\d{4})",
          "catatan": "Tidak punya nomor rekening/nama bank; dicocokkan lewat judul sel A2 'LAPORAN KAS KASIR FINANCE' dan sheet 'Data'."
        },
        "read_columns": "A:H saja (kolom J:M berisi panel ringkasan samping + tabel ringkasan per account, JANGAN dibaca sebagai mutasi)",
        "skip_rows": "baris tanpa Tanggal (baris penutup 'Saldo Akhir Kas Kasir Finance <bulan>' di kolom H) tidak dihitung",
        "opening_balance_row": {
          "match": "KETERANGAN = 'Modal Awal Bulan'",
          "catatan": "Baris pertama data (Modal Awal Bulan 445.641.438 di kolom KAS MASUK) = SALDO AWAL, BUKAN mutasi: jangan diimpor sebagai kas masuk."
        },
        "validation_expected": {
          "opening_balance": "445641438",
          "closing_balance": "512216528",
          "total_credit": "6496399337",
          "total_debit": "6429824247",
          "source": "panel samping (Saldo Awal / Saldo Akhir / Total Uang Masuk / Total Uang Keluar) + E4/F4"
        },
        "catatan_analisis": "Contoh: Laporan_Data_Kas_Kasir_Finance_Agustus_2026.xlsx (sheet 'Data', header baris 5, data mulai baris 6, 1.194 baris termasuk Modal Awal Bulan). Hasil uji: total KAS MASUK TANPA baris Modal Awal Bulan = 6.496.399.337 dan total KAS KELUAR = 6.429.824.247, sama persis dengan panel; saldo berjalan kolom SALDO UANG FISIK 0 selisih; saldo akhir 512.216.528. 'Modal Awal Kasir' (2.400.000) adalah kas keluar biasa. NO. JURNAL terisi hanya sebagian baris (698 dari 1.194).",
        "recipe": "kas_kasir_xlsx",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (posisi kata / tabel), bukan parser generik. Kalau header file tidak cocok, parser generik tetap jalan.",
        "sheet_name": "Data",
        "header_row_index": 5
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BCA', '6281900118', NULL, v_coa_bca, v_tpl_multi,
         'Rekening giro BCA KCP Arundina Cibubur a.n. SUMBER ALODIE UTAMA CV.', true, 0),
        (v_client_id, v_client_code, 'Mandiri', '1290011863475', NULL, v_coa_mandiri, v_tpl_multi,
         'Rekening Mandiri KCP Jkt Cimanggis (Kopra) a.n. SUMBER ALODIE UTAMA.', true, 0),
        (v_client_id, v_client_code, 'BRI', '140301000103562', NULL, v_coa_bri, v_tpl_multi,
         'Britama Bisnis SME BRI KK Condet a.n. SUMBER ALODIE UTAMA.', true, 0),
        (v_client_id, v_client_code, 'Kas Kasir', NULL, 'LAPORAN KAS KASIR', v_coa_kas, v_tpl_multi,
         'Laporan Kas Kasir Finance bulanan (Excel) -- kas fisik kasir finance.', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE c.nama_client = 'CV SUMBER ALODIE UTAMA' AND t.deleted_at IS NULL;