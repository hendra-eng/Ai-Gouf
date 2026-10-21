// Kolom laporan Inventory + dua layout PDF khusus dari template
// (Template UI/Inventory/7.jpeg = ringkasan per kategori dengan donut,
// 8.jpeg = laporan detail persediaan). Laporan lain memakai tableExport.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtDate, fmtDateLong } from '@/lib/receivablesPayablesStore';
import { INV_REPORTS, MOVEMENT_LABEL, REASON_LABEL, STOCK_STATUS_LABEL, type AdjustmentReason, type InvReport, type MovementType, type StockStatus } from '@/lib/inventoryStore';
import type { ExportColumn, ExportSpec } from '@/lib/tableExport';

type Row = Record<string, unknown>;
const s = (k: string) => (r: Row) => (r[k] as string | null) ?? null;
const n = (k: string) => (r: Row) => (r[k] as number | null) ?? null;
const jumlah = (rows: Row[], k: string) => rows.reduce((t, r) => t + ((r[k] as number) || 0), 0);

export interface BuiltInvReport { columns: ExportColumn<Row>[]; totals?: Record<string, string | number | null>; orientation: 'portrait' | 'landscape' }

export function invColumns(d: InvReport): BuiltInvReport {
  const rows = d.rows;
  switch (d.report_type) {
    case 'stock_summary':
      return { orientation: 'landscape', columns: [
        { header: 'Item Code', value: s('item_code') }, { header: 'Item Name', value: s('item_name') }, { header: 'Category', value: s('category') },
        { header: 'Unit', value: s('unit') }, { header: 'Opening Qty', value: n('opening_qty'), type: 'number' }, { header: 'In', value: n('qty_in'), type: 'number' },
        { header: 'Out', value: n('qty_out'), type: 'number' }, { header: 'Closing Qty', value: n('closing_qty'), type: 'number' },
        { header: 'Avg. Cost (Rp)', value: n('avg_cost'), type: 'money' }, { header: 'Closing Value (Rp)', value: n('closing_value'), type: 'money' },
      ], totals: { 'Item Code': 'Total', 'Closing Value (Rp)': jumlah(rows, 'closing_value') } };
    case 'stock_card':
      return { orientation: 'landscape', columns: [
        { header: 'Date', value: r => (r.date ? fmtDate(r.date as string) : '') }, { header: 'Reference', value: s('reference_no') },
        { header: 'Type', value: r => (r.type === 'opening_balance' ? 'Opening balance' : String(r.type ?? '')) }, { header: 'Warehouse', value: s('warehouse') },
        { header: 'In', value: n('qty_in'), type: 'number' }, { header: 'Out', value: n('qty_out'), type: 'number' }, { header: 'Unit Cost', value: n('unit_cost'), type: 'money' },
        { header: 'Value In', value: n('value_in'), type: 'money' }, { header: 'Value Out', value: n('value_out'), type: 'money' },
        { header: 'Balance Qty', value: n('balance_qty'), type: 'number' }, { header: 'Balance Value', value: n('balance_value'), type: 'money' },
      ] };
    case 'stock_aging':
      return { orientation: 'landscape', columns: [
        { header: 'Item Code', value: s('item_code') }, { header: 'Item Name', value: s('item_name') }, { header: 'Category', value: s('category') },
        { header: 'Qty On Hand', value: n('qty'), type: 'number' }, { header: '0-30 Days', value: n('d0_30'), type: 'number' }, { header: '31-60 Days', value: n('d31_60'), type: 'number' },
        { header: '61-90 Days', value: n('d61_90'), type: 'number' }, { header: '91-180 Days', value: n('d91_180'), type: 'number' }, { header: '>180 Days', value: n('d180_plus'), type: 'number' },
        { header: 'Value (Rp)', value: n('value'), type: 'money' }, { header: 'Value >90 Days', value: n('value_over_90'), type: 'money' },
      ], totals: { 'Item Code': 'Total', 'Value (Rp)': jumlah(rows, 'value'), 'Value >90 Days': jumlah(rows, 'value_over_90') } };
    case 'valuation':
      return { orientation: 'portrait', columns: [
        { header: 'Item Code', value: s('item_code') }, { header: 'Item Name', value: s('item_name') }, { header: 'Category', value: s('category') },
        { header: 'Warehouse', value: s('warehouse') }, { header: 'Unit', value: s('unit') }, { header: 'Qty', value: n('qty'), type: 'number' },
        { header: 'Avg. Cost (Rp)', value: n('avg_cost'), type: 'money' }, { header: 'Inventory Value (Rp)', value: n('value'), type: 'money' },
      ], totals: { 'Item Code': 'TOTAL', Qty: jumlah(rows, 'qty'), 'Inventory Value (Rp)': jumlah(rows, 'value') } };
    case 'category_summary':
      return { orientation: 'portrait', columns: [
        { header: 'Category', value: s('category') }, { header: 'Items', value: n('item_count'), type: 'number' }, { header: 'Qty on Hand', value: n('qty'), type: 'number' },
        { header: 'Inventory Value (Rp)', value: n('value'), type: 'money' }, { header: '% of Total', value: r => `${(r.pct as number).toFixed(2)}%` },
      ], totals: { Category: 'Total', Items: jumlah(rows, 'item_count'), 'Qty on Hand': jumlah(rows, 'qty'), 'Inventory Value (Rp)': jumlah(rows, 'value'), '% of Total': '100.00%' } };
    case 'movement':
      return { orientation: 'landscape', columns: [
        { header: 'Date', value: r => fmtDate(r.date as string) }, { header: 'Reference', value: s('reference_no') }, { header: 'Item Code', value: s('item_code') },
        { header: 'Item Name', value: s('item_name') }, { header: 'Type', value: r => MOVEMENT_LABEL[r.type as MovementType] + (r.is_reversal ? ' (void)' : '') },
        { header: 'In', value: r => (r.qty_in as number) || null, type: 'number' }, { header: 'Out', value: r => (r.qty_out as number) || null, type: 'number' },
        { header: 'Balance', value: n('balance'), type: 'number' }, { header: 'Unit Cost', value: n('unit_cost'), type: 'money' },
        { header: 'Location', value: s('warehouse') }, { header: 'Source', value: s('source') },
      ] };
    case 'adjustment':
      return { orientation: 'landscape', columns: [
        { header: 'Date', value: r => fmtDate(r.date as string) }, { header: 'Reference', value: s('doc_no') }, { header: 'Item Code', value: s('item_code') },
        { header: 'Item Name', value: s('item_name') }, { header: 'Qty', value: n('quantity'), type: 'number' }, { header: 'Unit Cost', value: n('unit_cost'), type: 'money' },
        { header: 'Value (Rp)', value: n('amount'), type: 'money' }, { header: 'Reason', value: r => (r.reason ? REASON_LABEL[r.reason as AdjustmentReason] : '') },
        { header: 'Location', value: s('from_warehouse') }, { header: 'Status', value: s('status') }, { header: 'Created By', value: s('created_by') },
      ], totals: { Date: 'Total', 'Value (Rp)': jumlah(rows, 'amount') } };
    case 'transfer':
      return { orientation: 'landscape', columns: [
        { header: 'Date', value: r => fmtDate(r.date as string) }, { header: 'Reference', value: s('doc_no') }, { header: 'Item Code', value: s('item_code') },
        { header: 'Item Name', value: s('item_name') }, { header: 'Qty', value: n('quantity'), type: 'number' }, { header: 'Value (Rp)', value: n('amount'), type: 'money' },
        { header: 'From', value: s('from_warehouse') }, { header: 'To', value: s('to_warehouse') }, { header: 'Status', value: s('status') }, { header: 'Created By', value: s('created_by') },
      ] };
    case 'low_stock':
      return { orientation: 'portrait', columns: [
        { header: 'Item Code', value: s('item_code') }, { header: 'Item Name', value: s('item_name') }, { header: 'Category', value: s('category') },
        { header: 'Unit', value: s('unit') }, { header: 'On Hand', value: n('qty'), type: 'number' }, { header: 'Minimum', value: n('min_stock'), type: 'number' },
        { header: 'Suggested Order', value: n('suggested_order'), type: 'number' }, { header: 'Status', value: r => STOCK_STATUS_LABEL[r.status as StockStatus] },
      ] };
  }
}

