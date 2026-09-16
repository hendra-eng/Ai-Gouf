'use client';

import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { exceptionBreakdown } from '@/data/journalEntryData';

const severityColors: Record<string, string> = {
  Critical: '#DC2626',
  High: '#EA580C',
  Medium: '#D97706',
  Low: '#65A30D',
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; payload: { severity: string } }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg shadow-elevated px-3 py-2.5 text-xs">
      <p className="font-700 text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">Count: <span className="font-700 text-foreground tabular-nums">{item.value}</span></p>
      <p className="text-muted-foreground">Severity: <span className="font-700" style={{ color: severityColors[item.payload.severity] }}>{item.payload.severity}</span></p>
    </div>
  );
}

export default function ExceptionBreakdownChart() {
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={exceptionBreakdown} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barSize={28}>
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
          {exceptionBreakdown.map((entry) => (
            <Cell key={`exc-bar-${entry.type}`} fill={severityColors[entry.severity]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}