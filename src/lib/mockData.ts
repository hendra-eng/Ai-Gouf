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

export const customers: Customer[] = [
  { id: 'cust-001', name: 'PT Mitra Solusi Digital', code: 'MSD-001', industry: 'Technology', creditLimit: 500000000, totalAR: 320000000, currentAR: 135000000, overdueAR: 185000000, ar90Plus: 82000000, dso: 58, collectionRate: 72.4, riskLevel: 'Critical', lastPayment: '2026-07-15', nextExpectedPayment: '2026-09-05', accountManager: 'Budi Santoso', creditUtilization: 64 },
  { id: 'cust-002', name: 'CV Berkah Mandiri', code: 'BM-002', industry: 'Trading', creditLimit: 300000000, totalAR: 198000000, currentAR: 198000000, overdueAR: 0, ar90Plus: 0, dso: 28, collectionRate: 96.1, riskLevel: 'Low', lastPayment: '2026-08-20', nextExpectedPayment: '2026-09-15', accountManager: 'Sari Dewi', creditUtilization: 66 },
  { id: 'cust-003', name: 'PT Sinar Harapan Nusantara', code: 'SHN-003', industry: 'Manufacturing', creditLimit: 750000000, totalAR: 215000000, currentAR: 110000000, overdueAR: 105000000, ar90Plus: 0, dso: 45, collectionRate: 81.3, riskLevel: 'High', lastPayment: '2026-07-28', nextExpectedPayment: '2026-09-10', accountManager: 'Andi Wijaya', creditUtilization: 28.7 },
  { id: 'cust-004', name: 'PT Global Teknindo', code: 'GT-004', industry: 'Technology', creditLimit: 400000000, totalAR: 142000000, currentAR: 142000000, overdueAR: 0, ar90Plus: 0, dso: 22, collectionRate: 98.2, riskLevel: 'Low', lastPayment: '2026-08-22', nextExpectedPayment: '2026-09-20', accountManager: 'Rina Kusuma', creditUtilization: 35.5 },
  { id: 'cust-005', name: 'UD Karya Utama', code: 'KU-005', industry: 'Retail', creditLimit: 200000000, totalAR: 98000000, currentAR: 35000000, overdueAR: 63000000, ar90Plus: 3000000, dso: 67, collectionRate: 65.8, riskLevel: 'High', lastPayment: '2026-07-05', nextExpectedPayment: '2026-09-02', accountManager: 'Budi Santoso', creditUtilization: 49 },
  { id: 'cust-006', name: 'PT Dinamika Persada', code: 'DP-006', industry: 'Services', creditLimit: 350000000, totalAR: 87000000, currentAR: 87000000, overdueAR: 0, ar90Plus: 0, dso: 31, collectionRate: 94.5, riskLevel: 'Low', lastPayment: '2026-08-18', nextExpectedPayment: '2026-09-18', accountManager: 'Sari Dewi', creditUtilization: 24.9 },
  { id: 'cust-007', name: 'CV Mega Perkasa', code: 'MP-007', industry: 'Construction', creditLimit: 600000000, totalAR: 76000000, currentAR: 48000000, overdueAR: 28000000, ar90Plus: 0, dso: 38, collectionRate: 88.7, riskLevel: 'Medium', lastPayment: '2026-08-01', nextExpectedPayment: '2026-09-08', accountManager: 'Andi Wijaya', creditUtilization: 12.7 },
  { id: 'cust-008', name: 'PT Nusa Cipta Raya', code: 'NCR-008', industry: 'Logistics', creditLimit: 250000000, totalAR: 58000000, currentAR: 58000000, overdueAR: 0, ar90Plus: 0, dso: 25, collectionRate: 97.3, riskLevel: 'Low', lastPayment: '2026-08-24', nextExpectedPayment: '2026-09-22', accountManager: 'Rina Kusuma', creditUtilization: 23.2 },
  { id: 'cust-009', name: 'PT Artha Kencana', code: 'AK-009', industry: 'Finance', creditLimit: 500000000, totalAR: 45000000, currentAR: 20000000, overdueAR: 25000000, ar90Plus: 0, dso: 52, collectionRate: 79.2, riskLevel: 'Medium', lastPayment: '2026-07-30', nextExpectedPayment: '2026-09-06', accountManager: 'Budi Santoso', creditUtilization: 9 },
  { id: 'cust-010', name: 'CV Jaya Abadi', code: 'JA-010', industry: 'Trading', creditLimit: 150000000, totalAR: 38000000, currentAR: 38000000, overdueAR: 0, ar90Plus: 0, dso: 18, collectionRate: 99.1, riskLevel: 'Low', lastPayment: '2026-08-25', nextExpectedPayment: '2026-09-25', accountManager: 'Sari Dewi', creditUtilization: 25.3 },
];

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

