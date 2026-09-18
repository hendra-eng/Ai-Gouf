// Backend integration point: replace these static arrays with API calls to your GL/ERP backend

export type JEStatus = 'draft' | 'pending' | 'approved' | 'posted' | 'rejected' | 'exception';
export type SourceType = 'Sales' | 'Purchase' | 'Expense' | 'Cash' | 'Bank' | 'Payroll' | 'Inventory' | 'Fixed Assets' | 'Tax' | 'Manual';

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  costCenter?: string;
}

export interface JournalEntry {
  id: string;
  jeNumber: string;
  date: string;
  postingDate: string;
  period: string;
  description: string;
  sourceType: SourceType;
  sourceReference: string;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  status: JEStatus;
  createdBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  createdDate: string;
  lastUpdated: string;
  lines: JournalLine[];
  notes?: string;
}

export const journalEntries: JournalEntry[] = [];

export const trendData = [
  { date: 'Aug 16', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 17', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 18', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 19', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 20', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 21', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 22', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 23', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 24', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 25', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 26', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 27', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 28', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 29', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 30', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 31', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 01', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 02', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 03', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 04', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 05', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 06', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 07', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 08', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 09', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 10', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 11', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 12', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 13', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Sep 14', entries: 0, posted: 0, exceptions: 0 },
];

export const statusDistribution = [
  { name: 'Posted', value: 0, color: '#15803D' },
  { name: 'Pending Review', value: 0, color: '#D97706' },
  { name: 'Draft', value: 0, color: '#64748B' },
  { name: 'Approved', value: 0, color: '#0369A1' },
  { name: 'Exception', value: 0, color: '#C2410C' },
];

export const exceptionBreakdown = [
  { type: 'Debit/Credit Mismatch', count: 0, severity: 'Critical' },
  { type: 'Missing Source Ref.', count: 0, severity: 'High' },
  { type: 'Invalid Account Code', count: 0, severity: 'High' },
  { type: 'Closed Period Entry', count: 0, severity: 'Critical' },
  { type: 'Missing Description', count: 0, severity: 'Medium' },
  { type: 'Duplicate Journal', count: 0, severity: 'Medium' },
];

export const recentActivity: { id: string; jeNumber: string; action: string; user: string; time: string; status: JEStatus; description: string }[] = [];

export const sourceDistribution = [
  { source: 'Sales', count: 0, totalAmount: 0, percentOfTotal: 0 },
  { source: 'Purchase', count: 0, totalAmount: 0, percentOfTotal: 0 },
  { source: 'Payroll', count: 0, totalAmount: 0, percentOfTotal: 0 },
  { source: 'Bank', count: 0, totalAmount: 0, percentOfTotal: 0 },
  { source: 'Manual', count: 0, totalAmount: 0, percentOfTotal: 0 },
  { source: 'Expense', count: 0, totalAmount: 0, percentOfTotal: 0 },
];