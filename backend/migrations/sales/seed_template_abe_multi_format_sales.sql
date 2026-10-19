-- seed_template_abe_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien ABE. SATU baris setting ("Multi") untuk halaman Transactions > Sales >
-- Source Data, dengan SATU varian Excel yang membaca SEMUA sheet catatan
-- penjualan dalam satu upload.
--
-- STATUS: hanya varian Excel (SELLING_<BULAN>.xlsx). Varian lain nanti cukup
-- ditambahkan ke array "variants" (lihat "Menambah varian / sheet baru").
--
-- PENTING -- BENTUK FILE ABE BEDA DARI NBM/SAU/AADL:
--   Bukan laporan invoice dari software, melainkan CATATAN PENJUALAN MANUAL:
--   1 workbook, 10 sheet (1 sheet per jalur/pelanggan), kolom tiap sheet
--   berbeda, TIDAK ada nomor invoice, kolom pajak, maupun kolom cabang, dan
--   tanggal hanya diisi di baris pertama tiap kelompok. Karena itu dipakai
--   format_type BARU "multi_sheet_line_items" di sales_import_v1.py (bagian 3c).
--
-- SUMBER (dataset/template_laporan/ABE/SELLING_JULI.xlsx, periode Juli 2026):
--   Sheet              header  data  prefix     isi (baris bernilai, jumlah Rp)
--   Consigment           1      2    ABE-CSG    EL MERKAT titipan             1.257.500
--   Bintang              1      2    ABE-BTG    harga KOSONG -> dilewati              0
--   Supermarket          2      3    ABE-SMK    PEPITO, GOURMET, FRESH MARKET 39.680.184
--   Permonth             1      2    ABE-PRM    wholesale/hotel (hanya Juli)  27.563.300
--   cash                 1      2    ABE-CSH    tunai/langganan               73.344.500
--   alfajores cafe       1      2    ABE-ALF    kafe sendiri                  40.834.695
--   GRANDLUCKY           1      2    ABE-GLK    SUNSET, GRANDLUCKY             1.160.350
--   COCO                 2      3    ABE-COCO   UBUD, BEACHWALK, LABUAN SAIT   9.033.536
--   Retur supermarket    1      2    ABE-RTR    retur (NEGATIF)               -1.092.555
--   Tukar Guling         1      2    (abaikan)  subset sheet Retur
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. User upload file di Sales > Source Data dengan klien ABE aktif.
--   2. Backend memeriksa tiap sheet terdaftar (mapping_rules.sheets): cocok kalau
--      NAMA sheet ada dan hash header-nya (signature, dari signature_kolom kolom
--      pertama saja -- kolom "Column1..N" bawaan tabel Excel tidak ikut) sama.
--      Cukup SATU sheet yang cocok; sheet lain yang hilang dilewati begitu saja
--      (file bulan lain boleh tidak memuat semua sheet).
--   3. Tiap sheet dibaca sendiri: header diverifikasi lagi (berubah -> sheet itu
--      TIDAK diimpor dan muncul 1 baris invalid), tanggal dibawa ke baris di
--      bawahnya yang kosong, baris tersembunyi (hasil filter) dan baris bernilai
--      0 dilewati, lalu baris dijumlah per (tanggal, pelanggan) -> 1 invoice.
--   4. Hasil: invoice = <prefix>-YYYYMMDD-<PELANGGAN> (mis. ABE-SMK-20260701-
--      PEPITO-BUWIT), customer = isi kolom pelanggan, cabang = kosong (kecuali
--      sheet "alfajores cafe"), dpp = SUM(TOTAL), ppn = 0, total = dpp.
--   5. Sheet di luar daftar (mis. sheet pelanggan baru) TIDAK hilang diam-diam:
--      muncul 1 baris invalid "Sheet '<nama>' tidak dikenal" -> status Butuh Review.
--
-- ATURAN DATA YANG DITANGANI (penting, jangan diubah sembarangan):
--   * TANGGAL TERTUKAR: sel bertipe tanggal berisi hari<->bulan yang TERTUKAR
--     (user mengetik "02/07/2026" = 2 Juli, Excel membaca 7 Februari). Resep
--     tanggal_tukar_hari_bulan = true menukarnya kembali (hanya bila hasilnya valid;
--     di file contoh SEMUA 2026-xx-07 menjadi 2026-07-xx). Sel teks "22/7/2026"
--     (DD/MM) dan "07/31/2026" (MM/DD) dikenali otomatis dari bagian yang > 12.
--     Teks dengan kedua bagian <= 12 dan berbeda (mis. "05/06/2026") AMBIGU ->
--     baris invalid, TIDAK ditebak.
--   * TANGGAL KOSONG = ikut tanggal baris di atasnya.
--   * Permonth berisi 186 baris Maret 2025 yang DISEMBUNYIKAN filter Excel; resep
--     lewati_baris_tersembunyi = true membuangnya. Kalau filter Permonth dibuka
--     (semua baris tampil), data lama itu IKUT terimpor -- jaga filternya.
--   * Sel TOTAL kosong (file disimpan tanpa Excel, rumus belum terhitung) ->
--     dihitung QTY x PRICE.
--   * RETUR bertanda negatif: invoice bernilai NEGATIF (mengurangi penjualan).
--   * TUKAR GULING dinonaktifkan ("abaikan": true) karena 5 dari 6 barisnya sudah
--     ada di sheet Retur; hitung ulang kalau ternyata berbeda makna.
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke SELLING_JULI.xlsx):
--   225 invoice, semuanya valid, tanpa nomor ganda, tanggal 01-07-2026 s/d
--   31-07-2026; DPP = TOTAL = 191.781.510,00 (PPN 0). Cocok dengan hitungan
--   terpisah memakai Decimal per (sheet, tanggal, pelanggan): 0 selisih.
--   Uji tambahan: sheet baru -> peringatan; header sheet berubah -> sheet itu
--   dilewati + peringatan; tanggal ambigu -> invalid; file tanpa rumus
--   terhitung -> total sama; file tak terkait -> tidak cocok (Butuh Review).
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * Baris yang punya QTY tapi harga/total kosong (seluruh sheet Bintang, 1 baris
--     "WHITE CHOCO" di alfajores cafe) tidak dibuat invoice (nilai 0) dan TIDAK
--     ada peringatan -- isi harganya bila memang penjualan.
--   * Nama pelanggan dipakai apa adanya ("MERKAT" dan "EL MERKAT" di Permonth
--     terbaca 2 pelanggan; "SUNSET" di GRANDLUCKY tanpa awalan).
--   * 1 pelanggan yang dikirim 2x di tanggal yang sama pada sheet yang sama
--     digabung jadi 1 invoice (file tidak punya nomor invoice untuk membedakan).
--   * ppn = 0: file tidak memuat pajak. Kalau harga ternyata sudah/akan ditambah
--     PPN/PB1, resep perlu diubah.
--   * Kolom/sheet lain di file (Column1..N, 'v', RECAPITULATION, subtotal baris 1)
--     diabaikan.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari level atas baris ini;
-- akun ada di sheet "COA ABE", COA_Clients_GOUF.xlsx). INI ASUMSI -- mohon dikonfirmasi:
--   Dr Piutang      1-201 Accounts Receivable
--   Cr Pendapatan   4-000 Sales - Factory   (semua sheet kecuali kafe)
--                   4-001 Sales - Restaurant (cabang ALFAJORES CAFE, lewat
--                   pendapatan_account_by_cabang; kunci HURUF BESAR semua)
--   Cr Pajak        2-400 Tax Payable (pengisi; ppn selalu 0)
-- Settings > Account Mapping klien, kalau diisi, tetap didahulukan untuk piutang
-- dan pajak. Tanpa akun di COA klien, posting ditolak. Invoice retur negatif
-- menghasilkan jurnal berbalik tanda -- periksa di Journal Preview.
--
-- column_signature_hash:
--   varian  = SHA-256("<hash sheet 1>:...:<hash sheet 10>") urut seperti array "sheets"
--   d9d5681b6cfa85814275fb67a922cd8f1b2ee7055970e961c6f93d650f4bf001
--   baris   = SHA-256(hash varian)   (1 varian saja)
--   77435830b5c7cb3b7d7146f355716a002db5b6ea9af04b24ab5dc066cb850d45
-- Nilai header_row_index / data_start_row_index / header_columns level baris dan
-- level varian hanya pengisi kolom NOT NULL; yang dipakai pencocokan adalah
-- signature per sheet di dalam mapping_rules.sheets.
--
-- KLIEN: dicari lewat client_code = 'ABE' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_abe_multi_format_sales.sql
--
-- Idempotensi: AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- seed ini (v_hash_baru) atau hash versi lamanya (v_hash_lama), termasuk yang
-- soft-delete: ketemu -> UPDATE di tempat (id, usage_count, created_at, riwayat file
-- tetap; resep DITIMPA isi file ini), tidak -> INSERT. Pengaman: kalau ada baris Multi
-- AKTIF lain milik klien ini dengan varian Excel berhash sama, seed berhenti dengan
-- pesan jelas (soft-delete baris yang tidak dipakai: UPDATE ... SET is_active = false,
-- deleted_at = now(), edited_at = now() WHERE id = '<id>').
--
-- Menambah varian / sheet baru nanti:
--   * Sheet baru di workbook yang sama: tambahkan 1 objek di variants[0].mapping_rules.
--     sheets (sheet_name, header_row_index, data_start_row_index, signature_kolom,
--     signature = hash baris header, prefix_invoice, columns 1-based {tanggal, client,
--     qty, harga, jumlah}). Hash varian & baris dihitung ulang: pindahkan hash baris
--     lama ke v_hash_lama, isi v_hash_baru dengan yang baru, jalankan ulang seed.
--   * Format file lain (CSV/PDF): tambah objek varian baru di array "variants".
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    v_hash_baru   CONSTANT TEXT := '77435830b5c7cb3b7d7146f355716a002db5b6ea9af04b24ab5dc066cb850d45';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien ABE untuk catatan penjualan manual (SELLING_<BULAN>.xlsx). SATU varian Excel membaca SEMUA sheet terdaftar dalam satu upload: tiap sheet punya posisi header, kolom, prefix nomor invoice, dan aturan sendiri (lihat variants[0].mapping_rules.sheets). 1 baris source_rows = 1 invoice = 1 (sheet, tanggal, pelanggan).",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "d9d5681b6cfa85814275fb67a922cd8f1b2ee7055970e961c6f93d650f4bf001",
      "header_columns": [
        "(per sheet -- lihat mapping_rules.sheets[].signature)"
      ],
      "mapping_rules": {
        "format_type": "multi_sheet_line_items",
        "description": "Catatan penjualan manual ABE, 1 workbook = banyak sheet. 1 baris sheet = 1 item; tanggal hanya di baris pertama tiap kelompok (baris kosong di bawahnya ikut tanggal di atas); baris tersembunyi (hasil filter) dan baris bernilai 0 dilewati; baris dijumlah per (tanggal, pelanggan) -> 1 invoice. Nomor invoice dibentuk <prefix_invoice>-YYYYMMDD-<PELANGGAN> karena file tidak punya nomor invoice. ppn = 0 (file tidak punya pajak).",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tanggal_tukar_hari_bulan": true,
        "lewati_baris_tersembunyi": true,
        "peringatan_sheet_tak_dikenal": true,
        "sheet_abaikan": [],
        "field_mapping": {
          "tanggal": "kolom tanggal per sheet; sel bertipe tanggal DITUKAR hari<->bulan (salah baca Excel), teks 'DD/MM/YYYY' atau 'MM/DD/YYYY' dikenali otomatis, ambigu -> invalid",
          "invoice": "<prefix_invoice>-YYYYMMDD-<slug pelanggan> (dibentuk, bukan dari file)",
          "customer": "kolom pelanggan sheet (customer_tetap / customer_prefix bila ada)",
          "cabang": "kosong, kecuali sheet 'alfajores cafe' = ALFAJORES CAFE",
          "dpp": "SUM(TOTAL) per (tanggal, pelanggan); kalau sel TOTAL kosong = QTY x PRICE; sheet Retur bertanda negatif",
          "ppn": "0 (tidak ada kolom pajak)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_tanggal_pelanggan",
        "sheets": [
          {
            "sheet_name": "Consigment",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 7,
            "signature": "f8cfaf3e6dc5c513dba61442f3247c0b12f2c827ed5b5ced9b45ab98048fd7cc",
            "prefix_invoice": "ABE-CSG",
            "columns": {
              "tanggal": 2,
              "client": 3,
              "qty": 5,
              "harga": 6,
              "jumlah": 7
            },
            "catatan": "Titipan/konsinyasi (EL MERKAT). Kolom: NO, DATE, CLIENT, DESCRIPTION, QTY, PRICE, TOTAL."
          },
          {
            "sheet_name": "Bintang",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 7,
            "signature": "f8cfaf3e6dc5c513dba61442f3247c0b12f2c827ed5b5ced9b45ab98048fd7cc",
            "prefix_invoice": "ABE-BTG",
            "columns": {
              "tanggal": 2,
              "client": 3,
              "qty": 5,
              "harga": 6,
              "jumlah": 7
            },
            "catatan": "Pengiriman BINTANG SEMINYAK/UBUD. Di file contoh PRICE/TOTAL KOSONG semua -> baris dilewati (total 0) sampai harga diisi."
          },
          {
            "sheet_name": "Supermarket",
            "header_row_index": 2,
            "data_start_row_index": 3,
            "signature_kolom": 7,
            "signature": "24a0ee58c2c6648e09c1443ec5ba1a7c982d1e8e5590907c8069619f3ed8e840",
            "prefix_invoice": "ABE-SMK",
            "columns": {
              "tanggal": 2,
              "client": 3,
              "qty": 5,
              "harga": 6,
              "jumlah": 7
            },
            "catatan": "Supermarket (PEPITO, GOURMET, FRESH MARKET). Baris 1 = subtotal filter, header baris 2, kolom 'name' = pelanggan."
          },
          {
            "sheet_name": "Permonth",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 7,
            "signature": "f8cfaf3e6dc5c513dba61442f3247c0b12f2c827ed5b5ced9b45ab98048fd7cc",
            "prefix_invoice": "ABE-PRM",
            "columns": {
              "tanggal": 2,
              "client": 3,
              "qty": 5,
              "harga": 6,
              "jumlah": 7
            },
            "catatan": "Rekap penjualan wholesale/hotel (EL MERKAT, BGS, ALIVE, dst). Berisi data Maret 2025 yang DISEMBUNYIKAN filter -> dilewati lewat lewati_baris_tersembunyi."
          },
          {
            "sheet_name": "cash",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 7,
            "signature": "f8cfaf3e6dc5c513dba61442f3247c0b12f2c827ed5b5ced9b45ab98048fd7cc",
            "prefix_invoice": "ABE-CSH",
            "columns": {
              "tanggal": 2,
              "client": 3,
              "qty": 5,
              "harga": 6,
              "jumlah": 7
            },
            "catatan": "Penjualan tunai/langganan (MUSHROOM, LA BAMBA, VILLA AMANTES, WALK IN, dst)."
          },
          {
            "sheet_name": "alfajores cafe",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 5,
            "signature": "2cadd882ea34c9548d8fa8350e756107ab5ffb0ad9284bbce3c49343d84f6426",
            "prefix_invoice": "ABE-ALF",
            "columns": {
              "tanggal": 2,
              "qty": 4,
              "harga": 5,
              "jumlah": 6
            },
            "customer_tetap": "ALFAJORES CAFE",
            "cabang_tetap": "ALFAJORES CAFE",
            "catatan": "Kafe sendiri: TIDAK ada kolom pelanggan -> customer tetap, cabang tetap (akun 4-001 Sales - Restaurant). Kolom RECAPITULATION di kolom I diabaikan."
          },
          {
            "sheet_name": "GRANDLUCKY",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 6,
            "signature": "ef55db1af1e1786330724426727e2a2569ee5a6c13a316a9b037de228a5ae273",
            "prefix_invoice": "ABE-GLK",
            "columns": {
              "tanggal": 1,
              "client": 2,
              "qty": 4,
              "harga": 5,
              "jumlah": 6
            },
            "catatan": "Grand Lucky (outlet SUNSET dan GRANDLUCKY). Header baris 1, kolom tanggal di kolom A."
          },
          {
            "sheet_name": "COCO",
            "header_row_index": 2,
            "data_start_row_index": 3,
            "signature_kolom": 6,
            "signature": "5c170c33252277751a81919dcb60cad5e277bdb73c708314631fa1d997433247",
            "prefix_invoice": "ABE-COCO",
            "columns": {
              "tanggal": 1,
              "client": 2,
              "qty": 4,
              "harga": 5,
              "jumlah": 6
            },
            "customer_prefix": "COCO",
            "catatan": "COCO (outlet UBUD, BEACHWALK, LABUAN SAIT) -> nama customer diberi awalan 'COCO'. Baris 1 = subtotal filter, header baris 2."
          },
          {
            "sheet_name": "Retur supermarket",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 6,
            "signature": "2a84ce4275719d0d30cdc53d38cfda2c9a802d02a85f6263c15d60ac20c02970",
            "prefix_invoice": "ABE-RTR",
            "columns": {
              "tanggal": 6,
              "client": 1,
              "qty": 3,
              "harga": 4,
              "jumlah": 5
            },
            "tanda": "negatif",
            "catatan": "RETUR supermarket -> invoice NEGATIF (mengurangi penjualan). Tanggal ada di kolom F (TGL RETUR)."
          },
          {
            "sheet_name": "Tukar Guling",
            "header_row_index": 1,
            "data_start_row_index": 2,
            "signature_kolom": 6,
            "signature": "2a84ce4275719d0d30cdc53d38cfda2c9a802d02a85f6263c15d60ac20c02970",
            "prefix_invoice": "ABE-TKG",
            "columns": {
              "tanggal": 6,
              "client": 1,
              "qty": 3,
              "harga": 4,
              "jumlah": 5
            },
            "abaikan": true,
            "catatan": "Tukar guling: 5 dari 6 baris SUDAH ADA di sheet Retur -> dinonaktifkan (abaikan) supaya tidak terhitung dobel."
          }
        ]
      }
    }
  ],
  "piutang_account": {
    "account_code": "1-201",
    "account_name": "Accounts Receivable"
  },
  "pendapatan_account": {
    "account_code": "4-000",
    "account_name": "Sales - Factory"
  },
  "pendapatan_account_by_cabang": {
    "ALFAJORES CAFE": {
      "account_code": "4-001",
      "account_name": "Sales - Restaurant"
    }
  },
  "ppn_account": {
    "account_code": "2-400",
    "account_name": "Tax Payable"
  },
  "catatan_akun": "Akun default dari COA ABE (sheet 'COA ABE' di COA_Clients_GOUF.xlsx); ASUMSI, ubah per invoice di Journal Preview atau lewat Settings > Account Mapping. Penjualan pabrik/wholesale/supermarket/retur -> 4-000 Sales - Factory; sheet 'alfajores cafe' (cabang ALFAJORES CAFE) -> 4-001 Sales - Restaurant. File tidak memuat pajak (ppn = 0), akun pajak 2-400 hanya pengisi."
}$json$::jsonb;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'ABE'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien ABE belum ada di management_clients (dicari client_code = ''ABE''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'd9d5681b6cfa85814275fb67a922cd8f1b2ee7055970e961c6f93d650f4bf001'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien ABE sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_sales_import_templates (
            client_id, client_code, file_type, header_row_index, data_start_row_index,
            column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, 'Multi', 1, 2,
            v_hash_baru, '[]'::jsonb, v_rules, 'manual', true, 0
        );
        RAISE NOTICE 'Template Multi ABE dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi ABE sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        jsonb_array_length(t.mapping_rules->'variants'->0->'mapping_rules'->'sheets') AS jumlah_sheet
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'ABE';