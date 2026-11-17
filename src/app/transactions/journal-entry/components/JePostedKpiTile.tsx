'use client';

import React from 'react';

// Kartu KPI halaman Posted -- salinan persis PostedKpiTile di Sales > Posted
// (garis aksen hitam tipis di atas, ikon netral, bar proporsi netral).
export default function JePostedKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
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
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? ''}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}