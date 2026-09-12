# Cara menjalankan test verifikasi dedup

Test ini murni Node.js (tidak butuh Jest/Vitest — proyek frontend belum punya
test runner). Cukup TypeScript untuk compile `transactionData.ts`.

**Tidak perlu salinan file** — `tsc` di bawah langsung menunjuk ke file asli
di `src/app/transactions/components/transactionData.ts`, supaya kamu selalu
test versi yang beneran dipakai aplikasi (tidak ada 2 file yang bisa
kadaluarsa/tidak sinkron).

Jalankan dari folder `scripts/verify-dedup/` (root proyek Dashboardori):

```bash
cd scripts/verify-dedup

# Compile file asli di src/ jadi transactionData.js di folder ini juga
npx tsc ../../src/app/transactions/components/transactionData.ts \
  --target ES2019 --module commonjs --outDir .

node test-dedup.js
```

Kalau semua lolos, keluar `=== SEMUA TEST LOLOS ===` dan exit code 0.

Test ini mengecek 5 skenario: file identik, revisi sebagian, tanggal beda
(harus TIDAK dianggap duplikat), reference sama tapi isi beda (harus TIDAK
false-positive), dan variasi kapitalisasi/spasi pada keterangan.

## Kalau sudah pernah punya salinan `transactionData.ts` di folder ini

Boleh dihapus — tidak dipakai lagi dengan cara di atas:

```bash
rm scripts/verify-dedup/transactionData.ts
```

Struktur folder yang berlaku sekarang cukup:

```
scripts/
└── verify-dedup/
    ├── test-dedup.js
    ├── CARA_JALANKAN.md
    └── transactionData.js   (hasil compile, boleh di-.gitignore-kan)
```