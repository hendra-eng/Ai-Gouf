'use client';

// Kit UI yang disalin 100% dari tab Sales > Overview (SalesOverview.tsx) supaya tab Cash Receipt
// punya tampilan elegant yang sama: kartu KPI, dropdown filter, header kartu, tombol paging.
// Hanya tampilan -- tidak ada logika data di sini.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Check, Trophy } from 'lucide-react';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import { formatIDR } from '../lib/formatMoney';
import { formatIDR as formatIDRRingkas } from '../../lib/groupAnalytics';

export type KpiTone = 'slate' | 'amber' | 'green' | 'sky' | 'warn' | 'danger';
export const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string; glow: string; border: string }> = {
  slate: { strip: 'bg-blue-600', iconBg: 'bg-blue-50', iconText: 'text-blue-600', bar: 'bg-blue-600', glow: '', border: 'border-neutral-300' },
  amber: { strip: 'bg-amber-500', iconBg: 'bg-amber-50', iconText: 'text-amber-600', bar: 'bg-amber-500', glow: '', border: 'border-neutral-300' },
  green: { strip: 'bg-teal-600', iconBg: 'bg-teal-50', iconText: 'text-teal-600', bar: 'bg-teal-600', glow: '', border: 'border-neutral-300' },
  sky: { strip: 'bg-sky-500', iconBg: 'bg-sky-50', iconText: 'text-sky-600', bar: 'bg-sky-500', glow: '', border: 'border-neutral-300' },
  warn: { strip: 'bg-orange-500', iconBg: 'bg-orange-50', iconText: 'text-orange-600', bar: 'bg-orange-500', glow: '', border: 'border-neutral-300' },
  danger: { strip: 'bg-red-600', iconBg: 'bg-red-50', iconText: 'text-red-600', bar: 'bg-red-600', glow: '', border: 'border-neutral-300' },
};

export function OverviewKpiTile({ label, value, sub, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className={`relative overflow-hidden rounded-[10px] border ${c.border} bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700`}>
      <span className={`absolute inset-x-0 top-0 h-0.5 ${c.strip}`} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ring-neutral-200 ${c.iconBg}`}>
          <Icon size={16} className={c.iconText} />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}


export const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

export interface FilterOption { value: string; label: string; short?: string }

export function FilterSelect({ value, onChange, options, searchable: searchableProp, title, neutral }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  searchable?: boolean;
  title?: string;
  neutral?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = searchableProp ?? options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${neutral ? (open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50') : (open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50')}`}
      >
        <span className="truncate max-w-[170px]">{current?.short ?? current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}


export function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}


export const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

export const fmtPct = (p: number) => `${p > 0 && p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;

// ── Pembulatan yang jumlahnya selalu pas (metode largest remainder) ──
// Membulatkan tiap angka sendiri-sendiri bikin jumlah legenda meleset dari total
// (mis. 100% + 0,1% = 100,1%, atau Rp 1,10M + Rp 1Jt != Rp 1,11M). Di sini
// pembulatan dibagi bersama: sisa pembulatan diberikan ke yang pecahannya terbesar.
export function largestRemainder(rawUnits: number[], targetUnits: number): number[] {
  const base = rawUnits.map((r) => Math.floor(r));
  let left = targetUnits - base.reduce((a, b) => a + b, 0);
  const order = rawUnits.map((r, i) => ({ i, frac: r - base[i] })).sort((a, b) => b.frac - a.frac);
  const out = base.slice();
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

// Persen satu desimal yang dijamin berjumlah tepat 100,0.
export function allocatePcts(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0 || values.some((v) => v < 0)) return values.map(() => 0);
  return largestRemainder(values.map((v) => (v / sum) * 1000), 1000).map((u) => u / 10);
}
export const pctLabel = (p: number, value = 1) =>
  p === 0 && value > 0 ? '<0.1%' : Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;

// Nominal ringkas yang dijamin berjumlah pas dengan totalnya. Di rentang miliar
// ("M") angka dihitung dalam resolusi juta, ditulis 3 desimal (Rp 1,104M) supaya
// cabang kecil (Rp 1Jt) tidak hilang karena dibulatkan ke 0,01M.
export function allocateMoney(values: number[], total: number): string[] {
  if (total >= 1e9 && values.every((v) => v >= 0)) {
    const units = largestRemainder(values.map((v) => v / 1e6), Math.round(total / 1e6));
    return units.map((u, i) =>
      u >= 1000 ? `Rp ${(u / 1000).toFixed(3).replace('.', ',')}M` : u > 0 ? `Rp ${u}Jt` : formatIDRRingkas(values[i], true)
    );
  }
  return values.map((v) => formatIDRRingkas(v, true));
}
// Inisial avatar: abaikan keterangan dalam kurung (mis. "AHIN (ATX)" -> "A"), hanya huruf/angka.
// >= 2 kata -> huruf depan 2 kata pertama ("TEGUH PS" -> "TP"); 1 kata -> 1 huruf depan ("SETIAWAN" -> "S").
export const initialsOf = (name: string) => {
  const cleaned = name.replace(/\(.*$/, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const src = words.length ? words : name.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(Boolean);
  if (src.length === 0) return '?';
  const out = src.length >= 2 ? src[0][0] + src[1][0] : src[0][0];
  return out.toUpperCase();
};


export function SalesCardHeader({ icon: Icon, title, subtitle, right, neutral }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
  neutral?: boolean;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${neutral ? 'bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200' : 'bg-[#ECFDF5] text-[#047857] shadow-sm ring-1 ring-white'}`}>
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className={`truncate text-sm ${neutral ? 'font-semibold text-neutral-900' : 'font-bold text-foreground'}`}>{title}</h2>
          <p className={`mt-0.5 text-xs ${neutral ? 'text-neutral-500' : 'text-muted-foreground'}`}>{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}



