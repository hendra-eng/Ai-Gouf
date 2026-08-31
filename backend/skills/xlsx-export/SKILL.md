---
name: xlsx-export
description: "Pakai skill ini setiap kali AI akan membuat atau menulis file Excel (.xlsx) untuk aplikasi akuntansi/pajak ini — export laporan keuangan 18-sheet, kertas kerja 14-sheet, rekening koran, atau sheet baru lain yang ditambahkan ke salah satu export tersebut. Berlaku untuk modules/accounting_export.py, modules/kertas_kerja.py, dan modul export sejenis. JANGAN dipakai untuk PDF, Word, atau format non-Excel."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Export Excel — Laporan Keuangan & Kertas Kerja

Panduan ini merangkum pola dan aturan yang SUDAH terbukti benar di codebase
(`accounting_export.py`, `kertas_kerja.py`) — termasuk bug yang pernah
ditemukan dan cara memperbaikinya. Tujuannya: setiap sheet baru dibuat
konsisten dengan yang sudah ada, tanpa mengulang bug lama.

## Aturan wajib sebelum menulis sheet baru

1. **Nama sheet ikut aturan Excel yang keras**: maksimum 31 karakter.
   openpyxl HANYA memberi warning kalau lebih (tidak auto-truncate) —
   sheet tetap akan gagal/aneh di Excel. Selalu potong manual atau pendekkan
   nama, contoh nyata di codebase: `"Catatan atas Laporan Keuangan (CALK)"`
   (36 karakter, salah) → `"Catatan Laporan Keuangan (CALK)"` (31 karakter).
   Untuk nama dinamis (mis. nama bank), selalu bungkus `str(nama)[:31]`.
2. **Urutan & nama sheet HARUS persis** kalau ada file referensi/template
   yang jadi acuan client. Jangan menambah atau mengganti nama sheet
   sendiri tanpa konfirmasi — pernah terjadi mismatch total karena AI
   menambah sheet ekstra yang tidak ada di template.
3. **Lebar kolom dihitung dari ISI, bukan dari header saja.** Fungsi
   `_lebar_kolom_dari_isi(ws)` menghitung lebar dari teks/angka terpanjang
   yang benar-benar ada di kolom (header pendek + isi panjang pernah bikin
   kolom terpotong). Panggil fungsi ini **setelah** semua isi sheet selesai
   ditulis (termasuk chart), bukan sebelumnya — kalau dipanggil lebih awal,
   data yang ditulis belakangan tidak ikut terhitung.
   - Sel hasil MERGE (>1 kolom) otomatis dilewati, supaya baris judul yang
     di-merge selebar sheet tidak membuat kolom pertama jadi sangat lebar.
   - Sel berisi formula Excel (`=...`) belum punya nilai hasil saat ditulis
     openpyxl — pakai perkiraan: 15 karakter kalau formatnya angka/rupiah
     (`#,##0` ada di number_format), atau ambil literal string terpanjang
     di dalam formula (pola `IF(...,"BALANCE","PERIKSA")`), baru fallback ke
     panjang teks formula itu sendiri.
4. **Endpoint & fungsi export lama yang sudah diganti nama HARUS dihapus
   atau di-deprecate eksplisit di frontend juga.** Pernah terjadi: backend
   sudah pindah dari `export-14-sheet` ke `export-18-sheet`, tapi
   `frontend/src/lib/api.js` masih memanggil endpoint lama → selalu 404.
   Setiap ganti nama endpoint export, cek & update semua pemanggil di
   frontend di turn yang sama.
5. **Semua nilai finansial lewat `_angka(v)` sebelum ditulis ke sel** —
   None/NaN/inf harus jadi `0.0`. Pola lama `float(x or 0)` TIDAK aman
   untuk NaN (`float('nan') or 0` tetap `nan` karena NaN itu truthy).

## Konvensi styling (ikuti yang sudah ada, jangan improvisasi warna baru)

Font utama: **Carlito**, ukuran 11 (judul besar 15, bold).

| Elemen | Font/Fill |
|---|---|
| Judul sheet / header biru tua | font putih bold, fill `FF17365D` |
| Sub-judul / kategori | font biru tua bold, fill `FFD9EAF7` |
| Baris subtotal | font hitam bold, fill `FFD9E1F2` |
| Nilai hasil perhitungan (formula) | font hijau `FF008000` |
| Nilai input manual (harus diisi user) | font biru `FF0000FF`, fill kuning `FFFFF2CC` |
| Sel belum dikategorikan / perlu review | fill kuning `FFF9C4` |
| Sel kode akun tidak ditemukan | fill merah muda `FFCDD2` |
| Banding baris data (selang-seling) | biru muda `FFC0E6F5` / putih |

