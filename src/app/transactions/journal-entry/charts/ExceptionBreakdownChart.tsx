'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

export interface ExceptionBreakdownItem {
  type: string;
  count: number;
  color: string;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg shadow-elevated px-3 py-2.5 text-xs">
      <p className="font-700 text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">Count: <span className="font-700 text-foreground tabular-nums">{item.value}</span></p>
    </div>
  );
}

export default function ExceptionBreakdownChart({ data }: { data: ExceptionBreakdownItem[] }) {
  if (data.length === 0) {
    return (
      <div className="h-[160px] flex items-center justify-center text-xs text-muted-foreground">
        Tidak ada exception saat ini.
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={28}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="type"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          interval={0}
          angle={-12}
          textAnchor="end"
          height={40}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          width={25}
          allowDecimals={false}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} />
        <Bar dataKey="count" name="Exceptions" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={`exc-bar-${entry.type}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}