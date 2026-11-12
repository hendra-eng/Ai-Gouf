-- seed_template_ubd_multi_format_bank_cash.sql
-- =============================================================
-- Template ekstraksi rekening koran / buku kas (financial_transaction_bank_cash_import_templates)
-- + mapping rekening/buku kas -> akun COA (financial_transaction_bank_cash_bank_mappings)
-- untuk klien UBD (PT Usher Beyond Design).
--
-- FORMAT: 1 baris template PER BENTUK FILE (file_type PDF/Excel/CSV + column_signature_hash), persis
-- yang dibaca modules/transactions/bank_statement_extractor.py (Bank Feed Cash & Bank). Menggantikan
-- seed format 'Multi' (variants + recipe di bank_statement_recipes.py versi branch hendra) yang TIDAK
-- dibaca extractor branch ini; template 'Multi' lama milik klien ini dihapus oleh seed ini.
--
-- Template & signature DIHASILKAN dari ekstraksi file contoh di dataset/Bank Cash/UBD/ (regresi:
-- tests/test_bank_statement_extractor_5_klien.py):
--   key                    tipe   metode  status     baris   file contoh
--   ocbc_pdf               PDF    grid    verified      42   UBD_OCBC_IDR_165800001092_202607.pdf
--   metode 'recipe' = parser khusus format di modules/transactions/bank_statement_recipes.py
--   (mapping_rules.recipe); header_columns = kolom buatan resep itu.
--
-- MAPPING (akun dicari di management_client_coa klien lewat acc_no ATAU source_acc_no, urut kiri ke kanan:
-- kode COA asli klien (dataset/COA/COA_Clients_GOUF.xlsx) dulu, lalu kode COA template industri sebagai
-- cadangan). Tidak ada yang cocok -> mapping itu DILEWATI (NOTICE), template tetap tersimpan; akun dipilih
-- manual saat upload pertama dan mapping-nya dipelajari otomatis. Urutan cocok saat upload "Auto-detect":
-- nomor rekening > kata kunci judul > template > nama bank.
--   OCBC       165800001092                         -> 1-10002                OCBC UBD 1092 IDR.
--   OCBC       165810049909                         -> 1-10011                OCBC CWU 9909 (IDR).
--
-- Klien dicari lewat nama_client IN ('PT USHER BEYOND DESIGN', 'PT USHERS BEYOND DESIGN'); GAGAL kalau tidak ada,
-- atau kalau ada >1 klien aktif dengan nama itu dan tidak satu pun ber-client_code 'UBD'. client_id / coa id TIDAK di-hardcode.
--
-- BOLEH DIJALANKAN ULANG: template di-upsert per (klien, file_type, signature); mapping di-upsert per
-- nomor rekening (nol di depan diabaikan) / kata kunci -- akun, template, label & catatan ikut diperbarui.
--
-- Cara pakai:
--   cd backend
--   venv\Scripts\python migrations\bank_cash\36-create_bank_cash_import_templates_and_bank_mappings.py   (sekali, kalau belum)
--   venv\Scripts\python migrations\run_seed.py migrations\bank_cash\seed_template_ubd_multi_format_bank_cash.sql
--
-- Hapus total (lalu jalankan ulang):
--   DELETE FROM financial_transaction_bank_cash_bank_mappings m USING management_clients c
--    WHERE m.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT USHER BEYOND DESIGN', 'PT USHERS BEYOND DESIGN');
--   DELETE FROM financial_transaction_bank_cash_import_templates t USING management_clients c
--    WHERE t.client_id = c.id AND upper(trim(c.nama_client)) IN ('PT USHER BEYOND DESIGN', 'PT USHERS BEYOND DESIGN');

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
    "key": "ocbc_pdf",
    "name": "OCBC - Rekening Koran / Statement of Account (PDF)",
    "file_type": "PDF",
    "header_row_index": 1,
    "signature": "f001b1ee249e969a1a7150bbb1ea7ffe6623963339b12cb869c6985cb8fc549d",
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
      "bank_name": "OCBC"
    }
  }
]$tpl$::jsonb;
    v_mappings    JSONB := $map$[
  {
    "bank": "OCBC",
    "norek": "165800001092",
    "keyword": null,
    "tpl": "ocbc_pdf",
    "akun": [
      "1-10002"
    ],
    "notes": "OCBC UBD 1092 IDR."
  },
  {
    "bank": "OCBC",
    "norek": "165810049909",
    "keyword": null,
    "tpl": "ocbc_pdf",
    "akun": [
      "1-10011"
    ],
    "notes": "OCBC CWU 9909 (IDR)."
  }
]$map$::jsonb;
BEGIN
    SELECT count(*) INTO v_n FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT USHER BEYOND DESIGN', 'PT USHERS BEYOND DESIGN');
    IF v_n = 0 THEN
        RAISE EXCEPTION 'Klien UBD belum ada di management_clients (dicari nama_client IN (''PT USHER BEYOND DESIGN'', ''PT USHERS BEYOND DESIGN'')). Buat dulu lewat halaman Clients, lalu jalankan ulang seed ini.';
    END IF;
    SELECT id, client_code INTO v_client_id, v_client_code FROM management_clients
    WHERE deleted_at IS NULL AND upper(trim(nama_client)) IN ('PT USHER BEYOND DESIGN', 'PT USHERS BEYOND DESIGN')
    ORDER BY (upper(trim(client_code)) = 'UBD') DESC, created_at
    LIMIT 1;
    IF v_n > 1 AND upper(trim(coalesce(v_client_code, ''))) <> 'UBD' THEN
        RAISE EXCEPTION 'Ada % klien aktif bernama UBD. Hapus/gabungkan duplikatnya dulu (supaya template tidak menempel ke klien yang salah), lalu jalankan ulang seed ini.', v_n;
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
