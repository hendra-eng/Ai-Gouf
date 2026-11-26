-- seed_template_npi_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk klien NPI
-- (PT NUSA PENIDA INVESTMENTS), halaman Transactions > Purchase > Source Data > Upload File.
-- SATU baris setting ("Multi"). Mengikuti pola seed_template_birawa_multi_format_purchase.sql
-- (nama file = periode, hash header dipangkas, akun dari file, nomor cadangan, idempotensi) dan
-- seed NBM.
--
-- STATUS: baru varian EXCEL (NPI_Purchase_May_2026.xlsx, Sheet1). Varian lain (CSV/PDF) nanti cukup
-- ditambahkan ke array "variants" (lihat "Menambah varian").
--
-- SUMBER: NPI_Purchase_May_2026.xlsx -- 2 sheet:
--   * "Sheet1"  = DATA BERSIH (dipakai): 5.762 baris fisik, 5.760 baris data, Jan-Mei 2026.
--   * "Sheet2"  = lembar kerja rekonsiliasi (urut per akun + tabel Total / TB YTD May / Selisih di
--                 kanan, 5.794 baris data termasuk 10 baris Agustus 2026 dan 27 baris sisi kredit).
--                 TIDAK dipakai. Header 14 kolom pertamanya SAMA dengan Sheet1, jadi hash cocok juga;
--                 yang membedakan hanya nama sheet di resep ("Sheet1").
--   Header di baris 2 (baris 1 kosong), data mulai baris 3. Kolom dipakai = 14 kolom:
--   1 NO | 2 MONTH | 3 TANGGAL | 4 Jurnal ID | 5 NO AKUN | 6 AKUN | 7 SUPPLIER/CUSTOMER/NARATION |
--   8 DESKRIPSI | 9 DEBET | 10 KREDIT | 11 D/C | 12 PROJECT | 13 POSTED DATE | 14 POSTED BY
--   Bentuk file: DAFTAR BIAYA per akun (32 akun beban 6-xxxx dan 9-1002), BUKAN laporan pembelian
--   per supplier: tidak ada kolom invoice/PPN/qty. Supplier ADA (kolom 7), akun ADA (kolom 5-6).
--
-- HASIL ANALISIS (parser purchase_import_v1.py dijalankan ke file contoh, Sheet1):
--   * 5.760 baris -> 5.748 baris item (Debet > 0) -> 4.616 transaksi Purchase draft. Total Debet
--     1.802.934.056,61 = penjumlahan mentah kolom DEBET file (selisih 0). Tanpa error dan tanpa peringatan.
--   * Rekonsiliasi per bulan tanggal transaksi (transaksi / baris item / total):
--       2026-01  858 / 1085 /  293.412.993,55    2026-02  861 / 1056 /  302.265.153,52
--       2026-03  905 / 1138 /  459.345.429,91    2026-04  975 / 1205 /  361.717.132,74
--       2026-05 1017 / 1264 /  386.193.346,89
--     File NPI_Purchase_May_2026.xlsx (nama file = Mei 2026) -> hanya 1.017 transaksi / 386.193.346,89 diimpor.
--
-- CARA FILE DIBACA:
--   * Nomor transaksi = "Jurnal ID" (angka, mis. 31418). 1 Jurnal ID = 1 tanggal; baris dengan Jurnal ID
--     sama = 1 transaksi, 1 item per baris (182 transaksi berisi > 1 akun). kunci_pisah_tanggal tetap
--     aktif sebagai pengaman kalau suatu hari 1 Jurnal ID dipakai di > 1 tanggal.
--   * Akun item = kolom NO AKUN / AKUN file (akun_baris_dari_file). Qty 1, harga = DEBET.
--   * Supplier = kolom SUPPLIER/CUSTOMER/NARATION. Kosong -> "NPI Expense Entry" (belum pernah terjadi di
--     file contoh). Catatan transaksi = kolom PROJECT (Nusa Penida Investments / Marietta / Deli / Store /
--     Sibarita / Well Star Indonesia).
--   * Baris tanpa Jurnal ID tidak dibuang diam-diam: nomornya NPI-NOJRNL-<YYYYMMDD> (nomor_cadangan_awalan;
--     file contoh tidak punya baris seperti itu).
--   * Baris DEBET 0 dilewati (abaikan_baris_total_nol): 12 baris sisi KREDIT akun 6-3006 Bank charges
--     (koreksi biaya bank, total 55.848: 5/3 mandiri shop sales, 20/3 PLN 2x5.000, Mei: Deli/marietta/mandiri)
--     TIDAK ikut diimpor. Tanggal wajib (tanggal_wajib true).
--
-- NAMA FILE = PERIODE (opsional, seperti BRW/NBM): resep memakai "filter_periode_nama_file": "jika_ada".
--   NPI_PURCHASE_202608.xlsx -> hanya transaksi bertanggal Agustus 2026 yang diimpor
--   NPI_PURCHASE_20260801-20260815.xlsx -> rentang tanggal; NPI_Purchase_May_2026.xlsx juga dikenali.
--   Nama file TANPA periode (mis. NPI_Purchase.xlsx) -> SEMUA transaksi di file diimpor (4.616).
--   Mau wajib periode (nama file tanpa periode ditolak): ganti "jika_ada" jadi true. Nomor transaksi unik
--   per klien: upload ulang bulan yang sama dilewati ("already imported"). Nama file dengan bulan yang
--   tidak ada di file (mis. 202608) ditolak dengan pesan "No transactions in period".
--
-- PERLU DIPERHATIKAN:
--   1. Kode akun file (32 akun) SUDAH ada di COA NPI (seed_coa_npi.sql) -- cek tetap di halaman COA kalau
--      COA di database pernah diubah manual.
--   2. Akun hutang (Cr) TIDAK diisi di resep: dipakai Settings > Account Mapping NPI (accounts payable).
--      Pastikan sudah diisi.
--   3. File ini bukan pembelian sungguhan: 3.049 transaksi hanya berisi 6-1003 Depreciation Expense
--      (159 jt, dibuat sistem), 895 hanya Bank charges, plus accrual gaji ("Accure Salary - Manual",
--      6-1009 Wages and Salaries). Hasil import berstatus 'unpaid' (muncul sebagai hutang); jurnal yang SAMA
--      bisa juga masuk lewat Journal Entry / Bank Cash / Fixed Asset -- pilih satu jalur, jangan dobel.
--   4. Struktur HARUS tetap: nama 14 header sama persis (hash), header di baris 2, sheet "Sheet1".
--      Kalau nama sheet tidak ada, parser memakai sheet AKTIF (bisa "Sheet2" -- isinya beda, lihat SUMBER).
--
-- SIGNATURE: pencocokan Excel memakai purchase_import_v1._cocokkan_template dengan "header_kolom" [1, 14]:
-- hash = SHA-256 baris header ke-2 kolom 1-14:
--   hash_excel = 4d22eb9196faeb68463a4da665ca633dab96d284bf00776fccccbe894b545493
-- column_signature_hash level baris = SHA-256(hash_excel) (satu varian):
--   f69999297e96a485504b021c5872d10782c0f95f05f46903d8abe06f4414065d
-- Tiap varian ditambah/dihapus, hitung ulang (SHA-256("<hash1>:<hash2>")).
--
-- PRASYARAT KODE (purchase_import_v1.py): filter_periode_nama_file, abaikan_baris_total_nol,
-- kunci_pisah_tanggal, akun_baris_dari_file, dan nomor_cadangan_awalan -- semuanya SUDAH ada (dipasang untuk
-- BRW); TIDAK ada perubahan kode untuk NPI. Prasyarat tabel: migration 15-create_purchase_import_templates.py.
--
-- KLIEN: dicari lewat client_code 'NPI' atau nama_client 'NPI' / 'PT NUSA PENIDA INVESTMENTS';
-- GAGAL dengan pesan jelas kalau tidak ada atau >1 klien aktif cocok. client_id & client_code otomatis.
--
-- Cara pakai (server Linux):
--   cd backend
--   venv/bin/python migrations/run_seed.py migrations/purchase/seed_template_npi_multi_format_purchase.sql
--   (Windows: venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_npi_multi_format_purchase.sql)
--
-- Idempotensi / upgrade di tempat: AMAN dijalankan berkali-kali (pola seed BRW/NBM/UBD). Baris Multi klien
-- dicari lewat hash baris seed ini (v_hash_baru) atau versi lamanya (v_hash_lama), termasuk yang soft-delete ->
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
    v_hash_baru   CONSTANT TEXT := 'f69999297e96a485504b021c5872d10782c0f95f05f46903d8abe06f4414065d';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien NPI (PT NUSA PENIDA INVESTMENTS) untuk file pembelian/biaya. Saat ini varian Excel (NPI_Purchase_May_2026.xlsx, Sheet1); varian CSV/PDF ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep sendiri; backend memilih varian yang tipe file dan signature header-nya cocok.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "4d22eb9196faeb68463a4da665ca633dab96d284bf00776fccccbe894b545493",
      "header_columns": [
        "NO",
        "MONTH",
        "TANGGAL",
        "Jurnal ID",
        "NO AKUN",
        "AKUN",
        "SUPPLIER/CUSTOMER/NARATION",
        "DESKRIPSI",
        "DEBET",
        "KREDIT",
        "D/C",
        "PROJECT",
        "POSTED DATE",
        "POSTED BY"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_purchase_report",
        "description": "Daftar biaya/pembelian NPI (PT NUSA PENIDA INVESTMENTS) dari file NPI_Purchase_May_2026.xlsx -- tabel FLAT di Sheet1, header baris 2 (baris 1 kosong), data mulai baris 3. 1 baris = 1 item biaya; baris dengan Jurnal ID (kolom D) sama dan tanggal sama = 1 transaksi Purchase draft. Akun tiap item dibaca dari kolom NO AKUN / AKUN file, supplier dari kolom SUPPLIER/CUSTOMER/NARATION. Periode yang diambil mengikuti NAMA FILE bila ada (NPI_PURCHASE_YYYYMM).",
        "source_kind": "excel_sheet",
        "sheet_name": "Sheet1",
        "date_format": "YYYY-MM-DD",
        "tanggal_wajib": true,
        "filter_periode_nama_file": "jika_ada",
        "header_kolom": [
          1,
          14
        ],
        "jatuh_tempo_hari": 30,
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "header_row_index": 2,
        "data_start_row_index": 3,
        "columns": {
          "tanggal": 3,
          "purchase_no": 4,
          "akun_kode": 5,
          "akun_nama": 6,
          "supplier": 7,
          "deskripsi": 8,
          "total": 9,
          "kredit": 10,
          "note": 12
        },
        "ignore_columns": {
          "1": "NO (nomor urut sistem sumber), tidak dipakai",
          "2": "MONTH (nomor bulan), informasi -- periode dibaca dari TANGGAL",
          "11": "D/C (nilai bersih Debet - Kredit), tidak dipakai",
          "13": "POSTED DATE, tidak dipakai",
          "14": "POSTED BY, tidak dipakai"
        },
        "abaikan_baris_total_nol": true,
        "kunci_pisah_tanggal": true,
        "akun_baris_dari_file": true,
        "nomor_cadangan_awalan": "NPI-NOJRNL",
        "validation": {
          "total_nota_toleransi": 1,
          "deskripsi_kosong_pengganti": "(tanpa keterangan)",
          "supplier_kosong_pengganti": "NPI Expense Entry"
        },
        "field_mapping": {
          "purchase_no": "columns.purchase_no (Jurnal ID, dinormalisasi; kosong -> NPI-NOJRNL-YYYYMMDD)",
          "purchase_date": "TANGGAL",
          "vendor_name": "SUPPLIER/CUSTOMER/NARATION (kosong -> 'NPI Expense Entry')",
          "description": "DESKRIPSI",
          "quantity": 1,
          "unit_price": "DEBET",
          "total": "DEBET",
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
      AND (upper(trim(client_code)) = 'NPI'
           OR upper(trim(nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS'));

    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND (upper(trim(client_code)) = 'NPI'
           OR upper(trim(nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS'))
    ORDER BY (upper(trim(client_code)) = 'NPI') DESC, created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari client_code NPI atau nama PT NUSA PENIDA INVESTMENTS). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    IF v_n > 1 AND upper(trim(coalesce(v_client_code, ''))) <> 'NPI' THEN
        RAISE EXCEPTION 'Ada % klien aktif yang cocok dengan NPI dan tidak satu pun ber-client_code NPI; tentukan client_code-nya dulu.', v_n;
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = '4d22eb9196faeb68463a4da665ca633dab96d284bf00776fccccbe894b545493'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien NPI sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_purchase_import_templates (
            client_id, client_code, file_type, header_row_index, data_start_row_index,
            column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, 'Multi', 2, 3,
            v_hash_baru, '[]'::jsonb, v_rules, 'manual', true, 0
        );
        RAISE NOTICE 'Template Multi NPI dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi NPI sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        t.mapping_rules->'variants'->0->'mapping_rules'->>'filter_periode_nama_file' AS filter_periode
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND (upper(m.client_code) = 'NPI');