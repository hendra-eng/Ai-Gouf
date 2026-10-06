'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useLanguage } from '@/lib/language';
import { getNiceTicksFromZero } from '@/lib/chartTicks';
import type { BSMonthlyRow } from '../../lib/useBalanceSheetData';

type SeriesKey = 'assets' | 'equity' | 'liabilities';

const SERIES_COLOR: Record<SeriesKey, string> = {
  assets: '#0d9488',
  equity: '#6366f1',
  liabilities: '#ef4444',
};

const AXIS_WIDTH = 56;
const AXIS_OVERLAY_WIDTH = AXIS_WIDTH + 8; // + margin.left dari AreaChart

interface DragPreview {
  index: number;
  seriesKey: SeriesKey;
  value: number;
}

function CustomTooltip({
  active,
  payload,
  label,
  fx,
  t,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; dataKey?: string }[];
  label?: string;
  fx: (v: number) => string;
  t: (s: string) => string;
  dragPreview?: DragPreview | null;
}) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-lg p-3 min-w-[180px]">
      <p className="text-xs font-bold text-slate-800 mb-2 pb-1.5 border-b border-slate-100">{label}</p>
      {payload.map((entry) => {
        const isDraggedRow = !!dragPreview && entry.dataKey === dragPreview.seriesKey;
        const value = isDraggedRow ? dragPreview!.value : entry.value;
        return (
          <div key={`tt-${entry.name}`} className="flex items-center justify-between gap-5 mb-1">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-[11px] text-slate-500">{entry.name}</span>
            </div>
            <span className="text-[11px] font-semibold text-slate-800">
              {isDraggedRow ? `${t('estimate')} · ` : ''}
              {fx(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const SPRING_DURATION_MS = 380;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export default function FinancialPositionChartInner({
  data,
  fx,
}: {
  data: BSMonthlyRow[];
  fx: (v: number) => string;
}) {
  const { t } = useLanguage();

  // ── Zoom skala harga (drag vertikal di sumbu Y, sama seperti chart Financial Overview) ──
  const baseMax = useMemo(
    () => Math.max(1, ...data.map((d) => Math.max(d.assets, d.equity, d.liabilities))) * 1.08,
    [data]
  );
  const [priceZoom, setPriceZoom] = useState(1);
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  // Tick "nice" (angka bulat) — domain chart tetap kontinu (baseMax / priceZoom)
  // supaya drag zoom tetap smooth, cuma label/gridline yang dibulatkan.
  const { ticks: yTicks } = useMemo(() => getNiceTicksFromZero(baseMax / priceZoom, 6), [baseMax, priceZoom]);
  const yDomain = useMemo<[number, number]>(() => [0, baseMax / priceZoom], [baseMax, priceZoom]);
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    zoomDragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!zoomDragRef.current) return;
      const deltaY = zoomDragRef.current.startY - ev.clientY; // drag ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, zoomDragRef.current.startZoom * factor));
      setPriceZoom(next);
    };
    const onUp = () => {
      zoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetZoom = () => setPriceZoom(1);

  // Pixel <-> value calibration, refreshed on every render from the
  // (invisible) per-point dots of every series — all three series share one
  // Y axis, so a single linear mapping works for all of them.
  const dotsRef = useRef<Record<SeriesKey, { value: number; cy: number }[]>>({
    assets: [],
    equity: [],
    liabilities: [],
  });

  // The one point currently being dragged (or springing back), if any.
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragStateRef = useRef<{
    index: number;
    seriesKey: SeriesKey;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number; // negative: dragging up (smaller clientY) increases value
  } | null>(null);
  const animRef = useRef<number | null>(null);

  const stopSpring = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  };

  // Reset any in-flight drag + stale calibration points whenever the
  // underlying data changes (indices/pixel positions may differ).
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
    dotsRef.current = { assets: [], equity: [], liabilities: [] };
  }, [data]);

  useEffect(() => stopSpring, []);

  const springBack = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index, seriesKey } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SPRING_DURATION_MS);
      const eased = easeOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (dragStateRef.current) dragStateRef.current.currentValue = next;
      setDragPreview({ index, seriesKey, value: next });
      if (elapsed < 1) {
        animRef.current = requestAnimationFrame(step);
      } else {
        dragStateRef.current = null;
        animRef.current = null;
        setDragPreview(null);
      }
    };
    animRef.current = requestAnimationFrame(step);
  }, []);

  const handleDotPointerDown = useCallback(
    (seriesKey: SeriesKey) => (e: React.PointerEvent, index: number, originalValue: number) => {
      e.preventDefault();
      e.stopPropagation();
      stopSpring();

      // Derive px-per-unit from two other calibration points of the same
      // series (excluding the one being dragged) — linear, so any two work.
      const samples = dotsRef.current[seriesKey].filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
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

      dragStateRef.current = {
        index,
        seriesKey,
        originalValue,
        currentValue: originalValue,
        startClientY: e.clientY,
        pxPerUnit,
      };
      setDragPreview({ index, seriesKey, value: originalValue });
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = yDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setDragPreview({ index: drag.index, seriesKey: drag.seriesKey, value });
    };
    const handleUp = () => {
      if (dragStateRef.current) springBack();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBack]);

  const displayData = useMemo(() => {
    if (!dragPreview) return data;
    return data.map((d, i) => (i === dragPreview.index ? { ...d, [dragPreview.seriesKey]: dragPreview.value } : d));
  }, [data, dragPreview]);

  // Invisible per-point dot: renders nothing visible, just keeps `dotsRef`
  // calibrated to the current chart's pixel scale on every render.
  const makeCalibrationDot = (seriesKey: SeriesKey) => function CalibrationDot(props: any) {
    const { cx, cy, index, payload } = props;
    // NOTE: recharts' Area component passes `value` as [baseline, value] —
    // always read the real number off `payload` instead, which is a plain
    // number for all three series.
    dotsRef.current[seriesKey][index] = { value: payload[seriesKey], cy };
    return <circle key={`cal-${seriesKey}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // The visible dot shown at the hovered month for each series, PLUS a
  // larger invisible hit-target circle on top of it — dragging the
  // invisible circle is much easier to grab than the small visible dot
  // alone (same pattern as the Financial Overview chart).
  const makeActiveDot = (seriesKey: SeriesKey) => function ActiveDot(props: any) {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = dragPreview?.seriesKey === seriesKey && dragPreview?.index === index;
    return (
      <g key={`pt-${seriesKey}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 6 : 5} fill={SERIES_COLOR[seriesKey]} stroke="#fff" strokeWidth={2} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleDotPointerDown(seriesKey)(e, index, payload[seriesKey])}
        />
      </g>
    );
  };

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={displayData} margin={{ top: 5, right: 5, left: 8, bottom: 0 }}>
          <defs>
            <linearGradient id="gradAssets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0d9488" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#0d9488" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradEquity" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => fx(v).replace(/^(Rp|S?\$)\s?/, '')}
            width={AXIS_WIDTH}
            ticks={yTicks}
            domain={yDomain}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip fx={fx} t={t} dragPreview={dragPreview} />} cursor={false} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
          <Area
            type="monotone"
            dataKey="assets"
            name={t('Assets')}
            stroke="#0d9488"
            strokeWidth={2.5}
            fill="url(#gradAssets)"
            dot={makeCalibrationDot('assets') as any}
            activeDot={makeActiveDot('assets') as any}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="equity"
            name={t('Equity')}
            stroke="#6366f1"
            strokeWidth={2}
            fill="url(#gradEquity)"
            dot={makeCalibrationDot('equity') as any}
            activeDot={makeActiveDot('equity') as any}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="liabilities"
            name={t('Liabilities')}
            stroke="#ef4444"
            strokeWidth={2}
            fill="none"
            strokeDasharray="4 2"
            dot={makeCalibrationDot('liabilities') as any}
            activeDot={makeActiveDot('liabilities') as any}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
      <div
        onMouseDown={handleAxisMouseDown}
        onDoubleClick={resetZoom}
        title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: AXIS_OVERLAY_WIDTH }}
      />
    </div>
  );
}