import type { PrintReport } from '@/lib/printExport';
import type { PurchaseTransaction, PurchaseLine } from '@/data/purchaseData';

// Susunan laporan Print (CSV / Excel / PDF) untuk fitur Purchase.
// Daftar = 1 baris per transaksi pembelian (sesuai kolom tabel);
// detail = 1 transaksi dengan baris item/jasa + ringkasan total.

const titleCase = (s: string) => s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export function buildPurchaseListReport(rows: PurchaseTransaction[], companyName?: string, printedBy?: string): PrintReport {
  const sum = (k: 'subtotal' | 'discount' | 'taxAmount' | 'total') => rows.reduce((s, r) => s + (r[k] || 0), 0);
  return {
    title: 'Purchase Transactions',
    fileBase: 'Purchase-Transactions',
    companyName,
    printedBy,
    subtitle: `${rows.length} transactions`,
    orientation: 'landscape',
    table: {
      columns: [
        { key: 'purchaseId', header: 'Purchase ID', width: 18 },
        { key: 'purchaseDate', header: 'Date', width: 12 },
        { key: 'invoiceNumber', header: 'Invoice No.', width: 18 },
        { key: 'poNumber', header: 'PO Number', width: 16 },
        { key: 'vendor', header: 'Vendor', width: 26 },
        { key: 'category', header: 'Category', width: 14 },
        { key: 'subtotal', header: 'Subtotal', type: 'money' },
        { key: 'discount', header: 'Discount', type: 'money' },
        { key: 'taxAmount', header: 'Tax', type: 'money' },
        { key: 'total', header: 'Total', type: 'money' },
        { key: 'paymentStatus', header: 'Payment', width: 12 },
        { key: 'dueDate', header: 'Due Date', width: 12 },
        { key: 'status', header: 'Status', width: 14 },
        { key: 'period', header: 'Period', width: 11 },
      ],
      rows: rows.map(r => ({
        purchaseId: r.purchaseId,
        purchaseDate: r.purchaseDate,
        invoiceNumber: r.invoiceNumber,
        poNumber: r.poNumber,
        vendor: r.vendor,
        category: r.category,
        subtotal: r.subtotal,
        discount: r.discount,
        taxAmount: r.taxAmount,
        total: r.total,
        paymentStatus: titleCase(r.paymentStatus),
        dueDate: r.dueDate,
        status: titleCase(r.status),
        period: r.period,
      })),
      totals: { category: 'TOTAL', subtotal: sum('subtotal'), discount: sum('discount'), taxAmount: sum('taxAmount'), total: sum('total') },
    },
  };
}

export function buildPurchaseDetailReport(tx: PurchaseTransaction, lines: PurchaseLine[], companyName?: string, printedBy?: string): PrintReport {
  return {
    title: 'Purchase Transaction',
    fileBase: `Purchase-${tx.purchaseId}`,
    companyName,
    printedBy,
    subtitle: tx.purchaseId,
    orientation: 'landscape',
    fields: [
      ['Purchase ID', tx.purchaseId],
      ['Status', titleCase(tx.status)],
      ['Vendor', tx.vendor],
      ['Payment Status', titleCase(tx.paymentStatus)],
      ['Invoice Number', tx.invoiceNumber || '—'],
      ['PO Number', tx.poNumber || '—'],
      ['Purchase Date', tx.purchaseDate],
      ['Invoice Date', tx.invoiceDate || '—'],
      ['Due Date', tx.dueDate || '—'],
      ['Payment Terms', tx.paymentTerms || '—'],
      ['Category', tx.category],
      ['Period', tx.period],
      ['Currency', tx.currency],
      ['Created By', tx.createdBy],
      ['Approved By', tx.approvedBy || '—'],
      ['Description', tx.description],
    ],
    table: {
      columns: [
        { key: 'itemCode', header: 'Item Code', width: 14 },
        { key: 'description', header: 'Item / Service', width: 34 },
        { key: 'quantity', header: 'Qty', type: 'number', width: 8 },
        { key: 'unit', header: 'Unit', width: 8 },
        { key: 'unitPrice', header: 'Unit Price', type: 'money' },
        { key: 'discount', header: 'Discount', type: 'money' },
        { key: 'taxAmount', header: 'Tax', type: 'money' },
        { key: 'total', header: 'Total', type: 'money' },
        { key: 'account', header: 'Account', width: 30 },
      ],
      rows: lines.map(l => ({
        itemCode: l.itemCode || '',
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discount: l.discount || null,
        taxAmount: l.taxAmount,
        total: l.total,
        account: [l.accountCode, l.accountName].filter(Boolean).join(' · '),
      })),
    },
    summary: [
      ['Subtotal', tx.subtotal, 'money'],
      ['Discount', -tx.discount, 'money'],
      ['Tax (Input VAT)', tx.taxAmount, 'money'],
      ['Total Payable', tx.total, 'money'],
    ],
    notes: tx.notes,
  };
}
