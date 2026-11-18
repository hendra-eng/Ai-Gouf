'use client';

// Kartu "Journal Entry Volume" -- tampilan & interaksi chart disalin 1:1 dari kartu
// "Tren Sales Bulanan" di Sales Overview (area/line/column/candle/OHLC, timeframe 5m..1Y,
// crosshair, zoom/geser sumbu waktu & harga). Bedanya hanya datanya: jumlah journal entry
// per tanggal entry (bukan nominal Rupiah).

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import type { BackendJeDraft } from '@/lib/journalEntryStore';
import {
  buildTrendIndex, buildSeries, buildTicks, makeBounds, pickGranularity, zoomRange, panRange, utc, addGran, DAY_MS,
  niceTicksRange, niceStep, smoothSeries, buildSeriesInterval, buildIntradayTicks, makeBoundsForInterval, defaultWindowForInterval,
  intervalStart, intervalNext, isIntraday, INTERVALS, INTERVAL_BY_ID,
  type TimeRange, type TickInfo, type Granularity, type IntervalId, type IntervalDef,
} from '@/app/transactions/sales/components/salesTrendTime';
import SalesChartCrosshair from '@/app/transactions/sales/components/SalesChartCrosshair';
import SalesCandleLayer, { type SalesChartType } from '@/app/transactions/sales/components/SalesCandleLayer';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { FilterSelect, type FilterOption } from './jeOverviewUi';

const PLOT_LEFT = 0;
const AXIS_GAP = 5;
const SPRING_MS = 380;
const XAXIS_HEIGHT = 34;
const PLOT_RIGHT = 10;
const CHART_HEIGHT = 220;
const PLOT_TOP = 5;
const TIME_ZOOM_PX = 220;
const AXIS_BORDER = '#404040';
const LINE_COLOR = '#171717';
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

interface DragPreview { index: number; value: number }

const fmtCount = (n: number) => Math.round(n).toLocaleString('en-US');

// Label sumbu Y: angka bulat, rata kanan (menempel ke garis sumbu).
function YTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  if (x == null || y == null || !payload) return null;
  return (
    <g>
      <text x={x + 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#8a8a8a">{fmtCount(payload.value)}</text>
    </g>
  );
}

// Label sumbu X: tahun/bulan tebal, tanggal tipis; tahun muncul di baris bawah Januari.
function XTick({ x, y, payload, info }: { x?: number; y?: number; payload?: { value: number }; info: Map<number, TickInfo> }) {
  const tick = payload ? info.get(payload.value) : undefined;
  if (!tick || x == null || y == null) return null;
  const strong = tick.kind !== 'day';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={strong ? 600 : 400} fill={strong ? '#525252' : '#8a8a8a'}>
        {tick.label}
      </text>
      {tick.sub && (
        <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">
          {tick.sub}
        </text>
      )}
    </g>
  );
}

const INTERVAL_OPTIONS: FilterOption[] = [
  { value: 'auto', label: 'Auto', short: 'Auto' },
  ...INTERVALS.map((d) => ({ value: d.id, label: `${d.label} · ${d.title}`, short: d.label })),
];
const CHART_TYPE_OPTIONS: FilterOption[] = [
  { value: 'area', label: 'Area' },
  { value: 'line', label: 'Line' },
  { value: 'column', label: 'Column' },
  { value: 'candle', label: 'Candle' },
  { value: 'ohlc', label: 'OHLC Bar' },
];
type SeriesId = 'all' | 'posted' | 'exception';
const SERIES_OPTIONS: FilterOption[] = [
  { value: 'all', label: 'All Entries' },
  { value: 'posted', label: 'Posted' },
  { value: 'exception', label: 'Exceptions' },
];
const SERIES_SUBTITLE: Record<SeriesId, string> = {
  all: 'Entries created per entry date',
  posted: 'Posted entries per entry date',
  exception: 'Exception entries per entry date',
};

