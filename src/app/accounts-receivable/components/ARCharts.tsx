'use client';
import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { arAgingData, arTrendData, dsoTrendData, formatRupiah } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

const fmt = (v: number) => `${(v / 1000000).toFixed(0)}M`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-600 text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`artt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-600 text-foreground">
            {typeof p.value === 'number' && p.value > 1000 ? fx(`Rp ${(p.value / 1000000).toFixed(0)}M`) : `${p.value}d`}
          </span>
        </div>
      ))}
    </div>
  );
};

const customerConcentration = [
  { name: 'PT Mitra Solusi Digital', value: 25.8, amount: 320000000 },
  { name: 'PT Sinar Harapan Nusantara', value: 17.3, amount: 215000000 },
  { name: 'CV Berkah Mandiri', value: 16.0, amount: 198000000 },
  { name: 'PT Global Teknindo', value: 11.5, amount: 142000000 },
  { name: 'Others', value: 29.4, amount: 365000000 },
];
const concentrationColors = ['#DC2626', '#D97706', '#2563EB', '#16A34A', '#94A3B8'];

export default function ARCharts() {
  const [trendPeriod, setTrendPeriod] = useState<'6M' | 'YTD'>('YTD');
  const { fx } = useCurrency();

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* AR Aging Bar */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-600 text-foreground">AR Aging Analysis</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Total AR: {fx('Rp 1.24B')} outstanding</p>
          </div>
          <span className="text-xs text-danger font-500 bg-danger-bg px-2 py-1 rounded-full">{fx('Rp 320M')} overdue</span>
        </div>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {arAgingData.map((d) => (
            <div key={`aging-bar-${d.bucket}`} className="text-center">
              <div className="h-1 rounded-full mb-2" style={{ background: d.color }} />
              <p className="text-2xs font-600 text-foreground tabular-nums">{fx(formatRupiah(d.amount, true))}</p>
              <p className="text-2xs text-muted-foreground">{d.percentage}%</p>
              <p className="text-2xs text-muted-foreground mt-0.5">{d.bucket}</p>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={arAgingData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
              {arAgingData.map((entry, index) => (
                <Cell key={`aging-cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Customer Concentration */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-1">Customer Concentration</h3>
        <p className="text-xs text-muted-foreground mb-4">Top 5 customers by AR balance</p>
        <ResponsiveContainer width="100%" height={160}>
          <PieChart>
            <Pie data={customerConcentration} cx="50%" cy="50%" innerRadius={44} outerRadius={68} paddingAngle={2} dataKey="value">
              {customerConcentration.map((_, i) => (
                <Cell key={`conc-cell-${i}`} fill={concentrationColors[i]} />
              ))}
            </Pie>
            <Tooltip formatter={(v: any) => [`${v}%`, '']} />
          </PieChart>
        </ResponsiveContainer>
        <div className="space-y-1.5 mt-2">
          {customerConcentration.map((c, i) => (
            <div key={`conc-leg-${i}`} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: concentrationColors[i] }} />
                <span className="text-muted-foreground truncate">{c.name}</span>
              </div>
              <span className="font-600 text-foreground ml-2 flex-shrink-0">{c.value}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* AR Trend */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-600 text-foreground">Receivables Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly AR movement Jan–Aug 2026</p>
          </div>
          <div className="flex gap-1">
            {(['6M', 'YTD'] as const).map((p) => (
              <button
                key={`artperiod-${p}`}
                onClick={() => setTrendPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-md font-500 transition-colors ${trendPeriod === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={arTrendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradNewInv" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradCollect" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--success)" stopOpacity={0.12} />
                <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Area type="monotone" dataKey="newInvoices" name="New Invoices" stroke="var(--primary)" strokeWidth={2} fill="url(#gradNewInv)" />
            <Area type="monotone" dataKey="collections" name="Collections" stroke="var(--success)" strokeWidth={2} fill="url(#gradCollect)" />
            <Line type="monotone" dataKey="closingAR" stroke="var(--warning)" strokeWidth={1.5} strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* DSO Trend */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-1">DSO Trend</h3>
        <p className="text-xs text-muted-foreground mb-4">Days Sales Outstanding — Jan–Aug 2026</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={dsoTrendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={30} unit="d" />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="dso" name="DSO" stroke="var(--warning)" strokeWidth={2} dot={{ fill: 'var(--warning)', r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Target DSO</span>
          <span className="font-600 text-success">≤ 35 days</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">Current DSO</span>
          <span className="font-600 text-warning">42 days</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">Variance</span>
          <span className="font-600 text-danger">+7 days over target</span>
        </div>
      </div>
    </div>
  );
}