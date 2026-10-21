'use client';

// Global "periode aktif" (filter periode di Topbar).
//
// Sebelumnya pilihan periode di Topbar cuma useState lokal berisi 4 periode
// hardcode (YTD / Q2 / Q1 / FY 2025) dan tidak dibaca halaman mana pun.
// Sekarang periode disimpan di context ini (dipasang sekali di AppLayout,
// sama seperti ActiveClientProvider) supaya halaman bisa membacanya lewat
// useActivePeriod() -> { start, end } (ISO yyyy-mm-dd, inklusif).
//
// Preset dihitung relatif ke HARI INI (minggu = Senin-Minggu). Pilihan
// sengaja TIDAK disimpan ke localStorage (sama seperti client aktif):
// setiap tab/refresh mulai lagi dari default Year to Date.
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type PeriodPreset =
  | 'today' | 'yesterday'
  | 'this_week' | 'last_week'
  | 'this_month' | 'last_month'
  | 'this_quarter' | 'last_quarter'
  | 'ytd' | 'this_year' | 'last_year'
  | 'custom';

export interface ActivePeriod {
  preset: PeriodPreset;
  start: string;   // yyyy-mm-dd
  end: string;     // yyyy-mm-dd (inklusif)
  /** Teks pendek: "This Month", "Custom". */
  label: string;
  /** Rentang tanggal: "01 Oct 2026 – 31 Oct 2026". */
  range: string;
}

export const PERIOD_GROUPS: { title: string; presets: { key: Exclude<PeriodPreset, 'custom'>; label: string }[] }[] = [
  { title: 'Day', presets: [{ key: 'today', label: 'Today' }, { key: 'yesterday', label: 'Yesterday' }] },
  { title: 'Week', presets: [{ key: 'this_week', label: 'This Week' }, { key: 'last_week', label: 'Last Week' }] },
  { title: 'Month', presets: [{ key: 'this_month', label: 'This Month' }, { key: 'last_month', label: 'Last Month' }] },
  { title: 'Quarter', presets: [{ key: 'this_quarter', label: 'This Quarter' }, { key: 'last_quarter', label: 'Last Quarter' }] },
  {
    title: 'Year',
    presets: [{ key: 'ytd', label: 'Year to Date' }, { key: 'this_year', label: 'This Year' }, { key: 'last_year', label: 'Last Year' }],
  },
];

const LABEL: Record<PeriodPreset, string> = {
  ...Object.fromEntries(PERIOD_GROUPS.flatMap(g => g.presets.map(p => [p.key, p.label]))),
  custom: 'Custom',
} as Record<PeriodPreset, string>;

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function formatPeriodDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')} ${BULAN[m - 1]} ${y}`;
}

export function formatPeriodRange(start: string, end: string): string {
  return start === end ? formatPeriodDate(start) : `${formatPeriodDate(start)} – ${formatPeriodDate(end)}`;
}

/** Rentang tanggal sebuah preset, relatif ke `today`. */
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: Date = new Date()): { start: string; end: string } {
  const y = today.getFullYear();
  const m = today.getMonth();
  const tgl = (yy: number, mm: number, dd: number) => toIso(new Date(yy, mm, dd));
  const hariIni = tgl(y, m, today.getDate());
  // Senin minggu ini (getDay: 0 = Minggu).
  const senin = new Date(y, m, today.getDate() - ((today.getDay() + 6) % 7));
  const geser = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const q = Math.floor(m / 3);
  switch (preset) {
    case 'today': return { start: hariIni, end: hariIni };
    case 'yesterday': { const k = tgl(y, m, today.getDate() - 1); return { start: k, end: k }; }
    case 'this_week': return { start: toIso(senin), end: toIso(geser(senin, 6)) };
    case 'last_week': return { start: toIso(geser(senin, -7)), end: toIso(geser(senin, -1)) };
    case 'this_month': return { start: tgl(y, m, 1), end: tgl(y, m + 1, 0) };
    case 'last_month': return { start: tgl(y, m - 1, 1), end: tgl(y, m, 0) };
    case 'this_quarter': return { start: tgl(y, q * 3, 1), end: tgl(y, q * 3 + 3, 0) };
    case 'last_quarter': return { start: tgl(y, q * 3 - 3, 1), end: tgl(y, q * 3, 0) };
    case 'ytd': return { start: tgl(y, 0, 1), end: hariIni };
    case 'this_year': return { start: tgl(y, 0, 1), end: tgl(y, 11, 31) };
    case 'last_year': return { start: tgl(y - 1, 0, 1), end: tgl(y - 1, 11, 31) };
  }
}

function buatPeriode(preset: PeriodPreset, start: string, end: string): ActivePeriod {
  return { preset, start, end, label: LABEL[preset], range: formatPeriodRange(start, end) };
}

interface ActivePeriodContextValue {
  period: ActivePeriod;
  setPreset: (preset: Exclude<PeriodPreset, 'custom'>) => void;
  /** Rentang bebas; start/end otomatis ditukar kalau terbalik. */
  setCustom: (start: string, end: string) => void;
}

const ActivePeriodContext = createContext<ActivePeriodContextValue | null>(null);

export function ActivePeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<ActivePeriod>(() => {
    const r = presetRange('ytd');
    return buatPeriode('ytd', r.start, r.end);
  });

  const setPreset = useCallback((preset: Exclude<PeriodPreset, 'custom'>) => {
    const r = presetRange(preset);
    setPeriod(buatPeriode(preset, r.start, r.end));
  }, []);

  const setCustom = useCallback((start: string, end: string) => {
    const [a, b] = start <= end ? [start, end] : [end, start];
    setPeriod(buatPeriode('custom', a, b));
  }, []);

  const value = useMemo(() => ({ period, setPreset, setCustom }), [period, setPreset, setCustom]);
  return <ActivePeriodContext.Provider value={value}>{children}</ActivePeriodContext.Provider>;
}

export function useActivePeriod(): ActivePeriodContextValue {
  const ctx = useContext(ActivePeriodContext);
  if (!ctx) throw new Error('useActivePeriod must be used inside ActivePeriodProvider');
  return ctx;
}
