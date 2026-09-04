'use client';
import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { MonthlyAbsoluteRow } from '../lib/useAnalyticsData';

// [BARU] Data chart sekarang datang dari `monthlyAbsoluteTrend` (real, via
// useAnalyticsData) atau data contoh dengan bentuk identik -- lihat
// TrendExplorer.tsx. BASE_DATA hardcoded lama sudah dihapus; FIELD_MAP di
// bawah cuma memetakan label metric (yang dipilih user) ke field di
// MonthlyAbsoluteRow.
const FIELD_MAP: Record<string, keyof MonthlyAbsoluteRow> = {
  'Revenue': 'revenue', 'COGS': 'cogs', 'Gross Profit': 'grossProfit', 'EBITDA': 'ebitda', 'Net Profit': 'netProfit',
  'Cash': 'cash', 'AR': 'ar', 'AP': 'ap', 'Assets': 'assets', 'Liabilities': 'liabilities', 'Equity': 'equity',
};

const COLORS = ['var(--primary)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

interface Props { selected: string[]; horizon: string; data: MonthlyAbsoluteRow[]; }

// Filter rows sesuai horizon yang dipilih. Data selalu terurut kronologis
// (lama -> baru). "YTD" = sejak kemunculan "Jan" TERAKHIR di data (real data
// dari backend memang sudah otomatis mulai dari Jan tahun berjalan).
function filterByHorizon(rows: MonthlyAbsoluteRow[], horizon: string): MonthlyAbsoluteRow[] {
  if (rows.length === 0) return rows;
  if (horizon === '6M') return rows.slice(-6);
  if (horizon === '12M') return rows.slice(-12);
  if (horizon === '3Y') return rows.slice(-36);
  if (horizon === 'YTD') {
    const lastJan = rows.map((r) => r.month.startsWith('Jan')).lastIndexOf(true);
    return lastJan >= 0 ? rows.slice(lastJan) : rows;
  }
  return rows;
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated min-w-[160px]">
      <p className="text-xs font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        <div key={`tex-tt-${i}`} className="flex justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-xs text-muted-foreground">{p.name}</span>
          </div>
          <span className="text-xs font-semibold tabular-nums text-foreground">{p.value}M</span>
        </div>
      ))}
    </div>
  );
};

export default function TrendExplorerChartInner({ selected, horizon, data: rows }: Props) {
  const filtered = filterByHorizon(rows, horizon);

  const data = filtered.map((row) => {
    const entry: Record<string, string | number> = { month: row.month };
    selected.forEach((metric) => {
      const field = FIELD_MAP[metric];
      entry[metric] = field ? row[field] : 0;
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