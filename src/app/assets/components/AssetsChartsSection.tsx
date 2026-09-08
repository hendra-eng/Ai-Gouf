'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { AssetsTrendRow, AssetsCompositionSlice } from '../lib/useAssetsData';
import InteractiveDonutChart, { DonutLivePreview as AgingLivePreview } from '@/components/shared/InteractiveDonutChart';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat AssetsContent.tsx
// (useAssetsData()) untuk sumber data ASLI client aktif.
const mockCompositionData: AssetsCompositionSlice[] = [
  { name: 'Cash & Bank', value: 2960, pct: 43.3, color: '#2563eb' },
  { name: 'Accounts Receivable', value: 1240, pct: 18.1, color: '#7c3aed' },
  { name: 'Inventory', value: 420, pct: 6.1, color: '#16a34a' },
  { name: 'Property & Equipment', value: 1200, pct: 17.5, color: '#d97706' },
  { name: 'Vehicles', value: 420, pct: 6.1, color: '#0891b2' },
  { name: 'Intangible Assets', value: 230, pct: 3.4, color: '#be185d' },
  { name: 'Other Assets', value: 370, pct: 5.4, color: '#64748b' },
];

const mockTrendData: AssetsTrendRow[] = [
  { month: 'Jan', total: 5200, current: 3100, nonCurrent: 2100 },
  { month: 'Feb', total: 5450, current: 3250, nonCurrent: 2200 },
  { month: 'Mar', total: 5680, current: 3380, nonCurrent: 2300 },
  { month: 'Apr', total: 5820, current: 3450, nonCurrent: 2370 },
  { month: 'May', total: 6050, current: 3620, nonCurrent: 2430 },
  { month: 'Jun', total: 6280, current: 3750, nonCurrent: 2530 },
  { month: 'Jul', total: 6560, current: 3920, nonCurrent: 2640 },
  { month: 'Aug', total: 6840, current: 4120, nonCurrent: 2720 },
];

const periodOptions = ['6M', 'YTD', '12M', '3Y'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[160px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={`tt-${i}`} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-600" style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}M</span>
        </div>
      ))}
    </div>
  );
};

interface AssetsChartsSectionProps {
  trendData?: AssetsTrendRow[];
  compositionData?: AssetsCompositionSlice[];
  companyName?: string | null;
  periodLabel?: string;
}

type TrendKey = 'total' | 'current' | 'nonCurrent';

