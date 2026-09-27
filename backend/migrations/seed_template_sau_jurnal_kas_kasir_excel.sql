-- seed_template_sau_jurnal_kas_kasir_excel.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates)
-- hasil pembelajaran MANUAL dari file contoh:
--   dataset/Jurnal Entry/SAU/Jurnal Kas Kasir.xlsx
--   (2.693 baris Excel, sheet "Sheet1", 1.193 voucher/journal entry --
--   masing-masing PERSIS 2 baris/lines (1 debit + 1 kredit), seluruhnya
--   sudah balance di file contoh ini, diikuti 305 baris kosong di ekor
--   file yang diabaikan)
--
-- BENTUK FILE -- tabel Excel flat (bukan blok gaya cetak POS seperti
-- template Sales SAU): baris 1 berisi "baris kontrol" (3 sel ringkasan
-- total debit/kredit/selisih di kolom K-M, sisanya kosong -- BUKAN
-- header), baris 2 berisi header kolom sungguhan, data mulai baris 3.
-- Header ke-9 ("NAMA  SUPPLIER/CUSTOMER") SENGAJA ada 2 spasi di file
-- aslinya -- disimpan apa adanya di header_columns, tapi pencarian
-- kolom di parser (journal_entry_import_v1.py) menormalisasi spasi jadi
-- tidak masalah kalau berubah jadi 1 spasi di file berikutnya.
--
-- Karena itu, `mapping_rules` di bawah pakai format_type
-- "flat_grouped_by_voucher": 1 baris financial_transaction_journal_entry_
-- drafts (+ N financial_transaction_journal_entry_draft_lines) dihasilkan
-- per NILAI UNIK kolom VOUCHER -- BUKAN 1 draft per baris Excel. Setiap
-- baris Excel dengan VOUCHER yang sama jadi 1 baris debit/kredit
-- (draft_line) di journal entry itu. Ini beda dari template Sales SAU
-- (format grouped_invoice_report, pola blok bertanda marker) -- data ini
-- sudah rapi berbentuk tabel flat biasa, tidak perlu marker blok.
--
-- column_signature_hash dihitung dari baris HEADER (baris ke-2, BUKAN
-- baris 1), dinormalisasi persis algoritma SALES_IMPORT_TEMPLATES.md
-- (trim + collapse spasi + lowercase per kolom, digabung "|") lalu
-- di-SHA-256 -- algoritma sama, cuma dipakai ulang untuk fitur Journal
-- Entry (lihat journal_entry_import_v1.py::_hash_baris, di-import dari
-- sales_import_v1.py supaya tidak duplikasi kode).
--
-- KLIEN: dicari lewat nama_client ('SAU', tidak peka huruf besar/kecil)
-- dan GAGAL dengan pesan jelas kalau klien belum ada di
-- management_clients -- buat dulu lewat halaman Clients. client_id &
-- client_code diambil otomatis dari baris klien itu, TIDAK di-hardcode
-- (pola sama seperti seed_template_sau_detail_penjualan_csv.sql, supaya
-- template tetap valid di database lain yang UUID klien SAU-nya beda).
--
-- currency_default = 'IDR' (BUKAN 'USD', default kolom
-- financial_transaction_journal_entry_drafts.currency) -- nominal di file
-- contoh ini jelas Rupiah (mis. transaksi 19.807.500), jadi endpoint
-- upload WAJIB override currency draft ke IDR untuk template ini, bukan
-- ikut default kolom.
--
-- is_active & usage_count DISEBUTKAN EKSPLISIT (bukan mengandalkan
-- DEFAULT kolom) -- default true/0 keduanya cuma default sisi Python di
-- ORM (db_client.py::JournalEntryImportTemplate), BUKAN DEFAULT di level
-- kolom database, jadi kalau tidak disebutkan di sini (INSERT mentah, di
-- luar ORM), nilainya NULL dan gagal kena NOT NULL constraint.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py seed_template_sau_jurnal_kas_kasir_excel.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: TIDAK pakai ON CONFLICT DO NOTHING supaya kesalahan run-2x
-- kelihatan jelas (gagal karena UNIQUE constraint
-- uq_je_import_templates_signature), bukan diam-diam ke-skip. Kalau
-- memang perlu dijalankan ulang (mis. setelah mapping_rules direvisi),
-- hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates
--   WHERE file_type = 'Excel'
--     AND column_signature_hash = '97980aee7332c0998820e472a23c4eb1738403517194903a3276cfc280a66276';

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
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = SAU). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

INSERT INTO financial_transaction_journal_entry_import_templates (
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
    'Sheet1',
    2,
    3,
    '97980aee7332c0998820e472a23c4eb1738403517194903a3276cfc280a66276',
    '["No", "MONTH", "TANGGAL", "JENIS TRANSAKSI", "DEPARTEMEN", "KODE AKUN", "AKUN DEKSRIPSI", "KODE TRANSAKSI", "NAMA  SUPPLIER/CUSTOMER", "DESKRIPSI", "DR", "CR", "D/C", "VOUCHER", "VOC BANTU"]'::jsonb,
    '{"format_type": "flat_grouped_by_voucher", "description": "Jurnal Kas Kasir SAU -- tabel Excel flat, baris 1 adalah baris kontrol (total debit/kredit/selisih, BUKAN header), header sungguhan di baris 2, data mulai baris 3. Setiap baris = 1 journal LINE (akun + debit ATAU kredit); baris-baris dengan nilai kolom VOUCHER yang sama digabung jadi 1 financial_transaction_journal_entry_drafts (+ N draft_lines). Baris kosong di ekor file (tidak ada VOUCHER) dilewati.", "number_format": {"thousands_separator": ",", "decimal_separator": "."}, "date_format": "YYYY-MM-DD", "currency_default": "IDR", "source_type_default": "Import - Petty Cash", "group_by": "voucher", "min_lines_per_group": 2, "columns": {"tanggal": "TANGGAL", "jenis_transaksi": "JENIS TRANSAKSI", "departemen": "DEPARTEMEN", "kode_akun": "KODE AKUN", "akun_deskripsi": "AKUN DEKSRIPSI", "kode_transaksi": "KODE TRANSAKSI", "nama_customer_supplier": "NAMA  SUPPLIER/CUSTOMER", "deskripsi": "DESKRIPSI", "debit": "DR", "credit": "CR", "dc": "D/C", "voucher": "VOUCHER", "voc_bantu": "VOC BANTU"}, "je_number_source": "voucher", "entry_date_source": "tanggal", "description_source": "deskripsi", "description_fallback_source": "nama_customer_supplier", "account_code_source": "kode_akun", "account_name_source": "akun_deskripsi", "debit_source": "debit", "credit_source": "credit", "cost_center_source": "departemen", "catatan_analisis": "Dianalisis manual dari file dataset/Jurnal Entry/SAU/Jurnal Kas Kasir.xlsx (2.693 baris Excel, sheet Sheet1). 1.193 voucher terbaca, SELURUHNYA persis 2 baris (1 debit 1 kredit) dan balance -- tidak ada sampel voucher dengan >2 baris/lines di file contoh ini, jadi belum divalidasi untuk kasus itu walau parser mendukungnya (group-by, bukan asumsi tepat 2 baris)."}'::jsonb,
    'manual',
    true,
    0
);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, t.client_id, m.nama_client, t.client_code, t.file_type, t.sheet_name,
--        t.header_row_index, t.data_start_row_index, t.column_signature_hash,
--        t.detected_by, t.is_active, t.created_at
-- FROM financial_transaction_journal_entry_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE m.nama_client = 'SAU';
