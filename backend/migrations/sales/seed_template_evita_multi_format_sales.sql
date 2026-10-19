-- seed_template_evita_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien EVITA (file sumber berawalan "EBA", kode voucher PENJ/EVITABERKATABADI;
-- 2 usaha/Kanal: EVITA SERANGAN dan ANAGEN COKROAMINOTO). SATU baris setting
-- ("Multi") untuk Transactions > Sales > Source Data.
--
-- STATUS: 1 varian Excel (sheet "DATA" di workbook "Jurnal Sales" bulanan).
-- Varian lain nanti cukup ditambahkan ke array "variants" (lihat "Menambah
-- varian lagi" di bawah).
--
-- SUMBER (dataset/template_laporan/EVITA/EBA_Jurnal_Sales_2608_roy.xlsx, Agustus 2026):
--   5 sheet: COA | Sales Jurnal | DATA | Recap | Sheet1 (kosong). Sheet AKTIF saat
--   file dibuka = "Sales Jurnal", BUKAN DATA -- karena itu resep menyebut nama sheet.
--   Yang dibaca HANYA "DATA" = daftar transaksi mentah. Sheet lain turunan/bukan data:
--     Sales Jurnal  jurnal HASIL pengolahan DATA (Dr Bank/Kas, Cr Penjualan per baris
--                   + jurnal adjust Deposit in Transit + accrue pajak PP 55)
--     Recap         rekap harian: PENJUALAN = SUMIF(DATA) dan PAJAK = 0,5 persen (PP 55)
--     COA           daftar akun Evita (kode 5 digit: 10002 Bank BCA, 40001 Penjualan - EVITA, ...)
--   DATA: header di baris 2 (baris 1 = subtotal rumus di kolom H), data mulai baris 3,
--   2.377 baris terisi + 258 baris kosong di bawahnya. Kolom:
--     A Tanggal (sel tanggal) | B Kode Transaksi (PENJ/EVITABERKATABADI/<Bulan>/2026)
--     C Nama Konsumen | D Member (Lama/Baru) | E Bank (BCA/CASH) | F Kanal
--     G Nama Produk Final (SKU) | H Harga Setelah Diskon
--     I nomor urut 4 digit ("0001") -- TANPA judul | J rumus =B&"/"&I -- TANPA judul
--   Nomor invoice = Kode Transaksi + "/" + nomor urut (kolom J). Tiap baris = 1 transaksi
--   (1 pelanggan, 1 layanan/produk) dan punya nomor urut sendiri.
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. User upload file di Sales > Source Data dengan klien Evita aktif.
--   2. Backend memilih varian Excel; sheet "DATA" dibaca; hash baris header (baris 2,
--      sel kosong di ujung dibuang) dicocokkan ke column_signature_hash varian.
--   3. Resep "flat_grouped_by_key" (sales_import_v1.py): kolom dicari lewat NAMA header.
--      Nomor invoice DIRAKIT dari B + "/" + nomor urut (kolom tanpa judul = 1 kolom di
--      kanan "Harga Setelah Diskon", dipadatkan 4 digit), jadi tidak bergantung pada nilai
--      hasil rumus kolom J (file yang disimpan ulang oleh tool lain bisa kehilangan nilai
--      rumus).
--   4. Hasil: invoice = nomor di atas, tanggal = Tanggal, customer = Nama Konsumen
--      (kosong -> "Penjualan - <Kanal>"), cabang = Kanal, dpp = SUM(Harga Setelah Diskon),
--      ppn = 0, total = dpp.
--
-- ANTISIPASI PERBEDAAN ISI FILE (semua sudah diuji ke parser ASLI, lihat HASIL UJI):
--   * Nama sheet beda huruf/spasi ("Data", "DATA ", "data_penjualan") -> tetap terbaca;
--     sheet diganti nama total -> dicari di semua sheet (cari_di_semua_sheet) lewat header.
--   * Baris judul/subtotal di atas header bertambah atau berkurang -> header dicari di 10
--     baris pertama (header_cari_dalam_baris); posisi data ikut bergeser.
--   * Kolom ditambah/disisipkan/dihapus/diurutkan ulang, kolom bantu tanpa judul
--     ditambah/dihapus -> hash persis tidak cocok, tapi cadangan "cocok_jika_kolom_ada"
--     (Tanggal, Kode Transaksi, Nama Konsumen, Kanal, Harga Setelah Diskon) tetap cocok
--     selama 5 kolom itu ada. Kolom wajib diganti nama -> file masuk "Butuh Review" (aman).
--   * Tanggal berupa teks DD/MM/YYYY atau sel tanggal -> keduanya terbaca.
--   * Nomor urut tersimpan angka (1) bukan teks ("0001") -> dipadatkan jadi 4 digit.
--   * Baris kosong, baris total/subtotal tanpa nomor-tanggal-customer, dan sisa rumus
--     di bawah data -> dilewati (abaikan_baris_ringkasan). Baris yang punya tanggal/customer
--     tapi nomor urutnya hilang TIDAK dilewati: muncul sebagai invalid "No. invoice kosong".
--   * Nomor invoice yang sama dipakai transaksi BERBEDA (tanggal/customer beda) -> tidak
--     digabung (key_ganda_pisah): yang kedua dst disimpan "<nomor>-2", semua pemakai nomor
--     itu ditandai is_duplicate_candidate + catatan. Di file contoh: 0326 dipakai 2 orang
--     berbeda (3 Agu Rp 275.000 dan 4 Agu Rp 100.000) -> 0326 dan 0326-2. Perbaiki nomornya
--     di sumber atau biarkan.
--
-- KENAPA ppn = 0: Harga Setelah Diskon final, tidak ada kolom pajak. Pajak yang ada =
-- PP 55 (0,5 persen omzet) yang dijurnal SEKALI sebulan di sheet Sales Jurnal ("JURNAL
-- ACCRUE PAJAK PP 55": Dr 60028 Biaya Pajak, Cr 20005 PPh Ps 4 ayat 2), bukan per invoice.
-- Itu BUKAN bagian import Sales ini.
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke file contoh):
--   2.377 baris source_rows (2.376 nomor unik + 0326-2), semua valid, 2 baris ditandai
--   duplikat (0326 dan 0326-2). Tanggal 01-08-2026 s/d 31-08-2026.
--   DPP 397.497.124,96 + PPN 0 = TOTAL 397.497.124,96 = subtotal H1 sheet DATA.
--   Cabang: EVITA SERANGAN 1.502, ANAGEN COKROAMINOTO 875. Setiap nomor J cocok dengan
--   hasil (selisih 0), kecuali 0326 yang memang dipisah.
--   Skenario variasi (kolom disisipkan, header bergeser, sheet diganti nama, file disimpan
--   ulang tanpa nilai rumus, tanggal teks, dst) menghasilkan total yang sama.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * Kolom Bank (BCA / CASH) tidak ikut diekstrak (source_rows tidak punya kolomnya), jadi
--     sisi debit jurnal memakai satu akun default -- lihat AKUN JURNAL.
--   * Kolom Nama Produk, Member, dan nomor urut tidak masuk source_rows.
--   * Baris bernilai 0 atau negatif tetap diekstrak (belum ada opsi "lewati").
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level atas baris
-- ini; kode dari sheet COA file Evita). INI ASUMSI -- mohon dikonfirmasi:
--   Dr Piutang      10002 Bank BCA   (default; 1.995 dari 2.377 baris = BCA)
--   Cr Pendapatan   40001 Penjualan - EVITA     untuk cabang EVITA SERANGAN
--                   40002 Penjualan - ANAGEN    untuk cabang ANAGEN COKROAMINOTO
--                   (pendapatan_account_by_cabang; kunci HURUF BESAR -- backend
--                   mencocokkan cabang.strip().upper())
-- Catatan: (a) transaksi Bank = CASH (382 baris) seharusnya Dr 10000 Petty Cash: ubah per
-- invoice di Journal Preview. (b) Kolom "Deposit in Transit" (10001) dan adjust bulan
-- sebelumnya tidak bisa dipetakan otomatis. (c) Settings > Account Mapping klien, kalau
-- diisi, tetap didahulukan untuk piutang dan pendapatan. (d) Akun harus ada di COA klien
-- (management_client_coa) -- tanpa itu posting ditolak. (e) ppn_account sengaja tidak
-- diisi karena ppn = 0.
--
-- column_signature_hash:
--   hash varian Excel  = SHA-256 dari baris header yang dinormalisasi (8 kolom, sel kosong
--                        di ujung dibuang): ca5fe82d6459390fe05ccab3b95e231c02312faec2b937122a0768424d649214
--   hash baris Multi   = SHA-256(hash varian)  (1 varian, pola seed ABE): b1f11978cefbe2cccfef875b38bf7c48389d7368d8be00db532252f96fb0175f
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya pengisi
-- kolom NOT NULL; yang dipakai pencocokan adalah nilai di dalam varian.
--
-- KLIEN: dicari lewat client_code = 'EVITA' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_evita_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- (v_hash_baru / v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE hash, posisi header, resep; is_active = true, deleted_at dikosongkan.
--               id, usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Menjalankan ulang MENIMPA resep baris itu dengan isi file ini (termasuk perubahan manual).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini dengan varian Excel berhash
-- sama, seed berhenti dengan pesan jelas. Singkirkan yang tidak dipakai:
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi (mis. CSV/format lain): tambahkan 1 objek di array "variants",
-- hitung ulang hash baris = SHA-256("<hash_excel>:<hash_baru>") (urutan = urutan array),
-- isi v_hash_baru dengan hash itu dan PINDAHKAN hash baris yang lama ke v_hash_lama, lalu
-- jalankan ulang file ini.
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
    v_hash_baru   CONSTANT TEXT := 'b1f11978cefbe2cccfef875b38bf7c48389d7368d8be00db532252f96fb0175f';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien Evita (EBA) untuk laporan penjualan. Varian Excel: sheet DATA di workbook 'Jurnal Sales' bulanan. Varian lain nanti ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "DATA",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "ca5fe82d6459390fe05ccab3b95e231c02312faec2b937122a0768424d649214",
      "header_columns": [
        "Tanggal",
        "Kode Transaksi",
        "Nama Konsumen",
        "Member",
        "Bank",
        "Kanal",
        "Nama Produk Final (SKU)",
        "Harga Setelah Diskon"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_by_key",
        "description": "Sheet DATA workbook penjualan Evita (EBA) -- 1 baris = 1 transaksi/line dengan nomor urut 4 digit (kolom tanpa judul di kanan 'Harga Setelah Diskon'). Nomor invoice dirakit dari 'Kode Transaksi' + '/' + nomor urut (sama dengan rumus kolom bantu di sheet DATA, tapi dihitung ulang sehingga tidak bergantung pada nilai hasil rumus). 1 baris source_rows = 1 nomor invoice. Cabang = kolom Kanal (EVITA SERANGAN / ANAGEN COKROAMINOTO) dipakai memilih akun pendapatan. Kolom dicari lewat NAMA header, jadi urutan/kolom tambahan tidak masalah.",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "invoice_key_gabung": [
          "Kode Transaksi",
          {
            "kolom_setelah": "Harga Setelah Diskon",
            "geser": 1
          }
        ],
        "invoice_key_pemisah": "/",
        "invoice_key_nomor_pad": 4,
        "key_ganda_pisah": true,
        "abaikan_baris_ringkasan": true,
        "tanggal": "Tanggal",
        "customer": "Nama Konsumen",
        "customer_fallback": "Penjualan - {Kanal}",
        "cabang": "Kanal",
        "dpp_columns": [
          "Harga Setelah Diskon"
        ],
        "ppn_columns": [],
        "signature_abaikan_kolom_kosong_di_ujung": true,
        "header_cari_dalam_baris": 10,
        "cocok_jika_kolom_ada": [
          "Tanggal",
          "Kode Transaksi",
          "Nama Konsumen",
          "Kanal",
          "Harga Setelah Diskon"
        ],
        "cari_di_semua_sheet": true,
        "field_mapping": {
          "tanggal": "Tanggal (sel tanggal Excel atau teks DD/MM/YYYY)",
          "invoice": "Kode Transaksi + '/' + nomor urut (kolom tanpa judul di kanan Harga Setelah Diskon, dipadatkan 4 digit)",
          "customer": "Nama Konsumen (kosong -> 'Penjualan - <Kanal>')",
          "cabang": "Kanal",
          "dpp": "SUM(Harga Setelah Diskon) per nomor invoice",
          "ppn": "0 (tidak ada PPN per invoice; pajak PP 55 0,5 persen dijurnal bulanan terpisah)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_invoice_number",
        "catatan_analisis": "Dianalisis dari EBA_Jurnal_Sales_2608_roy.xlsx (Agustus 2026), sheet DATA: header baris 2 (baris 1 = subtotal rumus), data mulai baris 3, 2.377 baris terisi + 258 baris kosong di bawahnya. 2.376 nomor invoice unik: nomor 0326 dipakai 2 transaksi berbeda (3 Agu dan 4 Agu, pelanggan beda) -> dipisah jadi 0326 dan 0326-2 dan ditandai. Total Harga Setelah Diskon 397.497.124,96 = subtotal H1 file. 2 Kanal: EVITA SERANGAN (1.502 baris) dan ANAGEN COKROAMINOTO (875). Bank: BCA 1.995, CASH 382 (tidak diekstrak, tidak ada kolom di source_rows)."
      }
    }
  ],
  "piutang_account": {
    "account_code": "10002",
    "account_name": "Bank BCA"
  },
  "pendapatan_account": {
    "account_code": "40001",
    "account_name": "Penjualan - EVITA"
  },
  "pendapatan_account_by_cabang": {
    "EVITA SERANGAN": {
      "account_code": "40001",
      "account_name": "Penjualan - EVITA"
    },
    "ANAGEN COKROAMINOTO": {
      "account_code": "40002",
      "account_name": "Penjualan - ANAGEN"
    }
  },
  "catatan_akun": "Akun dari sheet COA file Evita; ASUMSI, ubah per invoice di Journal Preview atau lewat Settings > Account Mapping. Debit default 10002 Bank BCA (mayoritas transaksi BCA); transaksi CASH perlu diubah ke 10000 Petty Cash per invoice. Kredit pendapatan per Kanal: EVITA SERANGAN 40001, ANAGEN COKROAMINOTO 40002. PPN tidak dipakai (ppn = 0)."
}$json$::jsonb;
BEGIN
    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'EVITA'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien Evita belum ada di management_clients (dicari client_code = ''EVITA''). Buat dulu lewat halaman Clients, lalu jalankan ulang.';
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'ca5fe82d6459390fe05ccab3b95e231c02312faec2b937122a0768424d649214'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien Evita sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
        RAISE NOTICE 'Template Multi Evita dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi Evita sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(m.client_code) = 'EVITA';