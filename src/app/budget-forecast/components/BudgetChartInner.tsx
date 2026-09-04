'use client';
import React from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { MonthBudgetRow } from '../lib/budgetBridge';

const ALL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const METRIC_FIELDS: Record<string, { budget: keyof MonthBudgetRow; actual: keyof MonthBudgetRow }> = {
  'Revenue': { budget: 'revBudget', actual: 'revActual' },
  'COGS': { budget: 'cogsBudget', actual: 'cogsActual' },
  'OpEx': { budget: 'opexBudget', actual: 'opexActual' },
  'EBITDA': { budget: 'ebitdaBudget', actual: 'ebitdaActual' },
  'Net Profit': { budget: 'netProfitBudget', actual: 'netProfitActual' },
};

/** "Gross Profit" bukan field langsung -- dihitung dari revenue - cogs per bulan. */
function metricValue(row: MonthBudgetRow, metric: string, field: 'budget' | 'actual'): number {
  if (metric === 'Gross Profit') {
    return field === 'budget' ? row.revBudget - row.cogsBudget : row.revActual - row.cogsActual;
  }
  const cfg = METRIC_FIELDS[metric] || METRIC_FIELDS['Revenue'];
  return Number(row[cfg[field]]);
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated min-w-[180px]">
      <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        p.value == null ? null : (
          <div key={`tt-${i}`} className="flex items-center justify-between gap-4 mb-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
            </div>
            <span className="text-xs font-semibold text-foreground tabular-nums">
              Rp {p.value?.toFixed(0)}M
            </span>
          </div>
        )
      ))}
    </div>
  );
};

interface Props {
  metric: string;
  horizon: string;
  monthlyRows: MonthBudgetRow[];
}

export default function BudgetChartInner({ metric, horizon, monthlyRows }: Props) {
  const count = horizon === '3M' ? 3 : horizon === '6M' ? 6 : 12;
  const actualMonths = monthlyRows.length;

  const recentActuals = monthlyRows.slice(-3).map((r) => metricValue(r, metric, 'actual'));
  const forecastBase = recentActuals.length > 0 ? recentActuals.reduce((s, v) => s + v, 0) / recentActuals.length : 0;
  const lastBudget = monthlyRows.length > 0 ? metricValue(monthlyRows[monthlyRows.length - 1], metric, 'budget') : 0;

  const fullData = ALL_MONTHS.map((m, i) => {
    const row = monthlyRows.find((r) => r.month === m);
    const budget = row ? metricValue(row, metric, 'budget') : lastBudget;
    const actual = row ? metricValue(row, metric, 'actual') : null;
    const isForecastMonth = i >= actualMonths - 1;
    const forecast = isForecastMonth ? Math.round(forecastBase * (1 + (i - actualMonths + 1) * 0.015)) : null;
    return {
      month: m,
      budget: Math.round(budget),
      actual,
      forecast,
      confidenceLow: isForecastMonth && forecast != null ? Math.round(forecast * 0.92) : null,
      confidenceHigh: isForecastMonth && forecast != null ? Math.round(forecast * 1.08) : null,
    };
  });

  const data = fullData.slice(0, count);
  const lastActualMonth = actualMonths > 0 ? ALL_MONTHS[actualMonths - 1] : null;

  if (actualMonths === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
        No posted monthly data yet for this client.
      </div>
    );
  }

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
        {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1} />}
        <Bar dataKey="budget" fill="var(--chart-2)" opacity={0.4} radius={[3, 3, 0, 0]} name="budget" barSize={18} />
        <Area type="monotone" dataKey="confidenceHigh" stroke="none" fill="url(#confidenceGrad)" name="confidence" legendType="none" />
        <Area type="monotone" dataKey="confidenceLow" stroke="none" fill="var(--background)" name="confidence-low" legendType="none" />
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
