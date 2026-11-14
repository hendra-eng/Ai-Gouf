'use client';

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { ChevronDown, Check, ShoppingBag } from 'lucide-react';
import { formatIDR } from '../../lib/groupAnalytics';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { useLanguage } from '@/lib/language';
import {
  buildSeries, buildTicks, buildTrendIndex, makeBounds, pickGranularity, zoomRange, panRange, utc, addGran, DAY_MS,
  niceTicksRange, niceStep, smoothSeries, buildSeriesInterval, buildIntradayTicks, makeBoundsForInterval, defaultWindowForInterval,
  intervalStart, intervalNext, isIntraday, INTERVALS, INTERVAL_BY_ID,
  type TimeRange, type TickInfo, type Granularity, type IntervalId, type IntervalDef,
} from '../../sales/components/salesTrendTime';
import SalesChartCrosshair from '../../sales/components/SalesChartCrosshair';
import SalesCandleLayer, { type SalesChartType } from '../../sales/components/SalesCandleLayer';

// Kartu "Purchase Volume Trend" & "Purchase Status" di tab Overview Purchase.
// Desain & fungsi disalin 1:1 dari kartu "Tren Sales Bulanan" & "Sales per Branch" di
// Sales Overview (timeframe, bentuk grafik, zoom/geser sumbu, crosshair, drag titik,
// donut interaktif). Sumber datanya tetap milik Purchase -- lihat page.tsx.

// ── Sumbu Y: lebarnya dihitung otomatis dari label harga terlebar (lihat salesAxisWidth di
// dalam komponen), dan margin kiri chart = 0, supaya label harga terlebar mulai tepat di
// tepi kiri kartu -- sejajar dengan judul di atasnya. Overlay drag-zoom sumbu Y mengikuti
// lebar yang sama (sama pola dengan chart Financial Overview / Balance Sheet). ──
const SALES_PLOT_LEFT = 0;        // margin.left AreaChart
const SALES_AXIS_GAP = 5;         // jarak label harga ke garis sumbu Y (offset tick Recharts + geser teks)
const SALES_SPRING_MS = 380;
// Sumbu waktu (X) ala TradingView: tarik di area label bulan = zoom, tarik di grafik = geser.
const SALES_XAXIS_HEIGHT = 34;
const SALES_PLOT_RIGHT = 10;      // margin.right AreaChart
const SALES_CHART_HEIGHT = 220;
const SALES_PLOT_TOP = 5;         // margin.top AreaChart
const SALES_TIME_ZOOM_PX = 220;   // jarak tarik (px) untuk melebarkan/menyempitkan jendela ~2,7x
const SALES_AXIS_BORDER = '#0E2F26'; // hijau sidebar (--nav) untuk garis tepi sumbu harga & bulan
const SALES_LINE_COLOR = '#EAB308';  // kuning garis chart
const salesEaseOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);


// Dropdown filter kustom -- sama dengan FilterSelect di tab Sales Transaction
// & Posted: selalu terbuka ke bawah, bisa di-scroll, hover/terpilih hijau brand.
interface FilterOption { value: string; label: string; short?: string }

