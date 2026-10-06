// [BARU] Ekspor CSV halaman Purchase (Transaction & Posted) -- dijalankan di
// browser, tanpa backend. Pola identik src/app/accounts-receivable/lib/arExport.ts:
// BOM UTF-8 supaya Excel baca karakter khusus dengan benar, sel yang diawali
// = + - @ diberi tanda kutip di depan supaya tidak dieksekusi sebagai rumus
// (CSV/formula injection).
import type { PurchaseTransaction } from '@/data/purchaseData';

function csvCell(v: string | number): string {
  if (typeof v === 'number') return String(v);
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', pending_review: 'Pending Review', approved: 'Approved',
  pending_posting: 'Pending Posting', posted: 'Posted', rejected: 'Rejected',
  exception: 'Exception', cancelled: 'Cancelled',
};
const PAYMENT_LABELS: Record<string, string> = {
  unpaid: 'Unpaid', partially_paid: 'Partial', paid: 'Paid', overdue: 'Overdue', on_hold: 'On Hold',
};

/** Dipakai tombol "Export" di halaman Purchase Transaction & Posted. */
export function exportPurchaseTransactionsCsv(rows: PurchaseTransaction[], filenamePrefix: string): void {
  const header = [
    'Purchase ID', 'Date', 'Invoice No.', 'PO Number', 'Vendor', 'Category',
    'Subtotal', 'Tax', 'Total', 'Payment Status', 'Due Date', 'Status', 'Period',
  ];
  const body = rows.map((r) => [
    r.purchaseId, r.purchaseDate, r.invoiceNumber, r.poNumber, r.vendor, r.category,
    r.subtotal, r.taxAmount, r.total, PAYMENT_LABELS[r.paymentStatus] || r.paymentStatus,
    r.dueDate, STATUS_LABELS[r.status] || r.status, r.period,
  ]);
  downloadCsv(`${filenamePrefix}-${stamp()}.csv`, [header, ...body]);
}