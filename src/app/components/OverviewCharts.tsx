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
import { ComposedChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import InteractiveDonutChart, { DonutLivePreview as AgingLivePreview } from '@/components/shared/InteractiveDonutChart';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import { useProfitLossData, fetchMonthlyPLForYear, type MonthlyPLRow } from '@/app/financial-statements/lib/useProfitLossData';
import { useActiveClient } from '@/lib/activeClient';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, arAgingFromInvoices } from '@/app/transactions/lib/arBridge';
// [FIX] Chart "Actual vs Budget" ini sebelumnya masih pakai konstanta
// BUDGET hardcoded (src/lib/financialData.tsx, isinya semua 0) --
// sekarang disambungkan ke data ASLI overview_overview_financial_budget
// (schema 2_Overview) lewat ambilFinancialBudget(), SAMA PERSIS dengan
// pola yang sudah dipakai KPIBentoGrid.tsx, supaya angka Budget di kedua
// tempat ini selalu konsisten.
import { ambilFinancialBudget } from '@/app/agent-ai/lib/api';

export type OverviewViewMode = 'Actual' | 'Budget' | 'Previous Year';

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];


// ── Data contoh (fallback) -- dipakai saat belum ada client aktif / belum
// ada jurnal & transaksi Sales sama sekali, supaya tampilan sama seperti
// versi mock sebelumnya (tidak ada regresi saat demo tanpa data asli). ──
const SAMPLE_REVENUE = [
  { month: 'Jan', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Feb', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Mar', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Apr', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'May', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Jun', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Jul', revenue: 0, expenses: 0, netProfit: 0 },
  { month: 'Aug', revenue: 0, expenses: 0, netProfit: 0 },
];

// Values are in Jt (Rp million) units — converted to raw IDR before display.
const SAMPLE_AGING = [
  { name: 'Current', value: 0, color: '#16A34A' },
  { name: '1–30 Days', value: 0, color: '#2563EB' },
  { name: '31–60 Days', value: 0, color: '#D97706' },
  { name: '61–90 Days', value: 0, color: '#EA580C' },
  { name: '90+ Days', value: 0, color: '#DC2626' },
];
const SAMPLE_AGING_TOTAL = SAMPLE_AGING.reduce((s, a) => s + a.value, 0);

export default function OverviewCharts({ viewMode = 'Actual', branchId }: { viewMode?: OverviewViewMode; branchId?: string }) {
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
    if (viewMode === 'Previous Year') return [anchorYear - 1];
    if (period === '12M') return anchorAbs - 11 < anchorYear * 12 ? [anchorYear - 1] : [];
    if (period === '3Y') return [anchorYear - 1, anchorYear - 2];
    return [];
  }, [plIsSample, viewMode, period, anchorAbs, anchorYear]);

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

  // ── Mode "Anggaran": bandingkan Aktual (YTD, jumlah bulan yg sudah punya
  // transaksi) vs Anggaran ASLI (overview_overview_financial_budget,
  // sudah di-YTD-kan langsung oleh backend sampai `elapsedMonths` --
  // lihat ambil_financial_budget() di db_client.py), supaya perbandingannya
  // apple-to-apple walau baru berjalan sebagian tahun. Kalau sample data,
  // pakai jumlah bulan contoh (8/12) dan Anggaran tetap 0 (tidak ada
  // client aktif untuk di-query). ──
  const elapsedMonths = plIsSample ? SAMPLE_REVENUE.length : Math.max(1, MONTHLY_PL.length);

  // [BARU] Anggaran P&L REAL, pola fetch identik dengan KPIBentoGrid.tsx.
  const [budgetData, setBudgetData] = useState<{
    revenue: number; cogs: number; grossProfit: number;
    operatingExpenses: number; ebitda: number; netProfit: number; ada_data: boolean;
  } | null>(null);
  const fetchingBudgetRef = useRef(false);
  useEffect(() => {
    if (viewMode !== 'Budget' || plIsSample || !activeClientId || fetchingBudgetRef.current) return;
    fetchingBudgetRef.current = true;
    ambilFinancialBudget(activeClientId, anchorYear, elapsedMonths, branchId)
      .then((res) => { fetchingBudgetRef.current = false; setBudgetData(res?.ada_data ? res : null); })
      .catch(() => { fetchingBudgetRef.current = false; setBudgetData(null); });
  }, [viewMode, plIsSample, activeClientId, anchorYear, elapsedMonths, branchId]);

  const actualYtdByField = useMemo(() => {
    const source = plIsSample
      ? SAMPLE_REVENUE.map((r) => {
          // Data contoh: pecah 'expenses' jadi cogs/opEx/other secara proporsional
          // supaya SEMUA kategori (bukan cuma Revenue & Net Profit) tampil di
          // chart Aktual vs Anggaran waktu belum ada client aktif.
          const cogs = r.expenses * 0.62;
          const opEx = r.expenses * 0.3;
          const grossProfit = r.revenue - cogs;
          const ebitda = grossProfit - opEx;
          return { revenue: r.revenue / 1e6, cogs: cogs / 1e6, grossProfit: grossProfit / 1e6, opEx: opEx / 1e6, ebitda: ebitda / 1e6, netProfit: r.netProfit / 1e6 };
        })
      : MONTHLY_PL;
    return source.reduce(
      (acc, r: any) => ({
        revenue: acc.revenue + (r.revenue || 0),
        cogs: acc.cogs + (r.cogs || 0),
        grossProfit: acc.grossProfit + (r.grossProfit || 0),
        opEx: acc.opEx + (r.opEx || 0),
        ebitda: acc.ebitda + (r.ebitda || 0),
        netProfit: acc.netProfit + (r.netProfit || 0),
      }),
      { revenue: 0, cogs: 0, grossProfit: 0, opEx: 0, ebitda: 0, netProfit: 0 }
    );
  }, [plIsSample, MONTHLY_PL]);

  const budgetComparisonData = useMemo(() => {
    // budgetData datang dari backend dalam Rupiah mentah (bukan Jt) dan
    // SUDAH di-YTD-kan sampai elapsedMonths -- konversi ke Jt dulu di sini
    // supaya sejajar dengan actualYtdByField (juga dalam Jt), baru
    // dikonversi balik ke Rupiah mentah (`*Raw`) khusus untuk chart, sama
    // seperti pola field lain di komponen ini.
    const b = budgetData;
    const rows: { name: string; actual: number; budget: number }[] = [
      { name: t('Revenue'), actual: actualYtdByField.revenue, budget: b ? b.revenue / 1e6 : 0 },
      { name: t('COGS'), actual: actualYtdByField.cogs, budget: b ? b.cogs / 1e6 : 0 },
      { name: t('Gross Profit'), actual: actualYtdByField.grossProfit, budget: b ? b.grossProfit / 1e6 : 0 },
      { name: t('OpEx'), actual: actualYtdByField.opEx, budget: b ? b.operatingExpenses / 1e6 : 0 },
      { name: t('EBITDA'), actual: actualYtdByField.ebitda, budget: b ? b.ebitda / 1e6 : 0 },
      { name: t('Net Profit'), actual: actualYtdByField.netProfit, budget: b ? b.netProfit / 1e6 : 0 },
    ];
    return rows.map((r) => ({ ...r, actualRaw: r.actual * 1e6, budgetRaw: r.budget * 1e6 }));
  }, [actualYtdByField, budgetData, t]);

  // ── Mode "Tahun Sebelumnya": pendapatan bulanan tahun berjalan vs tahun
  // lalu, sejajar per nama bulan, sepanjang bulan yg sudah punya transaksi
  // tahun ini (atau data contoh Jan–Aug kalau belum ada client aktif). ──
  const yoyData = useMemo(() => {
    if (plIsSample || MONTHLY_PL.length === 0) {
      return SAMPLE_REVENUE.map((r, i) => ({
        month: r.month,
        thisYear: r.revenue,
        lastYear: Math.round(r.revenue * 0.88),
        thisYearProfit: r.netProfit,
        lastYearProfit: Math.round(r.netProfit * 0.86),
      }));
    }
    const lastYearRows = priorYearsPL[anchorYear - 1] || [];
    const lastYearByMonth: Record<string, MonthlyPLRow> = {};
    lastYearRows.forEach((r) => { lastYearByMonth[r.month] = r; });
    return MONTHLY_PL.map((r) => ({
      month: r.month,
      thisYear: r.revenue * 1e6,
      lastYear: (lastYearByMonth[r.month]?.revenue || 0) * 1e6,
      thisYearProfit: r.netProfit * 1e6,
      lastYearProfit: (lastYearByMonth[r.month]?.netProfit || 0) * 1e6,
    }));
  }, [plIsSample, MONTHLY_PL, priorYearsPL, anchorYear]);
  const isLoadingLastYear = viewMode === 'Previous Year' && !plIsSample && !(anchorYear - 1 in priorYearsPL);

  const fmt = (v: number) => formatMoney(v, currency);

  // ── Zoom skala harga (drag vertikal di sumbu Y, kayak TradingView) ──
  // baseMax: batas atas alami dari data (dibulatkan ke atas + sedikit padding).
  // priceZoom: 1 = normal. >1 = zoom in (rentang harga makin sempit, makin rinci).
  //            <1 = zoom out (rentang makin lebar).
  const baseMax = useMemo(() => {
    if (viewMode === 'Previous Year') {
      const maxVal = Math.max(0, ...yoyData.map((d: any) => Math.max(d.thisYear, d.lastYear)));
      return maxVal * 1.08 || 1;
    }
    if (viewMode === 'Budget') {
      const maxVal = Math.max(0, ...budgetComparisonData.map((d: any) => Math.max(d.actualRaw, d.budgetRaw)));
      return maxVal * 1.08 || 1;
    }
    const maxVal = Math.max(0, ...revenueData.map((d: any) => Math.max(d.revenue, d.expenses, d.netProfit)));
    return maxVal * 1.08 || 1;
  }, [revenueData, yoyData, budgetComparisonData, viewMode]);

  const [priceZoom, setPriceZoom] = useState(1);
  const dragRef = React.useRef<{ startY: number; startZoom: number } | null>(null);

  // Tick "nice" (angka bulat) untuk label sumbu — domain chart tetap kontinu
  // (baseMax / priceZoom) supaya drag zoom tetap smooth, cuma label/gridline
  // yang dihitung ke angka bulat terdekat.
  const { ticks: yTicks } = useMemo(
    () => getNiceTicksFromZero(baseMax / priceZoom, 6),
    [baseMax, priceZoom]
  );
  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);

  // ── Drag titik data (Revenue/Expenses/Net Profit) di bulan yang sedang
  // di-hover, mirip fitur tarik di AR Aging Donut: tarik naik/turun untuk
  // preview nilai (live), lepas -> "spring back" ke nilai aslinya.
  // Kalibrasi piksel<->nilai diambil dari titik-titik lain yang SUDAH
  // di-render (bukan konstanta tebakan), jadi otomatis akurat walau chart
  // sedang di-zoom (priceZoom) atau lebar containernya berubah-ubah. ──
  type LineKey = 'revenue' | 'expenses' | 'netProfit' | 'thisYear' | 'lastYear' | 'actualRaw' | 'budgetRaw';

  const dotsRef = useRef<Record<LineKey, { value: number; cy: number }[]>>({
    revenue: [],
    expenses: [],
    netProfit: [],
    thisYear: [],
    lastYear: [],
    actualRaw: [],
    budgetRaw: [],
  });

  const [dragPoint, setDragPoint] = useState<{ key: LineKey; index: number; liveValue: number } | null>(null);
  const dragPointRef = useRef<{
    key: LineKey;
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number; // px per 1 satuan nilai (negatif: makin ke atas makin besar nilainya)
  } | null>(null);
  const pointAnimRef = useRef<number | null>(null);
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const stopPointSpring = () => {
    if (pointAnimRef.current) cancelAnimationFrame(pointAnimRef.current);
    pointAnimRef.current = null;
  };

  const easeOutQuintPoint = (t: number) => 1 - Math.pow(1 - t, 5);

  const springBackPoint = () => {
    const drag = dragPointRef.current;
    if (!drag) return;
    stopPointSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const duration = 380;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = easeOutQuintPoint(t);
      const next = from + (to - from) * eased;
      if (dragPointRef.current) {
        dragPointRef.current = { ...dragPointRef.current, liveValue: next };
        setDragPoint({ key: drag.key, index: drag.index, liveValue: next });
      }
      if (t < 1) {
        pointAnimRef.current = requestAnimationFrame(step);
      } else {
        dragPointRef.current = null;
        setDragPoint(null);
        pointAnimRef.current = null;
      }
    };
    pointAnimRef.current = requestAnimationFrame(step);
  };

  const handleDotPointerDown = (key: LineKey, index: number, startValue: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopPointSpring();

    // Kalibrasi px-per-unit dari 2 titik lain (selain yang sedang ditarik) di
    // garis yang sama -- linear, jadi titik mana saja bisa dipakai asal beda nilai.
    const samples = dotsRef.current[key].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      // fallback kalau kalibrasi gagal (mis. cuma 1 titik data): perkiraan kasar dari yDomain
      const [dMin, dMax] = yDomainRef.current;
      pxPerUnit = -226 / (dMax - dMin || 1);
    }

    dragPointRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setDragPoint({ key, index, liveValue: startValue });
  };

  // Drag titik untuk bar chart (tab Budget) -- kalibrasi langsung dari tinggi
  // bar yang di-render (barHeight px = startValue satuan, baseline di 0),
  // jadi tidak perlu titik lain sebagai referensi seperti pada garis.
  const handleBarPointerDown = (key: 'actualRaw' | 'budgetRaw', index: number, startValue: number, barHeight: number) => (
    e: React.PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    stopPointSpring();
    let pxPerUnit = startValue !== 0 ? -barHeight / startValue : -1;
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;
    dragPointRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setDragPoint({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragPointRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = yDomainRef.current;
      const maxValue = dMax * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      dragPointRef.current = { ...drag, liveValue: next };
      setDragPoint({ key: drag.key, index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (dragPointRef.current) springBackPoint();
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

  // Reset drag kalau ganti periode/filter/tab (index bulan & kalibrasi piksel jadi tidak relevan lagi)
  useEffect(() => {
    stopPointSpring();
    dragPointRef.current = null;
    setDragPoint(null);
    dotsRef.current = { revenue: [], expenses: [], netProfit: [], thisYear: [], lastYear: [], actualRaw: [], budgetRaw: [] };
  }, [period, viewMode]);

  // Data yang benar-benar dikirim ke chart: sama seperti revenueData, kecuali
  // satu titik (bulan + garis) yang sedang ditarik/spring-back diganti nilai live-nya.
  const chartData = useMemo(() => {
    if (!dragPoint) return revenueData;
    return revenueData.map((d: any, i: number) =>
      i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d
    );
  }, [revenueData, dragPoint]);

  const yoyChartData = useMemo(() => {
    if (!dragPoint) return yoyData;
    return yoyData.map((d: any, i: number) =>
      i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d
    );
  }, [yoyData, dragPoint]);

  const budgetChartData = useMemo(() => {
    if (!dragPoint) return budgetComparisonData;
    return budgetComparisonData.map((d: any, i: number) =>
      i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d
    );
  }, [budgetComparisonData, dragPoint]);

  // Bar custom shape (tab Budget): seluruh badan bar bisa digenggam & ditarik
  // naik/turun (bukan cuma strip tipis di ujungnya) supaya terasa alami.
  const renderInteractiveBar = (key: 'actualRaw' | 'budgetRaw', fillColor: string, fillOpacity: number = 1) => (props: any) => {
    const { x, y, width, height, index, payload } = props;
    if (x == null || y == null) return null;
    const isDraggingThis = dragPoint?.key === key && dragPoint?.index === index;
    const h = Math.max(0, height);
    return (
      <g>
        <rect
          x={x}
          y={y}
          width={width}
          height={h}
          fill={fillColor}
          fillOpacity={fillOpacity}
          rx={3}
          ry={3}
          stroke={isDraggingThis ? fillColor : 'none'}
          strokeWidth={isDraggingThis ? 1.5 : 0}
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(key, index, payload[key], height)}
        />
        {/* Perluas area genggam ke atas sedikit, biar mudah ditarik walau bar-nya pendek/kecil */}
        <rect
          x={x}
          y={y - 10}
          width={width}
          height={10}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleBarPointerDown(key, index, payload[key], height)}
        />
      </g>
    );
  };

  // Dot tak terlihat di SETIAP titik data: cuma untuk merekam posisi piksel
  // (cy) & nilai asli tiap titik ke dotsRef, dipakai buat kalibrasi drag.
  const renderCalibrationDot = (key: LineKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    dotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  const renderActiveDot = (key: LineKey, color: string) => (props: any) => {
    const { cx, cy, index, value } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = dragPoint?.key === key && dragPoint?.index === index;
    return (
      <g key={`pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 4} fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleDotPointerDown(key, index, value)}
        />
      </g>
    );
  };

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

  const BudgetTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const actual = payload.find((p: any) => p.dataKey === 'actualRaw')?.value || 0;
    const budget = payload.find((p: any) => p.dataKey === 'budgetRaw')?.value || 0;
    const variancePct = budget !== 0 ? ((actual - budget) / budget) * 100 : 0;
    return (
      <div className="bg-card border border-border rounded-lg p-3 shadow-dropdown text-xs min-w-[180px]">
        <p className="font-600 text-foreground mb-1.5">{label}</p>
        {payload.map((p: any, i: number) => (
          <div key={`btt-${i}`} className="flex items-center justify-between gap-3 py-0.5">
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color || p.fill }} />
              {p.name}
            </span>
            <span className="font-600 text-foreground">{formatMoney(p.value, currency)}</span>
          </div>
        ))}
        <div className={`mt-1.5 pt-1.5 border-t border-border font-600 ${variancePct >= 0 ? 'text-positive' : 'text-negative'}`}>
          {variancePct >= 0 ? '+' : ''}{variancePct.toFixed(1)}% {t('vs anggaran')}
        </div>
      </div>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 2xl:grid-cols-3 gap-4">
      {/* Revenue Chart / Budget Comparison / YoY Comparison — tergantung viewMode */}
      <div className="xl:col-span-2 bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-md font-600 text-foreground">
              {viewMode === 'Budget'
                ? t('Aktual vs Anggaran')
                : viewMode === 'Previous Year'
                ? t('Pendapatan: Tahun Ini vs Tahun Lalu')
                : t('Revenue vs Expenses vs Net Profit')}
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {viewMode === 'Budget'
                ? `${companyName} · ${t('YTD')} (${elapsedMonths} ${t('bulan')})`
                : viewMode === 'Previous Year'
                ? `${companyName} · ${yoyData[0]?.month || ''}${yoyData.length > 1 ? ` – ${yoyData[yoyData.length - 1].month}` : ''}`
                : plIsSample
                ? `${companyName} · Jan–Aug 2026`
                : `${companyName} · ${revenueData[0]?.month || ''}${revenueData.length > 1 ? ` – ${revenueData[revenueData.length - 1].month}` : ''}`}
            </p>
          </div>
          {viewMode === 'Actual' && (
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
          )}
        </div>

        {viewMode === 'Budget' && (
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={budgetChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={72}
                ticks={yTicks}
                domain={yDomain}
                allowDataOverflow
              />
              <Tooltip content={<BudgetTooltip />} cursor={false} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => t(v as string)} />
              <Bar
                dataKey="actualRaw"
                name={t('Actual')}
                fill="var(--primary)"
                shape={renderInteractiveBar('actualRaw', 'var(--primary)') as any}
                isAnimationActive={!dragPoint}
              />
              <Bar
                dataKey="budgetRaw"
                name={t('Budget')}
                fill="var(--muted-foreground)"
                fillOpacity={0.35}
                shape={renderInteractiveBar('budgetRaw', 'var(--muted-foreground)', 0.35) as any}
                isAnimationActive={!dragPoint}
              />
            </BarChart>
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
        )}

        {viewMode === 'Previous Year' && isLoadingLastYear && (
          <div className="h-[260px] flex items-center justify-center text-sm text-muted-foreground">
            {t('Memuat data tahun lalu...')}
          </div>
        )}

        {viewMode === 'Previous Year' && !isLoadingLastYear && (
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={yoyChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={72}
                ticks={yTicks}
                domain={yDomain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => t(v as string)} />
              <Line
                type="monotone"
                dataKey="thisYear"
                name={t('Tahun Ini')}
                stroke="var(--primary)"
                strokeWidth={2}
                dot={renderCalibrationDot('thisYear') as any}
                activeDot={renderActiveDot('thisYear', 'var(--primary)') as any}
                isAnimationActive={!dragPoint}
              />
              <Line
                type="monotone"
                dataKey="lastYear"
                name={t('Tahun Lalu')}
                stroke="var(--muted-foreground)"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={renderCalibrationDot('lastYear') as any}
                activeDot={renderActiveDot('lastYear', 'var(--muted-foreground)') as any}
                isAnimationActive={!dragPoint}
              />
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
        )}

        {viewMode === 'Actual' && (
        <div className="relative">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={72}
                ticks={yTicks}
                domain={yDomain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Line
                type="monotone"
                dataKey="revenue"
                name={t('Revenue')}
                stroke="var(--primary)"
                strokeWidth={2}
                dot={renderCalibrationDot('revenue') as any}
                activeDot={renderActiveDot('revenue', 'var(--primary)') as any}
                isAnimationActive={!dragPoint}
              />
              <Line
                type="monotone"
                dataKey="expenses"
                name={t('Expenses')}
                stroke="var(--danger)"
                strokeWidth={2}
                dot={renderCalibrationDot('expenses') as any}
                activeDot={renderActiveDot('expenses', 'var(--danger)') as any}
                isAnimationActive={!dragPoint}
              />
              <Line
                type="monotone"
                dataKey="netProfit"
                name={t('Net Profit')}
                stroke="var(--success)"
                strokeWidth={2}
                strokeDasharray="4 2"
                dot={renderCalibrationDot('netProfit') as any}
                activeDot={renderActiveDot('netProfit', 'var(--success)') as any}
                isAnimationActive={!dragPoint}
              />
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
        )}
      </div>

      {/* AR Aging Donut */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <div className="mb-4">
          <h3 className="text-md font-600 text-foreground">{t('AR Aging Analysis')}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isAgingSample
              ? fx(t('Total AR: Rp 0 outstanding'))
              : fx(`Total AR: ${formatMoney(totalAgingJt * 1e6, currency)} outstanding`)}
          </p>
        </div>
        <InteractiveDonutChart
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
              ? (SAMPLE_AGING_TOTAL > 0 ? (item.value / SAMPLE_AGING_TOTAL) * 100 : 0)
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