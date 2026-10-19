-- seed_template_sau_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk
-- klien SAU (CV Sumber Alodie Utama). SATU baris setting ("Multi") untuk
-- halaman Transactions > Purchase (upload file laporan pembelian), yang
-- melayani laporan pembelian dari KEEMPAT cabang:  CRS, NGY, OL, PCL.
--
-- STATUS: varian CSV dan PDF. Varian Excel ditambahkan kemudian ke array
-- "variants" (tidak perlu baris template baru -- lihat "Menambah varian").
-- Varian PDF = pola (posisi kolom, aturan pergantian halaman, signature) yang dibaca oleh
-- _parse_grouped_purchase_report_pdf di purchase_import_v1.py (lihat "PARSER PDF PURCHASE").
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
--   * 248 blok (CRS 77 + NGY 122 + OL 11 + PCL 38): 248 valid, 1 di antaranya BERPERINGATAN
--     (BL-000001890-26, lihat "KETERBATASAN" no. 1). 792 baris item + 17 baris "Other Costs"
--     (blok dengan "Biaya :" > 0 kecuali BL-000001890-26) = 809 baris transaksi.
--     (Sebelum parser menerima peringatan Biaya: 247 valid, 789 item + 17 = 806 baris.)
--   * Jumlah Sub Total, Potongan, Pajak, Biaya Lain, dan Total Akhir semua blok = angka
--     "TOTAL KESELURUHAN" resmi di bawah tiap file (keempat file, tanpa selisih).
--     Jumlah kuantitas semua baris item juga = "Jumlah Item" resmi (CRS 39.749, NGY 147.216,
--     OL 2.649, PCL 11.531) -> pembacaan angka dengan titik ribuan sudah benar.
--   * Total Akhir 248 blok = Rp 14.364.076.585; semuanya masuk (Rp 14.364.076.585);
--     versi parser lama menolak BL-000001890-26 sehingga hanya Rp 14.321.735.785 yang masuk.
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
-- SUMBER PDF (laporan yang SAMA dicetak ke PDF; 4 file contoh periode 01/08/26 - 31/08/26,
-- nama file "Data_Pembelian_Detail_01-30_Agustus_2026_<CABANG>__1_.pdf"; isinya sama dengan
-- 4 CSV Agustus di atas):
--   CRS 14 halaman,  77 transaksi, 243 baris item
--   NGY 21 halaman, 122 transaksi, 368 baris item
--   OL   2 halaman,  11 transaksi,  21 baris item
--   PCL  9 halaman,  38 transaksi, 160 baris item
-- Keempatnya dibuat generator yang sama (Developer Express DXperience v12.1.12), A4 595x841 pt,
-- punya text layer (bukan scan -> tidak perlu OCR), dan POSISI KOLOM-nya identik di keempat
-- file serta semua halaman (satuan pt, dari kata di text layer):
--   Header transaksi (x0 tepi kiri):  No Transaksi 20 | Tanggal 110 | Dept. 175 |
--                                     Kode Supp. 211 | Nama Supplier 274
--   Baris item: No 20 | Kd. Item x0 46-104 (membungkus ke baris di bawahnya) |
--     Nama Item x0 110-295 (juga membungkus) | Jml rata kanan x1=344.5 | Satuan x0 348 |
--     Harga rata kanan x1=460.9 | Pot. % rata kanan x1=491.7 | Total rata kanan x1=576.3
--   Kolom angka SELALU rata kanan, jadi dikenali lewat x1 (tepi kanan), bukan x0.
-- Hasil uji prototipe (membaca kata + posisi, 1 transaksi = 1 blok; tanpa mengubah kode backend):
--   * 248 blok (CRS 77 + NGY 122 + OL 11 + PCL 38) dan 792 baris item (CRS 243, NGY 368,
--     OL 21, PCL 160) -- SAMA PERSIS dengan hasil varian CSV.
--   * Jumlah "Total Akhir" semua blok = "TOTAL KESELURUHAN" resmi tiap file: CRS 2.114.085.103,
--     NGY 8.360.173.463, OL 941.661.796, PCL 2.948.156.223. Jumlah kuantitas = "Jumlah Item"
--     resmi (CRS 39.749, NGY 147.216, OL 2.649, PCL 11.531).
--   * Per blok: jumlah total baris item = subtotal cetak (satu pengecualian -1 rupiah:
--     BL-000001865-26 CRS, sama dengan keterbatasan no. 9) dan Total Akhir = subtotal - Pot. +
--     Pajak + Biaya (satu pengecualian: BL-000001890-26 OL, sama dengan keterbatasan no. 1).
--   * Baris berharga 0 = 31 (CRS 7, NGY 17, PCL 7) dan baris ber-Pot. % = 8 (BL-000001865-26),
--     sama dengan CSV. Nomor transaksi tidak ada yang ganda lintas keempat file.
--   * Dept. di tiap blok = cabang file (CRS/NGY/OL/PCL); tanggal 01/08/2026 s.d. 31/08/2026
--     (OL 04-28/08, PCL 04-31/08).
--
-- CARA APLIKASI MEMBACA UPLOAD PDF (varian PDF):
--   1. Penanda varian = header tabel "No Transaksi | Tanggal | Dept. | Kode Supp. |
--      Nama Supplier" (5 sel, dinormalisasi persis seperti _normalisasi_baris: trim, spasi
--      tunggal, huruf kecil, digabung '|') -> SHA-256 =
--      cc03ab080f3911a706f5a3edec20be4cd805fc953da3a948b37d8ba122a54fa0. Judul "LAPORAN PEMBELIAN DETAIL" di halaman 1 jadi
--      pengaman tambahan (laporan PDF SAU lain bisa memakai header tabel yang mirip).
--   2. Resep "grouped_purchase_report_pdf" membaca KATA + POSISI (x0, x1, top), bukan baris teks.
--      Hasilnya sama dengan CSV: 1 blok = 1 transaksi pembelian + baris itemnya (Pot. % item ->
--      discount baris; "Pot. :" footer dialokasikan; "Pajak :" -> tax_amount; "Biaya :" ->
--      1 baris "Other Costs"; sisa pembulatan ke baris terakhir).
--   3. JANGAN membaca PDF per baris teks biasa -- urutannya menyesatkan:
--      a. Pada item yang kodenya membungkus, qty (Jml) tercetak di baris PERTAMA kode, sebelum
--         nama item; pada item satu baris urutannya kode, nama, qty. Angka di dalam nama/kode
--         ("5 L", "25 L", "1.5KG", "(ISI 6)") mudah terbaca sebagai qty. Pakai posisi x1 kolom Jml.
--      b. Band header tabel di halaman lanjutan tumpang tindih dengan baris lanjutan item di
--         bagian paling atas halaman (mis. PCL hal. 2: kata "Transaksi" menyatu dengan "20KG"
--         jadi "Tra2n0sKaGksi"). Ekstrak kata dengan y_tolerance kecil (0,3 pt) dan
--         x_tolerance 2 pt, baru kelompokkan jadi baris dengan toleransi 3 pt, lalu buang kata
--         band berdasarkan TEKS + x0-nya (bukan membuang seluruh baris).
--   4. CABANG dibaca dari kolom Dept. di tiap blok (sama dengan CSV). Cadangan dari nama file
--      lewat pola yang sama dengan CSV: "..._PCL__1_.pdf" -> PCL, "..._OL.pdf" -> OL.
--   5. Pergantian halaman (PENTING, sudah diuji; aturannya ada di page_break_rules):
--      a. BARIS ITEM DICETAK 2x: baris item yang terpotong di pergantian halaman tercetak di
--         dasar halaman lalu DIULANG di awal halaman berikutnya dengan nomor urut yang sama.
--         4 kasus: CRS BL-000001884-26 (item 1); NGY BL-000001850-26 (item 3),
--         BL-000001894-26 (item 3), BL-000002056-26 (item 4). Tanpa aturan ini item dan
--         subtotal berlebih (mis. BL-000001884-26 terbaca 1.065.000, padahal 532.500).
--      b. HEADER TRANSAKSI DICETAK 2x: NGY BL-000001910-26 -- salinan di dasar halaman 10 TANPA
--         Tanggal, lalu diulang lengkap di halaman 11. Pakai kolom dari salinan kedua.
--      c. Footer dan baris subtotal bisa jatuh di atas halaman berikutnya (setelah band header),
--         dan baris lanjutan kode/nama item bisa jatuh di halaman berikutnya -- keduanya milik
--         blok/item yang masih terbuka.
--      d. Ringkasan akhir "TOTAL KESELURUHAN" bisa terbelah ke halaman berikutnya dan label
--         "Biaya Lain :" tercetak 2x (CRS hal. 13-14) -- hitung sekali.
--   6. Footer di PDF ADALAH 1 BARIS: "Pot. : X Pajak : Y Biaya : Z Total Akhir : T" (di CSV,
--      label "Biaya :" terpisah dari nilainya). Ketiga PDF-nya memakai regex yang sama.
--
-- PARSER PDF PURCHASE: purchase_import_v1.py punya parser format_type
-- "grouped_purchase_report_pdf" (_parse_grouped_purchase_report_pdf) yang membaca recipe varian
-- PDF ini. Pencocokan lewat band header halaman 1 (hash di atas + judul "LAPORAN PEMBELIAN
-- DETAIL"); PDF yang tidak cocok / tanpa text layer (scan) -> "Butuh Review" tanpa error.
-- Beda dengan CSV, tiap blok PDF dicek lebih ketat: jumlah total item harus = subtotal cetak
-- (kalau tidak, blok DITOLAK: kemungkinan ada item hilang/dobel), dan qty x harga yang jauh
-- dari total item jadi PERINGATAN (kemungkinan salah baca kolom). Kode ini diuji dengan PDF
-- sintetis yang meniru tata letak (posisi kolom, band header, pergantian halaman); pengujian
-- dengan 4 PDF asli Agustus perlu dijalankan sebelum dipakai produksi.
--
-- KETERBATASAN YANG DIKETAHUI (bukan salah template, tapi perlu diketahui pengguna;
-- no. 1-13 berlaku sama untuk CSV dan PDF karena isi datanya identik):
--   1. SATU BLOK BERPERINGATAN (dulu DITOLAK): BL-000001890-26 (OL, 08/08/2026, SP0432 PT MATAHARI SAKTI
--      (PET FOOD), 3 item TAISHO-2/TAISHO-5/TAISHO-5 SPESIAL, subtotal 42.340.800). Footer-nya
--      "Biaya : 150" tetapi "Total Akhir" tetap 42.340.800 (biaya TIDAK ikut dijumlah oleh POS),
--      sehingga baris item + Other Costs 150 = 42.340.950 != 42.340.800. Parser lama menolaknya
--      ("Line total 42,340,950.00 != printed grand total 42,340,800.00"). Parser sekarang
--      mengenali pola ini (selisih persis sebesar Biaya cetak): blok tetap VALID, baris "Other
--      Costs" 150 TIDAK dibuat (Hutang = Total Akhir cetak 42.340.800), dan peringatannya tampil
--      di validation_notes + notes transaksi. Recipe "biaya_tidak_ikut_total": "warn" (default)
--      / "reject" (kembali menolak). Selisih lain tetap ditolak (toleransi Rp 1). Footer OL
--      resmi sendiri tidak konsisten: 949.074.313 - 45.993.476 + 38.580.959 + 150 =
--      941.661.946, padahal Total Akhir resmi 941.661.796 (selisih persis 150). Di upload
--      file OL Agustus kini 11 dari 11 transaksi valid (1 berperingatan).
--      Tetap periksa dokumen aslinya (atau minta POS memperbaiki footer-nya): Biaya 150 itu
--      tidak tercatat di jurnal.
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
--   Juli 4/4 cocok ke template, Dept. terbaca benar. Varian PDF kini punya parser (lihat
--   "PARSER PDF PURCHASE" di atas); varian Excel BELUM punya parser Purchase -- upload Excel ->
--   template_matched=false ("Butuh Review").
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
--   SHA-256("<hash_csv>:<hash_pdf>")
--   hash_csv = f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64
--   hash_pdf = cc03ab080f3911a706f5a3edec20be4cd805fc953da3a948b37d8ba122a54fa0
-- -> 83b3ce13b0ecce8cf1bc7581b5c39d8834608f3db04191d2d24b99ec823d9765
-- (versi CSV-saja dulu: SHA-256(hash_csv) = 38ba284a93b8d55b8c00257d05a4c00c6d7b9ad3585984d07198c97ce56d1e2f. Kalau seed versi itu
-- sudah terlanjur dijalankan, hapus baris lamanya dulu -- lihat bagian "Idempotensi".)
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya
-- pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan adalah nilai di
-- dalam tiap varian. Setiap varian ditambah/dihapus, hitung ulang hash level baris dari
-- gabungan hash varian (urutan = urutan array "variants").
--
-- KLIEN: dicari lewat client_code = 'SAU' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
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
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'SAU'
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = '83b3ce13b0ecce8cf1bc7581b5c39d8834608f3db04191d2d24b99ec823d9765';
-- Kalau yang ada di database masih baris Multi versi CSV-saja (hash lama), hapus yang itu
-- sebelum menjalankan seed ini -- kalau tidak, hasilnya 2 baris Multi untuk SAU (UNIQUE tidak
-- menolak karena hash level barisnya beda):
--   DELETE FROM financial_transaction_purchase_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'SAU'
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = '38ba284a93b8d55b8c00257d05a4c00c6d7b9ad3585984d07198c97ce56d1e2f';
--
-- Menonaktifkan template lama SAU bertipe CSV (HANYA setelah upload lewat template Multi terbukti jalan):
--   UPDATE financial_transaction_purchase_import_templates t
--      SET is_active = false, edited_at = now()
--     FROM management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'SAU'
--      AND t.file_type = 'CSV' AND t.column_signature_hash = 'f5b9fc4d1e289233f6f2d71a9c1f07c16b88db8f4ee99f53ca70bba71f89ef64';
--
-- Menambah varian Excel nanti: tambahkan 1 objek lagi di array "variants" (file_type,
-- sheet_name, header_row_index, data_start_row_index, column_signature_hash dari baris
-- header file contoh, header_columns, mapping_rules), lalu hitung ulang hash level baris.
-- Kalau seed ini sudah dijalankan, ubah baris yang ada lewat UPDATE (jangan INSERT baru)
-- atau hapus dulu lalu jalankan ulang file ini.
-- Varian PDF: header_row_index = 1 dan data_start_row_index = 2 adalah posisi LOGIS (baris 1 =
-- band header tabel, baris 2 = header transaksi pertama), bukan nomor baris fisik -- PDF tidak
-- punya baris tetap karena teksnya membungkus dan terpotong antar halaman. Pencocokannya lewat
-- hash header.
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
      AND upper(trim(client_code)) = 'SAU'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien SAU belum ada di management_clients (dicari client_code = ''SAU''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '83b3ce13b0ecce8cf1bc7581b5c39d8834608f3db04191d2d24b99ec823d9765',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien SAU untuk laporan pembelian semua cabang (CRS, NGY, OL, PCL). Saat ini varian CSV dan PDF (format SAMA untuk keempat cabang di masing-masing tipe file); varian Excel ditambahkan kemudian ke array variants. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok. Varian PDF baru berfungsi setelah parser PDF Purchase dibuat di backend.",
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
        "biaya_tidak_ikut_total": "warn",
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
          "note": "Angka 'TOTAL KESELURUHAN' resmi di bawah tiap file contoh Agustus 2026 -- dipakai untuk rekonsiliasi setelah upload (jumlahkan Grand Total transaksi hasil import per cabang; BL-000001890-26 masuk dengan peringatan (Biaya 150 tidak ikut Total Akhir), jadi total OL harus sama). Hanya dokumentasi, tidak dibaca parser.",
          "periode": "2026-08",
          "CRS": {"transaksi": 77, "jumlah_item": 39749, "sub_total": 2104120286, "potongan": 599984, "pajak": 10564799, "biaya_lain": 2, "total_akhir": 2114085103},
          "NGY": {"transaksi": 122, "jumlah_item": 147216, "sub_total": 8321924200, "potongan": 61935863, "pajak": 99784935, "biaya_lain": 400191, "total_akhir": 8360173463},
          "OL": {"transaksi": 11, "jumlah_item": 2649, "sub_total": 949074313, "potongan": 45993476, "pajak": 38580959, "biaya_lain": 150, "total_akhir": 941661796, "berperingatan": ["BL-000001890-26"]},
          "PCL": {"transaksi": 38, "jumlah_item": 11531, "sub_total": 2855035932, "potongan": 180087194, "pajak": 273207043, "biaya_lain": 442, "total_akhir": 2948156223}
        },
        "catatan_analisis": "Dianalisis dari 4 file contoh periode Agustus 2026 (CRS 77 blok, NGY 122, OL 11, PCL 38 = 248 blok; nomor BL-<9 digit>-26, tidak ada nomor ganda lintas file maupun terhadap file Juli) dan dicek ulang ke 4 file Juli 2026 (249 blok, semua valid). Baris header ke-8 identik di kedelapan file (hash sama). Pot. % per item hanya ada di 1 blok; Pot./Pajak/Biaya footer ada di sebagian blok. Rumus footer: Total Akhir = subtotal - Pot. + Pajak + Biaya, berlaku di semua blok kecuali BL-000001890-26 (OL, Biaya 150 tidak ikut Total Akhir -> valid dengan peringatan, tanpa baris Other Costs; recipe biaya_tidak_ikut_total). Verifikasi Agustus: 248 blok -> 248 valid (1 berperingatan), 792 baris item + 17 baris Other Costs; pajak selalu 11%; Sub Total/Potongan/Pajak/Biaya Lain/Total Akhir dan Jumlah Item tiap file cocok dengan angka resmi. Kd. Item sering berisi nama item (229 dari 789 baris kode == nama) dan kode numerik berubah antar bulan (mis. 537 di Juli vs 0000537 di Agustus untuk 10 produk) sehingga bukan kunci master item; pakai nama item (description). 1 kode item NGY melebihi 50 karakter dan terpotong. Biaya < Rp 1.000 pada 15 blok valid adalah pembulatan POS; biaya nyata hanya BL-000001838-26 dan BL-000001963-26 (NGY, Rp 200.000). Nama file tidak menjamin periode (file 01-30 Agustus berisi sampai 31/08)."
      }
    },
    {
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "cc03ab080f3911a706f5a3edec20be4cd805fc953da3a948b37d8ba122a54fa0",
      "header_columns": [
        "No Transaksi",
        "Tanggal",
        "Dept.",
        "Kode Supp.",
        "Nama Supplier"
      ],
      "mapping_rules": {
        "format_type": "grouped_purchase_report_pdf",
        "description": "Laporan Pembelian Detail (POS/kasir) SAU versi PDF -- isi dan struktur blok SAMA dengan varian CSV: 1 transaksi pembelian (blok) = 1 Purchase Transaction draft + baris itemnya. Tiap blok = header transaksi (No Transaksi, Tanggal, Dept., Kode Supp., Nama Supplier), band label item, N baris item, baris subtotal, footer (Pot./Pajak/Biaya/Total Akhir). Beda dengan CSV: tidak ada baris/sel, jadi resep memakai KATA + POSISI (x0, x1, top) di text layer PDF. Format SAMA untuk keempat cabang (CRS, NGY, OL, PCL); cabang dibaca dari kolom Dept. di tiap blok (cadangan: nama file).",
        "source_kind": "pdf_text_layer",
        "pdf_reader": {
          "input": "kata beserta koordinat (x0, x1, top) dari text layer, mis. pdfplumber extract_words(x_tolerance=2, y_tolerance=0.3)",
          "word_extraction": "y_tolerance KECIL (0,3 pt) supaya kata band header yang tumpang tindih dengan baris lanjutan item di puncak halaman lanjutan tidak menyatu (contoh PCL hal. 2: 'Tra2n0sKaGksi'); x_tolerance 2 pt.",
          "line_grouping": "kata diurutkan menurut top lalu dikelompokkan jadi 1 baris bila selisih top <= 3 pt. WAJIB toleransi (bukan pembulatan per 2 pt): kata satu baris bisa berbeda ~1 pt secara vertikal.",
          "page_size_pt": [
            595,
            841
          ],
          "needs_ocr": false,
          "generator": "Developer Express Inc. DXperience v12.1.12 (informasional saja -- JANGAN dipakai untuk pencocokan template)"
        },
        "date_format": "DD/MM/YYYY",
        "number_format": {
          "thousands_separator": ".",
          "decimal_separator": ","
        },
        "signature_rule": {
          "source": "band header tabel (halaman mana pun; berulang di tiap halaman)",
          "cells": [
            "No Transaksi",
            "Tanggal",
            "Dept.",
            "Kode Supp.",
            "Nama Supplier"
          ],
          "normalisasi": "trim, spasi berurutan jadi satu, huruf kecil, digabung '|' (sama dengan _normalisasi_baris di sales_import_v1.py)",
          "hash_input": "no transaksi|tanggal|dept.|kode supp.|nama supplier",
          "guard_judul_halaman_1": "LAPORAN PEMBELIAN DETAIL"
        },
        "preamble": {
          "pages": [
            1
          ],
          "note": "Kop hanya ada di halaman 1: judul, periode, nama perusahaan (INSPIRASI MEDIA KREATIF -- bukan SAU, tidak dibaca), alamat, telepon, dan kode cabang (CRS/NGY/OL/PCL, di kanan alamat; tidak dipakai resep). Halaman berikutnya langsung mulai dari band header tabel.",
          "periode_pattern": "PERIODE\\s*:\\s*(\\d{2}/\\d{2}/\\d{2,4})\\s*-\\s*(\\d{2}/\\d{2}/\\d{2,4})"
        },
        "ignore": {
          "table_header_band": {
            "match_type": "words_by_text_and_x0",
            "value": "No Transaksi Tanggal Dept. Kode Supp. Nama Supplier",
            "anchors_x0": {
              "No": 20,
              "Transaksi": 34,
              "Tanggal": 110,
              "Dept.": 175,
              "Kode": 211,
              "Supp.": 236,
              "Nama": 274,
              "Supplier": 301
            },
            "description": "Band header tabel diulang di bagian atas SETIAP halaman (top ~99 pt di halaman 1, ~16,6 pt di halaman lain). Buang HANYA kata yang cocok teks + x0 (toleransi 2 pt), jangan seluruh baris: di puncak halaman lanjutan baris lanjutan item bisa berada di baris yang sama."
          },
          "item_header_band": {
            "match_type": "words_by_text_and_x0",
            "value": "No. Kd. Item Nama Item Jml Satuan Harga Pot. % Total",
            "anchors_x0": {
              "No.": 20,
              "Kd.": 46,
              "Item": 60,
              "Nama": 110,
              "Item#2": 133,
              "Jml": 332,
              "Satuan": 365,
              "Harga": 439,
              "Pot.": 468,
              "%": 485,
              "Total": 559
            },
            "description": "Band label item di bawah tiap header transaksi (juga bisa terpisah dari header transaksinya di pergantian halaman). Dilewati; dianggap band bila >= 5 kata cocok."
          },
          "page_stamp": {
            "description": "Baris cap di dasar tiap halaman (top ~807,8 pt): '<dd/mm/yyyy hh:mm> REPORT <n>/<N>'. Buang HANYA kata cap-nya: tanggal-jam dan REPORT di x0 < 135 yang cocok pola, dan penghitung halaman '<n>/<N>' di x0 >= 538. Kata lain pada baris yang sama BUKAN cap: baris lanjutan kode/nama item bisa tercetak di baris yang sama dengan cap. Tanggal cetak ini JANGAN dibaca sebagai tanggal transaksi."
          }
        },
        "purchase_header": {
          "row_shape": "single_row_wrapping",
          "no_transaksi_pattern": "^[A-Z]{2,4}-\\d{5,9}-\\d{2}$",
          "start_marker": "kata pertama baris (x0 < 40) cocok no_transaksi_pattern (mis. BL-000001835-26)",
          "columns_x0": {
            "note": "Rentang [min, max) pada x0 (tepi kiri) kata, satuan pt. Diukur dari kata header tabel dan identik di CRS, NGY, OL, PCL serta semua halaman yang diperiksa.",
            "no_transaksi": [
              0,
              40
            ],
            "tanggal": [
              105,
              170
            ],
            "dept": [
              170,
              205
            ],
            "kode_supplier": [
              205,
              270
            ],
            "nama_supplier": [
              270,
              545
            ]
          },
          "multiline_columns": [
            "nama_supplier"
          ],
          "multiline_join": "spasi tunggal, urut dari atas ke bawah; baris di bawah header yang SEMUA katanya di x0 >= 270 dan belum ada item = lanjutan nama supplier (belum ada di 4 contoh -- semua nama supplier 1 baris).",
          "ends_at": "baris item pertama (kata pertama x0 < 40 berupa bilangan bulat)"
        },
        "item_columns_x0": {
          "note": "Kolom angka rata kanan -> dikenali lewat x1 (tepi kanan, toleransi 3 pt), bukan x0. Nilai x1 terukur identik di 4 file: jumlah 344.5, harga 460.9, potongan_persen 491.7, total 576.3. Satuan kadang berisi 2 token ('@25 Kg').",
          "no": {
            "x0": [
              0,
              40
            ]
          },
          "kode_item": {
            "x0": [
              40,
              106
            ],
            "wrap": true
          },
          "nama_item": {
            "x0": [
              106,
              330
            ],
            "wrap": true
          },
          "jumlah": {
            "x1": [
              338,
              347
            ]
          },
          "satuan": {
            "x0": [
              347,
              420
            ]
          },
          "harga": {
            "x1": [
              440,
              470
            ]
          },
          "potongan_persen": {
            "x1": [
              476,
              505
            ]
          },
          "total": {
            "x1": [
              520,
              600
            ]
          }
        },
        "item_row_rules": {
          "start_marker": "baris yang kata pertamanya (x0 < 40) bilangan bulat = baris utama item; Jml, Satuan, Harga, Pot. % dan Total ada di baris utama itu",
          "wrapping": "kode_item dan nama_item membungkus ke baris-baris di bawah baris utama (hanya kata di kolomnya). Baris lanjutan = baris yang punya kata di x0 < 300 tanpa bilangan bulat di x0 < 40. Digabung dengan spasi tunggal, urut top lalu x0. Baris lanjutan bisa jatuh di halaman berikutnya.",
          "kode_item_catatan": "Sama dengan CSV: kode item sering berisi NAMA item atau singkatan (kode bisa beda dari nama di baris yang sama). Pakai nama item (description) untuk mencocokkan produk, bukan kode."
        },
        "block_subtotal": {
          "note": "Baris tanpa kata di x0 < 300: jumlah item total (x1 ~ 344,5) dan subtotal sebelum Pot./Pajak/Biaya (x1 ~ 576,3). Subtotal cetak dipakai sebagai acuan pembulatan, SAMA dengan CSV. Bisa terpisah dari blok-nya di pergantian halaman, jangan dijadikan penentu akhir blok."
        },
        "block_footer_marker": {
          "match_type": "regex",
          "value": "Pot\\.\\s*:\\s*(-?[\\d.]+)\\s+Pajak\\s*:\\s*(-?[\\d.]+)\\s+(?:Biaya\\s*:\\s*(-?[\\d.]+)\\s+)?Total Akhir\\s*:\\s*(-?[\\d.]+)",
          "groups": {
            "potongan": 1,
            "pajak": 2,
            "biaya": 3,
            "total_akhir": 4
          },
          "dipasang_pada": "teks 1 baris (hasil line_grouping)",
          "catatan": "Footer menutup blok. Di PDF footer 1 baris lengkap dengan label dan nilai Biaya (di CSV label 'Biaya :' terpisah dari nilainya). Biaya boleh tidak terbaca (dianggap 0)."
        },
        "page_break_rules": [
          {
            "kasus": "baris_item_dicetak_dua_kali",
            "aturan": "Bila baris utama item bernomor SAMA dengan item terakhir blok yang terbuka, itu salinan yang sama (baris yang terpotong di pergantian halaman tercetak di dasar halaman lalu diulang di awal halaman berikutnya): JANGAN tambah item; GANTI isi item terakhir dengan salinan kedua. Di contoh terjadi 4x (CRS BL-000001884-26; NGY BL-000001850-26, BL-000001894-26, BL-000002056-26); tanpa aturan ini item dan subtotal berlebih."
          },
          {
            "kasus": "header_transaksi_dicetak_dua_kali",
            "aturan": "Bila nomor transaksi yang SAMA muncul lagi saat blok terbuka belum punya footer, itu salinan yang sama: JANGAN buat blok baru; pakai kolom dari salinan kedua yang lengkap (salinan di dasar halaman bisa tanpa Tanggal). Di contoh terjadi 1x (NGY BL-000001910-26)."
          },
          {
            "kasus": "footer_di_halaman_berikutnya",
            "aturan": "Footer dan baris subtotal bisa tercetak di bagian ATAS halaman berikutnya, setelah band header tabel dan SEBELUM header transaksi berikutnya. Footer selalu milik blok terakhir yang masih terbuka."
          },
          {
            "kasus": "lanjutan_item_di_halaman_berikutnya",
            "aturan": "Baris lanjutan kode/nama item yang terpotong tercetak di halaman berikutnya (mis. PCL BL-000001948-26 item 1); gabungkan ke item terakhir yang terbuka sesuai kolomnya."
          },
          {
            "kasus": "ringkasan_akhir_terbelah",
            "aturan": "Ringkasan 'TOTAL KESELURUHAN' bisa terbelah ke halaman berikutnya dan label (mis. 'Biaya Lain : 2') tercetak 2x (CRS hal. 13-14): ambil nilainya sekali."
          }
        ],
        "end_of_data_marker": {
          "match_type": "contains",
          "value": "TOTAL KESELURUHAN",
          "description": "Begitu baris ini ditemukan, SISA file (ringkasan Jumlah Item/Sub Total/Potongan/Pajak/Biaya Lain/Total Akhir keseluruhan, lalu cap halaman terakhir) tidak dibaca sebagai transaksi. Total Akhir ringkasan = jumlah Total Akhir semua blok (kecuali blok yang ditolak) -- cocok untuk validasi."
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
        "biaya_tidak_ikut_total": "warn",
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
          "note": "Angka 'TOTAL KESELURUHAN' resmi di bawah tiap file contoh Agustus 2026 -- dipakai untuk rekonsiliasi setelah upload (jumlahkan Grand Total transaksi hasil import per cabang; BL-000001890-26 masuk dengan peringatan (Biaya 150 tidak ikut Total Akhir), jadi total OL harus sama). Hanya dokumentasi, tidak dibaca parser.",
          "periode": "2026-08",
          "CRS": {
            "transaksi": 77,
            "jumlah_item": 39749,
            "sub_total": 2104120286,
            "potongan": 599984,
            "pajak": 10564799,
            "biaya_lain": 2,
            "total_akhir": 2114085103
          },
          "NGY": {
            "transaksi": 122,
            "jumlah_item": 147216,
            "sub_total": 8321924200,
            "potongan": 61935863,
            "pajak": 99784935,
            "biaya_lain": 400191,
            "total_akhir": 8360173463
          },
          "OL": {
            "transaksi": 11,
            "jumlah_item": 2649,
            "sub_total": 949074313,
            "potongan": 45993476,
            "pajak": 38580959,
            "biaya_lain": 150,
            "total_akhir": 941661796,
            "berperingatan": [
              "BL-000001890-26"
            ]
          },
          "PCL": {
            "transaksi": 38,
            "jumlah_item": 11531,
            "sub_total": 2855035932,
            "potongan": 180087194,
            "pajak": 273207043,
            "biaya_lain": 442,
            "total_akhir": 2948156223
          }
        },
        "catatan_analisis": "Dianalisis dari 4 PDF contoh periode 01/08/26-31/08/26 (CRS 14 hal / 77 blok / 243 item, NGY 21 hal / 122 blok / 368 item, OL 2 hal / 11 blok / 21 item, PCL 9 hal / 38 blok / 160 item) -- isi sama dengan 4 CSV Agustus. Posisi kolom dan band header identik di keempat file. Jumlah Total Akhir semua blok dan jumlah kuantitas = angka 'TOTAL KESELURUHAN' resmi tiap file; BL-000001890-26 (OL) tetap tidak konsisten (Biaya 150 tidak ikut Total Akhir) dan diterima dengan peringatan seperti di CSV (tanpa baris Other Costs). 4 baris item dan 1 header transaksi dicetak dua kali di pergantian halaman (lihat page_break_rules). Kode item sering berisi nama item dan bisa beda dari nama; pakai nama item (description)."
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
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'SAU';