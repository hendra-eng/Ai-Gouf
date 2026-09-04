'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface GrowthShape { revenue: number; grossProfit: number; ebitda: number; netProfit: number; assets: number; equity: number; }
interface Props { growth?: GrowthShape; }

const SAMPLE_DATA = [
  { metric: 'Revenue', current: 12.8, previous: 9.4 },
  { metric: 'Gross Profit', current: 15.2, previous: 11.8 },
  { metric: 'EBITDA', current: 18.4, previous: 14.2 },
  { metric: 'Net Profit', current: 16.2, previous: 12.6 },
  { metric: 'Assets', current: 8.4, previous: 6.2 },
  { metric: 'Equity', current: 11.6, previous: 9.8 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`growth-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: p.color }}>{p.value >= 0 ? '+' : ''}{p.value}%</span>
        </div>
      ))}
    </div>
  );
};

export default function GrowthChartInner({ growth }: Props) {
  const data = growth
    ? [
        { metric: 'Revenue', current: growth.revenue },
        { metric: 'Gross Profit', current: growth.grossProfit },
        { metric: 'EBITDA', current: growth.ebitda },
        { metric: 'Net Profit', current: growth.netProfit },
        { metric: 'Assets', current: growth.assets },
        { metric: 'Equity', current: growth.equity },
      ]
    : SAMPLE_DATA;

  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={14} barGap={2}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="metric" tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={35} />
        <Tooltip content={<CustomTooltip />} />
        {!growth && <Bar dataKey="previous" fill="var(--muted-foreground)" opacity={0.5} radius={[3, 3, 0, 0]} name="Previous" />}
        <Bar dataKey="current" fill="var(--primary)" radius={[3, 3, 0, 0]} name={growth ? 'MoM Growth' : 'Current'} />
      </BarChart>
    </ResponsiveContainer>
  );
}
