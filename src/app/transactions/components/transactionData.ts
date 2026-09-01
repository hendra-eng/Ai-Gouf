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

// ─── PENGELOMPOKAN KE 5 SUB HALAMAN TRANSAKSI ──────────────────────────────
// [BARU] Setiap baris transaksi di halaman Transaksi utama dikelompokkan ke
// salah satu dari 5 sub halaman (Sales, Expense, Cash Payment, Cash Reserve,
// Other) berdasarkan field `category`, bukan accountCode/accountName.
// Alasannya: `category` sudah berupa daftar nilai yang tetap/terbatas
// (Revenue, Payroll, Software, dst — lihat categoryColors di
// TransactionsTable.tsx), jadi jauh lebih konsisten & minim salah deteksi
// dibanding mem-parsing teks nama akun yang bervariasi. accountCode juga
// tidak cukup andal sendirian di sini karena satu digit awal (mis. "1xxx")
// bisa berarti Kas & Bank, Piutang, ATAU Aset Tetap sekaligus — tiga makna
// bisnis yang berbeda kelompok.
export type TransactionGroup = 'sales' | 'expense' | 'cash_payment' | 'cash_reserve' | 'other';

export const CATEGORY_TO_GROUP: Record<string, TransactionGroup> = {
  Revenue: 'sales',
  Payroll: 'expense',
  Software: 'expense',
  Rent: 'expense',
  Marketing: 'expense',
  Travel: 'expense',
  Utilities: 'expense',
  Tax: 'cash_payment',
  'AP Payment': 'cash_payment',
  Financing: 'cash_reserve',
  CapEx: 'other',
  'Software License': 'sales',
  'Consulting Services': 'sales',
  'Implementation': 'sales',
  'Training': 'sales',
  'Loan Repayment': 'cash_payment',
  'Payroll Payment': 'cash_payment',
  'Deposit Rollover': 'cash_reserve',
  'Reserve Transfer': 'cash_reserve',
  'Refund': 'other',
  'Adjustment': 'other',
  'Interest Income': 'other',
  'Owner Withdrawal': 'other',
};

// [BARU] Fallback KHUSUS untuk baris hasil "Import Rekening Koran" — baris
// itu semuanya diberi category: 'Import Rekening Koran' yang sama (lihat
// ImportRekeningKoranModal.tsx), jadi field `category` saja tidak cukup
// untuk membedakan sales/expense/dst pada data import. Sebagai gantinya kita
// baca `accountName` (nama akun hasil kategorisasi otomatis dari backend,
// mis. "Pendapatan Jasa Konsultasi" atau "Beban Sewa Kantor") dengan
// pencocokan kata kunci akuntansi standar.
function classifyByAccountName(accountName: string | undefined): TransactionGroup {
  const n = (accountName || '').toLowerCase();
  if (n.includes('pendapatan') || n.includes('piutang')) return 'sales';
  if (n.includes('beban')) return 'expense';
  if (n.includes('pajak') || n.includes('ppn') || n.includes('pph') || n.includes('hutang usaha') || n.includes('hutang dagang')) return 'cash_payment';
  if (n.includes('kas & bank') || n.includes('kas dan bank') || n.includes('deposito') || n.includes('giro') || n.includes('tabungan')) return 'cash_reserve';
  return 'other';
}

// Kategori baru/tidak dikenal (termasuk 'Import Rekening Koran') jatuh ke
// fallback nama akun, supaya tidak ada transaksi yang "hilang" / tidak
// tampil di sub halaman manapun, baik data statis maupun hasil import.
export function getTransactionGroup(tx: Transaction): TransactionGroup {
  return CATEGORY_TO_GROUP[tx.category] || classifyByAccountName(tx.accountName);
}

