-- seed_template_aadl_multi_format_journal_entry.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates) untuk klien AADL
-- (PT Akshaya Ananda Dylan Lestari), halaman Transactions > Journal Entry > Import / Source Data.
-- Mengikuti pola seed SAU (seed_template_sau_jurnal_kas_kasir_excel.sql): 1 baris template per
-- bentuk file (parser Journal Entry mencocokkan 1 template per hash header, belum ada varian "Multi").
--
-- SUMBER: AADL_ADJUSTMENT_JOURNAL.xlsx -- 1 sheet ("Sheet1"), 452 baris, 361 baris terisi.
-- Jurnal penyesuaian (adjusting entries) Maret - Agustus 2026: reklas piutang/uang muka, penyusutan
-- per cabang, accrue pajak daerah & bunga deposito, BPJS, commission fee, amortisasi, dst.
--
-- BENTUK FILE -- BEDA DARI SAU:
--   * TIDAK ada kolom VOUCHER/nomor jurnal. 1 jurnal = blok baris berurutan yang dipisah baris
--     KOSONG; baris judul blok = kolom A terisi, kode akun kosong ("JURNAL PENYUSUTAN OMAH
--     SOEMANTRI JUNI2026"). Karena itu dipakai format_type BARU 'blank_separated_journal'
--     (journal_entry_import_v1.py), bukan 'flat_grouped_by_voucher'.
--   * Header baris 1, data mulai baris 2 (baris 2 kosong). Label header TIDAK sejajar dengan isi:
--     isi kolom sebenarnya (posisi 1-based) =
--       1 judul jurnal (hanya di baris judul) | 2 KODE akun (header "Keterangan COA")
--       3 NAMA akun (header "Bank")           | 4 Bank / sumber kas: MANUAL, "Bank BCA 600",
--       "Petty Cash - Omah Soemantri", ... (header "Month") | 5 nomor bulan | 6 tanggal |
--       7 keterangan | 8 DEBIT | 9 KREDIT | 10 Balance (Debit-Kredit, hanya pengecekan di file,
--       tanda tidak konsisten) -- sehingga kolom dibaca lewat POSISI, bukan nama header.
--   * Kode akun = kode COA AADL: "000.11004101" (Piutang Usaha), "003.37001101" (Biaya Penyusutan
--     Inventaris - Omah), dst, plus kode khusus penyesuaian "AUD-1" (Uang Muka Pelanggan),
--     "AUD-2" (Utang Lain-Lain), "AUD-5", "AUD-9", "AUD-10". Kode apa adanya dari file; posting
--     ke buku besar mensyaratkan kode itu ada di COA klien (COA AADL belum ada di repo).
--
-- CARA APLIKASI MEMBACA:
--   1. Template cocok lewat hash baris header (sheet "Sheet1"). Sel kosong di ujung baris header
--      tidak ikut di-hash (lebar sheet bisa berubah). Hash:
--        0f78392b6f18fb89849c368c7b857769f76b4dfd8b9ee4893c587ef1c6fd18c1
--   2. Tiap blok -> 1 draft jurnal. Deskripsi jurnal = judul blok. Blok TANPA judul (11 blok,
--      lanjutan jurnal yang sama setelah baris kosong) memakai judul blok sebelumnya.
--   3. Blok yang berisi beberapa TANGGAL dan seimbang per tanggal DIPECAH jadi 1 jurnal per tanggal
--      (11 blok di file contoh semuanya seimbang per tanggal -> 26 jurnal). Kalau tidak seimbang per
--      tanggal, tetap 1 jurnal bertanggal paling akhir + catatan. Tanggal ber-jam ("2026-08-27
--      08:32:34") dibaca tanggalnya saja.
--   4. Baris bernilai 0/kosong dilewati (13 baris, mis. placeholder "Biaya Transfer"); blok yang
--      semuanya 0 dilewati. Nominal dibulatkan 2 desimal (file memuat pecahan seperti
--      16928657.13541667 dari rumus penyusutan).
--   5. Nomor jurnal: AADL-ADJ-<YYYYMM tanggal jurnal>-<urut per bulan>, mis. AADL-ADJ-202606-003
--      (file tidak punya nomor). Catatan draft berisi "Source: rows 12-15" (baris di file) dan
--      keterangan pemecahan/judul turunan. Kolom Bank (4) tidak dipakai (informasi di file).
--   6. source_type = "Import - Adjustment", mata uang IDR.
--
-- HASIL UJI (kode parser ASLI journal_entry_import_v1.py ke file contoh):
--   106 jurnal (91 blok -> 26 hasil pemecahan), 264 baris, SEMUA valid dan seimbang, tanpa nomor
--   ganda. Total debit = total kredit = 639.208.825,34 (selisih 0,02 dari jumlah mentah file
--   639.208.825,32 karena pembulatan 2 desimal per baris). Per bulan jurnal: Mar 1, Apr 2, Mei 4,
--   Jun 43, Jul 27, Agu 29.
--   Parser SAU (flat_grouped_by_voucher) diuji ulang dengan kode yang sama: 1.193 jurnal, hasil sama.
--
-- BATAS RESEP:
--   * Struktur HARUS tetap: baris header sama persis (hash), kolom di posisi yang sama, jurnal
--     dipisah baris kosong, judul di kolom A. Perubahan header -> "Needs Review" tanpa baris.
--   * Nomor jurnal bergantung urutan blok per bulan. Draft Journal Entry unik per (user, je_number):
--     meng-upload file lain yang berisi bulan yang sama menghasilkan nomor bentrok (dilewati saat
--     Create Journal). Upload ulang file yang sama juga bentrok -- itu disengaja (tidak ganda).
--   * Jurnal bertanggal bulan yang belum ditutup mengikuti tanggal di file; periode ditentukan dari
--     tanggal itu.
--
-- KLIEN: dicari lewat nama_client ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI' atau 'PT. ...',
-- tidak peka huruf besar/kecil); GAGAL dengan pesan jelas kalau belum ada di management_clients.
--
-- PRASYARAT KODE: journal_entry_import_v1.py versi yang memuat format_type blank_separated_journal
-- (patch je_blank_separated_journal.patch). Tanpa itu, upload memunculkan "format_type ... belum
-- didukung".
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\journal_entry\seed_template_aadl_multi_format_journal_entry.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_je_import_templates_signature). Kalau resep
-- direvisi, hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI', 'PT. AKSHAYA ANANDA DYLAN LESTARI')
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '0f78392b6f18fb89849c368c7b857769f76b4dfd8b9ee4893c587ef1c6fd18c1';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI', 'PT. AKSHAYA ANANDA DYLAN LESTARI')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien AADL belum ada di management_clients (dicari nama_client = AADL / PT Akshaya Ananda Dylan Lestari). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '0f78392b6f18fb89849c368c7b857769f76b4dfd8b9ee4893c587ef1c6fd18c1',
        '["COA", "Keterangan COA", "Bank", "Month", "Tanggal Transaksi", "Keterangan", "Debit", "Kredit", "Balance", "Check Weda"]'::jsonb,
        $json${
  "format_type": "blank_separated_journal",
  "description": "Adjustment Journal AADL -- tabel Excel TANPA kolom voucher: 1 jurnal = blok baris yang dipisah baris kosong; baris judul (kolom A terisi, kode akun kosong) = nama jurnal. Kolom dibaca lewat POSISI (1-based) karena label header di file tidak sejajar dengan isinya (header 'Keterangan COA' berada di atas kolom KODE akun, 'Bank' di atas NAMA akun, dst).",
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
    "kode_akun": 2,
    "akun_deskripsi": 3,
    "bank": 4,
    "bulan": 5,
    "tanggal": 6,
    "deskripsi": 7,
    "debit": 8,
    "credit": 9
  },
  "ignore_columns": {
    "4": "Bank / sumber kas (MANUAL, Bank BCA 600, Petty Cash - ...) -- hanya informasi",
    "5": "nomor bulan",
    "10": "Balance (Debit - Kredit, hanya pengecekan di file; tanda tidak konsisten)"
  },
  "je_number_prefix": "AADL-ADJ",
  "split_by_date": true,
  "skip_zero_lines": true,
  "round_decimals": 2,
  "balance_tolerance": 0.01,
  "min_lines_per_group": 2,
  "catatan_analisis": "Dianalisis dari AADL_ADJUSTMENT_JOURNAL.xlsx (Sheet1, 452 baris). Lihat komentar seed."
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
-- WHERE upper(trim(m.nama_client)) IN ('AADL', 'PT AKSHAYA ANANDA DYLAN LESTARI', 'PT. AKSHAYA ANANDA DYLAN LESTARI');