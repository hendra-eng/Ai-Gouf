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

export const journalEntries: JournalEntry[] = [
  {
    id: 'je-001',
    jeNumber: 'JE-2026-09-0042',
    date: '2026-09-14',
    postingDate: '2026-09-14',
    period: 'Sep 2026',
    description: 'Customer Invoice — Meridian Corp Q3 Services',
    sourceType: 'Sales',
    sourceReference: 'INV-2026-1847',
    totalDebit: 125000.00,
    totalCredit: 125000.00,
    currency: 'USD',
    status: 'pending',
    createdBy: 'Sarah Chen',
    reviewedBy: undefined,
    approvedBy: undefined,
    createdDate: '2026-09-14',
    lastUpdated: '2026-09-14',
    notes: 'Q3 professional services billing for Meridian Corp. Net 30 terms.',
    lines: [
      { id: 'jl-001-1', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Meridian Corp — INV-2026-1847', debit: 125000.00, credit: 0 },
      { id: 'jl-001-2', accountCode: '4100', accountName: 'Service Revenue', description: 'Q3 Professional Services', debit: 0, credit: 112500.00 },
      { id: 'jl-001-3', accountCode: '2300', accountName: 'Sales Tax Payable', description: 'Sales Tax 10%', debit: 0, credit: 12500.00 },
    ],
  },
  {
    id: 'je-002',
    jeNumber: 'JE-2026-09-0041',
    date: '2026-09-13',
    postingDate: '2026-09-13',
    period: 'Sep 2026',
    description: 'Vendor Payment — Apex Supplies Ltd',
    sourceType: 'Purchase',
    sourceReference: 'PO-2026-0934',
    totalDebit: 48750.00,
    totalCredit: 48750.00,
    currency: 'USD',
    status: 'approved',
    createdBy: 'James Okafor',
    reviewedBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-13',
    lastUpdated: '2026-09-13',
    notes: 'Office supplies and equipment — PO approved by procurement.',
    lines: [
      { id: 'jl-002-1', accountCode: '5200', accountName: 'Inventory — Office Supplies', description: 'Office supplies batch Sep-2026', debit: 43500.00, credit: 0 },
      { id: 'jl-002-2', accountCode: '1300', accountName: 'VAT Recoverable', description: 'Input VAT 12%', debit: 5250.00, credit: 0 },
      { id: 'jl-002-3', accountCode: '2100', accountName: 'Accounts Payable', description: 'Apex Supplies Ltd', debit: 0, credit: 48750.00 },
    ],
  },
  {
    id: 'je-003',
    jeNumber: 'JE-2026-09-0040',
    date: '2026-09-12',
    postingDate: '2026-09-12',
    period: 'Sep 2026',
    description: 'Monthly Payroll — Sep 2026 Week 2',
    sourceType: 'Payroll',
    sourceReference: 'PR-2026-09-W2',
    totalDebit: 287400.00,
    totalCredit: 287400.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'Lisa Thornton',
    reviewedBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-12',
    lastUpdated: '2026-09-12',
    lines: [
      { id: 'jl-003-1', accountCode: '6100', accountName: 'Salaries & Wages Expense', description: 'Sep 2026 W2 gross payroll', debit: 287400.00, credit: 0 },
      { id: 'jl-003-2', accountCode: '1100', accountName: 'Cash — Operating Account', description: 'Net payroll disbursement', debit: 0, credit: 243900.00 },
      { id: 'jl-003-3', accountCode: '2500', accountName: 'Payroll Tax Payable', description: 'Federal/State payroll tax withholding', debit: 0, credit: 43500.00 },
    ],
  },
  {
    id: 'je-004',
    jeNumber: 'JE-2026-09-0039',
    date: '2026-09-11',
    postingDate: '2026-09-11',
    period: 'Sep 2026',
    description: 'Bank Transfer — Operating to Reserve',
    sourceType: 'Bank',
    sourceReference: 'BT-2026-0188',
    totalDebit: 75000.00,
    totalCredit: 75000.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'James Okafor',
    reviewedBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-11',
    lastUpdated: '2026-09-11',
    lines: [
      { id: 'jl-004-1', accountCode: '1101', accountName: 'Cash — Reserve Account', description: 'Transfer to reserve fund', debit: 75000.00, credit: 0 },
      { id: 'jl-004-2', accountCode: '1100', accountName: 'Cash — Operating Account', description: 'Transfer from operating', debit: 0, credit: 75000.00 },
    ],
  },
  {
    id: 'je-005',
    jeNumber: 'JE-2026-09-0038',
    date: '2026-09-10',
    postingDate: '',
    period: 'Sep 2026',
    description: 'Fixed Asset Depreciation — Sep 2026',
    sourceType: 'Fixed Assets',
    sourceReference: 'DEP-2026-09',
    totalDebit: 12350.00,
    totalCredit: 9850.00,
    currency: 'USD',
    status: 'exception',
    createdBy: 'Sarah Chen',
    reviewedBy: undefined,
    approvedBy: undefined,
    createdDate: '2026-09-10',
    lastUpdated: '2026-09-10',
    notes: 'EXCEPTION: Debit/Credit mismatch — depreciation schedule requires correction.',
    lines: [
      { id: 'jl-005-1', accountCode: '6500', accountName: 'Depreciation Expense', description: 'Monthly depreciation — all assets', debit: 12350.00, credit: 0 },
      { id: 'jl-005-2', accountCode: '1600', accountName: 'Accumulated Depreciation', description: 'Accumulated dep adjustment', debit: 0, credit: 9850.00 },
    ],
  },
  {
    id: 'je-006',
    jeNumber: 'JE-2026-09-0037',
    date: '2026-09-10',
    postingDate: '2026-09-10',
    period: 'Sep 2026',
    description: 'Expense Reimbursement — Sales Team Q3',
    sourceType: 'Expense',
    sourceReference: 'EXP-2026-0417',
    totalDebit: 8920.00,
    totalCredit: 8920.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'Lisa Thornton',
    reviewedBy: 'Sarah Chen',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-10',
    lastUpdated: '2026-09-10',
    lines: [
      { id: 'jl-006-1', accountCode: '6300', accountName: 'Travel & Entertainment', description: 'Sales team Q3 travel reimbursements', debit: 8920.00, credit: 0 },
      { id: 'jl-006-2', accountCode: '1100', accountName: 'Cash — Operating Account', description: 'Expense reimbursement disbursement', debit: 0, credit: 8920.00 },
    ],
  },
  {
    id: 'je-007',
    jeNumber: 'JE-2026-09-0036',
    date: '2026-09-09',
    postingDate: '2026-09-09',
    period: 'Sep 2026',
    description: 'Inventory Adjustment — Physical Count Sep',
    sourceType: 'Inventory',
    sourceReference: 'INV-ADJ-2026-031',
    totalDebit: 5640.00,
    totalCredit: 5640.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'James Okafor',
    reviewedBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-09',
    lastUpdated: '2026-09-09',
    lines: [
      { id: 'jl-007-1', accountCode: '5000', accountName: 'Cost of Goods Sold', description: 'Inventory write-down — physical count variance', debit: 5640.00, credit: 0 },
      { id: 'jl-007-2', accountCode: '1400', accountName: 'Inventory', description: 'Inventory reduction — physical count', debit: 0, credit: 5640.00 },
    ],
  },
  {
    id: 'je-008',
    jeNumber: 'JE-2026-09-0035',
    date: '2026-09-08',
    postingDate: '',
    period: 'Sep 2026',
    description: 'Accrued Expenses — Utilities & Rent Sep',
    sourceType: 'Manual',
    sourceReference: 'ACR-2026-09-003',
    totalDebit: 34200.00,
    totalCredit: 34200.00,
    currency: 'USD',
    status: 'draft',
    createdBy: 'Sarah Chen',
    reviewedBy: undefined,
    approvedBy: undefined,
    createdDate: '2026-09-08',
    lastUpdated: '2026-09-14',
    lines: [
      { id: 'jl-008-1', accountCode: '6200', accountName: 'Rent Expense', description: 'Sep 2026 office rent accrual', debit: 28000.00, credit: 0 },
      { id: 'jl-008-2', accountCode: '6250', accountName: 'Utilities Expense', description: 'Sep 2026 utilities accrual', debit: 6200.00, credit: 0 },
      { id: 'jl-008-3', accountCode: '2200', accountName: 'Accrued Liabilities', description: 'Accrued rent and utilities', debit: 0, credit: 34200.00 },
    ],
  },
  {
    id: 'je-009',
    jeNumber: 'JE-2026-09-0034',
    date: '2026-09-07',
    postingDate: '',
    period: 'Sep 2026',
    description: 'Tax Provision — Q3 2026 Income Tax',
    sourceType: 'Tax',
    sourceReference: 'TAX-Q3-2026',
    totalDebit: 62500.00,
    totalCredit: 62500.00,
    currency: 'USD',
    status: 'pending',
    createdBy: 'Marcus Webb',
    reviewedBy: undefined,
    approvedBy: undefined,
    createdDate: '2026-09-07',
    lastUpdated: '2026-09-14',
    lines: [
      { id: 'jl-009-1', accountCode: '7100', accountName: 'Income Tax Expense', description: 'Q3 2026 corporate income tax provision', debit: 62500.00, credit: 0 },
      { id: 'jl-009-2', accountCode: '2400', accountName: 'Income Tax Payable', description: 'Q3 2026 tax liability', debit: 0, credit: 62500.00 },
    ],
  },
  {
    id: 'je-010',
    jeNumber: 'JE-2026-09-0033',
    date: '2026-09-06',
    postingDate: '2026-09-06',
    period: 'Sep 2026',
    description: 'Cash Receipt — Hartley Industries Payment',
    sourceType: 'Cash',
    sourceReference: 'CR-2026-0892',
    totalDebit: 98400.00,
    totalCredit: 98400.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'James Okafor',
    reviewedBy: 'Sarah Chen',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-06',
    lastUpdated: '2026-09-06',
    lines: [
      { id: 'jl-010-1', accountCode: '1100', accountName: 'Cash — Operating Account', description: 'Hartley Industries — INV settlement', debit: 98400.00, credit: 0 },
      { id: 'jl-010-2', accountCode: '1200', accountName: 'Accounts Receivable', description: 'Hartley Industries AR clearance', debit: 0, credit: 98400.00 },
    ],
  },
  {
    id: 'je-011',
    jeNumber: 'JE-2026-09-0032',
    date: '2026-09-05',
    postingDate: '',
    period: 'Sep 2026',
    description: 'Prepaid Insurance Amortization — Sep 2026',
    sourceType: 'Manual',
    sourceReference: 'AMR-2026-09-001',
    totalDebit: 4166.67,
    totalCredit: 4166.67,
    currency: 'USD',
    status: 'draft',
    createdBy: 'Lisa Thornton',
    createdDate: '2026-09-05',
    lastUpdated: '2026-09-05',
    lines: [
      { id: 'jl-011-1', accountCode: '6400', accountName: 'Insurance Expense', description: 'Monthly amortization — annual policy', debit: 4166.67, credit: 0 },
      { id: 'jl-011-2', accountCode: '1500', accountName: 'Prepaid Insurance', description: 'Prepaid insurance reduction', debit: 0, credit: 4166.67 },
    ],
  },
  {
    id: 'je-012',
    jeNumber: 'JE-2026-09-0031',
    date: '2026-09-04',
    postingDate: '2026-09-04',
    period: 'Sep 2026',
    description: 'Revenue Recognition — Deferred Revenue Release',
    sourceType: 'Sales',
    sourceReference: 'REV-2026-0291',
    totalDebit: 22000.00,
    totalCredit: 22000.00,
    currency: 'USD',
    status: 'posted',
    createdBy: 'Sarah Chen',
    reviewedBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-04',
    lastUpdated: '2026-09-04',
    lines: [
      { id: 'jl-012-1', accountCode: '2600', accountName: 'Deferred Revenue', description: 'Sep 2026 deferred revenue release', debit: 22000.00, credit: 0 },
      { id: 'jl-012-2', accountCode: '4100', accountName: 'Service Revenue', description: 'Revenue recognized Sep 2026', debit: 0, credit: 22000.00 },
    ],
  },
];

export const trendData = [
  { date: 'Aug 16', entries: 3, posted: 2, exceptions: 0 },
  { date: 'Aug 17', entries: 5, posted: 4, exceptions: 1 },
  { date: 'Aug 18', entries: 2, posted: 2, exceptions: 0 },
  { date: 'Aug 19', entries: 7, posted: 5, exceptions: 2 },
  { date: 'Aug 20', entries: 4, posted: 3, exceptions: 0 },
  { date: 'Aug 21', entries: 1, posted: 1, exceptions: 0 },
  { date: 'Aug 22', entries: 0, posted: 0, exceptions: 0 },
  { date: 'Aug 23', entries: 6, posted: 5, exceptions: 1 },
  { date: 'Aug 24', entries: 8, posted: 6, exceptions: 2 },
  { date: 'Aug 25', entries: 5, posted: 5, exceptions: 0 },
  { date: 'Aug 26', entries: 9, posted: 7, exceptions: 1 },
  { date: 'Aug 27', entries: 4, posted: 3, exceptions: 0 },
  { date: 'Aug 28', entries: 3, posted: 2, exceptions: 1 },
  { date: 'Aug 29', entries: 2, posted: 2, exceptions: 0 },
  { date: 'Aug 30', entries: 6, posted: 4, exceptions: 2 },
  { date: 'Aug 31', entries: 11, posted: 9, exceptions: 1 },
  { date: 'Sep 01', entries: 4, posted: 3, exceptions: 0 },
  { date: 'Sep 02', entries: 7, posted: 5, exceptions: 1 },
  { date: 'Sep 03', entries: 3, posted: 2, exceptions: 0 },
  { date: 'Sep 04', entries: 6, posted: 5, exceptions: 0 },
  { date: 'Sep 05', entries: 5, posted: 3, exceptions: 1 },
  { date: 'Sep 06', entries: 8, posted: 7, exceptions: 0 },
  { date: 'Sep 07', entries: 4, posted: 2, exceptions: 1 },
  { date: 'Sep 08', entries: 3, posted: 1, exceptions: 0 },
  { date: 'Sep 09', entries: 6, posted: 5, exceptions: 0 },
  { date: 'Sep 10', entries: 5, posted: 2, exceptions: 2 },
  { date: 'Sep 11', entries: 4, posted: 4, exceptions: 0 },
  { date: 'Sep 12', entries: 7, posted: 5, exceptions: 1 },
  { date: 'Sep 13', entries: 5, posted: 3, exceptions: 0 },
  { date: 'Sep 14', entries: 4, posted: 1, exceptions: 1 },
];

export const statusDistribution = [
  { name: 'Posted', value: 6, color: '#15803D' },
  { name: 'Pending Review', value: 2, color: '#D97706' },
  { name: 'Draft', value: 2, color: '#64748B' },
  { name: 'Approved', value: 1, color: '#0369A1' },
  { name: 'Exception', value: 1, color: '#C2410C' },
];

export const exceptionBreakdown = [
  { type: 'Debit/Credit Mismatch', count: 3, severity: 'Critical' },
  { type: 'Missing Source Ref.', count: 2, severity: 'High' },
  { type: 'Invalid Account Code', count: 1, severity: 'High' },
  { type: 'Closed Period Entry', count: 1, severity: 'Critical' },
  { type: 'Missing Description', count: 2, severity: 'Medium' },
  { type: 'Duplicate Journal', count: 1, severity: 'Medium' },
];

export const recentActivity = [
  { id: 'act-001', jeNumber: 'JE-2026-09-0042', action: 'Created', user: 'Sarah Chen', time: '20:48', status: 'pending' as JEStatus, description: 'Customer Invoice — Meridian Corp' },
  { id: 'act-002', jeNumber: 'JE-2026-09-0041', action: 'Approved', user: 'Marcus Webb', time: '19:22', status: 'approved' as JEStatus, description: 'Vendor Payment — Apex Supplies Ltd' },
  { id: 'act-003', jeNumber: 'JE-2026-09-0040', action: 'Posted', user: 'Marcus Webb', time: '17:55', status: 'posted' as JEStatus, description: 'Monthly Payroll Sep 2026 W2' },
  { id: 'act-004', jeNumber: 'JE-2026-09-0039', action: 'Posted', user: 'Marcus Webb', time: '16:30', status: 'posted' as JEStatus, description: 'Bank Transfer — Operating to Reserve' },
  { id: 'act-005', jeNumber: 'JE-2026-09-0038', action: 'Exception Flagged', user: 'System', time: '15:12', status: 'exception' as JEStatus, description: 'Fixed Asset Depreciation Sep 2026' },
  { id: 'act-006', jeNumber: 'JE-2026-09-0035', action: 'Saved Draft', user: 'Sarah Chen', time: '14:08', status: 'draft' as JEStatus, description: 'Accrued Expenses — Utilities & Rent' },
  { id: 'act-007', jeNumber: 'JE-2026-09-0034', action: 'Submitted for Review', user: 'Marcus Webb', time: '11:45', status: 'pending' as JEStatus, description: 'Tax Provision Q3 2026' },
  { id: 'act-008', jeNumber: 'JE-2026-09-0033', action: 'Posted', user: 'Marcus Webb', time: '09:30', status: 'posted' as JEStatus, description: 'Cash Receipt — Hartley Industries' },
];

export const sourceDistribution = [
  { source: 'Sales', count: 8, totalAmount: 892340, percentOfTotal: 28 },
  { source: 'Purchase', count: 5, totalAmount: 341200, percentOfTotal: 18 },
  { source: 'Payroll', count: 4, totalAmount: 574800, percentOfTotal: 14 },
  { source: 'Bank', count: 6, totalAmount: 412500, percentOfTotal: 21 },
  { source: 'Manual', count: 3, totalAmount: 98760, percentOfTotal: 10 },
  { source: 'Expense', count: 4, totalAmount: 62340, percentOfTotal: 9 },
];