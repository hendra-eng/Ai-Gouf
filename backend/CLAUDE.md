# Panduan untuk AI Coding Assistant (Claude Code / Claude di chat)

File ini dibaca otomatis oleh Claude Code setiap sesi kerja di folder
`backend/`. Kalau kamu (AI) sedang membantu develop project ini, ikuti
instruksi di bawah SEBELUM mulai menulis atau mengedit kode.

## Wajib: baca SKILL.md yang relevan sebelum mengedit file tertentu

Project ini punya folder `skills/` berisi panduan best-practice yang
disusun dari pengalaman nyata (termasuk bug yang pernah terjadi dan cara
memperbaikinya). JANGAN mengedit file-file berikut tanpa membaca dulu
SKILL.md yang bersangkutan:

| Kalau akan mengedit... | Baca dulu |
|---|---|
| `modules/accounting_export.py`, `modules/kertas_kerja.py`, atau menambah sheet Excel baru di modul manapun | `skills/xlsx-export/SKILL.md` |
| `modules/akuntansi_ai.py` bagian `_baca_pdf_sebagai_lembar`, `muat_workbook`, atau `modules/kertas_kerja.py` bagian `susun_gl_dari_pdf_rekening_koran` | `skills/pdf-reading/SKILL.md` |
| Membuat fitur baru generate PDF (mis. memo pajak versi cetak) | `skills/pdf-writing/SKILL.md` |
| Membuat fitur baru generate Word (mis. memo pajak versi editable) | `skills/docx-writing/SKILL.md` |

Aturan ini berlaku juga kalau kamu menambah sheet/fitur BARU yang mirip
pola yang sudah ada (bukan cuma waktu mengedit yang sudah ada).

## Setelah mengedit file Excel export, WAJIB jalankan verifikasi

Project ini punya script otomatis untuk mengecek kepatuhan terhadap aturan
di `skills/xlsx-export/SKILL.md` — jangan anggap selesai sebelum ini hijau:

```bash
python scripts/cek_aturan_xlsx.py
```

Atau lewat pytest (sudah terhubung ke test suite):

```bash
pytest tests/test_skill_compliance.py -v
```

Script ini mengecek dari kode sumber (bukan dari file .xlsx hasil), jadi
bisa langsung dijalankan tanpa perlu generate file dulu. Kalau ada
pelanggaran (nama sheet >31 karakter, urutan `_lebar_kolom_dari_isi()`
salah, dll), perbaiki dulu sebelum menganggap task selesai.

## Prinsip umum project ini (ringkas, detail ada di tiap SKILL.md)

- **Bahasa Indonesia** dipakai konsisten di semua nama fungsi, variabel,
  komentar, dan pesan error yang akan dilihat user — jangan campur ke
  bahasa Inggris kecuali istilah teknis yang memang tidak ada
  padanannya (`DataFrame`, `endpoint`, dst).
- **Jangan mengganti nama endpoint/fungsi export tanpa mengecek semua
  pemanggilnya** di `frontend/src/lib/api.js` dan komponen React terkait,
  di turn/commit yang sama. Riwayat bug: endpoint `export-14-sheet`
  pernah diganti ke `export-18-sheet` di backend tapi frontend telat
  di-update, menyebabkan semua request 404 selama beberapa waktu.
- **AI (DeepSeek) di project ini dipakai untuk klasifikasi transaksi ke
  akun COA dan fitur chat** (`akuntansi_ai.py`: `proses_dataframe`,
  `tanya_ai`) — BUKAN untuk generate file Excel/PDF/Word. Pembuatan file
  tetap kode Python biasa (openpyxl). Jangan asumsikan ada AI yang
  "menulis" isi dokumen kecuali memang diminta menambah fitur itu secara
  eksplisit.
- **Ada 2 alur export Excel yang tujuannya beda, jangan dicampur gayanya**:
  `kertas_kerja.py` (14-sheet, working paper draft, boleh lebih mentah)
  vs `accounting_export.py` (18-sheet, laporan final, harus rapi & match
  template client kalau ada). Detail lengkap di `skills/xlsx-export/SKILL.md`.

## Auto-workflow: PDF rekening koran → working paper

### Cara mendeteksi apakah sebuah PDF adalah "rekening koran"

