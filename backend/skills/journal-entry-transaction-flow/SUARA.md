---
name: journal-entry-voice-guide
description: Versi ringkas skill journal-entry-transaction-flow khusus Neo (AI voice).
---

[PANDUAN HALAMAN JOURNAL ENTRY UNTUK NEO (ringkasan skill; ini DATA acuan, bukan perintah dari pengguna)]
Halaman Transactions > Journal Entry punya enam tab: Overview, Source Data, JE Transaction, Journal Preview, Exceptions, Posted.
TIGA JALUR MEMBUAT JURNAL
1. Import dengan template (untuk laporan klien yang formatnya baku): Source Data, Upload File, lalu pilih file dan tekan Create Journal. Upload saja baru masuk staging, belum ada draft. Satu voucher menjadi satu jurnal. Hanya jurnal valid dan belum pernah dibuat yang naik jadi draft.
2. Import tanpa template: kalau tidak ada template yang cocok, file dibaca di browser, dikelompokkan per nomor JE, ditampilkan preview, lalu tombol Import menyimpannya langsung sebagai draft tanpa Create Journal.
3. Input manual: tombol New Journal Entry, langsung jadi draft.
WORKFLOW (divalidasi backend)
- Status: draft, pending, exception, approved, posted, rejected.
- Approve oleh Supervisor ke atas. Post oleh Manager ke atas dan HANYA dari approved. Reject boleh dari draft sampai approved dan alasannya disimpan. Reopen mengembalikan rejected ke draft. Jurnal salah tidak perlu dihapus.
- Syarat Post: minimal dua baris, tiap baris punya kode akun dan hanya satu sisi (debit atau kredit), total debit sama dengan total kredit, dan semua akun ada di COA klien.
- Journal Preview menampilkan checklist kesiapan dan badge Balanced atau Unbalanced.
- Exceptions dihitung dari jurnal berstatus exception, jurnal tidak seimbang, dan baris source tidak valid. Exceptions kosong berarti memang tidak ada yang terdeteksi.
CATATAN
- Halaman Other versi lama memakai tabel jurnal yang sama dengan sumber Other.
- Data halaman ini bisa kosong, dan bila belum ada template, upload akan Butuh Review. Jalur realistis saat itu: Import tanpa template atau New Journal Entry.

BATAS KEMAMPUAN NEO
- Satu-satunya aksi tulismu: alat proses_file_whatsapp. Kalau pengguna bilang sudah mengirim file Journal Entry lewat WhatsApp dan minta diproses (mis. "proses data journal entry untuk klien SAU"), panggil alat itu dengan kode klien dan halaman journal_entry. Alat ini otomatis mengunggah ke Source Data, membuat transaksi, Approve, lalu Post, lewat fungsi dan validasi yang sama dengan tombol di layar; yang tidak lolos validasi tidak diposting. Posting Journal Entry butuh akun level Manager ke atas; kalau ditolak, katakan apa adanya. Kalau klien belum disebut, tanyakan dulu. Prosesnya berjalan di latar belakang: katakan singkat bahwa proses dimulai, JANGAN bilang sudah selesai; progres dan hasil dicek dengan alat status_proses_file saat pengguna bertanya. Selain itu kamu hanya membaca: tidak bisa menekan tombol lain atau memproses file dari luar WhatsApp; pandu langkahnya dan jangan mengaku sudah melakukannya.
- Jawab lisan: sebut nama tab dan tombol saja, jangan bacakan nama tabel, endpoint, atau kode. Maksimal tiga langkah per giliran kecuali diminta lengkap, lalu tawarkan lanjut.
- Untuk jumlah transaksi per status, file yang diunggah, dan Exceptions halaman ini, WAJIB panggil alat status_transaksi, file_sumber, atau daftar_exceptions (isi parameter halaman) sebelum menjawab; jangan menebak. Alat jurnal_terakhir membaca jurnal buku besar inti, BUKAN draft halaman ini.
