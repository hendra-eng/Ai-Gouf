'use client';

import React from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { trendData } from '@/data/journalEntryData';

interface TooltipPayload {
  color: string;
  name: string;
  value: number;
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipPayload[]; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-card border border-border rounded-lg shadow-elevated px-3 py-2.5 text-xs">
      <p className="font-700 text-foreground mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={`tip-${p.name}`} className="flex items-center gap-2 mb-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-600 text-foreground tabular-nums">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function EntryTrendChart() {
  const displayData = trendData.filter((_, i) => i % 2 === 0);
  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={displayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradEntries" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.18} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradPosted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#15803D" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#15803D" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradExceptions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#DC2626" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          interval={2}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
          width={30}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
        />
        <Area type="monotone" dataKey="entries" name="Created" stroke="var(--primary)" strokeWidth={2} fill="url(#gradEntries)" dot={false} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="posted" name="Posted" stroke="#15803D" strokeWidth={2} fill="url(#gradPosted)" dot={false} activeDot={{ r: 4 }} />
        <Area type="monotone" dataKey="exceptions" name="Exceptions" stroke="#DC2626" strokeWidth={1.5} fill="url(#gradExceptions)" dot={false} activeDot={{ r: 3 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}