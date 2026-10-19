-- seed_template_birawa_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien BIRAWA. SATU baris setting ("Multi") untuk halaman Transactions > Sales >
-- Source Data, dengan SATU varian Excel: register tagihan manual
-- "DETAIL INVOICE 2026 + PPN".
--
-- STATUS: hanya varian Excel (register invoice berblok bulanan). Varian lain nanti
-- cukup ditambahkan ke array "variants" (lihat "Menambah varian lagi" di bawah).
--
-- PENTING -- BENTUK FILE BIRAWA BEDA DARI NBM/SAU/AADL:
--   Bukan laporan dari software, melainkan REGISTER TAGIHAN MANUAL (bisnis
--   outsourcing/manpower: tagihan gaji + BPJS + fee ke tiap pelanggan). Nomor invoice
--   ADA di file, tetapi TANGGAL invoice tidak ada -- hanya BULAN. Karena itu dipakai
--   format_type "monthly_block_invoice_register" (sales_import_v1.py, bagian 3d).
--
-- SUMBER (dataset/template_laporan/BIRAWA/DETAIL_INVOICE_2026___PPN.xlsx):
--   4 sheet; yang dibaca HANYA "Sheet1" (A1:AI324). Sheet2 / "sheet" / Sheet3 adalah
--   pivot & rekap (ada #REF!) dan tidak dibaca.
--   Sheet1: 12 BLOK bulan (Jan-Des 2026). Tiap blok = baris header (DIULANG), lalu 1 baris
--   per invoice, lalu baris kosong:
--     header di baris 2, 26, 53, 84, 110, 137, 168, 194, 222, 249, 274, 298
--     kolom BULAN (B) berisi tanggal 1 bulan itu, hanya di baris PERTAMA blok (sel
--     gabungan) -> dibawa ke baris di bawahnya oleh parser
--   Kolom A kosong; kolom data mulai B. Kolom yang dipakai (nama di header):
--     BULAN | NO INVOICE (F) | BEBAN (D = pelanggan) | NILAI INVOICE (I) | PPN(11%) (W)
--   Kolom E-I dan K-U DISEMBUNYIKAN di Excel (termasuk NILAI INVOICE), tetapi tetap
--   terbaca normal oleh parser.
--   Pelanggan (BEBAN): ASF, ASF-INT, CSDI, CSDI-OPCENT, CSDI-TECHNO, AAF, SBSF, FIF, AAD.
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. User upload file di Sales > Source Data dengan klien BIRAWA aktif.
--   2. Backend mencari sheet bernama "Sheet1" lalu meng-hash baris header ke-2, mulai
--      kolom ke-2 (kolom_awal = 2; sel kosong di ujung dibuang). Cocok dengan
--      column_signature_hash varian -> dipakai resep ini. Tidak cocok -> "Butuh Review".
--   3. Parser membaca semua baris dari baris 3: header yang diulang di tiap blok dan baris
--      tanpa nilai (placeholder) dilewati; tanggal = kolom BULAN blok.
--   4. Hasil: 1 baris source_rows = 1 baris register = 1 invoice.
--      invoice = NO INVOICE, tanggal = BULAN blok (selalu tanggal 1), customer = BEBAN,
--      cabang = BEBAN (cabang_dari_kolom_customer, dipakai memilih akun pendapatan),
--      total = NILAI INVOICE, ppn = PPN(11%), dpp = total - ppn.
--
-- KENAPA dasar = "tagihan" (BUKAN "fee") -- ASUMSI, mohon dikonfirmasi:
--   NILAI INVOICE adalah yang benar-benar ditagihkan dan dibayar pelanggan (gaji, BPJS,
--   dst yang ditagihkan ulang + fee). PPN 11 persen hanya atas FEE NET(DPP). Jadi:
--     Dr Piutang = NILAI INVOICE; Cr PPN = PPN(11%); Cr Pendapatan = NILAI INVOICE - PPN.
--   Dasar "fee" (dpp = FEE NET(DPP)) membuat total tagihan jauh di bawah nilai tagihan
--   sebenarnya (invoice kompensasi/gaji tanpa fee, mis. No. 006/I, jadi 0) dan
--   menjadikan baris subtotal 166 invoice invalid. Konsekuensi dasar "tagihan": Cr
--   Pendapatan = fee + gaji yang ditagihkan ulang, tidak dipisah (COA punya 481001
--   Pengembalian biaya Outsourching, tapi 1 invoice hanya 1 baris pendapatan).
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py -- _cocokkan_template_excel_register_blok
-- dan _ekstrak_dengan_template -- dijalankan ke file contoh):
--   202 baris hasil = 202 invoice VALID, 0 invalid; tanpa nomor invoice ganda, tanggal
--   01-01-2026 s/d 01-08-2026; di setiap invoice dpp + ppn = total persis
--   DPP 68.019.695.787,05 + PPN 354.014.796,41 = TOTAL 68.373.710.583,46
--   (jumlah per baris yang sudah dibulatkan; hitungan Decimal dari sel mentah:
--    total 68.373.710.583,47 dan PPN 354.014.796,38 -- selisih beberapa sen = pembulatan)
--   Jurnal default (db_client.akun_default_sales) diuji per BEBAN: ASF -> Piutang 140001 /
--   Pendapatan 411001; CSDI-TECHNO -> 140002 / 411002; AAD -> 140009 / 411009; BEBAN tidak
--   dikenal -> 149999 / 481001.
--   Per bulan (invoice / total):
--     Jan 22 / 6.888.839.626,09   Feb 25 / 7.051.481.183,95   Mar 29 / 10.132.288.170,08
--     Apr 24 / 7.504.237.427,97   Mei 25 / 8.271.466.269,71   Jun 28 /  8.690.545.106,01
--     Jul 23 / 9.279.907.899,84   Agu 26 / 10.554.944.899,81  Sep-Des 0 (placeholder)
--   Per BEBAN: ASF 48, CSDI-OPCENT 48, CSDI-TECHNO 32, AAF 26, SBSF 24, FIF 8, ASF-INT 8,
--   AAD 5, CSDI 3.
--
-- PRASYARAT KODE -- seed ini mengandalkan 2 perubahan kecil di backend (diterapkan bersamaan
-- dengan seed ini):
--   * sales_import_v1.py, _parse_monthly_block_invoice_register: pada dasar "tagihan" baris
--     dengan NILAI INVOICE kosong/0 dilewati (dulu baris subtotal 166 -- tanpa nomor invoice,
--     hanya kolom PPN terisi -- lolos dan muncul sebagai 1 baris invalid), dan ppn dibulatkan
--     lebih dulu sebelum dpp = total - ppn (dulu invoice No. 018 dan 019 /V/2026 punya dpp +
--     ppn berbeda 0,01 dari total). Baris 83 (subtotal Maret, hanya kolom GAJI) dari dulu
--     sudah dilewati.
--   * db_client.py, akun_default_sales(): membaca "piutang_account_by_cabang" (pola sama dengan
--     pendapatan_account_by_cabang). Tanpa perubahan ini peta piutang per cabang DIABAIKAN
--     (aman, tidak error) dan semua invoice default ke piutang_account 149999.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep/parser, bukan galat):
--   * Tanggal invoice = tanggal 1 bulan blok (file tidak punya tanggal invoice). Tanggal
--     transfer/bayar di file tidak dipakai.
--   * Header baris ke-2 HARUS sama persis (33 kolom dari kolom B, termasuk kolom rekonsiliasi
--     "SELISIH KOLOM G - R" ... "Klasifikasi", "Cek", dan "FEE INCLUDE PPN" yang hanya ada di
--     blok Januari). Kalau kolom tersebut diubah/dihapus -> signature tidak cocok -> file masuk
--     "Butuh Review" (aman, tidak diekstrak salah) dan varian baru perlu ditambahkan. Blok
--     bulan lain boleh berbeda jumlah kolomnya (blok Sep-Des hanya 26 kolom, header memakai
--     "FEE"), karena kolom dicari lewat nama di header baris ke-2.
--   * Nama sheet HARUS "Sheet1" (tidak peka huruf besar/kecil). Sheet "sheet" (huruf kecil,
--     salinan data) berbeda dari "Sheet1" dan tidak dibaca.
--   * Baris dengan nomor invoice tetapi tanpa nilai (blok Sep-Des) dilewati diam-diam;
--     invoice bernilai negatif tidak ada di file contoh.
--   * Nomor invoice dipakai apa adanya (spasi tidak dirapikan: "No.001/..." dan "No. 003/..."
--     tercatat berbeda). Tidak ada duplikat di file contoh.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level atas baris
-- ini; semua akun ada di sheet 'COA BIRAWA'). INI ASUMSI -- mohon dikonfirmasi:
--   Dr Piutang      per pelanggan lewat cabang (= BEBAN), kunci HURUF BESAR
--                   (piutang_account_by_cabang):
--                     ASF, ASF-INT -> 140001 | CSDI, CSDI-OPCENT, CSDI-TECHNO -> 140002
--                     AAF 140005 | FIF 140006 | SBSF 140008 | AAD 140009
--                     (PSS 140003, KAF 140004, SERA 140007 disiapkan untuk pelanggan baru)
--                   BEBAN yang tidak dikenal -> 149999 Piutang - Lain-lain
--   Cr Pendapatan   per pelanggan lewat cabang (= BEBAN), kunci HURUF BESAR:
--                     ASF, ASF-INT                       -> 411001 Pendapatan Jasa - ASF
--                     CSDI, CSDI-OPCENT, CSDI-TECHNO     -> 411002 Pendapatan Jasa - CSDI
--                     AAF -> 411005 | FIF -> 411006 | SBSF -> 411008 | AAD -> 411009
--                     (PSS 411003, KAF 411004, SERA 411007 sudah disiapkan untuk pelanggan baru)
--                   BEBAN yang tidak dikenal -> 481001 Pengembalian biaya Outsourching
--   Cr PPN          246001 Hutang Pajak - PPN
-- Catatan: (a) Piutang dan pendapatan sama-sama dipilih per cabang (= BEBAN); Settings > Account
-- Mapping klien (account_receivable / sales_revenue / sales_tax_payable), kalau diisi, hanya
-- dipakai untuk BEBAN yang tidak ada di peta resep ini dan untuk PPN. Kolom "Klasifikasi" di file
-- (piutang tiap invoice) tidak dibaca; peta resep ini yang menentukan. (b) Semua akun harus ada
-- di COA klien Birawa di database (management_client_coa) -- tanpa itu posting ditolak. Seed
-- COA Birawa dibuat lewat migrations/generate_seed_coa.py (tambahkan BIRAWA ke KLIEN lalu
-- jalankan). (c) Pendapatan = fee + gaji yang ditagihkan ulang (dasar "tagihan"), tidak
-- dipisah ke 481001. (d) Data file menunjukkan ASF-INT memakai "Piutang - ASF"; 8 invoice
-- insentif AAF/SBSF di file diklasifikasikan "Piutang - ASF" (kemungkinan salah ketik di file).
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian, urut seperti array
-- "variants" dan dipisah ':' (pola seed SAU/NBM). Untuk SATU varian = SHA-256(hash varian):
--   hash_excel = b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45
--   -> 9fc6bf2f4962f95bf08b9d6064ab10af03b78a0b917a30b8f0206dbf3c17f3be
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya pengisi
-- kolom NOT NULL untuk template Multi; yang dipakai pencocokan adalah nilai di dalam varian.
--
-- KLIEN: dicari lewat client_code = 'BIRAWA' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- SEED LAMA: tidak ada (seed Birawa pertama; file ini sebelumnya kosong).
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya (nama file saja akan dicari
-- run_seed.py hanya di folder migrations/ dan tidak ketemu):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_birawa_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok DO, baris
-- Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash versi lamanya
-- (v_hash_lama), termasuk yang sudah soft-delete (UNIQUE tidak melihat deleted_at):
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan isi seed
--               ini, is_active = true, deleted_at dikosongkan. id, usage_count, created_at dan
--               source_files.template_id TETAP, jadi riwayat file yang sudah diupload tidak putus.
--   * tidak  -> INSERT baris baru.
-- Konsekuensi: menjalankan ulang seed ini MENIMPA resep baris itu dengan isi file ini
-- (termasuk perubahan manual lewat UPDATE).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini (bukan baris yang di-upgrade) yang
-- memuat varian Excel dengan header yang sama, seed berhenti dengan pesan jelas supaya tidak ada
-- 2 template aktif (usage_count terbagi). Singkirkan yang tidak dipakai (soft-delete, aman
-- terhadap FK source_files):
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi nanti (mis. layout register 2027 atau format lain): tambahkan 1 objek
-- lagi di array "variants" (file_type, sheet_name, header_row_index, data_start_row_index,
-- column_signature_hash dari baris header file contoh, header_columns, mapping_rules), hitung
-- ulang hash level baris = SHA-256("<hash_excel>:<hash_baru>") (urutan = urutan array), isi
-- v_hash_baru dengan hash itu dan PINDAHKAN hash baris yang lama ke v_hash_lama di blok DO, lalu
-- jalankan ulang file ini: baris yang sudah ada otomatis di-upgrade di tempat.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM (bukan DEFAULT
-- kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<hash_excel>") dan hash baris versi-versi LAMA seed yang
    -- sama (belum ada). Baris lama ditemukan lewat daftar ini lalu di-UPDATE di tempat --
    -- lihat "Idempotensi" di kepala file.
    v_hash_baru   CONSTANT TEXT := '9fc6bf2f4962f95bf08b9d6064ab10af03b78a0b917a30b8f0206dbf3c17f3be';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien Birawa untuk laporan penjualan. Varian Excel: register tagihan manual 'DETAIL INVOICE 2026 + PPN' (berblok bulanan, 1 baris = 1 invoice). Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok (lihat _template_dari_varian di sales_import_v1.py).",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45",
      "header_columns": [
        "BULAN",
        "KETERANGAN",
        "BEBAN",
        "MAN POWER",
        "NO INVOICE",
        "TANGGAL TRANSFER",
        "TANGGAL BAYAR",
        "NILAI INVOICE",
        "GAJI",
        "KET GAJI",
        "BPJS TK",
        "BPJS KS",
        "PPH21",
        "POT ABSEN",
        "POT KOPERASI",
        "SPD",
        "POT LAIN - LAIN",
        "FEE INCLUDE PPN",
        "TOTAL",
        "SELISIH KOLOM G - R",
        "FEE NET(DPP)",
        "PPN(11%)",
        "PPH 23(2%)",
        "Total Tagihan",
        "Pph23",
        "Tagihan - Pph23",
        "TERIMA DI RK",
        "TANGGAL DI RK",
        "SELISIH",
        "KET",
        "no rekon",
        "Klasifikasi",
        "Cek"
      ],
      "mapping_rules": {
        "format_type": "monthly_block_invoice_register",
        "description": "Register tagihan manual Birawa (DETAIL INVOICE 2026 + PPN), sheet 'Sheet1': 1 sheet = 1 tahun, tiap bulan = 1 BLOK (baris header diulang di tiap blok, kolom BULAN hanya terisi di baris pertama blok), 1 baris = 1 invoice. Nomor invoice ADA di file (kolom NO INVOICE), tanggal invoice TIDAK ada -- tanggal = kolom BULAN blok (tanggal 1 bulan itu). Nilai = NILAI INVOICE (tagihan penuh ke pelanggan, termasuk gaji/BPJS yang ditagihkan ulang), PPN = kolom PPN(11%), DPP = NILAI INVOICE - PPN. Pelanggan = kolom BEBAN. Sheet lain di workbook (Sheet2, sheet, Sheet3 = pivot/rekap) tidak dibaca. Kolom dicari lewat NAMA di baris header; kolom A kosong tidak ikut di-hash (kolom_awal = 2).",
        "kolom_awal": 2,
        "dasar": "tagihan",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "kolom": {
          "bulan": "BULAN",
          "invoice": "NO INVOICE",
          "customer": "BEBAN",
          "total": "NILAI INVOICE",
          "ppn": "PPN(11%)",
          "dpp": "FEE NET(DPP)"
        },
        "cabang_dari_kolom_customer": true,
        "field_mapping": {
          "tanggal": "kolom BULAN blok (sel gabungan, dibawa ke baris di bawahnya)",
          "invoice": "kolom NO INVOICE",
          "customer": "kolom BEBAN",
          "cabang": "= kolom BEBAN (dipakai memilih akun pendapatan per pelanggan)",
          "dpp": "NILAI INVOICE - PPN(11%)",
          "ppn": "kolom PPN(11%) (0 untuk invoice kompensasi PKWT/tanpa fee)",
          "total": "kolom NILAI INVOICE"
        },
        "row_granularity": "per_invoice",
        "catatan_analisis": "Dianalisis dari 1 file contoh DETAIL_INVOICE_2026___PPN.xlsx (Sheet1 A1:AI324): 12 blok bulan Jan-Des 2026, header di baris 2, 26, 53, 84, 110, 137, 168, 194, 222, 249, 274, 298. Hanya Jan-Agu yang berisi nilai (202 invoice bernilai, semua nomor unik); blok Sep-Des berisi nomor invoice urut tanpa nilai (placeholder) dan dilewati. Pelanggan (BEBAN): ASF, ASF-INT, CSDI, CSDI-OPCENT, CSDI-TECHNO, AAF, SBSF, FIF, AAD. Baris 83 dan 166 adalah baris subtotal tanpa nomor invoice (lihat catatan di kepala seed)."
      }
    }
  ],
  "piutang_account": {
    "account_code": "149999",
    "account_name": "Piutang - Lain-lain"
  },
  "pendapatan_account": {
    "account_code": "481001",
    "account_name": "Pengembalian biaya Outsourching"
  },
  "pendapatan_account_by_cabang": {
    "ASF": {
      "account_code": "411001",
      "account_name": "Pendapatan Jasa - ASF"
    },
    "ASF-INT": {
      "account_code": "411001",
      "account_name": "Pendapatan Jasa - ASF"
    },
    "CSDI": {
      "account_code": "411002",
      "account_name": "Pendapatan Jasa - CSDI"
    },
    "CSDI-OPCENT": {
      "account_code": "411002",
      "account_name": "Pendapatan Jasa - CSDI"
    },
    "CSDI-TECHNO": {
      "account_code": "411002",
      "account_name": "Pendapatan Jasa - CSDI"
    },
    "PSS": {
      "account_code": "411003",
      "account_name": "Pendapatan Jasa - PSS"
    },
    "KAF": {
      "account_code": "411004",
      "account_name": "Pendapatan Jasa - KAF"
    },
    "AAF": {
      "account_code": "411005",
      "account_name": "Pendapatan Jasa - AAF"
    },
    "FIF": {
      "account_code": "411006",
      "account_name": "Pendapatan Jasa - FIF"
    },
    "SERA": {
      "account_code": "411007",
      "account_name": "Pendapatan Jasa - SERA"
    },
    "SBSF": {
      "account_code": "411008",
      "account_name": "Pendapatan Jasa - SBSF"
    },
    "AAD": {
      "account_code": "411009",
      "account_name": "Pendapatan Jasa - AAD"
    }
  },
  "piutang_account_by_cabang": {
    "ASF": {
      "account_code": "140001",
      "account_name": "Piutang - ASF"
    },
    "ASF-INT": {
      "account_code": "140001",
      "account_name": "Piutang - ASF"
    },
    "CSDI": {
      "account_code": "140002",
      "account_name": "Piutang - CSDI"
    },
    "CSDI-OPCENT": {
      "account_code": "140002",
      "account_name": "Piutang - CSDI"
    },
    "CSDI-TECHNO": {
      "account_code": "140002",
      "account_name": "Piutang - CSDI"
    },
    "PSS": {
      "account_code": "140003",
      "account_name": "Piutang - PSS"
    },
    "KAF": {
      "account_code": "140004",
      "account_name": "Piutang - KAF"
    },
    "AAF": {
      "account_code": "140005",
      "account_name": "Piutang - AAF"
    },
    "FIF": {
      "account_code": "140006",
      "account_name": "Piutang - FIF"
    },
    "SERA": {
      "account_code": "140007",
      "account_name": "Piutang - SERA"
    },
    "SBSF": {
      "account_code": "140008",
      "account_name": "Piutang - SBSF"
    },
    "AAD": {
      "account_code": "140009",
      "account_name": "Piutang - AAD"
    }
  },
  "ppn_account": {
    "account_code": "246001",
    "account_name": "Hutang Pajak - PPN"
  },
  "catatan_akun": "Akun default dipilih dari COA BIRAWA (sheet 'COA BIRAWA' di COA_Clients_GOUF_IFRS_Standardized.xlsx); ASUMSI, bisa diubah per invoice di Journal Preview atau lewat Settings > Account Mapping (yang diutamakan setelah peta per cabang). Pendapatan dan piutang dipilih per pelanggan lewat kolom BEBAN (= cabang invoice): 'Pendapatan Jasa - <pelanggan>' dan 'Piutang - <pelanggan>' (kunci HURUF BESAR). BEBAN yang tidak dikenal jatuh ke akun umum: piutang 149999 Piutang - Lain-lain, pendapatan 481001 Pengembalian biaya Outsourching. piutang_account_by_cabang dibaca db_client.akun_default_sales() (butuh db_client versi yang memuat peta piutang per cabang; versi lama mengabaikannya dan memakai piutang_account)."
}$json$::jsonb;
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

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini yang sudah memuat varian Excel
    -- dengan header yang sama (baris yang di-upgrade dikecualikan).
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien BIRAWA sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
        RAISE NOTICE 'Template Multi BIRAWA dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi BIRAWA sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'BIRAWA';