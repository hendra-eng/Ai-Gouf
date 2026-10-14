import jsPDF from 'jspdf';
import autoTable, { type CellHookData, type RowInput } from 'jspdf-autotable';
import ExcelJS from 'exceljs';
import { downloadBlob } from '@/app/transactions/components/exportTemplates/exportExcelShared';
import { loadLogo } from '@/lib/imageUtils';
import {
  amountInWords, BUCKET_LABEL, BUCKETS, DOC_STATUS_LABEL, fmtDate, fmtDateLong, PAYMENT_METHOD_LABEL,
  type AgingBucket, type AgingReport, type ArApDoc, type PartyStatement, type PaymentMethod, type SideConfig,
} from '@/lib/receivablesPayablesStore';

// Ekspor Accounts Receivable / Payable (PDF jsPDF + autotable, Excel exceljs):
//   - Aging Report (layout dataset/picture/Template UI/Account Receivable/3.jpeg)
//   - Open Invoice / Bill List
//   - Customer / Vendor Statement
//   - Bukti Receipt / Payment (tombol "Print Receipt" di form Record Receipt)
// Kop: merek Gouf Consulting di kiri, klien aktif (logo, nama, alamat) di kanan.

export type PaperSize = 'a4' | 'letter' | 'legal';
export type Orientation = 'portrait' | 'landscape';

export interface ReportHeader {
  clientName: string;
  clientLogo?: string | null;
  clientLines?: string[];
  generatedBy?: string | null;
}

const HIJAU: [number, number, number] = [15, 125, 78];
const HIJAU_TUA: [number, number, number] = [14, 47, 38];
const TEAL: [number, number, number] = [11, 94, 92];
const TINTA: [number, number, number] = [30, 41, 59];
const ABU: [number, number, number] = [100, 116, 139];
const GARIS: [number, number, number] = [226, 232, 240];
const TINT: [number, number, number] = [236, 253, 245];
const M = 14;

const angka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const rp = (n: number) => `${n < 0 ? '-' : ''}Rp ${angka.format(Math.abs(n))}`;
const pct = (n: number, total: number) => (total ? `${((n / total) * 100).toFixed(1).replace('.', ',')}%` : '0%');
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** Kelompok aging di laporan cetak (sesuai template): Current (0-30) = belum jatuh tempo + telat 1-30 hari. */
export const REPORT_GROUPS: { key: string; label: string; buckets: AgingBucket[]; color: string }[] = [
  { key: '0_30', label: '0 - 30 days', buckets: ['current', '1_30'], color: '#22C55E' },
  { key: '31_60', label: '31 - 60 days', buckets: ['31_60'], color: '#FACC15' },
  { key: '61_90', label: '61 - 90 days', buckets: ['61_90'], color: '#FB923C' },
  { key: '91_plus', label: '> 90 days', buckets: ['91_plus'], color: '#EF4444' },
];
export const sumBuckets = (b: Record<AgingBucket, number>, keys: AgingBucket[]) => keys.reduce((n, k) => n + (b[k] || 0), 0);

