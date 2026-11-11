-- seed_template_ubd_multi_format_journal_entry.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates) untuk klien UBD
-- (PT Ushers Beyond Design), halaman Transactions > Journal Entry > Import / Source Data.
-- Mengikuti pola seed NBM / SAU (flat_grouped_by_voucher). 1 baris template per bentuk file
-- (parser Journal Entry mencocokkan 1 template per hash header).
--
-- SUMBER: UBD_ADJUSTMENT_JOURNAL.xlsx -- 1 sheet ("Sheet1"), 65 baris, 5 blok jurnal.
-- Jurnal penyesuaian Januari - Agustus 2026: depresiasi aset tetap (Jun-Agu), accrue PPh 21 dan
-- accrue PPh 25 (Jan-Jul terisi; Agu-Des sudah ada barisnya tapi nominal 0).
--
-- BENTUK FILE:
--   * Header di baris 1, data mulai baris 2 (BEDA dari NBM/SAU yang header di baris 2).
--     Header (18 kolom, label SEJAJAR dengan isi, dicari lewat NAMA header): No | Tipe Transaksi
--     Jurnal | Month | Tanggal | No Voucher | Kode Akun # | Nama Perkiraan | Keterangan Jurnal |
--     Debit | Kredit | D/C | SUPPLIER/CUSTOMER | TAX MAPPING | NO. REKON | NOMOR FAKTUR | CABANG |
--     NOTES | DIBUAT PADA.
--   * ADA kolom No Voucher -> format_type 'flat_grouped_by_voucher'. Kolom "No" hanya berisi baris
--     judul blok ("JURNAL ADJ DEPRESIASI ASET", ...) -- tanpa voucher & tanpa nominal, jadi dilewati.
--   * Baris debit dan baris kredit tiap voucher TERPISAH (blok debit dulu, blok kredit kemudian,
--     di blok PPh 21/25 dipisah baris kosong), jadi dikelompokkan per NILAI voucher, BUKAN per blok
--     baris kosong. Karena itu 'blank_separated_journal' TIDAK cocok untuk file ini (diuji: blok
--     PPh 25 terpecah jadi 2 jurnal tidak seimbang).
--   * Tanggal bertipe tanggal Excel (terbaca "2026-06-30 00:00:00", jam dibuang parser).
--   * Kode akun apa adanya dari file (6-60107, 1-10502, 6-60109, 2-20201, 1-10302); kelimanya ADA di
--     COA UBD (sheet 'COA UBD' di dataset/COA/COA_Clients_GOUF.xlsx) dengan nama yang sama.
--
-- HASIL UJI (fungsi parser ASLI journal_entry_import_v1.py::_parse_flat_grouped_by_voucher ke file contoh,
--   hash header cocok): 10 jurnal, 34 baris, SEMUA valid dan seimbang, tanpa nomor ganda.
--   Total debit = total kredit = 50.681.161. 20 baris bernilai 0 dilewati (PPh 21 & PPh 25 Agu-Des);
--   5 baris judul + 1 baris D/C=0 tanpa voucher dilewati.
--     * ADJ DEP FA-2026-05 dipakai di 3 tanggal (30 Jun, 31 Jul, 31 Agu), seimbang per tanggal ->
--       dipecah (split_by_date) jadi 3 jurnal 'ADJ DEP FA-2026-05-20260630' / '-20260731' / '-20260831',
--       masing-masing 210.998.
--     * ACC/PPH21/2026/001 s/d /007 -> 7 jurnal (Jan-Jul), masing-masing 4 baris.
--
-- PERLU DIPERHATIKAN (masalah di FILE SUMBER, bukan di parser):
--   * Blok "JURNAL ACCRUE PPH 25" memakai voucher yang SAMA dengan blok PPh 21 ('ACC/PPH21/2026/001'
--     dst). Akibatnya PPh 21 dan PPh 25 tiap bulan DIGABUNG jadi 1 jurnal 4 baris (Dr TAX ALLOWANCE,
--     Dr PREPAID INCOME TAX ART. 25, Cr TAX PAYABLE x2). Jurnalnya tetap seimbang dan tiap baris
--     menyimpan deskripsinya sendiri ("PPH 21 2026" / "pph 25 2026"), tetapi deskripsi header jurnal
--     = "PPH 21 2026". Kalau ingin terpisah, ganti voucher blok PPh 25 di file (mis. ACC/PPH25/2026/001)
--     -- tanpa ubah seed -- hasilnya 7 jurnal PPh 21 + 7 jurnal PPh 25.
--   * Baris Agu-Des bernilai 0 dibuat di file sebagai placeholder; begitu nominalnya diisi, jurnalnya
--     otomatis ikut ter-import (skip_zero_lines hanya melewati baris 0).
--
-- BATAS RESEP:
--   * Nomor jurnal = nilai voucher apa adanya (hasil pemecahan tanggal: <voucher>-<YYYYMMDD>).
--     Draft unik per (user, je_number): upload ulang file yang sama bentrok (disengaja, tidak ganda).
--   * Struktur HARUS tetap: nama header sama persis (hash), baris 1 = header, sheet bernama "Sheet1".
--     Perubahan header -> "Needs Review" tanpa baris. Sel kosong di ujung header tidak ikut di-hash.
--   * Kolom Tipe Transaksi Jurnal, Month, D/C, SUPPLIER/CUSTOMER, TAX MAPPING, NO. REKON, NOMOR FAKTUR,
--     CABANG, NOTES, DIBUAT PADA tidak ikut masuk ke jurnal (semuanya informasi / kosong di file contoh).
--
-- PRASYARAT KODE: journal_entry_import_v1.py versi yang mendukung opsi split_by_date / round_decimals /
-- skip_zero_lines pada format flat_grouped_by_voucher (sama dengan seed NBM).
--
-- KLIEN: dicari lewat client_code = 'UBD' (sama dengan seed sales & bank_cash UBD); GAGAL dengan pesan
-- jelas kalau belum ada di management_clients.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\journal_entry\seed_template_ubd_multi_format_journal_entry.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_je_import_templates_signature). Kalau resep
-- direvisi, hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'UBD'
--      AND t.file_type = 'Excel' AND t.column_signature_hash = 'd0bc263b435db2a7127f4a2c0ce0b8958fd2d3a835a8a1709e88f2a4b873cc45';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'UBD'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien UBD belum ada di management_clients (dicari client_code = ''UBD''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        1,
        2,
        'd0bc263b435db2a7127f4a2c0ce0b8958fd2d3a835a8a1709e88f2a4b873cc45',
        '["No", "Tipe Transaksi Jurnal", "Month", "Tanggal", "No Voucher", "Kode Akun #", "Nama Perkiraan", "Keterangan Jurnal", "Debit", "Kredit", "D/C", "SUPPLIER/CUSTOMER", "TAX MAPPING", "NO. REKON", "NOMOR FAKTUR", "CABANG", "NOTES", "DIBUAT PADA"]'::jsonb,
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Adjustment Journal UBD -- tabel Excel flat, header di baris 1, data mulai baris 2. Setiap baris = 1 journal LINE (akun + debit ATAU kredit); baris-baris dengan nilai No Voucher yang sama digabung jadi 1 draft jurnal multi-baris (voucher yang dipakai ulang di tanggal berbeda dan seimbang per tanggal dipecah per tanggal). Baris judul blok (kolom No terisi, tanpa voucher & tanpa nominal) dan baris bernilai 0 dilewati.",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Adjustment",
  "group_by": "voucher",
  "min_lines_per_group": 2,
  "split_by_date": true,
  "round_decimals": 2,
  "skip_zero_lines": true,
  "balance_tolerance": 0.01,
  "columns": {
    "tanggal": "Tanggal",
    "voucher": "No Voucher",
    "kode_akun": "Kode Akun #",
    "akun_deskripsi": "Nama Perkiraan",
    "deskripsi": "Keterangan Jurnal",
    "debit": "Debit",
    "credit": "Kredit"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "No": "hanya berisi judul blok jurnal (JURNAL ADJ DEPRESIASI ASET, ...)",
    "Tipe Transaksi Jurnal": "FA / ACCRUE, informasi",
    "Month": "nomor bulan",
    "D/C": "Debit-Kredit, hanya pengecekan",
    "SUPPLIER/CUSTOMER": "informasi",
    "TAX MAPPING": "informasi",
    "NO. REKON": "kosong di file contoh",
    "NOMOR FAKTUR": "kosong di file contoh",
    "CABANG": "kosong di file contoh",
    "NOTES": "kosong di file contoh",
    "DIBUAT PADA": "kosong di file contoh"
  },
  "catatan_analisis": "Dianalisis dari UBD_ADJUSTMENT_JOURNAL.xlsx (Sheet1, 65 baris). Lihat komentar seed."
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
-- WHERE upper(trim(m.client_code)) = 'UBD';