---
name: pdf-writing
description: "Pakai skill ini setiap kali AI akan MEMBUAT file PDF baru untuk aplikasi ini — misalnya CALK (calk_export.py), memo pajak (tax_memo.py), ringkasan laporan keuangan versi cetak, atau dokumen lain yang dikirim ke user sebagai .pdf. JANGAN dipakai untuk membaca/mengekstrak PDF yang diupload user — lihat skill pdf-reading untuk itu."
license: Internal — proyek AI Akuntansi Gouf Consulting
---

# Membuat PDF (CALK, Memo Pajak, Ringkasan, Dokumen Cetak)

## Cara PDF sungguhan dibuat di codebase ini (bukan reportlab)

`calk_export.py` (satu-satunya modul yang sudah generate PDF sungguhan
sejauh ini) **TIDAK** memakai reportlab/weasyprint/pypdf. Polanya:

1. Susun dokumen dengan `python-docx` (`Document()`, styling manual per
   run/paragraf/tabel).
2. `doc.save(path_docx)`.
3. Convert docx → PDF lewat **LibreOffice headless**:
   `subprocess.run(["soffice", "--headless", "--convert-to", "pdf", ...])`.

Ini pola yang SUDAH terverifikasi jalan (dipakai juga di `scripts/recalc.py`)
— kalau bikin modul PDF baru yang isinya dokumen terformat (bukan tabel data
Excel), **ikuti pola ini dulu** (docx → soffice convert) sebelum
mempertimbangkan reportlab dari nol. Reportlab/weasyprint/pypdf belum
pernah dipakai di proyek ini sama sekali — jangan asumsikan salah satu dari
itu "sudah ada" tanpa cek ulang ke kode.

| Kebutuhan | Tool yang benar-benar dipakai di sini |
|---|---|
| Dokumen terformat (CALK, memo, laporan naratif+tabel) | `python-docx` untuk susun isi → `soffice --headless --convert-to pdf` untuk convert |
| Isi form PDF yang sudah ada (mis. formulir SPT) | belum ada implementasinya — kalau dibutuhkan, `pypdf`/`pdfrw` isi field, JANGAN generate dari nol kalau formulir resminya sudah ada sbg template |

## Wajib: sanitasi nama file SEBELUM ditulis ke disk

**[Bug nyata ditemukan & diperbaiki di `calk_export.py`]** `export_calk()`
menerima `nama_file_dasar` dari pemanggil (`main.py` membangunnya dari
`req.periode_now`, field string bebas tanpa validasi pola di
`CalkGenerateRequest`), lalu dipakai langsung di
`os.path.join(output_dir, f"{nama_file_dasar}.docx")`. **Tanpa disaring**,
nilai seperti `"../../../tmp/x"` bisa membuat file tertulis KELUAR dari
`output_dir` (path traversal saat MENULIS, bukan cuma saat download).

Endpoint download (`/api/unduh/{nama_file}` di `main.py`) sudah benar
(`Path(nama_file).name`) — tapi sisi TULIS sebelumnya tidak disaring sama
sekali. Sudah diperbaiki: `nama_file_dasar` sekarang di-`os.path.basename()`
lalu di-strip ke `[A-Za-z0-9_-]` saja sebelum dipakai jadi nama file.

**Aturan wajib untuk semua fungsi PDF/docx baru yang menerima nama file
dari input user/API (bukan konstanta internal):** sanitasi nama file di
titik paling awal fungsi write, dengan pola yang sama:
```python
nama_file_dasar = os.path.basename(nama_file_dasar or "default")
nama_file_dasar = re.sub(r"[^A-Za-z0-9_\-]", "_", nama_file_dasar).strip("_") or "default"
```
Jangan andalkan validasi di sisi caller (endpoint) saja — fungsi generate
sendiri harus aman dipanggil langsung (mis. dari script/test) tanpa
bergantung pada caller yang "pasti" sudah membersihkan.

## Wajib: profil LibreOffice unik per konversi (concurrent-safe)

**[Bug nyata ditemukan & diperbaiki]** `soffice --headless` secara default
memakai satu *user installation* (profil) yang sama untuk semua proses di
mesin yang sama. Kalau dua PDF digenerate BERSAMAAN (dua supervisor beda
client di waktu yang sama, atau retry sebelum request lama selesai),
proses `soffice` kedua bisa gagal/hang karena rebutan lock profil — ini
bug klasik LibreOffice headless di server multi-user, bukan skenario
langka untuk endpoint yang bisa dipanggil kapan saja.

Fix wajib untuk setiap pemanggilan `soffice --convert-to`:
```python
profil_temp = os.path.join(tempfile.gettempdir(), f"lo_profile_{uuid.uuid4().hex}")
subprocess.run(["soffice", f"-env:UserInstallation=file://{profil_temp}",
                 "--headless", "--convert-to", "pdf", "--outdir", output_dir, path_docx], ...)
# lalu shutil.rmtree(profil_temp, ignore_errors=True) di finally
```
Jangan panggil `soffice --headless` polos tanpa `-env:UserInstallation`
unik kalau fungsinya bisa dipanggil concurrent oleh lebih dari satu
request — sekali kejadian lock, gejalanya "kadang gagal kadang tidak"
yang susah direproduksi manual.

