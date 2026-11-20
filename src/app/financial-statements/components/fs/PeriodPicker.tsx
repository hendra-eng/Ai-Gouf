'use client';

import React, { useState } from 'react';
import { Filter, Loader2 } from 'lucide-react';
import { inputCls as monoInputCls, Select as BsSelect } from './bs/BsMono';
import type { CompareMode, PeriodQuery, PeriodType } from '@/lib/fsStore';

// Pemilih periode bersama P&L / Changes in Equity / Cash Flow / CALK.
// Nilai baru dikirim ke induk saat "Apply" (bukan tiap ketikan).

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PERIOD_TYPES: { id: PeriodType; label: string }[] = [
  { id: 'month', label: 'Monthly' },
  { id: 'quarter', label: 'Quarterly' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'year', label: 'Full year' },
  { id: 'custom', label: 'Custom range' },
];

const COMPARES: { id: CompareMode; label: string }[] = [
  { id: 'none', label: 'No comparison' },
  { id: 'previous_period', label: 'Previous period' },
  { id: 'previous_year', label: 'Same period last year' },
  { id: 'custom', label: 'Custom period' },
];

export function defaultPeriod(): PeriodQuery {
  const d = new Date();
  return { period_type: 'ytd', year: d.getFullYear(), month: d.getMonth() + 1, compare: 'previous_year' };
}

export const inputCls = 'w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-400';

export const salesInputCls = inputCls.replace('text-sm text-foreground', 'text-xs font-medium text-neutral-900');

export function Field({ label, children, className = '', salesFont = false }: { label: string; children: React.ReactNode; className?: string; salesFont?: boolean }) {
  return (
    <label className={`block ${className}`}>
      <span className={salesFont ? 'block text-[11px] font-medium text-neutral-500 mb-1.5' : 'block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5'}>{label}</span>
      {children}
    </label>
  );
}

/** Dropdown kustom bertema mono (bukan <select> bawaan browser); tetap menerima anak <option>. */
export function Select({ value, onChange, children }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode; salesFont?: boolean; mono?: boolean }) {
  return <BsSelect value={value} onChange={onChange}>{children}</BsSelect>;
}

export default function PeriodPicker({ value, onApply, loading, hideCompare, extra, salesFont = false, mono = false, trailing }: {
  value: PeriodQuery;
  onApply: (q: PeriodQuery) => void;
  loading?: boolean;
  hideCompare?: boolean;
  /** Field tambahan (mis. segment P&L) dirender di baris yang sama. */
  extra?: React.ReactNode;
  /** true = font label/input/tombol gaya Sales (text-xs, label neutral-500). */
  salesFont?: boolean;
  /** true = tema hitam-putih seperti toolbar Profit & Loss / Balance Sheet. */
  mono?: boolean;
  /** Tombol di sisi kanan baris filter (mis. Print + Download). */
  trailing?: React.ReactNode;
}) {
  const ic = mono ? monoInputCls : salesFont ? salesInputCls : inputCls;
  const [q, setQ] = useState<PeriodQuery>(value);
  const set = (patch: Partial<PeriodQuery>) => setQ(prev => ({ ...prev, ...patch }));
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  const invalid = q.period_type === 'custom' && (!q.start_date || !q.end_date || q.start_date > q.end_date)
    || (!hideCompare && q.compare === 'custom' && (!q.compare_start || !q.compare_end || q.compare_start > q.compare_end));

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (!invalid) onApply(q); }}
      className={mono ? 'card-elevated-md flex flex-wrap items-end gap-3 rounded-xl px-4 py-3 print:hidden' : 'bg-card border border-border rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3'}
    >
      <Field salesFont={salesFont || mono} label="Period" className="w-40">
        <Select salesFont={salesFont} mono={mono} value={q.period_type} onChange={v => set({ period_type: v as PeriodType })}>
          {PERIOD_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>

      {q.period_type !== 'custom' && (
        <Field salesFont={salesFont || mono} label="Year" className="w-28">
          <Select salesFont={salesFont} mono={mono} value={q.year ?? thisYear} onChange={v => set({ year: Number(v) })}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
      )}
      {(q.period_type === 'month' || q.period_type === 'ytd') && (
        <Field salesFont={salesFont || mono} label={q.period_type === 'ytd' ? 'Up to month' : 'Month'} className="w-36">
          <Select salesFont={salesFont} mono={mono} value={q.month ?? 12} onChange={v => set({ month: Number(v) })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
      )}
      {q.period_type === 'quarter' && (
        <Field salesFont={salesFont || mono} label="Quarter" className="w-28">
          <Select salesFont={salesFont} mono={mono} value={q.quarter ?? 1} onChange={v => set({ quarter: Number(v) })}>
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>Q{n}</option>)}
          </Select>
        </Field>
      )}
      {q.period_type === 'custom' && (
        <>
          <Field salesFont={salesFont || mono} label="Start date" className="w-40">
            <input type="date" value={q.start_date ?? ''} onChange={e => set({ start_date: e.target.value })} className={ic} />
          </Field>
          <Field salesFont={salesFont || mono} label="End date" className="w-40">
            <input type="date" value={q.end_date ?? ''} min={q.start_date} onChange={e => set({ end_date: e.target.value })} className={ic} />
          </Field>
        </>
      )}

      {!hideCompare && (
        <Field salesFont={salesFont || mono} label="Compare with" className="w-48">
          <Select salesFont={salesFont} mono={mono} value={q.compare} onChange={v => set({ compare: v as CompareMode })}>
            {COMPARES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      )}
      {!hideCompare && q.compare === 'custom' && (
        <>
          <Field salesFont={salesFont || mono} label="Compare start" className="w-40">
            <input type="date" value={q.compare_start ?? ''} onChange={e => set({ compare_start: e.target.value })} className={ic} />
          </Field>
          <Field salesFont={salesFont || mono} label="Compare end" className="w-40">
            <input type="date" value={q.compare_end ?? ''} min={q.compare_start} onChange={e => set({ compare_end: e.target.value })} className={ic} />
          </Field>
        </>
      )}

      {extra}

      <button
        type="submit"
        disabled={invalid || loading}
        className={mono
          ? 'inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50'
          : `inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white ${salesFont ? 'text-xs' : 'text-sm'} font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply
      </button>
      {trailing && <div className="ml-auto flex items-center gap-2">{trailing}</div>}
    </form>
  );
}