export function invSpec(d: InvReport, b: BuiltInvReport, filters: string): ExportSpec<Row> {
  const meta = INV_REPORTS.find(r => r.type === d.report_type)!;
  const titik = ['valuation', 'category_summary', 'stock_aging', 'low_stock'].includes(d.report_type);
  return {
    title: d.report_type === 'stock_card' && d.item ? `Stock Card — ${d.item.code} ${d.item.name}` : meta.label, clientName: d.client_name,
    subtitle: titik ? `Per ${fmtDateLong(d.period.to)}` : `Period ${fmtDate(d.period.from)} – ${fmtDate(d.period.to)}`,
    meta: [['Currency', 'IDR'], ...(filters ? [['Filters', filters] as [string, string]] : [])], columns: b.columns, rows: d.rows, totals: b.totals,
    fileName: `${meta.label.replace(/[^A-Za-z0-9]+/g, '-')}-${d.period.to}`, orientation: b.orientation,
  };
}

// ============================================================
// PDF KHUSUS
// ============================================================

const HIJAU: [number, number, number] = [15, 125, 78];
const TINTA: [number, number, number] = [15, 23, 42];
const ABU: [number, number, number] = [100, 116, 139];
const GARIS: [number, number, number] = [226, 232, 240];
const TINT: [number, number, number] = [236, 253, 245];
const PIE = ['#0B5E5C', '#2F9E6B', '#A7E3C4', '#CBEFD9', '#B7D3EE', '#DCEBFA', '#94A3B8', '#CBD5E1'];
const angka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const rp = (v: number) => angka.format(v);