export const invoices: Invoice[] = [
  { id: 'inv-001', number: 'INV-2026-0185', customerId: 'cust-001', customerName: 'PT Mitra Solusi Digital', invoiceDate: '2026-05-15', dueDate: '2026-06-15', amount: 95000000, paid: 0, outstanding: 95000000, daysOverdue: 74, status: 'Overdue', priority: 'Critical', accountManager: 'Budi Santoso' },
  { id: 'inv-002', number: 'INV-2026-0201', customerId: 'cust-001', customerName: 'PT Mitra Solusi Digital', invoiceDate: '2026-06-01', dueDate: '2026-07-01', amount: 90000000, paid: 0, outstanding: 90000000, daysOverdue: 58, status: 'Overdue', priority: 'Critical', accountManager: 'Budi Santoso' },
  { id: 'inv-003', number: 'INV-2026-0218', customerId: 'cust-002', customerName: 'CV Berkah Mandiri', invoiceDate: '2026-07-20', dueDate: '2026-08-20', amount: 65000000, paid: 65000000, outstanding: 0, daysOverdue: 0, status: 'Paid', priority: 'Low', accountManager: 'Sari Dewi' },
  { id: 'inv-004', number: 'INV-2026-0225', customerId: 'cust-003', customerName: 'PT Sinar Harapan Nusantara', invoiceDate: '2026-06-28', dueDate: '2026-07-28', amount: 105000000, paid: 0, outstanding: 105000000, daysOverdue: 31, status: 'Overdue', priority: 'High', accountManager: 'Andi Wijaya' },
  { id: 'inv-005', number: 'INV-2026-0232', customerId: 'cust-004', customerName: 'PT Global Teknindo', invoiceDate: '2026-08-01', dueDate: '2026-08-31', amount: 72000000, paid: 0, outstanding: 72000000, daysOverdue: 0, status: 'Due Soon', priority: 'Medium', accountManager: 'Rina Kusuma' },
  { id: 'inv-006', number: 'INV-2026-0238', customerId: 'cust-005', customerName: 'UD Karya Utama', invoiceDate: '2026-06-05', dueDate: '2026-07-05', amount: 45000000, paid: 0, outstanding: 45000000, daysOverdue: 54, status: 'Overdue', priority: 'High', accountManager: 'Budi Santoso' },
  { id: 'inv-007', number: 'INV-2026-0241', customerId: 'cust-005', customerName: 'UD Karya Utama', invoiceDate: '2026-07-15', dueDate: '2026-08-15', amount: 18000000, paid: 0, outstanding: 18000000, daysOverdue: 13, status: 'Overdue', priority: 'High', accountManager: 'Budi Santoso' },
  { id: 'inv-008', number: 'INV-2026-0245', customerId: 'cust-006', customerName: 'PT Dinamika Persada', invoiceDate: '2026-07-18', dueDate: '2026-08-18', amount: 87000000, paid: 87000000, outstanding: 0, daysOverdue: 0, status: 'Paid', priority: 'Low', accountManager: 'Sari Dewi' },
  { id: 'inv-009', number: 'INV-2026-0252', customerId: 'cust-007', customerName: 'CV Mega Perkasa', invoiceDate: '2026-07-01', dueDate: '2026-08-01', amount: 28000000, paid: 0, outstanding: 28000000, daysOverdue: 27, status: 'Overdue', priority: 'Medium', accountManager: 'Andi Wijaya' },
  { id: 'inv-010', number: 'INV-2026-0258', customerId: 'cust-002', customerName: 'CV Berkah Mandiri', invoiceDate: '2026-08-10', dueDate: '2026-09-10', amount: 133000000, paid: 0, outstanding: 133000000, daysOverdue: 0, status: 'Open', priority: 'Low', accountManager: 'Sari Dewi' },
  { id: 'inv-011', number: 'INV-2026-0261', customerId: 'cust-009', customerName: 'PT Artha Kencana', invoiceDate: '2026-06-30', dueDate: '2026-07-30', amount: 25000000, paid: 0, outstanding: 25000000, daysOverdue: 29, status: 'Overdue', priority: 'Medium', accountManager: 'Budi Santoso' },
  { id: 'inv-012', number: 'INV-2026-0268', customerId: 'cust-004', customerName: 'PT Global Teknindo', invoiceDate: '2026-08-15', dueDate: '2026-09-15', amount: 70000000, paid: 0, outstanding: 70000000, daysOverdue: 0, status: 'Open', priority: 'Low', accountManager: 'Rina Kusuma' },
];

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