function nowLabel() {
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `${fmtDateLong(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function newDoc(paper: PaperSize, orientation: Orientation) {
  return new jsPDF({ orientation, unit: 'mm', format: paper });
}

/** Kop + garis hijau; mengembalikan y sesudah kop. */
async function letterhead(doc: jsPDF, h: ReportHeader): Promise<number> {
  const W = doc.internal.pageSize.getWidth();
  // Merek kiri
  doc.setFillColor(...HIJAU);
  doc.roundedRect(M, 12, 11, 11, 2.5, 2.5, 'F');
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(M + 3, 15, 5, 5, 1.2, 1.2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...HIJAU_TUA);
  doc.text('Gouf Consulting', M + 14, 17);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...TEAL);
  doc.text('Accounting', M + 14, 22.5);

  // Klien kanan
  let kananX = W - M;
  const logo = h.clientLogo ? await loadLogo(h.clientLogo) : null;
  if (logo) {
    const k = Math.min(16 / logo.width, 12 / logo.height);
    const w = logo.width * k;
    doc.addImage(logo.dataUrl, 'PNG', W - M - w, 11, w, logo.height * k);
    kananX = W - M - w - 3;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(...TINTA);
  doc.text(h.clientName, kananX, 14.5, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...ABU);
  let y = 18.5;
  for (const l of (h.clientLines ?? []).slice(0, 3)) {
    const potong = (doc.splitTextToSize(l, W / 2 - M) as string[])[0];
    doc.text(potong, kananX, y, { align: 'right' });
    y += 3.6;
  }
  const garis = Math.max(27, y);
  doc.setDrawColor(...HIJAU);
  doc.setLineWidth(0.6);
  doc.line(M, garis, W - M, garis);
  return garis + 9;
}

function judul(doc: jsPDF, y: number, title: string, sub: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.setTextColor(...TINTA);
  doc.text(title, M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...ABU);
  doc.text(sub, M, y + 6);
  return y + 13;
}

function meta(doc: jsPDF, y: number, rows: [string, string][]): number {
  doc.setFontSize(8.5);
  for (const [k, v] of rows) {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...ABU);
    doc.text(k, M, y);
    if (k) doc.text(':', M + 28, y);
    doc.setTextColor(...TINTA);
    doc.text(v, M + 32, y);
    y += 4.6;
  }
  return y + 2;
}

function footer(doc: jsPDF, note: string) {
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i += 1) {
    doc.setPage(i);
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    doc.setDrawColor(...GARIS);
    doc.setLineWidth(0.2);
    doc.line(M, H - 11, W - M, H - 11);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...ABU);
    doc.text(note, M, H - 7);
    doc.text(`Page ${i} of ${n}`, W - M, H - 7, { align: 'right' });
  }
}

const tabelDasar = {
  theme: 'grid' as const,
  styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.8, textColor: TINTA, lineColor: GARIS, lineWidth: 0.15 },
  headStyles: { fillColor: [248, 250, 252] as [number, number, number], textColor: TINTA, fontStyle: 'bold' as const, valign: 'middle' as const },
  margin: { left: M, right: M, bottom: 16 },
};

const lastY = (doc: jsPDF) => (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

// ============================================================
// AGING REPORT
// ============================================================

export interface AgingPdfOptions {
  cfg: SideConfig;
  header: ReportHeader;
  report: AgingReport;
  includeSummary: boolean;
  includeDetails: boolean;
  partyFilterLabel: string;
  paper: PaperSize;
  orientation: Orientation;
}

export async function buildAgingPdf(o: AgingPdfOptions): Promise<jsPDF> {
  const doc = newDoc(o.paper, o.orientation);
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  let y = await letterhead(doc, o.header);
  y = judul(doc, y, `${o.cfg.title} Aging Report`, `As of ${fmtDateLong(o.report.as_of)}`);
  y = meta(doc, y, [
    ['Client', o.header.clientName],
    [o.cfg.parties, o.partyFilterLabel],
    ['Report Date', nowLabel()],
    ['Generated By', o.header.generatedBy || '—'],
  ]);

  const body: RowInput[] = [];
  const gaya: ('party' | 'detail')[] = [];
  o.report.rows.forEach((r, i) => {
    body.push([String(i + 1), r.party, rp(r.total), ...REPORT_GROUPS.map(g => rp(sumBuckets(r.buckets, g.buckets)))]);
    gaya.push('party');
    if (o.includeDetails) {
      for (const d of r.invoices) {
        const b = d.bucket ?? 'current';
        body.push(['', `   ${d.no}  ·  due ${fmtDate(d.due_date)}${d.days_overdue ? ` (${d.days_overdue}d)` : ''}`, rp(d.outstanding),
          ...REPORT_GROUPS.map(g => (g.buckets.includes(b) ? rp(d.outstanding) : ''))]);
        gaya.push('detail');
      }
    }
  });
  const t = o.report.totals;
  autoTable(doc, {
    ...tabelDasar,
    startY: y,
    head: [['No', `${o.cfg.party} Name`, 'Total Outstanding', 'Current\n(0 - 30 days)', '31 - 60 days', '61 - 90 days', '> 90 days']],
    body: body.length ? body : [[{ content: `No outstanding ${o.cfg.docs.toLowerCase()} as of this date.`, colSpan: 7, styles: { halign: 'center', textColor: ABU } }]],
    foot: [['', 'Total', rp(t.total), ...REPORT_GROUPS.map(g => rp(sumBuckets(t.buckets, g.buckets)))]],
    footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'center', cellWidth: 9 }, 2: { halign: 'right', fontStyle: 'bold' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
    didParseCell: (hook: CellHookData) => {
      if (hook.section === 'head' && hook.column.index >= 2) hook.cell.styles.halign = 'right';
      if (hook.section === 'foot' && hook.column.index >= 2) hook.cell.styles.halign = 'right';
      if (hook.section === 'body' && gaya[hook.row.index] === 'detail') {
        hook.cell.styles.fontSize = 7;
        hook.cell.styles.textColor = ABU;
        hook.cell.styles.fontStyle = 'normal';
      }
    },
  });
  y = lastY(doc) + 8;

  if (o.includeSummary) {
    const lebarKiri = (W - 2 * M) * 0.58;
    if (y + 52 > H - 16) {
      doc.addPage();
      y = 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...TINTA);
    doc.text('Aging Summary', M, y);
    const ringkas = REPORT_GROUPS.map(g => ({ g, n: sumBuckets(t.buckets, g.buckets) }));
    autoTable(doc, {
      ...tabelDasar,
      startY: y + 3,
      margin: { left: M, right: W - M - lebarKiri, bottom: 16 },
      head: [['Aging Bucket', 'Amount (IDR)', 'Percentage', '']],
      body: ringkas.map(({ g, n }) => [g.label, rp(n), pct(n, t.total), '']),
      foot: [['Total Outstanding', rp(t.total), '100%', '']],
      footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right', cellWidth: 20 }, 3: { cellWidth: 26 } },
      didDrawCell: (hook: CellHookData) => {
        if (hook.section !== 'body' || hook.column.index !== 3) return;
        const { g, n } = ringkas[hook.row.index];
        const x = hook.cell.x + 2, w = hook.cell.width - 4, yy = hook.cell.y + hook.cell.height / 2 - 1.2;
        doc.setFillColor(...GARIS);
        doc.roundedRect(x, yy, w, 2.4, 1.2, 1.2, 'F');
        if (t.total > 0 && n > 0) {
          doc.setFillColor(...hex(g.color));
          doc.roundedRect(x, yy, Math.max(2.4, (w * n) / t.total), 2.4, 1.2, 1.2, 'F');
        }
      },
    });
    // Catatan di kanan
    const xN = M + lebarKiri + 6;
    const wN = W - M - xN;
    doc.setDrawColor(...GARIS);
    doc.setLineWidth(0.2);
    doc.roundedRect(xN, y - 4, wN, 46, 2, 2, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...TINTA);
    doc.text('Notes', xN + 4, y + 2);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.2);
    doc.setTextColor(...ABU);
    let yN = y + 7;
    [
      `This report shows the aging of ${o.cfg.title.toLowerCase()} as of ${fmtDateLong(o.report.as_of)}.`,
      'Amounts are presented in Indonesian Rupiah (IDR).',
      'Aging is based on the due date (estimated from payment terms when the due date is empty).',
      `Only posted ${o.cfg.sourceModule} transactions and posted settlements are included.`,
      'This is a system generated report and does not require a signature.',
    ].forEach((n, i) => {
      const baris = doc.splitTextToSize(`${i + 1}. ${n}`, wN - 8) as string[];
      doc.text(baris, xN + 4, yN);
      yN += baris.length * 3.3 + 0.8;
    });
  }
  footer(doc, `${o.cfg.title} Aging Report · ${o.header.clientName}`);
  return doc;
}

// ============================================================
// OPEN INVOICE / BILL LIST
// ============================================================

export async function buildDocListPdf(o: {
  cfg: SideConfig; header: ReportHeader; asOf: string; docs: ArApDoc[]; partyFilterLabel: string; paper: PaperSize; orientation: Orientation;
}): Promise<jsPDF> {
  const doc = newDoc(o.paper, o.orientation);
  let y = await letterhead(doc, o.header);
  y = judul(doc, y, `Open ${o.cfg.docs} List`, `As of ${fmtDateLong(o.asOf)}`);
  y = meta(doc, y, [
    ['Client', o.header.clientName],
    [o.cfg.parties, o.partyFilterLabel],
    ['Report Date', nowLabel()],
    ['Generated By', o.header.generatedBy || '—'],
  ]);
  const total = o.docs.reduce((n, d) => ({ t: n.t + d.total, p: n.p + d.paid, o: n.o + d.outstanding }), { t: 0, p: 0, o: 0 });
  autoTable(doc, {
    ...tabelDasar,
    startY: y,
    head: [[o.cfg.party, `${o.cfg.doc} No.`, 'Date', 'Due Date', 'Total', 'Paid', 'Outstanding', 'Aging', 'Status']],
    body: o.docs.length ? o.docs.map(d => [d.party, d.no, fmtDate(d.date), fmtDate(d.due_date), rp(d.total), rp(d.paid), rp(d.outstanding),
      d.bucket ? BUCKET_LABEL[d.bucket] : '—', DOC_STATUS_LABEL[d.status]])
      : [[{ content: `No open ${o.cfg.docs.toLowerCase()}.`, colSpan: 9, styles: { halign: 'center', textColor: ABU } }]],
    foot: [['Total', '', '', '', rp(total.t), rp(total.p), rp(total.o), '', '']],
    footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
    columnStyles: { 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right', fontStyle: 'bold' } },
    didParseCell: (hook: CellHookData) => {
      if ((hook.section === 'head' || hook.section === 'foot') && [4, 5, 6].includes(hook.column.index)) hook.cell.styles.halign = 'right';
    },
  });
  footer(doc, `Open ${o.cfg.docs} List · ${o.header.clientName}`);
  return doc;
}

// ============================================================
// STATEMENT
// ============================================================

export async function buildStatementPdf(o: {
  cfg: SideConfig; header: ReportHeader; st: PartyStatement; includeSummary: boolean; paper: PaperSize; orientation: Orientation;
  /** true = tabel invoice yang masih terbuka per tanggal akhir, bukan mutasi periode. */
  openItemsOnly?: boolean; partyCode?: string | null; partyLines?: string[];
}): Promise<jsPDF> {
  const doc = newDoc(o.paper, o.orientation);
  const W = doc.internal.pageSize.getWidth();
  const s = o.st;
  let y = await letterhead(doc, o.header);
  y = judul(doc, y, `${o.cfg.party} Statement`, `${fmtDateLong(s.date_from)} - ${fmtDateLong(s.date_to)}`);
  y = meta(doc, y, [
    [o.cfg.party, o.partyCode ? `${s.party} (${o.partyCode})` : s.party],
    ...(o.partyLines ?? []).filter(Boolean).map(l => ['', l] as [string, string]),
    ...(s.party_tax_id ? [[o.cfg.side === 'ar' ? 'Tax ID (NPWP)' : 'Vendor Code', s.party_tax_id] as [string, string]] : []),
    ['Report Date', nowLabel()],
    ['Generated By', o.header.generatedBy || '—'],
  ]);

  // Kotak ringkasan
  const kotak: [string, number][] = [
    ['Opening Balance', s.opening_balance],
    [o.cfg.side === 'ar' ? 'Invoiced' : 'Billed', s.total_charges],
    [o.cfg.settled, s.total_settlements],
    ['Closing Balance', s.closing_balance],
  ];
  const lebar = (W - 2 * M - 9) / 4;
  kotak.forEach(([k, v], i) => {
    const x = M + i * (lebar + 3);
    doc.setFillColor(...(i === 3 ? TINT : ([248, 250, 252] as [number, number, number])));
    doc.roundedRect(x, y, lebar, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...ABU);
    doc.text(k, x + 3, y + 5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...(i === 3 ? HIJAU_TUA : TINTA));
    doc.text(rp(v), x + 3, y + 11);
  });
  y += 20;

  const tipe: Record<string, string> = {
    invoice: 'Invoice', bill: 'Bill', settlement: o.cfg.settle, reversal: 'Reversal', settled_outside: 'Settled',
  };
  if (o.openItemsOnly) {
    let jalan = 0;
    autoTable(doc, {
      ...tabelDasar,
      startY: y,
      head: [[`${o.cfg.doc} Date`, `${o.cfg.doc} No.`, 'Due Date', 'Days Overdue', 'Total', o.cfg.settled, 'Outstanding', 'Balance']],
      body: s.open_invoices.map(d => {
        jalan += d.outstanding;
        return [fmtDate(d.date), d.no, fmtDate(d.due_date), d.days_overdue ? String(d.days_overdue) : '-', rp(d.total), rp(d.paid), rp(d.outstanding), rp(jalan)];
      }),
      foot: [['', '', '', '', '', `Open items as of ${fmtDate(s.date_to)}`, '', rp(s.closing_balance)]],
      footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' } },
      didParseCell: (hook: CellHookData) => {
        if ((hook.section === 'head' || hook.section === 'foot') && hook.column.index >= 3) hook.cell.styles.halign = 'right';
      },
    });
  } else autoTable(doc, {
    ...tabelDasar,
    startY: y,
    head: [['Date', 'Type', 'Number', 'Description', 'Due Date', o.cfg.side === 'ar' ? 'Charges' : 'Bills', o.cfg.settle + 's', 'Balance']],
    body: [
      [{ content: `Opening balance as of ${fmtDate(s.date_from)}`, colSpan: 7, styles: { fontStyle: 'italic', textColor: ABU } }, rp(s.opening_balance)],
      ...s.lines.map(l => [fmtDate(l.date), tipe[l.type] ?? l.type, l.number, l.description, l.due_date ? fmtDate(l.due_date) : '',
        l.charge ? rp(l.charge) : '', l.settlement ? rp(l.settlement) : '', rp(l.balance)]),
    ],
    foot: [['', '', '', 'Closing balance', '', rp(s.total_charges), rp(s.total_settlements), rp(s.closing_balance)]],
    footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
    columnStyles: { 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right', fontStyle: 'bold' }, 3: { cellWidth: 'auto' } },
    didParseCell: (hook: CellHookData) => {
      if ((hook.section === 'head' || hook.section === 'foot') && hook.column.index >= 5) hook.cell.styles.halign = 'right';
    },
  });
  y = lastY(doc) + 7;

  if (o.includeSummary) {
    autoTable(doc, {
      ...tabelDasar,
      startY: y,
      head: [BUCKETS.map(b => BUCKET_LABEL[b]).concat('Total Due')],
      body: [BUCKETS.map(b => rp(s.aging[b] || 0)).concat(rp(BUCKETS.reduce((n, b) => n + (s.aging[b] || 0), 0)))],
      styles: { ...tabelDasar.styles, halign: 'right' },
      didParseCell: (hook: CellHookData) => { hook.cell.styles.halign = 'right'; },
    });
  }
  footer(doc, `${o.cfg.party} Statement · ${s.party} · ${o.header.clientName}`);
  return doc;
}

// ============================================================
// BUKTI RECEIPT / PAYMENT
// ============================================================

export async function buildVoucherPdf(o: {
  cfg: SideConfig; header: ReportHeader; number: string; date: string; party: string; method: PaymentMethod; bank: string;
  reference?: string | null; referenceDate?: string | null; notes?: string | null; status: string;
  allocations: { no: string; date: string; due_date: string; amount: number }[]; unapplied: number;
}): Promise<jsPDF> {
  const doc = newDoc('a4', 'portrait');
  const W = doc.internal.pageSize.getWidth();
  let y = await letterhead(doc, o.header);
  y = judul(doc, y, o.cfg.side === 'ar' ? 'Official Receipt' : 'Payment Voucher', `${o.number} · ${o.status}`);
  const kiri: [string, string][] = [
    [o.cfg.party, o.party],
    ['Date', fmtDateLong(o.date)],
    ['Payment Method', PAYMENT_METHOD_LABEL[o.method]],
    [o.cfg.side === 'ar' ? 'Deposited To' : 'Paid From', o.bank],
    ['Reference', [o.reference, o.referenceDate ? fmtDate(o.referenceDate) : null].filter(Boolean).join(' · ') || '—'],
  ];
  y = meta(doc, y, kiri);
  if (o.notes) {
    doc.setFontSize(8.5);
    doc.setTextColor(...ABU);
    const b = doc.splitTextToSize(`Notes: ${o.notes}`, W - 2 * M) as string[];
    doc.text(b, M, y);
    y += b.length * 4 + 2;
  }
  const total = o.allocations.reduce((n, a) => n + a.amount, 0) + o.unapplied;
  autoTable(doc, {
    ...tabelDasar,
    startY: y,
    head: [['No', `${o.cfg.doc} No.`, `${o.cfg.doc} Date`, 'Due Date', 'Amount']],
    body: [
      ...o.allocations.map((a, i) => [String(i + 1), a.no, fmtDate(a.date), fmtDate(a.due_date), rp(a.amount)]),
      ...(o.unapplied > 0 ? [[String(o.allocations.length + 1), o.cfg.side === 'ar' ? 'Unapplied (customer deposit)' : 'Unapplied (vendor advance)', '', '', rp(o.unapplied)]] : []),
    ],
    foot: [['', 'Total', '', '', rp(total)]],
    footStyles: { fillColor: TINT, textColor: HIJAU_TUA, fontStyle: 'bold' },
    columnStyles: { 0: { halign: 'center', cellWidth: 10 }, 4: { halign: 'right' } },
    didParseCell: (hook: CellHookData) => {
      if ((hook.section === 'head' || hook.section === 'foot') && hook.column.index === 4) hook.cell.styles.halign = 'right';
    },
  });
  y = lastY(doc) + 6;
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(9);
  doc.setTextColor(...TINTA);
  doc.text(doc.splitTextToSize(`In words: ${amountInWords(total)}`, W - 2 * M) as string[], M, y);
  y += 22;
  const kolom = o.cfg.side === 'ar' ? ['Prepared by', 'Approved by', 'Received by'] : ['Prepared by', 'Approved by', 'Received by (vendor)'];
  const lebar = (W - 2 * M) / 3;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  kolom.forEach((k, i) => {
    const x = M + i * lebar;
    doc.setTextColor(...ABU);
    doc.text(k, x + lebar / 2, y, { align: 'center' });
    doc.setDrawColor(...ABU);
    doc.line(x + 8, y + 22, x + lebar - 8, y + 22);
  });
  footer(doc, `${o.number} · ${o.header.clientName}`);
  return doc;
}

// ============================================================
// EXCEL
// ============================================================

async function simpanXlsx(wb: ExcelJS.Workbook, fileName: string) {
  const buf = await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheetml.sheet' }), fileName);
}

function kopXlsx(ws: ExcelJS.Worksheet, title: string, lines: string[], kolom: number) {
  ws.addRow([title]).font = { bold: true, size: 14 };
  for (const l of lines) ws.addRow([l]).font = { color: { argb: 'FF64748B' } };
  ws.addRow([]);
  ws.mergeCells(1, 1, 1, kolom);
}

function gayaHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECFDF5' } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF0F7D4E' } } };
  });
}

const FMT_UANG = '#,##0.00;[Red]-#,##0.00';

export async function downloadAgingXlsx(cfg: SideConfig, clientName: string, report: AgingReport, includeDetails: boolean) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Aging');
  const head = ['No', cfg.party, 'Total Outstanding', ...BUCKETS.map(b => BUCKET_LABEL[b])];
  kopXlsx(ws, `${cfg.title} Aging Report`, [clientName, `As of ${fmtDateLong(report.as_of)}`], head.length);
  gayaHeader(ws.addRow(head));
  report.rows.forEach((r, i) => {
    ws.addRow([i + 1, r.party, r.total, ...BUCKETS.map(b => r.buckets[b])]).getCell(2).font = { bold: true };
    if (includeDetails) {
      for (const d of r.invoices) {
        const row = ws.addRow(['', `   ${d.no} (due ${fmtDate(d.due_date)})`, d.outstanding, ...BUCKETS.map(b => (d.bucket === b ? d.outstanding : null))]);
        row.font = { color: { argb: 'FF64748B' }, size: 9 };
      }
    }
  });
  const tot = ws.addRow(['', 'Total', report.totals.total, ...BUCKETS.map(b => report.totals.buckets[b])]);
  tot.font = { bold: true };
  for (let c = 3; c <= head.length; c += 1) ws.getColumn(c).numFmt = FMT_UANG;
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 42;
  for (let c = 3; c <= head.length; c += 1) ws.getColumn(c).width = 20;
  await simpanXlsx(wb, `${cfg.short}-Aging-${report.as_of}.xlsx`);
}

export async function downloadDocsXlsx(cfg: SideConfig, clientName: string, asOf: string, docs: ArApDoc[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(cfg.docs);
  const head = [cfg.party, `${cfg.doc} No.`, ...(cfg.side === 'ap' ? ['Purchase No.'] : []), 'Date', 'Due Date', 'Total', 'Paid', 'In Process',
    'Outstanding', 'Days Overdue', 'Aging', 'Status', 'Account'];
  kopXlsx(ws, `${cfg.title} — ${cfg.docs}`, [clientName, `As of ${fmtDateLong(asOf)}`], head.length);
  gayaHeader(ws.addRow(head));
  for (const d of docs) {
    ws.addRow([d.party, d.no, ...(cfg.side === 'ap' ? [d.ref_no ?? ''] : []), d.date, d.due_date, d.total, d.paid, d.in_process,
      d.outstanding, d.days_overdue, d.bucket ? BUCKET_LABEL[d.bucket] : '', DOC_STATUS_LABEL[d.status], `${d.account_code} ${d.account_name}`]);
  }
  const off = cfg.side === 'ap' ? 1 : 0;
  for (const c of [5, 6, 7, 8].map(x => x + off)) {
    ws.getColumn(c).numFmt = FMT_UANG;
    ws.getColumn(c).width = 18;
  }
  ws.getColumn(1).width = 36;
  ws.getColumn(2).width = 22;
  ws.getColumn(head.length).width = 34;
  await simpanXlsx(wb, `${cfg.short}-${cfg.docs}-${asOf}.xlsx`);
}

export async function downloadStatementXlsx(cfg: SideConfig, clientName: string, st: PartyStatement) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Statement');
  const head = ['Date', 'Type', 'Number', 'Description', 'Due Date', 'Charges', `${cfg.settle}s`, 'Balance'];
  kopXlsx(ws, `${cfg.party} Statement — ${st.party}`, [clientName, `${fmtDateLong(st.date_from)} - ${fmtDateLong(st.date_to)}`], head.length);
  gayaHeader(ws.addRow(head));
  ws.addRow(['', '', '', 'Opening balance', '', null, null, st.opening_balance]).font = { italic: true };
  for (const l of st.lines) ws.addRow([l.date, l.type, l.number, l.description, l.due_date ?? '', l.charge || null, l.settlement || null, l.balance]);
  ws.addRow(['', '', '', 'Closing balance', '', st.total_charges, st.total_settlements, st.closing_balance]).font = { bold: true };
  for (const c of [6, 7, 8]) {
    ws.getColumn(c).numFmt = FMT_UANG;
    ws.getColumn(c).width = 18;
  }
  ws.getColumn(4).width = 44;
  ws.getColumn(3).width = 20;
  await simpanXlsx(wb, `${cfg.short}-Statement-${st.party.replace(/[^A-Za-z0-9]+/g, '_')}-${st.date_to}.xlsx`);
}

export function downloadDocsCsv(cfg: SideConfig, asOf: string, docs: ArApDoc[]) {
  const sel = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = [cfg.party, `${cfg.doc} No.`, 'Date', 'Due Date', 'Total', 'Paid', 'Outstanding', 'Days Overdue', 'Aging', 'Status'];
  const rows = docs.map(d => [d.party, d.no, d.date, d.due_date, d.total, d.paid, d.outstanding, d.days_overdue,
    d.bucket ? BUCKET_LABEL[d.bucket] : '', DOC_STATUS_LABEL[d.status]]);
  const csv = [head, ...rows].map(r => r.map(sel).join(',')).join('\n');
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${cfg.short}-${cfg.docs}-${asOf}.csv`);
}
