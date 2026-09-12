const { pisahkanTransaksiDuplikat, signatureEntriJurnal } = require('./transactionData.js');

let gagal = 0;
function assert(kondisi, pesan) {
  if (!kondisi) {
    console.error(`❌ GAGAL: ${pesan}`);
    gagal++;
  } else {
    console.log(`✅ OK: ${pesan}`);
  }
}

// Helper: bikin sepasang baris Transaction (kaki debet + kredit) untuk 1 entri jurnal.
function buatEntri(jeId, tanggal, akunDebet, akunKredit, nominal, keterangan) {
  return [
    {
      id: `${jeId}-D`, date: tanggal, txId: `TXN-${jeId}`, accountCode: akunDebet,
      accountName: 'Akun Debet', description: keterangan, debit: nominal, credit: 0,
      reference: 'BCA', party: 'BCA', category: 'Other', type: 'debit', status: 'Unposted',
      jeId, voucherNo: `V-${jeId}`, saldoAkhir: 0, cek: false,
    },
    {
      id: `${jeId}-K`, date: tanggal, txId: `TXN-${jeId}`, accountCode: akunKredit,
      accountName: 'Akun Kredit', description: keterangan, debit: 0, credit: nominal,
      reference: 'BCA', party: 'BCA', category: 'Other', type: 'credit', status: 'Unposted',
      jeId, voucherNo: `V-${jeId}`, saldoAkhir: 0, cek: false,
    },
  ];
}

// ─── SKENARIO 1: Upload file yang SAMA persis 2x (kasus utama A2) ──────────
// txId/jeId beda (batchTag baru tiap sesi import), tapi isi (tanggal, akun,
// nominal, keterangan) identik -> HARUS terdeteksi 100% duplikat.
{
  const existing = [
    ...buatEntri('JE-IMPORT-abc-1', '2026-09-01', '1101', '4101', 5000000, 'Pembayaran Invoice #001'),
    ...buatEntri('JE-IMPORT-abc-2', '2026-09-02', '1101', '4101', 3000000, 'Pembayaran Invoice #002'),
  ];
  const rowsBaru = [
    ...buatEntri('JE-IMPORT-xyz-1', '2026-09-01', '1101', '4101', 5000000, 'Pembayaran Invoice #001'),
    ...buatEntri('JE-IMPORT-xyz-2', '2026-09-02', '1101', '4101', 3000000, 'Pembayaran Invoice #002'),
  ];
  const hasil = pisahkanTransaksiDuplikat(rowsBaru, existing);
  assert(hasil.jumlahKemungkinanDuplikat === 2, `Skenario 1 (file identik): jumlahKemungkinanDuplikat harus 2, dapat ${hasil.jumlahKemungkinanDuplikat}`);
  assert(hasil.entriBaru.length === 0, `Skenario 1: entriBaru harus kosong, dapat ${hasil.entriBaru.length} baris`);
}

// ─── SKENARIO 2: Revisi sebagian -- file baru = 2 baris lama + 1 baris baru ─
{
  const existing = [
    ...buatEntri('JE-IMPORT-abc-1', '2026-09-01', '1101', '4101', 5000000, 'Pembayaran Invoice #001'),
    ...buatEntri('JE-IMPORT-abc-2', '2026-09-02', '1101', '4101', 3000000, 'Pembayaran Invoice #002'),
  ];
  const rowsBaru = [
    ...buatEntri('JE-IMPORT-xyz-1', '2026-09-01', '1101', '4101', 5000000, 'Pembayaran Invoice #001'), // duplikat
    ...buatEntri('JE-IMPORT-xyz-2', '2026-09-02', '1101', '4101', 3000000, 'Pembayaran Invoice #002'), // duplikat
    ...buatEntri('JE-IMPORT-xyz-3', '2026-09-03', '1101', '4101', 7000000, 'Pembayaran Invoice #003'), // BARU
  ];
  const hasil = pisahkanTransaksiDuplikat(rowsBaru, existing);
  assert(hasil.jumlahKemungkinanDuplikat === 2, `Skenario 2 (revisi sebagian): jumlahKemungkinanDuplikat harus 2, dapat ${hasil.jumlahKemungkinanDuplikat}`);
  assert(hasil.entriBaru.length === 2, `Skenario 2: entriBaru harus 2 baris (1 entri x 2 kaki), dapat ${hasil.entriBaru.length}`);
  assert(hasil.entriBaru.every(r => r.jeId === 'JE-IMPORT-xyz-3'), `Skenario 2: entriBaru harus cuma berisi entri #003`);
}

// ─── SKENARIO 3: Transaksi lain yang KEBETULAN mirip tapi beda tanggal ─────
// Tidak boleh false-positive.
{
  const existing = [
    ...buatEntri('JE-IMPORT-abc-1', '2026-09-01', '1101', '4101', 5000000, 'Transfer Masuk'),
  ];
  const rowsBaru = [
    ...buatEntri('JE-IMPORT-xyz-1', '2026-09-05', '1101', '4101', 5000000, 'Transfer Masuk'), // tanggal beda
  ];
  const hasil = pisahkanTransaksiDuplikat(rowsBaru, existing);
  assert(hasil.jumlahKemungkinanDuplikat === 0, `Skenario 3 (tanggal beda): tidak boleh dianggap duplikat, dapat ${hasil.jumlahKemungkinanDuplikat}`);
  assert(hasil.entriBaru.length === 2, `Skenario 3: kedua baris (1 entri) harus masuk entriBaru`);
}

// ─── SKENARIO 4: reference sama (nama bank) tapi isi beda total ───────────
// Ini justru skenario yang GAGAL kalau pakai `reference` literal seperti
// draf awal rencana A2 -- harus dipastikan TIDAK false-positive di sini.
{
  const existing = [
    ...buatEntri('JE-IMPORT-abc-1', '2026-08-01', '1101', '4101', 1000000, 'Setoran Tunai'),
  ];
  const rowsBaru = [
    ...buatEntri('JE-IMPORT-xyz-1', '2026-08-15', '1101', '5201', 9999999, 'Pembayaran Gaji'), // reference sama-sama 'BCA', isi beda total
  ];
  const hasil = pisahkanTransaksiDuplikat(rowsBaru, existing);
  assert(hasil.jumlahKemungkinanDuplikat === 0, `Skenario 4 (reference sama, isi beda): tidak boleh false-positive, dapat ${hasil.jumlahKemungkinanDuplikat}`);
}

// ─── SKENARIO 5: keterangan beda kapitalisasi/spasi -- harus tetap match ──
{
  const existing = buatEntri('JE-IMPORT-abc-1', '2026-09-01', '1101', '4101', 5000000, 'Pembayaran  Invoice #001');
  const rowsBaru = buatEntri('JE-IMPORT-xyz-1', '2026-09-01', '1101', '4101', 5000000, 'PEMBAYARAN INVOICE #001');
  const hasil = pisahkanTransaksiDuplikat(rowsBaru, existing);
  assert(hasil.jumlahKemungkinanDuplikat === 1, `Skenario 5 (beda kapitalisasi/spasi ganda): harus tetap terdeteksi sama, dapat ${hasil.jumlahKemungkinanDuplikat}`);
}

console.log(gagal === 0 ? '\n=== SEMUA TEST LOLOS ===' : `\n=== ${gagal} TEST GAGAL ===`);
process.exit(gagal === 0 ? 0 : 1);