-- seed_template_ubd_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien UBD
-- (PT Ushers Beyond Design), format MULTI seperti seed NBM/Birawa:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. OCBC - Rekening Koran Giro / Current Account Statement (PDF)   dipakai 2 rekening:
--        165800001092 (Giro MCY Signature, a.n. PT Ushers Beyond Design) -> COA 1-10002 OCBC UBD 1092 IDR
--        165810049909 (Tanda360 Plus-S, a.n. Caroline Wendy Usher / CWU)  -> COA 1-10011 OCBC CWU 9909
--
-- SUMBER ISI: 5 file contoh Juni-Agustus 2026 (CWU hanya Juni-Juli). Angka dihitung langsung dari PDF
-- (pdfplumber) -- PDF OCBC ini TIDAK punya ringkasan total debit/kredit, jadi validasi = saldo awal
-- ('Beginning Balance'), saldo berjalan tiap baris (0 selisih di semua file) dan sambungan saldo antar bulan:
--   UBD_OCBC_IDR_165800001092_202606.pdf             40 baris | awal    1583634384.38 | akhir    1196776010.38
--   UBD_OCBC_IDR_165800001092_202607.pdf             42 baris | awal    1196776010.38 | akhir    1373471069.56
--   UBD_OCBC_IDR_165800001092_202608_unlocked.pdf    28 baris | awal    1373471069.56 | akhir    1684016955.92
--   UBD_OCBC_CWU_165810049909_202606.pdf            162 baris | awal      17429313.65 | akhir      11871827.02
--   UBD_OCBC_CWU_165810049909_202607.pdf            145 baris | awal      11871827.02 | akhir      80906825.03
--   Saldo akhir Jun = saldo awal Jul (IDR 1092 dan CWU 9909), IDR 1092 Jul = awal Agu.
--   Angka lengkap (total debit/kredit, jumlah baris debit/kredit) ada di
--   mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI:
--   * Varian TANPA recipe: tabel bergaris, jalur grid generik (pola sama dengan varian OCBC NPI).
--     BELUM dijalankan lewat bank_statement_parser.ekstrak_rekening_koran (file bank_statement_parser.py
--     di repo ini tertimpa salinan recipes, fungsi ekstrak_rekening_koran tidak ada). Jalankan preview 5 file
--     contoh dan cocokkan dengan validation_expected; kalau hasil grid tidak 'verified', perlu recipe 'ocbc_pdf'.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu (header
--     'NOMOR REKENING / ACCOUNT NUMBER'), jadi file 1092 dan 9909 tidak tertukar walau keterangan transaksi
--     memuat nama lain (mis. 'BIAYACETAKLK/2606/165810049909').
--   * Mutasi antar rekening UBD <-> CWU (OVERBOOKING SI 'CAROLINE WENDY USHER' / 'USHERS BEYOND DESIGN')
--     muncul di KEDUA rekening; itu urusan rekonsiliasi/jurnal, bukan parser.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_ocbc_pdf>") (satu varian)
--   = bba9c6bdd84af7f9f6d1a31fdc39d0c1dcec5939071fa051c29d319fd2505dbe
--
-- AKUN COA (sudah ada di DB; sumber sheet 'COA UBD' di dataset/COA/COA_Clients_GOUF.xlsx): 1-10002 OCBC UBD 1092 IDR,
-- 1-10011 OCBC CWU 9909. COA UBD sudah ada di DB Supabase (dicek: 101 akun),
-- jadi seed COA tidak perlu dijalankan.
-- Rekening UBD lain di COA (OCBC 1844 IDR 1-10005, OCBC 7222 IDR 1-10009, akun valas) belum punya file contoh,
-- jadi belum dipetakan; tambahkan baris mapping bila contohnya sudah ada.
-- Klien dicari lewat nama_client = 'PT USHER BEYOND DESIGN' (sesuai data klien di VPS);
-- GAGAL jelas kalau klien atau akun COA belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_ubd_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) = 'PT USHER BEYOND DESIGN';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) = 'PT USHER BEYOND DESIGN';

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_1092     UUID;
    v_coa_9909     UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(nama_client)) = 'PT USHER BEYOND DESIGN'
    ORDER BY created_at
    LIMIT 1;
    IF (SELECT count(*) FROM management_clients
        WHERE deleted_at IS NULL AND upper(trim(nama_client)) = 'PT USHER BEYOND DESIGN') > 1 THEN
        RAISE EXCEPTION 'Ada lebih dari 1 klien aktif bernama PT USHER BEYOND DESIGN di management_clients. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.';
    END IF;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien UBD belum ada di management_clients (dicari nama_client = ''PT USHER BEYOND DESIGN''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_1092 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10002' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_9909 FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '1-10011' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_1092 IS NULL OR v_coa_9909 IS NULL THEN
        RAISE EXCEPTION 'Akun COA UBD 1-10002 (OCBC UBD 1092 IDR) / 1-10011 (OCBC CWU 9909) belum lengkap -- pastikan COA UBD sudah diisi di management_client_coa.';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'UBD - Multi Format (OCBC; PDF)', 'Multi', NULL, 1, 2,
        'bba9c6bdd84af7f9f6d1a31fdc39d0c1dcec5939071fa051c29d319fd2505dbe',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien UBD untuk import rekening koran Cash & Bank > Source Data. 1 varian: OCBC Rekening Koran Giro (PDF) untuk 2 rekening (OCBC 165800001092 -> COA 1-10002, OCBC 165810049909 / CWU -> COA 1-10011). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "variant_name": "OCBC - Rekening Koran Giro / Current Account Statement (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "column_signature_hash": "dc953e30415804daa37413da7c39eafbba88f2c004866e0fdee6d8749e4acd6d",
      "header_columns": [
        "TGL TRANS / TRANS DATE",
        "TGL VALUTA / VALUE DATE",
        "URAIAN / DESCRIPTION",
        "DEBET / DEBIT",
        "KREDIT / CREDIT",
        "SALDO / BALANCE"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "TGL TRANS / TRANS DATE",
            "role": "date"
          },
          {
            "header": "TGL VALUTA / VALUE DATE",
            "role": "ignore"
          },
          {
            "header": "URAIAN / DESCRIPTION",
            "role": "description"
          },
          {
            "header": "DEBET / DEBIT",
            "role": "debit"
          },
          {
            "header": "KREDIT / CREDIT",
            "role": "credit"
          },
          {
            "header": "SALDO / BALANCE",
            "role": "balance"
          }
        ],
        "amount_mode": "split",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "grid",
        "bank_name": "OCBC",
        "date_format": "DD/MM/YYYY (kolom TGL TRANS; TGL VALUTA diabaikan); angka format en: 15,000,000.00",
        "detect": {
          "account_number_regex": "ACCOUNT NUMBER\\s*:\\s*(\\d+)",
          "filename_regex": "^UBD_OCBC_(?:IDR|CWU)_(\\d+)_(\\d{6})",
          "catatan": "Nama bank OCBC hanya logo (bukan teks); label dari bank_name template. Nomor rekening dokumen = nomor di nama file."
        },
        "validation_expected": {
          "source": "PDF TIDAK punya kotak ringkasan total debit/kredit. Divalidasi lewat baris 'Beginning Balance' (saldo awal), saldo berjalan tiap baris (awal - debit + kredit = saldo baris) dan sambungan saldo antar bulan (Jun -> Jul -> Agu). Angka di bawah dihitung dari PDF.",
          "samples": [
            {
              "file": "UBD_OCBC_IDR_165800001092_202606.pdf",
              "account": "165800001092",
              "pages": 7,
              "rows": 40,
              "count_debit": 33,
              "count_credit": 7,
              "opening_balance": "1583634384.38",
              "closing_balance": "1196776010.38",
              "total_debit": "852463956.00",
              "total_credit": "465605582.00"
            },
            {
              "file": "UBD_OCBC_IDR_165800001092_202607.pdf",
              "account": "165800001092",
              "pages": 7,
              "rows": 42,
              "count_debit": 31,
              "count_credit": 11,
              "opening_balance": "1196776010.38",
              "closing_balance": "1373471069.56",
              "total_debit": "466989699.82",
              "total_credit": "643684759.00"
            },
            {
              "file": "UBD_OCBC_IDR_165800001092_202608_unlocked.pdf",
              "account": "165800001092",
              "pages": 5,
              "rows": 28,
              "count_debit": 23,
              "count_credit": 5,
              "opening_balance": "1373471069.56",
              "closing_balance": "1684016955.92",
              "total_debit": "224317196.64",
              "total_credit": "534863083.00"
            },
            {
              "file": "UBD_OCBC_CWU_165810049909_202606.pdf",
              "account": "165810049909",
              "pages": 22,
              "rows": 162,
              "count_debit": 151,
              "count_credit": 11,
              "opening_balance": "17429313.65",
              "closing_balance": "11871827.02",
              "total_debit": "1660153486.63",
              "total_credit": "1654596000.00"
            },
            {
              "file": "UBD_OCBC_CWU_165810049909_202607.pdf",
              "account": "165810049909",
              "pages": 19,
              "rows": 145,
              "count_debit": 133,
              "count_credit": 12,
              "opening_balance": "11871827.02",
              "closing_balance": "80906825.03",
              "total_debit": "235407049.81",
              "total_credit": "304442047.82"
            }
          ]
        },
        "catatan_analisis": "OCBC 'Rekening Koran Giro / Current Account Statement' dwibahasa, dipakai 2 rekening UBD (giro MCY Signature 165800001092 a.n. PT Ushers Beyond Design; Tanda360 Plus-S 165810049909 a.n. Caroline Wendy Usher). Tabel bergaris 6 kolom: TGL TRANS | TGL VALUTA | URAIAN | DEBET | KREDIT | SALDO. 1 transaksi = 1 baris tanggal + 1 baris 'Berita'/keterangan lanjutan (bisa pindah halaman; halaman ke-14/16 CWU Jun hanya berisi sisa baris). Debet & Kredit dua kolom, saldo tercetak di tiap baris. Baris 'Currency Code : IDR' dan 'Beginning Balance' bukan mutasi. Tabel kurs/saldo min-max/tunggakan di halaman akhir bukan mutasi (header lain). JASA REKENING (kredit) & PAJAK (debit) tidak punya keterangan lanjutan. Rekening CWU juga punya saldo SGD kecil (0,82) yang tidak ada mutasinya. Tanpa recipe: tabel bergaris -> jalur grid generik (pola sama dengan varian OCBC NPI)."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'OCBC', '165800001092', NULL, v_coa_1092, v_tpl_multi,
         'Giro MCY Signature OCBC KC Gatot Subroto Denpasar a.n. PT USHERS BEYOND DESIGN (rekening koran giro, PDF; IDR).', true, 0),
        (v_client_id, v_client_code, 'OCBC', '165810049909', NULL, v_coa_9909, v_tpl_multi,
         'Tanda360 Plus-S OCBC KC Gatot Subroto Denpasar a.n. CAROLINE WENDY USHER / CWU (rekening koran giro, PDF; IDR).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT USHER BEYOND DESIGN' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(trim(c.nama_client)) = 'PT USHER BEYOND DESIGN' AND m.deleted_at IS NULL;