-- seed_template_evita_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran (financial_transaction_bank_cash_import_templates)
-- + mapping bank -> akun COA (financial_transaction_bank_cash_bank_mappings) untuk klien EVITA
-- (CV Evita Berkat Abadi; 2 usaha: EVITA SERANGAN dan ANAGEN COKROAMINOTO), format MULTI seperti seed NBM/YM/Birawa:
-- SATU baris template file_type 'Multi' yang membawa array "variants".
--
-- VARIAN (urutan = urutan hash di bawah):
--   1. BCA - Rekening Giro (PDF)                          rek. 6110737171   -> COA 10002 (Bank BCA)
--   2. BNI - Account Statement / Account Information (PDF) rek. 1863884296   -> COA 10003 (Bank BNI)
--
-- SUMBER ISI: 6 file contoh Juni-Agustus 2026 (BCA_STatement_Juni_2026.pdf, Rekening_Koran_BCA_Juli/Agustus_2026.pdf,
-- BNI_Statement_Juni_2026.pdf, Rekening_Koran_BNI_Juli/Agustus_2026.pdf). Diuji lewat resep bank_statement_recipes
-- (bca_pdf dan bni_acctinfo_pdf), pencocokan template memakai header_columns tiap varian. Semua file: total debit,
-- total kredit, jumlah baris debit/kredit dan saldo akhir SAMA PERSIS dengan ringkasan dokumen, 0 selisih saldo berjalan:
--
--   | File                               | Baris | Cek terhadap                                                      |
--   |------------------------------------|-------|-------------------------------------------------------------------|
--   | BCA_STatement_Juni_2026.pdf        | 223   | ringkasan halaman terakhir: saldo awal/akhir, MUTASI CR/DB + jumlah |
--   | Rekening_Koran_BCA_Juli_2026.pdf   | 208   | idem                                                              |
--   | Rekening_Koran_BCA_Agustus_2026.pdf| 210   | idem                                                              |
--   | BNI_Statement_Juni_2026.pdf        | 7     | Ledger Balance / Ending Balance / Total Debet & Credit (+ jumlah) |
--   | Rekening_Koran_BNI_Juli_2026.pdf   | 5     | idem                                                              |
--   | Rekening_Koran_BNI_Agustus_2026.pdf| 5     | idem                                                              |
--   Saldo akhir Juni = saldo awal Juli, Juli = saldo awal Agustus (tersambung persis, kedua bank).
--   Angka per file ada di mapping_rules.variants[].mapping_rules.validation_expected.samples.
--
-- KUNCI INTEGRASI (jangan dihapus):
--   * Varian BCA memakai recipe 'bca_pdf' yang SUDAH ada (layout & header sama dengan BCA Giro SAU/NBM; hash varian sama
--     dengan varian BCA PDF NBM). Tanpa recipe parser generik SALAH baca BCA (saldo hanya di baris terakhir tiap hari).
--   * Varian BNI membawa recipe 'bni_acctinfo_pdf'. RECIPE INI BARU: harus sudah ada di
--     backend/modules/transactions/bank_statement_recipes.py (fungsi _parse_bni_acctinfo + entri RESEP "bni_acctinfo_pdf",
--     lihat bni_acctinfo_recipe_patch.py) SEBELUM seed ini dipakai. Resep 'bni_pdf' milik YM TIDAK bisa dipakai: layout BNI
--     Evita beda (tanpa kolom No, header 'DB/CR', dua kolom tanggal, ringkasan Ledger/Ending Balance) dan membaca 0 baris.
--   * Pemetaan akun: bank_cash_v1._cari_mapping memakai nomor rekening DOKUMEN lebih dulu (nol di depan diabaikan).
--     Penting karena mutasi BNI memuat 'PEMINDAHAN DARI/KE 6110737171' (= rekening BCA Evita) dan mutasi BCA memuat
--     'EVITA BERKAT ABADI KBB' (transfer ke BNI); tanpa prioritas itu file bisa salah masuk akun.
--   * Nama file contoh Evita TIDAK seragam (BCA_STatement_... vs Rekening_Koran_BCA_...), jadi jangan menambah filename_regex
--     yang ketat; nomor rekening dibaca dari isi dokumen.
--
-- column_signature_hash varian = bsp.signature(header_columns) (sha256 header ternormalisasi digabung '|');
-- level baris = SHA-256("<hash_bca_pdf>:<hash_bni_pdf>")
--   = 7689cf34e14446c05c7a5cbe1f3d3dbc91809cc13125c8ba3abe281f3c009278
--   hash BCA = a0c6dff260fef25439c5c1661a4ccc807894f981d023cb45410277f438ade91a
--   hash BNI = 96629528a7941f42883c82c2286f94851c4f39c2132f614a42c9d0e94ce80153
--
-- AKUN COA (dataset/COA/COA_Clients_GOUF.xlsx, sheet 'COA EVITA'): 10002 'Bank BCA' dan 10003 'Bank BNI'.
-- PERLU: seed COA Evita belum ada di migrations/coa/ (baru ada nbm, npi, sau). Tambahkan EVITA ke KLIEN di
-- migrations/generate_seed_coa.py (mis. "EVITA": ["EVITA", "CV EVITA BERKAT ABADI"]) lalu jalankan, dan jalankan seed COA-nya
-- SEBELUM seed ini. Klien dicari lewat client_code = 'EVITA' (bukan nama klien), sama dengan seed Sales/Purchase Evita;
-- GAGAL jelas kalau klien atau akun COA belum ada. client_id / coa id TIDAK di-hardcode.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_evita_multi_format_bank_cash.sql
--
-- Idempotensi: TIDAK pakai ON CONFLICT supaya run-2x kelihatan. Untuk menjalankan ulang:
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.client_code)) = 'EVITA';
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.client_code)) = 'EVITA';

