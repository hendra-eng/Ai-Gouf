// Shared transaction data model and mock data for the financial dashboard
// All figures in IDR (Indonesian Rupiah)

export type TransactionType =
  | 'sale' |'expense' |'cash_payment' |'cash_reserve' |'other_income' |'other_outflow' |'adjustment' |'refund' |'interest' |'capital_contribution' |'owner_withdrawal' |'loan' |'reclassification' |'asset_adjustment' |'miscellaneous';

export type PaymentMethod = 'Cash' | 'Bank Transfer' | 'Credit Card' | 'Cheque' | 'Auto Debit';
export type PaymentStatus = 'Paid' | 'Unpaid' | 'Partial' | 'Overdue' | 'Pending';
export type TransactionStatus = 'Posted' | 'Pending' | 'Reconciled' | 'Unreconciled' | 'Draft' | 'Void';
export type ReserveStatus = 'Healthy' | 'Watch' | 'Below Target';
export type ApprovalStatus = 'Approved' | 'Pending' | 'Rejected';

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  category: string;
  account: string;
  counterAccount: string;
  party: string;
  description: string;
  reference: string;
  amount: number;
  tax: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: TransactionStatus;
  department: string;
  customer?: string;
  vendor?: string;
  invoiceNumber?: string;
  dueDate?: string;
  reconciliationStatus?: 'Reconciled' | 'Unreconciled' | 'Pending';
  approvalStatus?: ApprovalStatus;
  paymentType?: string;
  bankAccount?: string;
  isRecurring?: boolean;
  isFlagged?: boolean;
}

// ─── SALES TRANSACTIONS ───────────────────────────────────────────────────────
export const salesTransactions: Transaction[] = [];

// ─── EXPENSE TRANSACTIONS ─────────────────────────────────────────────────────
export const expenseTransactions: Transaction[] = [];

// ─── CASH PAYMENT TRANSACTIONS ────────────────────────────────────────────────
export const cashPaymentTransactions: Transaction[] = [];

// ─── OTHER TRANSACTIONS ───────────────────────────────────────────────────────
export const otherTransactions: Transaction[] = [];

// ─── CASH RESERVE DATA ────────────────────────────────────────────────────────
export interface CashReserveEntry {
  id: string;
  date: string;
  account: string;
  reserveType: string;
  openingBalance: number;
  inflow: number;
  outflow: number;
  reservedAmount: number;
  availableBalance: number;
  minimumTarget: number;
  variance: number;
  status: ReserveStatus;
}

export const cashReserveData: CashReserveEntry[] = [];

// ─── MONTHLY TREND DATA ───────────────────────────────────────────────────────
export const monthlyTrend = [
  { month: 'Jan', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Feb', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Mar', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Apr', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'May', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Jun', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Jul', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
  { month: 'Aug', sales: 0, expenses: 0, cashPayments: 0, cashBalance: 0, reserveAmount: 0, otherInflow: 0, otherOutflow: 0 },
];

// ─── SPARKLINE HELPER ─────────────────────────────────────────────────────────
// Menghasilkan deret data mini-chart (sparkline) yang halus (dua gelombang sinus
// dengan frekuensi berbeda, jadi tidak periodik-kaku) dan arah kemiringannya
// mengikuti tanda `changePct` (naik = hijau, turun = merah — diwarnai di KpiCard).
// Deterministik (bukan Math.random) supaya tidak mismatch antara render server & client.
export function makeSparkline(seedValue: number, changePct: number, points = 8): number[] {
  const pct = changePct === 0 ? 0.1 : changePct;
  const seed = Math.abs(seedValue) % 97;
  const arr: number[] = [];
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const trend = t * pct;
    const wiggle =
      Math.sin(t * Math.PI * 2.4 + seed) * Math.abs(pct) * 0.3 +
      Math.sin(t * Math.PI * 4 + seed * 0.5) * Math.abs(pct) * 0.12;
    arr.push(Number((trend + wiggle).toFixed(3)));
  }
  return arr;
}

// ─── UTILITY FUNCTIONS ────────────────────────────────────────────────────────
// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
export function formatIDR(amount: number, compact = false): string {
  if (compact) {
    if (Math.abs(amount) >= 1_000_000_000_000) return `Rp ${(amount / 1_000_000_000_000).toFixed(2).replace('.', ',')}T`;
    if (Math.abs(amount) >= 1_000_000_000) return `Rp ${(amount / 1_000_000_000).toFixed(2).replace('.', ',')}M`;
    if (Math.abs(amount) >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(0)}Jt`;
    if (Math.abs(amount) >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}Rb`;
  }
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'Healthy': case 'Reconciled': case 'Paid': case 'Approved': case 'Posted': return 'badge-success';
    case 'Watch': case 'Pending': case 'Partial': return 'badge-warning';
    case 'Below Target': case 'Overdue': case 'Rejected': case 'Void': return 'badge-danger';
    case 'Unreconciled': case 'Draft': return 'badge-neutral';
    default: return 'badge-neutral';
  }
}

export function getPaymentStatusBadge(status: PaymentStatus): string {
  switch (status) {
    case 'Paid': return 'badge-success';
    case 'Pending': case 'Partial': return 'badge-warning';
    case 'Unpaid': return 'badge-info';
    case 'Overdue': return 'badge-danger';
    default: return 'badge-neutral';
  }
}
