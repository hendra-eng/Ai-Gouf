---
name: docx-writing
description: "Pakai skill ini setiap kali AI akan membuat atau mengedit file Word (.docx) untuk aplikasi ini — misalnya CALK (calk_export.py, docx sebelum dikonversi ke PDF), versi editable dari memo pajak, surat ke klien, atau laporan naratif yang perlu diedit lebih lanjut oleh akuntan sebelum dikirim. Kalau dokumennya untuk DICETAK/dikirim final tanpa perlu diedit lagi, pertimbangkan pdf-writing sebagai gantinya (yang di codebase ini juga dibangun DI ATAS docx — lihat catatan alur di bawah)."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Membuat Dokumen Word (CALK, Memo, Surat, Laporan Naratif)

## Implementasi nyata sudah ada: `calk_export.py`

Beda dari versi sebelumnya skill ini ("belum ada implementasi") — sekarang
ADA implementasi matang di `modules/calk_export.py` (export CALK dwibahasa
ID/EN, 2174 baris). Semua pola di bawah diambil dari situ, bukan starting
point kosong lagi.

**Alur penting yang mungkin belum jelas dari nama skill:** docx di sini
BUKAN selalu produk akhir. `calk_export.export_calk()` membuat docx DULU
(`Document()` → susun semua note → `doc.save()`), LALU convert ke PDF lewat
LibreOffice headless (lihat skill `pdf-writing` untuk detail convert-nya) —
**docx dan PDF dihasilkan dari satu proses yang sama**, bukan dua fungsi
terpisah yang bisa saling drift datanya. Kalau bikin dokumen dwibahasa/
terformat baru yang butuh versi PDF juga, ikuti alur ini: susun docx dulu
dengan skill ini, baru convert dengan pola di `pdf-writing`.

## Kapan Word, kapan PDF

- **Word (.docx)**: dokumen yang MASIH akan diedit manusia setelah
  digenerate AI — draf memo pajak untuk direview akuntan, surat yang
  perlu penyesuaian bahasa sebelum dikirim ke klien.
- **PDF**: dokumen final yang tidak akan diedit lagi — hasil cetak,
  lampiran resmi, sesuatu yang dikirim ke instansi pajak. Di codebase ini,
  versi PDF hampir selalu dibuat DARI docx yang sama (bukan digenerate
  terpisah) — lihat `pdf-writing`.

## Tool

`python-docx` (`from docx import Document`) untuk generate dari nol. Untuk
dokumen dengan letterhead resmi (nama kantor Gouf Consulting, alamat,
dsb), **mulai dari template `.docx` yang sudah ada** kalau tersedia dan isi
kontennya — jangan generate letterhead dari nol setiap kali.

## Pola styling yang terbukti benar (dari `calk_export.py`)

- **Set font eksplisit di level `run`, bukan andalkan default** — helper
  `_set_font(run, bold, italic, underline, size, font_name)` set
  `run.font.name`, `.size`, `.bold`, `.italic`, `.underline`, `.color.rgb`
  SETIAP kali menulis teks. Untuk font Asia/kompleks, set juga
  `w:eastAsia` di `rPr` lewat `OxmlElement` — python-docx polos tidak
  menjamin Word pakai font yang sama untuk semua karakter kalau ini
  dilewatkan.
- **Helper tulis-sel seragam** — fungsi kecil seperti `_cell_text(cell,
  text, bold, italic, align, size, border_top, border_bottom)` yang
  membungkus `cell.text = ""` → set paragraph alignment/spacing → add run
  → set font, dipanggil di SETIAP sel tabel. Jangan tulis `cell.text = ...`
  polos berulang-ulang di banyak tempat — bikin satu helper, styling jadi
  konsisten dan mudah diubah sekaligus.
- **Border sel untuk baris subtotal/total**: gaya "garis di ATAS baris
  total" (meniru laporan keuangan tercetak) diatur lewat parameter
  `border_top`/`border_bottom` (`None`/`'single'`/`'double'`) di helper
  tulis-sel, bukan border generik seragam semua sel.
- **Margin & layout halaman diatur di entry point, bukan di fungsi
  per-section** — lihat detail di skill `pdf-writing` bagian "Konsistensi
  dengan gaya dokumen lain".

## Struktur standar dokumen kantor (memo/surat pajak)

1. **Kop surat** — nama kantor, alamat, kontak (dari template, bukan
   di-generate ulang).
2. **Identitas dokumen** — nomor referensi, tanggal, nama client, perihal.
3. **Isi** — narasi + tabel angka kalau perlu. Tabel angka pajak sebaiknya
   pakai style tabel yang konsisten dengan tabel di Excel export (lihat
   skill `xlsx-export`) supaya tidak terasa beda produk. Untuk CALK
   spesifik: format dwibahasa 2-kolom (kolom Indonesia = periode berjalan,
   kolom Inggris = periode pembanding), angka menghadap tengah, label
   menghadap tepi luar — lihat `calk_export.py` untuk contoh pola tabel
   dwibahasa yang sudah jadi.
