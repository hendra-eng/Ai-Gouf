// Tipe data Cash & Bank (Journal Preview, Posted, Exceptions).
// File ini dulu berisi data dummy; datanya sekarang dari backend (lib/useBankCashRekon.ts),
// jadi hanya tipe yang tersisa. `matchStatus`: 'matched' = jurnal dari Reconciliation (invoice atau
// tanpa invoice; linkedInvoice null untuk yang tanpa invoice).

export type CashBankDirection = 'Cash Receipt' | 'Cash Payment';
export type CashBankMatchStatus = 'matched' | 'unmatched';

export interface LinkedInvoice {
  /** Nomor invoice Sales (untuk Cash Receipt) atau transaksi Purchase (untuk Cash Payment). */
  no: string;
  type: 'Sales' | 'Purchase';
  counterpartyAccount: string; // nama akun Piutang/Hutang Usaha yang dipakai invoice ini
  outstandingBefore: number;
  outstandingAfter: number;
}

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
  matchStatus: CashBankMatchStatus;
  linkedInvoice: LinkedInvoice | null; // wajib diisi kalau matchStatus === 'matched'
}

export type CashBankExceptionSource = 'Reconciliation' | 'Classification';

export interface CashBankException {
  id: string;
  tx_no: string;
  counterparty: string;
  exception_type: string;
  /** [BARU] Dari mana exception ini berasal — dipakai untuk badge & filter.
   *  'Reconciliation' = soal pencocokan mutasi bank vs invoice (berlaku untuk
   *  transaksi matched maupun unmatched). 'Classification' = soal akun lawan
   *  / pajak yang belum diketahui, HANYA berlaku untuk transaksi unmatched
   *  (transaksi matched sudah tahu akun & pajaknya dari invoice asal). */
  source: CashBankExceptionSource;
  priority: 'High' | 'Medium' | 'Low';
  status: 'Open' | 'In Review' | 'Resolved';
  ai_confidence: number;
  ai_suggestion: string | null;
  source_snippet: Record<string, string | number> | null;
  assigned_to: string | null;
  resolved_at: string | null;
  created_at: string; // ISO
}
