// ─── DATA DUMMY — HANYA UNTUK DESAIN UI ────────────────────────────────────
// Tab Journal Preview & Exceptions di Cash & Bank sementara memakai data
// statis ini. Sumber data asli (Cash Payment/Receipt, Bank Feed, atau tabel
// backend baru) belum ditentukan — kalau sudah, ganti isi hook
// useCashBankTxs() / useCashBankExceptions() di komponen tanpa mengubah UI.

export type CashBankDirection = 'Cash Receipt' | 'Cash Payment';

export interface CashBankTx {
  id: string;
  tx_no: string;
  counterparty: string;
  tx_date: string; // YYYY-MM-DD
  amount: number;
  direction: CashBankDirection;
  bank_account: string;
  transaction_type: string;
  tax_status: string;
  dpp: number;
  ppn: number;
  posting_status: 'Draft' | 'Approved' | 'Posted';
}

export interface CashBankException {
  id: string;
  tx_no: string;
  counterparty: string;
  exception_type: string;
  priority: 'High' | 'Medium' | 'Low';
  status: 'Open' | 'In Review' | 'Resolved';
  ai_confidence: number;
  ai_suggestion: string | null;
  source_snippet: Record<string, string | number> | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string; // ISO
}

export const MOCK_CASH_BANK_TXS: CashBankTx[] = [
  { id: 'cb1', tx_no: 'CR-2026-0091', counterparty: 'PT Bali Sejahtera', tx_date: '2026-09-24', amount: 55500000, direction: 'Cash Receipt', bank_account: 'BCA 001-2345678', transaction_type: 'Penerimaan Piutang', tax_status: 'Non-Taxable', dpp: 55500000, ppn: 0, posting_status: 'Draft' },
  { id: 'cb2', tx_no: 'CP-2026-0142', counterparty: 'CV Nusa Dua Print', tx_date: '2026-09-23', amount: 11100000, direction: 'Cash Payment', bank_account: 'Mandiri 145-0098765', transaction_type: 'Pembayaran Hutang Usaha', tax_status: 'Taxable', dpp: 10000000, ppn: 1100000, posting_status: 'Approved' },
  { id: 'cb3', tx_no: 'CP-2026-0141', counterparty: 'PLN (Persero)', tx_date: '2026-09-22', amount: 4250000, direction: 'Cash Payment', bank_account: 'BCA 001-2345678', transaction_type: 'Beban Listrik', tax_status: 'Non-Taxable', dpp: 4250000, ppn: 0, posting_status: 'Draft' },
  { id: 'cb4', tx_no: 'CR-2026-0090', counterparty: 'Villa Semaya', tx_date: '2026-09-21', amount: 22200000, direction: 'Cash Receipt', bank_account: 'BNI 0456-7788', transaction_type: 'Penerimaan Jasa', tax_status: 'Taxable', dpp: 20000000, ppn: 2200000, posting_status: 'Posted' },
  { id: 'cb5', tx_no: 'CP-2026-0140', counterparty: 'Toko Bangunan Makmur', tx_date: '2026-09-20', amount: 8750000, direction: 'Cash Payment', bank_account: 'Mandiri 145-0098765', transaction_type: 'Beban Pemeliharaan', tax_status: 'Non-Taxable', dpp: 8750000, ppn: 0, posting_status: 'Approved' },
  { id: 'cb6', tx_no: 'CR-2026-0089', counterparty: 'PT Kuta Property', tx_date: '2026-09-19', amount: 33300000, direction: 'Cash Receipt', bank_account: 'BCA 001-2345678', transaction_type: 'Penerimaan Piutang', tax_status: 'Taxable', dpp: 30000000, ppn: 3300000, posting_status: 'Draft' },
  { id: 'cb7', tx_no: 'CP-2026-0139', counterparty: 'Bank Charge', tx_date: '2026-09-18', amount: 150000, direction: 'Cash Payment', bank_account: 'BCA 001-2345678', transaction_type: 'Biaya Administrasi Bank', tax_status: 'Non-Taxable', dpp: 150000, ppn: 0, posting_status: 'Posted' },
];

export const MOCK_CASH_BANK_EXCEPTIONS: CashBankException[] = [
  { id: 'ex1', tx_no: 'CR-2026-0091', counterparty: 'PT Bali Sejahtera', exception_type: 'Amount mismatch', priority: 'High', status: 'Open', ai_confidence: 32, ai_suggestion: 'Nominal mutasi bank berbeda Rp 500.000 dari Cash Receipt. Periksa biaya transfer atau pembulatan.', source_snippet: { tanggal: '2026-09-24', mutasi_bank: 55000000, cash_receipt: 55500000 }, assigned_to: null, resolved_at: null, created_at: '2026-09-25T03:10:00Z' },
  { id: 'ex2', tx_no: 'CP-2026-0142', counterparty: 'CV Nusa Dua Print', exception_type: 'Duplicate transaction', priority: 'High', status: 'In Review', ai_confidence: 38, ai_suggestion: 'Ada transaksi lain dengan nominal dan tanggal sama. Kemungkinan input ganda.', source_snippet: { tanggal: '2026-09-23', nominal: 11100000, rekening: 'Mandiri 145-0098765' }, assigned_to: 'me', resolved_at: null, created_at: '2026-09-24T08:30:00Z' },
  { id: 'ex3', tx_no: 'CP-2026-0141', counterparty: 'PLN (Persero)', exception_type: 'Missing counter account', priority: 'Medium', status: 'Open', ai_confidence: 55, ai_suggestion: 'Sarankan akun Beban Listrik & Air sebagai akun lawan.', source_snippet: { tanggal: '2026-09-22', keterangan: 'BAYAR LISTRIK SEP', nominal: 4250000 }, assigned_to: null, resolved_at: null, created_at: '2026-09-23T02:05:00Z' },
  { id: 'ex4', tx_no: 'MUT-0917-03', counterparty: 'TRF DARI 0456****', exception_type: 'Unmatched bank mutation', priority: 'Medium', status: 'Open', ai_confidence: 47, ai_suggestion: 'Belum ada Cash Receipt yang cocok untuk mutasi kredit ini.', source_snippet: { tanggal: '2026-09-17', kredit: 12500000, rekening: 'BNI 0456-7788' }, assigned_to: null, resolved_at: null, created_at: '2026-09-18T06:45:00Z' },
  { id: 'ex5', tx_no: 'CR-2026-0089', counterparty: 'PT Kuta Property', exception_type: 'Tax status unclear', priority: 'Low', status: 'Resolved', ai_confidence: 71, ai_suggestion: 'Status PPN perlu dikonfirmasi dari faktur pajak.', source_snippet: { tanggal: '2026-09-19', nominal: 33300000 }, assigned_to: 'me', resolved_at: '2026-09-22T09:00:00Z', created_at: '2026-09-20T04:20:00Z' },
  { id: 'ex6', tx_no: 'CP-2026-0139', counterparty: 'Bank Charge', exception_type: 'Unbalanced journal', priority: 'Low', status: 'In Review', ai_confidence: 82, ai_suggestion: null, source_snippet: null, assigned_to: null, resolved_at: null, created_at: '2026-09-19T01:15:00Z' },
];