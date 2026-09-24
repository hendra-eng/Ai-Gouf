'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { usePurchaseData } from '@/app/transactions/purchase/purchasebridge';
import {
  ExclamationTriangleIcon,
  BuildingStorefrontIcon,
} from '@heroicons/react/24/outline';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import type { PurchaseTransaction } from '@/data/purchaseData';
import { useCurrency } from '@/lib/currency';
import { formatRupiah } from '@/lib/mockData';

// ── Data untuk Purchase Volume Trend (multi-periode + pan/scroll ala
// TradingView). [DIUBAH] Sebelumnya dibangun dari generator pseudo-random
// (seededRandom) -- data contoh, tidak nyambung ke Supabase sama sekali.
// Sekarang dihitung dari purchaseTransactions asli: tiap hari/bulan dalam
// jendela waktu dijumlahkan dari transaksi yang purchaseDate-nya jatuh di
// hari/bulan itu; hari/bulan tanpa transaksi tampil 0 (bukan diisi angka
// karangan) supaya jujur mencerminkan data di database. ──
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type TrendPoint = { month: string; amount: number };

const DAILY_COUNT = 730; // ~2 tahun ke belakang, cukup untuk pan jauh di tampilan 1W/1M
function buildDailyTrend(anchor: Date, transactions: PurchaseTransaction[]): TrendPoint[] {
  const sumByDay = new Map<string, number>();
  transactions.forEach((t) => {
    const d = new Date(t.purchaseDate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    sumByDay.set(key, (sumByDay.get(key) || 0) + t.total);
  });
  const points: TrendPoint[] = [];
  for (let i = 0; i < DAILY_COUNT; i++) {
    const daysAgo = DAILY_COUNT - 1 - i;
    const d = new Date(anchor);
    d.setDate(d.getDate() - daysAgo);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    points.push({ month: `${MONTH_ABBR[d.getMonth()]} ${d.getDate()}`, amount: sumByDay.get(key) || 0 });
  }
  return points;
}

const MONTHLY_COUNT = 180; // 15 tahun ke belakang — cukup panjang untuk di-bucket jadi 6-bulanan/tahunan dan tetap bisa di-pan jauh
function buildMonthlyTrendSeries(anchor: Date, transactions: PurchaseTransaction[]): TrendPoint[] {
  const sumByMonth = new Map<string, number>();
  transactions.forEach((t) => {
    const d = new Date(t.purchaseDate);
    if (isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    sumByMonth.set(key, (sumByMonth.get(key) || 0) + t.total);
  });
  const points: TrendPoint[] = [];
  const anchorAbs = anchor.getFullYear() * 12 + anchor.getMonth();
  for (let i = 0; i < MONTHLY_COUNT; i++) {
    const monthsAgo = MONTHLY_COUNT - 1 - i;
    const abs = anchorAbs - monthsAgo;
    const year = Math.floor(abs / 12);
    const mIdx = ((abs % 12) + 12) % 12;
    const spansMultipleYears = year !== anchor.getFullYear();
    points.push({
      month: spansMultipleYears ? `${MONTH_ABBR[mIdx]} '${String(year).slice(-2)}` : MONTH_ABBR[mIdx],
      amount: sumByMonth.get(`${year}-${mIdx}`) || 0,
    });
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

// [DIUBAH] categoryData/statusDist/paymentStatusDist dulu array statis
// (angka contoh, tidak nyambung Supabase). Sekarang dihitung dari
// purchaseTransactions asli lewat useMemo di dalam komponen -- lihat
// categoryData/statusDist/paymentStatusDist di bawah (computed).
const STATUS_DONUT_COLORS: Record<string, string> = {
  draft: '#64748B',
  pending_review: '#D97706',
  approved: '#0369A1',
  pending_posting: '#0891B2',
  posted: '#15803D',
  rejected: '#DC2626',
  exception: '#C2410C',
  cancelled: '#94A3B8',
};

const PAYMENT_DONUT_COLORS: Record<string, string> = {
  unpaid: '#DC2626',
  partially_paid: '#D97706',
  paid: '#15803D',
  overdue: '#C2410C',
  on_hold: '#64748B',
};

const paymentStatusLabels: Record<string, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

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
  // [DIUBAH] Sebelumnya baca dari purchaseStore.tsx (tabel
  // financial_transaction_purchase_*, kosong, filter by user login).
  // Sekarang pakai purchasebridge.ts (tabel finance_transaction_purchase_*,
  // sudah terisi, filter by client aktif di Topbar) -- satu hook untuk
  // transactions + exceptions sekaligus, di-cache per client oleh TanStack Query.
  const { purchaseTransactions, purchaseExceptions, vendors } = usePurchaseData();
  // [DIUBAH] fmt dulu fungsi module-level tetap USD (Intl.NumberFormat hardcode).
  // Sekarang ikut currency yang dipilih di header (IDR/USD/SGD) via useCurrency(),
  // sama seperti pola yang sudah dipakai Financial Overview/AP/AR.
  const { fx } = useCurrency();
  const fmt = (n: number) => fx(formatRupiah(n, true));

  // purchaseOverviewKPIs dulu diekspor statis dari purchaseData.ts, sekarang
  // dihitung dari data backend (pola sama dengan kpis di Sales/JE Overview).
  const kpis = useMemo(() => ({
    totalPurchases: purchaseTransactions.length,
    totalAmount: purchaseTransactions.reduce((s, p) => s + p.total, 0),
    pendingReview: purchaseTransactions.filter(p => p.status === 'pending_review').length,
    approved: purchaseTransactions.filter(p => p.status === 'approved').length,
    posted: purchaseTransactions.filter(p => p.status === 'posted').length,
    exceptions: purchaseTransactions.filter(p => p.status === 'exception').length,
    totalTax: purchaseTransactions.reduce((s, p) => s + p.taxAmount, 0),
    totalAP: purchaseTransactions.filter(p => p.paymentStatus !== 'paid').reduce((s, p) => s + p.accountsPayable, 0),
    overdueAmount: purchaseTransactions.filter(p => p.paymentStatus === 'overdue').reduce((s, p) => s + p.total, 0),
  }), [purchaseTransactions]);

  const topVendors = useMemo(() => vendors
    .map(v => ({
      ...v,
      totalSpend: purchaseTransactions.filter(p => p.vendorId === v.id).reduce((s, p) => s + p.total, 0),
      txCount: purchaseTransactions.filter(p => p.vendorId === v.id).length,
    }))
    .filter(v => v.totalSpend > 0)
    .sort((a, b) => b.totalSpend - a.totalSpend)
    .slice(0, 6), [vendors, purchaseTransactions]);

  const recentActivity = useMemo(() => [...purchaseTransactions]
    .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate))
    .slice(0, 6), [purchaseTransactions]);

  // ── Purchase Status donut — pakai komponen InteractiveDonutChart yang
  // sama dengan AR Aging Analysis di Financial Overview (klik untuk
  // highlight, hover untuk brighten, tarik garis pemisah untuk preview
  // "what-if" dengan spring-back). Data tetap milik Purchase (statusDist),
  // cuma nilainya jumlah transaksi (bukan uang) jadi pakai formatValue
  // custom di bawah, bukan format mata uang bawaan komponen. ──
  const [activeStatus, setActiveStatus] = useState<number | null>(null);
  const [statusLivePreview, setStatusLivePreview] = useState<DonutLivePreview[] | null>(null);
  // [DIUBAH] statusDist dulu array statis (Posted 6, Approved 2, dst =
  // total 12) yang tidak nyambung sama sekali ke "Total Purchases" di KPI
  // card (yang sudah real). Sekarang dihitung langsung dari
  // purchaseTransactions -- status yang jumlahnya 0 tidak ditampilkan.
  const statusDist = useMemo(() => {
    const counts = new Map<string, number>();
    purchaseTransactions.forEach((t) => counts.set(t.status, (counts.get(t.status) || 0) + 1));
    return Array.from(counts.entries())
      .map(([status, value]) => ({ name: statusLabels[status] || status, value, color: STATUS_DONUT_COLORS[status] || '#64748B' }))
      .sort((a, b) => b.value - a.value);
  }, [purchaseTransactions]);
  const statusTotal = useMemo(() => statusDist.reduce((s, d) => s + d.value, 0), [statusDist]);

  // [BARU] Purchase by Category — dulu categoryData statis (angka contoh),
  // sekarang jumlah `total` asli dikelompokkan per kategori transaksi.
  const categoryData = useMemo(() => {
    const sums = new Map<string, number>();
    purchaseTransactions.forEach((t) => sums.set(t.category, (sums.get(t.category) || 0) + t.total));
    return Array.from(sums.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [purchaseTransactions]);

  // [BARU] Payment Status Overview — dulu paymentStatusDist statis (juga
  // pakai divisor hardcode /12 untuk hitung persen). Sekarang dihitung
  // dari paymentStatus asli tiap transaksi; persen dihitung dari total
  // transaksi yang benar-benar ada (paymentStatusTotal), bukan angka tetap.
  const paymentStatusDist = useMemo(() => {
    const counts = new Map<string, number>();
    purchaseTransactions.forEach((t) => counts.set(t.paymentStatus, (counts.get(t.paymentStatus) || 0) + 1));
    return Array.from(counts.entries())
      .map(([status, value]) => ({ name: paymentStatusLabels[status] || status, value, color: PAYMENT_DONUT_COLORS[status] || '#64748B' }))
      .sort((a, b) => b.value - a.value);
  }, [purchaseTransactions]);
  const paymentStatusTotal = useMemo(() => paymentStatusDist.reduce((s, d) => s + d.value, 0), [paymentStatusDist]);

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

  const dailyTrendMaster = useMemo(() => buildDailyTrend(new Date(), purchaseTransactions), [purchaseTransactions]);
  const monthlyTrendMaster = useMemo(() => buildMonthlyTrendSeries(new Date(), purchaseTransactions), [purchaseTransactions]);

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

  // [BARU] Trend label KPI dulu string statis ("+3 this week", "+16.7% vs
  // last month", "Avg 12% rate") -- angka value KPI-nya sudah real, tapi
  // label kecil di bawahnya cuma teks karangan. Sekarang dihitung dari
  // purchaseTransactions/purchaseDate asli.
  const kpiTrends = useMemo(() => {
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 6);

    const thisWeekCount = purchaseTransactions.filter((p) => {
      const d = new Date(p.purchaseDate);
      return !isNaN(d.getTime()) && d >= startOfWeek && d <= now;
    }).length;

    const thisMonthKey = `${now.getFullYear()}-${now.getMonth()}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthKey = `${lastMonthDate.getFullYear()}-${lastMonthDate.getMonth()}`;
    let thisMonthTotal = 0;
    let lastMonthTotal = 0;
    purchaseTransactions.forEach((p) => {
      const d = new Date(p.purchaseDate);
      if (isNaN(d.getTime())) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (key === thisMonthKey) thisMonthTotal += p.total;
      else if (key === lastMonthKey) lastMonthTotal += p.total;
    });
    let amountTrend: string;
    let amountUp = true;
    if (lastMonthTotal > 0) {
      const pctChange = ((thisMonthTotal - lastMonthTotal) / lastMonthTotal) * 100;
      amountUp = pctChange >= 0;
      amountTrend = `${pctChange >= 0 ? '+' : ''}${pctChange.toFixed(1)}% vs last month`;
    } else if (thisMonthTotal > 0) {
      amountTrend = 'No data last month';
    } else {
      amountTrend = 'No purchases this month';
      amountUp = false;
    }

    const subtotalSum = purchaseTransactions.reduce((s, p) => s + p.subtotal, 0);
    const avgTaxRate = subtotalSum > 0 ? (kpis.totalTax / subtotalSum) * 100 : 0;

    return {
      thisWeekLabel: thisWeekCount > 0 ? `+${thisWeekCount} this week` : 'No new this week',
      thisWeekUp: thisWeekCount > 0,
      amountTrend,
      amountUp,
      avgTaxRateLabel: subtotalSum > 0 ? `Avg ${avgTaxRate.toFixed(1)}% rate` : 'No data yet',
    };
  }, [purchaseTransactions, kpis.totalTax]);

  const kpiCards = [
    {
      label: 'Total Purchases',
      value: kpis.totalPurchases.toString(),
      sub: 'All transactions',
      icon: 'ShoppingBagIcon',
      color: 'text-blue-700',
      bg: 'bg-blue-50',
      trend: kpiTrends.thisWeekLabel,
      up: kpiTrends.thisWeekUp,
    },
    {
      label: 'Purchase Amount',
      value: fmt(kpis.totalAmount),
      sub: 'Gross purchase value',
      icon: 'CurrencyDollarIcon',
      color: 'text-slate-700',
      bg: 'bg-slate-50',
      trend: kpiTrends.amountTrend,
      up: kpiTrends.amountUp,
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
      trend: kpiTrends.avgTaxRateLabel,
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
                    tickFormatter={(v) => fx(formatRupiah(v, true))}
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
                    className={`grid grid-cols-[1fr_auto_auto] items-center gap-3 text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                      activeStatus === index ? 'bg-secondary' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className={`truncate ${activeStatus === index ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>
                        {item.name}
                      </span>
                    </div>
                    <span className="font-semibold text-foreground tabular-nums w-8 text-right">{displayValue}</span>
                    <span className="text-muted-foreground tabular-nums w-10 text-right">{displayPct.toFixed(0)}%</span>
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
                <XAxis type="number" tick={{ fontSize: 10, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(v) => fx(formatRupiah(v, true))} />
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
                const pct = paymentStatusTotal > 0 ? Math.round((item.value / paymentStatusTotal) * 100) : 0;
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
            <Link href="/transactions/purchase/exceptions" className="text-xs text-primary hover:underline font-medium">View all exceptions →</Link>
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