-- seed_template_npi_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / buku kas (financial_transaction_bank_cash_import_templates)
-- + mapping rekening/buku kas -> akun COA (financial_transaction_bank_cash_bank_mappings)
-- untuk klien NPI (PT Nusa Penida Investments).
--
-- FORMAT: 1 baris template PER BENTUK FILE (file_type PDF/Excel/CSV + column_signature_hash), persis
-- yang dibaca modules/transactions/bank_statement_extractor.py (Bank Feed Cash & Bank). Menggantikan
-- seed format 'Multi' (variants + recipe di bank_statement_recipes.py versi branch hendra) yang TIDAK
-- dibaca extractor branch ini; template 'Multi' lama milik klien ini dihapus oleh seed ini.
--
-- Template & signature DIHASILKAN dari ekstraksi file contoh di dataset/Bank Cash/NPI/ (regresi:
-- tests/test_bank_statement_extractor_5_klien.py):
--   key                    tipe   metode  status     baris   file contoh
--   mandiri_pdf            PDF    words   verified     136   NPI_MANDIRI_1450017315108_202608.pdf
--   ocbc_pdf               PDF    grid    verified       6   NPI_OCBC_IDR_163800007094_202608.pdf
--   petty_xlsx             Excel  recipe  verified     310   NPI_Petty_Cash_202609.xlsx
--   metode 'recipe' = parser khusus format di modules/transactions/bank_statement_recipes.py
--   (mapping_rules.recipe); header_columns = kolom buatan resep itu.
--
-- MAPPING (akun dicari di management_client_coa klien lewat acc_no ATAU source_acc_no, urut kiri ke kanan:
-- kode COA asli klien (dataset/COA/COA_Clients_GOUF.xlsx) dulu, lalu kode COA template industri sebagai
-- cadangan). Tidak ada yang cocok -> mapping itu DILEWATI (NOTICE), template tetap tersimpan; akun dipilih
-- manual saat upload pertama dan mapping-nya dipelajari otomatis. Urutan cocok saat upload "Auto-detect":
-- nomor rekening > kata kunci judul > template > nama bank.
--   Mandiri    1750003319273                        -> 1-1103 / 120001        Mandiri Resto #9273 (Kopra).
--   Mandiri    1450017315108                        -> 1-1106 / 120002        Mandiri Shop #5108 (Kopra).
--   Mandiri    1450018412482                        -> 1-1109 / 120003        Mandiri Deli Grocery (482) (Kopra).
--   OCBC       163800007094                         -> 1-1102 / 120004        OCBC IDR #7094.
--   Petty Cash kata kunci 'PETTY CASH'              -> 1-1101 / 110002        Petty cash - Report Expenses (sheet bulan terakhir).
--
-- Klien dicari lewat nama_client IN ('PT NUSA PENIDA INVESTMENTS'); GAGAL kalau tidak ada,
-- atau kalau ada >1 klien aktif dengan nama itu dan tidak satu pun ber-client_code 'NPI'. client_id / coa id TIDAK di-hardcode.
--
-- BOLEH DIJALANKAN ULANG: template di-upsert per (klien, file_type, signature); mapping di-upsert per
-- nomor rekening (nol di depan diabaikan) / kata kunci -- akun, template, label & catatan ikut diperbarui.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\bank_cash\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_npi_multi_format_bank_cash.sql
--
-- Hapus total (lalu jalankan ulang):
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT NUSA PENIDA INVESTMENTS');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT NUSA PENIDA INVESTMENTS');

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
    "key": "mandiri_pdf",
    "name": "Mandiri - Kopra Account Statement (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "ac5ac68033fef29681dc99e1491a97bc2bbe4b66760868de85aea7c4efff1f31",
    "header_columns": [
      "Posting Date",
      "Remark",
      "Reference No.",
      "Debit",
      "Credit",
      "Balance"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "Posting Date",
          "role": "date"
        },
        {
          "header": "Remark",
          "role": "description"
        },
        {
          "header": "Reference No.",
          "role": "reference"
        },
        {
          "header": "Debit",
          "role": "debit"
        },
        {
          "header": "Credit",
          "role": "credit"
        },
        {
          "header": "Balance",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "words",
      "bank_name": "Mandiri"
    }
  },
  {
    "key": "ocbc_pdf",
    "name": "OCBC - Account Statement (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "5fe193b3cdd3feb30bbeb79af4e0ad803ad8f33104f78a411dad9e272ed557f4",
    "header_columns": [
      "Transaction Date",
      "Value Date",
      "Reference No.",
      "Cheque No.",
      "Description",
      "Debit",
      "Credit",
      "Balance"
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
          "header": "Reference No.",
          "role": "reference"
        },
        {
          "header": "Cheque No.",
          "role": "ignore"
        },
        {
          "header": "Description",
          "role": "description"
        },
        {
          "header": "Debit",
          "role": "debit"
        },
        {
          "header": "Credit",
          "role": "credit"
        },
        {
          "header": "Balance",
          "role": "balance"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "grid",
      "bank_name": "OCBC"
    }
  },
  {
    "key": "petty_xlsx",
    "name": "Petty Cash - Report Expenses (Excel)",
    "file_type": "Excel",
    "header_row_index": 1,
    "signature": "8dc36f77d7b6664d81177328136ec0f00cef4d50578c0344c60497324fd3e95b",
    "header_columns": [
      "DATE",
      "NAME PRODUCT",
      "TOTAL",
      "TRANSFER IN"
    ],
    "mapping_rules": {
      "columns": [
        {
          "header": "DATE",
          "role": "date"
        },
        {
          "header": "NAME PRODUCT",
          "role": "description"
        },
        {
          "header": "TOTAL",
          "role": "debit"
        },
        {
          "header": "TRANSFER IN",
          "role": "credit"
        }
      ],
      "amount_mode": "split",
      "default_direction": null,
      "number_format": "en",
      "date_order": "dmy",
      "method": "recipe",
      "bank_name": "Petty Cash",
      "recipe": "petty_expense"
    }
  }
]$tpl$::jsonb;
    v_mappings    JSONB := $map$[
  {
    "bank": "Mandiri",
    "norek": "1750003319273",
    "keyword": null,
    "tpl": "mandiri_pdf",
    "akun": [
      "1-1103",
      "120001"
    ],
    "notes": "Mandiri Resto #9273 (Kopra)."
  },
  {
    "bank": "Mandiri",
    "norek": "1450017315108",
    "keyword": null,
    "tpl": "mandiri_pdf",
    "akun": [
      "1-1106",
      "120002"
    ],
    "notes": "Mandiri Shop #5108 (Kopra)."
  },
  {
    "bank": "Mandiri",
    "norek": "1450018412482",
    "keyword": null,
    "tpl": "mandiri_pdf",
    "akun": [
      "1-1109",
      "120003"
    ],
    "notes": "Mandiri Deli Grocery (482) (Kopra)."
  },
  {
    "bank": "OCBC",
    "norek": "163800007094",
    "keyword": null,
    "tpl": "ocbc_pdf",
    "akun": [
      "1-1102",
      "120004"
    ],
    "notes": "OCBC IDR #7094."
  },
  {
    "bank": "Petty Cash",
    "norek": null,
    "keyword": "PETTY CASH",
    "tpl": "petty_xlsx",
    "akun": [
      "1-1101",
      "110002"
    ],
    "notes": "Petty cash - Report Expenses (sheet bulan terakhir)."
  }
]$map$::jsonb;
BEGIN
    SELECT count(*) INTO v_n FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT NUSA PENIDA INVESTMENTS');
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Klien NPI belum ada di management_clients (dicari nama_client IN (''PT NUSA PENIDA INVESTMENTS'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    SELECT id, client_code INTO v_client_id, v_client_code FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT NUSA PENIDA INVESTMENTS')
    ORDER BY (upper(trim(client_code)) = 'NPI') DESC, created_at
    LIMIT 1;
    IF v_n > 1 AND upper(trim(coalesce(v_client_code, ''))) <> 'NPI' THEN
        RAISE EXCEPTION 'Ada % klien aktif bernama NPI. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.', v_n;
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
