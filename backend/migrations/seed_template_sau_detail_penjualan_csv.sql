-- seed_template_sau_detail_penjualan_csv.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) hasil
-- pembelajaran MANUAL dari file contoh:
--   dataset/template_laporan/SAU/Detail PENJ CRS.csv
--   (91.912 baris, periode 01/07/2026 - 31/07/2026, 10.769 blok transaksi --
--   prefix no invoice "JL-" 876x dan "KSR-" 9893x)
--
-- PENTING -- bentuk file ini BUKAN tabel flat biasa (1 baris = 1 field
-- header lalu N baris data dengan kolom yang sama). Ini "Laporan Penjualan
-- Detail" gaya cetak POS/kasir: tiap TRANSAKSI diwakili satu BLOK beberapa
-- baris CSV (baris header invoice, baris label item, baris-baris item,
-- baris subtotal, baris footer Pot./Pajak/Biaya/Total Akhir, lalu 1 baris
-- kosong sebelum blok berikutnya) -- lihat root/SALES_IMPORT_TEMPLATES.md
-- untuk konsep template & alurnya secara umum.
--
-- Karena itu, `mapping_rules` di bawah BUKAN pemetaan flat
-- {field_key: nama_kolom} seperti pada file CSV/Excel biasa (satu baris
-- per invoice), melainkan "resep parsing" lengkap dengan format_type
-- "grouped_invoice_report": posisi kolom (1-based) untuk baris header
-- invoice, baris item, dan baris footer, plus penanda (marker) untuk
-- mengenali batas tiap blok. 1 baris financial_transaction_sales_source_rows
-- yang dihasilkan nanti = 1 TRANSAKSI/INVOICE (dari baris footer "Total
-- Akhir"), BUKAN 1 baris item -- item-item di dalam satu invoice tidak
-- disimpan satu-satu (source_rows tidak punya struktur nested item; kalau
-- detail item per invoice dibutuhkan nanti, perlu tabel terpisah).
--
-- column_signature_hash dihitung dari SATU-SATUNYA baris berisi label
-- kolom asli di file ini (baris ke-8): "No Transaksi;;Tanggal;;Dept.;Kode
-- Pel.;Nama Pelanggan;;;Alamat;;;", dinormalisasi (trim + collapse spasi +
-- lowercase per kolom, digabung "|") lalu di-SHA-256 -- persis algoritma
-- yang didokumentasikan di SALES_IMPORT_TEMPLATES.md, supaya file
-- berikutnya dari klien SAU dengan layout kolom identik otomatis cocok ke
-- template ini.
--
-- detected_by = 'manual' (BUKAN 'ai') -- pola ini dianalisis langsung dari
-- isi file oleh Claude (bukan lewat pemanggilan model AI/DeepSeek, karena
-- endpoint & integrasi AI untuk fitur ini belum dibangun), makanya
-- ai_model_version/ai_confidence sengaja dibiarkan NULL (default).
--
-- CATATAN UNTUK DIKONFIRMASI USER: nama perusahaan yang tercetak di baris
-- ke-2 file ini adalah "INSPIRASI MEDIA KREATIF", BEDA dari nama_client
-- klien tujuan di bawah ("SAU"). Diasumsikan SAU adalah nama akun/brand di
-- platform ini untuk entitas yang sama (sesuai nama folder dataset), tapi
-- mohon dipastikan sebelum dieksekusi -- kalau ternyata salah, cukup ganti
-- nilai client_id di bawah ke management_clients.id yang benar.
--
-- Semua baris footer "Pajak :" di file contoh ini bernilai 0 (tidak ada
-- transaksi berPPN untuk divalidasi) -- field_mapping.ppn tetap diarahkan
-- ke situ (bukan diasumsikan selalu 0), jadi kalau suatu saat ada laporan
-- dari klien yang sama dengan Pajak > 0, pemetaannya sudah benar.
--
-- is_active & usage_count DISEBUTKAN EKSPLISIT (bukan mengandalkan DEFAULT
-- kolom) -- default true/0 keduanya cuma default sisi Python di ORM
-- (db_client.py::SalesImportTemplate), BUKAN DEFAULT di level kolom
-- database, jadi kalau tidak disebutkan di sini (INSERT mentah, di luar
-- ORM), nilainya NULL dan gagal kena NOT NULL constraint -- sudah
-- divalidasi (dijalankan lalu di-ROLLBACK) sebelum file ini diberikan.
--
-- Cara pakai: jalankan file ini SEKALI langsung ke database (psql, atau
-- tool SQL client apa pun) -- BUKAN lewat script migration Python, karena
-- ini data seed (1 baris konfigurasi), bukan perubahan skema.
--   psql "$DATABASE_URL" -f backend/migrations/seed_template_sau_detail_penjualan_csv.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT DO NOTHING supaya kesalahan run-2x
-- kelihatan jelas (gagal karena UNIQUE constraint uq_sales_import_templates_
-- signature), bukan diam-diam ke-skip. Kalau memang perlu dijalankan ulang
-- (mis. setelah mapping_rules direvisi), hapus dulu barisnya:
--   DELETE FROM financial_transaction_sales_import_templates
--   WHERE client_id = '6ccf0c66-36a4-4c45-8a97-db36e7a5a59d'
--     AND file_type = 'CSV'
--     AND column_signature_hash = '9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06';

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
    '8f44dfee-d107-4e7f-a400-ceb6b19455ee',
    'CLT-001',
    'CSV',
    8,
    11,
    '9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06',
    '["No Transaksi", "", "Tanggal", "", "Dept.", "Kode Pel.", "Nama Pelanggan", "", "", "Alamat", "", "", ""]'::jsonb,
    '{"format_type": "grouped_invoice_report", "description": "Laporan Penjualan Detail (POS/kasir) -- 1 baris kanonis (financial_transaction_sales_source_rows) = 1 TRANSAKSI/INVOICE, bukan 1 baris item. Setiap invoice diwakili sebuah ''blok'' beberapa baris CSV: 1 baris header invoice, 1 baris label item, N baris item, 1 baris subtotal, 1 baris footer (Pot./Pajak/Biaya/Total Akhir), lalu 1 baris kosong pemisah sebelum blok berikutnya.", "delimiter": ";", "encoding": "ISO-8859-1", "date_format": "DD/MM/YYYY", "number_format": {"thousands_separator": ".", "decimal_separator": ","}, "preamble_rows": 7, "header_label_row_index": 8, "block_start_row_index": 11, "invoice_header": {"row_shape": "single_row", "columns": {"no_invoice": 1, "tanggal": 3, "dept": 5, "kode_pelanggan": 6, "nama_pelanggan": 7, "alamat": 10}}, "item_header_marker": {"match_type": "exact_row_prefix", "value": "No.;Kd. Item;Nama Item"}, "item_columns": {"no": 1, "kode_item": 2, "nama_item": 3, "jumlah": 8, "satuan": 9, "harga": 10, "potongan_persen": 11, "total": 12}, "block_subtotal_columns": {"note": "Baris ringkasan sebelum footer -- informasional saja, TIDAK dipakai di field_mapping di bawah.", "jumlah_item_total": 8, "subtotal_sebelum_potongan_pajak_biaya": 12}, "block_footer_marker": {"match_type": "exact_row_prefix", "value": "Pot. :"}, "block_footer_columns": {"potongan": 2, "pajak": 5, "biaya": 8, "total_akhir": 11}, "block_separator": {"match_type": "blank_row", "description": "Baris kosong (semua kolom trim-kosong) menandai akhir 1 blok invoice, blok berikutnya dimulai di baris non-kosong sesudahnya."}, "end_of_data_marker": {"match_type": "contains", "value": "TOTAL KESELURUHAN", "description": "Begitu baris ini ditemukan, SISA file (ringkasan grand total + baris stempel tanggal cetak/REPORT) diabaikan -- bukan data transaksi."}, "field_mapping": {"cabang": "substring nama file (Detail PENJ <CABANG>.csv)", "tanggal": "invoice_header.tanggal", "invoice": "invoice_header.no_invoice", "customer": "invoice_header.nama_pelanggan", "dpp": "block_footer.total_akhir - block_footer.pajak", "ppn": "block_footer.pajak", "total": "block_footer.total_akhir"}, "cabang_dari_nama_file": {"pattern": "^Detail PENJ (.+)$", "group": 1, "contoh": "Detail PENJ OL.csv -> OL; Detail PENJ PCL.csv -> PCL"}, "row_granularity": "per_invoice_block", "catatan_analisis": "Dianalisis manual dari file dataset/template_laporan/SAU/Detail PENJ CRS.csv (91.912 baris, periode 01/07/26-31/07/26, 10.769 blok transaksi -- prefix no invoice ''JL-'' 876x dan ''KSR-'' 9893x). Seluruh baris footer ''Pajak :'' bernilai 0 di file contoh ini (tidak ada sampel PPN>0 untuk divalidasi). Nama perusahaan yang tercetak di header laporan (baris 2) adalah ''INSPIRASI MEDIA KREATIF'', BEDA dari nama_client di management_clients (''SAU'') -- kemungkinan SAU adalah nama akun/brand di platform ini untuk entitas yang sama, bukan salah pilih klien; mohon dikonfirmasi user."}'::jsonb,
    'manual',
    true,
    0
);

-- Verifikasi setelah dijalankan:
-- SELECT id, client_code, file_type, header_row_index, data_start_row_index,
--        column_signature_hash, detected_by, is_active, created_at
-- FROM financial_transaction_sales_import_templates
-- WHERE client_id = '6ccf0c66-36a4-4c45-8a97-db36e7a5a59d';
