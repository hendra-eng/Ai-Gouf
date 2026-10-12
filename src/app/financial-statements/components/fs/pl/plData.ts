'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { fetchProfitLossSeries, type PlReport, type ProfitLossSeries } from '@/lib/fsStore';
import { iso, monthEnd, parts, type MAccount, type MLine, type MSection } from '../bs/bsData';

// Data bersama 4 tampilan Profit & Loss (default / trend / comparison /
// gross vs net profit). Semua tampilan memakai 1 panggilan
// /profit-loss/series (banyak periode), lalu laporannya digabung jadi
// struktur seksi -> baris -> akun dengan nilai per kolom (index = urutan periode).

export const PL_COLORS = { revenue: '#22C55E', brand: '#0F7D4E', expense: '#F43F5E', profit: '#8B5CF6', amber: '#F59E0B', sky: '#0EA5E9', muted: '#94A3B8' };

export interface Period { start: string; end: string }
export interface Segment { type: string; value: string }

export interface ViewProps {
  clientId: string;
  segment: Segment | null;
  printedBy?: string;
  /** Filter bersama (segment) yang ditaruh di toolbar tiap tampilan. */
  filters?: ReactNode;
}

// ── Periode ──────────────────────────────────────────────────────────

export const monthPeriod = (y: number, m: number): Period => {
  const end = monthEnd(y, m);
  const [yy, mm] = parts(end);
  return { start: iso(yy, mm, 1), end };
};
export const quarterPeriod = (y: number, q: number): Period => ({ start: iso(y, q * 3 - 2, 1), end: monthEnd(y, q * 3) });
export const yearPeriod = (y: number): Period => ({ start: iso(y, 1, 1), end: iso(y, 12, 31) });

/** "2026-08" -> [2026, 8] */
export const ym = (s: string): [number, number] => { const [y, m] = s.split('-').map(Number); return [y, m]; };

export function monthName(y: number, m: number, style: 'short' | 'long' = 'short'): string {
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: style, year: 'numeric' });
}

// ── Gabungan laporan ─────────────────────────────────────────────────

export type SubKey = 'gross_profit' | 'operating_profit' | 'profit_before_tax' | 'net_profit';

/** Urutan baris laporan. `upIsGood=false` untuk beban (naik = merah). */
export const PL_LAYOUT: ({ kind: 'section'; key: string; label: string; upIsGood: boolean } | { kind: 'subtotal'; key: SubKey; label: string })[] = [
  { kind: 'section', key: 'revenue', label: 'Revenue', upIsGood: true },
  { kind: 'section', key: 'cost_of_sales', label: 'Cost of Sales', upIsGood: false },
  { kind: 'subtotal', key: 'gross_profit', label: 'Gross Profit' },
  { kind: 'section', key: 'operating_expenses', label: 'Operating Expenses', upIsGood: false },
  { kind: 'subtotal', key: 'operating_profit', label: 'Operating Profit' },
  { kind: 'section', key: 'other_net', label: 'Other Income / (Expense)', upIsGood: true },
  { kind: 'subtotal', key: 'profit_before_tax', label: 'Profit Before Tax' },
  { kind: 'section', key: 'income_tax', label: 'Income Tax Expense', upIsGood: false },
  { kind: 'subtotal', key: 'net_profit', label: 'Net Profit' },
];

export interface PlMerged {
  periods: Period[];
  sec: (key: string) => MSection;
  sub: (key: SubKey) => number[];
  revenue: number[];
  cogs: number[];
  opex: number[];
  otherIncome: number[];
  otherExpense: number[];
  /** other income - other expense */
  otherNet: number[];
  tax: number[];
  grossProfit: number[];
  operatingProfit: number[];
  pbt: number[];
  netProfit: number[];
  /** COGS + OpEx */
  expenses: number[];
}

const neg = (v: number[]) => v.map(x => -x);