export const GROUP_LABELS: Record<TransactionGroup, string> = {
  sales: 'Sales',
  expense: 'Expense',
  cash_payment: 'Cash Payment',
  cash_reserve: 'Cash Reserve',
  other: 'Other',
};

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
  { id: 'tx-021', date: '2026-06-05', txId: 'TXN-2026-06105', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0601', debit: 145000000, credit: 0, reference: 'INV-2026-0601', party: 'PT Cahaya Nusantara', category: 'Software License', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00612', voucherNo: 'BCA-0605-1', saldoAkhir: 1290000000, cek: true },
  { id: 'tx-022', date: '2026-06-08', txId: 'TXN-2026-06118', accountCode: '4104', accountName: 'Pendapatan Lisensi Software', description: 'Penjualan Lisensi ERP — Paket Enterprise', debit: 0, credit: 220000000, reference: 'INV-2026-0608', party: 'PT Nusa Indah Group', category: 'Software License', type: 'journal', status: 'Posted', jeId: 'JE-2026-00618', voucherNo: 'JV-0608-1', saldoAkhir: 1300000000, cek: false },
  { id: 'tx-023', date: '2026-06-10', txId: 'TXN-2026-06124', accountCode: '4105', accountName: 'Pendapatan Konsultasi IT', description: 'Jasa Konsultasi Transformasi Digital — Fase 1', debit: 0, credit: 175000000, reference: 'INV-2026-0610', party: 'PT Karya Mandiri', category: 'Consulting Services', type: 'journal', status: 'Posted', jeId: 'JE-2026-00621', voucherNo: 'JV-0610-1', saldoAkhir: 1320000000, cek: false },
  { id: 'tx-024', date: '2026-06-12', txId: 'TXN-2026-06131', accountCode: '5201', accountName: 'Beban Gaji & Tunjangan', description: 'Pembayaran Gaji Juni 2026 — 85 Karyawan', debit: 460000000, credit: 0, reference: 'PAYROLL-2026-06', party: 'Payroll Dept', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00625', voucherNo: 'JV-0612-1', saldoAkhir: 1290000000, cek: false },
  { id: 'tx-025', date: '2026-06-14', txId: 'TXN-2026-06140', accountCode: '4106', accountName: 'Pendapatan Implementasi Sistem', description: 'ERP Implementation — Manufacturing Module Fase 1', debit: 0, credit: 450000000, reference: 'INV-2026-0614', party: 'PT Surya Gemilang', category: 'Implementation', type: 'journal', status: 'Posted', jeId: 'JE-2026-00630', voucherNo: 'JV-0614-1', saldoAkhir: 1740000000, cek: false },
  { id: 'tx-026', date: '2026-06-16', txId: 'TXN-2026-06152', accountCode: '2401', accountName: 'Hutang Bank — Cicilan', description: 'Cicilan Pinjaman Modal Kerja — Bank Mandiri', debit: 55000000, credit: 0, reference: 'LOAN-2026-06', party: 'Bank Mandiri', category: 'Loan Repayment', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00634', voucherNo: 'JV-0616-1', saldoAkhir: 1685000000, cek: true },
  { id: 'tx-027', date: '2026-06-18', txId: 'TXN-2026-06163', accountCode: '5501', accountName: 'Beban Marketing & Promosi', description: 'Kampanye Digital Marketing Q2 2026', debit: 32000000, credit: 0, reference: 'MKT-2026-0618', party: 'PT Digital Kreatif', category: 'Marketing', type: 'debit', status: 'Posted', jeId: 'JE-2026-00638', voucherNo: 'JV-0618-1', saldoAkhir: 1653000000, cek: false },
  { id: 'tx-028', date: '2026-06-20', txId: 'TXN-2026-06175', accountCode: '1103', accountName: 'Kas & Bank — Reserve Account', description: 'Transfer ke Rekening Cadangan Operasional', debit: 0, credit: 100000000, reference: 'RSV-2026-06', party: 'Internal Treasury', category: 'Reserve Transfer', type: 'journal', status: 'Posted', jeId: 'JE-2026-00641', voucherNo: 'JV-0620-1', saldoAkhir: 1553000000, cek: false },
  { id: 'tx-029', date: '2026-06-22', txId: 'TXN-2026-06188', accountCode: '4201', accountName: 'Pendapatan Bunga Bank', description: 'Bunga Deposito Bulan Juni 2026', debit: 0, credit: 3400000, reference: 'INT-BCA-2026-06', party: 'Bank BCA', category: 'Interest Income', type: 'credit', status: 'Posted', jeId: 'JE-2026-00645', voucherNo: 'BCA-0622-1', saldoAkhir: 1556400000, cek: true },
  { id: 'tx-030', date: '2026-06-25', txId: 'TXN-2026-06199', accountCode: '5601', accountName: 'Beban Perjalanan Dinas', description: 'Perjalanan Dinas Bandung — Tim Implementation', debit: 9500000, credit: 0, reference: 'EXP-2026-0619', party: 'Rina Kartika', category: 'Travel', type: 'debit', status: 'Posted', jeId: 'JE-2026-00649', voucherNo: 'JV-0625-1', saldoAkhir: 1546900000, cek: false },
  { id: 'tx-031', date: '2026-07-03', txId: 'TXN-2026-07103', accountCode: '4107', accountName: 'Pendapatan Pelatihan', description: 'Program Pelatihan Finance Module — 3 Hari', debit: 0, credit: 38000000, reference: 'INV-2026-0703', party: 'PT Abadi Jaya', category: 'Training', type: 'journal', status: 'Posted', jeId: 'JE-2026-00660', voucherNo: 'JV-0703-1', saldoAkhir: 1584900000, cek: false },
  { id: 'tx-032', date: '2026-07-05', txId: 'TXN-2026-07115', accountCode: '1101', accountName: 'Kas & Bank — BCA', description: 'Penerimaan Pembayaran Invoice #INV-2026-0701', debit: 175000000, credit: 0, reference: 'INV-2026-0701', party: 'PT Karya Mandiri', category: 'Consulting Services', type: 'credit', status: 'Reconciled', jeId: 'JE-2026-00664', voucherNo: 'BCA-0705-1', saldoAkhir: 1759900000, cek: true },
  { id: 'tx-033', date: '2026-07-08', txId: 'TXN-2026-07127', accountCode: '5301', accountName: 'Beban Software & Lisensi', description: 'Perpanjangan Lisensi Tahunan Adobe Creative Cloud', debit: 15500000, credit: 0, reference: 'PO-2026-00330', party: 'PT Mitra Digital', category: 'Software', type: 'debit', status: 'Posted', jeId: 'JE-2026-00668', voucherNo: 'JV-0708-1', saldoAkhir: 1744400000, cek: false },
  { id: 'tx-034', date: '2026-07-10', txId: 'TXN-2026-07138', accountCode: '2101', accountName: 'Hutang Usaha', description: 'Pembayaran AP #APV-2026-0205 — Vendor Furniture', debit: 54000000, credit: 0, reference: 'APV-2026-0205', party: 'PT Furnindo Utama', category: 'AP Payment', type: 'debit', status: 'Posted', jeId: 'JE-2026-00672', voucherNo: 'JV-0710-1', saldoAkhir: 1690400000, cek: false },
  { id: 'tx-035', date: '2026-07-12', txId: 'TXN-2026-07149', accountCode: '4104', accountName: 'Pendapatan Lisensi Software', description: 'Upgrade Lisensi Enterprise — 30 Seat Tambahan', debit: 0, credit: 125000000, reference: 'INV-2026-0712', party: 'PT Citra Persada', category: 'Software License', type: 'journal', status: 'Posted', jeId: 'JE-2026-00676', voucherNo: 'JV-0712-1', saldoAkhir: 1815400000, cek: false },
  { id: 'tx-036', date: '2026-07-15', txId: 'TXN-2026-07160', accountCode: '2201', accountName: 'Prive / Penarikan Pemilik', description: 'Penarikan Dividen Direktur — Triwulan II', debit: 95000000, credit: 0, reference: 'DIV-2026-Q2', party: 'Direktur — Budi Santoso', category: 'Owner Withdrawal', type: 'debit', status: 'Posted', jeId: 'JE-2026-00680', voucherNo: 'JV-0715-1', saldoAkhir: 1720400000, cek: false },
  { id: 'tx-037', date: '2026-07-17', txId: 'TXN-2026-07172', accountCode: '5201', accountName: 'Beban Gaji & Tunjangan', description: 'Pembayaran Gaji Juli 2026 — 86 Karyawan', debit: 472000000, credit: 0, reference: 'PAYROLL-2026-07', party: 'Payroll Dept', category: 'Payroll', type: 'debit', status: 'Posted', jeId: 'JE-2026-00684', voucherNo: 'JV-0717-1', saldoAkhir: 1248400000, cek: false },
  { id: 'tx-038', date: '2026-07-19', txId: 'TXN-2026-07184', accountCode: '2101', accountName: 'Hutang Usaha — Payroll Vendor', description: 'Pembayaran Jasa Payroll Outsourcing Juli', debit: 18500000, credit: 0, reference: 'PMT-2026-0719', party: 'PT Payroll Prima', category: 'Payroll Payment', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00688', voucherNo: 'JV-0719-1', saldoAkhir: 1229900000, cek: true },
  { id: 'tx-039', date: '2026-07-21', txId: 'TXN-2026-07196', accountCode: '4199', accountName: 'Retur / Refund Pendapatan', description: 'Refund Kelebihan Tagihan Proyek #PRJ-0075', debit: 8500000, credit: 0, reference: 'REF-2026-0721', party: 'PT Garuda Solusi', category: 'Refund', type: 'debit', status: 'Posted', jeId: 'JE-2026-00692', voucherNo: 'JV-0721-1', saldoAkhir: 1221400000, cek: false },
  { id: 'tx-040', date: '2026-07-24', txId: 'TXN-2026-07207', accountCode: '5401', accountName: 'Beban Sewa Kantor', description: 'Pembayaran Sewa Kantor Jakarta Juli 2026', debit: 95000000, credit: 0, reference: 'LEASE-2026-07', party: 'PT Graha Sentosa', category: 'Rent', type: 'debit', status: 'Posted', jeId: 'JE-2026-00696', voucherNo: 'JV-0724-1', saldoAkhir: 1126400000, cek: false },
  { id: 'tx-041', date: '2026-07-27', txId: 'TXN-2026-07219', accountCode: '1102', accountName: 'Kas & Bank — Deposito', description: 'Rollover Deposito Berjangka 3 Bulan', debit: 0, credit: 350000000, reference: 'DEP-2026-0727', party: 'Bank BNI', category: 'Deposit Rollover', type: 'journal', status: 'Reconciled', jeId: 'JE-2026-00700', voucherNo: 'BNI-0727-1', saldoAkhir: 1476400000, cek: true },
  { id: 'tx-042', date: '2026-07-29', txId: 'TXN-2026-07231', accountCode: '9001', accountName: 'Penyesuaian Akun', description: 'Reklasifikasi Biaya Digital Tools ke Departemen IT', debit: 6500000, credit: 0, reference: 'ADJ-2026-0729', party: 'Internal — Finance', category: 'Adjustment', type: 'debit', status: 'Posted', jeId: 'JE-2026-00704', voucherNo: 'JV-0729-1', saldoAkhir: 1469900000, cek: false },
  { id: 'tx-043', date: '2026-08-02', txId: 'TXN-2026-08215', accountCode: '4106', accountName: 'Pendapatan Implementasi Sistem', description: 'Cloud Migration Project — Fase Akhir', debit: 0, credit: 210000000, reference: 'INV-2026-0802', party: 'PT Inti Karya', category: 'Implementation', type: 'journal', status: 'Posted', jeId: 'JE-2026-00760', voucherNo: 'JV-0802-1', saldoAkhir: 1679900000, cek: false },
  { id: 'tx-044', date: '2026-08-05', txId: 'TXN-2026-08228', accountCode: '4107', accountName: 'Pendapatan Pelatihan', description: 'Pelatihan Lanjutan Modul Finance — Batch 2', debit: 0, credit: 42000000, reference: 'INV-2026-0805', party: 'PT Cahaya Timur', category: 'Training', type: 'journal', status: 'Posted', jeId: 'JE-2026-00765', voucherNo: 'JV-0805-1', saldoAkhir: 1721900000, cek: false },
  { id: 'tx-045', date: '2026-08-07', txId: 'TXN-2026-08240', accountCode: '2401', accountName: 'Hutang Bank — Cicilan', description: 'Cicilan Pinjaman Modal Kerja — Bank Mandiri', debit: 55000000, credit: 0, reference: 'LOAN-2026-08', party: 'Bank Mandiri', category: 'Loan Repayment', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00770', voucherNo: 'JV-0807-1', saldoAkhir: 1666900000, cek: true },
  { id: 'tx-046', date: '2026-08-09', txId: 'TXN-2026-08252', accountCode: '4201', accountName: 'Pendapatan Bunga Bank', description: 'Bunga Deposito Bulan Agustus 2026', debit: 0, credit: 3600000, reference: 'INT-BCA-2026-08', party: 'Bank BCA', category: 'Interest Income', type: 'credit', status: 'Posted', jeId: 'JE-2026-00774', voucherNo: 'BCA-0809-1', saldoAkhir: 1670500000, cek: true },
  { id: 'tx-047', date: '2026-08-11', txId: 'TXN-2026-08264', accountCode: '1103', accountName: 'Kas & Bank — Reserve Account', description: 'Transfer ke Rekening Cadangan Operasional', debit: 0, credit: 120000000, reference: 'RSV-2026-08', party: 'Internal Treasury', category: 'Reserve Transfer', type: 'journal', status: 'Posted', jeId: 'JE-2026-00778', voucherNo: 'JV-0811-1', saldoAkhir: 1790500000, cek: false },
  { id: 'tx-048', date: '2026-08-13', txId: 'TXN-2026-08277', accountCode: '2101', accountName: 'Hutang Usaha — Payroll Vendor', description: 'Pembayaran Jasa Payroll Outsourcing Agustus', debit: 18500000, credit: 0, reference: 'PMT-2026-0813', party: 'PT Payroll Prima', category: 'Payroll Payment', type: 'debit', status: 'Reconciled', jeId: 'JE-2026-00782', voucherNo: 'JV-0813-1', saldoAkhir: 1772000000, cek: true },
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