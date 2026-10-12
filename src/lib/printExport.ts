import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { loadLogo } from '@/lib/imageUtils';

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
/**
 * section = judul grup, total = subtotal tebal. Khusus template 'statement':
 * group = judul besar (ASSETS / REVENUE), item = baris tanpa indent,
 * highlight = laba antara (GROSS PROFIT), grand = total utama (latar gelap),
 * spacer = jarak antar blok.
 */
export type PrintRowStyle = 'section' | 'total' | 'group' | 'item' | 'highlight' | 'grand' | 'spacer';

/** Kop laporan: logo + nama klien (kiri), nama + alamat/kontak (kanan). */
export interface PrintLetterhead {
  name: string;
  logo?: string | null;
  lines?: string[];
}

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
  /** 'statement' = format laporan keuangan resmi (kop logo, judul besar, baris teal). */
  template?: 'statement';
  letterhead?: PrintLetterhead;
  /** Info kecil di kanan judul (Report Date / Currency / Period). */
  meta?: [string, string][];
  /** Template statement: awalan angka, mis. "Rp ". Negatif selalu dalam kurung. */
  moneyPrefix?: string;
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

// ── Template "statement" (Balance Sheet / Profit & Loss) ─────────────
// Mengikuti dataset/picture/Template UI/{Balance sheet,Profit loss}/*print.jpeg:
// kop logo + alamat, judul besar, header & subtotal teal muda, total utama
// teal gelap, angka 1,250,000,000 dengan negatif dalam kurung.

type RGB = [number, number, number];
const T_DARK: RGB = [11, 94, 92];      // #0B5E5C -- grand total, judul grup
const T_INK: RGB = [15, 42, 42];       // judul & teks tebal
const T_TEXT: RGB = [55, 65, 81];      // baris rincian
const T_MUTED: RGB = [107, 114, 128];
const T_TINT: RGB = [230, 245, 242];   // header, seksi, subtotal
const T_TINT_2: RGB = [215, 239, 234]; // highlight (GROSS PROFIT dst.)
const T_RULE: RGB = [229, 231, 235];
const argb = (c: RGB) => 'FF' + c.map(x => x.toString(16).padStart(2, '0')).join('').toUpperCase();

function fmtStatement(v: PrintCell, prefix = ''): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v !== 'number') return String(v);
  if (Math.abs(v) < 0.005) return '-';
  const s = prefix + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return v < 0 ? `(${s})` : s;
}

function longStamp(): string {
  const d = new Date();
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
}

/** Kolom angka tunggal ditulis "Amount (IDR)" seperti template. */
const statementHeader = (cols: PrintColumn[]) => cols.map((c, i) => (i > 0 && c.type === 'money' && cols.length === 2 ? 'Amount (IDR)' : c.header));

