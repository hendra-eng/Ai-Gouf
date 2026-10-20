-- seed_template_evita_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk
-- klien EVITA (EBA; 2 usaha: EVITA SERANGAN dan ANAGEN COKROAMINOTO). SATU baris
-- setting ("Multi") untuk Transactions > Purchase > Source Data. Mengikuti pola
-- seed_template_aadl / nbm / sau_multi_format_purchase.sql dan seed sales Evita
-- (idempoten: aman dijalankan berkali-kali).
--
-- STATUS: 1 varian EXCEL (workbook "EVITA_BERKAT_ABADI_BIAYA-BIAYA", sheet "Biaya Lainnya").
-- Varian lain (CSV/PDF/Excel lain) nanti cukup ditambahkan ke array "variants".
--
-- SUMBER (EVITA_BERKAT_ABADI_BIAYA-BIAYA.xlsx): 1 sheet "Biaya Lainnya" (A1:R5007).
--   Isi sheet = aplikasi pencatatan di Excel: menu navigasi (kolom A:D), form "Catat Biaya"
--   (E5:G12), lalu TABEL DATA bernama TabelBiaya di I6:O5006 (header baris 6, data mulai
--   baris 7; 5.001 baris disediakan, TERISI sampai baris 2171). Yang dibaca HANYA tabel:
--     I Tanggal (sel tanggal) | J Periode (rumus "mmyyyy", tidak dipakai) | K Kategori Biaya |
--     L Akun Bank (CASH / BCA / BNI) | M Jenis Transaksi (Uang Keluar / Uang Masuk) |
--     N Kode Transaksi (keterangan bebas, BUKAN nomor nota) | O Jumlah
--   Kolom Q (di luar tabel, tanpa judul) berisi catatan akuntan per baris (59 baris, mis.
--   "amortisasi april - july 2026", "cicilan 6", "tolong di pindah ke asset ..."): ikut masuk
--   catatan transaksi ("Note: ...") supaya tidak hilang. Catatan di baris di bawah data
--   (baris 2330, 2580, 2615-2616, 2777-2781, 2836; R2002 "evitaG45A") tidak punya nominal,
--   jadi dilewati.
--   Tidak ada nomor nota, supplier, qty, harga satuan, maupun pajak.
--
-- CARA BACA (format_type 'flat_expense_ledger', _parse_flat_expense_ledger di purchase_import_v1.py):
--   1. 1 baris "Uang Keluar" bernilai > 0 = 1 transaksi pembelian dengan 1 baris item
--      (deskripsi = Kode Transaksi, qty 1, harga = Jumlah). Baris TIDAK dikelompokkan: Kode
--      Transaksi sering sama ("Misc-Minuman" 157x, "Biaya Kirim" 75x, 1.174 keterangan unik).
--   2. Nomor transaksi: EBA-BY-<YYYYMM tanggal>-<urut 4 digit>, urut = urutan baris di sheet
--      per bulan tanggalnya (contoh EBA-BY-202601-0001). Sheet TIDAK terurut tanggal -- tidak masalah.
--   3. Vendor generik per Akun Bank: "Biaya Evita - CASH" / "- BCA" / "- BNI".
--   4. Akun Cr (hutang) per Akun Bank lewat "ap_account_by_bank" (lihat AKUN JURNAL);
--      kategori Purchase (Utilities, Maintenance, Office Supplies, Travel, Inventory; lainnya
--      "Other") dari "purchase_category_by_kategori". Kategori Biaya asli masuk catatan
--      ("Category: ..."), begitu juga "Bank: ..." dan "Source: row <n>".
--   5. BUKAN pembelian -> baris TIDAK VALID (tampil di Source Data, file berstatus "Butuh
--      Review", tidak jadi transaksi): "Uang Masuk" (bunga/jasa giro bank), jumlah NEGATIF, dan
--      jumlah kosong/0 yang punya kategori atau keterangan. Ubah resep "uang_masuk" /
--      "jumlah_negatif" ke "abaikan" bila tidak mau ditandai.
--   6. Baris sisa template (hanya Tanggal + Periode terisi, mis. baris 2171) dilewati diam-diam.
--   7. Peringatan (tidak membuat baris tidak valid) untuk "kategori_perlu_review": kategori yang
--      kemungkinan bukan beban -- Prive Persero, Hutang Dagang, PPh 21/23, 4 ayat 2 (pelunasan
--      kewajiban), Aset Tetap Mesin, Aset Lancar ... Dibayar Dimuka, Pendapatan Lainnya.
--
-- HASIL UJI (kode parser ASLI purchase_import_v1.py dijalankan ke file contoh; angka SAMA dengan
-- hitungan terpisah langsung dari sel Excel):
--   2.162 baris terisi -> 1.804 transaksi VALID, total Rp 2.419.414.190 (Jan - Sep 2026),
--   tanpa nomor ganda; 358 baris TIDAK VALID:
--     348 jumlah negatif, total -48.121.600 (331 kategori Liabilities - Akrual Lainnya, 17 Liabilities - PPh 23; semua BCA)
--      10 "Uang Masuk", total 1.328.033 (bunga/jasa giro; 9 BNI, 1 BCA)
--   Cek silang: 2.419.414.190 - 48.121.600 + 1.328.033 = 2.372.620.623 = jumlah semua baris tabel.
--   Per bulan (transaksi / total):
--     2026-01 195 / 264.984.008   2026-02 203 / 278.030.342   2026-03 191 / 304.084.469
--     2026-04 200 / 258.824.694   2026-05 213 / 273.173.484   2026-06 236 / 350.452.560
--     2026-07 194 / 243.027.987   2026-08 200 / 192.386.694   2026-09 172 / 254.449.952
--   Per Akun Bank: CASH 1.079 / 98.935.844 | BCA 705 / 2.319.987.438 | BNI 20 / 490.908
--   Terbesar per kategori: Liabilities - Prive Persero Aktif 43 / 1.021.822.396 (42 persen total!),
--     Beban Gaji 10 / 317.919.000, Beban Insentif 9 / 313.801.274, Beban Komisi Dokter 9 / 130.688.717,
--     Aset Tetap Mesin 5 / 102.500.000, Liabilities - Akrual Lainnya 354 / 72.569.225.
--   97 transaksi berperingatan kategori + 20 baris BNI (tanpa akun Cr per bank) = 117.
--   Skenario variasi diuji: kolom A:D (menu/hitungan) berubah, nama sheet beda huruf/spasi, baris
--   baru di bawah data, jumlah/tanggal berupa teks -> hasil tetap sama. Header diganti nama atau
--   kolom disisipkan -> "Butuh Review" (aman, tidak salah baca).
--
-- HAL YANG PERLU DIKETAHUI (batas resep, bukan galat):
--   * 99 sel Jumlah berisi RUMUS (mis. =181965+176180+136460). Nilainya dibaca dari nilai tersimpan
--     Excel; file yang disimpan ulang oleh tool tanpa nilai rumus membuat baris itu berstatus tidak
--     valid ("amount is empty or 0 ... re-save the file in Excel"). Simpan dari Excel.
--   * Jumlah negatif (348 baris, mayoritas Akrual Lainnya) = koreksi/pengembalian; tidak diimpor
--     otomatis, jadi total hasil import LEBIH BESAR Rp 48.121.600 dari total tabel. Catat manual
--     (credit note) atau koreksi transaksi aslinya.
--   * "Uang Masuk" (bunga bank) milik Bank Feed / jurnal lain, bukan Purchase.
--   * Prive Persero (pengambilan pemilik, 52 baris, Rp 1,07 miliar), PPh, Hutang Dagang, aset tetap
--     dan "dibayar dimuka" adalah pelunasan kewajiban/aset, BUKAN beban. Tetap diimpor (dengan
--     peringatan) supaya jumlahnya sama dengan sumber; akunnya harus dibetulkan di Journal Preview.
--     Catatan akuntan di kolom Q (amortisasi, pindah ke aset) tidak dijalankan otomatis.
--   * Transaksi dibuat sebagai Purchase draft berstatus belum dibayar; sisi Cr = akun per Akun Bank.
--   * Nomor transaksi bergantung urutan baris per bulan. Upload ulang workbook kumulatif yang sama
--     menghasilkan nomor yang sama (yang sudah ada dihitung duplikat/bentrok); menyisipkan/menghapus
--     baris di tengah menggeser nomor sesudahnya. Baris baru sebaiknya ditambah di bawah.
--   * Struktur HARUS tetap: tabel di kolom I:O, header di baris 6 (kolom A:D, E:G dan Q bebas berubah).
--
-- AKUN JURNAL (ASUMSI -- mohon dikonfirmasi): seed COA Evita belum ada di repo (hanya NPI, NBM, SAU).
--   Kode di bawah diambil dari sheet COA file sales Evita (lihat seed_template_evita_multi_format_sales.sql):
--     Cr per Akun Bank ("ap_account_by_bank", paling spesifik: menimpa Settings > Account Mapping):
--        CASH -> 10000 Petty Cash | BCA -> 10002 Bank BCA | BNI -> BELUM ADA (kode belum diketahui;
--        ikut Settings > Account Mapping dan diberi peringatan, 20 baris)
--     Dr per Kategori Biaya ("line_account_by_kategori"): KOSONG -- kode akun beban Evita tidak
--        boleh ditebak (posting ditolak bila kode tidak ada di COA klien). Selama kosong, akun
--        baris ikut Settings > Account Mapping klien. Setelah COA Evita ada, isi lewat UPDATE
--        (atau hapus lalu jalankan ulang seed ini):
--          "line_account_by_kategori": { "Biaya Laundry": {"account_code": "...", "account_name": "..."}, ... }
--        (kunci = teks Kategori Biaya, tidak peka huruf besar/kecil; 34 kategori di file contoh).
--        Bila peta ini terisi, kategori yang tidak ada di peta diberi peringatan.
--
-- column_signature_hash:
--   hash varian Excel = SHA-256 dari baris header tabel yang dinormalisasi (HANYA kolom I:O,
--   lewat recipe.header_kolom = [9, 15]; kolom A:H berisi menu/form/hitungan yang berubah):
--   "tanggal|periode|kategori biaya|akun bank|jenis transaksi|kode transaksi|jumlah"
--     = a76299b81a536f2e54e1c516b14099aae1d224060c462c5f69d5d669d691c087
--   hash baris Multi = SHA-256(hash varian) (1 varian, pola NBM/SAU):
--     8f975c0d366b9ae7bc10045ff387fa01a784f0f1f8a884525ab7b9c0c9552c75
--   Tiap varian ditambah/dihapus, hitung ulang (gabungan hash varian dipisah ':'). Nilai level baris
--   (header_row_index, data_start_row_index, header_columns) hanya pengisi kolom NOT NULL.
--
-- PRASYARAT KODE: purchase_import_v1.py versi yang memuat format_type flat_expense_ledger dan
--   recipe.header_kolom (patch purchase_expense_parser.patch). Tanpa patch, upload Evita jatuh ke
--   "Butuh Review". Migration purchase/34-allow_null_purchase_date.py tidak wajib untuk file ini
--   (semua baris valid punya tanggal).
--
-- KLIEN: dicari lewat nama_client = 'CV EVITA BERKAT ABADI' (sesuai data klien di VPS) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md):
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_evita_multi_format_purchase.sql
--
-- Idempotensi: AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- (v_hash_baru / v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE hash, posisi header, resep; is_active = true, deleted_at dikosongkan.
--               id, usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Menambah varian (CSV/PDF/Excel lain): tambah 1 objek di array "variants", hitung ulang hash baris,
-- isi hash lama di v_hash_lama, lalu jalankan ulang seed ini.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_nama        TEXT;
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini (lihat "column_signature_hash" di kepala file).
    v_hash_baru   CONSTANT TEXT := '8f975c0d366b9ae7bc10045ff387fa01a784f0f1f8a884525ab7b9c0c9552c75';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien Evita (EBA) untuk file pembelian/biaya. Saat ini varian Excel (sheet 'Biaya Lainnya' di workbook EVITA_BERKAT_ABADI_BIAYA-BIAYA); varian CSV/PDF/Excel lain ditambahkan kemudian ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Biaya Lainnya",
      "header_row_index": 6,
      "data_start_row_index": 7,
      "column_signature_hash": "a76299b81a536f2e54e1c516b14099aae1d224060c462c5f69d5d669d691c087",
      "header_columns": [
        "Tanggal",
        "Periode",
        "Kategori Biaya",
        "Akun Bank",
        "Jenis Transaksi",
        "Kode Transaksi",
        "Jumlah"
      ],
      "mapping_rules": {
        "format_type": "flat_expense_ledger",
        "description": "Buku biaya Evita (EBA), sheet 'Biaya Lainnya' -- tabel TabelBiaya (kolom I:O, header baris 6): 1 baris 'Uang Keluar' > 0 = 1 transaksi pembelian/biaya (1 baris item); Kode Transaksi hanya keterangan bebas (sering ganda) sehingga tidak dipakai sebagai nomor. Vendor generik per Akun Bank, nomor EBA-BY-<YYYYMM>-<urut>. Uang Masuk (bunga bank), jumlah negatif dan nol ditandai tidak valid (tidak jadi transaksi). Signature = hash header HANYA kolom I:O (kolom A:D berisi menu dan angka rumus yang berubah).",
        "source_kind": "excel_sheet",
        "sheet_name": "Biaya Lainnya",
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "header_row_index": 6,
        "data_start_row_index": 7,
        "header_kolom": [
          9,
          15
        ],
        "columns": {
          "tanggal": 9,
          "periode": 10,
          "kategori_biaya": 11,
          "akun_bank": 12,
          "jenis_transaksi": 13,
          "kode_transaksi": 14,
          "jumlah": 15,
          "catatan": 17
        },
        "nomor_prefix": "EBA-BY",
        "vendor_default": "Biaya Evita",
        "kategori_default": "Lainnya",
        "category_default": "Other",
        "currency_default": "IDR",
        "uang_masuk": "tandai",
        "jumlah_negatif": "tandai",
        "deskripsi_kosong_pengganti": "(tanpa keterangan)",
        "kategori_perlu_review": [
          "Liabilities - Prive Persero Aktif",
          "Liabilities - Prive Persero Pasif",
          "Liabilities - PPh 21",
          "Liabilities - PPh 23",
          "Liabilities - 4 ayat 2",
          "Liabilities - Hutang Dagang",
          "Aset Tetap Mesin",
          "Aset Lancar Operasional Dibayar Dimuka",
          "Pendapatan Lainnya"
        ],
        "purchase_category_by_kategori": {
          "Biaya Utilitas": "Utilities",
          "Biaya Listrik dan Mekanik": "Utilities",
          "Biaya Reparasi dan Perawatan": "Maintenance",
          "Biaya Alat Tulis Kantor": "Office Supplies",
          "Biaya Transportasi": "Travel",
          "Biaya Pembelian - langsung": "Inventory"
        },
        "line_account_by_kategori": {},
        "ap_account_by_bank": {
          "CASH": {
            "account_code": "10000",
            "account_name": "Petty Cash"
          },
          "BCA": {
            "account_code": "10002",
            "account_name": "Bank BCA"
          }
        }
      }
    }
  ]
}
$json$::jsonb;
BEGIN
    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'CV EVITA BERKAT ABADI'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'CV EVITA BERKAT ABADI') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama CV EVITA BERKAT ABADI di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien Evita belum ada di management_clients (dicari nama_client = ''CV EVITA BERKAT ABADI''). Buat dulu lewat halaman Clients, lalu jalankan ulang.';
    END IF;
    RAISE NOTICE 'Klien terpilih: % (client_code %)', v_nama, v_client_code;

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_purchase_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini dengan varian Excel berhash sama.
    SELECT count(*) INTO v_bentrok
    FROM financial_transaction_purchase_import_templates t
    WHERE t.client_id = v_client_id
      AND t.deleted_at IS NULL
      AND t.is_active
      AND t.file_type = 'Multi'
      AND t.id IS DISTINCT FROM v_id
      AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(t.mapping_rules->'variants', '[]'::jsonb)) AS v
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'a76299b81a536f2e54e1c516b14099aae1d224060c462c5f69d5d669d691c087'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien Evita sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
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
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi Evita (purchase) dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_purchase_import_templates
           SET header_row_index = 1,
               data_start_row_index = 2,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi Evita (purchase) sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) = 'CV EVITA BERKAT ABADI';