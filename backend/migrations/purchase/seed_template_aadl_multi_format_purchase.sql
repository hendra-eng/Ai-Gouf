-- seed_template_aadl_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk
-- klien AADL (PT Akshaya Ananda Dylan Lestari). SATU baris setting ("Multi") untuk
-- Transactions > Purchase > Source Data, melayani BUKU KAS KECIL (rekap pembayaran
-- patty cash) dari 5 cabang/usaha AADL. Mengikuti pola seed purchase NBM/SAU dan seed
-- sales AADL (workbook 1 cabang, 1 sheet per bulan).
--
-- STATUS: hanya varian Excel (5 varian, 1 per cabang). Varian CSV/PDF nanti cukup
-- ditambahkan ke array "variants".
--
-- PENTING -- BENTUK FILE AADL: BUKAN laporan pembelian/invoice, melainkan BUKU KAS KECIL:
--   kolom NO | TANGGAL | KETERANGAN | DEBET | CREDIT | SALDO, 1 sheet per bulan
--   ("Desember 2025" .. "Oktober 2026"), ditambah sheet bantu (Sheet1, Sheet2, "Sheet1 (2)")
--   yang bukan data. TIDAK ada nomor nota, nama supplier, kolom pajak. Debet = pencairan dana
--   ke kas kecil ("Terima Pencairan Adv"), Credit = pengeluaran. Karena itu dipakai format_type
--   BARU 'monthly_petty_cash_ledger' (purchase_import_v1.py) yang membaca SEMUA sheet bulanan.
--
-- SUMBER (5 file contoh):
--   Rekapan_Pembayaran_Pattycash_Warung_Soemantri_2026       -> WARUNG SOEMANTRI
--   Rekapan_Pembayaran_Pattycash_Kost_Warung_Soemantri_2026  -> KOST WARUNG SOEMANTRI
--   Rekapan_Pembayaran_Pattycash_Kost_Kapu_Soemantri_2026    -> KAPU SOEMANTRI
--   Rekapan_Pembayaran_Patty_Cash_Putu_Soemantri_2026        -> VILLA PUTU SOEMANTRI
--   Rekap_Pembayaran_Patty_cash_Omah_Soemantri_-_2026        -> OMAH & KOPI SOEMANTRI
--   (nama cabang SAMA dengan seed sales AADL supaya laporan antar modul sejajar;
--    nama file tidak dipakai untuk mengenali cabang)
--
-- CARA APLIKASI MEMBACA UPLOAD:
--   1. Varian dikenali lewat hash BARIS JUDUL (recipe.judul_row_index) sheet-sheet bulanan,
--      BUKAN baris header, karena header NO/TANGGAL/KETERANGAN/DEBET/CREDIT/SALDO sama
--      di 4 dari 5 file (Omah beda: sel KETERANGAN kosong). Sel kosong di ujung baris dibuang
--      sebelum di-hash (lebar sheet beda-beda: 6 s.d. 188 kolom).
--         varian                   judul (baris)                                  header
--         WARUNG SOEMANTRI         "Warung Soemantri" (3)                         baris 5
--         KOST WARUNG SOEMANTRI    "Kost Warung Soemantri" (3)                    baris 5
--         KAPU SOEMANTRI           "Kost Kapu Soemantri" (3)                      baris 5
--         VILLA PUTU SOEMANTRI     "PUTU SOEMANTRI FAMILY VILLAS - DENPASAR" (2)  baris 4
--         OMAH & KOPI SOEMANTRI    "OMAH SOEMANTRI" (3)                           baris 6
--   2. Sheet bulanan = nama "<bulan> <tahun>"; Sheet1/Sheet2/"Sheet1 (2)" diabaikan.
--      Tahun dari nama sheet (recipe.tahun = nama_sheet); periode_mulai / periode_akhir
--      ("YYYY-MM") opsional untuk membatasi bulan.
--   3. 1 baris CREDIT (pengeluaran) = 1 transaksi pembelian draft, 1 baris item senilai Credit,
--      vendor generik "Petty Cash <Cabang>", cabang tetap per varian (kolom Dept/cabang).
--      Nomor transaksi: PC-<kode>-<YYYYMM>-<urut> (kode WRG/KWS/KPS/VPS/OMH; urut = urutan baris
--      pengeluaran di sheet). Kolom NO TIDAK dipakai (ganda di beberapa sheet Putu/Warung).
--   4. DILEWATI diam-diam: baris Saldo Awal / "Saldo Per ...", baris kosong, Debet berawalan
--      "Terima ..." (pencairan dana), teks tanpa nominal, angka negatif tanpa keterangan.
--   5. Ditandai TIDAK VALID (muncul di Source Data, tidak jadi transaksi; file berstatus
--      "Butuh Review"): Debet selain "Terima ..." (mis. "Koreksi ..."), Credit bernilai
--      tanpa keterangan, nomor, dan tanggal (angka nyasar), serta sheet bulanan dengan nama
--      tidak dikenali. Ada 5 baris begini di 5 file contoh (lihat HASIL UJI).
--   6. Kategori dari kata kunci pada keterangan (recipe.kategori_rules, urutan = prioritas):
--      Listrik, Internet & Telekomunikasi, Gas, Bahan Makanan & Minuman, Kebersihan &
--      Perlengkapan Kamar, BBM & Transportasi, Perbaikan & Pemeliharaan, Pajak/Iuran/Retribusi,
--      Tenaga Kerja Harian, Laundry, dll; tidak cocok -> "Lainnya" (sekitar 7% baris).
--      Kategori masuk catatan transaksi ("Category: Listrik") dan dipetakan ke kategori Purchase
--      aplikasi (Utilities, Raw Materials, Inventory, Travel, Maintenance, Office Supplies, Other).
--   7. TANGGAL: dari kolom TANGGAL; boleh kosong ("tanggal_wajib": false -> purchase_date NULL).
--      Tahun salah ketik di sheet (2025-01-05 di sheet Januari 2026) dikoreksi ke tahun sheet;
--      tanggal di luar bulan sheet (selain bulan sebelumnya, yang wajar untuk catatan akhir
--      bulan) diberi peringatan; teks tanggal rusak ("12//04/2026") dikosongkan + peringatan.
--      Khusus VILLA PUTU: 69% baris tidak bertanggal, jadi varian ini memakai
--      "tanggal_kosong": "ikut_baris_sebelumnya" (baris tanpa tanggal ikut tanggal baris
--      bertanggal di atasnya pada sheet yang sama, dengan catatan "Date not in the source ...").
--      Baris di awal sheet sebelum ada tanggal tetap kosong. Ganti ke "kosong" bila tidak mau.
--   8. Catatan tiap transaksi memuat "Source: sheet '<nama>', row <n>" untuk penelusuran ke file.
--
-- HASIL UJI (kode parser ASLI purchase_import_v1.py dijalankan ke 5 file contoh; tiap file
-- cocok ke varian yang benar; jumlah SAMA dengan hitungan terpisah langsung dari sel Excel):
--   Warung      207 transaksi   100.251.914     (Des 2025 - Okt 2026)
--   Kost Warung 122 transaksi    26.380.503     (Des 2025 - Sep 2026)
--   Kapu        96 transaksi     30.137.090     (Des 2025 - Okt 2026)
--   Putu        638 transaksi   137.816.697     (24 tanpa tanggal; 3 tahun dikoreksi)
--   Omah        1.719 transaksi 407.088.668     (Des 2025 - Okt 2026)
--   TOTAL       2.782 transaksi 701.674.872, tanpa nomor ganda; 5 baris tidak valid:
--     Warung Jun 2026 baris 18  Debet 124.779 "Koreksi transaksi"
--     Warung Sep 2026 baris 37  Credit 1.799.886 tanpa keterangan (angka nyasar di bawah tabel)
--     Kost Warung Jun 2026 baris 14  Debet 250.000 "Koreksi uang sampah maret (double input)"
--     Putu Sep 2026 baris 36    Debet 2.000.000 tanpa keterangan
--     Omah Des 2025 baris 53    Debet 10.100 "Koreksi pencatatan november"
--   Koreksi Debet TIDAK mengurangi pengeluaran otomatis (total koreksi 384.879): catat manual
--   atau koreksi transaksinya bila perlu.
--
-- HAL YANG PERLU DIKETAHUI (batas resep):
--   * Ini buku kas kecil, bukan nota: tidak ada supplier/nomor nota; vendor generik per cabang.
--     Transaksi dibuat sebagai Purchase draft berstatus belum dibayar; karena sudah dibayar dari
--     kas kecil, set akun hutang (ap_account) ke akun KAS KECIL lewat Settings > Account Mapping
--     klien (atau isi recipe) sebelum posting, supaya jurnalnya Dr beban / Cr Kas Kecil.
--   * Nomor transaksi bergantung urutan baris. Upload ulang workbook yang sama menghasilkan nomor
--     yang sama (yang sudah ada dihitung duplikat/bentrok). Menyisipkan/menghapus baris di tengah
--     bulan menggeser nomor baris sesudahnya.
--   * Sheet bulan berjalan/depan ikut terbaca bila sudah berisi pengeluaran. Batasi dengan
--     periode_akhir ("YYYY-MM") di resep bila perlu.
--   * Struktur HARUS tetap: baris judul sheet sama (judul berubah -> file "Butuh Review";
--     tambahkan hash judul baru ke recipe.signature_alternatif varian itu) dan kolom A header = "NO".
--
-- AKUN JURNAL: BELUM DIISI (sama dengan seed sales AADL). COA AADL belum ada di repo
-- (tidak ada seed_coa_aadl.sql) dan akun tidak boleh ditebak (posting ditolak bila kode tidak
-- ada di COA klien). Selama kosong, akun baris/hutang ikut Settings > Account Mapping klien.
-- Setelah COA AADL ada, ubah resep (UPDATE / hapus lalu jalankan ulang seed ini):
--   "line_account_by_kategori": { "Listrik": {"account_code": "...", "account_name": "..."}, ... }
--   (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil), atau
--   "line_account_by_dept": { "WARUNG SOEMANTRI": {...}, ... } (kunci HURUF BESAR = nilai cabang), atau
--   "line_account", "ap_account" (akun umum). Urutan prioritas: kategori > cabang > umum/Settings.
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian dipisah ':' urut array
-- "variants" (pola seed NBM/SAU/sales AADL):
--   h_warung     = 9151f324df7ec9f21f46e46407fb727b844fbb0015f388f64442e6a04bffa2a7   ("warung soemantri")
--   h_kostwarung = 1cdead52382a13e30d29298a8db2a573559ffc8bbf253f7fbb6ab73436da2124   ("kost warung soemantri")
--   h_kapu       = d0efc7211024462e1f05190eb1c0195950d8d3955b22cd0eeaf8ce15bbaa9b6d   ("kost kapu soemantri")
--   h_putu       = cfbd7b1879e1c852fd3926f4f1b5a6e192bda5d49012fc1de8156e3930b5d7e1   ("putu soemantri family villas - denpasar")
--   h_omah       = aefcc50012d196955f90983587e26b1eb3e926b520bb60adcd7ef18c523f4573   ("omah soemantri")
--   -> 2179d0165ee1e40c7b3b774d00ae35fcb2db715381d7b82adf47d1a5fb8db7e0
-- (hash varian = _hash_baris([judul]): huruf kecil, spasi dirapikan; sama dengan hash judul di
--  seed sales AADL untuk cabang yang berjudul sama.) header_row_index/data_start_row_index
-- level baris hanya pengisi kolom NOT NULL untuk template Multi.
--
-- KLIEN: dicari lewat client_code = 'AADL' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- PRASYARAT KODE: purchase_import_v1.py versi yang memuat format_type monthly_petty_cash_ledger
-- (patch purchase_ledger_parser.patch) dan migration purchase/34-allow_null_purchase_date.py
-- (Putu masih punya baris tanpa tanggal). Tanpa parser, upload AADL jatuh ke "Butuh Review".
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_aadl_multi_format_purchase.sql
--
-- Idempotensi: tanpa ON CONFLICT (run-2x gagal di uq_purchase_import_templates_signature).
-- Kalau resep direvisi, hapus baris lama lalu jalankan ulang:
--   DELETE FROM financial_transaction_purchase_import_templates t
--    USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'AADL'
--      AND t.file_type = 'Multi'
--      AND t.column_signature_hash = '2179d0165ee1e40c7b3b774d00ae35fcb2db715381d7b82adf47d1a5fb8db7e0';

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'AADL'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien AADL belum ada di management_clients (dicari client_code = ''AADL''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
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
        '2179d0165ee1e40c7b3b774d00ae35fcb2db715381d7b82adf47d1a5fb8db7e0',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien AADL untuk file pembelian: buku kas kecil (rekap pembayaran patty cash) per cabang. 5 varian Excel, 1 per cabang; varian dikenali lewat baris JUDUL sheet bulanan (column_signature_hash = hash judul). Varian CSV/PDF ditambahkan kemudian ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 5,
      "data_start_row_index": 6,
      "column_signature_hash": "9151f324df7ec9f21f46e46407fb727b844fbb0015f388f64442e6a04bffa2a7",
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "format_type": "monthly_petty_cash_ledger",
        "description": "Buku kas kecil (rekap pembayaran patty cash) WARUNG SOEMANTRI: 1 sheet per bulan; 1 baris CREDIT = 1 transaksi pembelian. Judul sheet baris 3: Warung Soemantri.",
        "source_kind": "excel_workbook_monthly",
        "cabang_tetap": "WARUNG SOEMANTRI",
        "nomor_prefix": "PC-WRG",
        "vendor_default": "Petty Cash Warung Soemantri",
        "judul_row_index": 3,
        "header_row_index": 5,
        "data_start_row_index": 6,
        "columns": {
          "no": 1,
          "tanggal": 2,
          "keterangan": 3,
          "debet": 4,
          "kredit": 5,
          "saldo": 6
        },
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tahun": "nama_sheet",
        "tanggal_wajib": false,
        "abaikan_baris_jika_keterangan": "^saldo",
        "abaikan_debet_jika_keterangan": "^terima",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "currency_default": "IDR",
        "category_default": "Other",
        "purchase_category_default": "Other",
        "kategori_default": "Lainnya",
        "kategori_rules": [
          {
            "kategori": "Listrik",
            "pattern": "listrik|\\btoken\\b|\\bpln\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Langganan & Digital",
            "pattern": "canva|you ?tube|langganan|berlangganan|trial|gofood|shopeefood|\\badm\\b|biaya admin|mekari|zoom|domain|hosting",
            "purchase_category": "Other"
          },
          {
            "kategori": "Internet & Telekomunikasi",
            "pattern": "internet|telkomsel|\\bpulsa\\b|paket data|wifi|inbiz|indihome|\\bhallo\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Gas",
            "pattern": "\\bgas\\b|\\blpg\\b|elpiji",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Upacara & Canang",
            "pattern": "canang|banten|\\bdupa\\b|upacara|sesajen|odalan",
            "purchase_category": "Other"
          },
          {
            "kategori": "Sumbangan & Sosial",
            "pattern": "sumbangan|sunbangan|jum'?at berkah|\\bduka\\b|idul|zakat|donasi|\\bthr\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Pajak, Iuran & Retribusi",
            "pattern": "pajak|\\bpph\\b|\\bpbb\\b|\\bpb1\\b|iuran|retribusi|sampah",
            "purchase_category": "Other"
          },
          {
            "kategori": "Tenaga Kerja Harian",
            "pattern": "casual|security|\\bupah\\b|honor|\\bfee\\b|\\btukang\\b(?!.*bahan)",
            "purchase_category": "Other"
          },
          {
            "kategori": "BBM & Transportasi",
            "pattern": "\\bbbm\\b|bensin|solar|parkir|e-?money|\\btol\\b|transport|grab|gojek|\\bojek\\b|kirim|ongkir|bandara|angkut|\\btiket\\b|\\bspbu\\b",
            "purchase_category": "Travel"
          },
          {
            "kategori": "Laundry",
            "pattern": "laundry|\\bcuci\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Perbaikan & Pemeliharaan",
            "pattern": "perbaik|\\bservice\\b|\\bservis\\b|reparasi|semen|\\bcat\\b|bahan bangunan|bahan-bahan tukang|\\bac\\b|\\bpipa\\b|kran|keran|ganti|salotip|baut|paku|engsel|kunci|gembok|lampu|saklar|adaptor|double tape|doble tape|\\bkaca\\b|\\bwd\\b|stop kontak|kabel|\\blem\\b|\\bkuas\\b|\\blakban\\b|oli\\b|selang|\\bmcb\\b|ribo",
            "purchase_category": "Maintenance"
          },
          {
            "kategori": "Kebersihan & Perlengkapan Kamar",
            "pattern": "kebersihan|karbol|vixal|pembersih|sabun|tisu|tissue|pewangi|\\bpel\\b|sapu|amenit|aminit|shower|chemical|linen|handuk|sampo|shampoo|odol|sikat|rinso|molto|wipol|bayclin|pengharum|kispray|kamar|dental|tooth|trash ?bag|klorin|jet spray|prostex|tablet|obat serangga|\\bhit\\b|citrit|citric|sprai|sprei|bantal|guling|selimut|cleaner|bayklin|superpel|lilin|korek|farfum|parfum|obat nyamuk|p3k|vape",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "ATK & Kantor",
            "pattern": "kantor|\\batk\\b|kertas|\\bprint|cetak|kartu nama|materai|fotokopi|\\bmap\\b|pulpen|spidol|stempel|bolpoint|bolpen|stiker|buku|dokumen|kurir",
            "purchase_category": "Office Supplies"
          },
          {
            "kategori": "Peralatan & Perlengkapan",
            "pattern": "blender|magic com|seal|lap kain|apron|celemek|bordir|alas meja|wrapping|handle mop|\\bmop\\b|gantungan|piring|gelas|sendok|panci|wajan|teflon|talenan|pisau|toples|mangkok|nampan|spatula|plastik|show ?case|rak\\b|kompor|termos|dispenser|kipas|baterai|\\bapar\\b|pompa|genset|\\bember\\b|payung",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "Bahan Makanan & Minuman",
            "pattern": "beras|gula|telur|ayam|tomat|timun|bawang|\\bkol\\b|roti|minyak|margarin|saos|kecap|indomie|nescafe|kopi|coffe|\\bteh\\b|\\bthe\\b|susu|\\buht\\b|yakult|mineral|aqua|galon|\\bair\\b|soto|sosis|kornet|bumbu|soun|jeruk|soda|belanja|balanja|toge|rawit|daging|ikan|sayur|buah|tepung|goreng|\\bmpc\\b|skm|meses|singkong|cabe|cabai|tahu|tempe|garam|mentega|keju|coklat|sirup|syrup|nestle|stick|bombay|koya|pedas|lemon|santan|kelapa|wortel|kentang|bakso|nugget|pisang|\\bmie\\b|bihun|jahe|serai|sereh|kacang|snack|permen|biskuit|wafer|krupuk|kerupuk|cream|creamer|pop ?mie|\\bdus\\b|es batu|beef|burger|french fries|yogurt|cimory|minuman|denali|lafonte|go getter|getter|\\bbeer\\b|\\bgo\\b|konsumsi|royco|sugar|lada",
            "purchase_category": "Raw Materials"
          }
        ],
        "line_account_by_kategori_catatan": "KOSONG sampai COA AADL ada. Isi {\"<kategori>\": {\"account_code\":\"..\",\"account_name\":\"..\"}} (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil). Tanpa ini akun ikut Settings > Account Mapping klien.",
        "line_account_by_kategori": {},
        "row_granularity": "per_expense_row",
        "tanggal_kosong": "kosong"
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 5,
      "data_start_row_index": 6,
      "column_signature_hash": "1cdead52382a13e30d29298a8db2a573559ffc8bbf253f7fbb6ab73436da2124",
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "format_type": "monthly_petty_cash_ledger",
        "description": "Buku kas kecil (rekap pembayaran patty cash) KOST WARUNG SOEMANTRI: 1 sheet per bulan; 1 baris CREDIT = 1 transaksi pembelian. Judul sheet baris 3: Kost Warung Soemantri.",
        "source_kind": "excel_workbook_monthly",
        "cabang_tetap": "KOST WARUNG SOEMANTRI",
        "nomor_prefix": "PC-KWS",
        "vendor_default": "Petty Cash Kost Warung Soemantri",
        "judul_row_index": 3,
        "header_row_index": 5,
        "data_start_row_index": 6,
        "columns": {
          "no": 1,
          "tanggal": 2,
          "keterangan": 3,
          "debet": 4,
          "kredit": 5,
          "saldo": 6
        },
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tahun": "nama_sheet",
        "tanggal_wajib": false,
        "abaikan_baris_jika_keterangan": "^saldo",
        "abaikan_debet_jika_keterangan": "^terima",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "currency_default": "IDR",
        "category_default": "Other",
        "purchase_category_default": "Other",
        "kategori_default": "Lainnya",
        "kategori_rules": [
          {
            "kategori": "Listrik",
            "pattern": "listrik|\\btoken\\b|\\bpln\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Langganan & Digital",
            "pattern": "canva|you ?tube|langganan|berlangganan|trial|gofood|shopeefood|\\badm\\b|biaya admin|mekari|zoom|domain|hosting",
            "purchase_category": "Other"
          },
          {
            "kategori": "Internet & Telekomunikasi",
            "pattern": "internet|telkomsel|\\bpulsa\\b|paket data|wifi|inbiz|indihome|\\bhallo\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Gas",
            "pattern": "\\bgas\\b|\\blpg\\b|elpiji",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Upacara & Canang",
            "pattern": "canang|banten|\\bdupa\\b|upacara|sesajen|odalan",
            "purchase_category": "Other"
          },
          {
            "kategori": "Sumbangan & Sosial",
            "pattern": "sumbangan|sunbangan|jum'?at berkah|\\bduka\\b|idul|zakat|donasi|\\bthr\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Pajak, Iuran & Retribusi",
            "pattern": "pajak|\\bpph\\b|\\bpbb\\b|\\bpb1\\b|iuran|retribusi|sampah",
            "purchase_category": "Other"
          },
          {
            "kategori": "Tenaga Kerja Harian",
            "pattern": "casual|security|\\bupah\\b|honor|\\bfee\\b|\\btukang\\b(?!.*bahan)",
            "purchase_category": "Other"
          },
          {
            "kategori": "BBM & Transportasi",
            "pattern": "\\bbbm\\b|bensin|solar|parkir|e-?money|\\btol\\b|transport|grab|gojek|\\bojek\\b|kirim|ongkir|bandara|angkut|\\btiket\\b|\\bspbu\\b",
            "purchase_category": "Travel"
          },
          {
            "kategori": "Laundry",
            "pattern": "laundry|\\bcuci\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Perbaikan & Pemeliharaan",
            "pattern": "perbaik|\\bservice\\b|\\bservis\\b|reparasi|semen|\\bcat\\b|bahan bangunan|bahan-bahan tukang|\\bac\\b|\\bpipa\\b|kran|keran|ganti|salotip|baut|paku|engsel|kunci|gembok|lampu|saklar|adaptor|double tape|doble tape|\\bkaca\\b|\\bwd\\b|stop kontak|kabel|\\blem\\b|\\bkuas\\b|\\blakban\\b|oli\\b|selang|\\bmcb\\b|ribo",
            "purchase_category": "Maintenance"
          },
          {
            "kategori": "Kebersihan & Perlengkapan Kamar",
            "pattern": "kebersihan|karbol|vixal|pembersih|sabun|tisu|tissue|pewangi|\\bpel\\b|sapu|amenit|aminit|shower|chemical|linen|handuk|sampo|shampoo|odol|sikat|rinso|molto|wipol|bayclin|pengharum|kispray|kamar|dental|tooth|trash ?bag|klorin|jet spray|prostex|tablet|obat serangga|\\bhit\\b|citrit|citric|sprai|sprei|bantal|guling|selimut|cleaner|bayklin|superpel|lilin|korek|farfum|parfum|obat nyamuk|p3k|vape",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "ATK & Kantor",
            "pattern": "kantor|\\batk\\b|kertas|\\bprint|cetak|kartu nama|materai|fotokopi|\\bmap\\b|pulpen|spidol|stempel|bolpoint|bolpen|stiker|buku|dokumen|kurir",
            "purchase_category": "Office Supplies"
          },
          {
            "kategori": "Peralatan & Perlengkapan",
            "pattern": "blender|magic com|seal|lap kain|apron|celemek|bordir|alas meja|wrapping|handle mop|\\bmop\\b|gantungan|piring|gelas|sendok|panci|wajan|teflon|talenan|pisau|toples|mangkok|nampan|spatula|plastik|show ?case|rak\\b|kompor|termos|dispenser|kipas|baterai|\\bapar\\b|pompa|genset|\\bember\\b|payung",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "Bahan Makanan & Minuman",
            "pattern": "beras|gula|telur|ayam|tomat|timun|bawang|\\bkol\\b|roti|minyak|margarin|saos|kecap|indomie|nescafe|kopi|coffe|\\bteh\\b|\\bthe\\b|susu|\\buht\\b|yakult|mineral|aqua|galon|\\bair\\b|soto|sosis|kornet|bumbu|soun|jeruk|soda|belanja|balanja|toge|rawit|daging|ikan|sayur|buah|tepung|goreng|\\bmpc\\b|skm|meses|singkong|cabe|cabai|tahu|tempe|garam|mentega|keju|coklat|sirup|syrup|nestle|stick|bombay|koya|pedas|lemon|santan|kelapa|wortel|kentang|bakso|nugget|pisang|\\bmie\\b|bihun|jahe|serai|sereh|kacang|snack|permen|biskuit|wafer|krupuk|kerupuk|cream|creamer|pop ?mie|\\bdus\\b|es batu|beef|burger|french fries|yogurt|cimory|minuman|denali|lafonte|go getter|getter|\\bbeer\\b|\\bgo\\b|konsumsi|royco|sugar|lada",
            "purchase_category": "Raw Materials"
          }
        ],
        "line_account_by_kategori_catatan": "KOSONG sampai COA AADL ada. Isi {\"<kategori>\": {\"account_code\":\"..\",\"account_name\":\"..\"}} (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil). Tanpa ini akun ikut Settings > Account Mapping klien.",
        "line_account_by_kategori": {},
        "row_granularity": "per_expense_row",
        "tanggal_kosong": "kosong"
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 5,
      "data_start_row_index": 6,
      "column_signature_hash": "d0efc7211024462e1f05190eb1c0195950d8d3955b22cd0eeaf8ce15bbaa9b6d",
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "format_type": "monthly_petty_cash_ledger",
        "description": "Buku kas kecil (rekap pembayaran patty cash) KAPU SOEMANTRI: 1 sheet per bulan; 1 baris CREDIT = 1 transaksi pembelian. Judul sheet baris 3: Kost Kapu Soemantri.",
        "source_kind": "excel_workbook_monthly",
        "cabang_tetap": "KAPU SOEMANTRI",
        "nomor_prefix": "PC-KPS",
        "vendor_default": "Petty Cash Kapu Soemantri",
        "judul_row_index": 3,
        "header_row_index": 5,
        "data_start_row_index": 6,
        "columns": {
          "no": 1,
          "tanggal": 2,
          "keterangan": 3,
          "debet": 4,
          "kredit": 5,
          "saldo": 6
        },
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tahun": "nama_sheet",
        "tanggal_wajib": false,
        "abaikan_baris_jika_keterangan": "^saldo",
        "abaikan_debet_jika_keterangan": "^terima",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "currency_default": "IDR",
        "category_default": "Other",
        "purchase_category_default": "Other",
        "kategori_default": "Lainnya",
        "kategori_rules": [
          {
            "kategori": "Listrik",
            "pattern": "listrik|\\btoken\\b|\\bpln\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Langganan & Digital",
            "pattern": "canva|you ?tube|langganan|berlangganan|trial|gofood|shopeefood|\\badm\\b|biaya admin|mekari|zoom|domain|hosting",
            "purchase_category": "Other"
          },
          {
            "kategori": "Internet & Telekomunikasi",
            "pattern": "internet|telkomsel|\\bpulsa\\b|paket data|wifi|inbiz|indihome|\\bhallo\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Gas",
            "pattern": "\\bgas\\b|\\blpg\\b|elpiji",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Upacara & Canang",
            "pattern": "canang|banten|\\bdupa\\b|upacara|sesajen|odalan",
            "purchase_category": "Other"
          },
          {
            "kategori": "Sumbangan & Sosial",
            "pattern": "sumbangan|sunbangan|jum'?at berkah|\\bduka\\b|idul|zakat|donasi|\\bthr\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Pajak, Iuran & Retribusi",
            "pattern": "pajak|\\bpph\\b|\\bpbb\\b|\\bpb1\\b|iuran|retribusi|sampah",
            "purchase_category": "Other"
          },
          {
            "kategori": "Tenaga Kerja Harian",
            "pattern": "casual|security|\\bupah\\b|honor|\\bfee\\b|\\btukang\\b(?!.*bahan)",
            "purchase_category": "Other"
          },
          {
            "kategori": "BBM & Transportasi",
            "pattern": "\\bbbm\\b|bensin|solar|parkir|e-?money|\\btol\\b|transport|grab|gojek|\\bojek\\b|kirim|ongkir|bandara|angkut|\\btiket\\b|\\bspbu\\b",
            "purchase_category": "Travel"
          },
          {
            "kategori": "Laundry",
            "pattern": "laundry|\\bcuci\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Perbaikan & Pemeliharaan",
            "pattern": "perbaik|\\bservice\\b|\\bservis\\b|reparasi|semen|\\bcat\\b|bahan bangunan|bahan-bahan tukang|\\bac\\b|\\bpipa\\b|kran|keran|ganti|salotip|baut|paku|engsel|kunci|gembok|lampu|saklar|adaptor|double tape|doble tape|\\bkaca\\b|\\bwd\\b|stop kontak|kabel|\\blem\\b|\\bkuas\\b|\\blakban\\b|oli\\b|selang|\\bmcb\\b|ribo",
            "purchase_category": "Maintenance"
          },
          {
            "kategori": "Kebersihan & Perlengkapan Kamar",
            "pattern": "kebersihan|karbol|vixal|pembersih|sabun|tisu|tissue|pewangi|\\bpel\\b|sapu|amenit|aminit|shower|chemical|linen|handuk|sampo|shampoo|odol|sikat|rinso|molto|wipol|bayclin|pengharum|kispray|kamar|dental|tooth|trash ?bag|klorin|jet spray|prostex|tablet|obat serangga|\\bhit\\b|citrit|citric|sprai|sprei|bantal|guling|selimut|cleaner|bayklin|superpel|lilin|korek|farfum|parfum|obat nyamuk|p3k|vape",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "ATK & Kantor",
            "pattern": "kantor|\\batk\\b|kertas|\\bprint|cetak|kartu nama|materai|fotokopi|\\bmap\\b|pulpen|spidol|stempel|bolpoint|bolpen|stiker|buku|dokumen|kurir",
            "purchase_category": "Office Supplies"
          },
          {
            "kategori": "Peralatan & Perlengkapan",
            "pattern": "blender|magic com|seal|lap kain|apron|celemek|bordir|alas meja|wrapping|handle mop|\\bmop\\b|gantungan|piring|gelas|sendok|panci|wajan|teflon|talenan|pisau|toples|mangkok|nampan|spatula|plastik|show ?case|rak\\b|kompor|termos|dispenser|kipas|baterai|\\bapar\\b|pompa|genset|\\bember\\b|payung",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "Bahan Makanan & Minuman",
            "pattern": "beras|gula|telur|ayam|tomat|timun|bawang|\\bkol\\b|roti|minyak|margarin|saos|kecap|indomie|nescafe|kopi|coffe|\\bteh\\b|\\bthe\\b|susu|\\buht\\b|yakult|mineral|aqua|galon|\\bair\\b|soto|sosis|kornet|bumbu|soun|jeruk|soda|belanja|balanja|toge|rawit|daging|ikan|sayur|buah|tepung|goreng|\\bmpc\\b|skm|meses|singkong|cabe|cabai|tahu|tempe|garam|mentega|keju|coklat|sirup|syrup|nestle|stick|bombay|koya|pedas|lemon|santan|kelapa|wortel|kentang|bakso|nugget|pisang|\\bmie\\b|bihun|jahe|serai|sereh|kacang|snack|permen|biskuit|wafer|krupuk|kerupuk|cream|creamer|pop ?mie|\\bdus\\b|es batu|beef|burger|french fries|yogurt|cimory|minuman|denali|lafonte|go getter|getter|\\bbeer\\b|\\bgo\\b|konsumsi|royco|sugar|lada",
            "purchase_category": "Raw Materials"
          }
        ],
        "line_account_by_kategori_catatan": "KOSONG sampai COA AADL ada. Isi {\"<kategori>\": {\"account_code\":\"..\",\"account_name\":\"..\"}} (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil). Tanpa ini akun ikut Settings > Account Mapping klien.",
        "line_account_by_kategori": {},
        "row_granularity": "per_expense_row",
        "tanggal_kosong": "kosong"
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 4,
      "data_start_row_index": 5,
      "column_signature_hash": "cfbd7b1879e1c852fd3926f4f1b5a6e192bda5d49012fc1de8156e3930b5d7e1",
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "format_type": "monthly_petty_cash_ledger",
        "description": "Buku kas kecil (rekap pembayaran patty cash) VILLA PUTU SOEMANTRI: 1 sheet per bulan; 1 baris CREDIT = 1 transaksi pembelian. Judul sheet baris 2: PUTU SOEMANTRI FAMILY VILLAS - DENPASAR.",
        "source_kind": "excel_workbook_monthly",
        "cabang_tetap": "VILLA PUTU SOEMANTRI",
        "nomor_prefix": "PC-VPS",
        "vendor_default": "Petty Cash Villa Putu Soemantri",
        "judul_row_index": 2,
        "header_row_index": 4,
        "data_start_row_index": 5,
        "columns": {
          "no": 1,
          "tanggal": 2,
          "keterangan": 3,
          "debet": 4,
          "kredit": 5,
          "saldo": 6
        },
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tahun": "nama_sheet",
        "tanggal_wajib": false,
        "abaikan_baris_jika_keterangan": "^saldo",
        "abaikan_debet_jika_keterangan": "^terima",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "currency_default": "IDR",
        "category_default": "Other",
        "purchase_category_default": "Other",
        "kategori_default": "Lainnya",
        "kategori_rules": [
          {
            "kategori": "Listrik",
            "pattern": "listrik|\\btoken\\b|\\bpln\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Langganan & Digital",
            "pattern": "canva|you ?tube|langganan|berlangganan|trial|gofood|shopeefood|\\badm\\b|biaya admin|mekari|zoom|domain|hosting",
            "purchase_category": "Other"
          },
          {
            "kategori": "Internet & Telekomunikasi",
            "pattern": "internet|telkomsel|\\bpulsa\\b|paket data|wifi|inbiz|indihome|\\bhallo\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Gas",
            "pattern": "\\bgas\\b|\\blpg\\b|elpiji",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Upacara & Canang",
            "pattern": "canang|banten|\\bdupa\\b|upacara|sesajen|odalan",
            "purchase_category": "Other"
          },
          {
            "kategori": "Sumbangan & Sosial",
            "pattern": "sumbangan|sunbangan|jum'?at berkah|\\bduka\\b|idul|zakat|donasi|\\bthr\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Pajak, Iuran & Retribusi",
            "pattern": "pajak|\\bpph\\b|\\bpbb\\b|\\bpb1\\b|iuran|retribusi|sampah",
            "purchase_category": "Other"
          },
          {
            "kategori": "Tenaga Kerja Harian",
            "pattern": "casual|security|\\bupah\\b|honor|\\bfee\\b|\\btukang\\b(?!.*bahan)",
            "purchase_category": "Other"
          },
          {
            "kategori": "BBM & Transportasi",
            "pattern": "\\bbbm\\b|bensin|solar|parkir|e-?money|\\btol\\b|transport|grab|gojek|\\bojek\\b|kirim|ongkir|bandara|angkut|\\btiket\\b|\\bspbu\\b",
            "purchase_category": "Travel"
          },
          {
            "kategori": "Laundry",
            "pattern": "laundry|\\bcuci\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Perbaikan & Pemeliharaan",
            "pattern": "perbaik|\\bservice\\b|\\bservis\\b|reparasi|semen|\\bcat\\b|bahan bangunan|bahan-bahan tukang|\\bac\\b|\\bpipa\\b|kran|keran|ganti|salotip|baut|paku|engsel|kunci|gembok|lampu|saklar|adaptor|double tape|doble tape|\\bkaca\\b|\\bwd\\b|stop kontak|kabel|\\blem\\b|\\bkuas\\b|\\blakban\\b|oli\\b|selang|\\bmcb\\b|ribo",
            "purchase_category": "Maintenance"
          },
          {
            "kategori": "Kebersihan & Perlengkapan Kamar",
            "pattern": "kebersihan|karbol|vixal|pembersih|sabun|tisu|tissue|pewangi|\\bpel\\b|sapu|amenit|aminit|shower|chemical|linen|handuk|sampo|shampoo|odol|sikat|rinso|molto|wipol|bayclin|pengharum|kispray|kamar|dental|tooth|trash ?bag|klorin|jet spray|prostex|tablet|obat serangga|\\bhit\\b|citrit|citric|sprai|sprei|bantal|guling|selimut|cleaner|bayklin|superpel|lilin|korek|farfum|parfum|obat nyamuk|p3k|vape",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "ATK & Kantor",
            "pattern": "kantor|\\batk\\b|kertas|\\bprint|cetak|kartu nama|materai|fotokopi|\\bmap\\b|pulpen|spidol|stempel|bolpoint|bolpen|stiker|buku|dokumen|kurir",
            "purchase_category": "Office Supplies"
          },
          {
            "kategori": "Peralatan & Perlengkapan",
            "pattern": "blender|magic com|seal|lap kain|apron|celemek|bordir|alas meja|wrapping|handle mop|\\bmop\\b|gantungan|piring|gelas|sendok|panci|wajan|teflon|talenan|pisau|toples|mangkok|nampan|spatula|plastik|show ?case|rak\\b|kompor|termos|dispenser|kipas|baterai|\\bapar\\b|pompa|genset|\\bember\\b|payung",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "Bahan Makanan & Minuman",
            "pattern": "beras|gula|telur|ayam|tomat|timun|bawang|\\bkol\\b|roti|minyak|margarin|saos|kecap|indomie|nescafe|kopi|coffe|\\bteh\\b|\\bthe\\b|susu|\\buht\\b|yakult|mineral|aqua|galon|\\bair\\b|soto|sosis|kornet|bumbu|soun|jeruk|soda|belanja|balanja|toge|rawit|daging|ikan|sayur|buah|tepung|goreng|\\bmpc\\b|skm|meses|singkong|cabe|cabai|tahu|tempe|garam|mentega|keju|coklat|sirup|syrup|nestle|stick|bombay|koya|pedas|lemon|santan|kelapa|wortel|kentang|bakso|nugget|pisang|\\bmie\\b|bihun|jahe|serai|sereh|kacang|snack|permen|biskuit|wafer|krupuk|kerupuk|cream|creamer|pop ?mie|\\bdus\\b|es batu|beef|burger|french fries|yogurt|cimory|minuman|denali|lafonte|go getter|getter|\\bbeer\\b|\\bgo\\b|konsumsi|royco|sugar|lada",
            "purchase_category": "Raw Materials"
          }
        ],
        "line_account_by_kategori_catatan": "KOSONG sampai COA AADL ada. Isi {\"<kategori>\": {\"account_code\":\"..\",\"account_name\":\"..\"}} (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil). Tanpa ini akun ikut Settings > Account Mapping klien.",
        "line_account_by_kategori": {},
        "row_granularity": "per_expense_row",
        "tanggal_kosong": "ikut_baris_sebelumnya"
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 6,
      "data_start_row_index": 7,
      "column_signature_hash": "aefcc50012d196955f90983587e26b1eb3e926b520bb60adcd7ef18c523f4573",
      "header_columns": [
        "NO",
        "TANGGAL",
        "KETERANGAN",
        "DEBET",
        "CREDIT",
        "SALDO"
      ],
      "mapping_rules": {
        "format_type": "monthly_petty_cash_ledger",
        "description": "Buku kas kecil (rekap pembayaran patty cash) OMAH & KOPI SOEMANTRI: 1 sheet per bulan; 1 baris CREDIT = 1 transaksi pembelian. Judul sheet baris 3: OMAH SOEMANTRI.",
        "source_kind": "excel_workbook_monthly",
        "cabang_tetap": "OMAH & KOPI SOEMANTRI",
        "nomor_prefix": "PC-OMH",
        "vendor_default": "Petty Cash Omah & Kopi Soemantri",
        "judul_row_index": 3,
        "header_row_index": 6,
        "data_start_row_index": 7,
        "columns": {
          "no": 1,
          "tanggal": 2,
          "keterangan": 3,
          "debet": 4,
          "kredit": 5,
          "saldo": 6
        },
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "tahun": "nama_sheet",
        "tanggal_wajib": false,
        "abaikan_baris_jika_keterangan": "^saldo",
        "abaikan_debet_jika_keterangan": "^terima",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "currency_default": "IDR",
        "category_default": "Other",
        "purchase_category_default": "Other",
        "kategori_default": "Lainnya",
        "kategori_rules": [
          {
            "kategori": "Listrik",
            "pattern": "listrik|\\btoken\\b|\\bpln\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Langganan & Digital",
            "pattern": "canva|you ?tube|langganan|berlangganan|trial|gofood|shopeefood|\\badm\\b|biaya admin|mekari|zoom|domain|hosting",
            "purchase_category": "Other"
          },
          {
            "kategori": "Internet & Telekomunikasi",
            "pattern": "internet|telkomsel|\\bpulsa\\b|paket data|wifi|inbiz|indihome|\\bhallo\\b",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Gas",
            "pattern": "\\bgas\\b|\\blpg\\b|elpiji",
            "purchase_category": "Utilities"
          },
          {
            "kategori": "Upacara & Canang",
            "pattern": "canang|banten|\\bdupa\\b|upacara|sesajen|odalan",
            "purchase_category": "Other"
          },
          {
            "kategori": "Sumbangan & Sosial",
            "pattern": "sumbangan|sunbangan|jum'?at berkah|\\bduka\\b|idul|zakat|donasi|\\bthr\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Pajak, Iuran & Retribusi",
            "pattern": "pajak|\\bpph\\b|\\bpbb\\b|\\bpb1\\b|iuran|retribusi|sampah",
            "purchase_category": "Other"
          },
          {
            "kategori": "Tenaga Kerja Harian",
            "pattern": "casual|security|\\bupah\\b|honor|\\bfee\\b|\\btukang\\b(?!.*bahan)",
            "purchase_category": "Other"
          },
          {
            "kategori": "BBM & Transportasi",
            "pattern": "\\bbbm\\b|bensin|solar|parkir|e-?money|\\btol\\b|transport|grab|gojek|\\bojek\\b|kirim|ongkir|bandara|angkut|\\btiket\\b|\\bspbu\\b",
            "purchase_category": "Travel"
          },
          {
            "kategori": "Laundry",
            "pattern": "laundry|\\bcuci\\b",
            "purchase_category": "Other"
          },
          {
            "kategori": "Perbaikan & Pemeliharaan",
            "pattern": "perbaik|\\bservice\\b|\\bservis\\b|reparasi|semen|\\bcat\\b|bahan bangunan|bahan-bahan tukang|\\bac\\b|\\bpipa\\b|kran|keran|ganti|salotip|baut|paku|engsel|kunci|gembok|lampu|saklar|adaptor|double tape|doble tape|\\bkaca\\b|\\bwd\\b|stop kontak|kabel|\\blem\\b|\\bkuas\\b|\\blakban\\b|oli\\b|selang|\\bmcb\\b|ribo",
            "purchase_category": "Maintenance"
          },
          {
            "kategori": "Kebersihan & Perlengkapan Kamar",
            "pattern": "kebersihan|karbol|vixal|pembersih|sabun|tisu|tissue|pewangi|\\bpel\\b|sapu|amenit|aminit|shower|chemical|linen|handuk|sampo|shampoo|odol|sikat|rinso|molto|wipol|bayclin|pengharum|kispray|kamar|dental|tooth|trash ?bag|klorin|jet spray|prostex|tablet|obat serangga|\\bhit\\b|citrit|citric|sprai|sprei|bantal|guling|selimut|cleaner|bayklin|superpel|lilin|korek|farfum|parfum|obat nyamuk|p3k|vape",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "ATK & Kantor",
            "pattern": "kantor|\\batk\\b|kertas|\\bprint|cetak|kartu nama|materai|fotokopi|\\bmap\\b|pulpen|spidol|stempel|bolpoint|bolpen|stiker|buku|dokumen|kurir",
            "purchase_category": "Office Supplies"
          },
          {
            "kategori": "Peralatan & Perlengkapan",
            "pattern": "blender|magic com|seal|lap kain|apron|celemek|bordir|alas meja|wrapping|handle mop|\\bmop\\b|gantungan|piring|gelas|sendok|panci|wajan|teflon|talenan|pisau|toples|mangkok|nampan|spatula|plastik|show ?case|rak\\b|kompor|termos|dispenser|kipas|baterai|\\bapar\\b|pompa|genset|\\bember\\b|payung",
            "purchase_category": "Inventory"
          },
          {
            "kategori": "Bahan Makanan & Minuman",
            "pattern": "beras|gula|telur|ayam|tomat|timun|bawang|\\bkol\\b|roti|minyak|margarin|saos|kecap|indomie|nescafe|kopi|coffe|\\bteh\\b|\\bthe\\b|susu|\\buht\\b|yakult|mineral|aqua|galon|\\bair\\b|soto|sosis|kornet|bumbu|soun|jeruk|soda|belanja|balanja|toge|rawit|daging|ikan|sayur|buah|tepung|goreng|\\bmpc\\b|skm|meses|singkong|cabe|cabai|tahu|tempe|garam|mentega|keju|coklat|sirup|syrup|nestle|stick|bombay|koya|pedas|lemon|santan|kelapa|wortel|kentang|bakso|nugget|pisang|\\bmie\\b|bihun|jahe|serai|sereh|kacang|snack|permen|biskuit|wafer|krupuk|kerupuk|cream|creamer|pop ?mie|\\bdus\\b|es batu|beef|burger|french fries|yogurt|cimory|minuman|denali|lafonte|go getter|getter|\\bbeer\\b|\\bgo\\b|konsumsi|royco|sugar|lada",
            "purchase_category": "Raw Materials"
          }
        ],
        "line_account_by_kategori_catatan": "KOSONG sampai COA AADL ada. Isi {\"<kategori>\": {\"account_code\":\"..\",\"account_name\":\"..\"}} (kunci = nama kategori di kategori_rules, tidak peka huruf besar/kecil). Tanpa ini akun ikut Settings > Account Mapping klien.",
        "line_account_by_kategori": {},
        "row_granularity": "per_expense_row",
        "tanggal_kosong": "kosong"
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
--        (SELECT string_agg(v->'mapping_rules'->>'cabang_tetap', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS cabang
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'AADL';