JANGAN mengenali PDF rekening koran dari nama bank atau isi transaksi
tertentu (nama bank, nomor rekening, nama nasabah SELALU beda-beda tiap
klien). Kenali dari STRUKTUR/TIPE DATA-nya saja, pakai checklist di
bawah. Kalau PDF yang di-upload cocok dengan **≥80% (minimal 6 dari 7)**
poin berikut, anggap itu PDF rekening koran dan langsung jalankan
auto-workflow — TANPA perlu tanya konfirmasi dulu:

| # | Ciri struktural yang dicek | Bukan yang dicek |
|---|---|---|
| 1 | Ada blok header berisi identitas institusi keuangan (nama bank/lembaga + kemungkinan nomor cabang/KCP) | Nama bank spesifik (bisa bank apa saja) |
| 2 | Ada blok metadata rekening: nomor rekening, periode/bulan laporan, mata uang | Nilai nomor rekening/periode itu sendiri |
| 3 | Ada tabel dengan MINIMAL 4 kolom yang fungsinya: tanggal transaksi, keterangan/deskripsi transaksi, nominal mutasi, saldo berjalan (nama kolom boleh beda-beda: "Mutasi/Debit-Kredit", "Keterangan/Uraian", dll) | Nama kolom persis harus sama |
| 4 | Setiap baris transaksi punya tanggal berformat pendek (DD/MM atau DD/MM/YYYY) yang berurutan kronologis | Format tanggal spesifik |
| 5 | Nominal transaksi punya penanda arah (misal: suffix "DB"/"CR", tanda negatif, atau kolom debit/kredit terpisah) yang membedakan uang masuk vs keluar | Simbol/format penanda spesifik |
| 6 | Ada baris "saldo awal" di transaksi pertama DAN baris/blok ringkasan di akhir dokumen berisi total mutasi kredit, total mutasi debit, saldo akhir | Angka-angka itu sendiri |
| 7 | Dokumen berisi PULUHAN hingga RATUSAN baris transaksi berulang dengan pola kolom yang sama dari awal sampai akhir (bukan dokumen 1-2 halaman berisi teks naratif atau tabel pendek) | Jumlah baris persis |

**Kalau cocok ≥80%** → langsung jalankan auto-workflow di bawah tanpa
bertanya.

**Kalau cocok 50-79%** → kemungkinan rekening koran tapi format tidak
lazim (misal: e-wallet, kartu kredit, atau bank dengan layout tidak
umum) — tanya konfirmasi singkat ke user sebelum lanjut.

**Kalau cocok <50%** → jangan asumsikan ini rekening koran, tanya user
mau diapakan dokumen tersebut.

### Alur setelah PDF terkonfirmasi sebagai rekening koran

1. Baca `skills/pdf-reading/SKILL.md` dulu (wajib, sesuai aturan di atas)
2. Ekstrak data transaksi dari PDF pakai pola yang sudah ada di
   `akuntansi_ai.py` (`_baca_pdf_sebagai_lembar`, `muat_workbook`)
3. Susun jadi working paper (14-sheet) lewat
   `kertas_kerja.py` → `susun_gl_dari_pdf_rekening_koran`
4. Generate file Excel hasilnya, simpan ke `hasil_output/`
5. Laporkan ke user: nama file hasil + ringkasan singkat (jumlah baris
   transaksi terbaca, ada anomali/baris gagal parse atau tidak)

Kalau PDF yang dikirim TIDAK terlihat seperti rekening koran (format
tidak cocok, kemungkinan dokumen lain), baru tanya ke user untuk
konfirmasi sebelum lanjut — jangan asumsikan paksa.

