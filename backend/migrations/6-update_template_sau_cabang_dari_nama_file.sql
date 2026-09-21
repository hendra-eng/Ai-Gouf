-- update_template_sau_cabang_dari_nama_file.sql
-- =============================================================
-- Menambahkan aturan cabang ke template SAU yang SUDAH ada di database
-- (dibuat dari seed_template_sau_detail_penjualan_csv.sql sebelum aturan
-- ini ada). Cabang SAU tidak ada di isi file -- diambil dari SUBSTRING nama
-- file yang diupload:
--   "Detail PENJ OL.csv"  -> cabang "OL"
--   "Detail PENJ PCL.csv" -> cabang "PCL"
-- Pola dicocokkan ke nama file tanpa ekstensi (lihat _cabang_dari_nama_file
-- di modules/transactions/sales_import_v1.py). Nama file yang tidak cocok
-- pola -> cabang dibiarkan kosong.
--
-- Template dicari lewat column_signature_hash-nya (hash header laporan
-- "Detail PENJ" SAU), bukan client_id, jadi tidak bergantung pada id klien
-- di database mana pun. Aman dijalankan berkali-kali (idempoten: hanya
-- menimpa key yang sama). Kalau tidak ada baris yang cocok, script tetap
-- selesai tanpa error (0 baris terubah) -- cek dengan SELECT di bawah.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py update_template_sau_cabang_dari_nama_file.sql

UPDATE financial_transaction_sales_import_templates
SET mapping_rules = mapping_rules
        || '{"cabang_dari_nama_file": {"pattern": "^Detail PENJ (.+)$", "group": 1, "contoh": "Detail PENJ OL.csv -> OL; Detail PENJ PCL.csv -> PCL"}}'::jsonb,
    edited_at = now()
WHERE file_type = 'CSV'
  AND column_signature_hash = '9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06'
  AND mapping_rules->>'format_type' = 'grouped_invoice_report';

-- Verifikasi setelah dijalankan:
-- SELECT id, client_id, mapping_rules->'cabang_dari_nama_file' AS aturan_cabang
-- FROM financial_transaction_sales_import_templates
-- WHERE column_signature_hash = '9d847b64d3b87a44a6b002ec1ff2734558ad901e1886fd84cc66f1ebac8f2f06';
