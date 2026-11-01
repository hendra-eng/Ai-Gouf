---
name: other-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Other (Dashboard Gouf Consulting): Create Transaction per jenis (uang muka karyawan, deposit, pinjaman, modal, intercompany, refund, other event), template, Import, Submit for Review, Approve, Post, Reverse, Exceptions, tab Posted. Wajib dibaca sebelum membuat fitur interaksi suara untuk halaman Other."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Alur Halaman Other (Transactions > Other)

Other adalah tempat peristiwa bisnis di luar Sales, Purchase, dan Cash & Bank. Berbeda dari empat halaman lain, **Other tidak memakai alur upload Source Data**.

Sumber: `src/app/transactions/other/*`, `src/lib/otherTransactionStore.ts`, `backend/modules/assets_and_equity/other_transactions_v1.py`, dan DB Supabase "database gouf". Prefix endpoint: `/api/v1/asset/other-transactions`.

## 0. PENTING: ada dua implementasi, hanya satu yang utama

- **Aktif (halaman utama `/transactions/other`)**: komponen `OtherWorkspace`, backend `assets_and_equity/other_transactions_v1.py`, tabel `asset_other_*`.
- **Lama (legacy)**: sub-halaman `/transactions/other/source-data`, `/transaction`, `/preview`, `/exceptions`, `/posted`, dan `legacy-overview`. Ini memakai tabel Journal Entry (`financial_transaction_journal_entry_drafts`) dengan `source_type = 'Other'`, lewat `otherStore.tsx` dan `OtherJournalWorkspace`.
- `backend/modules/transactions/other_v1.py` **tidak terdaftar** di `main.py`. Jangan edit file itu untuk mengubah perilaku halaman.
- Tabel lama `finance_transaction_other` (12 baris, terakhir 18 Sep 2026) bukan yang dibaca halaman aktif.

Panduan di bawah menjelaskan implementasi yang aktif.

## 1. Tab (di dalam satu halaman, lewat `?tab=`)

| Tab | Fungsi |
|---|---|
| Overview | KPI, transaksi terbaru, tren bulanan, ringkasan aturan, kategori teratas, antrean review |
| Categories | Statistik per jenis transaksi dan template-nya |
| Review Queue | Transaksi yang menunggu review |
| Journal Preview | Jurnal hasil hitung dan hasil cek |
| Exceptions | Transaksi yang punya error atau warning |
| Posted | Transaksi yang sudah masuk buku besar |

Tombol di header: **Create Transaction** (menu per jenis/template), **Transaction Templates**, **Import**, **Export**.

## 2. Jenis transaksi dan template

7 jenis, masing-masing punya sub jenis dengan aturan jurnal tetap:

`employee_advance` (uang muka karyawan), `security_deposit`, `loan_financing`, `capital_injection`, `intercompany`, `refund_reimbursement`, `other_event`.

Akun jurnal ditentukan per **peran**:

| Peran | Arti |
|---|---|
| `main` | Akun utama (uang muka karyawan, deposit, utang pinjaman, modal saham, ...) |
| `bank` | Akun kas/bank |
| `offset` | Akun lawan non-kas (biaya saat settlement, akun kredit Other Event) |
| `extra` | Porsi tambahan (bunga, tambahan modal disetor) sebesar `extra_amount` |

Akun diisi otomatis dari aturan template (`asset_other_transaction_rules`) dan boleh diganti di form. Template punya flag `requires_approval` dan `auto_post`.

## 3. Langkah pengguna

1. **Pilih klien** di dropdown "Switch Company" di header.
2. **Create Transaction** → pilih jenis/template → isi form (tanggal, pihak/counterparty, nominal, akun per peran, cabang/departemen/proyek/cost center, jatuh tempo, periode, lampiran).
   - Form punya **Journal Preview** langsung (`POST /preview` menghitung jurnal dan hasil cek tanpa menyimpan).
   - **Save Draft** → `draft`, atau **Submit for Review**.
