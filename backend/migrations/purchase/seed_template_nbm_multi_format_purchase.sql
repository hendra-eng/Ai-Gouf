-- seed_template_nbm_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk
-- klien NBM (PT Nawasanga Bertatap Muka; outlet FAS A FAS). SATU baris setting
-- ("Multi") untuk halaman Transactions > Purchase (upload file pembelian / AP).
-- Mengikuti pola seed_template_sau_multi_format_purchase.sql.
--
-- STATUS: baru varian EXCEL (workbook "AP_FAF_2025", sheet DETAIL). Varian lain
-- (CSV/PDF) nanti cukup ditambahkan ke array "variants" (lihat "Menambah varian").
--
-- SUMBER: dataset/Purchase/NBM/AP_FAF_2025 (13).xlsx -- 1 workbook, 18 sheet:
--   * 16 sheet bulanan (FEB..DEC 2025, JAN 26..APR 26, plus "JAN" = Jan 2025 yang
--     urutannya terselip): DAFTAR TAGIHAN per nota -- 1 baris = 1 nota, kolom
--     No | Description | Total Price | Supplier | Invoice Date | No Ref | Payment Date.
--     TIDAK ada qty/harga satuan, lebar sheet & posisi header berbeda-beda
--     (header di baris 1, kecuali FEB & JAN di baris 2), format tanggal campur
--     (datetime / teks "13/05/2025" / teks "1 agu 25"), ada baris TOTAL manual dan
--     baris template kosong (AUG: 35 baris tanpa harga). TIDAK dipakai sebagai varian.
--   * DETAIL  : rincian ITEM semua nota Jan 2025 - Apr 2026 (dipakai varian ini).
--   * Pengajuan: daftar pengajuan pembayaran supplier (bukan data pembelian).
--
-- KENAPA SHEET DETAIL: satu-satunya yang punya level item (Qty, Item Price, kategori
-- Cost) dan mencakup seluruh periode dalam 1 header yang konsisten. Strukturnya
-- sama dengan laporan berblok SAU: 1 No ref = 1 transaksi pembelian, baris-barisnya
-- berurutan (kontigu) = item. Beda: tabel FLAT (tanpa baris subtotal/footer),
-- tanpa Pot./Pajak/Biaya, tanpa kode supplier, tanpa kolom cabang.
--
-- TATA LETAK DETAIL (header baris 1, data mulai baris 2, 13 kolom berisi; sheet
-- dibaca selebar 221 kolom, sisanya kosong -- tidak ikut hash, lihat "SIGNATURE"):
--   1 pure | 2 Invoice Date | 3 Description | 4 Cost | 5 Qty | 6 Item Price |
--   7 Total Price | 8 Total Inv | 9 Supplier | 10 No ref | 11 Payment Date |
--   12 Payment by | 13 Note
--   * Kolom 1 "pure" = angka pembantu (1..12), tidak dipakai.
--   * Tanggal bertipe tanggal Excel (terbaca "2025-01-01 00:00:00"); angka memakai
--     titik desimal tanpa pemisah ribuan ("133000.0").
--   * Supplier & Invoice Date terisi di tiap baris item (kecuali 2 blok tanpa tanggal).
--   * "Total Inv" = total per NOTA FISIK, hanya di baris pertama nota. Satu No ref
--     bisa berisi >1 nota fisik (993 baris Total Inv tambahan), jadi BUKAN total transaksi.
--   * Cost = kategori bebas ketik (huruf besar/kecil campur, salah ketik).
--
-- HASIL ANALISIS (4.639 baris tidak kosong dari 4.839 baris fisik):
--   * 2.976 No ref; 2.969 punya total > 0 -> 2.969 transaksi, 4.632 baris item.
--     Jumlah Total Price semua item = 2.985.235.856.
--   * Dilewati (total 0, 7 No ref): AP03-27 (Mint leaf, 0), 1 baris tanpa No ref
--     ("vegetables kitchen", 0), dan AP4/206 s.d. AP4/210 (baris template kosong).
--     21 baris item berharga 0 DI DALAM transaksi lain tetap terbaca (bonus/gratis).
--   * qty x Item Price = Total Price di SEMUA baris; tidak ada nilai negatif; Qty
--     terisi di semua baris item valid.
--   * Rentang tanggal 01/01/2025 s.d. 29/04/2026 (16 bulan, tabel di bawah).
--   * 176 nama supplier unik (tanpa kode supplier; ejaan tidak seragam, mis. "Wahan Boga
--     Nusantara" vs "Wahana Boga Nusantara").
--   * Format No ref campur: AP01-04 (1.737), AP1/1 (811), "AP 11-1" dengan spasi (415),
--     AP05-01-1, "Ap06-104" huruf kecil (2). Tidak ada nomor ganda; tidak ada tabrakan
--     setelah spasi dibuang dan di-upper-case.
--
-- REKONSILIASI per bulan tanggal nota (transaksi / total):
--   2025-01 161 / 139.580.451    2025-02 134 / 126.162.883    2025-03 158 / 131.855.455
--   2025-04 183 / 169.855.326    2025-05 177 / 213.197.640    2025-06 166 / 213.817.359
--   2025-07 186 / 330.037.267    2025-08 171 / 183.072.412    2025-09 188 / 211.548.959
--   2025-10 219 / 193.474.932    2025-11 190 / 168.857.199    2025-12 223 / 199.764.059
--   2026-01 233 / 192.050.159    2026-02 201 / 164.707.346    2026-03 186 / 180.718.133
--   2026-04 191 / 165.234.676    tanpa tanggal: 2 / 1.301.600 (AP05-108, AP05-178)
--
-- KEPUTUSAN UNTUK KASUS TEPI (semuanya sudah ditangani parser _parse_flat_grouped_purchase_report):
--   1. 2 transaksi TANPA tanggal (AP05-108 800.000; AP05-178 501.600): tetap VALID, tanggal
--      dikosongkan ("tanggal_wajib": false). purchase_date jadi NULL (migration
--      purchase/34-allow_null_purchase_date.py); posting wajib mengisi tanggal dulu.
--   2. 1 transaksi TANPA supplier (AP05-87): valid, vendor "Unknown Supplier" + peringatan.
--   3. AP4/173 (2 supplier, 2 tanggal) dan AP01-131 (2 tanggal): nilai terisi PERTAMA dipakai
--      + peringatan yang menyebut nilai lainnya.
--   4. 1 baris tanpa Description (AP01-05, 159.000): "(tanpa keterangan)", tetap terbaca.
--   5. "Total Inv" (total nota fisik) beda dari jumlah item di 98 transaksi (selisih bersih
--      -1.281.274): total transaksi = SUM(Total Price); hanya PERINGATAN bila selisih > 1.000
--      (selisih kecil = pembulatan nota; 44 transaksi lebih dari itu, mis. AP01-89 +57.316,
--      AP01-160 +75.969, AP03-17 +56.400).
--   6. Cost tidak baku (huruf besar/kecil, salah ketik, kosong 10 baris, nilai nyasar "3.0",
--      "-", "staff"): dicocokkan dengan teks di-trim + huruf kecil lewat "line_account_by_cost"
--      (termasuk salah ketik umum). Tidak ada di peta -> akun default 6-60100 + peringatan
--      per transaksi. Kategori aset/peralatan/furniture -> akun aset tetap + peringatan
--      "review" (mis. "building fasafas to go" 140.000.000 berkategori asset masuk 1-10707;
--      pindahkan ke 1-10702 Building Improvements bila perlu).
--   7. Payment Date / Payment by / Note: hanya masuk catatan transaksi (status bayar tetap
--      unpaid; pelunasan lewat modul pembayaran). Payment Date yang bukan tanggal diabaikan.
--   8. Sel kosong di ujung baris header TIDAK ikut hash (lihat "SIGNATURE"), jadi lebar sheet
--      221 kolom tidak jadi masalah.
--   9. Nomor transaksi dinormalisasi: spasi dibuang + huruf besar ("AP 11-1" -> AP11-1,
--      "Ap06-104" -> AP06-104). Baris tanpa No ref dan baris template kosong dilewati;
--      No ref yang muncul lagi tidak berurutan digabung ke transaksi yang sama.
--  10. Sheet bulanan dan DETAIL tidak sepenuhnya sama (136 No ref beda nilai, 108 hanya di
--      DETAIL, 8 hanya di sheet bulanan; mis. AP04-17 120.060 vs 133.266). DETAIL dipakai
--      sebagai sumber; cocokkan ke buku besar sebelum posting.
--
-- PARSER: sudah ada di purchase_import_v1.py (_parse_flat_grouped_purchase_report, format_type
-- 'flat_grouped_purchase_report'). Syarat jalan: migration purchase/34-allow_null_purchase_date.py
-- (purchase_date boleh NULL) dan seed COA NBM. Urutan: 34 -> seed ini -> upload.
--
-- SIGNATURE: pencocokan Excel di purchase_import_v1._cocokkan_template menghitung hash baris
-- header apa adanya DAN setelah sel kosong di ujungnya dipangkas; seed ini memakai hash versi
-- DIPANGKAS (13 kolom), jadi tidak bergantung pada lebar sheet:
--   hash_excel = ec4beb61ff3bac110fa6b6dd2d50dffa3ad6113a28268b9aff2fce6413f54253
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian dipisah ':' urut
-- array "variants" (pola SAU). Satu varian -> SHA-256(hash_excel):
--   c589f6f8cd9fcd1173c95919a642ddc3715f46fb8cbc04cfdf8db2f9d0ff370e
-- Tiap varian ditambah/dihapus, hitung ulang. header_row_index/data_start_row_index level
-- baris hanya pengisi kolom NOT NULL untuk template Multi.
--
-- AKUN (seed_coa_nbm.sql; Settings > Account Mapping klien, kalau diisi, tetap didahulukan):
--   Cr Hutang Usaha 2-20100 | Dr PPN Masukan 1-10500 (tidak terpakai: tidak ada kolom pajak)
--   Dr per kategori Cost lewat "line_account_by_cost" (sudah dibaca parser).
--   Peta di bawah keputusan awal -- boleh diubah lewat UPDATE bila akuntan NBM minta lain:
--     makanan, pastry                    -> 1-10200 Persediaan Barang Makanan
--     minuman (+ salah ketik)            -> 1-10201 Persediaan Barang Minuman
--     pengemasan                         -> 1-10202 Persediaan - Kemasan dan Perlengkapan
--     kebersihan                         -> 6-60303 Keamanan dan Kebersihan
--     gas, operasional                   -> 6-60228 Biaya Perlengkapan Operasional
--     perlengkapan dapur                 -> 6-60227 | perlengkapan bar -> 6-60225
--     marketing, iklan promosi           -> 6-60001 Iklan & Promosi
--     manfaat karyawan, tunjangan        -> 6-60210 Beban Manfaat Karyawan (BPJS)
--     piutang karyawan                   -> 1-10301 Piutang Karyawan
--     perbaikan, maintenance, dst.       -> 6-60203 Perbaikan & Pemeliharaan
--     jasa konsultasi, legal             -> 6-60209 Biaya Hukum dan Profesional
--     lainnya / kosong / tidak dikenal   -> 6-60100 Biaya Umum & Administratif (default)
--     dapur, kitchen                     -> 6-60227 | bar -> 6-60225 (isinya plastik, tissue, towel)
--     asset, assset, peralatan(+dapur)   -> 1-10707 Peralatan dan perlengkapan Kitchen
--     furniture, asset/hutang lain-lain  -> 1-10708 Furniture dan Fixtures
--     pb1                                -> 2-20402 Hutang PB1
--     kantor, biaya kantor, perlengkapan kantor -> 6-60300 | listrik -> 6-60217
--     design, event                      -> 6-60001 | sewa lain -> 6-60403 | biaya penelitian -> 6-60102
--     perjalanan dinas, akomodasi        -> 6-60204 | seragam -> 6-60007 | bensin, patrol -> 6-60202
--     perawatan, material                -> 6-60203 | vegetables -> 1-10200
--
-- KLIEN: dicari lewat nama_client = 'PT NAWASANGA BERTATAP MUKA' (sesuai data klien di VPS) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- PRASYARAT: migration 15-create_purchase_import_templates.py dan coa/seed_coa_nbm.sql.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_nbm_multi_format_purchase.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_purchase_import_templates_signature).
-- Kalau resep direvisi:
--   DELETE FROM financial_transaction_purchase_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT NAWASANGA BERTATAP MUKA'
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = 'c589f6f8cd9fcd1173c95919a642ddc3715f46fb8cbc04cfdf8db2f9d0ff370e';
--
-- Menambah varian (CSV/PDF/Excel lain): tambah 1 objek di array "variants", hitung ulang hash
-- level baris. Jika seed sudah dijalankan, UPDATE baris yang ada atau hapus lalu jalankan ulang.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT NAWASANGA BERTATAP MUKA'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT NAWASANGA BERTATAP MUKA') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT NAWASANGA BERTATAP MUKA di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client = ''PT NAWASANGA BERTATAP MUKA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        'Multi',
        1,
        2,
        'c589f6f8cd9fcd1173c95919a642ddc3715f46fb8cbc04cfdf8db2f9d0ff370e',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien NBM untuk file pembelian/AP. Saat ini varian Excel (sheet DETAIL workbook AP_FAF); varian CSV/PDF ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep sendiri; backend memilih varian yang tipe file dan signature header-nya cocok.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "DETAIL",
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "ec4beb61ff3bac110fa6b6dd2d50dffa3ad6113a28268b9aff2fce6413f54253",
      "header_columns": [
        "pure",
        "Invoice Date",
        "Description",
        "Cost",
        "Qty",
        "Item Price",
        "Total Price",
        "Total Inv",
        "Supplier",
        "No ref",
        "Payment Date",
        "Payment by",
        "Note"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_purchase_report",
        "description": "Rincian pembelian NBM (FAS A FAS), sheet DETAIL -- tabel FLAT: 1 baris = 1 item; baris dengan No ref sama = 1 transaksi pembelian (1 Purchase Transaction draft + baris itemnya). Tidak ada baris subtotal/footer, tidak ada Pot./Pajak/Biaya, tidak ada kode supplier, tidak ada cabang. Total transaksi = SUM(Total Price) item. Kolom dibaca lewat posisi (1-based).",
        "source_kind": "excel_sheet",
        "sheet_name": "DETAIL",
        "date_format": "YYYY-MM-DD",
        "tanggal_wajib": false,
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "header_row_index": 1,
        "data_start_row_index": 2,
        "columns": {
          "tanggal": 2,
          "deskripsi": 3,
          "kategori_cost": 4,
          "jumlah": 5,
          "harga": 6,
          "total": 7,
          "total_nota": 8,
          "supplier": 9,
          "purchase_no": 10,
          "payment_date": 11,
          "payment_by": 12,
          "note": 13
        },
        "ignore_columns": {
          "1": "pure (angka pembantu 1..12)"
        },
        "group_by": {
          "key_column": "purchase_no",
          "contiguous": false,
          "key_normalisasi": "trim, buang semua spasi, huruf besar (AP 11-1 -> AP11-1; Ap06-104 -> AP06-104)",
          "header_values": {
            "tanggal": "nilai terisi PERTAMA di blok; peringatan bila ada tanggal lain",
            "supplier": "nilai terisi PERTAMA di blok; peringatan bila ada supplier lain",
            "supplier_normalisasi": "trim + spasi tunggal + huruf kecil dipakai sebagai identitas; nama tampil = ejaan pertama"
          }
        },
        "skip_rules": {
          "baris_kosong": "semua sel kosong -> dilewati (200 baris fisik)",
          "baris_tanpa_isi": "Description kosong DAN Total Price = 0 -> dilewati",
          "blok_total_nol": "blok dengan SUM(Total Price) <= 0 tidak dibuat (7 No ref: AP03-27, 1 baris tanpa No ref, AP4/206..AP4/210)",
          "baris_tanpa_no_ref": "baris berisi tanpa No ref dilewati dan dihitung di catatan"
        },
        "validation": {
          "total_nota_toleransi": 1000,
          "total_nota_tidak_cocok": "warn",
          "deskripsi_kosong_pengganti": "(tanpa keterangan)",
          "supplier_kosong_pengganti": "Unknown Supplier"
        },
        "field_mapping": {
          "purchase_no": "columns.purchase_no (dinormalisasi)",
          "purchase_date": "tanggal blok",
          "vendor_code": null,
          "vendor_name": "supplier blok",
          "description": "deskripsi item",
          "item_category": "kategori_cost item (dipakai untuk akun)",
          "quantity": "jumlah item",
          "unit_price": "harga item",
          "total": "total item (kolom Total Price)",
          "discount": 0,
          "tax_amount": 0,
          "other_costs": 0
        },
        "currency_default": "IDR",
        "category_default": "Inventory",
        "line_account": {
          "account_code": "6-60100",
          "account_name": "Biaya Umum & Administratif"
        },
        "line_account_by_cost_catatan": "Kunci = Cost di-trim + huruf kecil. Tidak ada di peta -> line_account (6-60100) + peringatan.",
        "kategori_perlu_review": ["asset", "assset", "asset/hutang lain-lain", "furniture", "peralatan", "peralatan dapur"],
        "line_account_by_cost": {
          "makanan": { "account_code": "1-10200", "account_name": "Persediaan Barang Makanan" },
          "pastry": { "account_code": "1-10200", "account_name": "Persediaan Barang Makanan" },
          "minuman": { "account_code": "1-10201", "account_name": "Persediaan Barang Minuman" },
          "minumaan": { "account_code": "1-10201", "account_name": "Persediaan Barang Minuman" },
          "mainuman": { "account_code": "1-10201", "account_name": "Persediaan Barang Minuman" },
          "pengemasan": { "account_code": "1-10202", "account_name": "Persediaan - Kemasan dan Perlengkapan" },
          "kebersihan": { "account_code": "6-60303", "account_name": "Keamanan dan Kebersihan" },
          "gas": { "account_code": "6-60228", "account_name": "Biaya Perlengkapan Operasional" },
          "operasional": { "account_code": "6-60228", "account_name": "Biaya Perlengkapan Operasional" },
          "perlengkapan dapur": { "account_code": "6-60227", "account_name": "Biaya Perlengkapan Dapur" },
          "perlengakapan dapur": { "account_code": "6-60227", "account_name": "Biaya Perlengkapan Dapur" },
          "perlengkapan bar": { "account_code": "6-60225", "account_name": "Biaya Perlengkapan Bar" },
          "perlengakapan bar": { "account_code": "6-60225", "account_name": "Biaya Perlengkapan Bar" },
          "marketing": { "account_code": "6-60001", "account_name": "Iklan & Promosi" },
          "iklan promosi": { "account_code": "6-60001", "account_name": "Iklan & Promosi" },
          "manfaat karyawan": { "account_code": "6-60210", "account_name": "Beban Manfaat Karyawan" },
          "tunjangan": { "account_code": "6-60210", "account_name": "Beban Manfaat Karyawan" },
          "tunjangan karyawan": { "account_code": "6-60210", "account_name": "Beban Manfaat Karyawan" },
          "piutang karyawan": { "account_code": "1-10301", "account_name": "Piutang Karyawan" },
          "perbaikan": { "account_code": "6-60203", "account_name": "Perbaikan & Pemeliharaan" },
          "maintenance": { "account_code": "6-60203", "account_name": "Perbaikan & Pemeliharaan" },
          "pemeliharaan": { "account_code": "6-60203", "account_name": "Perbaikan & Pemeliharaan" },
          "jasa konsultasi": { "account_code": "6-60209", "account_name": "Biaya Hukum dan Profesional" },
          "legal": { "account_code": "6-60209", "account_name": "Biaya Hukum dan Profesional" },
          "dapur": { "account_code": "6-60227", "account_name": "Biaya Perlengkapan Dapur" },
          "kitchen": { "account_code": "6-60227", "account_name": "Biaya Perlengkapan Dapur" },
          "bar": { "account_code": "6-60225", "account_name": "Biaya Perlengkapan Bar" },
          "asset": { "account_code": "1-10707", "account_name": "Peralatan dan perlengkapan Kitchen" },
          "assset": { "account_code": "1-10707", "account_name": "Peralatan dan perlengkapan Kitchen" },
          "peralatan": { "account_code": "1-10707", "account_name": "Peralatan dan perlengkapan Kitchen" },
          "peralatan dapur": { "account_code": "1-10707", "account_name": "Peralatan dan perlengkapan Kitchen" },
          "furniture": { "account_code": "1-10708", "account_name": "Furniture dan Fixtures" },
          "asset/hutang lain-lain": { "account_code": "1-10708", "account_name": "Furniture dan Fixtures" },
          "pb1": { "account_code": "2-20402", "account_name": "Hutang PB1" },
          "kantor": { "account_code": "6-60300", "account_name": "Biaya Kantor" },
          "biaya kantor": { "account_code": "6-60300", "account_name": "Biaya Kantor" },
          "perlengkapan kantor": { "account_code": "6-60300", "account_name": "Biaya Kantor" },
          "listrik": { "account_code": "6-60217", "account_name": "Biaya Listrik dan Air PAM" },
          "design": { "account_code": "6-60001", "account_name": "Iklan & Promosi" },
          "event": { "account_code": "6-60001", "account_name": "Iklan & Promosi" },
          "sewa lain": { "account_code": "6-60403", "account_name": "Biaya Sewa - Lain - lain" },
          "biaya penelitian": { "account_code": "6-60102", "account_name": "Biaya Penelitian dan Pengembangan" },
          "perjalanan dinas": { "account_code": "6-60204", "account_name": "Perjalanan Dinas - Umum" },
          "akomodasi": { "account_code": "6-60204", "account_name": "Perjalanan Dinas - Umum" },
          "seragam": { "account_code": "6-60007", "account_name": "Seragam Pegawai" },
          "bensin": { "account_code": "6-60202", "account_name": "Bensin, Tol dan Parkir - Umum" },
          "patrol": { "account_code": "6-60202", "account_name": "Bensin, Tol dan Parkir - Umum" },
          "perawatan": { "account_code": "6-60203", "account_name": "Perbaikan & Pemeliharaan" },
          "material": { "account_code": "6-60203", "account_name": "Perbaikan & Pemeliharaan" },
          "vegetables": { "account_code": "1-10200", "account_name": "Persediaan Barang Makanan" }
        },
        "biaya_account": {
          "account_code": "6-60100",
          "account_name": "Biaya Umum & Administratif"
        },
        "ap_account": {
          "account_code": "2-20100",
          "account_name": "Hutang Usaha"
        },
        "tax_account": {
          "account_code": "1-10500",
          "account_name": "PPN Masukan"
        },
        "row_granularity": "per_purchase_block",
        "total_resmi_contoh": {
          "note": "Hasil analisis sheet DETAIL (Jan 2025 - Apr 2026) untuk rekonsiliasi setelah upload. Hanya dokumentasi, tidak dibaca parser.",
          "transaksi": 2969,
          "baris_item": 4632,
          "total_price": 2985235856,
          "dilewati_total_nol": 7,
          "tanpa_tanggal": { "transaksi": 2, "total": 1301600, "no_ref": ["AP05-108", "AP05-178"], "keputusan": "tetap valid, tanggal kosong" },
          "tanpa_supplier": ["AP05-87"],
          "total_nota_tidak_cocok": 98,
          "total_nota_tidak_cocok_di_atas_1000": 44,
          "per_bulan": {
            "2025-01": { "transaksi": 161, "total": 139580451 },
            "2025-02": { "transaksi": 134, "total": 126162883 },
            "2025-03": { "transaksi": 158, "total": 131855455 },
            "2025-04": { "transaksi": 183, "total": 169855326 },
            "2025-05": { "transaksi": 177, "total": 213197640 },
            "2025-06": { "transaksi": 166, "total": 213817359 },
            "2025-07": { "transaksi": 186, "total": 330037267 },
            "2025-08": { "transaksi": 171, "total": 183072412 },
            "2025-09": { "transaksi": 188, "total": 211548959 },
            "2025-10": { "transaksi": 219, "total": 193474932 },
            "2025-11": { "transaksi": 190, "total": 168857199 },
            "2025-12": { "transaksi": 223, "total": 199764059 },
            "2026-01": { "transaksi": 233, "total": 192050159 },
            "2026-02": { "transaksi": 201, "total": 164707346 },
            "2026-03": { "transaksi": 186, "total": 180718133 },
            "2026-04": { "transaksi": 191, "total": 165234676 }
          }
        },
        "catatan_analisis": "Dianalisis dari workbook AP_FAF_2025 (18 sheet). Sheet DETAIL dipilih karena satu-satunya yang punya level item (Qty, Item Price, Cost) dan mencakup Jan 2025 - Apr 2026 dengan 1 header. 16 sheet bulanan hanya daftar tagihan per nota dengan header/lebar/format tanggal berbeda-beda dan baris TOTAL manual, sehingga tidak dijadikan varian. Total Inv adalah total nota fisik (bisa >1 per No ref) dan tidak selalu sama dengan jumlah item, jadi hanya pembanding. Keputusan tepi (tanggal kosong boleh, supplier kosong diganti, peringatan Total Inv > Rp 1.000, peta akun per Cost) ada di komentar seed."
      }
    }
  ]
}
$json$::jsonb,
        'manual',
        true,
        0
    );
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) = 'PT NAWASANGA BERTATAP MUKA';