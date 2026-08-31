'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/assets/depreciation?period=...
const monthlyDepreciation = [
  { month: 'Jan', amount: 44.2 },
  { month: 'Feb', amount: 44.2 },
  { month: 'Mar', amount: 47.8 },
  { month: 'Apr', amount: 47.8 },
  { month: 'May', amount: 52.4 },
  { month: 'Jun', amount: 52.4 },
  { month: 'Jul', amount: 56.1 },
  { month: 'Aug', amount: 56.1 },
];

const nearlyDepreciated = [
  { id: 'FA-2024-010', name: 'Printer Xerox C8000', nbv: 'Rp 9.6M', remaining: '8 months', pct: 88 },
  { id: 'FA-2024-004', name: 'Laptop MacBook Pro M3', nbv: 'Rp 18.2M', remaining: '14 months', pct: 76 },
  { id: 'FA-2024-005', name: 'Mesin Produksi CNC-X200', nbv: 'Rp 106M', remaining: '16 months', pct: 67 },
  { id: 'FA-2024-012', name: 'CCTV System 48 kamera', nbv: 'Rp 39M', remaining: '22 months', pct: 60 },
  { id: 'FA-2024-007', name: 'Honda CRV 2021', nbv: 'Rp 370M', remaining: '38 months', pct: 23 },
];

const summaryStats = [
  { label: 'Depreciation This Period', value: 'Rp 56.1M', sub: 'Aug 2026' },
  { label: 'Accumulated Depreciation', value: 'Rp 410M', sub: 'All fixed assets' },
  { label: 'Remaining Book Value', value: 'Rp 1.85B', sub: 'Net book value' },
  { label: 'Assets Near Full Depr.', value: '7 assets', sub: 'Within 24 months' },
];

export default function DepreciationSection() {
  const { fx } = useCurrency();
  const [hoveredBar, setHoveredBar] = useState<string | null>(null);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Chart + Summary */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-[14px] font-600 text-foreground">Depreciation Analysis</div>
            <div className="text-[11px] text-muted-foreground">Monthly depreciation expense — Jan–Aug 2026</div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {summaryStats.map((s, i) => (
            <div key={`depr-stat-${i}`} className="bg-muted/50 rounded-lg p-3">
              <div className="text-[10px] font-600 text-muted-foreground uppercase tracking-wide mb-1">{s.label}</div>
              <div className="text-[16px] font-700 text-foreground financial-value">{fx(s.value)}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</div>
            </div>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={monthlyDepreciation} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
              formatter={(v: number) => [fx(`Rp ${v}M`), 'Depreciation']}
            />
            <Bar dataKey="amount" fill="var(--primary)" radius={[3, 3, 0, 0]} opacity={0.85} name="Monthly Depreciation" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Nearly Depreciated */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Assets Near Full Depreciation</div>
        <div className="text-[11px] text-muted-foreground mb-4">Approaching end of useful life</div>
        <div className="space-y-3">
          {nearlyDepreciated.map(asset => (
            <div
              key={`near-depr-${asset.id}`}
              className="group cursor-pointer"
              onClick={() => toast.info(`Membuka detail aset ${asset.id}`)}
            >
              <div className="flex items-start justify-between mb-1">
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-500 text-foreground truncate">{asset.name}</div>
                  <div className="text-[10px] text-muted-foreground">{asset.id} · NBV: {fx(asset.nbv)}</div>
                </div>
                <div className="text-[11px] font-600 text-foreground ml-2 shrink-0">{asset.remaining}</div>
              </div>
              <div className="w-full bg-muted rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full transition-all"
                  style={{
                    width: `${asset.pct}%`,
                    background: asset.pct > 80 ? 'var(--negative)' : asset.pct > 60 ? 'var(--warning)' : 'var(--primary)',
                  }}
                />
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{asset.pct}% depreciated</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
