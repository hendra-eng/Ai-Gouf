-- seed_template_birawa_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk klien BIRAWA / BRW
-- (PT BINA RANCANG WASESA), halaman Transactions > Purchase > Source Data > Upload File.
-- SATU baris setting ("Multi"). Mengikuti pola seed_template_nbm_multi_format_purchase.sql
-- (nama file = periode, hash header dipangkas, idempotensi) dan seed UBD (akun dari file).
--
-- STATUS: baru varian EXCEL (BRW_Purchase_May_2026.xlsx, Sheet1). Varian lain (CSV/PDF) nanti cukup
-- ditambahkan ke array "variants" (lihat "Menambah varian").
--
-- SUMBER: BRW_Purchase_May_2026.xlsx -- 1 sheet ("Sheet1"), 92 baris fisik, 90 baris data.
--   Header di baris 2 (baris 1 KOSONG), data mulai baris 3. Kolom dipakai = 10 kolom pertama:
--   1 COA | 2 AKUN | 3 Bank | 4 MONTH | 5 Tanggal Transaksi | 6 Keterangan | 7 Debit | 8 Kredit |
--   9 Balance | 10 Voucher Bantu
--   Kolom K-Q (Summary, GL, TB, Selisih) = tabel rekap di sisi kanan, TIDAK dibaca (header_kolom [1,10]
--   -> hash hanya atas 10 kolom pertama, tidak terganggu isi kolom kanan).
--   Kolom 9 "Balance" = rumus (Debit - Kredit); nilainya terbaca dari cache Excel, tidak dipakai.
--   Bentuk file: DAFTAR BIAYA per akun (kode COA 511001, 701001, 740001, dst.), BUKAN laporan pembelian
--   per supplier: tidak ada kolom supplier/invoice/PPN/qty. Kolom Kredit selalu 0.
--
-- HASIL ANALISIS (parser purchase_import_v1.py dijalankan ke file contoh):
--   * 90 baris item -> 85 transaksi Purchase draft. Total Debit 790.872.509,15 (selisih 0,02 dari
--     penjumlahan mentah file = pembulatan desimal berulang di baris amortisasi sewa).
--   * Rekonsiliasi per bulan tanggal transaksi (transaksi / baris item / total):
--       2026-01 12 / 15 / 144.166.755,33    2026-02 16 / 18 / 131.264.689,33
--       2026-03 16 / 16 / 221.058.666,33    2026-04 18 / 18 / 133.501.668,83
--       2026-05 23 / 23 / 160.880.729,33
--     File BRW_Purchase_May_2026.xlsx (nama file = Mei 2026) -> hanya 23 transaksi / 160.880.729,33 diimpor.
--
-- CARA FILE DIBACA:
--   * Nomor transaksi = "Voucher Bantu" (spasi dibuang + huruf besar: "GL-Jan 26-007" -> GL-JAN26-007).
--   * Baris dengan voucher SAMA dan tanggal SAMA = 1 transaksi, 1 item per baris (mis. GL-0226-77: gaji
--     + BPJS Kesehatan + BPJS Tenaga Kerja Feb = 1 transaksi 3 item). Voucher yang dipakai di > 1 tanggal
--     dipecah per tanggal (kunci_pisah_tanggal): mis. GL-Jan 26-082 (biaya bank BPD Jogja 5/15/31 Jan)
--     -> GL-JAN26-082-20260105 / -20260115 / -20260131.
--   * 3 baris TANPA voucher (Depresiasi 30-Apr 612.812,50; Konsultan 31-Jan 5.102.041; Biaya Bank 28-Apr
--     13.839) TIDAK dibuang: nomornya BRW-NOVCR-<YYYYMMDD> (resep "nomor_cadangan_awalan", opsi baru
--     parser). Baris tanpa voucher di tanggal sama digabung jadi 1 transaksi.
--   * Akun item = kolom COA/AKUN file (akun_baris_dari_file). Qty 1, harga = Debit.
--   * Supplier tidak ada di file -> "BRW Expense Entry" (+ peringatan "Supplier is empty" di tiap
--     transaksi; wajar). Kolom "Bank" (Manual / Bank Permata 8993 / Bank BPD Jogja) masuk catatan transaksi.
--   * Baris Debit 0 dilewati. Tanggal wajib (tanggal_wajib true).
--
-- NAMA FILE = PERIODE (opsional, seperti NBM): resep memakai "filter_periode_nama_file": "jika_ada".
--   BRW_PURCHASE_202608.xlsx -> hanya transaksi bertanggal Agustus 2026 yang diimpor
--   BRW_PURCHASE_20260801-20260815.xlsx -> rentang tanggal; BRW_Purchase_May_2026.xlsx juga dikenali.
--   Nama file TANPA periode (mis. BRW_Purchase.xlsx) -> SEMUA transaksi di file diimpor.
--   Mau wajib periode (nama file tanpa periode ditolak): ganti "jika_ada" jadi true. Nomor transaksi unik
--   per klien: upload ulang bulan yang sama dilewati ("already imported").
--
-- PERLU DIPERHATIKAN:
--   1. KODE AKUN HARUS ADA di COA BRW (511001, 701001-701003, 707001, 708001, 713001, 718001, 722001,
--      724001, 728001, 736001, 738001, 740001, 821002). Seed Sales BRW mencatat COA BRW di database memakai
--      format "1-10020" dan banyak kode 6-digit tidak ada -- CEK dulu di halaman COA. Kalau kodenya beda,
--      ubah di file atau pindahkan ke peta akun.
--   2. Akun hutang (Cr) TIDAK diisi di resep: dipakai Settings > Account Mapping BRW (accounts payable).
--      Pastikan sudah diisi.
--   3. Baris "Manual" (accrual bunga/gaji/konsultan, amortisasi, penyusutan) bukan pembelian sungguhan, dan
--      baris bank sudah dibayar. Hasil import berstatus 'unpaid' (muncul sebagai hutang); jurnal yang SAMA
--      bisa juga masuk lewat Journal Entry / Bank Cash -- pilih satu jalur, jangan dobel.
--   4. Struktur HARUS tetap: nama 10 header sama persis (hash), header di baris 2, sheet "Sheet1".
--
-- SIGNATURE: pencocokan Excel memakai purchase_import_v1._cocokkan_template dengan "header_kolom" [1, 10]:
-- hash = SHA-256 baris header ke-2 kolom 1-10:
--   hash_excel = a0a098bcbaba45333ea2811833d5dd961e363f3df55c642382b16ee060cedef6
-- column_signature_hash level baris = SHA-256(hash_excel) (satu varian):
--   4495660b7ae844f707772fe5ece7260e533e27fa1df95d1ae53bd21e1796db68
-- Tiap varian ditambah/dihapus, hitung ulang (SHA-256("<hash1>:<hash2>")).
--
-- PRASYARAT KODE (purchase_import_v1.py): filter_periode_nama_file, abaikan_baris_total_nol,
-- kunci_pisah_tanggal, akun_baris_dari_file, dan nomor_cadangan_awalan (BARU, opsional; resep klien
-- lain tidak berubah). Prasyarat tabel: migration 15-create_purchase_import_templates.py.
--
-- KLIEN: dicari lewat client_code 'BRW' / 'BIRAWA' atau nama_client 'PT BINA RANCANG WASESA/WASISA';
-- GAGAL dengan pesan jelas kalau tidak ada atau >1 klien aktif cocok. client_id & client_code otomatis.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_birawa_multi_format_purchase.sql
--
-- Idempotensi / upgrade di tempat: AMAN dijalankan berkali-kali (pola seed NBM/UBD). Baris Multi klien dicari
-- lewat hash baris seed ini (v_hash_baru) atau versi lamanya (v_hash_lama), termasuk yang soft-delete ->
-- UPDATE resep di tempat (id, usage_count, riwayat file tetap); tidak ada -> INSERT. Menjalankan ulang MENIMPA
-- resep dengan isi file ini. Pengaman: ada baris Multi AKTIF lain milik klien dengan varian Excel header sama ->
-- seed berhenti dengan pesan jelas (nonaktifkan baris itu dulu:
--   UPDATE financial_transaction_purchase_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now() WHERE id = '<id>';).
-- Menambah varian: tambah objek di "variants", hitung ulang hash baris, pindahkan hash lama ke v_hash_lama.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_nama        TEXT;
    v_n           INTEGER;
    v_id          UUID;
    v_bentrok     INTEGER;
    v_hash_baru   CONSTANT TEXT := '4495660b7ae844f707772fe5ece7260e533e27fa1df95d1ae53bd21e1796db68';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien BRW (BIRAWA) untuk file pembelian/biaya. Saat ini varian Excel (BRW_Purchase_May_2026.xlsx, Sheet1); varian CSV/PDF ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep sendiri; backend memilih varian yang tipe file dan signature header-nya cocok.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "a0a098bcbaba45333ea2811833d5dd961e363f3df55c642382b16ee060cedef6",
      "header_columns": [
        "COA",
        "AKUN",
        "Bank",
        "MONTH",
        "Tanggal Transaksi",
        "Keterangan",
        "Debit",
        "Kredit",
        "Balance",
        "Voucher Bantu"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_purchase_report",
        "description": "Daftar biaya/pembelian BRW (BIRAWA) dari file BRW_Purchase_May_2026.xlsx -- tabel FLAT di Sheet1, header baris 2 (baris 1 kosong), data mulai baris 3. 1 baris = 1 item biaya; baris dengan Voucher Bantu (kolom J) sama dan tanggal sama = 1 transaksi Purchase draft (voucher yang dipakai di beberapa tanggal dipecah per tanggal). Akun tiap item dibaca dari kolom COA/AKUN file. Periode yang diambil mengikuti NAMA FILE bila ada (BRW_PURCHASE_YYYYMM). Kolom K-Q (tabel ringkasan GL/TB/Selisih di sisi kanan) tidak dibaca.",
        "source_kind": "excel_sheet",
        "sheet_name": "Sheet1",
        "date_format": "YYYY-MM-DD",
        "tanggal_wajib": true,
        "filter_periode_nama_file": "jika_ada",
        "header_kolom": [
          1,
          10
        ],
        "jatuh_tempo_hari": 30,
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "header_row_index": 2,
        "data_start_row_index": 3,
        "columns": {
          "akun_kode": 1,
          "akun_nama": 2,
          "note": 3,
          "tanggal": 5,
          "deskripsi": 6,
          "total": 7,
          "kredit": 8,
          "purchase_no": 10
        },
        "ignore_columns": {
          "4": "MONTH (nomor bulan), informasi -- periode dibaca dari Tanggal Transaksi",
          "9": "Balance (rumus Debit - Kredit), tidak dipakai",
          "11-17": "tabel ringkasan Summary/GL/TB/Selisih di kanan, bukan data transaksi"
        },
        "abaikan_baris_total_nol": true,
        "kunci_pisah_tanggal": true,
        "akun_baris_dari_file": true,
        "nomor_cadangan_awalan": "BRW-NOVCR",
        "validation": {
          "total_nota_toleransi": 1,
          "deskripsi_kosong_pengganti": "(tanpa keterangan)",
          "supplier_kosong_pengganti": "BRW Expense Entry"
        },
        "field_mapping": {
          "purchase_no": "columns.purchase_no (Voucher Bantu, dinormalisasi; kosong -> BRW-NOVCR-YYYYMMDD)",
          "purchase_date": "Tanggal Transaksi",
          "vendor_name": "tidak ada di file -> 'BRW Expense Entry'",
          "description": "Keterangan",
          "quantity": 1,
          "unit_price": "Debit",
          "total": "Debit",
          "discount": 0,
          "tax_amount": 0,
          "other_costs": 0
        },
        "currency_default": "IDR",
        "category_default": "Other",
        "row_granularity": "per_purchase_block"
      }
    }
  ]
}$json$::jsonb;
BEGIN
    SELECT count(*) INTO v_n
    FROM management_clients
    WHERE deleted_at IS NULL
      AND (upper(trim(client_code)) IN ('BRW', 'BIRAWA')
           OR upper(trim(nama_client)) IN ('PT BINA RANCANG WASESA', 'PT BINA RANCANG WASISA'));

    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND (upper(trim(client_code)) IN ('BRW', 'BIRAWA')
           OR upper(trim(nama_client)) IN ('PT BINA RANCANG WASESA', 'PT BINA RANCANG WASISA'))
    ORDER BY (upper(trim(client_code)) = 'BRW') DESC, (upper(trim(client_code)) = 'BIRAWA') DESC, created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien BRW/BIRAWA belum ada di management_clients (dicari client_code BRW/BIRAWA atau nama PT BINA RANCANG WASESA). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    IF v_n > 1 AND upper(trim(coalesce(v_client_code, ''))) NOT IN ('BRW', 'BIRAWA') THEN
        RAISE EXCEPTION 'Ada % klien aktif yang cocok dengan BRW/BIRAWA dan tidak satu pun ber-client_code BRW/BIRAWA; tentukan client_code-nya dulu.', v_n;
    END IF;
    RAISE NOTICE 'Klien terpilih: % (client_code %)', v_nama, v_client_code;

    SELECT t.id INTO v_id
    FROM financial_transaction_purchase_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    SELECT count(*) INTO v_bentrok
    FROM financial_transaction_purchase_import_templates t
    WHERE t.client_id = v_client_id
      AND t.deleted_at IS NULL
      AND t.is_active
      AND t.file_type = 'Multi'
      AND t.id IS DISTINCT FROM v_id
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.mapping_rules->'variants', '[]'::jsonb)) AS v
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'a0a098bcbaba45333ea2811833d5dd961e363f3df55c642382b16ee060cedef6'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien BRW sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_purchase_import_templates (
            client_id, client_code, file_type, header_row_index, data_start_row_index,
            column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, 'Multi', 2, 3,
            v_hash_baru, '[]'::jsonb, v_rules, 'manual', true, 0
        );
        RAISE NOTICE 'Template Multi BRW dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_purchase_import_templates
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
        RAISE NOTICE 'Template Multi BRW sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        t.mapping_rules->'variants'->0->'mapping_rules'->>'filter_periode_nama_file' AS filter_periode
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND (upper(m.client_code) IN ('BRW','BIRAWA'));