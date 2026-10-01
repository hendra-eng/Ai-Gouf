'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { MonthBudgetRow } from '../lib/budgetBridge';
import { getNiceTicksFromZero } from '@/lib/chartTicks';

// [BARU] 2 fitur interaktif yang sama seperti di Financial Overview & AR
// Charts (drag sumbu Y untuk zoom skala, drag titik garis Actual/Forecast
// untuk preview nilai), TANPA mengubah data/logic budget yang sudah ada
// (metricValue, fullData, forecastBase, dst tetap persis sama).
function useDragZoomChart(baseMax: number, resetKey: unknown) {
  // ── Fitur 1: drag sumbu Y untuk zoom skala (kayak TradingView) ──
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

  // ── Fitur 2: drag titik garis untuk preview nilai (spring back saat dilepas) ──
  const dotsRef = useRef<Record<string, { value: number; cy: number }[]>>({});
  const [dragPoint, setDragPoint] = useState<{ key: string; index: number; liveValue: number } | null>(null);
  const dragPointRef = useRef<{
    key: string; index: number; startValue: number; startClientY: number; liveValue: number; pxPerUnit: number;
  } | null>(null);
  const pointAnimRef = useRef<number | null>(null);

  const stopPointSpring = useCallback(() => {
    if (pointAnimRef.current) cancelAnimationFrame(pointAnimRef.current);
    pointAnimRef.current = null;
  }, []);
  const easeOutQuintPoint = (t: number) => 1 - Math.pow(1 - t, 5);

  const springBackPoint = useCallback(() => {
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
  }, [stopPointSpring]);

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
  }, [springBackPoint]);

  // Reset drag & kalibrasi kalau resetKey berubah (mis. ganti metric/horizon)
  useEffect(() => {
    stopPointSpring();
    dragPointRef.current = null;
    setDragPoint(null);
    dotsRef.current = {};
  }, [resetKey, stopPointSpring]);

  // Dot yang SELALU tampil (persis gaya semula: lingkaran kecil r=3) + area
  // genggam tak kasat mata di atasnya supaya bisa ditarik.
  const renderPersistentDot = (key: string, color: string) => function PersistentDot(props: any) {
    const { cx, cy, index, payload, value } = props;
    if (cx == null || cy == null || value == null) return null;
    if (!dotsRef.current[key]) dotsRef.current[key] = [];
    dotsRef.current[key][index] = { value: payload[key], cy };
    const isDraggingThis = dragPoint?.key === key && dragPoint?.index === index;
    return (
      <g key={`dot-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 4 : 3} fill={color} />
        <circle
          cx={cx}
          cy={cy}
          r={11}
          fill="transparent"
          style={{ cursor: 'ns-resize' }}
          onPointerDown={handleDotPointerDown(key, index, payload[key])}
        />
      </g>
    );
  };

  // Dot yang tampil membesar saat bulan tsb sedang di-hover (activeDot bawaan Recharts).
  const renderActiveDot = (key: string, color: string) => function ActiveDot(props: any) {
    const { cx, cy, index, value } = props;
    if (cx == null || cy == null || value == null) return null;
    const isDraggingThis = dragPoint?.key === key && dragPoint?.index === index;
    return (
      <g key={`active-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 6 : 5} fill={color} stroke="var(--card)" strokeWidth={1.5} />
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

  // Drag untuk bar (kotak Budget) -- kalibrasi langsung dari tinggi bar yang
  // dirender (barHeight px = startValue satuan, baseline di 0), beda dari
  // titik garis yang butuh 2 titik lain sebagai referensi.
  const handleBarPointerDown = (key: string, index: number, startValue: number, barHeight: number) => (
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

  // Seluruh badan bar bisa digenggam & ditarik naik/turun (bukan cuma strip
  // tipis di ujungnya), supaya terasa alami -- sama seperti kotak Budget di
  // Financial Overview.
  const renderInteractiveBar = (key: string, fillColor: string, fillOpacity: number = 1) => {
    const InteractiveBar = (props: any) => {
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
            onPointerDown={handleBarPointerDown(key, index, payload[key], h)}
          />
          {/* Perluas area genggam ke atas sedikit, biar mudah ditarik walau bar-nya pendek */}
          <rect
            x={x}
            y={y - 10}
            width={width}
            height={10}
            fill="transparent"
            style={{ cursor: 'ns-resize' }}
            onPointerDown={handleBarPointerDown(key, index, payload[key], h)}
          />
        </g>
      );
    };
    InteractiveBar.displayName = 'InteractiveBar';
    return InteractiveBar;
  };

  function applyDragPreview<T extends Record<string, any>>(data: T[]): T[] {
    if (!dragPoint) return data;
    return data.map((d, i) => (i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d));
  }

  return {
    yDomain, yTicks, handleAxisMouseDown, resetZoom,
    dragPoint, renderPersistentDot, renderActiveDot, renderInteractiveBar, applyDragPreview,
  };
}

const ALL_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const METRIC_FIELDS: Record<string, { budget: keyof MonthBudgetRow; actual: keyof MonthBudgetRow }> = {
  'Revenue': { budget: 'revBudget', actual: 'revActual' },
  'COGS': { budget: 'cogsBudget', actual: 'cogsActual' },
  'OpEx': { budget: 'opexBudget', actual: 'opexActual' },
  'EBITDA': { budget: 'ebitdaBudget', actual: 'ebitdaActual' },
  'Net Profit': { budget: 'netProfitBudget', actual: 'netProfitActual' },
};

/** "Gross Profit" bukan field langsung -- dihitung dari revenue - cogs per bulan. */
function metricValue(row: MonthBudgetRow, metric: string, field: 'budget' | 'actual'): number {
  if (metric === 'Gross Profit') {
    return field === 'budget' ? row.revBudget - row.cogsBudget : row.revActual - row.cogsActual;
  }
  const cfg = METRIC_FIELDS[metric] || METRIC_FIELDS['Revenue'];
  return Number(row[cfg[field]]);
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-xl p-3 shadow-elevated min-w-[180px]">
      <p className="text-sm font-semibold text-foreground mb-2">{label}</p>
      {payload.map((p, i) => (
        p.value == null ? null : (
          <div key={`tt-${i}`} className="flex items-center justify-between gap-4 mb-1">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-xs text-muted-foreground capitalize">{p.name}</span>
            </div>
            <span className="text-xs font-semibold text-foreground tabular-nums">
              Rp {p.value?.toFixed(0)}M
            </span>
          </div>
        )
      ))}
    </div>
  );
};

