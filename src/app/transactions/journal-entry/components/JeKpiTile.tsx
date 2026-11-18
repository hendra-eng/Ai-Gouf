'use client';

import React from 'react';

// Kartu KPI JE Transaction -- tema hitam putih, sama dengan JePostedKpiTile
// (garis aksen hitam tipis di atas, ikon netral, bar proporsi netral).
export type KpiTone = 'slate' | 'amber' | 'green' | 'sky';

export default function JeKpiTile({ label, count, amount, pct, pctLabel, icon: Icon }: {
  label: string;
  count: number;
  amount: string;
  pct: number;
  pctLabel: string;
  tone?: KpiTone;
  icon: React.ElementType;
}) {
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</p>
          <p className="mt-2 text-3xl font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="mt-3 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{amount}</p>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${count > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] font-medium text-neutral-600">{pct}% {pctLabel}</p>
    </div>
  );
}
