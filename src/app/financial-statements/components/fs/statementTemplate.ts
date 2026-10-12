import type { PrintColumn, PrintLetterhead, PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import type { Client } from '@/lib/clientsStore';
import { ASSET_SECTIONS, LIAB_SECTIONS, type Merged } from './bs/bsData';
import type { PlMerged } from './pl/plData';

// Download Balance Sheet & Profit and Loss dengan format laporan resmi
// (template 'statement' di src/lib/printExport.ts), mengikuti
// dataset/picture/Template UI/{Balance sheet,Profit loss}/*print.jpeg:
// kop logo klien, judul besar, seksi -> baris laporan -> subtotal, total
// utama berlatar gelap. Rincian per akun tidak ikut (sama seperti template).

/** "2025-12-31" -> "31 December 2025" */
export function fmtLongDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export const todayLong = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

/** Kop dari data klien aktif (logo, alamat, email, telepon). */
export function clientLetterhead(c: Client | null | undefined, fallbackName: string): PrintLetterhead {
  const real = (s?: string | null) => (s && s.trim() && s.trim() !== '-' ? s.trim() : null);
  return {
    name: real(c?.companyName) ?? fallbackName,
    logo: c?.logo ?? null,
    lines: [real(c?.address), real(c?.contactEmail), real(c?.contactPhone)].filter((x): x is string => !!x),
  };
}

interface Extra { header: string; values: (v: number[]) => number | null }
interface Opts {
  title: string;
  fileBase: string;
  companyName: string;
  subtitle: string;
  meta?: [string, string][];
  printedBy?: string;
  extra?: Extra[];
}

/** Penyusun baris bersama: kolom `cols` dari Merged + kolom turunan `extra`. */
function makeTable(cols: number[], colLabels: string[], extra: Extra[]) {
  const columns: PrintColumn[] = [{ key: 'desc', header: 'Description', width: 48 }];
  cols.forEach((_, i) => columns.push({ key: `c${i}`, header: colLabels[i], type: 'money', width: 20 }));
  extra.forEach((x, i) => columns.push({ key: `x${i}`, header: x.header, type: 'money', width: 20 }));
  const rows: PrintRow[] = [];
  const rowStyles: (PrintRowStyle | undefined)[] = [];
  const push = (desc: string, v: number[] | null, style?: PrintRowStyle) => {
    const r: PrintRow = { desc };
    cols.forEach((c, i) => { r[`c${i}`] = v ? v[c] : null; });
    extra.forEach((x, i) => { r[`x${i}`] = v ? x.values(v) : null; });
    rows.push(r);
    rowStyles.push(style);
  };
  return { columns, rows, rowStyles, push };
}

function finish(t: ReturnType<typeof makeTable>, opts: Opts, moneyPrefix?: string): PrintReport {
  const nMoney = t.columns.length - 1;
  return {
    template: 'statement',
    title: opts.title,
    fileBase: opts.fileBase,
    companyName: opts.companyName,
    subtitle: opts.subtitle,
    meta: opts.meta,
    printedBy: opts.printedBy,
    // "Rp " hanya muat kalau kolom angkanya sedikit.
    moneyPrefix: nMoney <= 2 ? moneyPrefix : undefined,
    orientation: nMoney > 4 ? 'landscape' : 'portrait',
    table: { columns: t.columns, rows: t.rows, rowStyles: t.rowStyles },
  };
}

// ── Balance Sheet ────────────────────────────────────────────────────

const BS_FALLBACK: Record<string, string> = {
  current_assets: 'Current Assets', non_current_assets: 'Non-current Assets',
  current_liabilities: 'Current Liabilities', non_current_liabilities: 'Non-current Liabilities', equity: 'Equity',
};

export function bsTemplateReport(m: Merged, cols: number[], colLabels: string[], opts: Opts): PrintReport {
  const t = makeTable(cols, colLabels, opts.extra ?? []);
  const sectionBlock = (key: string, withHeader = true) => {
    const s = m.sec(key);
    const label = s.label || BS_FALLBACK[key] || key;
    if (withHeader) t.push(label, null, 'section');
    s.lines.forEach(l => t.push(l.label, l.v));
    t.push(`Total ${label}`, s.v, 'total');
  };

  t.push('ASSETS', null, 'group');
  ASSET_SECTIONS.forEach(k => { sectionBlock(k); t.push('', null, 'spacer'); });
  t.push('TOTAL ASSETS', m.assets, 'grand');
  t.push('', null, 'spacer');

  t.push('LIABILITIES', null, 'group');
  LIAB_SECTIONS.forEach(k => { sectionBlock(k); t.push('', null, 'spacer'); });
  t.push('TOTAL LIABILITIES', m.liabilities, 'grand');
  t.push('', null, 'spacer');

  t.push('EQUITY', null, 'group');
  sectionBlock('equity', false);
  t.push('', null, 'spacer');
  t.push('TOTAL LIABILITIES & EQUITY', m.le, 'grand');
  return finish(t, opts, 'Rp ');
}

// ── Profit and Loss ──────────────────────────────────────────────────

const neg = (v: number[]) => v.map(x => -x);

export function plTemplateReport(m: PlMerged, cols: number[], colLabels: string[], opts: Opts): PrintReport {
  const t = makeTable(cols, colLabels, opts.extra ?? []);
  // Beban ditampilkan negatif -> dicetak dalam kurung seperti template.
  const block = (key: string, title: string, totalLabel: string, expense: boolean) => {
    const s = m.sec(key);
    const sign = (v: number[]) => (expense ? neg(v) : v);
    t.push(title, null, 'group');
    s.lines.forEach(l => t.push(l.label, sign(l.v)));
    t.push(totalLabel, sign(s.v), 'total');
    t.push('', null, 'spacer');
  };
  const subtotal = (label: string, v: number[]) => {
    t.push(label, v, 'highlight');
    t.push('', null, 'spacer');
  };

  block('revenue', 'REVENUE', 'Total Revenue', false);
  block('cost_of_sales', 'COST OF SALES', 'Total Cost of Sales', true);
  subtotal('GROSS PROFIT', m.grossProfit);
  block('operating_expenses', 'OPERATING EXPENSES', 'Total Operating Expenses', true);
  subtotal('OPERATING PROFIT', m.operatingProfit);
  block('other_income', 'OTHER INCOME', 'Total Other Income', false);
  block('other_expense', 'OTHER EXPENSES', 'Total Other Expenses', true);
  subtotal('PROFIT BEFORE TAX', m.pbt);
  t.push('Income Tax Expense', neg(m.tax), 'item');
  t.push('', null, 'spacer');
  t.push('NET PROFIT', m.netProfit, 'grand');
  return finish(t, opts);
}
