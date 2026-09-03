'use client';
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import InteractiveAgingDonut, { AgingLivePreview } from './InteractiveAgingDonut';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';

const revenueData = [
  { month: 'Jan', revenue: 950000000, expenses: 760000000, netProfit: 190000000 },
  { month: 'Feb', revenue: 1020000000, expenses: 790000000, netProfit: 230000000 },
  { month: 'Mar', revenue: 1080000000, expenses: 820000000, netProfit: 260000000 },
  { month: 'Apr', revenue: 1050000000, expenses: 840000000, netProfit: 210000000 },
  { month: 'May', revenue: 1120000000, expenses: 870000000, netProfit: 250000000 },
  { month: 'Jun', revenue: 1090000000, expenses: 860000000, netProfit: 230000000 },
  { month: 'Jul', revenue: 1150000000, expenses: 890000000, netProfit: 260000000 },
  { month: 'Aug', revenue: 1160000000, expenses: 920000000, netProfit: 240000000 },
];

// Values are in Jt (Rp million) units — converted to raw IDR before display.
const arAgingPie = [
  { name: 'Current', value: 620, color: '#16A34A' },
  { name: '1–30 Days', value: 215, color: '#2563EB' },
  { name: '31–60 Days', value: 168, color: '#D97706' },
  { name: '61–90 Days', value: 152, color: '#EA580C' },
  { name: '90+ Days', value: 85, color: '#DC2626' },
];

export default function OverviewCharts() {
  const [period, setPeriod] = useState<'6M' | 'YTD' | '12M' | '3Y'>('YTD');
  const [activeAging, setActiveAging] = useState<number | null>(null);
  const [livePreview, setLivePreview] = useState<AgingLivePreview[] | null>(null);
  const { t } = useLanguage();
  const { currency, fx } = useCurrency();

  const fmt = (v: number) => formatMoney(v, currency);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
        <p className="font-600 text-foreground mb-1.5">{label}</p>
        {payload.map((p: any, i: number) => (
          <div key={`tt-${i}`} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-600 text-foreground">{formatMoney(p.value, currency)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* Revenue Chart */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-600 text-foreground">{t('Revenue vs Expenses vs Net Profit')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">PT Nusantara Teknologi Indonesia · Jan–Aug 2026</p>
          </div>
          <div className="flex gap-1">
            {(['6M', 'YTD', '12M', '3Y'] as const).map((p) => (
              <button
                key={`period-${p}`}
                onClick={() => setPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-md font-500 transition-colors ${
                  period === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.12} />
                <stop offset="95%" stopColor="var(--danger)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="revenue" name={t('Revenue')} stroke="var(--primary)" strokeWidth={2} fill="url(#gradRevenue)" />
            <Area type="monotone" dataKey="expenses" name={t('Expenses')} stroke="var(--danger)" strokeWidth={1.5} fill="url(#gradExpenses)" />
            <Area type="monotone" dataKey="netProfit" name={t('Net Profit')} stroke="var(--success)" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* AR Aging Donut */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="mb-4">
          <h3 className="text-md font-600 text-foreground">{t('AR Aging Analysis')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{fx(t('Total AR: Rp 1,24M outstanding'))}</p>
        </div>
        <InteractiveAgingDonut
          data={arAgingPie}
          activeIndex={activeAging}
          onActiveChange={setActiveAging}
          onLiveChange={setLivePreview}
        />
        <div className="space-y-1.5 mt-2">
          {arAgingPie.map((item, index) => {
            const preview = livePreview?.[index];
            const displayValueJt = preview ? preview.value : item.value;
            const displayPct = preview ? preview.pct : (item.value / 1240) * 100;
            return (
              <div
                key={`aging-legend-${item.name}`}
                onClick={() => setActiveAging((prev) => (prev === index ? null : index))}
                className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                  activeAging === index ? 'bg-secondary' : 'hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className={activeAging === index ? 'text-foreground font-600' : 'text-muted-foreground'}>{t(item.name)}</span>
                </div>
                <span className="font-600 text-foreground tabular-nums">{formatMoney(displayValueJt * 1e6, currency)}</span>
                <span className="text-muted-foreground w-10 text-right">{displayPct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}