async function buildStatementPdf(r: PrintReport): Promise<jsPDF> {
  const cols = r.table.columns;
  const nMoney = cols.filter(c => c.type === 'money').length;
  const orientation = r.orientation ?? (nMoney > 4 ? 'landscape' : 'portrait');
  const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14;
  const lh = r.letterhead ?? { name: r.companyName || '' };

  // Kop kiri: logo + nama perusahaan
  const LOGO_H = 16, LOGO_W = 30;
  let x = M;
  const logo = lh.logo ? await loadLogo(lh.logo) : null;
  if (logo) {
    const k = Math.min(LOGO_W / logo.width, LOGO_H / logo.height);
    doc.addImage(logo.dataUrl, 'PNG', M, 12 + (LOGO_H - logo.height * k) / 2, logo.width * k, logo.height * k);
    x = M + logo.width * k + 4;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...T_DARK);
  const nameLines = (doc.splitTextToSize(lh.name, W / 2 - x) as string[]).slice(0, 2);
  doc.text(nameLines, x, 12 + LOGO_H / 2 + 2 - (nameLines.length - 1) * 3);

  // Kop kanan: nama + alamat / kontak
  let ry = 14;
  doc.setFontSize(8.5);
  doc.setTextColor(...T_INK);
  doc.text(lh.name, W - M, ry, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...T_MUTED);
  (lh.lines ?? []).forEach(line => {
    (doc.splitTextToSize(line, 75) as string[]).forEach(l => { ry += 3.8; doc.text(l, W - M, ry, { align: 'right' }); });
  });

  // Garis kop, judul + subjudul (+ meta di kanan)
  let y = Math.max(12 + LOGO_H, ry) + 4;
  doc.setDrawColor(...T_RULE);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 10;
  const meta = r.meta ?? [];
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...T_INK);
  const titleLines = doc.splitTextToSize(r.title, meta.length ? W - M * 2 - 80 : W - M * 2) as string[];
  doc.text(titleLines, M, y);
  let ty = y + (titleLines.length - 1) * 7.5;
  if (r.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(...T_MUTED);
    ty += 7;
    doc.text(r.subtitle, M, ty);
  }
  if (meta.length) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...T_MUTED);
    const mx = W - M - 74;
    meta.forEach(([k, v], i) => {
      const my = y - 5 + i * 4.6;
      doc.text(k, mx, my);
      doc.text(`:  ${v}`, mx + 20, my);
    });
  }
  y = Math.max(ty, y - 5 + meta.length * 4.6) + 4;
  doc.setDrawColor(...T_DARK);
  doc.setLineWidth(0.35);
  doc.line(M, y, W - M, y);
  y += 4;

  // Tabel
  const styles = r.table.rowStyles ?? [];
  const fontSize = cols.length > 8 ? 7 : cols.length > 5 ? 8 : 8.5;
  const pad = (top: number, left = 3) => ({ top, bottom: top, left, right: 3 });
  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M, top: 16, bottom: 17 },
    head: [statementHeader(cols)],
    body: r.table.rows.map(row => cols.map(c => (c.type === 'money' ? fmtStatement(row[c.key], r.moneyPrefix) : cellText(row[c.key], c.type)))),
    theme: 'plain',
    styles: { fontSize, cellPadding: pad(1), textColor: T_TEXT, overflow: 'linebreak', valign: 'middle' },
    headStyles: { fillColor: T_TINT, textColor: T_DARK, fontStyle: 'bold', fontSize: fontSize + 1, cellPadding: pad(2.2) },
    columnStyles: { 0: { cellWidth: cols.length > 3 ? 70 : 'auto' } },
    didParseCell: hook => {
      if (cols[hook.column.index]?.type === 'money') hook.cell.styles.halign = 'right';
      if (hook.section !== 'body') return;
      const st = styles[hook.row.index];
      const s = hook.cell.styles;
      if (st === 'spacer') {
        s.fontSize = 1; s.minCellHeight = 1.6; s.cellPadding = 0;
      } else if (st === 'group') {
        s.fontStyle = 'bold'; s.textColor = T_DARK; s.fontSize = fontSize + 1.5; s.cellPadding = { top: 1.8, bottom: 1, left: 3, right: 3 };
      } else if (st === 'section') {
        s.fontStyle = 'bold'; s.textColor = T_DARK; s.fillColor = T_TINT;
      } else if (st === 'total') {
        s.fontStyle = 'bold'; s.textColor = T_INK; s.fillColor = T_TINT; s.cellPadding = pad(1.4);
      } else if (st === 'highlight') {
        s.fontStyle = 'bold'; s.textColor = T_INK; s.fillColor = T_TINT_2; s.fontSize = fontSize + 1.5; s.cellPadding = pad(1.9);
      } else if (st === 'grand') {
        s.fontStyle = 'bold'; s.textColor = 255; s.fillColor = T_DARK; s.fontSize = fontSize + 1.5; s.cellPadding = pad(2.1);
      } else if (st === 'item') {
        s.textColor = T_INK; s.fontSize = fontSize + 0.5;
      } else if (hook.column.index === 0) {
        s.cellPadding = pad(1, 7);
      }
    },
    didDrawCell: hook => {
      // Garis tipis di bawah baris rincian (seperti template).
      if (hook.section !== 'body' || styles[hook.row.index]) return;
      const c = hook.cell;
      doc.setDrawColor(...T_RULE);
      doc.setLineWidth(0.15);
      doc.line(c.x, c.y + c.height, c.x + c.width, c.y + c.height);
    },
  });

  // Footer tiap halaman
  const stamp = longStamp();
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.setDrawColor(...T_RULE);
    doc.setLineWidth(0.3);
    doc.line(M - 2, H - 15, W - M + 2, H - 15);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(...T_MUTED);
    doc.text('Generated by Gouf Accounting System', M, H - 10.5);
    doc.setFont('helvetica', 'normal');
    doc.text(`${stamp}${r.printedBy ? ` · ${r.printedBy}` : ''}`, M, H - 6.5);
    doc.setFont('helvetica', 'bold');
    doc.text(`Page ${p} of ${total}`, W - M, H - 9, { align: 'right' });
  }
  return doc;
}

