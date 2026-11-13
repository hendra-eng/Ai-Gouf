-- seed_template_nbm_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / buku kas (financial_transaction_bank_cash_import_templates)
-- + mapping rekening/buku kas -> akun COA (financial_transaction_bank_cash_bank_mappings)
-- untuk klien NBM (PT Nawasanga Bertatap Muka).
--
-- FORMAT: 1 baris template PER BENTUK FILE (file_type PDF/Excel/CSV + column_signature_hash), persis
-- yang dibaca modules/transactions/bank_statement_extractor.py (Bank Feed Cash & Bank). Menggantikan
-- seed format 'Multi' (variants + recipe di bank_statement_recipes.py versi branch hendra) yang TIDAK
-- dibaca extractor branch ini; template 'Multi' lama milik klien ini dihapus oleh seed ini.
--
-- Template & signature DIHASILKAN dari ekstraksi file contoh di dataset/Bank Cash/NBM/ (regresi:
-- tests/test_bank_statement_extractor_5_klien.py):
--   key                    tipe   metode  status     baris   file contoh
--   bca_pdf                PDF    words   verified      44   5325107836_AUG_2026.pdf
--   bca_csv                CSV    table   verified     375   NBM_BCA 1350838208_202608.csv
--   bri_pdf                PDF    words   verified      80   NBM__BRI_059001001642303_202606.pdf
--   bri_csv                CSV    table   verified     103   NBM__BRI_059001001642303_202608.csv
--   metode 'recipe' = parser khusus format di modules/transactions/bank_statement_recipes.py
--   (mapping_rules.recipe); header_columns = kolom buatan resep itu.
--
-- MAPPING (akun dicari di management_client_coa klien lewat acc_no ATAU source_acc_no, urut kiri ke kanan:
-- kode COA asli klien (dataset/COA/COA_Clients_GOUF.xlsx) dulu, lalu kode COA template industri sebagai
-- cadangan). Tidak ada yang cocok -> mapping itu DILEWATI (NOTICE), template tetap tersimpan; akun dipilih
-- manual saat upload pertama dan mapping-nya dipelajari otomatis. Urutan cocok saat upload "Auto-detect":
-- nomor rekening > kata kunci judul > template > nama bank.
--   BCA        5325107836                           -> 1-10006                Tahapan Xpresi BCA (PDF).
--   BCA        1350838208                           -> 1-10007                BCA a.n. Nawasanga Bertatap Muka (export KlikBCA Bisnis CSV).
--   BRI        059001001642303                      -> 1-10008                Giro BRI KC Denpasar Ubud (PDF IBBIZ & CSV core banking).
--   BRI        059001001757302                      -> 1-10011                Giro BRI KC Denpasar Ubud, rekening kedua (PDF IBBIZ & CSV core banking).
--
-- Klien dicari lewat nama_client IN ('PT NAWASANGA BERTATAP MUKA', 'NBM'); GAGAL kalau tidak ada,
-- atau kalau ada >1 klien aktif dengan nama itu. client_id / coa id TIDAK di-hardcode.
--
-- BOLEH DIJALANKAN ULANG: template di-upsert per (klien, file_type, signature); mapping di-upsert per
-- nomor rekening (nol di depan diabaikan) / kata kunci -- akun, template, label & catatan ikut diperbarui.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\bank_cash\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_nbm_multi_format_bank_cash.sql
--
-- Hapus total (lalu jalankan ulang):
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT NAWASANGA BERTATAP MUKA', 'NBM');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT NAWASANGA BERTATAP MUKA', 'NBM');

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
    "name": "BCA - Rekening Tahapan (PDF)",
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
    "key": "bca_csv",
    "name": "BCA - KlikBCA Mutasi Rekening (CSV)",
    "file_type": "CSV",
    "header_row_index": 7,
    "signature": "f5ae1a529acbe10941098a4b0fefab521a2d1a806ecf14f1f02d660fa798bfc9",
    "header_columns": [
      "Tanggal Transaksi",
      "Keterangan",
      "Cabang",
      "Jumlah",
      "Saldo"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "Tanggal Transaksi",
          "role": "date"
        },
        {
          "header": "Keterangan",
          "role": "description"
        },
        {
          "header": "Cabang",
          "role": "reference"
        },
        {
          "header": "Jumlah",
          "role": "amount"
        },
        {
          "header": "Saldo",
          "role": "balance"
        }
      ],
      "amount_mode": "single",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "table",
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
    "key": "bri_csv",
    "name": "BRI - Export Mutasi Core Banking (CSV)",
    "file_type": "CSV",
    "header_row_index": 1,
    "signature": "dd357869ce244a4d0db4986bf71dfe6bcfe176cb030de8d26679c8536a9fcfbf",
    "header_columns": [
      "ID",
      "NOREK",
      "TGL_TRAN",
      "TGL_EFEKTIF",
      "JAM_TRAN",
      "SEQ",
      "DESK_TRAN",
      "SALDO_AWAL_MUTASI",
      "MUTASI_DEBET",
      "MUTASI_KREDIT",
      "SALDO_AKHIR_MUTASI",
      "GLSIGN",
      "TRUSER",
      "KODE_TRAN",
      "KODE_TRAN_TELLER",
      "TRREMK",
      "TLBDS1",
      "TLBDS2",
      "REMARK_CUSTOM"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "ID",
          "role": "ignore"
        },
        {
          "header": "NOREK",
          "role": "ignore"
        },
        {
          "header": "TGL_TRAN",
          "role": "date"
        },
        {
          "header": "TGL_EFEKTIF",
          "role": "ignore"
        },
        {
          "header": "JAM_TRAN",
          "role": "ignore"
        },
        {
          "header": "SEQ",
          "role": "reference"
        },
        {
          "header": "DESK_TRAN",
          "role": "description"
        },
        {
          "header": "SALDO_AWAL_MUTASI",
          "role": "balance_before"
        },
        {
          "header": "MUTASI_DEBET",
          "role": "debit"
        },
        {
          "header": "MUTASI_KREDIT",
          "role": "credit"
        },
        {
          "header": "SALDO_AKHIR_MUTASI",
          "role": "balance"
        },
        {
          "header": "GLSIGN",
          "role": "ignore"
        },
        {
          "header": "TRUSER",
          "role": "ignore"
        },
        {
          "header": "KODE_TRAN",
          "role": "ignore"
        },
        {
          "header": "KODE_TRAN_TELLER",
          "role": "ignore"
        },
        {
          "header": "TRREMK",
          "role": "ignore"
        },
        {
          "header": "TLBDS1",
          "role": "ignore"
        },
        {
          "header": "TLBDS2",
          "role": "ignore"
        },
        {
          "header": "REMARK_CUSTOM",
          "role": "reference"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "table",
      "bank_name": "BRI"
    }
  }
]$tpl$::jsonb;
    v_mappings    JSONB := $map$[
  {
    "bank": "BCA",
    "norek": "5325107836",
    "keyword": null,
    "tpl": "bca_pdf",
    "akun": [
      "1-10006"
    ],
    "notes": "Tahapan Xpresi BCA (PDF)."
  },
  {
    "bank": "BCA",
    "norek": "1350838208",
    "keyword": null,
    "tpl": "bca_csv",
    "akun": [
      "1-10007"
    ],
    "notes": "BCA a.n. Nawasanga Bertatap Muka (export KlikBCA Bisnis CSV)."
  },
  {
    "bank": "BRI",
    "norek": "059001001642303",
    "keyword": null,
    "tpl": "bri_pdf",
    "akun": [
      "1-10008"
    ],
    "notes": "Giro BRI KC Denpasar Ubud (PDF IBBIZ & CSV core banking)."
  },
  {
    "bank": "BRI",
    "norek": "059001001757302",
    "keyword": null,
    "tpl": "bri_pdf",
    "akun": [
      "1-10011"
    ],
    "notes": "Giro BRI KC Denpasar Ubud, rekening kedua (PDF IBBIZ & CSV core banking)."
  }
]$map$::jsonb;
BEGIN
    SELECT count(*) INTO v_n FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT NAWASANGA BERTATAP MUKA', 'NBM');
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Klien NBM belum ada di management_clients (dicari nama_client IN (''PT NAWASANGA BERTATAP MUKA'', ''NBM'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    SELECT id, client_code INTO v_client_id, v_client_code FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT NAWASANGA BERTATAP MUKA', 'NBM')
    ORDER BY created_at
    LIMIT 1;
    IF v_n > 1 THEN
        RAISE EXCEPTION 'Ada % klien aktif bernama NBM. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.', v_n;
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
