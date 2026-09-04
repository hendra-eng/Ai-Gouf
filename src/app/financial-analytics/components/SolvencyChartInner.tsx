'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { MonthlyAnalyticsRow } from '../lib/useAnalyticsData';

const SOLVENCY_SAMPLE = [
  { month: 'Jan', debtEquity: 0.26, debtRatio: 0.16 },
  { month: 'Feb', debtEquity: 0.25, debtRatio: 0.15 },
  { month: 'Mar', debtEquity: 0.24, debtRatio: 0.15 },
  { month: 'Apr', debtEquity: 0.23, debtRatio: 0.14 },
  { month: 'May', debtEquity: 0.22, debtRatio: 0.14 },
  { month: 'Jun', debtEquity: 0.22, debtRatio: 0.14 },
  { month: 'Jul', debtEquity: 0.21, debtRatio: 0.14 },
  { month: 'Aug', debtEquity: 0.21, debtRatio: 0.14 },
];

const EFFICIENCY_SAMPLE = [
  { month: 'Jan', dso: 56, dpo: 62 },
  { month: 'Feb', dso: 54, dpo: 64 },
  { month: 'Mar', dso: 55, dpo: 68 },
  { month: 'Apr', dso: 58, dpo: 66 },
  { month: 'May', dso: 52, dpo: 70 },
  { month: 'Jun', dso: 51, dpo: 68 },
  { month: 'Jul', dso: 54, dpo: 67 },
  { month: 'Aug', dso: 54, dpo: 67 },
];

interface Props { mode: 'solvency' | 'efficiency'; monthlyTrend?: MonthlyAnalyticsRow[]; }

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`st-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground">{p.name}</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: p.color }}>{p.value}</span>
        </div>
      ))}
    </div>
  );
};

export default function SolvencyChartInner({ mode, monthlyTrend }: Props) {
  const hasReal = monthlyTrend && monthlyTrend.length > 0;
  const data = mode === 'solvency'
    ? (hasReal ? monthlyTrend!.map((r) => ({ month: r.month, debtEquity: r.debtToEquity, debtRatio: r.debtRatio })) : SOLVENCY_SAMPLE)
    : (hasReal ? monthlyTrend!.map((r) => ({ month: r.month, dso: r.dso, dpo: r.dpo })) : EFFICIENCY_SAMPLE);
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={12}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} width={35} />
        <Tooltip content={<CustomTooltip />} />
        {mode === 'solvency' ? (
          <>
            <Bar dataKey="debtEquity" fill="var(--chart-4)" radius={[3, 3, 0, 0]} name="D/E Ratio" />
            <Bar dataKey="debtRatio" fill="var(--chart-2)" radius={[3, 3, 0, 0]} name="Debt Ratio" />
          </>
        ) : (
          <>
            <Bar dataKey="dso" fill="var(--chart-3)" radius={[3, 3, 0, 0]} name="DSO (days)" />
            <Bar dataKey="dpo" fill="var(--chart-2)" radius={[3, 3, 0, 0]} name="DPO (days)" />
          </>
        )}
      </BarChart>
    </ResponsiveContainer>
  );
}
