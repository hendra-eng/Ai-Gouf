-- seed_template_sau_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien SAU (CV Sumber Alodie Utama). SATU baris setting ("Multi") untuk
-- halaman Transactions > Sales > Source Data, yang melayani laporan
-- penjualan dari KEEMPAT cabang:  CRS, NGY, OL, PCL.
--
-- STATUS: varian CSV dan PDF. Varian Excel ditambahkan kemudian ke array
-- "variants" (tidak perlu baris template baru -- lihat bagian "Menambah
-- varian" di bawah). Varian PDF = DEFINISI pola; parser PDF untuk Sales
-- belum ada di backend -- lihat bagian "PERINGATAN -- PARSER PDF".
--
-- SUMBER (dataset/template_laporan/SAU/, periode 01/07/26 - 31/07/26):
--   Detail PENJ CRS.csv   91.912 baris, 10.769 invoice (KSR- 9.893, JL- 876), cp1252
--   Detail PENJ NGY.csv   12.825 baris,    645 invoice (JL-)
--   Detail PENJ OL.csv       100 baris,      9 invoice (JL-)
--   Detail PENJ PCL.csv    1.811 baris,    159 invoice (JL-)
-- Keempatnya BERFORMAT SAMA: header baris 8 identik (hash di bawah), delimiter
-- ';', tanggal DD/MM/YYYY, angka ribuan '.', 1 invoice = 1 blok beberapa baris.
-- Karena itu CUKUP 1 varian CSV -- tidak perlu varian per cabang. Hasil uji
-- (parser sales_import_v1.py): jumlah total tiap file = "Total Akhir" resmi di
-- bagian bawah file, tanpa baris invalid dan tanpa duplikat.
--
-- SUMBER PDF (laporan yang SAMA dicetak ke PDF; periode 01/06/26 - 30/06/26,
-- jadi isinya BUKAN invoice yang sama dengan CSV Juli di atas):
--   Detail_CRS_p.pdf        1.813 halaman, 10.714 invoice (KSR- 9.795, JL- 919)
--   Detail_NGY_p.pdf          273 halaman,    682 invoice (JL-)
--   Detail_OL_P (2).pdf         3 halaman,     16 invoice (JL-)
--   Detail_PCL_p (1).pdf       54 halaman,    171 invoice (JL-)
-- Keempatnya dibuat generator yang sama (Developer Express DXperience), A4
-- 595x841 pt, punya text layer (bukan scan -> tidak perlu OCR), dan POSISI
-- KOLOM-nya identik di keempat file maupun di semua halaman yang diperiksa:
--   No Transaksi x0~20 | Tanggal ~110 | Dept. ~175 | Kode Pel. ~211 |
--   Nama Pelanggan ~274 | Alamat ~393  (satuan pt, dari kata header tabel).
-- Hasil uji prototipe (membaca kata + posisi, 1 invoice = 1 baris): jumlah
-- "Total Akhir" semua invoice SAMA PERSIS dengan "Total Akhir" resmi di bagian
-- bawah tiap file, tanpa invoice tanpa footer dan tanpa nomor ganda:
--   CRS 5.388.951.710 (potongan 4.279.500) | NGY 6.892.925.350 |
--   OL 1.492.376.000 (potongan 744.000)    | PCL 1.104.468.000
-- Nama pelanggan hasil baca PDF dibandingkan ke CSV lewat kode pelanggan: 130
-- dari 131 kode yang bisa dibandingkan identik (1 beda cuma huruf terakhir
-- terpotong di PDF). Karena formatnya sama untuk keempat cabang, CUKUP 1
-- varian PDF -- tidak perlu varian per cabang.
--
-- CARA APLIKASI MEMBACA UPLOAD TIAP CABANG:
--   1. User upload file di Sales > Source Data dengan klien SAU aktif.
--   2. Backend memecah baris ini jadi template virtual per varian, lalu
--      memilih varian bertipe CSV yang hash baris ke-8 file-nya cocok
--      (column_signature_hash varian) -> file CRS/NGY/OL/PCL semuanya cocok.
--   3. Resep "grouped_invoice_report" membaca blok per invoice ->
--      1 baris source_rows = 1 invoice (dpp = Total Akhir - Pajak,
--      ppn = Pajak, total = Total Akhir).
--   4. CABANG diambil dari NAMA FILE lewat mapping_rules.cabang_dari_nama_file
--      (pola ^Detail[ _]+PENJ[ _]+([A-Za-z]+)): "Detail PENJ CRS.csv" -> CRS,
--      "Detail_PENJ_NGY.csv" -> NGY, "Detail_PENJ_CRS__1_.csv" -> CRS.
--      Pola SENGAJA menerima spasi ATAU underscore (hasil unduhan browser
--      sering mengganti spasi jadi '_' dan menambah akhiran "(1)").
--      Kalau nama file tidak berawalan "Detail PENJ <KODE>", cabang dibiarkan
--      kosong dan jurnal memakai akun pendapatan default.
--
-- CARA APLIKASI MEMBACA UPLOAD PDF (varian PDF):
--   1. Penanda varian = header tabel "No Transaksi | Tanggal | Dept. |
--      Kode Pel. | Nama Pelanggan | Alamat" (6 sel, dinormalisasi persis
--      seperti _normalisasi_baris: trim, spasi tunggal, huruf kecil, digabung
--      '|') -> SHA-256 = df08d189fd72ef9f9aa484edc45b5858717906141e0bf2763aa1b017af0cd3f5.
--      Judul "LAPORAN PENJUALAN DETAIL" di halaman 1 jadi pengaman tambahan
--      (laporan PDF SAU lain bisa memakai header tabel yang mirip).
--   2. Resep "grouped_invoice_report_pdf" membaca KATA + POSISI (x0, top),
--      bukan baris teks: jangkar kolom ada di invoice_header.columns_x0.
--      Hasilnya sama dengan CSV: 1 baris source_rows = 1 invoice
--      (dpp = Total Akhir - Pajak, ppn = Pajak, total = Total Akhir).
--   3. CABANG dari NAMA FILE lewat pola KHUSUS PDF (beda dari CSV!). Nama file
--      PDF SAU yang ada memakai "Detail_<KODE>_p..." TANPA kata "PENJ"
--      ("Detail_PCL_p (1).pdf", "Detail_OL_P (2).pdf"), jadi pola CSV
--      ^Detail[ _]+PENJ[ _]+([A-Za-z]+) TIDAK cocok dan cabang akan kosong.
--      Pola PDF: ^Detail[ _]+(?:PENJ[ _]+)?(CRS|NGY|OL|PCL)(?![A-Za-z])
--      -> "Detail_PCL_p__1_.pdf" = PCL, "Detail PENJ CRS.pdf" = CRS. Daftar
--      kode SENGAJA dibatasi 4 cabang supaya nama seperti "Detail_penjualan_
--      bulanan.pdf" tidak terbaca sebagai cabang "penjualan". Kalau suatu saat
--      ada cabang baru, tambahkan kodenya di pola ini.
--   4. Pergantian halaman (PENTING, sudah diuji): invoice sering terpotong di
--      pergantian halaman -- footer "Pot. ... Total Akhir" bisa jatuh di
--      halaman berikutnya, header invoice bisa terbelah, dan di CRS ada 34
--      kasus header invoice dicetak 2x (di dasar halaman tanpa item, lalu
--      diulang lengkap di halaman berikutnya). Aturannya ada di
--      page_break_rules; tanpa aturan ini 34 invoice CRS terhitung ganda.
--
-- PERINGATAN -- PARSER PDF BELUM ADA: sales_import_v1.upload_source_file()
-- saat ini langsung mencatat file PDF sebagai 'Butuh Review' TANPA mencocokkan
-- template (cabang percabangan file_type == "PDF" sebelum _cocokkan_template),
-- dan _ekstrak_dengan_template() belum mengenal format_type
-- "grouped_invoice_report_pdf" (jenis tak dikenal jatuh ke _parse_flat_mapping).
-- Jadi seed ini baru MENYIAPKAN data pola; upload PDF baru benar-benar
-- terbaca otomatis setelah parser PDF dibuat di backend. Menjalankan seed ini
-- aman untuk upload CSV: kandidat template difilter per file_type, varian PDF
-- tidak pernah dimuat saat file yang diupload CSV.
--
-- KETAHANAN PEMBACAAN CSV:
--   * quoted_fields = true -> dibaca csv.reader, jadi nama item/pelanggan yang memuat
--     ';' atau tanda kutip (CRS punya 16 baris seperti "CHEF""S CHOICE 1 KG") tidak
--     menggeser kolom. Hasil identik dengan sebelumnya pada 4 file contoh.
--   * block_start_row_index = 9 (tepat setelah baris header ke-8). Baris 9-10 kosong dan
--     dilewati parser, jadi tidak bergantung pada panjang kop yang persis 10 baris.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level
-- atas baris ini; akun ada di seed_coa_sau.sql):
--   Dr Piutang      11300003 PIUTANG USAHA
--   Cr Pendapatan   CRS 41110001, NGY 41110002, OL 41110003, PCL 41110004;
--                   tanpa cabang -> 41110098 PENJUALAN
--   Cr PPN Keluaran 21400006 PAJAK KELUARAN
-- (sama dengan migration 20-set_sau_sales_accounts.sql; Settings > Account
-- Mapping klien, kalau diisi, tetap didahulukan.)
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian,
-- urut seperti di array "variants" dan dipisah ':' (pola seed NBM):
--   SHA-256("<hash_csv>:<hash_pdf>")
--   hash_csv = 9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06
--   hash_pdf = df08d189fd72ef9f9aa484edc45b5858717906141e0bf2763aa1b017af0cd3f5
-- -> 39445a8870fd4a05643011fb70291e5d74c94d028c65ddcc3b09a994ddcf4f64
-- (versi CSV-saja dulu: SHA-256(hash_csv) = dc3d9a9c5c192aa1b1f61cb68b498fbd66e12f699ca6799bd9413bff1caf7211. Kalau seed versi
-- itu sudah terlanjur dijalankan, hapus baris lamanya dulu -- lihat bagian
-- "Idempotensi".)
-- Nilai level baris (header_row_index, data_start_row_index, header_columns)
-- hanya pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan
-- adalah nilai di dalam tiap varian. Setiap kali varian ditambah/dihapus,
-- hitung ulang hash level baris dari gabungan hash varian (urutan = urutan
-- array "variants") -- lihat bagian "Menambah varian".
--
-- KLIEN: dicari lewat nama_client ('SAU' atau 'CV SUMBER ALODIE UTAMA', tidak
-- peka huruf besar/kecil) dan GAGAL dengan pesan jelas kalau belum ada di
-- management_clients. client_id & client_code diambil otomatis, tidak
-- di-hardcode.
--
-- PERINGATAN -- seed lama: seed_template_sau_detail_penjualan_csv.sql (baris
-- bertipe 'CSV', resep identik) sudah tercatat di history-migration.md. Kalau
-- seed itu sudah dijalankan di database ini, baris lama dan baris Multi ini
-- akan sama-sama menjadi kandidat; hasilnya tetap benar (resep sama) tapi
-- usage_count terbagi. Disarankan nonaktifkan/hapus baris lama setelah seed
-- ini terbukti jalan:
--   UPDATE financial_transaction_sales_import_templates t
--      SET is_active = false, edited_at = now()
--     FROM management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.file_type = 'CSV' AND t.column_signature_hash = '9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06';
-- Catatan: akun_default_sales() membaca akun dari template mana pun milik klien
-- yang punya piutang_account + pendapatan_account (tidak peduli is_active),
-- jadi akun jurnal tetap aman.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_template_sau_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan (gagal karena
-- UNIQUE uq_sales_import_templates_signature). Kalau resep direvisi dan perlu
-- dijalankan ulang, hapus dulu (hash BARU = versi CSV+PDF ini):
--   DELETE FROM financial_transaction_sales_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = '39445a8870fd4a05643011fb70291e5d74c94d028c65ddcc3b09a994ddcf4f64';
-- Kalau yang ada di database masih baris Multi versi CSV-saja (hash lama),
-- hapus yang itu sebelum menjalankan seed ini -- kalau tidak, hasilnya 2 baris
-- Multi untuk SAU (UNIQUE tidak menolak karena hash level barisnya beda):
--   DELETE FROM financial_transaction_sales_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = 'dc3d9a9c5c192aa1b1f61cb68b498fbd66e12f699ca6799bd9413bff1caf7211';
--
-- Menambah varian Excel nanti: tambahkan 1 objek lagi di array "variants"
-- (file_type 'Excel', sheet_name, header_row_index, data_start_row_index,
-- column_signature_hash dari baris header file contoh, header_columns,
-- mapping_rules), lalu hitung ulang hash level baris (lihat di atas). Kalau
-- seed ini sudah dijalankan, ubah baris yang ada lewat UPDATE (jangan INSERT
-- baru) atau hapus dulu lalu jalankan ulang file ini.
-- Varian PDF: header_row_index = 1 dan data_start_row_index = 2 adalah posisi
-- LOGIS (baris 1 = band header tabel, baris 2 = baris header invoice pertama),
-- bukan nomor baris fisik -- PDF tidak punya baris tetap karena teksnya
-- membungkus dan terpotong antar halaman. Pencocokannya lewat hash header.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi
-- ORM (bukan DEFAULT kolom database) -- lihat catatan di seed SAU lama.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = SAU / CV Sumber Alodie Utama). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    INSERT INTO financial_transaction_sales_import_templates (
        client_id,
        client_code,
        file_type,
        header_row_index,
        data_start_row_index,
        column_signature_hash,
        header_columns,
        mapping_rules,
        detected_by,
        is_active,
        usage_count
    ) VALUES (
        v_client_id,
        v_client_code,
        'Multi',
        1,
        2,
        '39445a8870fd4a05643011fb70291e5d74c94d028c65ddcc3b09a994ddcf4f64',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien SAU untuk laporan penjualan semua cabang (CRS, NGY, OL, PCL). Saat ini varian CSV dan PDF (format SAMA untuk keempat cabang di masing-masing tipe file); varian Excel ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok (lihat _template_dari_varian di sales_import_v1.py). Varian PDF baru berfungsi setelah parser PDF Sales dibuat di backend.",
  "variants": [
    {
      "file_type": "CSV",
      "sheet_name": null,
      "header_row_index": 8,
      "data_start_row_index": 11,
      "column_signature_hash": "9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06",
      "header_columns": [
        "No Transaksi",
        "",
        "Tanggal",
        "",
        "Dept.",
        "Kode Pel.",
        "Nama Pelanggan",
        "",
        "",
        "Alamat",
        "",
        "",
        ""
      ],
      "mapping_rules": {
        "format_type": "grouped_invoice_report",
        "description": "Laporan Penjualan Detail (POS/kasir) SAU -- 1 baris kanonis (source_rows) = 1 TRANSAKSI/INVOICE, bukan 1 baris item. Tiap invoice = 1 blok baris CSV: header invoice, label item, N baris item, subtotal, footer (Pot./Pajak/Biaya/Total Akhir), lalu 1 baris kosong. Format SAMA untuk keempat cabang (CRS, NGY, OL, PCL); cabang dibaca dari nama file.",
        "delimiter": ";",
        "quoted_fields": true,
        "encoding": "ISO-8859-1",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ".",
          "decimal_separator": ","
        },
        "preamble_rows": 7,
        "header_label_row_index": 8,
        "block_start_row_index": 9,
        "invoice_header": {
          "row_shape": "single_row",
          "columns": {
            "no_invoice": 1,
            "tanggal": 3,
            "dept": 5,
            "kode_pelanggan": 6,
            "nama_pelanggan": 7,
            "alamat": 10
          }
        },
        "item_header_marker": {
          "match_type": "exact_row_prefix",
          "value": "No.;Kd. Item;Nama Item"
        },
        "item_columns": {
          "no": 1,
          "kode_item": 2,
          "nama_item": 3,
          "jumlah": 8,
          "satuan": 9,
          "harga": 10,
          "potongan_persen": 11,
          "total": 12
        },
        "block_subtotal_columns": {
          "note": "Baris ringkasan sebelum footer -- informasional saja, TIDAK dipakai di field_mapping di bawah.",
          "jumlah_item_total": 8,
          "subtotal_sebelum_potongan_pajak_biaya": 12
        },
        "block_footer_marker": {
          "match_type": "exact_row_prefix",
          "value": "Pot. :"
        },
        "block_footer_columns": {
          "potongan": 2,
          "pajak": 5,
          "biaya": 8,
          "total_akhir": 11
        },
        "block_separator": {
          "match_type": "blank_row",
          "description": "Baris kosong (semua kolom trim-kosong) menandai akhir 1 blok invoice."
        },
        "end_of_data_marker": {
          "match_type": "contains",
          "value": "TOTAL KESELURUHAN",
          "description": "Begitu baris ini ditemukan, SISA file (ringkasan grand total + baris stempel tanggal cetak/REPORT) diabaikan."
        },
        "field_mapping": {
          "cabang": "substring nama file (Detail PENJ <CABANG>.csv)",
          "tanggal": "invoice_header.tanggal",
          "invoice": "invoice_header.no_invoice",
          "customer": "invoice_header.nama_pelanggan",
          "dpp": "block_footer.total_akhir - block_footer.pajak",
          "ppn": "block_footer.pajak",
          "total": "block_footer.total_akhir"
        },
        "cabang_dari_nama_file": {
          "pattern": "^Detail[ _]+PENJ[ _]+([A-Za-z]+)",
          "group": 1,
          "contoh": "Detail PENJ CRS.csv -> CRS; Detail_PENJ_NGY.csv -> NGY; Detail PENJ OL.csv -> OL; Detail_PENJ_CRS__1_.csv -> CRS"
        },
        "row_granularity": "per_invoice_block",
        "catatan_analisis": "Dianalisis dari 4 file contoh (periode 01/07/26-31/07/26): CRS 10.769 blok (KSR- 9.893, JL- 876, encoding cp1252), NGY 645 blok, OL 9 blok, PCL 159 blok (JL-). Header baris 8 identik di keempatnya (hash sama). Pajak dan Biaya selalu 0; Potongan ada di sebagian invoice (sudah terhitung di Total Akhir)."
      }
    },
    {
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "df08d189fd72ef9f9aa484edc45b5858717906141e0bf2763aa1b017af0cd3f5",
      "header_columns": [
        "No Transaksi",
        "Tanggal",
        "Dept.",
        "Kode Pel.",
        "Nama Pelanggan",
        "Alamat"
      ],
      "mapping_rules": {
        "format_type": "grouped_invoice_report_pdf",
        "description": "Laporan Penjualan Detail (POS/kasir) SAU versi PDF -- isi dan struktur blok SAMA dengan varian CSV: 1 baris kanonis (source_rows) = 1 TRANSAKSI/INVOICE, bukan 1 baris item. Tiap invoice = header invoice, band label item, N baris item, baris subtotal, footer (Pot./Pajak/Biaya/Total Akhir). Beda dengan CSV: tidak ada baris/sel, jadi resep memakai KATA + POSISI (x0, top) di text layer PDF. Format SAMA untuk keempat cabang (CRS, NGY, OL, PCL); cabang dibaca dari nama file.",
        "source_kind": "pdf_text_layer",
        "pdf_reader": {
          "input": "kata beserta koordinat (x0, top) dari text layer, mis. pdfplumber extract_words()",
          "line_grouping": "kata diurutkan menurut top lalu dikelompokkan jadi 1 baris bila selisih top <= 3 pt. WAJIB toleransi (bukan pembulatan per 2 pt): kata satu baris footer bisa berbeda ~1 pt secara vertikal dan terbelah jadi dua baris kalau dibulatkan.",
          "page_size_pt": [
            595,
            841
          ],
          "needs_ocr": false,
          "generator": "Developer Express Inc. DXperience v12.1.12 (informasional saja -- JANGAN dipakai untuk pencocokan template)"
        },
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ".",
          "decimal_separator": ","
        },
        "signature_rule": {
          "source": "band header tabel (halaman mana pun; berulang di tiap halaman)",
          "cells": [
            "No Transaksi",
            "Tanggal",
            "Dept.",
            "Kode Pel.",
            "Nama Pelanggan",
            "Alamat"
          ],
          "normalisasi": "trim, spasi berurutan jadi satu, huruf kecil, digabung '|' (sama dengan _normalisasi_baris di sales_import_v1.py)",
          "hash_input": "no transaksi|tanggal|dept.|kode pel.|nama pelanggan|alamat",
          "guard_judul_halaman_1": "LAPORAN PENJUALAN DETAIL"
        },
        "preamble": {
          "pages": [
            1
          ],
          "note": "Kop hanya ada di halaman 1: judul, periode, nama perusahaan, alamat, telepon. Halaman berikutnya langsung mulai dari band header tabel.",
          "periode_pattern": "PERIODE\\s*:\\s*(\\d{2}/\\d{2}/\\d{2,4})\\s*-\\s*(\\d{2}/\\d{2}/\\d{2,4})"
        },
        "ignore": {
          "table_header_band": {
            "match_type": "exact_row_prefix",
            "value": "No Transaksi Tanggal Dept. Kode Pel. Nama Pelanggan Alamat",
            "description": "Band header tabel diulang di bagian atas SETIAP halaman (top ~98 pt di halaman 1, ~17 pt di halaman lain). Dilewati, tapi jadi titik acuan pergantian halaman."
          },
          "page_stamp": {
            "description": "Baris cap di dasar tiap halaman: '<dd/mm/yyyy hh:mm> REPORT <n>/<N>'. Buang HANYA kata cap-nya (tanggal-jam dan REPORT di x0 < 130; penghitung halaman '<n>/<N>' di x0 >= 538). Kata lain pada baris yang sama BUKAN cap: lanjutan alamat invoice yang terpotong bisa tercetak di baris yang sama dengan cap."
          }
        },
        "invoice_header": {
          "row_shape": "single_row_wrapping",
          "no_invoice_pattern": "^[A-Z]{2,4}-\\d{5,8}-\\d{2}$",
          "start_marker": "kata pertama baris (x0 < 40) cocok no_invoice_pattern (mis. KSR-0046007-26, JL-0009480-26)",
          "columns_x0": {
            "note": "Rentang [min, max) pada x0 (tepi kiri) kata, satuan pt. Diukur dari kata header tabel dan identik di CRS, NGY, OL, PCL serta semua halaman yang diperiksa.",
            "no_invoice": [
              0,
              40
            ],
            "tanggal": [
              105,
              170
            ],
            "dept": [
              170,
              205
            ],
            "kode_pelanggan": [
              205,
              270
            ],
            "nama_pelanggan": [
              270,
              390
            ],
            "alamat": [
              390,
              545
            ]
          },
          "multiline_columns": [
            "nama_pelanggan",
            "alamat"
          ],
          "multiline_join": "spasi tunggal, urut dari atas ke bawah (lintas halaman bila perlu)",
          "ends_at": "item_header_marker",
          "catatan": "Nama pelanggan dan alamat membungkus ke baris-baris di bawah baris pertama dalam kolomnya masing-masing. Dept. kosong di semua contoh. alamat tidak dipakai field_mapping."
        },
        "item_header_marker": {
          "match_type": "exact_row_prefix",
          "value": "No. Kd. Item Nama Item"
        },
        "item_columns_x0": {
          "note": "Informasional -- TIDAK dipakai field_mapping di bawah (1 baris = 1 invoice). Perkiraan dari kata header/isi item. Kolom Jml dan Satuan bisa menyatu jadi 1 token (mis. '2SAK', '1' + '@25 Kg') dan angka rata kanan.",
          "no": [
            0,
            40
          ],
          "kode_item": [
            40,
            105
          ],
          "nama_item": [
            105,
            330
          ],
          "jml_satuan": [
            330,
            420
          ],
          "harga": [
            420,
            480
          ],
          "potongan_persen": [
            480,
            520
          ],
          "total": [
            520,
            590
          ]
        },
        "block_subtotal": {
          "note": "Baris ringkasan sebelum footer (jumlah item di kiri, subtotal sebelum potongan di kanan) -- informasional saja, TIDAK dipakai field_mapping. Bisa terpisah dari bloknya di pergantian halaman, jangan dijadikan penentu akhir blok."
        },
        "block_footer_marker": {
          "match_type": "regex",
          "value": "Pot\\.\\s*:\\s*(-?[\\d.]+)\\s+Pajak\\s*:\\s*(-?[\\d.]+)\\s+(?:Biaya\\s*:\\s*(-?[\\d.]+)\\s+)?Total Akhir\\s*:\\s*(-?[\\d.]+)",
          "groups": {
            "potongan": 1,
            "pajak": 2,
            "biaya": 3,
            "total_akhir": 4
          },
          "dipasang_pada": "teks 1 baris (hasil line_grouping)",
          "catatan": "Footer menutup blok invoice. Biaya boleh tidak terbaca (dianggap 0)."
        },
        "page_break_rules": [
          {
            "kasus": "footer_di_halaman_berikutnya",
            "aturan": "Bila item invoice meluber ke halaman berikutnya, footer (dan baris subtotal) tercetak di bagian ATAS halaman berikutnya, setelah band header tabel dan SEBELUM header invoice berikutnya. Footer selalu milik invoice terakhir yang masih terbuka (belum punya footer)."
          },
          {
            "kasus": "header_invoice_terbelah",
            "aturan": "Baris header invoice (no, tanggal, kode, nama, alamat) bisa tercetak di dasar halaman sementara lanjutan nama/alamat dan band label item ada di halaman berikutnya setelah band header tabel. Kata di kolom nama_pelanggan/alamat sebelum item_header_marker ditambahkan ke invoice yang sedang terbuka."
          },
          {
            "kasus": "header_invoice_dicetak_dua_kali",
            "aturan": "Bila nomor invoice yang SAMA muncul lagi saat invoice terbuka belum punya footer, itu salinan yang sama (header dicetak sendirian di dasar halaman lalu diulang lengkap di halaman berikutnya): JANGAN buat baris baru; pakai nama/alamat dari salinan kedua yang lengkap. Di contoh CRS terjadi 34x; tanpa aturan ini 34 invoice terhitung ganda."
          }
        ],
        "end_of_data_marker": {
          "match_type": "contains",
          "value": "TOTAL KESELURUHAN",
          "description": "Begitu baris ini ditemukan, SISA file (ringkasan grand total: Jumlah Item, Sub Total, Potongan, Pajak, Biaya Lain, Total Akhir, lalu cap halaman terakhir) diabaikan. Total Akhir ringkasan = jumlah Total Akhir semua invoice -- cocok untuk validasi."
        },
        "field_mapping": {
          "cabang": "substring nama file (Detail_<CABANG>_p.pdf / Detail PENJ <CABANG>.pdf)",
          "tanggal": "invoice_header.tanggal",
          "invoice": "invoice_header.no_invoice",
          "customer": "invoice_header.nama_pelanggan",
          "dpp": "block_footer.total_akhir - block_footer.pajak",
          "ppn": "block_footer.pajak",
          "total": "block_footer.total_akhir"
        },
        "cabang_dari_nama_file": {
          "pattern": "^Detail[ _]+(?:PENJ[ _]+)?(CRS|NGY|OL|PCL)(?![A-Za-z])",
          "group": 1,
          "contoh": "Detail_PCL_p__1_.pdf -> PCL; Detail_OL_P__2_.pdf -> OL; Detail_CRS_p.pdf -> CRS; Detail_NGY_p.pdf -> NGY; Detail PENJ CRS.pdf -> CRS",
          "catatan": "Beda dari pola CSV: kata PENJ opsional dan kode dibatasi 4 cabang. Tidak cocok -> cabang kosong dan jurnal memakai akun pendapatan default."
        },
        "row_granularity": "per_invoice_block",
        "catatan_analisis": "Dianalisis dari 4 PDF contoh (periode 01/06/26-30/06/26): CRS 1.813 hal / 10.714 invoice unik (KSR- 9.795, JL- 919; 34 header ganda digabung), NGY 273 hal / 682 invoice, OL 3 hal / 16 invoice, PCL 54 hal / 171 invoice (semua JL-). Posisi kolom dan band header identik di keempat file. Jumlah Total Akhir semua invoice = Total Akhir resmi tiap file (CRS 5.388.951.710; NGY 6.892.925.350; OL 1.492.376.000; PCL 1.104.468.000), tanpa invoice tanpa footer dan tanpa nomor ganda. Pajak dan Biaya selalu 0; Potongan ada di sebagian invoice (CRS total 4.279.500; OL 744.000) dan sudah terhitung di Total Akhir. Nama pelanggan identik dengan CSV pada 130 dari 131 kode pelanggan yang bisa dibandingkan."
      }
    }
  ],
  "piutang_account": {
    "account_code": "11300003",
    "account_name": "PIUTANG USAHA"
  },
  "pendapatan_account": {
    "account_code": "41110098",
    "account_name": "PENJUALAN"
  },
  "pendapatan_account_by_cabang": {
    "CRS": {
      "account_code": "41110001",
      "account_name": "PENJUALAN CRS"
    },
    "NGY": {
      "account_code": "41110002",
      "account_name": "PENJUALAN NGY"
    },
    "OL": {
      "account_code": "41110003",
      "account_name": "PENJUALAN OL"
    },
    "PCL": {
      "account_code": "41110004",
      "account_name": "PENJUALAN PCL"
    }
  },
  "ppn_account": {
    "account_code": "21400006",
    "account_name": "PAJAK KELUARAN"
  }
}$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA');