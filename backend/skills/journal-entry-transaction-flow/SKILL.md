---
name: journal-entry-transaction-flow
description: "Pakai skill ini setiap kali AI perlu menjawab, memandu, atau menjalankan sesuatu di halaman Transactions > Journal Entry (Dashboard Gouf Consulting): upload/import jurnal, Create Journal, input manual, Approve, Reject, Reopen, Post ke GL, Exceptions, tab Posted. Wajib dibaca sebelum membuat fitur interaksi suara untuk halaman Journal Entry."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Alur Halaman Journal Entry (Transactions > Journal Entry)

Sumber: `src/app/transactions/journal-entry/*`, `src/lib/journalEntryStore`, `backend/modules/transactions/journal_entry_v1.py`, `journal_entry_import_v1.py`, `backend/db_client.py`, dan DB Supabase "database gouf". Prefix endpoint: `/api/v1/transactions/journal-entries`.

## 1. Tab dan fungsinya

| Tab | Fungsi |
|---|---|
| Overview | KPI, grafik status, tren entri, rincian exception |
| Source Data | Upload/import file jurnal, preview, tombol **Create Journal**, tombol **New Journal Entry** |
| JE Transaction | Daftar jurnal (draft). Aksi massal: Approve, Post, Reopen, Reject, Delete |
| Journal Preview | Satu jurnal dengan checklist kesiapan, lalu aksi workflow |
| Exceptions | Jurnal bermasalah |
| Posted | Jurnal yang sudah masuk buku besar |

## 2. Tiga jalur membuat jurnal

1. **Import dengan template (jalur utama untuk laporan klien yang formatnya baku, misal Jurnal Kas Kasir SAU)**
   - Source Data → **Upload File** (`POST /import/upload`, minimal Supervisor). Backend mencocokkan pola kolom dengan template Journal Entry milik klien aktif (format `flat_grouped_by_voucher`, satu voucher menjadi satu jurnal).
   - Template cocok: file dicatat, dan tiap jurnal masuk staging (`source_rows`). Belum ada draft di tahap ini.
   - Pilih file → **Create Journal** (`POST /source-files/{id}/promote-to-journals`). Hanya jurnal valid, belum pernah dibuat, dan nomornya belum dipakai yang naik jadi draft. Proses idempoten.
2. **Import tanpa template (fallback)**
   - Kalau backend menjawab `template_matched = false`, modal Import memparse file di browser, mengelompokkan baris per JE Number, menampilkan preview, lalu **Import** menyimpan langsung sebagai draft (`POST /drafts/full`). Tidak lewat tombol Create Journal.
3. **Input manual**: tombol **New Journal Entry** (modal), langsung jadi draft.

## 3. Workflow status

Status: `draft`, `pending`, `exception`, `approved`, `posted`, `rejected`.

| Aksi | Siapa | Dari status | Hasil |
|---|---|---|---|
| Approve | Supervisor ke atas (level 3) | draft, pending, exception | approved |
| Post | Manager ke atas (level 4) | **hanya approved** | posted |
| Reject | Supervisor ke atas | draft, pending, exception, approved | rejected (alasan disimpan di notes) |
| Reopen | Supervisor ke atas | rejected | draft |
| Delete | Supervisor ke atas | draft, pending, exception, rejected | jurnal dihapus |
| Edit | Supervisor ke atas | draft, pending, exception, rejected | tetap |

Syarat **Post** (divalidasi backend): minimal 2 baris, tiap baris punya kode akun, tiap baris hanya salah satu sisi (debit atau kredit) dengan nominal, total debit = total kredit, dan semua akun ada di COA klien. Tanggal posting = `posting_date`, kalau kosong memakai `entry_date`.

Aksi bisa massal. Hasilnya `done` dan `skipped` dengan alasan. Alasan skip yang umum: "Approve the journal first." dan "Status 'x' cannot be posted."

Setiap aksi (Approved, Rejected, Reopened) dicatat otomatis ke activity log jurnal.

## 4. Journal Preview

Checklist kesiapan yang ditampilkan per jurnal:
1. Minimal 2 baris jurnal.
2. Setiap baris punya kode akun.
3. Setiap baris hanya debit atau kredit, dan ada nominalnya.
4. Debit sama dengan kredit.

Kalau semua lolos, jurnal berstatus siap diposting. Badge "Balanced" atau "Unbalanced" tampil di atas.

## 5. Exceptions

- **Tidak disimpan di tabel.** Daftar dihitung di frontend dari: jurnal berstatus `exception`, jurnal yang debit-kreditnya tidak seimbang, dan baris staging tidak valid (`is_valid = false`) di source files.
- Jadi "Exceptions kosong" berarti memang tidak ada jurnal yang terdeteksi bermasalah, bukan berarti fitur belum jalan.

## 6. Tabel DB utama

| Tabel | Isi |
|---|---|
| `financial_transaction_journal_entry_source_files` | File upload |
| `financial_transaction_journal_entry_source_rows` | Staging, 1 baris per jurnal |
| `financial_transaction_journal_entry_drafts` | Header jurnal (`je_number`, `status`, `source_type`, `entry_date`, `posting_date`) |
| `financial_transaction_journal_entry_draft_lines` | Baris debit/kredit |
| `financial_transaction_journal_entry_activity_log` | Riwayat aksi |
| `financial_transaction_journal_entry_import_templates` | Template pola kolom per klien |

Tabel `financial_transaction_journal_entry_drafts` juga dipakai halaman **Other** versi lama dengan `source_type = 'Other'`.

## 7. Hal yang harus diketahui AI

- Per 24 Okt 2026 semua tabel Journal Entry di atas **kosong (0 baris)**, termasuk template import. Jangan mengarang angka. Kalau pengguna bertanya jumlah jurnal, jawab dari DB. Hasilnya saat ini nol.
- Tabel `journal_entries` (52 baris) dan `journal_lines` adalah tabel inti buku besar, bukan hasil halaman ini.
- Karena belum ada template JE, upload file akan berstatus "Butuh Review" kecuali template dibuat dulu. Jalur yang realistis untuk sekarang: fallback import di browser atau New Journal Entry manual.
- Post butuh Manager ke atas. Reject dan Reopen tersedia, jadi jurnal salah tidak perlu dihapus.

## Catatan untuk AI voice (Neo)

- Neo saat ini **hanya membaca**; semua aksi tulis di halaman ini (upload, promote, Approve, Post, Reverse, dst) dipandu lewat langkah di layar, bukan dieksekusi.
- Alat baca yang tersedia: `status_transaksi`, `file_sumber`, `daftar_exceptions` (parameter `halaman`, di `neo_data_tools.py`). `jurnal_terakhir` membaca jurnal buku besar inti, bukan draft halaman ini.
- Versi ringkas untuk prompt suara ada di `SUARA.md` (folder ini), dimuat `neo_skills.py` lewat kata kunci. Ubah `SUARA.md` kalau alur halaman berubah.
- Kalau aksi tulis lewat suara ditambahkan nanti: konfirmasi lisan dengan nomor dokumen dan nominal, catat ke activity log, dan jangan massal dalam satu perintah.
