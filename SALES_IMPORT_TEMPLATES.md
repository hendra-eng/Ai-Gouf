# Sales Import Templates — Belajar Pola File Laporan Penjualan

Dokumen ini merancang fitur "belajar pola" untuk upload file di tab **Source
Data** (`src/app/transactions/sales/components/SalesSourceData.tsx`): begitu
sistem berhasil memetakan kolom sebuah file laporan penjualan (CSV/Excel) ke
field standar (tanggal, invoice, customer, DPP, PPN, total), pola pemetaan
itu **disimpan sebagai template per klien**, supaya file berikutnya dengan
struktur kolom yang sama langsung diekstrak tanpa perlu "belajar" ulang lewat
AI.

> **Status: DESAIN SKEMA + ALUR SAJA.** DDL sudah ditambahkan ke
> `root/ddl-table`, tapi migration script, endpoint backend, integrasi AI, dan
> perubahan UI upload di `SalesSourceData.tsx` **belum dikerjakan** — itu
> langkah implementasi berikutnya setelah desain ini disetujui (lihat
> [Langkah Implementasi](#langkah-implementasi-belum-dikerjakan) di akhir).

## 1. Kenapa key-nya `management_clients`, bukan `management_users`

6 tabel `financial_transaction_sales_*` yang sudah ada (`source_files`,
`source_rows`, `invoices`, dst) memakai `client_id UUID -> management_users
(id_user)` — itu representasi **akun yang login** (staf internal atau akun
client_lv_N), sesuai keputusan di percakapan sebelumnya.

Template pola kolom itu beda sifatnya: pola sebuah laporan Excel/CSV adalah
properti **perusahaan klien itu sendiri** ("Laporan Penjualan PT Maju
Bersama selalu format Excel begini, kolom G selalu PPN"), bukan properti
akun siapa yang kebetulan login dan mengklik upload. Karena itu:

- `financial_transaction_sales_import_templates.client_id` → **`management_clients(id)`**.
- `financial_transaction_sales_import_templates.client_code` → salinan
  (denormalized) `management_clients.client_code` saat template dibuat,
  dipakai sebagai key pencarian tambahan tanpa join (dan tetap valid kalau
  `client_code` di `management_clients` diedit belakangan).
- Tabel `financial_transaction_sales_source_files` mendapat kolom baru
  **`management_client_id UUID NOT NULL -> management_clients(id)`** —
  wajib diisi user lewat dropdown "Pilih Klien" saat upload. Ini terpisah
  dari `client_id` (management_users) yang sudah ada di tabel itu.

Akibatnya, satu file upload sekarang punya 2 relasi klien yang beda makna:

| Kolom | Reference | Makna |
|---|---|---|
| `source_files.client_id` | `management_users(id_user)` | Akun yang login & melakukan upload |
| `source_files.management_client_id` | `management_clients(id)` | Perusahaan yang laporan penjualannya sedang diproses |

## 2. Skema tabel

### 2.1 Tabel baru: `financial_transaction_sales_import_templates`

Lihat definisi lengkap di `root/ddl-table` (bagian "FITUR SALES > IMPORT
TEMPLATE", ditaruh sebelum bagian "FITUR TRANSACTIONS > SALES" karena
`source_files.template_id` mereferensikannya). Ringkasan kolom:

| Kolom | Tipe | Keterangan |
|---|---|---|
| `id` | UUID PK | |
| `client_id` | UUID → `management_clients(id)` | Klien pemilik pola ini |
| `client_code` | VARCHAR(50) | Salinan `management_clients.client_code` — key pencarian tambahan |
| `file_type` | VARCHAR(20) | Excel/CSV/PDF/TXT — pola kolom beda per format |
| `sheet_name` | VARCHAR(255) | Khusus Excel: nama sheet tempat tabel data ditemukan |
| `header_row_index` | INTEGER | Baris ke-berapa (1-based) berisi header — sebagian laporan punya baris judul/logo di atasnya |
| `data_start_row_index` | INTEGER | Baris ke-berapa data mulai |
| `column_signature_hash` | CHAR(64) | SHA-256 dari header yang dinormalisasi — kunci pencocokan cepat tanpa AI |
| `header_columns` | JSONB | Nama kolom asli apa adanya (array), buat audit/tampilan |
| `mapping_rules` | JSONB | `{field_key: nama_kolom_sumber}` — sama bentuknya dengan `source_files.mapping_rules` |
| `detected_by` | VARCHAR(20) | `ai` / `manual` |
| `ai_model_version`, `ai_confidence` | | Jejak model & confidence saat pertama belajar |
| `is_active` | BOOLEAN | Nonaktifkan template yang ternyata salah tanpa menghapus riwayat |
| `usage_count`, `last_used_at` | | Berapa kali & kapan terakhir dipakai ulang |
| `created_at/by`, `edited_at/by`, `deleted_at/by` | | Audit standar, pola sama seperti tabel Sales lain |

Constraint kunci: **`UNIQUE (client_id, file_type, column_signature_hash)`**
— satu klien bisa punya banyak template (format Excel A, format CSV B, dst),
tapi kombinasi klien+format+pola-kolom yang identik hanya boleh satu baris.

### 2.2 Perubahan tabel existing

`financial_transaction_sales_source_files` mendapat 2 kolom baru:

- `management_client_id UUID NOT NULL REFERENCES management_clients(id)` (lihat §1)
- `template_id UUID REFERENCES financial_transaction_sales_import_templates(id)`
  — template yang cocok/dipakai untuk file ini. `NULL` kalau: (a) file ini
  yang PERTAMA KALI membentuk template baru (template baru dibuat *setelah*
  ekstraksi berhasil, jadi ada jeda), atau (b) file jenis ini (PDF, lihat §5)
  belum didukung pembelajaran pola sama sekali.

Tidak ada perubahan pada `source_rows` maupun `invoices` — keterkaitan ke
`management_client_id` tetap bisa ditelusuri lewat
`source_rows.source_file_id → source_files.management_client_id` kalau
suatu saat dibutuhkan untuk laporan (belum didenormalisasi turun ke situ
supaya tidak menambah kolom yang belum tentu dipakai).

## 3. Alur end-to-end

```
1. User buka tab Source Data → pilih Klien (dropdown management_clients,
   WAJIB) → klik Upload File → pilih 1+ file (CSV/Excel; PDF tetap bisa
   diupload tapi lihat batasan di §5).

2. Untuk SETIAP file:

   a. Baca file, tentukan lokasi header:
      - CSV: default header_row_index=1, data_start_row_index=2.
      - Excel: heuristik cari baris dengan sel non-kosong terbanyak yang
        diikuti ≥2 baris "mirip data" (ada tanggal/angka) di bawahnya —
        supaya baris judul/logo di atas header tidak ikut terbaca sebagai
        header.

   b. Normalisasi header (trim, collapse spasi, lowercase), gabung dengan
      delimiter "|", hitung SHA-256 → column_signature_hash.

   c. Cari template:
      SELECT * FROM financial_transaction_sales_import_templates
      WHERE client_id = :management_client_id
        AND file_type = :file_type
        AND column_signature_hash = :hash
        AND is_active = true

      - KETEMU  → pola SUDAH dikenal. Pakai mapping_rules & (untuk Excel)
        sheet_name/header_row_index/data_start_row_index dari template ini
        LANGSUNG, TIDAK panggil AI. Naikkan usage_count +1, set
        last_used_at = now(), set source_files.template_id = template.id.
      - TIDAK KETEMU → lanjut ke langkah (d), pola ini belum pernah dilihat
        untuk klien & format ini.

   d. (Hanya kalau tidak ketemu template) Ambil header + beberapa baris
      contoh (mis. 5-10 baris pertama setelah header), kirim ke AI
      (DeepSeek, provider yang sama dipakai `backend/akuntansi_ai.py` untuk
      klasifikasi akun) dengan instruksi: petakan tiap kolom ke salah satu
      field kanonis (tanggal/invoice/customer/dpp/ppn/total) atau
      "tidak_relevan", beserta confidence 0-100.

      - confidence ≥ 70  → simpan HASIL AI sebagai template baru
        (detected_by='ai', is_active=true) supaya file berikutnya dari
        klien+format yang sama langsung lewat jalur (c). Lanjut ekstraksi
        dengan mapping ini.
      - confidence < 70  → JANGAN simpan sebagai template (mencegah
        template buruk "meracuni" pencocokan berikutnya). File ditandai
        status_ekstraksi='Butuh Review', mapping_rules diisi hasil AI
        sebagai SARAN saja. User mengoreksi lewat modal "Mapping Rules"
        (sudah ada, lihat SalesSourceData.tsx) → begitu user simpan manual,
        BARU dibuat baris template baru dengan detected_by='manual'.

   e. Ekstraksi baris: pakai mapping_rules (dari template atau hasil
      manual) untuk memetakan tiap baris data mentah → 1 baris
      financial_transaction_sales_source_rows (lihat §4 utk detail kolom).
      Validasi per baris (tanggal bisa diparse, angka valid, dst) →
      is_valid + validation_notes. Deteksi duplikat (lihat §4.2) →
      is_duplicate_candidate.

   f. Update agregat di source_files (rows_detected, rows_valid,
      rows_invalid, duplicate_count, dpp_total, ppn_total, grand_total,
      status_ekstraksi, status_mapping, confidence_score, ai_model_version,
      extraction_duration_ms, mapping_rules, template_id).

3. (Opsional, terpisah dari proses upload) User meninjau source_rows di
   panel "File Preview", lalu memutuskan baris mana yang di-"naik"-kan jadi
   financial_transaction_sales_invoices resmi (lihat §4.1) — TIDAK otomatis
   sekali klik, supaya baris yang is_valid=false atau duplikat tidak
   langsung ikut ke sisi akuntansi tanpa direview.
```

## 4. Pemetaan kolom (field kanonis → kolom tabel)

### 4.1 `source_rows` → (opsional, saat "Buat Invoice") → `invoices`

| Field kanonis (`mapping_rules` key) | `source_rows` | `invoices` (saat dipromosikan) |
|---|---|---|
| `tanggal` | `tanggal` (DATE) | `invoice_date` |
| `invoice` | `no_invoice` (VARCHAR) | `invoice_no` |
| `customer` | `nama_customer` (VARCHAR) | `customer_name` |
| `dpp` | `dpp` (NUMERIC) | `dpp` |
| `ppn` | `ppn` (NUMERIC) | `ppn` |
| `total` | `total` (NUMERIC) | `gross_amount` |
| — | `row_no`, `source_file_id`, `client_id` | `source_row_id` (FK balik ke baris asalnya) |
| — | — | `pph` = 0 (default, tidak ada di file sumber — field kanonis baru bisa ditambah kalau ada laporan yang memuat PPh) |
| — | — | `posting_status` = `'Draft'`, `tax_invoice_status` = `'Belum Terbit Faktur'` (default, sama seperti input manual) |
| — | — | `client_id` = akun yang login (BUKAN `management_client_id` — tetap ikut keputusan awal, lihat catatan di `salesStore.tsx`) |

### 4.2 Deteksi duplikat (`is_duplicate_candidate`)

Satu baris ditandai duplikat kalau `(no_invoice, total)`-nya cocok dengan:

1. Baris lain di **batch file yang sama** (duplikat internal file), ATAU
2. Baris `source_rows`/`invoices` yang **sudah ada** untuk
   `management_client_id` yang sama sebelumnya (duplikat lintas upload).

Baris duplikat TETAP disimpan (bukan ditolak) dengan flag menyala, supaya
user yang memutuskan — konsisten dengan makna `is_duplicate_candidate` yang
sudah ada di DDL.

## 5. Batasan fase ini

- **PDF belum didukung pembelajaran pola.** Laporan PDF umumnya bukan tabel
  bersih (butuh deteksi layout/OCR dulu sebelum kolom bisa "dipelajari"),
  scope-nya jauh lebih besar dari CSV/Excel. File PDF tetap bisa diupload &
  tercatat di `source_files` (seperti sekarang), tapi `template_id` selalu
  NULL dan `status_ekstraksi` langsung `'Butuh Review'` — tidak ada usaha
  ekstraksi otomatis untuk PDF di fase ini.
- Pencocokan template murni **exact-match** pada signature hash. Kalau
  klien mengganti SATU nama kolom saja di laporan berikutnya (mis. "No.
  Invoice" → "Nomor Faktur"), signature-nya berubah dan sistem akan
  menganggap itu pola baru (lewat AI lagi) — bukan fuzzy-match ke template
  lama. Fuzzy-matching bisa jadi peningkatan lanjutan kalau pola ini
  ternyata sering terjadi di praktiknya.
- Satu klien+format bisa punya banyak template aktif sekaligus (mis. kalau
  klien memang punya 2 sistem sumber data yang formatnya beda) — sistem
  TIDAK membatasi jumlah, tinggal signature-nya beda.

## Langkah Implementasi (belum dikerjakan)

1. Migration script (`backend/migrations/create_sales_import_templates.py`)
   — buat tabel baru + `ALTER TABLE ... ADD COLUMN management_client_id,
   template_id` ke `source_files` (tabelnya masih kosong di database saat
   ini, jadi `NOT NULL` aman ditambahkan langsung).
2. ORM model + CRUD di `db_client.py` (pola sama seperti 6 tabel Sales
   lain).
3. Endpoint backend: deteksi header, hitung signature, cari/buat template,
   panggil AI (reuse provider di `akuntansi_ai.py`), ekstraksi baris —
   kemungkinan modul baru `backend/modules/transactions/sales_import_v1.py`.
4. Frontend: dropdown "Pilih Klien" (wajib) di action bar upload
   `SalesSourceData.tsx`, ambil daftar dari `GET /api/v1/management/clients`
   yang sudah ada.
