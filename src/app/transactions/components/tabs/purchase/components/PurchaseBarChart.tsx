'use client';
import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';

const data = [
  { month: 'Jan', technology: 0, materials: 0, services: 0 },
  { month: 'Feb', technology: 0, materials: 0, services: 0 },
  { month: 'Mar', technology: 0, materials: 0, services: 0 },
  { month: 'Apr', technology: 0, materials: 0, services: 0 },
  { month: 'May', technology: 0, materials: 0, services: 0 },
  { month: 'Jun', technology: 0, materials: 0, services: 0 },
  { month: 'Jul', technology: 0, materials: 0, services: 0 },
  { month: 'Aug', technology: 0, materials: 0, services: 0 },
  { month: 'Sep', technology: 0, materials: 0, services: 0 },
];

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs min-w-[170px]">
      <p className="font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((entry) => (
        <div key={`ptt-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
          <span className="text-muted-foreground capitalize">{entry.name}</span>
          <span className="font-600 text-foreground font-tabular">${Number(entry.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

export default function PurchaseBarChart() {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }} barSize={12}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="technology" fill="var(--primary)" radius={[3, 3, 0, 0]} />
        <Bar dataKey="materials" fill="#F59E0B" radius={[3, 3, 0, 0]} />
        <Bar dataKey="services" fill="#10B981" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}