function FilterSelect({ value, onChange, options, searchable: searchableProp, title }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
  searchable?: boolean;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = searchableProp ?? options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.short ?? current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[#6EE7B7] hover:text-[#064E3B] ${selected ? 'bg-[#D1FAE5] font-semibold text-[#065F46]' : 'text-foreground'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Pilihan dropdown timeframe & bentuk grafik Tren Sales.
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


interface SalesDragPreview {
  index: number;
  value: number;
}

// Teks label sumbu Y: nominal angka penuh tanpa awalan "Rp". Dipakai juga untuk mengukur
// lebar sumbu, jadi harus satu sumber dengan yang digambar SalesYTick.
const salesYLabel = (value: number) =>
  new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(Math.round(value));

// Label sumbu Y: rata kanan (menempel ke garis sumbu), dalam satu baris.
function SalesYTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: number } }) {
  if (x == null || y == null || !payload) return null;
  return (
    <g>
      <text x={x + 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#94a3b8">{salesYLabel(payload.value)}</text>
    </g>
  );
}

// Label sumbu X: tahun/bulan tebal, tanggal tipis; tahun muncul di baris bawah Januari.
function SalesXTick({ x, y, payload, info }: { x?: number; y?: number; payload?: { value: number }; info: Map<number, TickInfo> }) {
  const tick = payload ? info.get(payload.value) : undefined;
  if (!tick || x == null || y == null) return null;
  const strong = tick.kind !== 'day';
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={strong ? 600 : 400} fill={strong ? '#64748b' : '#94a3b8'}>
        {tick.label}
      </text>
      {tick.sub && (
        <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#475569">
          {tick.sub}
        </text>
      )}
    </g>
  );
}


function largestRemainder(rawUnits: number[], targetUnits: number): number[] {
  const base = rawUnits.map((r) => Math.floor(r));
  let left = targetUnits - base.reduce((a, b) => a + b, 0);
  const order = rawUnits.map((r, i) => ({ i, frac: r - base[i] })).sort((a, b) => b.frac - a.frac);
  const out = base.slice();
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i] += 1;
  return out;
}

// Persen satu desimal yang dijamin berjumlah tepat 100,0.
function allocatePcts(values: number[]): number[] {
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0 || values.some((v) => v < 0)) return values.map(() => 0);
  return largestRemainder(values.map((v) => (v / sum) * 1000), 1000).map((u) => u / 10);
}
const pctLabel = (p: number, value = 1) =>
  p === 0 && value > 0 ? '<0.1%' : Number.isInteger(p) ? `${p}%` : `${p.toFixed(1)}%`;


