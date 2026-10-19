-- seed_template_ubd_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien UBD. SATU baris setting ("Multi") untuk halaman Transactions > Sales >
-- Source Data.
--
-- STATUS: varian Excel (workbook "Monitoring Project Income", jurnal
-- pendapatan proyek dari buku besar) di array "variants" pada SATU baris
-- template Multi. Format lain nanti cukup ditambahkan ke array itu (lihat
-- bagian "Menambah varian lagi" di bawah).
--
-- SUMBER EXCEL:
--   UBD_monitoring_project_income_202608_roy.xlsx
--   1 sheet bernama "Monitoring Project Income", A1:M72. Ini BUKAN laporan
--   invoice, melainkan jurnal buku besar akun 4-40101 PROJECT INCOME yang
--   dikerjakan manual per bulan:
--     baris 1      : subtotal rumus (J1 = SUBTOTAL kolom Kredit) -- di atas header
--     baris 2      : HEADER (13 kolom): No | Tipe Transaksi Jurnal | Month | Tanggal |
--                    No Voucher | Kode Akun # | Nama Perkiraan | Keterangan Jurnal |
--                    Debit | Kredit | D/C | SUPPLIER/CUSTOMER | CATEGORY
--     baris 3-54   : data (52 baris)
--     baris 55-59  : kosong
--     baris 60-72  : tabel rekonsiliasi bulanan (Month, Amount GL, TB, Selsish;
--                    rumus SUMIF) -- kolom 'No'-nya KOSONG
--   Isinya TAHUN BERJALAN (06-01-2026 s/d 18-08-2026), bukan satu bulan: nama file
--   "202608" hanya bulan laporan. 1 baris = 1 voucher penerimaan bank (Tipe
--   Transaksi Jurnal: OCBC IDR 42 baris, OCBC CWU IDR 10 baris). Semua baris akun
--   4-40101 PROJECT INCOME, Kredit > 0, Debit 0, 52 No Voucher unik.
--
-- CARA APLIKASI MEMBACA UPLOAD UBD:
--   1. User upload file di Sales > Source Data dengan klien UBD aktif.
--   2. Backend mencari baris header file (di 15 baris pertama) yang hash-nya cocok
--      dengan column_signature_hash varian.
--   3. Resep "flat_grouped_by_key" menjumlah baris per No Voucher -> 1 baris
--      source_rows = 1 voucher.
--   4. Hasil ekstraksi: invoice = No Voucher (file TIDAK punya nomor invoice/
--      faktur), tanggal = Tanggal, customer = SUPPLIER/CUSTOMER (kosong ->
--      "Project Income"), cabang = Nama Perkiraan ("PROJECT INCOME"), dpp = Kredit -
--      Debit, ppn = 0, total = dpp.
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke file contoh):
--   52 invoice, semuanya valid, tanpa nomor ganda, tanggal 06-01-2026 s/d 18-08-2026
--   DPP 5.040.866.328,00 + PPN 0,00 = TOTAL 5.040.866.328,00
--   = J1 = baris total tabel rekonsiliasi (selisih 0). Per bulan Jan-Agu juga sama:
--   532.626.987 | 307.847.200 | 444.976.416 | 370.290.085 | 789.394.020 |
--   1.485.719.614 | 576.093.636 | 533.918.370.
--
-- ANTISIPASI PERBEDAAN ISI FILE (semua diuji dengan parser asli ke file contoh
-- yang dimodifikasi):
--   * Baris kop di atas header bertambah -> header dicari di 15 baris pertama
--     (header_cari_dalam_baris); posisi data ikut bergeser.
--   * Tabel rekonsiliasi di bawah data (posisi/jaraknya berubah, atau dihapus) ->
--     dilewati lewat abaikan_baris_tanpa_penanda = "No": baris yang kolom 'No'-nya
--     kosong DAN tanggalnya tidak terbaca bukan data. Tidak bergantung pada jumlah
--     baris kosong. Baris kosong dan baris ringkasan polos juga dilewati.
--   * Kolom ditambah, diacak urutannya, atau kolom opsional hilang (No, Debit,
--     SUPPLIER/CUSTOMER, Nama Perkiraan, Keterangan Jurnal) -> hash persis tidak
--     cocok, tapi cadangan "cocok_jika_kolom_ada" (No Voucher, Tanggal, Kredit) tetap
--     cocok; kolom dicari lewat NAMA. Kolom opsional yang hilang dianggap kosong/0.
--   * Sheet diganti nama -> dicari di semua sheet lewat header (cari_di_semua_sheet).
--   * Tanggal sebagai sel tanggal Excel ATAU teks (DD/MM/YYYY, YYYY-MM-DD, dst).
--   * Customer kosong -> "Project Income".
--   * Koreksi/retur di sisi Debit -> dpp = Kredit - Debit, jadi voucher itu menjadi
--     invoice NEGATIF dan mengurangi pendapatan (dpp_kurang_columns). Saat ini
--     Debit selalu 0.
--   * Akun lain di Nama Perkiraan (mis. SALES INCOME) -> cabang terisi nama akun itu,
--     dan pendapatan_account_by_cabang memilih 4-40102.
--   * No Voucher yang sama dipakai transaksi BEDA (tanggal/customer beda) di 1 file ->
--     tidak digabung: yang kedua disimpan sebagai "<no>-2" dan keduanya ditandai
--     duplikat + catatan (key_ganda_pisah).
--   * Keterangan Jurnal memuat kata "RETUR" -> baris tetap diekstrak, hanya diberi
--     catatan peringatan di validation_notes (peringatan_teks_mengandung).
--   * Kolom wajib diganti nama/hilang (mis. "Kredit" -> "Credit", atau No Voucher/
--     Tanggal hilang) -> TIDAK dicocokkan, file masuk "Butuh Review" (aman, tidak
--     diekstrak salah). Perlu varian baru di seed ini.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * FILE BERISI TAHUN BERJALAN. Upload bulan berikutnya mengekstrak ulang semua
--     bulan sebelumnya. Saat "Buat Invoice", nomor voucher yang sudah pernah
--     dibuat otomatis DILEWATI (dilewati_invoice_no_bentrok), jadi tidak dobel --
--     hanya voucher baru yang menjadi invoice. Total source_files dan jumlah
--     baris mentah tetap menghitung semua bulan.
--   * 2 voucher RETUR di file contoh (OCBC CWU IDR-2026-6-61 dan -6-65, masing-
--     masing Rp 500.000.000, customer "OWNER EXPENSES", keterangan "RETUR TRN ...
--     BenefName Not Match") = transfer yang dikembalikan bank, tapi tercatat sebagai
--     PROJECT INCOME (total Rp 1.000.000.000, sekitar 20 persen dari total tahun
--     berjalan). Keduanya tetap diekstrak dan diberi peringatan -- mohon dicek
--     apakah memang pendapatan atau salah catat.
--   * Nama customer di kolom SUPPLIER/CUSTOMER tidak konsisten (mis. "INDONESIA
--     ADVENTURE SPORTS" dan "INDONESIA ADVENTURE", "DEVELOPMENT PT", "GROUP/UBD",
--     "PROJECT INCOME", "OWNER EXPENSES"). Dipakai apa adanya; tidak ada
--     normalisasi nama.
--   * Baris dengan No Voucher persis sama dan data persis sama (mis. baris tersalin
--     dua kali) DIGABUNG dan nilainya terjumlah dua kali -- resep tidak bisa
--     membedakannya dari voucher berbaris-banyak. Cek No Voucher ganda di sumbernya.
--   * Tidak ada kolom pajak, jadi ppn = 0 dan seluruh Kredit masuk dpp. Kalau jasa
--     desain UBD ternyata dikenai PPN yang ditagihkan terpisah, resep ini perlu diubah.
--   * Kolom Tipe Transaksi Jurnal (rekening bank) tidak dijadikan cabang/akun.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level
-- atas baris ini; semua akun ada di sheet "COA UBD" COA_Clients_GOUF.xlsx). INI
-- ASUMSI -- mohon dikonfirmasi:
--   Dr Piutang      1-10102 ACCOUNT RECEIVABLE
--   Cr Pendapatan   4-40101 PROJECT INCOME (PROJECT INCOME) / 4-40102 SALES INCOME
--                   (bila Nama Perkiraan = SALES INCOME) lewat pendapatan_account_by_cabang
--   PPN             tidak diisi (COA UBD tidak punya akun PPN keluaran; ppn = 0)
-- Catatan: (a) COA punya akun pendapatan per proyek (4-40103 s/d 4-40141) yang tidak
-- dipakai otomatis; ubah per invoice di Journal Preview. (b) Penerimaan sudah masuk
-- bank, tapi alur Sales tetap Dr Piutang; pelunasannya lewat Cash & Bank. (c)
-- Settings > Account Mapping klien, kalau diisi, tetap didahulukan untuk piutang dan
-- PPN. Tanpa akun di COA klien, posting ditolak. NB: seed_coa_ubd.sql BELUM ada di
-- repo (generate_seed_coa.py baru memuat SAU, NPI, NBM) -- pastikan COA UBD sudah
-- masuk management_client_coa sebelum posting.
--
-- column_signature_hash level baris = SHA-256 dari hash varian (1 varian ->
-- SHA-256("<hash_excel>"); pola seed NBM/NPI):
--   hash_excel = e6e141eab5843c7a8c00e0df38899e30cfb578100b4bbeb4223158c2dafc8d7f
--   -> 35764608fa5d16c8b6682e418a80bc3362e0c820bdea1aa0d9a6592ba2abee75
-- Nilai level baris (header_row_index, data_start_row_index, header_columns)
-- hanya pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan
-- adalah nilai di dalam tiap varian.
--
-- KLIEN: dicari lewat client_code = 'UBD' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_ubd_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok
-- DO, baris Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash
-- versi lamanya (v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan
--               isi seed ini, is_active = true, deleted_at dikosongkan. id,
--               usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Konsekuensi: menjalankan ulang seed ini MENIMPA resep baris itu dengan isi file
-- ini (termasuk perubahan manual lewat UPDATE).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini (bukan baris yang
-- di-upgrade) yang memuat varian Excel dengan header yang sama, seed berhenti
-- dengan pesan jelas supaya tidak ada 2 template aktif:
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi nanti: tambahkan 1 objek lagi di array "variants", hitung
-- ulang hash level baris = SHA-256("<hash_excel>:<hash_baru>") (urutan = urutan
-- array), isi v_hash_baru dengan hash itu dan PINDAHKAN hash baris yang lama ke
-- v_hash_lama di blok DO, lalu jalankan ulang file ini.
--
-- OPSI RESEP BARU di sales_import_v1.py (_parse_flat_grouped_by_key; opsional,
-- resep lain tidak berubah perilakunya): dpp_kurang_columns,
-- abaikan_baris_tanpa_penanda, peringatan_teks_mengandung (selain kolom_opsional,
-- invoice_key_cadangan, peringatan_nilai_kolom dari seed NPI) -- lihat docstring
-- fungsi itu.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi
-- ORM (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_nama        TEXT;
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<hash_excel>"). Belum ada versi lama.
    v_hash_baru   CONSTANT TEXT := '35764608fa5d16c8b6682e418a80bc3362e0c820bdea1aa0d9a6592ba2abee75';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien UBD untuk laporan penjualan/pendapatan. Varian Excel: workbook 'Monitoring Project Income' (jurnal pendapatan proyek akun 4-40101 dari buku besar, tahun berjalan), 1 No Voucher = 1 invoice. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok (lihat _template_dari_varian di sales_import_v1.py). Format lain nanti ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Monitoring Project Income",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "e6e141eab5843c7a8c00e0df38899e30cfb578100b4bbeb4223158c2dafc8d7f",
      "header_columns": [
        "No",
        "Tipe Transaksi Jurnal",
        "Month",
        "Tanggal",
        "No Voucher",
        "Kode Akun #",
        "Nama Perkiraan",
        "Keterangan Jurnal",
        "Debit",
        "Kredit",
        "D/C",
        "SUPPLIER/CUSTOMER",
        "CATEGORY"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_by_key",
        "description": "Workbook 'Monitoring Project Income' UBD -- jurnal pendapatan proyek yang diekspor dari buku besar (akun 4-40101 PROJECT INCOME), tahun berjalan (Januari s/d bulan laporan, bukan 1 bulan saja). Bukan laporan invoice: 1 baris = 1 voucher penerimaan bank (OCBC IDR / OCBC CWU IDR) dan tidak ada nomor invoice/faktur, jadi No Voucher dipakai sebagai nomor invoice. 1 baris kanonis (source_rows) = 1 No Voucher; dpp = Kredit - Debit, tanpa PPN (file tidak punya kolom pajak). Kolom dicari lewat NAMA di baris header, bukan posisi. Baris subtotal di atas header dan tabel rekonsiliasi bulanan (Month / Amount GL / TB / Selisih) di bawah data dilewati.",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "invoice_key": "No Voucher",
        "tanggal": "Tanggal",
        "customer": "SUPPLIER/CUSTOMER",
        "customer_fallback": "Project Income",
        "cabang": "Nama Perkiraan",
        "dpp_columns": [
          "Kredit"
        ],
        "dpp_kurang_columns": [
          "Debit"
        ],
        "ppn_columns": [],
        "abaikan_baris_ringkasan": true,
        "key_ganda_pisah": true,
        "abaikan_baris_tanpa_penanda": "No",
        "kolom_opsional": [
          "No",
          "Debit",
          "SUPPLIER/CUSTOMER",
          "Nama Perkiraan",
          "Keterangan Jurnal"
        ],
        "peringatan_teks_mengandung": {
          "Keterangan Jurnal": [
            "retur"
          ]
        },
        "signature_abaikan_kolom_kosong_di_ujung": true,
        "header_cari_dalam_baris": 15,
        "cocok_jika_kolom_ada": [
          "No Voucher",
          "Tanggal",
          "Kredit"
        ],
        "cari_di_semua_sheet": true,
        "field_mapping": {
          "tanggal": "Tanggal (sel tanggal Excel atau teks DD/MM/YYYY)",
          "invoice": "No Voucher (mis. OCBC IDR-2026-8-14)",
          "customer": "SUPPLIER/CUSTOMER (kosong -> 'Project Income')",
          "cabang": "Nama Perkiraan (nama akun pendapatan: PROJECT INCOME) -- dipakai memilih akun pendapatan via pendapatan_account_by_cabang",
          "dpp": "Kredit - Debit per No Voucher",
          "ppn": "0 (tidak ada kolom pajak)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_voucher",
        "catatan_analisis": "Dianalisis dari 1 file contoh (UBD_monitoring_project_income_202608_roy.xlsx): sheet 'Monitoring Project Income', A1:M72. Baris 1 = subtotal rumus (J1 = SUBTOTAL kolom Kredit), HEADER baris 2 (13 kolom), data baris 3-54, baris 55-59 kosong, baris 60-72 = tabel rekonsiliasi bulanan (Month, Amount GL, TB, Selsish; rumus SUMIF) yang kolom 'No'-nya kosong. 52 baris data = 52 No Voucher unik, semuanya akun 4-40101 PROJECT INCOME, tanggal 06-01-2026 s/d 18-08-2026 (tahun berjalan, BUKAN 1 bulan), Month selalu sama dengan bulan Tanggal. Tipe Transaksi Jurnal: OCBC IDR (42 baris) dan OCBC CWU IDR (10 baris). Debit selalu 0, D/C = Debit - Kredit, Kredit selalu > 0. Tidak ada kolom pajak. Total Kredit 5.040.866.328 = J1 = baris total tabel rekonsiliasi (selisih 0)."
      }
    }
  ],
  "piutang_account": {
    "account_code": "1-10102",
    "account_name": "ACCOUNT RECEIVABLE"
  },
  "pendapatan_account": {
    "account_code": "4-40101",
    "account_name": "PROJECT INCOME"
  },
  "pendapatan_account_by_cabang": {
    "PROJECT INCOME": {
      "account_code": "4-40101",
      "account_name": "PROJECT INCOME"
    },
    "SALES INCOME": {
      "account_code": "4-40102",
      "account_name": "SALES INCOME"
    }
  },
  "catatan_akun": "Akun default dipilih dari sheet 'COA UBD' (COA_Clients_GOUF.xlsx); ASUMSI, bisa diubah per invoice di Journal Preview atau lewat Settings > Account Mapping (yang diutamakan untuk piutang/PPN). Pendapatan mengikuti 'Nama Perkiraan' di file (cabang = nama akun, pola sama dengan MM): PROJECT INCOME -> 4-40101, SALES INCOME -> 4-40102. COA juga punya akun pendapatan per proyek (4-40103 Polyland, 4-40104 Karang Mas, 4-40109 Indonesia Adventure Sport, 4-40110 Daniel Tanoni, dst) yang TIDAK dipakai otomatis karena file selalu mencatat ke 4-40101; ubah per invoice kalau perlu. Tidak ada akun PPN keluaran di COA UBD (2-20201 TAX PAYABLE adalah pajak penghasilan) dan file tidak punya pajak, jadi ppn_account sengaja tidak diisi; isi lewat Settings > Account Mapping kalau suatu saat ada PPN. Penerimaan sudah masuk bank (OCBC IDR / OCBC CWU IDR), tetapi jurnal Sales tetap Dr Piutang (1-10102) -> Cr Pendapatan; pelunasan piutang lewat modul Cash & Bank. Rekening bank (1-10002, 1-10005, 1-10009 untuk 'OCBC IDR'; 1-10011 untuk 'OCBC CWU IDR') tidak dipetakan otomatis karena nama di file tidak menyebut nomor rekening."
}$json$::jsonb;
BEGIN
    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'UBD'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien UBD belum ada di management_clients (dicari client_code = ''UBD''). Buat dulu lewat halaman Clients, lalu jalankan ulang.';
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'e6e141eab5843c7a8c00e0df38899e30cfb578100b4bbeb4223158c2dafc8d7f'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien UBD sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
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
        RAISE NOTICE 'Template Multi UBD dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi UBD sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(m.client_code) = 'UBD';