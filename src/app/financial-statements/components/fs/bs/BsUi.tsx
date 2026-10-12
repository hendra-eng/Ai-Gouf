'use client';

import React from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { fmtCompact } from './bsData';

// Potongan UI bersama tampilan Balance Sheet: kartu KPI, badge perubahan,
// panel kartu. Warna mengikuti tema hijau ([[project-green-theme]]):
// blue-* di repo ini = palet brand hijau.

export type Tone = 'brand' | 'rose' | 'violet' | 'amber' | 'sky';

export const TONE: Record<Tone, string> = {
  brand: 'bg-blue-50 text-blue-700',
  rose: 'bg-rose-50 text-rose-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  sky: 'bg-sky-50 text-sky-600',
};

export function Panel({ title, icon: Icon, tone = 'brand', right, children, className = '', bodyClass = 'p-5' }: {
  title?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`bg-white border border-border rounded-2xl shadow-sm ${className}`}>
      {title && (
        <header className="flex items-center gap-3 px-5 pt-4 pb-1">
          {Icon && <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${TONE[tone]}`}><Icon size={18} /></span>}
          <h2 className="text-base font-bold text-foreground">{title}</h2>
          {right && <div className="ml-auto flex items-center gap-2">{right}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** Badge persentase / selisih. `upIsGood=false` untuk liabilitas (naik = merah). */
export function Delta({ pct, abs, upIsGood = true, suffix, className = '' }: {
  pct?: number | null;
  abs?: number | null;
  upIsGood?: boolean;
  suffix?: React.ReactNode;
  className?: string;
}) {
  const val = pct ?? abs ?? null;
  if (val === null || val === undefined) return <span className={`text-xs text-muted-foreground ${className}`}>– {suffix}</span>;
  const flat = Math.abs(val) < 0.05;
  const up = val > 0;
  const good = flat ? null : up === upIsGood;
  const color = good === null ? 'text-slate-500' : good ? 'text-emerald-600' : 'text-rose-600';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = pct !== undefined && pct !== null
    ? `${up ? '+' : ''}${pct.toFixed(1)}%`
    : `${up ? '+' : ''}${fmtCompact(abs ?? 0)}`;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${className}`}>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${color}`}><Icon size={14} /> {text}</span>
      {suffix && <span className="text-muted-foreground ml-1">{suffix}</span>}
    </span>
  );
}

export function KpiCard({ label, value, icon: Icon, tone, delta }: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  tone: Tone;
  delta?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-border rounded-2xl shadow-sm p-4 flex items-start gap-4 min-w-0">
      <span className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${TONE[tone]}`}><Icon size={22} /></span>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-xl font-bold text-foreground tabular-nums truncate mt-0.5">{value}</p>
        {delta && <div className="mt-1">{delta}</div>}
      </div>
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

export function ChartTooltip({ active, payload, label, fmt }: {
  active?: boolean;
  payload?: { name: string; value: number; color?: string; fill?: string; stroke?: string }[];
  label?: string;
  fmt?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-border rounded-lg p-3 shadow-lg text-xs min-w-[180px]">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto font-semibold text-foreground tabular-nums">{fmt ? fmt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Kartu insight berwarna (tampilan Trend). */
export function InsightCard({ icon: Icon, tone, title, value, sub, badge }: {
  icon: React.ElementType;
  tone: Tone;
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const bg: Record<Tone, string> = { brand: 'bg-blue-50/70', rose: 'bg-rose-50/70', violet: 'bg-violet-50/70', amber: 'bg-amber-50/70', sky: 'bg-sky-50/70' };
  return (
    <div className={`rounded-xl p-3.5 flex items-start gap-3 ${bg[tone]}`}>
      <span className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-white ${TONE[tone].split(' ')[1]}`}><Icon size={20} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-base font-bold text-foreground tabular-nums">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      {badge && <div className="text-sm font-semibold shrink-0 self-center">{badge}</div>}
    </div>
  );
}

export function EmptyData({ text = 'No posted journals for this period.' }: { text?: string }) {
  return (
    <div className="bg-white border border-dashed border-border rounded-2xl p-10 text-center text-sm text-muted-foreground">{text}</div>
  );
}
