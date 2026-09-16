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
export const vendors = [
  { id: 'VND-001', name: 'Apex Supplies Ltd', category: 'Office Supplies', paymentTerms: 'Net 30' },
  { id: 'VND-002', name: 'Nexus IT Solutions', category: 'IT Equipment', paymentTerms: 'Net 45' },
  { id: 'VND-003', name: 'Meridian Logistics Co.', category: 'Logistics', paymentTerms: 'Net 15' },
  { id: 'VND-004', name: 'Brightfield Materials', category: 'Raw Materials', paymentTerms: 'Net 30' },
  { id: 'VND-005', name: 'Crestwood Facilities', category: 'Maintenance', paymentTerms: 'Net 30' },
  { id: 'VND-006', name: 'Pinnacle Marketing Group', category: 'Marketing', paymentTerms: 'Net 45' },
  { id: 'VND-007', name: 'Hartley Professional Services', category: 'Professional Services', paymentTerms: 'Net 30' },
  { id: 'VND-008', name: 'Summit Tech Hardware', category: 'IT Equipment', paymentTerms: 'Net 60' },
  { id: 'VND-009', name: 'Greenfield Raw Materials', category: 'Raw Materials', paymentTerms: 'Net 30' },
  { id: 'VND-010', name: 'Atlas Freight & Cargo', category: 'Logistics', paymentTerms: 'Net 15' },
];