function SalesCardHeader({ icon: Icon, title, subtitle, right }: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#ECFDF5] text-[#047857] shadow-sm ring-1 ring-white">
          <Icon size={17} />
        </span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-foreground">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}


export interface PurchaseTrendRecord {
  /** Tanggal ISO "YYYY-MM-DD". */
  date: string;
  amount: number;
}

const yearOf = (iso: string | null | undefined) => {
  const y = Number((iso || '').slice(0, 4));
  return Number.isFinite(y) && y > 0 ? y : null;
};

export function PurchaseTrendCard({ records, loading = false }: { records: PurchaseTrendRecord[]; loading?: boolean }) {
  const { t, lang } = useLanguage();

  // ── Tren bulanan (per tahun, berdasarkan invoice_date) ──
  const availableYears = useMemo(() => {
    const ys = new Set<number>();
    records.forEach((r) => { const y = yearOf(r.date); if (y) ys.add(y); });
    return Array.from(ys).sort((a, b) => b - a);
  }, [records]);
  const [pickedYear, setPickedYear] = useState<number | null>(null);
  const trendYear = pickedYear && availableYears.includes(pickedYear) ? pickedYear : (availableYears[0] ?? new Date().getFullYear());

  // ── Sumbu waktu ala TradingView ──
  // Jendela waktu (view) bisa digeser dan di-zoom. Makin sempit jendelanya, makin halus datanya:
  // tahun -> bulan -> hari. Default = satu tahun penuh (Jan..Des) seperti sebelumnya.
  const trendIndex = useMemo(
    () => buildTrendIndex(records, (r) => r.date, (r) => r.amount),
    [records]
  );
  const hasAnyPurchase = useMemo(() => Array.from(trendIndex.month.values()).some((b) => b.total !== 0), [trendIndex]);
  const allTimeMaxMonth = useMemo(() => Math.max(0, ...Array.from(trendIndex.month.values()).map((b) => b.total)), [trendIndex]);

  const defaultView = useMemo<TimeRange>(() => ({ from: utc(trendYear, 0, 1), to: utc(trendYear, 11, 1) }), [trendYear]);
  const [range, setRange] = useState<TimeRange | null>(null);
  // Interval bucket pilihan user (5m ... 1Y) ala TradingView. null = otomatis, mengikuti zoom (perilaku lama).
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

  const intlLocale = lang === 'id' ? 'id-ID' : lang === 'zh' ? 'zh-CN' : 'en-US';
  const fmtMonth = useMemo(() => new Intl.DateTimeFormat(intlLocale, { month: 'short', timeZone: 'UTC' }), [intlLocale]);
  const fmtMonthYear = useMemo(() => new Intl.DateTimeFormat(intlLocale, { month: 'short', year: 'numeric', timeZone: 'UTC' }), [intlLocale]);
  const fmtFullDay = useMemo(() => new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [intlLocale]);
  const pointLabel = useCallback(
    (tm: number, g: Granularity) => (g === 'day' ? fmtFullDay.format(tm) : g === 'month' ? fmtMonthYear.format(tm) : String(new Date(tm).getUTCFullYear())),
    [fmtFullDay, fmtMonthYear]
  );
  const tickFormatters = useMemo(() => ({ monthShort: (tm: number) => fmtMonth.format(tm) }), [fmtMonth]);

  // Label bucket untuk interval pilihan (tooltip/crosshair): jam, tanggal, rentang minggu, bulan, tahun.
  const fmtTime = useMemo(() => new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }), [intlLocale]);
  const fmtDayMonth = useMemo(() => new Intl.DateTimeFormat(intlLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' }), [intlLocale]);
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

  // Titik chart untuk jendela saat ini (+1 bucket di tiap sisi supaya garis menyentuh tepi).
  const trend = useMemo(
    () => (intervalDef
      ? buildSeriesInterval(trendIndex, view.from, view.to, intervalDef, (tm) => intervalLabel(tm, intervalDef))
      : buildSeries(trendIndex, view.from, view.to, gran, pointLabel)),
    [trendIndex, view.from, view.to, gran, pointLabel, intervalDef, intervalLabel]
  );
  const xTicks = useMemo(
    () => (intervalDef && isIntraday(intervalDef)
      ? buildIntradayTicks(view.from, view.to, tickFormatters)
      : buildTicks(view.from, view.to, gran, tickFormatters)),
    [view.from, view.to, gran, tickFormatters, intervalDef]
  );
  // Lebar tiap batang/candle = jarak ke awal periode berikutnya; teks Open -> Close untuk crosshair.
  const bucketEnd = useCallback(
    (tm: number) => (intervalDef ? intervalNext(tm, intervalDef, 1) : addGran(tm, gran, 1)),
    [intervalDef, gran]
  );
  const candleExtra = useCallback(
    (i: number) => (i > 0 && trend[i] ? `Open ${formatIDR(trend[i - 1].total)} → Close ${formatIDR(trend[i].total)}` : null),
    [trend]
  );
  const xTickValues = useMemo(() => xTicks.map((k) => k.t), [xTicks]);
  const xTickInfo = useMemo(() => new Map(xTicks.map((k) => [k.t, k])), [xTicks]);

  // Dot kalibrasi dideklarasikan di sini supaya direset tepat saat data titik berganti (sebelum chart dirender).
  const salesDotsRef = useRef<{ value: number; cy: number }[]>([]);
  useMemo(() => { salesDotsRef.current = []; }, [trend]);

  // ── Zoom skala harga (drag vertikal di sumbu Y) — sama seperti chart
  // Financial Overview / Balance Sheet. ──
  // Skala dasar: dari sedikit di bawah 0 (supaya ada ruang bernilai negatif, label "-") sampai nilai
  // tertinggi yang terlihat. Bisa digeser naik/turun (tarik grafik) dan di-zoom (tarik sumbu Y).
  const salesBase = useMemo(() => {
    const vals = trend.filter((d) => d.t >= view.from && d.t <= view.to).map((d) => d.total);
    let hiData = Math.max(0, ...vals);
    const loData = Math.min(0, ...vals);
    // Jendela kosong (mis. digeser ke tahun tanpa data): pakai skala bulanan tertinggi supaya sumbu Y tetap masuk akal.
    if (hiData <= 0) hiData = allTimeMaxMonth;
    hiData = Math.max(1, hiData);
    const hi = hiData * 1.08;
    // Data tanpa nilai negatif: sisakan ruang tepat satu langkah tick di bawah 0 (muncul label "-").
    return { lo: loData < 0 ? loData * 1.08 : -niceStep(hi, 4), hi };
  }, [trend, view.from, view.to, allTimeMaxMonth]);
  const [salesPriceZoom, setSalesPriceZoom] = useState(1);
  const [salesYShift, setSalesYShift] = useState(0);
  const salesYShiftRef = useRef(0);
  salesYShiftRef.current = salesYShift;
  const salesZoomDragRef = useRef<{ startY: number; startZoom: number } | null>(null);

  const salesYDomain = useMemo<[number, number]>(() => {
    const mid = (salesBase.lo + salesBase.hi) / 2 + salesYShift;
    const half = (salesBase.hi - salesBase.lo) / 2 / salesPriceZoom;
    return [mid - half, mid + half];
  }, [salesBase, salesPriceZoom, salesYShift]);
  const salesYTicks = useMemo(() => niceTicksRange(salesYDomain[0], salesYDomain[1], 5), [salesYDomain]);

  // Lebar sumbu Y = label harga terlebar + jarak ke garis sumbu. Diukur dengan canvas memakai font
  // halaman (diukur ulang setelah font selesai dimuat); tebakan awal dipakai untuk render pertama.
  const [salesAxisWidth, setSalesAxisWidth] = useState(() =>
    Math.ceil(Math.max(...salesYTicks.map((v) => salesYLabel(v).length)) * 6.8) + SALES_AXIS_GAP
  );
  useEffect(() => {
    const labels = salesYTicks.map(salesYLabel);
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `10px ${getComputedStyle(document.body).fontFamily}`;
      const widest = Math.max(0, ...labels.map((l) => ctx.measureText(l).width));
      const next = Math.ceil(widest) + SALES_AXIS_GAP;
      setSalesAxisWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; };
  }, [salesYTicks]);
  const salesAxisOverlayWidth = salesAxisWidth + SALES_PLOT_LEFT;
  const salesYDomainRef = useRef(salesYDomain);
  salesYDomainRef.current = salesYDomain;

  const handleSalesAxisMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    salesZoomDragRef.current = { startY: e.clientY, startZoom: salesPriceZoom };
    const onMove = (ev: MouseEvent) => {
      if (!salesZoomDragRef.current) return;
      const deltaY = salesZoomDragRef.current.startY - ev.clientY; // tarik ke atas = zoom in
      const factor = Math.exp(deltaY / 150);
      const next = Math.min(6, Math.max(0.25, salesZoomDragRef.current.startZoom * factor));
      setSalesPriceZoom(next);
    };
    const onUp = () => {
      salesZoomDragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const resetSalesZoom = () => { setSalesPriceZoom(1); setSalesYShift(0); };

  // ── Drag titik data (tarik nilai "total" bulan tertentu) — kalibrasi
  // piksel<->nilai dari titik lain, live preview, spring-back saat dilepas. ──
  const [salesDragPreview, setSalesDragPreview] = useState<SalesDragPreview | null>(null);
  const salesDragStateRef = useRef<{
    index: number;
    originalValue: number;
    currentValue: number;
    startClientY: number;
    pxPerUnit: number;
  } | null>(null);
  const salesAnimRef = useRef<number | null>(null);

  const stopSalesSpring = () => {
    if (salesAnimRef.current) cancelAnimationFrame(salesAnimRef.current);
    salesAnimRef.current = null;
  };

  useEffect(() => {
    stopSalesSpring();
    salesDragStateRef.current = null;
    setSalesDragPreview(null);
  }, [trend]);

  useEffect(() => stopSalesSpring, []);

  const springBackSales = useCallback(() => {
    const drag = salesDragStateRef.current;
    if (!drag) return;
    stopSalesSpring();
    const from = drag.currentValue;
    const target = drag.originalValue;
    const { index } = drag;
    const start = performance.now();
    const step = (now: number) => {
      const elapsed = Math.min(1, (now - start) / SALES_SPRING_MS);
      const eased = salesEaseOutQuint(elapsed);
      const next = from + (target - from) * eased;
      if (salesDragStateRef.current) salesDragStateRef.current.currentValue = next;
      setSalesDragPreview({ index, value: next });
      if (elapsed < 1) {
        salesAnimRef.current = requestAnimationFrame(step);
      } else {
        salesDragStateRef.current = null;
        salesAnimRef.current = null;
        setSalesDragPreview(null);
      }
    };
    salesAnimRef.current = requestAnimationFrame(step);
  }, []);

  const handleSalesDotPointerDown = useCallback((e: React.PointerEvent, index: number, originalValue: number) => {
    e.preventDefault();
    e.stopPropagation();
    stopSalesSpring();

    const samples = salesDotsRef.current.filter((pt, i) => i !== index && Number.isFinite(pt?.cy));
    let pxPerUnit = 0; // 0 = belum terkalibrasi -> pakai fallback di bawah
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
      const [dMin, dMax] = salesYDomainRef.current;
      pxPerUnit = -160 / (dMax - dMin || 1);
    }

    salesDragStateRef.current = {
      index,
      originalValue,
      currentValue: originalValue,
      startClientY: e.clientY,
      pxPerUnit,
    };
    setSalesDragPreview({ index, value: originalValue });
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      const drag = salesDragStateRef.current;
      if (!drag) return;
      const deltaY = e.clientY - drag.startClientY;
      const [, dMax] = salesYDomainRef.current;
      const maxValue = dMax * 1.4;
      const value = Math.max(0, Math.min(maxValue, drag.originalValue + deltaY / drag.pxPerUnit));
      drag.currentValue = value;
      setSalesDragPreview({ index: drag.index, value });
    };
    const handleUp = () => {
      if (salesDragStateRef.current) springBackSales();
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [springBackSales]);

  // Interval < 1 hari: isi tiap hari hanya hasil bagi rata, jadi garis dihaluskan (khusus tampilan Area/Line)
  // supaya tidak berbentuk kotak-kotak. Nilai asli tetap dipakai di legenda crosshair & skala sumbu Y.
  const lineTrend = useMemo(
    () => (intervalDef && isIntraday(intervalDef) && (chartType === 'area' || chartType === 'line')
      ? smoothSeries(trend, Math.max(1, (DAY_MS / intervalDef.ms) * 0.12))
      : trend),
    [trend, intervalDef, chartType]
  );
  const salesDisplayTrend = useMemo(() => {
    if (!salesDragPreview) return lineTrend;
    return lineTrend.map((d, i) => (i === salesDragPreview.index ? { ...d, total: salesDragPreview.value } : d));
  }, [lineTrend, salesDragPreview]);

  // Dot tak terlihat: cuma merekam posisi piksel & nilai asli tiap titik, buat kalibrasi drag.
  const renderSalesCalibrationDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    salesDotsRef.current[index] = { value: payload.total, cy };
    return <circle key={`sales-cal-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  // Dot terlihat + target genggam (hit-area) lebih besar di atasnya, biar mudah ditarik.
  const renderSalesActiveDot = (props: any) => {
    const { cx, cy, index, payload } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = salesDragPreview?.index === index;
    return (
      <g key={`sales-pt-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill={SALES_LINE_COLOR} stroke="#fff" strokeWidth={1.5} />
        <circle
          cx={cx}
          cy={cy}
          r={12}
          fill="transparent"
          style={{ cursor: 'ns-resize', touchAction: 'none' }}
          onPointerDown={(e) => handleSalesDotPointerDown(e, index, payload.total)}
        />
      </g>
    );
  };

  // ── Zoom & geser sumbu waktu (ala TradingView) ──
  //  - Tarik di area label bulan: kanan = jendela melebar (bulan -> tahun), kiri = menyempit (bulan -> tanggal).
  //    Titik yang diklik tetap di tempatnya saat zoom.
  //  - Tarik di grafik: geser periode kiri/kanan. Klik dua kali di label = kembali ke satu tahun penuh.
  const chartWrapRef = useRef<HTMLDivElement>(null);
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
    const plotLeft = rect.left + salesAxisOverlayWidth;
    const plotWidth = Math.max(60, rect.width - salesAxisOverlayWidth - SALES_PLOT_RIGHT);
    const start = viewRef.current;
    const span = start.to - start.from;
    const startX = e.clientX;
    const startY = e.clientY;
    const startShift = salesYShiftRef.current;
    const [yLo, yHi] = salesYDomainRef.current;
    const plotH = Math.max(60, SALES_CHART_HEIGHT - SALES_XAXIS_HEIGHT - SALES_PLOT_TOP);
    if (mode === 'pan') setPanning(true);
    const anchor = Math.min(1, Math.max(0, (startX - plotLeft) / plotWidth));
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (mode === 'zoom') setRange(zoomRange(start, Math.exp(dx / SALES_TIME_ZOOM_PX), anchor, boundsRef.current));
      else {
        setRange(panRange(start, (-dx / plotWidth) * span, boundsRef.current));
        // Tarik ke bawah = grafik turun (rentang nilai yang terlihat naik), seperti TradingView.
        setSalesYShift(startShift + ((ev.clientY - startY) / plotH) * (yHi - yLo));
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
    if (x < salesAxisOverlayWidth || y > rect.height - SALES_XAXIS_HEIGHT) return; // sumbu Y & sumbu X punya handler sendiri
    beginTimeDrag(e, 'pan');
  };

  const chartGeometry = {
    plotLeft: salesAxisOverlayWidth,
    plotRightMargin: SALES_PLOT_RIGHT,
    plotTop: SALES_PLOT_TOP,
    plotBottom: SALES_CHART_HEIGHT - SALES_XAXIS_HEIGHT,
  };

  const selectInterval = (id: IntervalId | null) => {
    setIntervalId(id);
    setRange(null);
    setSalesPriceZoom(1);
    setSalesYShift(0);
  };

  return (
    <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">{t('Purchase Volume Trend')}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">{t('Based on purchase date, gross amount')}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {/* Timeframe (5m ... 1Y) + bentuk grafik ala TradingView */}
              <FilterSelect
                title="Timeframe"
                searchable={false}
                value={intervalId ?? 'auto'}
                onChange={(v) => selectInterval(v === 'auto' ? null : (v as IntervalId))}
                options={INTERVAL_OPTIONS}
              />
              <FilterSelect
                title="Bentuk grafik"
                searchable={false}
                value={chartType}
                onChange={(v) => setChartType(v as SalesChartType)}
                options={CHART_TYPE_OPTIONS}
              />
              {(range || intervalId) && (
                <button
                  type="button"
                  onClick={() => { setRange(null); setIntervalId(null); setSalesYShift(0); setSalesPriceZoom(1); }}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground hover:bg-muted"
                >
                  {t('Reset')}
                </button>
              )}
              {availableYears.length > 1 && (
                <select
                  value={trendYear}
                  onChange={(e) => { setPickedYear(Number(e.target.value)); setRange(null); }}
                  className="text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground"
                >
                  {availableYears.map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              )}
            </div>
          </div>
          {!hasAnyPurchase ? (
            <p className="text-xs text-muted-foreground py-10 text-center">{loading ? t('Loading...') : t('No purchase transactions to display yet.')}</p>
          ) : (
            <div
              ref={chartWrapRef}
              onPointerDown={handleChartPointerDown}
              className={`relative select-none ${panning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
              style={{ touchAction: 'pan-y' }}
            >
              <ResponsiveContainer width="100%" height={SALES_CHART_HEIGHT}>
                <AreaChart data={salesDisplayTrend} margin={{ top: SALES_PLOT_TOP, right: SALES_PLOT_RIGHT, left: SALES_PLOT_LEFT, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradPurchaseMain" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={SALES_LINE_COLOR} stopOpacity={0.65} />
                      <stop offset="95%" stopColor={SALES_LINE_COLOR} stopOpacity={0.12} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="t"
                    type="number"
                    scale="linear"
                    domain={[view.from, view.to]}
                    allowDataOverflow
                    ticks={xTickValues}
                    interval={0}
                    tick={(p: any) => <SalesXTick {...p} info={xTickInfo} />}
                    axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
                    tickLine={false}
                    height={SALES_XAXIS_HEIGHT}
                  />
                  <YAxis
                    tick={(p: any) => <SalesYTick {...p} />}
                    axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
                    tickLine={false}
                    width={salesAxisWidth}
                    ticks={salesYTicks}
                    domain={salesYDomain}
                    allowDataOverflow
                  />
                  <ReferenceLine y={0} stroke={SALES_AXIS_BORDER} strokeOpacity={0.35} />
                  <Tooltip content={() => null} cursor={false} />
                  {(chartType === 'area' || chartType === 'line') && (
                    <Area
                      type="monotone"
                      dataKey="total"
                      name="Purchase"
                      stroke={SALES_LINE_COLOR}
                      strokeWidth={2.5}
                      baseValue={0}
                    fill={chartType === 'area' ? 'url(#gradPurchaseMain)' : 'none'}
                      dot={renderSalesCalibrationDot as any}
                      activeDot={renderSalesActiveDot as any}
                      isAnimationActive={!salesDragPreview && range === null}
                    />
                  )}
                </AreaChart>
              </ResponsiveContainer>
              {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
              <div
                onMouseDown={handleSalesAxisMouseDown}
                onDoubleClick={resetSalesZoom}
                title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
                className="absolute top-0 left-0 h-full cursor-ns-resize"
                style={{ width: salesAxisOverlayWidth }}
              />
              {/* Overlay drag di area label waktu: tarik kanan = zoom out (tahun), tarik kiri = zoom in (tanggal) */}
              <div
                onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); beginTimeDrag(e, 'zoom'); }}
                onDoubleClick={() => setRange(null)}
                title={t('Tarik kanan/kiri untuk zoom periode · klik dua kali untuk reset')}
                className="absolute bottom-0 cursor-ew-resize"
                style={{ left: salesAxisOverlayWidth, right: SALES_PLOT_RIGHT, height: SALES_XAXIS_HEIGHT, touchAction: 'none' }}
              />
              {(chartType === 'column' || chartType === 'candle' || chartType === 'ohlc') && (
                <SalesCandleLayer
                  wrapRef={chartWrapRef}
                  geometry={chartGeometry}
                  view={view}
                  yMin={salesYDomain[0]}
                  yMax={salesYDomain[1]}
                  points={trend}
                  nextOf={bucketEnd}
                  type={chartType}
                />
              )}
              {/* Crosshair: garis horizontal + vertikal di kursor dengan label harga & tanggal */}
              <SalesChartCrosshair
                wrapRef={chartWrapRef}
                geometry={chartGeometry}
                view={view}
                gran={gran}
                yMin={salesYDomain[0]}
                yMax={salesYDomain[1]}
                trend={trend}
                pointLabel={pointLabel}
                bucketOf={intervalDef ? (tm) => intervalStart(tm, intervalDef) : undefined}
                labelOf={intervalDef ? (tm) => intervalLabel(tm, intervalDef) : undefined}
                extraOf={chartType === 'candle' || chartType === 'ohlc' ? candleExtra : undefined}
                dragPreview={salesDragPreview}
                estimatedLabel={t('Estimated')}
                salesLabel={t('Purchase')}
              />
            </div>
          )}
          {intervalDef && isIntraday(intervalDef) && hasAnyPurchase && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {lang === 'id'
                ? 'Data pembelian tercatat per hari; interval di bawah 1 hari = total harian dibagi rata.'
                : lang === 'zh'
                  ? '采购按天记录；小于1天的周期将当日总额平均分配。'
                  : 'Purchases are recorded per day; intervals under 1 day split the daily total evenly.'}
            </p>
          )}
        </div>
  );
}

// ── Donut Purchase Status ──
// Sama dengan kartu "Sales per Branch": donut interaktif (klik segmen / baris legenda,
// tarik garis pemisah untuk preview what-if) + legenda dengan nilai & persen.
// Bedanya, nilainya jumlah transaksi (bukan uang), jadi dipakai formatter hitungan.
const fmtCount = (n: number) => `${n} ${n === 1 ? 'transaction' : 'transactions'}`;

export function PurchaseStatusDonutCard({ data }: { data: { name: string; value: number; color: string }[] }) {
  const { t } = useLanguage();
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);

  const segs = data;
  const total = useMemo(() => segs.reduce((s, d) => s + d.value, 0), [segs]);

  // Jumlah segmen bisa berubah -> reset pilihan.
  useEffect(() => { setActive(null); }, [segs.length]);

  // Angka yang tampil (nilai asli, atau nilai preview saat garis pemisah ditarik), dibulatkan
  // bersama supaya persen = 100,0% dan jumlah transaksi = total.
  const shownValues = useMemo(() => (live ? live.map((p) => p.value) : segs.map((sg) => sg.value)), [live, segs]);
  const shownTotal = useMemo(() => shownValues.reduce((a, b) => a + b, 0), [shownValues]);
  const shownPcts = useMemo(() => allocatePcts(shownValues), [shownValues]);
  const shownCounts = useMemo(
    () => (shownValues.every((v) => v >= 0) ? largestRemainder(shownValues, Math.round(shownTotal)) : shownValues.map(Math.round)),
    [shownValues, shownTotal]
  );
  const toggle = (i: number) => setActive((prev) => (prev === i ? null : i));

  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <SalesCardHeader icon={ShoppingBag} title={t('Purchase Status')} subtitle={t('Current distribution')} />
      {segs.length === 0 || total <= 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[220px] shrink-0">
            <InteractiveDonutChart
              data={segs}
              height={190}
              centerLabel={String(Math.round(total))}
              centerSubLabel={t('Total Transactions')}
              activeIndex={active}
              onActiveChange={setActive}
              onLiveChange={setLive}
              rawValue
              minVisibleDeg={5}
              formatValue={(v, i) => fmtCount(shownCounts[i] ?? Math.round(v))}
              formatPct={(p, i) => pctLabel(shownPcts[i] ?? p, shownValues[i] ?? 1)}
            />
          </div>

          <ul className="mt-4 space-y-1">
            {segs.map((a, i) => (
              <li
                key={`legend-${a.name}-${i}`}
                onClick={() => toggle(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${active === i ? 'bg-[#ECFDF5]' : 'hover:bg-slate-50'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className={`min-w-0 flex-1 truncate ${active === i ? 'font-bold' : 'font-medium'} text-foreground`} title={a.name}>{a.name}</span>
                <span className="font-semibold tabular-nums text-foreground">{shownCounts[i]}</span>
                <span className="w-10 shrink-0 rounded-full bg-slate-100 py-0.5 text-center text-[10px] font-bold tabular-nums text-slate-600">
                  {pctLabel(shownPcts[i], shownValues[i])}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}