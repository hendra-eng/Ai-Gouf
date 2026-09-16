// [BARU] Util export khusus tab-tab baru di halaman /transactions. File-file
// di folder tabs/ (Sales/Purchase/Journal Entry/Cash & Bank/Other) semula
// mengimpor `exportToCSV`, `exportToPDF`, `exportGLSnapshot` dari
// `@/lib/exportUtils` — path itu tidak pernah ada di project ini. Util ini
// mengimplementasikan ketiga fungsi tersebut dengan library yang memang
// sudah jadi dependency project (jsPDF + jspdf-autotable), jadi tidak perlu
// nambah package baru.
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/** Export baris data (array of plain objects) sebagai file CSV. */
export function exportToCSV(rows: Record<string, unknown>[], fileName: string): void {
  if (!rows || rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((h) => csvEscape(row[h])).join(',')),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, `${fileName}.csv`);
}

/** Export tabel data sebagai laporan PDF (judul + subjudul + tabel). */
export function exportToPDF(
  title: string,
  subtitle: string,
  headers: string[],
  rows: (string | number)[][],
  fileName: string
): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 14, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(subtitle, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
    tableWidth: pageWidth - 28,
  });

  doc.output('dataurlnewwindow');
  doc.save(`${fileName}.pdf`);
}

interface GLEntry {
  accountCode: string;
  accountName: string;
  openingBalance: number;
  totalDebits: number;
  totalCredits: number;
  closingBalance: number;
  period: string;
}

function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Export snapshot buku besar (General Ledger) per akun sebagai PDF. */
export function exportGLSnapshot(entries: GLEntry[], period: string, moduleName: string): void {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(`${moduleName} — General Ledger Snapshot`, 14, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Accounting period: ${period}`, 14, 21);

  autoTable(doc, {
    startY: 26,
    head: [['Account Code', 'Account Name', 'Opening Balance', 'Total Debits', 'Total Credits', 'Closing Balance']],
    body: entries.map((e) => [
      e.accountCode,
      e.accountName,
      formatAmount(e.openingBalance),
      formatAmount(e.totalDebits),
      formatAmount(e.totalCredits),
      formatAmount(e.closingBalance),
    ]),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [30, 41, 59] },
    margin: { left: 14, right: 14 },
    tableWidth: pageWidth - 28,
  });

  doc.output('dataurlnewwindow');
  doc.save(`GL_Snapshot_${moduleName.replace(/\s+/g, '_')}_${period.replace(/\s+/g, '_')}.pdf`);
}
