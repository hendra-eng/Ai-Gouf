'use client';
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,  } from 'recharts';

// Backend integration point: replace with API call to /api/assets/charts?period=...
const compositionData = [
  { name: 'Cash & Bank', value: 2960, pct: 43.3, color: '#2563eb' },
  { name: 'Accounts Receivable', value: 1240, pct: 18.1, color: '#7c3aed' },
  { name: 'Inventory', value: 420, pct: 6.1, color: '#16a34a' },
  { name: 'Property & Equipment', value: 1200, pct: 17.5, color: '#d97706' },
  { name: 'Vehicles', value: 420, pct: 6.1, color: '#0891b2' },
  { name: 'Intangible Assets', value: 230, pct: 3.4, color: '#be185d' },
  { name: 'Other Assets', value: 370, pct: 5.4, color: '#64748b' },
];

const trendData = [
  { month: 'Jan', total: 5200, current: 3100, nonCurrent: 2100 },
  { month: 'Feb', total: 5450, current: 3250, nonCurrent: 2200 },
  { month: 'Mar', total: 5680, current: 3380, nonCurrent: 2300 },
  { month: 'Apr', total: 5820, current: 3450, nonCurrent: 2370 },
  { month: 'May', total: 6050, current: 3620, nonCurrent: 2430 },
  { month: 'Jun', total: 6280, current: 3750, nonCurrent: 2530 },
  { month: 'Jul', total: 6560, current: 3920, nonCurrent: 2640 },
  { month: 'Aug', total: 6840, current: 4120, nonCurrent: 2720 },
];

const periodOptions = ['6M', 'YTD', '12M', '3Y'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[160px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={`tt-${i}`} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-600" style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}M</span>
        </div>
      ))}
    </div>
  );
};

export default function AssetsChartsSection() {
  const [activePeriod, setActivePeriod] = useState('YTD');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Trend */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[14px] font-600 text-foreground">Total Assets Trend</div>
            <div className="text-[11px] text-muted-foreground">Monthly asset values — PT Nusantara Teknologi Indonesia</div>
          </div>
          <div className="flex gap-1">
            {periodOptions.map(p => (
              <button
                key={`assets-period-${p}`}
                onClick={() => setActivePeriod(p)}
                className={`px-2.5 py-1 text-[11px] font-500 rounded transition-colors ${activePeriod === p ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="totalAssetsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="currentAssetsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#16a34a" stopOpacity={0.1} />
                <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="url(#totalAssetsGrad)" strokeWidth={2} name="Total Assets" />
            <Area type="monotone" dataKey="current" stroke="#16a34a" fill="url(#currentAssetsGrad)" strokeWidth={1.5} name="Current Assets" />
            <Area type="monotone" dataKey="nonCurrent" stroke="#d97706" fill="none" strokeWidth={1.5} strokeDasharray="4 2" name="Non-Current Assets" />
          </AreaChart>
        </ResponsiveContainer>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          {[
            { label: 'Total Assets', color: 'var(--primary)' },
            { label: 'Current Assets', color: '#16a34a' },
            { label: 'Non-Current Assets', color: '#d97706' },
          ].map(l => (
            <div key={`assets-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-3 h-0.5 inline-block rounded" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Composition */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Asset Composition</div>
        <div className="text-[11px] text-muted-foreground mb-4">By category — Aug 2026</div>
        <div className="flex justify-center">
          <PieChart width={180} height={180}>
            <Pie data={compositionData} cx={85} cy={85} innerRadius={52} outerRadius={82} dataKey="value" paddingAngle={2}>
              {compositionData.map((entry, i) => (
                <Cell key={`comp-cell-${i}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
              formatter={(v: number, name: string) => [`Rp ${v.toLocaleString('id-ID')}M (${compositionData.find(d => d.name === name)?.pct ?? 0}%)`, name]}
            />
          </PieChart>
        </div>
        <div className="space-y-1.5 mt-2">
          {compositionData.map((d, i) => (
            <div key={`comp-legend-${i}`} className="flex items-center justify-between text-[11px]">
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
