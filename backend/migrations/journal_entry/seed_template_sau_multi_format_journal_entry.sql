-- seed_template_sau_multi_format_journal_entry.sql
-- =============================================================
-- Template pola kolom (financial_transaction_journal_entry_import_templates) untuk klien SAU
-- (CV Sumber Alodie Utama), halaman Transactions > Journal Entry > Import / Source Data.
-- Mengikuti pola seed NBM. 1 baris template per bentuk file (parser Journal Entry mencocokkan 1
-- template per hash header; belum ada varian "Multi" seperti di Sales/Purchase), jadi file ini
-- berisi 5 INSERT -- satu per file sumber. 4 pertama format 'flat_grouped_by_voucher'; yang ke-5
-- (rekap gaji) format BARU 'month_matrix_journal'.
--
-- SUMBER (periode Agustus 2026; rekap gaji Januari - Mei 2026). Kolom flat dicari lewat NAMA header:
--   [1] SAU_Jurnal_Kas_Kasir_202608_Mega.xlsx -- sheet "Sheet1", baris 1 = total kontrol (DR/CR/D-C),
--       header baris 2, data mulai baris 3. Header: No | MONTH | TANGGAL | JENIS TRANSAKSI | DEPARTEMEN |
--       KODE AKUN | AKUN DEKSRIPSI | KODE TRANSAKSI | NAMA  SUPPLIER/CUSTOMER | DESKRIPSI | DR | CR | D/C |
--       VOUCHER | VOC BANTU (15 kolom). Kunci jurnal = VOUCHER (CASH-2026-8-1, ...).
--   [2] 1_3_SAU_Cash_Receipt_and_Payment_Journal_202608_Mega.xlsx -- sheet "GL" (sheet "COA" dan
--       "Sheet1" = tabel bantu, TIDAK dipakai). Baris 1 = total kontrol, header baris 2, data baris 3.
--       Kolom B header KOSONG (tetap ikut hash). Header: No | (kosong) | TANGGAL | JENIS TRANSAKSI |
--       DEPARTEMEN | KODE AKUN | AKUN DEKSRIPSI | KODE TRANSAKSI | NAMA  SUPPLIER/CUSTOMER | DESKRIPSI |
--       DR | CR | D/C | VOUCHER (14 kolom). Kunci jurnal = VOUCHER (BRI-2608-1, ...). Voucher yang sama
--       tersebar di 2 blok (baris bank, lalu baris akun lawan) -> dikelompokkan per NILAI voucher.
--       Baris judul blok ("JURNAL PENERIMAAN BANK BRI", dst) tanpa voucher & tanpa nominal dilewati.
--   [3] 1_3_SAU_Jurnal_Accrue__Keluar_Selain_Persediaan_Mega.xlsx -- sheet "AP Non Barang Dagang" (sheet
--       "COA" tidak dipakai). Baris 1 = total kontrol, header baris 2 (kolom B kosong), data baris 3.
--       Sama dengan [2] + 2 kolom di ujung: NO REKON | NOTES KLIEN (16 kolom). Kunci jurnal = VOUCHER
--       (AP-ACC-BCA-2608-1, ...). Baris judul bank ("BANK BCA/BRI/MANDIRI") dilewati.
--   [4] SAU_Jurnal_Sales_202608_roy.xlsx -- sheet "Jurnal sales" (sheet "COA" tidak dipakai). Baris 1 =
--       total kontrol, header baris 2, data baris 3. Header: TANGGAL | JENIS TRANSAKSI | DEPARTEMEN |
--       KODE AKUN | AKUN DEKSRIPSI | KODE TRANSAKSI | NAMA  SUPPLIER/CUSTOMER | DESKRIPSI TRANSAKSI |
--       DR | CR | D/C | No Rekon | No Bantu (13 kolom). TIDAK ada kolom voucher: kunci jurnal = KODE
--       TRANSAKSI (nomor struk kasir KSR-0065719-26 / JL-0014073-26) -> 1 struk = 1 jurnal multi-baris
--       (Piutang Usaha, Pajak Keluaran, Penjualan per item). Kolom "No Bantu" (25.908 nilai) SENGAJA tidak
--       dipakai sebagai kunci: itu memecah 1 struk jadi banyak jurnal kecil.
--       Sheet "Jurnal sales pribadi" (header IDENTIK, jenis "Manual", dept "Pribadi", Piutang Usaha vs Hutang
--       kepada Pemegang Saham) ikut diekstrak lewat mapping_rules.extra_sheets: resep sama, nomor jurnal
--       diberi awalan "PRB-" (3.178 nomor struknya juga ada di sheet utama), source_type "Import - Pribadi".
--       Satu template = satu hash header, jadi sheet pribadi TIDAK punya baris template sendiri.
--   [5] REKAP_GAJI_SAU_2026_10-06-2026.xlsx -- sheet "Summry Jurnal Gaji 2026", blok "JURNAL GAJI" (sheet
--       bulanan JANUARI..MEI dan sheet tersembunyi TIDAK dipakai). Header baris 37 = JURNAL GAJI | DEBIT |
--       KREDIT | DEBIT | KREDIT ... (pasangan per bulan), baris 38 = nomor bulan 1-12, data mulai baris 39.
--       Matriks: kolom A = nama akun. Tidak ada tanggal & kode akun di file -> format_type
--       'month_matrix_journal': tanggal = akhir bulan, tahun dari nama sheet ("... 2026"), kode akun lewat
--       mapping_rules.account_map. 4 blok (dipisah baris label kosong): BIAYA GAJI..UTANG GAJI, BPJS KES,
--       BPJS TK, Tunjangan Pajak PPH 21; 1 blok x 1 bulan = 1 jurnal GAJI-<YYYYMM>-<urut blok>.
--
-- HASIL UJI (jalur kode ASLI endpoint upload: _ekstrak_dengan_sheet_tambahan -> parser; fungsi baca file,
--   hash header, tanggal & angka dari sales_import_v1 dijalankan ke ke-5 file contoh; hash header cocok).
--   SEMUA jurnal valid & seimbang, tanpa nomor ganda, semua nomor <= 100 karakter dan source_type <= 20
--   karakter (batas kolom):
--     [1] Kas Kasir      : 1.193 jurnal (2.386 baris)   total debit = kredit = 12.926.223.584
--     [2] Cash Rcpt/Pay  : 1.998 jurnal (3.996 baris)   total debit = kredit = 31.161.465.482 (0,01 selisih
--                          pembulatan 2 desimal per baris); 7 baris judul/nomor urut dilewati
--     [3] Accrue AP      : 35 jurnal (70 baris)         total debit = kredit = 40.647.878; 3 baris judul dilewati
--     [4] Sales          : 8.409 jurnal sheet utama (67.566 baris) total 12.457.304.000 + 5.907 jurnal
--                          sheet pribadi (PRB-...) total 1.983.802.735 = 14.316 jurnal, total 14.441.106.735;
--                          10.158 baris bernilai 0 (Pajak Keluaran 0) dilewati; struk JL-0014073-26 semua
--                          barisnya 0 -> tidak dibuat jurnal
--     [5] Rekap Gaji     : 20 jurnal (5 bulan x 4 blok), total debit = kredit = 2.075.810.615,67; Jan 31 -
--                          Mei 31 2026; bulan 6-12 masih kosong di file -> belum ada jurnal
--   Total debit file [1]-[4] sama dengan angka kontrol di baris 1 file sumbernya; jurnal gaji sama dengan blok
--   JURNAL GAJI (BIAYA GAJI per bulan 341.871.097 / 356.118.257 / 562.213.129,67 / 343.402.990 / 341.743.845).
--   Semua kode akun di keempat file jurnal ADA di COA SAU (migrations/coa/seed_coa_sau.sql, 95 akun) dengan
--   nama yang sama; kode di account_map rekap gaji juga ada di COA tsb.
--
-- PERLU KONFIRMASI AKUNTAN -- account_map rekap gaji (file hanya memuat NAMA akun, bukan kode; pemetaan
--   diambil dari pemakaian akun di jurnal Agustus 2026: bayar BPJS -> 21300002, bayar PPh 21 -> 21400002,
--   kasbon -> 11300002). Ubah di JSON seed lalu hapus-dan-seed ulang bila beda:
--     BIAYA GAJI -> 52010001 | Cicilan Pinjaman, Pot. Kasbon Langsung, Kasbon Langsung -> 11300002 PIUTANG
--     KARYAWAN | Income Tax PPH 21 / CASH BON, Koreksi Pot. PPH -> 21400002 HUTANG PAJAK 21 | UTANG GAJI ->
--     21300001 | BPJS KES & BPJS TK (debit) -> 52010003 BIAYA JAMSOSTEK, UTANG (kredit) -> 21300002 |
--     Tunjangan Pajak pph 21 -> 52010001 | Utang Pajak pph 21 -> 21400002.
--   Label yang tidak ada di account_map TIDAK hilang diam-diam: jurnalnya muncul TIDAK VALID di File Preview.
--
-- BATAS RESEP:
--   * Nomor jurnal = nilai kunci apa adanya (struk: maks. 21 karakter). Draft unik per (klien, je_number):
--     upload ulang file yang sama bentrok (disengaja, tidak ganda). Rekap gaji memuat SEMUA bulan terisi tiap
--     upload, jadi upload bulan berikutnya akan bentrok pada bulan yang sudah di-Create Journal (dilewati).
--   * Struktur HARUS tetap: nama header sama persis (hash), nama sheet sama, posisi baris header sama.
--     Perubahan header -> "Needs Review" tanpa baris. Sel kosong di ujung header tidak ikut di-hash. Sheet
--     pribadi dengan header beda -> 1 baris TIDAK VALID, bukan hilang diam-diam.
--   * Rekap gaji: nama sheet memuat tahun (2026). File tahun berikutnya dengan nama sheet lain tidak
--     tercocok (hash header sama dgn template ini -> UBAH sheet_name template, jangan insert baru) atau isi
--     mapping_rules.year.
--   * Kolom DR/CR dibulatkan 2 desimal per baris (round_decimals), toleransi seimbang 0,01.
--
-- PRASYARAT KODE (journal_entry_import_v1.py versi terbaru): opsi split_by_date / round_decimals /
-- skip_zero_lines pada flat_grouped_by_voucher (sama dengan seed NBM) + BARU: format_type
-- 'month_matrix_journal' dan opsi resep 'extra_sheets'. Tanpa versi ini seed [4]-pribadi diabaikan dan seed
-- [5] ditolak ("format_type ... belum didukung").
--
-- KLIEN: dicari lewat client_code = 'SAU' ATAU nama_client IN ('SAU', 'CV SUMBER ALODIE UTAMA') (tidak
-- peka huruf besar/kecil); GAGAL dengan pesan jelas kalau belum ada di management_clients.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\journal_entry\seed_template_sau_multi_format_journal_entry.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_je_import_templates_signature; karena 1 blok DO,
-- gagal = tidak ada baris yang masuk). Kalau resep direvisi, hapus dulu barisnya:
--   DELETE FROM financial_transaction_journal_entry_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND (upper(trim(c.client_code)) = 'SAU' OR upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '97980aee7332c0998820e472a23c4eb1738403517194903a3276cfc280a66276';  -- kas_kasir
--    WHERE t.client_id = c.id AND (upper(trim(c.client_code)) = 'SAU' OR upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '9eed7e599fbc03be3db8dfe6bde87ea45a9c9ff4ea148ed1140c8ae3fc5fb717';  -- cash_receipt_payment
--    WHERE t.client_id = c.id AND (upper(trim(c.client_code)) = 'SAU' OR upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = 'edfba5ada6e5e92e27c98a79834ba6982e985b1ff050b46fe8cc8220ba7ed659';  -- accrue_ap
--    WHERE t.client_id = c.id AND (upper(trim(c.client_code)) = 'SAU' OR upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = 'f738dc176c3f26548b7ec17e0d904b4843e922129ee896fa0d5be539becd06ef';  -- sales
--    WHERE t.client_id = c.id AND (upper(trim(c.client_code)) = 'SAU' OR upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
--      AND t.file_type = 'Excel' AND t.column_signature_hash = '4805b65bb0f71080518713ae37262386912738daa802d3aebb9066174a8f9936';  -- payroll

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND (upper(trim(client_code)) = 'SAU' OR upper(trim(nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA'))
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari client_code = SAU atau nama_client = SAU / CV Sumber Alodie Utama). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- [1] SAU_Jurnal_Kas_Kasir_*.xlsx -- sheet "Sheet1" (Jurnal Kas Kasir)
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
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Jurnal Kas Kasir SAU -- tabel Excel flat, baris 1 berisi total kontrol (kolom DR/CR/D-C), header di baris 2, data mulai baris 3. Setiap baris = 1 journal LINE (akun + DR ATAU CR); baris dengan nilai VOUCHER yang sama (CASH-2026-8-1, ...) digabung jadi 1 draft jurnal. Kolom dicari lewat NAMA header.",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Kas Kasir",
  "group_by": "voucher",
  "min_lines_per_group": 2,
  "split_by_date": true,
  "round_decimals": 2,
  "skip_zero_lines": true,
  "balance_tolerance": 0.01,
  "columns": {
    "tanggal": "TANGGAL",
    "voucher": "VOUCHER",
    "kode_akun": "KODE AKUN",
    "akun_deskripsi": "AKUN DEKSRIPSI",
    "deskripsi": "DESKRIPSI",
    "debit": "DR",
    "credit": "CR"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "No": "nomor urut",
    "MONTH": "nomor bulan",
    "JENIS TRANSAKSI": "jenis transaksi sumber (CASH), informasi",
    "DEPARTEMEN": "informasi",
    "KODE TRANSAKSI": "informasi (kosong)",
    "NAMA  SUPPLIER/CUSTOMER": "informasi",
    "D/C": "Debit-Kredit, hanya pengecekan",
    "VOC BANTU": "voucher bantu, informasi"
  }
}$json$::jsonb,
        'manual',
        true,
        0
    );

    -- [2] SAU_Cash_Receipt_and_Payment_Journal_*.xlsx -- sheet "GL" (penerimaan & pembayaran bank)
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
        'GL',
        2,
        3,
        '9eed7e599fbc03be3db8dfe6bde87ea45a9c9ff4ea148ed1140c8ae3fc5fb717',
        '["No", "", "TANGGAL", "JENIS TRANSAKSI", "DEPARTEMEN", "KODE AKUN", "AKUN DEKSRIPSI", "KODE TRANSAKSI", "NAMA  SUPPLIER/CUSTOMER", "DESKRIPSI", "DR", "CR", "D/C", "VOUCHER"]'::jsonb,
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Cash Receipt and Payment Journal SAU (penerimaan & pembayaran bank BRI/Mandiri/BCA) -- sheet GL, baris 1 berisi total kontrol, header di baris 2, data mulai baris 3. Kolom B header KOSONG (di baris judul blok kolom B/C berisi teks judul, mis. 'JURNAL PENERIMAAN BANK BRI'). 1 baris = 1 journal LINE; voucher yang sama (BRI-2608-1, ...) tersebar di 2 blok (baris bank & baris akun lawan) dan digabung per NILAI voucher. Baris judul blok / nomor urut tanpa voucher & tanpa nominal dilewati. Sheet lain (COA, Sheet1 = tabel bantu) diabaikan.",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Cash Bank",
  "group_by": "voucher",
  "min_lines_per_group": 2,
  "split_by_date": true,
  "round_decimals": 2,
  "skip_zero_lines": true,
  "balance_tolerance": 0.01,
  "columns": {
    "tanggal": "TANGGAL",
    "voucher": "VOUCHER",
    "kode_akun": "KODE AKUN",
    "akun_deskripsi": "AKUN DEKSRIPSI",
    "deskripsi": "DESKRIPSI",
    "debit": "DR",
    "credit": "CR"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "No": "nomor urut / judul blok",
    "JENIS TRANSAKSI": "RECEIVABLE / PAYMENT, informasi",
    "DEPARTEMEN": "nama bank, informasi",
    "KODE TRANSAKSI": "informasi",
    "NAMA  SUPPLIER/CUSTOMER": "informasi (EDC, nama pelanggan)",
    "D/C": "Debit-Kredit, hanya pengecekan"
  }
}$json$::jsonb,
        'manual',
        true,
        0
    );

    -- [3] SAU_Jurnal_Accrue_Keluar_Selain_Persediaan_*.xlsx -- sheet "AP Non Barang Dagang"
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
        'AP Non Barang Dagang',
        2,
        3,
        'edfba5ada6e5e92e27c98a79834ba6982e985b1ff050b46fe8cc8220ba7ed659',
        '["No", "", "TANGGAL", "JENIS TRANSAKSI", "DEPARTEMEN", "KODE AKUN", "AKUN DEKSRIPSI", "KODE TRANSAKSI", "NAMA  SUPPLIER/CUSTOMER", "DESKRIPSI", "DR", "CR", "D/C", "VOUCHER", "NO REKON", "NOTES KLIEN"]'::jsonb,
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Jurnal Accrue pengeluaran selain persediaan SAU -- sheet 'AP Non Barang Dagang', baris 1 total kontrol, header di baris 2 (kolom B header KOSONG), data mulai baris 3. 1 baris = 1 journal LINE (beban/aset vs HUTANG USAHA); voucher yang sama (AP-ACC-BCA-2608-1, ...) digabung jadi 1 draft jurnal. Baris judul bank ('BANK BCA', 'BANK BRI', 'BANK MANDIRI') tanpa voucher & nominal dilewati.",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Accrual",
  "group_by": "voucher",
  "min_lines_per_group": 2,
  "split_by_date": true,
  "round_decimals": 2,
  "skip_zero_lines": true,
  "balance_tolerance": 0.01,
  "columns": {
    "tanggal": "TANGGAL",
    "voucher": "VOUCHER",
    "kode_akun": "KODE AKUN",
    "akun_deskripsi": "AKUN DEKSRIPSI",
    "deskripsi": "DESKRIPSI",
    "debit": "DR",
    "credit": "CR"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "No": "nomor urut",
    "JENIS TRANSAKSI": "Accure Persediaan Non Barang Dagang, informasi",
    "DEPARTEMEN": "informasi",
    "KODE TRANSAKSI": "informasi (kosong)",
    "NAMA  SUPPLIER/CUSTOMER": "informasi",
    "D/C": "Debit-Kredit, hanya pengecekan",
    "NO REKON": "nomor rekonsiliasi bank, informasi",
    "NOTES KLIEN": "catatan klien"
  }
}$json$::jsonb,
        'manual',
        true,
        0
    );

    -- [4] SAU_Jurnal_Sales_*.xlsx -- sheet "Jurnal sales" (+ sheet "Jurnal sales pribadi" lewat extra_sheets)
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
        'Jurnal sales',
        2,
        3,
        'f738dc176c3f26548b7ec17e0d904b4843e922129ee896fa0d5be539becd06ef',
        '["TANGGAL", "JENIS TRANSAKSI", "DEPARTEMEN", "KODE AKUN", "AKUN DEKSRIPSI", "KODE TRANSAKSI", "NAMA  SUPPLIER/CUSTOMER", "DESKRIPSI TRANSAKSI", "DR", "CR", "D/C", "No Rekon", "No Bantu"]'::jsonb,
        $json${
  "format_type": "flat_grouped_by_voucher",
  "description": "Jurnal Sales SAU (kasir CRS/NGY/PCL/OL) -- sheet 'Jurnal sales', baris 1 total kontrol, header di baris 2, data mulai baris 3. TIDAK ada kolom VOUCHER: nomor struk kasir di kolom KODE TRANSAKSI (KSR-0065719-26) dipakai sebagai kunci jurnal (1 struk = 1 jurnal multi-baris: Piutang Usaha / Pajak Keluaran / Penjualan per item). Baris Pajak Keluaran bernilai 0 dilewati. Sheet 'COA' tidak diimpor. Sheet 'Jurnal sales pribadi' (header identik) ikut diekstrak lewat extra_sheets dengan awalan nomor jurnal PRB- (karena 3.178 nomor struknya juga ada di sheet utama).",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Sales",
  "group_by": "voucher",
  "min_lines_per_group": 2,
  "split_by_date": true,
  "round_decimals": 2,
  "skip_zero_lines": true,
  "balance_tolerance": 0.01,
  "columns": {
    "tanggal": "TANGGAL",
    "voucher": "KODE TRANSAKSI",
    "kode_akun": "KODE AKUN",
    "akun_deskripsi": "AKUN DEKSRIPSI",
    "deskripsi": "DESKRIPSI TRANSAKSI",
    "debit": "DR",
    "credit": "CR"
  },
  "je_number_source": "voucher",
  "entry_date_source": "tanggal",
  "description_source": "deskripsi",
  "account_code_source": "kode_akun",
  "account_name_source": "akun_deskripsi",
  "debit_source": "debit",
  "credit_source": "credit",
  "ignore_columns": {
    "JENIS TRANSAKSI": "Sales, informasi",
    "DEPARTEMEN": "cabang/outlet (CRS, NGY, PCL, OL), informasi",
    "NAMA  SUPPLIER/CUSTOMER": "informasi",
    "D/C": "Debit-Kredit, hanya pengecekan",
    "No Rekon": "nomor rekonsiliasi, informasi (kosong)",
    "No Bantu": "nomor urut bantu per baris penjualan, informasi"
  },
  "extra_sheets": [
    {
      "sheet_name": "Jurnal sales pribadi",
      "je_number_prefix": "PRB-",
      "source_type": "Import - Pribadi"
    }
  ]
}$json$::jsonb,
        'manual',
        true,
        0
    );

    -- [5] REKAP_GAJI_SAU_*.xlsx -- sheet "Summry Jurnal Gaji 2026" (blok JURNAL GAJI, format month_matrix_journal)
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
        'Summry Jurnal Gaji 2026',
        37,
        39,
        '4805b65bb0f71080518713ae37262386912738daa802d3aebb9066174a8f9936',
        '["JURNAL GAJI", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT", "DEBIT", "KREDIT"]'::jsonb,
        $json${
  "format_type": "month_matrix_journal",
  "description": "Rekap Gaji SAU -- blok 'JURNAL GAJI' di sheet 'Summry Jurnal Gaji 2026' (sheet bulanan JANUARI..MEI dan sheet tersembunyi tidak dipakai). Matriks: kolom A = nama akun, kolom B.. berpasangan DEBIT/KREDIT per bulan 1-12 (header baris 37 = teks DEBIT/KREDIT, baris 38 = nomor bulan, data mulai baris 39). Blok akun dipisah baris label kosong (BIAYA GAJI..UTANG GAJI, BPJS KES, BPJS TK, Tunjangan Pajak PPH 21); 1 blok x 1 bulan = 1 jurnal bertanggal akhir bulan. File tidak memuat kode akun: dipetakan lewat account_map (label -> kode COA SAU). Tahun diambil dari nama sheet.",
  "source_kind": "excel_sheet",
  "number_format": {
    "thousands_separator": ",",
    "decimal_separator": "."
  },
  "date_format": "YYYY-MM-DD",
  "currency_default": "IDR",
  "source_type_default": "Import - Payroll",
  "min_lines_per_group": 2,
  "round_decimals": 2,
  "balance_tolerance": 0.01,
  "label_column": 1,
  "entry_date_rule": "month_end",
  "je_number_prefix": "GAJI",
  "description_prefix": "Jurnal Gaji",
  "account_map": {
    "BIAYA GAJI": {
      "code": "52010001",
      "name": "BIAYA GAJI"
    },
    "Cicilan Pinjaman": {
      "code": "11300002",
      "name": "PIUTANG KARYAWAN"
    },
    "Pot. Kasbon Langsung": {
      "code": "11300002",
      "name": "PIUTANG KARYAWAN"
    },
    "Kasbon Langsung": {
      "code": "11300002",
      "name": "PIUTANG KARYAWAN"
    },
    "Income Tax, PPH 21 / CASH BON": {
      "code": "21400002",
      "name": "HUTANG PAJAK 21"
    },
    "Koreksi Pot. PPH Bulan Maret & THR 2026": {
      "code": "21400002",
      "name": "HUTANG PAJAK 21"
    },
    "UTANG GAJI": {
      "code": "21300001",
      "name": "BIAYA YMH DIBAYAR GAJI"
    },
    "BPJS KES": {
      "code": "52010003",
      "name": "BIAYA JAMSOSTEK"
    },
    "BPJS KES|UTANG": {
      "code": "21300002",
      "name": "BIAYA YMH DIBAYAR JAMSOSTEK"
    },
    "BPJS TK": {
      "code": "52010003",
      "name": "BIAYA JAMSOSTEK"
    },
    "BPJS TK|UTANG": {
      "code": "21300002",
      "name": "BIAYA YMH DIBAYAR JAMSOSTEK"
    },
    "Tunjangan Pajak pph 21": {
      "code": "52010001",
      "name": "BIAYA GAJI"
    },
    "Utang Pajak pph 21": {
      "code": "21400002",
      "name": "HUTANG PAJAK 21"
    }
  },
  "catatan_analisis": "Pemetaan akun (account_map) adalah asumsi dari pemakaian akun di jurnal Agustus 2026 (bayar BPJS -> 21300002, bayar PPh 21 -> 21400002, kasbon -> 11300002) -- konfirmasi ke akuntan SAU."
}$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan (harus 5 baris):
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.sheet_name, t.header_row_index,
--        t.data_start_row_index, t.column_signature_hash, t.detected_by, t.is_active, t.mapping_rules->>'format_type' AS format_type
-- FROM financial_transaction_journal_entry_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE upper(trim(m.client_code)) = 'SAU' OR upper(trim(m.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA');