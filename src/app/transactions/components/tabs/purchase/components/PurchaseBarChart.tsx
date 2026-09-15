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
  { month: 'Jan', technology: 42000, materials: 28000, services: 18000 },
  { month: 'Feb', technology: 38000, materials: 31000, services: 22000 },
  { month: 'Mar', technology: 51000, materials: 24000, services: 19000 },
  { month: 'Apr', technology: 45000, materials: 36000, services: 25000 },
  { month: 'May', technology: 39000, materials: 29000, services: 21000 },
  { month: 'Jun', technology: 58000, materials: 33000, services: 28000 },
  { month: 'Jul', technology: 44000, materials: 27000, services: 24000 },
  { month: 'Aug', technology: 52000, materials: 38000, services: 26000 },
  { month: 'Sep', technology: 48200, materials: 36800, services: 28100 },
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