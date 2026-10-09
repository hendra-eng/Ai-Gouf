'use client';

import React, { useState } from 'react';
import { ChevronDown, Filter, Loader2 } from 'lucide-react';
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

export function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">{label}</span>
      {children}
    </label>
  );
}

export function Select({ value, onChange, children }: { value: string | number; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="relative">
      <select value={value} onChange={e => onChange(e.target.value)} className={`${inputCls} appearance-none pr-8`}>{children}</select>
      <ChevronDown size={15} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
    </div>
  );
}

export default function PeriodPicker({ value, onApply, loading, hideCompare, extra }: {
  value: PeriodQuery;
  onApply: (q: PeriodQuery) => void;
  loading?: boolean;
  hideCompare?: boolean;
  /** Field tambahan (mis. segment P&L) dirender di baris yang sama. */
  extra?: React.ReactNode;
}) {
  const [q, setQ] = useState<PeriodQuery>(value);
  const set = (patch: Partial<PeriodQuery>) => setQ(prev => ({ ...prev, ...patch }));
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => thisYear + 1 - i);
  const invalid = q.period_type === 'custom' && (!q.start_date || !q.end_date || q.start_date > q.end_date)
    || (!hideCompare && q.compare === 'custom' && (!q.compare_start || !q.compare_end || q.compare_start > q.compare_end));

  return (
    <form
      onSubmit={e => { e.preventDefault(); if (!invalid) onApply(q); }}
      className="bg-card border border-border rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3"
    >
      <Field label="Period" className="w-40">
        <Select value={q.period_type} onChange={v => set({ period_type: v as PeriodType })}>
          {PERIOD_TYPES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </Select>
      </Field>

      {q.period_type !== 'custom' && (
        <Field label="Year" className="w-28">
          <Select value={q.year ?? thisYear} onChange={v => set({ year: Number(v) })}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
        </Field>
      )}
      {(q.period_type === 'month' || q.period_type === 'ytd') && (
        <Field label={q.period_type === 'ytd' ? 'Up to month' : 'Month'} className="w-36">
          <Select value={q.month ?? 12} onChange={v => set({ month: Number(v) })}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </Select>
        </Field>
      )}
      {q.period_type === 'quarter' && (
        <Field label="Quarter" className="w-28">
          <Select value={q.quarter ?? 1} onChange={v => set({ quarter: Number(v) })}>
            {[1, 2, 3, 4].map(n => <option key={n} value={n}>Q{n}</option>)}
          </Select>
        </Field>
      )}
      {q.period_type === 'custom' && (
        <>
          <Field label="Start date" className="w-40">
            <input type="date" value={q.start_date ?? ''} onChange={e => set({ start_date: e.target.value })} className={inputCls} />
          </Field>
          <Field label="End date" className="w-40">
            <input type="date" value={q.end_date ?? ''} min={q.start_date} onChange={e => set({ end_date: e.target.value })} className={inputCls} />
          </Field>
        </>
      )}

      {!hideCompare && (
        <Field label="Compare with" className="w-48">
          <Select value={q.compare} onChange={v => set({ compare: v as CompareMode })}>
            {COMPARES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </Select>
        </Field>
      )}
      {!hideCompare && q.compare === 'custom' && (
        <>
          <Field label="Compare start" className="w-40">
            <input type="date" value={q.compare_start ?? ''} onChange={e => set({ compare_start: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Compare end" className="w-40">
            <input type="date" value={q.compare_end ?? ''} min={q.compare_start} onChange={e => set({ compare_end: e.target.value })} className={inputCls} />
          </Field>
        </>
      )}

      {extra}

      <button
        type="submit"
        disabled={invalid || loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply
      </button>
    </form>
  );
}