## WAJIB: verifikasi visual setelah generate — jangan cuma cek "tidak error"

**[Kesalahan struktural yang sebelumnya luput dari skill ini]** Skill docx
bawaan Claude sendiri (`/mnt/skills/public/docx/SKILL.md`) punya langkah
eksplisit "Verify the output": setelah menulis file, RENDER dan LIHAT
hasilnya — bukan cuma percaya karena kode jalan tanpa exception. Skill ini
sebelumnya tidak punya langkah itu sama sekali, padahal risikonya nyata:
CALK bisa ~20 halaman dwibahasa dengan tabel kompleks — kolom kepotong,
teks tumpang tindih, angka jadi `#####` (kolom sempit), atau baris salah
align **tidak kelihatan dari membaca kode python-docx**. Kode bisa
"benar secara logis" (semua data terisi, tidak ada exception) tapi
hasil visualnya tetap rusak.

Pakai `scripts/verify_output.py` (dibundel bersama skill ini, pola sama
dengan `_convert_docx_ke_pdf()` di `calk_export.py`) setiap kali selesai
generate dokumen baru atau mengubah logic penulisan tabel/styling:
```bash
python scripts/verify_output.py CALK_client5_2026-07.docx
# atau kalau cuma mau cek beberapa halaman dulu:
python scripts/verify_output.py CALK_client5_2026-07.docx --pages 1,3
```
Script ini convert docx→PDF→gambar JPEG per halaman, lalu **kamu (AI)
WAJIB benar-benar melihat gambarnya** (pakai tool `view`) — bukan cuma
menjalankan script dan berhenti begitu keluar tanpa error. Cek minimal:
tabel tidak kepotong di tepi halaman, kolom Indonesia/Inggris sejajar,
tidak ada teks tumpang tindih, dan halaman terakhir tidak terpotong aneh.

**Jangan anggap tugas pembuatan dokumen selesai sampai langkah ini
dilakukan** — ini sama pentingnya dengan menjalankan test setelah menulis
kode, cuma bentuknya visual bukan assertion.

## Auto-translate ID→EN: hanya untuk teks bebas, bukan boilerplate

Pola di `calk_export.py` (`terjemahkan_id_ke_en()`) yang sudah terbukti
benar dan wajib diikuti untuk modul PDF dwibahasa lain:
- Teks boilerplate standar (label header, "Jumlah"/"Total", teks hukum
  baku yang sama di semua laporan) ditulis manual dwibahasa di kode —
  **bukan** lewat AI translate tiap generate. Alasan: lebih akurat
  (direview sekali), lebih cepat, tidak kena biaya API berulang untuk
  teks yang tidak pernah berubah.
- AI translate (lewat Anthropic API) HANYA dipakai untuk teks bebas/
  spesifik per klien (mis. field "keterangan" custom yang diisi akuntan)
  yang memang tidak bisa ditulis manual sebelumnya.
- Hasil terjemahan **wajib di-cache** per string persis (bukan per
  dokumen) — satu laporan bisa berisi puluhan baris teks bebas, dan
  laporan sering di-generate ulang.
- Kalau API key tidak ada/API gagal, **fallback ke teks asli + tag
  `[EN?]`** di depan — JANGAN diam-diam tampilkan teks Indonesia seolah
  itu versi Inggris, dan JANGAN gagalkan generate laporan hanya karena
  translate gagal. Dokumen tetap harus bisa keluar.

## Konsistensi dengan gaya dokumen lain di proyek ini

- **Font & warna ikuti konvensi yang sudah dipakai di Excel export**
  (lihat skill `xlsx-export`): biru tua `#17365D` untuk header/judul,
  hijau untuk angka hasil perhitungan, biru untuk catatan input manual —
  supaya dokumen PDF terasa satu keluarga visual dengan laporan Excel.
  (Catatan: CALK sendiri pakai gaya legal formal — Times New Roman, hitam
  polos, karena mengikuti template referensi CALK baku, bukan skema warna
  Excel. Sesuaikan konvensi warna ke jenis dokumennya: dokumen legal/CALK
  ikuti gaya CALK, dokumen ringkasan angka ikuti gaya Excel.)
- **Setiap angka hasil perhitungan pajak harus menyebut dasar hukumnya**
  (pasal/peraturan yang jadi rujukan) — proyek ini sudah punya modul
  `citation.py` dan `tax_case_law.py` untuk sitasi peraturan/putusan,
  pakai itu sebagai sumber teks sitasi, jangan mengarang referensi pasal.