// Spring-back setelah drag titik dilepas — pola & durasi sama persis dengan
// chart lain (Financial Overview, Debt Maturity, dst).
const TREND_SPRING_DURATION_MS = 420;
const trendEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export default function AssetsChartsSection({ trendData, compositionData, companyName, periodLabel }: AssetsChartsSectionProps) {
  const [activePeriod, setActivePeriod] = useState('YTD');
  const [activeComp, setActiveComp] = useState<number | null>(null);
  const [compLivePreview, setCompLivePreview] = useState<AgingLivePreview[] | null>(null);
  const trend = trendData && trendData.length > 0 ? trendData : mockTrendData;
  const composition = compositionData && compositionData.length > 0 ? compositionData : mockCompositionData;
  const subtitle = companyName ? `Monthly asset values — ${companyName}` : 'Monthly asset values — PT Nusantara Teknologi Indonesia';

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — tarik naik/turun di area
  // label sumbu Y buat zoom in/out skala, double-click buat reset. Data
  // (`trend`) tidak pernah diubah, cuma domain/tick sumbu yang berubah. ──
  const trendBaseMax = useMemo(
    () => Math.max(0, ...trend.map((d) => Math.max(d.total, d.current, d.nonCurrent))) * 1.08 || 1,
    [trend]
  );
  const [trendZoom, setTrendZoom] = useState(1);
  const trendZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);
  const { ticks: trendYTicks } = useMemo(
    () => getNiceTicksFromZero(trendBaseMax / trendZoom, 5),
    [trendBaseMax, trendZoom]
  );
  const trendYDomain = useMemo<[number, number]>(
    () => [0, trendBaseMax / trendZoom],
    [trendBaseMax, trendZoom]
  );

  const handleTrendAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    trendZoomDragRef.current = { startY: e.clientY, startZoom: trendZoom };
    const onMove = (ev: MouseEvent) => {
      if (!trendZoomDragRef.current) return;
      const deltaY = trendZoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, trendZoomDragRef.current.startZoom * factor));
      setTrendZoom(next);
    };
    const onUp = () => {
      trendZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetTrendZoom = () => setTrendZoom(1);

  // ── Fitur 2: Drag titik garis (Total/Current/Non-Current Assets) di bulan
  // yang sedang di-hover — tarik naik/turun untuk preview nilai (live), lepas
  // -> "spring back" ke nilai aslinya. Kalibrasi piksel<->nilai diambil dari
  // titik-titik lain yang sudah dirender, jadi tetap akurat walau chart
  // sedang di-zoom (trendZoom) atau lebar containernya berubah-ubah. ──
  const trendDotsRef = useRef<Record<TrendKey, { value: number; cy: number }[]>>({
    total: [],
    current: [],
    nonCurrent: [],
  });

  const [trendDragPoint, setTrendDragPoint] = useState<{ key: TrendKey; index: number; liveValue: number } | null>(null);
  const trendDragPointRef = useRef<{
    key: TrendKey;
    index: number;
    startValue: number;
    startClientY: number;
    liveValue: number;
    pxPerUnit: number; // px per 1 satuan nilai (negatif: makin ke atas makin besar nilainya)
  } | null>(null);
  const trendPointAnimRef = useRef<number | null>(null);
  const trendYDomainRef = useRef(trendYDomain);
  trendYDomainRef.current = trendYDomain;

  const stopTrendPointSpring = () => {
    if (trendPointAnimRef.current) cancelAnimationFrame(trendPointAnimRef.current);
    trendPointAnimRef.current = null;
  };

  const trendSpringBackPoint = useCallback(() => {
    const drag = trendDragPointRef.current;
    if (!drag) return;
    stopTrendPointSpring();
    const from = drag.liveValue;
    const to = drag.startValue;
    const { key, index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / TREND_SPRING_DURATION_MS);
      const eased = trendEaseOutQuint(elapsed);
      const next = from + (to - from) * eased;
      if (trendDragPointRef.current) trendDragPointRef.current.liveValue = next;
      setTrendDragPoint({ key, index, liveValue: next });
      if (elapsed < 1) {
        trendPointAnimRef.current = requestAnimationFrame(step);
      } else {
        trendDragPointRef.current = null;
        trendPointAnimRef.current = null;
        setTrendDragPoint(null);
      }
    };
    trendPointAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleTrendDotPointerDown = (key: TrendKey, index: number, startValue: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    stopTrendPointSpring();

    // Kalibrasi px-per-unit dari 2 titik lain (selain yang sedang ditarik) di
    // garis yang sama -- linear, jadi titik mana saja bisa dipakai asal beda nilai.
    const samples = trendDotsRef.current[key].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = -1;
    if (samples.length >= 2) {
      const a = samples[0];
      const b = samples[samples.length - 1];
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      // fallback kalau kalibrasi gagal (mis. cuma 1 titik data): perkiraan kasar dari yDomain
      const [dMin, dMax] = trendYDomainRef.current;
      pxPerUnit = -180 / (dMax - dMin || 1);
    }

    trendDragPointRef.current = { key, index, startValue, startClientY: e.clientY, liveValue: startValue, pxPerUnit };
    setTrendDragPoint({ key, index, liveValue: startValue });
  };

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = trendDragPointRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = trendYDomainRef.current;
      const maxValue = dMax * 1.4;
      const next = Math.max(0, Math.min(maxValue, drag.startValue + deltaY / drag.pxPerUnit));
      drag.liveValue = next;
      setTrendDragPoint({ key: drag.key, index: drag.index, liveValue: next });
    };
    const handleUp = () => {
      if (trendDragPointRef.current) trendSpringBackPoint();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [trendSpringBackPoint]);

  // Reset drag & zoom kalau data/periode berubah (mis. ganti client aktif
  // atau ganti tab 6M/YTD/12M/3Y) — index bulan & kalibrasi piksel jadi tidak relevan lagi.
  useEffect(() => {
    stopTrendPointSpring();
    trendDragPointRef.current = null;
    setTrendDragPoint(null);
    trendZoomDragRef.current = null;
    setTrendZoom(1);
    trendDotsRef.current = { total: [], current: [], nonCurrent: [] };
  }, [trend, activePeriod]);

  // Data yang benar-benar dikirim ke chart: sama seperti `trend`, kecuali satu
  // titik (bulan + garis) yang sedang ditarik/spring-back diganti nilai
  // live-nya. Data asli (`trend`/props) TIDAK pernah dimutasi.
  const trendDisplayData = useMemo(() => {
    if (!trendDragPoint) return trend;
    return trend.map((d, i) => (i === trendDragPoint.index ? { ...d, [trendDragPoint.key]: trendDragPoint.liveValue } : d));
  }, [trend, trendDragPoint]);

  // Dot tak terlihat di SETIAP titik data: cuma untuk merekam posisi piksel
  // (cy) & nilai asli tiap titik ke trendDotsRef, dipakai buat kalibrasi drag.
  const renderTrendCalibrationDot = (key: TrendKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    trendDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot yang terlihat & bisa digenggam di bulan yang sedang di-hover — tarik
  // vertikal untuk preview, lepas untuk spring-back ke nilai asli.
  const renderTrendActiveDot = (key: TrendKey, color: string) => (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = trendDragPoint?.key === key && trendDragPoint?.index === index;
    return (
      <g key={`pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 4} fill={color} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleTrendDotPointerDown(key, index, payload[key])}
        />
      </g>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Trend */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[14px] font-600 text-foreground">Total Assets Trend</div>
            <div className="text-[11px] text-muted-foreground">{subtitle}</div>
          </div>
          <div className="flex gap-1">
            {periodOptions.map(p => (
              <button
                key={`assets-period-${p}`}
                onClick={() => setActivePeriod(p)}
                className={`px-2.5 py-1 text-[11px] font-500 rounded transition-colors ${activePeriod === p ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={trendDisplayData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="totalAssetsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="currentAssetsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#16a34a" stopOpacity={0.1} />
                  <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => `${v}M`}
                width={52}
                ticks={trendYTicks}
                domain={trendYDomain}
                allowDataOverflow
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="total"
                stroke="var(--primary)"
                fill="url(#totalAssetsGrad)"
                strokeWidth={2}
                name="Total Assets"
                dot={renderTrendCalibrationDot('total') as any}
                activeDot={renderTrendActiveDot('total', 'var(--primary)') as any}
                isAnimationActive={!trendDragPoint}
              />
              <Area
                type="monotone"
                dataKey="current"
                stroke="#16a34a"
                fill="url(#currentAssetsGrad)"
                strokeWidth={1.5}
                name="Current Assets"
                dot={renderTrendCalibrationDot('current') as any}
                activeDot={renderTrendActiveDot('current', '#16a34a') as any}
                isAnimationActive={!trendDragPoint}
              />
              <Area
                type="monotone"
                dataKey="nonCurrent"
                stroke="#d97706"
                fill="none"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                name="Non-Current Assets"
                dot={renderTrendCalibrationDot('nonCurrent') as any}
                activeDot={renderTrendActiveDot('nonCurrent', '#d97706') as any}
                isAnimationActive={!trendDragPoint}
              />
            </AreaChart>
          </ResponsiveContainer>
          {/* Overlay drag: tarik naik/turun di atas label sumbu Y buat zoom in/out skala harga */}
          <div
            onMouseDown={handleTrendAxisMouseDown}
            onDoubleClick={resetTrendZoom}
            title="Tarik untuk zoom skala harga · klik dua kali untuk reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: 52 }}
          />
        </div>
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-border">
          {[
            { label: 'Total Assets', color: 'var(--primary)' },
            { label: 'Current Assets', color: '#16a34a' },
            { label: 'Non-Current Assets', color: '#d97706' },
          ].map(l => (
            <div key={`assets-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="w-3 h-0.5 inline-block rounded" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Composition */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Asset Composition</div>
        <div className="text-[11px] text-muted-foreground mb-4">By category{periodLabel ? ` — ${periodLabel}` : ' — Aug 2026'}</div>
        <div className="flex justify-center">
          <InteractiveDonutChart
            data={composition}
            activeIndex={activeComp}
            onActiveChange={setActiveComp}
            onLiveChange={setCompLivePreview}
          />
        </div>
        <div className="space-y-1.5 mt-2">
          {composition.map((d, i) => {
            const preview = compLivePreview?.[i];
            const displayValue = preview ? preview.value : d.value;
            const displayPct = preview ? preview.pct : d.pct;
            return (
              <div
                key={`comp-legend-${i}`}
                onClick={() => setActiveComp((prev) => (prev === i ? null : i))}
                className={`flex items-center justify-between text-[11px] cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
                  activeComp === i ? 'bg-secondary' : 'hover:bg-secondary/50'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full inline-block shrink-0" style={{ background: d.color }} />
                  <span className={`truncate ${activeComp === i ? 'text-foreground font-600' : 'text-muted-foreground'}`}>{d.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-muted-foreground">{displayPct.toFixed(1)}%</span>
                  <span className="font-600 text-foreground financial-value">Rp {displayValue.toLocaleString('id-ID')}M</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}