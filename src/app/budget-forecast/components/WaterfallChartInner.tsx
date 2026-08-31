'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const RAW = [
  { name: 'Budget\nProfit', value: 1760, isBase: true, cumulative: 1760 },
  { name: 'Revenue\nUpside', value: 80, isBase: false, cumulative: 1840 },
  { name: 'COGS\nSavings', value: 60, isBase: false, cumulative: 1900 },
  { name: 'Payroll\nSavings', value: 22, isBase: false, cumulative: 1922 },
  { name: 'Marketing\nOverspend', value: -22, isBase: false, cumulative: 1900 },
  { name: 'Other\nSavings', value: 10, isBase: false, cumulative: 1910 },
  { name: 'Forecast\nProfit', value: 1910, isBase: true, cumulative: 1910 },
];

// Build waterfall: each bar has a transparent "invisible" base + a colored bar
const DATA = RAW.map((item, i) => {
  if (item.isBase) {
    return { ...item, invisible: 0, positive: item.value, negative: 0 };
  }
  const prev = RAW[i - 1]?.cumulative || 0;
  const base = item.value >= 0 ? prev : prev + item.value;
  return {
    ...item,
    invisible: base,
    positive: item.value >= 0 ? item.value : 0,
    negative: item.value < 0 ? Math.abs(item.value) : 0,
  };
});

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  const item = RAW.find((r) => r.name === label);
  if (!item) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-600 text-foreground mb-1">{label?.replace('\n', ' ')}</p>
      <p className={`text-sm font-700 font-tabular ${item.value >= 0 ? 'text-positive' : 'text-negative'}`}>
        {item.value >= 0 ? '+' : ''}Rp {item.value}M
      </p>
      <p className="text-xs text-muted-foreground">Running: Rp {item.cumulative}M</p>
    </div>
  );
};

export default function WaterfallChartInner() {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={DATA} margin={{ top: 10, right: 10, left: 0, bottom: 20 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}M`}
          width={45}
        />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="invisible" stackId="a" fill="transparent" legendType="none" />
        <Bar dataKey="positive" stackId="a" radius={[3, 3, 0, 0]} legendType="none">
          {DATA.map((entry, i) => (
            <Cell
              key={`cell-pos-${i}`}
              fill={entry.isBase ? 'var(--chart-2)' : 'var(--positive)'}
            />
          ))}
        </Bar>
        <Bar dataKey="negative" stackId="a" radius={[3, 3, 0, 0]} legendType="none">
          {DATA.map((_, i) => (
            <Cell key={`cell-neg-${i}`} fill="var(--negative)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