const yearOf = (iso: string | null | undefined) => {
  const y = Number((iso || '').slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

export default function JeTrendCard({ drafts, loading }: { drafts: BackendJeDraft[]; loading: boolean }) {
  const [seriesId, setSeriesId] = useState<SeriesId>('all');
  const rows = useMemo(
    () => (seriesId === 'all' ? drafts : drafts.filter((d) => d.status === seriesId)),
    [drafts, seriesId]
  );

  // ── Tahun & indeks tren (jumlah entry per hari/bulan/tahun) ──
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    drafts.forEach((d) => { const y = yearOf(d.entry_date); if (y) ys.add(y); });
    return Array.from(ys).sort((a, b) => b - a);
  }, [drafts]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const trendYear = pickedYear && availableYears.includes(pickedYear) ? pickedYear : (availableYears[0] ?? new Date().getFullYear());

  const trendIndex = useMemo(() => buildTrendIndex(rows, (d) => d.entry_date, () => 1), [rows]);
  const hasAny = useMemo(() => Array.from(trendIndex.month.values()).some((b) => b.total !== 0), [trendIndex]);
  const allTimeMaxMonth = useMemo(() => Math.max(0, ...Array.from(trendIndex.month.values()).map((b) => b.total)), [trendIndex]);

  const defaultView = useMemo<TimeRange>(() => ({ from: utc(trendYear, 0, 1), to: utc(trendYear, 11, 1) }), [trendYear]);
  const [range, setRange] = useState<TimeRange | null>(null);
  const [intervalId, setIntervalId] = useState<IntervalId | null>(null);
  const [chartType, setChartType] = useState<SalesChartType>('area');
  const intervalDef: IntervalDef | null = intervalId ? INTERVAL_BY_ID[intervalId] : null;
  const intervalWindow = useMemo(
    () => (intervalDef ? defaultWindowForInterval(trendIndex, intervalDef, trendYear) : null),
    [trendIndex, intervalDef, trendYear]
  );
  const view = range ?? intervalWindow ?? defaultView;
  const timeBounds = useMemo(
    () => (intervalDef ? makeBoundsForInterval(trendIndex, trendYear, intervalDef) : makeBounds(trendIndex, trendYear)),
    [trendIndex, trendYear, intervalDef]
  );
  const gran: Granularity = pickGranularity(view.to - view.from);

  const fmtMonth = useMemo(() => new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }), []);
  const fmtMonthYear = useMemo(() => new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), []);
  const fmtFullDay = useMemo(() => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), []);
  const pointLabel = useCallback(
    (tm: number, g: Granularity) => (g === 'day' ? fmtFullDay.format(tm) : g === 'month' ? fmtMonthYear.format(tm) : String(new Date(tm).getUTCFullYear())),
    [fmtFullDay, fmtMonthYear]
  );
  const tickFormatters = useMemo(() => ({ monthShort: (tm: number) => fmtMonth.format(tm) }), [fmtMonth]);

  const fmtTime = useMemo(() => new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }), []);
  const fmtDayMonth = useMemo(() => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short', timeZone: 'UTC' }), []);
  const intervalLabel = useCallback((tm: number, d: IntervalDef) => {
    if (d.kind === 'fixed') {
      if (d.ms < DAY_MS) return `${fmtFullDay.format(tm)} ${fmtTime.format(tm)}`;
      if (d.ms === DAY_MS) return fmtFullDay.format(tm);
      return `${fmtDayMonth.format(tm)} – ${fmtFullDay.format(tm + d.ms - DAY_MS)}`;
    }
    if (d.months === 1) return fmtMonthYear.format(tm);
    if (d.months === 12) return String(new Date(tm).getUTCFullYear());
    return `${fmtMonth.format(tm)} – ${fmtMonthYear.format(addGran(tm, 'month', d.months - 1))}`;
  }, [fmtFullDay, fmtTime, fmtDayMonth, fmtMonth, fmtMonthYear]);

  const trend = useMemo(
    () => (intervalDef
      ? buildSeriesInterval(trendIndex, view.from, view.to, intervalDef, (tm) => intervalLabel(tm, intervalDef))
      : buildSeries(trendIndex, view.from, view.to, gran, pointLabel)),
    [trendIndex, view.from, view.to, gran, pointLabel, intervalDef, intervalLabel]
  );
  const [wrapPx, setWrapPx] = useState(900);
  const maxXTicks = Math.max(3, Math.floor((wrapPx - 90) / 70));
  const xTicks = useMemo(
    () => (intervalDef && isIntraday(intervalDef)
      ? buildIntradayTicks(view.from, view.to, tickFormatters, maxXTicks)
      : buildTicks(view.from, view.to, gran, tickFormatters, maxXTicks)),
    [view.from, view.to, gran, tickFormatters, intervalDef, maxXTicks]
  );
  const bucketEnd = useCallback(
    (tm: number) => (intervalDef ? intervalNext(tm, intervalDef, 1) : addGran(tm, gran, 1)),
    [intervalDef, gran]
  );
  const candleExtra = useCallback(
    (i: number) => (i > 0 && trend[i] ? `Open ${fmtCount(trend[i - 1].total)} → Close ${fmtCount(trend[i].total)}` : null),
    [trend]
  );
  const xTickValues = useMemo(() => xTicks.map((k) => k.t), [xTicks]);
  const xTickInfo = useMemo(() => new Map(xTicks.map((k) => [k.t, k])), [xTicks]);

  const dotsRef = useRef<{ value: number; cy: number }[]>([]);
  useMemo(() => { dotsRef.current = []; }, [trend]);

  // ── Skala sumbu Y: bisa di-zoom (tarik sumbu) dan digeser (tarik grafik) ──
  const base = useMemo(() => {
    const vals = trend.filter((d) => d.t >= view.from && d.t <= view.to).map((d) => d.total);
    let hiData = Math.max(0, ...vals);
    const loData = Math.min(0, ...vals);
    if (hiData <= 0) hiData = allTimeMaxMonth;
    hiData = Math.max(1, hiData);
    const hi = hiData * 1.08;
    return { lo: loData < 0 ? loData * 1.08 : -niceStep(hi, 4), hi };
  }, [trend, view.from, view.to, allTimeMaxMonth]);
  const [priceZoom, setPriceZoom] = useState(1);
  const [yShift, setYShift] = useState(0);
  const yShiftRef = useRef(0);
  yShiftRef.current = yShift;
  const zoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const yDomain = useMemo<[number, number]>(() => {
    const mid = (base.lo + base.hi) / 2 + yShift;
    const half = (base.hi - base.lo) / 2 / priceZoom;
    return [mid - half, mid + half];
  }, [base, priceZoom, yShift]);
  // Jumlah entry selalu bilangan bulat >= 0 -> tick pecahan / negatif dibuang.
  const yTicks = useMemo(
    () => niceTicksRange(yDomain[0], yDomain[1], 5).filter((v) => v >= 0 && Number.isInteger(v)),
    [yDomain]
  );

  const [axisWidth, setAxisWidth] = useState(() =>
    Math.ceil(Math.max(1, ...yTicks.map((v) => fmtCount(v).length)) * 6.8) + AXIS_GAP
  );
  useEffect(() => {
    const labels = yTicks.map(fmtCount);
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `10px ${salesFont.style.fontFamily}`;
      const widest = Math.max(0, ...labels.map((l) => ctx.measureText(l).width));
      const next = Math.ceil(widest) + AXIS_GAP;
      setAxisWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; };
  }, [yTicks]);
  const axisOverlayWidth = axisWidth + PLOT_LEFT;
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;

  const handleAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    zoomDragRef.current = { startY: e.clientY, startZoom: priceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!zoomDragRef.current) return;
      const deltaY = zoomDragRef.current.startY - ev.clientY;
      const factor = Math.exp(deltaY / 150);
      setPriceZoom(Math.min(6, Math.max(0.25, zoomDragRef.current.startZoom * factor)));
    };
    const onUp = () => {
      zoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetZoom = () => { setPriceZoom(1); setYShift(0); };

  // ── Tarik titik data (preview "what-if", kembali ke nilai asli saat dilepas) ──
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const dragStateRef = useRef<{
    index: number; originalValue: number; currentValue: number; startClientY: number; pxPerUnit: number;
  } | null>(null);
  const animRef = useRef<number | null>(null);
  const stopSpring = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    animRef.current = null;
  };
  useEffect(() => {
    stopSpring();
    dragStateRef.current = null;
    setDragPreview(null);
  }, [trend]);
  useEffect(() => stopSpring, []);

  const springBack = useCallback(() => {
    const drag = dragStateRef.current;
    if (!drag) return;
    stopSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SPRING_MS);
      const next = from + (target - from) * easeOutQuint(elapsed);
      if (dragStateRef.current) dragStateRef.current.currentValue = next;
      setDragPreview({ index, value: next });
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

  const handleDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSpring();
    const samples = dotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = 0;
    if (samples.length >= 2) {
      let a = samples[0];
      let b = samples[0];
      for (const pt of samples) {
        if (pt.value < a.value) a = pt;
        if (pt.value > b.value) b = pt;
      }
      if (b.value !== a.value) pxPerUnit = (b.cy - a.cy) / (b.value - a.value);
    }
    if (!Number.isFinite(pxPerUnit) || pxPerUnit === 0) {
      const [dMin, dMax] = yDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }
    dragStateRef.current = { index, originalValue, currentValue: originalValue, startClientY: e.clientY, pxPerUnit };
    setDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = dragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = yDomainRef.current;
      const value = Math.max(0, Math.min(dMax * 1.4, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setDragPreview({ index: drag.index, value });
    };
    const handleUp = () => { if (dragStateRef.current) springBack(); };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBack]);

  const lineTrend = useMemo(
    () => (intervalDef && isIntraday(intervalDef) && (chartType === 'area' || chartType === 'line')
      ? smoothSeries(trend, Math.max(1, (DAY_MS / intervalDef.ms) * 0.12))
      : trend),
    [trend, intervalDef, chartType]
  );
  const displayTrend = useMemo(() => {
    if (!dragPreview) return lineTrend;
    return lineTrend.map((d, i) => (i === dragPreview.index ? { ...d, total: dragPreview.value } : d));
  }, [lineTrend, dragPreview]);

  const renderCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    dotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`je-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };
  const renderActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = dragPreview?.index === index;
    return (
      <g key={`je-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill={LINE_COLOR} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  // ── Zoom & geser sumbu waktu (ala TradingView) ──
  const chartWrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const measure = () => setWrapPx((prev) => (Math.abs(prev - el.clientWidth) < 2 ? prev : el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasAny]);
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boundsRef = useRef(timeBounds);
  boundsRef.current = timeBounds;

  const beginTimeDrag = (e: React.PointerEvent, mode: 'zoom' | 'pan') => {
    const el = chartWrapRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const plotLeft = rect.left + axisOverlayWidth;
    const plotWidth = Math.max(60, rect.width - axisOverlayWidth - PLOT_RIGHT);
    const start = viewRef.current;
    const span = start.to - start.from;
    const startX = e.clientX;
    const startY = e.clientY;
    const startShift = yShiftRef.current;
    const [yLo, yHi] = yDomainRef.current;
    const plotH = Math.max(60, CHART_HEIGHT - XAXIS_HEIGHT - PLOT_TOP);
    if (mode === 'pan') setPanning(true);
    const anchor = Math.min(1, Math.max(0, (startX - plotLeft) / plotWidth));
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (mode === 'zoom') setRange(zoomRange(start, Math.exp(dx / TIME_ZOOM_PX), anchor, boundsRef.current));
      else {
        setRange(panRange(start, (-dx / plotWidth) * span, boundsRef.current));
        setYShift(startShift + ((ev.clientY - startY) / plotH) * (yHi - yLo));
      }
    };
    const onUp = () => {
      setPanning(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const handleChartPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < axisOverlayWidth || y > rect.height - XAXIS_HEIGHT) return;
    beginTimeDrag(e, 'pan');
  };

  const chartGeometry = {
    plotLeft: axisOverlayWidth,
    plotRightMargin: PLOT_RIGHT,
    plotTop: PLOT_TOP,
    plotBottom: CHART_HEIGHT - XAXIS_HEIGHT,
  };

  const selectInterval = (id: IntervalId | null) => {
    setIntervalId(id);
    setRange(null);
    setPriceZoom(1);
    setYShift(0);
  };

  return (
    <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">Journal Entry Volume</h2>
          <p className="text-xs text-neutral-500 mt-0.5">{SERIES_SUBTITLE[seriesId]}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <FilterSelect
            title="Series"
            searchable={false}
            value={seriesId}
            onChange={(v) => { setSeriesId(v as SeriesId); setRange(null); setPriceZoom(1); setYShift(0); }}
            options={SERIES_OPTIONS}
          />
          <FilterSelect
            title="Timeframe"
            searchable={false}
            value={intervalId ?? 'auto'}
            onChange={(v) => selectInterval(v === 'auto' ? null : (v as IntervalId))}
            options={INTERVAL_OPTIONS}
          />
          <FilterSelect
            title="Chart type"
            searchable={false}
            value={chartType}
            onChange={(v) => setChartType(v as SalesChartType)}
            options={CHART_TYPE_OPTIONS}
          />
          {(range || intervalId) && (
            <button
              type="button"
              onClick={() => { setRange(null); setIntervalId(null); setYShift(0); setPriceZoom(1); }}
              className="text-xs border border-neutral-300 rounded-lg px-2 py-1 bg-card text-neutral-900 hover:bg-neutral-100"
            >
              Reset
            </button>
          )}
          {availableYears.length > 1 && (
            <select
              value={trendYear}
              onChange={(e) => { setPickedYear(Number(e.target.value)); setRange(null); }}
              className="text-xs border border-neutral-300 rounded-lg px-2 py-1 bg-card text-neutral-900"
            >
              {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>
      </div>
      {!hasAny ? (
        <p className="text-xs text-muted-foreground py-10 text-center">{loading ? 'Loading...' : 'No journal entries to display yet.'}</p>
      ) : (
        <div
          ref={chartWrapRef}
          onPointerDown={handleChartPointerDown}
          className={`relative select-none ${panning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
          style={{ touchAction: 'pan-y' }}
        >
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <AreaChart data={displayTrend} margin={{ top: PLOT_TOP, right: PLOT_RIGHT, left: PLOT_LEFT, bottom: 0 }}>
              <defs>
                <linearGradient id="gradJeVolume" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={LINE_COLOR} stopOpacity={0.30} />
                  <stop offset="95%" stopColor={LINE_COLOR} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
              <XAxis
                dataKey="t"
                type="number"
                scale="linear"
                domain={[view.from, view.to]}
                allowDataOverflow
                ticks={xTickValues}
                interval={0}
                tick={(p: any) => <XTick {...p} info={xTickInfo} />}
                axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
                tickLine={false}
                height={XAXIS_HEIGHT}
              />
              <YAxis
                tick={(p: any) => <YTick {...p} />}
                axisLine={{ stroke: AXIS_BORDER, strokeWidth: 1.5 }}
                tickLine={false}
                width={axisWidth}
                ticks={yTicks}
                domain={yDomain}
                allowDataOverflow
              />
              <ReferenceLine y={0} stroke={AXIS_BORDER} strokeOpacity={0.35} />
              <Tooltip content={() => null} cursor={false} />
              {(chartType === 'area' || chartType === 'line') && (
                <Area
                  type="monotone"
                  dataKey="total"
                  name="Entries"
                  stroke={LINE_COLOR}
                  strokeWidth={2.5}
                  baseValue={0}
                  fill={chartType === 'area' ? 'url(#gradJeVolume)' : 'none'}
                  dot={renderCalibrationDot as any}
                  activeDot={renderActiveDot as any}
                  isAnimationActive={!dragPreview && range === null}
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
          {/* Overlay drag di sumbu harga: tarik naik/turun = zoom skala */}
          <div
            onMouseDown={handleAxisMouseDown}
            onDoubleClick={resetZoom}
            title="Drag to zoom the scale · double-click to reset"
            className="absolute top-0 left-0 h-full cursor-ns-resize"
            style={{ width: axisOverlayWidth }}
          />
          {/* Overlay drag di label waktu: tarik kanan = zoom out, kiri = zoom in */}
          <div
            onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); beginTimeDrag(e, 'zoom'); }}
            onDoubleClick={() => setRange(null)}
            title="Drag left/right to zoom the period · double-click to reset"
            className="absolute bottom-0 cursor-ew-resize"
            style={{ left: axisOverlayWidth, right: PLOT_RIGHT, height: XAXIS_HEIGHT, touchAction: 'none' }}
          />
          {(chartType === 'column' || chartType === 'candle' || chartType === 'ohlc') && (
            <SalesCandleLayer
              wrapRef={chartWrapRef}
              geometry={chartGeometry}
              view={view}
              yMin={yDomain[0]}
              yMax={yDomain[1]}
              points={trend}
              nextOf={bucketEnd}
              type={chartType}
            />
          )}
          <SalesChartCrosshair
            wrapRef={chartWrapRef}
            geometry={chartGeometry}
            view={view}
            gran={gran}
            yMin={yDomain[0]}
            yMax={yDomain[1]}
            trend={trend}
            pointLabel={pointLabel}
            bucketOf={intervalDef ? (tm) => intervalStart(tm, intervalDef) : undefined}
            labelOf={intervalDef ? (tm) => intervalLabel(tm, intervalDef) : undefined}
            extraOf={chartType === 'candle' || chartType === 'ohlc' ? candleExtra : undefined}
            dragPreview={dragPreview}
            estimatedLabel="Estimated"
            salesLabel="Entries"
            formatValue={fmtCount}
          />
        </div>
      )}
      {intervalDef && isIntraday(intervalDef) && hasAny && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Entries are recorded per entry date; intervals under 1 day split the daily total evenly.
        </p>
      )}
    </div>
  );
}
