-- seed_template_nbm_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien NBM (PT Nawasanga Bertatap Muka). SATU baris setting ("Multi") untuk
-- halaman Transactions > Sales > Source Data.
--
-- STATUS: varian CSV (export POS "Report Item Details", 2 outlet FAS A FAS) dan
-- varian Excel (laporan "Penjualan per Pelanggan", wholesale), keduanya di
-- array "variants" pada SATU baris template Multi. Varian lain nanti cukup
-- ditambahkan ke array itu (lihat bagian "Menambah varian lagi" di bawah).
--
-- SUMBER CSV (dataset/template_laporan/NBM/):
--   Report Item Details - 01-08-2026 - 31-08-2026 - All_Outlet - 865077 - 6aade518.csv
--   Export POS (periode 01/08/26 - 31/08/26), 25 kolom, UTF-8 tanpa BOM, akhir
--   baris LF, delimiter ',', tanggal DD-MM-YYYY, angka memakai titik desimal
--   tanpa pemisah ribuan (mis. 42727.0). Header ada di baris 1, data mulai
--   baris 2, tanpa kop dan tanpa baris total di bawah.
--   5.737 baris data = 2.315 struk (Receipt Number), 2 outlet:
--     FAS A FAS CAFE AND BAKERY  1.561 struk  total 309.276.049,35
--     FAS A FAS TO-GO              754 struk  total  52.852.373,31
--   Tabel FLAT: 1 baris = 1 item dalam struk; banyak baris berbagi 1 Receipt
--   Number. Karena itu resepnya "flat_grouped_by_key" (bukan grouped_invoice_report
--   seperti SAU yang berblok).
--
-- CARA APLIKASI MEMBACA UPLOAD CSV NBM:
--   1. User upload file di Sales > Source Data dengan klien NBM aktif.
--   2. Backend memecah baris ini jadi template virtual per varian, lalu memilih
--      varian bertipe CSV yang hash baris ke-1 file-nya cocok
--      (column_signature_hash varian).
--   3. Resep "flat_grouped_by_key" menjumlah semua baris per Receipt Number ->
--      1 baris source_rows = 1 struk.
--   4. Hasil ekstraksi: invoice = Receipt Number, tanggal = Date, cabang = kosong
--      (NBM tidak memakai cabang; kolom Outlet hanya dipakai untuk nama customer
--      pengganti), customer = kolom Customer (kosong -> "Penjualan POS -
--      <Outlet>"), dpp = SUM(Net Sales + Gratuity), ppn = SUM(Tax), total = dpp + ppn.
--
-- KENAPA Gratuity MASUK DPP: di file, Tax = 10 persen x (Net Sales + Gratuity) pada
-- SEMUA 5.737 baris (selisih maks 0,005 = pembulatan). Jadi dasar pajaknya sudah
-- termasuk service charge (Gratuity = 5 persen Net Sales di Dine In & Take Away outlet
-- Cafe; 0 di GrabFood/GoFood/To-Go), dan total = Net + Gratuity + Tax = uang yang
-- benar-benar dibayar tamu, sehingga cocok dengan mutasi bank/EDC. Struk
-- source_rows hanya punya dpp/ppn/total (tidak ada kolom service charge).
--
-- REFUND: baris Event Type = Refund (5 baris, 4 struk) memakai Receipt Number
-- dan tanggal struk asalnya, dengan Net Sales/Tax NEGATIF, jadi otomatis
-- mengurangi struk asalnya. 2 struk di-refund PENUH (4Z7M0T, 4Z7LV0) -> total 0;
-- 2 struk refund SEBAGIAN (4Z7LZ8, 4Z7LZM) -> total tinggal sisanya.
--
-- HASIL UJI CSV (kode parser ASLI sales_import_v1.py dijalankan ke file contoh):
--   2.315 struk, tanpa baris invalid, tanpa Receipt Number ganda
--   DPP 329.207.656,95 + PPN 32.920.765,71 = TOTAL 362.128.422,66
--   (sama dengan hitungan terpisah memakai Decimal per struk: 0 selisih pada
--   dpp, ppn, total, cabang, tanggal, customer). Tetap cocok bila file diberi
--   BOM UTF-8 atau akhir baris CRLF.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA -- CSV (batas resep, bukan galat):
--   * Struk refund penuh (total 0) tetap diekstrak dan valid, lalu ikut menjadi
--     invoice bernilai 0 bila di-promote. Di file contoh ada 2 struk begini.
--     Parser belum punya opsi "lewati total 0" -- user yang memutuskan.
--   * 1 struk (1O5GF3) berisi nomor telepon di kolom Customer dengan awalan
--     apostrof ("'+62818700901", sisa format Excel), jadi nama customer-nya
--     apa adanya. Struk lain memakai "Penjualan POS - <Outlet>".
--   * Header file HARUS sama persis (25 kolom, urutan sama). Kalau POS menambah/
--     mengubah kolom, signature tidak cocok -> file masuk "Butuh Review" (aman,
--     tidak diekstrak salah) dan varian baru perlu ditambahkan.
--   * encoding = utf-8-sig (bukan utf-8) SENGAJA: file ekspor dengan BOM tetap
--     terbaca. Dengan utf-8 biasa, BOM menempel di sel "Outlet" -> hash header
--     tidak cocok.
--   * Baris tanpa Receipt Number TIDAK dibuang diam-diam (abaikan_baris_tanpa_key
--     tidak dipakai): ia muncul sebagai baris invalid "No. invoice kosong".
--
-- =============================================================
-- VARIAN EXCEL -- laporan "Penjualan per Pelanggan" (wholesale)
-- =============================================================
-- SUMBER EXCEL (dataset/template_laporan/NBM/):
--   sales_by_customer_01-08-2026_31-08-2026.xlsx
--   Laporan "Penjualan per Pelanggan" (kop: PT NAWASANGA BERTATAP MUKA, periode
--   01/08/2026 - 31/08/2026, "(dalam IDR)"). 1 sheet bernama "Sales by Customer",
--   A1:J2183. Kop 4 baris (sel gabungan A1:J4), baris 5 kosong, HEADER di baris 6
--   (10 kolom), data mulai baris 7, baris terakhir (2183) = "Grand Total".
--   Kolom: A Pelanggan / Tanggal | B Transaksi | C No | D Produk | E Keterangan |
--          F Kuantitas | G Satuan | H Harga Satuan | I Jumlah Tagihan | J Total
--   Bentuknya BERSEKSI per pelanggan (93 pelanggan), tiap seksi berisi:
--     baris judul : nama pelanggan di kolom A, kolom lain kosong
--     baris line  : A = tanggal (teks DD/MM/YYYY), B = "Sales Invoice",
--                   C = nomor invoice (INV/WS/<no>/<bulan romawi>/2026),
--                   D-H = produk, kuantitas, satuan, harga, I = jumlah tagihan line
--     baris total : kolom I = "(<Pelanggan>) | Total Penjualan", kolom J = jumlahnya
--   1.990 line = 851 invoice (1 invoice = 1 sampai N line produk). Kolom
--   Transaksi hanya berisi "Sales Invoice" dan kolom Keterangan kosong semua.
--
-- CARA APLIKASI MEMBACA UPLOAD EXCEL NBM:
--   1. Backend memilih varian bertipe Excel yang hash baris ke-6 file-nya cocok
--      (column_signature_hash varian). Sheet dibaca lewat nama "Sales by
--      Customer"; kalau namanya beda, dipakai sheet yang aktif.
--   2. Resep "sectioned_by_customer_header" membaca per seksi: baris yang kolom B
--      (Transaksi)-nya kosong = judul seksi (nama pelanggan dari kolom A); baris
--      "Total Penjualan" dilewati; baris "Grand Total" = akhir data.
--   3. Line dijumlah per nomor invoice (kolom C) -> 1 baris source_rows = 1 invoice.
--      Yang dijumlah kolom I (Jumlah Tagihan), BUKAN kolom J.
--   4. Hasil ekstraksi: invoice = nomor invoice, tanggal = kolom A, customer =
--      nama pelanggan seksi, cabang = kosong (file tidak punya kolom cabang),
--      dpp = SUM(Jumlah Tagihan), ppn = 0, total = dpp.
--
-- KENAPA kolom I, BUKAN J: kolom J (Total) adalah TOTAL BERJALAN per pelanggan
-- (baris pertama = nilainya sendiri, lalu bertambah di tiap line, kembali dari
-- awal di pelanggan berikutnya), bukan total invoice. Dipakai akan menghitung
-- berlipat-lipat. Dicek: J = jumlah berjalan kolom I pada semua 1.990 line.
--
-- DISKON: line dengan Produk = "Diskon" (140 line di 46 invoice, total
-- -2.222.725) bernilai NEGATIF; kuantitasnya teks kosong, satuan dan harga
-- kosong. Ikut dijumlah, jadi invoice tersimpan NETTO setelah diskon (cocok
-- dengan Grand Total file).
--
-- PAJAK (ASUMSI -- mohon dikonfirmasi): laporan ini tidak punya kolom pajak,
-- jadi ppn = 0 dan seluruh Jumlah Tagihan masuk dpp. Kalau harga wholesale ternyata
-- belum termasuk PPN/PB1 yang ditagihkan terpisah, resep ini perlu diubah.
--
-- HASIL UJI EXCEL (kode parser ASLI sales_import_v1.py -- _baca_excel_baris dan
-- _ekstrak_dengan_template -- dijalankan ke file contoh):
--   851 invoice, semuanya valid, tanpa nomor invoice ganda, tanggal 01-08-2026
--   s/d 31-08-2026, 93 pelanggan
--   DPP 204.221.225,00 + PPN 0,00 = TOTAL 204.221.225,00
--   = baris "Grand Total" file = jumlah semua baris "Total Penjualan" seksi
--   Cocok dengan hitungan terpisah memakai Decimal per nomor invoice dari sel
--   mentah (0 selisih). Tiap nomor invoice hanya muncul di 1 pelanggan dan 1
--   tanggal, jadi penjumlahan per nomor invoice aman.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA -- EXCEL (batas resep, bukan galat):
--   * Header di baris 6 HARUS sama persis (10 kolom, urutan sama). Kalau software
--     sumber menambah/mengubah kolom, signature tidak cocok -> file masuk "Butuh
--     Review" (aman, tidak diekstrak salah) dan varian baru perlu ditambahkan.
--     Kop baris 1-4 (periode, dll) boleh berubah; header tetap harus di baris 6.
--   * Excel tidak punya kolom cabang, jadi cabang invoice kosong dan jurnal
--     memakai akun pendapatan default -- lihat AKUN JURNAL di bawah.
--   * Nama pelanggan dipakai apa adanya dari judul seksi.
--   * Resep belum punya opsi "lewati invoice bernilai 0 atau negatif"; di file
--     contoh tidak ada invoice seperti itu.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level
-- atas baris ini; semua akun ada di seed_coa_nbm.sql). INI ASUMSI -- mohon
-- dikonfirmasi:
--   Dr Piutang      1-10100 Piutang Usaha
--   Cr Pendapatan   4-40000 Sales Retail (SEMUA invoice, CSV maupun Excel)
--   Cr PB1          2-20402 Hutang PB1  (Tax di POS = 10 persen pajak restoran/PB1,
--                   bukan PPN 11 persen/12 persen; field-nya tetap bernama "ppn")
-- Catatan: (a) NBM TIDAK memakai cabang (kolom Outlet CSV tidak dijadikan cabang,
-- Excel memang tidak punya), jadi tidak ada pendapatan_account_by_cabang dan semua
-- pendapatan ke 4-40000. Pendapatan FAS TO-GO (4-40005) dan wholesale (4-40003)
-- tidak dipisah otomatis -- ubah per invoice di Journal Preview kalau perlu.
-- Kalau suatu saat ingin dipisah, tambahkan "cabang": "Outlet" di resep CSV dan
-- pendapatan_account_by_cabang (kunci HURUF BESAR semua; backend mencocokkan
-- cabang.strip().upper()). (b) Service charge (Gratuity) ikut masuk Cr
-- Pendapatan karena ikut dpp; COA punya 2-20401 Hutang Service Charge bila nanti
-- perlu direklasifikasi. (c) Sisi debit per metode bayar (EDC BRI 1-10103,
-- GrabFood 1-10105, GoFood 1-10104, Kas) tidak bisa dipetakan otomatis -- default
-- 1-10100, ubah per invoice di Journal Preview. (d) Settings > Account Mapping
-- klien, kalau diisi, tetap didahulukan untuk piutang dan PPN/PB1. Tanpa akun di
-- COA klien, posting ditolak. (e) Diskon (Excel) sudah netto di dpp, jadi tidak
-- ada posting terpisah ke 4-40100 Sales Discount.
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian, urut
-- seperti array "variants" dan dipisah ':' (pola seed SAU/NBM lama):
--   SHA-256("<hash_csv>:<hash_excel>")
--   hash_csv   = c74ca792bb1ec18556aaf3ce8a1f5e200043c756090c7761e2f6973be7922bc0
--   hash_excel = 201e5e46c2908cdc9ef5782c4cf4e1ee6aa7b7337adf9ffc4212202c8668e118
--   -> 5cf5abf76b2309c94a3127c2e8456eb3504425bc66b6da889716596966cb41db
-- (versi CSV-saja dulu: SHA-256(hash_csv) = 0fc8e6add3bd3665f3b38b0f75ea5c7763606abbb63a1f0f8cb634a66848238f.)
-- Hash baris ini SAMA dengan hash baris seed lama seed_template_nbm_multi_format.sql
-- (CSV+Excel), artinya header CSV dan Excel-nya identik -- lihat "SEED LAMA".
-- Nilai level baris (header_row_index, data_start_row_index, header_columns)
-- hanya pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan
-- adalah nilai di dalam tiap varian.
--
-- KLIEN: dicari lewat nama_client ('NBM' atau 'PT NAWASANGA BERTATAP MUKA',
-- tidak peka huruf besar/kecil) dan GAGAL dengan pesan jelas kalau belum ada
-- di management_clients. client_id & client_code diambil otomatis.
--
-- SEED LAMA -- seed_template_nbm_multi_format.sql (baris 'Multi' CSV+Excel,
-- hash baris 5cf5abf76b2309c94a3127c2e8456eb3504425bc66b6da889716596966cb41db) sudah tercatat di history-migration.md. Hash baris itu
-- SAMA dengan hash baris seed ini, begitu juga versi CSV-saja seed ini dulu (hash
-- baris 0fc8e6add3bd3665f3b38b0f75ea5c7763606abbb63a1f0f8cb634a66848238f). Kalau salah satunya sudah ada di database, seed ini
-- TIDAK gagal: barisnya di-UPDATE di tempat (lihat "Idempotensi"). Tidak perlu
-- DELETE atau UPDATE manual lebih dulu.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya (nama file saja akan
-- dicari run_seed.py hanya di folder migrations/ dan tidak ketemu):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_nbm_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok
-- DO, baris Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash
-- versi lamanya (v_hash_lama), termasuk yang sudah soft-delete (UNIQUE tidak
-- melihat deleted_at):
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan
--               isi seed ini, is_active = true, deleted_at dikosongkan. id,
--               usage_count, created_at dan source_files.template_id TETAP, jadi
--               riwayat file yang sudah diupload tidak putus.
--   * tidak  -> INSERT baris baru.
-- Konsekuensi: menjalankan ulang seed ini MENIMPA resep baris itu dengan isi file
-- ini (termasuk perubahan manual lewat UPDATE). Seed ini tidak lagi berakhir di
-- UNIQUE uq_sales_import_templates_signature.
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini (bukan baris yang
-- di-upgrade) yang memuat varian CSV atau Excel dengan header yang sama, seed
-- berhenti dengan pesan jelas supaya tidak ada 2 template aktif (usage_count
-- terbagi). Lihat daftar barisnya lewat query verifikasi di akhir file, lalu
-- singkirkan yang tidak dipakai (soft-delete, aman terhadap FK source_files):
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi nanti (mis. format baru dari software sumber): tambahkan
-- 1 objek lagi di array "variants" (file_type, sheet_name, header_row_index,
-- data_start_row_index, column_signature_hash dari baris header file contoh,
-- header_columns, mapping_rules), hitung ulang hash level baris =
-- SHA-256("<hash_csv>:<hash_excel>:<hash_baru>") (urutan = urutan array), isi
-- v_hash_baru dengan hash itu dan PINDAHKAN hash baris yang lama ke v_hash_lama
-- di blok DO, lalu jalankan ulang file ini: baris yang sudah ada otomatis
-- di-upgrade di tempat.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi
-- ORM (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<hash_csv>:<hash_excel>"), dan hash baris
    -- versi-versi LAMA seed yang sama (CSV-saja). Baris lama ditemukan lewat daftar
    -- ini lalu di-UPDATE di tempat -- lihat "Idempotensi" di kepala file.
    v_hash_baru   CONSTANT TEXT := '5cf5abf76b2309c94a3127c2e8456eb3504425bc66b6da889716596966cb41db';
    v_hash_lama   TEXT[] := ARRAY['0fc8e6add3bd3665f3b38b0f75ea5c7763606abbb63a1f0f8cb634a66848238f'];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien NBM (PT Nawasanga Bertatap Muka) untuk laporan penjualan. Varian CSV: export POS 'Report Item Details' (2 outlet FAS A FAS), 1 struk = 1 invoice. Varian Excel: laporan 'Penjualan per Pelanggan' (wholesale, berseksi per pelanggan), 1 nomor invoice = 1 invoice. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok (lihat _template_dari_varian di sales_import_v1.py).",
  "variants": [
    {
      "file_type": "CSV",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "c74ca792bb1ec18556aaf3ce8a1f5e200043c756090c7761e2f6973be7922bc0",
      "header_columns": [
        "Outlet",
        "Receipt Number",
        "Date",
        "Time",
        "Category",
        "Brand",
        "Items",
        "Variant",
        "SKU",
        "Quantity",
        "Modifier Applied",
        "Discount Applied",
        "Gross Sales",
        "Discounts",
        "Refunds",
        "Net Sales",
        "Gratuity",
        "Tax",
        "Sales Type",
        "Collected By",
        "Served By",
        "Customer",
        "Payment Method",
        "Event Type",
        "Reason of Refund"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_by_key",
        "description": "Export POS 'Report Item Details' (semua outlet NBM) -- 1 baris CSV = 1 item/line dalam struk; banyak baris berbagi 1 Receipt Number. 1 baris kanonis (source_rows) = 1 STRUK (Receipt Number), diagregasi dengan menjumlah semua barisnya, termasuk baris Event Type = Refund yang bernilai NEGATIF (refund otomatis mengurangi total struk asalnya). Kolom dicari lewat NAMA di baris header, bukan posisi; tetapi urutan+isi header harus sama persis dengan file contoh agar signature cocok.",
        "encoding": "utf-8-sig",
        "delimiter": ",",
        "quoted_fields": true,
        "date_format": "DD-MM-YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "invoice_key": "Receipt Number",
        "tanggal": "Date",
        "customer": "Customer",
        "customer_fallback": "Penjualan POS - {Outlet}",
        "dpp_columns": [
          "Net Sales",
          "Gratuity"
        ],
        "ppn_columns": [
          "Tax"
        ],
        "field_mapping": {
          "tanggal": "Date (DD-MM-YYYY)",
          "invoice": "Receipt Number",
          "customer": "Customer (kosong -> 'Penjualan POS - <Outlet>')",
          "cabang": "kosong (NBM tidak memakai cabang; kolom Outlet hanya dipakai untuk nama customer pengganti)",
          "dpp": "SUM(Net Sales + Gratuity) per struk",
          "ppn": "SUM(Tax) per struk",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_receipt",
        "catatan_analisis": "Dianalisis dari 1 file contoh (01-08-2026 s/d 31-08-2026, All Outlet): 5.737 baris data = 2.315 struk unik, 2 outlet (FAS A FAS CAFE AND BAKERY 1.561 struk, FAS A FAS TO-GO 754 struk). Pada SEMUA baris Tax = 10 persen x (Net Sales + Gratuity) (selisih maks 0,005 = pembulatan); Gratuity = 5 persen Net Sales di Dine In & Take Away outlet Cafe, 0 di GrabFood/GoFood/To-Go. Baris Refund (5 baris, 4 struk) memakai Receipt Number & tanggal struk asalnya dengan Net Sales/Tax negatif. Tidak ada baris kosong/ringkasan, tidak ada Receipt Number ganda antar outlet."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": "Sales by Customer",
      "header_row_index": 6,
      "data_start_row_index": 7,
      "column_signature_hash": "201e5e46c2908cdc9ef5782c4cf4e1ee6aa7b7337adf9ffc4212202c8668e118",
      "header_columns": [
        "Pelanggan / Tanggal",
        "Transaksi",
        "No",
        "Produk",
        "Keterangan",
        "Kuantitas",
        "Satuan",
        "Harga Satuan",
        "Jumlah Tagihan",
        "Total"
      ],
      "mapping_rules": {
        "format_type": "sectioned_by_customer_header",
        "description": "Laporan 'Penjualan per Pelanggan' NBM (wholesale, nomor invoice INV/WS/...) -- tiap pelanggan = 1 SEKSI: 1 baris judul (nama pelanggan di kolom A, kolom lain kosong), N baris line (1 invoice bisa punya banyak line produk, termasuk line 'Diskon' bernilai negatif), 1 baris 'Total Penjualan'. Line dijumlah per nomor invoice -> 1 baris kanonis (source_rows) = 1 INVOICE. Yang dijumlah kolom 'Jumlah Tagihan' (I); kolom 'Total' (J) adalah total berjalan per pelanggan dan TIDAK dipakai. Posisi kolom (1-based) dari resep, bukan nama, karena kolom A dipakai ganda untuk nama pelanggan & tanggal.",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "columns": {
          "tanggal": 1,
          "transaksi": 2,
          "no_invoice": 3,
          "jumlah": 9
        },
        "section_total_marker": {
          "column": 9,
          "contains": "Total Penjualan"
        },
        "end_of_data_marker": {
          "column": 9,
          "value": "Grand Total"
        },
        "field_mapping": {
          "tanggal": "kolom A baris line (DD/MM/YYYY)",
          "invoice": "kolom C (No)",
          "customer": "judul seksi (kolom A baris judul)",
          "cabang": "kosong (NBM tidak memakai cabang)",
          "dpp": "SUM(kolom I Jumlah Tagihan) per nomor invoice, sudah netto diskon",
          "ppn": "0 (tidak ada kolom pajak)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_invoice",
        "catatan_analisis": "Dianalisis dari 1 file contoh (01/08/2026-31/08/2026): sheet 'Sales by Customer' A1:J2183, header baris 6, data baris 7-2182, 'Grand Total' baris 2183 (204.221.225). 1.990 line = 851 invoice unik (semua INV/WS), 93 pelanggan; tiap nomor invoice hanya di 1 pelanggan dan 1 tanggal. Kolom J = total berjalan per pelanggan (cocok di semua line). Line 'Diskon': 140 line di 46 invoice, total -2.222.725, kuantitas teks kosong. Kolom Keterangan kosong semua; kolom Transaksi hanya 'Sales Invoice'. Hasil uji dengan kode parser asli: 851 invoice valid, tanpa duplikat, total = Grand Total = jumlah 'Total Penjualan' semua seksi."
      }
    }
  ],
  "piutang_account": {
    "account_code": "1-10100",
    "account_name": "Piutang Usaha"
  },
  "pendapatan_account": {
    "account_code": "4-40000",
    "account_name": "Sales Retail"
  },
  "ppn_account": {
    "account_code": "2-20402",
    "account_name": "Hutang PB1"
  },
  "catatan_akun": "Akun default dipilih dari COA NBM (seed_coa_nbm.sql); ASUMSI, bisa diubah per invoice di Journal Preview atau lewat Settings > Account Mapping (yang diutamakan untuk piutang/PPN). NBM tidak memakai cabang, jadi SEMUA invoice (CSV dan Excel) memakai pendapatan 4-40000 Sales Retail; COA juga punya 4-40003 Pendapatan Wholesale dan 4-40005 Pendapatan Fas To Go kalau ingin diubah per invoice. Kolom Tax di POS = PB1 10 persen, bukan PPN, maka dipetakan ke Hutang PB1."
}$json$::jsonb;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client = NBM / PT Nawasanga Bertatap Muka). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini yang sudah memuat varian
    -- CSV atau Excel dengan header yang sama (baris yang di-upgrade dikecualikan).
    SELECT count(*) INTO v_bentrok
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.deleted_at IS NULL
      AND t.is_active
      AND t.file_type = 'Multi'
      AND t.id IS DISTINCT FROM v_id
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.mapping_rules->'variants', '[]'::jsonb)) AS v
          WHERE (v->>'file_type' = 'CSV'   AND v->>'column_signature_hash' = 'c74ca792bb1ec18556aaf3ce8a1f5e200043c756090c7761e2f6973be7922bc0')
             OR (v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = '201e5e46c2908cdc9ef5782c4cf4e1ee6aa7b7337adf9ffc4212202c8668e118')
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien NBM sudah punya template Multi AKTIF lain dengan varian CSV atau Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
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
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi NBM dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
           SET header_row_index = 1,
               data_start_row_index = 2,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi NBM sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA');