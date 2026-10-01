'use client';
import React, { useState } from 'react';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';

// Backend integration point: replace with /api/ar/aging-summary
// [UBAH] Data contoh dikosongkan -- semua nilai 0 sampai ada data AR asli.
const agingData = [
  { name: 'Current', value: 0, color: 'var(--positive)', pct: 0 },
  { name: '1–30 Days', value: 0, color: 'var(--info)', pct: 0 },
  { name: '31–60 Days', value: 0, color: 'var(--warning)', pct: 0 },
  { name: '61–90 Days', value: 0, color: '#F97316', pct: 0 },
  { name: '90+ Days', value: 0, color: 'var(--negative)', pct: 0 },
];

export default function ARAgingDonutInner() {
  const { fx, currency } = useCurrency();
  const { t } = useLanguage();
  const [activeAging, setActiveAging] = useState<number | null>(null);
  const [livePreview, setLivePreview] = useState<DonutLivePreview[] | null>(null);
  return (
    <div className="card-elevated-md rounded-xl p-5 h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">{t('AR Aging Analysis')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{fx(t('Total AR: Rp 0 outstanding'))}</p>
      </div>

      <div className="flex-1 min-h-[200px] flex justify-center">
        <InteractiveDonutChart
          data={agingData}
          height={200}
          activeIndex={activeAging}
          onActiveChange={setActiveAging}
          onLiveChange={setLivePreview}
        />
      </div>

      {/* Legend */}
      <div className="space-y-2 mt-2">
        {agingData.map((d, i) => {
          const preview = livePreview?.[i];
          const displayValueJt = preview ? preview.value : d.value;
          const displayPct = preview ? preview.pct : d.pct;
          return (
            <div
              key={`ar-leg-${i}`}
              onClick={() => setActiveAging((prev) => (prev === i ? null : i))}
              className={`flex items-center justify-between cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                activeAging === i ? 'bg-secondary' : 'hover:bg-secondary/50'
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
                <span className={`text-xs ${activeAging === i ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{t(d.name)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold font-mono text-foreground">{fx(`Rp ${displayValueJt}Jt`)}</span>
                <span className="text-[10px] text-muted-foreground w-10 text-right">{displayPct.toFixed(0)}%</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Alert */}
      <div className="mt-4 p-3 rounded-lg bg-negative-subtle border border-negative/20">
        <p className="text-xs font-semibold text-negative">{fx(t('⚠ Rp 0 overdue 60+ days'))}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('0 customers require immediate follow-up')}</p>
      </div>
    </div>
  );
}