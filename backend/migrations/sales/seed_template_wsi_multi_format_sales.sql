-- seed_template_wsi_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien WSI (PT Well Star Indonesia). SATU baris setting ("Multi") untuk halaman
-- Transactions > Sales > Source Data, berisi 1 varian Excel: laporan "HOTEL SALES
-- RECAP" (rekap penjualan hotel per channel OTA). Format lain nanti cukup ditambahkan
-- ke array "variants" (lihat "Menambah varian / properti / channel" di bawah).
--
-- SUMBER (4 file contoh bulan Agustus 2026, 1 file per properti):
--   HOTEL_SALES_RECAP_-August_Lime_villa.xlsx
--   HOTEL_SALES_RECAP_-_August_Treeland_.xlsx
--   HOTEL_SALES_RECAP_-_August_Purnama_.xlsx
--   HOTEL_SALES_RECAP_-_August_Bougainvilla.xlsx
--   * NAMA PROPERTI HANYA ADA DI NAMA FILE. Isi sheet hanya memuat nama PT (A2).
--   * 1 file = 1 properti, 2 sheet = 2 channel: "AIRBNB" dan "BOOKING.COM".
--   * Tiap sheet: A1 judul channel ("AIRBNB SALES RECAPITULATION"), A2 "PT WELL STAR
--     INDONESIA", A3 nama bulan, baris 4 kosong, HEADER baris 5 (6 kolom A:F):
--       A MONTH | B INCOME BEFORE TAX | C SERVICE FEE (INC VAT) | D TOTAL RECEIVING |
--       E HOTEL TAX 10% | F NET INCOME AFTER TAX
--     Data baris 6-36 = 31 hari (tanggal bertipe tanggal). Hari tanpa transaksi:
--     B dan C KOSONG, D/E/F rumus bernilai 0. Di bawah data ada baris total (SUM) dan
--     kadang 1 baris rumus 0 tanpa tanggal -- posisinya BEDA tiap sheet/file (baris 38
--     atau 39), jadi parser tidak memakai nomor baris.
--   * D = B-C, E = ROUND(B*10%,0), F = D-E (RUMUS). Kalau file disimpan oleh software
--     yang tidak menghitung rumus, selnya kosong -> pajak dihitung ulang dari B.
--
-- CARA APLIKASI MEMBACA UPLOAD WSI (resep "daily_channel_recap", sales_import_v1.py
-- bagian 3e -- format BARU, ditambahkan bersama seed ini):
--   1. Backend mencocokkan file ke varian lewat LABEL kolom header di sheet mana pun
--      (kolom tanggal "MONTH/DATE/TANGGAL" + "INCOME BEFORE TAX"), dicari di 15 baris
--      teratas. column_signature_hash varian tetap diisi (NOT NULL + dokumentasi), tetapi
--      pencocokan TIDAK memakai hash persis supaya perubahan kecil tidak menjatuhkan file ke
--      "Butuh Review".
--   2. Tiap sheet yang headernya dikenal dibaca; kolom dicari lewat NAMA, bukan posisi.
--   3. Hasil: 1 baris source_rows = 1 HARI x 1 CHANNEL x 1 PROPERTI (INCOME BEFORE TAX
--      tidak 0). Hari bernilai 0 dilewati.
--        invoice  = WSI-<PROPERTI>-<CHANNEL>-YYYYMMDD   (mis. WSI-LIME-VILLA-AIRBNB-20260803;
--                   file tidak punya nomor invoice, jadi dibentuk)
--        tanggal  = kolom MONTH
--        customer = nama channel (AIRBNB / BOOKING.COM)
--        cabang   = properti dari NAMA FILE (LIME VILLA / TREELAND / PURNAMA / BOUGAINVILLA)
--        dpp      = INCOME BEFORE TAX
--        ppn      = HOTEL TAX 10% (nilai file; kosong -> 10% x dpp, bulat setengah ke atas
--                   seperti ROUND Excel -- round() Python membulatkan ke genap dan selisih
--                   1 rupiah, mis. 4.662.625 x 10% = 466.262,5 -> 466.263)
--        total    = dpp + ppn
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke 4 file contoh):
--   properti        AIRBNB inv / dpp          BOOKING.COM inv / dpp       ppn
--   Lime Villa       3 /  12.490.000           3 /  19.544.000          3.203.400
--   Treeland         2 /  16.300.000           3 /  68.535.500          8.483.550
--   Purnama          1 /   1.466.250           4 /  24.372.900          2.583.915
--   Bougainvilla    11 / 108.261.744           0 /           0         10.826.176
--   TOTAL 27 invoice, semuanya valid: dpp 250.970.394 + ppn 25.097.041 = 276.067.435.
--   Setiap angka sama dengan baris total di file (SUM) per sheet.
--
-- ANTISIPASI PERBEDAAN FILE (diuji dengan file contoh yang sengaja diubah):
--   Tetap terbaca OTOMATIS:
--     * kop/baris kosong di atas header bertambah atau berkurang (header dicari di 15 baris)
--     * urutan kolom berubah, kolom tambahan ada, kolom A kosong di depan
--     * label kolom berubah sebagian ("HOTEL TAX 11%", "SERVICE FEE", "Income Before Tax")
--       -- dicocokkan sebagai AWALAN, tanpa peduli huruf besar/kecil dan spasi ganda
--     * posisi/jumlah baris total berubah, baris total dihapus
--     * sel rumus tanpa nilai tersimpan (pajak dihitung ulang, hasil sama persis)
--     * tanggal berbentuk teks ("2026-08-05"), angka berbentuk teks ("1.500.000", "Rp 1,500,000")
--     * sheet channel BARU (mis. AGODA) dengan header yang sama: otomatis ikut diimpor, nama
--       sheet = nama customer. Sheet bernama generik (Sheet1) memakai judul A1 sebagai channel.
--     * sheet kosong (Sheet1 bawaan) dan sheet di daftar sheet_abaikan (SUMMARY, REKAP, TOTAL,
--       ...) dilewati tanpa peringatan -- JANGAN beri nama sheet rekap gabungan selain itu,
--       karena headernya mirip dan akan terhitung dobel
--     * nama file bervariasi ("Agustus 2026 Lime Villa (2).xlsx"); properti baru yang belum
--       terdaftar tetap terbaca dari nama file (dengan catatan peringatan)
--   Muncul sebagai baris INVALID (status "Butuh Review", TIDAK ikut Buat Invoice) -- tidak
--   hilang diam-diam:
--     * nama properti tidak terbaca dari nama file (satu baris peringatan, file tidak diimpor
--       supaya nomor invoice antar properti tidak bentrok)
--     * sheet tanpa header yang dikenal / sheet tersembunyi
--     * baris tanpa tanggal bernilai yang BUKAN total, atau total file != jumlah harian
--       (ada hari hilang/rusak)
--     * tanggal tidak terbaca, isi sel bukan angka, income 0 tapi service fee/pajak terisi,
--       income negatif (pembatalan/refund)
--   Hanya CATATAN (tetap valid): Hotel Tax di file != 10% x Income (selisih > 1 rupiah),
--   Service Fee negatif/melebihi Income, nomor invoice ganda (mis. sheet salinan "AIRBNB (2)"
--   -- baris kedua dst otomatis dilewati saat Buat Invoice karena nomornya bentrok).
--   Di LUAR kemampuan resep (file masuk "Butuh Review" atau perlu varian baru): header diganti
--   total (tanpa "Income Before Tax"/padanannya), 1 sheet berisi beberapa properti, tanggal
--   hanya berupa nomor hari (1..31) tanpa bulan/tahun.
--
-- ASUMSI AKUNTANSI -- MOHON DIKONFIRMASI (ubah di resep, lalu jalankan ulang seed):
--   1. ppn = HOTEL TAX 10% (pajak hotel/PB1) DITAMBAHKAN di atas dpp, jadi total = dpp + ppn
--      (pola yang sama dengan PB1 di seed NBM). Kalau INCOME BEFORE TAX ternyata sudah
--      termasuk pajak yang ditanggung hotel (di file, NET INCOME = TOTAL RECEIVING - HOTEL TAX,
--      artinya pajak diambil dari uang OTA), set "pajak_termasuk_dalam_income": true ->
--      dpp = INCOME - pajak, total = INCOME.
--   2. SERVICE FEE (komisi OTA) TIDAK masuk dpp/ppn/total (source_rows hanya punya 3 nilai).
--      Akibatnya komisi OTA belum tercatat sebagai beban dari import ini, dan piutang = dpp +
--      ppn lebih besar dari uang yang benar-benar dibayar OTA (TOTAL RECEIVING = B - C). Kalau
--      ingin pendapatan dicatat NETTO komisi (pola AADL untuk booking.com), set
--      "fee_mengurangi_dpp": true -> dpp = INCOME - SERVICE FEE. Selisih ke mutasi bank OTA
--      tetap perlu disesuaikan di Journal Preview/rekonsiliasi.
--   3. Properti dipetakan ke "cabang" (nama baku HURUF BESAR) supaya bisa dipetakan ke akun
--      pendapatan per properti.
--
-- AKUN JURNAL: BELUM DIISI. COA WSI belum ada di repo (tidak ada seed_coa_wsi.sql) dan akun
-- tidak boleh ditebak karena posting ditolak kalau kode tidak ada di COA klien. Selama kosong:
-- db_client.akun_default_sales() memakai Settings > Account Mapping klien (account_receivable /
-- sales_revenue / sales_tax_payable); kalau itu juga kosong, mapping akun invoice dilewati
-- diam-diam saat Buat Invoice. Setelah COA WSI ada, tambahkan di v_rules (sejajar "variants"):
--   "piutang_account":   {"account_code": "<kode>", "account_name": "<nama>"},   -- mis. piutang OTA
--   "pendapatan_account": {"account_code": "<kode>", "account_name": "<nama>"},
--   "ppn_account":       {"account_code": "<kode>", "account_name": "<nama>"},   -- Hutang Pajak Hotel/PB1
--   "pendapatan_account_by_cabang": {          -- kunci HURUF BESAR, persis nilai cabang
--     "LIME VILLA":   {"account_code": "...", "account_name": "..."},
--     "TREELAND":     {...}, "PURNAMA": {...}, "BOUGAINVILLA": {...}
--   }
-- (opsional "piutang_account_by_cabang" dengan kunci yang sama, mis. piutang per OTA/properti.)
--
-- column_signature_hash:
--   hash_excel = c418e36b07c935f60fa4593e22d42fb1a8017b769ff3584b956c9a51544cddaf
--              = _hash_baris(header baris 5): huruf kecil, spasi dirapikan, digabung '|'
--   baris Multi (1 varian) = SHA-256("<hash_excel>")
--              = c957e961a69df28e68885e130b8c42f6f7160de2dc4f113e727bc24bf413fa92
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya pengisi
-- kolom NOT NULL untuk template Multi; yang dipakai pencocokan adalah resep di dalam varian.
--
-- KLIEN: dicari lewat nama_client = 'PT WELL STAR INDONESIA' (sesuai data klien di VPS) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_wsi_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
-- PENTING: seed ini bergantung pada format_type baru "daily_channel_recap" -- deploy
-- sales_import_v1.py yang sudah diperbarui SEBELUM upload file WSI, kalau tidak file jatuh
-- ke parser flat lama dan hasilnya salah.
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok DO, baris
-- Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash versi lamanya
-- (v_hash_lama), termasuk yang sudah soft-delete (UNIQUE tidak melihat deleted_at):
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan isi
--               seed ini, is_active = true, deleted_at dikosongkan. id, usage_count, created_at
--               dan source_files.template_id TETAP, jadi riwayat file tidak putus.
--   * tidak  -> INSERT baris baru.
-- Konsekuensi: menjalankan ulang seed ini MENIMPA resep baris itu dengan isi file ini
-- (termasuk perubahan manual lewat UPDATE). Pengaman: kalau ada baris Multi AKTIF lain milik
-- klien ini yang memuat varian Excel dengan header yang sama, seed berhenti dengan pesan jelas
-- supaya tidak ada 2 template aktif. Singkirkan yang tidak dipakai (soft-delete, aman
-- terhadap FK source_files):
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian / properti / channel:
--   * PROPERTI BARU: tambahkan {"nama": "<NAMA>", "cocok": ["<kata di nama file>"]} ke
--     "properti" (dan kunci HURUF BESAR yang sama ke pendapatan_account_by_cabang). Tanpa itu
--     properti tetap terbaca dari nama file (pola properti_dari_nama_file) dengan catatan.
--   * CHANNEL BARU (Agoda, Traveloka, ...): TIDAK perlu diubah selama headernya sama; isi
--     "channel" hanya kalau nama sheet ingin diseragamkan ("agoda.com": "AGODA").
--   * FORMAT BARU: tambahkan 1 objek lagi di array "variants", hitung ulang hash baris =
--     SHA-256("<hash_excel>:<hash_baru>"), isi v_hash_baru dan PINDAHKAN hash lama ke
--     v_hash_lama, lalu jalankan ulang seed.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM (bukan
-- DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<hash_excel>"). Belum ada versi lama.
    v_hash_baru   CONSTANT TEXT := 'c957e961a69df28e68885e130b8c42f6f7160de2dc4f113e727bc24bf413fa92';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json$
{
  "format_type": "multi_format",
  "description": "1 setting klien WSI (PT Well Star Indonesia) untuk laporan penjualan. 1 varian Excel: rekap penjualan hotel per channel OTA ('HOTEL SALES RECAP - <bulan> <properti>', 1 sheet per channel, 1 baris per hari). Varian lain (format baru dari software/properti lain) cukup ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 5,
      "data_start_row_index": 6,
      "column_signature_hash": "c418e36b07c935f60fa4593e22d42fb1a8017b769ff3584b956c9a51544cddaf",
      "header_columns": [
        "MONTH",
        "INCOME BEFORE TAX",
        "SERVICE FEE (INC VAT)",
        "TOTAL RECEIVING",
        "HOTEL TAX 10%",
        "NET INCOME AFTER TAX"
      ],
      "mapping_rules": {
        "format_type": "daily_channel_recap",
        "description": "Rekap penjualan hotel PT Well Star Indonesia per channel OTA. 1 file = 1 properti (nama properti HANYA ada di nama file: 'HOTEL SALES RECAP - August Lime villa.xlsx'); 1 sheet = 1 channel (AIRBNB, BOOKING.COM, sheet channel baru otomatis ikut terbaca); 1 baris = 1 hari. 1 baris kanonis (source_rows) = 1 HARI x 1 CHANNEL x 1 PROPERTI dengan INCOME BEFORE TAX tidak 0. Kolom dicari lewat NAMA header (bukan posisi) di 15 baris teratas tiap sheet, jadi urutan kolom/kop yang bergeser tetap terbaca.",
        "prefix_invoice": "WSI",
        "properti": [
          {
            "nama": "LIME VILLA",
            "cocok": [
              "lime"
            ]
          },
          {
            "nama": "TREELAND",
            "cocok": [
              "treeland",
              "tree land"
            ]
          },
          {
            "nama": "PURNAMA",
            "cocok": [
              "purnama"
            ]
          },
          {
            "nama": "BOUGAINVILLA",
            "cocok": [
              "bougainvil"
            ]
          }
        ],
        "properti_dari_nama_file": {
          "pattern": "^HOTEL[\\s_]+SALES[\\s_]+RECAP[\\s_\\-]*[A-Za-z]+[\\s_\\-]+(?:\\d{4}[\\s_\\-]+)?(.+?)[\\s_]*(?:\\(\\d+\\))?$",
          "group": 1
        },
        "channel": {
          "airbnb": "AIRBNB",
          "booking.com": "BOOKING.COM",
          "booking com": "BOOKING.COM",
          "booking": "BOOKING.COM"
        },
        "sheet_abaikan": [
          "summary",
          "resume",
          "rekap",
          "recap",
          "total",
          "grand total",
          "all",
          "meta",
          "cek upload"
        ],
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tarif_pajak": 0.1,
        "fee_mengurangi_dpp": false,
        "pajak_termasuk_dalam_income": false,
        "lewati_nol": true,
        "toleransi_selisih": 1,
        "maks_baris_header": 15,
        "field_mapping": {
          "tanggal": "kolom MONTH (1 baris = 1 hari, bertipe tanggal)",
          "invoice": "WSI-<PROPERTI>-<CHANNEL>-YYYYMMDD (dibentuk; file tidak punya nomor invoice)",
          "customer": "nama channel = nama sheet (AIRBNB / BOOKING.COM)",
          "cabang": "properti dari NAMA FILE (LIME VILLA / TREELAND / PURNAMA / BOUGAINVILLA)",
          "dpp": "INCOME BEFORE TAX",
          "ppn": "HOTEL TAX 10% (pajak hotel/PB1; kosong -> 10% x INCOME BEFORE TAX, bulat setengah ke atas)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_day_per_channel_per_property",
        "catatan_analisis": "Dianalisis dari 4 file contoh bulan Agustus 2026 (1 file per properti: Lime Villa, Treeland, Purnama, Bougainvilla), masing-masing 2 sheet (AIRBNB, BOOKING.COM), A1:F38..40. Kop baris 1-3 (judul channel, PT WELL STAR INDONESIA, nama bulan), header baris 5, data baris 6-36 (31 hari, tanggal bertipe tanggal), baris total di bawahnya (baris 38 atau 39, posisinya beda tiap sheet; baris 37 kadang berisi rumus 0 tanpa tanggal). Kolom D/E/F berumus: D = B-C, E = ROUND(B*10%,0), F = D-E. Hari tanpa transaksi: B dan C KOSONG (bukan 0). Hasil uji dengan kode parser asli: 27 invoice, semuanya valid; jumlah dpp dan pajak per properti per channel sama dengan baris total file."
      }
    }
  ],
  "catatan_akun": "Akun jurnal (piutang_account, pendapatan_account, pendapatan_account_by_cabang, ppn_account) SENGAJA belum diisi: COA klien WSI belum ada di repo (belum ada seed_coa_wsi.sql) dan kode akun tidak boleh ditebak. Selama kosong, Journal Preview memakai Settings > Account Mapping klien; kalau itu juga kosong, mapping akun invoice dilewati diam-diam saat Buat Invoice. Lihat bagian AKUN JURNAL di kepala seed_template_wsi_multi_format_sales.sql."
}$json$::jsonb;
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'c418e36b07c935f60fa4593e22d42fb1a8017b769ff3584b956c9a51544cddaf'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien WSI sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
            5,
            6,
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi WSI dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
           SET header_row_index = 5,
               data_start_row_index = 6,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi WSI sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) = 'PT WELL STAR INDONESIA';