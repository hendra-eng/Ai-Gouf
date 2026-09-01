// Backend integration point: replace with API calls to /api/documents

export type DocumentType = 'Invoice' | 'Receipt' | 'Bank Statement' | 'Tax Document' | 'Contract' | 'Audit Evidence' | 'Financial Report' | 'Other';
export type DocumentStatus = 'Processed' | 'Pending Review' | 'Needs Attention' | 'Archived';
export type FileFormat = 'PDF' | 'Excel' | 'Image' | 'CSV' | 'Word';

export interface DocumentFolder {
  id: string;
  name: string;
  icon: string;
  count: number;
  size: string;
}

export interface FinancialDocument {
  id: string;
  name: string;
  type: DocumentType;
  fileFormat: FileFormat;
  date: string;
  company: string;
  relatedRecord: string;
  relatedRecordId: string;
  uploadedBy: string;
  status: DocumentStatus;
  size: string;
  tags: string[];
  aiAnalysis?: {
    vendor?: string;
    amount?: number;
    taxAmount?: number;
    invoiceNumber?: string;
    flags?: string[];
    confidence: number;
  };
}

export const documentFolders: DocumentFolder[] = [
  { id: 'folder-all', name: 'All Documents', icon: 'FolderOpen', count: 156, size: '284 MB' },
  { id: 'folder-invoices', name: 'Invoices', icon: 'FileText', count: 48, size: '42 MB' },
  { id: 'folder-receipts', name: 'Receipts', icon: 'Receipt', count: 32, size: '18 MB' },
  { id: 'folder-bank', name: 'Bank Statements', icon: 'Landmark', count: 18, size: '24 MB' },
  { id: 'folder-tax', name: 'Tax Documents', icon: 'FileCheck', count: 24, size: '68 MB' },
  { id: 'folder-contracts', name: 'Contracts', icon: 'ScrollText', count: 12, size: '45 MB' },
  { id: 'folder-audit', name: 'Audit Evidence', icon: 'ShieldCheck', count: 8, size: '32 MB' },
  { id: 'folder-reports', name: 'Financial Reports', icon: 'BarChart3', count: 10, size: '52 MB' },
  { id: 'folder-other', name: 'Other', icon: 'Folder', count: 4, size: '3 MB' },
];