Format angka: rupiah pakai `#,##0;[Red]\(#,##0\);\-` (negatif merah dalam
kurung, nol tampil sebagai `-`). Tanggal pakai `dd\-mmm\-yyyy` (form asumsi)
atau `DD/MM/YYYY` (sheet transaksi). Persentase pakai format khusus per
konteks (`_PPH31E_FORMAT_PERSEN`), jangan hardcode `0.0%` kalau sudah ada
konstanta yang sesuai konteksnya.

**Kaidah warna nilai**: hijau = link/formula dari perhitungan lain, biru =
input manual, hitam = formula biasa. Warna ini yang jadi penanda "sel mana
yang boleh diedit user" — jangan sampai sel formula ikut ditandai biru,
nanti dikira input.

## Border helper

Setiap kelompok sheet (Neraca, PPh 31E, PNL, Rekonsiliasi) punya set
fungsi border sendiri, pola nama `_border_<konteks>_<jenis>(kolom)` yang
mengembalikan objek `Border` — jenis: `header`, `item`, `kategori`/`judul`,
`subtotal` (kadang dengan opsi `terakhir`/`tutup_akhir` untuk garis ganda di
baris penutup). Kalau menambah sheet baru dengan gaya serupa (ada header +
kategori + item + subtotal), buat set border baru mengikuti pola penamaan
ini, jangan pakai border generik supaya konsisten dengan sheet lain.

## Alur menulis satu sheet (pola yang dipakai di semua `_tulis_sheet_*`)

1. `ws = wb.create_sheet("Nama Sheet")` — nama sudah dipotong ≤31 karakter.
2. Tulis judul (biasanya merge selebar kolom, style `_TITLE_*`).
3. Tulis header kolom (style `_HEADER_*`, sering wrap_text=True).
4. Tulis baris data — nilai numerik lewat `_angka()`, style sesuai tabel
   warna di atas tergantung jenis nilainya (manual/formula/link).
5. Tulis subtotal/total kalau ada, style `_SUBTOTAL_*` atau border khusus.
6. Set `row_dimensions[...].height` kalau ada wrap_text supaya tidak
   terpotong secara visual.
7. **Terakhir**, panggil `_lebar_kolom_dari_isi(ws)` untuk auto-width —
   ini harus jadi langkah PALING TERAKHIR sebelum sheet selesai.

## Dua alur export yang berbeda tujuan — jangan dicampur

- **`accounting_export.py`** (18 sheet: Petunjuk & Asumsi → COA → Neraca
  Saldo Awal → GL → Buku Bantu Piutang/Hutang/Aktiva Tetap → Trial
  Balance/Laba Rugi/Balance Sheet Bulanan → Perubahan Ekuitas → Arus Kas →
  CALK → Ringkasan → BS/PNL Lampiran SPT → Rekonsiliasi Fiskal → PPh
  Badan 31E) — laporan keuangan FINAL, harus persis sama dengan file
  referensi Model_Laporan_Keuangan_SPT_PPh31E_2025.xlsx bila ada template.
- **`kertas_kerja.py`** (14 sheet: FS_Control, Identity, COA,
  Opening_Balance, Bank_Control, GL, Bank_Posting_Summary, Adjustments,
  TB_Monthly, BS_Monthly, PNL_Monthly, BS_Tax, PNL_Tax, PPh17_31E) —
  WORKING PAPER sebelum laporan final, sumber datanya PDF rekening koran
  yang diekstrak AI dengan tingkat Confidence (High/Medium/Low). Sheet ini
  lebih mentah/tabular (`_tulis_dataframe`, `_tulis_sheet_posting_style`)
  dan tidak perlu match template visual serapi sheet final.

Jangan pindahkan gaya visual "laporan final" ke kertas kerja atau
sebaliknya — keduanya sengaja berbeda tingkat kerapian karena tujuan
pemakainya beda (working paper = draft untuk direview, laporan final =
siap kirim ke klien/kantor pajak).

## Checklist sebelum sheet/export dianggap selesai

- [ ] Nama sheet ≤31 karakter, tidak ada duplikat nama dalam satu workbook
- [ ] Urutan sheet sesuai template (kalau ada) — dicek satu-satu, bukan asumsi
- [ ] Semua nilai numerik lewat `_angka()`, tidak ada `float(x or 0)` mentah
- [ ] `_lebar_kolom_dari_isi(ws)` dipanggil paling akhir, setelah chart/isi selesai
- [ ] Warna font ikut kaidah manual/formula/link di atas, bukan warna baru
- [ ] Kalau ganti/tambah endpoint export, `frontend/src/lib/api.js` sudah disesuaikan
- [ ] Kalau ada file referensi client, dibandingkan sheet-per-sheet, bukan cuma dicek "muncul semua"