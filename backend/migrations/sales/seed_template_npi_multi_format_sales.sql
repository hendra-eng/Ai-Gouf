-- seed_template_npi_multi_format_sales.sql
-- =============================================================
-- Template pola kolom (financial_transaction_sales_import_templates) untuk
-- klien NPI (PT Nusa Penida Investments). SATU baris setting ("Multi") untuk
-- halaman Transactions > Sales > Source Data.
--
-- STATUS: varian Excel (laporan POS "Sales Recapitulation Detail Report",
-- 2 outlet: PLAZA MARIETTA dan SIBARITA) di array "variants" pada SATU baris
-- template Multi. Format lain (mis. CSV) nanti cukup ditambahkan ke array itu
-- (lihat bagian "Menambah varian lagi" di bawah).
--
-- SUMBER EXCEL (dataset/template_laporan/NPI/):
--   Sales Recapitulation Detail Report_PLAZAACCOUNTING_17897817030237.xlsx
--   1 sheet bernama "Report", A1:AT8600 (46 kolom). Kop baris 1-9 (judul, nama
--   PT, Generated, Period, Branch, Sales Type, Generated Username, Report File
--   Name), baris 10 kosong, HEADER di baris 11, data mulai baris 12.
--   Tabel FLAT: 1 baris = 1 item menu dalam bill; banyak baris berbagi 1 Bill
--   Number. Di bawah data ada 4 baris ringkasan (Discount Total Rounding,
--   Rounding Total, Voucher Purchase Total, Platform Fee Total) -- labelnya di
--   kolom Menu, kolom lain kosong, jadi dilewati (abaikan_baris_ringkasan).
--   8.584 baris data = 2.036 bill, 2 branch:
--     PLAZA MARIETTA (Order Mode POS)       1.602 bill
--     SIBARITA       (Order Mode POS Lite)    434 bill
--   Resepnya "flat_grouped_by_key" (parser yang sama dengan CSV POS NBM).
--
-- CARA APLIKASI MEMBACA UPLOAD NPI:
--   1. User upload file di Sales > Source Data dengan klien NPI aktif.
--   2. Backend memecah baris ini jadi template virtual per varian, lalu mencari
--      baris header file yang hash-nya cocok dengan column_signature_hash varian.
--   3. Resep "flat_grouped_by_key" menjumlah semua baris per Bill Number ->
--      1 baris source_rows = 1 bill.
--   4. Hasil ekstraksi: invoice = Bill Number, tanggal = Sales Date, cabang =
--      Branch, customer = Customer Name ('-' atau kosong -> "Penjualan POS -
--      <Branch>"), dpp = SUM(Nett Sales + Service Charge), ppn = SUM(Tax + VAT),
--      total = dpp + ppn.
--
-- KENAPA Service Charge MASUK DPP: di file, Total = Nett Sales + Service Charge +
-- Tax pada SEMUA baris, dan total adalah uang yang dibayar tamu (cocok dengan
-- mutasi bank/EDC/QRIS). Struk source_rows hanya punya dpp/ppn/total, jadi
-- service charge (5 persen Nett Sales) digabung ke dpp. Catatan: di NPI, Tax =
-- 10 persen x Nett Sales saja (BUKAN x (Nett + Service Charge) seperti NBM).
--
-- DIKUNCI DARI FILE CONTOH (angka asli):
--   2.036 bill, tanpa baris invalid, tanpa Bill Number ganda, tanggal 01-08-2026
--   s/d 31-08-2026
--   DPP 544.953.436,78 + PPN 47.484.063,16 = TOTAL 592.437.499,94
--   Pembanding terpisah (pandas, jumlah kolom Total per bill) = 592.437.500,00.
--   Selisih 0,06 pada total berasal dari parser membulatkan dpp dan ppn per bill
--   ke 2 desimal sebelum dijumlah (maks 0,01 per bill). Cabang dan tanggal cocok
--   di semua 2.036 bill.
--
-- ANTISIPASI PERBEDAAN ISI FILE (semua diuji dengan kode parser ASLI
-- sales_import_v1.py ke file contoh yang dimodifikasi):
--   * Kop atas bertambah/berkurang -> header dicari di 30 baris pertama
--     (header_cari_dalam_baris); posisi data ikut bergeser. Diuji +4 baris kop.
--   * Kolom tambahan, kolom hilang yang opsional (VAT, DPP, Branch, Customer Name,
--     Sales Type), urutan kolom diacak, sel header kosong di ujung -> hash persis
--     tidak cocok, tapi cadangan "cocok_jika_kolom_ada" (Bill Number, Sales Date,
--     Nett Sales, Service Charge, Tax) tetap cocok; kolom dicari lewat NAMA.
--     Kolom opsional yang hilang dianggap kosong/0 (kolom_opsional).
--   * Sheet diganti nama -> dicari di semua sheet lewat header (cari_di_semua_sheet).
--   * Bill Number kosong di suatu baris -> dipakai Sales Number
--     (invoice_key_cadangan).
--   * Sales Date berupa sel tanggal Excel ATAU teks (DD-MM-YYYY, YYYY-MM-DD, dst).
--   * Hanya 1 branch di file (export per outlet) -> tetap terbaca.
--   * Sales Type selain "Sales" (mis. Void/Refund bila export tidak difilter) ->
--     baris TIDAK dibuang dan TIDAK invalid, hanya diberi catatan peringatan di
--     validation_notes (peringatan_nilai_kolom); user yang memutuskan.
--   * Kolom wajib diganti nama atau hilang (mis. "Nett Sales" -> "Net Sales", atau
--     Service Charge dihapus) -> TIDAK dicocokkan, file masuk "Butuh Review" (aman:
--     tidak diekstrak dengan angka salah). Perlu varian baru di seed ini.
--
-- HAL YANG PERLU DIKETAHUI PENGGUNA (batas resep, bukan galat):
--   * Baris tambahan di bawah data yang punya teks di kolom Sales Number/Bill
--     Number tetapi tanpa tanggal (mis. "TOTAL") muncul sebagai 1 baris invalid
--     "Tanggal tidak terbaca" (tidak diam-diam hilang, nilainya 0).
--   * Kolom Bill Discount, Voucher dan Platform Fee di baris ringkasan TIDAK
--     diproses; di file contoh nilainya 0 (Bill Discount) atau tidak ada. Kalau
--     suatu saat terisi, perlu resep baru (belum jelas apakah per baris/per bill).
--   * Customer Name di file contoh selalu "-", jadi semua invoice memakai nama
--     pengganti "Penjualan POS - <Branch>". Metode bayar CREDIT ACCOUNT / CITY
--     LEDGER (322 baris) tetap dijadikan invoice biasa; penagihan per tamu/
--     perusahaan dikerjakan manual.
--   * Metode bayar campuran ("CASH (150.000),CREDIT CARD (935.000)") tidak
--     dipecah; sisi debit per metode bayar diubah per invoice di Journal Preview.
--
-- AKUN JURNAL (dibaca db_client.akun_default_sales() dari mapping_rules level
-- atas baris ini; semua akun ada di seed_coa_npi.sql). INI ASUMSI -- mohon
-- dikonfirmasi:
--   Dr Piutang      1-2001 Accounts Receivable
--   Cr Pendapatan   4-1004 Sales food (SEMUA invoice; bill campuran makanan+minuman)
--   Cr PB1          2-1005 PB 1 Payable (Tax di POS = PB1 10 persen, bukan PPN)
-- Catatan: (a) kedua branch memakai akun yang sama -> tidak ada
-- pendapatan_account_by_cabang; kalau mau dipisah, tambahkan peta itu (kunci HURUF
-- BESAR: "PLAZA MARIETTA", "SIBARITA"). (b) Service Charge ikut Cr Pendapatan; COA
-- punya 2-1004 Service Charge Payable bila perlu direklasifikasi. (c) Sisi debit
-- per metode bayar (1-303 Cash on hand, 1-304 EDC BCA, 1-305 EDC MANDIRI 9273,
-- 1-306 QRIS MANDIRI) tidak bisa dipetakan otomatis -- ubah per invoice. (d)
-- Settings > Account Mapping klien, kalau diisi, tetap didahulukan untuk piutang
-- dan PPN/PB1. Tanpa akun di COA klien, posting ditolak.
--
-- column_signature_hash level baris = SHA-256 dari hash varian (1 varian ->
-- SHA-256("<hash_excel>"); pola seed NBM/Evita):
--   hash_excel = 8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d
--   -> f61baeab964efb7858e1fb4b782e84c0fefe7709038a8bf472e39ad69e5f2159
-- Nilai level baris (header_row_index, data_start_row_index, header_columns)
-- hanya pengisi kolom NOT NULL untuk template Multi; yang dipakai pencocokan
-- adalah nilai di dalam tiap varian.
--
-- KLIEN: dicari lewat nama_client ('NPI' atau 'PT NUSA PENIDA INVESTMENTS', tidak
-- peka huruf besar/kecil) dan GAGAL dengan pesan jelas kalau belum ada di
-- management_clients. client_id & client_code diambil otomatis.
--
-- SEED LAMA -- seed_template_npi_sales_recapitulation_excel.sql (1 format Excel,
-- file_type 'Excel', BUKAN Multi) tercatat di history-migration.md. Kalau barisnya
-- masih aktif di database, upload NPI akan punya 2 template yang cocok (usage_count
-- terbagi). Seed ini TIDAK menghapusnya, tapi memberi WARNING + perintah
-- soft-delete di log. Perintahnya aman terhadap FK source_files:
--   UPDATE financial_transaction_sales_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now()
--    WHERE id = '<id baris lama yang diberitahukan WARNING>';
--
-- Cara pakai (lewat runner: 1 transaksi + nama file dicatat ke history-migration.md).
-- File ini ada di subfolder sales/, jadi berikan PATH-nya:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\sales\seed_template_npi_multi_format_sales.sql
-- (jalur psql tetap bisa, tapi tidak tercatat di history-migration.md)
--
-- Idempotensi / upgrade di tempat: seed ini AMAN dijalankan berkali-kali. Di blok
-- DO, baris Multi klien dicari lewat hash baris seed ini (v_hash_baru) atau hash
-- versi lamanya (v_hash_lama), termasuk yang sudah soft-delete:
--   * ketemu -> UPDATE: hash, posisi header dan resep (mapping_rules) diganti dengan
--               isi seed ini, is_active = true, deleted_at dikosongkan. id,
--               usage_count, created_at dan source_files.template_id TETAP.
--   * tidak  -> INSERT baris baru.
-- Konsekuensi: menjalankan ulang seed ini MENIMPA resep baris itu dengan isi file
-- ini (termasuk perubahan manual lewat UPDATE).
-- Pengaman: kalau ada baris Multi AKTIF lain milik klien ini (bukan baris yang
-- di-upgrade) yang memuat varian Excel dengan header yang sama, seed berhenti
-- dengan pesan jelas supaya tidak ada 2 template aktif.
--
-- Menambah varian lagi nanti (mis. export CSV): tambahkan 1 objek lagi di array
-- "variants", hitung ulang hash level baris = SHA-256("<hash_excel>:<hash_baru>")
-- (urutan = urutan array), isi v_hash_baru dengan hash itu dan PINDAHKAN hash baris
-- yang lama ke v_hash_lama di blok DO, lalu jalankan ulang file ini.
--
-- OPSI RESEP BARU di sales_import_v1.py (_parse_flat_grouped_by_key; opsional,
-- resep lain tidak berubah perilakunya): kolom_opsional, invoice_key_cadangan,
-- peringatan_nilai_kolom -- lihat docstring fungsi itu.
--
-- is_active & usage_count disebut eksplisit karena default-nya hanya di sisi
-- ORM (bukan DEFAULT kolom database) -- lihat catatan di seed SAU.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_id          UUID;
    v_bentrok     INTEGER;
    v_lama        RECORD;
    -- Hash baris seed ini = SHA-256("<hash_excel>"). Belum ada versi lama.
    v_hash_baru   CONSTANT TEXT := 'f61baeab964efb7858e1fb4b782e84c0fefe7709038a8bf472e39ad69e5f2159';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien NPI (PT Nusa Penida Investments) untuk laporan penjualan. Varian Excel: laporan POS 'Sales Recapitulation Detail Report' (outlet PLAZA MARIETTA dan SIBARITA), 1 Bill Number = 1 invoice. Tiap varian membawa file_type, sheet, posisi header, signature & resep parsing sendiri; backend memilih varian yang tipe file dan signature header-nya cocok (lihat _template_dari_varian di sales_import_v1.py). Varian lain (mis. CSV) nanti ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Report",
      "header_row_index": 11,
      "data_start_row_index": 12,
      "column_signature_hash": "8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d",
      "header_columns": [
        "Sales Number",
        "Bill Number",
        "Sales Type",
        "Batch Order",
        "Table Section",
        "Table Name",
        "Sales Date",
        "Sales Date In",
        "Sales Date Out",
        "Branch",
        "Brand",
        "City",
        "Area",
        "Visit Purpose",
        "Regular Member Code",
        "Regular Member Name",
        "Loyalty Member Code",
        "Loyalty Member Name",
        "Loyalty Member Type",
        "Employee Code",
        "Employee Name",
        "External Employee Code",
        "External Employee Name",
        "Customer Name",
        "Payment Method",
        "Menu Category",
        "Menu Category Detail",
        "Menu",
        "Custom Menu Name",
        "Menu Code",
        "Menu Notes",
        "Order Mode",
        "Qty",
        "Price",
        "Subtotal",
        "Discount",
        "Service Charge",
        "Tax",
        "VAT",
        "Total",
        "Nett Sales",
        "DPP",
        "Bill Discount",
        "Total After Bill Discount",
        "Waiter",
        "Order Time"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_by_key",
        "description": "Laporan POS 'Sales Recapitulation Detail Report' NPI (PT Nusa Penida Investments; outlet PLAZA MARIETTA dan SIBARITA) -- 1 baris Excel = 1 item/line menu dalam bill; banyak baris berbagi 1 Bill Number. 1 baris kanonis (source_rows) = 1 BILL (Bill Number), diagregasi dengan menjumlah semua barisnya. Kolom dicari lewat NAMA di baris header (bukan posisi), jadi urutan kolom boleh berubah/ditambah. Kop laporan (judul, periode, branch, dst) ada di atas header dan jumlah barisnya boleh berubah; baris ringkasan di bawah data ('Rounding Total', 'Platform Fee Total', dst) dilewati.",
        "date_format": "DD-MM-YYYY",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "invoice_key": "Bill Number",
        "invoice_key_cadangan": "Sales Number",
        "tanggal": "Sales Date",
        "customer": "Customer Name",
        "customer_kosong_jika": [
          "-"
        ],
        "customer_fallback": "Penjualan POS - {Branch}",
        "cabang": "Branch",
        "dpp_columns": [
          "Nett Sales",
          "Service Charge"
        ],
        "ppn_columns": [
          "Tax",
          "VAT"
        ],
        "abaikan_baris_ringkasan": true,
        "kolom_opsional": [
          "VAT",
          "Branch",
          "Customer Name",
          "Sales Type"
        ],
        "peringatan_nilai_kolom": {
          "Sales Type": [
            "Sales"
          ]
        },
        "signature_abaikan_kolom_kosong_di_ujung": true,
        "header_cari_dalam_baris": 30,
        "cocok_jika_kolom_ada": [
          "Bill Number",
          "Sales Date",
          "Nett Sales",
          "Service Charge",
          "Tax"
        ],
        "cari_di_semua_sheet": true,
        "field_mapping": {
          "tanggal": "Sales Date (sel tanggal Excel atau teks DD-MM-YYYY / YYYY-MM-DD)",
          "invoice": "Bill Number (kosong -> Sales Number)",
          "customer": "Customer Name ('-' atau kosong -> 'Penjualan POS - <Branch>')",
          "cabang": "Branch",
          "dpp": "SUM(Nett Sales + Service Charge) per bill",
          "ppn": "SUM(Tax + VAT) per bill (Tax = PB1 10 persen dari Nett Sales; VAT selalu 0 di file contoh)",
          "total": "dpp + ppn (= SUM kolom Total per bill)"
        },
        "row_granularity": "per_bill",
        "catatan_analisis": "Dianalisis dari 1 file contoh (Sales_Recapitulation_Detail_Report_PLAZAACCOUNTING_17897817030237.xlsx, periode 01-08-2026 s/d 31-08-2026): sheet 'Report', kop baris 1-9, baris 10 kosong, HEADER baris 11 (46 kolom), data baris 12-8595, 4 baris ringkasan di bawah data (Discount Total Rounding, Rounding Total, Voucher Purchase Total, Platform Fee Total; label di kolom Menu, kolom Sales Number kosong). 8.584 baris data = 2.036 bill unik (Bill Number = 1-1 dengan Sales Number), 2 branch: PLAZA MARIETTA (POS) dan SIBARITA (POS Lite). Sales Type semua 'Sales'; Customer Name semua '-'. Pada SEMUA baris: Total = Nett Sales + Service Charge + Tax, Nett Sales = Subtotal - Discount, Tax = 10 persen x Nett Sales (BUKAN x (Nett+SC)), Service Charge = 5 persen Nett Sales (0 di 803 baris); kolom VAT, DPP dan Bill Discount selalu 0. Tanggal = sel tanggal Excel. Tidak ada bill total <= 0."
      }
    }
  ],
  "piutang_account": {
    "account_code": "1-2001",
    "account_name": "Accounts Receivable"
  },
  "pendapatan_account": {
    "account_code": "4-1004",
    "account_name": "Sales food"
  },
  "ppn_account": {
    "account_code": "2-1005",
    "account_name": "PB 1 Payable"
  },
  "catatan_akun": "Akun default dipilih dari COA NPI (seed_coa_npi.sql); ASUMSI, bisa diubah per invoice di Journal Preview atau lewat Settings > Account Mapping (yang diutamakan untuk piutang/PPN). Laporan ini 1 baris per bill campuran makanan dan minuman, jadi pendapatan tidak bisa dipisah per kategori otomatis: semua ke 4-1004 Sales food (COA juga punya 4-1005 Sales beverage, 4-0000 Sales - cash, 4-0001 Sales - card (EDC), 4-0002 Sales - QRIS). Kolom Tax di POS = PB1 10 persen, bukan PPN, maka dipetakan ke 2-1005 PB 1 Payable (field-nya tetap bernama ppn). Service Charge ikut dpp sehingga masuk Cr Pendapatan; COA punya 2-1004 Service Charge Payable bila nanti perlu direklasifikasi. Sisi debit per metode bayar (1-303 Cash on hand, 1-304 EDC BCA, 1-305 EDC MANDIRI 9273, 1-306 QRIS MANDIRI) tidak bisa dipetakan otomatis -- default 1-2001, ubah per invoice di Journal Preview."
}$json$::jsonb;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS')
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari nama_client = NPI / PT Nusa Penida Investments). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    -- Baris yang di-upgrade: hash baris seed ini diutamakan, lalu versi lamanya.
    SELECT t.id INTO v_id
    FROM financial_transaction_sales_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

    -- Pengaman: template Multi AKTIF LAIN milik klien ini yang sudah memuat varian
    -- Excel dengan header yang sama (baris yang di-upgrade dikecualikan).
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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = '8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien NPI sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (UPDATE ... SET is_active = false, deleted_at = now(); lihat bagian SEED LAMA di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    -- Peringatan (bukan galat): template Excel tunggal (bukan Multi) lama dengan header sama.
    FOR v_lama IN
        SELECT t.id
        FROM financial_transaction_sales_import_templates t
        WHERE t.client_id = v_client_id
          AND t.deleted_at IS NULL
          AND t.is_active
          AND t.file_type = 'Excel'
          AND t.column_signature_hash = '8489d2c319f37358eb840da52a20cede2f3326cd0a137c613da258016672970d'
    LOOP
        RAISE WARNING 'Klien NPI masih punya template Excel (non-Multi) lama aktif dengan header yang sama: id %. Nonaktifkan dengan: UPDATE financial_transaction_sales_import_templates SET is_active = false, deleted_at = now(), edited_at = now() WHERE id = ''%'';', v_lama.id, v_lama.id;
    END LOOP;

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
            1,
            2,
            v_hash_baru,
            '[]'::jsonb,
            v_rules,
            'manual',
            true,
            0
        );
        RAISE NOTICE 'Template Multi NPI dibuat (baris baru).';
    ELSE
        UPDATE financial_transaction_sales_import_templates
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
        RAISE NOTICE 'Template Multi NPI sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.detected_by, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        (SELECT string_agg(v->>'file_type', ', ') FROM jsonb_array_elements(t.mapping_rules->'variants') v) AS tipe_file
-- FROM financial_transaction_sales_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(trim(m.nama_client)) IN ('NPI', 'PT NUSA PENIDA INVESTMENTS');