'use client';
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { EquityTrendRow } from '../lib/useEquityData';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// [UBAH] Fallback kosong -- lihat EquityContent.tsx (useEquityData())
// untuk sumber data ASLI client aktif.
const mockTrendData: EquityTrendRow[] = [];

const periodOptions = ['6M', 'YTD', '12M', '3Y'];

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) => {
  if (!active || !payload) return null;
  return (
    <div className="fin-card p-3 text-[11px] shadow-lg min-w-[160px]">
      <div className="font-600 text-foreground mb-2">{label}</div>
      {payload.map((p, i) => (
        <div key={`eq-tt-${i}`} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{p.name}</span>
          <span className="font-600" style={{ color: p.color }}>Rp {p.value.toLocaleString('id-ID')}M</span>
        </div>
      ))}
    </div>
  );
};

interface EquityTrendChartProps {
  trendData?: EquityTrendRow[];
  companyName?: string | null;
}

type TrendKey = 'total' | 'retained' | 'capital';

// Spring-back setelah drag titik dilepas — pola & durasi sama persis dengan
// chart lain (Financial Overview, Total Assets/Liabilities Trend, dst).
const TREND_SPRING_DURATION_MS = 420;
const trendEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export default function EquityTrendChart({ trendData, companyName }: EquityTrendChartProps) {
  const [activePeriod, setActivePeriod] = useState('YTD');
  const trend = trendData && trendData.length > 0 ? trendData : mockTrendData;
  const subtitle = companyName ? `Monthly equity composition — ${companyName}` : 'Monthly equity composition';

  // ── Fitur 1: Drag-zoom skala sumbu Y (harga) — tarik naik/turun di area
  // label sumbu Y buat zoom in/out skala, double-click buat reset. Data
  // (`trend`) tidak pernah diubah, cuma domain/tick sumbu yang berubah. ──
  const trendBaseMax = useMemo(
    () => Math.max(0, ...trend.map((d) => Math.max(d.total, d.retained, d.capital))) * 1.08 || 1,
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

  // ── Fitur 2: Drag titik garis (Total Equity/Retained Earnings/Paid-in
  // Capital) di bulan yang sedang di-hover — tarik naik/turun untuk preview
  // nilai (live), lepas -> "spring back" ke nilai aslinya. Kalibrasi
  // piksel<->nilai diambil dari titik-titik lain yang sudah dirender, jadi
  // tetap akurat walau chart sedang di-zoom (trendZoom) atau lebar
  // containernya berubah-ubah. ──
  const trendDotsRef = useRef<Record<TrendKey, { value: number; cy: number }[]>>({
    total: [],
    retained: [],
    capital: [],
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
    trendDotsRef.current = { total: [], retained: [], capital: [] };
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
  const renderTrendCalibrationDot = (key: TrendKey) => function TrendCalibrationDot(props: any) {
    const { cx, cy, index, payload } = props;
    trendDotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot yang terlihat & bisa digenggam di bulan yang sedang di-hover — tarik
  // vertikal untuk preview, lepas untuk spring-back ke nilai asli.
  const renderTrendActiveDot = (key: TrendKey, color: string) => function TrendActiveDot(props: any) {
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
    <div className="fin-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-[14px] font-600 text-foreground">Total Equity Trend</div>
          <div className="text-[11px] text-muted-foreground">{subtitle}</div>
        </div>
        <div className="flex gap-1">
          {periodOptions.map(p => (
            <button
              key={`eq-period-${p}`}
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
              <linearGradient id="totalEqGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="retainedGrad" x1="0" y1="0" x2="0" y2="1">
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
              fill="url(#totalEqGrad)"
              strokeWidth={2}
              name="Total Equity"
              dot={renderTrendCalibrationDot('total') as any}
              activeDot={renderTrendActiveDot('total', 'var(--primary)') as any}
              isAnimationActive={!trendDragPoint}
            />
            <Area
              type="monotone"
              dataKey="retained"
              stroke="#16a34a"
              fill="url(#retainedGrad)"
              strokeWidth={1.5}
              name="Retained Earnings"
              dot={renderTrendCalibrationDot('retained') as any}
              activeDot={renderTrendActiveDot('retained', '#16a34a') as any}
              isAnimationActive={!trendDragPoint}
            />
            <Area
              type="monotone"
              dataKey="capital"
              stroke="#7c3aed"
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 2"
              name="Paid-in Capital"
              dot={renderTrendCalibrationDot('capital') as any}
              activeDot={renderTrendActiveDot('capital', '#7c3aed') as any}
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
          { label: 'Total Equity', color: 'var(--primary)' },
          { label: 'Retained Earnings', color: '#16a34a' },
          { label: 'Paid-in Capital', color: '#7c3aed' },
        ].map(l => (
          <div key={`eq-legend-${l.label}`} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-3 h-0.5 inline-block rounded" style={{ background: l.color }} />
            {l.label}
          </div>
        ))}
      </div>
    </div>
  );
}