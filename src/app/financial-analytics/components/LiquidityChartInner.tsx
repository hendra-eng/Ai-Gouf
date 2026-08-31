'use client';
import React from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const DATA = [
  { month: 'Jan', currentRatio: 2.12, quickRatio: 1.88 },
  { month: 'Feb', currentRatio: 2.18, quickRatio: 1.94 },
  { month: 'Mar', currentRatio: 2.24, quickRatio: 1.98 },
  { month: 'Apr', currentRatio: 2.19, quickRatio: 1.92 },
  { month: 'May', currentRatio: 2.31, quickRatio: 2.04 },
  { month: 'Jun', currentRatio: 2.38, quickRatio: 2.12 },
  { month: 'Jul', currentRatio: 2.35, quickRatio: 2.08 },
  { month: 'Aug', currentRatio: 2.41, quickRatio: 2.12 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((p, i) => (
        <div key={`liq-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-600 font-tabular" style={{ color: p.color }}>{p.value?.toFixed(2)}x</span>
        </div>
      ))}
    </div>
  );
};

export default function LiquidityChartInner() {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={DATA} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="liqGrad1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--chart-2)" stopOpacity={0.2} />
            <stop offset="95%" stopColor="var(--chart-2)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="liqGrad2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} domain={[1, 3]} tickFormatter={(v) => `${v}x`} width={35} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={2.0} stroke="var(--warning)" strokeDasharray="4 4" strokeWidth={1} />
        <ReferenceLine y={1.0} stroke="var(--negative)" strokeDasharray="4 4" strokeWidth={1} />
        <Area type="monotone" dataKey="currentRatio" stroke="var(--chart-2)" fill="url(#liqGrad1)" strokeWidth={2} name="current ratio" dot={false} />
        <Area type="monotone" dataKey="quickRatio" stroke="var(--primary)" fill="url(#liqGrad2)" strokeWidth={2} name="quick ratio" dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
