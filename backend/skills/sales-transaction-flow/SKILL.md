---
name: sales-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Sales (Dashboard Gouf Consulting): upload file di Source Data, Buat Invoice, approve, posting jurnal, exceptions, tab Posted, serta arti SEMUA tombol dan komponen di enam tab. Berisi jalur cepat upload sampai Posted (versi 2, 6 Nov 2026). Wajib dibaca sebelum membuat fitur interaksi suara atau agen untuk halaman Sales."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Halaman Sales (Transactions > Sales) — Versi 2

Sumber: `src/app/transactions/sales/components/*`, `backend/modules/transactions/sales_v1.py`, `sales_import_v1.py`, `db_client.py`, `neo_wa_pipeline.py`, dan DB Supabase "database gouf". Semua endpoint berawalan `/api/v1/transactions/sales`.

## 0. Ringkasan satu menit

- Tujuan halaman: mengubah file laporan penjualan (CSV / Excel / PDF) menjadi invoice, lalu memposting jurnalnya ke buku besar.
- Jalur utama (file sampai Posted) hanya 4 tombol inti: **pilih klien → Upload File → Buat Invoice → Approve → Post Journal**. Tombol lain di halaman ini bersifat bantu (lihat, ubah, cetak, hapus, tinjau masalah).
- **Upload saja tidak membuat transaksi.** Transaksi baru ada setelah Buat Invoice, dan baru masuk laporan keuangan setelah Posted.
- Dengan alat `proses_file_whatsapp`, keempat langkah itu dijalankan otomatis dan MASSAL (lihat bagian 6). Pengguna cukup bilang file mana dan klien siapa.

## 1. Enam tab dan fungsinya

| Tab | Fungsi | Termasuk jalur upload → Posted? |
|---|---|---|
| Overview | Ringkasan KPI dan grafik penjualan (hanya baca) | Tidak |
| Source Data | Upload file, lihat hasil ekstraksi, tombol **Buat Invoice** | **Ya** (langkah 1 dan 2) |
| Sales Transaction | Daftar invoice Draft sampai Paid; edit, hapus, cetak | Hanya sebagai tempat melihat hasil; tombol Post di sini adalah jalan pintas |
| Journal Preview | Cek akun jurnal, **Approve**, **Post Journal** | **Ya** (langkah 3 dan 4, jalur resmi) |
| Exceptions | Daftar masalah yang perlu ditinjau | Tidak (tinjauan) |
| Posted | Invoice yang sudah Posted/Partial/Paid, sisa piutang | Tidak (hasil akhir) |

## 2. Jalur dari upload sampai Posted (urut)

1. **Pilih klien** di dropdown "Switch Company" di header. Wajib. Tanpa klien aktif tombol Upload File nonaktif.
2. **Source Data → Upload File** (`POST /source-files/upload`, minimal Supervisor, maks 50 MB, `.xlsx .xls .csv .pdf .txt`, boleh banyak file sekaligus). Backend mencocokkan pola kolom file dengan template milik klien (`financial_transaction_sales_import_templates`).
   - Cocok: baris masuk `source_rows`. Status file `Berhasil` (semua valid) atau `Butuh Review` (ada baris tidak valid).
   - Tidak cocok: file tersimpan `Butuh Review` dengan 0 baris. Template baru harus dibuat dulu (`SALES_IMPORT_TEMPLATES.md`). PDF harus punya text layer, bukan hasil scan.
   - Cocok tapi ekstraksi error: `Gagal`.
3. **Source Data → klik file → File Preview → Buat Invoice** (`POST /source-files/{id}/promote-to-invoices`). Hanya baris yang valid, punya nomor invoice dan tanggal, belum pernah naik, dan nomornya belum dipakai klien itu yang jadi invoice `Draft` (`tax_invoice_status = Belum Terbit Faktur`). Akun jurnal otomatis dibuat dari akun default klien kalau ada. Ringkasan: `invoice_dibuat`, `dilewati_tidak_valid`, `dilewati_sudah_pernah_dipromosikan`, `dilewati_invoice_no_bentrok`.
4. **Journal Preview → Approve** → status `Approved` (label "Siap Posting"). Akun piutang, pendapatan, PPN, PPh bisa dicek/diubah lewat Edit Mapping sebelum Approve.
5. **Journal Preview → Post Journal** → `posting_status = Posted`, `journal_sync_status = Synced`, `posted_at` dan `posted_by` terisi, activity log `JOURNAL_SYNC`. Sejak titik ini invoice terbaca GL dan Financial Statements.
6. Pembayaran dari AR atau Cash & Bank mengubah status ke `Partial` lalu `Paid`.

