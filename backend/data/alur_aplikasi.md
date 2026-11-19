# ALUR PROSES APLIKASI DASHBOARDORI
# Format: setiap alur dimulai dengan "## ALUR: <judul>", lalu baris "Rute:" dan "Kata kunci:".
# Ditulis manual dari alur kode yang sebenarnya. Update bagian terkait setiap alur berubah.

## ALUR: Sales (penjualan) — dari upload file sampai Posted
Rute: /transactions/sales, /transactions/source-data
Kata kunci: sales, penjualan, invoice penjualan, faktur penjualan, source data, upload file, buat invoice, journal preview, posting, posted, post journal, exceptions, mapping rules, template impor, piutang, bulk post

Halaman Sales (`/transactions/sales`) punya 6 tab: Overview, Source Data, Sales Transaction, Journal Preview, Exceptions, Posted. Urutan kerja normal:

**1. Source Data → Upload File**
- Pengguna mengunggah laporan penjualan (CSV / Excel / PDF) untuk client yang sedang aktif.
- Sistem mencocokkan file dengan Template Impor (Mapping Rules) milik client itu, berdasarkan baris header file. Satu template bisa melayani beberapa format (CSV, Excel, PDF).
- Template ketemu → baris diekstrak otomatis jadi "source rows". Status ekstraksi: **Berhasil** (semua baris valid) atau **Butuh Review** (ada baris tidak valid).
- Template TIDAK ketemu → file tetap tersimpan tetapi berstatus **Butuh Review** dan tanpa baris. Template baru harus dibuat dulu lewat Mapping Rules sebelum file jenis itu bisa diekstrak. Status lain yang bisa muncul: **Diproses** (sedang berjalan) dan **Gagal**.

**2. Source Data → Buat Invoice**
- Baris valid dinaikkan menjadi invoice Sales resmi berstatus **Draft**, lengkap dengan mapping akun default client.
- Yang dilewati: baris tidak valid atau tanpa nomor invoice, baris yang sudah pernah dinaikkan, dan nomor invoice yang bentrok (sudah dipakai client itu atau dobel di file yang sama). Ringkasan jumlah dibuat/dilewati ditampilkan setelah proses.
- Tombol ini khusus Supervisor ke atas (level 3).

**3. Sales Transaction (workspace invoice)**
- Daftar invoice dengan status posting: **Draft → Review → Approved → Posted**, lalu **Partial** / **Paid** untuk invoice yang sudah dibayar sebagian / penuh.
- Invoice bisa diedit, di-Approve, dan di-Post satu per satu. Untuk banyak sekaligus, centang beberapa invoice lalu Post (bulk post, maksimal 1000 per proses). Invoice yang sudah Posted/Partial/Paid dilewati; yang gagal validasi dilaporkan dan sisanya tetap diposting.

**4. Journal Preview (tinjau jurnal, lalu posting)**
- Menampilkan jurnal otomatis tiap invoice: **Debit Piutang = nilai gross; Kredit Pendapatan = DPP; Kredit PPN Keluaran = PPN**.
- Di sini akun bisa diatur/disetujui, lalu **Approve** dan **Post Journal**.
- Kalau invoice belum punya mapping, sistem membuatnya dari akun default client (template Sales). Fallback terakhir: Piutang 1120-01, Pendapatan 4100-01, PPN Keluaran 2100-01.

**5. Syarat posting (validasi)**
- Jika client punya master COA, invoice wajib punya mapping akun, dan semua akunnya harus ada di COA client: piutang, pendapatan, PPN (kalau ada PPN), dan PPh (kalau diisi).
- Gagal validasi → invoice tidak diposting dengan pesan seperti "Accounts are not mapped yet" atau "Account(s) not found in the client's chart of accounts". Solusinya: set akun di Journal Preview, atau tambahkan akun ke COA client, lalu Post ulang.
- Approve, Post, edit, dan hapus invoice khusus Supervisor ke atas (level 3).

**6. Setelah Posted — data pergi ke mana**
- Status invoice menjadi **Posted**, status sinkron jurnal **Synced**, tercatat waktu dan siapa yang posting, dan ada jejak aktivitas "POSTING". Invoice muncul di tab **Posted** (bisa di-export ke Excel).
- Invoice Posted otomatis dibaca oleh **Financial Statements** (buku besar dan laporan keuangan). Laporan hanya mengambil data yang sudah Posted — Draft/Review/Approved tidak masuk laporan.
- Posting Sales TIDAK membuat draft Journal Entry, jadi tidak ada jurnal dobel antara Sales dan Journal Entry.
- Invoice saldo awal (import Opening AR) tidak dihitung ulang di laporan karena sudah diwakili jurnal opening balance.
- Setelah posting, sistem mencoba mencocokkan invoice dengan mutasi bank yang sudah di-upload di Bank & Cash (toggle Auto-match). Kecocokan memengaruhi jumlah terbayar dan status reconcile (Reconciled bila sisa tagihan dalam toleransi, selain itu Unreconciled). Auto-match tidak pernah menggagalkan posting.

**7. Exceptions**
- Tempat mencatat dan menindaklanjuti transaksi penjualan yang butuh review. Status: Open sampai ditandai **Resolved**. Tab Exceptions menampilkan badge jumlah yang masih terbuka.

**Ringkas:** Upload File (Source Data) → Buat Invoice (Draft) → Review/Approve → Journal Preview → Post → tab Posted → masuk Financial Statements dan bisa dicocokkan dengan mutasi bank.