-- seed_template_aadl_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / buku kas (financial_transaction_bank_cash_import_templates)
-- + mapping bank/kas -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien AADL
-- (PT Akshaya Ananda Dylan Lestari), format MULTI seperti seed NBM/SAU:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. BCA     - Rekening Giro / Tahapan (PDF)               5 rek.: 5855820177, 5855710177, 5855779177, 5855600177, 5265275785
--   2. BRI     - Laporan Transaksi Finansial IBBIZ (PDF)     2 rek.: 040901017700302, 040901001771307
--   3. Permata - ME Saver Transaction History (PDF)          rek. 0099-2995-1325            (resep BARU permata_me_pdf)
--   4. Permata Syariah - Transaction History Financial (PDF) rek. 0702-7771-771             (resep BARU permata_syariah_pdf)
--   5. Kas Kecil - Rekapan Patty Cash (Excel)                Warung, Kost Warung, Kost Kapu, Putu   (resep BARU kas_ledger_xlsx)
--   6. Kas Kecil - Rekapan Patty Cash Omah Soemantri (Excel)                                (resep BARU kas_ledger_xlsx)
--   7. Kas Kecil - Kas d'Kappu Soemantri Coffee (Excel)                                     (resep BARU kas_ledger_xlsx)
--
-- SUMBER ISI: 15 file contoh periode AGUSTUS 2026 (kas Excel: seluruh sheet bulanan) dibaca lewat resep di
-- bank_statement_recipes.py / bank_statement_recipes_aadl.py. Angka per file ada di
-- mapping_rules.variants[].mapping_rules.validation_expected.samples. Hasil uji:
--   * BCA (5 file) & BRI (2 file): jumlah baris, total debit/kredit, jumlah baris CR/DB, saldo awal & akhir SAMA PERSIS
--     dengan ringkasan di dokumen, 0 selisih saldo berjalan.
--   * Permata Syariah: 20 baris; total debit 22.411.175,00 & total kredit 100.018.218,00 sama dengan kepala dokumen;
--     saldo awal + kredit - debit = saldo akhir 223.901.428,00.
--   * Permata ME Saver: 10 baris, total debit 6.438.203,00 / kredit 6.444.298,00 hasil baca. TIDAK ADA ringkasan/saldo di
--     dokumen, jadi tidak ada angka resmi untuk dicocokkan -- arah (keluar/masuk) dibaca dari WARNA nominal.
--   * Buku kas Excel (6 file): saldo berjalan 0 selisih di semua sheet dan saldo akhir bulan = saldo awal bulan berikutnya.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian BCA & BRI PDF membawa recipe (bca_pdf | bri_pdf) -- header sama dengan BCA/BRI di seed NBM, jadi hash varian sama.
--   * 3 recipe BARU (permata_me_pdf, permata_syariah_pdf, kas_ledger_xlsx) ada di
--       backend/modules/transactions/bank_statement_recipes_aadl.py
--     WAJIB dipasang dengan menambah SATU baris di paling bawah bank_statement_recipes.py:
--       from . import bank_statement_recipes_aadl  # noqa: E402,F401
--     Tanpa itu, varian 3-7 tidak punya resep terdaftar -> jatuh ke parser generik. Resep permata_pdf & kas_kasir_xlsx
--     yang sudah ada TIDAK bisa membaca file-file ini (diuji: 0 baris / header ditolak).
--   * ARAH BUKU KAS: di Excel patty cash kolom DEBET = uang MASUK dan CREDIT/KREDIT = uang KELUAR (kebalikan bank), maka
--     role: DEBET -> credit, CREDIT -> debit. 1 upload = 1 workbook = SEMUA sheet bulanan; mutasi yang sudah ada di-skip lewat row_hash.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu (nol di depan diabaikan), jadi
--     nama file ESTATEMENT (05855820177) tidak masalah. Buku kas Excel tidak punya nomor rekening -> dikenali lewat
--     match_keyword pada judul sheet (blob 12 baris pertama). Diuji dengan _cari_mapping asli: ke-15 file masuk ke akun
--     yang benar pada 3 urutan pengurutan mapping.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<h_bca>:<h_bri>:<h_permata_me>:<h_permata_syariah>:<h_kas_std>:<h_kas_omah>:<h_kas_kappu>")
--   = 3eb44bff214a2fe9a10900d70a9d795abb9fe3f05b72a7cf6eabb521469a968b
--
-- AKUN COA: COA AADL BELUM ADA di repo (tidak ada seed_coa_aadl.sql) dan nomor akun TIDAK BOLEH DITEBAK. Seed ini mencari akun
-- di management_client_coa milik klien dan GAGAL (tanpa menyimpan apa pun) dengan daftar akun yang belum ketemu:
--   * rekening bank : akun yang account_name-nya memuat nomor rekening (hanya angka dibandingkan, nol di depan diabaikan),
--                     mis. 'BCA # 5855820177' / 'Permata # 0099-2995-1325' (pola yang sama dengan COA NBM);
--   * buku kas      : akun yang account_name-nya cocok pola di blok v_akun (mis. 'Kas Kecil Warung Soemantri');
--   * ATAU isi "acc_no" pada item terkait di blok v_akun untuk memakai nomor akun yang sudah ada (menang atas pola).
--   Tiap item harus cocok TEPAT 1 akun (0 atau >1 = gagal). Klien dicari lewat nama_client = 'PT AKSHAYA ANANDA DYLAN LESTARI'. client_id / coa id TIDAK di-hardcode.
--
-- PERIKSA SEBELUM DIPAKAI:
--   * Rek. BCA 5265275785 atas nama ANTONIUS HARTONO K. (perorangan), bukan nama PT -- pastikan memang milik AADL.
--   * Permata ME Saver 0099-2995-1325: dokumen tanpa nama pemilik & tanpa saldo.
--   * Rekapan Putu: ada tanggal salah ketik (mis. 2025-01-05 di sheet Des 2025); dilaporkan sebagai peringatan saat preview.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_aadl_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_tpl_multi   UUID;
    -- Daftar rekening/kas yang dipetakan. norek = cari akun COA lewat nomor rekening di nama akun;
    -- name_re / name_not_re = pola regex (tidak peka huruf besar-kecil) pada nama akun; acc_no (opsional) = pakai nomor akun ini.
    v_akun        JSONB := $akun$[
  {
    "norek": "5855820177",
    "bank_name": "BCA",
    "account_number": "5855820177",
    "notes": "Rekening Giro BCA KCP Ampera a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF ESTATEMENT; nomor di nama file berawalan 0 -> 05855820177).",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "5855710177",
    "bank_name": "BCA",
    "account_number": "5855710177",
    "notes": "Rekening Giro BCA KCP Ampera a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF ESTATEMENT); memuat settlement MID d'kappu soemantri & transfer INTERSOFT SOLUTION.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "5855779177",
    "bank_name": "BCA",
    "account_number": "5855779177",
    "notes": "Rekening Giro BCA KCP Ampera a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF ESTATEMENT); memuat kredit Booking.com / Trip.com / Trinusa Travelindo & transfer 'NI LUH PUTU EKA YA'.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "5855600177",
    "bank_name": "BCA",
    "account_number": "5855600177",
    "notes": "Rekening Giro BCA KCP Ampera a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF ESTATEMENT); memuat kredit 'kos/kost <bulan>'.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "5265275785",
    "bank_name": "BCA",
    "account_number": "5265275785",
    "notes": "Rekening Tahapan BCA KCP Sahid Sudirman Residence. PERIKSA: nama pemilik di dokumen ANTONIUS HARTONO K. (bukan nama PT); isi mutasi hanya kredit VISIONET INTERNASIONAL + biaya adm. Pastikan memang rekening AADL sebelum dipakai.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "040901017700302",
    "bank_name": "BRI",
    "account_number": "040901017700302",
    "notes": "Giro Umum-IDR BRI KC Yogyakarta Mlati a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF IBBIZ).",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "040901001771307",
    "bank_name": "BRI",
    "account_number": "040901001771307",
    "notes": "Giro Umum-IDR BRI KC Yogyakarta Mlati a.n. AKSHAYA ANANDA DYLAN LESTARI (PDF IBBIZ); memuat Payoneer/Airbnb, Booking.com, Trinusa Travelindo, OffUs 'OMAH SOEMANT'.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "0099-2995-1325",
    "bank_name": "Permata",
    "account_number": "0099-2995-1325",
    "notes": "Permata ME Saver 0099-2995-1325 (PDF Transaction History aplikasi). Dokumen tidak memuat nama pemilik, saldo, maupun ringkasan; arah debit/kredit dibaca dari warna nominal.",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "norek": "0702-7771-771",
    "bank_name": "Permata Syariah",
    "account_number": "0702-7771-771",
    "notes": "Permata Unit Usaha Syariah 0702-7771-771 a.n. Akshaya Ananda Dylan Lestari (PDF Transaction History Financial).",
    "match_keyword": null,
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*warung",
    "name_not_re": "kost",
    "bank_name": "Kas Kecil Warung Soemantri",
    "account_number": null,
    "match_keyword": "\nWarung Soemantri",
    "notes": "Buku kas kecil 'Warung Soemantri' (Excel). match_keyword diawali baris baru supaya TIDAK ikut mencocokkan judul 'Kost Warung Soemantri' (substring yang sama).",
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*kost.*warung",
    "bank_name": "Kas Kecil Kost Warung Soemantri",
    "account_number": null,
    "match_keyword": "Kost Warung Soemantri",
    "notes": "Buku kas kecil 'Kost Warung Soemantri' (Excel).",
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*kost.*kapp?u",
    "bank_name": "Kas Kecil Kost Kapu Soemantri",
    "account_number": null,
    "match_keyword": "Kost Kapu Soemantri",
    "notes": "Buku kas kecil 'Kost Kapu Soemantri' (Excel).",
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*putu",
    "bank_name": "Kas Kecil Putu Soemantri Family Villas",
    "account_number": null,
    "match_keyword": "PUTU SOEMANTRI FAMILY VILLAS",
    "notes": "Buku kas kecil 'Putu Soemantri Family Villas - Denpasar' (Excel).",
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*omah",
    "bank_name": "Kas Kecil Omah Soemantri",
    "account_number": null,
    "match_keyword": "OMAH SOEMANTRI",
    "notes": "Buku kas kecil 'Omah Soemantri' (Excel).",
    "acc_no": null
  },
  {
    "name_re": "(kas|petty).*kapp?u",
    "name_not_re": "kost",
    "bank_name": "Kas Kecil d'Kappu Soemantri Coffee",
    "account_number": null,
    "match_keyword": "D'KAPPU SOEMANTRI COFFEE",
    "notes": "Buku kas harian 'D'KAPPU SOEMANTRI COFFEE' (Excel).",
    "acc_no": null
  }
]$akun$::jsonb;
    v_item        JSONB;
    v_i           INT;
    v_n           BIGINT;
    v_coa         UUID;
    v_coa_ids     UUID[] := ARRAY[]::UUID[];
    v_hilang      TEXT := '';
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT AKSHAYA ANANDA DYLAN LESTARI di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien AADL belum ada di management_clients (dicari nama_client = ''PT AKSHAYA ANANDA DYLAN LESTARI''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- 1) Cari akun COA untuk SEMUA item dulu; kalau ada yang belum ketemu / ambigu, gagal sebelum menyimpan apa pun.
    FOR v_i IN 0 .. jsonb_array_length(v_akun) - 1 LOOP
        v_item := v_akun -> v_i;
        SELECT count(*), (array_agg(c.id))[1] INTO v_n, v_coa
        FROM management_client_coa c
        WHERE c.client_id = v_client_id
          AND c.deleted_at IS NULL
          AND CASE
                WHEN NULLIF(v_item->>'acc_no', '') IS NOT NULL THEN
                    c.acc_no = v_item->>'acc_no'
                WHEN NULLIF(regexp_replace(COALESCE(v_item->>'norek', ''), '[^0-9]', '', 'g'), '') IS NOT NULL THEN
                    regexp_replace(c.account_name, '[^0-9]', '', 'g')
                        LIKE '%' || ltrim(regexp_replace(v_item->>'norek', '[^0-9]', '', 'g'), '0') || '%'
                WHEN NULLIF(v_item->>'name_re', '') IS NOT NULL THEN
                    c.account_name ~* (v_item->>'name_re')
                    AND (NULLIF(v_item->>'name_not_re', '') IS NULL OR c.account_name !~* (v_item->>'name_not_re'))
                ELSE false
              END;
        IF v_n <> 1 THEN
            v_hilang := v_hilang || E'\n  - ' || (v_item->>'bank_name') || ' '
                        || COALESCE(v_item->>'account_number', '(kas Excel)') || ': ditemukan ' || v_n || ' akun COA';
            v_coa := NULL;
        END IF;
        v_coa_ids := array_append(v_coa_ids, v_coa);
    END LOOP;

    IF v_hilang <> '' THEN
        RAISE EXCEPTION 'Akun COA AADL belum lengkap / ambigu (harus tepat 1 per item). Buat akun COA-nya dulu (nama akun bank memuat nomor rekening, mis. ''BCA # 5855820177''; nama akun kas mis. ''Kas Kecil Warung Soemantri'') atau isi acc_no di blok v_akun seed ini:%', v_hilang;
    END IF;

    -- 2) Satu baris template Multi
    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'AADL - Multi Format (BCA, BRI, Permata, Permata Syariah, Kas Kecil; PDF & Excel)', 'Multi', NULL, 1, 2,
        '3eb44bff214a2fe9a10900d70a9d795abb9fe3f05b72a7cf6eabb521469a968b',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien AADL (PT Akshaya Ananda Dylan Lestari) untuk import rekening koran & buku kas Cash & Bank > Source Data. 7 varian: BCA Rekening Giro/Tahapan (PDF), BRI IBBIZ (PDF), Permata ME Saver Transaction History (PDF), Permata Syariah Transaction History (PDF), dan 3 varian buku kas kecil Excel (Warung/Kost Warung/Kost Kapu/Putu; Omah; Kas d'Kappu). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "column_signature_hash": "a0c6dff260fef25439c5c1661a4ccc807894f981d023cb45410277f438ade91a",
      "variant_name": "BCA - Rekening Giro / Tahapan (PDF)",
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
          "filename_regex": "^(?:ESTATEMENT_0?(\\d{10})_(\\d{6})|(\\d{10})_(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)_(\\d{4}))"
        },
        "validation_expected": {
          "source": "ringkasan di halaman terakhir (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR)",
          "samples": [
            {
              "file": "ESTATEMENT_05855820177_202608.pdf",
              "account": "5855820177",
              "rows": 31,
              "opening_balance": "33598789.00",
              "closing_balance": "53081199.00",
              "total_credit": "26200000.00",
              "total_debit": "6717590.00",
              "count_credit": 22,
              "count_debit": 9
            },
            {
              "file": "ESTATEMENT_05855710177_202608.pdf",
              "account": "5855710177",
              "rows": 55,
              "opening_balance": "151625968.94",
              "closing_balance": "179248917.64",
              "total_credit": "44275101.70",
              "total_debit": "16652153.00",
              "count_credit": 38,
              "count_debit": 17
            },
            {
              "file": "ESTATEMENT_05855779177_202608.pdf",
              "account": "5855779177",
              "rows": 39,
              "opening_balance": "4819319.00",
              "closing_balance": "6061234.00",
              "total_credit": "31812684.00",
              "total_debit": "30570769.00",
              "count_credit": 23,
              "count_debit": 16
            },
            {
              "file": "ESTATEMENT_05855600177_202608.pdf",
              "account": "5855600177",
              "rows": 29,
              "opening_balance": "39917072.00",
              "closing_balance": "49782122.00",
              "total_credit": "18400000.00",
              "total_debit": "8534950.00",
              "count_credit": 17,
              "count_debit": 12
            },
            {
              "file": "5265275785_AUG_2026.pdf",
              "account": "5265275785",
              "rows": 20,
              "opening_balance": "2920942.67",
              "closing_balance": "4404730.67",
              "total_credit": "1499788.00",
              "total_debit": "16000.00",
              "count_credit": 19,
              "count_debit": 1
            }
          ]
        },
        "catatan_analisis": "Rekening Koran BCA Agustus 2026 untuk 5 rekening (4 Giro KCP Ampera + 1 Tahapan KCP Sahid Sudirman Residence); header kolom TANGGAL/KETERANGAN/CBG/MUTASI/SALDO SAMA dengan BCA di seed NBM/SAU sehingga hash varian & resep bca_pdf sama. Nominal MUTASI satu kolom, sufiks 'DB' = debit (tanpa sufiks = kredit), saldo hanya tercetak di baris terakhir tiap hari, tanggal 'dd/mm' (tahun dari 'PERIODE : <BULAN> <TAHUN>'). NAMA FILE ESTATEMENT memakai nomor 11 digit berawalan 0 (05855820177) padahal nomor di dokumen 10 digit (5855820177) -> mapping memakai nomor di dokumen. Diuji semua: jumlah baris, total & jumlah baris CR/DB, saldo awal/akhir sama persis dengan ringkasan dokumen dan 0 selisih saldo berjalan.",
        "recipe": "bca_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py. Kalau header file tidak cocok, parser generik tetap jalan."
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
          "filename_regex": "^IBIZ_(\\d{15})_(\\d{8})_(\\d{8})_"
        },
        "validation_expected": {
          "source": "blok ringkasan di halaman terakhir (Saldo Awal / Total Transaksi Debet / Total Transaksi Kredit / Saldo Akhir)",
          "samples": [
            {
              "file": "IBIZ_040901017700302_20260801_20260831_1788410142216896997.pdf",
              "account": "040901017700302",
              "rows": 36,
              "opening_balance": "642546.60",
              "closing_balance": "7244073.60",
              "total_credit": "10135527.00",
              "total_debit": "3534000.00"
            },
            {
              "file": "IBIZ_040901001771307_20260801_20260831_1788410131841153200.pdf",
              "account": "040901001771307",
              "rows": 186,
              "opening_balance": "18717713.80",
              "closing_balance": "55013459.80",
              "total_credit": "130819297.00",
              "total_debit": "94523551.00"
            }
          ]
        },
        "catatan_analisis": "Laporan Transaksi Finansial (IBBIZ) Giro Umum-IDR BRI KC Yogyakarta Mlati, Agustus 2026 (2 halaman / 8 halaman), layout sama dengan BRI NBM/SAU sehingga hash varian & resep bri_pdf sama. Debet & Kredit dua kolom, saldo tercetak di tiap baris, keterangan bisa 2 baris (BI-Fast) dan ditempel ke transaksi di atasnya. Nama file memuat nomor rekening 15 digit yang sama dengan header dokumen. Diuji: total debit/kredit, saldo awal/akhir sama persis dengan blok ringkasan, 0 selisih saldo berjalan.",
        "recipe": "bri_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "column_signature_hash": "9d11ffa6675bc32fcf09d321e0dcbd278947be3e6741aa78d1e00aa47db6ef34",
      "variant_name": "Permata - ME Saver Transaction History (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "Transaction History",
        "Permata ME Saver"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Transaction History",
            "role": "ignore"
          },
          {
            "header": "Permata ME Saver",
            "role": "ignore"
          }
        ],
        "amount_mode": "single",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "Permata",
        "date_format": "'dd <Bulan> yyyy' pada baris judul tanggal (bar biru); jam transaksi ada di dalam keterangan",
        "detect": {
          "account_number_regex": "\\b(\\d{4})-(\\d{4})-(\\d{4})\\b",
          "filename_regex": "^Transaction_History_-_Permata_ME_Saver(\\d+)"
        },
        "validation_expected": {
          "source": "TIDAK ADA ringkasan/saldo di dokumen -- hanya bisa dicek jumlah baris & total mutasi hasil baca",
          "samples": [
            {
              "file": "Transaction_History_-_Permata_ME_Saver1325_-_3182026114133.pdf",
              "account": "009929951325",
              "rows": 10,
              "total_debit": "6438203.00",
              "total_credit": "6444298.00"
            }
          ]
        },
        "catatan_analisis": "Riwayat transaksi Permata ME Saver dari aplikasi (2 halaman, kartu per transaksi). Nominal 'Rp x' satu kolom TANPA tanda +/-: arah HANYA terlihat dari warna (merah = uang keluar, hijau = uang masuk) dan ikon panah, jadi teks biasa tidak cukup -- resep membaca warna nominal lewat pdfplumber. Tidak ada saldo awal/akhir, saldo per baris, maupun ringkasan; nama pemilik rekening juga tidak tercetak. Urutan dokumen = terbaru di atas, dibalik jadi kronologis. Keterangan 2 baris digabung (nominal rata-tengah vertikal terhadap barisnya).",
        "recipe": "permata_me_pdf",
        "recipe_catatan": "Resep BARU di bank_statement_recipes_aadl.py (harus dipasang, lihat kepala seed). Tanpa resep, parser generik tidak bisa menentukan arah debit/kredit dari warna."
      }
    },
    {
      "column_signature_hash": "489eaa56e0ecad3ec73ba85a2ad506389f9376fb6cf550a1d7ef4d9119be55c1",
      "variant_name": "Permata Syariah - Transaction History Financial (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "Transaction",
        "Value",
        "Transaction Reference No./",
        "Description",
        "Amount"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Transaction",
            "role": "date"
          },
          {
            "header": "Value",
            "role": "ignore"
          },
          {
            "header": "Transaction Reference No./",
            "role": "reference"
          },
          {
            "header": "Description",
            "role": "description"
          },
          {
            "header": "Amount",
            "role": "amount"
          }
        ],
        "amount_mode": "single",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "Permata Syariah",
        "date_format": "dd Mon yyyy (Transaction Date) -- Value Date sama dan diabaikan",
        "detect": {
          "account_number_regex": "Account No\\.\\s*(\\d{4}-\\d{4}-\\d{3,4})",
          "filename_regex": "^\\d{6}_\\d{6}_report_(\\d+)_transactionhistory"
        },
        "validation_expected": {
          "source": "kepala dokumen (Opening Balance / Total Debit / Total Credit / Closing Balance); tidak ada saldo per baris",
          "samples": [
            {
              "file": "260903_113756_report_07027771771_transactionhistory.pdf",
              "account": "07027771771",
              "rows": 20,
              "opening_balance": "146294385.00",
              "closing_balance": "223901428.00",
              "total_debit": "22411175.00",
              "total_credit": "100018218.00"
            }
          ]
        },
        "catatan_analisis": "Permata Unit Usaha Syariah 'TRANSACTION HISTORY / Financial', 2 halaman. Satu kolom Amount: uang keluar bertanda '-' (mis. '- 2,000.00'), uang masuk tanpa tanda. Nominal rata-tengah vertikal terhadap baris (keterangan 2-3 baris), jadi baris dikelompokkan dari jangkar tanggal. Urutan dokumen = terbaru di atas -> dibalik jadi kronologis. Saldo tidak tercetak per baris: saldo akhir dokumen dipakai sebagai checkpoint baris terakhir, total debit/kredit dicocokkan dengan kepala dokumen. Baris 'Biaya adm', 'PB Bagi Hasil' dan 'PB Pajak Bagi Hasil' tanggal 01/08 tanpa nomor referensi ikut diimpor.",
        "recipe": "permata_syariah_pdf",
        "recipe_catatan": "Resep BARU di bank_statement_recipes_aadl.py (harus dipasang, lihat kepala seed). resep permata_pdf lama membaca 0 baris dari format ini."
      }
    },
    {
      "column_signature_hash": "537a2ec82cd0a707df333dc1ef983f37042dbcab5de7c340c12b184e5cd1dcc3",
      "variant_name": "Kas Kecil - Rekapan Patty Cash (Warung, Kost Warung, Kost Kapu, Putu)",
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 5,
      "data_start_row_index": 6,
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "NO",
            "role": "ignore"
          },
          {
            "header": "TANGGAL",
            "role": "date"
          },
          {
            "header": "KETERANGAN",
            "role": "description"
          },
          {
            "header": "DEBET",
            "role": "credit"
          },
          {
            "header": "CREDIT",
            "role": "debit"
          },
          {
            "header": "SALDO",
            "role": "balance"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "Kas Kecil",
        "date_format": "sel tanggal Excel (datetime); sel tanggal kosong = ikut tanggal baris di atasnya",
        "detect": {
          "title_keywords": [
            "Warung Soemantri",
            "Kost Warung Soemantri",
            "Kost Kapu Soemantri",
            "PUTU SOEMANTRI FAMILY VILLAS"
          ],
          "filename_regex": "^Rekap(?:an)?_Pembayaran_Patty_?[Cc]ash",
          "catatan": "Tidak punya nomor rekening; cabang kas dikenali dari judul sel A3 (A2 untuk Putu) lewat match_keyword di bank mapping."
        },
        "opening_balance_row": {
          "match": "KETERANGAN = 'Saldo Awal' (saldo di kolom SALDO, kolom DEBET/CREDIT kosong)",
          "catatan": "Baris 'Saldo Awal' tiap sheet = saldo awal, BUKAN mutasi."
        },
        "validation_expected": {
          "source": "TIDAK ADA ringkasan resmi; divalidasi lewat saldo berjalan (kolom SALDO) tiap baris + sambungan saldo akhir -> saldo awal antar sheet bulanan (0 selisih di semua file contoh)",
          "samples": [
            {
              "file": "Rekapan_Pembayaran_Pattycash_Warung_Soemantri_2026__1_.xlsx",
              "rows": 210,
              "opening_balance": "1100561",
              "closing_balance": "1556040",
              "total_credit_masuk": "90010279",
              "total_debit_keluar": "89554800",
              "period": "2025-12-02 s/d 2026-08-31",
              "sheets": [
                "Desember 2025",
                "Januari 2026",
                "Februari 2026",
                "Maret 2026",
                "April 2026",
                "Mei 2026",
                "Juni 2026",
                "Juli 2026",
                "Agustus 2026"
              ]
            },
            {
              "file": "Rekapan_Pembayaran_Pattycash_Kost_Warung_Soemantri_2026__1_.xlsx",
              "rows": 136,
              "opening_balance": "629537",
              "closing_balance": "1096620",
              "total_credit_masuk": "24993650",
              "total_debit_keluar": "24526567",
              "period": "2025-12-02 s/d 2026-08-31",
              "sheets": [
                "Desember 2025",
                "Januari 2026",
                "Februari 2026",
                "Maret 2026",
                "April 2026",
                "Mei 2026",
                "Juni 2026",
                "Juli 2026",
                "Agustus 2026"
              ]
            },
            {
              "file": "Rekapan_Pembayaran_Pattycash_Kost_Kapu_Soemantri_2026__1_.xlsx",
              "rows": 109,
              "opening_balance": "807335",
              "closing_balance": "1043102",
              "total_credit_masuk": "27837720",
              "total_debit_keluar": "27601953",
              "period": "2025-12-01 s/d 2026-08-31",
              "sheets": [
                "Desember 2025",
                "Januari 2026",
                "Februari 2026",
                "Maret 2026",
                "April 2026",
                "Mei 2026",
                "Juni 2026",
                "Juli 2026",
                "Agustus 2026",
                "September 2026"
              ]
            },
            {
              "file": "Rekapan_Pembayaran_Patty_Cash_Putu_Soemantri_2026__1_.xlsx",
              "rows": 630,
              "opening_balance": "138368",
              "closing_balance": "2787856",
              "total_credit_masuk": "129750000",
              "total_debit_keluar": "127100512",
              "period": "2025-01-05 s/d 2026-09-01",
              "sheets": [
                "Desember 2025",
                "Januari 2026",
                "Februari 2026",
                "Maret 2026",
                "April 2026",
                "Mei 2026",
                "Juni 2026",
                "Juli 2026",
                "Agustus 2026",
                "September 2026"
              ]
            }
          ]
        },
        "catatan_analisis": "Empat workbook 'Rekapan Pembayaran Patty Cash' dengan header identik (NO | TANGGAL | KETERANGAN | DEBET | CREDIT | SALDO; header di baris 5, Putu di baris 4). PERHATIAN ARAH: kolom DEBET = uang MASUK (menambah SALDO; mis. 'Terima Pencairan Adv', pendapatan penjualan) dan CREDIT/KREDIT = uang KELUAR (belanja/biaya) -- kebalikan rekening koran bank. Karena itu role: DEBET -> credit, CREDIT -> debit (konvensi aplikasi: debit = keluar, credit = masuk). 1 workbook = 1 file untuk 1 kas, banyak sheet bulanan (Des 2025 - Sep 2026); resep membaca SEMUA sheet bulanan (nama sheet berawalan bulan; 'Sheet1/Sheet2' diabaikan) dan berhenti di baris penutup 'Saldo ...'/'Total'. Mutasi yang sudah pernah diimpor di-skip lewat row_hash, jadi unggah ulang workbook yang sama aman. Baris tanpa tanggal ikut tanggal baris di atasnya (atau tgl 1 bulan sheet kalau di awal sheet); tanggal salah ketik di luar bulan sheet dilaporkan sebagai peringatan. Putu: baris 'Saldo Akhir 2026' di bawah tabel tidak diimpor; sel tanggal sering kosong.",
        "recipe": "kas_ledger_xlsx",
        "recipe_catatan": "Resep BARU di bank_statement_recipes_aadl.py (harus dipasang, lihat kepala seed). Resep kas_kasir_xlsx lama mencari header Kas Kasir Finance dan menolak file ini."
      }
    },
    {
      "column_signature_hash": "68b806494b48ebb414854a395df8c5617988c3bb1a1516297a7ae12ad7dec40f",
      "variant_name": "Kas Kecil - Rekapan Patty Cash Omah Soemantri",
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 6,
      "data_start_row_index": 7,
      "header_columns": [
        "NO",
        "TANGGAL",
        " ",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "NO",
            "role": "ignore"
          },
          {
            "header": "TANGGAL",
            "role": "date"
          },
          {
            "header": " ",
            "role": "description"
          },
          {
            "header": "DEBET",
            "role": "credit"
          },
          {
            "header": "CREDIT",
            "role": "debit"
          },
          {
            "header": "SALDO",
            "role": "balance"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "table",
        "bank_name": "Kas Kecil",
        "date_format": "sel tanggal Excel (datetime); sel tanggal kosong = ikut tanggal baris di atasnya",
        "detect": {
          "title_keywords": [
            "OMAH SOEMANTRI"
          ],
          "filename_regex": "^Rekap(?:an)?_Pembayaran_Patty_?[Cc]ash",
          "catatan": "Judul kolom ketiga (keterangan) berupa SPASI KOSONG -> hash header beda dari 4 workbook lain; judul 'OMAH SOEMANTRI' di A3."
        },
        "opening_balance_row": {
          "match": "KETERANGAN = 'Saldo Awal' (saldo di kolom SALDO, kolom DEBET/CREDIT kosong)",
          "catatan": "Baris 'Saldo Awal' tiap sheet = saldo awal, BUKAN mutasi."
        },
        "validation_expected": {
          "source": "TIDAK ADA ringkasan resmi; divalidasi lewat saldo berjalan (kolom SALDO) tiap baris + sambungan saldo akhir -> saldo awal antar sheet bulanan (0 selisih di semua file contoh)",
          "samples": [
            {
              "file": "Rekap_Pembayaran_Patty_cash_Omah_Soemantri_-_2026__1_.xlsx",
              "rows": 1582,
              "opening_balance": "2290693",
              "closing_balance": "3325753",
              "total_credit_masuk": "365893991",
              "total_debit_keluar": "364858931",
              "period": "2025-12-01 s/d 2026-08-31",
              "sheets": [
                "Desember 2025",
                "Januari 2026",
                "Februari 2026",
                "Maret 2026",
                "April 2026",
                "Mei 2026",
                "Juni 2026",
                "Juli 2026",
                "Agustus 2026"
              ]
            }
          ]
        },
        "catatan_analisis": "Workbook Omah Soemantri: sama dengan rekapan lain, tetapi kolom ketiga tanpa judul dan header di baris 6 (tanggal 1/4/2026 tercetak di A4 dan diabaikan). Kolom CREDIT memuat sel ' ' (spasi) -> dianggap kosong. PERHATIAN ARAH: kolom DEBET = uang MASUK (menambah SALDO; mis. 'Terima Pencairan Adv', pendapatan penjualan) dan CREDIT/KREDIT = uang KELUAR (belanja/biaya) -- kebalikan rekening koran bank. Karena itu role: DEBET -> credit, CREDIT -> debit (konvensi aplikasi: debit = keluar, credit = masuk). 1 workbook = 1 file untuk 1 kas, banyak sheet bulanan (Des 2025 - Sep 2026); resep membaca SEMUA sheet bulanan (nama sheet berawalan bulan; 'Sheet1/Sheet2' diabaikan) dan berhenti di baris penutup 'Saldo ...'/'Total'. Mutasi yang sudah pernah diimpor di-skip lewat row_hash, jadi unggah ulang workbook yang sama aman. Baris tanpa tanggal ikut tanggal baris di atasnya (atau tgl 1 bulan sheet kalau di awal sheet); tanggal salah ketik di luar bulan sheet dilaporkan sebagai peringatan.",
        "recipe": "kas_ledger_xlsx",
        "recipe_catatan": "Resep BARU di bank_statement_recipes_aadl.py (harus dipasang, lihat kepala seed). Resep kas_kasir_xlsx lama mencari header Kas Kasir Finance dan menolak file ini."
      }
    },
    {
      "column_signature_hash": "cb6b215adc3ffca23093920fd484834d85c7e1aa055dd5c4527b138ff4b5717d",
      "variant_name": "Kas Kecil - Kas d'Kappu Soemantri Coffee",
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 4,
      "data_start_row_index": 5,
      "header_columns": [
        "No",
        "Tanggal",
        "Keterangan",
        "Debet",
        "Kredit",
        "Saldo"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "No",
            "role": "ignore"
          },
          {
            "header": "Tanggal",
            "role": "date"
          },
          {
            "header": "Keterangan",
            "role": "description"
          },
          {
            "header": "Debet",
            "role": "credit"
          },
          {
            "header": "Kredit",
            "role": "debit"
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
        "method": "table",
        "bank_name": "Kas Kecil",
        "date_format": "sel tanggal Excel (datetime); sel tanggal kosong = ikut tanggal baris di atasnya",
        "detect": {
          "title_keywords": [
            "D'KAPPU SOEMANTRI COFFEE"
          ],
          "filename_regex": "^\\d{4}_Kas_d_Kappu_Soemantri_Coffee",
          "catatan": "Judul 'D'KAPPU SOEMANTRI COFFEE' di A2; kolom ke-5 bernama 'Kredit' (bukan 'CREDIT') -> hash header beda."
        },
        "opening_balance_row": {
          "match": "KETERANGAN = 'Saldo Awal' (saldo di kolom SALDO, kolom DEBET/CREDIT kosong)",
          "catatan": "Baris 'Saldo Awal' tiap sheet = saldo awal, BUKAN mutasi."
        },
        "validation_expected": {
          "source": "TIDAK ADA ringkasan resmi; divalidasi lewat saldo berjalan (kolom SALDO) tiap baris + sambungan saldo akhir -> saldo awal antar sheet bulanan (0 selisih di semua file contoh)",
          "samples": [
            {
              "file": "2026_Kas_d_Kappu_Soemantri_Coffee_24_-_31_Agustus__26.xlsx",
              "rows": 527,
              "opening_balance": "791500",
              "closing_balance": "714110",
              "total_credit_masuk": "48947310",
              "total_debit_keluar": "49024700",
              "period": "2026-01-01 s/d 2026-08-31",
              "sheets": [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "Mei",
                "Juni",
                "Juli",
                "Agustus"
              ]
            }
          ]
        },
        "catatan_analisis": "Workbook Kas d'Kappu: sheet bulanan 'Jan'..'September' (tanpa tahun di nama sheet; tahun dari sel tanggal), header di baris 4, baris 'Saldo awal' memuat tanggal 1 bulan itu. PERHATIAN ARAH: kolom DEBET = uang MASUK (menambah SALDO; mis. 'Terima Pencairan Adv', pendapatan penjualan) dan CREDIT/KREDIT = uang KELUAR (belanja/biaya) -- kebalikan rekening koran bank. Karena itu role: DEBET -> credit, CREDIT -> debit (konvensi aplikasi: debit = keluar, credit = masuk). 1 workbook = 1 file untuk 1 kas, banyak sheet bulanan (Des 2025 - Sep 2026); resep membaca SEMUA sheet bulanan (nama sheet berawalan bulan; 'Sheet1/Sheet2' diabaikan) dan berhenti di baris penutup 'Saldo ...'/'Total'. Mutasi yang sudah pernah diimpor di-skip lewat row_hash, jadi unggah ulang workbook yang sama aman. Baris tanpa tanggal ikut tanggal baris di atasnya (atau tgl 1 bulan sheet kalau di awal sheet); tanggal salah ketik di luar bulan sheet dilaporkan sebagai peringatan.",
        "recipe": "kas_ledger_xlsx",
        "recipe_catatan": "Resep BARU di bank_statement_recipes_aadl.py (harus dipasang, lihat kepala seed). Resep kas_kasir_xlsx lama mencari header Kas Kasir Finance dan menolak file ini."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    -- 3) Bank mapping: satu baris per rekening / buku kas
    FOR v_i IN 0 .. jsonb_array_length(v_akun) - 1 LOOP
        v_item := v_akun -> v_i;
        INSERT INTO financial_transaction_bank_cash_bank_mappings (
            client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, v_item->>'bank_name', NULLIF(v_item->>'account_number', ''),
            NULLIF(v_item->>'match_keyword', ''), v_coa_ids[v_i + 1], v_tpl_multi, v_item->>'notes', true, 0
        );
    END LOOP;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI' AND t.deleted_at IS NULL;      -- harus 1 baris, 7 varian
-- SELECT m.bank_name, m.account_number, m.match_keyword, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT AKSHAYA ANANDA DYLAN LESTARI' AND m.deleted_at IS NULL
-- ORDER BY m.bank_name, m.account_number;                             -- harus 15 baris