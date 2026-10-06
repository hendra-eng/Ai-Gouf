// Ekspor CSV halaman Accounts Receivable (dijalankan di browser, tanpa backend).
// File diberi BOM UTF-8 supaya Excel membaca karakter "—" / nama berhuruf
// khusus dengan benar, dan sel teks yang diawali = + - @ diberi tanda kutip
// di depan supaya tidak dieksekusi sebagai rumus (CSV/formula injection).
import type { Invoice } from '@/lib/mockData';
import type { PaymentView } from './arDbBridge';

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

export function exportInvoicesCsv(invoices: Invoice[], filename?: string): void {
  const header = ['Invoice #', 'Customer', 'Account Manager', 'Invoice Date', 'Due Date', 'Amount', 'Paid', 'Outstanding', 'Days Overdue', 'Status', 'Priority'];
  const rows = invoices.map((i) => [
    i.number, i.customerName, i.accountManager, i.invoiceDate, i.dueDate,
    i.amount, i.paid, i.outstanding, i.daysOverdue, i.status, i.priority,
  ]);
  downloadCsv(filename || `accounts-receivable-invoices-${stamp()}.csv`, [header, ...rows]);
}

export function exportInvoiceDetailCsv(invoice: Invoice, payments: PaymentView[]): void {
  const rows: (string | number)[][] = [
    ['Invoice #', invoice.number],
    ['Customer', invoice.customerName],
    ['Invoice Date', invoice.invoiceDate],
    ['Due Date', invoice.dueDate],
    ['Amount', invoice.amount],
    ['Paid', invoice.paid],
    ['Outstanding', invoice.outstanding],
    ['Status', invoice.status],
    [],
    ['Payment Date', 'Amount', 'Method', 'Reference', 'Recorded By'],
    ...payments.map((p) => [p.date, p.amount, p.method, p.reference, p.createdBy]),
  ];
  downloadCsv(`invoice-${invoice.number.replace(/[^A-Za-z0-9_-]+/g, '-')}-${stamp()}.csv`, rows);
}
