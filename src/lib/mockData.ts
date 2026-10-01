// Central mock data for GoufAccounting — all entities are cross-referenced

export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type ARStatus = 'Paid' | 'Partially Paid' | 'Open' | 'Due Soon' | 'Overdue' | 'Disputed' | 'Written Off';
export type APStatus = 'Paid' | 'Scheduled' | 'Pending Approval' | 'Open' | 'Due Soon' | 'Overdue' | 'Disputed' | 'On Hold';
export type CollectionPriority = 'Critical' | 'High' | 'Medium' | 'Low';

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  name: string;
  code: string;
  industry: string;
  creditLimit: number;
  totalAR: number;
  currentAR: number;
  overdueAR: number;
  ar90Plus: number;
  dso: number;
  collectionRate: number;
  riskLevel: RiskLevel;
  lastPayment: string;
  nextExpectedPayment: string;
  accountManager: string;
  creditUtilization: number;
}

export const customers: Customer[] = [];

// ─── INVOICES ────────────────────────────────────────────────────────────────
export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  invoiceDate: string;
  dueDate: string;
  amount: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  status: ARStatus;
  priority: CollectionPriority;
  accountManager: string;
}

export const invoices: Invoice[] = [];

// ─── VENDORS ─────────────────────────────────────────────────────────────────
export interface Vendor {
  id: string;
  name: string;
  code: string;
  category: string;
  totalAP: number;
  currentAP: number;
  overdueAP: number;
  dueSoon: number;
  paymentTerms: string;
  avgPaymentDays: number;
  creditExposure: number;
  riskLevel: RiskLevel;
  nextPayment: string;
  status: string;
}

export const vendors: Vendor[] = [];

// ─── BILLS ───────────────────────────────────────────────────────────────────
export interface Bill {
  id: string;
  number: string;
  vendorId: string;
  vendorName: string;
  billDate: string;
  dueDate: string;
  amount: number;
  paid: number;
  outstanding: number;
  daysOverdue: number;
  status: APStatus;
  priority: CollectionPriority;
  paymentMethod: string;
  approvalStatus: string;
  // [BARU — dipakai vendorsFromBills/mostCommonCategoryLabel di apBridge.ts
  // untuk menentukan kategori Vendor dari kategori transaksi Expense
  // sumbernya, bukan string statis]. Opsional supaya data contoh `bills`
  // di bawah (yang tidak berasal dari transaksi asli) tidak wajib diisi.
  category?: string;
}

export const bills: Bill[] = [];

// ─── AR AGING DATA ────────────────────────────────────────────────────────────
export const arAgingData = [
  { bucket: 'Current', amount: 0, percentage: 0, color: '#16A34A' },
  { bucket: '1–30 Days', amount: 0, percentage: 0, color: '#2563EB' },
  { bucket: '31–60 Days', amount: 0, percentage: 0, color: '#D97706' },
  { bucket: '61–90 Days', amount: 0, percentage: 0, color: '#EA580C' },
  { bucket: '90+ Days', amount: 0, percentage: 0, color: '#DC2626' },
];

// ─── AP AGING DATA ────────────────────────────────────────────────────────────
export const apAgingData = [
  { bucket: 'Current', amount: 0, percentage: 0, color: '#16A34A' },
  { bucket: '1–30 Days', amount: 0, percentage: 0, color: '#2563EB' },
  { bucket: '31–60 Days', amount: 0, percentage: 0, color: '#D97706' },
  { bucket: '61–90 Days', amount: 0, percentage: 0, color: '#EA580C' },
  { bucket: '90+ Days', amount: 0, percentage: 0, color: '#DC2626' },
];