- **Nomor halaman & watermark/header identitas client** wajib ada di
  setiap dokumen yang dikirim keluar — di `calk_export.py` ini dilakukan
  di `export_calk()` (entry point) lewat `_atur_footer_nomor_halaman(doc)`
  yang dipanggil SETELAH semua note ditulis, BUKAN di dalam
  orchestrator/tiap fungsi note — supaya orchestrator tetap bisa dipanggil
  terpisah (preview/testing) tanpa efek samping ke layout dokumen. Ikuti
  pemisahan ini: isi dokumen dan layout halaman (margin, footer, nomor
  halaman) adalah tanggung jawab yang beda, jangan dicampur satu fungsi.
- **Margin standar dokumen legal Indonesia** (`Cm(2.5)` atas/bawah,
  `Cm(2.0)` kiri/kanan) diset di entry point, sekali, untuk semua section
  — jangan set margin di dalam fungsi per-note.

## Hal yang sering jadi bug di PDF generation (waspadai dari awal)

- **Font non-Latin/karakter khusus (Rp, °, dsb)** tidak selalu didukung
  font bawaan — kalau pindah dari python-docx+soffice ke reportlab suatu
  saat, pastikan font yang dipakai mendukung simbol yang muncul di teks,
  uji dengan angka rupiah asli sebelum dianggap selesai.
- **Tabel yang meluber ke luar halaman** — kalau nanti pakai reportlab,
  tidak auto-wrap tabel antar-halaman kecuali eksplisit pakai `Table` dari
  platypus dengan `repeatRows` untuk header berulang tiap halaman baru.
  Untuk jalur python-docx+soffice yang dipakai sekarang, uji dokumen
  panjang (CALK bisa ~20 halaman) tetap terbaca wajar setelah convert PDF.
- **Total angka di PDF harus dihitung ulang dari sumber data**, bukan
  disalin manual — `calk_export.py` mengambil `neraca`/`laba_rugi` apa
  adanya dari `laporan_keuangan.py` (`susun_neraca()`/`susun_laba_rugi()`),
  TIDAK menghitung ulang apa pun sendiri. Modul PDF baru harus ikuti pola
  ini: terima data yang sudah dihitung, jangan hitung ulang di modul
  export supaya tidak ada dua versi angka yang beda antar format.
- **Konversi docx→PDF butuh binary `soffice` terpasang di server** — ini
  dependency infrastruktur, bukan cuma `pip install`. Kalau `soffice`
  tidak ada, `FileNotFoundError` harus ditangkap & dilaporkan jelas (docx
  tetap tersimpan, convert PDF gagal) — bukan 500 generik. Pola penanganan
  error yang benar (tangkap `FileNotFoundError`/`CalledProcessError`/
  `TimeoutExpired` terpisah, masing-masing pesan jelas) sudah ada di
  `_convert_docx_ke_pdf()`, ikuti pola ini untuk modul convert PDF lain.
- **Nama file dari input user harus disaring SEBELUM dipakai di path**
  (lihat bagian sanitasi di atas) — jangan asumsikan caller sudah bersihkan.
- **Konversi concurrent butuh profil LibreOffice terpisah** (lihat bagian
  di atas) — jangan panggil `soffice --headless` polos di endpoint yang
  bisa diakses banyak user sekaligus.

## Checklist sebelum PDF dianggap selesai

- [ ] Nama file (kalau berasal dari input user/API) sudah disaring lewat
      `os.path.basename()` + regex alfanumerik sebelum dipakai di path
- [ ] Kalau convert lewat `soffice --headless`, pakai `-env:UserInstallation`
      unik per panggilan + cleanup folder temp-nya
- [ ] Semua angka pajak menyebut dasar hukum/pasal rujukan
- [ ] Nomor halaman & identitas client muncul di setiap halaman, diatur di
      entry point (bukan di dalam fungsi per-note/per-section)
- [ ] Tabel panjang diuji tidak terpotong aneh saat pindah halaman
- [ ] Angka di PDF dicek konsisten dengan angka yang sama di Excel export
      (kalau ada) — diambil dari sumber data yang sama, tidak dihitung ulang
- [ ] Font mendukung karakter Rp dan simbol lain yang dipakai
- [ ] Teks bebas dwibahasa lewat AI translate dicache & ada fallback
      `[EN?]` kalau API gagal — boilerplate tetap manual, bukan AI translate
- [ ] Error `soffice` tidak ditemukan/gagal/timeout ditangani terpisah
      dengan pesan yang bisa ditindaklanjuti, bukan 500 generik
- [ ] **`scripts/verify_output.py` sudah dijalankan DAN hasil gambarnya
      benar-benar dilihat (bukan cuma "script tidak error")** — dokumen
      tidak dianggap selesai tanpa langkah ini

## Dependencies

`python-docx` (susun isi) · LibreOffice `soffice` (convert docx→PDF,
wajib binary terpasang di server, bukan cuma `pip install`) ·
`poppler-utils`/`pdftoppm` (dipakai `scripts/verify_output.py` untuk
render halaman jadi gambar saat verifikasi) · `requests` (panggil
Anthropic API untuk auto-translate teks bebas, opsional — fallback
`[EN?]` kalau tidak ada `ANTHROPIC_API_KEY`)