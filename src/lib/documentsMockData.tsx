// Backend integration point: replace with API calls to /api/documents

export type DocumentType = 'Invoice' | 'Receipt' | 'Bank Statement' | 'Tax Document' | 'Contract' | 'Audit Evidence' | 'Financial Report' | 'Other';
export type DocumentStatus = 'Processed' | 'Pending Review' | 'Needs Attention' | 'Archived';
export type FileFormat = 'PDF' | 'Excel' | 'Image' | 'CSV' | 'Word';

// [BARU] Field aiAnalysis di bawah ini dipakai juga oleh data ASLI (lihat
// src/app/documents/lib/useDocumentsData.ts) -- backend generik
// GET /api/client/{id}/riwayat TIDAK menyimpan skor keyakinan (confidence)
// per dokumen, jadi field itu dibuat opsional supaya tidak perlu mengarang
// angka untuk data real (hanya data contoh di bawah yang mengisinya).

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
    confidence?: number;
  };
}

export const documentFolders: DocumentFolder[] = [
  { id: 'folder-all', name: 'All Documents', icon: 'FolderOpen', count: 0, size: '0 MB' },
  { id: 'folder-invoices', name: 'Invoices', icon: 'FileText', count: 0, size: '0 MB' },
  { id: 'folder-receipts', name: 'Receipts', icon: 'Receipt', count: 0, size: '0 MB' },
  { id: 'folder-bank', name: 'Bank Statements', icon: 'Landmark', count: 0, size: '0 MB' },
  { id: 'folder-tax', name: 'Tax Documents', icon: 'FileCheck', count: 0, size: '0 MB' },
  { id: 'folder-contracts', name: 'Contracts', icon: 'ScrollText', count: 0, size: '0 MB' },
  { id: 'folder-audit', name: 'Audit Evidence', icon: 'ShieldCheck', count: 0, size: '0 MB' },
  { id: 'folder-reports', name: 'Financial Reports', icon: 'BarChart3', count: 0, size: '0 MB' },
  { id: 'folder-other', name: 'Other', icon: 'Folder', count: 0, size: '0 MB' },
];

export const documents: FinancialDocument[] = [];