3. **Submit for Review**: `pending_review` kalau template butuh approval, langsung `approved` kalau tidak.
4. **Approve** (Supervisor ke atas): `approved`. Kalau template `auto_post` **dan** pengguna Manager ke atas, langsung `posted`.
5. **Post** (Manager ke atas): `posted`, masuk buku besar dan laporan keuangan dengan sumber "other".
6. **Reject** (Supervisor ke atas): `rejected`. Bisa diedit lalu diajukan lagi, atau dikembalikan ke draft (`return-to-draft`).
7. **Reverse** (Manager ke atas): `reversed`, dibuat jurnal pembalik `RV-<no>` di `reversal_date`.

**Import** (`POST /import`): file CSV/Excel diparse di browser, lalu dikirim sebagai baris dan menjadi transaksi **DRAFT**. Akun yang kosong memakai akun dari aturan template. Ini bukan alur template pola kolom seperti Sales.

**Lampiran**: PDF/JPG/PNG, maks 10 MB per file, bisa dihapus selama transaksi belum posted.

## 4. Status

`draft` → `pending_review` → `approved` → `posted` → `reversed`, plus `rejected`.

Transaksi hanya bisa diedit atau dihapus selama belum posted.

## 5. Hasil cek (Journal Preview dan Exceptions)

Error (menghalangi Approve/Post):
- `zero_amount`: nominal harus lebih dari nol.
- `extra_exceeds`: porsi tambahan melebihi total.
- `missing_<peran>`: akun untuk peran wajib belum diisi.
- `account_missing`: akun tidak ada di COA klien.
- `few_lines`: jurnal butuh minimal dua baris.
- `unbalanced`: debit tidak sama dengan kredit.
- `period_locked`: tanggal jatuh di periode yang sudah ditutup.

Warning (tidak menghalangi):
- `account_inactive`: akun nonaktif.
- `account_unmapped`: akun belum dipetakan ke akun standar.
- `bank_not_cash`: akun bank yang dipilih bukan akun kas/bank.
- `due_before_date`: jatuh tempo lebih awal dari tanggal transaksi.
- `missing_party`: pihak/counterparty kosong.
- `review_overdue`: sudah menunggu review beberapa hari.

## 6. Tabel DB utama

| Tabel | Isi |
|---|---|
| `asset_other_transactions` | Header transaksi |
| `asset_other_transaction_lines` | Baris jurnal |
| `asset_other_transaction_templates` | Template per jenis (7 aktif) |
| `asset_other_transaction_rules` | Aturan akun per sub jenis dan peran (22 baris) |
| `asset_other_transaction_attachments` | Lampiran |
| `asset_other_transaction_events` | Riwayat aksi |

## 7. Hal yang harus diketahui AI

- Per 24 Okt 2026: **0 transaksi**, tapi 7 template dan 22 aturan sudah terisi. Jadi form Create bisa dipakai, hanya belum ada datanya.
- Jurnal lama berawalan `OTH-` seharusnya disalin migration 48 sebagai jenis `other_event` dengan source `legacy` (tidak bisa diedit). Tabel baru tetap 0 baris, jadi tidak ada yang tersalin.
- Kalau pengguna melihat tampilan atau tab berbeda (Source Data, Other Transaction), itu halaman legacy. Arahkan ke halaman utama `/transactions/other`.
- Pertanyaan "mana Source Data-nya": jelaskan bahwa Other tidak punya upload berbasis template. Pilihannya Create Transaction manual atau Import CSV/Excel.

## Catatan untuk AI voice (Neo)

- Neo saat ini **hanya membaca**; semua aksi tulis di halaman ini (upload, promote, Approve, Post, Reverse, dst) dipandu lewat langkah di layar, bukan dieksekusi.
- Alat baca yang tersedia: `status_transaksi` (halaman `other`). Exceptions Other dihitung di layar dan tidak punya alat baca; Other tidak punya file Source Data.
- Versi ringkas untuk prompt suara ada di `SUARA.md` (folder ini), dimuat `neo_skills.py` lewat kata kunci. Ubah `SUARA.md` kalau alur halaman berubah.
- Kalau aksi tulis lewat suara ditambahkan nanti: konfirmasi lisan dengan nomor dokumen dan nominal, catat ke activity log, dan jangan massal dalam satu perintah.
