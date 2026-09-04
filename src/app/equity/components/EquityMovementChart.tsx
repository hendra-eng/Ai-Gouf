'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,  } from 'recharts';
import type { EquityWaterfallStep } from '../lib/useEquityData';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat EquityContent.tsx
// (useEquityData()) untuk sumber data ASLI client aktif. Versi ASLI cuma
// punya 2 komponen (Net Profit + Other Equity Movements digabung) karena
// trial_balance_bulanan tidak menyimpan jenis mutasi ekuitas per transaksi
// (dividen/setoran modal/revaluasi/OCI) -- lihat komentar di useEquityData.ts.
const mockWaterfallData: EquityWaterfallStep[] = [
  { name: 'Beginning Equity', value: 4290, type: 'base' },
  { name: 'Net Profit', value: 1840, type: 'positive' },
  { name: 'Capital Injection', value: 0, type: 'neutral' },
  { name: 'Dividends Paid', value: -880, type: 'negative' },
  { name: 'Revaluation Gain', value: 50, type: 'positive' },
  { name: 'OCI Adjustments', value: -600, type: 'negative' },
  { name: 'Ending Equity', value: 4700, type: 'base' },
];

const TYPE_COLOR: Record<EquityWaterfallStep['type'], string> = {
  base: '#2563eb',
  positive: '#16a34a',
  negative: '#dc2626',
  neutral: '#64748b',
};

function buildChartData(steps: EquityWaterfallStep[]) {
  let runningCumulative = 0;
  return steps.map((d, i) => {
    if (d.type === 'base') {
      runningCumulative = d.value;
      return { ...d, cumulative: d.value, color: TYPE_COLOR[d.type], invisible: 0, display: d.value };
    }
    const before = runningCumulative;
    runningCumulative += d.value;
    const base = Math.min(before, runningCumulative);
    const display = Math.abs(d.value);
    return { ...d, cumulative: runningCumulative, color: TYPE_COLOR[d.type], invisible: base, display };
  });
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { payload: ReturnType<typeof buildChartData>[0] }[]; label?: string }) => {
  if (!active || !payload || !payload[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[180px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      <div className="flex justify-between gap-4">
        <span className="text-muted-foreground">Movement</span>
        <span className={`font-600 ${d.type === 'negative' ? 'text-negative' : d.type === 'positive' ? 'text-positive' : 'text-primary'}`}>
          {d.type === 'negative' ? '-' : d.type === 'positive' ? '+' : ''}Rp {Math.abs(d.value).toLocaleString('id-ID')}M
        </span>
      </div>
      <div className="flex justify-between gap-4 mt-1">
        <span className="text-muted-foreground">Cumulative</span>
        <span className="font-600 text-foreground">Rp {d.cumulative.toLocaleString('id-ID')}M</span>
      </div>
    </div>
  );
};

interface EquityMovementChartProps {
  steps?: EquityWaterfallStep[];
  periodLabel?: string;
}

export default function EquityMovementChart({ steps, periodLabel }: EquityMovementChartProps) {
  const source = steps && steps.length > 0 ? steps : mockWaterfallData;
  const chartData = buildChartData(source);
  const maxCumulative = Math.max(...chartData.map((d) => Math.max(d.cumulative, (d as any).invisible + (d as any).display)));
  const yMax = Math.ceil((maxCumulative * 1.1) / 500) * 500 || 500;

  return (
    <div className="fin-card p-5">
      <div className="mb-4">
        <div className="text-[14px] font-600 text-foreground">Equity Movement (Waterfall)</div>
        <div className="text-[11px] text-muted-foreground">Beginning to ending equity{periodLabel ? ` — ${periodLabel}` : ' — Jan–Aug 2026'}</div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            angle={-35}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}M`}
            domain={[0, yMax]}
          />
          <Tooltip content={<CustomTooltip />} />
          {/* Invisible base bar */}
          <Bar dataKey="invisible" stackId="a" fill="transparent" radius={[0, 0, 0, 0]} />
          {/* Visible delta bar */}
          <Bar dataKey="display" stackId="a" radius={[3, 3, 0, 0]} name="Movement">
            {chartData.map((entry, i) => (
              <Cell key={`waterfall-cell-${i}`} fill={entry.color} opacity={entry.type === 'base' ? 0.9 : 0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 pt-3 border-t border-border flex-wrap">
        {[
          { label: 'Beginning/Ending', color: '#2563eb' },
          { label: 'Increase', color: '#16a34a' },
          { label: 'Decrease', color: '#dc2626' },
          { label: 'Adjustment', color: '#d97706' },
        ].map(l => (
          <div key={`wf-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-3 rounded-sm inline-block" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
