'use client';
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

export interface WaterfallItem { name: string; value: number; isBase: boolean }

function buildData(raw: WaterfallItem[]) {
  let cumulative = 0;
  const withCumulative = raw.map((item) => {
    cumulative = item.isBase ? item.value : cumulative + item.value;
    return { ...item, cumulative };
  });
  return withCumulative.map((item, i) => {
    if (item.isBase) {
      return { ...item, invisible: 0, positive: item.value, negative: 0 };
    }
    const prev = withCumulative[i - 1]?.cumulative || 0;
    const base = item.value >= 0 ? prev : prev + item.value;
    return {
      ...item,
      invisible: base,
      positive: item.value >= 0 ? item.value : 0,
      negative: item.value < 0 ? Math.abs(item.value) : 0,
    };
  });
}

const CustomTooltip = ({ active, payload, label, raw }: { active?: boolean; payload?: Array<{ value: number }>; label?: string; raw: ReturnType<typeof buildData> }) => {
  if (!active || !payload?.length) return null;
  const item = raw.find((r) => r.name === label);
  if (!item) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-1">{label?.replace('\n', ' ')}</p>
      <p className={`text-sm font-bold tabular-nums ${item.value >= 0 ? 'text-positive' : 'text-negative'}`}>
        {item.value >= 0 ? '+' : ''}Rp {item.value}M
      </p>
      <p className="text-xs text-muted-foreground">Running: Rp {item.cumulative}M</p>
    </div>
  );
};

export default function WaterfallChartInner({ items }: { items: WaterfallItem[] }) {
  const DATA = buildData(items);

  if (items.length === 0) {
    return <div className="h-56 flex items-center justify-center text-sm text-muted-foreground">No data available yet.</div>;
  }

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
        <Tooltip content={<CustomTooltip raw={DATA} />} />
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
