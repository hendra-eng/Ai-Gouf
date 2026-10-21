'use client';

// Ekspor tabel generik (PDF lewat jsPDF-autotable, Excel lewat ExcelJS, CSV)
// untuk laporan modul Fixed Assets, Inventory, dan Tax Compliance. Kolom
// didefinisikan sekali (header + nilai + format), dipakai ketiga format.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';

export type ExportFormat = 'pdf' | 'xlsx' | 'csv';

export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** money = angka rupiah 2 desimal, number = angka biasa, text = apa adanya. */
  type?: 'money' | 'number' | 'text';
  width?: number;
}

export interface ExportSpec<T> {
  title: string;
  subtitle?: string;
  clientName: string;
  meta?: [string, string][];
  columns: ExportColumn<T>[];
  rows: T[];
  /** Baris total opsional (nilai per header kolom). */
  totals?: Record<string, string | number | null>;
  fileName: string;
  orientation?: 'portrait' | 'landscape';
}

const HIJAU: [number, number, number] = [15, 125, 78];
const TINTA: [number, number, number] = [30, 41, 59];
const ABU: [number, number, number] = [100, 116, 139];
const GARIS: [number, number, number] = [226, 232, 240];
const angka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const fmtRp = (n: number) => `${n < 0 ? '-' : ''}${angka.format(Math.abs(n))}`;

function teks<T>(c: ExportColumn<T>, v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return '';
  if ((c.type === 'money' || c.type === 'number') && typeof v === 'number') return c.type === 'money' ? fmtRp(v) : angka.format(v);
  return String(v);
}

function stempel() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function buildTablePdf<T>(s: ExportSpec<T>): jsPDF {
  const doc = new jsPDF({ orientation: s.orientation ?? (s.columns.length > 7 ? 'landscape' : 'portrait'), unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 12;
  doc.setFillColor(...HIJAU);
  doc.roundedRect(M, 10, 9, 9, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...TINTA);
  doc.text('zafeb', M + 12, 14.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...ABU);
  doc.text('Accounting', M + 12, 18.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...TINTA);
  doc.text(s.clientName || '', W - M, 14.5, { align: 'right' });
  doc.setDrawColor(...HIJAU);
  doc.setLineWidth(0.5);
  doc.line(M, 22, W - M, 22);
  doc.setFontSize(15);
  doc.text(s.title, M, 31);
  let y = 31;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...ABU);
  if (s.subtitle) {
    y += 5.5;
    doc.text(s.subtitle, M, y);
  }
  for (const [k, v] of s.meta ?? []) {
    y += 4.5;
    doc.text(`${k}: ${v}`, M, y);
  }
  const body = s.rows.map(r => s.columns.map(c => teks(c, c.value(r))));
  const foot = s.totals ? [s.columns.map(c => {
    const v = s.totals![c.header];
    return v === undefined ? '' : teks(c, v);
  })] : undefined;
  autoTable(doc, {
    startY: y + 5,
    head: [s.columns.map(c => c.header)],
    body,
    foot,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 1.6, textColor: TINTA, lineColor: GARIS, lineWidth: 0.15 },
    headStyles: { fillColor: [236, 253, 245], textColor: TINTA, fontStyle: 'bold' },
    footStyles: { fillColor: [248, 250, 252], textColor: TINTA, fontStyle: 'bold' },
    columnStyles: Object.fromEntries(s.columns.map((c, i) => [i, { halign: c.type === 'money' || c.type === 'number' ? 'right' : 'left' }])),
    margin: { left: M, right: M, bottom: 14 },
  });
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(7);
    doc.setTextColor(...ABU);
    doc.text(`Generated ${stempel()} · zafeb`, M, H - 7);
    doc.text(`Page ${i} of ${n}`, W - M, H - 7, { align: 'right' });
  }
  return doc;
}

export async function buildTableXlsx<T>(s: ExportSpec<T>): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(s.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || 'Report');
  const n = s.columns.length;
  const judul = ws.addRow([s.title]);
  judul.font = { bold: true, size: 14, color: { argb: 'FF0F7D4E' } };
  ws.mergeCells(1, 1, 1, Math.max(n, 1));
  ws.addRow([s.clientName]).font = { bold: true };
  if (s.subtitle) ws.addRow([s.subtitle]).font = { color: { argb: 'FF64748B' } };
  for (const [k, v] of s.meta ?? []) ws.addRow([`${k}: ${v}`]).font = { color: { argb: 'FF64748B' } };
  ws.addRow([]);
  const head = ws.addRow(s.columns.map(c => c.header));
  head.eachCell(c => {
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF0F7D4E' } } };
  });
  for (const r of s.rows) ws.addRow(s.columns.map(c => c.value(r) ?? null));
  if (s.totals) ws.addRow(s.columns.map(c => s.totals![c.header] ?? null)).font = { bold: true };
  s.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = '#,##0.00;[Red]-#,##0.00';
    if (c.type === 'number') col.numFmt = '#,##0.##';
    const isi = [c.header, ...s.rows.slice(0, 200).map(r => teks(c, c.value(r)))];
    col.width = c.width ?? Math.min(48, Math.max(10, ...isi.map(x => x.length + 2)));
  });
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildTableCsv<T>(s: ExportSpec<T>): Blob {
  const sel = (v: unknown) => {
    const t = String(v ?? '');
    return /[",\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const baris = [s.columns.map(c => c.header), ...s.rows.map(r => s.columns.map(c => c.value(r) ?? ''))];
  if (s.totals) baris.push(s.columns.map(c => s.totals![c.header] ?? ''));
  return new Blob(['﻿' + baris.map(r => r.map(sel).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' });
}

/** Unduh tabel dalam format yang dipilih. */
export async function downloadTable<T>(format: ExportFormat, s: ExportSpec<T>): Promise<void> {
  if (format === 'pdf') {
    buildTablePdf(s).save(`${s.fileName}.pdf`);
  } else if (format === 'xlsx') {
    downloadBlob(await buildTableXlsx(s), `${s.fileName}.xlsx`);
  } else {
    downloadBlob(buildTableCsv(s), `${s.fileName}.csv`);
  }
}
