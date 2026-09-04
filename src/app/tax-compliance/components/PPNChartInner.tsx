'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const SAMPLE_DATA = [
  { period: 'Mar 2026', payable: 76 },
  { period: 'Apr 2026', payable: 70 },
  { period: 'May 2026', payable: 80 },
  { period: 'Jun 2026', payable: 90 },
  { period: 'Jul 2026', payable: 91 },
  { period: 'Aug 2026', payable: 94 },
];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`ppn-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: p.color }}>Rp {p.value}Jt</span>
        </div>
      ))}
    </div>
  );
};

export default function PPNChartInner({ data }: { data?: { period: string; payable: number }[] }) {
  const chartData = data && data.length > 0 ? data : SAMPLE_DATA;
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }} barSize={20}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="period" tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}Jt`} width={40} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="payable" fill="var(--warning)" opacity={0.85} radius={[3, 3, 0, 0]} name="net payable" />
      </BarChart>
    </ResponsiveContainer>
  );
}