// ── Kartu donut + legenda (disalin dari BranchDonutCard di Sales Overview, dibuat generik) ──
const DONUT_COLORS = ['#2563EB', '#0EA5E9', '#6366F1', '#14B8A6', '#F59E0B', '#EC4899'];
const DONUT_OTHERS_COLOR = '#CBD5E1';

export function BreakdownDonutCard({ items, total, icon, title, subtitle, centerSubLabel, emptyLabel = 'No data yet.', othersLabel = 'Others' }: {
  items: { name: string; value: number }[];
  total: number;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  centerSubLabel: string;
  emptyLabel?: string;
  othersLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);

  const segs = useMemo(() => {
    const list = items.map((b, i) => ({ name: b.name, value: b.value, color: DONUT_COLORS[i % DONUT_COLORS.length] }));
    const rest = total - items.reduce((s2, b) => s2 + b.value, 0);
    if (total > 0 && rest > 1) list.push({ name: othersLabel, value: rest, color: DONUT_OTHERS_COLOR });
    return list;
  }, [items, total, othersLabel]);

  useEffect(() => { setActive(null); }, [segs.length]);

  const shownValues = useMemo(() => (live ? live.map((p) => p.value) : segs.map((sg) => sg.value)), [live, segs]);
  const shownTotal = useMemo(() => shownValues.reduce((a, b) => a + b, 0), [shownValues]);
  const shownPcts = useMemo(() => allocatePcts(shownValues), [shownValues]);
  const shownMoney = useMemo(() => allocateMoney(shownValues, shownTotal), [shownValues, shownTotal]);
  const toggle = (i: number) => setActive((prev) => (prev === i ? null : i));

  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <SalesCardHeader neutral icon={icon} title={title} subtitle={subtitle} />
      {segs.length === 0 || total <= 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[220px] shrink-0">
            <InteractiveDonutChart
              data={segs}
              height={190}
              centerLabel={allocateMoney([total], total)[0]}
              centerSubLabel={centerSubLabel}
              activeIndex={active}
              onActiveChange={setActive}
              onLiveChange={setLive}
              rawValue
              minVisibleDeg={5}
              formatValue={(v, i) => shownMoney[i] ?? formatIDRRingkas(v, true)}
              formatPct={(p, i) => pctLabel(shownPcts[i] ?? p, shownValues[i] ?? 1)}
            />
          </div>
          <ul className="mt-4 space-y-1">
            {segs.map((a, i) => (
              <li
                key={`legend-${a.name}-${i}`}
                onClick={() => toggle(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${active === i ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className={`min-w-0 flex-1 truncate ${active === i ? 'font-bold' : 'font-medium'} text-foreground`} title={a.name}>{a.name}</span>
                <span className="font-semibold tabular-nums text-foreground">{shownMoney[i]}</span>
                <span className="w-10 shrink-0 rounded-full bg-neutral-100 py-0.5 text-center text-[10px] font-semibold tabular-nums text-neutral-600">
                  {pctLabel(shownPcts[i], shownValues[i])}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Leaderboard Top Customer (disalin dari TopCustomerCard di Sales Overview, dibuat generik) ──
export function TopPartyCard({ parties, total, icon, title, subtitle, shareLabel, countLabel, emptyLabel = 'No data yet.' }: {
  parties: { name: string; amount: number; count: number }[];
  total: number;
  icon: React.ElementType;
  title: string;
  subtitle: string;
  shareLabel: string;
  countLabel: string;
  emptyLabel?: string;
}) {
  const max = parties[0]?.amount || 1;
  const topShare = total > 0 ? (parties.reduce((s2, c) => s2 + c.amount, 0) / total) * 100 : 0;
  return (
    <div className="card-elevated-md rounded-xl p-5">
      <SalesCardHeader
        neutral
        icon={icon}
        title={title}
        subtitle={subtitle}
        right={parties.length > 0 ? (
          <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-300">
            Top {parties.length} · {fmtPct(topShare)} {shareLabel}
          </span>
        ) : undefined}
      />
      {parties.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {parties.map((c, i) => {
            const first = i === 0;
            const share = total > 0 ? (c.amount / total) * 100 : 0;
            const badge = first ? 'bg-blue-600 text-white' : 'bg-neutral-100 text-neutral-700';
            return (
              <div
                key={`top-party-${c.name}`}
                className="rounded-[10px] border border-neutral-300 bg-white p-4 transition-colors duration-200 hover:border-neutral-500 hover:bg-neutral-50"
              >
                <div className="flex items-center justify-between">
                  <span className={`inline-flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ${badge}`}>
                    {first ? <Trophy size={12} /> : null}#{i + 1}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-600">
                    {fmtPct(share)}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200">
                    {initialsOf(c.name)}
                  </span>
                  <p className="min-w-0 truncate text-sm font-semibold text-neutral-900" title={c.name}>{c.name}</p>
                </div>
                <p className="mt-3 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={formatIDR(c.amount)}>
                  {formatIDR(c.amount)}
                </p>
                <p className="text-[11px] font-medium text-neutral-500">
                  {c.count} {countLabel}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(3, (c.amount / max) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