Status invoice: `Draft` → `Review` → `Approved` → `Posted` → `Partial` → `Paid`.

## 3. Kamus tombol dan komponen (semua tab)

### Header (semua tab)
- **Switch Company**: memilih klien aktif. Semua data dan upload mengikuti klien ini.
- **Tombol rentang tanggal** (mis. "01 Jan 2024 – 31 Dec 2024"): hanya tampilan, belum memfilter data.
- **Tambah Transaksi** (hanya di tab Sales Transaction): membuka form membuat SATU invoice secara manual (`/transactions/sales/invoice/new`). Bukan bagian jalur upload file.
- **Tab Exceptions punya badge angka**: jumlah exception yang belum Resolved.

### Tab Overview (hanya baca)
Kartu KPI: Total Sales, Number of Transactions, Average per Transaction, Not Posted, Reconciliation (%), Total Tax Base (DPP), VAT Output, Total Withholding Tax (PPh), Paid, Accounts Receivable, Overdue Invoices. Ada grafik (tarik untuk zoom, klik dua kali untuk reset) dan tabel invoice dengan tombol halaman sebelumnya/berikutnya. Tidak ada tombol aksi tulis.

### Tab Source Data
- **Upload File**: memilih satu atau banyak file lalu mengunggah dan mengekstrak. Nonaktif tanpa klien. Hasil: toast "File berhasil diekstrak (n baris)" atau "Belum ada template yang cocok".
- **Template Excel**: mengunduh contoh Excel kosong 6 kolom (Date, Invoice No., Customer Name, Tax Base, VAT, Total). Hanya contoh format, tidak mengubah data.
- **Export**: mengunduh daftar file Source Data (nama, tipe, jumlah baris, status ekstraksi dan mapping, confidence) ke Excel.
- **Mapping Rules**: membuka modal pemetaan kolom sumber ke field sistem untuk file yang dipilih, lalu Simpan. Tidak bisa untuk format kompleks (`grouped_invoice_report`); untuk itu tampil pesan bahwa template terdeteksi otomatis.
- **Tabel file**: klik satu baris file untuk membuka File Preview. Kolom: tanggal upload, nama, tipe, baris terdeteksi, status ekstraksi, status mapping, confidence, diproses oleh.
- **Menu ⋯ per file → Hapus file**: menghapus file dari Source Data (ada konfirmasi). **Invoice yang sudah dibuat dari file itu TIDAK ikut terhapus.**
- **File Preview** (panel bawah): daftar baris hasil ekstraksi dengan halaman sebelumnya/berikutnya.
- **Buat Invoice** (di File Preview, muncul kalau ada baris): inilah langkah yang mengubah baris hasil ekstraksi menjadi invoice Draft. **Ya, ini bagian wajib dari jalur upload sampai Posted**, dan tanpa tombol ini tab Sales Transaction tetap kosong.

### Tab Sales Transaction
- **Kartu KPI**: Draft, Ready for Approval, Posted, Outstanding AR (jumlah dan nilai Rp).
- **Filter**: Date Period, All Customers, All Branches, All Statuses (Tax), All Statuses (Posting), All Projects, kotak cari (no. invoice, pelanggan, deskripsi), **Reset** (hapus semua filter).
- **Print All**: cetak/ekspor daftar sesuai filter (CSV, Excel, PDF), bukan hanya halaman aktif.
- **Ikon ⚙**: memilih kolom yang tampil (PPh, Due Date, Journal).
- **Kotak centang per baris dan kotak centang header**: hanya MENANDAI baris (header = tandai satu halaman). **Saat ini tidak ada aksi massal di layar yang memakai tanda ini.** Jangan menyuruh pengguna mencentang satu per satu untuk membuat Draft atau Approve; untuk jumlah banyak pakai jalur massal (bagian 6).
- **Klik baris**: membuka panel detail (tab Detail dan lainnya), tombol **Edit** (ubah pelanggan, cabang, deskripsi, DPP, project, jatuh tempo; Simpan/Batal) dan **Print**. PERHATIAN: Simpan menghitung ulang PPN 11% dan PPh 1% dari DPP, jadi nilai PPN/PPh sebelumnya ditimpa.
- **Menu ⋯ per baris**: Lihat Detail, Edit, **Approve** (muncul hanya untuk status `Review`; status ini praktis tidak pernah terisi, jadi tombol ini hampir tidak tampil), **Post** (muncul kalau belum Posted; memposting langsung dari Draft tanpa Approve dan tanpa cek akun, event log `POSTING`), **Hapus** (menghapus invoice).
- Tombol halaman sebelumnya/berikutnya dan ukuran halaman.

