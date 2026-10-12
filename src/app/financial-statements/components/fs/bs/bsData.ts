'use client';

import { useEffect, useState } from 'react';
import { fetchBalanceSheetSeries, type BalanceSheetSeries, type BsSnapshot } from '@/lib/fsStore';

// Data bersama 4 tampilan Balance Sheet (default / trend / comparison /
// assets vs liabilities). Semua tampilan memakai 1 panggilan
// /balance-sheet/series (banyak tanggal), lalu snapshot-nya digabung jadi
// struktur seksi -> baris -> akun dengan nilai per kolom (index = urutan tanggal).

export const BS_COLORS = { assets: '#0F7D4E', assetsSoft: '#22C55E', liabilities: '#F43F5E', equity: '#8B5CF6', muted: '#CBD5E1' };

export const ASSET_SECTIONS = ['current_assets', 'non_current_assets'];
export const LIAB_SECTIONS = ['current_liabilities', 'non_current_liabilities'];

// ── Tanggal ──────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
export const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const daysIn = (y: number, m: number) => new Date(y, m, 0).getDate();

export function monthEnd(y: number, m: number): string {
  while (m < 1) { m += 12; y -= 1; }
  while (m > 12) { m -= 12; y += 1; }
  return iso(y, m, daysIn(y, m));
}

export function parts(d: string): [number, number, number] {
  const [y, m, dd] = d.split('-').map(Number);
  return [y, m, dd];
}

/** Akhir bulan sebelumnya dari tanggal `d`. */
export const prevMonthEnd = (d: string) => { const [y, m] = parts(d); return monthEnd(y, m - 1); };

/** Tanggal yang sama tahun lalu (29 Feb -> 28 Feb). */
export function shiftYear(d: string, n = -1): string {
  const [y, m, dd] = parts(d);
  return iso(y + n, m, Math.min(dd, daysIn(y + n, m)));
}

export const yearEnd = (y: number) => iso(y, 12, 31);

/** Tanggal masa depan dipotong ke hari ini (laporan "to date"). */
export function capToday(d: string, today: string): string {
  return d > today ? today : d;
}

export function monthLabel(d: string, withYear = true): string {
  const [y, m] = parts(d);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

// ── Format ───────────────────────────────────────────────────────────

/** 12.450.320.000 -> "12.45B"; 340.100.000 -> "340.1M". */
export function fmtCompact(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined) return '–';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

/** Jutaan: 11.050.000.000 -> "11.050M". */
export function fmtMillions(n: number): string {
  if (Math.abs(n) < 0.005) return '–';
  const s = Math.abs(Math.round(n / 1e6)).toLocaleString('id-ID');
  return n < 0 ? `(${s}M)` : `${s}M`;
}

export function pctChange(cur: number, prev: number | null | undefined): number | null {
  if (prev === null || prev === undefined || Math.abs(prev) < 0.005) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

// ── Gabungan snapshot ────────────────────────────────────────────────

export interface MAccount { code: string | null; name: string; computed?: boolean; v: number[] }
export interface MLine { key: string; label: string; v: number[]; accounts: MAccount[] }
export interface MSection { key: string; label: string; v: number[]; lines: MLine[] }

export interface Merged {
  dates: string[];
  sections: MSection[];
  sec: (key: string) => MSection;
  assets: number[];
  liabilities: number[];
  equity: number[];
  le: number[];
  workingCapital: number[];
  /** CA / CL; null kalau CL nol. */
  currentRatio: (number | null)[];
}

export function mergeSnapshots(snaps: BsSnapshot[]): Merged {
  const n = snaps.length;
  const zeros = () => new Array<number>(n).fill(0);
  const sections: MSection[] = [];
  const secMap = new Map<string, MSection>();
  snaps.forEach((s, i) => {
    s.sections.forEach(sec => {
      let ms = secMap.get(sec.key);
      if (!ms) { ms = { key: sec.key, label: sec.label, v: zeros(), lines: [] }; secMap.set(sec.key, ms); sections.push(ms); }
      ms.v[i] = sec.total;
      sec.lines.forEach(l => {
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
  sections.forEach(s => s.lines.forEach(l => l.accounts.sort((a, b) => (a.code === null ? 1 : 0) - (b.code === null ? 1 : 0) || (a.code ?? '').localeCompare(b.code ?? ''))));
  const empty: MSection = { key: '', label: '', v: zeros(), lines: [] };
  const sec = (key: string) => secMap.get(key) ?? { ...empty, key };
  const assets = snaps.map(s => s.totals.assets);
  const liabilities = snaps.map(s => s.totals.liabilities);
  const equity = snaps.map(s => s.totals.equity);
  const ca = sec('current_assets').v;
  const cl = sec('current_liabilities').v;
  return {
    dates: snaps.map(s => s.as_of),
    sections,
    sec,
    assets,
    liabilities,
    equity,
    le: snaps.map(s => s.totals.liabilities_and_equity),
    workingCapital: ca.map((v, i) => v - cl[i]),
    currentRatio: ca.map((v, i) => (Math.abs(cl[i]) < 0.005 ? null : v / cl[i])),
  };
}

/** Baris terbesar penyebab perubahan antara kolom `from` -> `to` di seksi tertentu. */
export function topMovers(m: Merged, sectionKeys: string[], from: number, to: number, limit = 3) {
  const all = sectionKeys.flatMap(k => m.sec(k).lines.map(l => ({ label: l.label, delta: l.v[to] - l.v[from] })));
  return all.filter(x => Math.abs(x.delta) >= 0.5).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}

// ── Fetch ────────────────────────────────────────────────────────────

/**
 * Ambil snapshot untuk `dates` (boleh duplikat / tidak urut). Hasil `merged`
 * mengikuti urutan `dates` persis, jadi index kolom = index tanggal.
 */
export function useBsSeries(clientId: string | null, dates: string[], enabled = true) {
  const key = dates.join(',');
  const [state, setState] = useState<{ key: string; data: BalanceSheetSeries | null; merged: Merged | null; error: string | null }>({ key: '', data: null, merged: null, error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId || !enabled || !dates.length) return;
    const ctrl = new AbortController();
    setLoading(true);
    fetchBalanceSheetSeries(clientId, Array.from(new Set(dates)), ctrl.signal)
      .then(data => {
        const byDate = new Map(data.snapshots.map(s => [s.as_of, s]));
        const ordered = dates.map(d => byDate.get(d)!).filter(Boolean);
        setState({ key, data, merged: mergeSnapshots(ordered), error: null });
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') setState({ key, data: null, merged: null, error: (e as Error).message }); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, key, enabled]);

  return { ...state, loading };
}
