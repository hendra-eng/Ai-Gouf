'use client';
import React, { useState } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import type { LiabTrendRow, LiabCompositionSlice } from '../lib/useLiabilitiesData';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat LiabilitiesContent.tsx
// (useLiabilitiesData()) untuk sumber data ASLI client aktif.
const mockCompositionData: LiabCompositionSlice[] = [
  { name: 'Accounts Payable', value: 860, pct: 40.2, color: '#2563eb' },
  { name: 'Tax Payable', value: 182, pct: 8.5, color: '#d97706' },
  { name: 'Accrued Expenses', value: 118, pct: 5.5, color: '#16a34a' },
  { name: 'Short-Term Debt', value: 240, pct: 11.2, color: '#0891b2' },
  { name: 'Long-Term Debt', value: 620, pct: 29.0, color: '#7c3aed' },
  { name: 'Lease Liabilities', value: 80, pct: 3.7, color: '#be185d' },
  { name: 'Other Liabilities', value: 40, pct: 1.9, color: '#64748b' },
];

const mockTrendData: LiabTrendRow[] = [
  { month: 'Jan', total: 1800, current: 1050, nonCurrent: 750 },
  { month: 'Feb', total: 1840, current: 1080, nonCurrent: 760 },
  { month: 'Mar', total: 1880, current: 1100, nonCurrent: 780 },
  { month: 'Apr', total: 1920, current: 1130, nonCurrent: 790 },
  { month: 'May', total: 1960, current: 1160, nonCurrent: 800 },
  { month: 'Jun', total: 2000, current: 1190, nonCurrent: 810 },
  { month: 'Jul', total: 2080, current: 1240, nonCurrent: 840 },
  { month: 'Aug', total: 2140, current: 1280, nonCurrent: 860 },
];

const periodOptions = ['6M', 'YTD', '12M', '3Y'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[160px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={`liab-tt-${i}`} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-600" style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}M</span>
        </div>
      ))}
    </div>
  );
};

interface LiabilitiesChartsSectionProps {
  trendData?: LiabTrendRow[];
  compositionData?: LiabCompositionSlice[];
  companyName?: string | null;
  periodLabel?: string;
}

export default function LiabilitiesChartsSection({ trendData, compositionData, companyName, periodLabel }: LiabilitiesChartsSectionProps) {
  const [activePeriod, setActivePeriod] = useState('YTD');
  const trend = trendData && trendData.length > 0 ? trendData : mockTrendData;
  const composition = compositionData && compositionData.length > 0 ? compositionData : mockCompositionData;
  const subtitle = companyName ? `Monthly liability values — ${companyName}` : 'Monthly liability values — PT Nusantara Teknologi Indonesia';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Trend */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[14px] font-600 text-foreground">Total Liabilities Trend</div>
            <div className="text-[11px] text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex gap-1">
            {periodOptions.map(p => (
              <button
                key={`liab-period-${p}`}
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
              <linearGradient id="totalLiabGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#dc2626" stopOpacity={0.12} />
                <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="currLiabGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.08} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="total" stroke="#dc2626" fill="url(#totalLiabGrad)" strokeWidth={2} name="Total Liabilities" />
            <Area type="monotone" dataKey="current" stroke="var(--primary)" fill="url(#currLiabGrad)" strokeWidth={1.5} name="Current Liabilities" />
            <Area type="monotone" dataKey="nonCurrent" stroke="#7c3aed" fill="none" strokeWidth={1.5} strokeDasharray="4 2" name="Non-Current Liabilities" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          {[
            { label: 'Total Liabilities', color: '#dc2626' },
            { label: 'Current Liabilities', color: 'var(--primary)' },
            { label: 'Non-Current Liabilities', color: '#7c3aed' },
          ].map(l => (
            <div key={`liab-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-3 h-0.5 inline-block rounded" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Composition */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Liability Composition</div>
        <div className="text-[11px] text-muted-foreground mb-4">By category{periodLabel ? ` — ${periodLabel}` : ' — Aug 2026'}</div>
        <div className="flex justify-center">
          <PieChart width={180} height={180}>
            <Pie data={composition} cx={85} cy={85} innerRadius={52} outerRadius={82} dataKey="value" paddingAngle={2}>
              {composition.map((entry, i) => (
                <Cell key={`liab-comp-cell-${i}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
              formatter={(v: number, name: string) => [`Rp ${v.toLocaleString('id-ID')}M (${composition.find(d => d.name === name)?.pct ?? 0}%)`, name]}
            />
          </PieChart>
        </div>
        <div className="space-y-1.5 mt-2">
          {composition.map((d, i) => (
            <div key={`liab-comp-legend-${i}`} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: d.color }} />
                <span className="text-muted-foreground truncate">{d.name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-muted-foreground">{d.pct}%</span>
                <span className="font-600 text-foreground financial-value">Rp {d.value.toLocaleString('id-ID')}M</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
