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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { Clock } from 'lucide-react';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
// Desain chart disalin 100% dari kartu "Tren Sales Bulanan" (Sales > Overview) & donut dari
// "Purchase Status" (Purchase > Overview). Hanya tampilan -- data & logika Overview tetap.
import { FilterSelect, SalesCardHeader, allocatePcts, pctLabel, type FilterOption } from '@/app/transactions/bank-cash/components/salesStyleKit';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import {
  niceStep, niceTicksRange, addGran, startOf, utc, DAY_MS, buildTicks, zoomRange, panRange,
  intervalStart, intervalNext, INTERVALS, INTERVAL_BY_ID, TREND_FIRST_YEAR,
  type TimeRange, type TimeBounds, type TickInfo, type IntervalId, type IntervalDef, type Granularity,
} from '@/app/transactions/sales/components/salesTrendTime';
// Bentuk grafik column / candle / OHLC memakai layer yang SAMA dengan chart Tren Sales.
import SalesCandleLayer, { type SalesChartType } from '@/app/transactions/sales/components/SalesCandleLayer';
import { useLanguage } from '@/lib/language';
import { useCurrency, formatMoney } from '@/lib/currency';
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
import { ambilFinancialBudget } from '@/app/zafeb-ai/lib/api';

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

// ── Konstanta & komponen tampilan chart (salinan dari chart Tren Sales) ──
const SALES_AXIS_GAP = 5;            // jarak label harga ke garis sumbu Y
const SALES_XAXIS_HEIGHT = 34;
const SALES_PLOT_RIGHT = 10;         // margin.right chart
const SALES_PLOT_TOP = 5;            // margin.top chart
const SALES_CHART_HEIGHT = 220;
const SALES_TIME_ZOOM_PX = 220;      // jarak tarik (px) untuk melebarkan/menyempitkan jendela waktu ~2,7x
const SALES_AXIS_BORDER = '#404040'; // abu gelap garis sumbu
const SALES_LINE_COLOR = '#2563EB';  // biru garis chart (sama dengan chart Tren Sales)
const C_EXPENSES = '#737373';
const C_NET = '#171717';
const C_MUTED = '#a3a3a3';

type OverviewChartType = SalesChartType;
// Sama dengan pilihan "Bentuk grafik" di chart Tren Sales.
const CHART_TYPE_OPTIONS: FilterOption[] = [
  { value: 'area', label: 'Area' },
  { value: 'line', label: 'Line' },
  { value: 'column', label: 'Column' },
  { value: 'candle', label: 'Candle' },
  { value: 'ohlc', label: 'OHLC Bar' },
];
// Mode Tahun Lalu bukan deret waktu, jadi hanya Area / Line.
const CHART_TYPE_OPTIONS_BASIC: FilterOption[] = CHART_TYPE_OPTIONS.slice(0, 2);
// Interval bucket (data P&L bulanan -> hanya 1M / 6M / 1Y yang bermakna).
const INTERVAL_OPTIONS: FilterOption[] = [
  { value: 'auto', label: 'Auto', short: 'Auto' },
  ...INTERVALS.filter((d) => d.kind === 'months').map((d) => ({ value: d.id, label: `${d.label} · ${d.title}`, short: d.label })),
];

const fmtMonthYearLabel = (tm: number) => `${NAMA_BULAN[new Date(tm).getUTCMonth()]} ${new Date(tm).getUTCFullYear()}`;
function intervalLabel(tm: number, d: IntervalDef): string {
  if (d.months === 1) return fmtMonthYearLabel(tm);
  if (d.months === 12) return String(new Date(tm).getUTCFullYear());
  return `${NAMA_BULAN[new Date(tm).getUTCMonth()]} – ${fmtMonthYearLabel(addGran(tm, 'month', d.months - 1))}`;
}
const PERIOD_OPTIONS: FilterOption[] = [
  { value: '6M', label: '6M · 6 Months', short: '6M' },
  { value: 'YTD', label: 'YTD · Year to Date', short: 'YTD' },
  { value: '12M', label: '12M · 12 Months', short: '12M' },
  { value: '3Y', label: '3Y · 3 Years', short: '3Y' },
];

// Label sumbu Y: rata kanan (menempel ke garis sumbu), dalam satu baris.
function SalesYTick({ x, y, payload, label }: { x?: number; y?: number; payload?: { value: number }; label: (v: number) => string }) {
  if (x == null || y == null || !payload) return null;
  return (
    <g>
      <text x={x + 4} y={y} dy={4} textAnchor="end" fontSize={10} fill="#8a8a8a">{label(payload.value)}</text>
    </g>
  );
}

// Label sumbu X: bulan tebal; tahun muncul di baris bawah Januari (atau titik pertama).
function SalesXTick({ x, y, payload, index, labels, info }: { x?: number; y?: number; payload?: { value: string | number }; index?: number; labels?: string[]; info?: Map<number, TickInfo> }) {
  if (x == null || y == null || !payload) return null;
  // Sumbu waktu nyata (ms): label & tahun (di bawah Januari) datang dari TickInfo.
  if (info) {
    const ti = info.get(Number(payload.value));
    if (!ti) return null;
    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="#525252">{ti.label}</text>
        {ti.sub && <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">{ti.sub}</text>}
      </g>
    );
  }
  // Sumbu waktu numerik (indeks bulan): ambil nama bulan dari `labels`.
  const raw = labels ? String(labels[Math.round(Number(payload.value))] ?? '') : String(payload.value ?? '');
  if (!raw) return null;
  const m = raw.match(/^(.+?) '(\d{2})$/);
  const label = m ? m[1] : raw;
  const sub = m && (m[1] === 'Jan' || index === 0) ? `20${m[2]}` : null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="#525252">{label}</text>
      {sub && (
        <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">{sub}</text>
      )}
    </g>
  );
}

interface CrosshairRow { name: string; color: string; value: number }
interface CrosshairGeometry { plotLeft: number; plotRightMargin: number; plotTop: number; plotBottom: number }

// Crosshair ala TradingView (salinan SalesChartCrosshair): garis putus-putus di kursor, label harga di
// sumbu Y, label periode di sumbu X, dan legenda kecil di pojok kiri atas berisi nilai tiap garis.
const CHIP = 'absolute rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white whitespace-nowrap shadow-sm';
const CHIP_BG = '#262626';
const CROSS_LINE = '#a3a3a3';
const DATE_CHIP_HALF = 80;

