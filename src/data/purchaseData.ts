// Purchase Module Data — Backend integration point: replace with API calls to your ERP/AP backend

export type PurchaseStatus = 'draft' | 'pending_review' | 'approved' | 'pending_posting' | 'posted' | 'rejected' | 'exception' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overdue' | 'on_hold';
export type PurchaseCategory = 'Inventory' | 'Office Supplies' | 'IT Equipment' | 'Professional Services' | 'Utilities' | 'Maintenance' | 'Marketing' | 'Travel' | 'Fixed Assets' | 'Raw Materials' | 'Logistics' | 'Other';
export type SourceDocType = 'Purchase Order' | 'Vendor Invoice' | 'Goods Receipt' | 'Service Receipt' | 'Supplier Bill' | 'Expense Claim' | 'Recurring Purchase' | 'Manual';
export type ExceptionType = 'Missing Invoice Number' | 'Duplicate Invoice' | 'Invalid Vendor' | 'Purchase Order Mismatch' | 'Price Mismatch' | 'Tax Mismatch' | 'Missing Approval' | 'Closed Accounting Period' | 'Missing Purchase Order' | 'Posting Failure' | 'Quantity Mismatch' | 'Missing Documentation';
export type ExceptionSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type ExceptionStatus = 'Open' | 'Under Review' | 'Requires Correction' | 'Resolved' | 'Ignored';

export interface PurchaseLine {
  id: string;
  itemCode?: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  subtotal: number;
  total: number;
  accountCode: string;
  accountName: string;
}

export interface PurchaseTransaction {
  id: string;
  purchaseId: string;
  purchaseDate: string;
  invoiceDate: string;
  invoiceNumber: string;
  poNumber: string;
  vendor: string;
  vendorId: string;
  sourceDocType: SourceDocType;
  sourceRef: string;
  description: string;
  category: PurchaseCategory;
  subtotal: number;
  discount: number;
  taxAmount: number;
  total: number;
  accountsPayable: number;
  currency: string;
  paymentStatus: PaymentStatus;
  paymentTerms: string;
  dueDate: string;
  status: PurchaseStatus;
  period: string;
  createdBy: string;
  approvedBy?: string;
  createdDate: string;
  updatedDate: string;
  lines: PurchaseLine[];
  notes?: string;
  postingDate?: string;
  postedBy?: string;
  postedTimestamp?: string;
}

export interface PurchaseSourceRecord {
  id: string;
  sourceId: string;
  sourceType: SourceDocType;
  vendor: string;
  vendorId: string;
  sourceDate: string;
  invoiceNumber: string;
  poNumber: string;
  description: string;
  amount: number;
  taxAmount: number;
  totalAmount: number;
  currency: string;
  status: 'Mapped' | 'Pending Mapping' | 'Validation Error' | 'Imported';
  relatedPurchaseId: string | null;
  period: string;
  createdBy: string;
  createdDate: string;
  validationStatus: 'Valid' | 'Pending Validation' | 'Invalid';
}

export interface PurchaseException {
  id: string;
  purchaseId: string;
  exceptionType: ExceptionType;
  severity: ExceptionSeverity;
  vendor: string;
  invoiceNumber: string;
  purchaseDate: string;
  amount: number;
  currency: string;
  description: string;
  detectedDate: string;
  assignedTo: string;
  status: ExceptionStatus;
  resolution?: string;
  resolutionDate?: string;
  period: string;
}

// ─── Vendors ────────────────────────────────────────────────────────────────
export const vendors: { id: string; name: string; category: string; paymentTerms: string }[] = [];

// ─── Purchase Transactions ───────────────────────────────────────────────────
export const purchaseTransactions: PurchaseTransaction[] = [];

// ─── Source Records ──────────────────────────────────────────────────────────
export const purchaseSourceRecords: PurchaseSourceRecord[] = [];

// ─── Exceptions ──────────────────────────────────────────────────────────────
export const purchaseExceptions: PurchaseException[] = [];

// ─── Overview KPI helpers ────────────────────────────────────────────────────
export const purchaseOverviewKPIs = {
  totalPurchases: purchaseTransactions.length,
  totalAmount: purchaseTransactions.reduce((s, p) => s + p.total, 0),
  pendingReview: purchaseTransactions.filter(p => p.status === 'pending_review').length,
  approved: purchaseTransactions.filter(p => p.status === 'approved').length,
  posted: purchaseTransactions.filter(p => p.status === 'posted').length,
  exceptions: purchaseTransactions.filter(p => p.status === 'exception').length,
  totalTax: purchaseTransactions.reduce((s, p) => s + p.taxAmount, 0),
  totalAP: purchaseTransactions.filter(p => p.paymentStatus !== 'paid').reduce((s, p) => s + p.accountsPayable, 0),
  overdueAmount: purchaseTransactions.filter(p => p.paymentStatus === 'overdue').reduce((s, p) => s + p.total, 0),
  thisMonthAmount: purchaseTransactions.filter(p => p.period === 'Sep 2026').reduce((s, p) => s + p.total, 0),
};                                 