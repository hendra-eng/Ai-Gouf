'use client';

import { useEffect, useState } from 'react';
import { fetchCashFlowSeries, type CashFlowSeries, type CfDirectLine, type CfLine } from '@/lib/fsStore';
import type { PrintColumn, PrintReport, PrintRow, PrintRowStyle } from '@/lib/printExport';
import { iso, monthEnd, parts, shiftYear } from '../bs/bsData';

// Data bersama tampilan Cash Flow (direct / indirect). Satu panggilan
// /cash-flow/series berisi kolom periode (bulan / kuartal / tahun di dalam
// rentang) + 3 periode ringkasan: TOTAL rentang, periode sebelumnya
// (panjang sama, tepat sebelum rentang) dan rentang yang sama tahun lalu.

export const CF_COLORS = { operating: '#22C55E', investing: '#0EA5E9', financing: '#F59E0B', net: '#0B5E5C', brand: '#0F7D4E' };

export type Method = 'direct' | 'indirect';
export type Granularity = 'monthly' | 'quarterly' | 'annual';
export interface Period { start: string; end: string; label: string }

export const MAX_COLUMNS = 36;

// ── Periode ──────────────────────────────────────────────────────────

const dayBefore = (d: string) => {
  const [y, m, dd] = parts(d);
  const t = new Date(Date.UTC(y, m - 1, dd - 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
const daysBetween = (a: string, b: string) => {
  const [y1, m1, d1] = parts(a), [y2, m2, d2] = parts(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
};
const addDays = (d: string, n: number) => {
  const [y, m, dd] = parts(d);
  const t = new Date(Date.UTC(y, m - 1, dd + n));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
};
const mon = (y: number, m: number) => new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** Pecah [from, to] menjadi kolom bulan / kuartal / tahun kalender (dipotong ke rentang). */
export function splitRange(from: string, to: string, g: Granularity): Period[] {
  const out: Period[] = [];
  let [y, m] = parts(from);
  if (g === 'quarterly') m = Math.floor((m - 1) / 3) * 3 + 1;
  if (g === 'annual') m = 1;
  const step = g === 'monthly' ? 1 : g === 'quarterly' ? 3 : 12;
  while (out.length <= MAX_COLUMNS) {
    const start = iso(y, m, 1);
    if (start > to) break;
    const end = monthEnd(y, m + step - 1);
    const label = g === 'monthly' ? mon(y, m) : g === 'quarterly' ? `Q${(m - 1) / 3 + 1} ${y}` : String(y);
    out.push({ start: start < from ? from : start, end: end > to ? to : end, label });
    m += step;
    while (m > 12) { m -= 12; y += 1; }
  }
  return out;
}

/** Periode dengan panjang sama tepat sebelum [from, to]. */
export function previousRange(from: string, to: string): { start: string; end: string } {
  const [fy, fm, fd] = parts(from), [ty, tm] = parts(to);
  if (fd === 1 && to === monthEnd(ty, tm)) {
    // Rentang bulan penuh (bulan / kuartal / tahun): geser sebanyak jumlah bulannya.
    const n = (ty - fy) * 12 + (tm - fm) + 1;
    const s = monthEnd(fy, fm - n);
    const [sy, sm] = parts(s);
    return { start: iso(sy, sm, 1), end: monthEnd(fy, fm - 1) };
  }
  const end = dayBefore(from);
  return { start: addDays(end, -daysBetween(from, to)), end };
}

export function fmtRange(from: string, to: string): string {
  const f = (d: string) => { const [y, m, dd] = parts(d); return new Date(y, m - 1, dd).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  return `${f(from)} – ${f(to)}`;
}

// ── Model baris ──────────────────────────────────────────────────────

export type Tone = 'operating' | 'investing' | 'financing';

export interface CfAccount { code: string; name: string; v: number[] }
export interface CfRow {
  kind: 'heading' | 'sub' | 'line' | 'total' | 'grand' | 'cash';
  key: string;
  label: string;
  v: number[];
  tone?: Tone;
  accounts?: CfAccount[];
  flag?: boolean;
}

export interface CfMerged {
  /** Semua periode: kolom..., TOTAL, PREV, LY */
  periods: { start: string; end: string }[];
  cols: number;
  TOTAL: number;
  PREV: number;
  LY: number;
  rows: Record<Method, CfRow[]>;
  operating: Record<Method, number[]>;
  investing: number[];
  financing: number[];
  net: number[];
  revenue: number[];
  opening: number[];
  ending: number[];
  data: CashFlowSeries;
}

type AnyLine = CfLine | CfDirectLine;

/** Gabung baris berlabel sama dari tiap periode -> nilai per kolom (+ akun). */
function unionLines(n: number, pick: (i: number) => AnyLine[], prefix: string, tone: Tone, flag = false): CfRow[] {
  const rows: CfRow[] = [];
  const byKey = new Map<string, CfRow>();
  for (let i = 0; i < n; i++) {
    pick(i).forEach(l => {
      let r = byKey.get(l.label);
      if (!r) { r = { kind: 'line', key: `${prefix}:${l.label}`, label: l.label, v: new Array(n).fill(0), tone, accounts: [], flag }; byKey.set(l.label, r); rows.push(r); }
      r.v[i] = l.amount;
      l.accounts.forEach(a => {
        let ra = r!.accounts!.find(x => x.code === a.code);
        if (!ra) { ra = { code: a.code, name: a.name, v: new Array(n).fill(0) }; r!.accounts!.push(ra); }
        ra.v[i] = a.amount;
      });
    });
  }
  rows.forEach(r => r.accounts!.sort((a, b) => a.code.localeCompare(b.code)));
  return rows;
}

export function mergeSeries(data: CashFlowSeries, periods: { start: string; end: string }[], cols: number): CfMerged {
  const byKey = new Map(data.periods.map(p => [`${p.period.start}:${p.period.end}`, p]));
  const ps = periods.map(p => byKey.get(`${p.start}:${p.end}`)!);
  const n = ps.length;
  const map = (f: (i: number) => number) => Array.from({ length: n }, (_, i) => f(i));
  const I = (i: number) => ps[i].indirect, D = (i: number) => ps[i].direct;

  const investing = map(i => I(i).investing.total);
  const financing = map(i => I(i).financing.total);
  const net = map(i => I(i).net_change);
  const opening = map(i => I(i).opening_cash);
  const ending = map(i => I(i).ending_cash);
  const opInd = map(i => I(i).operating.total);
  const opDir = map(i => D(i).operating.total);

  const tail = (inv: CfRow[], fin: CfRow[], op: number[], invT: number[], finT: number[], netV: number[], openV: number[], endV: number[]): CfRow[] => [
    { kind: 'total', key: 't-op', label: 'Net Cash from Operating Activities', v: op, tone: 'operating' },
    { kind: 'heading', key: 'h-inv', label: 'Cash Flows from Investing Activities', v: [], tone: 'investing' },
    ...inv,
    { kind: 'total', key: 't-inv', label: 'Net Cash from Investing Activities', v: invT, tone: 'investing' },
    { kind: 'heading', key: 'h-fin', label: 'Cash Flows from Financing Activities', v: [], tone: 'financing' },
    ...fin,
    { kind: 'total', key: 't-fin', label: 'Net Cash from Financing Activities', v: finT, tone: 'financing' },
    { kind: 'grand', key: 'net', label: 'Net Increase (Decrease) in Cash and Cash Equivalents', v: netV },
    { kind: 'cash', key: 'open', label: 'Cash and Cash Equivalents at Beginning of Period', v: openV },
    { kind: 'grand', key: 'end', label: 'Cash and Cash Equivalents at End of Period', v: endV },
  ];

  const nonCash = unionLines(n, i => I(i).operating.non_cash_adjustments, 'nc', 'operating');
  const wc = unionLines(n, i => I(i).operating.working_capital, 'wc', 'operating');
  const um = unionLines(n, i => I(i).operating.unmapped, 'um', 'operating', true);
  const indirect: CfRow[] = [
    { kind: 'heading', key: 'h-op', label: 'Cash Flows from Operating Activities', v: [], tone: 'operating' },
    { kind: 'line', key: 'np', label: 'Net Profit for the Period', v: map(i => I(i).operating.net_profit), tone: 'operating' },
    ...(nonCash.length ? [{ kind: 'sub' as const, key: 's-nc', label: 'Adjustments for non-cash items:', v: [] }, ...nonCash] : []),
    ...(wc.length ? [{ kind: 'sub' as const, key: 's-wc', label: 'Changes in working capital:', v: [] }, ...wc] : []),
    ...um,
    ...tail(
      unionLines(n, i => I(i).investing.lines, 'inv', 'investing'), unionLines(n, i => I(i).financing.lines, 'fin', 'financing'),
      opInd, investing, financing, net, opening, ending,
    ),
  ];

  const direct: CfRow[] = [
    { kind: 'heading', key: 'h-op', label: 'Cash Flows from Operating Activities', v: [], tone: 'operating' },
    ...unionLines(n, i => D(i).operating.lines, 'dop', 'operating'),
    ...tail(
      unionLines(n, i => D(i).investing.lines, 'dinv', 'investing'), unionLines(n, i => D(i).financing.lines, 'dfin', 'financing'),
      opDir, map(i => D(i).investing.total), map(i => D(i).financing.total), map(i => D(i).net_change), opening, map(i => D(i).ending_cash),
    ),
  ];

  return {
    periods, cols, TOTAL: cols, PREV: cols + 1, LY: cols + 2,
    rows: { direct, indirect },
    operating: { direct: opDir, indirect: opInd },
    investing, financing, net, opening, ending,
    revenue: map(i => ps[i].revenue),
    data,
  };
}

// ── Fetch ────────────────────────────────────────────────────────────

/** Kolom periode + TOTAL + PREV + LY. Hasil `merged` index = urutan itu. */
export function useCfSeries(clientId: string, columns: Period[], from: string, to: string, enabled = true) {
  const all = [...columns.map(c => ({ start: c.start, end: c.end })), { start: from, end: to }, previousRange(from, to), { start: shiftYear(from), end: shiftYear(to) }];
  const key = all.map(p => `${p.start}:${p.end}`).join(',');
  const [state, setState] = useState<{ merged: CfMerged | null; error: string | null }>({ merged: null, error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId || !enabled) return;
    const ctrl = new AbortController();
    setLoading(true);
    const uniq = Array.from(new Map(all.map(p => [`${p.start}:${p.end}`, p])).values());
    fetchCashFlowSeries(clientId, uniq, ctrl.signal)
      .then(data => setState({ merged: mergeSeries(data, all, columns.length), error: null }))
      .catch(e => { if ((e as Error).name !== 'AbortError') setState({ merged: null, error: (e as Error).message }); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, key, enabled]);

  return { ...state, loading };
}

// ── Export ───────────────────────────────────────────────────────────

export function cfReport(m: CfMerged, method: Method, labels: string[], totalLabel: string, opts: {
  companyName: string; subtitle: string; fileBase: string; printedBy?: string; compare?: { label: string; index: number } | null;
}): PrintReport {
  const columns: PrintColumn[] = [{ key: 'desc', header: 'Description', width: 46 }];
  labels.forEach((l, i) => columns.push({ key: `c${i}`, header: l, type: 'money', width: 15 }));
  columns.push({ key: 'tot', header: totalLabel, type: 'money', width: 17 });
  if (opts.compare) {
    columns.push({ key: 'cmp', header: opts.compare.label, type: 'money', width: 17 });
    columns.push({ key: 'var', header: 'Variance', type: 'money', width: 16 });
  }
  const rows: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  const push = (desc: string, v: number[] | null, style?: PrintRowStyle) => {
    const r: PrintRow = { desc };
    labels.forEach((_, i) => { r[`c${i}`] = v ? v[i] : null; });
    r.tot = v ? v[m.TOTAL] : null;
    if (opts.compare) {
      r.cmp = v ? v[opts.compare.index] : null;
      r.var = v ? v[m.TOTAL] - v[opts.compare.index] : null;
    }
    rows.push(r);
    styles.push(style);
  };
  m.rows[method].forEach(row => {
    if (row.kind === 'heading') push(row.label.toUpperCase(), null, 'section');
    else if (row.kind === 'sub') push(`  ${row.label}`, null);
    else if (row.kind === 'total' || row.kind === 'grand') push(row.label, row.v, 'total');
    else {
      push(`  ${row.label}`, row.v);
      row.accounts?.forEach(a => push(`      ${a.code} ${a.name}`, a.v));
    }
  });
  return {
    title: `Cash Flow Statement (${method === 'direct' ? 'Direct' : 'Indirect'} Method)`,
    fileBase: opts.fileBase, companyName: opts.companyName, subtitle: opts.subtitle,
    orientation: 'landscape', printedBy: opts.printedBy, table: { columns, rows, rowStyles: styles },
  };
}
