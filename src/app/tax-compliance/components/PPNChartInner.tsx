'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const DATA = [
  { month: 'Mar', output: 118, input: 42, net: 76 },
  { month: 'Apr', output: 108, input: 38, net: 70 },
  { month: 'May', output: 124, input: 44, net: 80 },
  { month: 'Jun', output: 136, input: 46, net: 90 },
  { month: 'Jul', output: 131, input: 40, net: 91 },
  { month: 'Aug', output: 143, input: 49, net: 94 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((p, i) => (
        <div key={`ppn-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-600 font-tabular" style={{ color: p.color }}>Rp {p.value}M</span>
        </div>
      ))}
    </div>
  );
};

export default function PPNChartInner() {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={DATA} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={16}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="month" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}M`} width={40} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="output" fill="var(--negative)" opacity={0.7} radius={[3, 3, 0, 0]} name="output" />
        <Bar dataKey="input" fill="var(--positive)" opacity={0.7} radius={[3, 3, 0, 0]} name="input" />
        <Bar dataKey="net" fill="var(--warning)" opacity={0.8} radius={[3, 3, 0, 0]} name="net payable" />
      </BarChart>
    </ResponsiveContainer>
  );
}
