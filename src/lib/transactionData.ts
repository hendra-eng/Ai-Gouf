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
export const salesTransactions: Transaction[] = [
  { id: 'TXN-S001', date: '2026-08-15', type: 'sale', category: 'Software License', account: 'Accounts Receivable', counterAccount: 'Revenue - Software', party: 'PT Maju Bersama', description: 'Annual software license renewal - ERP System', reference: 'INV-2026-0815', amount: 185000000, tax: 20350000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Sales', customer: 'PT Maju Bersama', invoiceNumber: 'INV-2026-0815', dueDate: '2026-09-15', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S002', date: '2026-08-12', type: 'sale', category: 'Consulting Services', account: 'Accounts Receivable', counterAccount: 'Revenue - Consulting', party: 'CV Teknologi Nusantara', description: 'IT consulting services - Q3 2026', reference: 'INV-2026-0812', amount: 95000000, tax: 10450000, paymentMethod: 'Bank Transfer', paymentStatus: 'Unpaid', status: 'Posted', department: 'Consulting', customer: 'CV Teknologi Nusantara', invoiceNumber: 'INV-2026-0812', dueDate: '2026-09-12', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-S003', date: '2026-08-10', type: 'sale', category: 'Implementation', account: 'Cash - BCA', counterAccount: 'Revenue - Implementation', party: 'PT Sinar Harapan', description: 'System implementation project phase 2', reference: 'INV-2026-0810', amount: 320000000, tax: 35200000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Implementation', customer: 'PT Sinar Harapan', invoiceNumber: 'INV-2026-0810', dueDate: '2026-08-10', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S004', date: '2026-08-08', type: 'sale', category: 'Support & Maintenance', account: 'Accounts Receivable', counterAccount: 'Revenue - Support', party: 'PT Garuda Digital', description: 'Monthly support contract - August 2026', reference: 'INV-2026-0808', amount: 45000000, tax: 4950000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Support', customer: 'PT Garuda Digital', invoiceNumber: 'INV-2026-0808', dueDate: '2026-08-30', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S005', date: '2026-08-05', type: 'sale', category: 'Software License', account: 'Accounts Receivable', counterAccount: 'Revenue - Software', party: 'PT Bumi Pertiwi', description: 'New software license - HR Module', reference: 'INV-2026-0805', amount: 75000000, tax: 8250000, paymentMethod: 'Cash', paymentStatus: 'Paid', status: 'Posted', department: 'Sales', customer: 'PT Bumi Pertiwi', invoiceNumber: 'INV-2026-0805', dueDate: '2026-09-05', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S006', date: '2026-08-03', type: 'sale', category: 'Training', account: 'Accounts Receivable', counterAccount: 'Revenue - Training', party: 'PT Cahaya Timur', description: 'User training program - 3 days', reference: 'INV-2026-0803', amount: 28000000, tax: 3080000, paymentMethod: 'Bank Transfer', paymentStatus: 'Overdue', status: 'Posted', department: 'Training', customer: 'PT Cahaya Timur', invoiceNumber: 'INV-2026-0803', dueDate: '2026-08-03', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-S007', date: '2026-07-28', type: 'sale', category: 'Consulting Services', account: 'Accounts Receivable', counterAccount: 'Revenue - Consulting', party: 'PT Mega Solusi', description: 'Business process analysis and optimization', reference: 'INV-2026-0728', amount: 145000000, tax: 15950000, paymentMethod: 'Bank Transfer', paymentStatus: 'Partial', status: 'Posted', department: 'Consulting', customer: 'PT Mega Solusi', invoiceNumber: 'INV-2026-0728', dueDate: '2026-08-28', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-S008', date: '2026-07-25', type: 'sale', category: 'Implementation', account: 'Cash - BCA', counterAccount: 'Revenue - Implementation', party: 'PT Inti Karya', description: 'Cloud migration project - Phase 1', reference: 'INV-2026-0725', amount: 280000000, tax: 30800000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Implementation', customer: 'PT Inti Karya', invoiceNumber: 'INV-2026-0725', dueDate: '2026-07-25', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S009', date: '2026-07-20', type: 'sale', category: 'Support & Maintenance', account: 'Accounts Receivable', counterAccount: 'Revenue - Support', party: 'PT Duta Niaga', description: 'Annual maintenance contract renewal', reference: 'INV-2026-0720', amount: 60000000, tax: 6600000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Support', customer: 'PT Duta Niaga', invoiceNumber: 'INV-2026-0720', dueDate: '2026-08-20', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S010', date: '2026-07-15', type: 'sale', category: 'Software License', account: 'Accounts Receivable', counterAccount: 'Revenue - Software', party: 'PT Nusa Indah', description: 'Software license upgrade - Enterprise tier', reference: 'INV-2026-0715', amount: 220000000, tax: 24200000, paymentMethod: 'Bank Transfer', paymentStatus: 'Unpaid', status: 'Posted', department: 'Sales', customer: 'PT Nusa Indah', invoiceNumber: 'INV-2026-0715', dueDate: '2026-08-15', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-S011', date: '2026-07-10', type: 'sale', category: 'Consulting Services', account: 'Cash - BCA', counterAccount: 'Revenue - Consulting', party: 'PT Karya Mandiri', description: 'Digital transformation roadmap consulting', reference: 'INV-2026-0710', amount: 175000000, tax: 19250000, paymentMethod: 'Cash', paymentStatus: 'Paid', status: 'Posted', department: 'Consulting', customer: 'PT Karya Mandiri', invoiceNumber: 'INV-2026-0710', dueDate: '2026-07-10', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S012', date: '2026-07-05', type: 'sale', category: 'Training', account: 'Accounts Receivable', counterAccount: 'Revenue - Training', party: 'PT Abadi Jaya', description: 'Advanced user training - Finance module', reference: 'INV-2026-0705', amount: 35000000, tax: 3850000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Training', customer: 'PT Abadi Jaya', invoiceNumber: 'INV-2026-0705', dueDate: '2026-08-05', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S013', date: '2026-06-28', type: 'sale', category: 'Implementation', account: 'Cash - BCA', counterAccount: 'Revenue - Implementation', party: 'PT Surya Gemilang', description: 'ERP implementation - Manufacturing module', reference: 'INV-2026-0628', amount: 450000000, tax: 49500000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Implementation', customer: 'PT Surya Gemilang', invoiceNumber: 'INV-2026-0628', dueDate: '2026-06-28', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S014', date: '2026-06-20', type: 'sale', category: 'Software License', account: 'Accounts Receivable', counterAccount: 'Revenue - Software', party: 'PT Citra Persada', description: 'Multi-user license package - 50 seats', reference: 'INV-2026-0620', amount: 125000000, tax: 13750000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Sales', customer: 'PT Citra Persada', invoiceNumber: 'INV-2026-0620', dueDate: '2026-07-20', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-S015', date: '2026-06-15', type: 'sale', category: 'Support & Maintenance', account: 'Accounts Receivable', counterAccount: 'Revenue - Support', party: 'PT Maju Bersama', description: 'Quarterly support package - Q2 2026', reference: 'INV-2026-0615', amount: 48000000, tax: 5280000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Support', customer: 'PT Maju Bersama', invoiceNumber: 'INV-2026-0615', dueDate: '2026-07-15', reconciliationStatus: 'Reconciled' },
];

// ─── EXPENSE TRANSACTIONS ─────────────────────────────────────────────────────
export const expenseTransactions: Transaction[] = [
  { id: 'TXN-E001', date: '2026-08-14', type: 'expense', category: 'Salaries & Wages', account: 'Salary Expense', counterAccount: 'Accrued Payroll', party: 'Payroll - August 2026', description: 'Monthly payroll - all departments', reference: 'PAY-2026-08', amount: 285000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'HR', vendor: 'Internal Payroll', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E002', date: '2026-08-13', type: 'expense', category: 'Office Rent', account: 'Rent Expense', counterAccount: 'Accounts Payable', party: 'PT Graha Properti', description: 'Office rent - August 2026, Sudirman Tower Lt. 12', reference: 'RENT-2026-08', amount: 65000000, tax: 7150000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Operations', vendor: 'PT Graha Properti', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E003', date: '2026-08-12', type: 'expense', category: 'Cloud Services', account: 'IT Expense', counterAccount: 'Accounts Payable', party: 'AWS Indonesia', description: 'AWS cloud infrastructure - August 2026', reference: 'AWS-2026-08', amount: 42000000, tax: 4620000, paymentMethod: 'Credit Card', paymentStatus: 'Paid', status: 'Posted', department: 'IT', vendor: 'AWS Indonesia', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E004', date: '2026-08-10', type: 'expense', category: 'Marketing', account: 'Marketing Expense', counterAccount: 'Accounts Payable', party: 'PT Digital Kreatif', description: 'Digital marketing campaign - Q3 2026', reference: 'MKT-2026-0810', amount: 35000000, tax: 3850000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Marketing', vendor: 'PT Digital Kreatif', approvalStatus: 'Approved' },
  { id: 'TXN-E005', date: '2026-08-08', type: 'expense', category: 'Professional Services', account: 'Professional Fees', counterAccount: 'Accounts Payable', party: 'KAP Wijaya & Partners', description: 'External audit services - FY 2025', reference: 'AUDIT-2026-08', amount: 85000000, tax: 9350000, paymentMethod: 'Bank Transfer', paymentStatus: 'Pending', status: 'Posted', department: 'Finance', vendor: 'KAP Wijaya & Partners', approvalStatus: 'Approved' },
  { id: 'TXN-E006', date: '2026-08-07', type: 'expense', category: 'Travel & Entertainment', account: 'Travel Expense', counterAccount: 'Accounts Payable', party: 'Various', description: 'Business travel - client visits Surabaya', reference: 'TRVL-2026-0807', amount: 12500000, tax: 0, paymentMethod: 'Credit Card', paymentStatus: 'Paid', status: 'Posted', department: 'Sales', vendor: 'Various', approvalStatus: 'Approved' },
  { id: 'TXN-E007', date: '2026-08-05', type: 'expense', category: 'Utilities', account: 'Utilities Expense', counterAccount: 'Accounts Payable', party: 'PLN & Telkom', description: 'Electricity and internet - August 2026', reference: 'UTIL-2026-08', amount: 8500000, tax: 935000, paymentMethod: 'Auto Debit', paymentStatus: 'Paid', status: 'Posted', department: 'Operations', vendor: 'PLN & Telkom', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E008', date: '2026-08-04', type: 'expense', category: 'Software Subscriptions', account: 'IT Expense', counterAccount: 'Accounts Payable', party: 'Microsoft Indonesia', description: 'Microsoft 365 Business - 50 licenses', reference: 'MS365-2026-08', amount: 18000000, tax: 1980000, paymentMethod: 'Credit Card', paymentStatus: 'Paid', status: 'Posted', department: 'IT', vendor: 'Microsoft Indonesia', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E009', date: '2026-08-03', type: 'expense', category: 'Training & Development', account: 'Training Expense', counterAccount: 'Accounts Payable', party: 'PT Edukasi Prima', description: 'Staff training - Project Management certification', reference: 'TRN-2026-0803', amount: 22000000, tax: 2420000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'HR', vendor: 'PT Edukasi Prima', approvalStatus: 'Approved' },
  { id: 'TXN-E010', date: '2026-08-01', type: 'expense', category: 'Office Supplies', account: 'Office Expense', counterAccount: 'Accounts Payable', party: 'PT Alat Kantor', description: 'Office supplies and stationery - August', reference: 'OFF-2026-0801', amount: 4500000, tax: 495000, paymentMethod: 'Cash', paymentStatus: 'Paid', status: 'Posted', department: 'Operations', vendor: 'PT Alat Kantor', approvalStatus: 'Approved' },
  { id: 'TXN-E011', date: '2026-07-30', type: 'expense', category: 'Insurance', account: 'Insurance Expense', counterAccount: 'Prepaid Insurance', party: 'PT Asuransi Mandiri', description: 'Business insurance premium - Q3 2026', reference: 'INS-2026-Q3', amount: 28000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance', vendor: 'PT Asuransi Mandiri', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E012', date: '2026-07-28', type: 'expense', category: 'Marketing', account: 'Marketing Expense', counterAccount: 'Accounts Payable', party: 'PT Event Organizer', description: 'Tech conference sponsorship - TechFest 2026', reference: 'EVT-2026-0728', amount: 50000000, tax: 5500000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Marketing', vendor: 'PT Event Organizer', approvalStatus: 'Approved', isFlagged: true },
  { id: 'TXN-E013', date: '2026-07-25', type: 'expense', category: 'Salaries & Wages', account: 'Salary Expense', counterAccount: 'Accrued Payroll', party: 'Payroll - July 2026', description: 'Monthly payroll - all departments', reference: 'PAY-2026-07', amount: 280000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'HR', vendor: 'Internal Payroll', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E014', date: '2026-07-20', type: 'expense', category: 'Cloud Services', account: 'IT Expense', counterAccount: 'Accounts Payable', party: 'Google Cloud Indonesia', description: 'Google Cloud Platform - July 2026', reference: 'GCP-2026-07', amount: 38000000, tax: 4180000, paymentMethod: 'Credit Card', paymentStatus: 'Paid', status: 'Posted', department: 'IT', vendor: 'Google Cloud Indonesia', approvalStatus: 'Approved', isRecurring: true },
  { id: 'TXN-E015', date: '2026-07-15', type: 'expense', category: 'Professional Services', account: 'Professional Fees', counterAccount: 'Accounts Payable', party: 'Konsultan Hukum Pratama', description: 'Legal consultation - contract review', reference: 'LEG-2026-0715', amount: 15000000, tax: 1650000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Legal', vendor: 'Konsultan Hukum Pratama', approvalStatus: 'Approved' },
];

// ─── CASH PAYMENT TRANSACTIONS ────────────────────────────────────────────────
export const cashPaymentTransactions: Transaction[] = [
  { id: 'TXN-P001', date: '2026-08-14', type: 'cash_payment', category: 'Payroll', account: 'Cash - BCA', counterAccount: 'Accrued Payroll', party: 'Employee Payroll', description: 'Monthly payroll disbursement - August 2026', reference: 'PAY-DISB-2026-08', amount: 285000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'HR', paymentType: 'Payroll', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P002', date: '2026-08-13', type: 'cash_payment', category: 'Supplier Payment', account: 'Cash - BCA', counterAccount: 'Accounts Payable', party: 'PT Graha Properti', description: 'Office rent payment - August 2026', reference: 'PMT-2026-0813', amount: 72150000, tax: 7150000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'Operations', paymentType: 'Supplier', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P003', date: '2026-08-12', type: 'cash_payment', category: 'Operating Expense', account: 'Cash - BCA', counterAccount: 'IT Expense', party: 'AWS Indonesia', description: 'AWS cloud services payment', reference: 'PMT-2026-0812', amount: 46620000, tax: 4620000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'IT', paymentType: 'Operating', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P004', date: '2026-08-10', type: 'cash_payment', category: 'Tax Payment', account: 'Cash - BCA', counterAccount: 'Tax Payable', party: 'Direktorat Jenderal Pajak', description: 'PPh 21 - August 2026', reference: 'TAX-PPH21-2026-08', amount: 42500000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'Finance', paymentType: 'Tax', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P005', date: '2026-08-08', type: 'cash_payment', category: 'Loan Repayment', account: 'Cash - BCA', counterAccount: 'Bank Loan Payable', party: 'Bank Mandiri', description: 'Monthly loan installment - August 2026', reference: 'LOAN-2026-08', amount: 55000000, tax: 0, paymentMethod: 'Auto Debit', paymentStatus: 'Paid', status: 'Reconciled', department: 'Finance', paymentType: 'Loan', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P006', date: '2026-08-07', type: 'cash_payment', category: 'Operating Expense', account: 'Cash - Petty', counterAccount: 'Travel Expense', party: 'Various', description: 'Travel reimbursements - Surabaya trip', reference: 'PMT-2026-0807', amount: 12500000, tax: 0, paymentMethod: 'Cash', paymentStatus: 'Paid', status: 'Posted', department: 'Sales', paymentType: 'Operating', bankAccount: 'Petty Cash', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-P007', date: '2026-08-05', type: 'cash_payment', category: 'Supplier Payment', account: 'Cash - BCA', counterAccount: 'Accounts Payable', party: 'PT Digital Kreatif', description: 'Marketing campaign payment', reference: 'PMT-2026-0805', amount: 38850000, tax: 3850000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'Marketing', paymentType: 'Supplier', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P008', date: '2026-08-04', type: 'cash_payment', category: 'Operating Expense', account: 'Cash - BCA', counterAccount: 'IT Expense', party: 'Microsoft Indonesia', description: 'Microsoft 365 subscription payment', reference: 'PMT-2026-0804', amount: 19980000, tax: 1980000, paymentMethod: 'Credit Card', paymentStatus: 'Paid', status: 'Reconciled', department: 'IT', paymentType: 'Operating', bankAccount: 'BCA Credit Card', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P009', date: '2026-08-01', type: 'cash_payment', category: 'Asset Purchase', account: 'Cash - BCA', counterAccount: 'Fixed Assets', party: 'PT Komputer Jaya', description: 'Laptop purchase - 5 units for new staff', reference: 'ASSET-2026-0801', amount: 75000000, tax: 8250000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'IT', paymentType: 'Asset', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Unreconciled' },
  { id: 'TXN-P010', date: '2026-07-30', type: 'cash_payment', category: 'Tax Payment', account: 'Cash - BCA', counterAccount: 'Tax Payable', party: 'Direktorat Jenderal Pajak', description: 'PPN - July 2026', reference: 'TAX-PPN-2026-07', amount: 38500000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'Finance', paymentType: 'Tax', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P011', date: '2026-07-28', type: 'cash_payment', category: 'Supplier Payment', account: 'Cash - BCA', counterAccount: 'Accounts Payable', party: 'PT Event Organizer', description: 'TechFest 2026 sponsorship payment', reference: 'PMT-2026-0728', amount: 55500000, tax: 5500000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'Marketing', paymentType: 'Supplier', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P012', date: '2026-07-25', type: 'cash_payment', category: 'Payroll', account: 'Cash - BCA', counterAccount: 'Accrued Payroll', party: 'Employee Payroll', description: 'Monthly payroll disbursement - July 2026', reference: 'PAY-DISB-2026-07', amount: 280000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'HR', paymentType: 'Payroll', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P013', date: '2026-07-20', type: 'cash_payment', category: 'Operating Expense', account: 'Cash - BCA', counterAccount: 'IT Expense', party: 'Google Cloud Indonesia', description: 'Google Cloud Platform payment - July', reference: 'PMT-2026-0720', amount: 42180000, tax: 4180000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Reconciled', department: 'IT', paymentType: 'Operating', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P014', date: '2026-07-15', type: 'cash_payment', category: 'Loan Repayment', account: 'Cash - BCA', counterAccount: 'Bank Loan Payable', party: 'Bank Mandiri', description: 'Monthly loan installment - July 2026', reference: 'LOAN-2026-07', amount: 55000000, tax: 0, paymentMethod: 'Auto Debit', paymentStatus: 'Paid', status: 'Reconciled', department: 'Finance', paymentType: 'Loan', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Reconciled' },
  { id: 'TXN-P015', date: '2026-07-10', type: 'cash_payment', category: 'Supplier Payment', account: 'Cash - BCA', counterAccount: 'Accounts Payable', party: 'KAP Wijaya & Partners', description: 'Audit services advance payment', reference: 'PMT-2026-0710', amount: 47175000, tax: 4675000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Pending', department: 'Finance', paymentType: 'Supplier', bankAccount: 'BCA - 1234567890', reconciliationStatus: 'Pending' },
];

// ─── OTHER TRANSACTIONS ───────────────────────────────────────────────────────
export const otherTransactions: Transaction[] = [
  { id: 'TXN-O001', date: '2026-08-15', type: 'interest', category: 'Interest', account: 'Cash - BCA', counterAccount: 'Interest Income', party: 'Bank BCA', description: 'Bank interest income - August 2026', reference: 'INT-BCA-2026-08', amount: 3250000, tax: 357500, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O002', date: '2026-08-12', type: 'refund', category: 'Refund', account: 'Cash - BCA', counterAccount: 'Accounts Payable', party: 'AWS Indonesia', description: 'AWS credit refund - overcharge correction', reference: 'REF-AWS-2026-08', amount: 5500000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'IT' },
  { id: 'TXN-O003', date: '2026-08-10', type: 'adjustment', category: 'Adjustment', account: 'Accounts Receivable', counterAccount: 'Revenue - Software', party: 'PT Maju Bersama', description: 'Invoice adjustment - pricing correction INV-2026-0815', reference: 'ADJ-2026-0810', amount: -5000000, tax: -550000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O004', date: '2026-08-08', type: 'capital_contribution', category: 'Capital Contribution', account: 'Cash - BCA', counterAccount: 'Paid-in Capital', party: 'PT Nusantara Teknologi (Shareholder)', description: 'Additional capital injection - expansion fund', reference: 'CAP-2026-08', amount: 500000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O005', date: '2026-08-05', type: 'reclassification', category: 'Reclassification', account: 'Marketing Expense', counterAccount: 'IT Expense', party: 'Internal', description: 'Reclassify digital tools from Marketing to IT', reference: 'RECL-2026-0805', amount: 8000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O006', date: '2026-08-03', type: 'other_income', category: 'Other Income', account: 'Cash - BCA', counterAccount: 'Other Income', party: 'PT Garuda Digital', description: 'Late payment penalty income', reference: 'OTH-2026-0803', amount: 2500000, tax: 275000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O007', date: '2026-07-30', type: 'owner_withdrawal', category: 'Owner Withdrawal', account: 'Retained Earnings', counterAccount: 'Cash - BCA', party: 'Director - Budi Santoso', description: 'Director dividend withdrawal - Q2 2026', reference: 'DIV-2026-Q2', amount: 150000000, tax: 15000000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O008', date: '2026-07-25', type: 'loan', category: 'Loan', account: 'Cash - BCA', counterAccount: 'Bank Loan Payable', party: 'Bank Mandiri', description: 'Working capital loan drawdown', reference: 'LOAN-DRAW-2026-07', amount: 200000000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O009', date: '2026-07-20', type: 'asset_adjustment', category: 'Asset Adjustment', account: 'Fixed Assets', counterAccount: 'Accumulated Depreciation', party: 'Internal', description: 'Monthly depreciation - IT equipment', reference: 'DEP-2026-07', amount: 12500000, tax: 0, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O010', date: '2026-07-15', type: 'interest', category: 'Interest', account: 'Cash - BCA', counterAccount: 'Interest Income', party: 'Bank BCA', description: 'Bank interest income - July 2026', reference: 'INT-BCA-2026-07', amount: 3100000, tax: 341000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Finance' },
  { id: 'TXN-O011', date: '2026-07-10', type: 'refund', category: 'Refund', account: 'Cash - BCA', counterAccount: 'Revenue - Software', party: 'PT Bumi Pertiwi', description: 'Partial refund - license downgrade', reference: 'REF-2026-0710', amount: -15000000, tax: -1650000, paymentMethod: 'Bank Transfer', paymentStatus: 'Paid', status: 'Posted', department: 'Sales' },
  { id: 'TXN-O012', date: '2026-07-05', type: 'miscellaneous', category: 'Miscellaneous', account: 'Miscellaneous Income', counterAccount: 'Cash - BCA', party: 'Various', description: 'Miscellaneous income - asset disposal', reference: 'MISC-2026-0705', amount: 8500000, tax: 935000, paymentMethod: 'Cash', paymentStatus: 'Paid', status: 'Posted', department: 'Operations' },
];

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

export const cashReserveData: CashReserveEntry[] = [
  { id: 'CR-001', date: '2026-08-31', account: 'Cash - BCA', reserveType: 'Operating Reserve', openingBalance: 1850000000, inflow: 605000000, outflow: 548000000, reservedAmount: 400000000, availableBalance: 1507000000, minimumTarget: 350000000, variance: 1157000000, status: 'Healthy' },
  { id: 'CR-002', date: '2026-08-31', account: 'Cash - Mandiri', reserveType: 'Emergency Reserve', openingBalance: 650000000, inflow: 200000000, outflow: 55000000, reservedAmount: 500000000, availableBalance: 295000000, minimumTarget: 500000000, variance: -205000000, status: 'Below Target' },
  { id: 'CR-003', date: '2026-08-31', account: 'Cash - Petty', reserveType: 'Petty Cash', openingBalance: 25000000, inflow: 15000000, outflow: 12500000, reservedAmount: 5000000, availableBalance: 22500000, minimumTarget: 10000000, variance: 12500000, status: 'Healthy' },
  { id: 'CR-004', date: '2026-07-31', account: 'Cash - BCA', reserveType: 'Operating Reserve', openingBalance: 1720000000, inflow: 780000000, outflow: 650000000, reservedAmount: 400000000, availableBalance: 1450000000, minimumTarget: 350000000, variance: 1100000000, status: 'Healthy' },
  { id: 'CR-005', date: '2026-07-31', account: 'Cash - Mandiri', reserveType: 'Emergency Reserve', openingBalance: 580000000, inflow: 200000000, outflow: 130000000, reservedAmount: 500000000, availableBalance: 150000000, minimumTarget: 500000000, variance: -350000000, status: 'Below Target' },
  { id: 'CR-006', date: '2026-06-30', account: 'Cash - BCA', reserveType: 'Operating Reserve', openingBalance: 1580000000, inflow: 850000000, outflow: 710000000, reservedAmount: 380000000, availableBalance: 1340000000, minimumTarget: 350000000, variance: 990000000, status: 'Healthy' },
  { id: 'CR-007', date: '2026-06-30', account: 'Cash - Mandiri', reserveType: 'Emergency Reserve', openingBalance: 520000000, inflow: 100000000, outflow: 40000000, reservedAmount: 480000000, availableBalance: 100000000, minimumTarget: 500000000, variance: -400000000, status: 'Watch' },
  { id: 'CR-008', date: '2026-05-31', account: 'Cash - BCA', reserveType: 'Operating Reserve', openingBalance: 1420000000, inflow: 720000000, outflow: 560000000, reservedAmount: 360000000, availableBalance: 1220000000, minimumTarget: 350000000, variance: 870000000, status: 'Healthy' },
];

// ─── MONTHLY TREND DATA ───────────────────────────────────────────────────────
export const monthlyTrend = [
  { month: 'Jan', sales: 850000000, expenses: 620000000, cashPayments: 680000000, cashBalance: 1420000000, reserveAmount: 380000000, otherInflow: 15000000, otherOutflow: 165000000 },
  { month: 'Feb', sales: 920000000, expenses: 645000000, cashPayments: 710000000, cashBalance: 1520000000, reserveAmount: 390000000, otherInflow: 18000000, otherOutflow: 155000000 },
  { month: 'Mar', sales: 1050000000, expenses: 680000000, cashPayments: 750000000, cashBalance: 1680000000, reserveAmount: 400000000, otherInflow: 22000000, otherOutflow: 180000000 },
  { month: 'Apr', sales: 980000000, expenses: 660000000, cashPayments: 720000000, cashBalance: 1580000000, reserveAmount: 395000000, otherInflow: 12000000, otherOutflow: 160000000 },
  { month: 'May', sales: 1120000000, expenses: 710000000, cashPayments: 780000000, cashBalance: 1720000000, reserveAmount: 410000000, otherInflow: 25000000, otherOutflow: 175000000 },
  { month: 'Jun', sales: 1280000000, expenses: 750000000, cashPayments: 820000000, cashBalance: 1850000000, reserveAmount: 420000000, otherInflow: 20000000, otherOutflow: 190000000 },
  { month: 'Jul', sales: 1150000000, expenses: 730000000, cashPayments: 800000000, cashBalance: 1780000000, reserveAmount: 415000000, otherInflow: 18000000, otherOutflow: 185000000 },
  { month: 'Aug', sales: 1086000000, expenses: 693500000, cashPayments: 756000000, cashBalance: 1829500000, reserveAmount: 905000000, otherInflow: 23000000, otherOutflow: 178000000 },
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
