---
name: pdf-reading
description: "Pakai skill ini setiap kali AI perlu membaca/mengekstrak data dari file PDF yang diupload user — terutama rekening koran bank, tapi juga dokumen sumber lain (faktur, bukti potong, dsb). Berlaku untuk modules/akuntansi_ai.py (_baca_pdf_sebagai_lembar), modules/kertas_kerja.py (susun_gl_dari_pdf_rekening_koran), dan modules/tax_pdf_extractor.py. JANGAN dipakai untuk membuat/generate PDF baru — lihat skill pdf-writing untuk itu."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Membaca PDF Sumber (Rekening Koran & Dokumen Transaksi)

## Pilih jalur ekstraksi sesuai bentuk PDF

PDF yang dikirim user tidak semua punya struktur tabel yang sama. Selalu
coba jalur bertingkat, jangan langsung gagal di percobaan pertama:

1. **PDF dengan garis tabel/grid** (paling mudah) — `page.extract_tables()`
   lewat pdfplumber. Cocok untuk mayoritas rekening koran bank besar.
2. **PDF tanpa garis tabel** (mis. beberapa format BCA Tahapan) —
   `extract_tables()` akan gagal total/kosong. Jangan langsung raise error.
   Fallback ke ekstraksi berbasis **posisi kata** (`extract_words()` +
   cluster baris berdasarkan koordinat Y, lalu deteksi kolom dari posisi X)
   — pola ini sudah dipakai di `_ekstrak_pdf_rekening_koran_berbasis_posisi()`
   / `_ekstrak_pdf_berbasis_posisi()`.
3. **PDF hasil scan (gambar, bukan teks)** — perlu OCR dulu sebelum kedua
   jalur di atas bisa jalan sama sekali. Cek dulu apakah `extract_words()`
   mengembalikan apa-apa; kalau kosong total, itu tanda PDF-nya gambar.

**Urutan coba yang benar**: grid dulu → kalau baris hasil 0, baru coba
posisi-kata → kalau tetap 0, baru curiga PDF hasil scan. Jangan skip
jalur grid meski tahu sebagian besar PDF user format non-grid — PDF format
lama/lain tetap harus lewat jalur ini supaya tidak regresi.

## Hal yang wajib dicek per jenis dokumen, bukan diasumsikan

- **Jumlah kolom mutasi beda-beda per bank.** Sebagian bank punya kolom
  DEBIT/KREDIT terpisah, sebagian (mis. BCA) cuma 1 kolom "MUTASI" dengan
  suffix "DB" untuk menandai debit. Jangan asumsikan skema kolom sama
  untuk semua bank — deteksi dulu dari header, baru pilih parser.
- **Tahun transaksi sering tidak ada di badan tabel** — tanggal di baris
  transaksi biasanya cuma `dd/mm`. Ambil tahun dari header dokumen (mis.
  baris "PERIODE : ..."), bukan dari baris transaksi.
- **Selalu validasi hasil ekstraksi terhadap ringkasan resmi di
  footer/header PDF** (saldo awal, saldo akhir, total mutasi kredit/debit
  yang dicetak bank sendiri) — kalau total hasil parsing tidak cocok
  dengan angka resmi ini, tandai sebagai peringatan, jangan diamkan.
- **Setiap hasil ekstraksi butuh level Confidence** (High/Medium/Low)
  per baris, bukan per file — satu PDF bisa punya baris yang jelas
  terbaca dan baris yang meragukan (mis. nominal terpotong, deskripsi
  ambigu). Baris Confidence rendah harus ditandai untuk direview manual,
  jangan langsung diposting sebagai jurnal final.

## Cache hasil ekstraksi

Ekstraksi PDF (apalagi via posisi-kata) relatif mahal. Simpan hasil per
file berdasarkan **hash isi file**, bukan nama file (nama bisa berubah,
isi yang menentukan apakah perlu ekstrak ulang). Kalau file yang sama
diupload lagi, pakai cache, jangan proses ulang dari nol.

## Jangan duplikasi logic fallback

Kalau satu fungsi fallback (mis. ekstraksi posisi-kata) dipakai di lebih
dari satu modul (`akuntansi_ai.py` dan `kertas_kerja.py`), pindahkan jadi
satu fungsi bersama yang di-import, bukan disalin dua kali dengan nama
beda. Dua salinan identik saat ini gampang drift kalau ada bugfix di satu
sisi tapi lupa di sisi lain.

## Checklist sebelum ekstraksi dianggap selesai

- [ ] Jalur grid dicoba dulu, fallback posisi-kata hanya aktif kalau grid kosong
- [ ] Skema kolom (jumlah kolom mutasi, ada/tidaknya suffix DB/CR) dideteksi, bukan diasumsikan sama semua bank
- [ ] Tahun diambil dari header periode, bukan ditebak dari tanggal `dd/mm`
- [ ] Total hasil ekstraksi dibandingkan dengan saldo awal/akhir & total mutasi resmi di PDF
- [ ] Setiap baris punya level Confidence, baris Low ditandai untuk review manual
- [ ] Hasil ekstraksi di-cache berdasarkan hash isi file