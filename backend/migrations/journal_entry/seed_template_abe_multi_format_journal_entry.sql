-- seed_template_abe_multi_format_journal_entry.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates) untuk klien ABE,
-- halaman Transactions > Journal Entry > Import / Source Data. Mengikuti pola seed AADL
-- (blank_separated_journal). 1 baris template per bentuk file.
--
-- SUMBER: EBA_ADJUSTMENT_JOURNAL.xlsx -- 1 sheet ("Sheet1"), 132 baris, 82 baris data, 25 blok.
-- Jurnal penyesuaian Juni - Juli 2026: deposit in transit, accrue pajak PP 55, penyusutan,
-- reklas prepaid, reklas pendapatan lainnya, koreksi akun, dst.
--
-- BENTUK FILE -- ADA kolom NO VOUCHER, TETAPI TIDAK DIPAKAI sebagai kunci jurnal:
--   * Voucher dipakai ulang di beberapa jurnal (mis. 'DEPOSIT IN TRANSIT/0626/01' di 2 jurnal,
--     'DEPRE/0626' di 4 baris) dan 1 jurnal bisa memuat banyak voucher (blok Prepaid/EXP/PEMB).
--     Group-by-voucher (flat_grouped_by_voucher) akan menggabung jurnal yang tidak berhubungan.
--     Karena itu dipakai format_type 'blank_separated_journal' seperti AADL: 1 jurnal = blok baris
--     dipisah baris KOSONG, baris judul (kolom A terisi, NO AKUN kosong) = nama jurnal.
--   * Baris 1 KOSONG, header baris 2, data mulai baris 3. Header (12 kolom, label SEJAJAR dengan isi):
--     NO | MONTH | TANGGAL | NO AKUN | AKUN | NO VOUCHER | BANK | CATEGORY | DESKRIPSI | DEBIT |
--     KREDIT | NOTES. Kolom dibaca lewat POSISI: 1 judul, 3 tanggal, 4 kode akun, 5 nama akun,
--     9 deskripsi, 10 debit, 11 kredit.
--   * Kode akun berupa angka (10002, 60028, 20005, 70001, ...) -- apa adanya dari file; posting
--     mensyaratkan kode itu ada di COA klien.
--
-- HASIL UJI (kode parser ASLI journal_entry_import_v1.py::_parse_blank_separated_journal ke file contoh):
--   27 jurnal (25 blok -> 2 blok dipecah per tanggal), 82 baris, SEMUA valid dan seimbang, tanpa
--   nomor ganda. Total debit = total kredit = 172.987.129,07 (selisih 0,01 dari jumlah mentah file
--   karena pembulatan 2 desimal). Per bulan: Jun 14, Jul 13. Nomor ABE-ADJ-202606-001 s/d
--   ABE-ADJ-202607-013.
--   Blok dipecah per tanggal (seimbang per tanggal): 'JURNAL REKLASS PREPAID' Jun (4 & 24 Jun) dan
--   'JURNAL ADJ KESALAHAN AKUN' Jul (5 & 20 Jul; blok ini tanpa baris judul, memakai judul blok
--   sebelumnya).
--
-- BATAS RESEP:
--   * Struktur HARUS tetap: header sama persis (hash), kolom di posisi sama, jurnal dipisah baris
--     kosong, judul di kolom A. Perubahan header -> "Needs Review" tanpa baris.
--   * Nomor jurnal tergantung urutan blok per bulan (file tidak punya nomor jurnal sendiri). Draft
--     unik per (user, je_number): upload file lain bulan yang sama menghasilkan nomor bentrok
--     (dilewati saat Create Journal). Upload ulang file yang sama juga bentrok -- disengaja.
--   * Kolom NO VOUCHER dan NOTES tidak ikut masuk ke jurnal.
--
-- KLIEN: dicari lewat client_code = 'ABE' ATAU nama_client IN ('ABE', 'EBA') (tidak peka huruf besar/kecil);
-- GAGAL dengan pesan jelas kalau belum ada di management_clients. Nama file sumber memakai "EBA", kode
-- klien di seed lain memakai "ABE" -- keduanya dicakup.
--
-- PRASYARAT KODE: journal_entry_import_v1.py versi yang memuat format_type blank_separated_journal.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\journal_entry\seed_template_abe_multi_format_journal_entry.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_je_import_templates_signature). Kalau resep
-- direvisi, hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id
--      AND (upper(trim(c.client_code)) = 'ABE' OR upper(trim(c.nama_client)) IN ('ABE', 'EBA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '7d4e97cbf2eb2d22afea0cc339858fd183901e6c9fadc5d2c51a60297f3a2af1';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND (upper(trim(client_code)) = 'ABE' OR upper(trim(nama_client)) IN ('ABE', 'EBA'))
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien ABE belum ada di management_clients (dicari client_code = ABE atau nama_client = ABE / EBA). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '7d4e97cbf2eb2d22afea0cc339858fd183901e6c9fadc5d2c51a60297f3a2af1',
        '["NO", "MONTH", "TANGGAL", "NO AKUN", "AKUN", "NO VOUCHER", "BANK", "CATEGORY", "DESKRIPSI", "DEBIT", "KREDIT", "NOTES"]'::jsonb,
        $json${
  "format_type": "blank_separated_journal",
  "description": "Adjustment Journal ABE (file EBA_ADJUSTMENT_JOURNAL.xlsx) -- tabel Excel dengan kolom NO VOUCHER yang TIDAK dapat dipakai sebagai kunci jurnal (voucher dipakai ulang di beberapa jurnal dan satu jurnal bisa memuat banyak voucher). 1 jurnal = blok baris yang dipisah baris kosong; baris judul (kolom A terisi, NO AKUN kosong) = nama jurnal. Kolom dibaca lewat POSISI (1-based).",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Adjustment",
  "columns": {
    "judul": 1,
    "kode_akun": 4,
    "akun_deskripsi": 5,
    "tanggal": 3,
    "deskripsi": 9,
    "debit": 10,
    "credit": 11
  },
  "ignore_columns": {
    "2": "nomor bulan",
    "6": "NO VOUCHER (dipakai ulang / banyak voucher per jurnal, tidak dipakai)",
    "7": "BANK (MANUAL, informasi)",
    "8": "CATEGORY (informasi)",
    "12": "NOTES (catatan reviewer)"
  },
  "je_number_prefix": "ABE-ADJ",
  "split_by_date": true,
  "skip_zero_lines": true,
  "round_decimals": 2,
  "balance_tolerance": 0.01,
  "min_lines_per_group": 2,
  "catatan_analisis": "Dianalisis dari EBA_ADJUSTMENT_JOURNAL.xlsx (Sheet1, 132 baris). Lihat komentar seed."
}
$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.sheet_name, t.header_row_index,
--        t.data_start_row_index, t.column_signature_hash, t.detected_by, t.is_active, t.mapping_rules->>'format_type' AS format_type
-- FROM financial_transaction_journal_entry_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE upper(trim(m.client_code)) = 'ABE' OR upper(trim(m.nama_client)) IN ('ABE', 'EBA');