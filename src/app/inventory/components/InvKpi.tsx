'use client';

// Kartu KPI Inventory — desain disamakan dengan KpiCard halaman Balance Sheet
// (financial-statements/components/fs/bs/BsMono.tsx): garis warna tipis di atas kartu,
// label uppercase, chip ikon di kanan atas, angka tabular. Warna garis mengikuti topik KPI.

import React from 'react';

export type InvTone = 'blue' | 'emerald' | 'amber' | 'red';

const TONE: Record<InvTone, { bar: string; chip: string; icon: string }> = {
  blue:    { bar: 'bg-blue-600',    chip: 'bg-blue-50 ring-blue-100',       icon: 'text-blue-600' },
  emerald: { bar: 'bg-emerald-600', chip: 'bg-emerald-50 ring-emerald-100', icon: 'text-emerald-600' },
  amber:   { bar: 'bg-amber-500',   chip: 'bg-amber-50 ring-amber-100',     icon: 'text-amber-600' },
  red:     { bar: 'bg-red-600',     chip: 'bg-red-50 ring-red-100',         icon: 'text-red-600' },
};

export interface InvKpiSpec {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: InvTone;
  /** Keterangan kecil di bawah angka. */
  note?: React.ReactNode;
}

export function InvKpiCard({ label, value, icon: Icon, tone, note, loading }: InvKpiSpec & { loading?: boolean }) {
  return (
    <div className="relative min-w-0 overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className={`absolute inset-x-0 top-0 h-0.5 ${TONE[tone].bar}`} />
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${TONE[tone].chip}`}>
          <Icon size={16} className={TONE[tone].icon} />
        </span>
      </div>
      {loading
        ? <div className="mt-2 h-6 w-28 animate-pulse rounded bg-neutral-100" />
        : <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>}
      {note && <div className="mt-1 min-h-4 text-[11px] font-medium text-neutral-500">{note}</div>}
    </div>
  );
}

export function InvKpiRow({ cards, loading }: { cards: InvKpiSpec[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(c => <InvKpiCard key={c.label} {...c} loading={loading} />)}
    </div>
  );
}