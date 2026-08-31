'use client';
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const DATA_MAP: Record<string, { month: string; current: number; previous: number; benchmark: number }[]> = {
  'Net Margin': [
    { month: 'Jan', current: 19.8, previous: 17.2, benchmark: 15 },
    { month: 'Feb', current: 19.4, previous: 18.1, benchmark: 15 },
    { month: 'Mar', current: 18.2, previous: 17.8, benchmark: 15 },
    { month: 'Apr', current: 18.2, previous: 18.4, benchmark: 15 },
    { month: 'May', current: 18.5, previous: 19.2, benchmark: 15 },
    { month: 'Jun', current: 17.9, previous: 20.1, benchmark: 15 },
    { month: 'Jul', current: 17.9, previous: 21.4, benchmark: 15 },
    { month: 'Aug', current: 20.1, previous: 22.8, benchmark: 15 },
  ],
  'Gross Margin': [
    { month: 'Jan', current: 42.1, previous: 40.2, benchmark: 40 },
    { month: 'Feb', current: 43.2, previous: 41.8, benchmark: 40 },
    { month: 'Mar', current: 45.1, previous: 42.4, benchmark: 40 },
    { month: 'Apr', current: 44.6, previous: 41.9, benchmark: 40 },
    { month: 'May', current: 45.1, previous: 43.2, benchmark: 40 },
    { month: 'Jun', current: 44.9, previous: 43.8, benchmark: 40 },
    { month: 'Jul', current: 45.1, previous: 42.8, benchmark: 40 },
    { month: 'Aug', current: 44.3, previous: 43.1, benchmark: 40 },
  ],
};

const getDefaultData = (benchmark: number) => [
  { month: 'Jan', current: 22.1, previous: 19.8, benchmark },
  { month: 'Feb', current: 23.4, previous: 20.2, benchmark },
  { month: 'Mar', current: 24.8, previous: 21.4, benchmark },
  { month: 'Apr', current: 23.2, previous: 20.8, benchmark },
  { month: 'May', current: 25.1, previous: 22.1, benchmark },
  { month: 'Jun', current: 26.4, previous: 23.4, benchmark },
  { month: 'Jul', current: 27.1, previous: 24.2, benchmark },
  { month: 'Aug', current: 28.2, previous: 25.8, benchmark },
];

interface Props { metric: string; }

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((p, i) => (
        <div key={`prof-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-600 font-tabular" style={{ color: p.color }}>{p.value?.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
};

export default function ProfitabilityChartInner({ metric }: Props) {
  const benchmarkMap: Record<string, number> = { 'Gross Margin': 40, 'EBITDA Margin': 20, 'Net Margin': 15, 'ROA': 10, 'ROE': 15, 'EBIT Margin': 18 };
  const data = DATA_MAP[metric] || getDefaultData(benchmarkMap[metric] || 15);

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={data[0].benchmark} stroke="var(--chart-2)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Target', fill: 'var(--chart-2)', fontSize: 10, position: 'right' }} />
        <Line type="monotone" dataKey="previous" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} name="previous" />
        <Line type="monotone" dataKey="current" stroke="var(--primary)" strokeWidth={2.5} dot={{ fill: 'var(--primary)', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} name="current" />
      </LineChart>
    </ResponsiveContainer>
  );
}
