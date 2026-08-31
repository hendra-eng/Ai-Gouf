'use client';
import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

// Backend integration point: replace with /api/ar/aging-summary
const agingData = [
  { name: 'Current', value: 620, color: 'var(--positive)', pct: 50.0 },
  { name: '1–30 Days', value: 248, color: 'var(--info)', pct: 20.0 },
  { name: '31–60 Days', value: 186, color: 'var(--warning)', pct: 15.0 },
  { name: '61–90 Days', value: 124, color: '#F97316', pct: 10.0 },
  { name: '90+ Days', value: 62, color: 'var(--negative)', pct: 5.0 },
];

function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: typeof agingData[0] }[] }) {
  const { fx } = useCurrency();
  const { t } = useLanguage();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-3">
      <p className="text-xs font-semibold text-foreground mb-1">{t(d.name)}</p>
      <p className="text-sm font-bold font-mono text-foreground">{fx(`Rp ${d.value}Jt`)}</p>
      <p className="text-xs text-muted-foreground">{d.pct.toFixed(1)}% {t('of total AR')}</p>
    </div>
  );
}

export default function ARAgingDonutInner() {
  const { fx } = useCurrency();
  const { t } = useLanguage();
  return (
    <div className="card-elevated-md rounded-xl p-5 h-full flex flex-col">
      <div className="mb-4">
        <h2 className="text-base font-bold text-foreground">{t('AR Aging Analysis')}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{fx(t('Total AR: Rp 1,24M outstanding'))}</p>
      </div>

      <div className="flex-1 min-h-[200px]">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={agingData}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
            >
              {agingData.map((entry, index) => (
                <Cell key={`ar-cell-${index}`} fill={entry.color} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="space-y-2 mt-2">
        {agingData.map((d, i) => (
          <div key={`ar-leg-${i}`} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.color }} />
              <span className="text-xs text-muted-foreground">{t(d.name)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold font-mono text-foreground">{fx(`Rp ${d.value}Jt`)}</span>
              <span className="text-[10px] text-muted-foreground w-10 text-right">{d.pct.toFixed(0)}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Alert */}
      <div className="mt-4 p-3 rounded-lg bg-negative-subtle border border-negative/20">
        <p className="text-xs font-semibold text-negative">{fx(t('⚠ Rp 320Jt overdue 60+ days'))}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{t('3 customers require immediate follow-up')}</p>
      </div>
    </div>
  );
}