Alur ini TIDAK berlaku kalau user secara eksplisit minta hal lain
(misal: "cuma mau ekstrak datanya jadi CSV", "jangan generate Excel
dulu") — instruksi eksplisit user selalu diutamakan di atas alur
otomatis ini.

## Auto-workflow umum: file dikirim TANPA teks apapun

User sering kerja dengan cara: buka VS Code, drag/kirim satu atau
beberapa file ke Claude Code, TANPA mengetik instruksi sama sekali.
Kalau ini terjadi, JANGAN balas dengan pertanyaan "mau diapakan file
ini?" sebagai langkah pertama. Ikuti urutan ini:

1. **Cek nama & lokasi file dulu.** Kalau nama file/path cocok persis
   dengan file yang sudah pernah dibahas/disebut di project ini (misal
   `accounting_export.py`, `kertas_kerja.py`, `Model_Laporan_Keuangan_*`,
   `Kertas_Kerja_Laporan_Keuangan_2025.xlsx`) — itu sinyal kuat soal
   konteks kerjanya, walau belum tentu langsung menentukan aksi.
2. **Kalau file itu KODE (.py, .jsx, .js)** yang sudah ada isinya:
   anggap user mau file itu DIPERBAIKI/DILANJUTKAN berdasarkan bug atau
   pekerjaan yang belum selesai paling terakhir dibahas untuk file
   tersebut (cek riwayat obrolan/PR/commit terakhir kalau tersedia).
   Kalau tidak ada riwayat sama sekali dan tidak jelas apa yang perlu
   diubah, baru tanya singkat — jangan menebak buta di kode yang sudah
   jalan.
3. **Kalau file itu DATA (.xlsx, .csv, .pdf)** — jalankan deteksi jenis
   dokumen berdasarkan STRUKTUR isinya (kolom, header, pola baris),
   PERSIS seperti prinsip checklist rekening koran di atas (jangan
   pakai nama file/bank/klien sebagai penentu). Pakai tabel referensi
   di bawah untuk memutuskan aksi default:

   | Struktur file terdeteksi sebagai... | Aksi default (tanpa tanya, kalau confidence tinggi) |
   |---|---|
   | Rekening koran / mutasi bank (lihat checklist di atas) | Jalankan alur kertas kerja / kategorisasi bank yang sudah ada |
   | Data penjualan/invoice (kolom invoice, customer, DPP, PPN, Total) | Proses lewat pipeline data penjualan → draf jurnal |
   | Export POS/kasir (Tanggal, Outlet, Type, Amount) | Proses lewat pipeline POS → draf jurnal |
   | Sheet berisi kolom kode akun + kategori (Aset/Liabilitas/dst) | Perlakukan sebagai COA klien, simpan/update, jangan generate laporan dari situ saja |
   | Working paper / kertas kerja 14-sheet (FS_Control, Identity, GL, TB_Monthly, dst) | Perlakukan sebagai referensi format ATAU sebagai kertas kerja yang mau dilanjutkan ke laporan 18-sheet — kalau ambigu, tanya singkat mana yang dimaksud |
   | Laporan keuangan 18-sheet / model referensi (Neraca Saldo Awal, GL, Trial Balance Bulanan, dst) | Perlakukan sebagai acuan untuk mencocokkan format/styling `accounting_export.py`, BUKAN untuk langsung ditimpa |
   | Rekap penilaian kinerja (kolom Nama Klien, Maker, Score, BOBOT KLIEN, dst) | Jalankan analisis 20 kesalahan standar + 6 poin prioritas, perbaiki langsung sesuai aturan yang sudah ada |
   | Bukti potong PPh 21/23/4(2), AR/AP Aging, Bukti Kas Masuk/Keluar, Slip Gaji, Aset Tetap, dsb | Proses lewat pipeline deteksi jenis dokumen yang sudah ada di `akuntansi_ai.py` |

   Confidence tetap pakai aturan 3 tingkat seperti checklist rekening
   koran: **≥80% jalan otomatis**, **50-79% tanya konfirmasi singkat**,
   **<50% tanya user mau diapakan**.
4. **Kalau lebih dari satu file dikirim sekaligus** dan salah satunya
   kode + salah satunya data (misal: `kertas_kerja.py` + PDF rekening
   koran), anggap file data itu sebagai CONTOH/INPUT untuk melengkapi
   atau menguji file kode yang dikirim bersamaan — bukan dua task
   terpisah.
5. **Kalau setelah langkah 1-4 masih ambigu** (tidak cocok kategori
   manapun, atau bisa masuk 2+ kategori sekaligus), baru tanya — tapi
   tanya SINGKAT dan spesifik (mis. "Ini kertas kerja mau dijadikan
   acuan format, atau mau dilanjutkan generate ke 18-sheet?"), jangan
   minta user menjelaskan ulang dari awal.

Prinsip di atas adalah generalisasi dari alur "PDF rekening koran →
working paper" di bawah — kalau menambah jenis file baru yang bisa
dideteksi otomatis, tambahkan barisnya di tabel ini juga.

## Kalau menambah SKILL.md baru

Ikuti format yang sudah ada (frontmatter `name`/`description`/`license`,
lalu isi terstruktur dengan heading, tabel aturan wajib, dan checklist di
akhir). Tambahkan juga baris baru di tabel "Wajib: baca SKILL.md" di atas
supaya AI berikutnya tahu kapan skill baru itu harus dibaca.# Panduan untuk AI Coding Assistant (Claude Code / Claude di chat)

File ini dibaca otomatis oleh Claude Code setiap sesi kerja di folder
`backend/`. Kalau kamu (AI) sedang membantu develop project ini, ikuti
instruksi di bawah SEBELUM mulai menulis atau mengedit kode.

## Wajib: baca SKILL.md yang relevan sebelum mengedit file tertentu

Project ini punya folder `skills/` berisi panduan best-practice yang
disusun dari pengalaman nyata (termasuk bug yang pernah terjadi dan cara
memperbaikinya). JANGAN mengedit file-file berikut tanpa membaca dulu
SKILL.md yang bersangkutan:

| Kalau akan mengedit... | Baca dulu |
|---|---|
| `modules/accounting_export.py`, `modules/kertas_kerja.py`, atau menambah sheet Excel baru di modul manapun | `skills/xlsx-export/SKILL.md` |
| `modules/akuntansi_ai.py` bagian `_baca_pdf_sebagai_lembar`, `muat_workbook`, atau `modules/kertas_kerja.py` bagian `susun_gl_dari_pdf_rekening_koran` | `skills/pdf-reading/SKILL.md` |
| Membuat fitur baru generate PDF (mis. memo pajak versi cetak) | `skills/pdf-writing/SKILL.md` |
| Membuat fitur baru generate Word (mis. memo pajak versi editable) | `skills/docx-writing/SKILL.md` |

Aturan ini berlaku juga kalau kamu menambah sheet/fitur BARU yang mirip
pola yang sudah ada (bukan cuma waktu mengedit yang sudah ada).

## Setelah mengedit file Excel export, WAJIB jalankan verifikasi

Project ini punya script otomatis untuk mengecek kepatuhan terhadap aturan
di `skills/xlsx-export/SKILL.md` — jangan anggap selesai sebelum ini hijau:

```bash
python scripts/cek_aturan_xlsx.py
```

Atau lewat pytest (sudah terhubung ke test suite):

```bash
pytest tests/test_skill_compliance.py -v
```

Script ini mengecek dari kode sumber (bukan dari file .xlsx hasil), jadi
bisa langsung dijalankan tanpa perlu generate file dulu. Kalau ada
pelanggaran (nama sheet >31 karakter, urutan `_lebar_kolom_dari_isi()`
salah, dll), perbaiki dulu sebelum menganggap task selesai.

## Prinsip umum project ini (ringkas, detail ada di tiap SKILL.md)

- **Bahasa Indonesia** dipakai konsisten di semua nama fungsi, variabel,
  komentar, dan pesan error yang akan dilihat user — jangan campur ke
  bahasa Inggris kecuali istilah teknis yang memang tidak ada
  padanannya (`DataFrame`, `endpoint`, dst).
- **Jangan mengganti nama endpoint/fungsi export tanpa mengecek semua
  pemanggilnya** di `frontend/src/lib/api.js` dan komponen React terkait,
  di turn/commit yang sama. Riwayat bug: endpoint `export-14-sheet`
  pernah diganti ke `export-18-sheet` di backend tapi frontend telat
  di-update, menyebabkan semua request 404 selama beberapa waktu.
- **AI (DeepSeek) di project ini dipakai untuk klasifikasi transaksi ke
  akun COA dan fitur chat** (`akuntansi_ai.py`: `proses_dataframe`,
  `tanya_ai`) — BUKAN untuk generate file Excel/PDF/Word. Pembuatan file
  tetap kode Python biasa (openpyxl). Jangan asumsikan ada AI yang
  "menulis" isi dokumen kecuali memang diminta menambah fitur itu secara
  eksplisit.
- **Ada 2 alur export Excel yang tujuannya beda, jangan dicampur gayanya**:
  `kertas_kerja.py` (14-sheet, working paper draft, boleh lebih mentah)
  vs `accounting_export.py` (18-sheet, laporan final, harus rapi & match
  template client kalau ada). Detail lengkap di `skills/xlsx-export/SKILL.md`.

## Auto-workflow: PDF rekening koran → working paper

### Cara mendeteksi apakah sebuah PDF adalah "rekening koran"

JANGAN mengenali PDF rekening koran dari nama bank atau isi transaksi
tertentu (nama bank, nomor rekening, nama nasabah SELALU beda-beda tiap
klien). Kenali dari STRUKTUR/TIPE DATA-nya saja, pakai checklist di
bawah. Kalau PDF yang di-upload cocok dengan **≥80% (minimal 6 dari 7)**
poin berikut, anggap itu PDF rekening koran dan langsung jalankan
auto-workflow — TANPA perlu tanya konfirmasi dulu:

| # | Ciri struktural yang dicek | Bukan yang dicek |
|---|---|---|
| 1 | Ada blok header berisi identitas institusi keuangan (nama bank/lembaga + kemungkinan nomor cabang/KCP) | Nama bank spesifik (bisa bank apa saja) |
| 2 | Ada blok metadata rekening: nomor rekening, periode/bulan laporan, mata uang | Nilai nomor rekening/periode itu sendiri |
| 3 | Ada tabel dengan MINIMAL 4 kolom yang fungsinya: tanggal transaksi, keterangan/deskripsi transaksi, nominal mutasi, saldo berjalan (nama kolom boleh beda-beda: "Mutasi/Debit-Kredit", "Keterangan/Uraian", dll) | Nama kolom persis harus sama |
| 4 | Setiap baris transaksi punya tanggal berformat pendek (DD/MM atau DD/MM/YYYY) yang berurutan kronologis | Format tanggal spesifik |
| 5 | Nominal transaksi punya penanda arah (misal: suffix "DB"/"CR", tanda negatif, atau kolom debit/kredit terpisah) yang membedakan uang masuk vs keluar | Simbol/format penanda spesifik |
| 6 | Ada baris "saldo awal" di transaksi pertama DAN baris/blok ringkasan di akhir dokumen berisi total mutasi kredit, total mutasi debit, saldo akhir | Angka-angka itu sendiri |
| 7 | Dokumen berisi PULUHAN hingga RATUSAN baris transaksi berulang dengan pola kolom yang sama dari awal sampai akhir (bukan dokumen 1-2 halaman berisi teks naratif atau tabel pendek) | Jumlah baris persis |

**Kalau cocok ≥80%** → langsung jalankan auto-workflow di bawah tanpa
bertanya.

**Kalau cocok 50-79%** → kemungkinan rekening koran tapi format tidak
lazim (misal: e-wallet, kartu kredit, atau bank dengan layout tidak
umum) — tanya konfirmasi singkat ke user sebelum lanjut.

**Kalau cocok <50%** → jangan asumsikan ini rekening koran, tanya user
mau diapakan dokumen tersebut.

### Alur setelah PDF terkonfirmasi sebagai rekening koran

1. Baca `skills/pdf-reading/SKILL.md` dulu (wajib, sesuai aturan di atas)
2. Ekstrak data transaksi dari PDF pakai pola yang sudah ada di
   `akuntansi_ai.py` (`_baca_pdf_sebagai_lembar`, `muat_workbook`)
3. Susun jadi working paper (14-sheet) lewat
   `kertas_kerja.py` → `susun_gl_dari_pdf_rekening_koran`
4. Generate file Excel hasilnya, simpan ke `hasil_output/`
5. Laporkan ke user: nama file hasil + ringkasan singkat (jumlah baris
   transaksi terbaca, ada anomali/baris gagal parse atau tidak)

Kalau PDF yang dikirim TIDAK terlihat seperti rekening koran (format
tidak cocok, kemungkinan dokumen lain), baru tanya ke user untuk
konfirmasi sebelum lanjut — jangan asumsikan paksa.

Alur ini TIDAK berlaku kalau user secara eksplisit minta hal lain
(misal: "cuma mau ekstrak datanya jadi CSV", "jangan generate Excel
dulu") — instruksi eksplisit user selalu diutamakan di atas alur
otomatis ini.

## Auto-workflow umum: file dikirim TANPA teks apapun

User sering kerja dengan cara: buka VS Code, drag/kirim satu atau
beberapa file ke Claude Code, TANPA mengetik instruksi sama sekali.
Kalau ini terjadi, JANGAN balas dengan pertanyaan "mau diapakan file
ini?" sebagai langkah pertama. Ikuti urutan ini:

1. **Cek nama & lokasi file dulu.** Kalau nama file/path cocok persis
   dengan file yang sudah pernah dibahas/disebut di project ini (misal
   `accounting_export.py`, `kertas_kerja.py`, `Model_Laporan_Keuangan_*`,
   `Kertas_Kerja_Laporan_Keuangan_2025.xlsx`) — itu sinyal kuat soal
   konteks kerjanya, walau belum tentu langsung menentukan aksi.
2. **Kalau file itu KODE (.py, .jsx, .js)** yang sudah ada isinya:
   anggap user mau file itu DIPERBAIKI/DILANJUTKAN berdasarkan bug atau
   pekerjaan yang belum selesai paling terakhir dibahas untuk file
   tersebut (cek riwayat obrolan/PR/commit terakhir kalau tersedia).
   Kalau tidak ada riwayat sama sekali dan tidak jelas apa yang perlu
   diubah, baru tanya singkat — jangan menebak buta di kode yang sudah
   jalan.
3. **Kalau file itu DATA (.xlsx, .csv, .pdf)** — jalankan deteksi jenis
   dokumen berdasarkan STRUKTUR isinya (kolom, header, pola baris),
   PERSIS seperti prinsip checklist rekening koran di atas (jangan
   pakai nama file/bank/klien sebagai penentu). Pakai tabel referensi
   di bawah untuk memutuskan aksi default:

   | Struktur file terdeteksi sebagai... | Aksi default (tanpa tanya, kalau confidence tinggi) |
   |---|---|
   | Rekening koran / mutasi bank (lihat checklist di atas) | Jalankan alur kertas kerja / kategorisasi bank yang sudah ada |
   | Data penjualan/invoice (kolom invoice, customer, DPP, PPN, Total) | Proses lewat pipeline data penjualan → draf jurnal |
   | Export POS/kasir (Tanggal, Outlet, Type, Amount) | Proses lewat pipeline POS → draf jurnal |
   | Sheet berisi kolom kode akun + kategori (Aset/Liabilitas/dst) | Perlakukan sebagai COA klien, simpan/update, jangan generate laporan dari situ saja |
   | Working paper / kertas kerja 14-sheet (FS_Control, Identity, GL, TB_Monthly, dst) | Perlakukan sebagai referensi format ATAU sebagai kertas kerja yang mau dilanjutkan ke laporan 18-sheet — kalau ambigu, tanya singkat mana yang dimaksud |
   | Laporan keuangan 18-sheet / model referensi (Neraca Saldo Awal, GL, Trial Balance Bulanan, dst) | Perlakukan sebagai acuan untuk mencocokkan format/styling `accounting_export.py`, BUKAN untuk langsung ditimpa |
   | Rekap penilaian kinerja (kolom Nama Klien, Maker, Score, BOBOT KLIEN, dst) | Jalankan analisis 20 kesalahan standar + 6 poin prioritas, perbaiki langsung sesuai aturan yang sudah ada |
   | Bukti potong PPh 21/23/4(2), AR/AP Aging, Bukti Kas Masuk/Keluar, Slip Gaji, Aset Tetap, dsb | Proses lewat pipeline deteksi jenis dokumen yang sudah ada di `akuntansi_ai.py` |

   Confidence tetap pakai aturan 3 tingkat seperti checklist rekening
   koran: **≥80% jalan otomatis**, **50-79% tanya konfirmasi singkat**,
   **<50% tanya user mau diapakan**.
4. **Kalau lebih dari satu file dikirim sekaligus** dan salah satunya
   kode + salah satunya data (misal: `kertas_kerja.py` + PDF rekening
   koran), anggap file data itu sebagai CONTOH/INPUT untuk melengkapi
   atau menguji file kode yang dikirim bersamaan — bukan dua task
   terpisah.
5. **Kalau setelah langkah 1-4 masih ambigu** (tidak cocok kategori
   manapun, atau bisa masuk 2+ kategori sekaligus), baru tanya — tapi
   tanya SINGKAT dan spesifik (mis. "Ini kertas kerja mau dijadikan
   acuan format, atau mau dilanjutkan generate ke 18-sheet?"), jangan
   minta user menjelaskan ulang dari awal.

Prinsip di atas adalah generalisasi dari alur "PDF rekening koran →
working paper" di bawah — kalau menambah jenis file baru yang bisa
dideteksi otomatis, tambahkan barisnya di tabel ini juga.

## Kalau menambah SKILL.md baru

Ikuti format yang sudah ada (frontmatter `name`/`description`/`license`,
lalu isi terstruktur dengan heading, tabel aturan wajib, dan checklist di
akhir). Tambahkan juga baris baru di tabel "Wajib: baca SKILL.md" di atas
supaya AI berikutnya tahu kapan skill baru itu harus dibaca.