### Tab Journal Preview (jalur resmi, satu invoice per kali)
- **Daftar Invoice Penjualan** (kiri) + kotak cari + halaman. Klik invoice untuk melihat pratinjau jurnalnya. Invoice `Paid` disembunyikan.
- Lima bagian pratinjau: 1 Source Document (tombol **Lihat Dokumen** membuka pratinjau dokumen), 2 AI Extraction, 3 Accounting Classification (akun piutang, pendapatan, PPN, PPh), 4 Tax Treatment (info PPN 11% dan DPP), 5 Journal Entry (tabel debit dan kredit, harus seimbang).
- **Edit Mapping**: membuka pilihan akun dari COA klien; **Simpan** menyimpan ke `/invoices/{id}/account-mapping`, **Batal** menutup. Nonaktif kalau sudah Posted.
- **Approve**: aktif hanya saat label "Diproses". Menyimpan mapping yang tampil (kalau belum tersimpan) lalu status jadi `Approved` ("Siap Posting").
- **Post Journal**: aktif hanya saat "Siap Posting". Mengubah ke `Posted`, `Synced`, mencatat log `JOURNAL_SYNC`.

### Tab Exceptions (tinjauan masalah)
- Filter, kotak cari, **Reset**, kotak centang (hanya penanda). Kolom: ID, jenis, prioritas, status, ditugaskan ke.
- **Menu ⋯ / panel detail**: Lihat Detail, **Edit** (ubah jenis, "assign ke saya", status; Simpan/Batal), **Accept Suggestion** (status Open → In Review), **Resolve** (tandai selesai), **Lihat File Asli** (saat ini belum tersedia).
- Status: `Open` → `In Review` → `Resolved`. Tidak terisi otomatis oleh proses upload, jadi kosong bukan berarti data bersih.

### Tab Posted (hasil akhir)
- Filter, **Reset**, kotak centang untuk memilih baris, menu **Export**: semua data sesuai filter (CSV), data terpilih, atau **Cetak**.
- Per baris: **Lihat** (detail), menu ⋯: Lihat Detail, **Salin No. Jurnal**, **Buka di General Ledger** dan **Unduh Bukti/PDF** (keduanya saat ini baru menampilkan info "belum tersedia").
- **Aksi Cepat**: Lihat Jurnal, Buka di General Ledger, Export ke Excel, Rekonsiliasi AR, Cetak Daftar.
- Menampilkan sisa piutang (`outstanding_amount`) dan status bayar.

## 4. Tabel DB utama

| Tabel | Isi |
|---|---|
| `financial_transaction_sales_source_files` | Satu baris per file upload (status_ekstraksi, status_mapping, rows_detected, total DPP/PPN) |
| `financial_transaction_sales_source_rows` | Baris hasil ekstraksi (`is_valid`, `is_duplicate_candidate`) |
| `financial_transaction_sales_invoices` | Invoice resmi (`posting_status`, `journal_sync_status`, `source_row_id`); unik per (client_id, invoice_no) |
| `financial_transaction_sales_account_mappings` | Akun jurnal per invoice (1:1) |
| `financial_transaction_sales_exceptions` | Exceptions |
| `financial_transaction_sales_activity_log` | Riwayat aksi (POSTING, JOURNAL_SYNC, dst) |
| `financial_transaction_sales_import_templates` | Template pola kolom per klien |

`client_id` mengacu ke `management_clients(id)` (perusahaan yang laporannya diproses), bukan akun yang login. `posted_by` mengacu ke id USER yang login.

## 5. Perilaku nyata yang harus diketahui AI

- Tombol Post di Sales Transaction melompati Approve dan cek akun. Jalur yang benar secara kontrol adalah Journal Preview. Jelaskan perbedaannya; untuk aksi otomatis pakai jalur dengan validasi akun.
- Exceptions belum terisi otomatis (`create_sales_exception` tidak dipanggil proses upload/promote).
- Satu file bisa diupload dua kali. Duplikasi baru tertangkap saat Buat Invoice lewat nomor invoice yang bentrok.
- Banyak baris Source Data belum jadi invoice sebelum Buat Invoice ditekan. Itu normal.
- Pengguna di bawah level Supervisor tidak bisa upload, Buat Invoice, atau mengubah data Sales.
- Sebelum menyebut angka (jumlah invoice, total piutang), baca dari DB atau alat data, jangan menebak.

