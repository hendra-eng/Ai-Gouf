---
name: transactions-overview
description: "Pakai skill ini lebih dulu setiap kali pengguna bertanya tentang halaman Transactions secara umum atau perintahnya belum jelas menyebut halaman mana (Sales, Purchase, Journal Entry, Cash & Bank, Other). Berisi peta kelima halaman, hubungan antar halaman, aturan role, dan perbedaan perilaku penting. Setelah halaman ditentukan, baca skill halaman terkait."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Peta Halaman Transactions

Detail tiap halaman ada di skill masing-masing:
`sales-transaction-flow`, `purchase-transaction-flow`, `journal-entry-transaction-flow`, `cash-bank-transaction-flow`, `other-transaction-flow`.

## 1. Aturan yang berlaku di semua halaman

- **Klien aktif** dipilih lewat dropdown "Switch Company" di header. Semua data difilter per klien itu. Upload dan input tidak bisa jalan tanpa klien aktif.
- **Role**: level 3 (Supervisor) untuk upload, input, edit, Approve. Level 4 (Manager) untuk Post dan Reverse.
- **Upload tidak sama dengan transaksi.** Di Sales, Purchase, dan Journal Entry, file upload hanya masuk staging (`source_rows`). Pengguna harus menekan tombol promote (Buat Invoice / Buat Transaksi / Create Journal) supaya jadi transaksi draft.
- **Template pola kolom per klien.** Kalau pola file belum dikenal, file berstatus "Butuh Review" dengan 0 baris. Template harus dibuat dulu.
- Hanya data berstatus **posted** yang terbaca buku besar dan laporan keuangan.

## 2. Ringkasan kelima halaman

| Halaman | Tab | Cara data masuk | Approve / Post |
|---|---|---|---|
| Sales | Overview, Source Data, Sales Transaction, Journal Preview, Exceptions, Posted | Upload file → Buat Invoice | Journal Preview: Approve lalu Post. Tombol Post di Sales Transaction memotong jalur (tanpa validasi) |
| Purchase | Overview, Source Data, Purchase Transaction, Purchase Preview, Exceptions, Posted | Upload file → Buat Transaksi, atau Create Bill manual | Divalidasi backend: Approve (Supervisor), Post (Manager) |
| Journal Entry | Overview, Source Data, JE Transaction, Journal Preview, Exceptions, Posted | Upload file → Create Journal, import fallback di browser, atau New Journal Entry | Divalidasi backend: Approve, Reject, Reopen, Post (hanya dari approved) |
| Cash & Bank | Overview, Cash Payment, Cash Receipt, Source Data, Reconciliation, Journal Preview, Exceptions, Posted | Upload rekening koran → Reconciliation (match) atau input manual | Approve (Supervisor), Post dan Reverse (Manager) |
| Other | Overview, Categories, Review Queue, Journal Preview, Exceptions, Posted | Create Transaction per jenis/template, atau Import CSV/Excel. Tidak ada Source Data berbasis template | Submit, Approve, Post, Reject, Reverse |

## 3. Hubungan antar halaman

- **Sales** posted/partial/paid → muncul di **Cash & Bank > Cash Receipt** dan bisa dicocokkan dengan mutasi uang masuk.
- **Purchase** posted → muncul di **Cash & Bank > Cash Payment**, dan menjadi dasar Accounts Payable. Cocok dengan mutasi uang keluar.
- **Cash & Bank** posted → memperbarui pelunasan invoice (`paid_amount` Sales, `payment_status` Purchase). Status posting invoice Sales tidak diubah.
- **Journal Entry** dan **Other** berdiri sendiri untuk jurnal di luar tiga alur di atas. Halaman Other versi lama memakai tabel Journal Entry (`source_type = 'Other'`).
- Semua yang posted → buku besar dan Financial Statements.

## 4. Perbedaan perilaku yang sering menyesatkan

| Hal | Sales | Purchase / JE / Cash & Bank / Other |
|---|---|---|
| Validasi saat Post | Tidak ada di tombol Post Sales Transaction. Status diubah langsung | Divalidasi backend (balance, akun ada di COA, role) |
| Exceptions | Tabel ada, belum terisi otomatis | Journal Entry: dihitung dari data. Cash & Bank: dideteksi dari Bank Feed dan invoice. Other: dari hasil cek jurnal |
| Tombol Approve | Hanya tampil untuk status Review, yang tidak pernah terisi. Praktis lewat Journal Preview | Berjalan normal |

## 5. Kondisi data per 24 Okt 2026

| Halaman | Ringkasan |
|---|---|
| Sales | 173 invoice (172 Draft, 1 Partial), 33.895 baris source, baru 2 file yang dipromosikan |
| Purchase | 163 transaksi (159 draft, 1 approved, 3 posted), 546 baris item |
| Journal Entry | Semua tabel kosong (0 draft, 0 file, 0 template) |
| Cash & Bank | 1 statement, 3 mutasi unmatched, 0 transaksi, 756 exception Open |
| Other | 0 transaksi, 7 template dan 22 aturan sudah ada |

Angka ini bisa berubah. Untuk jawaban ke pengguna, baca ulang dari DB, jangan pakai tabel ini sebagai sumber.

## 6. Dua jebakan kode

- Cash & Bank: router aktif adalah `bank_cash_willi.py`, bukan `bank_cash_v1.py`.
- Other: router aktif adalah `assets_and_equity/other_transactions_v1.py`, bukan `transactions/other_v1.py`.

## 7. Cara AI memilih halaman dari ucapan pengguna

| Pengguna menyebut | Halaman |
|---|---|
| penjualan, invoice, piutang, customer | Sales |
| pembelian, bill, vendor, utang usaha | Purchase |
| jurnal umum, JE, voucher, jurnal manual | Journal Entry |
| rekening koran, mutasi, bank, kas, pelunasan, rekonsiliasi | Cash & Bank |
| uang muka karyawan, deposit, pinjaman, modal, intercompany, refund | Other |

Kalau ucapan bisa cocok ke dua halaman (misal "pembayaran"), tanya satu pertanyaan singkat: untuk invoice penjualan (Cash Receipt) atau pembelian (Cash Payment)?
