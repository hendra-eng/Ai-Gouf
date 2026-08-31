'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList
} from 'recharts';

const waterfallRaw = [
  { name: 'Revenue', value: 8420, start: 0, end: 8420, type: 'total' },
  { name: 'COGS', value: -4700, start: 3720, end: 8420, type: 'negative' },
  { name: 'Gross Profit', value: 3720, start: 0, end: 3720, type: 'subtotal' },
  { name: 'OpEx', value: -1180, start: 2540, end: 3720, type: 'negative' },
  { name: 'EBITDA', value: 2310, start: 0, end: 2310, type: 'subtotal' },
  { name: 'D&A', value: -210, start: 2100, end: 2310, type: 'negative' },
  { name: 'Interest', value: -148, start: 1952, end: 2100, type: 'negative' },
  { name: 'Tax', value: -436, start: 1516, end: 1952, type: 'negative' },
  { name: 'Net Profit', value: 1840, start: 0, end: 1840, type: 'total' },
];

// Build invisible base + visible bar for each item
const chartData = waterfallRaw.map((d) => ({
  name: d.name,
  base: d.type === 'total' || d.type === 'subtotal' ? 0 : Math.min(d.start, d.end),
  bar: Math.abs(d.value),
  type: d.type,
  value: d.value,
}));

function getColor(type: string) {
  if (type === 'total') return 'var(--primary)';
  if (type === 'subtotal') return 'var(--info)';
  return 'var(--negative)';
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { payload: typeof chartData[0] }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-3">
      <p className="text-xs font-bold text-foreground mb-1">{label}</p>
      <p className={`text-sm font-bold font-mono ${d.value < 0 ? 'text-negative' : 'text-primary'}`}>
        {d.value < 0 ? '−' : ''}Rp {Math.abs(d.value).toFixed(0)}Jt
      </p>
    </div>
  );
}

export default function PLWaterfallChart() {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={chartData} margin={{ top: 20, right: 16, left: 16, bottom: 4 }} barSize={38}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v) => `${(v / 1000).toFixed(0)}M`}
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip content={<CustomTooltip />} />
        {/* Invisible base bar */}
        <Bar dataKey="base" stackId="wf" fill="transparent" stroke="none" />
        {/* Visible colored bar */}
        <Bar dataKey="bar" stackId="wf" radius={[4, 4, 0, 0]}>
          {chartData.map((entry, index) => (
            <Cell key={`wf-cell-${index}`} fill={getColor(entry.type)} fillOpacity={entry.type === 'negative' ? 0.75 : 1} />
          ))}
          <LabelList
            dataKey="bar"
            position="top"
            formatter={(v: number) => `${(v / 1000).toFixed(1)}M`}
            style={{ fontSize: 10, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-ibm-plex-mono)' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
