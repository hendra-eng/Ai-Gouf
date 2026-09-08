'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

type SeriesKey = 'revenue' | 'expenses' | 'netProfit';

const SERIES_COLOR_VAR: Record<SeriesKey, string> = {
  revenue: 'var(--primary)',
  expenses: 'var(--negative)',
  netProfit: 'var(--positive)',
};

// Backend integration point: replace with /api/financial/revenue-trend?period=&company=
const monthlyData = [
  { month: 'Jan', revenue: 920, expenses: 748, grossProfit: 408, netProfit: 172, margin: 18.7 },
  { month: 'Feb', expenses: 772, revenue: 985, grossProfit: 435, netProfit: 213, margin: 21.6 },
  { month: 'Mar', revenue: 1042, expenses: 818, grossProfit: 462, netProfit: 224, margin: 21.5 },
  { month: 'Apr', revenue: 1108, expenses: 862, grossProfit: 492, netProfit: 246, margin: 22.2 },
  { month: 'May', revenue: 1075, expenses: 884, grossProfit: 476, netProfit: 191, margin: 17.8 },
  { month: 'Jun', revenue: 1154, expenses: 908, grossProfit: 514, netProfit: 246, margin: 21.3 },
  { month: 'Jul', revenue: 1198, expenses: 924, grossProfit: 534, netProfit: 274, margin: 22.9 },
  { month: 'Aug', revenue: 1242, expenses: 948, grossProfit: 552, netProfit: 294, margin: 23.7 },
];

const quarterlyData = [
  { month: 'Q1 2025', revenue: 2640, expenses: 2148, grossProfit: 1168, netProfit: 492, margin: 18.6 },
  { month: 'Q2 2025', revenue: 2820, expenses: 2284, grossProfit: 1248, netProfit: 536, margin: 19.0 },
  { month: 'Q3 2025', revenue: 3050, expenses: 2440, grossProfit: 1352, netProfit: 610, margin: 20.0 },
  { month: 'Q4 2025', revenue: 3280, expenses: 2596, grossProfit: 1452, netProfit: 684, margin: 20.9 },
  { month: 'Q1 2026', revenue: 2947, expenses: 2338, grossProfit: 1305, netProfit: 609, margin: 20.7 },
  { month: 'Q2 2026', revenue: 3337, expenses: 2654, grossProfit: 1482, netProfit: 683, margin: 20.5 },
];

const yearlyData = [
  { month: '2022', revenue: 5840, expenses: 4880, grossProfit: 2580, netProfit: 960, margin: 16.4 },
  { month: '2023', revenue: 7240, expenses: 5920, grossProfit: 3200, netProfit: 1320, margin: 18.2 },
  { month: '2024', revenue: 9180, expenses: 7380, grossProfit: 4060, netProfit: 1800, margin: 19.6 },
  { month: '2025', revenue: 11790, expenses: 9468, grossProfit: 5220, netProfit: 2322, margin: 19.7 },
];

const periods = ['6M', 'YTD', '12M', '3Y'];

// `value` here is expressed in millions of IDR (Jt), matching the chart data.
function formatChartValue(value: number, currency: 'IDR' | 'USD' | 'SGD') {
  return formatMoney(value * 1_000_000, currency);
}

interface DragPreview {
  index: number;
  seriesKey: SeriesKey;
  value: number;
}

function CustomTooltip({
  active,
  payload,
  label,
  dragPreview,
}: {
  active?: boolean;
  payload?: { value: number; name: string; color: string; dataKey?: string }[];
  label?: string;
  dragPreview?: DragPreview | null;
}) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  if (!active || !payload || !payload.length) return null;
  const data = (payload[0] as any)?.payload as typeof monthlyData[0] | undefined;
  return (
    <div className="bg-card border border-border rounded-xl shadow-card-lg p-4 min-w-[200px]">
      <p className="text-sm font-bold text-foreground mb-3 pb-2 border-b border-border">{label}</p>
      {payload.map((entry) => {
        const isDraggedRow = !!dragPreview && entry.dataKey === dragPreview.seriesKey;
        const value = isDraggedRow ? dragPreview!.value : entry.value;
        return (
          <div key={`tt-${entry.name}`} className="flex items-center justify-between gap-6 mb-1.5">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
              <span className="text-xs text-muted-foreground capitalize">{entry.name}</span>
            </div>
            <span className="text-xs font-semibold font-mono text-foreground">
              {isDraggedRow ? `${t('estimate')} · ` : ''}
              {formatChartValue(value, currency)}
            </span>
          </div>
        );
      })}
      {data && (
        <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t('Net Margin')}</span>
          <span className="text-xs font-bold text-positive font-mono">{data.margin?.toFixed(1)}%</span>
        </div>
      )}
    </div>
  );
}

