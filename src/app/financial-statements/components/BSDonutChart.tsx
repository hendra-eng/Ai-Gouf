'use client';
import React from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

interface BSDonutChartProps {
  totalAssets: number;
  currentAssets: number;
  nonCurrentAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

function CustomTooltip({ active, payload, currency, t }: { active?: boolean; payload?: { name: string; value: number; payload: { pct: number } }[]; currency: 'IDR' | 'USD' | 'SGD'; t: (text: string) => string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0];
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-3">
      <p className="text-xs font-semibold text-foreground mb-1">{t(d.name)}</p>
      <p className="text-sm font-bold font-mono text-foreground">{formatRp(d.value)}</p>
      <p className="text-xs text-muted-foreground">{d.payload.pct.toFixed(1)}% {t('of total')}</p>
    </div>
  );
}

export default function BSDonutChart({ totalAssets, currentAssets, nonCurrentAssets, totalLiabilities, totalEquity }: BSDonutChartProps) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const assetData = [
    { name: 'Current Assets', value: currentAssets, pct: (currentAssets / totalAssets) * 100, color: 'var(--primary)' },
    { name: 'Non-Current Assets', value: nonCurrentAssets, pct: (nonCurrentAssets / totalAssets) * 100, color: '#3B82F6' },
  ];

  const fundingData = [
    { name: 'Liabilities', value: totalLiabilities, pct: (totalLiabilities / totalAssets) * 100, color: 'var(--negative)' },
    { name: 'Equity', value: totalEquity, pct: (totalEquity / totalAssets) * 100, color: 'var(--positive)' },
  ];

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-semibold text-center text-muted-foreground mb-2">{t('Asset Mix')}</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={assetData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
              {assetData.map((entry, i) => (
                <Cell key={`bsasset-${i}`} fill={entry.color} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip currency={currency} t={t} />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-plus-jakarta-sans)' }} formatter={(value: string) => t(value)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div>
        <p className="text-xs font-semibold text-center text-muted-foreground mb-2">{t('Funding Structure')}</p>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={fundingData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={3} dataKey="value">
              {fundingData.map((entry, i) => (
                <Cell key={`bsfund-${i}`} fill={entry.color} strokeWidth={0} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip currency={currency} t={t} />} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, fontFamily: 'var(--font-plus-jakarta-sans)' }} formatter={(value: string) => t(value)} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
