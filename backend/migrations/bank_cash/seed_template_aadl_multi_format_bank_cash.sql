-- seed_template_aadl_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / buku kas (financial_transaction_bank_cash_import_templates)
-- + mapping rekening/buku kas -> akun COA (financial_transaction_bank_cash_bank_mappings)
-- untuk klien AADL (PT Akshaya Ananda Dylan Lestari).
--
-- FORMAT: 1 baris template PER BENTUK FILE (file_type PDF/Excel/CSV + column_signature_hash), persis
-- yang dibaca modules/transactions/bank_statement_extractor.py (Bank Feed Cash & Bank). Menggantikan
-- seed format 'Multi' (variants + recipe di bank_statement_recipes.py versi branch hendra) yang TIDAK
-- dibaca extractor branch ini; template 'Multi' lama milik klien ini dihapus oleh seed ini.
--
-- Template & signature DIHASILKAN dari ekstraksi file contoh di dataset/Bank Cash/AADL/ (regresi:
-- tests/test_bank_statement_extractor_5_klien.py):
--   key                    tipe   metode  status     baris   file contoh
--   bca_pdf                PDF    words   verified      29   ESTATEMENT_05855600177_202608.pdf
--   bri_pdf                PDF    words   verified      36   IBIZ_040901017700302_20260801_20260831_1788410142216896997.pdf
--   permata_syariah_pdf    PDF    words   verified      20   260903_113756_report_07027771771_transactionhistory.pdf
--   permata_me_pdf         PDF    recipe  unverified    10   Transaction History - Permata ME Saver1325 - 3182026114133.pdf
--   kas_std_xlsx           Excel  table   verified     210   Rekapan Pembayaran Pattycash Warung Soemantri 2026.xlsx
--   kas_omah_xlsx          Excel  table   verified    1582   Rekap Pembayaran Patty cash Omah Soemantri - 2026.xlsx
--   kas_kappu_xlsx         Excel  table   verified     527   2026 Kas d_Kappu Soemantri Coffee 24 - 31 Agustus ‘26.xlsx
--   metode 'recipe' = parser khusus format di modules/transactions/bank_statement_recipes.py
--   (mapping_rules.recipe); header_columns = kolom buatan resep itu.
--
-- MAPPING (akun dicari di management_client_coa klien lewat acc_no ATAU source_acc_no, urut kiri ke kanan:
-- kode COA asli klien (dataset/COA/COA_Clients_GOUF.xlsx) dulu, lalu kode COA template industri sebagai
-- cadangan). Tidak ada yang cocok -> mapping itu DILEWATI (NOTICE), template tetap tersimpan; akun dipilih
-- manual saat upload pertama dan mapping-nya dipelajari otomatis. Urutan cocok saat upload "Auto-detect":
-- nomor rekening > kata kunci judul > template > nama bank.
--   BCA        5855820177                           -> 000.11002107 / 120001  Bank BCA 201 - Kost Kapu (rek. 585-582-0177).
--   BCA        5855710177                           -> 000.11002110 / 120002  Bank BCA 5710 - Kafe Kapu Soemantri.
--   BCA        5855779177                           -> 000.11002104 / 120003  Bank BCA 9177.
--   BCA        5855600177                           -> 000.11002106 / 120004  Bank BCA 600 - Kost Warung Soemantri.
--   BCA        5265275785                           -> 000.11002108 / 120005  Bank BCA 5785 (rekening a.n. perorangan -- konfirmasi milik AADL).
--   BRI        040901001771307                      -> 000.11002103 / 120006  Bank BRI 307 (Giro Umum, KC Yogyakarta Mlati).
--   BRI        040901017700302                      -> 000.11002105 / 120007  Bank BRI 302.
--   Permata    07027771771                          -> 000.11002101 / 120008  Bank Permata 1771 (0702-7771-771, Transaction History).
--   Permata    009929951325                         -> 000.11002109 / 120009  Bank Permata 1325 (ME Saver 0099-2995-1325; arah dari warna nominal, tanpa saldo).
--   Kas Kecil  kata kunci 'LESTARI WARUNG SOEMANTRI' -> 005.11001101 / 110002  Petty Cash - Warung Soemantri.
--   Kas Kecil  kata kunci 'KOST WARUNG SOEMANTRI'   -> 008.11001101 / 110002  Petty Cash - Kost Warung Soemantri.
--   Kas Kecil  kata kunci 'KOST KAPU SOEMANTRI'     -> 009.11001101 / 110002  Petty Cash - Kost Kapu Soemantri.
--   Kas Kecil  kata kunci 'PUTU SOEMANTRI'          -> 001.11001101 / 110002  Petty Cash - Putu Soemantri Family Villas.
--   Kas Kecil  kata kunci 'OMAH SOEMANTRI'          -> 003.11001101 / 110002  Petty Cash - Omah Soemantri.
--   Kas Kecil  kata kunci 'KAPPU SOEMANTRI COFFEE'  -> 011.11001101 / 110002  Kas d'Kappu Soemantri Coffee (Cafe Kapu).
--
-- Klien dicari lewat nama_client IN ('PT AKSHAYA ANANDA DYLAN LESTARI'); GAGAL kalau tidak ada,
-- atau kalau ada >1 klien aktif dengan nama itu dan tidak satu pun ber-client_code 'AADL'. client_id / coa id TIDAK di-hardcode.
--
-- BOLEH DIJALANKAN ULANG: template di-upsert per (klien, file_type, signature); mapping di-upsert per
-- nomor rekening (nol di depan diabaikan) / kata kunci -- akun, template, label & catatan ikut diperbarui.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\bank_cash\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_aadl_multi_format_bank_cash.sql
--
-- Hapus total (lalu jalankan ulang):
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT AKSHAYA ANANDA DYLAN LESTARI');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT AKSHAYA ANANDA DYLAN LESTARI');

