'use client';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { formatRupiah, type Customer } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type { arAgingFromInvoices, arTrendFromInvoices } from '@/app/transactions/lib/arBridge';
import InteractiveDonutChart, { DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import ARAgingChartInner from './ARAgingChartInner';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// [BARU] 2 fitur interaktif dipindahkan dari chart "Revenue vs Expenses vs Net
// Profit" di Financial Overview (src/app/components/OverviewCharts.tsx) ke
// chart line di halaman AR ini (Receivables Trend & DSO Trend), TANPA
// mengubah data/logic yang sudah ada di halaman ini sama sekali:
//   1) Drag sumbu Y (zoom skala harga, kayak TradingView) -- overlay tak
//      kasat mata di atas label sumbu Y, tarik naik/turun untuk zoom in/out,
//      klik dua kali untuk reset.
//   2) Drag titik pada garis chart (preview nilai) -- tarik satu titik data
//      naik/turun untuk lihat efeknya secara live, lepas untuk "spring back"
//      ke nilai aslinya. Ini murni preview visual, tidak menyimpan/mengubah
//      data apa pun.
// Diekstrak jadi satu hook `useDragZoomChart` supaya bisa dipakai di kedua
// chart (Receivables Trend & DSO Trend) tanpa duplikasi kode.
function useDragZoomChart(baseMax: number, resetKey: unknown) {
  // ── Fitur 1: drag sumbu Y untuk zoom skala harga ──
  const [priceZoom, setPriceZoom] = useState(1);
  const axisDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);
  const { ticks: yTicks } = useMemo(() => getNiceTicksFromZero(baseMax / priceZoom, 5), [baseMax, priceZoom]);
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    axisDragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!axisDragRef.current) return;
      const deltaY = axisDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, axisDragRef.current.startZoom * factor));
      setPriceZoom(next);
    };
    const onUp = () => {
      axisDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetZoom = () => setPriceZoom(1);

  // ── Fitur 2: drag titik pada garis untuk preview nilai (spring back saat dilepas) ──
  const dotsRef = useRef<Record<string, { value: number; cy: number }[]>>({});
  const [dragPoint, setDragPoint] = useState<{ key: string; index: number; liveValue: number } | null>(null);
  const dragPointRef = useRef<{
    key: string; index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
  } | null>(null);
  const pointAnimRef = useRef<number | null>(null);

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

  const handleDotPointerDown = (key: string, index: number, startValue: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopPointSpring();
    const samples = (dotsRef.current[key] || []).filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = yDomainRef.current;
      pxPerUnit = -226 / (dMax - dMin || 1);
    }
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

  // Reset drag & kalibrasi kalau resetKey berubah (mis. ganti filter periode)
  useEffect(() => {
    stopPointSpring();
    dragPointRef.current = null;
    setDragPoint(null);
    dotsRef.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const renderCalibrationDot = (key: string) => (props: any) => {
    const { cx, cy, index, payload } = props;
    if (!dotsRef.current[key]) dotsRef.current[key] = [];
    dotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  const renderActiveDot = (key: string, color: string) => (props: any) => {
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

  function applyDragPreview<T extends Record<string, any>>(data: T[]): T[] {
    if (!dragPoint) return data;
    return data.map((d, i) => (i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d));
  }

  return {
    yDomain, yTicks, handleAxisMouseDown, resetZoom,
    dragPoint, renderCalibrationDot, renderActiveDot, applyDragPreview,
  };
}

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

  const rows = top4.map((c, i) => ({
    name: c.name,
    amount: c.totalAR,
    value: Math.round((c.totalAR / totalAR) * 1000) / 10,
    color: CONCENTRATION_COLORS[i % CONCENTRATION_COLORS.length],
  }));
  if (othersAmount > 0) {
    rows.push({ name: 'Others', amount: othersAmount, value: Math.round((othersAmount / totalAR) * 1000) / 10, color: CONCENTRATION_COLORS[rows.length % CONCENTRATION_COLORS.length] });
  }
  return rows;
}

export default function ARCharts({ agingData, trendData, customers, totalAR, overdueAR, dso }: ARChartsProps) {
  const [trendPeriod, setTrendPeriod] = useState<'6M' | 'YTD'>('YTD');
  const [activeConc, setActiveConc] = useState<number | null>(null);
  const [concLivePreview, setConcLivePreview] = useState<DonutLivePreview[] | null>(null);
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

  // [BARU] Zoom sumbu Y + drag titik untuk "Receivables Trend" (newInvoices,
  // collections, closingAR) dan "DSO Trend" (dso) -- lihat useDragZoomChart.
  const trendBaseMax = useMemo(() => {
    const maxVal = Math.max(0, ...trendData.map((d: any) => Math.max(d.newInvoices || 0, d.collections || 0, d.closingAR || 0)));
    return maxVal * 1.08 || 1;
  }, [trendData]);
  const trendZoom = useDragZoomChart(trendBaseMax, trendPeriod);
  const trendChartData = trendZoom.applyDragPreview(trendData as any);

  const dsoBaseMax = useMemo(() => {
    const maxVal = Math.max(0, ...dsoTrend.map((d) => d.dso || 0));
    return maxVal * 1.08 || 1;
  }, [dsoTrend]);
  const dsoZoom = useDragZoomChart(dsoBaseMax, trendPeriod);
  const dsoChartData = dsoZoom.applyDragPreview(dsoTrend as any);

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
        <ARAgingChartInner data={agingData} fx={fx} />
      </div>

      {/* Customer Concentration */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-1">Customer Concentration</h3>
        <p className="text-xs text-muted-foreground mb-4">Top customers by AR balance</p>
        {customerConcentration.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-8">Belum ada data piutang</p>
        ) : (
          <>
            <div className="flex justify-center">
              <InteractiveDonutChart
                data={customerConcentration}
                height={160}
                rawValue
                activeIndex={activeConc}
                onActiveChange={setActiveConc}
                onLiveChange={setConcLivePreview}
              />
            </div>
            <div className="space-y-1.5 mt-2">
              {customerConcentration.map((c, i) => {
                const preview = concLivePreview?.[i];
                const displayPct = preview ? preview.pct : c.value;
                return (
                  <div
                    key={`conc-leg-${i}`}
                    onClick={() => setActiveConc((prev) => (prev === i ? null : i))}
                    className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                      activeConc === i ? 'bg-secondary' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      <span className={`truncate ${activeConc === i ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}>{c.name}</span>
                    </div>
                    <span className="font-semibold text-foreground ml-2 flex-shrink-0">{displayPct.toFixed(1)}%</span>
                  </div>
                );
              })}
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
        <div className="relative">
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
              <YAxis
                tickFormatter={fmt}
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={42}
                domain={trendZoom.yDomain}
                ticks={trendZoom.yTicks}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Area
                type="monotone"
                dataKey="newInvoices"
                name="New Invoices"
                stroke="var(--primary)"
                strokeWidth={2}
                fill="url(#gradNewInv)"
                dot={trendZoom.renderCalibrationDot('newInvoices') as any}
                activeDot={trendZoom.renderActiveDot('newInvoices', 'var(--primary)') as any}
                isAnimationActive={!trendZoom.dragPoint}
              />
              <Area
                type="monotone"
                dataKey="collections"
                name="Collections"
                stroke="var(--success)"
                strokeWidth={2}
                fill="url(#gradCollect)"
                dot={trendZoom.renderCalibrationDot('collections') as any}
                activeDot={trendZoom.renderActiveDot('collections', 'var(--success)') as any}
                isAnimationActive={!trendZoom.dragPoint}
              />
              <Line
                type="monotone"
                dataKey="closingAR"
                stroke="var(--warning)"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={trendZoom.renderCalibrationDot('closingAR') as any}
                activeDot={trendZoom.renderActiveDot('closingAR', 'var(--warning)') as any}
                isAnimationActive={!trendZoom.dragPoint}
              />
            </AreaChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala, klik dua kali untuk reset */}
          <div
            onMouseDown={trendZoom.handleAxisMouseDown}
            onDoubleClick={trendZoom.resetZoom}
            title="Tarik untuk zoom skala · klik dua kali untuk reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 42 }}
          />
        </div>
      </div>

      {/* DSO Trend */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-1">DSO Trend</h3>
        <p className="text-xs text-muted-foreground mb-4">Days Sales Outstanding (perkiraan bulanan)</p>
        <div className="relative">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={dsoChartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                width={30}
                unit="d"
                domain={dsoZoom.yDomain}
                ticks={dsoZoom.yTicks}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="dso"
                name="DSO"
                stroke="var(--warning)"
                strokeWidth={2}
                dot={dsoZoom.renderCalibrationDot('dso') as any}
                activeDot={dsoZoom.renderActiveDot('dso', 'var(--warning)') as any}
                isAnimationActive={!dsoZoom.dragPoint}
              />
            </LineChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala, klik dua kali untuk reset */}
          <div
            onMouseDown={dsoZoom.handleAxisMouseDown}
            onDoubleClick={dsoZoom.resetZoom}
            title="Tarik untuk zoom skala · klik dua kali untuk reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 30 }}
          />
        </div>
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