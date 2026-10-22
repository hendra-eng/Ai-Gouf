-- seed_template_nbm_multi_format_journal_entry.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates) untuk klien NBM
-- (PT Nawasanga Bertatap Muka), halaman Transactions > Journal Entry > Import / Source Data.
-- 1 baris template per bentuk file (parser Journal Entry mencocokkan 1 template per hash header).
--
-- SUMBER: NBM_ADJUSTMENT_JOURNAL.xlsx -- 1 sheet ("Sheet1"), 2.846 baris, 2.841 baris terisi.
-- Jurnal penyesuaian Juni - Agustus 2026: penyesuaian penerimaan bank/EDC/GrabFood/GoFood, MDR,
-- penyusutan, HPP, packaging, konsinyasi, sewa dibayar di muka, dst.
--
-- BENTUK FILE -- BEDA DARI AADL, MIRIP SAU:
--   * ADA kolom NO VOUCHER -> format_type 'flat_grouped_by_voucher' (BUKAN blank_separated_journal,
--     tidak ada pemisah baris kosong). Kolom dicari lewat NAMA header (bukan posisi).
--   * Baris 1 KOSONG, header baris 2, data mulai baris 3. Header: NO | MONTH | TANGGAL | NO VOUCHER |
--     NO AKUN | AKUN | DESKRIPSI | DEBIT | KREDIT | D/C | TRANSAKSI | CATEGORY | Notes |
--     Nomor Invoice | check (15 kolom; sel kosong di ujung header sampai kolom 27 tidak ikut di-hash).
--   * Voucher yang sama tersebar di 2 blok baris (blok akun lawan dulu, lalu blok baris bank),
--     jadi dikelompokkan per NILAI voucher, bukan per baris berurutan. Voucher bisa teks
--     ("BCA 5325-2026-6-1", "MDR...", "KK7-...", "MANUAL ...") atau angka (11141).
--   * Tanggal bertipe tanggal Excel (terbaca "2026-06-01 00:00:00", jam dibuang parser).
--
-- HASIL UJI (parser ASLI journal_entry_import_v1.py versi terbaru, dengan opsi split_by_date,
--   round_decimals, skip_zero_lines di bawah):
--   1.374 baris staging: 1.373 jurnal VALID dan seimbang (2.832 baris) + 1 baris TIDAK VALID
--   (lihat di bawah). Per bulan (jurnal valid): Jun 594, Jul 476, Agu 303. Tanpa nomor ganda.
--   Total debit 2.484.383.797,19 vs kredit 2.484.383.797,18 (selisih agregat 0,01 akibat pembulatan
--   2 desimal per baris; setiap jurnal tetap lolos toleransi 0,01). 6 baris bernilai 0 dilewati.
--
-- PERILAKU PARSER YANG DIPAKAI RESEP INI:
--   * split_by_date: 5 voucher dipakai ulang untuk jurnal berbeda tanggal -- 'CONS/MOKA/04/001'
--     (30 Jun, 31 Jul), 'MANUAL HPP 31/06/2026' (30 Jun, 31 Jul), 'MANUAL 31/05/2026' (30 Jun,
--     31 Jul, 31 Agu), 'MANUAL 31/07/2026' (31 Jul, 31 Agu), 'MANUAL' (30 Jun, 31 Jul, 20 Agu,
--     31 Agu). Semuanya seimbang per tanggal, jadi dipecah jadi 13 jurnal dengan nomor
--     <voucher>-<YYYYMMDD> (mis. 'CONS/MOKA/04/001-20260731') dan tanggal sesuai barisnya.
--     Catatan draft berisi "Source: rows a-b".
--   * round_decimals = 2: nominal per baris dibulatkan 2 desimal (file memuat pecahan panjang
--     hasil rumus, mis. 282.9771009385586).
--   * skip_zero_lines: baris debit = kredit = 0 dilewati.
--   * Baris bernilai TANPA voucher tidak lagi hilang diam-diam: baris 2078-2079 (pasangan
--     "ADJ ROUNDING" 282,98, akun 7-70004 Rounding vs 1-10007 BCA 1350838208) muncul sebagai
--     1 baris staging TIDAK VALID dengan catatan "Rows 2078-2079 have an amount but no voucher",
--     status file jadi 'Needs Review'. Baris 2844 (teks judul "Jurnal Penyesuaian Biaya dibayar di
--     Muka", tanpa nominal) tetap dilewati. Isi voucher di file supaya pasangan rounding ikut
--     ter-import.
--
-- BATAS RESEP:
--   * Kode akun apa adanya dari file ("1-10006", "6-60506", ...); posting ke buku besar
--     mensyaratkan kode itu ada di COA klien (lihat migrations/coa/seed_coa_nbm.sql).
--   * Draft unik per (user, je_number): upload ulang file yang sama bentrok (disengaja, tidak ganda).
--   * Struktur HARUS tetap: nama header sama persis (hash), baris 2 = header. Perubahan header
--     -> "Needs Review" tanpa baris.
--
-- PRASYARAT KODE: journal_entry_import_v1.py versi yang mendukung opsi split_by_date / round_decimals /
-- skip_zero_lines pada format flat_grouped_by_voucher (tanpa itu opsi diabaikan: voucher beda tanggal
-- digabung ke tanggal baris pertama dan nominal tidak dibulatkan).
--
-- KLIEN: dicari lewat nama_client IN ('NBM', 'PT NAWASANGA BERTATAP MUKA', 'PT. NAWASANGA BERTATAP MUKA')
-- (tidak peka huruf besar/kecil); GAGAL dengan pesan jelas kalau belum ada di management_clients.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\journal_entry\seed_template_nbm_multi_format_journal_entry.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_je_import_templates_signature). Kalau resep
-- direvisi, hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA', 'PT. NAWASANGA BERTATAP MUKA')
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '649e631c41a2fa25b0a9628074556b467a7af8cc5bdd6a6464cfcb4c27e7b125';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA', 'PT. NAWASANGA BERTATAP MUKA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client = NBM / PT Nawasanga Bertatap Muka). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '649e631c41a2fa25b0a9628074556b467a7af8cc5bdd6a6464cfcb4c27e7b125',
        '["NO", "MONTH", "TANGGAL", "NO VOUCHER", "NO AKUN", "AKUN", "DESKRIPSI", "DEBIT", "KREDIT", "D/C", "TRANSAKSI", "CATEGORY", "Notes", "Nomor Invoice", "check"]'::jsonb,
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Adjustment Journal NBM -- tabel Excel flat, baris 1 KOSONG, header di baris 2, data mulai baris 3. Setiap baris = 1 journal LINE (akun + debit ATAU kredit); baris-baris dengan nilai NO VOUCHER yang sama digabung jadi 1 draft jurnal multi-baris. Voucher bisa berupa teks (BCA 5325-2026-6-1, MDR..., KK7-..., MANUAL ...) atau angka (11141). Baris tanpa voucher dilewati.",
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
    "tanggal": "TANGGAL",
    "voucher": "NO VOUCHER",
    "kode_akun": "NO AKUN",
    "akun_deskripsi": "AKUN",
    "deskripsi": "DESKRIPSI",
    "debit": "DEBIT",
    "credit": "KREDIT"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "NO": "nomor urut (terisi sebagian)",
    "MONTH": "nomor bulan",
    "D/C": "Debit-Kredit, hanya pengecekan",
    "TRANSAKSI": "jenis transaksi sumber, informasi",
    "CATEGORY": "informasi",
    "Notes": "catatan reviewer",
    "Nomor Invoice": "informasi",
    "check": "pengecekan"
  },
  "catatan_analisis": "Dianalisis dari NBM_ADJUSTMENT_JOURNAL.xlsx (Sheet1, 2.846 baris). Lihat komentar seed."
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
-- WHERE upper(trim(m.nama_client)) IN ('NBM', 'PT NAWASANGA BERTATAP MUKA', 'PT. NAWASANGA BERTATAP MUKA');