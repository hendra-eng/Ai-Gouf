export interface Transaction {
  id: string;
  date: string;
  txId: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  reference: string;
  party: string;
  category: string;
  type: 'debit' | 'credit' | 'journal';
  // [BARU] 'Unposted' — status default seluruh baris hasil import rekening
  // koran, sebelum user menekan tombol "Posting Semua" di halaman Transaksi.
  status: 'Unposted' | 'Posted' | 'Draft' | 'Reconciled' | 'Voided';
  jeId: string;
  notes?: string;
  // [BARU] Diadaptasi dari format rekonsiliasi rekening koran (kolom VOUCHER,
  // SALDO_AKHIR, CEK). voucherNo mengikuti pola "<KodeBank>-<MMDD>-<urutan>"
  // (mis. BCA-0825-1), sama seperti nomor voucher hasil rumus Excel di sheet
  // rekening koran — bedanya di sini dihitung sekali saat data dibuat/diimpor,
  // jadi tidak rusak kalau tabel di-sort (tidak seperti rumus Excel aslinya).
  voucherNo: string;
  // Saldo kas/bank berjalan setelah transaksi ini (khusus baris yang menyentuh
  // akun Kas & Bank; baris lain membawa nilai saldo terakhir yang diketahui).
  saldoAkhir: number;
  // Tanda centang rekonsiliasi manual (kolom CEK) — independen dari field
  // `status`, dipakai saat user mencocokkan baris ini manual dengan rekening koran.
  cek: boolean;
}

