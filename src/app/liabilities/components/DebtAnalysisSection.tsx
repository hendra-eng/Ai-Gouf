'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/liabilities/debt-analysis?period=...
const maturityData = [
  { bucket: '≤30 days', amount: 182, color: '#dc2626' },
  { bucket: '31–90 days', amount: 340, color: '#d97706' },
  { bucket: '3–6 months', amount: 280, color: '#f59e0b' },
  { bucket: '6–12 months', amount: 458, color: '#2563eb' },
  { bucket: '1–3 years', amount: 520, color: '#7c3aed' },
  { bucket: '3+ years', amount: 360, color: '#16a34a' },
];

const debtMetrics = [
  { label: 'Total Debt', value: 'Rp 860M', sub: 'Short + Long-term' },
  { label: 'Short-Term Debt', value: 'Rp 240M', sub: '27.9% of total debt' },
  { label: 'Long-Term Debt', value: 'Rp 620M', sub: '72.1% of total debt' },
  { label: 'Debt-to-Equity', value: '0.18x', sub: 'Healthy leverage' },
  { label: 'Interest Coverage', value: '12.7x', sub: 'EBIT / Interest Exp' },
  { label: 'Interest Expense', value: 'Rp 48.2M', sub: 'YTD 2026' },
];

export default function DebtAnalysisSection() {
  const { fx } = useCurrency();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Debt Maturity Chart */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="mb-4">
          <div className="text-[14px] font-600 text-foreground">Debt Maturity Profile</div>
          <div className="text-[11px] text-muted-foreground">Upcoming obligation schedule — PT Nusantara Teknologi Indonesia</div>
        </div>

        {/* Urgency callout */}
        <div className="flex items-center gap-2 bg-negative-subtle border border-red-200 rounded-lg px-3 py-2 mb-4">
          <span className="w-2 h-2 rounded-full bg-negative inline-block" />
          <span className="text-[12px] font-600 text-negative">{fx('Rp 182M due within 30 days')}</span>
          <span className="text-[11px] text-muted-foreground ml-1">— Tax payable due 8 Sep 2026</span>
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={maturityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
              formatter={(v: number) => [fx(`Rp ${v.toLocaleString('id-ID')}M`), 'Obligations']}
            />
            <Bar dataKey="amount" radius={[3, 3, 0, 0]} name="Obligations">
              {maturityData.map((entry, i) => (
                <Cell key={`maturity-cell-${i}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Debt Metrics */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Debt Analysis</div>
        <div className="text-[11px] text-muted-foreground mb-4">Key debt ratios and metrics</div>
        <div className="space-y-3">
          {debtMetrics.map((m, i) => (
            <div key={`debt-metric-${i}`} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
              <div>
                <div className="text-[12px] font-500 text-foreground">{m.label}</div>
                <div className="text-[10px] text-muted-foreground">{m.sub}</div>
              </div>
              <div className="text-[14px] font-700 text-foreground financial-value">{fx(m.value)}</div>
            </div>
          ))}
        </div>

        {/* D/E Ratio visual */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] font-600 text-muted-foreground mb-2">Debt-to-Equity Ratio</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted rounded-full h-2">
              <div className="h-2 rounded-full bg-primary" style={{ width: '18%' }} />
            </div>
            <span className="text-[11px] font-600 text-positive">0.18x — Healthy</span>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
            <span>0x</span>
            <span>Threshold: 1.0x</span>
          </div>
        </div>
      </div>
    </div>
  );
}
