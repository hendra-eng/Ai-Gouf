---
name: purchase-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Purchase (Dashboard Gouf Consulting): upload file di Source Data, Buat Transaksi, Create Bill manual, Approve, Post ke GL, Exceptions, tab Posted. Wajib dibaca sebelum membuat fitur interaksi suara untuk halaman Purchase."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Alur Halaman Purchase (Transactions > Purchase)

Sumber: `src/app/transactions/purchase/*`, `src/lib/purchaseStore.tsx`, `backend/modules/transactions/purchase_v1.py`, `purchase_import_v1.py`, `purchase_bill_v1.py`, `backend/db_client.py`, dan DB Supabase "database gouf". Prefix endpoint: `/api/v1/transactions/purchase`.

## 1. Tab dan fungsinya

| Tab | Fungsi |
|---|---|
| Overview | Ringkasan pembelian dan KPI |
| Source Data | Upload file laporan pembelian (CSV/Excel/PDF), preview, tombol **Buat Transaksi** |
| Purchase Transaction | Daftar transaksi. Tombol **Create Bill**, Approve dan Post massal |
| Purchase Preview | Jurnal satu transaksi sebelum diposting. Approve dan **Post to GL** |
| Exceptions | Transaksi yang perlu ditinjau |
| Posted | Transaksi yang sudah masuk ke buku besar |

## 2. Dua jalur masuk data

**Jalur A, upload file (laporan pembelian dari klien)**

1. Pilih klien di dropdown "Switch Company" di header. Wajib.
2. **Source Data → Upload** (`POST /import/upload`, minimal Supervisor). Backend mencocokkan pola kolom dengan template pembelian milik klien itu.
   - Template cocok: blok transaksi diekstrak ke staging (`source_rows`). Status file `Berhasil` (semua valid) atau `Butuh Review` (ada baris tidak valid).
   - Template tidak cocok: file tersimpan `Butuh Review` dengan 0 baris. Template harus dibuat dulu (contoh: `backend/migrations/purchase/seed_template_sau_multi_format_purchase.sql`).
   - Template cocok tapi ekstraksi error: status `Gagal`.
3. **Source Data → klik file → Buat Transaksi** (`POST /source-files/{id}/promote-to-transactions`). Upload saja belum membuat transaksi. Hanya baris valid yang naik jadi transaksi `draft`. Ringkasan hasil: `transaksi_dibuat`, `dilewati_tidak_valid`, `dilewati_sudah_pernah_dipromosikan`, `dilewati_nomor_bentrok`. Proses ini idempoten, jadi aman diulang.

**Jalur B, input manual (Create Bill)**

- Tombol **Create Bill** di tab Purchase Transaction (`/transactions/purchase/bills/new`, backend `purchase_bill_v1.py`, minimal Supervisor).
- Form menyediakan nomor berikutnya, vendor, COA, dan akun default (`GET /bills/form-options`). Ada cek duplikat vendor + nomor invoice vendor (`GET /bills/check-invoice`).
- Bill hanya bisa diedit selama statusnya `draft`, `pending_review`, `rejected`, atau `exception`.

## 3. Approve dan Post

Alur status: `draft` → (Approve) → `approved` → (Post) → `posted`.

| Aksi | Siapa | Dari status | Syarat |
|---|---|---|---|
| Approve | Supervisor ke atas (level 3) | draft, pending_review, exception | Transaksi harus punya baris item |
| Post | Manager ke atas (level 4) | approved, pending_posting | Baris dan akun lengkap, jurnal balance, semua akun ada di COA klien, dan ada tanggal posting (default = tanggal pembelian) |

- Aksi bisa massal (`POST /transactions/approve` dan `/transactions/post`). Hasilnya `done` dan `skipped` beserta alasan per transaksi.
- Alasan skip yang umum: "Approve the transaction first.", "Transaction has no item lines.", "Posting date is required...", atau jurnal tidak balance.
- Di tab Purchase Transaction, tombol Approve dan Post bekerja pada baris yang dicentang. Di tab Purchase Preview, tombolnya untuk satu transaksi dan nonaktif kalau jurnal tidak balance.
- Setelah Post, transaksi pindah ke tab Posted dan terbaca buku besar dan laporan keuangan.

## 4. Status transaksi

`draft`, `pending_review`, `approved`, `pending_posting`, `posted`, `rejected`, `exception`, `cancelled`.

## 5. Tabel DB utama

| Tabel | Isi |
|---|---|
| `financial_transaction_purchase_source_files` | File upload (status_ekstraksi, rows_detected) |
| `financial_transaction_purchase_source_rows` | Baris staging (`is_valid`, `transaction_id` terisi setelah dipromosikan) |
| `financial_transaction_purchase_transactions` | Transaksi/bill (`status`, `purchase_no`, `purchase_date`, `posting_date`) |
| `financial_transaction_purchase_transaction_lines` | Baris item per transaksi |
| `financial_transaction_purchase_exceptions` | Exceptions |
| `financial_transaction_purchase_import_templates` | Template pola kolom per klien |

Jangan tertukar dengan tabel lama `finance_transaction_purchase_*` (nama "finance", semuanya 0 baris dan bukan yang dipakai halaman ini).

## 6. Hubungan dengan halaman lain

- Bill Purchase yang `posted` menjadi dasar **Accounts Payable** (`/api/v1/finance/payables`) dan muncul di tab **Cash Payment** di Cash & Bank.
- Pembayaran lewat Cash & Bank memperbarui `payment_status` bill, bukan status transaksinya.

## 7. Hal yang harus diketahui AI

- Berbeda dari Sales, Post di Purchase **divalidasi backend** (balance, COA, role). Aman dijadikan jalur suara, tapi tetap minta konfirmasi.
- Posting butuh role Manager ke atas. Kalau pengguna hanya Supervisor, AI harus bilang ia hanya bisa Approve.
- Per 24 Okt 2026: 163 transaksi (159 draft, 1 approved, 3 posted) dengan 546 baris item. Baru 1 file sumber (77 baris, status Berhasil). Tabel exceptions 0 baris.
- Banyak transaksi masih draft. Pertanyaan "kenapa belum masuk Posted" hampir selalu berarti belum di-Approve atau belum di-Post.

## Catatan untuk AI voice (Neo)

- Neo saat ini **hanya membaca**; semua aksi tulis di halaman ini (upload, promote, Approve, Post, Reverse, dst) dipandu lewat langkah di layar, bukan dieksekusi.
- Alat baca yang tersedia: `status_transaksi`, `file_sumber`, `daftar_exceptions` (parameter `halaman`, di `neo_data_tools.py`), plus `ringkasan_pembelian`.
- Versi ringkas untuk prompt suara ada di `SUARA.md` (folder ini), dimuat `neo_skills.py` lewat kata kunci. Ubah `SUARA.md` kalau alur halaman berubah.
- Kalau aksi tulis lewat suara ditambahkan nanti: konfirmasi lisan dengan nomor dokumen dan nominal, catat ke activity log, dan jangan massal dalam satu perintah.
