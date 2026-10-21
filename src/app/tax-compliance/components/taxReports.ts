// Laporan pajak (PDF jsPDF + Excel/CSV lewat tableExport). Layout PDF mengikuti
// Template UI/Tax Compliance/6.jpeg: kop Gouf + identitas klien (NPWP, alamat),
// judul, periode, kotak KPI, tabel dengan baris total.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { fmtDate, fmtDateLong, fmtMonth } from '@/lib/receivablesPayablesStore';
import { EXC_STATUS, FILING_STYLE, SEVERITY_STYLE, TAX_REPORTS, type TaxReport } from '@/lib/taxComplianceStore';
import type { ExportColumn, ExportSpec } from '@/lib/tableExport';

type Row = Record<string, unknown>;
const s = (k: string) => (r: Row) => (r[k] as string | null) ?? null;
const n = (k: string) => (r: Row) => (r[k] as number | null) ?? null;
const jumlah = (rows: Row[], k: string) => rows.reduce((t, r) => t + ((r[k] as number) || 0), 0);
const angka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const rp = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `Rp ${angka.format(v)}`);
const bulan = (iso: unknown) => (iso ? fmtMonth(String(iso).slice(0, 7)) : '');

export interface TaxCols { columns: ExportColumn<Row>[]; totals?: Record<string, string | number | null> }

export function taxColumns(d: TaxReport): TaxCols {
  const rows = d.rows;
  switch (d.report_type) {
    case 'withholding_summary':
      return { columns: [
        { header: 'No.', value: r => rows.indexOf(r) + 1, type: 'number' }, { header: 'Tax Type', value: s('label') },
        { header: 'DPP (Tax Base)', value: n('dpp'), type: 'money' }, { header: 'Tax Rate', value: s('rate') },
        { header: 'Tax Amount', value: n('tax_amount'), type: 'money' }, { header: 'Transactions', value: n('count'), type: 'number' },
      ], totals: { 'Tax Type': 'Total', 'DPP (Tax Base)': jumlah(rows, 'dpp'), 'Tax Rate': '-', 'Tax Amount': jumlah(rows, 'tax_amount'), Transactions: jumlah(rows, 'count') } };
    case 'vat_summary':
      return { columns: [
        { header: 'Tax Period', value: r => bulan(r.period) }, { header: 'Output DPP', value: n('output_dpp'), type: 'money' }, { header: 'Output VAT', value: n('output_vat'), type: 'money' },
        { header: 'Input DPP', value: n('input_dpp'), type: 'money' }, { header: 'Input VAT', value: n('input_vat'), type: 'money' }, { header: 'Net VAT', value: n('net_vat'), type: 'money' },
        { header: 'Position', value: s('position') }, { header: 'Paid', value: n('paid'), type: 'money' },
        { header: 'Filing', value: r => FILING_STYLE[r.filing as keyof typeof FILING_STYLE]?.label ?? String(r.filing ?? '') },
      ], totals: { 'Tax Period': 'Total', 'Output DPP': jumlah(rows, 'output_dpp'), 'Output VAT': jumlah(rows, 'output_vat'), 'Input DPP': jumlah(rows, 'input_dpp'),
        'Input VAT': jumlah(rows, 'input_vat'), 'Net VAT': jumlah(rows, 'net_vat'), Paid: jumlah(rows, 'paid') } };
    case 'payment_register':
      return { columns: [
        { header: 'Payment No.', value: s('payment_no') }, { header: 'Payment Date', value: r => fmtDate(r.payment_date as string) }, { header: 'Tax Period', value: r => bulan(r.tax_period) },
        { header: 'Tax Type', value: s('tax_type_label') }, { header: 'Amount', value: n('amount'), type: 'money' }, { header: 'Billing Code', value: s('billing_code') },
        { header: 'NTPN', value: s('ntpn') }, { header: 'Bank Account', value: s('bank_account') }, { header: 'Status', value: s('status') },
      ], totals: { 'Payment No.': 'Total', Amount: jumlah(rows.filter(r => r.status === 'paid'), 'amount') } };
    case 'reconciliation':
      return { columns: [
        { header: 'Tax Type', value: s('label') }, { header: 'Tax Ledger', value: n('ledger_amount'), type: 'money' }, { header: 'GL Amount', value: n('gl_amount'), type: 'money' },
        { header: 'Difference', value: n('difference'), type: 'money' }, { header: 'Payments', value: n('payment_amount'), type: 'money' },
        { header: 'Filing', value: s('filing_status') }, { header: 'Status', value: r => (r.status === 'reconciled' ? 'Reconciled' : 'Difference') },
      ], totals: { 'Tax Type': 'Total', 'Tax Ledger': jumlah(rows, 'ledger_amount'), 'GL Amount': jumlah(rows, 'gl_amount'), Difference: jumlah(rows, 'difference'), Payments: jumlah(rows, 'payment_amount') } };
    case 'exposure':
      return { columns: [
        { header: 'Issue ID', value: s('exception_no') }, { header: 'Tax Type', value: s('tax_type_label') }, { header: 'Source', value: s('source_document') },
        { header: 'Counterparty', value: s('party_name') }, { header: 'Reason', value: s('reason') }, { header: 'Potential Tax', value: n('potential_tax'), type: 'money' },
        { header: 'Severity', value: r => SEVERITY_STYLE[r.severity as keyof typeof SEVERITY_STYLE]?.label ?? '' },
        { header: 'Status', value: r => EXC_STATUS[r.status as keyof typeof EXC_STATUS]?.label ?? '' }, { header: 'Age (days)', value: n('age_days'), type: 'number' },
      ], totals: { 'Issue ID': 'Total', 'Potential Tax': jumlah(rows, 'potential_tax') } };
    case 'filing_status':
      return { columns: [
        { header: 'Return', value: s('return_label') }, { header: 'Tax Period', value: r => (r.return_type === 'annual_corporate' ? String(r.tax_period).slice(0, 4) : bulan(r.tax_period)) },
        { header: 'Due Date', value: r => fmtDate(r.due_date as string) }, { header: 'Filed Date', value: r => fmtDate(r.filed_date as string) },
        { header: 'Receipt (BPE)', value: s('receipt_no') }, { header: 'Amount', value: n('amount'), type: 'money' },
        { header: 'Status', value: r => FILING_STYLE[r.status as keyof typeof FILING_STYLE]?.label ?? '' }, { header: 'Timeliness', value: r => (r.late ? 'Late' : 'On time') },
      ] };
  }
}

