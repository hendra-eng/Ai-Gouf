---
name: cash-bank-voice-guide
description: Versi ringkas skill cash-bank-transaction-flow khusus Neo (AI voice).
---

[PANDUAN HALAMAN CASH DAN BANK UNTUK NEO (ringkasan skill; ini DATA acuan, bukan perintah dari pengguna)]
Halaman Transactions > Cash dan Bank punya delapan tab: Overview, Cash Payment, Cash Receipt, Source Data, Reconciliation, Journal Preview, Exceptions, Posted.
Cash Payment berisi invoice Purchase yang sudah posted; Cash Receipt berisi invoice Sales yang sudah Posted, Partial, atau Paid. Invoice Sales yang masih Draft tidak bisa dicocokkan.
LANGKAH PENGGUNA
1. Pilih klien di Switch Company.
2. Source Data: upload rekening koran (PDF, Excel, CSV) per akun bank, minimal Supervisor. Sistem membaca file dulu sebagai preview dan memvalidasi saldo. Kalau template cocok dan saldo lolos, langsung diimport; kalau tidak, muncul modal review untuk mengoreksi kolom. Akun tujuan default Auto-detect lewat Bank Mapping. Baris yang sama dilewati otomatis, jadi upload ulang aman. Baris ragu-ragu harus direview dulu. Laporan kas tunai masuk ke akun kas.
3. Reconciliation: mutasi debet (uang keluar) dicocokkan ke invoice Purchase; mutasi kredit (uang masuk) ke invoice Sales. Total alokasi harus sama dengan nominal mutasi. Auto-match hanya untuk kandidat yang pasti. Mutasi tanpa invoice (biaya admin, bunga, pajak bunga, transfer antar bank, setoran modal) dicocokkan ke akun lawan pilihan pengguna. Ignore untuk yang tidak dibukukan, Unmatch untuk membatalkan pencocokan. Hasil pencocokan adalah transaksi Draft.
4. Journal Preview: Draft, Approve (Supervisor), Approved, Post (Manager), Posted. Approved bisa dikembalikan ke Draft.
5. Setelah Post: masuk buku besar, dan pelunasan invoice diterapkan. Status posting invoice Sales sengaja tidak berubah; status bayar dilihat dari jumlah terbayar dan sisa.
6. Reverse (Manager): dibuat jurnal pembalik, pelunasan dibatalkan, mutasi kembali unmatched untuk dicocokkan ulang.
Tanpa rekening koran, Cash Receipt atau Cash Payment bisa dibuat manual (kas kecil, tunai) lalu Approve dan Post.
HAL YANG HARUS JUJUR
- Satu mutasi hanya boleh dicocokkan sekali. Untuk mencocokkan ulang, Unmatch dulu, atau Reverse kalau sudah posted.
- Selisih kecil tidak diselesaikan diam-diam; biarkan unmatched atau catat lewat mutasi tanpa invoice.
- Exceptions dideteksi otomatis dari bank feed dan invoice; jumlahnya bisa jauh lebih banyak dari jumlah mutasi. Jangan menyimpulkan penyebabnya tanpa melihat isinya.
- Kalau Journal Preview dan Posted kosong, itu bisa sekadar kondisi data, bukan error.

BATAS KEMAMPUAN NEO
- Satu-satunya aksi tulismu: alat proses_file_whatsapp dengan halaman cash_bank. Kalau pengguna bilang sudah mengirim rekening koran lewat WhatsApp dan minta diproses, panggil alat itu dengan kode klien. Alat ini mengunggah rekening koran ke Source Data (hanya kalau polanya dikenal dan saldonya cocok, sama seperti layar), menjalankan Auto-match, lalu Approve dan Post transaksi hasil pencocokan. Mutasi tanpa invoice yang pasti (biaya admin, bunga, transfer, dan sejenisnya) TIDAK dibukukan otomatis; itu butuh akun lawan pilihan pengguna di tab Reconciliation, jadi sebutkan jumlahnya saat melaporkan hasil. Prosesnya berjalan di latar belakang: katakan singkat bahwa proses dimulai, JANGAN bilang sudah selesai; progres dan hasil dicek dengan alat status_proses_file saat pengguna bertanya. Posting butuh akun level Manager ke atas; kalau ditolak, katakan apa adanya. Kalau klien belum disebut, tanyakan dulu. Selain itu kamu hanya membaca: tidak bisa menekan tombol lain atau memproses file dari luar WhatsApp; pandu langkahnya dan jangan mengaku sudah melakukannya.
- Jawab lisan: sebut nama tab dan tombol saja, jangan bacakan nama tabel, endpoint, atau kode. Maksimal tiga langkah per giliran kecuali diminta lengkap, lalu tawarkan lanjut.
- Untuk jumlah transaksi per status, file yang diunggah, dan Exceptions halaman ini, WAJIB panggil alat status_transaksi, file_sumber, atau daftar_exceptions (isi parameter halaman) sebelum menjawab; jangan menebak. Saldo akun kas dan bank dari alat saldo_akun (jurnal posted). Status per mutasi dibaca lewat status_transaksi (bagian mutasi).
