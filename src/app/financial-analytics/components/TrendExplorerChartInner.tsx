'use client';
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const BASE_DATA: Record<string, number[]> = {
  'Revenue': [680, 712, 748, 692, 780, 842, 818, 702, 820, 864, 892, 920],
  'COGS': [374, 392, 411, 381, 429, 463, 450, 386, 451, 475, 490, 506],
  'Gross Profit': [306, 320, 337, 311, 351, 379, 368, 316, 369, 389, 402, 414],
  'EBITDA': [176, 188, 198, 172, 204, 228, 218, 177, 208, 224, 236, 244],
  'Net Profit': [138, 148, 158, 132, 162, 182, 174, 141, 166, 178, 188, 196],
  'Cash': [2420, 2480, 2560, 2620, 2700, 2780, 2840, 2960, 3020, 3080, 3140, 3200],
  'AR': [1020, 1060, 1120, 1080, 1140, 1200, 1180, 1240, 1260, 1280, 1300, 1320],
  'AP': [780, 800, 820, 810, 840, 860, 850, 860, 870, 880, 890, 900],
  'Assets': [11800, 11900, 12000, 12100, 12200, 12400, 12500, 12800, 12900, 13000, 13100, 13200],
  'Liabilities': [4100, 4120, 4140, 4160, 4180, 4200, 4190, 4200, 4210, 4220, 4230, 4240],
  'Equity': [7700, 7780, 7860, 7940, 8020, 8200, 8310, 8600, 8690, 8780, 8870, 8960],
};

const MONTHS_12 = ['Sep\'25', 'Oct', 'Nov', 'Dec', 'Jan\'26', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];
const MONTHS_6 = ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'];

const COLORS = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

interface Props { selected: string[]; horizon: string; }

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated min-w-[160px]">
      <p className="text-xs font-600 text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`tex-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-xs text-muted-foreground">{p.name}</span>
          </div>
          <span className="text-xs font-600 font-tabular text-foreground">{p.value}M</span>
        </div>
      ))}
    </div>
  );
};

export default function TrendExplorerChartInner({ selected, horizon }: Props) {
  const months = horizon === '6M' ? MONTHS_6 : MONTHS_12;
  const startIdx = horizon === '6M' ? 6 : 0;

  const data = months.map((m, i) => {
    const entry: Record<string, string | number> = { month: m };
    selected.forEach((metric) => {
      const series = BASE_DATA[metric] || [];
      entry[metric] = series[startIdx + i] || 0;
    });
    return entry;
  });

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--muted-foreground)', fontSize: 10 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}M`}
          width={50}
        />
        <Tooltip content={<CustomTooltip />} />
        {selected.map((metric, i) => (
          <Line
            key={`trend-line-${metric}`}
            type="monotone"
            dataKey={metric}
            stroke={COLORS[i]}
            strokeWidth={2}
            dot={{ fill: COLORS[i], r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5 }}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