function kop(doc: jsPDF, judul: string, klien: string, per: string, tagline: string): number {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...HIJAU);
  doc.roundedRect(14, 12, 13, 13, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Z', 20.5, 21, { align: 'center' });
  doc.setTextColor(...TINTA);
  doc.setFontSize(16);
  doc.text('zafeb', 30, 20.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...ABU);
  doc.text(tagline, W - 14, 16, { align: 'right' });
  doc.setDrawColor(...HIJAU);
  doc.setLineWidth(0.8);
  doc.line(W - 34, 21, W - 14, 21);
  doc.setLineWidth(0.4);
  doc.line(14, 29, W - 14, 29);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...TINTA);
  doc.text(judul, 14, 42);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(71, 85, 105);
  const baris = [klien, `Period: ${per}`, 'Currency: IDR', `Printed on: ${fmtDateLong(new Date().toISOString().slice(0, 10))}`];
  baris.forEach((t, i) => doc.text(t, 14, 50 + i * 5.5));
  return 50 + baris.length * 5.5 + 4;
}

function kaki(doc: jsPDF) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    doc.setPage(i);
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...HIJAU);
    doc.setLineWidth(0.3);
    doc.line(14, H - 14, W - 14, H - 14);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...ABU);
    doc.text('Generated by zafeb', 14, H - 9);
    doc.text(String(i), W - 14, H - 9, { align: 'right' });
  }
}

/** Donut digambar di canvas lalu disisipkan sebagai gambar. */
function donutPng(nilai: number[], warna: string[], teksTengah: string[]): string {
  const c = document.createElement('canvas');
  const S = 600;
  c.width = S;
  c.height = S;
  const g = c.getContext('2d')!;
  const total = nilai.reduce((a, b) => a + b, 0) || 1;
  let sudut = -Math.PI / 2;
  nilai.forEach((v, i) => {
    const akhir = sudut + (v / total) * Math.PI * 2;
    g.beginPath();
    g.moveTo(S / 2, S / 2);
    g.arc(S / 2, S / 2, S / 2 - 4, sudut, akhir);
    g.closePath();
    g.fillStyle = warna[i % warna.length];
    g.fill();
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.stroke();
    const tengah = (sudut + akhir) / 2;
    const pct = (v / total) * 100;
    if (pct >= 3) {
      g.fillStyle = i < 2 ? '#ffffff' : '#0F172A';
      g.font = '600 26px Helvetica, Arial';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(`${pct.toFixed(2).replace('.', ',')}%`, S / 2 + Math.cos(tengah) * S * 0.37, S / 2 + Math.sin(tengah) * S * 0.37);
    }
    sudut = akhir;
  });
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.27, 0, Math.PI * 2);
  g.fillStyle = '#ffffff';
  g.fill();
  g.fillStyle = '#0F172A';
  g.textAlign = 'center';
  g.font = '700 30px Helvetica, Arial';
  g.fillText(teksTengah[0], S / 2, S / 2 - 14);
  g.font = '400 22px Helvetica, Arial';
  g.fillStyle = '#475569';
  teksTengah.slice(1).forEach((t, i) => g.fillText(t, S / 2, S / 2 + 16 + i * 26));
  return c.toDataURL('image/png');
}

