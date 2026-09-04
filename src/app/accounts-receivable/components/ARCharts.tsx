'use client';
import React, { useState } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { formatRupiah, type Customer } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type { arAgingFromInvoices, arTrendFromInvoices } from '@/app/transactions/lib/arBridge';

// [DIUBAH] Data chart di sini SEKARANG diterima lewat props dari ARContent
// (hasil turunan transaksi Sales via arBridge.ts) — sebelumnya file ini
// import langsung array statis dari @/lib/mockData (arAgingData, arTrendData,
// dsoTrendData), terputus total dari transaksi Sales yang sesungguhnya.
// Polanya sama persis dengan APCharts.tsx.
interface ARChartsProps {
  agingData: ReturnType<typeof arAgingFromInvoices>;
  trendData: ReturnType<typeof arTrendFromInvoices>;
  customers: Customer[];
  totalAR: number;
  overdueAR: number;
  dso: number;
}

const fmt = (v: number) => `${(v / 1000000).toFixed(0)}M`;

const CustomTooltip = ({ active, payload, label }: any) => {
  const { fx } = useCurrency();
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={`artt-${i}`} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke || p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground">
            {typeof p.value === 'number' && p.value > 1000 ? fx(`Rp ${(p.value / 1000000).toFixed(0)}M`) : `${p.value}d`}
          </span>
        </div>
      ))}
    </div>
  );
};

const CONCENTRATION_COLORS = ['#DC2626', '#D97706', '#2563EB', '#16A34A', '#94A3B8'];

/** Top 4 customer by AR + sisanya digabung "Others" — pengganti array
 * customerConcentration yang dulu hardcoded 5 nama tetap. */
function concentrationFromCustomers(customers: Customer[]) {
  const totalAR = customers.reduce((s, c) => s + c.totalAR, 0) || 1;
  const sorted = [...customers].sort((a, b) => b.totalAR - a.totalAR);
  const top4 = sorted.slice(0, 4);
  const othersAmount = sorted.slice(4).reduce((s, c) => s + c.totalAR, 0);

  const rows = top4.map((c) => ({
    name: c.name,
    amount: c.totalAR,
    value: Math.round((c.totalAR / totalAR) * 1000) / 10,
  }));
  if (othersAmount > 0) {
    rows.push({ name: 'Others', amount: othersAmount, value: Math.round((othersAmount / totalAR) * 1000) / 10 });
  }
  return rows;
}

export default function ARCharts({ agingData, trendData, customers, totalAR, overdueAR, dso }: ARChartsProps) {
  const [trendPeriod, setTrendPeriod] = useState<'6M' | 'YTD'>('YTD');
  const { fx } = useCurrency();

  const customerConcentration = concentrationFromCustomers(customers);

  // [BARU] DSO Trend tidak lagi array statis (dsoTrendData) -- backend belum
  // punya histori DSO bulanan tersendiri, jadi di sini diaproksimasi dari
  // closingAR/newInvoices bulan berjalan (arTrendFromInvoices), mengikuti
  // gaya heuristik yang sama seperti probabilitas di collectionForecastFromInvoices
  // (arBridge.ts). Aproksimasi ini murni untuk visualisasi tren, BUKAN angka
  // DSO resmi -- angka DSO resmi tetap dari kpiValues.dso (dihitung penuh di
  // arKpisFromInvoices, dipakai untuk KPI card & label "Current DSO" di bawah).
  const dsoTrend = trendData.map((t) => ({
    month: t.month,
    dso: t.newInvoices > 0 ? Math.round((t.closingAR / t.newInvoices) * 30) : dso,
  }));

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* AR Aging Bar */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-semibold text-foreground">AR Aging Analysis</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Total AR: {fx(formatRupiah(totalAR, true))} outstanding</p>
          </div>
          <span className="text-xs text-danger font-medium bg-danger-bg px-2 py-1 rounded-full">{fx(formatRupiah(overdueAR, true))} overdue</span>
        </div>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {agingData.map((d) => (
            <div key={`aging-bar-${d.bucket}`} className="text-center">
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
                <Cell key={`aging-cell-${index}`} fill={entry.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Customer Concentration */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-1">Customer Concentration</h3>
        <p className="text-xs text-muted-foreground mb-4">Top customers by AR balance</p>
        {customerConcentration.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">Belum ada data piutang</p>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={customerConcentration} cx="50%" cy="50%" innerRadius={44} outerRadius={68} paddingAngle={2} dataKey="value">
                  {customerConcentration.map((_, i) => (
                    <Cell key={`conc-cell-${i}`} fill={CONCENTRATION_COLORS[i % CONCENTRATION_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: any) => [`${v}%`, '']} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {customerConcentration.map((c, i) => (
                <div key={`conc-leg-${i}`} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: CONCENTRATION_COLORS[i % CONCENTRATION_COLORS.length] }} />
                    <span className="text-muted-foreground truncate">{c.name}</span>
                  </div>
                  <span className="font-semibold text-foreground ml-2 flex-shrink-0">{c.value}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* AR Trend */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-semibold text-foreground">Receivables Trend</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly AR movement</p>
          </div>
          <div className="flex gap-1">
            {(['6M', 'YTD'] as const).map((p) => (
              <button
                key={`artperiod-${p}`}
                onClick={() => setTrendPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${trendPeriod === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={trendData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
        <h3 className="text-md font-semibold text-foreground mb-1">DSO Trend</h3>
        <p className="text-xs text-muted-foreground mb-4">Days Sales Outstanding (perkiraan bulanan)</p>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={dsoTrend} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={30} unit="d" />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="dso" name="DSO" stroke="var(--warning)" strokeWidth={2} dot={{ fill: 'var(--warning)', r: 3 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Target DSO</span>
          <span className="font-semibold text-success">≤ 35 days</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">Current DSO</span>
          <span className={`font-semibold ${dso > 35 ? 'text-warning' : 'text-success'}`}>{dso} days</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-muted-foreground">Variance</span>
          <span className={`font-semibold ${dso > 35 ? 'text-danger' : 'text-success'}`}>
            {dso > 35 ? `+${dso - 35} days over target` : `${35 - dso} days under target`}
          </span>
        </div>
      </div>
    </div>
  );
}