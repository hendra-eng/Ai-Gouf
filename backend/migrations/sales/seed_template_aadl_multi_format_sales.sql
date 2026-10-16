-- seed_template_aadl_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien AADL (PT Akshaya Ananda Dylan Lestari). SATU baris setting ("Multi")
-- untuk halaman Transactions > Sales > Source Data, yang melayani laporan
-- pendapatan dari KEENAM cabang/usaha AADL.
--
-- STATUS: hanya varian Excel (6 varian, 1 per cabang). Varian CSV/PDF nanti
-- cukup ditambahkan ke array "variants" (lihat "Menambah varian lagi").
--
-- PENTING -- BENTUK FILE AADL BEDA DARI NBM/SAU:
--   Bukan laporan invoice, melainkan REKAP PENDAPATAN yang dirawat manual:
--   1 workbook = 1 cabang = 1 tahun, 1 sheet per bulan ("Januari 2026",
--   "Jan 2026", "JANUARI'26", "Des'25"), ditambah sheet RESUME dan Sheet1 yang
--   bukan data. TIDAK ada nomor invoice, kolom pajak, maupun nama customer.
--   Karena itu dipakai 2 format_type BARU di sales_import_v1.py:
--     monthly_daily_matrix  matriks hari (kolom 1..31) x komponen pendapatan
--     monthly_rent_roll     daftar kamar + Uang Kamar per bulan
--   dan pembaca Excel yang membaca SEMUA sheet bulanan (bukan 1 sheet).
--
-- SUMBER (6 file contoh, update 31 Agustus 2026):
--   Laporan Pendapatan Warung Soemantri 2026   -> varian "WARUNG SOEMANTRI"
--   Laporan Pendapatan Kafe Kapu 2026          -> varian "KAFE KAPU SOEMANTRI"
--   Laporan Pendapatan Omah & Kopi Soemantri   -> varian "OMAH SOEMANTRI HOTEL & KOPI"
--   Laporan Pendapatan Villa Putu Soemantri    -> varian "PUTU SOEMANTRI FAMILY VILLAS"
--   Laporan Pendapatan Kapu Soemantri 2026     -> varian "KOST KAPU SOEMANTRI"
--   Laporan Pendapatan Kost Warung Soemantri   -> varian "KOST WARUNG SOEMANTRI"
--   (nama file hanya ditulis user, TIDAK dipakai untuk mengenali cabang)
--
-- CARA APLIKASI MEMBACA UPLOAD EXCEL AADL:
--   1. User upload file di Sales > Source Data dengan klien AADL aktif.
--   2. Backend mengumpulkan template Excel klien (termasuk 6 varian ini) dan
--      untuk varian bertipe rekap bulanan memeriksa BARIS JUDUL (header_row_index
--      = 2, sel A2 = nama usaha) pada sheet-sheet bulanan. Sel kosong di ujung
--      baris dibuang sebelum di-hash karena lebar sheet beda-beda tiap bulan.
--      Sheet dianggap bulanan kalau namanya "<nama bulan> [tahun]"; RESUME dan
--      Sheet1 otomatis dilewati. Varian cocok kalau hash judul SALAH SATU sheet
--      bulanan = column_signature_hash varian (atau salah satu signature_alternatif).
--   3. CABANG SELALU TETAP per varian (mapping_rules.cabang_tetap), bukan dari nama
--      file seperti SAU, karena nama file AADL tidak konsisten ("Up Date", "Up.date",
--      "Agustusi", awalan "AADL_" hilang saat diunduh). Cabang yang dipakai:
--        WARUNG SOEMANTRI | KAFE KAPU | OMAH & KOPI SOEMANTRI |
--        VILLA PUTU SOEMANTRI | KAPU SOEMANTRI | KOST WARUNG SOEMANTRI
--   4. TAHUN diambil dari sheet bulanan PERTAMA lalu naik 1 setiap bulan "mundur"
--      (Des -> Jan) -- mapping_rules.tahun = "urutan_sheet". Alasan: nama sheet
--      sering salah ketik (Kapu Soemantri: "Juli 2024" dan "Agustus 2024" padahal
--      2026; judul sheet Kost Warung "JUNI 2025" di file 2026). Sel tanggal di baris
--      header juga TIDAK dipercaya (sheet Agustus Warung berisi 2026-07-01).
--   5. periode_mulai = "2026-01": sheet Desember 2025 (ada di Kafe Kapu, Omah, Villa)
--      DILEWATI karena rekap ini laporan tahun 2026 dan RESUME-nya mulai Januari.
--      Hapus/ubah periode_mulai kalau Desember 2025 memang perlu diimpor.
--
-- DETAIL TIAP VARIAN
--   A. monthly_daily_matrix -- 1 baris source_rows = 1 HARI per cabang.
--      Kolom hari dicari otomatis (baris yang memuat angka 1..31, bukan posisi
--      tetap: Warung/Kafe di kolom B, Villa di C, Omah di D). Nilai harian diambil
--      dari SATU baris ringkasan (baris_pendapatan), dpp = nilai itu, ppn = 0,
--      total = dpp. Hari bernilai kosong/0 dilewati (lewati_nol), jadi tidak ada
--      invoice 0. Nomor invoice dibentuk: <prefix>-YYYY-MM-DD, mis. AADL-WRG-2026-08-01.
--        Warung   AADL-WRG  baris "TOTAL" (SHIFT 1+2 + Lain-lain + GoFood/Shopee)
--        Kafe     AADL-KFK  baris awalan "Pendapatan Bersih" (= Pendapatan Kafe
--                           - Potongan Admin) -> dicatat NETTO, sama dengan RESUME
--        Omah     AADL-OMH  baris "TOTAL" (kamar + breakfast + kopi + lain-lain
--                           - BIAYA BOOKING.COM), sudah netto biaya booking
--        Villa    AADL-VPS  baris "TOTAL" (kamar + F&B + lain-lain - ADM BOOKING.COM);
--                           header hari di baris 5 (bukan 6) -- ditangani otomatis
--   B. monthly_rent_roll -- 1 baris source_rows = 1 BULAN per cabang (kost).
--      dpp = jumlah kolom "Uang Kamar" semua kamar bernomor (sampai baris TOTAL),
--      Deposit TIDAK ikut (jaminan, bukan pendapatan; sama dengan RESUME). Tanggal
--      = akhir bulan (tanggal_bulanan = "akhir_bulan"). Nomor invoice
--      <prefix>-YYYY-MM:
--        Kapu Soemantri       AADL-KPS   (judul sheet "KOST KAPU SOEMANTRI")
--        Kost Warung          AADL-KWS   (judul sheet Januari "KOST WARUNG SOEMANTRI",
--                                         sheet lain "KOST BIMO KURDO" = sisa template,
--                                         diterima lewat signature_alternatif)
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke 6 file contoh;
-- tiap file dicocokkan ke varian yang benar di antara 6 varian):
--   jumlah per bulan SAMA PERSIS dengan sheet RESUME di tiap file, tanpa baris invalid
--   dan tanpa nomor invoice ganda:
--     Warung   235 invoice  Jan 11.279.500 ... Agu 9.886.500     (Jan-Agu 2026)
--     Kafe     243 invoice  Jan 59.852.754 ... Agu 45.839.604    (Jan-Agu 2026)
--     Omah     247 invoice  Jan 118.380.256,5 ... Agu 99.688.025 (+ Sep 1.564.321,5; Nov 575.000)
--     Villa    197 invoice  Jan 45.345.366 ... Agu 56.832.244,5  (+ Sep 6.722.176,5)
--     Kapu S.    8 invoice  Jan 24.900.000 ... Agu 25.700.000
--     Kost W.   10 invoice  Jan 18.485.000 ... Jun 18.600.000 (+ Jul/Agu 18.600.000; Sep 2.900.000; Okt 1.100.000)
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * Ini REKAP, bukan transaksi: invoice yang terbentuk = 1 per hari (atau per bulan
--     untuk kost) dengan customer generik ("Penjualan <Cabang>" / "Sewa Kost <Cabang>").
--     Rincian per tamu/booking tidak ada di file sumber.
--   * Sheet bulan DI MASA DEPAN sudah berisi angka (Omah Sep-Nov, Villa Sep, Kost
--     Warung Sep-Okt: booking/sewa yang sudah dijadwalkan). Angka itu ikut diekstrak.
--     Jangan di-promote sebelum realisasinya jelas, atau isi periode_akhir (format
--     "YYYY-MM") di tiap resep untuk membatasi.
--   * Upload ULANG workbook yang sama (setelah ada pembaruan) menghasilkan nomor invoice
--     yang SAMA: Buat Invoice melewati yang sudah ada (dihitung "bentrok"), jadi hari
--     yang angkanya berubah di file TIDAK memperbarui invoice lama. Koreksi lewat
--     Journal Preview / invoice, atau hapus invoice Draft-nya dulu.
--   * Struktur HARUS tetap: baris judul sheet (baris 2) berisi nama usaha yang sama,
--     baris ringkasan berlabel sama ("TOTAL" / "Pendapatan Bersih"), dan kolom "Uang
--     Kamar" di kost. Perubahan label -> sheet itu dilewati diam-diam (tidak ada
--     invoice dari bulan itu). Judul baris 2 berubah -> file masuk "Butuh Review"
--     (tambahkan judul baru ke signature_alternatif varian yang bersangkutan).
--   * Hari bertotal NEGATIF (mis. biaya booking tanpa pendapatan) ditandai invalid
--     "Total harian negatif" dan tidak ikut Buat Invoice sampai ditinjau. Di file
--     contoh tidak ada.
--   * Kafe Kapu dicatat NETTO setelah Potongan Admin (mengikuti RESUME). Kalau ingin
--     kotor, ubah baris_pendapatan.label varian Kafe menjadi "Pendapatan Kafe"
--     (cocok "persis") -- potongan admin lalu dicatat sebagai beban terpisah.
--   * Omah dan Villa: biaya booking.com ikut mengurangi dpp (sudah netto di TOTAL).
--
-- AKUN JURNAL: BELUM DIISI. COA AADL belum ada di repo (tidak ada seed_coa_aadl.sql),
-- dan akun tidak boleh ditebak karena posting ditolak kalau kode tidak ada di COA klien.
-- Selama kosong: db_client.akun_default_sales() memakai Settings > Account Mapping
-- klien (account_receivable / sales_revenue); kalau itu juga kosong, mapping akun
-- invoice dilewati diam-diam saat Buat Invoice. Setelah COA AADL ada, tambahkan di
-- v_rules (sejajar "variants") lalu jalankan ulang seed ini (idempoten):
--   "piutang_account":   {"account_code": "<kode>", "account_name": "<nama>"},
--   "pendapatan_account": {"account_code": "<kode>", "account_name": "<nama>"},
--   "pendapatan_account_by_cabang": {          -- kunci HURUF BESAR, persis nilai cabang
--     "WARUNG SOEMANTRI":      {"account_code": "...", "account_name": "..."},
--     "KAFE KAPU":             {...}, "OMAH & KOPI SOEMANTRI": {...},
--     "VILLA PUTU SOEMANTRI":  {...}, "KAPU SOEMANTRI": {...},
--     "KOST WARUNG SOEMANTRI": {...}
--   }
-- (ppn_account tidak perlu: file AADL tidak punya pajak, ppn selalu 0.)
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian, urut
-- seperti array "variants" dan dipisah ':' (pola seed NBM/SAU):
--   SHA-256("<h_warung>:<h_kafe>:<h_omah>:<h_villa>:<h_kapu>:<h_kostwarung>")
--   h_warung     = 9151f324df7ec9f21f46e46407fb727b844fbb0015f388f64442e6a04bffa2a7   (SHA-256 "warung soemantri")
--   h_kafe       = 3d440f444375f089d79bf54328c3d71cb7f050e9ef1560751bb3d60b77b72c5d   (SHA-256 "kafe kapu soemantri")
--   h_omah       = ed4a1841a837cce198d0a59d2d42e6c279a056fd9ce6d21791b3620a73cbdd48   (SHA-256 "omah soemantri hotel & kopi")
--   h_villa      = 34fd012fe530a0941a777a10ee5b934f73e9413ce562bd0cc535abede5538aff   (SHA-256 "putu soemantri family villas")
--   h_kapu       = d0efc7211024462e1f05190eb1c0195950d8d3955b22cd0eeaf8ce15bbaa9b6d   (SHA-256 "kost kapu soemantri")
--   h_kostwarung = 1cdead52382a13e30d29298a8db2a573559ffc8bbf253f7fbb6ab73436da2124   (SHA-256 "kost warung soemantri")
--   -> 252e33a2be444d161a0eba521163dc95dd5dfbcc86b6fcf7b0707d716c97e534
-- (hash tiap varian = _hash_baris([judul]): huruf kecil, spasi dirapikan.)
-- Nilai level baris (header_row_index, data_start_row_index, header_columns)
-- hanya pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan
-- adalah nilai di dalam tiap varian.
--
-- KLIEN: dicari lewat nama_client ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI' atau
-- yang bertitik 'PT. ...', tidak peka huruf besar/kecil) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_aadl_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- PRASYARAT KODE: seed ini membutuhkan sales_import_v1.py versi yang memuat
-- format_type monthly_daily_matrix / monthly_rent_roll dan
-- _cocokkan_template_excel_bulanan. Tanpa itu, upload file AADL jatuh ke "Butuh Review".
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok
-- DO, baris Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash
-- versi lamanya (v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan
--               isi seed ini, is_active = true, deleted_at dikosongkan. id,
--               usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Menjalankan ulang MENIMPA resep baris itu dengan isi file ini (termasuk perubahan
-- manual lewat UPDATE).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini yang memuat varian
-- Excel dengan signature yang sama, seed berhenti dengan pesan jelas supaya tidak ada
-- 2 template aktif. Singkirkan yang tidak dipakai (soft-delete, aman terhadap FK):
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi nanti (mis. CSV/PDF AADL): tambahkan 1 objek di array "variants"
-- (file_type, sheet_name, header_row_index, data_start_row_index, column_signature_hash,
-- header_columns, mapping_rules), hitung ulang hash level baris =
-- SHA-256("<h1>:...:<h6>:<hash_baru>") (urutan = urutan array), isi v_hash_baru dengan
-- hash itu dan PINDAHKAN hash baris yang lama ke v_hash_lama di blok DO, lalu jalankan
-- ulang file ini. Cabang baru/usaha baru AADL = 1 varian Excel baru dengan cara yang sama.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM
-- (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<h_warung>:...:<h_kostwarung>"); hash baris
    -- versi-versi LAMA seed yang sama ditaruh di v_hash_lama (kosong = belum ada).
    v_hash_baru   CONSTANT TEXT := '252e33a2be444d161a0eba521163dc95dd5dfbcc86b6fcf7b0707d716c97e534';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien AADL (PT Akshaya Ananda Dylan Lestari) untuk laporan pendapatan. 6 varian Excel (1 workbook per cabang, 1 sheet per bulan): Warung Soemantri, Kafe Kapu, Omah & Kopi, Villa Putu (rekap harian, 1 invoice = 1 hari) dan Kost Kapu Soemantri, Kost Warung Soemantri (daftar sewa kamar, 1 invoice = 1 bulan). Tiap varian membawa signature judul sheet & resep sendiri; cabang tetap per varian. Backend memilih varian lewat hash baris judul sheet bulanan (lihat _cocokkan_template_excel_bulanan di sales_import_v1.py).",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "9151f324df7ec9f21f46e46407fb727b844fbb0015f388f64442e6a04bffa2a7",
      "header_columns": [
        "WARUNG SOEMANTRI"
      ],
      "mapping_rules": {
        "format_type": "monthly_daily_matrix",
        "description": "Warung Soemantri (AADL) -- rekap pendapatan HARIAN, 1 sheet per bulan. 1 invoice = 1 hari.",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "cabang_tetap": "WARUNG SOEMANTRI",
        "prefix_invoice": "AADL-WRG",
        "customer": "Penjualan Warung Soemantri",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "baris_pendapatan": {
          "label": "TOTAL",
          "cocok": "persis",
          "kolom": 1
        },
        "field_mapping": {
          "tanggal": "nama sheet (bulan+tahun) + angka header hari 1..31",
          "invoice": "<prefix_invoice>-YYYY-MM-DD (dibentuk, file tidak punya nomor invoice)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "baris TOTAL (SHIFT 1 + SHIFT 2 + Lain-lain + GoFood/Shopee) per hari",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "8 sheet bulanan (Jan-Agustus 2026) + RESUME + Sheet1. Header baris 5-6, hari 1..31 di kolom B..AF, TOTAL bulanan di kolom AG. Baris TOTAL = baris 12 di semua sheet; jumlah tiap bulan sama persis dengan sheet RESUME (Jan 11.279.500 ... Agustus 9.886.500). Sel tanggal di baris 5 tidak dipercaya (sheet Agustus berisi 2026-07-01)."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "3d440f444375f089d79bf54328c3d71cb7f050e9ef1560751bb3d60b77b72c5d",
      "header_columns": [
        "KAFE KAPU SOEMANTRI"
      ],
      "mapping_rules": {
        "format_type": "monthly_daily_matrix",
        "description": "Kafe Kapu Soemantri (AADL) -- rekap pendapatan HARIAN, 1 sheet per bulan. 1 invoice = 1 hari, nilai = Pendapatan Bersih (setelah Potongan Admin).",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "cabang_tetap": "KAFE KAPU",
        "prefix_invoice": "AADL-KFK",
        "customer": "Penjualan Kafe Kapu",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "baris_pendapatan": {
          "label": "Pendapatan Bersih",
          "cocok": "awalan",
          "kolom": 1
        },
        "field_mapping": {
          "tanggal": "nama sheet (bulan+tahun) + angka header hari 1..31",
          "invoice": "<prefix_invoice>-YYYY-MM-DD (dibentuk, file tidak punya nomor invoice)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "baris 'Pendapatan Bersih' (= Pendapatan Kafe - Potongan Admin) per hari",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "9 sheet bulanan (Des'25 - Agustus 2026) + RESUME + Sheet1. Baris 7-8 SHIFT 1/2, 9 Pendapatan Kafe, 10 Potongan Admin, 11 Pendapatan Bersih. Jumlah Pendapatan Bersih tiap bulan sama persis dengan RESUME (Jan 59.852.754 ... Agustus 45.839.604), jadi nilai yang dicatat NETTO setelah potongan admin."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "ed4a1841a837cce198d0a59d2d42e6c279a056fd9ce6d21791b3620a73cbdd48",
      "header_columns": [
        "OMAH SOEMANTRI HOTEL & KOPI"
      ],
      "mapping_rules": {
        "format_type": "monthly_daily_matrix",
        "description": "Omah Soemantri Hotel & Kopi (AADL) -- rekap pendapatan HARIAN, 1 sheet per bulan. 1 invoice = 1 hari.",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "cabang_tetap": "OMAH & KOPI SOEMANTRI",
        "prefix_invoice": "AADL-OMH",
        "customer": "Penjualan Omah & Kopi Soemantri",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "baris_pendapatan": {
          "label": "TOTAL",
          "cocok": "persis",
          "kolom": 1
        },
        "field_mapping": {
          "tanggal": "nama sheet (bulan+tahun) + angka header hari 1..31",
          "invoice": "<prefix_invoice>-YYYY-MM-DD (dibentuk, file tidak punya nomor invoice)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "baris TOTAL (KAMAR + CAFE BREAKFAST + KOPI SOEMANTRI + LAIN-LAIN - BIAYA BOOKING.COM - Traveloka) per hari",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "12 sheet bulanan (Desember'25 - November 2026) + RESUME + Sheet1. Hari 1..31 di kolom D..AH (header baris 6), baris TOTAL = baris 40. Jumlah TOTAL tiap bulan sama persis dengan RESUME (Jan 118.380.256,5 ... Agustus 99.688.025). TOTAL sudah dipotong BIAYA BOOKING.COM (negatif). Sheet September-November 2026 sudah berisi sebagian angka (booking ke depan)."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "34fd012fe530a0941a777a10ee5b934f73e9413ce562bd0cc535abede5538aff",
      "header_columns": [
        "PUTU SOEMANTRI FAMILY VILLAS"
      ],
      "mapping_rules": {
        "format_type": "monthly_daily_matrix",
        "description": "Putu Soemantri Family Villas (AADL) -- rekap pendapatan HARIAN, 1 sheet per bulan. 1 invoice = 1 hari.",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "cabang_tetap": "VILLA PUTU SOEMANTRI",
        "prefix_invoice": "AADL-VPS",
        "customer": "Penjualan Villa Putu Soemantri",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "baris_pendapatan": {
          "label": "TOTAL",
          "cocok": "persis",
          "kolom": 1
        },
        "field_mapping": {
          "tanggal": "nama sheet (bulan+tahun) + angka header hari 1..31",
          "invoice": "<prefix_invoice>-YYYY-MM-DD (dibentuk, file tidak punya nomor invoice)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "baris TOTAL (KAMAR + F & B + LAIN-LAIN - BY ADM BOOKING.COM) per hari",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "11 sheet bulanan (DESEMBER'25 - September 2026) + RESUME. Header hari di baris 5 (bukan 6), hari 1..31 di kolom C..AG, baris TOTAL = baris 21. Jumlah TOTAL tiap bulan sama persis dengan RESUME (Jan 45.345.366 ... Agustus 56.832.244,5). Di bawah tabel ada tabel transfer bank (kolom AC-AI) yang tidak dibaca."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "d0efc7211024462e1f05190eb1c0195950d8d3955b22cd0eeaf8ce15bbaa9b6d",
      "header_columns": [
        "KOST KAPU SOEMANTRI"
      ],
      "mapping_rules": {
        "format_type": "monthly_rent_roll",
        "description": "Kost Kapu Soemantri (AADL) -- daftar sewa kamar, 1 sheet per bulan. 1 invoice = 1 bulan (total Uang Kamar).",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "cabang_tetap": "KAPU SOEMANTRI",
        "prefix_invoice": "AADL-KPS",
        "customer": "Sewa Kost Kapu Soemantri",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "kolom_jumlah": "Uang Kamar",
        "tanggal_bulanan": "akhir_bulan",
        "field_mapping": {
          "tanggal": "akhir bulan dari nama sheet",
          "invoice": "<prefix_invoice>-YYYY-MM (dibentuk, 1 invoice per bulan)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "SUM(kolom Uang Kamar) semua kamar bernomor di sheet bulan itu; Deposit tidak ikut",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "8 sheet bulanan + RESUME. Nama sheet Juli/Agustus tertulis '2024' padahal 2026 (salah ketik), karena itu tahun memakai tahun='urutan_sheet'. 22 kamar per sheet; jumlah Uang Kamar sama persis dengan RESUME (Jan 24.900.000, Feb 25.700.000, ..., Agustus 25.700.000). Deposit (kolom Deposit) tidak termasuk pendapatan di RESUME, jadi tidak ikut."
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "1cdead52382a13e30d29298a8db2a573559ffc8bbf253f7fbb6ab73436da2124",
      "header_columns": [
        "KOST WARUNG SOEMANTRI"
      ],
      "mapping_rules": {
        "format_type": "monthly_rent_roll",
        "description": "Kost Warung Soemantri (AADL) -- daftar sewa kamar, 1 sheet per bulan. 1 invoice = 1 bulan (total Uang Kamar).",
        "tahun": "urutan_sheet",
        "periode_mulai": "2026-01",
        "signature_alternatif": [
          "075f0b0f2aeaae3f74aa7e0611e6b69e44b9a107fff776ea9e9071d9df93fc95"
        ],
        "cabang_tetap": "KOST WARUNG SOEMANTRI",
        "prefix_invoice": "AADL-KWS",
        "customer": "Sewa Kost Warung Soemantri",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "lewati_nol": true,
        "maks_baris_header": 12,
        "kolom_jumlah": "Uang Kamar",
        "tanggal_bulanan": "akhir_bulan",
        "field_mapping": {
          "tanggal": "akhir bulan dari nama sheet",
          "invoice": "<prefix_invoice>-YYYY-MM (dibentuk, 1 invoice per bulan)",
          "customer": "tetap (customer di resep)",
          "cabang": "tetap (cabang_tetap di resep)",
          "dpp": "SUM(kolom Uang Kamar) semua kamar bernomor di sheet bulan itu; Deposit tidak ikut",
          "ppn": "0 (file tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "catatan_analisis": "10 sheet bulanan (Jan - Oktober 2026) + RESUME + Sheet1. 18 kamar per sheet. Judul baris 2 berubah: sheet Januari 'KOST WARUNG SOEMANTRI', sheet Februari dst 'KOST BIMO KURDO' (sisa template) -> keduanya diterima lewat signature_alternatif. Jumlah Uang Kamar Jan-Juni sama persis dengan RESUME; Juli-Agustus (18.600.000) ada di sheet tapi RESUME-nya masih kosong. Sheet September-Oktober berisi sebagian angka (sewa ke depan)."
      }
    }
  ],
  "catatan_akun": "Akun jurnal (piutang_account, pendapatan_account, pendapatan_account_by_cabang, ppn_account) SENGAJA belum diisi: COA klien AADL belum ada di repo (belum ada seed_coa_aadl.sql). Selama kosong, Journal Preview memakai Settings > Account Mapping klien; kalau itu juga kosong, mapping akun invoice dilewati diam-diam saat Buat Invoice. Lihat bagian AKUN JURNAL di kepala file untuk cara mengisinya."
}$json$::jsonb;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI', 'PT. AKSHAYA ANANDA DYLAN LESTARI')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien AADL belum ada di management_clients (dicari nama_client = AADL / PT Akshaya Ananda Dylan Lestari). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
    -- Excel dengan signature yang sama (baris yang di-upgrade dikecualikan).
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
          WHERE v->>'file_type' = 'Excel'
            AND v->>'column_signature_hash' IN ('9151f324df7ec9f21f46e46407fb727b844fbb0015f388f64442e6a04bffa2a7', '3d440f444375f089d79bf54328c3d71cb7f050e9ef1560751bb3d60b77b72c5d', 'ed4a1841a837cce198d0a59d2d42e6c279a056fd9ce6d21791b3620a73cbdd48', '34fd012fe530a0941a777a10ee5b934f73e9413ce562bd0cc535abede5538aff', 'd0efc7211024462e1f05190eb1c0195950d8d3955b22cd0eeaf8ce15bbaa9b6d', '1cdead52382a13e30d29298a8db2a573559ffc8bbf253f7fbb6ab73436da2124')
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien AADL sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
            2,
            3,
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi AADL dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
           SET header_row_index = 2,
               data_start_row_index = 3,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi AADL sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->'mapping_rules'->>'cabang_tetap', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS cabang
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) IN ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI', 'PT. AKSHAYA ANANDA DYLAN LESTARI');