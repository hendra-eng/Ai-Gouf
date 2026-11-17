'use client';

import React from 'react';

// Kartu KPI JE Transaction -- salinan persis gaya SalesKpiTile
// (sales/components/SalesTransaction.tsx): garis aksen hijau di atas, angka besar,
// nominal, dan bar proporsi terhadap total.
export type KpiTone = 'slate' | 'amber' | 'green' | 'sky';

const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string }> = {
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]' },
};

export default function JeKpiTile({ label, count, amount, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  count: number;
  amount: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-primary/60 bg-white p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-extrabold uppercase tracking-wide text-slate-700">{label}</p>
          <p className="mt-2 text-4xl font-extrabold leading-none tabular-nums text-[#064E3B]">{count.toLocaleString('id-ID')}</p>
        </div>
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${c.iconBg}`}>
          <Icon size={24} className={c.iconText} />
        </span>
      </div>
      <p className="mt-3 truncate text-lg font-bold text-slate-900">{amount}</p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${count > 0 ? Math.max(pct, 3) : 0}%` }} />
      </div>
      <p className="mt-1.5 text-xs font-semibold text-slate-600">{pct}% {pctLabel}</p>
    </div>
  );
}
