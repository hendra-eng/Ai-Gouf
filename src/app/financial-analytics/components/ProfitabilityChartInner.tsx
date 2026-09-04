'use client';
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { MonthlyAnalyticsRow } from '../lib/useAnalyticsData';

const DATA_MAP: Record<string, { month: string; current: number; previous: number; benchmark: number }[]> = {
  'EBIT Margin': [
    { month: 'Jan', current: 18.9, previous: 16.8, benchmark: 18 },
    { month: 'Feb', current: 19.6, previous: 17.2, benchmark: 18 },
    { month: 'Mar', current: 21.2, previous: 18.4, benchmark: 18 },
    { month: 'Apr', current: 20.6, previous: 17.9, benchmark: 18 },
    { month: 'May', current: 22.1, previous: 19.2, benchmark: 18 },
    { month: 'Jun', current: 23.4, previous: 20.4, benchmark: 18 },
    { month: 'Jul', current: 24.1, previous: 21.2, benchmark: 18 },
    { month: 'Aug', current: 25.9, previous: 22.8, benchmark: 18 },
  ],
  'ROA': [
    { month: 'Jan', current: 10.2, previous: 8.8, benchmark: 10 },
    { month: 'Feb', current: 10.8, previous: 9.2, benchmark: 10 },
    { month: 'Mar', current: 11.4, previous: 9.8, benchmark: 10 },
    { month: 'Apr', current: 11.9, previous: 10.2, benchmark: 10 },
    { month: 'May', current: 12.6, previous: 10.8, benchmark: 10 },
    { month: 'Jun', current: 13.2, previous: 11.4, benchmark: 10 },
    { month: 'Jul', current: 13.8, previous: 12.1, benchmark: 10 },
    { month: 'Aug', current: 14.4, previous: 12.8, benchmark: 10 },
  ],
  'ROE': [
    { month: 'Jan', current: 16.8, previous: 14.2, benchmark: 15 },
    { month: 'Feb', current: 17.6, previous: 14.8, benchmark: 15 },
    { month: 'Mar', current: 18.4, previous: 15.6, benchmark: 15 },
    { month: 'Apr', current: 18.9, previous: 16.1, benchmark: 15 },
    { month: 'May', current: 19.6, previous: 16.8, benchmark: 15 },
    { month: 'Jun', current: 20.2, previous: 17.4, benchmark: 15 },
    { month: 'Jul', current: 20.8, previous: 17.9, benchmark: 15 },
    { month: 'Aug', current: 21.4, previous: 18.2, benchmark: 15 },
  ],
};

interface Props { metric: string; monthlyTrend?: MonthlyAnalyticsRow[]; benchmark?: number; }

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`prof-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: p.color }}>{p.value?.toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
};

const REAL_FIELD: Record<string, keyof MonthlyAnalyticsRow | undefined> = {
  'Gross Margin': 'grossMargin', 'EBITDA Margin': 'ebitdaMargin', 'Net Margin': 'netMargin',
};

export default function ProfitabilityChartInner({ metric, monthlyTrend, benchmark = 15 }: Props) {
  const field = REAL_FIELD[metric];
  const hasReal = field && monthlyTrend && monthlyTrend.length > 0;

  if (hasReal) {
    const data = monthlyTrend!.map((row) => ({ month: row.month, current: row[field!] as number, benchmark }));
    return (
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} width={40} />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={benchmark} stroke="var(--chart-2)" strokeDasharray="4 4" strokeWidth={1.5} label={{ value: 'Target', fill: 'var(--chart-2)', fontSize: 10, position: 'right' }} />
          <Line type="monotone" dataKey="current" stroke="var(--primary)" strokeWidth={2.5} dot={{ fill: 'var(--primary)', r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} name={metric} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  const data = DATA_MAP[metric] || DATA_MAP['ROA'];
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
