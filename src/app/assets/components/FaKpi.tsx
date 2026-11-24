'use client';

// KPI halaman Fixed Assets -- desain disamakan dengan KPI halaman Balance Sheet
// (BsMono.KpiCard): kartu putih bergaris tipis, garis warna 2px di atas, ikon
// dalam chip berwarna di kanan atas, label huruf besar, nilai tebal, baris delta.
// Warna garis/ikon dipilih per topik KPI (aset, penyusutan, nilai buku, dst).
// KpiGrid bersama (moduleUi) tidak diubah agar modul lain tidak ikut berubah.

import React from 'react';

export type FaKpiTone = 'emerald' | 'rose' | 'teal' | 'sky' | 'amber' | 'violet';

export interface FaKpiSpec {
  label: string;
  value: string;
  icon: React.ElementType;
  tone: FaKpiTone;
  delta: React.ReactNode;
}

const TONE: Record<FaKpiTone, { bar: string; chip: string; icon: string }> = {
  emerald: { bar: 'bg-emerald-600', chip: 'bg-emerald-50 ring-emerald-100', icon: 'text-emerald-600' },
  rose:    { bar: 'bg-rose-500',    chip: 'bg-rose-50 ring-rose-100',       icon: 'text-rose-600' },
  teal:    { bar: 'bg-teal-600',    chip: 'bg-teal-50 ring-teal-100',       icon: 'text-teal-600' },
  sky:     { bar: 'bg-sky-500',     chip: 'bg-sky-50 ring-sky-100',         icon: 'text-sky-600' },
  amber:   { bar: 'bg-amber-500',   chip: 'bg-amber-50 ring-amber-100',     icon: 'text-amber-600' },
  violet:  { bar: 'bg-violet-500',  chip: 'bg-violet-50 ring-violet-100',   icon: 'text-violet-600' },
};

const KOLOM: Record<4 | 5 | 6, string> = { 4: 'xl:grid-cols-4', 5: 'lg:grid-cols-3 xl:grid-cols-5', 6: 'lg:grid-cols-3 xl:grid-cols-6' };

export function FaKpiGrid({ cards, loading, cols = 4 }: { cards: FaKpiSpec[]; loading?: boolean; cols?: 4 | 5 | 6 }) {
  return (
    <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${KOLOM[cols]}`}>
      {cards.map(c => {
        const Ikon = c.icon;
        const t = TONE[c.tone];
        return (
          <div
            key={c.label}
            className="relative min-w-0 overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700"
          >
            <span className={`absolute inset-x-0 top-0 h-0.5 ${t.bar}`} />
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={c.label}>{c.label}</p>
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${t.chip}`}>
                <Ikon size={16} className={t.icon} />
              </span>
            </div>
            {loading ? (
              <div className="mt-2 h-6 w-28 animate-pulse rounded bg-neutral-100" />
            ) : (
              <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{c.value}</p>
            )}
            <div className="mt-1 min-h-4 text-neutral-500">{c.delta}</div>
          </div>
        );
      })}
    </div>
  );
}