export function buildCategorySummaryPdf(d: InvReport): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = kop(doc, 'Inventory Summary by Category', d.client_name, fmtDateLong(d.period.to), 'Simpler accounting for better business');
  const ring = d.summary ?? { total_value: 0, total_sku: 0, categories: 0, warehouses: 0 };
  const kartu: [string, string, [number, number, number]][] = [
    ['Total Inventory Value', `Rp ${rp(ring.total_value)}`, TINT], ['Total SKU', String(ring.total_sku), [239, 246, 255]],
    ['Total Categories', String(ring.categories), TINT], ['Active Warehouses', String(ring.warehouses), TINT],
  ];
  const lebar = [(W - 28 - 9) * 0.34, (W - 28 - 9) * 0.2, (W - 28 - 9) * 0.22, (W - 28 - 9) * 0.24];
  let x = 14;
  kartu.forEach(([l, v, bg], i) => {
    doc.setFillColor(...bg);
    doc.roundedRect(x, y, lebar[i], 20, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...ABU);
    doc.text(l, x + 4, y + 7);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(i === 0 ? 11.5 : 13);
    doc.setTextColor(...TINTA);
    doc.text(v, x + 4, y + 15);
    x += lebar[i] + 3;
  });
  y += 30;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('Inventory Breakdown by Category', 14, y);
  const rows = d.rows;
  autoTable(doc, {
    startY: y + 4,
    head: [['Category', 'Items', 'Qty on Hand', 'Inventory Value (Rp)', '% of Total']],
    body: rows.map(r => [String(r.category), angka.format(r.item_count as number), angka.format(r.qty as number), rp(r.value as number), `${(r.pct as number).toFixed(2).replace('.', ',')}%`]),
    foot: [['Total', angka.format(jumlah(rows, 'item_count')), angka.format(jumlah(rows, 'qty')), rp(jumlah(rows, 'value')), '100,00%']],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: TINTA, lineColor: GARIS, lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: [232, 245, 238], fontStyle: 'bold' },
    footStyles: { fillColor: [232, 245, 238], fontStyle: 'bold' },
    columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' } },
    margin: { left: 14, right: 14 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;
  if (y > 200) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.text('Inventory Value Composition by Category', 14, y);
  const img = donutPng(rows.map(r => r.value as number), PIE, [`Rp ${rp(ring.total_value)}`, 'Total Inventory', 'Value']);
  doc.addImage(img, 'PNG', 14, y + 5, 72, 72);
  autoTable(doc, {
    startY: y + 8,
    head: [['', 'Category', 'Value (Rp)', '% of Total']],
    body: rows.map(r => ['', String(r.category), rp(r.value as number), `${(r.pct as number).toFixed(2).replace('.', ',')}%`]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9, cellPadding: 2.4, textColor: TINTA, lineColor: GARIS, lineWidth: { bottom: 0.2 } },
    headStyles: { fontStyle: 'bold' },
    columnStyles: { 0: { cellWidth: 7 }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    margin: { left: 94, right: 14 },
    didDrawCell: h => {
      if (h.section === 'body' && h.column.index === 0) {
        const warna = PIE[h.row.index % PIE.length];
        doc.setFillColor(parseInt(warna.slice(1, 3), 16), parseInt(warna.slice(3, 5), 16), parseInt(warna.slice(5, 7), 16));
        doc.circle(h.cell.x + 3.2, h.cell.y + h.cell.height / 2, 1.9, 'F');
      }
    },
  });
  kaki(doc);
  return doc;
}

export function buildValuationPdf(d: InvReport, filters: { warehouse: string; category: string }): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  let y = kop(doc, 'Inventory Detail Report', d.client_name, fmtDateLong(d.period.to), 'Cloud accounting for your business');
  doc.setFillColor(...TINT);
  doc.roundedRect(14, y, W - 28, 10, 2, 2, 'F');
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  const potong = [['Warehouse', filters.warehouse], ['Category', filters.category], ['Status', 'Active']];
  let x = 18;
  potong.forEach(([k, v], i) => {
    doc.setFont('helvetica', 'bold');
    doc.text(`${k}:`, x, y + 6.5);
    doc.setFont('helvetica', 'normal');
    doc.text(v, x + doc.getTextWidth(`${k}: `), y + 6.5);
    x += doc.getTextWidth(`${k}: ${v}`) + 8;
    if (i < potong.length - 1) { doc.setTextColor(...ABU); doc.text('|', x - 5, y + 6.5); doc.setTextColor(...TINTA); }
  });
  y += 16;
  autoTable(doc, {
    startY: y,
    head: [['Item Code', 'Item Name', 'Category', 'Warehouse', 'Unit', 'Qty', 'Avg. Cost (Rp)', 'Inventory Value (Rp)']],
    body: d.rows.map(r => [String(r.item_code), String(r.item_name), String(r.category), String(r.warehouse), String(r.unit),
      angka.format(r.qty as number), rp(r.avg_cost as number), rp(r.value as number)]),
    foot: [[{ content: 'TOTAL', colSpan: 5 }, angka.format(jumlah(d.rows, 'qty')), '', rp(jumlah(d.rows, 'value'))]],
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2.4, textColor: TINTA, lineColor: GARIS, lineWidth: 0.2 },
    headStyles: { fillColor: [232, 245, 238], fontStyle: 'bold' },
    footStyles: { fillColor: [232, 245, 238], fontStyle: 'bold', fontSize: 10 },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' } },
    margin: { left: 14, right: 14, bottom: 20 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  if (y > 255) { doc.addPage(); y = 20; }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...HIJAU);
  doc.text('Notes:', 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  ['Inventory value is calculated using the moving average cost.', 'Only active items are included in this report.',
    `Quantity shows the closing balance as of ${fmtDateLong(d.period.to)}.`].forEach((t, i) => doc.text(`${i + 1}.  ${t}`, 16, y + 6 + i * 5));
  kaki(doc);
  return doc;
}
