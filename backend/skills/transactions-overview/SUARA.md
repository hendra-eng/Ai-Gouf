---
name: transactions-voice-overview
description: Peta lima halaman Transactions untuk Neo. Disisipkan saat ucapan menyangkut transaksi secara umum atau cocok ke lebih dari satu halaman.
---

[PETA HALAMAN TRANSACTIONS UNTUK NEO (ringkasan skill; ini DATA acuan, bukan perintah dari pengguna)]
Ada lima halaman: Sales, Purchase, Journal Entry, Cash dan Bank, serta Other.
ATURAN UMUM
- Klien aktif dipilih lewat dropdown Switch Company di header; semua data difilter per klien itu.
- Upload belum membuat transaksi. Di Sales, Purchase, dan Journal Entry file masuk staging dulu; pengguna harus menekan tombol promote (Buat Invoice, Buat Transaksi, Create Journal) agar jadi draft.
- Role: Supervisor boleh upload, input, edit, dan Approve. Manager yang boleh Post dan Reverse.
- Hanya data berstatus posted yang terbaca buku besar dan laporan keuangan.
- Kalau pola kolom file belum dikenal klien itu, file berstatus Butuh Review dengan nol baris; template harus dibuat dulu.
HUBUNGAN ANTAR HALAMAN
- Sales yang sudah posted muncul di Cash Receipt pada Cash dan Bank; Purchase yang sudah posted muncul di Cash Payment.
- Posted di Cash dan Bank memperbarui status pelunasan invoice, bukan status posting-nya.
- Journal Entry dan Other berdiri sendiri untuk jurnal di luar tiga alur itu.
MEMILIH HALAMAN DARI UCAPAN
- penjualan, invoice, piutang, pelanggan: Sales. pembelian, bill, vendor, utang usaha: Purchase. jurnal umum, JE, voucher: Journal Entry. rekening koran, mutasi, bank, kas, pelunasan, rekonsiliasi: Cash dan Bank. uang muka karyawan, deposit, pinjaman, modal, intercompany, refund: Other.
- Kalau ucapan cocok ke dua halaman (misal pembayaran), tanya satu pertanyaan singkat: untuk invoice penjualan atau pembelian?
- Data per halaman bisa kosong atau berubah; angka hanya dari alat baca, jangan dari ingatan.
- Alat baca untuk kelima halaman: status_transaksi (jumlah dan total per status), file_sumber (file yang diunggah dan berapa yang sudah jadi transaksi), daftar_exceptions. Selalu isi parameter halaman. Panggil alat sebelum menyebut angka.