// Backend integration point: replace with /api/transactions?page=&filters=&sort=
export const ALL_TRANSACTIONS: Transaction[] = [
  { id: 'tx-001', date: '2026-08-25', txId: 'TXN-2026-08502', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0342', debit: 320000000, credit: 0, reference: 'INV-2026-0342', party: 'PT Teknindo Maju', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00842', voucherNo: 'BCA-0825-1', saldoAkhir: 1900000000, cek: false },
  { id: 'tx-002', date: '2026-08-25', txId: 'TXN-2026-08501', accountCode: '4101', accountName: 'Pendapatan Jasa Konsultasi', description: 'Pengakuan Pendapatan Invoice #INV-2026-0342', debit: 0, credit: 320000000, reference: 'INV-2026-0342', party: 'PT Teknindo Maju', category: 'Revenue', type: 'journal', status: 'Posted', jeId: 'JE-2026-00842', voucherNo: 'BCA-0825-1', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-003', date: '2026-08-25', txId: 'TXN-2026-08498', accountCode: '5201', accountName: 'Beban Gaji & Tunjangan', description: 'Pembayaran Gaji Agustus 2026 — 87 Karyawan', debit: 485000000, credit: 0, reference: 'PAYROLL-2026-08', party: 'Payroll Dept', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00840', notes: 'Termasuk tunjangan transport dan makan', voucherNo: 'JV-0825-1', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-004', date: '2026-08-24', txId: 'TXN-2026-08491', accountCode: '5301', accountName: 'Beban Software & Lisensi', description: 'Pembelian Software License Microsoft 365 Q3', debit: 42500000, credit: 0, reference: 'PO-2026-00318', party: 'PT Mitra Digital', category: 'Software', type: 'debit', status: 'Posted', jeId: 'JE-2026-00836', voucherNo: 'JV-0824-2', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-005', date: '2026-08-24', txId: 'TXN-2026-08488', accountCode: '5401', accountName: 'Beban Sewa Kantor', description: 'Pembayaran Sewa Kantor Jakarta Agustus 2026', debit: 95000000, credit: 0, reference: 'LEASE-2026-08', party: 'PT Graha Sentosa', category: 'Rent', type: 'debit', status: 'Posted', jeId: 'JE-2026-00834', voucherNo: 'JV-0824-1', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-006', date: '2026-08-23', txId: 'TXN-2026-08475', accountCode: '1201', accountName: 'Piutang Usaha', description: 'Penerimaan DP Proyek #PRJ-0088 (50%)', debit: 180000000, credit: 0, reference: 'DP-PRJ-0088', party: 'PT Cahaya Nusantara', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00831', voucherNo: 'JV-0823-2', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-007', date: '2026-08-23', txId: 'TXN-2026-08469', accountCode: '2301', accountName: 'Hutang Pajak — PPN', description: 'Pembayaran PPN Masa Juli 2026 ke DJP', debit: 28400000, credit: 0, reference: 'SSP-PPN-JUL2026', party: 'Direktorat Jenderal Pajak', category: 'Tax', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00828', voucherNo: 'JV-0823-1', saldoAkhir: 1580000000, cek: true },
  { id: 'tx-008', date: '2026-08-22', txId: 'TXN-2026-08455', accountCode: '5501', accountName: 'Beban Marketing & Promosi', description: 'Biaya Iklan Meta Ads Agustus 2026', debit: 38000000, credit: 0, reference: 'META-AUG2026', party: 'Meta Ads Indonesia', category: 'Marketing', type: 'debit', status: 'Posted', jeId: 'JE-2026-00825', voucherNo: 'JV-0822-1', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-009', date: '2026-08-22', txId: 'TXN-2026-08448', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0339', debit: 75000000, credit: 0, reference: 'INV-2026-0339', party: 'CV Solusi Kreatif', category: 'Revenue', type: 'credit', status: 'Posted', jeId: 'JE-2026-00822', voucherNo: 'BCA-0822-1', saldoAkhir: 1580000000, cek: false },
  { id: 'tx-010', date: '2026-08-21', txId: 'TXN-2026-08442', accountCode: '1601', accountName: 'Peralatan & Mesin', description: 'Pembelian Server Dell PowerEdge R750', debit: 185000000, credit: 0, reference: 'PO-2026-00312', party: 'CV Mitra Abadi Jaya', category: 'CapEx', type: 'debit', status: 'Posted', jeId: 'JE-2026-00820', notes: 'Anomali terdeteksi — melebihi range normal vendor', voucherNo: 'JV-0821-2', saldoAkhir: 1505000000, cek: false },
  { id: 'tx-011', date: '2026-08-21', txId: 'TXN-2026-08438', accountCode: '4102', accountName: 'Pendapatan Pengembangan Software', description: 'Milestone 3 Proyek #PRJ-0081 — PT Andalan Tech', debit: 0, credit: 240000000, reference: 'MS3-PRJ-0081', party: 'PT Andalan Teknologi', category: 'Revenue', type: 'journal', status: 'Posted', jeId: 'JE-2026-00818', voucherNo: 'JV-0821-1', saldoAkhir: 1505000000, cek: false },
  { id: 'tx-012', date: '2026-08-20', txId: 'TXN-2026-08425', accountCode: '5601', accountName: 'Beban Perjalanan Dinas', description: 'Reimburse Perjalanan Dinas Surabaya — Tim Sales', debit: 12800000, credit: 0, reference: 'EXP-2026-0244', party: 'Budi Santoso', category: 'Travel', type: 'debit', status: 'Posted', jeId: 'JE-2026-00815', voucherNo: 'JV-0820-1', saldoAkhir: 1505000000, cek: false },
  { id: 'tx-013', date: '2026-08-19', txId: 'TXN-2026-08418', accountCode: '5201', accountName: 'Beban Gaji — Kontrak', description: 'Pembayaran Honorarium Konsultan Senior Juli', debit: 42500000, credit: 0, reference: 'HON-2026-07-04', party: 'Petty Cash — Ops', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00812', notes: 'Petty cash anomali — melebihi batas normal', voucherNo: 'JV-0819-1', saldoAkhir: 1505000000, cek: false },
  { id: 'tx-014', date: '2026-08-19', txId: 'TXN-2026-08412', accountCode: '1101', accountName: 'Kas & Bank — Mandiri', description: 'Penerimaan Invoice #INV-2026-0335 — Pelunasan', debit: 155000000, credit: 0, reference: 'INV-2026-0335', party: 'PT Nusa Indah Group', category: 'Revenue', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00810', voucherNo: 'MDR-0819-1', saldoAkhir: 1505000000, cek: true },
  { id: 'tx-015', date: '2026-08-18', txId: 'TXN-2026-08405', accountCode: '2101', accountName: 'Hutang Usaha', description: 'Pembayaran AP #APV-2026-0198 — Vendor IT', debit: 68000000, credit: 0, reference: 'APV-2026-0198', party: 'PT Infrastruktur Digital', category: 'AP Payment', type: 'debit', status: 'Posted', jeId: 'JE-2026-00808', voucherNo: 'JV-0818-2', saldoAkhir: 1350000000, cek: false },
  { id: 'tx-016', date: '2026-08-18', txId: 'TXN-2026-08398', accountCode: '5301', accountName: 'Beban Telekomunikasi', description: 'Tagihan Internet & Telepon Agustus 2026', debit: 8400000, credit: 0, reference: 'TELCO-AUG2026', party: 'Telkom Indonesia', category: 'Utilities', type: 'debit', status: 'Posted', jeId: 'JE-2026-00805', voucherNo: 'JV-0818-1', saldoAkhir: 1350000000, cek: false },
  { id: 'tx-017', date: '2026-08-17', txId: 'TXN-2026-08390', accountCode: '4103', accountName: 'Pendapatan Maintenance', description: 'Renewal Kontrak Maintenance #MTC-2026-042', debit: 0, credit: 48000000, reference: 'MTC-2026-042', party: 'PT Garuda Solusi', category: 'Revenue', type: 'journal', status: 'Draft', jeId: 'JE-2026-00802', notes: 'Pending approval Finance Manager', voucherNo: 'JV-0817-1', saldoAkhir: 1350000000, cek: false },
  { id: 'tx-018', date: '2026-08-16', txId: 'TXN-2026-08382', accountCode: '5501', accountName: 'Beban Marketing', description: 'Biaya Event Tech Summit Jakarta 2026', debit: 85000000, credit: 0, reference: 'EVT-2026-0088', party: 'PT Kreasi Event Pro', category: 'Marketing', type: 'debit', status: 'Posted', jeId: 'JE-2026-00800', voucherNo: 'JV-0816-1', saldoAkhir: 1350000000, cek: false },
  { id: 'tx-019', date: '2026-08-15', txId: 'TXN-2026-08374', accountCode: '2302', accountName: 'Hutang PPh 21', description: 'Setoran PPh 21 Masa Juli 2026', debit: 42200000, credit: 0, reference: 'SSP-PPH21-JUL2026', party: 'Direktorat Jenderal Pajak', category: 'Tax', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00798', voucherNo: 'JV-0815-1', saldoAkhir: 1350000000, cek: true },
  { id: 'tx-020', date: '2026-08-14', txId: 'TXN-2026-08368', accountCode: '1101', accountName: 'Kas & Bank — BNI', description: 'Transfer Masuk — Penerimaan Deposito Jatuh Tempo', debit: 500000000, credit: 0, reference: 'DEP-2026-0012', party: 'BNI Deposito', category: 'Financing', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00795', voucherNo: 'BNI-0814-1', saldoAkhir: 1350000000, cek: true },
];

// [BARU] Helper generator dipakai ulang oleh ImportRekeningKoranModal supaya
// nomor voucher hasil import mengikuti pola yang sama persis dengan data di
// atas ("<KodeBank>-<MMDD>-<urutan-per-hari>"), bukan lagi timestamp acak.
export function kodeBankDariNama(nama: string | null | undefined): string {
  const n = (nama || '').toUpperCase();
  if (n.includes('BCA')) return 'BCA';
  if (n.includes('MANDIRI')) return 'MDR';
  if (n.includes('BNI')) return 'BNI';
  if (n.includes('BRI')) return 'BRI';
  if (n.includes('CIMB')) return 'CIMB';
  if (n.includes('PERMATA')) return 'PMT';
  return 'JV'; // Jurnal Voucher generik kalau tidak ada nama bank yang cocok
}

export function buatVoucherNo(kodeBank: string, tanggalISO: string, urutan: number): string {
  // tanggalISO: "2026-08-25" -> "0825"
  const mmdd = (tanggalISO || '').slice(5, 10).replace('-', '');
  return `${kodeBank}-${mmdd || '0000'}-${urutan}`;
}