DO $do$
DECLARE
    v_client_id   UUID;
    v_client_code VARCHAR(50);
    v_n           INT;
    v_tpl_ids     JSONB := '{}'::jsonb;
    t             JSONB;
    m             JSONB;
    v_kode        TEXT;
    v_tid         UUID;
    v_coa         UUID;
    v_coa_kode    TEXT;
    v_map_id      UUID;
    v_templates   JSONB := $tpl$[
  {
    "key": "bca_pdf",
    "name": "BCA - Rekening Giro/Tahapan (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "6a65c7106a217a494632febf3b4f082cb15a8570ec54ace3a2299c34087b21f0",
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
      "bank_name": "BCA"
    }
  },
  {
    "key": "bri_pdf",
    "name": "BRI - Laporan Transaksi Finansial IBBIZ (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "a4fb6183c395e851688fdf816e45630e7fa62b10075bc4287efed290f4aff457",
    "header_columns": [
      "Tanggal Transaksi",
      "Uraian Transaksi",
      "Teller",
      "Debet",
      "Kredit",
      "Saldo"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "Tanggal Transaksi",
          "role": "date"
        },
        {
          "header": "Uraian Transaksi",
          "role": "description"
        },
        {
          "header": "Teller",
          "role": "reference"
        },
        {
          "header": "Debet",
          "role": "debit"
        },
        {
          "header": "Kredit",
          "role": "credit"
        },
        {
          "header": "Saldo",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "words",
      "bank_name": "BRI"
    }
  },
  {
    "key": "permata_syariah_pdf",
    "name": "Permata - Transaction History Financial (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "c6378a0c147556b6ef9ce4aabd85bd625da48011a850a42c18eeb845f47a7b5f",
    "header_columns": [
      "Transaction Date",
      "Value Date",
      "Transaction Reference No./ Customer Reference Detail/",
      "Description",
      "Amount"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "Transaction Date",
          "role": "date"
        },
        {
          "header": "Value Date",
          "role": "ignore"
        },
        {
          "header": "Transaction Reference No./ Customer Reference Detail/",
          "role": "reference"
        },
        {
          "header": "Description",
          "role": "description"
        },
        {
          "header": "Amount",
          "role": "amount"
        }
      ],
      "amount_mode": "single",
      "default_direction": "credit",
      "number_format": "en",
      "date_order": "dmy",
      "method": "words",
      "bank_name": "Permata"
    }
  },
  {
    "key": "permata_me_pdf",
    "name": "Permata ME Saver - Transaction History (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "f2211c3669d8bfeb1bf69e83060e3585009f9f40039dea10bfc47a0a1770337b",
    "header_columns": [
      "Transaction Date",
      "Transaction Details",
      "Money Out (red)",
      "Money In (green)"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "Transaction Date",
          "role": "date"
        },
        {
          "header": "Transaction Details",
          "role": "description"
        },
        {
          "header": "Money Out (red)",
          "role": "debit"
        },
        {
          "header": "Money In (green)",
          "role": "credit"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "recipe",
      "bank_name": "Permata",
      "recipe": "permata_me"
    }
  },
  {
    "key": "kas_std_xlsx",
    "name": "Petty Cash - Rekapan Pembayaran (Excel)",
    "file_type": "Excel",
    "header_row_index": 5,
    "signature": "908825ef9fb4d264e56d4b10df0df56da41fc731a71d9f05c7ede62634749168",
    "header_columns": [
      "NO",
      "TANGGAL",
      "KETERANGAN",
      "DEBET",
      "CREDIT",
      "SALDO"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "NO",
          "role": "ignore"
        },
        {
          "header": "TANGGAL",
          "role": "date"
        },
        {
          "header": "KETERANGAN",
          "role": "description"
        },
        {
          "header": "DEBET",
          "role": "credit"
        },
        {
          "header": "CREDIT",
          "role": "debit"
        },
        {
          "header": "SALDO",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "table",
      "bank_name": "Kas Kecil"
    }
  },
  {
    "key": "kas_omah_xlsx",
    "name": "Petty Cash - Rekap Omah Soemantri (Excel)",
    "file_type": "Excel",
    "header_row_index": 6,
    "signature": "9de012a76cbe55cd901339577493617628c05d5189328a2485dabf943a2ac26a",
    "header_columns": [
      "NO",
      "TANGGAL",
      "",
      "DEBET",
      "CREDIT",
      "SALDO"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "NO",
          "role": "ignore"
        },
        {
          "header": "TANGGAL",
          "role": "date"
        },
        {
          "header": "",
          "role": "description"
        },
        {
          "header": "DEBET",
          "role": "credit"
        },
        {
          "header": "CREDIT",
          "role": "debit"
        },
        {
          "header": "SALDO",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "table",
      "bank_name": "Kas Kecil"
    }
  },
  {
    "key": "kas_kappu_xlsx",
    "name": "Kas - d'Kappu Soemantri Coffee (Excel)",
    "file_type": "Excel",
    "header_row_index": 4,
    "signature": "91525298a4fd1ad190fbbb454738c38a990af05c30ff3cb8e5099dc9f4f2df69",
    "header_columns": [
      "No",
      "Tanggal",
      "Keterangan",
      "Debet",
      "Kredit",
      "Saldo"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "No",
          "role": "ignore"
        },
        {
          "header": "Tanggal",
          "role": "date"
        },
        {
          "header": "Keterangan",
          "role": "description"
        },
        {
          "header": "Debet",
          "role": "credit"
        },
        {
          "header": "Kredit",
          "role": "debit"
        },
        {
          "header": "Saldo",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "table",
      "bank_name": "Kas Kecil"
    }
  }
]$tpl$::jsonb;
    v_mappings    JSONB := $map$[
  {
    "bank": "BCA",
    "norek": "5855820177",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "000.11002107",
      "120001"
    ],
    "notes": "Bank BCA 201 - Kost Kapu (rek. 585-582-0177)."
  },
  {
    "bank": "BCA",
    "norek": "5855710177",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "000.11002110",
      "120002"
    ],
    "notes": "Bank BCA 5710 - Kafe Kapu Soemantri."
  },
  {
    "bank": "BCA",
    "norek": "5855779177",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "000.11002104",
      "120003"
    ],
    "notes": "Bank BCA 9177."
  },
  {
    "bank": "BCA",
    "norek": "5855600177",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "000.11002106",
      "120004"
    ],
    "notes": "Bank BCA 600 - Kost Warung Soemantri."
  },
  {
    "bank": "BCA",
    "norek": "5265275785",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "000.11002108",
      "120005"
    ],
    "notes": "Bank BCA 5785 (rekening a.n. perorangan -- konfirmasi milik AADL)."
  },
  {
    "bank": "BRI",
    "norek": "040901001771307",
    "keyword": null,
    "tpl": "bri_pdf",
    "akun": [
      "000.11002103",
      "120006"
    ],
    "notes": "Bank BRI 307 (Giro Umum, KC Yogyakarta Mlati)."
  },
  {
    "bank": "BRI",
    "norek": "040901017700302",
    "keyword": null,
    "tpl": "bri_pdf",
    "akun": [
      "000.11002105",
      "120007"
    ],
    "notes": "Bank BRI 302."
  },
  {
    "bank": "Permata",
    "norek": "07027771771",
    "keyword": null,
    "tpl": "permata_syariah_pdf",
    "akun": [
      "000.11002101",
      "120008"
    ],
    "notes": "Bank Permata 1771 (0702-7771-771, Transaction History)."
  },
  {
    "bank": "Permata",
    "norek": "009929951325",
    "keyword": null,
    "tpl": "permata_me_pdf",
    "akun": [
      "000.11002109",
      "120009"
    ],
    "notes": "Bank Permata 1325 (ME Saver 0099-2995-1325; arah dari warna nominal, tanpa saldo)."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "LESTARI WARUNG SOEMANTRI",
    "tpl": "kas_std_xlsx",
    "akun": [
      "005.11001101",
      "110002"
    ],
    "notes": "Petty Cash - Warung Soemantri."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "KOST WARUNG SOEMANTRI",
    "tpl": "kas_std_xlsx",
    "akun": [
      "008.11001101",
      "110002"
    ],
    "notes": "Petty Cash - Kost Warung Soemantri."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "KOST KAPU SOEMANTRI",
    "tpl": "kas_std_xlsx",
    "akun": [
      "009.11001101",
      "110002"
    ],
    "notes": "Petty Cash - Kost Kapu Soemantri."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "PUTU SOEMANTRI",
    "tpl": "kas_std_xlsx",
    "akun": [
      "001.11001101",
      "110002"
    ],
    "notes": "Petty Cash - Putu Soemantri Family Villas."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "OMAH SOEMANTRI",
    "tpl": "kas_omah_xlsx",
    "akun": [
      "003.11001101",
      "110002"
    ],
    "notes": "Petty Cash - Omah Soemantri."
  },
  {
    "bank": "Kas Kecil",
    "norek": null,
    "keyword": "KAPPU SOEMANTRI COFFEE",
    "tpl": "kas_kappu_xlsx",
    "akun": [
      "011.11001101",
      "110002"
    ],
    "notes": "Kas d'Kappu Soemantri Coffee (Cafe Kapu)."
  }
]$map$::jsonb;
BEGIN
    SELECT count(*) INTO v_n FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT AKSHAYA ANANDA DYLAN LESTARI');
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Klien AADL belum ada di management_clients (dicari nama_client IN (''PT AKSHAYA ANANDA DYLAN LESTARI'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    SELECT id, client_code INTO v_client_id, v_client_code FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT AKSHAYA ANANDA DYLAN LESTARI')
    ORDER BY (upper(trim(client_code)) = 'AADL') DESC, created_at
    LIMIT 1;
    IF v_n > 1 AND upper(trim(coalesce(v_client_code, ''))) <> 'AADL' THEN
        RAISE EXCEPTION 'Ada % klien aktif bernama AADL. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.', v_n;
    END IF;

    -- Template format 'Multi' (seed lama branch hendra) tidak dibaca extractor -> buang
    -- (template_id mapping yang menunjuknya otomatis NULL: FK ON DELETE SET NULL).
    DELETE FROM financial_transaction_bank_cash_import_templates
    WHERE client_id = v_client_id AND file_type = 'Multi';

    -- ---------------------------------------------------------
    -- Template ekstraksi (upsert per file_type + signature)
    -- ---------------------------------------------------------
    FOR t IN SELECT * FROM jsonb_array_elements(v_templates) LOOP
        SELECT id INTO v_tid FROM financial_transaction_bank_cash_import_templates
        WHERE client_id = v_client_id AND file_type = t->>'file_type' AND column_signature_hash = t->>'signature';
        IF v_tid IS NULL THEN
            INSERT INTO financial_transaction_bank_cash_import_templates (
                client_id, client_code, template_name, file_type, sheet_name, header_row_index, data_start_row_index,
                column_signature_hash, header_columns, mapping_rules, detected_by, ai_confidence, is_active, usage_count
            ) VALUES (
                v_client_id, coalesce(v_client_code, ''), t->>'name', t->>'file_type', NULL,
                (t->>'header_row_index')::int, (t->>'header_row_index')::int + 1,
                t->>'signature', t->'header_columns', t->'mapping_rules', 'manual', 100.00, true, 0
            ) RETURNING id INTO v_tid;
        ELSE
            UPDATE financial_transaction_bank_cash_import_templates
               SET template_name = t->>'name', header_columns = t->'header_columns', mapping_rules = t->'mapping_rules',
                   header_row_index = (t->>'header_row_index')::int, data_start_row_index = (t->>'header_row_index')::int + 1,
                   detected_by = 'manual', ai_confidence = 100.00, is_active = true,
                   deleted_at = NULL, deleted_by = NULL, edited_at = now()
             WHERE id = v_tid;
        END IF;
        v_tpl_ids := v_tpl_ids || jsonb_build_object(t->>'key', v_tid);
    END LOOP;

    -- ---------------------------------------------------------
    -- Mapping rekening / buku kas -> akun COA
    -- ---------------------------------------------------------
    FOR m IN SELECT * FROM jsonb_array_elements(v_mappings) LOOP
        v_coa := NULL;
        v_coa_kode := NULL;
        FOR v_kode IN SELECT jsonb_array_elements_text(m->'akun') LOOP
            SELECT count(*) INTO v_n FROM management_client_coa
            WHERE client_id = v_client_id AND deleted_at IS NULL AND (acc_no = v_kode OR source_acc_no = v_kode);
            IF v_n = 1 THEN
                SELECT id INTO v_coa FROM management_client_coa
                WHERE client_id = v_client_id AND deleted_at IS NULL AND (acc_no = v_kode OR source_acc_no = v_kode);
                v_coa_kode := v_kode;
                EXIT;
            END IF;
        END LOOP;
        IF v_coa IS NULL THEN
            RAISE NOTICE 'Mapping % % dilewati: tidak ada akun COA % di klien ini.',
                m->>'bank', coalesce(m->>'norek', m->>'keyword'), m->>'akun';
            CONTINUE;
        END IF;

        v_map_id := NULL;
        IF m->>'norek' IS NOT NULL THEN
            SELECT id INTO v_map_id FROM financial_transaction_bank_cash_bank_mappings
            WHERE client_id = v_client_id AND deleted_at IS NULL
              AND ltrim(regexp_replace(coalesce(account_number, ''), '\D', '', 'g'), '0') = ltrim(m->>'norek', '0')
            LIMIT 1;
        ELSE
            SELECT id INTO v_map_id FROM financial_transaction_bank_cash_bank_mappings
            WHERE client_id = v_client_id AND deleted_at IS NULL AND account_number IS NULL
              AND upper(trim(match_keyword)) = upper(m->>'keyword')
            LIMIT 1;
        END IF;

        IF v_map_id IS NULL THEN
            INSERT INTO financial_transaction_bank_cash_bank_mappings (
                client_id, client_code, bank_name, account_number, match_keyword, bank_coa_id, template_id, notes,
                is_active, usage_count
            ) VALUES (
                v_client_id, coalesce(v_client_code, ''), m->>'bank', m->>'norek', m->>'keyword', v_coa,
                (v_tpl_ids->>(m->>'tpl'))::uuid, m->>'notes', true, 0
            );
        ELSE
            UPDATE financial_transaction_bank_cash_bank_mappings
               SET bank_name = m->>'bank', account_number = m->>'norek', match_keyword = m->>'keyword',
                   bank_coa_id = v_coa, template_id = (v_tpl_ids->>(m->>'tpl'))::uuid, notes = m->>'notes',
                   is_active = true, edited_at = now()
             WHERE id = v_map_id;
        END IF;
        RAISE NOTICE 'Mapping % % -> akun %', m->>'bank', coalesce(m->>'norek', m->>'keyword'), v_coa_kode;
    END LOOP;
END
$do$;
