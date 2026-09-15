'use client';

import React, { useState, useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { purchaseTransactions, purchaseExceptions, purchaseOverviewKPIs, vendors } from '@/data/purchaseData';
import {
  ExclamationTriangleIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';


const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);
const fmtFull = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

// ── Data historis untuk Purchase Volume Trend (multi-periode + pan/scroll
// ala TradingView). Dibuat deterministik (bukan random murni) dari fungsi
// hash sederhana, supaya angkanya konsisten setiap render tapi tetap
// terlihat "natural" (ada tren naik & variasi musiman). Ini data contoh —
// kalau sudah tersambung ke backend, tinggal ganti fungsi build-nya. ──
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function seededRandom(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

type TrendPoint = { month: string; amount: number };

const DAILY_COUNT = 730; // ~2 tahun ke belakang, cukup untuk pan jauh di tampilan 1W/1M
function buildDailyTrend(anchor: Date): TrendPoint[] {
  const points: TrendPoint[] = [];
  for (let i = 0; i < DAILY_COUNT; i++) {
    const daysAgo = DAILY_COUNT - 1 - i;
    const d = new Date(anchor);
    d.setDate(d.getDate() - daysAgo);
    const dayOfWeek = d.getDay();
    const weekendFactor = dayOfWeek === 0 || dayOfWeek === 6 ? 0.35 : 1;
    const trend = i * 15;
    const seasonal = 4000 * Math.sin((i / 365) * Math.PI * 2);
    const noise = (seededRandom(i * 7.13) - 0.5) * 6000;
    const amount = Math.max(500, Math.round((9000 + trend + seasonal + noise) * weekendFactor));
    points.push({ month: `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`, amount });
  }
  return points;
}

const MONTHLY_COUNT = 180; // 15 tahun ke belakang — cukup panjang untuk di-bucket jadi 6-bulanan/tahunan dan tetap bisa di-pan jauh
function buildMonthlyTrendSeries(anchor: Date): TrendPoint[] {
  const points: TrendPoint[] = [];
  const anchorAbs = anchor.getFullYear() * 12 + anchor.getMonth();
  for (let i = 0; i < MONTHLY_COUNT; i++) {
    const monthsAgo = MONTHLY_COUNT - 1 - i;
    const abs = anchorAbs - monthsAgo;
    const year = Math.floor(abs / 12);
    const mIdx = ((abs % 12) + 12) % 12;
    const trend = i * 1270;
    const seasonal = 60000 * Math.sin((i / 12) * Math.PI * 2);
    const noise = (seededRandom(i * 3.71) - 0.5) * 70000;
    const amount = Math.max(50000, Math.round(300000 + trend + seasonal + noise));
    const spansMultipleYears = year !== anchor.getFullYear();
    points.push({ month: spansMultipleYears ? `${MONTH_ABBR[mIdx]} '${String(year).slice(-2)}` : MONTH_ABBR[mIdx], amount });
  }
  return points;
}

/** Gabungkan titik-titik data mentah (harian/bulanan) jadi bucket yang lebih
 *  besar — inilah yang membuat "1 kotak chart" benar-benar mewakili 1
 *  minggu / 1 bulan / 6 bulan / 1 tahun (bukan cuma rentang tampilan yang
 *  beda). bucketSize dalam satuan titik data sumbernya (7 hari untuk
 *  mingguan; 1/6/12 bulan untuk bulanan/6-bulanan/tahunan). Sisa data
 *  tertua yang tidak genap satu bucket dibuang, supaya setiap bucket selalu
 *  utuh (bucket paling kanan/baru selalu berakhir tepat di data terakhir). */
function bucketTrendPoints(points: TrendPoint[], bucketSize: number): TrendPoint[] {
  if (bucketSize <= 1) return points;
  const totalBuckets = Math.floor(points.length / bucketSize);
  const usable = points.slice(points.length - totalBuckets * bucketSize);
  const buckets: TrendPoint[] = [];
  for (let b = 0; b < totalBuckets; b++) {
    const chunk = usable.slice(b * bucketSize, (b + 1) * bucketSize);
    const amount = chunk.reduce((s, c) => s + c.amount, 0);
    const label = `${chunk[0].month}–${chunk[chunk.length - 1].month}`;
    buckets.push({ month: label, amount });
  }
  return buckets;
}

const categoryData = [
  { name: 'IT Equipment', value: 241840 },
  { name: 'Raw Materials', value: 158962 },
  { name: 'Professional Services', value: 71120 },
  { name: 'Logistics', value: 31976 },
  { name: 'Marketing', value: 39200 },
  { name: 'Office Supplies', value: 55549 },
  { name: 'Maintenance', value: 13888 },
];

const COLORS = ['#1E40AF', '#0EA5E9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#64748B'];

const statusDist = [
  { name: 'Posted', value: 6, color: '#15803D' },
  { name: 'Approved', value: 2, color: '#0369A1' },
  { name: 'Pending Review', value: 2, color: '#D97706' },
  { name: 'Exception', value: 1, color: '#C2410C' },
  { name: 'Cancelled', value: 1, color: '#64748B' },
];

const paymentStatusDist = [
  { name: 'Unpaid', value: 4, color: '#DC2626' },
  { name: 'Paid', value: 5, color: '#15803D' },
  { name: 'Partially Paid', value: 1, color: '#D97706' },
  { name: 'Overdue', value: 1, color: '#C2410C' },
  { name: 'On Hold', value: 1, color: '#64748B' },
];

// Top vendors by spend
const topVendors = vendors
  .map(v => ({
    ...v,
    totalSpend: purchaseTransactions.filter(p => p.vendorId === v.id).reduce((s, p) => s + p.total, 0),
    txCount: purchaseTransactions.filter(p => p.vendorId === v.id).length,
  }))
  .filter(v => v.totalSpend > 0)
  .sort((a, b) => b.totalSpend - a.totalSpend)
  .slice(0, 6);

const recentActivity = purchaseTransactions
  .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
  .slice(0, 6);

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

export default function PurchaseOverviewPage() {
  const kpis = purchaseOverviewKPIs;

  // ── Purchase Status donut — pakai komponen InteractiveDonutChart yang
  // sama dengan AR Aging Analysis di Financial Overview (klik untuk
  // highlight, hover untuk brighten, tarik garis pemisah untuk preview
  // "what-if" dengan spring-back). Data tetap milik Purchase (statusDist),
  // cuma nilainya jumlah transaksi (bukan uang) jadi pakai formatValue
  // custom di bawah, bukan format mata uang bawaan komponen. ──
  const [activeStatus, setActiveStatus] = useState<number | null>(null);
  const [statusLivePreview, setStatusLivePreview] = useState<DonutLivePreview[] | null>(null);
  const statusTotal = useMemo(() => statusDist.reduce((s, d) => s + d.value, 0), []);

  // ── Purchase Volume Trend: filter periode menentukan UKURAN 1 BAR (bukan
  // total rentang yang tampil) — 1W = 1 bar per minggu, 1M = 1 bar per
  // bulan, 6M = 1 bar per 6 bulan, 1Y = 1 bar per tahun. Semua tetap
  // menampilkan 6 bar sekaligus, dan bisa di-pan (tarik) ke kiri/kanan
  // untuk melihat bucket yang lebih lama, mirip TradingView. ──
  type TrendPeriod = '1W' | '1M' | '6M' | '1Y';
  const TREND_PERIOD_CONFIG: Record<TrendPeriod, { base: 'daily' | 'monthly'; bucketSize: number; visibleCount: number; label: string }> = {
    '1W': { base: 'daily', bucketSize: 7, visibleCount: 6, label: 'Weekly purchase amount' },
    '1M': { base: 'monthly', bucketSize: 1, visibleCount: 6, label: 'Monthly purchase amount' },
    '6M': { base: 'monthly', bucketSize: 6, visibleCount: 6, label: '6-month purchase amount' },
    '1Y': { base: 'monthly', bucketSize: 12, visibleCount: 6, label: 'Yearly purchase amount' },
  };
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('6M');
  const [trendWindowOffset, setTrendWindowOffset] = useState(0); // 0 = data terbaru; makin besar = makin ke masa lalu

  const dailyTrendMaster = useMemo(() => buildDailyTrend(new Date()), []);
  const monthlyTrendMaster = useMemo(() => buildMonthlyTrendSeries(new Date()), []);

  const trendPeriodCfg = TREND_PERIOD_CONFIG[trendPeriod];
  const trendVisibleCount = trendPeriodCfg.visibleCount;
  const trendBaseMaster = trendPeriodCfg.base === 'daily' ? dailyTrendMaster : monthlyTrendMaster;
  const trendMaster = useMemo(
    () => bucketTrendPoints(trendBaseMaster, trendPeriodCfg.bucketSize),
    [trendBaseMaster, trendPeriodCfg.bucketSize]
  );
  const trendMaxOffset = Math.max(0, trendMaster.length - trendVisibleCount);

  // Reset posisi scroll saat ganti periode (offset lama tidak relevan lagi)
  React.useEffect(() => {
    setTrendWindowOffset(0);
  }, [trendPeriod]);

  const trendStartIdx = trendMaster.length - trendVisibleCount - trendWindowOffset;
  const trendWindowData = useMemo(
    () => trendMaster.slice(trendStartIdx, trendStartIdx + trendVisibleCount),
    [trendMaster, trendStartIdx, trendVisibleCount]
  );

  // Drag horizontal di area label sumbu X untuk scroll riwayat (mirip pan
  // chart TradingView). Klik dua kali untuk kembali ke data terbaru.
  const trendChartWrapRef = React.useRef<HTMLDivElement | null>(null);
  const trendPanRef = React.useRef<{ startX: number; startOffset: number; barWidthPx: number } | null>(null);

  const handleTrendPanPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const wrapWidth = trendChartWrapRef.current?.clientWidth || 0;
    const plotWidth = Math.max(1, wrapWidth - 56); // 56 = lebar YAxis
    const barWidthPx = plotWidth / trendVisibleCount;
    trendPanRef.current = { startX: e.clientX, startOffset: trendWindowOffset, barWidthPx };
    const onMove = (ev: PointerEvent) => {
      if (!trendPanRef.current) return;
      const deltaX = ev.clientX - trendPanRef.current.startX; // geser ke kanan = lihat data lampau
      const deltaUnits = deltaX / trendPanRef.current.barWidthPx;
      const next = Math.round(trendPanRef.current.startOffset + deltaUnits);
      setTrendWindowOffset(Math.max(0, Math.min(trendMaxOffset, next)));
    };
    const onUp = () => {
      trendPanRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const resetTrendPan = () => setTrendWindowOffset(0);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // "Actual vs Budget" di Financial Overview: drag ke atas di area sumbu
  // Y untuk zoom in (rentang makin rinci), drag ke bawah untuk zoom out.
  // Klik dua kali untuk reset ke skala normal. ──
  const trendBaseMax = useMemo(
    () => Math.max(1, ...trendWindowData.map((d) => d.amount)) * 1.08,
    [trendWindowData]
  );
  const [trendPriceZoom, setTrendPriceZoom] = useState(1);
  const trendDragAxisRef = React.useRef<{ startY: number; startZoom: number } | null>(null);

  const { ticks: trendYTicks } = useMemo(
    () => getNiceTicksFromZero(trendBaseMax / trendPriceZoom, 5),
    [trendBaseMax, trendPriceZoom]
  );
  const trendYDomain = useMemo<[number, number]>(
    () => [0, trendBaseMax / trendPriceZoom],
    [trendBaseMax, trendPriceZoom]
  );

  const handleTrendAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    trendDragAxisRef.current = { startY: e.clientY, startZoom: trendPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!trendDragAxisRef.current) return;
      const deltaY = trendDragAxisRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, trendDragAxisRef.current.startZoom * factor));
      setTrendPriceZoom(next);
    };
    const onUp = () => {
      trendDragAxisRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const resetTrendZoom = () => setTrendPriceZoom(1);

  // ── Drag bar (tarik naik/turun untuk preview nilai) — lepas pointer maka
  // nilai "spring back" (animasi pegas) ke nilai aslinya, sama seperti bar
  // Actual/Budget di Financial Overview. ──
  const [trendDragBar, setTrendDragBar] = useState<{ index: number; liveValue: number } | null>(null);
  const trendDragBarRef = React.useRef<{
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number;
  } | null>(null);
  const trendPointAnimRef = React.useRef<number | null>(null);
  const trendYDomainRef = React.useRef(trendYDomain);
  trendYDomainRef.current = trendYDomain;

  const stopTrendSpring = () => {
    if (trendPointAnimRef.current) cancelAnimationFrame(trendPointAnimRef.current);
    trendPointAnimRef.current = null;
  };

  const easeOutQuintTrend = (t: number) => 1 - Math.pow(1 - t, 5);

  const springBackTrendBar = () => {
    const drag = trendDragBarRef.current;
    if (!drag) return;
    stopTrendSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const duration = 380;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuintTrend(t);
      const next = from + (to - from) * eased;
      if (trendDragBarRef.current) {
        trendDragBarRef.current = { ...trendDragBarRef.current, liveValue: next };
        setTrendDragBar({ index: drag.index, liveValue: next });
      }
      if (t < 1) {
        trendPointAnimRef.current = requestAnimationFrame(step);
      } else {
        trendDragBarRef.current = null;
        setTrendDragBar(null);
        trendPointAnimRef.current = null;
      }
    };
    trendPointAnimRef.current = requestAnimationFrame(step);
  };

  const handleTrendBarPointerDown = (index: number, startValue: number, barHeight: number) => (
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    stopTrendSpring();
    let pxPerUnit = startValue !== 0 ? -barHeight / startValue : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    trendDragBarRef.current = { index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setTrendDragBar({ index, liveValue: startValue });
  };

  // Reset drag bar yang sedang berlangsung kalau window data berubah (ganti
  // periode atau habis di-pan) — index lama sudah tidak relevan lagi.
  React.useEffect(() => {
    stopTrendSpring();
    trendDragBarRef.current = null;
    setTrendDragBar(null);
  }, [trendPeriod, trendWindowOffset]);

  React.useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = trendDragBarRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = trendYDomainRef.current;
      const maxValue = dMax * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      trendDragBarRef.current = { ...drag, liveValue: next };
      setTrendDragBar({ index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (trendDragBarRef.current) springBackTrendBar();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, []);

  const trendChartData = useMemo(() => {
    if (!trendDragBar) return trendWindowData;
    return trendWindowData.map((d, i) => (i === trendDragBar.index ? { ...d, amount: trendDragBar.liveValue } : d));
  }, [trendWindowData, trendDragBar]);

  const renderTrendInteractiveBar = (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = trendDragBar?.index === index;
    const h = Math.max(0, height);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={h}
          fill="#1E40AF"
          rx={3}
          ry={3}
          stroke={isDraggingThis ? '#1E40AF' : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleTrendBarPointerDown(index, payload.amount, height)}
        />
        {/* Perluas area genggam ke atas sedikit, biar mudah ditarik walau bar-nya pendek */}
        <rect
          x={x}
          y={y - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleTrendBarPointerDown(index, payload.amount, height)}
        />
      </g>
    );
  };

  const kpiCards = [
    {
      label: 'Total Purchases',
      value: kpis.totalPurchases.toString(),
      sub: 'All transactions',
      icon: 'ShoppingBagIcon',
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      trend: '+3 this week',
      up: true,
    },
    {
      label: 'Purchase Amount',
      value: fmt(kpis.totalAmount),
      sub: 'Gross purchase value',
      icon: 'CurrencyDollarIcon',
      color: 'text-slate-700',
      bg: 'bg-slate-50',
      trend: '+16.7% vs last month',
      up: true,
    },
    {
      label: 'Outstanding AP',
      value: fmt(kpis.totalAP),
      sub: 'Accounts payable balance',
      icon: 'BanknotesIcon',
      color: 'text-red-700',
      bg: 'bg-red-50',
      trend: 'Unpaid & overdue',
      up: false,
    },
    {
      label: 'Pending Review',
      value: kpis.pendingReview.toString(),
      sub: 'Awaiting approval',
      icon: 'ClockIcon',
      color: 'text-amber-700',
      bg: 'bg-amber-50',
      trend: 'Action required',
      up: false,
    },
    {
      label: 'Posted',
      value: kpis.posted.toString(),
      sub: 'Finalized to GL',
      icon: 'CheckCircleIcon',
      color: 'text-green-700',
      bg: 'bg-green-50',
      trend: 'This period',
      up: true,
    },
    {
      label: 'Exceptions',
      value: kpis.exceptions.toString(),
      sub: 'Require attention',
      icon: 'ExclamationTriangleIcon',
      color: 'text-orange-700',
      bg: 'bg-orange-50',
      trend: `${purchaseExceptions.filter(e => e.status === 'Open').length} open`,
      up: false,
    },
    {
      label: 'Input Tax (VAT)',
      value: fmt(kpis.totalTax),
      sub: 'Recoverable input tax',
      icon: 'ChartBarIcon',
      color: 'text-purple-700',
      bg: 'bg-purple-50',
      trend: 'Avg 12% rate',
      up: true,
    },
    {
      label: 'Overdue Amount',
      value: fmt(kpis.overdueAmount),
      sub: 'Past payment due date',
      icon: 'ExclamationTriangleIcon',
      color: 'text-red-700',
      bg: 'bg-red-50',
      trend: 'Immediate action',
      up: false,
    },
  ];

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* KPI Grid — desain disamakan dengan shared KpiCard (dipakai di
            Sales), data & isi tetap sama seperti sebelumnya. */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {kpiCards.map((card) => (
            <KpiCard
              key={card.label}
              title={card.label}
              value={card.value}
              subLabel={card.sub}
              icon={card.icon}
              iconColor={card.color}
              iconBg={card.bg}
              change={card.trend}
              changePositive={card.up}
            />
          ))}
        </div>

        {/* Charts Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Purchase Trend */}
          <div className="je-card p-5 lg:col-span-2">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase Volume Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {trendPeriodCfg.label}
                  {trendWindowData.length > 0 && (
                    <> · {trendWindowData[0].month} – {trendWindowData[trendWindowData.length - 1].month}</>
                  )}
                </p>
              </div>
              <div className="flex gap-1">
                {(['1W', '1M', '6M', '1Y'] as const).map((p) => (
                  <button
                    key={`trend-period-${p}`}
                    onClick={() => setTrendPeriod(p)}
                    className={`text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
                      trendPeriod === p ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative" ref={trendChartWrapRef}>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trendChartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    interval={trendVisibleCount > 10 ? Math.ceil(trendVisibleCount / 6) - 1 : 0}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#64748B' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                    width={56}
                    ticks={trendYTicks}
                    domain={trendYDomain}
                    allowDataOverflow
                  />
                  <Tooltip
                    formatter={(value: number) => [fmt(value), 'Amount']}
                    contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #E2E8F0' }}
                    cursor={false}
                  />
                  <Bar
                    dataKey="amount"
                    fill="#1E40AF"
                    radius={[3, 3, 0, 0]}
                    shape={renderTrendInteractiveBar as any}
                    isAnimationActive={!trendDragBar}
                  />
                </BarChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleTrendAxisMouseDown}
                onDoubleClick={resetTrendZoom}
                title="Drag to zoom price scale · double-click to reset"
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: 56 }}
              />
              {/* Overlay drag: tarik ke kiri/kanan di area label bulan/tanggal buat scroll riwayat, mirip TradingView */}
              <div
                onPointerDown={handleTrendPanPointerDown}
                onDoubleClick={resetTrendPan}
                title="Drag left/right to scroll through history · double-click to jump to latest"
                className="absolute bottom-0 h-6 cursor-grab active:cursor-grabbing"
                style={{ left: 56, right: 0 }}
              />
            </div>
            {trendWindowOffset > 0 && (
              <button
                onClick={resetTrendPan}
                className="mt-2 text-[11px] text-primary hover:underline"
              >
                ← Back to latest
              </button>
            )}
          </div>

          {/* Status Distribution */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase Status</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Current distribution</p>
              </div>
            </div>
            <InteractiveDonutChart
              data={statusDist}
              height={200}
              activeIndex={activeStatus}
              onActiveChange={setActiveStatus}
              onLiveChange={setStatusLivePreview}
              formatValue={(v) => `${Math.round(v)} ${Math.round(v) === 1 ? 'transaction' : 'transactions'}`}
            />
            <div className="space-y-1.5 mt-2">
              {statusDist.map((item, index) => {
                const preview = statusLivePreview?.[index];
                const displayValue = preview ? Math.round(preview.value) : item.value;
                const displayPct = preview ? preview.pct : (item.value / statusTotal) * 100;
                return (
                  <div
                    key={item.name}
                    onClick={() => setActiveStatus((prev) => (prev === index ? null : index))}
                    className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                      activeStatus === index ? 'bg-secondary' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className={activeStatus === index ? 'text-foreground font-semibold' : 'text-muted-foreground'}>
                        {item.name}
                      </span>
                    </div>
                    <span className="font-semibold text-foreground tabular-nums">{displayValue}</span>
                    <span className="text-muted-foreground w-10 text-right">{displayPct.toFixed(0)}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Charts Row 2 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Category Breakdown */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Purchase by Category</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Spend distribution by category</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={categoryData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} width={110} />
                <Tooltip formatter={(v: number) => [fmt(v), 'Amount']} contentStyle={{ fontSize: 11, borderRadius: 6 }} />
                <Bar dataKey="value" fill="#0EA5E9" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Payment Status */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Payment Status Overview</h3>
                <p className="text-xs text-muted-foreground mt-0.5">AP payment distribution</p>
              </div>
            </div>
            <div className="space-y-3 mt-2">
              {paymentStatusDist.map((item) => {
                const pct = Math.round((item.value / 12) * 100);
                return (
                  <div key={item.name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color }} />
                        <span className="text-foreground font-medium">{item.name}</span>
                      </div>
                      <span className="text-muted-foreground tabular-nums">{item.value} ({pct}%)</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5">
                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-3">
              <div className="bg-red-50 rounded-lg p-3">
                <p className="text-xs text-red-600 font-medium">Overdue AP</p>
                <p className="text-base font-bold text-red-700 tabular-nums mt-0.5">{fmt(kpis.overdueAmount)}</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-3">
                <p className="text-xs text-amber-600 font-medium">Outstanding AP</p>
                <p className="text-base font-bold text-amber-700 tabular-nums mt-0.5">{fmt(kpis.totalAP)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Top Vendors + Recent Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Vendors */}
          <div className="je-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <BuildingStorefrontIcon className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Top Vendors by Spend</h3>
            </div>
            <div className="space-y-3">
              {topVendors.map((vendor, idx) => {
                const maxSpend = topVendors[0].totalSpend;
                const pct = Math.round((vendor.totalSpend / maxSpend) * 100);
                return (
                  <div key={vendor.id}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center flex-shrink-0">{idx + 1}</span>
                        <div>
                          <p className="font-medium text-foreground">{vendor.name}</p>
                          <p className="text-muted-foreground">{vendor.txCount} transaction{vendor.txCount !== 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <span className="font-bold text-foreground tabular-nums">{fmt(vendor.totalSpend)}</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-1.5 ml-7">
                      <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Activity */}
          <div className="je-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-foreground">Recent Purchase Activity</h3>
              <span className="text-xs text-muted-foreground">Last 6 transactions</span>
            </div>
            <div className="space-y-3">
              {recentActivity.map((tx) => (
                <div key={tx.id} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-primary">{tx.purchaseId}</span>
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColors[tx.status]}`}>
                        {statusLabels[tx.status]}
                      </span>
                    </div>
                    <p className="text-xs text-foreground mt-0.5 truncate">{tx.vendor}</p>
                    <p className="text-xs text-muted-foreground">{tx.purchaseDate} · {tx.category}</p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold tabular-nums text-foreground">{fmt(tx.total)}</p>
                    <p className="text-xs text-muted-foreground">{tx.currency}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Exception Summary */}
        <div className="je-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ExclamationTriangleIcon className="w-4 h-4 text-orange-500" />
              <h3 className="text-sm font-semibold text-foreground">Exception Summary</h3>
            </div>
            <a href="/purchase/exceptions" className="text-xs text-primary hover:underline font-medium">View all exceptions →</a>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Total Exceptions', value: purchaseExceptions.length, color: 'text-slate-700', bg: 'bg-slate-50' },
              { label: 'Open', value: purchaseExceptions.filter(e => e.status === 'Open').length, color: 'text-red-700', bg: 'bg-red-50' },
              { label: 'Under Review', value: purchaseExceptions.filter(e => e.status === 'Under Review').length, color: 'text-amber-700', bg: 'bg-amber-50' },
              { label: 'Resolved', value: purchaseExceptions.filter(e => e.status === 'Resolved').length, color: 'text-green-700', bg: 'bg-green-50' },
            ].map(card => (
              <div key={card.label} className={`${card.bg} rounded-lg p-3`}>
                <p className={`text-2xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
                <p className="text-xs font-medium text-foreground mt-1">{card.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {purchaseExceptions.filter(e => e.status === 'Open' || e.status === 'Under Review').slice(0, 3).map(exc => (
              <div key={exc.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${exc.severity === 'Critical' ? 'bg-red-500' : exc.severity === 'High' ? 'bg-orange-500' : 'bg-amber-400'}`} />
                  <span className="text-xs font-medium text-foreground">{exc.purchaseId}</span>
                  <span className="text-xs text-muted-foreground">— {exc.exceptionType}</span>
                </div>
                <span className={`text-xs font-semibold ${exc.severity === 'Critical' ? 'text-red-700' : exc.severity === 'High' ? 'text-orange-700' : 'text-amber-700'}`}>{exc.severity}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
  );
}