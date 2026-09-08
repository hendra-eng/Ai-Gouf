'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatRupiah, type Vendor } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
import type { apAgingFromBills, apTrendFromBills, paymentForecastFromBills } from '@/app/transactions/lib/apBridge';
import APAgingChartInner from './APAgingChartInner';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

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

type ApTrendKey = 'newBills' | 'payments';

// Spring-back setelah drag titik dilepas — pola & durasi sama persis dengan
// chart lain (Financial Overview, Total Assets/Liabilities/Equity Trend, dst).
const AP_TREND_SPRING_DURATION_MS = 420;
const apTrendEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export default function APCharts({ agingData, trendData, forecastData, vendors, totalAP, overdueAP }: APChartsProps) {
  const [trendPeriod, setTrendPeriod] = useState<'6M' | 'YTD'>('YTD');
  const { fx } = useCurrency();

  const topVendors = vendors.slice(0, 6).map((v) => ({ name: v.name.replace('PT ', '').replace('CV ', ''), amount: v.totalAP }));
  const thisMonthForecast = forecastData.find((pf) => pf.period === 'This Month')?.amount || 0;
  const maxForecastAmount = Math.max(1, ...forecastData.map((pf) => pf.amount));

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) pada chart AP Trend — tarik
  // naik/turun di area label sumbu Y buat zoom in/out skala, double-click
  // buat reset. Data (`trendData`) tidak pernah diubah, cuma domain/tick
  // sumbu yang berubah. ──
  const apTrendBaseMax = useMemo(
    () => Math.max(0, ...trendData.map((d: any) => Math.max(d.newBills, d.payments))) * 1.08 || 1,
    [trendData]
  );
  const [apTrendZoom, setApTrendZoom] = useState(1);
  const apTrendZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: apTrendYTicks } = useMemo(
    () => getNiceTicksFromZero(apTrendBaseMax / apTrendZoom, 4),
    [apTrendBaseMax, apTrendZoom]
  );
  const apTrendYDomain = useMemo<[number, number]>(
    () => [0, apTrendBaseMax / apTrendZoom],
    [apTrendBaseMax, apTrendZoom]
  );

  const handleApTrendAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    apTrendZoomDragRef.current = { startY: e.clientY, startZoom: apTrendZoom };
    const onMove = (ev: MouseEvent) => {
      if (!apTrendZoomDragRef.current) return;
      const deltaY = apTrendZoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, apTrendZoomDragRef.current.startZoom * factor));
      setApTrendZoom(next);
    };
    const onUp = () => {
      apTrendZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetApTrendZoom = () => setApTrendZoom(1);

  // ── Fitur 2: Drag titik garis (New Bills/Payments Made) di bulan yang
  // sedang di-hover — tarik naik/turun untuk preview nilai (live), lepas ->
  // "spring back" ke nilai aslinya. Kalibrasi piksel<->nilai diambil dari
  // titik-titik lain yang sudah dirender, jadi tetap akurat walau chart
  // sedang di-zoom (apTrendZoom) atau lebar containernya berubah-ubah. ──
  const apTrendDotsRef = useRef<Record<ApTrendKey, { value: number; cy: number }[]>>({
    newBills: [],
    payments: [],
  });

  const [apTrendDragPoint, setApTrendDragPoint] = useState<{ key: ApTrendKey; index: number; liveValue: number } | null>(null);
  const apTrendDragPointRef = useRef<{
    key: ApTrendKey;
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number; // px per 1 satuan nilai (negatif: makin ke atas makin besar nilainya)
  } | null>(null);
  const apTrendPointAnimRef = useRef<number | null>(null);
  const apTrendYDomainRef = useRef(apTrendYDomain);
  apTrendYDomainRef.current = apTrendYDomain;

  const stopApTrendPointSpring = () => {
    if (apTrendPointAnimRef.current) cancelAnimationFrame(apTrendPointAnimRef.current);
    apTrendPointAnimRef.current = null;
  };

  const apTrendSpringBackPoint = useCallback(() => {
    const drag = apTrendDragPointRef.current;
    if (!drag) return;
    stopApTrendPointSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { key, index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / AP_TREND_SPRING_DURATION_MS);
      const eased = apTrendEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (apTrendDragPointRef.current) apTrendDragPointRef.current.liveValue = next;
      setApTrendDragPoint({ key, index, liveValue: next });
      if (elapsed < 1) {
        apTrendPointAnimRef.current = requestAnimationFrame(step);
      } else {
        apTrendDragPointRef.current = null;
        apTrendPointAnimRef.current = null;
        setApTrendDragPoint(null);
      }
    };
    apTrendPointAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleApTrendDotPointerDown = (key: ApTrendKey, index: number, startValue: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopApTrendPointSpring();

    // Kalibrasi px-per-unit dari 2 titik lain (selain yang sedang ditarik) di
    // garis yang sama -- linear, jadi titik mana saja bisa dipakai asal beda nilai.
    const samples = apTrendDotsRef.current[key].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      // fallback kalau kalibrasi gagal (mis. cuma 1 titik data): perkiraan kasar dari yDomain
      const [dMin, dMax] = apTrendYDomainRef.current;
      pxPerUnit = -150 / (dMax - dMin || 1);
    }

    apTrendDragPointRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setApTrendDragPoint({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = apTrendDragPointRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = apTrendYDomainRef.current;
      const maxValue = dMax * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setApTrendDragPoint({ key: drag.key, index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (apTrendDragPointRef.current) apTrendSpringBackPoint();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [apTrendSpringBackPoint]);

  // Reset drag & zoom kalau data/periode berubah (mis. ganti client aktif
  // atau ganti tab 6M/YTD) — index bulan & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopApTrendPointSpring();
    apTrendDragPointRef.current = null;
    setApTrendDragPoint(null);
    apTrendZoomDragRef.current = null;
    setApTrendZoom(1);
    apTrendDotsRef.current = { newBills: [], payments: [] };
  }, [trendData, trendPeriod]);

  // Data yang benar-benar dikirim ke chart: sama seperti `trendData`, kecuali
  // satu titik (bulan + garis) yang sedang ditarik/spring-back diganti nilai
  // live-nya. Data asli (`trendData`/props) TIDAK pernah dimutasi.
  const apTrendDisplayData = useMemo(() => {
    if (!apTrendDragPoint) return trendData;
    return trendData.map((d: any, i: number) =>
      i === apTrendDragPoint.index ? { ...d, [apTrendDragPoint.key]: apTrendDragPoint.liveValue } : d
    );
  }, [trendData, apTrendDragPoint]);

  // Dot tak terlihat di SETIAP titik data: cuma untuk merekam posisi piksel
  // (cy) & nilai asli tiap titik ke apTrendDotsRef, dipakai buat kalibrasi drag.
  const renderApTrendCalibrationDot = (key: ApTrendKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    apTrendDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot yang terlihat & bisa digenggam di bulan yang sedang di-hover — tarik
  // vertikal untuk preview, lepas untuk spring-back ke nilai asli.
  const renderApTrendActiveDot = (key: ApTrendKey, color: string) => (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = apTrendDragPoint?.key === key && apTrendDragPoint?.index === index;
    return (
      <g key={`pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 4} fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleApTrendDotPointerDown(key, index, payload[key])}
        />
      </g>
    );
  };

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
        <APAgingChartInner data={agingData} fx={(v) => fx(formatRupiah(v, true))} />
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
          <div className="relative">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={apTrendDisplayData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
                <YAxis
                  tickFormatter={fmt}
                  tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                  axisLine={false}
                  tickLine={false}
                  width={42}
                  ticks={apTrendYTicks}
                  domain={apTrendYDomain}
                  allowDataOverflow
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="newBills"
                  name="New Bills"
                  stroke="var(--warning)"
                  strokeWidth={2}
                  fill="url(#gradNewBills)"
                  dot={renderApTrendCalibrationDot('newBills') as any}
                  activeDot={renderApTrendActiveDot('newBills', 'var(--warning)') as any}
                  isAnimationActive={!apTrendDragPoint}
                />
                <Area
                  type="monotone"
                  dataKey="payments"
                  name="Payments Made"
                  stroke="var(--success)"
                  strokeWidth={2}
                  fill="url(#gradPayments)"
                  dot={renderApTrendCalibrationDot('payments') as any}
                  activeDot={renderApTrendActiveDot('payments', 'var(--success)') as any}
                  isAnimationActive={!apTrendDragPoint}
                />
              </AreaChart>
            </ResponsiveContainer>
            {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
            <div
              onMouseDown={handleApTrendAxisMouseDown}
              onDoubleClick={resetApTrendZoom}
              title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
              className="absolute top-0 left-0 h-full cursor-ns-resize"
              style={{ width: 42 }}
            />
          </div>
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