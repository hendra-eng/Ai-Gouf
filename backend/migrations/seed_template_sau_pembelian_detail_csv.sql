-- seed_template_sau_pembelian_detail_csv.sql
-- =============================================================
-- Template pola kolom Purchase (financial_transaction_purchase_import_templates)
-- hasil pembelajaran MANUAL dari 4 file contoh klien SAU:
--   dataset/purchase/SAU/csv/Data Pembelian Detail 01-31 Juli 2026 CRS.csv  (85 transaksi)
--   dataset/purchase/SAU/csv/Data Pembelian Detail 01-31 Juli 2026 NGY.csv  (113 transaksi)
--   dataset/purchase/SAU/csv/Data Pembelian Detail 01-31 Juli 2026 OL.csv   (9 transaksi)
--   dataset/purchase/SAU/csv/Data Pembelian Detail 01-31 Juli 2026 PCL.csv  (42 transaksi)
-- (periode 01/07/2026 - 31/07/2026, 1 file = 1 cabang/Dept.)
--
-- Bentuk file: "Laporan Pembelian Detail" gaya cetak -- mirip Laporan
-- Penjualan Detail SAU (seed_template_sau_detail_penjualan_csv.sql), tiap
-- TRANSAKSI = 1 BLOK beberapa baris CSV (delimiter ';', 13 kolom):
--
--   BL-000001576-26;;01/07/2026;;CRS;SP0526;PT KRITING JABRIK BERSAUDARA;...   <- header transaksi
--   No.;Kd. Item;Nama Item;;;;;Jml;Satuan;Harga;Pot. %;Total;                  <- label item
--   1;70093;TUNA SUNBELL B 185 GR (48);;;;;30;DUS;750.000;0;22.500.000;        <- N baris item
--   ;;;;;;;30;;;;22.500.000;                                                   <- subtotal blok
--   Pot. :;0;;Pajak :;0;;Biaya :;0;;Total Akhir :;22.500.000;;                 <- footer
--    ;;;;;;;;;;;;                                                              <- pemisah
--
-- BEDA dengan Sales: 1 blok di sini jadi 1 Purchase Transaction LENGKAP
-- DENGAN baris itemnya (financial_transaction_purchase_transaction_lines),
-- dibuat langsung berstatus 'draft' oleh
-- modules/transactions/purchase_import_v1.py (format_type
-- 'grouped_purchase_report' -- lihat docstring modul itu untuk aturan
-- alokasi Pot./Pajak/Biaya ke baris). Hasil uji parser ke 4 file di atas:
-- 249 transaksi, 0 error, SUM total baris == "Total Akhir" grand total
-- tiap file persis.
--
-- column_signature_hash = SHA-256 dari baris ke-8 ("No Transaksi;;Tanggal;;
-- Dept.;Kode Supp.;Nama Supplier;;;;;;"), dinormalisasi (trim + collapse
-- spasi + lowercase per kolom, digabung "|") -- algoritma sama dengan
-- sales_import_v1._hash_baris. Keempat file cabang punya hash yang SAMA,
-- jadi cukup 1 template.
--
-- AKUN (sesuai master COA SAU, lihat seed_coa_sau.sql & 19-fix_sau_purchase_accounts.sql):
-- baris pembelian per cabang/Dept. (line_account_by_dept) CRS 11500001,
-- NGY 11500002, OL 11500003, PCL 11500004, cabang lain 11500099 PERSEDIAAN;
-- Hutang Usaha 21200001 (ap_account); PPN Masukan 11300998 (tax_account).
--
-- KLIEN: dicari lewat nama_client (sama seperti seed Sales SAU), GAGAL
-- dengan pesan jelas kalau belum ada. client_id/client_code TIDAK di-hardcode.
--
-- PRASYARAT: tabel sudah dibuat lewat
--   venv\Scripts\python migrations\15-create_purchase_import_templates.py
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_template_sau_pembelian_detail_csv.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT (sama seperti seed lain) -- run-2x
-- gagal jelas di UNIQUE uq_purchase_import_templates_signature. Untuk
-- menjalankan ulang setelah revisi, hapus dulu:
--   DELETE FROM financial_transaction_purchase_import_templates
--   WHERE file_type = 'CSV' AND column_signature_hash = 'f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) in ('SAU', 'CV SUMBER ALODIE UTAMA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = SAU / CV SUMBER ALODIE UTAMA). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

INSERT INTO financial_transaction_purchase_import_templates (
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
    'CSV',
    8,
    11,
    'f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64',
    '["No Transaksi", "", "Tanggal", "", "Dept.", "Kode Supp.", "Nama Supplier", "", "", "", "", "", ""]'::jsonb,
    '{"format_type": "grouped_purchase_report", "description": "Laporan Pembelian Detail -- 1 Purchase Transaction = 1 BLOK beberapa baris CSV: 1 baris header transaksi (No Transaksi/Tanggal/Dept./Kode Supp./Nama Supplier), 1 baris label item, N baris item, 1 baris subtotal, 1 baris footer (Pot./Pajak/Biaya/Total Akhir), lalu 1 baris kosong pemisah.", "delimiter": ";", "encoding": "ISO-8859-1", "date_format": "DD/MM/YYYY", "number_format": {"thousands_separator": ".", "decimal_separator": ","}, "preamble_rows": 7, "header_label_row_index": 8, "block_start_row_index": 11, "purchase_header": {"row_shape": "single_row", "columns": {"no_transaksi": 1, "tanggal": 3, "dept": 5, "kode_supplier": 6, "nama_supplier": 7}}, "item_header_marker": {"match_type": "exact_row_prefix", "value": "No.;Kd. Item;Nama Item"}, "item_columns": {"no": 1, "kode_item": 2, "nama_item": 3, "jumlah": 8, "satuan": 9, "harga": 10, "potongan_persen": 11, "total": 12}, "block_subtotal_columns": {"note": "Baris sesudah item dengan kolom 1 kosong & kolom 12 terisi -- subtotal cetak blok (dianggap benar kalau beda pembulatan dengan SUM total item).", "jumlah_item_total": 8, "subtotal": 12}, "block_footer_marker": {"match_type": "exact_row_prefix", "value": "Pot. :"}, "block_footer_columns": {"potongan": 2, "pajak": 5, "biaya": 8, "total_akhir": 11}, "block_separator": {"match_type": "blank_row"}, "end_of_data_marker": {"match_type": "contains", "value": "TOTAL KESELURUHAN", "description": "Sisa file (grand total + stempel cetak REPORT) diabaikan."}, "cabang_dari_nama_file": {"pattern": "^Data Pembelian Detail .* (\\S+)$", "group": 1, "contoh": "Data Pembelian Detail 01-31 Juli 2026 CRS.csv -> CRS (fallback kalau kolom Dept. kosong)"}, "field_mapping": {"purchase_no": "purchase_header.no_transaksi", "purchase_date": "purchase_header.tanggal", "vendor_code": "purchase_header.kode_supplier", "vendor_name": "purchase_header.nama_supplier", "dept": "purchase_header.dept (disimpan di description & notes)", "line.subtotal/discount": "harga x jumlah; discount = selisih ke total item bila Pot. % > 0", "line.discount (+)": "block_footer.potongan dialokasikan proporsional", "line.tax_amount": "block_footer.pajak dialokasikan proporsional", "baris Biaya Lain": "block_footer.biaya (1 baris tambahan)", "total transaksi": "block_footer.total_akhir (divalidasi, toleransi Rp1)"}, "line_account": {"account_code": "11500099", "account_name": "PERSEDIAAN"}, "biaya_account": {"account_code": "11500099", "account_name": "PERSEDIAAN"}, "line_account_by_dept": {"CRS": {"account_code": "11500001", "account_name": "PERSEDIAAN CRS"}, "NGY": {"account_code": "11500002", "account_name": "PERSEDIAAN NGY"}, "OL": {"account_code": "11500003", "account_name": "PERSEDIAAN OL"}, "PCL": {"account_code": "11500004", "account_name": "PERSEDIAAN PCL"}}, "ap_account": {"account_code": "21200001", "account_name": "HUTANG USAHA"}, "tax_account": {"account_code": "11300998", "account_name": "PAJAK MASUKAN"}, "biaya_description": "Other Costs", "currency_default": "IDR", "category_default": "Inventory", "row_granularity": "per_purchase_block", "catatan_analisis": "Dianalisis manual dari 4 file dataset/purchase/SAU/csv/Data Pembelian Detail 01-31 Juli 2026 {CRS,NGY,OL,PCL}.csv (periode 01/07/26-31/07/26, total 249 blok transaksi prefix BL-). Semua file 13 kolom, header label identik di baris 8. Total Akhir = subtotal cetak - Pot. + Pajak + Biaya di seluruh blok. 1 blok (BL-000002008-26, CRS) selisih pembulatan Rp2 antara SUM total item dan subtotal cetak. Akun persediaan per cabang mengikuti master COA SAU (line_account_by_dept)."}'::jsonb,
    'manual',
    true,
    0
);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash,
--        t.mapping_rules->'line_account' AS akun, t.is_active, t.created_at
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id;