interface Props {
  metric: string;
  horizon: string;
  monthlyRows: MonthBudgetRow[];
}

export default function BudgetChartInner({ metric, horizon, monthlyRows }: Props) {
  const count = horizon === '3M' ? 3 : horizon === '6M' ? 6 : 12;
  const actualMonths = monthlyRows.length;

  const recentActuals = monthlyRows.slice(-3).map((r) => metricValue(r, metric, 'actual'));
  const forecastBase = recentActuals.length > 0 ? recentActuals.reduce((s, v) => s + v, 0) / recentActuals.length : 0;
  const lastBudget = monthlyRows.length > 0 ? metricValue(monthlyRows[monthlyRows.length - 1], metric, 'budget') : 0;

  const fullData = ALL_MONTHS.map((m, i) => {
    const row = monthlyRows.find((r) => r.month === m);
    const budget = row ? metricValue(row, metric, 'budget') : lastBudget;
    const actual = row ? metricValue(row, metric, 'actual') : null;
    const isForecastMonth = i >= actualMonths - 1;
    const forecast = isForecastMonth ? Math.round(forecastBase * (1 + (i - actualMonths + 1) * 0.015)) : null;
    return {
      month: m,
      budget: Math.round(budget),
      actual,
      forecast,
      confidenceLow: isForecastMonth && forecast != null ? Math.round(forecast * 0.92) : null,
      confidenceHigh: isForecastMonth && forecast != null ? Math.round(forecast * 1.08) : null,
    };
  });

  const data = fullData.slice(0, count);
  const lastActualMonth = actualMonths > 0 ? ALL_MONTHS[actualMonths - 1] : null;

  // [BARU] Zoom sumbu Y + drag titik untuk garis Actual & Forecast -- lihat
  // useDragZoomChart. Reset kalibrasi kalau metric/horizon berganti (index &
  // makna data berubah).
  const baseMax = useMemo(() => {
    const maxVal = Math.max(
      0,
      ...data.map((d) => Math.max(d.budget || 0, d.actual || 0, d.forecast || 0, d.confidenceHigh || 0))
    );
    return maxVal * 1.08 || 1;
  }, [data]);
  const zoom = useDragZoomChart(baseMax, `${metric}|${horizon}`);
  const chartData = zoom.applyDragPreview(data);

  if (actualMonths === 0) {
    return (
      <div className="h-80 flex items-center justify-center text-sm text-muted-foreground">
        No posted monthly data yet for this client.
      </div>
    );
  }

  return (
    <div className="relative">
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 0 }}>
          <defs>
            <linearGradient id="confidenceGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.15} />
              <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: 'var(--muted-foreground)', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}M`}
            width={55}
            domain={zoom.yDomain}
            ticks={zoom.yTicks}
            allowDataOverflow
          />
          <Tooltip content={<CustomTooltip />} />
          {lastActualMonth && <ReferenceLine x={lastActualMonth} stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1} />}
          <Bar
            dataKey="budget"
            name="budget"
            barSize={18}
            shape={zoom.renderInteractiveBar('budget', 'var(--chart-2)', 0.4) as any}
            isAnimationActive={!zoom.dragPoint}
          />
          <Area type="monotone" dataKey="confidenceHigh" stroke="none" fill="url(#confidenceGrad)" name="confidence" legendType="none" />
          <Area type="monotone" dataKey="confidenceLow" stroke="none" fill="var(--background)" name="confidence-low" legendType="none" />
          <Line
            type="monotone"
            dataKey="actual"
            stroke="var(--primary)"
            strokeWidth={2.5}
            dot={zoom.renderPersistentDot('actual', 'var(--primary)') as any}
            activeDot={zoom.renderActiveDot('actual', 'var(--primary)') as any}
            name="actual"
            connectNulls={false}
            isAnimationActive={!zoom.dragPoint}
          />
          <Line
            type="monotone"
            dataKey="forecast"
            stroke="var(--chart-3)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={zoom.renderPersistentDot('forecast', 'var(--chart-3)') as any}
            activeDot={zoom.renderActiveDot('forecast', 'var(--chart-3)') as any}
            name="forecast"
            connectNulls={false}
            isAnimationActive={!zoom.dragPoint}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {/* Overlay drag: tarik naik/turun di atas sumbu buat zoom in/out skala, klik dua kali untuk reset */}
      <div
        onMouseDown={zoom.handleAxisMouseDown}
        onDoubleClick={zoom.resetZoom}
        title="Tarik untuk zoom skala · klik dua kali untuk reset"
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: 55 }}
      />
    </div>
  );
}