const SPRING_DURATION_MS = 420;
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export default function RevenueExpenseChartInner() {
  const [activePeriod, setActivePeriod] = useState('YTD');
  const { currency } = useCurrency();
  const { t } = useLanguage();

  const data = activePeriod === 'YTD' ? monthlyData
    : activePeriod === '6M' ? monthlyData.slice(-6)
    : activePeriod === '12M' ? quarterlyData
    : yearlyData;

  // Pixel <-> value calibration, refreshed on every render from the
  // (invisible) per-point dots of every series — all three lines share one
  // Y axis, so a single linear mapping works for all of them.
  const dotsRef = useRef<Record<SeriesKey, { value: number; cy: number }[]>>({
    revenue: [],
    expenses: [],
    netProfit: [],
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

  // Reset any in-flight drag + stale calibration points when switching
  // 6M/YTD/12M/3Y (indices and pixel positions differ between them).
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
    dotsRef.current = { revenue: [], expenses: [], netProfit: [] };
  }, [activePeriod]);

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
    (seriesKey: SeriesKey) => (e: React.PointerEvent, index: number, cy: number, originalValue: number) => {
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
      if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) pxPerUnit = -1;

      dragStateRef.current = {
        index,
        seriesKey,
        originalValue,
        currentValue: originalValue,
        startClientY: e.clientY,
        pxPerUnit,
      };
      setDragPreview({ index, seriesKey, value: originalValue });
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* noop */
      }
    },
    []
  );

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      let value = drag.originalValue + deltaY / drag.pxPerUnit;
      value = Math.max(0, value);
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
  const makeCalibrationDot = (seriesKey: SeriesKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    // NOTE: recharts' Area component passes `value` as [baseline, value] —
    // always read the real number off `payload` instead, which is a plain
    // number for both Area and Line series.
    dotsRef.current[seriesKey][index] = { value: payload[seriesKey], cy };
    return <circle key={`cal-${seriesKey}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // The visible, grabbable dot shown at the hovered month for each series —
  // drag it vertically, release to spring back to the original value.
  const makeActiveDot = (seriesKey: SeriesKey) => (props: any) => {
    const { cx, cy, index, payload } = props;
    return (
      <circle
        key={`active-${seriesKey}-${index}`}
        cx={cx}
        cy={cy}
        r={5}
        fill={SERIES_COLOR_VAR[seriesKey]}
        stroke="var(--card)"
        strokeWidth={2}
        style={{ cursor: 'ns-resize', touchAction: 'none' }}
        onPointerDown={(e) => handleDotPointerDown(seriesKey)(e, index, cy, payload[seriesKey])}
      />
    );
  };

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h2 className="text-base font-bold text-foreground">{t('Revenue vs Expenses vs Net Profit')}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">PT Nusantara Teknologi Indonesia · Jan–Aug 2026</p>
        </div>
        <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border flex-shrink-0">
          {periods.map((p) => (
            <button
              key={`period-${p}`}
              onClick={() => setActivePeriod(p)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 ${
                activePeriod === p ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={displayData} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
          <defs>
            <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.15} />
              <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gradExpenses" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--negative)" stopOpacity={0.12} />
              <stop offset="100%" stopColor="var(--negative)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => formatChartValue(v, currency).replace(/^(Rp|S?\$)\s?/, '')}
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)', fontFamily: 'var(--font-plus-jakarta-sans)' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip dragPreview={dragPreview} />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 12, fontFamily: 'var(--font-plus-jakarta-sans)', paddingTop: 12 }}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            name={t('Revenue')}
            stroke="var(--primary)"
            strokeWidth={2}
            fill="url(#gradRevenue)"
            dot={makeCalibrationDot('revenue')}
            activeDot={makeActiveDot('revenue')}
            isAnimationActive={false}
          />
          <Area
            type="monotone"
            dataKey="expenses"
            name={t('Expenses')}
            stroke="var(--negative)"
            strokeWidth={2}
            fill="url(#gradExpenses)"
            dot={makeCalibrationDot('expenses')}
            activeDot={makeActiveDot('expenses')}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="netProfit"
            name={t('Net Profit')}
            stroke="var(--positive)"
            strokeWidth={2.5}
            dot={makeCalibrationDot('netProfit')}
            activeDot={makeActiveDot('netProfit')}
            strokeDasharray="5 3"
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
