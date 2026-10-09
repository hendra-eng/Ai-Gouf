import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';

// Helper "Print" generik untuk daftar transaksi & detail transaksi (Sales,
// Purchase, Journal Entry). Satu definisi laporan (PrintReport) bisa dicetak
// ke 3 format -- CSV, Excel (exceljs), PDF (jsPDF + autotable) -- supaya isi
// ketiga file selalu sama dan tiap halaman cukup menyusun datanya sekali.
//
// - Laporan daftar: cukup `table` (+ `table.totals` untuk baris TOTAL).
// - Laporan detail: `fields` (info header transaksi), `table` (baris item /
//   baris jurnal), `summary` (subtotal/pajak/total), `notes`.

export type PrintFormat = 'csv' | 'excel' | 'pdf';

export interface PrintColumn {
  key: string;
  header: string;
  /** money = angka rupiah (Excel #,##0.00, PDF format id-ID, rata kanan). */
  type?: 'text' | 'money' | 'number';
  /** Lebar kolom Excel (karakter). */
  width?: number;
}

export type PrintCell = string | number | null | undefined;
export type PrintRow = Record<string, PrintCell>;
export type PrintRowStyle = 'section' | 'total';

export interface PrintReport {
  title: string;
  /** Nama file tanpa ekstensi & tanggal, mis. "Sales-Transactions". */
  fileBase: string;
  companyName?: string;
  subtitle?: string;
  fields?: [string, PrintCell][];
  table: {
    columns: PrintColumn[];
    rows: PrintRow[];
    totals?: PrintRow;
    /** Penanda baris (sejajar index `rows`): section = judul grup, total = subtotal tebal. */
    rowStyles?: (PrintRowStyle | undefined)[];
  };
  summary?: [string, PrintCell, 'money'?][];
  notes?: string;
  orientation?: 'portrait' | 'landscape';
  printedBy?: string;
}

const fmtMoney = (n: number) => n.toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function cellText(v: PrintCell, type?: PrintColumn['type']): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') {
    if (type === 'money') return fmtMoney(v);
    return v.toLocaleString('id-ID');
  }
  return String(v);
}

function fileStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function safeFileBase(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'export';
}