DO $do$
DECLARE
    v_client_id    UUID;
    v_client_code  VARCHAR(50);
    v_coa_bca      UUID;
    v_coa_bni      UUID;
    v_tpl_multi    UUID;
BEGIN
    SELECT id, client_code INTO v_client_id, v_client_code
    FROM management_clients
    WHERE deleted_at IS NULL
      AND upper(trim(client_code)) = 'EVITA'
    ORDER BY created_at
    LIMIT 1;

    IF v_client_id IS NULL THEN
        RAISE EXCEPTION 'Klien EVITA belum ada di management_clients (dicari client_code = ''EVITA''). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;

    SELECT id INTO v_coa_bca FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '10002' AND deleted_at IS NULL LIMIT 1;
    SELECT id INTO v_coa_bni FROM management_client_coa WHERE client_id = v_client_id AND acc_no = '10003' AND deleted_at IS NULL LIMIT 1;

    IF v_coa_bca IS NULL OR v_coa_bni IS NULL THEN
        RAISE EXCEPTION 'Akun COA Evita 10002 (Bank BCA) / 10003 (Bank BNI) belum lengkap -- jalankan dulu seed COA Evita (generate_seed_coa.py, sheet COA EVITA).';
    END IF;

    INSERT INTO financial_transaction_bank_cash_import_templates (
        client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
        column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
    ) VALUES (
        v_client_id, v_client_code, 'EVITA - Multi Format (BCA, BNI; PDF)', 'Multi', NULL, 1, 2,
        '7689cf34e14446c05c7a5cbe1f3d3dbc91809cc13125c8ba3abe281f3c009278',
        '[]'::jsonb,
        $json${
  "format_type": "multi_format",
  "description": "1 setting klien EVITA (CV Evita Berkat Abadi) untuk import rekening koran Cash & Bank > Source Data. 2 varian PDF: BCA Rekening Giro (rek. 6110737171) dan BNI Account Statement (rek. 1863884296). Backend memilih varian yang file_type dan header-nya cocok; akun COA ditentukan lewat financial_transaction_bank_cash_bank_mappings (nomor rekening dokumen > kata kunci > template > nama bank).",
  "variants": [
    {
      "column_signature_hash": "a0c6dff260fef25439c5c1661a4ccc807894f981d023cb45410277f438ade91a",
      "variant_name": "BCA - Rekening Giro (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "TANGGAL",
        "KETERANGAN",
        "CBG",
        "MUTASI",
        "SALDO"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "TANGGAL",
            "role": "date"
          },
          {
            "header": "KETERANGAN",
            "role": "description"
          },
          {
            "header": "CBG",
            "role": "reference"
          },
          {
            "header": "MUTASI",
            "role": "amount"
          },
          {
            "header": "SALDO",
            "role": "balance"
          }
        ],
        "amount_mode": "single",
        "default_direction": "credit",
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "BCA",
        "date_format": "DD/MM (tahun dari baris 'PERIODE : <BULAN> <TAHUN>' di header tiap halaman)",
        "detect": {
          "account_number_regex": "NO\\.?\\s*REKENING\\s*:\\s*(\\d+)",
          "filename_regex": "(?i)BCA",
          "catatan": "Nama file contoh Evita tidak seragam (BCA_STatement_Juni_2026 / Rekening_Koran_BCA_Juli_2026), jadi pengenalan bertumpu pada header halaman + nomor rekening di dokumen, bukan nama file."
        },
        "validation_expected": {
          "source": "ringkasan di halaman terakhir (SALDO AWAL / MUTASI CR / MUTASI DB / SALDO AKHIR)",
          "samples": [
            {
              "file": "BCA_STatement_Juni_2026.pdf",
              "account": "6110737171",
              "rows": 223,
              "opening_balance": "104560960.08",
              "closing_balance": "106838283.96",
              "total_credit": "489495607.88",
              "count_credit": 140,
              "total_debit": "487218284.00",
              "count_debit": 83
            },
            {
              "file": "Rekening_Koran_BCA_Juli_2026.pdf",
              "account": "6110737171",
              "rows": 208,
              "opening_balance": "106838283.96",
              "closing_balance": "42335588.76",
              "total_credit": "244162962.80",
              "count_credit": 138,
              "total_debit": "308665658.00",
              "count_debit": 70
            },
            {
              "file": "Rekening_Koran_BCA_Agustus_2026.pdf",
              "account": "6110737171",
              "rows": 210,
              "opening_balance": "42335588.76",
              "closing_balance": "142574285.38",
              "total_credit": "349164961.62",
              "count_credit": 151,
              "total_debit": "248926265.00",
              "count_debit": 59
            }
          ]
        },
        "catatan_analisis": "Rekening Giro BCA KCP Grand Sudirman a.n. EVITA BERKAT ABADI CV (rek. 6110737171), Jun-Agu 2026, 22-25 halaman, 208-223 baris per bulan. Layout & header SAMA dengan BCA Giro SAU/NBM, jadi memakai resep bca_pdf yang sudah ada (tidak ada perubahan kode). Tanggal 'dd/mm', MUTASI satu kolom dengan sufiks 'DB' = debit (tanpa sufiks = kredit), saldo hanya tercetak di baris terakhir tiap hari. Keterangan 3-5 baris. Isi dominan: setoran settlement EDC/QRIS ('KR OTOMATIS' MID 885002548990 EVITA SKIN CARE HO & 885002525303 ANAGEN HO, 'KARTU KREDIT' MID 002548990 / 002525303) yang sudah neto MDR/DDR; transfer keluar e-banking/BI-FAST (reimburse, supplier, prive, gaji komisi). Transfer ANTAR REKENING SENDIRI ke BNI 1863884296 tercetak 'BI-FAST DB ... EVITA BERKAT ABADI KBB' (+ baris biaya BIF BIAYA TXN KE 2.500): 16/06 26.607.323, 30/06 17.892.040, 16/07 16.703.955, 31/07 19.848.055, 15/08 14.415.575, 31/08 32.361.160; dan 29/06 masuk 150.000.000 dari BNI ('BI-FAST CR ... EVITA BERKAT ABADI'). Pasangan ini = kandidat pencocokan transfer internal di fase berikutnya, jangan diperlakukan sebagai pendapatan/biaya. Baris 'SALDO AWAL' bukan mutasi.",
        "recipe": "bca_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py. Kalau header file tidak cocok, parser generik tetap jalan."
      }
    },
    {
      "column_signature_hash": "96629528a7941f42883c82c2286f94851c4f39c2132f614a42c9d0e94ce80153",
      "variant_name": "BNI - Account Statement / Account Information (PDF)",
      "file_type": "PDF",
      "sheet_name": null,
      "header_row_index": 1,
      "data_start_row_index": 2,
      "header_columns": [
        "Posting Date",
        "Effective Date",
        "Branch",
        "Journal",
        "Transaction Description",
        "Amount",
        "DB/CR",
        "Balance"
      ],
      "mapping_rules": {
        "columns": [
          {
            "header": "Posting Date",
            "role": "date"
          },
          {
            "header": "Effective Date",
            "role": "ignore"
          },
          {
            "header": "Branch",
            "role": "ignore"
          },
          {
            "header": "Journal",
            "role": "reference"
          },
          {
            "header": "Transaction Description",
            "role": "description"
          },
          {
            "header": "Amount",
            "role": "amount"
          },
          {
            "header": "DB/CR",
            "role": "dc_flag"
          },
          {
            "header": "Balance",
            "role": "balance"
          }
        ],
        "amount_mode": "single",
        "default_direction": null,
        "number_format": "en",
        "date_order": "dmy",
        "method": "words",
        "bank_name": "BNI",
        "date_format": "DD/MM/YYYY HH.MM.SS (tanggal+jam satu baris; Posting Date dipakai, Effective Date diabaikan)",
        "detect": {
          "account_number_regex": "Account\\s*No\\.\\s*(\\d{6,})",
          "filename_regex": "(?i)BNI",
          "catatan": "Nomor rekening ada di kepala halaman ('Account No. : 1863884296 / CV EVITA BERKAT ABADI(IDR)'). Keterangan transaksi memuat 'PEMINDAHAN DARI/KE 6110737171' = rekening BCA Evita; pemetaan akun memakai nomor rekening DOKUMEN lebih dulu sehingga file BNI tidak salah masuk ke akun BCA."
        },
        "validation_expected": {
          "source": "blok ringkasan di bawah tabel (Ledger Balance = saldo awal / Ending Balance / Total Debet n x / Total Credit n x)",
          "samples": [
            {
              "file": "BNI_Statement_Juni_2026.pdf",
              "account": "1863884296",
              "rows": 7,
              "opening_balance": "262915154.00",
              "closing_balance": "157546560.00",
              "total_debit": "150067386.00",
              "count_debit": 4,
              "total_credit": "44698792.00",
              "count_credit": 3
            },
            {
              "file": "Rekening_Koran_BNI_Juli_2026.pdf",
              "account": "1863884296",
              "rows": 5,
              "opening_balance": "157546560.00",
              "closing_balance": "194169538.00",
              "total_debit": "48992.00",
              "count_debit": 2,
              "total_credit": "36671970.00",
              "count_credit": 3
            },
            {
              "file": "Rekening_Koran_BNI_Agustus_2026.pdf",
              "account": "1863884296",
              "rows": 5,
              "opening_balance": "194169538.00",
              "closing_balance": "241042254.00",
              "total_debit": "55246.00",
              "count_debit": 2,
              "total_credit": "46927962.00",
              "count_credit": 3
            }
          ]
        },
        "catatan_analisis": "BNI 'Account Information - ACCOUNT STATEMENT' giro CV EVITA BERKAT ABADI (rek. 1863884296), Jun-Agu 2026, 1 halaman (7/5/5 baris). Kolom: Posting Date | Effective Date | Branch | Journal | Transaction Description | Amount | DB/CR | Balance. SATU kolom Amount + penanda 'D' = debit / 'K' = kredit; saldo tercetak per baris KECUALI baris terakhir tabel (diisi dari Ending Balance dokumen hanya bila selisihnya persis cocok). BEDA dengan BNI BNIDirect milik YM: tidak ada kolom No, header 'DB/CR', dua kolom tanggal, ringkasan 'Ledger/Ending Balance + Total Debet/Credit' -- resep bni_pdf (YM) membaca 0 baris dari file ini, karena itu dibuat resep terpisah bni_acctinfo_pdf. Kolom Amount tercetak dobel (lapisan teks ganda, angka K ditimpa '0'), dibersihkan _halaman_pdf_bni. Nominal panjang (mis. 150,000,000.00) tercetak ~6pt lebih tinggi dari baris tanggal, ditangani lewat jendela vertikal. Isi: setoran masuk dari BCA ('TRF/PAY/TOP-UP ECHANNEL | PEMINDAHAN DARI 6110737171 ... cash 1-15 / 16-31 <bulan>') dua kali per bulan, JASA GIRO/BUNGA (K), PPH (D), BIAYA ADM REK 25.000 (D); Juni: 29/06 PEMINDAHAN KE 6110737171 150.000.000 (biaya gaji) + BY TRX BIFAST 2.500. Baris 31/xx jam 08.00.00 (bunga, PPH, adm) adalah mutasi biasa.",
        "recipe": "bni_acctinfo_pdf",
        "recipe_catatan": "Dibaca oleh bank_statement_recipes.py (_parse_bni_acctinfo). Resep BARU: harus sudah ada di backend/modules/transactions/bank_statement_recipes.py sebelum seed ini dipakai (lihat bni_acctinfo_recipe_patch.py)."
      }
    }
  ]
}$json$::jsonb,
        'manual', 100.00, true, 0
    ) RETURNING id INTO v_tpl_multi;

    INSERT INTO financial_transaction_bank_cash_bank_mappings (
        client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes, is_active, usage_count
    ) VALUES
        (v_client_id, v_client_code, 'BCA', '6110737171', NULL, v_coa_bca, v_tpl_multi,
         'Rekening Giro BCA KCP Grand Sudirman a.n. EVITA BERKAT ABADI CV (PDF).', true, 0),
        (v_client_id, v_client_code, 'BNI', '1863884296', NULL, v_coa_bni, v_tpl_multi,
         'Giro BNI a.n. CV EVITA BERKAT ABADI (PDF Account Statement).', true, 0);
END
$do$;

-- Verifikasi setelah dijalankan:
-- SELECT t.template_name, t.file_type, jsonb_array_length(t.mapping_rules->'variants') AS jumlah_varian
-- FROM financial_transaction_bank_cash_import_templates t
-- JOIN management_clients c ON c.id = t.client_id
-- WHERE upper(c.client_code) = 'EVITA' AND t.deleted_at IS NULL;
-- SELECT m.bank_name, m.account_number, a.acc_no, a.account_name
-- FROM financial_transaction_bank_cash_bank_mappings m
-- JOIN management_client_coa a ON a.id = m.bank_coa_id
-- JOIN management_clients c ON c.id = m.client_id
-- WHERE upper(c.client_code) = 'EVITA' AND m.deleted_at IS NULL;