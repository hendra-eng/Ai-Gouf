---
name: sales-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Sales (Dashboard Gouf Consulting): upload file di Source Data, jadikan invoice, approve, posting jurnal, exceptions, tab Posted. Wajib dibaca sebelum membuat fitur interaksi suara untuk halaman Sales."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Alur Halaman Sales (Transactions > Sales)

Sumber: `src/app/transactions/sales/components/*`, `backend/modules/transactions/sales_v1.py`, `sales_import_v1.py`, dan DB Supabase "database gouf". Semua endpoint berawalan `/api/v1/transactions/sales`.

## 1. Tab dan fungsinya

| Tab | Fungsi |
|---|---|
| Overview | Ringkasan invoice dan KPI (status Posted/Partial/Paid dihitung sebagai "posted") |
| Source Data | Upload file laporan penjualan, preview baris hasil ekstraksi, tombol **Buat Invoice** |
| Sales Transaction | Daftar invoice (Draft sampai Paid). Edit, Approve, Post, Hapus |
| Journal Preview | Cek/ubah akun jurnal, **Approve**, lalu **Post Journal** (jalur 6 tahap) |
| Exceptions | Daftar masalah (Open / In Review / Resolved) |
| Posted | Invoice Posted/Partial/Paid, sisa piutang (Outstanding AR), status bayar |

## 2. Langkah pengguna dari awal sampai Posted

1. **Pilih klien** di dropdown "Switch Company" di header. Wajib. Tanpa ini tombol upload nonaktif.
2. **Source Data → Upload** (`POST /source-files/upload`, minimal level Supervisor, maks 50 MB, format CSV/Excel/PDF).
   Backend mencocokkan pola kolom file dengan template milik klien tersebut (`financial_transaction_sales_import_templates`).
   - Template cocok: baris diekstrak ke `source_rows`. Status file `Berhasil` (semua baris valid) atau `Butuh Review` (ada baris tidak valid).
   - Template tidak cocok: file tersimpan `Butuh Review` dengan 0 baris. Template baru harus dibuat dulu (lihat `SALES_IMPORT_TEMPLATES.md`). PDF harus punya text layer, bukan hasil scan.
   - Template cocok tapi ekstraksi error: status `Gagal`.
3. **Source Data → klik file → File Preview → Buat Invoice** (`POST /source-files/{id}/promote-to-invoices`).
   **Upload saja tidak membuat transaksi.** Hanya baris yang valid, punya nomor invoice, belum pernah dipromosikan, dan nomor invoicenya belum dipakai klien itu yang naik. Hasil: invoice `posting_status = Draft`, `tax_invoice_status = Belum Terbit Faktur`. Mapping akun otomatis dibuat dari akun default klien (COA klien) kalau ada.
   Ringkasan hasil: `invoice_dibuat`, `dilewati_tidak_valid`, `dilewati_sudah_pernah_dipromosikan`, `dilewati_invoice_no_bentrok`.
4. **Sales Transaction**: invoice Draft muncul di sini. Aksi per baris: Detail, Edit, Approve (hanya tampil saat status `Review`), Post (tampil kalau belum Posted), Hapus.
5. **Journal Preview** (jalur resmi):
   - Pilih invoice. Tahapan yang ditampilkan: Source Document, AI Extraction, Accounting Classification, Tax Treatment, Journal, Approve/Post.
   - Cek atau ubah akun Piutang, Pendapatan, PPN, PPh (disimpan lewat `/invoices/{id}/account-mapping`).
   - **Approve** → `posting_status = Approved` (tampil "Siap Posting").
   - **Post Journal** → `posting_status = Posted`, `journal_sync_status = Synced`, `posted_at` dan `posted_by` diisi, dan activity log `JOURNAL_SYNC` dicatat.
6. **Posted**: invoice Posted/Partial/Paid. Pembayaran (dari modul AR / Cash & Bank) mengubah status ke `Partial` lalu `Paid`. Sisa piutang = `outstanding_amount`.
7. **Exceptions**: dipakai untuk menandai masalah. `Open` → `In Review` → `Resolved`.

## 3. Status invoice (`posting_status`)

`Draft` → `Review` → `Approved` → `Posted` → `Partial` → `Paid`

- Tab Journal Preview menyembunyikan invoice `Paid`.
- Label UI Journal Preview: Draft/Review = "Diproses", Approved = "Siap Posting", Posted/Partial/Paid = "Diposting".

## 4. Tabel DB utama

