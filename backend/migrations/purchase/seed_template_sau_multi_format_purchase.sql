-- seed_template_sau_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk
-- klien SAU (CV Sumber Alodie Utama). SATU baris setting ("Multi") untuk
-- halaman Transactions > Purchase (upload file laporan pembelian), yang
-- melayani laporan pembelian dari KEEMPAT cabang:  CRS, NGY, OL, PCL.
--
-- STATUS: baru varian CSV. Varian PDF/Excel ditambahkan kemudian ke array
-- "variants" (tidak perlu baris template baru -- lihat "Menambah varian").
--
-- SUMBER UTAMA (4 file contoh periode Agustus 2026, isi file "PERIODE : 01/08/26 -
-- 31/08/26", nama file "Data_Pembelian_Detail_01-30_Agustus_2026_<CABANG>.csv"):
--   CRS   723 baris,  77 transaksi, 243 baris item, Total Akhir 2.114.085.103
--   NGY 1.118 baris, 122 transaksi, 368 baris item, Total Akhir 8.360.173.463
--   OL      105 baris,  11 transaksi,  21 baris item, Total Akhir   941.661.796
--   PCL   406 baris,  38 transaksi, 160 baris item, Total Akhir 2.948.156.223
-- Pembanding (4 file periode Juli 2026, dataset/Purchase/SAU/CSV, "Data Pembelian
-- Detail 01-31 Juli 2026 <CABANG>.csv"): CRS 85, NGY 113, OL 9, PCL 42 transaksi.
-- Resep yang SAMA lolos di kedua periode (Juli 249/249 blok valid), jadi seed ini
-- berlaku untuk laporan bulan apa pun selama formatnya tidak berubah.
--
-- Kedelapan file BERFORMAT SAMA: header baris 8 identik (hash di bawah), delimiter
-- ';', CRLF, ASCII murni (tanpa tanda kutip), 13 kolom di SETIAP baris, tanggal
-- DD/MM/YYYY, angka ribuan '.', 1 transaksi = 1 blok beberapa baris. Karena itu
-- CUKUP 1 varian CSV -- tidak perlu varian per cabang.
--
-- HASIL UJI Agustus (resep di bawah dijalankan dengan fungsi asli purchase_import_v1.py:
-- _baca_csv_baris, _hash_baris, _parse_grouped_purchase_report, _terapkan_akun_dept):
--   * Hash baris 8 = f5b9fc4d...ef64 di keempat file (SAMA dengan Juli); SHA-256 dari hash
--     itu = 38ba284a...1e2f (nilai level baris di bawah sudah benar).
--   * 248 blok (CRS 77 + NGY 122 + OL 11 + PCL 38): 247 valid, 1 DITOLAK (BL-000001890-26,
--     lihat "KETERBATASAN" no. 1). 789 baris item + 17 baris "Other Costs" (blok dengan
--     "Biaya :" > 0) = 806 baris transaksi dari 247 blok valid.
--   * Jumlah Sub Total, Potongan, Pajak, Biaya Lain, dan Total Akhir semua blok = angka
--     "TOTAL KESELURUHAN" resmi di bawah tiap file (keempat file, tanpa selisih).
--     Jumlah kuantitas semua baris item juga = "Jumlah Item" resmi (CRS 39.749, NGY 147.216,
--     OL 2.649, PCL 11.531) -> pembacaan angka dengan titik ribuan sudah benar.
--   * Total Akhir 248 blok = Rp 14.364.076.585; yang masuk dari 247 blok valid =
--     Rp 14.321.735.785 (selisih = blok yang ditolak, Rp 42.340.800).
--   * Rumus footer Total Akhir = subtotal - Pot. + Pajak + Biaya berlaku di 247 dari 248 blok
--     (satu-satunya yang tidak: BL-000001890-26).
--   * Pajak: 47 blok kena pajak (CRS 2, NGY 10, OL 4, PCL 31), semuanya tepat 11% dari
--     (subtotal - Pot.). Blok dengan Pot. footer > 0: 45 (CRS 5, NGY 16, OL 4, PCL 20).
--     Pot. % per item hanya ada di 8 baris satu blok (BL-000001865-26 CRS, 3%).
--   * Tanggal 01/08/2026 s.d. 31/08/2026 (OL 04-28/08, PCL 04-31/08), tidak ada tanggal gagal
--     baca; nomor selalu BL-<9 digit>-26 (BL-000001812-26 s.d. BL-000002077-26); tidak ada
--     nomor ganda lintas keempat file, dan TIDAK ada yang sama dengan nomor file Juli
--     (nomor Juli BL-000001566-26 s.d. BL-000002009-26 -- rentangnya tumpang tindih dengan
--     Agustus karena nomor tidak berurutan menurut tanggal, tapi tidak ada yang kembar).
--   * 63 kode supplier unik (CRS 37, NGY 32, OL 7, PCL 11); 20 kode muncul di 2-3 file
--     cabang (mis. SP0487 PT PERFECT COMPANION INDONESIA di NGY, OL, PCL). 1 kode = 1 nama
--     dan sebaliknya, juga setelah digabung dengan file Juli (80 kode unik, 46 ada di
--     kedua bulan, 0 konflik).
--   * Dept. di isi file selalu = cabang nama file, jadi akun persediaan per cabang
--     (line_account_by_dept) terpilih dari Dept.: CRS 11500001 (244 baris), NGY 11500002
--     (375), OL 11500003 (18), PCL 11500004 (169) -- semua baris tiap file jatuh ke akun
--     cabangnya.
--   * Tidak ada jumlah/harga/total negatif atau desimal. Jumlah memakai titik ribuan
--     ("24.300" = 24300; 35 baris), satuan terpanjang 6 karakter.
--
-- KETERBATASAN YANG DIKETAHUI (bukan salah template, tapi perlu diketahui pengguna):
--   1. SATU BLOK DITOLAK PARSER: BL-000001890-26 (OL, 08/08/2026, SP0432 PT MATAHARI SAKTI
--      (PET FOOD), 3 item TAISHO-2/TAISHO-5/TAISHO-5 SPESIAL, subtotal 42.340.800). Footer-nya
--      "Biaya : 150" tetapi "Total Akhir" tetap 42.340.800 (biaya TIDAK ikut dijumlah oleh POS),
--      sehingga baris item + Other Costs 150 = 42.340.950 != 42.340.800 dan parser menolak
--      ("Line total 42,340,950.00 != printed grand total 42,340,800.00") -- toleransi total
--      hanya Rp 1 (_TOLERANSI_TOTAL di kode, tidak bisa diatur dari seed). Footer OL
--      resmi sendiri tidak konsisten: 949.074.313 - 45.993.476 + 38.580.959 + 150 =
--      941.661.946, padahal Total Akhir resmi 941.661.796 (selisih persis 150). Akibatnya
--      di upload file OL Agustus akan muncul 10 dari 11 transaksi berhasil, 1 "skipped_invalid".
--      Transaksi itu harus diinput manual (atau minta POS memperbaiki footer-nya). Kalau
--      parser ingin menerimanya otomatis, perlu perubahan kode (toleransi/biaya per template)
--      -- BUKAN lewat seed ini.
--   2. KODE ITEM TIDAK ANDAL untuk pencocokan produk. Kolom "Kd. Item" dari POS terisi NAMA
--      item kalau item tidak punya kode: 229 dari 789 baris kode == nama, 415 baris kodenya
--      mengandung spasi. Kode juga bisa tidak sama dengan nama item di baris yang sama
--      (mis. kode "MEO 7 KG - PERSIAN" untuk nama "MEO 6.8 KG - PERSIAN"). Pakai description,
--      jangan item_code, untuk mencocokkan produk.
--   3. KODE ITEM NUMERIK BERUBAH ANTAR BULAN (nol di depan). 10 produk yang sama memakai kode
--      tanpa nol di file Juli dan kode berawalan "0000" di file Agustus, mis. KATUL SUPER 50 KG
--      "537" (Juli) vs "0000537" (Agustus); lainnya: BR11 CP (50 KG) 460/0000460, BR12 CP
--      (50 KG) 461/0000461, BR21E (50 KG) 462/0000462, GD-21 (50 KG) 468/0000468,
--      PUYUH SP-22 (50 KG) 472/0000472, JAGUNG HIBRIDA 50 KG 539/0000539, 144 (50 KG)
--      449/0000449, A591-K 463/0000463, A594-K 464/0000464. Mencocokkan produk lewat
--      item_code akan memecah produk yang sama jadi dua. Sebaliknya, pencocokan lewat
--      description konsisten: tidak ada satu pun kode yang punya dua nama berbeda
--      (Agustus 359 kode = 359 nama, 1:1; Juli+Agustus tidak ada kode dengan 2 nama).
--   4. Parser memotong item_code sampai 50 karakter (kolom DB String(50)). Di Agustus ada 1
--      baris yang terpotong: BL-000001899-26 NGY, "WHISKAS POUCH 80GR - ADULT CHICKEN SALMON
--      LOAF (28)" (51 karakter) tersimpan sebagai "...LOAF (2". Tidak bertabrakan dengan kode
--      lain, tapi description (Text) tidak dipotong -- pakai itu. (Di Juli: 6 baris CRS.)
--   5. Item yang sama bisa muncul lebih dari sekali dalam 1 transaksi (70 kombinasi kode+nama
--      di 34 blok, mis. KILI KILI NO.10/12 (BKS) 2 baris dengan jumlah 80 dan 60 di
--      BL-000001816-26). item_code bukan kunci unik per transaksi; jangan gabungkan/dedup baris
--      berdasarkan item_code.
--   6. 37 baris memakai satuan notasi isi kemasan, bukan master satuan: CRS "@12" 11 dan "@6" 8;
--      NGY "@25 Kg" 15, "@30" 2, "@12" 1. Terbaca apa adanya di kolom unit (maks 20
--      karakter, tidak ada yang terpotong). Jangan dipakai untuk konversi satuan otomatis.
--      Satuan lain: BAL, PCS, SAK, DUS, PAK, SET, KARTON, RENC, KODI, ROLL.
--   7. 31 baris item berharga 0 (barang bonus/gratis; NGY 17, CRS 7, PCL 7). Terbaca benar
--      (total 0). Kalau baris bonus kebetulan baris TERAKHIR di blok, sisa pembulatan alokasi
--      Pot./Pajak bisa jatuh ke baris itu (total baris Rp 0,03 di BL-000001881-26 dan Rp 0,01
--      di BL-000002017-26). Total transaksi tetap benar.
--   8. 18 blok punya "Biaya :" > 0, tapi 16 di antaranya < Rp 1.000 (2 s.d. 223) -- selisih
--      pembulatan POS, bukan biaya nyata. Total Akhir SUDAH menyertakannya (kecuali
--      BL-000001890-26, lihat no. 1), jadi parser tetap membuat 1 baris "Other Costs" kecil agar
--      total cocok. Biaya nyata hanya 2: BL-000001838-26 dan BL-000001963-26 (NGY, masing-masing
--      Rp 200.000, bersama Pot. 1.555.000 dan 1.565.400).
--   9. 1 blok punya selisih pembulatan item vs subtotal cetak (BL-000001865-26, -1 rupiah),
--      diserap baris terakhir dan dicatat di notes transaksi. Tidak mengubah total.
--  10. Banyak pembelian rutin berangka kembar (supplier, subtotal, total sama, nomor beda): 19
--      kelompok / 57 blok, mis. SP0487 PT PERFECT COMPANION INDONESIA 106.231.044 -> Total Akhir
--      107.858.185 di 7 blok (OL BL-000001845/1846, PCL BL-000001897/1898/2014/2037/2048), atau
--      SP0080 444.000 di 6 blok CRS. Wajar untuk pembelian berulang, tapi pencegah duplikat
--      HANYA berdasarkan purchase_no -- input ganda dengan nomor berbeda tidak akan terdeteksi.
--  11. NAMA FILE TIDAK MENJAMIN PERIODE. File bernama "01-30 Agustus" ternyata berisi transaksi
--      sampai 31/08/2026 (periode di baris 1 isi file: 01/08/26 - 31/08/26). Parser memakai
--      tanggal per transaksi (bukan nama file), jadi aman -- tapi jangan mengandalkan nama file
--      untuk memeriksa kelengkapan periode.
--  12. Nama perusahaan di baris 2 isi file adalah "INSPIRASI MEDIA KREATIF" (bukan SAU). Parser
--      dan hash TIDAK membaca baris itu: file berformat sama milik perusahaan lain yang diupload
--      ke klien SAU tetap akan cocok dan diimpor. Pastikan klien yang dipilih saat upload benar.
--      Kode cabang juga tercetak di baris 4 kolom 9 (CRS/NGY/OL/PCL) -- tidak dipakai resep,
--      Dept. di tiap blok yang dipakai.
--  13. Nama file huruf kecil ("..._pcl (1).csv") terbaca "pcl" sebagai cadangan cabang. Akun per
--      cabang tetap benar (pencarian line_account_by_dept di-upper-case), tapi teks "Dept:" di
--      notes transaksi tampil huruf kecil. Kalau Dept. di isi file terisi (selalu terisi di
--      kedelapan contoh), tidak terjadi. Nama file tanpa kode cabang -> cadangan kosong, Dept.
--      isi file dipakai. Diuji: "..._Agustus_2026_PCL__1_.csv" -> PCL, "..._OL.csv" -> OL,
--      "laporan pembelian agustus.csv" -> kosong.
--
-- CARA APLIKASI MEMBACA UPLOAD CSV:
--   1. User upload file di Purchase dengan klien SAU aktif.
--   2. Backend memecah baris ini jadi template virtual per varian, lalu memilih
--      varian bertipe CSV yang hash baris ke-8 file-nya cocok
--      (column_signature_hash varian) -> file CRS/NGY/OL/PCL semuanya cocok.
--   3. Resep "grouped_purchase_report" membaca blok per transaksi -> 1 Purchase
--      Transaction (status draft) + baris itemnya. Pot. % item -> discount baris;
--      "Pot. :" footer dialokasikan proporsional ke discount tiap baris; "Pajak :"
--      -> tax_amount tiap baris; "Biaya :" -> 1 baris tambahan "Other Costs".
--      Sisa pembulatan masuk baris terakhir, jadi SUM(total baris) = Total Akhir.
--   4. CABANG (Dept.) dibaca dari kolom Dept. di isi file (selalu terisi di keempat
--      file). Kalau kosong, cadangan dari nama file lewat cabang_dari_nama_file
--      (pola menerima spasi/underscore/strip sebelum kode, dan akhiran "(1)" / "__1_"
--      hasil unduhan browser): "..._PCL.csv" -> PCL, "..._OL__1_.csv" -> OL.
--
-- PARSER PURCHASE SUDAH MENDUKUNG TEMPLATE "Multi" (varian CSV):
--   purchase_import_v1._kandidat_template() memecah baris file_type = 'Multi' jadi template
--   virtual per varian lewat _template_dari_varian (fungsi yang sama dengan sales_import_v1),
--   jadi varian CSV seed ini ikut jadi kandidat saat file CSV diupload. Diuji end-to-end
--   (baris Multi dari seed ini + fungsi parser asli) pada 8 file contoh: Agustus 4/4 dan
--   Juli 4/4 cocok ke template, Dept. terbaca benar. Varian PDF/Excel BELUM punya parser
--   Purchase -- varian bertipe itu diabaikan (upload PDF/Excel -> template_matched=false)
--   sampai nanti dibuat.
--   Kalau di database SAU masih ada template lama bertipe 'CSV' dengan hash header yang SAMA
--   (f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64), nonaktifkan SETELAH
--   upload lewat seed ini terbukti jalan (query ada di bawah), supaya tidak ada dua template
--   yang cocok untuk file yang sama.
--
-- AKUN JURNAL (sama dengan migration 19-fix_sau_purchase_accounts.sql; semuanya ada di
-- seed_coa_sau.sql; Settings > Account Mapping klien, kalau diisi, tetap didahulukan
-- untuk akun umum -- akun per cabang line_account_by_dept paling spesifik):
--   Dr Persediaan   CRS 11500001, NGY 11500002, OL 11500003, PCL 11500004;
--                   cabang lain / tanpa Dept. -> 11500099 PERSEDIAAN
--   Dr PPN Masukan  11300998 PAJAK MASUKAN
--   Cr Hutang Usaha 21200001 HUTANG USAHA
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian, urut seperti
-- di array "variants" dan dipisah ':' (pola seed sales SAU / NBM):
--   SHA-256("<hash_csv>")   (1 varian -> hanya hash_csv)
--   hash_csv = f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64
-- -> 38ba284a93b8d55b8c00257d05a4c00c6d7b9ad3585984d07198c97ce56d1e2f
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya
-- pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan adalah nilai di
-- dalam tiap varian. Setiap varian ditambah/dihapus, hitung ulang hash level baris dari
-- gabungan hash varian (urutan = urutan array "variants").
--
-- KLIEN: dicari lewat nama_client ('SAU' atau 'CV SUMBER ALODIE UTAMA', tidak peka
-- huruf besar/kecil) dan GAGAL dengan pesan jelas kalau belum ada di
-- management_clients. client_id & client_code diambil otomatis, tidak di-hardcode.
--
-- PRASYARAT: migration 15-create_purchase_import_templates.py (tabel sudah ada) dan
-- seed_coa_sau.sql (akun di atas).
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_sau_multi_format_purchase.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan (gagal karena UNIQUE
-- uq_purchase_import_templates_signature). Kalau resep direvisi dan perlu dijalankan
-- ulang, hapus dulu:
--   DELETE FROM financial_transaction_purchase_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = '38ba284a93b8d55b8c00257d05a4c00c6d7b9ad3585984d07198c97ce56d1e2f';
--
-- Menonaktifkan template lama SAU bertipe CSV (HANYA setelah upload lewat template Multi terbukti jalan):
--   UPDATE financial_transaction_purchase_import_templates t
--      SET is_active = false, edited_at = now()
--     FROM management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
--      AND t.file_type = 'CSV' AND t.column_signature_hash = 'f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64';
--
-- Menambah varian PDF/Excel nanti: tambahkan 1 objek lagi di array "variants" (file_type,
-- sheet_name, header_row_index, data_start_row_index, column_signature_hash dari baris
-- header file contoh, header_columns, mapping_rules), lalu hitung ulang hash level baris.
-- Kalau seed ini sudah dijalankan, ubah baris yang ada lewat UPDATE (jangan INSERT baru)
-- atau hapus dulu lalu jalankan ulang file ini.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM
-- (bukan DEFAULT kolom database).

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari nama_client = SAU / CV Sumber Alodie Utama). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '38ba284a93b8d55b8c00257d05a4c00c6d7b9ad3585984d07198c97ce56d1e2f',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien SAU untuk laporan pembelian semua cabang (CRS, NGY, OL, PCL). Saat ini baru varian CSV (format SAMA untuk keempat cabang); varian PDF/Excel ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok.",
  "variants": [
    {
      "file_type": "CSV",
      "sheet_name": null,
      "header_row_index": 8,
      "data_start_row_index": 11,
      "column_signature_hash": "f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64",
      "header_columns": [
        "No Transaksi",
        "",
        "Tanggal",
        "",
        "Dept.",
        "Kode Supp.",
        "Nama Supplier",
        "",
        "",
        "",
        "",
        "",
        ""
      ],
      "mapping_rules": {
        "format_type": "grouped_purchase_report",
        "description": "Laporan Pembelian Detail (POS/kasir) SAU -- 1 transaksi pembelian (blok) = 1 Purchase Transaction draft + baris itemnya. Tiap blok CSV: header transaksi (No Transaksi, Tanggal, Dept., Kode Supp., Nama Supplier), label item, N baris item, baris subtotal, footer (Pot./Pajak/Biaya/Total Akhir), lalu 1 baris kosong. Format SAMA untuk keempat cabang (CRS, NGY, OL, PCL); cabang dibaca dari kolom Dept. di isi file (cadangan: nama file).",
        "delimiter": ";",
        "quoted_fields": true,
        "encoding": "ISO-8859-1",
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ".",
          "decimal_separator": ","
        },
        "preamble_rows": 7,
        "header_label_row_index": 8,
        "block_start_row_index": 9,
        "purchase_header": {
          "row_shape": "single_row",
          "columns": {
            "no_transaksi": 1,
            "tanggal": 3,
            "dept": 5,
            "kode_supplier": 6,
            "nama_supplier": 7
          }
        },
        "item_header_marker": {
          "match_type": "exact_row_prefix",
          "value": "No.;Kd. Item;Nama Item"
        },
        "item_columns": {
          "no": 1,
          "kode_item": 2,
          "nama_item": 3,
          "jumlah": 8,
          "satuan": 9,
          "harga": 10,
          "potongan_persen": 11,
          "total": 12
        },
        "block_subtotal_columns": {
          "note": "Baris ringkasan sebelum footer: jumlah item total di kolom 8, subtotal (sebelum Pot./Pajak/Biaya) di kolom 12. Parser memakai kolom 12 sebagai subtotal cetak.",
          "jumlah_item_total": 8,
          "subtotal": 12
        },
        "block_footer_marker": {
          "match_type": "exact_row_prefix",
          "value": "Pot. :"
        },
        "block_footer_columns": {
          "potongan": 2,
          "pajak": 5,
          "biaya": 8,
          "total_akhir": 11
        },
        "block_separator": {
          "match_type": "blank_row",
          "description": "Baris kosong (semua kolom trim-kosong) menandai akhir 1 blok transaksi."
        },
        "end_of_data_marker": {
          "match_type": "contains",
          "value": "TOTAL KESELURUHAN",
          "description": "Begitu baris ini ditemukan, SISA file (ringkasan Sub Total/Potongan/Pajak/Biaya Lain/Total Akhir keseluruhan + baris stempel tanggal cetak/REPORT) diabaikan."
        },
        "field_mapping": {
          "purchase_no": "purchase_header.no_transaksi",
          "purchase_date": "purchase_header.tanggal",
          "dept": "purchase_header.dept (cadangan: cabang_dari_nama_file)",
          "vendor_code": "purchase_header.kode_supplier",
          "vendor_name": "purchase_header.nama_supplier",
          "subtotal": "block_subtotal.subtotal",
          "discount": "item Pot. % + block_footer.potongan (dialokasikan ke baris)",
          "tax_amount": "block_footer.pajak (dialokasikan ke baris)",
          "other_costs": "block_footer.biaya (1 baris tambahan)",
          "total": "block_footer.total_akhir"
        },
        "cabang_dari_nama_file": {
          "pattern": "(?:^|[ _\\-])(CRS|NGY|OL|PCL)(?![A-Za-z])",
          "group": 1,
          "contoh": "Data Pembelian Detail 01-31 Juli 2026 PCL.csv -> PCL; Data_Pembelian_Detail_01-30_Agustus_2026_PCL.csv -> PCL; Data_Pembelian_Detail_..._OL__1_.csv -> OL. Hanya cadangan: Dept. di isi file menang atas nama file. Daftar kode sengaja dibatasi 4 cabang; kalau ada cabang baru, tambahkan kodenya di pola ini."
        },
        "currency_default": "IDR",
        "category_default": "Inventory",
        "biaya_description": "Other Costs",
        "line_account": {
          "account_code": "11500099",
          "account_name": "PERSEDIAAN"
        },
        "biaya_account": {
          "account_code": "11500099",
          "account_name": "PERSEDIAAN"
        },
        "line_account_by_dept": {
          "CRS": {
            "account_code": "11500001",
            "account_name": "PERSEDIAAN CRS"
          },
          "NGY": {
            "account_code": "11500002",
            "account_name": "PERSEDIAAN NGY"
          },
          "OL": {
            "account_code": "11500003",
            "account_name": "PERSEDIAAN OL"
          },
          "PCL": {
            "account_code": "11500004",
            "account_name": "PERSEDIAAN PCL"
          }
        },
        "ap_account": {
          "account_code": "21200001",
          "account_name": "HUTANG USAHA"
        },
        "tax_account": {
          "account_code": "11300998",
          "account_name": "PAJAK MASUKAN"
        },
        "row_granularity": "per_purchase_block",
        "total_resmi_contoh": {
          "note": "Angka 'TOTAL KESELURUHAN' resmi di bawah tiap file contoh Agustus 2026 -- dipakai untuk rekonsiliasi setelah upload (jumlahkan Grand Total transaksi hasil import per cabang; OL akan kurang Rp 42.340.800 karena BL-000001890-26 ditolak). Hanya dokumentasi, tidak dibaca parser.",
          "periode": "2026-08",
          "CRS": {"transaksi": 77, "jumlah_item": 39749, "sub_total": 2104120286, "potongan": 599984, "pajak": 10564799, "biaya_lain": 2, "total_akhir": 2114085103},
          "NGY": {"transaksi": 122, "jumlah_item": 147216, "sub_total": 8321924200, "potongan": 61935863, "pajak": 99784935, "biaya_lain": 400191, "total_akhir": 8360173463},
          "OL": {"transaksi": 11, "jumlah_item": 2649, "sub_total": 949074313, "potongan": 45993476, "pajak": 38580959, "biaya_lain": 150, "total_akhir": 941661796, "ditolak": ["BL-000001890-26"]},
          "PCL": {"transaksi": 38, "jumlah_item": 11531, "sub_total": 2855035932, "potongan": 180087194, "pajak": 273207043, "biaya_lain": 442, "total_akhir": 2948156223}
        },
        "catatan_analisis": "Dianalisis dari 4 file contoh periode Agustus 2026 (CRS 77 blok, NGY 122, OL 11, PCL 38 = 248 blok; nomor BL-<9 digit>-26, tidak ada nomor ganda lintas file maupun terhadap file Juli) dan dicek ulang ke 4 file Juli 2026 (249 blok, semua valid). Baris header ke-8 identik di kedelapan file (hash sama). Pot. % per item hanya ada di 1 blok; Pot./Pajak/Biaya footer ada di sebagian blok. Rumus footer: Total Akhir = subtotal - Pot. + Pajak + Biaya, berlaku di semua blok kecuali BL-000001890-26 (OL, Biaya 150 tidak ikut Total Akhir -> ditolak parser, input manual). Verifikasi Agustus: 248 blok -> 247 valid, 789 baris item + 17 baris Other Costs; pajak selalu 11%; Sub Total/Potongan/Pajak/Biaya Lain/Total Akhir dan Jumlah Item tiap file cocok dengan angka resmi. Kd. Item sering berisi nama item (229 dari 789 baris kode == nama) dan kode numerik berubah antar bulan (mis. 537 di Juli vs 0000537 di Agustus untuk 10 produk) sehingga bukan kunci master item; pakai nama item (description). 1 kode item NGY melebihi 50 karakter dan terpotong. Biaya < Rp 1.000 pada 15 blok valid adalah pembulatan POS; biaya nyata hanya BL-000001838-26 dan BL-000001963-26 (NGY, Rp 200.000). Nama file tidak menjamin periode (file 01-30 Agustus berisi sampai 31/08)."
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
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) IN ('SAU', 'CV SUMBER ALODIE UTAMA');