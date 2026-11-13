-- seed_template_birawa_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien BIRAWA / BRW (PT BINA RANCANG WASESA). SATU baris setting ("Multi") untuk
-- halaman Transactions > Sales > Source Data, dengan SATU varian Excel: register
-- tagihan manual "DETAIL INVOICE 2026 & PPN".
--
-- REVISI 2026-11-08 (upload file BRW masih error / "Butuh Review"):
--   1. Klien tidak ketemu: seed lama mencari nama_client 'PT BINA RANCANG WASISA', padahal
--      di database tertulis 'PT BINA RANCANG WASESA' -> seed RAISE, template tidak pernah
--      masuk. Sekarang kedua ejaan diterima (tetap berhenti kalau >1 klien aktif cocok).
--   2. Parser format_type "monthly_block_invoice_register" belum ada di sales_import_v1.py
--      branch ini (seed datang dari playground-hendra tanpa parsernya) -> sudah di-port
--      (bagian 3d sales_import_v1.py). Seed ini butuh kode tersebut.
--   3. File Juni "(Revisi)" judul kolom "Klasifikasi" di baris header KOSONG -> hash header
--      beda. Resep sekarang punya cadangan "cocok_jika_kolom_ada" (cocok kalau kolom BULAN,
--      NO INVOICE, BEBAN, NILAI INVOICE, PPN(11%) ada di baris header) dan
--      "header_cari_dalam_baris" (header boleh bergeser beberapa baris).
--   4. Akun jurnal: kode akun di seed lama (140001 Piutang - ASF, 411001 Pendapatan Jasa - ASF,
--      246001, 149999, 481001, dst) TIDAK ADA di COA BRW di database -- bahkan sebagian kode
--      dipakai akun lain (140005 = Inventories 2, 140009 = Prepayment 2). Peta per pelanggan
--      (pendapatan/piutang_account_by_cabang) DIHAPUS; default sekarang memakai akun standar
--      yang ada di COA BRW (lihat "AKUN JURNAL" di bawah).
--
-- FILE CONTOH (dataset/Sales/Birawa/):
--   Juni/DETAIL INVOICE 2026 & PPN (Revisi).xlsx  -> header baris 2, "Klasifikasi" kosong
--   Juli/DETAIL INVOICE 2026 & PPN (1) jun.xlsx    -> header baris 2 (hash = varian)
--   Agustus/DETAIL INVOICE 2026 & PPN.xlsx          -> header baris 2 (hash = varian)
--   Workbook: Sheet1 (register, DIBACA), Sheet2 / sheet / Sheet3 (pivot & rekap, ada #REF!,
--   TIDAK dibaca). Sheet1 = 12 blok bulan Jan-Des 2026; tiap blok = baris header (diulang),
--   1 baris per invoice, baris kosong. Kolom A kosong (kolom_awal = 2). Kolom BULAN berisi
--   tanggal 1 bulan itu (file Agustus: hanya di baris pertama blok; Juni/Juli: tiap baris) --
--   parser membawa nilai terakhir ke baris di bawahnya.
--   Kolom yang dipakai: BULAN | NO INVOICE | BEBAN (pelanggan) | NILAI INVOICE | PPN(11%).
--
-- PENTING -- FILE BERSIFAT KUMULATIF: tiap file memuat SEMUA bulan sampai bulan itu (file
--   Agustus juga berisi invoice Jan-Jul). Upload file bulan berikutnya akan mengekstrak ulang
--   invoice lama; saat "promote" ke invoice, nomor invoice yang sudah ada otomatis DILEWATI
--   (tidak dobel). Nomor invoice dipakai apa adanya ("No.001/..." dan "No. 003/..." beda).
--
-- HASIL PARSING (resep ini + parser sales_import_v1.py, dijalankan ke 3 file contoh):
--   semua baris VALID, tanpa nomor invoice ganda, di tiap invoice dpp + ppn = total persis.
--     Juni (Revisi): 153 invoice Jan-Jun  TOTAL 48.538.857.783,81 (PPN 252.682.503,47)
--     Juli         : 176 invoice Jan-Jul  TOTAL 57.818.765.683,65 (PPN 300.471.539,22)
--     Agustus      : 202 invoice Jan-Agu  TOTAL 68.373.710.583,46 (PPN 354.014.796,41)
--   Per bulan: Jan 22, Feb 25, Mar 29, Apr 24, Mei 25, Jun 28, Jul 23, Agu 26.
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. Upload di Sales > Source Data dengan klien BRW aktif.
--   2. Backend membuka sheet "Sheet1" (tidak peka huruf besar/kecil), ambil baris header ke-2
--      mulai kolom B (sel kosong di ujung dibuang) -> cocok dengan column_signature_hash ATAU
--      memuat semua kolom "cocok_jika_kolom_ada" -> resep ini dipakai.
--   3. Baris header yang diulang & baris tanpa NILAI INVOICE (placeholder Sep-Des, subtotal)
--      dilewati. 1 baris = 1 invoice: invoice = NO INVOICE, tanggal = BULAN blok (tgl 1),
--      customer = cabang = BEBAN, total = NILAI INVOICE, ppn = PPN(11%), dpp = total - ppn.
--
-- DASAR "tagihan" (ASUMSI, sama dengan seed lama): NILAI INVOICE = yang ditagihkan ke
--   pelanggan (gaji/BPJS yang ditagihkan ulang + fee); PPN 11% hanya atas fee.
--   Dr Piutang = NILAI INVOICE; Cr PPN = PPN(11%); Cr Pendapatan = NILAI INVOICE - PPN.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales()). Prioritas di kode:
--   Settings > Account Mapping klien (account_receivable / sales_revenue / sales_tax_payable)
--   > akun di resep ini. Di database lokal Account Mapping BRW sudah terisi (1-10020 /
--   4-10001 / 2-10010), jadi resep ini hanya cadangan kalau mapping itu dikosongkan:
--     Dr Piutang     1-10020 Trade Receivables
--     Cr Pendapatan  4-10002 Service Revenue   (BRW = jasa outsourcing)
--     Cr PPN         2-10010 Output VAT Payable
--   Seed memberi NOTICE (tidak gagal) kalau salah satu akun ini tidak ada di COA klien.
--   Akun bisa diubah per invoice di Journal Preview. Kalau nanti COA BRW punya akun piutang/
--   pendapatan per pelanggan (ASF, CSDI, AAF, ...), tambahkan "pendapatan_account_by_cabang"
--   dengan kunci HURUF BESAR = nilai kolom BEBAN.
--
-- KLIEN: nama_client 'PT BINA RANCANG WASESA' atau 'PT BINA RANCANG WASISA'; client_id &
-- client_code diambil otomatis; GAGAL dengan pesan jelas kalau tidak ada / lebih dari 1.
--
-- column_signature_hash level baris = SHA-256 dari hash varian (1 varian):
--   hash_excel = b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45
--   -> 9fc6bf2f4962f95bf08b9d6064ab10af03b78a0b917a30b8f0206dbf3c17f3be  (tidak berubah)
--
-- KLIEN: dicari lewat client_code = 'BIRAWA' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- SEED LAMA: tidak ada (seed Birawa pertama; file ini sebelumnya kosong).
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya (nama file saja akan dicari
-- run_seed.py hanya di folder migrations/ dan tidak ketemu):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_birawa_multi_format_sales.sql
--
-- Idempotensi: AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- (v_hash_baru / v_hash_lama), termasuk yang soft-delete:
--   * ketemu -> UPDATE di tempat (resep diganti, is_active = true, deleted_at dikosongkan;
--               id, usage_count, source_files.template_id TETAP).
--   * tidak  -> INSERT baris baru.
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini dengan varian Excel yang sama,
-- seed berhenti. Singkirkan yang tidak dipakai:
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- SETELAH seed dijalankan: file BRW yang sebelumnya sudah diupload dan berstatus
-- "Butuh Review" (0 baris) TIDAK diproses ulang otomatis -- hapus lalu upload ulang filenya.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    v_jumlah      INTEGER;
    v_akun        TEXT;
    v_nama_klien  CONSTANT TEXT[] := ARRAY['PT BINA RANCANG WASESA', 'PT BINA RANCANG WASISA'];
    v_hash_baru   CONSTANT TEXT := '9fc6bf2f4962f95bf08b9d6064ab10af03b78a0b917a30b8f0206dbf3c17f3be';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien BRW (Birawa) untuk laporan penjualan. Varian Excel: register tagihan manual 'DETAIL INVOICE 2026 & PPN' (berblok bulanan, 1 baris = 1 invoice). Backend memilih varian yang tipe file dan header-nya cocok (lihat _template_dari_varian dan _cocokkan_template_excel_register_blok di sales_import_v1.py).",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 2,
      "data_start_row_index": 3,
      "column_signature_hash": "b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45",
      "header_columns": [
        "BULAN", "KETERANGAN", "BEBAN", "MAN POWER", "NO INVOICE", "TANGGAL TRANSFER",
        "TANGGAL BAYAR", "NILAI INVOICE", "GAJI", "KET GAJI", "BPJS TK", "BPJS KS", "PPH21",
        "POT ABSEN", "POT KOPERASI", "SPD", "POT LAIN - LAIN", "FEE INCLUDE PPN", "TOTAL",
        "SELISIH KOLOM G - R", "FEE NET(DPP)", "PPN(11%)", "PPH 23(2%)", "Total Tagihan", "Pph23",
        "Tagihan - Pph23", "TERIMA DI RK", "TANGGAL DI RK", "SELISIH", "KET", "no rekon",
        "Klasifikasi", "Cek"
      ],
      "mapping_rules": {
        "format_type": "monthly_block_invoice_register",
        "description": "Register tagihan manual BRW (DETAIL INVOICE 2026 & PPN), sheet 'Sheet1': 1 sheet = 1 tahun, tiap bulan = 1 BLOK (baris header diulang di tiap blok), 1 baris = 1 invoice. Tanggal = kolom BULAN blok (tanggal 1 bulan itu). Total = NILAI INVOICE, PPN = PPN(11%), DPP = total - PPN. Pelanggan = BEBAN. Sheet lain (Sheet2, sheet, Sheet3 = pivot/rekap) tidak dibaca. Kolom dicari lewat NAMA di baris header; kolom A kosong tidak ikut di-hash (kolom_awal = 2).",
        "kolom_awal": 2,
        "header_cari_dalam_baris": 5,
        "cocok_jika_kolom_ada": ["BULAN", "NO INVOICE", "BEBAN", "NILAI INVOICE", "PPN(11%)"],
        "dasar": "tagihan",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "kolom": {
          "bulan": "BULAN",
          "invoice": "NO INVOICE",
          "customer": "BEBAN",
          "total": "NILAI INVOICE",
          "ppn": "PPN(11%)",
          "dpp": "FEE NET(DPP)"
        },
        "cabang_dari_kolom_customer": true,
        "field_mapping": {
          "tanggal": "kolom BULAN blok (dibawa ke baris di bawahnya kalau kosong)",
          "invoice": "kolom NO INVOICE",
          "customer": "kolom BEBAN",
          "cabang": "= kolom BEBAN",
          "dpp": "NILAI INVOICE - PPN(11%)",
          "ppn": "kolom PPN(11%) (0 untuk invoice kompensasi tanpa fee)",
          "total": "kolom NILAI INVOICE"
        },
        "row_granularity": "per_invoice",
        "catatan_analisis": "Dianalisis 2026-11-08 dari 3 file di dataset/Sales/Birawa (Juni Revisi, Juli, Agustus). Semua: Sheet1, header baris 2 dari kolom B; file Juni judul 'Klasifikasi' kosong (cocok lewat cocok_jika_kolom_ada). File kumulatif Jan s/d bulan file; blok bulan berikutnya berisi nomor invoice tanpa nilai (placeholder, dilewati). Pelanggan (BEBAN): ASF, ASF-INT, CSDI, CSDI-OPCENT, CSDI-TECHNO, AAF, SBSF, FIF, AAD."
      }
    }
  ],
  "piutang_account": {
    "account_code": "1-10020",
    "account_name": "Trade Receivables"
  },
  "pendapatan_account": {
    "account_code": "4-10002",
    "account_name": "Service Revenue"
  },
  "ppn_account": {
    "account_code": "2-10010",
    "account_name": "Output VAT Payable"
  },
  "catatan_akun": "Akun default dari COA BRW di database (akun standar). Settings > Account Mapping klien (account_receivable / sales_revenue / sales_tax_payable) diutamakan di atas akun ini. Bisa diubah per invoice di Journal Preview. COA BRW belum punya akun piutang/pendapatan per pelanggan; kalau ditambahkan, isi pendapatan_account_by_cabang dengan kunci HURUF BESAR = kolom BEBAN (ASF, ASF-INT, CSDI, CSDI-OPCENT, CSDI-TECHNO, AAF, SBSF, FIF, AAD)."
}$json$::jsonb;
BEGIN
    SELECT count(*) INTO v_jumlah
    FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) = ANY (v_nama_klien);
    IF v_jumlah > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT BINA RANCANG WASESA/WASISA di management_clients. Hapus/gabungkan duplikatnya dulu, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'BIRAWA'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien BIRAWA belum ada di management_clients (dicari client_code = ''BIRAWA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- Peringatan (tidak menggagalkan seed): akun default yang belum ada di COA klien.
    FOR v_akun IN
        SELECT a FROM unnest(ARRAY['1-10020', '4-10002', '2-10010']) AS a
        WHERE NOT EXISTS (
            SELECT 1 FROM management_client_coa c
            WHERE c.client_id = v_client_id AND c.deleted_at IS NULL AND c.acc_no = a
        )
    LOOP
        RAISE NOTICE 'Akun % belum ada di COA klien BRW -- tambahkan di halaman COA atau isi Settings > Account Mapping sebelum posting.', v_akun;
    END LOOP;

    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    SELECT count(*) INTO v_bentrok
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.deleted_at IS NULL
      AND t.is_active
      AND t.file_type = 'Multi'
      AND t.id IS DISTINCT FROM v_id
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.mapping_rules->'variants', '[]'::jsonb)) AS v
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'b6cf5de9d3cb6de54091be4ac0d61fcae14cfa58969fa177e0f36df6b88d7e45'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien BRW sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_sales_import_templates (
            client_id, client_code, file_type, header_row_index, data_start_row_index,
            column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, 'Multi', 2, 3,
            v_hash_baru, '[]'::jsonb, v_rules, 'manual', true, 0
        );
        RAISE NOTICE 'Template Multi BRW dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
           SET header_row_index = 2,
               data_start_row_index = 3,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi BRW sudah ada: resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.is_active,
--        t.mapping_rules->'variants'->0->'mapping_rules'->>'format_type' AS format_type
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'BIRAWA';
