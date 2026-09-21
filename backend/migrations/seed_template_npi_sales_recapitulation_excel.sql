-- seed_template_npi_sales_recapitulation_excel.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien NPI (PT Nusa Penida Investments), format Excel:
--   dataset/template_laporan/NPI/Sales Recapitulation Detail Report_PLAZAACCOUNTING_....xlsx
--   Export POS "Sales Recapitulation Detail Report" -- sheet "Report", 2 cabang
--   (PLAZA MARIETTA & SIBARITA), periode 01-08-2026 s/d 31-08-2026.
--   8.584 baris line = 2.036 bill (Bill Number).
--
-- STRUKTUR FILE
--   baris 1-10   : judul & metadata laporan (nama PT, periode, cabang, user) -- dilewati
--   baris 11     : header 46 kolom (Sales Number, Bill Number, ..., Order Time)
--   baris 12+    : data, 1 baris = 1 menu/line dalam bill
--   4 baris akhir: ringkasan (Discount Total Rounding, Rounding Total,
--                  Voucher Purchase Total, Platform Fee Total) -- tidak punya
--                  Bill Number, dilewati (recipe: abaikan_baris_tanpa_key)
--
-- ATURAN EKSTRAKSI (format_type = flat_grouped_by_key; 1 baris source_rows = 1 BILL)
--   invoice  = Bill Number (1:1 dengan Sales Number, 2.036 nilai unik)
--   tanggal  = Sales Date (sel bertipe tanggal Excel)
--   cabang   = Branch (PLAZA MARIETTA / SIBARITA)
--   customer = Customer Name -- isinya "-" di semua baris, jadi dianggap kosong
--              dan dipakai "Penjualan POS - <Branch>"
--   dpp      = SUM(Nett Sales + Service Charge)
--              Kolom "DPP" di file berisi 0 di SEMUA baris -- tidak bisa dipakai.
--              Service charge sengaja masuk DPP supaya total = SUM kolom Total di
--              file (Total = Nett Sales + Service Charge + Tax, terverifikasi di
--              semua 8.584 baris). Catatan: di file ini Tax = 10% x Nett Sales
--              (BUKAN x (Nett + Service Charge)) dan Service Charge = 5% x Nett Sales.
--   ppn      = SUM(Tax) -- kolom VAT berisi 0 semua. Untuk F&B ini kemungkinan
--              PB1 (pajak restoran), bukan PPN; tetap dipetakan ke field 'ppn'
--              karena source_rows cuma punya itu.
--   total    = dpp + ppn
--
-- Hasil uji terhadap file contoh: 2.036 bill (PLAZA MARIETTA 1.602, SIBARITA 434),
-- DPP 544.953.436,78 + PPN 47.484.063,16 = 592.437.499,94. Total di file =
-- 592.437.500,00; selisih 0,06 murni pembulatan 2 desimal per bill (angka
-- sumbernya berdesimal 4 digit).
--
-- Tidak dipetakan (tidak punya tempat di source_rows): Payment Method (bill
-- bisa dibayar campur, mis. "CASH (150.000),CREDIT CARD (935.000)"), Menu,
-- Table, Waiter, Member, dst. Baris line bernilai 0 (add-on/paket, 652 baris)
-- ikut dijumlah dan tidak mengubah total.
--
-- Hash header (baris 11, dihitung pakai fungsi backend yang sama):
--   8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d
--
-- KLIEN: dicari lewat nama_client ('NPI' atau 'PT Nusa Penida Investments', tidak
-- peka huruf besar/kecil); GAGAL dengan pesan jelas kalau klien belum ada di
-- management_clients -- buat dulu lewat halaman Clients. client_id & client_code
-- diambil otomatis dari baris klien itu.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_template_npi_sales_recapitulation_excel.sql
--
-- Idempotensi: tanpa ON CONFLICT supaya run-2x kelihatan (gagal karena UNIQUE).
-- Kalau resep direvisi dan perlu dijalankan ulang, hapus dulu:
--   DELETE FROM financial_transaction_sales_import_templates
--   WHERE file_type = 'Excel' AND column_signature_hash = '8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari nama_client = NPI / PT Nusa Penida Investments). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    INSERT INTO financial_transaction_sales_import_templates (
        client_id,
        client_code,
        file_type,
        sheet_name,
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
        'Excel',
        'Report',
        11,
        12,
        '8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d',
        $json$["Sales Number", "Bill Number", "Sales Type", "Batch Order", "Table Section", "Table Name", "Sales Date", "Sales Date In", "Sales Date Out", "Branch", "Brand", "City", "Area", "Visit Purpose", "Regular Member Code", "Regular Member Name", "Loyalty Member Code", "Loyalty Member Name", "Loyalty Member Type", "Employee Code", "Employee Name", "External Employee Code", "External Employee Name", "Customer Name", "Payment Method", "Menu Category", "Menu Category Detail", "Menu", "Custom Menu Name", "Menu Code", "Menu Notes", "Order Mode", "Qty", "Price", "Subtotal", "Discount", "Service Charge", "Tax", "VAT", "Total", "Nett Sales", "DPP", "Bill Discount", "Total After Bill Discount", "Waiter", "Order Time"]$json$::jsonb,
        $json${
  "format_type": "flat_grouped_by_key",
  "description": "Export POS 'Sales Recapitulation Detail Report' (PT Nusa Penida Investments, 2 cabang: PLAZA MARIETTA & SIBARITA) -- tabel flat, 1 baris = 1 menu/line dalam bill; banyak baris berbagi 1 Bill Number. 1 baris kanonis (source_rows) = 1 BILL, diagregasi dengan menjumlah semua line-nya. Ada 10 baris judul/metadata di atas header (baris 1-10) dan 4 baris ringkasan di bawah data (Discount Total Rounding, Rounding Total, Voucher Purchase Total, Platform Fee Total) yang tidak punya Bill Number -- dilewati.",
  "date_format": "YYYY-MM-DD",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "preamble_rows": 10,
  "invoice_key": "Bill Number",
  "tanggal": "Sales Date",
  "customer": "Customer Name",
  "customer_kosong_jika": [
    "-"
  ],
  "customer_fallback": "Penjualan POS - {Branch}",
  "cabang": "Branch",
  "dpp_columns": [
    "Nett Sales",
    "Service Charge"
  ],
  "ppn_columns": [
    "Tax"
  ],
  "abaikan_baris_tanpa_key": true,
  "field_mapping": {
    "tanggal": "Sales Date",
    "invoice": "Bill Number",
    "cabang": "Branch",
    "customer": "Customer Name (selalu '-' -> 'Penjualan POS - <Branch>')",
    "dpp": "SUM(Nett Sales + Service Charge)  -- kolom 'DPP' di file berisi 0 semua, tidak dipakai",
    "ppn": "SUM(Tax)",
    "total": "dpp + ppn (= SUM kolom Total)"
  },
  "row_granularity": "per_bill"
}$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT id, client_code, file_type, sheet_name, header_row_index, column_signature_hash,
--        detected_by, is_active, mapping_rules->>'format_type' AS format_type
-- FROM financial_transaction_sales_import_templates
-- WHERE column_signature_hash = '8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d';
