-- seed_template_ubd_multi_format_purchase.sql
-- =============================================================
-- Template pola kolom (financial_transaction_purchase_import_templates) untuk klien UBD
-- (PT Ushers Beyond Design), halaman Transactions > Purchase > Source Data > Upload File.
-- SATU baris setting ("Multi"); format lain nanti cukup ditambahkan ke array "variants".
--
-- SUMBER: UBD_ADJUSTMENT_JOURNAL.xlsx -- 1 sheet ("Sheet1"), 65 baris, 5 blok jurnal (depresiasi aset
-- Jun-Agu, accrue PPh 21 dan PPh 25 Jan-Jul; Agu-Des PPh bernilai 0). Header baris 1, data baris 2.
-- Header (18 kolom) IDENTIK dengan seed Journal Entry UBD, hash header sama:
--   d0bc263b435db2a7127f4a2c0ce0b8958fd2d3a835a8a1709e88f2a4b873cc45
-- column_signature_hash level baris = SHA-256("<hash varian>") = 9923cf06d28ec0937e37d1ecdd5e589ffdeb3cbf9f49ae15ce6c929333727da5
--
-- NAMA FILE = PERIODE (sama seperti Sales UBD): resep memakai "filter_periode_nama_file": true.
--   UBD_PURCHASE_202608.xlsx -> hanya transaksi bertanggal Agustus 2026 yang diimpor
--   UBD_PURCHASE_202607.xlsx -> hanya Juli 2026   (isi file boleh sama, Januari-Desember)
--   UBD_PURCHASE_20260801-20260815.xlsx -> rentang tanggal; UBD_PURCHASE_Agustus_2026.xlsx juga dikenali.
-- Nama file TANPA periode -> TIDAK ada yang diimpor (aman, mencegah transaksi dobel antar bulan).
-- Nomor transaksi unik per klien: upload ulang bulan yang sama dilewati ("already imported").
--
-- CARA FILE DIBACA (jurnal -> transaksi Purchase draft):
--   * Baris SISI DEBIT (Debit > 0) = item transaksi; akun item = "Kode Akun #" di file (6-60107, 6-60109,
--     1-10302 ...), BUKAN akun persediaan. Qty = 1, harga = nilai debit.
--   * Baris SISI KREDIT hanya dipakai untuk akun lawan transaksi (Cr): akun kredit di voucher itu menjadi
--     akun "hutang" transaksi (1-10502 akumulasi penyusutan / 2-20201 TAX PAYABLE), menimpa akun hutang
--     Settings > Account Mapping HANYA untuk transaksi ini. Jurnal Purchase hasilnya: Dr akun debit, Cr akun
--     kredit file, SAMA dengan jurnal di file.
--   * Voucher yang dipakai di > 1 tanggal dipecah per tanggal: ADJ DEP FA-2026-05 -> 'ADJDEPFA-2026-05-20260630'
--     / '-20260731' / '-20260831'. Nomor transaksi = voucher tanpa spasi, huruf besar (aturan resep flat).
--   * PPh 21 dan PPh 25 memakai voucher SAMA per bulan ('ACC/PPH21/2026/001' dst) -> jadi 1 transaksi per
--     bulan, 2 item (Dr 6-60109 dan Dr 1-10302), Cr 2-20201. Mau dipisah: beri voucher beda di file.
--   * Baris bernilai 0 dan baris judul blok dilewati. Supplier kosong di file -> 'UBD Adjustment Journal'.
--
-- PERLU DIPERHATIKAN:
--   * File ini sebenarnya JURNAL PENYESUAIAN, bukan laporan pembelian: tidak ada vendor/invoice/PPN. Hasil
--     di Purchase = transaksi draft tanpa PPN dan tanpa vendor asli; payment_status 'unpaid' & jurnal hutang
--     pada akun kredit file. Jurnal yang SAMA bisa juga diimpor lewat Journal Entry UBD -- pilih salah satu,
--     jangan keduanya (jurnal dobel).
--   * Kode akun HARUS ada di COA UBD (kelimanya ada). Struktur HARUS tetap: nama header sama persis (hash),
--     baris 1 = header, sheet bernama "Sheet1".
--
-- PRASYARAT KODE (purchase_import_v1.py): filter_periode_nama_file, abaikan_baris_total_nol,
-- kunci_pisah_tanggal, akun_baris_dari_file, akun_kredit_dari_baris (semua opsional; resep klien lain
-- tidak berubah perilakunya).
--
-- KLIEN: dicari lewat client_code = 'UBD'; GAGAL dengan pesan jelas kalau belum ada di management_clients.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\run_seed.py migrations\purchase\seed_template_ubd_multi_format_purchase.sql
--
-- Idempotensi / upgrade di tempat: AMAN dijalankan berkali-kali (pola seed Sales UBD). Baris Multi klien dicari
-- lewat hash baris seed ini (v_hash_baru) atau versi lamanya (v_hash_lama), termasuk yang soft-delete ->
-- UPDATE resep di tempat (id, usage_count, riwayat file tetap); tidak ada -> INSERT. Menjalankan ulang MENIMPA
-- resep dengan isi file ini. Pengaman: ada baris Multi AKTIF lain milik klien dengan varian Excel header sama ->
-- seed berhenti dengan pesan jelas (nonaktifkan baris itu dulu:
--   UPDATE financial_transaction_purchase_import_templates
--      SET is_active = false, deleted_at = now(), edited_at = now() WHERE id = '<id>';).
-- Menambah varian: tambah objek di "variants", hitung ulang hash baris = SHA-256("<hash1>:<hash2>"), pindahkan
-- hash lama ke v_hash_lama, jalankan ulang.

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_nama        TEXT;
    v_id          UUID;
    v_bentrok     INTEGER;
    v_hash_baru   CONSTANT TEXT := '9923cf06d28ec0937e37d1ecdd5e589ffdeb3cbf9f49ae15ce6c929333727da5';
    v_hash_lama   TEXT[] := ARRAY[]::TEXT[];
    v_rules       JSONB := $json${
  "format_type": "multi_format",
  "description": "1 setting klien UBD untuk file pembelian/AP. Varian Excel: UBD_ADJUSTMENT_JOURNAL (jurnal penyesuaian: depresiasi aset, accrue PPh 21 dan PPh 25) dibaca sebagai transaksi Purchase draft. Tiap varian membawa file_type, sheet, posisi header, signature & resep sendiri; backend memilih varian yang tipe file dan signature header-nya cocok. Format lain ditambahkan ke array variants.",
  "variants": [
    {
      "file_type": "Excel",
      "sheet_name": "Sheet1",
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "d0bc263b435db2a7127f4a2c0ce0b8958fd2d3a835a8a1709e88f2a4b873cc45",
      "header_columns": [
        "No",
        "Tipe Transaksi Jurnal",
        "Month",
        "Tanggal",
        "No Voucher",
        "Kode Akun #",
        "Nama Perkiraan",
        "Keterangan Jurnal",
        "Debit",
        "Kredit",
        "D/C",
        "SUPPLIER/CUSTOMER",
        "TAX MAPPING",
        "NO. REKON",
        "NOMOR FAKTUR",
        "CABANG",
        "NOTES",
        "DIBUAT PADA"
      ],
      "mapping_rules": {
        "format_type": "flat_grouped_purchase_report",
        "description": "Adjustment Journal UBD sebagai transaksi Purchase -- tabel Excel flat, header baris 1, data mulai baris 2. 1 baris = 1 sisi jurnal (akun + debit ATAU kredit). Baris sisi DEBIT (Debit > 0) menjadi item transaksi; baris sisi KREDIT dibaca hanya untuk menentukan akun lawan (Cr) transaksi. Baris dengan No Voucher sama (dan tanggal sama) = 1 transaksi Purchase draft. Voucher yang dipakai di beberapa tanggal dipecah per tanggal. Periode yang diambil ditentukan NAMA FILE (UBD_PURCHASE_YYYYMM): file boleh berisi Januari-Desember, hanya transaksi bulan di nama file yang diimpor.",
        "source_kind": "excel_sheet",
        "sheet_name": "Sheet1",
        "date_format": "YYYY-MM-DD",
        "number_format": {
          "thousands_separator": ",",
          "decimal_separator": "."
        },
        "header_row_index": 1,
        "data_start_row_index": 2,
        "filter_periode_nama_file": true,
        "jatuh_tempo_hari": 30,
        "header_kolom": [1, 18],
        "currency_default": "IDR",
        "category_default": "Other",
        "columns": {
          "tanggal": 4,
          "purchase_no": 5,
          "akun_kode": 6,
          "akun_nama": 7,
          "deskripsi": 8,
          "total": 9,
          "kredit": 10,
          "supplier": 12
        },
        "abaikan_baris_total_nol": true,
        "kunci_pisah_tanggal": true,
        "akun_baris_dari_file": true,
        "akun_kredit_dari_baris": true,
        "ignore_columns": {
          "1": "hanya berisi judul blok jurnal (JURNAL ADJ DEPRESIASI ASET, JURNAL ACCRUE PPH 21, ...)",
          "2": "Tipe Transaksi Jurnal (FA / ACCRUE), informasi",
          "3": "Month (nomor bulan), informasi -- periode dibaca dari kolom Tanggal",
          "11": "D/C, hanya pengecekan",
          "13": "TAX MAPPING, informasi",
          "14": "NO. REKON, kosong di file contoh",
          "15": "NOMOR FAKTUR, kosong di file contoh",
          "16": "CABANG, kosong di file contoh",
          "17": "NOTES, kosong di file contoh",
          "18": "DIBUAT PADA, kosong di file contoh"
        },
        "validation": {
          "total_nota_toleransi": 0.01,
          "deskripsi_kosong_pengganti": "(no description)",
          "supplier_kosong_pengganti": "UBD Adjustment Journal"
        },
        "catatan_analisis": "Dianalisis dari UBD_ADJUSTMENT_JOURNAL.xlsx (Sheet1, 65 baris). Lihat komentar seed."
      }
    }
  ]
}$json$::jsonb;
BEGIN
    SELECT id, client_code, nama_client INTO v_client_id, v_client_code, v_nama
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'UBD'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien UBD belum ada di management_clients (dicari client_code = ''UBD''). Buat dulu lewat halaman Clients, lalu jalankan ulang.';
    END IF;
    RAISE NOTICE 'Klien terpilih: % (client_code %)', v_nama, v_client_code;

    SELECT t.id INTO v_id
    FROM financial_transaction_purchase_import_templates t
    WHERE t.client_id = v_client_id
      AND t.file_type = 'Multi'
      AND (t.column_signature_hash = v_hash_baru OR t.column_signature_hash = ANY (v_hash_lama))
    ORDER BY (t.column_signature_hash = v_hash_baru) DESC, t.created_at
    LIMIT 1;

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
          WHERE v->>'file_type' = 'Excel' AND v->>'column_signature_hash' = 'd0bc263b435db2a7127f4a2c0ce0b8958fd2d3a835a8a1709e88f2a4b873cc45'
      );

    IF v_bentrok > 0 THEN
        RAISE EXCEPTION 'Klien UBD sudah punya template Multi AKTIF lain dengan varian Excel yang sama. Singkirkan baris yang tidak dipakai (lihat bagian Idempotensi di kepala file ini), lalu jalankan ulang seed ini.';
    END IF;

    IF v_id IS NULL THEN
        INSERT INTO financial_transaction_purchase_import_templates (
            client_id, client_code, file_type, header_row_index, data_start_row_index,
            column_signature_hash, header_columns, mapping_rules, detected_by, is_active, usage_count
        ) VALUES (
            v_client_id, v_client_code, 'Multi', 1, 2,
            v_hash_baru, '[]'::jsonb, v_rules, 'manual', true, 0
        );
        RAISE NOTICE 'Template Multi UBD dibuat (baris baru).';
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
        RAISE NOTICE 'Template Multi UBD sudah ada: hash dan resep diperbarui di tempat (usage_count dan riwayat file tetap).';
    END IF;
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.id, m.nama_client, t.client_code, t.file_type, t.column_signature_hash, t.is_active,
--        jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian,
--        t.mapping_rules->'variants'->0->'mapping_rules'->>'filter_periode_nama_file' AS filter_periode
-- FROM financial_transaction_purchase_import_templates t
-- JOIN management_clients m ON m.id = t.client_id
-- WHERE t.file_type = 'Multi' AND upper(m.client_code) = 'UBD';