'use client';
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { EquityTrendRow } from '../lib/useEquityData';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat EquityContent.tsx
// (useEquityData()) untuk sumber data ASLI client aktif.
const mockTrendData: EquityTrendRow[] = [
  { month: 'Jan', total: 3800, retained: 900, capital: 3000 },
  { month: 'Feb', total: 3920, retained: 950, capital: 3000 },
  { month: 'Mar', total: 4050, retained: 1000, capital: 3000 },
  { month: 'Apr', total: 4120, retained: 1050, capital: 3000 },
  { month: 'May', total: 4280, retained: 1100, capital: 3000 },
  { month: 'Jun', total: 4420, retained: 1160, capital: 3000 },
  { month: 'Jul', total: 4550, retained: 1200, capital: 3000 },
  { month: 'Aug', total: 4700, retained: 1240, capital: 3000 },
];

const periodOptions = ['6M', 'YTD', '12M', '3Y'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[160px]">
      <div className="font-600 text-foreground mb-2">{label} 2026</div>
      {payload.map((p, i) => (
        <div key={`eq-tt-${i}`} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-600" style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}M</span>
        </div>
      ))}
    </div>
  );
};

interface EquityTrendChartProps {
  trendData?: EquityTrendRow[];
  companyName?: string | null;
}

export default function EquityTrendChart({ trendData, companyName }: EquityTrendChartProps) {
  const [activePeriod, setActivePeriod] = useState('YTD');
  const trend = trendData && trendData.length > 0 ? trendData : mockTrendData;
  const subtitle = companyName ? `Monthly equity composition — ${companyName}` : 'Monthly equity composition — 2026';

  return (
    <div className="fin-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[14px] font-600 text-foreground">Total Equity Trend</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex gap-1">
          {periodOptions.map(p => (
            <button
              key={`eq-period-${p}`}
              onClick={() => setActivePeriod(p)}
              className={`px-2.5 py-1 text-[11px] font-500 rounded transition-colors ${activePeriod === p ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="totalEqGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="retainedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.1} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="url(#totalEqGrad)" strokeWidth={2} name="Total Equity" />
          <Area type="monotone" dataKey="retained" stroke="#16a34a" fill="url(#retainedGrad)" strokeWidth={1.5} name="Retained Earnings" />
          <Area type="monotone" dataKey="capital" stroke="#7c3aed" fill="none" strokeWidth={1.5} strokeDasharray="4 2" name="Paid-in Capital" />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
        {[
          { label: 'Total Equity', color: 'var(--primary)' },
          { label: 'Retained Earnings', color: '#16a34a' },
          { label: 'Paid-in Capital', color: '#7c3aed' },
        ].map(l => (
          <div key={`eq-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-0.5 inline-block rounded" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}