export function mergeReports(reports: PlReport[], periods: Period[]): PlMerged {
  const n = reports.length;
  const zeros = () => new Array<number>(n).fill(0);
  const secMap = new Map<string, MSection>();
  const subMap = new Map<string, number[]>();
  reports.forEach((r, i) => {
    r.rows.forEach(row => {
      if (row.type === 'subtotal') {
        if (!subMap.has(row.key)) subMap.set(row.key, zeros());
        subMap.get(row.key)![i] = row.amount;
        return;
      }
      let ms = secMap.get(row.key);
      if (!ms) { ms = { key: row.key, label: row.label, v: zeros(), lines: [] }; secMap.set(row.key, ms); }
      ms.v[i] = row.total;
      row.lines.forEach(l => {
        let ml = ms!.lines.find(x => x.key === l.key);
        if (!ml) { ml = { key: l.key, label: l.label, v: zeros(), accounts: [] }; ms!.lines.push(ml); }
        ml.v[i] = l.amount;
        l.accounts.forEach(a => {
          const id = a.code ?? `~${a.name}`;
          let ma = ml!.accounts.find(x => (x.code ?? `~${x.name}`) === id);
          if (!ma) { ma = { code: a.code, name: a.name, computed: a.computed, v: zeros() }; ml!.accounts.push(ma); }
          ma.v[i] = a.amount;
        });
      });
    });
  });
  secMap.forEach(s => s.lines.forEach(l => l.accounts.sort((a, b) => (a.code ?? '').localeCompare(b.code ?? ''))));

  const empty = (key: string, label = ''): MSection => ({ key, label, v: zeros(), lines: [] });
  const raw = (key: string) => secMap.get(key) ?? empty(key);

  // Seksi gabungan "Other Income / (Expense)": beban lain ditampilkan negatif.
  const oi = raw('other_income'), oe = raw('other_expense');
  const negLine = (l: MLine): MLine => ({ ...l, key: `x_${l.key}`, v: neg(l.v), accounts: l.accounts.map((a: MAccount) => ({ ...a, v: neg(a.v) })) });
  const otherNetSec: MSection = {
    key: 'other_net', label: 'Other Income / (Expense)',
    v: oi.v.map((x, i) => x - oe.v[i]),
    lines: [...oi.lines, ...oe.lines.map(negLine)],
  };

  const sec = (key: string) => {
    if (key === 'other_net') return otherNetSec;
    const s = raw(key);
    const lay = PL_LAYOUT.find(x => x.key === key);
    return { ...s, label: lay?.label ?? s.label };
  };
  const sub = (key: SubKey) => subMap.get(key) ?? zeros();
  const cogs = raw('cost_of_sales').v, opex = raw('operating_expenses').v;
  return {
    periods,
    sec,
    sub,
    revenue: raw('revenue').v,
    cogs,
    opex,
    otherIncome: oi.v,
    otherExpense: oe.v,
    otherNet: otherNetSec.v,
    tax: raw('income_tax').v,
    grossProfit: sub('gross_profit'),
    operatingProfit: sub('operating_profit'),
    pbt: sub('profit_before_tax'),
    netProfit: sub('net_profit'),
    expenses: cogs.map((x, i) => x + opex[i]),
  };
}

/** Baris terbesar penyebab perubahan antara kolom `from` -> `to` di seksi tertentu. */
export function plMovers(m: PlMerged, sectionKeys: string[], from: number, to: number, limit = 3) {
  const all = sectionKeys.flatMap(k => m.sec(k).lines.map(l => ({ label: l.label, delta: l.v[to] - l.v[from] })));
  return all.filter(x => Math.abs(x.delta) >= 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}

export const margin = (part: number, revenue: number): number | null => (Math.abs(revenue) < 0.005 ? null : (part / revenue) * 100);

// ── Fetch ────────────────────────────────────────────────────────────

/**
 * Ambil laporan untuk `periods` (boleh duplikat / tidak urut). Hasil `merged`
 * mengikuti urutan `periods` persis, jadi index kolom = index periode.
 */
export function usePlSeries(clientId: string | null, periods: Period[], segment: Segment | null, enabled = true) {
  const key = `${periods.map(p => `${p.start}:${p.end}`).join(',')}|${segment?.type ?? ''}=${segment?.value ?? ''}`;
  const [state, setState] = useState<{ key: string; data: ProfitLossSeries | null; merged: PlMerged | null; error: string | null }>({ key: '', data: null, merged: null, error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId || !enabled || !periods.length) return;
    const ctrl = new AbortController();
    setLoading(true);
    const uniq = Array.from(new Map(periods.map(p => [`${p.start}:${p.end}`, p])).values());
    fetchProfitLossSeries(clientId, uniq, segment, ctrl.signal)
      .then(data => {
        const byKey = new Map(data.reports.map(r => [`${r.period.start}:${r.period.end}`, r]));
        const ordered = periods.map(p => byKey.get(`${p.start}:${p.end}`)!);
        if (ordered.some(r => !r)) throw new Error('Incomplete profit & loss series response.');
        setState({ key, data, merged: mergeReports(ordered, periods), error: null });
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') setState({ key, data: null, merged: null, error: (e as Error).message }); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, key, enabled]);

  return { ...state, loading };
}
