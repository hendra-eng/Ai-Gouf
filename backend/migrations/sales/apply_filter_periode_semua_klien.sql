-- apply_filter_periode_semua_klien.sql
-- Menyalakan filter periode dari NAMA FILE di template yang SUDAH ADA di database (tanpa seed, tanpa
-- bergantung kode klien). Aman dijalankan ulang.
--   * varian yang sudah punya flag (UBD, BRW, NBM = true) TIDAK diubah
--   * varian lain diberi "jika_ada": nama file memuat tahun+bulan -> hanya transaksi periode itu diambil;
--     tidak memuat -> semua baris diambil seperti biasa
--   * klien AADL dilewati (nama file berisi tanggal "Up Date", bukan bulan transaksi)
-- PENTING: deploy dulu sales_import_v1.py versi baru + restart backend SEBELUM menjalankan ini.
UPDATE financial_transaction_sales_import_templates t
SET mapping_rules = jsonb_set(
        t.mapping_rules, '{variants}',
        (SELECT jsonb_agg(
                    CASE WHEN (v->'mapping_rules') ? 'filter_periode_nama_file' THEN v
                         ELSE jsonb_set(v, '{mapping_rules,filter_periode_nama_file}', '"jika_ada"'::jsonb) END
                    ORDER BY ord)
           FROM jsonb_array_elements(t.mapping_rules->'variants') WITH ORDINALITY AS x(v, ord))),
    edited_at = now()
WHERE t.file_type = 'Multi'
  AND t.deleted_at IS NULL
  AND jsonb_typeof(t.mapping_rules->'variants') = 'array'
  AND upper(coalesce(t.client_code, '')) NOT LIKE 'AADL%'
RETURNING t.client_code,
          (SELECT string_agg(coalesce(v->'mapping_rules'->>'filter_periode_nama_file', '-'), ', ')
             FROM jsonb_array_elements(t.mapping_rules->'variants') AS x(v)) AS flag_per_varian;