export const vendors: Vendor[] = [
  { id: 'vend-001', name: 'PT Infratech Solusi', code: 'ITS-001', category: 'IT Infrastructure', totalAP: 185000000, currentAP: 89000000, overdueAP: 96000000, dueSoon: 0, paymentTerms: 'Net 30', avgPaymentDays: 38, creditExposure: 185000000, riskLevel: 'Critical', nextPayment: '2026-09-02', status: 'Overdue' },
  { id: 'vend-002', name: 'CV Maju Bersama', code: 'MB-002', category: 'Office Supplies', totalAP: 142000000, currentAP: 142000000, overdueAP: 0, dueSoon: 45000000, paymentTerms: 'Net 15', avgPaymentDays: 16, creditExposure: 142000000, riskLevel: 'Low', nextPayment: '2026-09-05', status: 'Due Soon' },
  { id: 'vend-003', name: 'PT Kreasi Utama', code: 'KU-003', category: 'Marketing', totalAP: 98000000, currentAP: 98000000, overdueAP: 0, dueSoon: 0, paymentTerms: 'Net 30', avgPaymentDays: 29, creditExposure: 98000000, riskLevel: 'Low', nextPayment: '2026-09-20', status: 'Open' },
  { id: 'vend-004', name: 'PT Logistik Nusantara', code: 'LN-004', category: 'Logistics', totalAP: 87000000, currentAP: 62000000, overdueAP: 0, dueSoon: 25000000, paymentTerms: 'Net 21', avgPaymentDays: 22, creditExposure: 87000000, riskLevel: 'Low', nextPayment: '2026-09-03', status: 'Due Soon' },
  { id: 'vend-005', name: 'CV Sumber Daya Prima', code: 'SDP-005', category: 'HR Services', totalAP: 76000000, currentAP: 76000000, overdueAP: 0, dueSoon: 0, paymentTerms: 'Net 30', avgPaymentDays: 31, creditExposure: 76000000, riskLevel: 'Low', nextPayment: '2026-09-25', status: 'Open' },
  { id: 'vend-006', name: 'PT Daya Cipta Digital', code: 'DCD-006', category: 'Software', totalAP: 68000000, currentAP: 68000000, overdueAP: 0, dueSoon: 68000000, paymentTerms: 'Net 14', avgPaymentDays: 14, creditExposure: 68000000, riskLevel: 'Medium', nextPayment: '2026-09-01', status: 'Due Soon' },
  { id: 'vend-007', name: 'UD Serba Ada', code: 'SA-007', category: 'General Supplies', totalAP: 55000000, currentAP: 55000000, overdueAP: 0, dueSoon: 0, paymentTerms: 'Net 45', avgPaymentDays: 44, creditExposure: 55000000, riskLevel: 'Low', nextPayment: '2026-10-05', status: 'Open' },
  { id: 'vend-008', name: 'PT Arsitek Rancang Bangun', code: 'ARB-008', category: 'Facilities', totalAP: 48000000, currentAP: 48000000, overdueAP: 0, dueSoon: 0, paymentTerms: 'Net 30', avgPaymentDays: 33, creditExposure: 48000000, riskLevel: 'Low', nextPayment: '2026-09-28', status: 'Open' },
  { id: 'vend-009', name: 'CV Prima Konsultan', code: 'PK-009', category: 'Consulting', totalAP: 45000000, currentAP: 45000000, overdueAP: 0, dueSoon: 4000000, paymentTerms: 'Net 30', avgPaymentDays: 28, creditExposure: 45000000, riskLevel: 'Low', nextPayment: '2026-09-15', status: 'Open' },
  { id: 'vend-010', name: 'PT Wahana Ekspres', code: 'WE-010', category: 'Delivery', totalAP: 36000000, currentAP: 36000000, overdueAP: 0, dueSoon: 0, paymentTerms: 'Net 15', avgPaymentDays: 15, creditExposure: 36000000, riskLevel: 'Low', nextPayment: '2026-09-10', status: 'Open' },
];

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
}

