'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink } from 'lucide-react';
import { fetchSegments, type SegmentType } from '@/lib/fsStore';
import { Select } from '../PeriodPicker';
import { fmtAmount, glHref } from '../fsFormat';
import { fmtCompact, pctChange, type MLine, type MSection } from '../bs/bsData';
import { PL_COLORS, PL_LAYOUT, type PlMerged, type Segment } from './plData';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Potongan UI bersama tampilan Profit & Loss: tabel laporan yang bisa
// dibuka per seksi -> baris -> akun, waterfall bridge, filter segment.
// Warna mengikuti tema hijau ([[project-green-theme]]): blue-* = brand hijau.

// ── Sel angka ────────────────────────────────────────────────────────

export function Num({ v, bold, className = '' }: { v: number | null; bold?: boolean; className?: string }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold' : ''} ${v !== null && v < -0.004 ? 'text-rose-600' : ''} ${className}`}>
      {fmtAmount(v)}
    </td>
  );
}

/** Persentase perubahan dengan segitiga; `upIsGood=false` untuk beban. */
export function PctCell({ cur, prev, upIsGood = true, className = '' }: { cur: number; prev: number; upIsGood?: boolean; className?: string }) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const p = pctChange(cur, prev);
  if (p === null || Math.abs(p) < 0.05) return <td className={`px-3 py-2 text-right text-xs tabular-nums text-muted-foreground ${className}`}>{p === null ? '–' : '0.0%'}</td>;
  const good = (p > 0) === upIsGood;
  return (
    <td className={`px-3 py-2 text-right text-xs font-medium tabular-nums whitespace-nowrap ${good ? 'text-emerald-600' : 'text-rose-600'} ${className}`}>
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
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [openLines, setOpenLines] = useState<Set<string>>(new Set());
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) => set(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const sections = PL_LAYOUT.filter(x => x.kind === 'section').map(x => m.sec(x.key));
  const allLineKeys = sections.flatMap(s => s.lines.map(l => `${s.key}:${l.key}`));
  const allOpen = openLines.size > 0 && openLines.size >= allLineKeys.length;
  const py = compact ? 'py-1.5' : 'py-2.5';

  const lineRow = (s: MSection, l: MLine, upIsGood: boolean) => {
    const k = `${s.key}:${l.key}`;
    const open = openLines.has(k);
    return (
      <React.Fragment key={k}>
        <tr className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer text-[13px]" onClick={() => toggle(setOpenLines, k)}>
          <td className="pl-10 pr-3 py-1.5 text-foreground/85">
            <span className="inline-flex items-center gap-1">
              {open ? <ChevronDown size={13} className="text-muted-foreground" /> : <ChevronRight size={13} className="text-muted-foreground" />}
              {l.label}
            </span>
          </td>
          {cells(l.v, { bold: false, upIsGood, level: 'line' })}
        </tr>
        {open && l.accounts.map((a, i) => (
          <tr key={`${a.code ?? 'calc'}-${i}`} className="text-[12px] hover:bg-slate-50">
            <td className="pl-16 pr-3 py-1">
              <span className="inline-flex items-center gap-2 min-w-0 text-muted-foreground">
                {a.code && <span className="font-mono text-[11px]">{kodeAkun(a.code)}</span>}
                <span className="truncate">{a.name}</span>
                {a.code && (
                  <Link href={glHref(a.code, glRange.start, glRange.end)} target="_blank" title="Open in General Ledger" onClick={e => e.stopPropagation()} className="hover:text-blue-700">
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
    <section className="bg-white border border-border rounded-2xl shadow-sm">
      <div className="flex items-center gap-3 px-5 pt-4 pb-1">
        {title}
        <button type="button" onClick={() => setOpenLines(allOpen ? new Set() : new Set(allLineKeys))}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-slate-50 print:hidden">
          {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {allOpen ? 'Collapse accounts' : 'Expand accounts'}
        </button>
      </div>
      <div className="overflow-x-auto scrollbar-thin p-3 pt-2">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead>{head}</thead>
          <tbody>
            {PL_LAYOUT.map(item => {
              if (item.kind === 'subtotal') {
                return (
                  <tr key={item.key} className="bg-blue-50/80 border-t border-white">
                    <td className={`px-3 ${py} font-bold text-blue-800 rounded-l-lg`}>{item.label}</td>
                    {cells(m.sub(item.key), { bold: true, upIsGood: true, level: 'subtotal' })}
                  </tr>
                );
              }
              const s = m.sec(item.key);
              const open = !closed.has(item.key);
              return (
                <React.Fragment key={item.key}>
                  <tr className="border-t border-slate-200 cursor-pointer hover:bg-slate-50" onClick={() => toggle(setClosed, item.key)}>
                    <td className={`px-3 ${py} font-semibold text-foreground`}>
                      <span className="inline-flex items-center gap-1.5">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}{item.label}</span>
                    </td>
                    {cells(s.v, { bold: true, upIsGood: item.upIsGood, level: 'section' })}
                  </tr>
                  {open && s.lines.length === 0 && (
                    <tr><td colSpan={colCount + 1} className="pl-10 py-1.5 text-xs italic text-muted-foreground">No transactions</td></tr>
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

/** Grafik jembatan: nilai awal -> langkah (+ hijau / - merah) -> nilai akhir. */
export function Bridge({ startLabel, start, steps, endLabel, end, height = 190 }: {
  startLabel: string; start: number; steps: BridgeStep[]; endLabel: string; end: number; height?: number;
}) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  let run = start;
  const bars = [{ name: startLabel, base: Math.min(0, start), value: Math.abs(start), fill: PL_COLORS.muted, label: fmtCompact(start, 1) }];
  steps.filter(s => Math.abs(s.delta) >= 0.5).forEach(s => {
    const lo = s.delta >= 0 ? run : run + s.delta;
    bars.push({ name: s.name, base: lo, value: Math.abs(s.delta), fill: s.delta >= 0 ? PL_COLORS.revenue : PL_COLORS.expense, label: `${s.delta >= 0 ? '+' : '-'}${fmtCompact(Math.abs(s.delta), 1)}` });
    run += s.delta;
  });
  bars.push({ name: endLabel, base: Math.min(0, end), value: Math.abs(end), fill: PL_COLORS.brand, label: fmtCompact(end, 1) });

  // Recharts tidak mendukung base negatif pada stack; geser semua ke atas kalau perlu.
  const levels = bars.flatMap(b => [b.base, b.base + b.value]);
  const lo = Math.min(...levels), hi = Math.max(...levels);
  const shift = lo < 0 ? -lo : 0;
  const data = bars.map(b => ({ ...b, base: b.base + shift }));
  const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.05 || 1;
  const floor = shift > 0 ? 0 : Math.max(0, lo - pad);

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 4, left: 4, bottom: 0 }}>
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} interval={0} tickLine={false} axisLine={false}
            tickFormatter={(s: string) => (s.length > 16 ? `${s.slice(0, 15)}…` : s)} />
          <YAxis hide domain={[floor, hi + shift + pad * 0.4]} allowDataOverflow />
          <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="w" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((b, i) => <Cell key={i} fill={b.fill} />)}
            <LabelList dataKey="label" position="top" style={{ fontSize: 10, fontWeight: 600, fill: '#334155' }} />
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
        <li key={i} className="flex gap-3 text-sm text-foreground/90 leading-snug">
          <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
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
      <span className="text-sm text-muted-foreground">Segment</span>
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
