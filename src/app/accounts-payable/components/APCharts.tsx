'use client';
import React, { useState } from 'react';
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatRupiah, type Vendor } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type { apAgingFromBills, apTrendFromBills, paymentForecastFromBills } from '@/app/transactions/lib/apBridge';

// [DIUBAH] Data chart di sini SEKARANG diterima lewat props dari APContent
// (hasil turunan transaksi Expense via apBridge.ts) — sebelumnya file ini
// import langsung array statis dari @/lib/mockData, terputus total dari
// transaksi Expense yang sesungguhnya.
interface APChartsProps {
  agingData: ReturnType<typeof apAgingFromBills>;
  trendData: ReturnType<typeof apTrendFromBills>;
  forecastData: ReturnType<typeof paymentForecastFromBills>;
  vendors: Vendor[];
  totalAP: number;
  overdueAP: number;
}

const fmt = (v: number) => `${(v / 1000000).toFixed(0)}M`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`aptt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">
            {typeof p.value === 'number' && p.value > 1000 ? fx(`Rp ${(p.value / 1000000).toFixed(0)}M`) : p.value}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function APCharts({ agingData, trendData, forecastData, vendors, totalAP, overdueAP }: APChartsProps) {
  const [trendPeriod, setTrendPeriod] = useState<'6M' | 'YTD'>('YTD');
  const { fx } = useCurrency();

  const topVendors = vendors.slice(0, 6).map((v) => ({ name: v.name.replace('PT ', '').replace('CV ', ''), amount: v.totalAP }));
  const thisMonthForecast = forecastData.find((pf) => pf.period === 'This Month')?.amount || 0;
  const maxForecastAmount = Math.max(1, ...forecastData.map((pf) => pf.amount));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* AP Aging Bar */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-semibold text-foreground">AP Aging Analysis</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Total AP: {fx(formatRupiah(totalAP, true))} outstanding</p>
          </div>
          <span className="text-xs text-danger font-medium bg-danger-bg px-2 py-1 rounded-full">{fx(formatRupiah(overdueAP, true))} overdue</span>
        </div>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {agingData.map((d) => (
            <div key={`ap-aging-${d.bucket}`} className="text-center">
              <div className="h-1 rounded-full mb-2" style={{ background: d.color }} />
              <p className="text-2xs font-semibold text-foreground tabular-nums">{fx(formatRupiah(d.amount, true))}</p>
              <p className="text-2xs text-muted-foreground">{d.percentage}%</p>
              <p className="text-2xs text-muted-foreground mt-0.5">{d.bucket}</p>
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={agingData} margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="bucket" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="amount" name="Amount" radius={[3, 3, 0, 0]}>
              {agingData.map((entry, index) => (
                <Cell key={`ap-aging-cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Payment Forecast */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-1">Upcoming Payment Obligations</h3>
        <p className="text-xs text-muted-foreground mb-4">Cash requirement by period</p>
        <div className="space-y-3">
          {forecastData.map((pf) => (
            <div key={`apf-${pf.period}`} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="font-medium text-foreground">{pf.period}</span>
                <span className="tabular-nums font-semibold">{fx(formatRupiah(pf.amount, true))}</span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full"
                  style={{ width: `${(pf.amount / maxForecastAmount) * 100}%` }}
                />
              </div>
              <p className="text-2xs text-muted-foreground">{pf.bills} bill{pf.bills !== 1 ? 's' : ''} pending</p>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground font-medium">Total 30-day obligation</span>
            <span className="font-bold text-foreground tabular-nums">{fx(formatRupiah(thisMonthForecast, true))}</span>
          </div>
        </div>
      </div>

      {/* AP Trend */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-semibold text-foreground">AP Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pergerakan AP bulanan — dari transaksi Expense</p>
          </div>
          <div className="flex gap-1">
            {(['6M', 'YTD'] as const).map((p) => (
              <button
                key={`aptrend-${p}`}
                onClick={() => setTrendPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${trendPeriod === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {trendData.length === 0 ? (
          <p className="text-xs text-muted-foreground py-10 text-center">Belum ada transaksi Expense untuk ditampilkan.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradNewBills" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--warning)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--warning)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradPayments" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--success)" stopOpacity={0.12} />
                  <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area type="monotone" dataKey="newBills" name="New Bills" stroke="var(--warning)" strokeWidth={2} fill="url(#gradNewBills)" />
              <Area type="monotone" dataKey="payments" name="Payments Made" stroke="var(--success)" strokeWidth={2} fill="url(#gradPayments)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Vendor Exposure */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-1">Top Vendor Exposure</h3>
        <p className="text-xs text-muted-foreground mb-4">AP balance by vendor</p>
        {topVendors.length === 0 ? (
          <p className="text-xs text-muted-foreground py-10 text-center">Belum ada data vendor.</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={topVendors} layout="vertical" margin={{ top: 0, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tickFormatter={fmt} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={80} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="amount" name="AP Balance" fill="var(--primary)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}