'use client';

// Komponen UI bersama untuk tab Overview Journal Entry.
// Desainnya disalin 1:1 dari tab Overview Sales (SalesOverview.tsx): tema monokrom
// neutral (abu + hitam), font Inter, kartu putih berborder tipis, aksen strip hitam.
// Hanya tampilan -- tidak ada logika data di file ini.

import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

// ── Kartu KPI (sama dengan OverviewKpiTile di Sales Overview) ──
export function OverviewKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? '\u00A0'}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Label seksi KPI (garis hitam kecil + teks kapital).
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-700">
      <span className="h-3.5 w-1 rounded-full bg-neutral-800" />{children}
    </p>
  );
}

// Header kartu (ikon dalam chip + judul + subjudul) -- varian "neutral" di Sales.
export function CardHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-neutral-900">{title}</h2>
          <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

// ── Dropdown filter kustom (varian neutral dari FilterSelect Sales Overview) ──
export interface FilterOption { value: string; label: string; short?: string }

export function FilterSelect({ value, onChange, options, searchable: searchableProp, title }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  searchable?: boolean;
  title?: string;
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
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
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
                placeholder="Search..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Not found</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-foreground'}`}
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

// ── Pagination (sama dengan tabel invoice di Sales Overview) ──
export const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

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

// ── Status pill (warna lembut: tint -100, teks -800, garis -300; sama dengan STATUS_STYLE Sales) ──
export const STATUS_STYLE: Record<string, { pill: string; dot: string }> = {
  Draft: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
  Pending: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Approved: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  Posted: { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' },
  Exception: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Rejected: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
};
export const STATUS_STYLE_FALLBACK = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

// ── Helper angka (disalin dari Sales Overview) ──
export const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);
export const fmtPct = (p: number) => `${p > 0 && p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;

// Pembulatan yang jumlahnya selalu pas (largest remainder) supaya total persen = 100,0%.
function largestRemainder(rawUnits: number[], targetUnits: number): number[] {
  const base = rawUnits.map((r) => Math.floor(r));
  let left = targetUnits - base.reduce((a, b) => a + b, 0);
  const order = rawUnits.map((r, i) => ({ i, frac: r - base[i] })).sort((a, b) => b.frac - a.frac);
  const out = base.slice();
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

export function allocatePcts(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0 || values.some((v) => v < 0)) return values.map(() => 0);
  return largestRemainder(values.map((v) => (v / sum) * 1000), 1000).map((u) => u / 10);
}

export const pctLabel = (p: number, value = 1) =>
  p === 0 && value > 0 ? '<0.1%' : Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;

// Inisial avatar: >= 2 kata -> huruf depan 2 kata pertama; 1 kata -> 1 huruf depan.
export const initialsOf = (name: string) => {
  const cleaned = name.replace(/\(.*$/, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  const src = words.length ? words : name.replace(/[^\p{L}\p{N}]/gu, ' ').split(/\s+/).filter(Boolean);
  if (src.length === 0) return '?';
  const out = src.length >= 2 ? src[0][0] + src[1][0] : src[0][0];
  return out.toUpperCase();
};