// ─── Purchase Transactions ───────────────────────────────────────────────────
export const purchaseTransactions: PurchaseTransaction[] = [
  {
    id: 'pur-001',
    purchaseId: 'PUR-2026-09-0042',
    purchaseDate: '2026-09-14',
    invoiceDate: '2026-09-13',
    invoiceNumber: 'APEX-INV-7821',
    poNumber: 'PO-2026-0934',
    vendor: 'Apex Supplies Ltd',
    vendorId: 'VND-001',
    sourceDocType: 'Vendor Invoice',
    sourceRef: 'APEX-INV-7821',
    description: 'Office supplies and stationery — Q3 2026 bulk order',
    category: 'Office Supplies',
    subtotal: 43500.00,
    discount: 2175.00,
    taxAmount: 5040.00,
    total: 46365.00,
    accountsPayable: 46365.00,
    currency: 'USD',
    paymentStatus: 'unpaid',
    paymentTerms: 'Net 30',
    dueDate: '2026-10-14',
    status: 'pending_review',
    period: 'Sep 2026',
    createdBy: 'James Okafor',
    createdDate: '2026-09-14',
    updatedDate: '2026-09-14',
    notes: 'Q3 bulk order — 5% early payment discount available.',
    lines: [
      { id: 'pl-001-1', itemCode: 'OFF-001', description: 'A4 Copy Paper (500 reams)', quantity: 500, unit: 'ream', unitPrice: 45.00, discount: 1125.00, taxRate: 12, taxAmount: 2754.00, subtotal: 22500.00, total: 24129.00, accountCode: '5200', accountName: 'Office Supplies Expense' },
      { id: 'pl-001-2', itemCode: 'OFF-042', description: 'Printer Toner Cartridges (HP)', quantity: 30, unit: 'unit', unitPrice: 120.00, discount: 360.00, taxRate: 12, taxAmount: 432.00, subtotal: 3600.00, total: 3672.00, accountCode: '5200', accountName: 'Office Supplies Expense' },
      { id: 'pl-001-3', itemCode: 'OFF-088', description: 'Office Furniture — Ergonomic Chairs', quantity: 15, unit: 'unit', unitPrice: 1160.00, discount: 690.00, taxRate: 12, taxAmount: 1854.00, subtotal: 17400.00, total: 18564.00, accountCode: '1700', accountName: 'Furniture & Fixtures' },
    ],
  },
  {
    id: 'pur-002',
    purchaseId: 'PUR-2026-09-0041',
    purchaseDate: '2026-09-13',
    invoiceDate: '2026-09-12',
    invoiceNumber: 'NIT-2026-4412',
    poNumber: 'PO-2026-0921',
    vendor: 'Nexus IT Solutions',
    vendorId: 'VND-002',
    sourceDocType: 'Purchase Order',
    sourceRef: 'PO-2026-0921',
    description: 'Server hardware upgrade — data center expansion Phase 2',
    category: 'IT Equipment',
    subtotal: 128000.00,
    discount: 6400.00,
    taxAmount: 14592.00,
    total: 136192.00,
    accountsPayable: 136192.00,
    currency: 'USD',
    paymentStatus: 'unpaid',
    paymentTerms: 'Net 45',
    dueDate: '2026-10-28',
    status: 'approved',
    period: 'Sep 2026',
    createdBy: 'Sarah Chen',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-13',
    updatedDate: '2026-09-13',
    notes: 'Data center Phase 2 — approved by CTO. Capitalize as fixed asset.',
    lines: [
      { id: 'pl-002-1', itemCode: 'IT-201', description: 'Dell PowerEdge R750 Server (x4)', quantity: 4, unit: 'unit', unitPrice: 18500.00, discount: 3700.00, taxRate: 12, taxAmount: 8856.00, subtotal: 74000.00, total: 79156.00, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
      { id: 'pl-002-2', itemCode: 'IT-305', description: 'Network Switch 48-Port (x6)', quantity: 6, unit: 'unit', unitPrice: 3200.00, discount: 960.00, taxRate: 12, taxAmount: 2688.00, subtotal: 19200.00, total: 20928.00, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
      { id: 'pl-002-3', itemCode: 'IT-410', description: 'UPS Power Backup Units (x8)', quantity: 8, unit: 'unit', unitPrice: 4350.00, discount: 1740.00, taxRate: 12, taxAmount: 3048.00, subtotal: 34800.00, total: 36108.00, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
    ],
  },
  {
    id: 'pur-003',
    purchaseId: 'PUR-2026-09-0040',
    purchaseDate: '2026-09-12',
    invoiceDate: '2026-09-11',
    invoiceNumber: 'MLC-INV-3301',
    poNumber: 'PO-2026-0918',
    vendor: 'Meridian Logistics Co.',
    vendorId: 'VND-003',
    sourceDocType: 'Service Receipt',
    sourceRef: 'SR-2026-0918',
    description: 'Freight and logistics services — Sep 2026 shipments',
    category: 'Logistics',
    subtotal: 18750.00,
    discount: 0,
    taxAmount: 2250.00,
    total: 21000.00,
    accountsPayable: 21000.00,
    currency: 'USD',
    paymentStatus: 'paid',
    paymentTerms: 'Net 15',
    dueDate: '2026-09-27',
    status: 'posted',
    period: 'Sep 2026',
    createdBy: 'Lisa Thornton',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-12',
    updatedDate: '2026-09-12',
    postingDate: '2026-09-12',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-09-12 16:30:00',
    lines: [
      { id: 'pl-003-1', itemCode: 'LOG-001', description: 'Domestic freight — 45 shipments', quantity: 45, unit: 'shipment', unitPrice: 250.00, discount: 0, taxRate: 12, taxAmount: 1350.00, subtotal: 11250.00, total: 12600.00, accountCode: '6400', accountName: 'Freight & Logistics Expense' },
      { id: 'pl-003-2', itemCode: 'LOG-002', description: 'International freight — 3 shipments', quantity: 3, unit: 'shipment', unitPrice: 2500.00, discount: 0, taxRate: 12, taxAmount: 900.00, subtotal: 7500.00, total: 8400.00, accountCode: '6400', accountName: 'Freight & Logistics Expense' },
    ],
  },
  {
    id: 'pur-004',
    purchaseId: 'PUR-2026-09-0039',
    purchaseDate: '2026-09-11',
    invoiceDate: '2026-09-10',
    invoiceNumber: 'BFM-2026-0892',
    poNumber: 'PO-2026-0912',
    vendor: 'Brightfield Materials',
    vendorId: 'VND-004',
    sourceDocType: 'Goods Receipt',
    sourceRef: 'GR-2026-0912',
    description: 'Raw materials — aluminum alloy sheets and steel rods',
    category: 'Raw Materials',
    subtotal: 87400.00,
    discount: 4370.00,
    taxAmount: 9963.60,
    total: 92993.60,
    accountsPayable: 92993.60,
    currency: 'USD',
    paymentStatus: 'partially_paid',
    paymentTerms: 'Net 30',
    dueDate: '2026-10-11',
    status: 'posted',
    period: 'Sep 2026',
    createdBy: 'James Okafor',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-11',
    updatedDate: '2026-09-11',
    postingDate: '2026-09-11',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-09-11 14:15:00',
    lines: [
      { id: 'pl-004-1', itemCode: 'RM-201', description: 'Aluminum Alloy Sheet 3mm (500 units)', quantity: 500, unit: 'sheet', unitPrice: 98.00, discount: 2450.00, taxRate: 12, taxAmount: 5466.00, subtotal: 49000.00, total: 52016.00, accountCode: '1400', accountName: 'Raw Materials Inventory' },
      { id: 'pl-004-2', itemCode: 'RM-305', description: 'Steel Rod 12mm x 6m (200 units)', quantity: 200, unit: 'rod', unitPrice: 192.00, discount: 1920.00, taxRate: 12, taxAmount: 4497.60, subtotal: 38400.00, total: 40977.60, accountCode: '1400', accountName: 'Raw Materials Inventory' },
    ],
  },
  {
    id: 'pur-005',
    purchaseId: 'PUR-2026-09-0038',
    purchaseDate: '2026-09-10',
    invoiceDate: '2026-09-09',
    invoiceNumber: 'CWF-INV-1144',
    poNumber: 'PO-2026-0905',
    vendor: 'Crestwood Facilities',
    vendorId: 'VND-005',
    sourceDocType: 'Service Receipt',
    sourceRef: 'SR-2026-0905',
    description: 'Building maintenance and HVAC servicing — Sep 2026',
    category: 'Maintenance',
    subtotal: 12400.00,
    discount: 0,
    taxAmount: 1488.00,
    total: 13888.00,
    accountsPayable: 13888.00,
    currency: 'USD',
    paymentStatus: 'unpaid',
    paymentTerms: 'Net 30',
    dueDate: '2026-10-10',
    status: 'exception',
    period: 'Sep 2026',
    createdBy: 'Sarah Chen',
    createdDate: '2026-09-10',
    updatedDate: '2026-09-10',
    notes: 'EXCEPTION: Invoice number missing from vendor submission.',
    lines: [
      { id: 'pl-005-1', itemCode: 'MNT-001', description: 'HVAC preventive maintenance service', quantity: 1, unit: 'service', unitPrice: 8500.00, discount: 0, taxRate: 12, taxAmount: 1020.00, subtotal: 8500.00, total: 9520.00, accountCode: '6600', accountName: 'Maintenance & Repairs Expense' },
      { id: 'pl-005-2', itemCode: 'MNT-002', description: 'General building maintenance', quantity: 1, unit: 'service', unitPrice: 3900.00, discount: 0, taxRate: 12, taxAmount: 468.00, subtotal: 3900.00, total: 4368.00, accountCode: '6600', accountName: 'Maintenance & Repairs Expense' },
    ],
  },
  {
    id: 'pur-006',
    purchaseId: 'PUR-2026-09-0037',
    purchaseDate: '2026-09-09',
    invoiceDate: '2026-09-08',
    invoiceNumber: 'PMG-2026-0771',
    poNumber: 'PO-2026-0899',
    vendor: 'Pinnacle Marketing Group',
    vendorId: 'VND-006',
    sourceDocType: 'Vendor Invoice',
    sourceRef: 'PMG-2026-0771',
    description: 'Digital marketing campaign — Q3 2026 brand awareness',
    category: 'Marketing',
    subtotal: 35000.00,
    discount: 0,
    taxAmount: 4200.00,
    total: 39200.00,
    accountsPayable: 39200.00,
    currency: 'USD',
    paymentStatus: 'unpaid',
    paymentTerms: 'Net 45',
    dueDate: '2026-10-24',
    status: 'pending_review',
    period: 'Sep 2026',
    createdBy: 'Lisa Thornton',
    createdDate: '2026-09-09',
    updatedDate: '2026-09-09',
    lines: [
      { id: 'pl-006-1', itemCode: 'MKT-001', description: 'Social media advertising campaign', quantity: 1, unit: 'campaign', unitPrice: 18000.00, discount: 0, taxRate: 12, taxAmount: 2160.00, subtotal: 18000.00, total: 20160.00, accountCode: '6700', accountName: 'Marketing & Advertising Expense' },
      { id: 'pl-006-2', itemCode: 'MKT-002', description: 'Content creation and copywriting', quantity: 1, unit: 'project', unitPrice: 12000.00, discount: 0, taxRate: 12, taxAmount: 1440.00, subtotal: 12000.00, total: 13440.00, accountCode: '6700', accountName: 'Marketing & Advertising Expense' },
      { id: 'pl-006-3', itemCode: 'MKT-003', description: 'SEO optimization services', quantity: 1, unit: 'month', unitPrice: 5000.00, discount: 0, taxRate: 12, taxAmount: 600.00, subtotal: 5000.00, total: 5600.00, accountCode: '6700', accountName: 'Marketing & Advertising Expense' },
    ],
  },
  {
    id: 'pur-007',
    purchaseId: 'PUR-2026-09-0036',
    purchaseDate: '2026-09-08',
    invoiceDate: '2026-09-07',
    invoiceNumber: 'HPS-INV-2209',
    poNumber: 'PO-2026-0891',
    vendor: 'Hartley Professional Services',
    vendorId: 'VND-007',
    sourceDocType: 'Vendor Invoice',
    sourceRef: 'HPS-INV-2209',
    description: 'Legal and compliance consulting — Q3 2026',
    category: 'Professional Services',
    subtotal: 28500.00,
    discount: 0,
    taxAmount: 3420.00,
    total: 31920.00,
    accountsPayable: 31920.00,
    currency: 'USD',
    paymentStatus: 'paid',
    paymentTerms: 'Net 30',
    dueDate: '2026-10-08',
    status: 'posted',
    period: 'Sep 2026',
    createdBy: 'Marcus Webb',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-08',
    updatedDate: '2026-09-08',
    postingDate: '2026-09-08',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-09-08 11:45:00',
    lines: [
      { id: 'pl-007-1', itemCode: 'SVC-001', description: 'Legal advisory — contract review (40 hrs)', quantity: 40, unit: 'hour', unitPrice: 450.00, discount: 0, taxRate: 12, taxAmount: 2160.00, subtotal: 18000.00, total: 20160.00, accountCode: '6800', accountName: 'Professional Services Expense' },
      { id: 'pl-007-2', itemCode: 'SVC-002', description: 'Compliance audit support (15 hrs)', quantity: 15, unit: 'hour', unitPrice: 700.00, discount: 0, taxRate: 12, taxAmount: 1260.00, subtotal: 10500.00, total: 11760.00, accountCode: '6800', accountName: 'Professional Services Expense' },
    ],
  },
  {
    id: 'pur-008',
    purchaseId: 'PUR-2026-09-0035',
    purchaseDate: '2026-09-07',
    invoiceDate: '2026-09-06',
    invoiceNumber: 'STH-2026-0654',
    poNumber: 'PO-2026-0882',
    vendor: 'Summit Tech Hardware',
    vendorId: 'VND-008',
    sourceDocType: 'Purchase Order',
    sourceRef: 'PO-2026-0882',
    description: 'Laptop computers and peripherals — new employee onboarding',
    category: 'IT Equipment',
    subtotal: 54000.00,
    discount: 2700.00,
    taxAmount: 6156.00,
    total: 57456.00,
    accountsPayable: 57456.00,
    currency: 'USD',
    paymentStatus: 'unpaid',
    paymentTerms: 'Net 60',
    dueDate: '2026-11-06',
    status: 'approved',
    period: 'Sep 2026',
    createdBy: 'Sarah Chen',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-07',
    updatedDate: '2026-09-07',
    lines: [
      { id: 'pl-008-1', itemCode: 'IT-501', description: 'MacBook Pro 14" M3 (x12)', quantity: 12, unit: 'unit', unitPrice: 3200.00, discount: 1920.00, taxRate: 12, taxAmount: 4070.40, subtotal: 38400.00, total: 40550.40, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
      { id: 'pl-008-2', itemCode: 'IT-502', description: 'External Monitor 27" 4K (x12)', quantity: 12, unit: 'unit', unitPrice: 650.00, discount: 390.00, taxRate: 12, taxAmount: 751.20, subtotal: 7800.00, total: 8161.20, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
      { id: 'pl-008-3', itemCode: 'IT-503', description: 'Keyboard & Mouse Sets (x12)', quantity: 12, unit: 'set', unitPrice: 150.00, discount: 90.00, taxRate: 12, taxAmount: 194.40, subtotal: 1800.00, total: 1904.40, accountCode: '5200', accountName: 'Office Supplies Expense' },
      { id: 'pl-008-4', itemCode: 'IT-504', description: 'USB-C Docking Stations (x12)', quantity: 12, unit: 'unit', unitPrice: 500.00, discount: 300.00, taxRate: 12, taxAmount: 504.00, subtotal: 6000.00, total: 6204.00, accountCode: '1800', accountName: 'IT Equipment — Fixed Assets' },
    ],
  },
  {
    id: 'pur-009',
    purchaseId: 'PUR-2026-09-0034',
    purchaseDate: '2026-09-05',
    invoiceDate: '2026-09-04',
    invoiceNumber: 'GRM-INV-0441',
    poNumber: 'PO-2026-0874',
    vendor: 'Greenfield Raw Materials',
    vendorId: 'VND-009',
    sourceDocType: 'Goods Receipt',
    sourceRef: 'GR-2026-0874',
    description: 'Chemical compounds and industrial solvents — production batch',
    category: 'Raw Materials',
    subtotal: 62000.00,
    discount: 3100.00,
    taxAmount: 7068.00,
    total: 65968.00,
    accountsPayable: 65968.00,
    currency: 'USD',
    paymentStatus: 'overdue',
    paymentTerms: 'Net 30',
    dueDate: '2026-09-04',
    status: 'posted',
    period: 'Sep 2026',
    createdBy: 'James Okafor',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-05',
    updatedDate: '2026-09-05',
    postingDate: '2026-09-05',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-09-05 09:20:00',
    notes: 'OVERDUE — payment past due date. Follow up with AP team.',
    lines: [
      { id: 'pl-009-1', itemCode: 'RM-401', description: 'Industrial solvent IPA-99 (200L drums)', quantity: 50, unit: 'drum', unitPrice: 620.00, discount: 1550.00, taxRate: 12, taxAmount: 3534.00, subtotal: 31000.00, total: 32984.00, accountCode: '1400', accountName: 'Raw Materials Inventory' },
      { id: 'pl-009-2', itemCode: 'RM-402', description: 'Chemical compound XR-7 (100kg bags)', quantity: 100, unit: 'bag', unitPrice: 310.00, discount: 1550.00, taxRate: 12, taxAmount: 3534.00, subtotal: 31000.00, total: 32984.00, accountCode: '1400', accountName: 'Raw Materials Inventory' },
    ],
  },
  {
    id: 'pur-010',
    purchaseId: 'PUR-2026-09-0033',
    purchaseDate: '2026-09-04',
    invoiceDate: '2026-09-03',
    invoiceNumber: 'AFC-2026-1882',
    poNumber: 'PO-2026-0866',
    vendor: 'Atlas Freight & Cargo',
    vendorId: 'VND-010',
    sourceDocType: 'Service Receipt',
    sourceRef: 'SR-2026-0866',
    description: 'International cargo handling and customs clearance',
    category: 'Logistics',
    subtotal: 9800.00,
    discount: 0,
    taxAmount: 1176.00,
    total: 10976.00,
    accountsPayable: 10976.00,
    currency: 'USD',
    paymentStatus: 'paid',
    paymentTerms: 'Net 15',
    dueDate: '2026-09-19',
    status: 'posted',
    period: 'Sep 2026',
    createdBy: 'Lisa Thornton',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-09-04',
    updatedDate: '2026-09-04',
    postingDate: '2026-09-04',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-09-04 13:00:00',
    lines: [
      { id: 'pl-010-1', itemCode: 'LOG-101', description: 'International cargo handling fee', quantity: 1, unit: 'service', unitPrice: 6500.00, discount: 0, taxRate: 12, taxAmount: 780.00, subtotal: 6500.00, total: 7280.00, accountCode: '6400', accountName: 'Freight & Logistics Expense' },
      { id: 'pl-010-2', itemCode: 'LOG-102', description: 'Customs clearance and documentation', quantity: 1, unit: 'service', unitPrice: 3300.00, discount: 0, taxRate: 12, taxAmount: 396.00, subtotal: 3300.00, total: 3696.00, accountCode: '6400', accountName: 'Freight & Logistics Expense' },
    ],
  },
  {
    id: 'pur-011',
    purchaseId: 'PUR-2026-08-0091',
    purchaseDate: '2026-08-28',
    invoiceDate: '2026-08-27',
    invoiceNumber: 'APEX-INV-7744',
    poNumber: 'PO-2026-0821',
    vendor: 'Apex Supplies Ltd',
    vendorId: 'VND-001',
    sourceDocType: 'Vendor Invoice',
    sourceRef: 'APEX-INV-7744',
    description: 'Office supplies — Aug 2026 monthly replenishment',
    category: 'Office Supplies',
    subtotal: 8200.00,
    discount: 0,
    taxAmount: 984.00,
    total: 9184.00,
    accountsPayable: 9184.00,
    currency: 'USD',
    paymentStatus: 'paid',
    paymentTerms: 'Net 30',
    dueDate: '2026-09-27',
    status: 'posted',
    period: 'Aug 2026',
    createdBy: 'James Okafor',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-08-28',
    updatedDate: '2026-08-28',
    postingDate: '2026-08-28',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-08-28 10:30:00',
    lines: [
      { id: 'pl-011-1', itemCode: 'OFF-001', description: 'A4 Copy Paper (200 reams)', quantity: 200, unit: 'ream', unitPrice: 45.00, discount: 0, taxRate: 12, taxAmount: 1080.00, subtotal: 9000.00, total: 10080.00, accountCode: '5200', accountName: 'Office Supplies Expense' },
    ],
  },
  {
    id: 'pur-012',
    purchaseId: 'PUR-2026-08-0088',
    purchaseDate: '2026-08-25',
    invoiceDate: '2026-08-24',
    invoiceNumber: 'NIT-2026-4301',
    poNumber: 'PO-2026-0812',
    vendor: 'Nexus IT Solutions',
    vendorId: 'VND-002',
    sourceDocType: 'Vendor Invoice',
    sourceRef: 'NIT-2026-4301',
    description: 'Annual software license renewal — ERP and productivity suite',
    category: 'IT Equipment',
    subtotal: 48000.00,
    discount: 4800.00,
    taxAmount: 5184.00,
    total: 48384.00,
    accountsPayable: 48384.00,
    currency: 'USD',
    paymentStatus: 'paid',
    paymentTerms: 'Net 45',
    dueDate: '2026-10-09',
    status: 'posted',
    period: 'Aug 2026',
    createdBy: 'Sarah Chen',
    approvedBy: 'Marcus Webb',
    createdDate: '2026-08-25',
    updatedDate: '2026-08-25',
    postingDate: '2026-08-25',
    postedBy: 'Marcus Webb',
    postedTimestamp: '2026-08-25 15:00:00',
    lines: [
      { id: 'pl-012-1', itemCode: 'SW-001', description: 'ERP Annual License (50 users)', quantity: 50, unit: 'user/year', unitPrice: 720.00, discount: 3600.00, taxRate: 12, taxAmount: 3888.00, subtotal: 36000.00, total: 36288.00, accountCode: '1900', accountName: 'Prepaid Software Licenses' },
      { id: 'pl-012-2', itemCode: 'SW-002', description: 'Microsoft 365 Business (50 users)', quantity: 50, unit: 'user/year', unitPrice: 240.00, discount: 1200.00, taxRate: 12, taxAmount: 1296.00, subtotal: 12000.00, total: 12096.00, accountCode: '1900', accountName: 'Prepaid Software Licenses' },
    ],
  },
];

// ─── Source Records ──────────────────────────────────────────────────────────
export const purchaseSourceRecords: PurchaseSourceRecord[] = [
  { id: 'psrc-001', sourceId: 'APEX-INV-7821', sourceType: 'Vendor Invoice', vendor: 'Apex Supplies Ltd', vendorId: 'VND-001', sourceDate: '2026-09-13', invoiceNumber: 'APEX-INV-7821', poNumber: 'PO-2026-0934', description: 'Office supplies and stationery — Q3 2026 bulk order', amount: 43500.00, taxAmount: 5040.00, totalAmount: 46365.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0042', period: 'Sep 2026', createdBy: 'James Okafor', createdDate: '2026-09-14', validationStatus: 'Valid' },
  { id: 'psrc-002', sourceId: 'PO-2026-0921', sourceType: 'Purchase Order', vendor: 'Nexus IT Solutions', vendorId: 'VND-002', sourceDate: '2026-09-12', invoiceNumber: 'NIT-2026-4412', poNumber: 'PO-2026-0921', description: 'Server hardware upgrade — data center expansion Phase 2', amount: 128000.00, taxAmount: 14592.00, totalAmount: 136192.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0041', period: 'Sep 2026', createdBy: 'Sarah Chen', createdDate: '2026-09-13', validationStatus: 'Valid' },
  { id: 'psrc-003', sourceId: 'SR-2026-0918', sourceType: 'Service Receipt', vendor: 'Meridian Logistics Co.', vendorId: 'VND-003', sourceDate: '2026-09-11', invoiceNumber: 'MLC-INV-3301', poNumber: 'PO-2026-0918', description: 'Freight and logistics services — Sep 2026 shipments', amount: 18750.00, taxAmount: 2250.00, totalAmount: 21000.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0040', period: 'Sep 2026', createdBy: 'Lisa Thornton', createdDate: '2026-09-12', validationStatus: 'Valid' },
  { id: 'psrc-004', sourceId: 'GR-2026-0912', sourceType: 'Goods Receipt', vendor: 'Brightfield Materials', vendorId: 'VND-004', sourceDate: '2026-09-10', invoiceNumber: 'BFM-2026-0892', poNumber: 'PO-2026-0912', description: 'Raw materials — aluminum alloy sheets and steel rods', amount: 87400.00, taxAmount: 9963.60, totalAmount: 92993.60, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0039', period: 'Sep 2026', createdBy: 'James Okafor', createdDate: '2026-09-11', validationStatus: 'Valid' },
  { id: 'psrc-005', sourceId: 'SR-2026-0905', sourceType: 'Service Receipt', vendor: 'Crestwood Facilities', vendorId: 'VND-005', sourceDate: '2026-09-09', invoiceNumber: '', poNumber: 'PO-2026-0905', description: 'Building maintenance and HVAC servicing — Sep 2026', amount: 12400.00, taxAmount: 1488.00, totalAmount: 13888.00, currency: 'USD', status: 'Validation Error', relatedPurchaseId: 'PUR-2026-09-0038', period: 'Sep 2026', createdBy: 'Sarah Chen', createdDate: '2026-09-10', validationStatus: 'Invalid' },
  { id: 'psrc-006', sourceId: 'PMG-2026-0771', sourceType: 'Vendor Invoice', vendor: 'Pinnacle Marketing Group', vendorId: 'VND-006', sourceDate: '2026-09-08', invoiceNumber: 'PMG-2026-0771', poNumber: 'PO-2026-0899', description: 'Digital marketing campaign — Q3 2026 brand awareness', amount: 35000.00, taxAmount: 4200.00, totalAmount: 39200.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0037', period: 'Sep 2026', createdBy: 'Lisa Thornton', createdDate: '2026-09-09', validationStatus: 'Valid' },
  { id: 'psrc-007', sourceId: 'HPS-INV-2209', sourceType: 'Vendor Invoice', vendor: 'Hartley Professional Services', vendorId: 'VND-007', sourceDate: '2026-09-07', invoiceNumber: 'HPS-INV-2209', poNumber: 'PO-2026-0891', description: 'Legal and compliance consulting — Q3 2026', amount: 28500.00, taxAmount: 3420.00, totalAmount: 31920.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0036', period: 'Sep 2026', createdBy: 'Marcus Webb', createdDate: '2026-09-08', validationStatus: 'Valid' },
  { id: 'psrc-008', sourceId: 'PO-2026-0882', sourceType: 'Purchase Order', vendor: 'Summit Tech Hardware', vendorId: 'VND-008', sourceDate: '2026-09-06', invoiceNumber: 'STH-2026-0654', poNumber: 'PO-2026-0882', description: 'Laptop computers and peripherals — new employee onboarding', amount: 54000.00, taxAmount: 6156.00, totalAmount: 57456.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0035', period: 'Sep 2026', createdBy: 'Sarah Chen', createdDate: '2026-09-07', validationStatus: 'Valid' },
  { id: 'psrc-009', sourceId: 'GR-2026-0874', sourceType: 'Goods Receipt', vendor: 'Greenfield Raw Materials', vendorId: 'VND-009', sourceDate: '2026-09-04', invoiceNumber: 'GRM-INV-0441', poNumber: 'PO-2026-0874', description: 'Chemical compounds and industrial solvents — production batch', amount: 62000.00, taxAmount: 7068.00, totalAmount: 65968.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0034', period: 'Sep 2026', createdBy: 'James Okafor', createdDate: '2026-09-05', validationStatus: 'Valid' },
  { id: 'psrc-010', sourceId: 'SR-2026-0866', sourceType: 'Service Receipt', vendor: 'Atlas Freight & Cargo', vendorId: 'VND-010', sourceDate: '2026-09-03', invoiceNumber: 'AFC-2026-1882', poNumber: 'PO-2026-0866', description: 'International cargo handling and customs clearance', amount: 9800.00, taxAmount: 1176.00, totalAmount: 10976.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-09-0033', period: 'Sep 2026', createdBy: 'Lisa Thornton', createdDate: '2026-09-04', validationStatus: 'Valid' },
  { id: 'psrc-011', sourceId: 'PO-2026-0951', sourceType: 'Purchase Order', vendor: 'Brightfield Materials', vendorId: 'VND-004', sourceDate: '2026-09-14', invoiceNumber: '', poNumber: 'PO-2026-0951', description: 'Steel coils and copper wire — production Q4 advance order', amount: 145000.00, taxAmount: 17400.00, totalAmount: 162400.00, currency: 'USD', status: 'Pending Mapping', relatedPurchaseId: null, period: 'Sep 2026', createdBy: 'James Okafor', createdDate: '2026-09-14', validationStatus: 'Pending Validation' },
  { id: 'psrc-012', sourceId: 'APEX-INV-7744', sourceType: 'Vendor Invoice', vendor: 'Apex Supplies Ltd', vendorId: 'VND-001', sourceDate: '2026-08-27', invoiceNumber: 'APEX-INV-7744', poNumber: 'PO-2026-0821', description: 'Office supplies — Aug 2026 monthly replenishment', amount: 8200.00, taxAmount: 984.00, totalAmount: 9184.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-08-0091', period: 'Aug 2026', createdBy: 'James Okafor', createdDate: '2026-08-28', validationStatus: 'Valid' },
  { id: 'psrc-013', sourceId: 'NIT-2026-4301', sourceType: 'Vendor Invoice', vendor: 'Nexus IT Solutions', vendorId: 'VND-002', sourceDate: '2026-08-24', invoiceNumber: 'NIT-2026-4301', poNumber: 'PO-2026-0812', description: 'Annual software license renewal — ERP and productivity suite', amount: 48000.00, taxAmount: 5184.00, totalAmount: 48384.00, currency: 'USD', status: 'Mapped', relatedPurchaseId: 'PUR-2026-08-0088', period: 'Aug 2026', createdBy: 'Sarah Chen', createdDate: '2026-08-25', validationStatus: 'Valid' },
];

// ─── Exceptions ──────────────────────────────────────────────────────────────
export const purchaseExceptions: PurchaseException[] = [
  { id: 'pexc-001', purchaseId: 'PUR-2026-09-0038', exceptionType: 'Missing Invoice Number', severity: 'Critical', vendor: 'Crestwood Facilities', invoiceNumber: '—', purchaseDate: '2026-09-10', amount: 13888.00, currency: 'USD', description: 'Vendor invoice submitted without an invoice number. Cannot process payment or post to AP without valid invoice reference.', detectedDate: '2026-09-10', assignedTo: 'Sarah Chen', status: 'Open', period: 'Sep 2026' },
  { id: 'pexc-002', purchaseId: 'PUR-2026-09-0042', exceptionType: 'Purchase Order Mismatch', severity: 'High', vendor: 'Apex Supplies Ltd', invoiceNumber: 'APEX-INV-7821', purchaseDate: '2026-09-14', amount: 46365.00, currency: 'USD', description: 'Invoice total $46,365 does not match approved PO amount $44,800. Variance of $1,565 requires approval before processing.', detectedDate: '2026-09-14', assignedTo: 'James Okafor', status: 'Under Review', period: 'Sep 2026' },
  { id: 'pexc-003', purchaseId: 'PUR-2026-09-0034', exceptionType: 'Missing Approval', severity: 'High', vendor: 'Greenfield Raw Materials', invoiceNumber: 'GRM-INV-0441', purchaseDate: '2026-09-05', amount: 65968.00, currency: 'USD', description: 'Purchase transaction exceeds $50,000 threshold and requires CFO approval. Currently only Controller-level approval on file.', detectedDate: '2026-09-05', assignedTo: 'Marcus Webb', status: 'Requires Correction', resolution: 'Escalated to CFO for approval sign-off.', period: 'Sep 2026' },
  { id: 'pexc-004', purchaseId: 'PUR-2026-09-0037', exceptionType: 'Tax Mismatch', severity: 'Medium', vendor: 'Pinnacle Marketing Group', invoiceNumber: 'PMG-2026-0771', purchaseDate: '2026-09-09', amount: 39200.00, currency: 'USD', description: 'Tax rate applied (12%) does not match vendor tax registration category (exempt services). Tax amount of $4,200 may need to be reversed.', detectedDate: '2026-09-09', assignedTo: 'Lisa Thornton', status: 'Under Review', period: 'Sep 2026' },
  { id: 'pexc-005', purchaseId: 'PUR-2026-09-0041', exceptionType: 'Duplicate Invoice', severity: 'Medium', vendor: 'Nexus IT Solutions', invoiceNumber: 'NIT-2026-4412', purchaseDate: '2026-09-13', amount: 136192.00, currency: 'USD', description: 'Invoice NIT-2026-4412 appears to match a previously submitted invoice NIT-2026-4401 from Aug 2026. Potential duplicate submission.', detectedDate: '2026-09-13', assignedTo: 'Sarah Chen', status: 'Under Review', period: 'Sep 2026' },
  { id: 'pexc-006', purchaseId: 'PUR-2026-09-0033', exceptionType: 'Missing Documentation', severity: 'Low', vendor: 'Atlas Freight & Cargo', invoiceNumber: 'AFC-2026-1882', purchaseDate: '2026-09-04', amount: 10976.00, currency: 'USD', description: 'Customs clearance documentation (Bill of Lading, customs declaration) not attached to purchase record. Required for audit trail.', detectedDate: '2026-09-04', assignedTo: 'Lisa Thornton', status: 'Resolved', resolution: 'Documentation received and attached on 2026-09-06.', resolutionDate: '2026-09-06', period: 'Sep 2026' },
  { id: 'pexc-007', purchaseId: 'PUR-2026-09-0039', exceptionType: 'Price Mismatch', severity: 'High', vendor: 'Brightfield Materials', invoiceNumber: 'BFM-2026-0892', purchaseDate: '2026-09-11', amount: 92993.60, currency: 'USD', description: 'Unit price for aluminum alloy sheets ($98/sheet) exceeds contracted price of $92/sheet. Overcharge of $3,000 on 500 units.', detectedDate: '2026-09-11', assignedTo: 'James Okafor', status: 'Open', period: 'Sep 2026' },
];

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
