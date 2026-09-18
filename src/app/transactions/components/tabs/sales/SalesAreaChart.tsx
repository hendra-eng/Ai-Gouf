'use client';
import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';

const data = [
  { month: 'Jan', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Feb', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Mar', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Apr', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'May', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Jun', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Jul', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Aug', paid: 0, outstanding: 0, overdue: 0 },
  { month: 'Sep', paid: 0, outstanding: 0, overdue: 0 },
];

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-lg p-3 text-xs min-w-[160px]">
      <p className="font-600 text-foreground mb-2">{label} 2026</p>
      {payload.map((entry) => (
        <div key={`tt-${entry.name}`} className="flex items-center justify-between gap-4 mb-1">
          <span className="text-muted-foreground capitalize">{entry.name}</span>
          <span className="font-600 text-foreground font-tabular">
            ${Number(entry.value).toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function SalesAreaChart() {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="gradPaid" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOutstanding" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradOverdue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#EF4444" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="paid"
          stroke="var(--primary)"
          strokeWidth={2}
          fill="url(#gradPaid)"
        />
        <Area
          type="monotone"
          dataKey="outstanding"
          stroke="#F59E0B"
          strokeWidth={2}
          fill="url(#gradOutstanding)"
        />
        <Area
          type="monotone"
          dataKey="overdue"
          stroke="#EF4444"
          strokeWidth={2}
          fill="url(#gradOverdue)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}