export const bills: Bill[] = [
  { id: 'bill-001', number: 'BILL-2026-0142', vendorId: 'vend-001', vendorName: 'PT Infratech Solusi', billDate: '2026-05-20', dueDate: '2026-06-20', amount: 96000000, paid: 0, outstanding: 96000000, daysOverdue: 69, status: 'Overdue', priority: 'Critical', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-002', number: 'BILL-2026-0158', vendorId: 'vend-001', vendorName: 'PT Infratech Solusi', billDate: '2026-07-15', dueDate: '2026-08-15', amount: 89000000, paid: 0, outstanding: 89000000, daysOverdue: 13, status: 'Overdue', priority: 'Critical', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-003', number: 'BILL-2026-0165', vendorId: 'vend-002', vendorName: 'CV Maju Bersama', billDate: '2026-08-05', dueDate: '2026-09-05', amount: 45000000, paid: 0, outstanding: 45000000, daysOverdue: 0, status: 'Due Soon', priority: 'High', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-004', number: 'BILL-2026-0171', vendorId: 'vend-006', vendorName: 'PT Daya Cipta Digital', billDate: '2026-08-18', dueDate: '2026-09-01', amount: 68000000, paid: 0, outstanding: 68000000, daysOverdue: 0, status: 'Due Soon', priority: 'High', paymentMethod: 'Auto Debit', approvalStatus: 'Approved' },
  { id: 'bill-005', number: 'BILL-2026-0175', vendorId: 'vend-004', vendorName: 'PT Logistik Nusantara', billDate: '2026-08-12', dueDate: '2026-09-03', amount: 25000000, paid: 0, outstanding: 25000000, daysOverdue: 0, status: 'Due Soon', priority: 'Medium', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-006', number: 'BILL-2026-0180', vendorId: 'vend-003', vendorName: 'PT Kreasi Utama', billDate: '2026-07-20', dueDate: '2026-08-20', amount: 98000000, paid: 0, outstanding: 98000000, daysOverdue: 8, status: 'Overdue', priority: 'High', paymentMethod: 'Bank Transfer', approvalStatus: 'Pending' },
  { id: 'bill-007', number: 'BILL-2026-0185', vendorId: 'vend-002', vendorName: 'CV Maju Bersama', billDate: '2026-08-15', dueDate: '2026-08-30', amount: 97000000, paid: 97000000, outstanding: 0, daysOverdue: 0, status: 'Paid', priority: 'Low', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-008', number: 'BILL-2026-0190', vendorId: 'vend-005', vendorName: 'CV Sumber Daya Prima', billDate: '2026-07-25', dueDate: '2026-08-25', amount: 76000000, paid: 0, outstanding: 76000000, daysOverdue: 3, status: 'Overdue', priority: 'High', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-009', number: 'BILL-2026-0195', vendorId: 'vend-007', vendorName: 'UD Serba Ada', billDate: '2026-08-20', dueDate: '2026-10-05', amount: 55000000, paid: 0, outstanding: 55000000, daysOverdue: 0, status: 'Open', priority: 'Low', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-010', number: 'BILL-2026-0198', vendorId: 'vend-009', vendorName: 'CV Prima Konsultan', billDate: '2026-08-16', dueDate: '2026-09-15', amount: 45000000, paid: 0, outstanding: 45000000, daysOverdue: 0, status: 'Open', priority: 'Low', paymentMethod: 'Bank Transfer', approvalStatus: 'Pending' },
  { id: 'bill-011', number: 'BILL-2026-0202', vendorId: 'vend-008', vendorName: 'PT Arsitek Rancang Bangun', billDate: '2026-08-28', dueDate: '2026-09-28', amount: 48000000, paid: 0, outstanding: 48000000, daysOverdue: 0, status: 'Open', priority: 'Low', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
  { id: 'bill-012', number: 'BILL-2026-0205', vendorId: 'vend-010', vendorName: 'PT Wahana Ekspres', billDate: '2026-08-25', dueDate: '2026-09-10', amount: 36000000, paid: 0, outstanding: 36000000, daysOverdue: 0, status: 'Open', priority: 'Low', paymentMethod: 'Bank Transfer', approvalStatus: 'Approved' },
];

// ─── AR AGING DATA ────────────────────────────────────────────────────────────
export const arAgingData = [
  { bucket: 'Current', amount: 620000000, percentage: 50, color: '#16A34A' },
  { bucket: '1–30 Days', amount: 215000000, percentage: 17.3, color: '#2563EB' },
  { bucket: '31–60 Days', amount: 168000000, percentage: 13.5, color: '#D97706' },
  { bucket: '61–90 Days', amount: 152000000, percentage: 12.3, color: '#EA580C' },
  { bucket: '90+ Days', amount: 85000000, percentage: 6.9, color: '#DC2626' },
];

// ─── AP AGING DATA ────────────────────────────────────────────────────────────
export const apAgingData = [
  { bucket: 'Current', amount: 540000000, percentage: 62.8, color: '#16A34A' },
  { bucket: '1–30 Days', amount: 128000000, percentage: 14.9, color: '#2563EB' },
  { bucket: '31–60 Days', amount: 96000000, percentage: 11.2, color: '#D97706' },
  { bucket: '61–90 Days', amount: 62000000, percentage: 7.2, color: '#EA580C' },
  { bucket: '90+ Days', amount: 34000000, percentage: 3.9, color: '#DC2626' },
];

// ─── AR TREND DATA ────────────────────────────────────────────────────────────
export const arTrendData = [
  { month: 'Jan', openingAR: 980000000, newInvoices: 420000000, collections: 380000000, closingAR: 1020000000 },
  { month: 'Feb', openingAR: 1020000000, newInvoices: 385000000, collections: 410000000, closingAR: 995000000 },
  { month: 'Mar', openingAR: 995000000, newInvoices: 465000000, collections: 395000000, closingAR: 1065000000 },
  { month: 'Apr', openingAR: 1065000000, newInvoices: 398000000, collections: 425000000, closingAR: 1038000000 },
  { month: 'May', openingAR: 1038000000, newInvoices: 512000000, collections: 388000000, closingAR: 1162000000 },
  { month: 'Jun', openingAR: 1162000000, newInvoices: 445000000, collections: 452000000, closingAR: 1155000000 },
  { month: 'Jul', openingAR: 1155000000, newInvoices: 398000000, collections: 468000000, closingAR: 1085000000 },
  { month: 'Aug', openingAR: 1085000000, newInvoices: 310000000, collections: 155000000, closingAR: 1240000000 },
];

// ─── DSO TREND DATA ───────────────────────────────────────────────────────────
export const dsoTrendData = [
  { month: 'Jan', dso: 38 },
  { month: 'Feb', dso: 35 },
  { month: 'Mar', dso: 40 },
  { month: 'Apr', dso: 37 },
  { month: 'May', dso: 44 },
  { month: 'Jun', dso: 46 },
  { month: 'Jul', dso: 43 },
  { month: 'Aug', dso: 42 },
];

// ─── AP TREND DATA ────────────────────────────────────────────────────────────
export const apTrendData = [
  { month: 'Jan', openingAP: 720000000, newBills: 310000000, payments: 340000000, closingAP: 690000000 },
  { month: 'Feb', openingAP: 690000000, newBills: 285000000, payments: 320000000, closingAP: 655000000 },
  { month: 'Mar', openingAP: 655000000, newBills: 365000000, payments: 295000000, closingAP: 725000000 },
  { month: 'Apr', openingAP: 725000000, newBills: 298000000, payments: 345000000, closingAP: 678000000 },
  { month: 'May', openingAP: 678000000, newBills: 412000000, payments: 288000000, closingAP: 802000000 },
  { month: 'Jun', openingAP: 802000000, newBills: 345000000, payments: 352000000, closingAP: 795000000 },
  { month: 'Jul', openingAP: 795000000, newBills: 298000000, payments: 368000000, closingAP: 725000000 },
  { month: 'Aug', openingAP: 725000000, newBills: 285000000, payments: 150000000, closingAP: 860000000 },
];

// ─── COLLECTION FORECAST ─────────────────────────────────────────────────────
export const collectionForecast = [
  { period: '7 days', expected: 142000000, probability: 82 },
  { period: '14 days', expected: 285000000, probability: 74 },
  { period: '30 days', expected: 520000000, probability: 63 },
  { period: '60 days', expected: 780000000, probability: 51 },
];

// ─── PAYMENT FORECAST ────────────────────────────────────────────────────────
export const paymentForecastData = [
  { period: 'Today', amount: 68000000, bills: 1 },
  { period: 'This Week', amount: 238000000, bills: 4 },
  { period: 'Next Week', amount: 174000000, bills: 3 },
  { period: 'This Month', amount: 320000000, bills: 7 },
];

// ─── AI ANALYSES ─────────────────────────────────────────────────────────────
export interface AIAnalysis {
  id: string;
  title: string;
  type: string;
  createdAt: string;
  updatedAt: string;
  period: string;
  risk: RiskLevel;
  isFavorite: boolean;
  isArchived: boolean;
}

export const aiAnalyses: AIAnalysis[] = [
  { id: 'ai-001', title: 'Why did net profit decrease?', type: 'Profitability Analysis', createdAt: '2026-08-28', updatedAt: '2026-08-28', period: 'Jan–Aug 2026', risk: 'High', isFavorite: true, isArchived: false },
  { id: 'ai-002', title: 'Analyze receivables risk', type: 'Receivables Risk', createdAt: '2026-08-28', updatedAt: '2026-08-28', period: 'Jan–Aug 2026', risk: 'High', isFavorite: false, isArchived: false },
  { id: 'ai-003', title: 'Explain cash flow', type: 'Cash Flow Analysis', createdAt: '2026-08-28', updatedAt: '2026-08-28', period: 'Jan–Aug 2026', risk: 'Medium', isFavorite: false, isArchived: false },
  { id: 'ai-004', title: 'Compare Q2 vs Q1', type: 'Quarter Comparison', createdAt: '2026-08-27', updatedAt: '2026-08-27', period: 'Q1–Q2 2026', risk: 'Medium', isFavorite: true, isArchived: false },
  { id: 'ai-005', title: 'Find unusual expenses', type: 'Anomaly Detection', createdAt: '2026-08-27', updatedAt: '2026-08-27', period: 'Jan–Aug 2026', risk: 'High', isFavorite: false, isArchived: false },
];

// ─── FORMATTERS ──────────────────────────────────────────────────────────────
export function formatRupiah(value: number, compact = false): string {
  if (compact) {
    if (value >= 1000000000) return `Rp ${(value / 1000000000).toFixed(2)}B`;
    if (value >= 1000000) return `Rp ${(value / 1000000).toFixed(0)}M`;
    if (value >= 1000) return `Rp ${(value / 1000).toFixed(0)}K`;
    return `Rp ${value.toLocaleString('id-ID')}`;
  }
  return `Rp ${value.toLocaleString('id-ID')}`;
}

export function formatCompact(value: number): string {
  if (value >= 1000000000) return `${(value / 1000000000).toFixed(2)}B`;
  if (value >= 1000000) return `${(value / 1000000).toFixed(0)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}Jt`;
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