// ─── AR TREND DATA ────────────────────────────────────────────────────────────
export const arTrendData = [
  { month: 'Jan', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Feb', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Mar', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Apr', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'May', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Jun', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Jul', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
  { month: 'Aug', openingAR: 0, newInvoices: 0, collections: 0, closingAR: 0 },
];

// ─── DSO TREND DATA ───────────────────────────────────────────────────────────
export const dsoTrendData = [
  { month: 'Jan', dso: 0 },
  { month: 'Feb', dso: 0 },
  { month: 'Mar', dso: 0 },
  { month: 'Apr', dso: 0 },
  { month: 'May', dso: 0 },
  { month: 'Jun', dso: 0 },
  { month: 'Jul', dso: 0 },
  { month: 'Aug', dso: 0 },
];

// ─── AP TREND DATA ────────────────────────────────────────────────────────────
export const apTrendData = [
  { month: 'Jan', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Feb', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Mar', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Apr', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'May', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Jun', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Jul', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
  { month: 'Aug', openingAP: 0, newBills: 0, payments: 0, closingAP: 0 },
];

// ─── COLLECTION FORECAST ─────────────────────────────────────────────────────
export const collectionForecast = [
  { period: '7 days', expected: 0, probability: 0 },
  { period: '14 days', expected: 0, probability: 0 },
  { period: '30 days', expected: 0, probability: 0 },
  { period: '60 days', expected: 0, probability: 0 },
];

// ─── PAYMENT FORECAST ────────────────────────────────────────────────────────
export const paymentForecastData = [
  { period: 'Today', amount: 0, bills: 0 },
  { period: 'This Week', amount: 0, bills: 0 },
  { period: 'Next Week', amount: 0, bills: 0 },
  { period: 'This Month', amount: 0, bills: 0 },
];

// ─── AI ANALYSES ─────────────────────────────────────────────────────────────
// [RAPI] `analysisType` ditambahkan supaya AIConversationSidebar tidak perlu
// lagi hardcode peta id->type terpisah (analysisTypeMap) yang gampang telat
// diupdate saat entri baru ditambah lewat "New Analysis". Nilainya harus
// sama persis dengan literal ActiveAnalysisType di AIAnalystLayout.tsx.
export type AIAnalysisTemplateType =
  | 'profit-decrease'
  | 'ar-risk'
  | 'cash-flow'
  | 'q-comparison'
  | 'expense-anomaly'
  | 'ap-risk';

export interface AIAnalysis {
  id: string;
  title: string;
  type: string;
  analysisType: AIAnalysisTemplateType;
  createdAt: string;
  updatedAt: string;
  period: string;
  risk: RiskLevel;
  isFavorite: boolean;
  isArchived: boolean;
}

export const aiAnalyses: AIAnalysis[] = [];

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
// Canonical IDR shorthand structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
export function formatRupiah(value: number, compact = false): string {
  if (compact) {
    if (value >= 1000000000000) return `Rp ${(value / 1000000000000).toFixed(2).replace('.', ',')}T`;
    if (value >= 1000000000) return `Rp ${(value / 1000000000).toFixed(2).replace('.', ',')}M`;
    if (value >= 1000000) return `Rp ${(value / 1000000).toFixed(0)}Jt`;
    if (value >= 1000) return `Rp ${(value / 1000).toFixed(0)}Rb`;
    return `Rp ${value.toLocaleString('id-ID')}`;
  }
  return `Rp ${value.toLocaleString('id-ID')}`;
}

export function formatCompact(value: number): string {
  if (value >= 1000000000000) return `${(value / 1000000000000).toFixed(2).replace('.', ',')}T`;
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2).replace('.', ',')}M`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(0)}Jt`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}Rb`;
  return value.toString();
}

export const riskColors: Record<RiskLevel, string> = {
  Low: 'bg-success-bg text-success-foreground',
  Medium: 'bg-warning-bg text-warning-foreground',
  High: 'bg-orange-50 text-orange-700',
  Critical: 'bg-danger-bg text-danger-foreground',
};

export const arStatusColors: Record<ARStatus, string> = {
  'Paid': 'bg-success-bg text-success-foreground',
  'Partially Paid': 'bg-info-bg text-info-foreground',
  'Open': 'bg-secondary text-secondary-foreground',
  'Due Soon': 'bg-warning-bg text-warning-foreground',
  'Overdue': 'bg-danger-bg text-danger-foreground',
  'Disputed': 'bg-orange-50 text-orange-700',
  'Written Off': 'bg-muted text-muted-foreground',
};

export const apStatusColors: Record<APStatus, string> = {
  'Paid': 'bg-success-bg text-success-foreground',
  'Scheduled': 'bg-info-bg text-info-foreground',
  'Pending Approval': 'bg-warning-bg text-warning-foreground',
  'Open': 'bg-secondary text-secondary-foreground',
  'Due Soon': 'bg-warning-bg text-warning-foreground',
  'Overdue': 'bg-danger-bg text-danger-foreground',
  'Disputed': 'bg-orange-50 text-orange-700',
  'On Hold': 'bg-muted text-muted-foreground',
};