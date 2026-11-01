---
name: cash-bank-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Cash & Bank (Dashboard Gouf Consulting): upload rekening koran di Source Data, Bank Mapping, Reconciliation (match ke invoice Sales/Purchase atau akun bebas), Journal Preview, Approve, Post, Reverse, Exceptions, tab Posted. Wajib dibaca sebelum membuat fitur interaksi suara untuk halaman Cash & Bank."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Alur Halaman Cash & Bank (Transactions > Cash & Bank)

Sumber: `src/app/transactions/bank-cash/*`, `src/lib/bankCashStore.ts`, `backend/modules/transactions/bank_cash_willi.py`, `bank_statement_extractor.py`, `backend/modules/finance/bank_cash_exceptions_v1.py`, dan DB Supabase "database gouf". Prefix endpoint: `/api/v1/transactions/bank-cash`.

## 0. PENTING: file backend mana yang aktif

`main.py` mengimpor `bank_cash_willi.py` sebagai router Cash & Bank (`from modules.transactions import bank_cash_willi as transactions_bank_cash_v1`). Artinya:

- Yang aktif dan lengkap (Source Data, Reconciliation, transaksi, Approve, Post, Reverse, Overview) adalah **`bank_cash_willi.py`**.
- `backend/modules/transactions/bank_cash_v1.py` **tidak terdaftar** di `main.py`. File itu versi "Fase 1" lama, endpoint Fase 2-nya hanya mengembalikan 501 atau daftar kosong. Jangan edit file itu untuk memperbaiki perilaku halaman.
- `finance/bank_reconciliation_v1.py` masih terdaftar di `/api/v1/finance/bank-reconciliation`, tapi halaman memakai endpoint `transactions/bank-cash/mutations/...`, jadi router itu tidak dipakai UI.
- Kalau muncul "Not Found" di Source Data, periksa dulu apakah router `bank_cash_willi` terdaftar dan frontend memakai prefix yang benar.

## 1. Tab dan fungsinya

| Tab | Fungsi |
|---|---|
| Overview | Cash In/Out/Net transaksi posted (tahun terpilih), saldo buku vs saldo rekening koran per akun, pipeline |
| Cash Payment | Invoice **Purchase** posted dan status pembayarannya (sumber: `GET /open-invoices?type=purchase`) |
| Cash Receipt | Invoice **Sales** posted dan status penerimaannya (`type=sales`) |
| Source Data | Upload rekening koran / laporan kas. Mapping bank dan template ekstraksi |
| Reconciliation | Cocokkan mutasi ke invoice atau akun bebas |
| Journal Preview | Antrean transaksi Draft dan Approved, lalu Approve dan Post |
| Exceptions | Item yang perlu ditinjau |
| Posted | Transaksi posted dan yang sudah dibalik (reversed) |

## 2. Langkah pengguna dari awal sampai Posted

1. **Pilih klien** di dropdown "Switch Company" di header. Wajib.
2. **Source Data → Upload** rekening koran (PDF/Excel/CSV) per akun bank. Minimal Supervisor.
   - Mulai dari **preview** (`POST /statements/preview`): backend membaca file tanpa menyimpan (tabel PDF, posisi kata, atau OCR) dan memvalidasi saldo.
   - Template cocok dan lolos validasi saldo: langsung diimport (`POST /statements/upload`).
   - Selain itu muncul **StatementReviewModal** untuk mengecek atau mengoreksi kolom, lalu template ekstraksi disimpan untuk file berikutnya.
   - Akun tujuan default **Auto-detect**: dipilih dari **Bank Mapping** (nomor rekening, judul dokumen, template, nama bank). Kalau pengguna memilih akun manual, mapping baru tercatat untuk rekening itu.
   - Baris yang sudah pernah tersimpan (hash sama) dilewati otomatis. Upload ulang file yang sama aman.
   - Baris dengan confidence rendah ("Needs review") harus dikoreksi lewat **ReviewLineModal** dulu, dan dilewati auto-match sampai direview.
   - Laporan kas tunai (misal Laporan Kas Kasir) masuk ke akun kas, bukan bank.
3. **Reconciliation**: kiri = mutasi bank (status `unmatched`, `matched`, `ignored`), kanan = invoice Purchase posted dan Sales Posted/Partial/Paid.
   - Mutasi **debet (uang keluar)** dicocokkan ke invoice **Purchase**, jadi Cash Payment.
   - Mutasi **kredit (uang masuk)** dicocokkan ke invoice **Sales**, jadi Cash Receipt.
   - **Cocokkan** (`POST /mutations/{id}/match`): ke 1 sampai n invoice. Total alokasi harus sama dengan nominal mutasi, jadi invoice harus punya sisa minimal sebesar itu.
   - **Auto-match** (`POST /mutations/auto-match`): hanya yang kandidat invoicenya pasti. Sisanya tetap unmatched dan muncul di Exceptions.
   - **Mutasi tanpa invoice** (`POST /mutations/{id}/match-account`, form NonInvoiceForm): biaya admin, bunga, pajak bunga, transfer antar bank, setoran modal. Pengguna memilih akun lawan. Baris Bank dibuat otomatis, jurnal harus seimbang.
   - **Ignore** (mutasi bukan transaksi yang dibukukan, bisa di-restore dari Source Data) dan **Unmatch** (batalkan pencocokan, transaksi draft/approved dihapus, mutasi kembali unmatched).
   - Hasil pencocokan: transaksi **DRAFT**.