async function buildStatementExcel(r: PrintReport): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '), { views: [{ showGridLines: false }] });
  const cols = r.table.columns;
  const last = cols.length;
  ws.columns = cols.map((c, i) => ({ key: c.key, width: i === 0 ? Math.max(c.width ?? 48, 48) : Math.max(c.width ?? 18, 20) }));
  const lh = r.letterhead ?? { name: r.companyName || '' };
  const numFmt = r.moneyPrefix ? `"${r.moneyPrefix}"#,##0;("${r.moneyPrefix}"#,##0);"-"` : '#,##0;(#,##0);"-"';
  const fill = (c: RGB): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: argb(c) } });

  // Kop: logo + nama (kiri), nama + alamat (kanan, kolom terakhir)
  const right = [lh.name, ...(lh.lines ?? [])];
  for (let i = 0; i < Math.max(3, right.length); i++) ws.addRow([]);
  const logo = lh.logo ? await loadLogo(lh.logo) : null;
  if (logo) {
    const k = Math.min(110 / logo.width, 54 / logo.height);
    const id = wb.addImage({ base64: logo.dataUrl, extension: 'png' });
    ws.addImage(id, { tl: { col: 0.05, row: 0.15 }, ext: { width: logo.width * k, height: logo.height * k } });
  }
  const nameCell = ws.getCell(2, 1);
  nameCell.value = lh.name;
  nameCell.font = { bold: true, size: 15, color: { argb: argb(T_DARK) } };
  if (logo) nameCell.alignment = { indent: 12 };
  if (last > 1) right.forEach((t, i) => {
    const c = ws.getCell(i + 1, last);
    c.value = t;
    c.alignment = { horizontal: 'right' };
    c.font = i === 0 ? { bold: true, size: 9, color: { argb: argb(T_INK) } } : { size: 8.5, color: { argb: argb(T_MUTED) } };
  });
  ws.addRow([]);

  const title = ws.addRow([r.title]);
  title.font = { bold: true, size: 18, color: { argb: argb(T_INK) } };
  title.height = 26;
  if (r.subtitle) ws.addRow([r.subtitle]).font = { size: 12, color: { argb: argb(T_MUTED) } };
  (r.meta ?? []).forEach(([k, v]) => { ws.addRow([`${k}: ${v}`]).font = { size: 9, color: { argb: argb(T_MUTED) } }; });
  ws.addRow([]);

  const header = ws.addRow(statementHeader(cols));
  header.height = 22;
  header.eachCell((cell, i) => {
    cell.font = { bold: true, color: { argb: argb(T_DARK) } };
    cell.fill = fill(T_TINT);
    cell.alignment = { vertical: 'middle', horizontal: cols[i - 1].type === 'money' ? 'right' : 'left' };
  });

  const styles = r.table.rowStyles ?? [];
  r.table.rows.forEach((data, ri) => {
    const st = styles[ri];
    if (st === 'spacer') { ws.addRow([]).height = 6; return; }
    const row = ws.addRow(cols.map(c => { const v = data[c.key]; return v === undefined || v === '' ? null : v; }));
    for (let i = 1; i <= last; i++) {
      const cell = row.getCell(i);
      const money = cols[i - 1].type === 'money';
      if (money) cell.numFmt = numFmt;
      const font: Partial<ExcelJS.Font> = { size: 10, color: { argb: argb(T_TEXT) } };
      if (st === 'group') Object.assign(font, { bold: true, size: 11, color: { argb: argb(T_DARK) } });
      else if (st === 'section') { Object.assign(font, { bold: true, color: { argb: argb(T_DARK) } }); cell.fill = fill(T_TINT); }
      else if (st === 'total') { Object.assign(font, { bold: true, color: { argb: argb(T_INK) } }); cell.fill = fill(T_TINT); }
      else if (st === 'highlight') { Object.assign(font, { bold: true, size: 11, color: { argb: argb(T_INK) } }); cell.fill = fill(T_TINT_2); }
      else if (st === 'grand') { Object.assign(font, { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }); cell.fill = fill(T_DARK); }
      else if (st === 'item') font.color = { argb: argb(T_INK) };
      else cell.border = { bottom: { style: 'thin', color: { argb: argb(T_RULE) } } };
      cell.font = font;
      cell.alignment = { vertical: 'middle', horizontal: money ? 'right' : 'left', indent: !st && i === 1 ? 2 : 0 };
    }
    if (st === 'grand' || st === 'highlight' || st === 'total') row.height = 19;
  });
  ws.views = [{ state: 'frozen', ySplit: header.number, showGridLines: false }];

  ws.addRow([]);
  ws.addRow([`Generated by Gouf Accounting System · ${longStamp()}${r.printedBy ? ` · ${r.printedBy}` : ''}`]).font = { italic: true, size: 8.5, color: { argb: argb(T_MUTED) } };

  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ── Entry point ─────────────────────────────────────────────────────

export async function printReport(report: PrintReport, format: PrintFormat): Promise<void> {
  const name = `${safeFileBase(report.fileBase)}-${fileStamp()}`;
  if (format === 'csv') {
    const blob = new Blob(['﻿' + buildCsv(report)], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, `${name}.csv`);
  } else if (format === 'excel') {
    downloadBlob(await (report.template === 'statement' ? buildStatementExcel(report) : buildExcel(report)), `${name}.xlsx`);
  } else {
    (report.template === 'statement' ? await buildStatementPdf(report) : buildPdf(report)).save(`${name}.pdf`);
  }
}
