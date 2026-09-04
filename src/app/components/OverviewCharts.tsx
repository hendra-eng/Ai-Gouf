'use client';
// [BARU] Sambungkan 2 chart di Financial Overview ke data ASLI client aktif
// -- sebelumnya kedua chart di sini (Revenue vs Expenses vs Net Profit, AR
// Aging Donut) 100% pakai array hardcoded (`revenueData`, `arAgingPie`)
// meskipun sumber data yang dibutuhkan SUDAH ADA & sudah dipakai halaman
// lain:
//   - Revenue/Expenses/Net Profit per bulan -> `useProfitLossData()`
//     (financial-statements/lib/useProfitLossData.ts), MONTHLY_PL -- sama
//     persis dengan yang dipakai chart P&L, cuma di sini expenses = jumlah
//     cogs+opEx+da+interest+tax (satu garis, bukan dipecah per komponen).
//   - AR Aging -> `useTransactions()` (transaksi Sales client aktif) diolah
//     lewat `invoicesFromTransactions` + `arAgingFromInvoices` dari
//     transactions/lib/arBridge.ts -- SAMA PERSIS dengan yang dipakai
//     halaman Account Receivable, supaya angkanya selalu konsisten dengan
//     AR Aging di halaman AR.
// Kalau belum ada client aktif / client belum ada jurnal & transaksi Sales
// sama sekali, kedua chart fallback ke data contoh (sama seperti versi
// sebelumnya) supaya halaman tidak pernah kosong.
import React, { useMemo, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import InteractiveAgingDonut, { AgingLivePreview } from './InteractiveAgingDonut';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useProfitLossData } from '@/app/financial-statements/lib/useProfitLossData';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, arAgingFromInvoices } from '@/app/transactions/lib/arBridge';

// ── Data contoh (fallback) -- dipakai saat belum ada client aktif / belum
// ada jurnal & transaksi Sales sama sekali, supaya tampilan sama seperti
// versi mock sebelumnya (tidak ada regresi saat demo tanpa data asli). ──
const SAMPLE_REVENUE = [
  { month: 'Jan', revenue: 950000000, expenses: 760000000, netProfit: 190000000 },
  { month: 'Feb', revenue: 1020000000, expenses: 790000000, netProfit: 230000000 },
  { month: 'Mar', revenue: 1080000000, expenses: 820000000, netProfit: 260000000 },
  { month: 'Apr', revenue: 1050000000, expenses: 840000000, netProfit: 210000000 },
  { month: 'May', revenue: 1120000000, expenses: 870000000, netProfit: 250000000 },
  { month: 'Jun', revenue: 1090000000, expenses: 860000000, netProfit: 230000000 },
  { month: 'Jul', revenue: 1150000000, expenses: 890000000, netProfit: 260000000 },
  { month: 'Aug', revenue: 1160000000, expenses: 920000000, netProfit: 240000000 },
];

// Values are in Jt (Rp million) units — converted to raw IDR before display.
const SAMPLE_AGING = [
  { name: 'Current', value: 620, color: '#16A34A' },
  { name: '1–30 Days', value: 215, color: '#2563EB' },
  { name: '31–60 Days', value: 168, color: '#D97706' },
  { name: '61–90 Days', value: 152, color: '#EA580C' },
  { name: '90+ Days', value: 85, color: '#DC2626' },
];
const SAMPLE_AGING_TOTAL = SAMPLE_AGING.reduce((s, a) => s + a.value, 0);