4. **Journal Preview**: `Draft` → **Approve** (Supervisor ke atas) → `Approved` → **Post** (Manager ke atas) → `Posted`. Draft bisa diedit atau dihapus, Approved bisa dikembalikan ke Draft (`return-to-draft`).
5. **Post**: transaksi masuk buku besar dan laporan keuangan, dan pelunasan invoice diterapkan (`paid_amount` Sales, `payment_status` Purchase). `posting_status` invoice Sales sengaja tidak diubah. Status bayar Sales dibaca dari `paid_amount` dan `outstanding_amount`.
6. **Posted**: daftar posted dan reversed.
   - **Reverse** (`POST /transactions/{id}/reverse`, Manager ke atas): jurnal asal tetap di buku besar, dibuat jurnal pembalik `RV-<no>` di tanggal pembalik (sisi debit dan kredit ditukar), pelunasan invoice dibatalkan, dan mutasi bank kembali `unmatched` supaya bisa dicocokkan ulang.

**Input manual tanpa rekening koran**: `POST /transactions` membuat Cash Receipt atau Cash Payment DRAFT (kas kecil, tunai, atau bank tanpa rekening koran), lalu lanjut Approve dan Post.

## 3. Status

- Mutasi: `unmatched`, `matched`, `ignored`.
- Transaksi: `draft` → `approved` → `posted` → `reversed`.
- Exception: `Open`, `In Review`, `Resolved`.

## 4. Exceptions

- Deteksi dihitung dari Bank Feed, invoice Purchase/Sales, dan pembayaran rekonsiliasi (`lib/cashBankExceptionsStore.ts`). Hanya **status penanganan** yang disimpan di `financial_transaction_bank_cash_exceptions` (lewat `/api/v1/finance/bank-cash/exceptions`).
- Tiap exception punya `source`: **Reconciliation** (soal pencocokan mutasi vs invoice) atau **Classification** (akun lawan atau pajak belum diketahui, hanya untuk transaksi tanpa invoice).

## 5. Tabel DB utama

| Tabel | Isi |
|---|---|
| `financial_transaction_bank_cash_statements` | File rekening koran yang diupload |
| `financial_transaction_bank_cash_mutations` | Baris mutasi (status unmatched/matched/ignored) |
| `financial_transaction_bank_cash_transactions` | Cash Receipt / Cash Payment (draft sampai reversed) |
| `financial_transaction_bank_cash_transaction_lines` | Baris lawan: pelunasan invoice atau akun bebas |
| `financial_transaction_bank_cash_import_templates` | Template ekstraksi rekening koran |
| `financial_transaction_bank_cash_bank_mappings` | Mapping rekening/bank ke akun kas-bank COA |
| `financial_transaction_bank_cash_exceptions` | Status penanganan exception |
| `financial_transaction_bank_cash_payments` | Catatan pembayaran dari rekonsiliasi versi lama. Trigger DB memperbarui sisa tagihan invoice |

## 6. Hal yang harus diketahui AI

- Per 24 Okt 2026: 1 statement, 3 mutasi (semuanya `unmatched`), **0 transaksi** Cash & Bank. Tabel payments berisi 3 baris lama (2 belum diterapkan, 1 sudah). Template ekstraksi 3 dan bank mapping 5 sudah ada.
- Exceptions: 756 Open dan 3 Resolved, jauh lebih banyak dari jumlah mutasi. Kemungkinan besar berasal dari deteksi invoice Purchase/Sales, belum diverifikasi. Jangan menyimpulkan penyebabnya tanpa memeriksa isi tabelnya.
- Karena transaksi masih 0, tab Journal Preview dan Posted kosong. Itu kondisi data, bukan error.
- Satu mutasi hanya boleh dicocokkan sekali. Untuk mencocokkan ulang, Unmatch dulu (atau Reverse kalau sudah posted).
- Selisih kecil (biaya admin, potongan) tidak diselesaikan diam-diam. Biarkan unmatched, atau catat terpisah lewat mutasi tanpa invoice.
- Hanya invoice Purchase yang sudah posted dan invoice Sales yang sudah Posted/Partial/Paid yang muncul di kolom kanan. Invoice Sales yang masih Draft tidak bisa dicocokkan.

## Catatan untuk AI voice (Neo)

- Neo saat ini **hanya membaca**; semua aksi tulis di halaman ini (upload, promote, Approve, Post, Reverse, dst) dipandu lewat langkah di layar, bukan dieksekusi.
- Alat baca yang tersedia: `status_transaksi`, `file_sumber`, `daftar_exceptions` (parameter `halaman`, di `neo_data_tools.py`) (termasuk hitungan mutasi per status), plus `saldo_akun` untuk saldo dari jurnal posted.
- Versi ringkas untuk prompt suara ada di `SUARA.md` (folder ini), dimuat `neo_skills.py` lewat kata kunci. Ubah `SUARA.md` kalau alur halaman berubah.
- Kalau aksi tulis lewat suara ditambahkan nanti: konfirmasi lisan dengan nomor dokumen dan nominal, catat ke activity log, dan jangan massal dalam satu perintah.
