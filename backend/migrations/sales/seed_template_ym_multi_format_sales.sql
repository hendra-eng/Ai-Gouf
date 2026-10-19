-- seed_template_ym_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien YM (PT Yoniso Manasikara -- North Bali Beach Cottages & Spa dan North
-- Bali Divecenter). SATU baris setting ("Multi") untuk halaman Transactions >
-- Sales > Source Data, berisi 2 varian Excel dengan parser yang sama
-- (format_type "monthly_income_list", sales_import_v1.py bagian 3f).
--
-- SUMBER (dataset/template_laporan/YM/):
--   PT_YM_-_INCOME_LIST_-_202608.xlsx   varian #1 "INCOME LIST" (file kerja kumulatif)
--   Pemasukan_yoniso_2026.xls           varian #2 "Pemasukan" (Excel lama, daftar dari pihak hotel)
--
-- STRUKTUR -- varian #1, xlsx "INCOME LIST":
--   40 sheet (10 terlihat, 30 tersembunyi), 1 sheet = 1 bulan. Nama sheet "MMYY" ("0826"), kadang ada versi final
--   "0826 YANG DI PAKAI" / "0226 YANG DI PAKAI" untuk bulan yang sama, dan riwayat lama
--   (2024-2025: "0825 SESUAI KLIEN INCOM LIST", "0325 Pembetulan 1", dst) yang TERSEMBUNYI.
--   Tiap sheet: kop (A1 nama usaha) + tarif per dive/malam (A5:C7), HEADER baris 10, data
--   mulai baris 11, baris "Total" di bawah data (posisinya berbeda: baris 22/23/27/30), lalu
--   blok ringkasan pajak (Income NET Room, Income Diving, PPN 12%, PHR 10%, PPh 21, dst).
--   Header (16 kolom, bergeser 11-16 kolom antar tahun; kolom CC BNI muncul sejak Agustus 2026):
--     A Date of invoice | B Name | C Nights PHR | D Room | E Dives | F Extra income | G Total € |
--     H Total Rp | I Paid by | J Part Diving | K Part R&B&S | L Total | (M CC BNI) | CC mandiri |
--     Sebagian ambil cash dari uang Euro | Selisih
--   L Total = RUMUS J + K + F (Part Diving + Part R&B&S + Extra income), dalam Rupiah. Sheet
--   2024 - awal 2025 tidak punya kolom "Total" (header hanya sampai Part R&B&S) -> parser
--   menjumlah ketiga komponen itu sendiri.
--   Tanggal: sel tanggal, kadang teks ("12./02/2026" di sheet 0226 -- titik nyasar).
-- STRUKTUR -- varian #2, xls "Pemasukan":
--   8 sheet: "Jan 26", "Feb 26", "Maret 26", "April 26", "Mei 26 ", "Juni 26", "Juli 26" +
--   "Sheet1" kosong. Kop 6 baris, HEADER baris 7, data mulai baris 8, baris total di bawah
--   TANPA label (tanggal diisi tanggal 1 bulan, nama kosong).
--   Header (10 kolom): Date of invoice | Name | Nights PHR | Room | dive | Total Rp |
--   Income extra | total € | Paid by | Paket
--   Pembayaran kartu (Cc.Mandiri / Cc.BNI) diisi di "Total Rp"; pembayaran CASH hanya diisi
--   "total €" (Total Rp kosong); beberapa baris punya keduanya. Tidak ada kurs di file.
--
-- CARA APLIKASI MEMBACA UPLOAD YM:
--   1. File .xls (Excel lama) dikonversi dulu ke .xlsx di memory (_pastikan_xlsx, butuh paket
--      xlrd di requirements.txt). File .xlsx dipakai apa adanya.
--   2. Template dicocokkan lewat LABEL kolom header di sheet mana pun (15 baris teratas),
--      BUKAN hash persis: varian #1 wajib punya Date of invoice + Name + Part Diving, varian #2
--      wajib Date of invoice + Name + Total Rp. Varian #1 dicoba lebih dulu (header #1 juga
--      memuat "Total Rp"). column_signature_hash varian hanya dokumentasi header contoh.
--   3. Sheet yang dibaca: yang tidak tersembunyi, bukan Sheet1/Rekap/Summary, dan SATU sheet per
--      bulan -- kalau sebulan punya beberapa sheet, yang dipilih "YANG DI PAKAI" > "Pembetulan"
--      > biasa > "SESUAI KLIEN". Bulan ditebak dari nama sheet ("0826", "Jan 26", "Maret 26").
--   4. Tiap baris yang punya nama tamu dan nilai jadi 1 invoice:
--        invoice  = YM-<YYYYMMDD>-<NAMA TAMU>  (mis. YM-20260814-INES-ELIAS; tamu+tanggal sama
--                   tapi nilai beda -> akhiran -2, -3; baris identik -> nomor sama, ditandai ganda)
--        tanggal  = Date of invoice          customer = Name        cabang = kosong
--        dpp      = varian #1: kolom Total (kosong -> Part Diving + Part R&B&S + Extra income)
--                   varian #2: kolom Total Rp
--        ppn      = 0                        total    = dpp
--      Baris "Total" menghentikan pembacaan sheet (blok pajak di bawahnya tidak terbaca) dan
--      dicocokkan dengan jumlah baris di atasnya.
--
-- HASIL UJI (kode parser ASLI sales_import_v1.py dijalankan ke kedua file contoh):
--   Varian #1 (xlsx): 8 bulan terbaca (0126, 0226 YANG DI PAKAI, 0326, 0426, 0526, 0626,
--   0726 YANG DI PAKAI, 0826 YANG DI PAKAI), 42 invoice, semuanya valid, nomor invoice unik.
--     bulan   invoice          dpp (= baris Total sheet itu)
--     2026-01      3     82.619.318,00
--     2026-02      4    104.971.875,00
--     2026-03      7     69.220.151,00
--     2026-04      6    141.260.350,00
--     2026-05      5    120.064.326,00
--     2026-06      7    117.886.186,00
--     2026-07      5    119.236.550,40
--     2026-08      5    118.554.348,00
--     TOTAL       42    873.813.104,40  (ppn 0 -> total sama)
--   Tidak ikut dibaca: 30 sheet tersembunyi (riwayat 2024-2025 dan "0226" polos) serta "0726" dan
--   "0826" polos yang terlihat tetapi kalah dari versi "YANG DI PAKAI" bulan yang sama.
--   Varian #2 (xls): 41 baris tamu, 21 valid (kartu, dpp 491.203.704) dan 20 INVALID: pembayaran
--   cash yang hanya berisi nilai Euro (tanpa kurs di template, tidak ditebak). Jumlah "Total Rp"
--   tiap sheet sama dengan baris total file.
--
-- ANTISIPASI PERBEDAAN FILE (diuji lewat tests/test_sales_import_ym.py):
--   Tetap terbaca OTOMATIS:
--     * kop/baris kosong di atas header bertambah atau berkurang (header dicari di 15 baris)
--     * urutan kolom berubah, kolom tambahan/hilang (CC BNI, Selisih, kolom bantu), kolom A kosong
--     * label header beda huruf besar/kecil, spasi ganda, titik di ujung ("Total Rp.", "DATE OF INVOICE")
--     * kolom Total tidak ada -> dijumlah dari Part Diving + Part R&B&S + Extra income
--     * tanggal berbentuk teks: "2026-08-05", "05/08/2026", "12./02/2026", "27-03-26" (DD/MM)
--     * angka berbentuk teks ("1.500.000", "Rp 1,500,000")
--     * baris Total hilang/pindah, blok ringkasan pajak di bawahnya berubah
--     * bulan baru, sheet bulan ganda (versi "YANG DI PAKAI"), sheet riwayat tersembunyi,
--       Sheet1/Rekap/Summary kosong atau rekap
--     * nama sheet "Agustus 2026", "Jan 26", "0826 YANG DI PAKAI "
--   Muncul sebagai baris INVALID (status "Butuh Review", TIDAK ikut Buat Invoice) -- tidak
--   hilang diam-diam:
--     * sheet berisi data tapi tanpa header yang dikenal; semua sheet data tersembunyi
--     * tanggal tidak terbaca/kosong, nilai negatif, baris tanpa nama tamu yang bukan total
--     * baris "Total" file != jumlah baris (ada baris hilang/rusak)
--     * nilai valuta asing (€) tanpa kurs; rumus yang belum dihitung (file belum dibuka di Excel)
--   Hanya CATATAN (tetap valid): tanggal di luar bulan sheet, baris identik (nomor invoice ganda).
--   Di LUAR kemampuan resep (file masuk "Butuh Review" atau perlu varian baru): header tidak
--   memuat "Date of invoice"/"Name" (atau padanannya), 1 sheet berisi banyak bulan, atau tamu
--   dipecah per komponen (diving/room/extra) jadi invoice terpisah.
--
-- ASUMSI AKUNTANSI -- MOHON DIKONFIRMASI (ubah di resep, lalu jalankan ulang seed):
--   1. Nilai = kolom Total (pendapatan NETTO yang dilaporkan PT YM: part diving + part room,
--      restaurant & spa + extra), BUKAN total uang yang dibayar tamu. ppn = 0 karena PHR 10%
--      dan PPN (DPP nilai lain 11/12, PPN DM 60%) dihitung di blok rekap bawah sheet, bukan per
--      tamu. Kalau PPN ingin dicatat per invoice, resep perlu opsi tarif.
--   2. Sheet "YANG DI PAKAI" menggantikan sheet polos bulan yang sama. Di file contoh isinya
--      BEDA dari sheet polos (Feb: 4 dari 8 tamu; Jul & Agu: nilai Extra income cash lebih
--      kecil). Kalau yang harus diimpor justru sheet polos, hapus "yang dipakai" dari
--      sheet_prioritas_kata.
--   3. Kurs € untuk file xls TIDAK ADA di file. Isi "valuta_asing": {"kolom": "total_eur",
--      "kurs": <angka>} di varian #2 kalau mau baris cash ikut diimpor (nilai = Total Rp +
--      € x kurs; hati-hati baris yang berisi Rp DAN € sekaligus, mis. Linus & Jonah). Selama
--      kosong, 20 baris cash di contoh INVALID. File xlsx INCOME LIST sudah dalam Rupiah.
--   4. File kumulatif (Jan-Agu) memuat bulan-bulan lama lagi: upload bulan berikutnya
--      menghasilkan nomor invoice yang sama untuk bulan lama -> dilewati saat Buat Invoice
--      karena bentrok. Batasi bulan dengan "periode_mulai": "YYYY-MM" di resep bila perlu.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level atas baris ini).
-- Diambil dari sheet "COA YM" di dataset/COA/COA_Clients_GOUF.xlsx -- seed_coa_ym.sql BELUM ada
-- di repo, jadi pastikan COA YM sudah ter-load; posting ditolak kalau kode tidak ada di COA klien:
--   Dr Piutang      10003 Piutang Usaha
--   Cr Pendapatan   40002 Pendapatan Room (SEMUA invoice; COA punya 40001 Pendapatan Diving dan
--                   40003 Pendapatan Extra -- ubah per invoice di Journal Preview kalau perlu)
--   Cr PPN          20003 Utang Pajak (cadangan; ppn selalu 0)
-- Sisi debit per metode bayar (Kas Kecil 10001, Bank BNI 10002, Bank Mandiri 10012; kolom
-- "Paid by") tidak dipetakan otomatis -- default 10003, ubah per invoice. Settings > Account
-- Mapping klien, kalau diisi, tetap didahulukan untuk piutang dan PPN.
--
-- column_signature_hash level baris = SHA-256 dari gabungan hash varian, urut seperti array
-- "variants" dan dipisah ':' (pola seed NBM/SAU):
--   SHA-256("<hash_xlsx>:<hash_xls>")
--   hash_xlsx = 74ac14e9718974abcac27ee3a99dc4f50576f371fc294092d496b59367dcdbc3   (header baris 10 sheet 0826, 16 kolom)
--   hash_xls  = 0bf9cfb763a02de1bbfaeba7f0c433b028442724b0a0fab4a6d5627f3dc79e1f   (header baris 7 sheet Jan 26, 10 kolom)
--   -> 4737cb0554436b58285dc04198664036f8eb578847c80c7c8ccad4868f4932f9
-- Nilai level baris (header_row_index, data_start_row_index, header_columns) hanya pengisi
-- kolom NOT NULL untuk template Multi; pencocokan memakai label kolom di dalam tiap varian.
--
-- KLIEN: dicari lewat client_code = 'YM' (bukan nama klien) dan GAGAL dengan pesan jelas
-- kalau belum ada di management_clients. client_id & client_code diambil otomatis.
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_ym_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi: seed ini AMAN dijalankan berkali-kali. Baris Multi klien dicari lewat hash baris
-- seed ini (v_hash_baru) atau hash versi lamanya (v_hash_lama, termasuk yang soft-delete):
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan isi seed
--               ini, is_active = true, deleted_at dikosongkan. id, usage_count, created_at dan
--               source_files.template_id TETAP. Perubahan manual pada resep akan ditimpa.
--   * tidak  -> INSERT baris baru.
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini yang memuat varian Excel dengan
-- header yang sama, seed berhenti dengan pesan jelas (supaya tidak ada 2 template aktif).
-- Singkirkan yang tidak dipakai (soft-delete, aman terhadap FK source_files):
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris yang tidak dipakai>';
--
-- Menambah varian lagi nanti: tambahkan 1 objek di array "variants", hitung ulang hash baris =
-- SHA-256("<hash_xlsx>:<hash_xls>:<hash_baru>"), isi v_hash_baru dan PINDAHKAN hash baris yang
-- lama ke v_hash_lama, lalu jalankan ulang file ini.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi ORM (bukan DEFAULT
-- kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    -- Hash baris seed ini = SHA-256("<hash_xlsx>:<hash_xls>"). Belum ada versi lama.
    v_hash_baru   CONSTANT TEXT := '4737cb0554436b58285dc04198664036f8eb578847c80c7c8ccad4868f4932f9';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien YM (PT Yoniso Manasikara) untuk laporan penjualan. Varian Excel #1: file xlsx 'INCOME LIST' (kolom Total dalam Rupiah). Varian Excel #2: file xls 'Pemasukan' (kolom Total Rp + total EUR untuk pembayaran cash). Keduanya 1 sheet per bulan, 1 baris = 1 tamu = 1 invoice (nomor invoice dibentuk dari tanggal + nama tamu). Tiap varian membawa resep parsing sendiri; backend memilih varian lewat LABEL kolom header (lihat _cocokkan_template_excel_income_list di sales_import_v1.py).",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 10,
      "data_start_row_index": 11,
      "column_signature_hash": "74ac14e9718974abcac27ee3a99dc4f50576f371fc294092d496b59367dcdbc3",
      "header_columns": [
        "Date of invoice",
        "Name",
        "Nights PHR",
        "Room",
        "Dives",
        "Extra income",
        "Total €",
        "Total Rp",
        "Paid by",
        "Part Diving",
        "Part R&B&S",
        "Total",
        "CC BNI",
        "CC mandiri",
        "Sebagian ambil cash dari uang Euro",
        "Selisih"
      ],
      "mapping_rules": {
        "format_type": "monthly_income_list",
        "description": "Varian xlsx 'INCOME LIST' PT Yoniso Manasikara (North Bali Beach Cottages & Spa + North Bali Divecenter): 1 sheet per bulan (0126, 0826, '0826 YANG DI PAKAI'), 1 baris = 1 tamu = 1 invoice. Nilai = kolom Total (Part Diving + Part R&B&S + Extra income) dalam Rupiah.",
        "prefix_invoice": "YM",
        "kolom_wajib": [
          "tanggal",
          "nama",
          "part_diving"
        ],
        "nilai": {
          "kolom_total": "total",
          "kolom_komponen": [
            "part_diving",
            "part_room",
            "extra"
          ]
        },
        "maks_baris_header": 15,
        "sheet_abaikan": [
          "Sheet1",
          "Rekap",
          "Summary"
        ],
        "sheet_tersembunyi": "abaikan",
        "sheet_prioritas_kata": [
          "yang dipakai",
          "pembetulan"
        ],
        "sheet_prioritas_rendah_kata": [
          "sesuai klien"
        ],
        "lewati_nol": true,
        "toleransi_selisih": 1,
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "field_mapping": {
          "tanggal": "kolom 'Date of invoice' (sel tanggal / teks DD/MM/YYYY)",
          "invoice": "dibentuk: YM-<YYYYMMDD>-<NAMA TAMU> (file tidak punya nomor invoice)",
          "customer": "kolom 'Name'",
          "cabang": "kosong",
          "dpp": "kolom 'Total'; kosong -> Part Diving + Part R&B&S + Extra income",
          "ppn": "0 (angka file = pendapatan netto; PHR 10% dan PPN dihitung di rekap bawah sheet, bukan per tamu)",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_tamu"
      }
    },
    {
      "file_type": "Excel",
      "sheet_name": null,
      "header_row_index": 7,
      "data_start_row_index": 8,
      "column_signature_hash": "0bf9cfb763a02de1bbfaeba7f0c433b028442724b0a0fab4a6d5627f3dc79e1f",
      "header_columns": [
        "Date of invoice",
        "Name",
        "Nights PHR",
        "Room",
        "dive",
        "Total Rp",
        "Income extra",
        "total €",
        "Paid by",
        "Paket"
      ],
      "mapping_rules": {
        "format_type": "monthly_income_list",
        "description": "Varian xls 'Pemasukan' PT Yoniso Manasikara (daftar dari pihak hotel): 1 sheet per bulan ('Jan 26', 'Maret 26'), 1 baris = 1 tamu = 1 invoice. Nilai = kolom 'Total Rp'; pembayaran cash hanya berisi 'total €' -- tanpa kurs di template baris itu INVALID (tidak ditebak).",
        "prefix_invoice": "YM",
        "kolom_wajib": [
          "tanggal",
          "nama",
          "total_rp"
        ],
        "nilai": {
          "kolom_total": "total_rp",
          "kolom_komponen": []
        },
        "valuta_asing": {
          "kolom": "total_eur",
          "kurs": null
        },
        "maks_baris_header": 15,
        "sheet_abaikan": [
          "Sheet1",
          "Rekap",
          "Summary"
        ],
        "sheet_tersembunyi": "abaikan",
        "lewati_nol": true,
        "toleransi_selisih": 1,
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "field_mapping": {
          "tanggal": "kolom 'Date of invoice' (sel tanggal / teks DD/MM/YYYY, mis. '27./03/2026')",
          "invoice": "dibentuk: YM-<YYYYMMDD>-<NAMA TAMU>",
          "customer": "kolom 'Name'",
          "cabang": "kosong",
          "dpp": "kolom 'Total Rp' (+ 'total €' x kurs bila kurs diisi)",
          "ppn": "0",
          "total": "dpp + ppn"
        },
        "row_granularity": "per_tamu"
      }
    }
  ],
  "piutang_account": {
    "account_code": "10003",
    "account_name": "Piutang Usaha"
  },
  "pendapatan_account": {
    "account_code": "40002",
    "account_name": "Pendapatan Room"
  },
  "ppn_account": {
    "account_code": "20003",
    "account_name": "Utang Pajak"
  },
  "catatan_akun": "Akun default diambil dari sheet 'COA YM' di dataset/COA/COA_Clients_GOUF.xlsx (seed_coa_ym.sql belum ada di repo) -- ASUMSI, mohon dikonfirmasi; bisa diubah per invoice di Journal Preview atau lewat Settings > Account Mapping (yang diutamakan untuk piutang/PPN). 1 invoice memuat 3 komponen (diving, room, extra) tetapi source_rows hanya punya 1 nilai, jadi semua ke 40002 Pendapatan Room; COA juga punya 40001 Pendapatan Diving dan 40003 Pendapatan Extra. ppn selalu 0 sehingga ppn_account hanya cadangan."
}$json$::jsonb;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'YM'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien YM belum ada di management_clients (dicari client_code = ''YM''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini yang sudah memuat varian Excel dengan
    -- header yang sama (baris yang di-upgrade dikecualikan).
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
          WHERE v->>'file_type' = 'Excel'
            AND v->>'column_signature_hash' IN ('74ac14e9718974abcac27ee3a99dc4f50576f371fc294092d496b59367dcdbc3', '0bf9cfb763a02de1bbfaeba7f0c433b028442724b0a0fab4a6d5627f3dc79e1f')
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien YM sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_sales_import_templates (
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
            10,
            11,
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi YM dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
           SET header_row_index = 10,
               data_start_row_index = 11,
               column_signature_hash = v_hash_baru,
               header_columns = '[]'::jsonb,
               mapping_rules = v_rules,
               is_active = true,
               deleted_at = NULL,
               deleted_by = NULL,
               edited_at = now()
         WHERE id = v_id;
        RAISE NOTICE 'Template Multi YM sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.client_code)) = 'YM';