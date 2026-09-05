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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import InteractiveAgingDonut, { AgingLivePreview } from './InteractiveAgingDonut';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useProfitLossData, fetchMonthlyPLForYear, type MonthlyPLRow } from '@/app/financial-statements/lib/useProfitLossData';
import { useActiveClient } from '@/lib/activeClient';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, arAgingFromInvoices } from '@/app/transactions/lib/arBridge';

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


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

  const { isSampleData: plIsSample, MONTHLY_PL, companyName } = useProfitLossData();
  const { activeClientId } = useActiveClient();
  const { transactions, isSampleData: txIsSample } = useTransactions();

  // ── Anchor "bulan berjalan" (dari jam sistem, ex: Sep 2026) — ini yang
  // jadi patokan ujung PALING KANAN chart untuk semua filter periode. ──
  const now = new Date();
  const anchorYear = now.getFullYear();
  const anchorMonthIdx = now.getMonth(); // 0 = Jan
  const anchorAbs = anchorYear * 12 + anchorMonthIdx;

  // ── Cache MONTHLY_PL tahun-tahun sebelumnya (dibutuhkan 12M kalau bulan
  // berjalan < 12, dan 3Y) -- di-fetch on-demand, reuse fungsi yang sama
  // persis dengan hook P&L (fetchMonthlyPLForYear) supaya angkanya
  // konsisten dengan halaman Profit & Loss. ──
  const [priorYearsPL, setPriorYearsPL] = useState<Record<number, MonthlyPLRow[]>>({});
  const fetchingYearsRef = useRef<Set<number>>(new Set());

  const yearsNeeded = useMemo(() => {
    if (plIsSample) return [];
    if (period === '12M') return anchorAbs - 11 < anchorYear * 12 ? [anchorYear - 1] : [];
    if (period === '3Y') return [anchorYear - 1, anchorYear - 2];
    return [];
  }, [plIsSample, period, anchorAbs, anchorYear]);

  useEffect(() => {
    if (!activeClientId || plIsSample) return;
    const toFetch = yearsNeeded.filter((y) => !(y in priorYearsPL) && !fetchingYearsRef.current.has(y));
    if (toFetch.length === 0) return;
    toFetch.forEach((y) => fetchingYearsRef.current.add(y));
    (async () => {
      const results = await Promise.all(toFetch.map((y) => fetchMonthlyPLForYear(activeClientId, y)));
      setPriorYearsPL((prev) => {
        const next = { ...prev };
        toFetch.forEach((y, i) => {
          next[y] = results[i] || [];
          fetchingYearsRef.current.delete(y);
        });
        return next;
      });
    })();
  }, [activeClientId, plIsSample, yearsNeeded, priorYearsPL]);

  // ── Gabungkan semua tahun yang tersedia jadi satu deret kronologis
  // {absIdx, month, revenue, expenses, netProfit}, lalu potong sesuai
  // filter periode dengan ujung kanan = anchorAbs (bulan berjalan). ──
  const revenueData = useMemo(() => {
    if (plIsSample || MONTHLY_PL.length === 0) {
      // Data contoh tetap ikut kepotong sesuai filter periode, supaya
      // tombol 6M/YTD/12M/3Y kelihatan beneran ngefek walau belum ada
      // client aktif (banner "Showing sample data").
      const windowSize = period === '6M' ? 6 : period === '12M' ? 12 : period === '3Y' ? 36 : null;
      if (!windowSize) return SAMPLE_REVENUE; // YTD = semua data contoh (Jan–Aug)
      return SAMPLE_REVENUE.slice(Math.max(0, SAMPLE_REVENUE.length - windowSize));
    }

    type Row = { absIdx: number; year: number; month: string; revenue: number; expenses: number; netProfit: number };
    const rows: Row[] = [];
    const pushYear = (year: number, monthly: MonthlyPLRow[]) => {
      monthly.forEach((row) => {
        const mIdx = NAMA_BULAN.indexOf(row.month);
        if (mIdx === -1) return;
        rows.push({
          absIdx: year * 12 + mIdx,
          year,
          month: row.month,
          revenue: row.revenue * 1e6,
          expenses: (row.cogs + row.opEx + row.da + row.interest + row.tax) * 1e6,
          netProfit: row.netProfit * 1e6,
        });
      });
    };
    pushYear(anchorYear, MONTHLY_PL);
    Object.entries(priorYearsPL).forEach(([y, monthly]) => pushYear(Number(y), monthly));
    rows.sort((a, b) => a.absIdx - b.absIdx);

    const windowSize = period === '6M' ? 6 : period === '12M' ? 12 : period === '3Y' ? 36 : null; // null = YTD
    const lowerBound = windowSize ? anchorAbs - (windowSize - 1) : anchorYear * 12; // YTD: dari Jan tahun ini
    const filtered = rows.filter((r) => r.absIdx >= lowerBound && r.absIdx <= anchorAbs);
    if (filtered.length === 0) return SAMPLE_REVENUE;

    const spansMultipleYears = filtered.some((r) => r.year !== filtered[0].year);
    return filtered.map((r) => ({
      month: spansMultipleYears ? `${r.month} '${String(r.year).slice(-2)}` : r.month,
      revenue: r.revenue,
      expenses: r.expenses,
      netProfit: r.netProfit,
    }));
  }, [plIsSample, MONTHLY_PL, priorYearsPL, period, anchorYear, anchorAbs]);

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

  // ── Zoom skala harga (drag vertikal di sumbu Y, kayak TradingView) ──
  // baseMax: batas atas alami dari data (dibulatkan ke atas + sedikit padding).
  // priceZoom: 1 = normal. >1 = zoom in (rentang harga makin sempit, makin rinci).
  //            <1 = zoom out (rentang makin lebar).
  const baseMax = useMemo(() => {
    const maxVal = Math.max(0, ...revenueData.map((d: any) => Math.max(d.revenue, d.expenses, d.netProfit)));
    return maxVal * 1.08 || 1;
  }, [revenueData]);

  const [priceZoom, setPriceZoom] = useState(1);
  const dragRef = React.useRef<{ startY: number; startZoom: number } | null>(null);

  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const deltaY = dragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, dragRef.current.startZoom * factor));
      setPriceZoom(next);
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetZoom = () => setPriceZoom(1);

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
              {plIsSample
                ? `${companyName} · Jan–Aug 2026`
                : `${companyName} · ${revenueData[0]?.month || ''}${revenueData.length > 1 ? ` – ${revenueData[revenueData.length - 1].month}` : ''}`}
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
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={revenueData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={72}
                tickCount={8}
                allowDecimals={false}
                domain={yDomain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="revenue" name={t('Revenue')} stroke="var(--primary)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="expenses" name={t('Expenses')} stroke="var(--danger)" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="netProfit" name={t('Net Profit')} stroke="var(--success)" strokeWidth={2} dot={false} strokeDasharray="4 2" />
            </ComposedChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
          <div
            onMouseDown={handleAxisMouseDown}
            onDoubleClick={resetZoom}
            title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 72 }}
          />
        </div>
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