export const documents: FinancialDocument[] = [
  {
    id: 'doc-001',
    name: 'INV-2026-0842 — PT Mitra Solusi Teknologi.pdf',
    type: 'Invoice',
    fileFormat: 'PDF',
    date: '28 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'INV-2026-0842',
    relatedRecordId: 'inv-842',
    uploadedBy: 'Sari Dewi',
    status: 'Processed',
    size: '284 KB',
    tags: ['AR', 'Technology', 'Q3-2026'],
    aiAnalysis: {
      vendor: 'PT Mitra Solusi Teknologi',
      amount: 185000000,
      taxAmount: 18500000,
      invoiceNumber: 'INV-2026-0842',
      flags: [],
      confidence: 96,
    },
  },
  {
    id: 'doc-002',
    name: 'Bank Statement BCA — Aug 2026.pdf',
    type: 'Bank Statement',
    fileFormat: 'PDF',
    date: '28 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'BANK-BCA-AUG26',
    relatedRecordId: 'bank-aug26',
    uploadedBy: 'Budi Santoso',
    status: 'Pending Review',
    size: '1.2 MB',
    tags: ['Bank', 'BCA', 'Aug-2026'],
    aiAnalysis: {
      flags: ['Reconciliation pending'],
      confidence: 88,
    },
  },
  {
    id: 'doc-003',
    name: 'PPN Masa Agustus 2026.pdf',
    type: 'Tax Document',
    fileFormat: 'PDF',
    date: '20 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'TAX-PPN-AUG26',
    relatedRecordId: 'tax-ppn-aug26',
    uploadedBy: 'Agus Prasetyo',
    status: 'Processed',
    size: '484 KB',
    tags: ['Tax', 'PPN', 'Monthly'],
    aiAnalysis: {
      amount: 124500000,
      flags: [],
      confidence: 94,
    },
  },
  {
    id: 'doc-004',
    name: 'Service Agreement — PT Globalindo Logistik.pdf',
    type: 'Contract',
    fileFormat: 'PDF',
    date: '15 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'CONT-2026-0024',
    relatedRecordId: 'cont-024',
    uploadedBy: 'Sari Dewi',
    status: 'Processed',
    size: '892 KB',
    tags: ['Contract', 'Service', 'Logistics'],
    aiAnalysis: {
      vendor: 'PT Globalindo Logistik',
      amount: 480000000,
      flags: [],
      confidence: 91,
    },
  },
  {
    id: 'doc-005',
    name: 'Receipt — Marketing Event Jul 2026.jpg',
    type: 'Receipt',
    fileFormat: 'Image',
    date: '31 Jul 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'EXP-2026-0318',
    relatedRecordId: 'exp-318',
    uploadedBy: 'Agus Prasetyo',
    status: 'Pending Review',
    size: '2.4 MB',
    tags: ['Receipt', 'Marketing', 'Expense'],
    aiAnalysis: {
      amount: 24500000,
      flags: ['Amount differs from expense claim by Rp 500Rb'],
      confidence: 78,
    },
  },
  {
    id: 'doc-006',
    name: 'INV-2026-0798 — CV Maju Bersama Sejahtera.pdf',
    type: 'Invoice',
    fileFormat: 'PDF',
    date: '25 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'INV-2026-0798',
    relatedRecordId: 'inv-798',
    uploadedBy: 'Budi Santoso',
    status: 'Needs Attention',
    size: '196 KB',
    tags: ['AR', 'Manufacturing', 'Q3-2026'],
    aiAnalysis: {
      vendor: 'CV Maju Bersama Sejahtera',
      amount: 96000000,
      taxAmount: 9600000,
      invoiceNumber: 'INV-2026-0798',
      flags: ['Potential duplicate — similar invoice INV-2026-0756 detected'],
      confidence: 82,
    },
  },
  {
    id: 'doc-007',
    name: 'Audit Evidence — Fixed Assets Q2 2026.xlsx',
    type: 'Audit Evidence',
    fileFormat: 'Excel',
    date: '10 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'AUDIT-FY26-FA-02',
    relatedRecordId: 'audit-fa-02',
    uploadedBy: 'Rina Kusuma',
    status: 'Processed',
    size: '428 KB',
    tags: ['Audit', 'Fixed Assets', 'FY2026'],
    aiAnalysis: {
      flags: [],
      confidence: 95,
    },
  },
  {
    id: 'doc-008',
    name: 'P&L Statement Jan-Aug 2026.pdf',
    type: 'Financial Report',
    fileFormat: 'PDF',
    date: '28 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'RPT-PL-AUG26',
    relatedRecordId: 'rpt-pl-aug26',
    uploadedBy: 'Sari Dewi',
    status: 'Processed',
    size: '284 KB',
    tags: ['Report', 'P&L', 'Monthly'],
    aiAnalysis: {
      amount: 8420000000,
      flags: [],
      confidence: 98,
    },
  },
  {
    id: 'doc-009',
    name: 'PPh 21 Juli 2026.pdf',
    type: 'Tax Document',
    fileFormat: 'PDF',
    date: '20 Jul 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'TAX-PPH21-JUL26',
    relatedRecordId: 'tax-pph21-jul26',
    uploadedBy: 'Agus Prasetyo',
    status: 'Processed',
    size: '312 KB',
    tags: ['Tax', 'PPh21', 'Monthly'],
    aiAnalysis: {
      amount: 48200000,
      flags: [],
      confidence: 96,
    },
  },
  {
    id: 'doc-010',
    name: 'Lease Agreement — Kantor Sudirman.pdf',
    type: 'Contract',
    fileFormat: 'PDF',
    date: '01 Jan 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'CONT-2026-0001',
    relatedRecordId: 'cont-001',
    uploadedBy: 'Sari Dewi',
    status: 'Archived',
    size: '1.8 MB',
    tags: ['Contract', 'Lease', 'Property'],
    aiAnalysis: {
      amount: 840000000,
      flags: [],
      confidence: 93,
    },
  },
  {
    id: 'doc-011',
    name: 'Receipt — Office Supplies Aug 2026.jpg',
    type: 'Receipt',
    fileFormat: 'Image',
    date: '22 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'EXP-2026-0342',
    relatedRecordId: 'exp-342',
    uploadedBy: 'Budi Santoso',
    status: 'Processed',
    size: '1.6 MB',
    tags: ['Receipt', 'Office', 'Expense'],
    aiAnalysis: {
      amount: 3200000,
      flags: [],
      confidence: 89,
    },
  },
  {
    id: 'doc-012',
    name: 'Bank Statement Mandiri — Aug 2026.pdf',
    type: 'Bank Statement',
    fileFormat: 'PDF',
    date: '28 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'BANK-MDR-AUG26',
    relatedRecordId: 'bank-mdr-aug26',
    uploadedBy: 'Budi Santoso',
    status: 'Needs Attention',
    size: '984 KB',
    tags: ['Bank', 'Mandiri', 'Aug-2026'],
    aiAnalysis: {
      flags: ['3 unmatched transactions detected', 'Balance differs from GL by Rp 12.4M'],
      confidence: 72,
    },
  },
  {
    id: 'doc-013',
    name: 'INV-2026-0831 — PT Karya Digital Nusantara.pdf',
    type: 'Invoice',
    fileFormat: 'PDF',
    date: '26 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'INV-2026-0831',
    relatedRecordId: 'inv-831',
    uploadedBy: 'Sari Dewi',
    status: 'Processed',
    size: '228 KB',
    tags: ['AR', 'Technology', 'Q3-2026'],
    aiAnalysis: {
      vendor: 'PT Karya Digital Nusantara',
      amount: 240000000,
      taxAmount: 24000000,
      invoiceNumber: 'INV-2026-0831',
      flags: [],
      confidence: 97,
    },
  },
  {
    id: 'doc-014',
    name: 'Audit Evidence — Cash Reconciliation Jul 2026.xlsx',
    type: 'Audit Evidence',
    fileFormat: 'Excel',
    date: '05 Aug 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'AUDIT-FY26-CASH-07',
    relatedRecordId: 'audit-cash-07',
    uploadedBy: 'Rina Kusuma',
    status: 'Processed',
    size: '184 KB',
    tags: ['Audit', 'Cash', 'FY2026'],
    aiAnalysis: {
      flags: [],
      confidence: 98,
    },
  },
  {
    id: 'doc-015',
    name: 'SPT Tahunan PPh Badan 2025.pdf',
    type: 'Tax Document',
    fileFormat: 'PDF',
    date: '31 Mar 2026',
    company: 'PT Nusantara Teknologi Indonesia',
    relatedRecord: 'TAX-SPT-2025',
    relatedRecordId: 'tax-spt-2025',
    uploadedBy: 'Agus Prasetyo',
    status: 'Archived',
    size: '2.8 MB',
    tags: ['Tax', 'Annual', 'PPh Badan'],
    aiAnalysis: {
      amount: 1240000000,
      flags: [],
      confidence: 99,
    },
  },
];