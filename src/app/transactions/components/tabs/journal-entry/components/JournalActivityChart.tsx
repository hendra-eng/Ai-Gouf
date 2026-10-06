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
  { month: 'Jan', posted: 0, pending: 0, rejected: 0 },
  { month: 'Feb', posted: 0, pending: 0, rejected: 0 },
  { month: 'Mar', posted: 0, pending: 0, rejected: 0 },
  { month: 'Apr', posted: 0, pending: 0, rejected: 0 },
  { month: 'May', posted: 0, pending: 0, rejected: 0 },
  { month: 'Jun', posted: 0, pending: 0, rejected: 0 },
  { month: 'Jul', posted: 0, pending: 0, rejected: 0 },
  { month: 'Aug', posted: 0, pending: 0, rejected: 0 },
  { month: 'Sep', posted: 0, pending: 0, rejected: 0 },
];

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs min-w-[150px]">
      <p className="font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((entry) => (
        <div key={`jtt-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
          <span className="text-muted-foreground capitalize">{entry.name}</span>
          <span className="font-600 text-foreground font-tabular">{entry.value} entries</span>
        </div>
      ))}
    </div>
  );
}

export default function JournalActivityChart() {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={14}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="posted" fill="var(--primary)" radius={[3, 3, 0, 0]} stackId="a" />
        <Bar dataKey="pending" fill="#F59E0B" radius={[0, 0, 0, 0]} stackId="a" />
        <Bar dataKey="rejected" fill="#EF4444" radius={[3, 3, 0, 0]} stackId="a" />
      </BarChart>
    </ResponsiveContainer>
  );
}