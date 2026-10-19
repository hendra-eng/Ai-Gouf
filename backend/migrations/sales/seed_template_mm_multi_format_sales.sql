-- seed_template_mm_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien MM. SATU baris setting ("Multi") untuk halaman Transactions > Sales >
-- Source Data.
--
-- STATUS: 1 varian Excel -- laporan POS "Report Category Sales" (ringkasan penjualan
-- per KATEGORI per outlet). Varian lain (mis. laporan per item/transaksi dari POS yang
-- sama, atau CSV) nanti cukup ditambahkan ke array "variants" (lihat "Menambah varian").
--
-- PENTING -- BENTUK FILE MM BEDA DARI NBM/EVITA:
--   Bukan daftar invoice. Ini RINGKASAN: 1 baris = 1 kategori untuk 1 periode. Di dalam
--   file TIDAK ada nomor invoice, tanggal, maupun nama customer -- periode dan outlet
--   hanya ada di NAMA FILE. Karena itu dipakai format_type BARU "category_summary" di
--   sales_import_v1.py (periode/outlet dibaca dari nama file, nomor invoice dibentuk).
--
-- SUMBER (dataset/template_laporan/MM/, periode 01-08-2026 s/d 31-08-2026, Outlet 1):
--   Report_Category_Sales_-_01-08-2026_-_31-08-2026_-_Outlet_1__1_.xlsx
--   (nama asli POS: "Report Category Sales - 01-08-2026 - 31-08-2026 - Outlet 1"; tanda
--   "__1_" di belakang = sisa duplikat unduhan browser dan tidak mengganggu)
--   1 sheet "Sheet1" A1:M25. Header baris 1 (10 kolom, kolom K-M tanpa judul), data mulai
--   baris 2, baris "Total" di baris 8, sisanya kosong:
--     Category Name | Item Sold | Item Refunded | Gross Sales | Discount | Refund |
--     Net Sales | COGS | Gross Profit | Gross Margin
--   6 kategori: BARBER 8.188.000 | CAFE MM 230.000 | MERCHANDISE 395.000 | RENTALS
--   10.175.000 | SERVICE MOTOR 3.025.000 | Uncategorized 1.400.000 -> Total 23.413.000
--   (92 item). Discount/Refund/COGS semua 0.
--   Kolom K-M berisi CATATAN MANUAL user (K7 = "BARBER" pada baris Uncategorized, L2 =
--   9.588.000 = BARBER + Uncategorized, M = "v") dan TIDAK dibaca.
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. User upload file di Sales > Source Data dengan klien MM aktif.
--   2. Backend memilih varian Excel; hash baris header (baris 1, sel kosong di ujung dibuang)
--      dicocokkan ke column_signature_hash varian.
--   3. Resep "category_summary": kolom dicari lewat NAMA header; tiap kategori = 1 baris
--      source_rows (kategori sama dijumlah); berhenti di baris "Total".
--   4. Hasil per kategori: tanggal = AKHIR periode dari nama file (31-08-2026); invoice =
--      MM-POS-<awal>-<akhir>-OUTLET<n>-<KATEGORI>, mis. MM-POS-20260801-20260831-OUTLET1-BARBER;
--      customer = "Penjualan POS - Outlet 1 - BARBER"; cabang = nama kategori; dpp = Net Sales
--      (sudah dikurangi Discount dan Refund); ppn = 0; total = dpp.
--
-- ANTISIPASI PERBEDAAN ISI FILE (semua sudah diuji ke parser ASLI):
--   * Nama file beda format (spasi/underscore, ada/tidak "(1)" atau "__1_", 1 atau 2 tanggal,
--     DD-MM-YYYY atau YYYY-MM-DD) -> periode tetap terbaca. Outlet dari kata "Outlet <x>"
--     (opsional; tidak ada -> bagian outlet dibuang dari nomor invoice).
--   * Nama file TANPA tanggal -> baris tetap diekstrak tapi INVALID ("Tanggal tidak terbaca") dan
--     tidak ikut di-promote, supaya tidak ada invoice bertanggal salah. Unggah dengan nama asli POS.
--   * Nama sheet beda ("Sheet1" -> nama lain) -> tetap terbaca (sheet dicari lewat header).
--   * Baris judul bertambah di atas header -> header dicari di 10 baris pertama.
--   * Kolom judul ditambah di kanan (K, L, ...) atau kolom catatan diisi -> cadangan
--     "cocok_jika_kolom_ada" (Category Name, Gross Sales, Net Sales) tetap cocok. Kolom wajib
--     diganti nama -> file masuk "Butuh Review" (aman, tidak diekstrak salah).
--   * Baris Total hilang atau berubah jadi "Grand Total" -> tetap benar (baris total dilewati,
--     hasil tidak bergantung pada baris itu).
--   * Kategori bernilai 0 dilewati (tidak membuat invoice kosong); kategori yang sama muncul
--     2x (huruf/spasi beda) dijumlah; kategori BARU ikut terbaca dan memakai akun default.
--   * Angka berupa teks "8,188,000" terbaca.
--
-- HASIL UJI (parser asli sales_import_v1.py dijalankan ke file contoh):
--   6 baris source_rows, semua valid, tanggal 31-08-2026, DPP 23.413.000 + PPN 0 = TOTAL
--   23.413.000 = baris "Total" file. 14 skenario variasi file menghasilkan total yang benar
--   atau (untuk kolom wajib diganti nama) ditolak aman ke "Butuh Review".
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * Karena file hanya ringkasan per kategori, invoice yang dihasilkan juga ringkasan (1
--     invoice = penjualan 1 kategori sebulan), bukan per transaksi/struk.
--   * Mengunggah file yang SAMA dua kali menghasilkan nomor invoice yang sama; baris kedua
--     akan ditolak saat promote karena nomor bentrok (itu perilaku yang diinginkan).
--   * Laporan ini tidak memuat pajak (PB1/PPN) dan metode bayar.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level atas baris ini;
-- kode dari sheet "COA MM" di dataset/COA/COA_Clients_GOUF.xlsx). INI ASUMSI -- mohon dikonfirmasi:
--   Dr Piutang      610 Accounts Receivable   (default semua invoice)
--   Cr Pendapatan   per kategori (pendapatan_account_by_cabang; kunci HURUF BESAR):
--                   BARBER 209 Barber Income | CAFE MM 210 Café MM Income |
--                   MERCHANDISE 203 Lifestyle Income | RENTALS 202 Rental Income |
--                   SERVICE MOTOR 200 Services Income |
--                   UNCATEGORIZED 209 Barber Income (mengikuti catatan manual di file
--                   contoh yang memasukkan Uncategorized ke BARBER -- ubah kalau berbeda)
--                   Kategori lain/baru -> 200 Services Income (pendapatan_account).
--   Cr PPN          820 Sales Tax (hanya terpakai kalau suatu saat ppn > 0)
-- Catatan: (a) MERCHANDISE -> 203 Lifestyle Income adalah tebakan terdekat (COA MM tidak punya
-- akun "Merchandise"; alternatif 207 Bike Sales). (b) Sisi debit memakai piutang karena laporan
-- tidak memuat metode bayar -- pelunasan lewat modul bank/kas. (c) Settings > Account Mapping
-- klien, kalau diisi, tetap didahulukan. (d) Akun harus ada di COA klien (management_client_coa)
-- -- tanpa itu posting ditolak.
--
-- column_signature_hash:
--   hash varian Excel = SHA-256 dari baris header yang dinormalisasi (10 kolom, sel kosong di
--                       ujung dibuang): 8947a0f2d23715ad74ed2f2087be2d14212f5d645da76ec621034244022a52d7
--   hash baris Multi  = SHA-256(hash varian) (1 varian, pola seed ABE/Evita): 1b80b85b1f4b164b246d35d95ff0ad87eb63e6e83b7f230d0ebc69d282712b67
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya pengisi
-- kolom NOT NULL; yang dipakai pencocokan adalah nilai di dalam varian.
--
-- KLIEN: dicari lewat client_code = 'MM' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_mm_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- (v_hash_baru / v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE hash, posisi header, resep; is_active = true, deleted_at dikosongkan.
--               id, usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Menjalankan ulang MENIMPA resep baris itu dengan isi file ini (termasuk perubahan manual).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini dengan varian Excel berhash sama,
-- seed berhenti dengan pesan jelas. Singkirkan yang tidak dipakai:
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi: tambahkan 1 objek di array "variants", hitung ulang hash baris =
-- SHA-256("<hash_excel>:<hash_baru>") (urutan = urutan array), isi v_hash_baru dengan hash itu
-- dan PINDAHKAN hash baris yang lama ke v_hash_lama, lalu jalankan ulang file ini.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM
-- (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_nama        TEXT;
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini (lihat "column_signature_hash" di kepala file).
    v_hash_baru   CONSTANT TEXT := '1b80b85b1f4b164b246d35d95ff0ad87eb63e6e83b7f230d0ebc69d282712b67';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien MM untuk laporan penjualan. Varian Excel: POS 'Report Category Sales' (ringkasan per kategori per outlet). Varian lain (mis. laporan per item/transaksi) nanti ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "8947a0f2d23715ad74ed2f2087be2d14212f5d645da76ec621034244022a52d7",
      "header_columns": [
        "Category Name",
        "Item Sold",
        "Item Refunded",
        "Gross Sales",
        "Discount",
        "Refund",
        "Net Sales",
        "COGS",
        "Gross Profit",
        "Gross Margin"
      ],
      "mapping_rules": {
        "format_type": "category_summary",
        "description": "Laporan POS 'Report Category Sales' MM (Excel, sheet Sheet1): 1 baris = 1 KATEGORI untuk 1 periode & 1 outlet. File TIDAK memuat nomor invoice maupun tanggal, jadi periode dan outlet diambil dari NAMA FILE (mis. 'Report Category Sales - 01-08-2026 - 31-08-2026 - Outlet 1.xlsx'). 1 baris source_rows = 1 kategori; tanggal invoice = akhir periode; nomor invoice = MM-POS-<awal>-<akhir>-<OUTLET>-<KATEGORI>; cabang = nama kategori (dipakai memilih akun pendapatan). dpp = Net Sales. Kolom dicari lewat NAMA header; baris Total dan kolom catatan manual di kanan tabel diabaikan.",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "kategori": "Category Name",
        "dpp_columns": [
          "Net Sales"
        ],
        "ppn_columns": [],
        "akhir_data_jika": [
          "Total",
          "Grand Total"
        ],
        "abaikan_nilai_nol": true,
        "prefix_invoice": "MM-POS",
        "tanggal_pakai": "akhir",
        "outlet_dari_nama_file": {
          "pattern": "Outlet[ _]+([A-Za-z0-9]+)",
          "group": 1,
          "label": "OUTLET"
        },
        "customer_prefix": "Penjualan POS",
        "signature_abaikan_kolom_kosong_di_ujung": true,
        "header_cari_dalam_baris": 10,
        "cocok_jika_kolom_ada": [
          "Category Name",
          "Gross Sales",
          "Net Sales"
        ],
        "cari_di_semua_sheet": true,
        "field_mapping": {
          "tanggal": "akhir periode dari NAMA FILE (DD-MM-YYYY, 2 tanggal: awal - akhir)",
          "invoice": "MM-POS-<awal YYYYMMDD>-<akhir YYYYMMDD>-OUTLET<n dari nama file>-<KATEGORI>",
          "customer": "Penjualan POS - Outlet <n> - <Category Name>",
          "cabang": "Category Name",
          "dpp": "Net Sales per kategori (sudah dikurangi Discount dan Refund)",
          "ppn": "0 (laporan tidak punya kolom pajak)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_category_per_period",
        "catatan_analisis": "Dianalisis dari 'Report Category Sales - 01-08-2026 - 31-08-2026 - Outlet 1.xlsx': sheet Sheet1 A1:M25, header baris 1 (10 kolom), 6 baris kategori (BARBER, CAFE MM, MERCHANDISE, RENTALS, SERVICE MOTOR, Uncategorized) lalu baris 'Total' (Net Sales 23.413.000, 92 item). Semua Discount/Refund/COGS = 0. Kolom K-M berisi catatan manual user (mis. 'BARBER' di baris Uncategorized, subtotal 9.588.000 = BARBER + Uncategorized) dan TIDAK dibaca."
      }
    }
  ],
  "piutang_account": {
    "account_code": "610",
    "account_name": "Accounts Receivable"
  },
  "pendapatan_account": {
    "account_code": "200",
    "account_name": "Services Income"
  },
  "ppn_account": {
    "account_code": "820",
    "account_name": "Sales Tax"
  },
  "pendapatan_account_by_cabang": {
    "BARBER": {
      "account_code": "209",
      "account_name": "Barber Income"
    },
    "CAFE MM": {
      "account_code": "210",
      "account_name": "Café MM Income"
    },
    "MERCHANDISE": {
      "account_code": "203",
      "account_name": "Lifestyle Income"
    },
    "RENTALS": {
      "account_code": "202",
      "account_name": "Rental Income"
    },
    "SERVICE MOTOR": {
      "account_code": "200",
      "account_name": "Services Income"
    },
    "UNCATEGORIZED": {
      "account_code": "209",
      "account_name": "Barber Income"
    }
  },
  "catatan_akun": "Akun dari sheet COA MM (COA_Clients_GOUF.xlsx); ASUMSI, ubah per invoice di Journal Preview atau lewat Settings > Account Mapping. Pendapatan dipilih per kategori (cabang = Category Name, kunci HURUF BESAR): BARBER 209, CAFE MM 210, MERCHANDISE 203 Lifestyle Income, RENTALS 202, SERVICE MOTOR 200, UNCATEGORIZED 209 (mengikuti catatan manual di file contoh yang memasukkan Uncategorized ke BARBER). Kategori baru yang belum terdaftar memakai 200 Services Income. Debit default 610 Accounts Receivable."
}$json$::jsonb;
BEGIN
    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'MM'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien MM belum ada di management_clients (dicari client_code = ''MM''). Buat dulu lewat halaman Clients, lalu jalankan ulang.';
    END IF;
    RAISE NOTICE 'Klien terpilih: % (client_code %)', v_nama, v_client_code;

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini dengan varian Excel berhash sama.
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = '8947a0f2d23715ad74ed2f2087be2d14212f5d645da76ec621034244022a52d7'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien MM sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
        RAISE NOTICE 'Template Multi MM dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi MM sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'MM';