'use client';
import React from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,  } from 'recharts';

const generateData = (metric: string, horizon: string) => {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const count = horizon === '3M' ? 3 : horizon === '6M' ? 6 : 12;
  const actualMonths = 8; // Jan-Aug are actual

  const baseValues: Record<string, { budget: number; actual: number; forecast: number }> = {
    'Revenue': { budget: 850, actual: 702, forecast: 874 },
    'COGS': { budget: 467, actual: 392, forecast: 477 },
    'Gross Profit': { budget: 383, actual: 310, forecast: 397 },
    'OpEx': { budget: 115, actual: 98, forecast: 112 },
    'EBITDA': { budget: 213, actual: 193, forecast: 227 },
    'Net Profit': { budget: 147, actual: 153, forecast: 159 },
  };

  const base = baseValues[metric] || baseValues['Revenue'];
  const variance = [0.92, 0.95, 1.02, 0.88, 0.97, 1.05, 1.01, 0.98, null, null, null, null];
  const forecastVar = [null, null, null, null, null, null, null, null, 1.03, 1.06, 1.08, 1.10];

  return months.slice(0, count).map((m, i) => ({
    month: m,
    budget: Math.round(base.budget * (1 + i * 0.01)),
    actual: i < actualMonths ? Math.round(base.actual * (variance[i] || 1) * (1 + i * 0.008)) : null,
    forecast: i >= actualMonths - 1 ? Math.round(base.forecast * (forecastVar[i] || 1) * (1 + i * 0.009)) : null,
    confidenceLow: i >= actualMonths - 1 ? Math.round(base.forecast * 0.92 * (1 + i * 0.007)) : null,
    confidenceHigh: i >= actualMonths - 1 ? Math.round(base.forecast * 1.08 * (1 + i * 0.011)) : null,
    isForecast: i >= actualMonths,
  }));
};

interface Props {
  metric: string;
  horizon: string;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated min-w-[180px]">
      <p className="text-sm font-semibold text-foreground mb-2">{label} 2026</p>
      {payload.map((p, i) => (
        <div key={`tt-${i}`} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          </div>
          <span className="text-xs font-semibold text-foreground tabular-nums">
            Rp {p.value?.toFixed(0)}M
          </span>
        </div>
      ))}
    </div>
  );
};

export default function BudgetChartInner({ metric, horizon }: Props) {
  const data = generateData(metric, horizon);

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ComposedChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <defs>
          <linearGradient id="confidenceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}M`}
          width={55}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine x="Aug" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1} />
        <Bar dataKey="budget" fill="var(--chart-2)" opacity={0.4} radius={[3, 3, 0, 0]} name="budget" barSize={18} />
        <Area
          type="monotone"
          dataKey="confidenceHigh"
          stroke="none"
          fill="url(#confidenceGrad)"
          name="confidence"
          legendType="none"
        />
        <Area
          type="monotone"
          dataKey="confidenceLow"
          stroke="none"
          fill="var(--background)"
          name="confidence-low"
          legendType="none"
        />
        <Line
          type="monotone"
          dataKey="actual"
          stroke="var(--primary)"
          strokeWidth={2.5}
          dot={{ fill: 'var(--primary)', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: 'var(--primary)' }}
          name="actual"
          connectNulls={false}
        />
        <Line
          type="monotone"
          dataKey="forecast"
          stroke="var(--chart-3)"
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={{ fill: 'var(--chart-3)', r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5 }}
          name="forecast"
          connectNulls={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