4. **Dasar hukum/sitasi** — sama seperti PDF, ambil dari `citation.py`/
   `tax_case_law.py`, jangan mengarang nomor pasal.
5. **Penutup** — nama & jabatan penandatangan, ruang tanda tangan.

## Teks boilerplate vs teks bebas (dwibahasa)

Kalau dokumen perlu versi Indonesia+Inggris berdampingan (seperti CALK):
- **Teks baku yang sama di setiap laporan** (label header, "Jumlah"/
  "Total", narasi hukum standar) — tulis manual dwibahasa langsung di
  kode. JANGAN panggil AI translate untuk ini tiap generate — boros biaya
  API dan hasilnya harus konsisten persis di semua laporan.
- **Teks bebas spesifik per klien** (mis. field "keterangan" custom yang
  diisi akuntan) — baru pakai AI translate, DENGAN cache per-string dan
  fallback tag `[EN?]` kalau API gagal. Detail lengkap pola ini ada di
  skill `pdf-writing` (karena letak fungsinya di modul yang sama,
  `calk_export.py`).

## Wajib: sanitasi nama file sebelum menulis ke disk

**[Bug nyata ditemukan & diperbaiki]** Kalau fungsi pembuat docx menerima
nama file dari input user/API (bukan konstanta internal), jangan pakai
langsung di `os.path.join()`. `export_calk()` di `calk_export.py`
sebelumnya menerima `nama_file_dasar` mentah dari request (`main.py`
membangunnya dari field string bebas tanpa validasi pola) — nilai berisi
`"../"` bisa membuat file docx tertulis di luar folder output yang
dimaksud. Sudah diperbaiki dengan sanitasi di awal fungsi:
```python
nama_file_dasar = os.path.basename(nama_file_dasar or "default")
nama_file_dasar = re.sub(r"[^A-Za-z0-9_\-]", "_", nama_file_dasar).strip("_") or "default"
```
Terapkan pola yang sama di setiap fungsi baru yang membuat docx/pdf dari
nama file yang berasal dari input luar.

## Hal yang sering jadi bug

- **Style Word yang tidak konsisten** kalau teks disisipkan tanpa
  menetapkan style paragraf/run eksplisit — selalu set lewat helper
  seperti `_set_font()`/`_cell_text()`, jangan andalkan default python-docx.
- **Tabel yang dibuat dari nol kehilangan border/formatting** — kalau
  menyisipkan ke template yang sudah ada tabelnya, copy struktur baris
  yang ada (`table.rows[0]`) daripada `table.add_row()` polos yang tidak
  mewarisi style.
- **Angka yang beda dari versi Excel/PDF** — tarik angka dari fungsi
  sumber yang sama (`laporan_keuangan.py`: `susun_neraca()`/
  `susun_laba_rugi()`), jangan hardcode salinan manual. `calk_export.py`
  secara eksplisit TIDAK menghitung ulang apa pun — dia cuma menyusun
  tampilan dari data yang sudah dihitung modul lain.
- **Nama file dari input user tidak disaring** (lihat bagian sanitasi di
  atas) — path traversal saat menulis file, bukan cuma saat download.

## Checklist sebelum dokumen Word dianggap selesai

- [ ] Kop surat & identitas dokumen lengkap (nomor ref, tanggal, client, perihal)
- [ ] Kalau ada template resmi kantor, dipakai — bukan generate dari nol
- [ ] Dasar hukum/sitasi diambil dari modul citation, bukan dikarang
- [ ] Angka konsisten dengan Excel/PDF export yang sama sumbernya —
      TIDAK dihitung ulang di modul docx, cuma ditampilkan
- [ ] Style paragraf/tabel diset eksplisit lewat helper, tidak mengandalkan default polos
- [ ] Font di-set juga untuk `w:eastAsia` kalau dokumen bisa memuat
      karakter non-Latin
- [ ] Nama file (kalau dari input user/API) sudah disaring sebelum
      dipakai di path penyimpanan
- [ ] Kalau dokumen dwibahasa: boilerplate manual di kode, cuma teks
      bebas yang lewat AI translate (dengan cache + fallback `[EN?]`)
- [ ] **Hasil sudah diverifikasi visual** lewat `scripts/verify_output.py`
      di skill `pdf-writing` (render → gambar → benar-benar dilihat) —
      docx yang "tidak error saat disimpan" belum tentu benar tampilannya;
      lihat bagian "WAJIB: verifikasi visual" di skill `pdf-writing` untuk
      alasan & cara pakainya (script yang sama dipakai untuk docx maupun PDF)

## Dependencies

`python-docx` (`Document`, `Pt`/`Cm`/`RGBColor` dari `docx.shared`,
`OxmlElement`/`qn` dari `docx.oxml` untuk atribut font tingkat-XML seperti
`w:eastAsia`) — lihat skill `pdf-writing` untuk dependency convert &
verifikasi (`soffice`, `poppler-utils`), karena docx di proyek ini hampir
selalu berakhir dikonversi ke PDF lewat pipeline yang sama.