function SalesChartCrosshair({
  wrapRef, geometry, yMin, yMax, labels, band, rowsOf, extraOf, formatValue, view, times,
}: {
  wrapRef: React.RefObject<HTMLDivElement | null>;
  geometry: CrosshairGeometry;
  yMin: number;
  yMax: number;
  labels: string[];
  /** true = sumbu X berupa batang (band), false = titik dari tepi ke tepi. */
  band: boolean;
  rowsOf: (index: number) => CrosshairRow[];
  extraOf?: (index: number) => string | null;
  formatValue: (n: number) => string;
  /** Jendela waktu (indeks data, pecahan) saat chart digeser/di-zoom; kosong = seluruh data tepi ke tepi. */
  view?: { from: number; to: number };
  /** Waktu (ms) tiap titik -- dipakai bila sumbu X berupa waktu nyata (bukan indeks). */
  times?: number[];
}) {
  const [pos, setPos] = useState<{ x: number; y: number; w: number } | null>(null);
  const { plotLeft, plotRightMargin, plotTop, plotBottom } = geometry;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') { setPos(null); return; }
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const inside = x >= plotLeft && x <= r.width - plotRightMargin && y >= plotTop && y <= plotBottom;
      setPos(inside ? { x, y, w: r.width } : null);
    };
    const onLeave = () => setPos(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [wrapRef, plotLeft, plotRightMargin, plotTop, plotBottom]);

  if (!pos || labels.length === 0) return null;

  const plotRight = pos.w - plotRightMargin;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const n = labels.length;
  const frac = Math.min(1, Math.max(0, (pos.x - plotLeft) / plotWidth));
  let idx: number;
  if (times && view && times.length > 0) {
    // Sumbu waktu nyata: batang = periode yang memuat kursor, garis = titik terdekat.
    const tAt = view.from + frac * (view.to - view.from);
    idx = 0;
    if (band) {
      for (let i = 0; i < times.length; i++) { if (times[i] <= tAt) idx = i; else break; }
    } else {
      let best = Infinity;
      for (let i = 0; i < times.length; i++) { const dd = Math.abs(times[i] - tAt); if (dd < best) { best = dd; idx = i; } }
    }
    idx = Math.min(n - 1, idx);
  } else if (band) {
    idx = Math.min(n - 1, Math.floor(frac * n));
  } else if (view) {
    idx = Math.min(n - 1, Math.max(0, Math.round(view.from + frac * (view.to - view.from))));
  } else {
    idx = n > 1 ? Math.round(frac * (n - 1)) : 0;
  }
  const price = yMin + ((plotBottom - pos.y) / plotHeight) * (yMax - yMin);
  const dateText = labels[idx] ?? '';
  const dateCenter = Math.min(plotRight - DATE_CHIP_HALF, Math.max(plotLeft + DATE_CHIP_HALF, pos.x));
  const rows = rowsOf(idx);
  const extra = extraOf ? extraOf(idx) : null;

  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <line x1={pos.x} y1={plotTop} x2={pos.x} y2={plotBottom} stroke={CROSS_LINE} strokeWidth={1} strokeDasharray="4 3" />
        <line x1={plotLeft} y1={pos.y} x2={plotRight} y2={pos.y} stroke={CROSS_LINE} strokeWidth={1} strokeDasharray="4 3" />
      </svg>

      {/* Harga di posisi kursor — menempel di sumbu Y */}
      <div className={CHIP} style={{ background: CHIP_BG, right: pos.w - plotLeft + 4, top: pos.y - 10 }}>
        {formatValue(price)}
      </div>

      {/* Periode di posisi kursor — menempel di sumbu X */}
      <div className={CHIP} style={{ background: CHIP_BG, left: dateCenter, top: plotBottom + 4, transform: 'translateX(-50%)' }}>
        {dateText}
      </div>

      {/* Nilai tiap garis pada periode di bawah kursor (pengganti kartu tooltip) */}
      <div
        className="absolute rounded bg-white/90 px-1.5 py-0.5 text-[11px] leading-4 text-slate-700 shadow-sm"
        style={{ left: plotLeft + 8, top: plotTop + 2 }}
      >
        <span className="font-semibold">{dateText}</span>
        {rows.map((r) => (
          <span key={r.name} style={{ color: r.color }}>
            {' · '}{r.name}: {formatValue(r.value)}
          </span>
        ))}
        {extra && <span className="text-slate-500">{' · '}{extra}</span>}
      </div>
    </div>
  );
}

// Legenda statis di bawah chart (chart Sales hanya satu garis, Overview punya beberapa).
function SalesChartLegend({ items }: { items: { name: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-medium text-neutral-600">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0 w-4 border-t-2"
            style={{ borderColor: it.color, borderTopStyle: it.dashed ? 'dashed' : 'solid' }}
          />
          {it.name}
        </span>
      ))}
    </div>
  );
}

