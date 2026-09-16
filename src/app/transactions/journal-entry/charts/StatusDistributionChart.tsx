'use client';

import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer,  } from 'recharts';
import { statusDistribution } from '@/data/journalEntryData';

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number; payload: { color: string } }> }) {
  if (!active || !payload || payload.length === 0) return null;
  const item = payload[0];
  return (
    <div className="bg-card border border-border rounded-lg shadow-elevated px-3 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.payload.color }} />
        <span className="font-700 text-foreground">{item.name}</span>
      </div>
      <p className="text-muted-foreground mt-0.5">{item.value} entries</p>
    </div>
  );
}

export default function StatusDistributionChart() {
  return (
    <div>
      <ResponsiveContainer width="100%" height={160}>
        <PieChart>
          <Pie
            data={statusDistribution}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={70}
            paddingAngle={3}
            dataKey="value"
          >
            {statusDistribution.map((entry) => (
              <Cell key={`cell-status-${entry.name}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
        </PieChart>
      </ResponsiveContainer>
      <div className="space-y-1.5 mt-2">
        {statusDistribution.map((item) => (
          <div key={`legend-status-${item.name}`} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
              <span className="text-muted-foreground">{item.name}</span>
            </div>
            <span className="font-700 text-foreground tabular-nums">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}