export default function OverviewCharts() {
  const [period, setPeriod] = useState<'6M' | 'YTD' | '12M' | '3Y'>('YTD');
  const [activeAging, setActiveAging] = useState<number | null>(null);
  const [livePreview, setLivePreview] = useState<AgingLivePreview[] | null>(null);
  const { t } = useLanguage();
  const { currency, fx } = useCurrency();

  const { isSampleData: plIsSample, MONTHLY_PL, periodLabel, companyName } = useProfitLossData();
  const { transactions, isSampleData: txIsSample } = useTransactions();

  // ── Revenue vs Expenses vs Net Profit (dari MONTHLY_PL, satuan Jt -> raw IDR) ──
  const revenueData = useMemo(() => {
    if (plIsSample || MONTHLY_PL.length === 0) return SAMPLE_REVENUE;
    return MONTHLY_PL.map((row) => ({
      month: row.month,
      revenue: row.revenue * 1e6,
      expenses: (row.cogs + row.opEx + row.da + row.interest + row.tax) * 1e6,
      netProfit: row.netProfit * 1e6,
    }));
  }, [plIsSample, MONTHLY_PL]);

  // ── AR Aging (dari transaksi Sales client aktif, lewat arBridge -- sama seperti halaman AR) ──
  const agingData = useMemo(() => {
    if (txIsSample) return SAMPLE_AGING;
    const invoices = invoicesFromTransactions(transactions);
    if (invoices.length === 0) return SAMPLE_AGING;
    const aging = arAgingFromInvoices(invoices);
    if (aging.every((a) => a.amount === 0)) return SAMPLE_AGING;
    return aging.map((a) => ({ name: a.bucket, value: a.amount / 1e6, color: a.color, percentage: a.percentage }));
  }, [txIsSample, transactions]);
  const isAgingSample = agingData === SAMPLE_AGING;
  const totalAgingJt = agingData.reduce((s, a) => s + a.value, 0);

  const fmt = (v: number) => formatMoney(v, currency);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs">
        <p className="font-600 text-foreground mb-1.5">{label}</p>
        {payload.map((p: any, i: number) => (
          <div key={`tt-${i}`} className="flex items-center gap-2 py-0.5">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.stroke }} />
            <span className="text-muted-foreground">{p.name}:</span>
            <span className="font-600 text-foreground">{formatMoney(p.value, currency)}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* Revenue Chart */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-600 text-foreground">{t('Revenue vs Expenses vs Net Profit')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {plIsSample ? 'PT Nusantara Teknologi Indonesia · Jan–Aug 2026' : `${companyName} · ${periodLabel}`}
            </p>
          </div>
          <div className="flex gap-1">
            {(['6M', 'YTD', '12M', '3Y'] as const).map((p) => (
              <button
                key={`period-${p}`}
                onClick={() => setPeriod(p)}
                className={`text-xs px-2.5 py-1 rounded-md font-500 transition-colors ${
                  period === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--danger)" stopOpacity={0.12} />
                <stop offset="95%" stopColor="var(--danger)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={fmt} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={42} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="revenue" name={t('Revenue')} stroke="var(--primary)" strokeWidth={2} fill="url(#gradRevenue)" />
            <Area type="monotone" dataKey="expenses" name={t('Expenses')} stroke="var(--danger)" strokeWidth={1.5} fill="url(#gradExpenses)" />
            <Area type="monotone" dataKey="netProfit" name={t('Net Profit')} stroke="var(--success)" strokeWidth={1.5} fill="none" strokeDasharray="4 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* AR Aging Donut */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="mb-4">
          <h3 className="text-md font-600 text-foreground">{t('AR Aging Analysis')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAgingSample
              ? fx(t('Total AR: Rp 1,24M outstanding'))
              : fx(`Total AR: ${formatMoney(totalAgingJt * 1e6, currency)} outstanding`)}
          </p>
        </div>
        <InteractiveAgingDonut
          data={agingData}
          activeIndex={activeAging}
          onActiveChange={setActiveAging}
          onLiveChange={setLivePreview}
        />
        <div className="space-y-1.5 mt-2">
          {agingData.map((item: any, index) => {
            const preview = livePreview?.[index];
            const displayValueJt = preview ? preview.value : item.value;
            const displayPct = preview
              ? preview.pct
              : isAgingSample
              ? (item.value / SAMPLE_AGING_TOTAL) * 100
              : item.percentage ?? 0;
            return (
              <div
                key={`aging-legend-${item.name}`}
                onClick={() => setActiveAging((prev) => (prev === index ? null : index))}
                className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                  activeAging === index ? 'bg-secondary' : 'hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
                  <span className={activeAging === index ? 'text-foreground font-600' : 'text-muted-foreground'}>{t(item.name)}</span>
                </div>
                <span className="font-600 text-foreground tabular-nums">{formatMoney(displayValueJt * 1e6, currency)}</span>
                <span className="text-muted-foreground w-10 text-right">{displayPct.toFixed(0)}%</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