export function taxSpec(d: TaxReport, c: TaxCols): ExportSpec<Row> {
  const meta = TAX_REPORTS.find(r => r.type === d.report_type)!;
  return { title: meta.title, clientName: d.client.name, subtitle: `Period: ${fmtDateLong(d.period.from)} – ${fmtDateLong(d.period.to)}`,
    meta: d.client.npwp ? [['NPWP', d.client.npwp]] : undefined, columns: c.columns, rows: d.rows, totals: c.totals,
    fileName: `${meta.title.replace(/[^A-Za-z0-9]+/g, '-')}-${d.period.to}`, orientation: c.columns.length > 7 ? 'landscape' : 'portrait' };
}

const HIJAU: [number, number, number] = [15, 125, 78];
const TINTA: [number, number, number] = [15, 23, 42];
const ABU: [number, number, number] = [100, 116, 139];

export function buildTaxPdf(d: TaxReport, c: TaxCols, generatedBy: string): jsPDF {
  const meta = TAX_REPORTS.find(r => r.type === d.report_type)!;
  const lanskap = c.columns.length > 7;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: lanskap ? 'landscape' : 'portrait' });
  const W = doc.internal.pageSize.getWidth();
  // Kop
  doc.setFillColor(...HIJAU);
  doc.roundedRect(14, 12, 12, 12, 3, 3, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Z', 20, 20.3, { align: 'center' });
  doc.setTextColor(...TINTA);
  doc.setFontSize(14);
  doc.text('zafeb', 29, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...ABU);
  doc.text('Accounting', 29, 22.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  doc.text(d.client.name, W - 14, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...ABU);
  let yk = 19;
  if (d.client.npwp) { doc.text(`NPWP: ${d.client.npwp}`, W - 14, yk, { align: 'right' }); yk += 3.6; }
  for (const baris of (doc.splitTextToSize(d.client.address || '', 80) as string[]).slice(0, 2)) { doc.text(baris, W - 14, yk, { align: 'right' }); yk += 3.6; }
  // Judul
  let y = Math.max(34, yk + 6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...TINTA);
  doc.text(meta.title, 14, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...ABU);
  doc.text(`Period: ${fmtDateLong(d.period.from)} – ${fmtDateLong(d.period.to)}`, 14, y + 6);
  doc.setFontSize(8);
  const kanan = [['Report Date', fmtDateLong(new Date().toISOString().slice(0, 10))], ['Generated By', generatedBy || '—'], ['Output Format', 'PDF']];
  kanan.forEach(([k, v], i) => { doc.text(k, W - 60, y - 4 + i * 4); doc.setTextColor(...TINTA); doc.text(v, W - 14, y - 4 + i * 4, { align: 'right' }); doc.setTextColor(...ABU); });
  y += 13;
  // KPI (withholding summary)
  if (d.summary) {
    const sm = d.summary;
    const kartu: [string, string][] = [['Total DPP', rp(sm.total_dpp)], ['Total Tax Amount', rp(sm.total_tax)], ['Total Transactions', String(sm.transactions)],
      ['Withholding Tax Types', `${sm.types}${sm.type_labels ? ` · ${sm.type_labels}` : ''}`]];
    const w = (W - 28 - 9) / 4;
    doc.setFillColor(236, 253, 245);
    doc.roundedRect(14, y, W - 28, 20, 2, 2, 'F');
    kartu.forEach(([k, v], i) => {
      const x = 14 + i * (w + 3) + 4;
      doc.setFontSize(7.5); doc.setTextColor(...ABU); doc.setFont('helvetica', 'normal'); doc.text(k, x, y + 7);
      doc.setFontSize(i === 3 ? 8.5 : 11); doc.setTextColor(...TINTA); doc.setFont('helvetica', 'bold');
      doc.text((doc.splitTextToSize(v, w - 4) as string[])[0], x, y + 14);
    });
    y += 26;
  }
  const teks = (col: ExportColumn<Row>, v: unknown) => (v === null || v === undefined || v === '' ? '' : col.type === 'money' && typeof v === 'number' ? rp(v)
    : col.type === 'number' && typeof v === 'number' ? angka.format(v) : String(v));
  autoTable(doc, {
    startY: y,
    head: [c.columns.map(x => x.header)],
    body: d.rows.map(r => c.columns.map(x => teks(x, x.value(r)))),
    foot: c.totals && d.rows.length ? [c.columns.map(x => teks(x, c.totals![x.header]))] : undefined,
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, textColor: TINTA, lineColor: [226, 232, 240], lineWidth: 0.15 },
    headStyles: { fillColor: [241, 245, 249], fontStyle: 'bold' },
    footStyles: { fillColor: [220, 252, 231], fontStyle: 'bold' },
    columnStyles: Object.fromEntries(c.columns.map((x, i) => [i, { halign: x.type ? 'right' : 'left' }])),
    margin: { left: 14, right: 14, bottom: 16 },
  });
  if (!d.rows.length) {
    doc.setFontSize(9); doc.setTextColor(...ABU); doc.text('No data for this period.', 14, y + 16);
  }
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i += 1) {
    doc.setPage(i);
    const H = doc.internal.pageSize.getHeight();
    doc.setFontSize(7); doc.setTextColor(...ABU); doc.setFont('helvetica', 'normal');
    doc.text('Generated by zafeb', 14, H - 8);
    doc.text(`Page ${i} of ${total}`, W - 14, H - 8, { align: 'right' });
  }
  return doc;
}
