-- seed_template_nbm_multi_format.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien NBM (PT Nawasanga Bertatap Muka). SATU baris setting yang melayani
-- DUA format file laporan penjualan yang strukturnya berbeda:
--
--   varian 1 -- CSV   : dataset/template_laporan/NBM/Report Item Details - 01-08-2026 - 31-08-2026 - All_Outlet - ....csv
--                       Export POS ("Report Item Details", 2 outlet FAS A FAS). Tabel flat,
--                       1 baris = 1 item dalam struk; 5.737 baris = 2.315 struk (Receipt Number).
--   varian 2 -- Excel : dataset/template_laporan/NBM/sales_by_customer_01-08-2026_31-08-2026.xlsx
--                       "Penjualan per Pelanggan" (wholesale, INV/WS/...). Dikelompokkan per
--                       pelanggan (93 section), 1.990 baris line = 851 invoice.
--
-- BAGAIMANA 1 BARIS MELAYANI 2 FORMAT -- file_type = 'Multi' dan
-- mapping_rules.format_type = 'multi_format'. Di dalam mapping_rules ada
-- array "variants"; tiap varian membawa file_type, sheet_name,
-- header_row_index, data_start_row_index, column_signature_hash,
-- header_columns, dan mapping_rules (resep parsing) SENDIRI. Saat file
-- diupload, backend (sales_import_v1.py::_kandidat_template) memecah baris
-- ini jadi template virtual per varian, lalu memilih varian yang tipe
-- file-nya sama DAN hash header-nya cocok. usage_count/template_id tetap
-- menunjuk ke baris ini (1 setting).
--
-- Nilai di level baris (header_row_index, data_start_row_index,
-- column_signature_hash, header_columns) hanya PENGISI kolom NOT NULL untuk
-- template Multi -- yang dipakai untuk pencocokan adalah nilai di dalam
-- tiap varian. column_signature_hash level baris = SHA-256 dari
-- "<hash_csv>:<hash_excel>" supaya tetap unik per klien di constraint
-- uq_sales_import_templates_signature.
--
-- Hash tiap varian dihitung dari baris header asli file contoh pakai fungsi
-- yang sama dengan yang dipakai backend (normalisasi trim+lowercase+collapse
-- spasi, digabung "|", SHA-256):
--   CSV   baris 1 : c74ca792bb1ec18556aaf3ce8a1f5e200043c756090c7761e2f6973be7922bc0
--   Excel baris 6 : 201e5e46c2908cdc9ef5782c4cf4e1ee6aa7b7337adf9ffc4212202c8668e118
--
-- ATURAN EKSTRAKSI (1 baris source_rows = 1 invoice/struk):
--   CSV   (flat_grouped_by_key)
--     invoice  = Receipt Number          tanggal = Date (DD-MM-YYYY)          cabang = Outlet
--     customer = kolom Customer; kosong di 99,9% baris -> "Penjualan POS - <Outlet>"
--     dpp      = SUM(Net Sales + Gratuity)   -- Gratuity (service charge) ikut DPP:
--                di file, Tax = 10% x (Net Sales + Gratuity) persis di semua baris
--     ppn      = SUM(Tax)   -- catatan: di F&B ini kemungkinan PB1 (pajak restoran),
--                bukan PPN; tetap dipetakan ke field 'ppn' karena source_rows cuma punya itu
--     total    = dpp + ppn
--     Baris Event Type=Refund bernilai NEGATIF (Net Sales & Tax), jadi ikut
--     dijumlah dan otomatis mengurangi total struk asalnya. 2 struk yang
--     di-refund penuh menghasilkan total 0 -- tetap diekstrak (is_valid),
--     user yang memutuskan mau di-promote atau tidak.
--   Excel (sectioned_by_customer_header)
--     invoice  = kolom C (No)            tanggal = kolom A (DD/MM/YYYY)
--     customer = nama di baris judul section (kolom A bold, kolom lain kosong); cabang = nama yang sama
--     dpp      = SUM(kolom I 'Jumlah Tagihan') per invoice, termasuk line
--                'Diskon' (negatif), 'Delivery', dll
--     ppn      = 0  -- laporan ini TIDAK punya kolom pajak sama sekali.
--                DIKONFIRMASI USER: apakah penjualan wholesale (INV/WS) kena
--                PPN dan apakah 'Jumlah Tagihan' sudah termasuk PPN?
--     total    = dpp + ppn
--     Baris '(Nama) | Total Penjualan' dan 'Grand Total' dilewati.
--
-- Hasil uji terhadap kedua file contoh (Sep 2026): CSV 2.315 struk, DPP
-- 329.207.656,95 + PPN 32.920.765,71 = 362.128.422,66; Excel 851 invoice,
-- total 204.221.225 (= 'Grand Total' di baris terakhir file).
--
-- CABANG (source_rows.cabang -> invoices.cabang saat "Buat Invoice"):
--   CSV   : kolom Outlet (mis. "FAS A FAS CAFE AND BAKERY", "FAS A FAS TO-GO").
--   Excel : nama pelanggan di baris judul section (font bold di kolom
--           "Pelanggan / Tanggal") -- 93 cabang. Nama yang sama juga tetap
--           disimpan sbg nama_customer (kolom itu tidak boleh kosong).
--
-- KLIEN: seed mencari klien lewat nama_client ('NBM' atau 'PT Nawasanga
-- Bertatap Muka', tidak peka huruf besar/kecil), dan GAGAL dengan pesan
-- jelas kalau klien belum dibuat di management_clients -- buat dulu lewat
-- halaman Clients, baru jalankan file ini. client_id & client_code diambil
-- otomatis dari baris klien itu, jadi tidak ada id yang di-hardcode.
--
-- Cara pakai: jalankan SEKALI lewat runner (menjalankan seed dalam 1 transaksi + mencatat nama file ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_template_nbm_multi_format.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: tanpa ON CONFLICT supaya run-2x kelihatan (gagal karena
-- UNIQUE constraint). Kalau resep direvisi dan perlu dijalankan ulang, hapus dulu:
--   DELETE FROM financial_transaction_sales_import_templates
--   WHERE file_type = 'Multi' AND column_signature_hash = '5cf5abf76b2309c94a3127c2e8456eb3504425bc66b6da889716596966cb41db';
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi
-- ORM (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
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
        '5cf5abf76b2309c94a3127c2e8456eb3504425bc66b6da889716596966cb41db',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien NBM (PT Nawasanga Bertatap Muka) untuk 2 format laporan penjualan yang BEDA struktur: (1) CSV export POS 'Report Item Details' -- retail/cafe per outlet; (2) Excel 'Penjualan per Pelanggan' -- wholesale (INV/WS/...). Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang signature header-nya cocok dengan file yang diupload (lihat _template_dari_varian di sales_import_v1.py).",
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
        "description": "Export POS 'Report Item Details' (semua outlet) -- 1 baris CSV = 1 item/line dalam struk; banyak baris berbagi 1 Receipt Number. 1 baris kanonis (source_rows) = 1 STRUK (Receipt Number), diagregasi dengan menjumlah semua baris (termasuk baris Event Type=Refund yang bernilai negatif, jadi refund otomatis mengurangi total struknya).",
        "encoding": "utf-8",
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
          "tanggal": "Date",
          "invoice": "Receipt Number",
          "customer": "Customer (kosong -> 'Penjualan POS - <Outlet>')",
          "dpp": "SUM(Net Sales + Gratuity)",
          "ppn": "SUM(Tax)",
          "total": "dpp + ppn",
          "cabang": "Outlet"
        },
        "row_granularity": "per_receipt",
        "cabang": "Outlet"
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
        "description": "Laporan 'Penjualan per Pelanggan' (Excel) -- dikelompokkan per pelanggan: 1 baris judul (nama pelanggan), N baris line invoice (1 invoice bisa banyak line produk, termasuk line 'Diskon' negatif), 1 baris '(Nama) | Total Penjualan'; diakhiri baris 'Grand Total'. 1 baris kanonis (source_rows) = 1 INVOICE, dijumlah dari semua line-nya.",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "preamble_rows": 5,
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
          "tanggal": "kolom A (Pelanggan / Tanggal)",
          "invoice": "kolom C (No)",
          "customer": "nama pelanggan di baris judul section",
          "dpp": "SUM(kolom I 'Jumlah Tagihan') per invoice",
          "ppn": "0 (laporan ini tidak memuat kolom pajak)",
          "total": "dpp + ppn",
          "cabang": "nama di baris judul section (bold, kolom A) -- sama dgn customer"
        },
        "row_granularity": "per_invoice",
        "cabang_dari_judul_section": true
      }
    }
  ]
}$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT id, client_code, file_type, column_signature_hash, detected_by, is_active,
--        jsonb_array_length(mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates
-- WHERE file_type = 'Multi';
