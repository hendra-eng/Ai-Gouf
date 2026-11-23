'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink } from 'lucide-react';
import { fetchSegments, type SegmentType } from '@/lib/fsStore';
import { fmtAmount, glHref } from '../fsFormat';
import { fmtCompact, pctChange, type MLine, type MSection } from '../bs/bsData';
import { PL_LAYOUT, type PlMerged, type Segment } from './plData';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { Select, trCls } from '../bs/BsMono';

// Potongan UI bersama tampilan Profit & Loss: tabel laporan yang bisa
// dibuka per seksi -> baris -> akun, waterfall bridge, filter segment.
// Tema elegant monokrom (neutral-*) disamakan dengan halaman Sales; merah hanya untuk nilai negatif.

// ── Sel angka ────────────────────────────────────────────────────────

export function Num({ v, bold, className = '' }: { v: number | null; bold?: boolean; className?: string }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <td className={`px-3 py-1.5 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold text-neutral-900' : 'text-neutral-800'} ${v !== null && v < -0.004 ? 'text-red-700' : ''} ${className}`}>
      {fmtAmount(v)}
    </td>
  );
}

/** Persentase perubahan dengan segitiga; `upIsGood=false` untuk beban. */
export function PctCell({ cur, prev, upIsGood = true, className = '' }: { cur: number; prev: number; upIsGood?: boolean; className?: string }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const p = pctChange(cur, prev);
  if (p === null || Math.abs(p) < 0.05) return <td className={`px-3 py-1.5 text-right text-xs tabular-nums text-neutral-500 ${className}`}>{p === null ? '–' : '0.0%'}</td>;
  const good = (p > 0) === upIsGood;
  return (
    <td className={`px-3 py-1.5 text-right text-xs tabular-nums whitespace-nowrap ${good ? 'text-emerald-700' : 'text-red-700'} ${className}`}>
      {p > 0 ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%
    </td>
  );
}

// ── Tabel laporan ────────────────────────────────────────────────────

export interface CellCtx { bold: boolean; upIsGood: boolean; level: 'subtotal' | 'section' | 'line' | 'account' }

/**
 * Tabel P&L mengikuti PL_LAYOUT. `cells(v, ctx)` merender sel nilai untuk
 * satu baris (v = nilai per kolom periode). Seksi terbuka secara default;
 * rincian akun per baris dibuka dengan klik.
 */
export function PlTable({ m, head, cells, colCount, glRange, title, minWidth = 860, compact }: {
  m: PlMerged;
  head: React.ReactNode;
  cells: (v: number[], ctx: CellCtx) => React.ReactNode;
  colCount: number;
  glRange: { start: string; end: string };
  title?: React.ReactNode;
  minWidth?: number;
  compact?: boolean;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  // Posisi awal: semua seksi (Revenue, Cost of Sales, Operating Expenses, ...) tertutup; subtotal tetap tampil.
  const [closed, setClosed] = useState<Set<string>>(() => new Set(PL_LAYOUT.filter(x => x.kind === 'section').map(x => x.key)));
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) => set(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const sections = PL_LAYOUT.filter(x => x.kind === 'section').map(x => m.sec(x.key));
  const allLineKeys = sections.flatMap(s => s.lines.map(l => `${s.key}:${l.key}`));
  const allOpen = openLines.size > 0 && openLines.size >= allLineKeys.length;
  const py = compact ? 'py-2' : 'py-2.5';

  const lineRow = (s: MSection, l: MLine, upIsGood: boolean) => {
    const k = `${s.key}:${l.key}`;
    const open = openLines.has(k);
    return (
      <React.Fragment key={k}>
        <tr className={`${trCls} cursor-pointer`} onClick={() => toggle(setOpenLines, k)}>
          <td className="pl-9 pr-3 py-1.5 whitespace-nowrap text-neutral-800">
            <span className="inline-flex items-center gap-1">
              {open ? <ChevronDown size={13} className="text-neutral-500" /> : <ChevronRight size={13} className="text-neutral-500" />}
              {l.label}
            </span>
          </td>
          {cells(l.v, { bold: false, upIsGood, level: 'line' })}
        </tr>
        {open && l.accounts.map((a, i) => (
          <tr key={`${a.code ?? 'calc'}-${i}`} className={trCls}>
            <td className="pl-14 pr-3 py-1 whitespace-nowrap">
              <span className="inline-flex items-center gap-2 min-w-0 text-neutral-500">
                {a.code ? <span className="font-mono text-[11px]">{kodeAkun(a.code)}</span> : <span className="rounded bg-neutral-200 px-1.5 text-[10px] font-semibold uppercase text-neutral-700">Auto</span>}
                <span className="truncate">{a.name}</span>
                {a.code && (
                  <Link href={glHref(a.code, glRange.start, glRange.end)} target="_blank" title="Open in General Ledger" onClick={e => e.stopPropagation()} className="hover:text-neutral-900">
                    <ExternalLink size={12} />
                  </Link>
                )}
              </span>
            </td>
            {cells(a.v, { bold: false, upIsGood, level: 'account' })}
          </tr>
        ))}
      </React.Fragment>
    );
  };

  return (
    <section className={`card-elevated-md rounded-xl ${salesFont.className}`}>
      <header className="flex items-center gap-3 px-5 pt-4 pb-1">
        {title}
        <button type="button" onClick={() => setOpenLines(allOpen ? new Set() : new Set(allLineKeys))}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 print:hidden">
          {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {allOpen ? 'Collapse accounts' : 'Expand accounts'}
        </button>
      </header>
      <div className="overflow-x-auto scrollbar-thin p-3 pt-2">
        <table className="w-full border-separate border-spacing-0 text-xs" style={{ minWidth }}>
          <thead>{head}</thead>
          <tbody>
            {PL_LAYOUT.map(item => {
              if (item.kind === 'subtotal') {
                return (
                  <tr key={item.key} className="text-xs [&>td]:bg-neutral-200 [&>td]:shadow-[inset_0_-1px_0_#171717,inset_0_1px_0_#171717]">
                    <td className={`px-3 ${py} whitespace-nowrap font-bold text-neutral-900`}>{item.label}</td>
                    {cells(m.sub(item.key), { bold: true, upIsGood: true, level: 'subtotal' })}
                  </tr>
                );
              }
              const s = m.sec(item.key);
              const open = !closed.has(item.key);
              return (
                <React.Fragment key={item.key}>
                  <tr className={`${trCls} cursor-pointer`} onClick={() => toggle(setClosed, item.key)}>
                    <td className={`px-3 ${py} whitespace-nowrap font-semibold text-neutral-900`}>
                      <span className="inline-flex items-center gap-1.5">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}{item.label}</span>
                    </td>
                    {cells(s.v, { bold: true, upIsGood: item.upIsGood, level: 'section' })}
                  </tr>
                  {open && s.lines.length === 0 && (
                    <tr><td colSpan={colCount + 1} className="pl-12 py-1.5 text-xs italic text-neutral-500">No transactions</td></tr>
                  )}
                  {open && s.lines.map(l => lineRow(s, l, item.upIsGood))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ── Waterfall (bridge) ───────────────────────────────────────────────

export interface BridgeStep { name: string; delta: number }

// Warna chart (biru): awal = biru muda, naik = biru, turun = merah lembut, akhir = biru tua.
export const PL_BLUE = { start: '#BFDBFE', up: '#3B82F6', down: '#F87171', end: '#1D4ED8' };

// Label sumbu-X: nama langkah diringkas (kamus + singkatan), lalu dipecah maks 2 baris @ 9 karakter
// supaya tidak bertabrakan. Nama lengkap tetap muncul saat hover.
const BR_MAX_CHARS = 9;
const BR_SHORT: Record<string, string> = {
  'revenue': 'Revenue', 'cost of sales': 'Cost of Sales', 'operating expenses': 'OpEx', 'other income': 'Other Inc.',
  'income tax': 'Tax', 'gross profit': 'Gross Profit', 'net profit': 'Net Profit',
};
const BR_ABBR: [RegExp, string][] = [
  [/\bOperating\b/gi, 'Oper.'], [/\bExpenses?\b/gi, 'Exp.'], [/\bAdministration\b/gi, 'Admin'],
  [/\bDepreciation\b/gi, 'Depr.'], [/\bAmortization\b/gi, 'Amort.'], [/\bReceivables?\b/gi, 'A/R'], [/\bPayables?\b/gi, 'A/P'],
  [/\s*&\s*/g, ' '], [/\band\b/gi, ' '],
];
function brShortLabel(text: string): string {
  const base = text.trim().replace(/\s+(Increase|Decrease)$/i, '');
  const hit = BR_SHORT[base.toLowerCase()];
  if (hit) return hit;
  return BR_ABBR.reduce((acc, [re, to]) => acc.replace(re, to), base).replace(/\s+/g, ' ').trim();
}
function brWrapLabel(text: string): string[] {
  const clip = (t: string) => (t.length > BR_MAX_CHARS ? `${t.slice(0, BR_MAX_CHARS - 1)}…` : t);
  const lines: string[] = [];
  let cur = '';
  for (const w of brShortLabel(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= BR_MAX_CHARS) { cur = next; continue; }
    if (cur) lines.push(cur);
    cur = w;
  }
  if (cur) lines.push(cur);
  if (lines.length > 2) return [clip(lines[0]), clip(lines.slice(1).join(' '))];
  return lines.map(clip);
}
function BridgeTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const full = String(payload?.value ?? '');
  const lines = brWrapLabel(full);
  return (
    <text x={x} y={(y ?? 0) + 10} textAnchor="middle" fontSize={10} fill="#737373">
      <title>{full}</title>
      {lines.map((ln, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : 11}>{ln}</tspan>)}
    </text>
  );
}

/** Grafik jembatan: nilai awal -> langkah (naik biru / turun merah) -> nilai akhir. Batang melayang [bawah, atas]. */
export function Bridge({ startLabel, start, steps, endLabel, end, height = 200 }: {
  startLabel: string; start: number; steps: BridgeStep[]; endLabel: string; end: number; height?: number;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  type Bar = { name: string; range: [number, number]; fill: string; label: string; up?: boolean };
  let run = start;
  const bars: Bar[] = [{ name: startLabel, range: [Math.min(0, start), Math.max(0, start)], fill: PL_BLUE.start, label: fmtCompact(start, 1) }];
  steps.filter(s => Math.abs(s.delta) >= 0.5).forEach(s => {
    const lo = s.delta >= 0 ? run : run + s.delta;
    bars.push({ name: s.name, range: [lo, lo + Math.abs(s.delta)], up: s.delta >= 0, fill: s.delta >= 0 ? PL_BLUE.up : PL_BLUE.down, label: `${s.delta >= 0 ? '+' : '-'}${fmtCompact(Math.abs(s.delta), 1)}` });
    run += s.delta;
  });
  bars.push({ name: endLabel, range: [Math.min(0, end), Math.max(0, end)], fill: PL_BLUE.end, label: fmtCompact(end, 1) });

  const levels = bars.flatMap(b => b.range);
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.05 || 1;
  const domain: [number, number] = [lo < 0 ? lo - pad * 0.3 : 0, hi + pad * 0.4];
  // Selisih sangat kecil diberi tinggi minimum ~4% sumbu agar tetap terlihat (hanya gambar; label tetap nilai asli).
  const minH = (domain[1] - domain[0]) * 0.04;
  const data = bars.map(b => {
    if (b.up === undefined || b.range[1] - b.range[0] >= minH) return b;
    const range: [number, number] = b.up ? [b.range[0], b.range[0] + minH] : [b.range[1] - minH, b.range[1]];
    return { ...b, range };
  });

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="name" tick={<BridgeTick />} interval={0} tickLine={false} axisLine={false} height={34} />
          <YAxis hide domain={domain} allowDataOverflow />
          <Bar dataKey="range" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((b, i) => <Cell key={i} fill={b.fill} />)}
            <LabelList dataKey="label" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#262626' }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Langkah bridge laba antara kolom `from` -> `to` (efek ke laba: beban naik = negatif). */
export function profitSteps(m: PlMerged, from: number, to: number, upTo: 'gross_profit' | 'operating_profit' | 'net_profit'): BridgeStep[] {
  const d = (v: number[]) => v[to] - v[from];
  const word = (x: number, up: string, down: string) => (x >= 0 ? up : down);
  const steps: BridgeStep[] = [];
  const dr = d(m.revenue);
  steps.push({ name: `Revenue ${word(dr, 'Increase', 'Decrease')}`, delta: dr });
  const dc = d(m.cogs);
  steps.push({ name: `Cost of Sales ${word(dc, 'Increase', 'Decrease')}`, delta: -dc });
  if (upTo === 'gross_profit') return steps;
  const dox = d(m.opex);
  steps.push({ name: `Operating Expenses ${word(dox, 'Increase', 'Decrease')}`, delta: -dox });
  if (upTo === 'operating_profit') return steps;
  const don = d(m.otherNet);
  steps.push({ name: `Other Income ${word(don, 'Increase', 'Decrease')}`, delta: don });
  const dt = d(m.tax);
  steps.push({ name: `Income Tax ${word(dt, 'Increase', 'Decrease')}`, delta: -dt });
  return steps;
}

// ── Insight bernomor ─────────────────────────────────────────────────

export function NumberedInsights({ items }: { items: string[] }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <ol className="space-y-3">
      {items.map((t, i) => (
        <li key={i} className="flex gap-3 text-sm font-medium leading-snug text-neutral-800">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold text-white">{i + 1}</span>
          <span>{t}</span>
        </li>
      ))}
    </ol>
  );
}

// ── Filter segment ───────────────────────────────────────────────────

/** Pilih segment (branch / cost center / project ...) -- berlaku untuk semua tampilan. */
export function SegmentFilter({ clientId, value, onChange }: { clientId: string; value: Segment | null; onChange: (s: Segment | null) => void }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const [types, setTypes] = useState<SegmentType[]>([]);
  const [type, setType] = useState(value?.type ?? '');

  useEffect(() => {
    setTypes([]);
    if (clientId) fetchSegments(clientId).then(d => setTypes(d.types)).catch(() => setTypes([]));
  }, [clientId]);

  const values = types.find(t => t.key === type)?.values ?? [];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-neutral-600">Segment</span>
      <div className="w-40">
        <Select value={type} onChange={v => { setType(v); if (!v) onChange(null); }}>
          <option value="">All segments</option>
          {types.map(t => <option key={t.key} value={t.key} disabled={t.values.length === 0}>{t.label}{t.values.length === 0 ? ' (no data)' : ''}</option>)}
        </Select>
      </div>
      {type && (
        <div className="w-44">
          <Select value={value?.type === type ? value.value : ''} onChange={v => onChange(v ? { type, value: v } : null)}>
            <option value="">Choose…</option>
            {values.map(v => <option key={v} value={v}>{v}</option>)}
          </Select>
        </div>
      )}
    </div>
  );
}

// ── Kartu KPI ────────────────────────────────────────────────────────
// Desain sama dengan kartu KPI di Sales Overview (OverviewKpiTile): garis
// aksen atas, label kapital, kotak ikon, nilai, baris sub (badge perubahan),
// progress bar proporsi + keterangan persen. Monokrom, hover border gelap.

export { Delta as KpiDelta } from '../bs/BsMono';

/** n / d dalam persen; null kalau pembanding tidak positif. */
export const ratioPct = (n: number, d: number): number | null => (d > 0.004 ? (n / d) * 100 : null);

export function PlKpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{children}</div>;
}

export function PlKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  pct: number | null;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const raw = pct !== null && Number.isFinite(pct) ? pct : 0;
  const bar = Math.min(100, Math.max(0, Math.round(raw)));
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={typeof value === 'string' ? value : undefined}>{value}</p>
      <div className="relative flex h-4 items-center overflow-hidden whitespace-nowrap">{sub ?? '\u00A0'}</div>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${bar > 0 ? Math.max(bar, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{pct === null ? '–' : `${Math.round(raw)}%`} {pctLabel}</p>
    </div>
  );
}