| Tabel | Isi |
|---|---|
| `financial_transaction_sales_source_files` | Satu baris per file upload (status_ekstraksi, status_mapping, rows_detected, total DPP/PPN) |
| `financial_transaction_sales_source_rows` | Baris hasil ekstraksi (`is_valid`, `is_duplicate_candidate`) |
| `financial_transaction_sales_invoices` | Invoice resmi (`posting_status`, `journal_sync_status`, `source_row_id`) |
| `financial_transaction_sales_account_mappings` | Akun jurnal per invoice |
| `financial_transaction_sales_exceptions` | Exceptions |
| `financial_transaction_sales_activity_log` | Riwayat aksi (POSTING, JOURNAL_SYNC, dst) |
| `financial_transaction_sales_import_templates` | Template pola kolom per klien |

Relasi klien: `client_id` mengacu ke `management_clients(id)` (perusahaan yang laporannya diproses), bukan ke akun yang login.

## 5. Hal yang harus diketahui AI (perilaku nyata saat ini)

- **Tombol Post di Sales Transaction** langsung memposting dari Draft, tanpa Approve dan tanpa pengecekan akun di Journal Preview. Jalur yang benar secara kontrol adalah Journal Preview. Jelaskan perbedaan ini ke pengguna, dan untuk aksi suara pilih jalur Journal Preview.
- **Tombol Approve di Sales Transaction** hanya muncul untuk status `Review`. Dari kode yang dibaca tidak ada langkah yang mengisi status `Review`, jadi Approve efektif lewat Journal Preview.
- **Exceptions belum terisi otomatis.** Fungsi `create_sales_exception` ada di `db_client.py`, tapi tidak dipanggil oleh proses upload/promote. Per 24 Okt 2026 tabelnya 0 baris.
- **Satu file bisa diupload dua kali.** Tidak ada blokir file duplikat. Duplikasi baru tertangkap di tahap promote lewat nomor invoice yang bentrok.
- **Banyak baris source belum jadi invoice.** Per 24 Okt 2026: 173 invoice (172 Draft, 1 Partial) dari 33.895 baris source. Hanya 2 file yang sudah dipromosikan (`Detail PCL p (1).pdf` 171 invoice, `Detail PENJ CRS.csv` 2 invoice).
- Pengguna di bawah level Supervisor tidak bisa upload, promote, atau mengubah data Sales.

## 6. Panduan menjawab pengguna

- Pengguna bertanya "kenapa data upload tidak muncul di Sales Transaction": jelaskan bahwa file harus dipromosikan lewat **Buat Invoice**, lalu cek hitungan dilewati (tidak valid / sudah pernah / bentrok).
- Pengguna bertanya "kenapa file Butuh Review dan 0 baris": belum ada template yang cocok untuk klien dan format itu.
- Pengguna bertanya "kenapa belum masuk Posted": invoice masih Draft atau Approved. Arahkan ke Journal Preview → Approve → Post Journal.
- Sebelum menyebut angka (jumlah invoice, total piutang), baca dari DB, jangan menebak.

## 7. Catatan untuk AI voice (Neo)

- Neo **membaca**, dengan satu pengecualian aksi tulis: alat `proses_file_whatsapp` (`neo_wa_pipeline.py`) memproses file Sales yang masuk lewat WhatsApp sampai Posted tanpa konfirmasi tambahan: upload (`upload_source_file`) -> Buat Invoice (`promote_source_file_to_invoices`) -> per invoice `pastikan_mapping_sales` -> `validasi_posting_sales` -> Approved -> Posted + activity log `JOURNAL_SYNC` (performed_by "Neo (nama user)"). Minimal level Supervisor. Invoice yang gagal validasi akun tidak diposting. Berjalan di background; progres lewat alat `status_proses_file`. Matikan dengan `NEO_TULIS_AKTIF=0`.
- Di luar itu Neo tidak bisa Buat Invoice, Approve, atau Post Journal secara terpisah; Neo memandu langkah di layar.
- Alat baca yang tersedia: `status_transaksi`, `file_sumber`, `daftar_exceptions` (parameter `halaman`, di `neo_data_tools.py`), plus `ringkasan_penjualan` dan `umur_piutang`. Activity log belum punya alat baca.
- Versi ringkas untuk prompt suara ada di `SUARA.md` (folder ini), dimuat oleh `neo_skills.py` hanya saat ucapan menyangkut Sales. Ubah `SUARA.md` kalau alur halaman berubah; SKILL.md ini rujukan lengkap untuk manusia dan AI lain.
- Catatan: untuk `proses_file_whatsapp`, pemilik aplikasi memilih mode sepenuhnya otomatis sampai Post tanpa konfirmasi (24 Okt 2026). Posting tercatat di activity log.