// ── Donut AR Aging: salinan 100% kartu donut "Purchase Status" (Purchase > Overview). ──
function ArAgingDonutCard({ data, subtitle }: { data: { name: string; value: number; color: string }[]; subtitle: string }) {
  const { t } = useLanguage();
  const { currency } = useCurrency();
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);

  const segs = data;
  const total = useMemo(() => segs.reduce((s, d) => s + d.value, 0), [segs]);

  // Jumlah segmen bisa berubah -> reset pilihan.
  useEffect(() => { setActive(null); }, [segs.length]);

  // Angka yang tampil (nilai asli, atau nilai preview saat garis pemisah ditarik), dibulatkan
  // bersama supaya persen = 100,0%.
  const shownValues = useMemo(() => (live ? live.map((p) => p.value) : segs.map((sg) => sg.value)), [live, segs]);
  const shownPcts = useMemo(() => allocatePcts(shownValues), [shownValues]);
  const toggle = (i: number) => setActive((prev) => (prev === i ? null : i));

  return (
    <div className={`${salesFont.className} card-elevated-md flex h-full flex-col rounded-xl p-5`}>
      <SalesCardHeader neutral icon={Clock} title={t('AR Aging Analysis')} subtitle={subtitle} />
      {segs.length === 0 || total <= 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">{t('Belum ada data.')}</p>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[220px] shrink-0">
            <InteractiveDonutChart
              data={segs}
              height={190}
              centerLabel={formatMoney(total, currency)}
              centerSubLabel={t('Total AR')}
              activeIndex={active}
              onActiveChange={setActive}
              onLiveChange={setLive}
              rawValue
              minVisibleDeg={5}
              formatValue={(v, i) => formatMoney(shownValues[i] ?? v, currency)}
              formatPct={(p, i) => pctLabel(shownPcts[i] ?? p, shownValues[i] ?? 1)}
            />
          </div>

          <ul className="mt-4 space-y-1">
            {segs.map((a, i) => (
              <li
                key={`legend-${a.name}-${i}`}
                onClick={() => toggle(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${active === i ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className={`min-w-0 flex-1 truncate ${active === i ? 'font-bold' : 'font-medium'} text-foreground`} title={a.name}>{a.name}</span>
                <span className="font-semibold tabular-nums text-foreground">{formatMoney(shownValues[i] ?? a.value, currency)}</span>
                <span className="w-10 shrink-0 rounded-full bg-neutral-100 py-0.5 text-center text-[10px] font-semibold tabular-nums text-neutral-600">
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

export default function OverviewCharts({ viewMode = 'Actual', branchId }: { viewMode?: OverviewViewMode; branchId?: string }) {
  const [period, setPeriod] = useState<'6M' | 'YTD' | '12M' | '3Y'>('YTD');
  const [chartType, setChartType] = useState<OverviewChartType>('area');
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

  // ── Sumbu waktu NYATA (ms UTC) untuk mode Actual: bisa digeser & di-zoom dari 1950 sampai akhir
  // tahun ini, persis seperti chart Tren Sales. Pilihan periode (6M/YTD/12M/3Y) hanya menentukan jendela
  // awal. Data P&L bulanan tiap tahun dimuat sesuai jendela yang sedang terlihat. ──
  const isTimeline = viewMode === 'Actual';
  const [tRange, setTRange] = useState<TimeRange | null>(null);
  const [intervalId, setIntervalId] = useState<IntervalId | null>(null);
  const intervalDef: IntervalDef | null = intervalId ? INTERVAL_BY_ID[intervalId] : null;
  const anchorMonthStart = utc(anchorYear, anchorMonthIdx, 1);

  const timeBounds = useMemo<TimeBounds>(() => {
    const minT = utc(TREND_FIRST_YEAR, 0, 1);
    const maxT = utc(anchorYear + 1, 0, 1);
    const bar = (intervalDef ? intervalDef.months : 1) * 30.4375 * DAY_MS;
    return {
      minT,
      maxT,
      minSpan: (intervalDef ? 8 : 3) * bar,
      maxSpan: Math.min(maxT - minT, intervalDef ? 600 * bar : Infinity),
    };
  }, [anchorYear, intervalDef]);

  const presetWindow = useMemo<TimeRange>(() => {
    const months = period === '6M' ? 6 : period === '12M' ? 12 : period === '3Y' ? 36 : anchorMonthIdx + 1; // YTD
    return { from: addGran(anchorMonthStart, 'month', -(Math.max(months, 2) - 1)), to: anchorMonthStart };
  }, [period, anchorMonthStart, anchorMonthIdx]);
  const intervalWindow = useMemo<TimeRange | null>(() => {
    if (!intervalDef) return null;
    const to = intervalStart(anchorMonthStart, intervalDef);
    return { from: intervalNext(to, intervalDef, -(intervalDef.bars - 1)), to };
  }, [intervalDef, anchorMonthStart]);
  const timelineView: TimeRange = tRange ?? intervalWindow ?? presetWindow;
  // Data bulanan: bulan -> (jendela <= 12 tahun) ; tahun -> (lebih lebar). Tidak ada tingkat "hari".
  const timelineGran: Granularity = (timelineView.to - timelineView.from) / DAY_MS <= 12 * 366 ? 'month' : 'year';

  // Jendela yang sudah "settle" (tidak sedang ditarik) -> menentukan tahun mana yang perlu di-fetch.
  const [settledView, setSettledView] = useState<TimeRange>(timelineView);
  useEffect(() => {
    const id = setTimeout(() => setSettledView({ from: timelineView.from, to: timelineView.to }), 300);
    return () => clearTimeout(id);
  }, [timelineView.from, timelineView.to]);

  const MAX_YEARS_PER_VIEW = 10;
  const { yearsNeeded, yearsTruncated } = useMemo(() => {
    const none = { yearsNeeded: [] as number[], yearsTruncated: false };
    if (plIsSample) return none;
    if (viewMode === 'Previous Year') return { yearsNeeded: [anchorYear - 1], yearsTruncated: false };
    if (!isTimeline) return none;
    const y0 = Math.max(TREND_FIRST_YEAR, new Date(settledView.from).getUTCFullYear());
    const y1 = Math.min(anchorYear - 1, new Date(settledView.to).getUTCFullYear());
    const list: number[] = [];
    for (let y = y1; y >= y0 && list.length < MAX_YEARS_PER_VIEW; y--) list.push(y); // tahun terbaru dulu
    return { yearsNeeded: list, yearsTruncated: y1 - y0 + 1 > MAX_YEARS_PER_VIEW };
  }, [plIsSample, viewMode, isTimeline, settledView.from, settledView.to, anchorYear]);

  // Ganti client -> buang cache tahun-tahun milik client sebelumnya.
  const latestClientRef = useRef(activeClientId);
  latestClientRef.current = activeClientId;
  useEffect(() => {
    setPriorYearsPL({});
    fetchingYearsRef.current.clear();
  }, [activeClientId]);

  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    if (!activeClientId || plIsSample) return;
    const toFetch = yearsNeeded.filter((y) => !(y in priorYearsPL) && !fetchingYearsRef.current.has(y));
    if (toFetch.length === 0) return;
    const cid = activeClientId;
    toFetch.forEach((y) => fetchingYearsRef.current.add(y));
    setLoadingMore(true);
    (async () => {
      // Maksimal 3 tahun sekaligus supaya backend tidak kebanjiran saat chart di-zoom out jauh.
      for (let i = 0; i < toFetch.length; i += 3) {
        const chunk = toFetch.slice(i, i + 3);
        const results = await Promise.all(
          // Tahun lama (> 2 tahun ke belakang) dibaca saja -- tidak men-generate laporan baru untuk tahun yang kosong.
          chunk.map((y) => fetchMonthlyPLForYear(cid, y, { generateIfMissing: y >= anchorYear - 2 }))
        );
        if (latestClientRef.current !== cid) return;
        setPriorYearsPL((prev) => {
          const next = { ...prev };
          chunk.forEach((y, j) => { next[y] = results[j] || []; fetchingYearsRef.current.delete(y); });
          return next;
        });
      }
      if (latestClientRef.current === cid) setLoadingMore(false);
    })();
  }, [activeClientId, plIsSample, yearsNeeded, priorYearsPL, anchorYear]);

  // ── Semua bulan P&L yang sudah dimuat (tahun ini + tahun lain) -> peta per awal bulan (ms UTC). ──
  type PlMonth = { revenue: number; expenses: number; netProfit: number };
  const plMonthMap = useMemo(() => {
    const map = new Map<number, PlMonth>();
    if (plIsSample) return map;
    const addYear = (year: number, monthly: MonthlyPLRow[] | null | undefined) => {
      (monthly || []).forEach((row) => {
        const mIdx = NAMA_BULAN.indexOf(row.month);
        if (mIdx === -1) return;
        map.set(utc(year, mIdx, 1), {
          revenue: row.revenue * 1e6,
          expenses: (row.cogs + row.opEx + row.da + row.interest + row.tax) * 1e6,
          netProfit: row.netProfit * 1e6,
        });
      });
    };
    addYear(anchorYear, MONTHLY_PL);
    Object.entries(priorYearsPL).forEach(([y, monthly]) => addYear(Number(y), monthly as MonthlyPLRow[]));
    return map;
  }, [plIsSample, MONTHLY_PL, priorYearsPL, anchorYear]);

  const sumMonths = useCallback((start: number, months: number): PlMonth => {
    const acc = { revenue: 0, expenses: 0, netProfit: 0 };
    for (let m = 0; m < months; m++) {
      const r = plMonthMap.get(addGran(start, 'month', m));
      if (r) { acc.revenue += r.revenue; acc.expenses += r.expenses; acc.netProfit += r.netProfit; }
    }
    return acc;
  }, [plMonthMap]);

  // Titik chart untuk jendela saat ini (+1 bucket di tiap sisi supaya garis menyentuh tepi).
  const timeline = useMemo(() => {
    const out: { t: number; label: string; revenue: number; expenses: number; netProfit: number }[] = [];
    if (intervalDef) {
      const end = intervalNext(intervalStart(timelineView.to, intervalDef), intervalDef, 1);
      let guard = 0;
      for (let tm = intervalNext(intervalStart(timelineView.from, intervalDef), intervalDef, -1); tm <= end && guard < 3000; tm = intervalNext(tm, intervalDef, 1), guard++) {
        out.push({ t: tm, label: intervalLabel(tm, intervalDef), ...sumMonths(tm, intervalDef.months) });
      }
      return out;
    }
    const months = timelineGran === 'month' ? 1 : 12;
    const end = addGran(startOf(timelineView.to, timelineGran), timelineGran, 1);
    for (let tm = addGran(startOf(timelineView.from, timelineGran), timelineGran, -1); tm <= end; tm = addGran(tm, timelineGran, 1)) {
      out.push({
        t: tm,
        label: timelineGran === 'month' ? fmtMonthYearLabel(tm) : String(new Date(tm).getUTCFullYear()),
        ...sumMonths(tm, months),
      });
    }
    return out;
  }, [timelineView.from, timelineView.to, timelineGran, intervalDef, sumMonths]);

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

  // ── Jendela waktu sumbu X (geser & zoom ala chart Tren Sales) ──
  // Satuan jendela = indeks bulan (pecahan). Default = seluruh data tepi ke tepi.
  // Mode Budget berupa kategori (bukan deret waktu), jadi hanya sumbu harga yang bisa digeser.
  const timeEnabled = viewMode !== 'Budget';
  const seriesLen = yoyData.length; // jendela berbasis indeks hanya dipakai mode Tahun Lalu
  const [win, setWin] = useState<{ from: number; to: number } | null>(null);
  const defaultWin = useMemo(
    () => (seriesLen <= 1 ? { from: -0.5, to: 0.5 } : { from: 0, to: seriesLen - 1 }),
    [seriesLen]
  );
  const view = isTimeline ? timelineView : timeEnabled && win ? win : defaultWin;
  const effType: OverviewChartType = viewMode === 'Actual' ? chartType : chartType === 'line' ? 'line' : 'area';
  const barType = viewMode === 'Actual' && (chartType === 'column' || chartType === 'candle' || chartType === 'ohlc');
  const [yShift, setYShift] = useState(0);

  // ── Zoom skala harga (drag vertikal di sumbu Y, kayak TradingView) ──
  // baseMax: batas atas alami dari data (dibulatkan ke atas + sedikit padding).
  // priceZoom: 1 = normal. >1 = zoom in (rentang harga makin sempit, makin rinci).
  //            <1 = zoom out (rentang makin lebar).
  // Skala dasar ala chart Tren Sales: dari sedikit di bawah 0 (ruang untuk nilai negatif / label "-")
  // sampai nilai tertinggi yang terlihat. Bisa di-zoom dengan menarik sumbu Y.
  const yBase = useMemo(() => {
    let hiData = 0;
    let loData = 0;
    const scan = (v: number) => { if (v > hiData) hiData = v; if (v < loData) loData = v; };
    // Skala mengikuti bulan yang sedang terlihat di jendela waktu (seperti chart Tren Sales).
    const inView = (i: number) => !timeEnabled || (i >= Math.floor(view.from) && i <= Math.ceil(view.to));
    if (viewMode === 'Previous Year') yoyData.forEach((d: any, i: number) => { if (inView(i)) { scan(d.thisYear); scan(d.lastYear); } });
    else if (viewMode === 'Budget') budgetComparisonData.forEach((d: any) => { scan(d.actualRaw); scan(d.budgetRaw); });
    else timeline.forEach((d) => { if (d.t >= timelineView.from && d.t <= timelineView.to) { scan(d.revenue); scan(d.expenses); scan(d.netProfit); } });
    // Jendela kosong (mis. digeser ke tahun tanpa data): pakai nilai bulanan tertinggi yang sudah dimuat.
    if (isTimeline && hiData <= 0 && loData >= 0) plMonthMap.forEach((v) => { scan(v.revenue); scan(v.expenses); scan(v.netProfit); });
    // Belum ada nilai sama sekali (semua 0): pakai skala awal Rp 100 Jt supaya sumbu harga
    // tidak jadi "Rp 2 / -Rp 2" dan tetap bisa di-zoom/digeser dengan wajar.
    if (hiData <= 0 && loData >= 0) hiData = 100_000_000;
    hiData = Math.max(1, hiData);
    const hi = hiData * 1.08;
    return { lo: loData < 0 ? loData * 1.08 : -niceStep(hi, 4), hi };
  }, [timeline, yoyData, budgetComparisonData, viewMode, timeEnabled, isTimeline, plMonthMap, view.from, view.to, timelineView.from, timelineView.to]);

  const [priceZoom, setPriceZoom] = useState(1);
  const dragRef = React.useRef<{ startY: number; startZoom: number } | null>(null);

  const yDomain = useMemo<[number, number]>(() => {
    const mid = (yBase.lo + yBase.hi) / 2 + yShift;
    const half = (yBase.hi - yBase.lo) / 2 / priceZoom;
    return [mid - half, mid + half];
  }, [yBase, priceZoom, yShift]);
  const yTicks = useMemo(() => niceTicksRange(yDomain[0], yDomain[1], 5), [yDomain]);

  // Lebar sumbu Y = label harga terlebar + jarak ke garis sumbu, diukur dengan canvas memakai font halaman
  // (diukur ulang setelah font selesai dimuat) -- sama seperti chart Tren Sales.
  const [axisWidth, setAxisWidth] = useState(72);
  useEffect(() => {
    const labels = yTicks.map((v) => formatMoney(v, currency));
    const measure = () => {
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      ctx.font = `10px ${salesFont.style.fontFamily}`;
      const widest = Math.max(0, ...labels.map((l) => ctx.measureText(l).width));
      const next = Math.ceil(widest) + SALES_AXIS_GAP;
      setAxisWidth((prev) => (prev === next ? prev : next));
    };
    measure();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) measure(); });
    return () => { alive = false; };
  }, [yTicks, currency]);
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const chartGeometry: CrosshairGeometry = {
    plotLeft: axisWidth,
    plotRightMargin: SALES_PLOT_RIGHT,
    plotTop: SALES_PLOT_TOP,
    plotBottom: SALES_CHART_HEIGHT - SALES_XAXIS_HEIGHT,
  };

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
  }, [springBackPoint]);

  // Reset drag kalau ganti periode/filter/tab (index bulan & kalibrasi piksel jadi tidak relevan lagi)
  useEffect(() => {
    stopPointSpring();
    dragPointRef.current = null;
    setDragPoint(null);
    dotsRef.current = { revenue: [], expenses: [], netProfit: [], thisYear: [], lastYear: [], actualRaw: [], budgetRaw: [] };
  }, [period, viewMode, stopPointSpring]);

  // Data yang benar-benar dikirim ke chart: sama seperti revenueData, kecuali
  // satu titik (bulan + garis) yang sedang ditarik/spring-back diganti nilai live-nya.
  // `idx` = posisi bulan (sumbu X numerik, supaya jendela waktu bisa digeser/di-zoom).
  const chartData = useMemo(
    () => timeline.map((d, i: number) => ({
      ...d,
      idx: i,
      ...(dragPoint && i === dragPoint.index ? { [dragPoint.key]: dragPoint.liveValue } : {}),
    })),
    [timeline, dragPoint]
  );
  // Titik kalibrasi drag dibuang saat deret titik berganti (sebelum chart dirender ulang).
  useMemo(() => { dotsRef.current = { revenue: [], expenses: [], netProfit: [], thisYear: [], lastYear: [], actualRaw: [], budgetRaw: [] }; }, [timeline]);

  const yoyChartData = useMemo(
    () => yoyData.map((d: any, i: number) => ({
      ...d,
      idx: i,
      ...(dragPoint && i === dragPoint.index ? { [dragPoint.key]: dragPoint.liveValue } : {}),
    })),
    [yoyData, dragPoint]
  );

  const budgetChartData = useMemo(() => {
    if (!dragPoint) return budgetComparisonData;
    return budgetComparisonData.map((d: any, i: number) =>
      i === dragPoint.index ? { ...d, [dragPoint.key]: dragPoint.liveValue } : d
    );
  }, [budgetComparisonData, dragPoint]);

  // Bar custom shape (tab Budget): seluruh badan bar bisa digenggam & ditarik
  // naik/turun (bukan cuma strip tipis di ujungnya) supaya terasa alami.
  const renderInteractiveBar = (key: 'actualRaw' | 'budgetRaw', fillColor: string, fillOpacity: number = 1) => {
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
    InteractiveBar.displayName = 'InteractiveBar';
    return InteractiveBar;
  };

  // Dot tak terlihat di SETIAP titik data: cuma untuk merekam posisi piksel
  // (cy) & nilai asli tiap titik ke dotsRef, dipakai buat kalibrasi drag.
  const renderCalibrationDot = (key: LineKey) => function CalibrationDot(props: any) {
    const { cx, cy, index, payload } = props;
    dotsRef.current[key][index] = { value: payload[key], cy };
    return <circle key={`cal-${key}-${index}`} cx={cx} cy={cy} r={0} fill="transparent" />;
  };

  const renderActiveDot = (key: LineKey, color: string) => function ActiveDot(props: any) {
    const { cx, cy, index, value } = props;
    if (cx == null || cy == null) return null;
    const isDraggingThis = dragPoint?.key === key && dragPoint?.index === index;
    return (
      <g key={`pt-${key}-${index}`}>
        <circle cx={cx} cy={cy} r={isDraggingThis ? 5 : 3} fill={color} stroke="#fff" strokeWidth={1.5} />
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

  // Double-klik sumbu harga: kembalikan skala harga. Tombol Reset: kembalikan semuanya.
  const resetZoom = () => { setPriceZoom(1); setYShift(0); };
  const resetAll = () => { setPriceZoom(1); setYShift(0); setWin(null); setTRange(null); setIntervalId(null); };

  // Ganti periode / mode / jumlah data -> kembali ke tampilan awal.
  useEffect(() => { setWin(null); setYShift(0); setPriceZoom(1); }, [viewMode, seriesLen]);
  useEffect(() => { setTRange(null); setYShift(0); setPriceZoom(1); }, [period, viewMode]);

  // Lebar chart (untuk menentukan berapa label bulan yang muat di sumbu X).
  const [wrapPx, setWrapPx] = useState(900);
  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const measure = () => setWrapPx((prev) => (Math.abs(prev - el.clientWidth) < 2 ? prev : el.clientWidth));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, isLoadingLastYear]);

  const xLabels = useMemo(() => yoyData.map((d: any) => String(d.month)), [yoyData]);
  const maxXTicks = Math.max(3, Math.floor((wrapPx - 90) / 70));
  const xTicks = useMemo<TickInfo[]>(
    () => (isTimeline
      ? buildTicks(timelineView.from, timelineView.to, timelineGran, { monthShort: (tm) => NAMA_BULAN[new Date(tm).getUTCMonth()] }, maxXTicks)
      : []),
    [isTimeline, timelineView.from, timelineView.to, timelineGran, maxXTicks]
  );
  const xTickInfo = useMemo(() => new Map(xTicks.map((k) => [k.t, k])), [xTicks]);
  const xTickValues = useMemo(() => {
    if (isTimeline) return xTicks.map((k) => k.t);
    const first = Math.max(0, Math.ceil(view.from - 1e-6));
    const last = Math.min(seriesLen - 1, Math.floor(view.to + 1e-6));
    const count = Math.max(0, last - first + 1);
    const maxTicks = Math.max(3, Math.floor((wrapPx - 90) / 60));
    const step = Math.max(1, Math.ceil(count / maxTicks));
    const out: number[] = [];
    for (let i = first; i <= last; i++) if (i % step === 0) out.push(i);
    return out;
  }, [isTimeline, xTicks, view.from, view.to, seriesLen, wrapPx]);

  // ── Zoom & geser sumbu waktu (ala TradingView, sama seperti chart Tren Sales) ──
  //  - Tarik di area label bulan: kanan = jendela melebar, kiri = menyempit (titik yang diklik tetap di tempatnya).
  //  - Tarik di grafik: geser periode kiri/kanan sekaligus skala harga naik/turun.
  //  - Klik dua kali di label bulan = kembali ke seluruh data.
  const [panning, setPanning] = useState(false);
  const viewRef = useRef(view);
  viewRef.current = view;
  const yShiftRef = useRef(0);
  yShiftRef.current = yShift;
  const timeBoundsRef = useRef(timeBounds);
  timeBoundsRef.current = timeBounds;

  const clampWin = (from: number, span: number, n: number) => {
    const minSpan = Math.min(2, Math.max(1, n - 1));
    const maxSpan = Math.max(n - 1, 1) * 2.5;
    const sp = Math.min(maxSpan, Math.max(minSpan, span));
    const lo = -sp * 0.5;
    const hi = (n - 1) + sp * 0.5;
    let f = from;
    if (f + sp > hi) f = hi - sp;
    if (f < lo) f = lo;
    return { from: f, to: f + sp };
  };

  const beginTimeDrag = (e: React.PointerEvent, mode: 'zoom' | 'pan') => {
    const el = chartWrapRef.current;
    if (!el) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const plotLeft = rect.left + axisWidth;
    const plotWidth = Math.max(60, rect.width - axisWidth - SALES_PLOT_RIGHT);
    const start = viewRef.current;
    const span = start.to - start.from;
    const startX = e.clientX;
    const startY = e.clientY;
    const startShift = yShiftRef.current;
    const [yLo, yHi] = yDomainRef.current;
    const plotH = Math.max(60, SALES_CHART_HEIGHT - SALES_XAXIS_HEIGHT - SALES_PLOT_TOP);
    const n = seriesLen;
    const canPanTime = timeEnabled;
    const tl = isTimeline;
    if (mode === 'pan') setPanning(true);
    const anchor = Math.min(1, Math.max(0, (startX - plotLeft) / plotWidth));
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (mode === 'zoom') {
        if (tl) setTRange(zoomRange(start, Math.exp(dx / SALES_TIME_ZOOM_PX), anchor, timeBoundsRef.current));
        else {
          const nextSpan = span * Math.exp(dx / SALES_TIME_ZOOM_PX);
          setWin(clampWin(start.from + anchor * span - anchor * nextSpan, nextSpan, n));
        }
      } else {
        if (canPanTime) {
          if (tl) setTRange(panRange(start, (-dx / plotWidth) * span, timeBoundsRef.current));
          else setWin(clampWin(start.from - (dx / plotWidth) * span, span, n));
        }
        // Tarik ke bawah = grafik turun (rentang nilai yang terlihat naik), seperti TradingView.
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
    if (x < axisWidth || y > rect.height - SALES_XAXIS_HEIGHT) return; // sumbu Y & sumbu X punya handler sendiri
    beginTimeDrag(e, 'pan');
  };

  const agingSegs = useMemo(
    () => agingData.map((a: any) => ({ name: t(a.name), value: a.value * 1e6, color: a.color })),
    [agingData, t]
  );
  const agingSubtitle = isAgingSample
    ? fx(t('Total AR: Rp 0 outstanding'))
    : fx(`Total AR: ${formatMoney(totalAgingJt * 1e6, currency)} outstanding`);

  // Sumbu & grid yang sama untuk ketiga mode chart (gaya chart Tren Sales).
  const axisProps = {
    xAxis: timeEnabled ? (
      <XAxis
        dataKey={isTimeline ? 't' : 'idx'}
        type="number"
        scale="linear"
        domain={[view.from, view.to]}
        allowDataOverflow
        ticks={xTickValues}
        interval={0}
        tick={(p: any) => (isTimeline ? <SalesXTick {...p} info={xTickInfo} /> : <SalesXTick {...p} labels={xLabels} />)}
        axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
        tickLine={false}
        height={SALES_XAXIS_HEIGHT}
      />
    ) : (
      <XAxis
        dataKey="name"
        tick={(p: any) => <SalesXTick {...p} />}
        axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
        tickLine={false}
        height={SALES_XAXIS_HEIGHT}
        minTickGap={12}
      />
    ),
    yAxis: (
      <YAxis
        tick={(p: any) => <SalesYTick {...p} label={fmt} />}
        axisLine={{ stroke: SALES_AXIS_BORDER, strokeWidth: 1.5 }}
        tickLine={false}
        width={axisWidth}
        ticks={yTicks}
        domain={yDomain}
        allowDataOverflow
      />
    ),
  };

  // Area/Line satu seri: seri pertama (utama) memakai gradien isi seperti chart Tren Sales.
  const renderSeries = (key: LineKey, name: string, color: string, opts: { fill?: boolean; dashed?: boolean } = {}) => (
    <Area
      key={key}
      type="monotone"
      dataKey={key}
      name={name}
      stroke={color}
      strokeWidth={2.5}
      strokeDasharray={opts.dashed ? '4 2' : undefined}
      baseValue={0}
      fill={effType === 'area' && opts.fill ? 'url(#gradOverviewMain)' : 'none'}
      dot={renderCalibrationDot(key) as any}
      activeDot={renderActiveDot(key, color) as any}
      isAnimationActive={!dragPoint && !win && !tRange}
    />
  );

  const gradientDefs = (
    <defs>
      <linearGradient id="gradOverviewMain" x1="0" y1="0" x2="0" y2="1">
        <stop offset="5%" stopColor={SALES_LINE_COLOR} stopOpacity={0.30} />
        <stop offset="95%" stopColor={SALES_LINE_COLOR} stopOpacity={0.02} />
      </linearGradient>
    </defs>
  );

  // Pembungkus chart: overlay drag sumbu Y (zoom skala harga) + crosshair, sama seperti chart Tren Sales.
  const chartShell = (
    chart: React.ReactElement,
    crosshair: { labels: string[]; band: boolean; rowsOf: (i: number) => CrosshairRow[]; extraOf?: (i: number) => string | null; times?: number[] },
    overlay?: React.ReactNode,
  ) => (
    <div
      ref={chartWrapRef}
      onPointerDown={handleChartPointerDown}
      className={`relative select-none ${panning ? 'cursor-grabbing' : 'cursor-crosshair'}`}
      style={{ touchAction: 'pan-y' }}
    >
      <ResponsiveContainer width="100%" height={SALES_CHART_HEIGHT}>
        {chart}
      </ResponsiveContainer>
      {overlay}
      {/* Overlay drag: tarik naik/turun di atas sumbu harga buat zoom in/out skala harga */}
      <div
        onMouseDown={handleAxisMouseDown}
        onDoubleClick={resetZoom}
        title={t('Tarik untuk zoom skala harga · klik dua kali untuk reset')}
        className="absolute top-0 left-0 h-full cursor-ns-resize"
        style={{ width: axisWidth }}
      />
      {/* Overlay drag di area label bulan: tarik kanan = zoom out, tarik kiri = zoom in */}
      {timeEnabled && (
        <div
          onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); beginTimeDrag(e, 'zoom'); }}
          onDoubleClick={() => setWin(null)}
          title={t('Tarik kanan/kiri untuk zoom periode · klik dua kali untuk reset')}
          className="absolute bottom-0 cursor-ew-resize"
          style={{ left: axisWidth, right: SALES_PLOT_RIGHT, height: SALES_XAXIS_HEIGHT, touchAction: 'none' }}
        />
      )}
      <SalesChartCrosshair
        wrapRef={chartWrapRef}
        geometry={chartGeometry}
        yMin={yDomain[0]}
        yMax={yDomain[1]}
        labels={crosshair.labels}
        band={crosshair.band}
        rowsOf={crosshair.rowsOf}
        extraOf={crosshair.extraOf}
        formatValue={fmt}
        view={timeEnabled ? view : undefined}
        times={crosshair.times}
      />
    </div>
  );

  const chartMargin = { top: SALES_PLOT_TOP, right: SALES_PLOT_RIGHT, left: 0, bottom: 0 };

  return (
    <div className={`${salesFont.className} grid grid-cols-1 lg:grid-cols-3 gap-4`}>
      {/* Revenue Chart / Budget Comparison / YoY Comparison — tergantung viewMode */}
      <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-900">
              {viewMode === 'Budget'
                ? t('Aktual vs Anggaran')
                : viewMode === 'Previous Year'
                ? t('Pendapatan: Tahun Ini vs Tahun Lalu')
                : t('Revenue vs Expenses vs Net Profit')}
            </h2>
            <p className="mt-0.5 text-xs text-neutral-500">
              {viewMode === 'Budget'
                ? `${companyName} · ${t('YTD')} (${elapsedMonths} ${t('bulan')})`
                : viewMode === 'Previous Year'
                ? `${companyName} · ${yoyData[0]?.month || ''}${yoyData.length > 1 ? ` – ${yoyData[yoyData.length - 1].month}` : ''}`
                : `${companyName} · ${fmtMonthYearLabel(timelineView.from)} – ${fmtMonthYearLabel(timelineView.to)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {viewMode === 'Actual' && (
              <FilterSelect
                neutral
                title="Timeframe"
                searchable={false}
                value={period}
                onChange={(v) => setPeriod(v as typeof period)}
                options={PERIOD_OPTIONS}
              />
            )}
            {viewMode === 'Actual' && (
              <FilterSelect
                neutral
                title="Interval"
                searchable={false}
                value={intervalId ?? 'auto'}
                onChange={(v) => { setIntervalId(v === 'auto' ? null : (v as IntervalId)); setTRange(null); setPriceZoom(1); setYShift(0); }}
                options={INTERVAL_OPTIONS}
              />
            )}
            {viewMode !== 'Budget' && (
              <FilterSelect
                neutral
                title="Bentuk grafik"
                searchable={false}
                value={effType}
                onChange={(v) => setChartType(v as OverviewChartType)}
                options={viewMode === 'Actual' ? CHART_TYPE_OPTIONS : CHART_TYPE_OPTIONS_BASIC}
              />
            )}
            {(priceZoom !== 1 || yShift !== 0 || win !== null || tRange !== null || intervalId !== null) && (
              <button
                type="button"
                onClick={resetAll}
                className="text-xs border border-neutral-300 rounded-lg px-2 py-1 bg-card text-neutral-900 hover:bg-neutral-100"
              >
                {t('Reset')}
              </button>
            )}
          </div>
        </div>

        {isTimeline && (loadingMore || yearsTruncated) && (
          <p className="mb-2 text-[11px] text-neutral-500">
            {loadingMore ? t('Memuat data tahun lain...') : t('Zoom in untuk memuat tahun yang lebih lama')}
          </p>
        )}

        {viewMode === 'Budget' && (
          <>
            {chartShell(
              <BarChart data={budgetChartData} margin={chartMargin}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                {axisProps.xAxis}
                {axisProps.yAxis}
                <ReferenceLine y={0} stroke={SALES_AXIS_BORDER} strokeOpacity={0.35} />
                <Tooltip content={() => null} cursor={false} />
                <Bar
                  dataKey="actualRaw"
                  name={t('Actual')}
                  fill={SALES_LINE_COLOR}
                  shape={renderInteractiveBar('actualRaw', SALES_LINE_COLOR) as any}
                  isAnimationActive={!dragPoint}
                />
                <Bar
                  dataKey="budgetRaw"
                  name={t('Budget')}
                  fill={C_MUTED}
                  shape={renderInteractiveBar('budgetRaw', C_MUTED) as any}
                  isAnimationActive={!dragPoint}
                />
              </BarChart>,
              {
                labels: budgetChartData.map((d: any) => d.name),
                band: true,
                rowsOf: (i) => [
                  { name: t('Actual'), color: SALES_LINE_COLOR, value: (budgetChartData[i] as any)?.actualRaw ?? 0 },
                  { name: t('Budget'), color: '#737373', value: (budgetChartData[i] as any)?.budgetRaw ?? 0 },
                ],
                extraOf: (i) => {
                  const d: any = budgetChartData[i];
                  if (!d || !d.budgetRaw) return null;
                  const v = ((d.actualRaw - d.budgetRaw) / d.budgetRaw) * 100;
                  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}% ${t('vs anggaran')}`;
                },
              }
            )}
            <SalesChartLegend items={[
              { name: t('Actual'), color: SALES_LINE_COLOR },
              { name: t('Budget'), color: C_MUTED },
            ]} />
          </>
        )}

        {viewMode === 'Previous Year' && isLoadingLastYear && (
          <div className="flex h-[220px] items-center justify-center text-xs text-neutral-500">
            {t('Memuat data tahun lalu...')}
          </div>
        )}

        {viewMode === 'Previous Year' && !isLoadingLastYear && (
          <>
            {chartShell(
              <AreaChart data={yoyChartData} margin={chartMargin}>
                {gradientDefs}
                <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                {axisProps.xAxis}
                {axisProps.yAxis}
                <ReferenceLine y={0} stroke={SALES_AXIS_BORDER} strokeOpacity={0.35} />
                <Tooltip content={() => null} cursor={false} />
                {renderSeries('thisYear', t('Tahun Ini'), SALES_LINE_COLOR, { fill: true })}
                {renderSeries('lastYear', t('Tahun Lalu'), C_MUTED, { dashed: true })}
              </AreaChart>,
              {
                labels: yoyChartData.map((d: any) => d.month),
                band: false,
                rowsOf: (i) => [
                  { name: t('Tahun Ini'), color: SALES_LINE_COLOR, value: (yoyChartData[i] as any)?.thisYear ?? 0 },
                  { name: t('Tahun Lalu'), color: '#737373', value: (yoyChartData[i] as any)?.lastYear ?? 0 },
                ],
              }
            )}
            <SalesChartLegend items={[
              { name: t('Tahun Ini'), color: SALES_LINE_COLOR },
              { name: t('Tahun Lalu'), color: C_MUTED, dashed: true },
            ]} />
          </>
        )}

        {viewMode === 'Actual' && (
          <>
            {chartShell(
              <AreaChart data={chartData} margin={chartMargin}>
                {gradientDefs}
                <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                {axisProps.xAxis}
                {axisProps.yAxis}
                <ReferenceLine y={0} stroke={SALES_AXIS_BORDER} strokeOpacity={0.35} />
                <Tooltip content={() => null} cursor={false} />
                {!barType && renderSeries('revenue', t('Revenue'), SALES_LINE_COLOR, { fill: true })}
                {renderSeries('expenses', t('Expenses'), C_EXPENSES)}
                {renderSeries('netProfit', t('Net Profit'), C_NET, { dashed: true })}
              </AreaChart>,
              {
                labels: chartData.map((d) => d.label),
                times: chartData.map((d) => d.t),
                band: barType,
                rowsOf: (i) => [
                  { name: t('Revenue'), color: SALES_LINE_COLOR, value: chartData[i]?.revenue ?? 0 },
                  { name: t('Expenses'), color: C_EXPENSES, value: chartData[i]?.expenses ?? 0 },
                  { name: t('Net Profit'), color: C_NET, value: chartData[i]?.netProfit ?? 0 },
                ],
                extraOf: chartType === 'candle' || chartType === 'ohlc'
                  ? (i) => (i > 0 && chartData[i] ? `Open ${fmt(chartData[i - 1].revenue)} → Close ${fmt(chartData[i].revenue)}` : null)
                  : undefined,
              },
              // Column / Candle / OHLC menggambar Revenue (layer yang sama dengan chart Tren Sales);
              // Expenses & Net Profit tetap berupa garis.
              barType ? (
                <SalesCandleLayer
                  wrapRef={chartWrapRef}
                  geometry={chartGeometry}
                  view={view}
                  yMin={yDomain[0]}
                  yMax={yDomain[1]}
                  points={chartData.map((d) => ({ t: d.t, total: d.revenue, count: 0, label: d.label }))}
                  nextOf={(tm: number) => (intervalDef ? intervalNext(tm, intervalDef, 1) : addGran(tm, timelineGran, 1))}
                  type={chartType as 'column' | 'candle' | 'ohlc'}
                />
              ) : null
            )}
            <SalesChartLegend items={[
              { name: t('Revenue'), color: SALES_LINE_COLOR },
              { name: t('Expenses'), color: C_EXPENSES },
              { name: t('Net Profit'), color: C_NET, dashed: true },
            ]} />
          </>
        )}
      </div>

      {/* AR Aging Donut — desain disalin dari donut Purchase Status */}
      <ArAgingDonutCard data={agingSegs} subtitle={agingSubtitle} />
    </div>
  );
}