## 6. Jalur cepat otomatis (`proses_file_whatsapp`, halaman sales)

Alat ini menjalankan 4 tahap berurutan di latar belakang: **Upload → Buat Invoice → Validasi akun → Approve + Post**. Pengguna tidak perlu mencentang apa pun.

Kenapa dulu lambat: upload sudah massal, tetapi Buat Invoice dan posting memproses satu invoice per kali (sekitar 8 sampai 10 query database per invoice, termasuk memuat seluruh COA klien berulang). File 1.000 invoice bisa makan puluhan menit.

Perbaikan 6 Nov 2026:
- **Buat Invoice massal** (`dbc.promote_sales_rows_bulk`): satu kali baca baris, satu kali baca invoice yang sudah ada, lalu INSERT multi-baris per 500 invoice beserta mapping akunnya. Aturan dilewati sama persis dengan versi lama. Tombol **Buat Invoice** di layar ikut menjadi cepat karena memakai fungsi yang sama.
- **Approve + Post massal** (`_posting_cepat` di `neo_wa_pipeline.py`): mapping akun, validasi COA (dihitung di memori, aturan sama dengan `validasi_posting_sales`), satu UPDATE status Posted dan satu INSERT activity log `JOURNAL_SYNC` per 500 invoice. Hasil akhirnya sama dengan Approve lalu Post di Journal Preview.
- **Pengaman**: invoice yang akunnya tidak ada di COA klien TIDAK diposting dan dilaporkan alasannya. Potongan yang gagal massal otomatis diulang per invoice lewat jalur lama.
- **Perbaikan bug**: jalur lama mengisi `posted_by` dengan id klien (bukan id user), yang bisa membuat posting gagal.

Yang masih makan waktu dan tidak bisa dipercepat dengan SQL: ekstraksi PDF dan pencocokan template pada tahap upload.

Cara memakai (untuk agen): pastikan kode klien dan nama file jelas, panggil `proses_file_whatsapp` dengan `halaman = sales`, katakan singkat bahwa proses dimulai (JANGAN bilang selesai), lalu cek `status_proses_file` saat pengguna bertanya. Status akhir: `selesai`, `selesai_sebagian` (ada invoice tidak diposting, sebutkan 3 alasan teratas), `perlu_template`, atau `gagal`.

## 7. Panduan menjawab pengguna

- "Kenapa data upload tidak muncul di Sales Transaction": belum menekan **Buat Invoice**, atau barisnya dilewati (tidak valid, sudah pernah dibuat, nomor bentrok).
- "Kenapa file Butuh Review dan 0 baris": belum ada template yang cocok untuk klien dan format itu.
- "Kenapa belum masuk Posted": invoice masih Draft atau Approved. Arahkan ke Journal Preview → Approve → Post Journal, atau minta agen memprosesnya otomatis.
- "Apa gunanya tombol X": jelaskan fungsinya dari bagian 3 dan katakan apakah tombol itu bagian jalur upload sampai Posted (hanya Upload File, Buat Invoice, Approve, Post Journal).
- "Kenapa mencentang tidak melakukan apa-apa": kotak centang di layar hanya penanda; aksi massal dilakukan agen lewat jalur cepat.

## 8. Catatan untuk AI voice dan agen (Neo, Atlas, Zeno)

- Satu-satunya aksi tulis: `proses_file_whatsapp` (`neo_wa_pipeline.py`), memproses file Sales yang masuk lewat WhatsApp sampai Posted tanpa konfirmasi tambahan (pilihan pemilik aplikasi, 24 Okt 2026). Posting tercatat di activity log dengan `performed_by` "Neo (nama user)". Minimal level Supervisor. Matikan dengan `NEO_TULIS_AKTIF=0`. Lewat pintu Hermes (`/api/hermes`), alat tulis aktif hanya jika `HERMES_TULIS_AKTIF=1`.
- Di luar itu agen tidak bisa menekan Buat Invoice, Approve, atau Post secara terpisah; agen memandu langkah di layar.
- Alat baca: `status_transaksi`, `file_sumber`, `daftar_exceptions` (parameter `halaman`), `ringkasan_penjualan`, `umur_piutang`. Activity log belum punya alat baca.
- Versi ringkas untuk prompt suara ada di `SUARA.md`, dimuat oleh `neo_skills.py` hanya saat ucapan menyangkut Sales. Ubah `SUARA.md` kalau alur halaman berubah; SKILL.md ini rujukan lengkap.