function printedAt(): string {
  return new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── CSV ──────────────────────────────────────────────────────────────

function csvEscape(v: PrintCell): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(r: PrintReport): string {
  const out: PrintCell[][] = [];
  if (r.fields?.length) {
    out.push([r.title]);
    if (r.companyName) out.push(['Company', r.companyName]);
    r.fields.forEach(([k, v]) => out.push([k, v]));
    out.push([]);
  }
  const cols = r.table.columns;
  out.push(cols.map(c => c.header));
  r.table.rows.forEach(row => out.push(cols.map(c => row[c.key])));
  if (r.table.totals) out.push(cols.map(c => r.table.totals![c.key]));
  if (r.summary?.length) {
    out.push([]);
    r.summary.forEach(([k, v]) => out.push([k, v]));
  }
  if (r.notes) {
    out.push([]);
    out.push(['Notes', r.notes]);
  }
  return out.map(line => line.map(csvEscape).join(',')).join('\r\n');
}

// ── Excel ────────────────────────────────────────────────────────────

async function buildExcel(r: PrintReport): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  const cols = r.table.columns;

  ws.columns = cols.map(c => ({ key: c.key, width: c.width ?? (c.type === 'money' ? 18 : 16) }));

  const titleRow = ws.addRow([r.companyName || r.title]);
  titleRow.font = { bold: true, size: 13 };
  if (r.companyName) ws.addRow([r.title]).font = { bold: true, size: 11 };
  if (r.subtitle) ws.addRow([r.subtitle]).font = { color: { argb: 'FF6B7280' } };
  ws.addRow([`Printed: ${printedAt()}${r.printedBy ? ` by ${r.printedBy}` : ''}`]).font = { italic: true, size: 9, color: { argb: 'FF6B7280' } };
  ws.addRow([]);

  if (r.fields?.length) {
    r.fields.forEach(([k, v]) => {
      const row = ws.addRow([k, v ?? '']);
      row.getCell(1).font = { bold: true, color: { argb: 'FF374151' } };
    });
    ws.addRow([]);
  }

  const header = ws.addRow(cols.map(c => c.header));
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    cell.alignment = { vertical: 'middle' };
  });
  const firstDataRow = header.number + 1;

  const addDataRow = (data: PrintRow) => {
    const row = ws.addRow(cols.map(c => {
      const v = data[c.key];
      return v === undefined || v === '' ? null : v;
    }));
    cols.forEach((c, i) => {
      if (c.type === 'money') row.getCell(i + 1).numFmt = '#,##0.00';
      else if (c.type === 'number') row.getCell(i + 1).numFmt = '#,##0.##';
    });
    return row;
  };

  r.table.rows.forEach((data, i) => {
    const row = addDataRow(data);
    const style = r.table.rowStyles?.[i];
    if (style) row.font = { bold: true, color: style === 'section' ? { argb: 'FF6B7280' } : undefined };
    if (style === 'total') row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } }; });
  });
  if (r.table.totals) {
    const t = addDataRow(r.table.totals);
    t.font = { bold: true };
    t.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; });
  }
  if (r.table.rows.length > 0) {
    ws.autoFilter = { from: { row: header.number, column: 1 }, to: { row: firstDataRow + r.table.rows.length - 1, column: cols.length } };
  }
  ws.views = [{ state: 'frozen', ySplit: header.number }];

  if (r.summary?.length) {
    ws.addRow([]);
    r.summary.forEach(([k, v, kind]) => {
      const row = ws.addRow([k, v ?? '']);
      row.getCell(1).font = { bold: true };
      if (kind === 'money') row.getCell(2).numFmt = '#,##0.00';
    });
  }
  if (r.notes) {
    ws.addRow([]);
    const row = ws.addRow(['Notes', r.notes]);
    row.getCell(1).font = { bold: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ── PDF ──────────────────────────────────────────────────────────────

const MARGIN = 12;
const DARK: [number, number, number] = [17, 24, 39];
const GRAY: [number, number, number] = [107, 114, 128];
const BORDER: [number, number, number] = [209, 213, 219];

function buildPdf(r: PrintReport): jsPDF {
  const cols = r.table.columns;
  const orientation = r.orientation ?? (cols.length > 7 ? 'landscape' : 'portrait');
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop
  let y = MARGIN + 4;
  doc.setTextColor(...DARK);
  if (r.companyName) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(r.companyName, MARGIN, y);
    y += 6;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(r.companyName ? 11 : 13);
  doc.text(r.title, MARGIN, y);
  y += 5;
  if (r.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(r.subtitle, MARGIN, y);
    y += 5;
  }
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, y, pageWidth - MARGIN, y);
  y += 4;

  // Field header (detail) -- grid 2 pasang label/nilai per baris
  if (r.fields?.length) {
    const pairs: string[][] = [];
    for (let i = 0; i < r.fields.length; i += 2) {
      const a = r.fields[i];
      const b = r.fields[i + 1];
      pairs.push([a[0], cellText(a[1]), b ? b[0] : '', b ? cellText(b[1]) : '']);
    }
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      theme: 'plain',
      body: pairs,
      styles: { fontSize: 8.5, cellPadding: 1.2, textColor: DARK, overflow: 'linebreak' },
      columnStyles: {
        0: { textColor: GRAY, cellWidth: 32 },
        1: { fontStyle: 'bold' },
        2: { textColor: GRAY, cellWidth: 32 },
        3: { fontStyle: 'bold' },
      },
    });
    // @ts-expect-error lastAutoTable ditambahkan jspdf-autotable ke instance jsPDF
    y = (doc.lastAutoTable?.finalY ?? y) + 5;
  }

  // Tabel utama
  const moneyIdx = cols.map((c, i) => (c.type === 'money' || c.type === 'number' ? i : -1)).filter(i => i >= 0);
  autoTable(doc, {
    startY: y,
    margin: { left: MARGIN, right: MARGIN, bottom: 16 },
    head: [cols.map(c => c.header)],
    body: r.table.rows.map(row => cols.map(c => cellText(row[c.key], c.type))),
    foot: r.table.totals ? [cols.map(c => cellText(r.table.totals![c.key], c.type))] : undefined,
    showFoot: 'lastPage',
    theme: 'grid',
    styles: { fontSize: cols.length > 10 ? 6.5 : 7.5, cellPadding: 1.5, overflow: 'linebreak', textColor: DARK, lineColor: BORDER, lineWidth: 0.15 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
    footStyles: { fillColor: [241, 245, 249], textColor: DARK, fontStyle: 'bold' },
    didParseCell: hook => {
      if (moneyIdx.includes(hook.column.index)) hook.cell.styles.halign = 'right';
      const style = hook.section === 'body' ? r.table.rowStyles?.[hook.row.index] : undefined;
      if (style === 'section') {
        hook.cell.styles.fontStyle = 'bold';
        hook.cell.styles.textColor = GRAY;
        hook.cell.styles.fillColor = [243, 244, 246];
      } else if (style === 'total') {
        hook.cell.styles.fontStyle = 'bold';
        hook.cell.styles.fillColor = [248, 250, 252];
      }
    },
  });
  // @ts-expect-error lastAutoTable ditambahkan jspdf-autotable ke instance jsPDF
  y = (doc.lastAutoTable?.finalY ?? y) + 4;

  // Ringkasan (subtotal / pajak / total) rata kanan di bawah tabel
  if (r.summary?.length) {
    const boxW = 90;
    autoTable(doc, {
      startY: y,
      margin: { left: pageWidth - MARGIN - boxW, right: MARGIN, bottom: 16 },
      theme: 'plain',
      body: r.summary.map(([k, v, kind]) => [k, kind === 'money' && typeof v === 'number' ? 'Rp ' + fmtMoney(v) : cellText(v)]),
      styles: { fontSize: 8.5, cellPadding: 1.2, textColor: DARK },
      columnStyles: { 0: { textColor: GRAY }, 1: { halign: 'right', fontStyle: 'bold' } },
    });
    // @ts-expect-error lastAutoTable ditambahkan jspdf-autotable ke instance jsPDF
    y = (doc.lastAutoTable?.finalY ?? y) + 4;
  }

  if (r.notes) {
    doc.setFontSize(8.5);
    const lines: string[] = doc.splitTextToSize(r.notes, pageWidth - MARGIN * 2);
    if (y + lines.length * 4 + 8 > pageHeight - 16) { doc.addPage(); y = MARGIN + 4; }
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...GRAY);
    doc.text('Notes', MARGIN, y + 2);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...DARK);
    doc.text(lines, MARGIN, y + 7);
  }

  // Footer tiap halaman
  const stamp = printedAt();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.setDrawColor(...BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, pageHeight - 12, pageWidth - MARGIN, pageHeight - 12);
    doc.text(`Printed${r.printedBy ? ` by ${r.printedBy}` : ''} · ${stamp}`, MARGIN, pageHeight - 8);
    doc.text(`Page ${p} of ${total}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  }
  return doc;
}

// ── Entry point ─────────────────────────────────────────────────────

export async function printReport(report: PrintReport, format: PrintFormat): Promise<void> {
  const name = `${safeFileBase(report.fileBase)}-${fileStamp()}`;
  if (format === 'csv') {
    const blob = new Blob(['﻿' + buildCsv(report)], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${name}.csv`);
  } else if (format === 'excel') {
    downloadBlob(await buildExcel(report), `${name}.xlsx`);
  } else {
    buildPdf(report).save(`${name}.pdf`);
  }
}
