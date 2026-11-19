'use client';

import React, { useEffect, useRef, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Check, ChevronDown, Loader2, Minus, Printer } from 'lucide-react';
import DownloadMenu from '../DownloadMenu';
import type { PrintReport } from '@/lib/printExport';
import { useActiveClient } from '@/lib/activeClient';
import { clientLetterhead } from '../statementTemplate';
import { fmtCompact } from './bsData';

// Komponen UI halaman Balance Sheet bertema "elegant hitam putih" -- disamakan
// dengan halaman Sales (Inter, neutral-*, kartu bergaris atas hitam, tabel
// header abu tua). Khusus Balance Sheet: P&L / Cash Flow tetap memakai BsUi.tsx.

export type { ViewProps } from './BsToolbar';
export type Tone = 'brand' | 'rose' | 'violet' | 'amber' | 'sky'; // dipertahankan agar API sama; semua nada tampil monokrom

// ── Kontrol form ─────────────────────────────────────────────────────

export const inputCls = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300';

/** Dropdown kustom (bukan <select> bawaan browser) -- gaya sama dengan dropdown di halaman Sales. */
export function BsDropdown({ value, onChange, options, icon: Icon, align = 'left', fullWidth = false, className = '' }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ElementType;
  align?: 'left' | 'right';
  fullWidth?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  return (
    <div ref={ref} className={`relative ${fullWidth ? 'w-full' : ''} ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors ${fullWidth ? 'w-full justify-between' : ''} ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
      >
        {Icon && <Icon size={15} className="shrink-0 text-neutral-700" />}
        <span className="truncate">{current?.label}</span>
        <ChevronDown size={14} className={`ml-auto shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-lg border border-neutral-300 bg-white shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {options.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-xs transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'font-medium text-neutral-700'}`}
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

/** Pengganti <select>: tetap menerima anak <option>, tampil sebagai BsDropdown. */
export function Select({ value, onChange, children }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode }) {
  const options = React.Children.toArray(children)
    .filter((c): c is React.ReactElement<{ value: string | number; children?: React.ReactNode }> => React.isValidElement(c))
    .map(c => ({ value: String(c.props.value), label: React.Children.toArray(c.props.children).join('') }));
  return <BsDropdown fullWidth value={String(value)} onChange={onChange} options={options} />;
}

/** Toggle segmen (mis. "As of" / "Date range"). */
export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: readonly (readonly [T, string])[] }) {
  return (
    <div className="inline-flex rounded-lg border border-neutral-300 bg-white p-0.5 text-xs font-semibold">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onChange(k)}
          className={`rounded-md px-3 py-1.5 transition-colors ${value === k ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:text-neutral-900'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** Label kecil di toolbar. */
export const filterLabelCls = 'flex items-center gap-2 text-xs font-medium text-neutral-600';

// ── Toolbar (Print + Download) ───────────────────────────────────────

export function BsToolbar({ filters, loading, exportReady, buildExport }: {
  filters: React.ReactNode;
  loading?: boolean;
  exportReady: boolean;
  buildExport: () => PrintReport;
}) {
  const { clients, activeClientId } = useActiveClient();
  const build = () => {
    const r = buildExport();
    if (r.template !== 'statement' || r.letterhead) return r;
    return { ...r, letterhead: clientLetterhead(clients.find(c => c.id === activeClientId), r.companyName ?? '') };
  };
  return (
    <div className="card-elevated-md flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-center gap-3">{filters}</div>
      {loading && <Loader2 size={16} className="animate-spin text-neutral-700" />}
      <div className="ml-auto flex items-center gap-2">
        <button type="button" onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
          <Printer size={14} className="text-neutral-500" /> Print
        </button>
        <DownloadMenu disabled={!exportReady} build={build} variant="mono" />
      </div>
    </div>
  );
}

// ── Panel, KPI, badge ────────────────────────────────────────────────

export function Panel({ title, icon: Icon, right, children, className = '', bodyClass = 'p-5' }: {
  title?: React.ReactNode;
  icon?: React.ElementType;
  tone?: Tone;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClass?: string;
}) {
  return (
    <section className={`card-elevated-md rounded-xl ${className}`}>
      {title && (
        <header className="flex items-center gap-3 px-5 pt-4 pb-1">
          {Icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><Icon size={18} /></span>}
          <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
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
  if (val === null || val === undefined) return <span className={`text-[11px] font-medium text-neutral-500 ${className}`}>– {suffix}</span>;
  const flat = Math.abs(val) < 0.05;
  const up = val > 0;
  const good = flat ? null : up === upIsGood;
  const color = good === null ? 'text-neutral-500' : good ? 'text-neutral-900' : 'text-red-700';
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = pct !== undefined && pct !== null
    ? `${up ? '+' : ''}${pct.toFixed(1)}%`
    : `${up ? '+' : ''}${fmtCompact(abs ?? 0)}`;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] ${className}`}>
      <span className={`inline-flex items-center gap-0.5 font-semibold ${color}`}><Icon size={13} /> {text}</span>
      {suffix && <span className="ml-1 font-medium text-neutral-500">{suffix}</span>}
    </span>
  );
}

export function KpiCard({ label, value, icon: Icon, delta }: {
  label: string;
  value: React.ReactNode;
  icon: React.ElementType;
  tone?: Tone;
  delta?: React.ReactNode;
}) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      {delta && <div className="mt-1 min-h-4">{delta}</div>}
    </div>
  );
}

export function KpiRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-neutral-600">
      {items.map(i => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: i.color }} />{i.label}</span>
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
    <div className="min-w-[180px] rounded-lg border border-neutral-300 bg-white p-3 text-xs shadow-xl">
      <p className="mb-1.5 font-semibold text-neutral-900">{label}</p>
      {payload.map(p => (
        <div key={p.name} className="flex items-center gap-2 py-0.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-neutral-500">{p.name}</span>
          <span className="ml-auto font-semibold tabular-nums text-neutral-900">{fmt ? fmt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Kartu insight (tampilan Trend). */
export function InsightCard({ icon: Icon, title, value, sub, badge }: {
  icon: React.ElementType;
  tone?: Tone;
  title: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-neutral-300 bg-white p-3.5 transition-colors duration-200 hover:border-neutral-500 hover:bg-neutral-50">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"><Icon size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
        <p className="text-sm font-semibold tabular-nums text-neutral-900">{value}</p>
        {sub && <p className="mt-0.5 text-[11px] font-medium text-neutral-500">{sub}</p>}
      </div>
      {badge && <div className="shrink-0 self-center text-sm font-semibold">{badge}</div>}
    </div>
  );
}

export function EmptyData({ text = 'No posted journals for this period.' }: { text?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-10 text-center text-xs font-medium text-neutral-500">{text}</div>
  );
}

// ── Gaya tabel bersama (acuan tabel Sales) ───────────────────────────

/** <thead><tr> */
export const thRowCls = 'bg-neutral-300 text-xs font-bold text-black';
/** Sel header: garis atas/bawah hitam seperti tabel Sales. */
export const thCls = 'border-y border-neutral-800 px-3 py-2 whitespace-nowrap';
/** Baris data: garis pemisah abu + hover. */
export const trCls = 'text-xs [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200';
