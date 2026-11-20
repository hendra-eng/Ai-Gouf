'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowLeftRight, BarChart3, CalendarDays, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ExternalLink, FileText, Wallet } from 'lucide-react';
import { CheckBanner } from '../CheckBanner';
import { ErrorBlock, LoadingBlock } from '../FsShell';
import { fmtAmount, glHref, todayIso } from '../fsFormat';
import { fmtCompact, iso, monthEnd, pctChange } from '../bs/bsData';
import { BsDropdown, BsToolbar, Delta, KpiCard, KpiRow, Panel, Segmented, inputCls, thCls, thRowCls, trCls } from '../bs/BsMono';
import { MAX_COLUMNS, cfReport, fmtRange, mergeSeries, splitRange, useCfSeries, type CfMerged, type CfRow, type Granularity, type Method, type Tone } from './cfData';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import { fetchCashFlowSeries } from '@/lib/fsStore';

// Cash Flow Statement -- satu layout untuk metode langsung & tidak langsung:
// filter periode (bulanan / kuartalan / tahunan + rentang), 4 KPI vs periode
// sebelumnya, grafik trend (kolom + garis), komposisi, dan tabel per kolom
// periode + total (+ pembanding opsional / % of revenue).

export interface CfViewProps {
  clientId: string;
  method: Method;
  onMethod: (m: Method) => void;
  printedBy?: string;
}

const GRANS: { id: Granularity; label: string }[] = [
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'annual', label: 'Annual' },
];

type ChartType = 'column_line' | 'line';
type CmpBasis = 'previous_period' | 'last_year';

// Tema "elegant hitam putih" disamakan dengan Balance Sheet (BsMono): kartu & tabel
// netral, tanpa warna per-aktivitas -- seri grafik dibedakan lewat tingkat abu-abu.
const CF_MONO = { operating: '#2563EB', investing: '#F59E0B', financing: '#DC2626', net: '#16A34A' };
const dateCls = inputCls;
const NEG = 'text-red-700';
const LABEL = 'mb-1 text-[11px] font-medium text-neutral-500';
const NOTICE = 'flex items-start gap-2 rounded-[10px] border border-neutral-300 bg-neutral-50 px-4 py-3 text-xs font-medium text-neutral-800';
const GRAN_OPTS = GRANS.map(g => [g.id, g.label] as const);
const METHOD_OPTS = [['direct', 'Direct Method'], ['indirect', 'Indirect Method']] as const;

export default function CashFlowView({ clientId, method, onMethod, printedBy }: CfViewProps) {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const today = todayIso();
  const y = Number(today.slice(0, 4));
  const [gran, setGran] = useState<Granularity>('monthly');
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(`${y}-12-31`);
  const columns = useMemo(() => (from && to && from <= to ? splitRange(from, to, gran) : []), [from, to, gran]);
  const tooMany = columns.length > MAX_COLUMNS;
  const valid = columns.length > 0 && !tooMany;
  const { merged: m, loading, error } = useCfSeries(clientId, columns, from, to, valid);
  const company = m?.data.client.company_name ?? '';
  const totalLabel = gran === 'annual' && columns.length === 1 ? `Total ${columns[0].label}` : from.slice(0, 4) === to.slice(0, 4) && from.endsWith('-01-01') && to.endsWith('-12-31') ? `Total ${from.slice(0, 4)}` : 'Total';

  const [showCmp, setShowCmp] = useState(false);
  const [cmpBasis, setCmpBasis] = useState<CmpBasis>('previous_period');

  return (
    <div className="space-y-5">
      <BsToolbar
        filters={
          <>
            <div>
              <p className={LABEL}>Period View</p>
              <Segmented value={gran} options={GRAN_OPTS} onChange={setGran} />
            </div>
            <div>
              <p className={LABEL}>Period Range</p>
              <div className="flex items-center gap-2">
                <input type="date" value={from} max="9999-12-31" onChange={e => e.target.value && setFrom(e.target.value)} className={`${dateCls} w-40`} aria-label="From" />
                <span className="text-xs font-medium text-neutral-500">to</span>
                <input type="date" value={to} max="9999-12-31" onChange={e => e.target.value && setTo(e.target.value)} className={`${dateCls} w-40`} aria-label="To" />
              </div>
            </div>
            <div>
              <p className={LABEL}>Method</p>
              <Segmented value={method} options={METHOD_OPTS} onChange={onMethod} />
            </div>
            {valid && (
              <div className="flex items-center gap-3 rounded-[10px] border border-neutral-300 bg-neutral-50 px-3.5 py-2">
                <CalendarDays size={22} className="text-neutral-700 shrink-0" />
                <div>
                  <p className="text-[11px] font-medium text-neutral-500">Selected Period</p>
                  <p className="text-sm font-semibold text-neutral-900 whitespace-nowrap">{fmtRange(from, to)}</p>
                  <p className="text-[11px] font-medium text-neutral-500">{GRANS.find(g => g.id === gran)!.label} view ({columns.length} {gran === 'monthly' ? 'months' : gran === 'quarterly' ? 'quarters' : 'years'}) · {method === 'direct' ? 'Direct' : 'Indirect'} method</p>
                </div>
              </div>
            )}
          </>
        }
        loading={loading}
        exportReady={!!m && valid}
        buildExport={() => {
          const cmp = showCmp ? { label: cmpBasis === 'previous_period' ? 'Previous Period' : 'Same Period Last Year', index: cmpBasis === 'previous_period' ? m!.PREV : m!.LY } : null;
          return cfReport(m!, method, columns.map(c => c.label), totalLabel, {
            companyName: company, subtitle: `For the period ${fmtRange(from, to)}`, fileBase: `Cash-Flow-${method}-${from}_${to}`, printedBy, compare: cmp,
          });
        }}
      />

      {from > to && <ErrorBlock message="The start date must be on or before the end date." />}
      {tooMany && <ErrorBlock message={`The range has more than ${MAX_COLUMNS} ${gran === 'monthly' ? 'months' : 'periods'}. Shorten the range or use a quarterly / annual view.`} />}
      {error && <ErrorBlock message={error} />}
      {loading && !m && valid && <LoadingBlock />}
      {m && valid && (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <Body clientId={clientId} m={m} method={method} labels={columns.map(c => c.label)} totalLabel={totalLabel} range={{ start: from, end: to }}
            showCmp={showCmp} setShowCmp={setShowCmp} cmpBasis={cmpBasis} setCmpBasis={setCmpBasis} />
        </div>
      )}
    </div>
  );
}

// ── Isi ──────────────────────────────────────────────────────────────

function Body({ clientId, m, method, labels, totalLabel, range, showCmp, setShowCmp, cmpBasis, setCmpBasis }: {
  clientId: string; m: CfMerged; method: Method; labels: string[]; totalLabel: string; range: { start: string; end: string };
  showCmp: boolean; setShowCmp: (v: boolean) => void; cmpBasis: CmpBasis; setCmpBasis: (v: CmpBasis) => void;
}) {
  const T = m.TOTAL, P = m.PREV;
  const op = m.operating[method];
  const ind = m.data.periods.find(p => p.period.start === range.start && p.period.end === range.end)?.indirect;
  const unmappedMoving = m.data.unmapped_accounts.filter(a => a.has_movement);
  const trendYear = Number(range.start.slice(0, 4));
  const trendLast = Math.max(new Date().getFullYear(), Number(range.end.slice(0, 4)), trendYear);

  return (
    <>
      <KpiRow>
        <CfKpi label="Operating Cash Flow" icon={FileText} v={op[T]} prev={op[P]} />
        <CfKpi label="Investing Cash Flow" icon={BarChart3} v={m.investing[T]} prev={m.investing[P]} />
        <CfKpi label="Financing Cash Flow" icon={ArrowLeftRight} v={m.financing[T]} prev={m.financing[P]} />
        <CfKpi label="Net Cash Change" icon={Wallet} v={m.net[T]} prev={m.net[P]} />
      </KpiRow>

      {ind && (
        <CheckBanner
          mono
          ok={ind.check.reconciled}
          okText={`Reconciled — net change ${fmtAmount(ind.net_change)} agrees with the movement of cash accounts in the Balance Sheet (closing cash ${fmtAmount(ind.balance_sheet_ending_cash)}).`}
          failText={`Not reconciled — difference ${fmtAmount(ind.check.difference)}. Caused by journals whose debit ≠ credit.`}
          journals={ind.check.unbalanced_journals}
        />
      )}
      {m.data.cash_accounts.length === 0 && (
        <div className={NOTICE}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-neutral-700" />
          <span>No account is mapped as <span className="font-semibold">Cash &amp; cash equivalents</span>, so every cash flow is zero. Set the cash flow category of the cash / bank accounts in <Link href="/financial-statements/mapping" className="underline font-semibold">Statement Mapping</Link>.</span>
        </div>
      )}
      {unmappedMoving.length > 0 && (
        <div className={NOTICE}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-neutral-700" />
          <span>
            {unmappedMoving.length} balance sheet account{unmappedMoving.length > 1 ? 's have' : ' has'} movement but no cash flow mapping (shown under Operating in the indirect method):{' '}
            {unmappedMoving.slice(0, 6).map(a => `${kodeAkun(a.code)} ${a.name}`).join(' · ')}{unmappedMoving.length > 6 ? ' …' : ''}.{' '}
            <Link href="/financial-statements/mapping" className="underline font-semibold">Map them</Link>
          </span>
        </div>
      )}

      {method === 'indirect' ? (
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] gap-5 items-stretch">
          <TrendChart clientId={clientId} method={method} defaultYear={trendYear} lastYear={trendLast} />
          <Composition m={m} method={method} />
        </div>
      ) : (
        <TrendChart clientId={clientId} method={method} defaultYear={trendYear} lastYear={trendLast} withType />
      )}

      <CfTable m={m} method={method} labels={labels} totalLabel={totalLabel} range={range}
        showCmp={showCmp} setShowCmp={setShowCmp} cmpBasis={cmpBasis} setCmpBasis={setCmpBasis} />
    </>
  );
}

function CfKpi({ label, icon, v, prev }: { label: string; icon: React.ElementType; v: number; prev: number }) {
  const pos = v >= 0;
  return (
    <KpiCard
      label={label}
      icon={icon}
      value={<span className={pos ? '' : NEG}>{pos ? '' : '('}Rp {fmtAmount(Math.abs(v))}{pos ? '' : ')'}</span>}
      delta={<Delta pct={pctChange(v, prev)} suffix="vs. previous period" />}
    />
  );
}

// ── Cash Flow Trend: jendela 12 bulan yang bisa digeser ke belakang sampai Jan 2000 ──
// Skala sumbu X selalu per bulan (Jan, Feb, ...). Tarik grafik ke kanan = mundur ke
// bulan/tahun sebelumnya, tarik ke kiri = maju. Data tiap tahun diambil bila dibutuhkan.
const CF_FIRST_YEAR = 2000;
const CF_WINDOW = 11; // Jan..Des = 11 langkah bulan
const CF_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const cfMonthLabel = (i: number) => `${CF_MON[((i % 12) + 12) % 12]} ${CF_FIRST_YEAR + Math.floor(i / 12)}`;
const CF_AXIS_LINE = { stroke: '#404040', strokeWidth: 1.5 };
const CF_MARGIN_LEFT = 4;
const CF_PLOT_RIGHT = 14;      // margin kanan

// Langkah tick "bulat" untuk skala harga (sama seperti chart Purchase).
function cfNiceStep(span: number, target = 5): number {
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
function cfNiceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [0];
  const step = cfNiceStep(span, target);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k++) out.push(k * step || 0);
  return out;
}
const CF_XAXIS_H = 44;
const CF_PLOT_H = 288 - CF_XAXIS_H - 8; // tinggi chart (h-72) - sumbu X - margin atas

interface CfYearData { opDirect: number[]; opIndirect: number[]; investing: number[]; financing: number[]; net: number[] }

function useCfYearCache(clientId: string) {
  const cacheRef = useRef<Record<number, CfYearData>>({});
  const inflight = useRef(new Set<number>());
  const [cache, setCache] = useState<Record<number, CfYearData>>({});
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback((years: number[]): Promise<void> => {
    const todo = years.filter(y => !cacheRef.current[y] && !inflight.current.has(y));
    if (!clientId || todo.length === 0) return Promise.resolve();
    todo.forEach(y => inflight.current.add(y));
    setPending(n => n + todo.length);
    return Promise.all(todo.map(async y => {
      const periods = Array.from({ length: 12 }, (_, i) => ({ start: iso(y, i + 1, 1), end: monthEnd(y, i + 1) }));
      try {
        const data = await fetchCashFlowSeries(clientId, periods);
        const mm = mergeSeries(data, periods, 12);
        cacheRef.current = { ...cacheRef.current, [y]: { opDirect: mm.operating.direct, opIndirect: mm.operating.indirect, investing: mm.investing, financing: mm.financing, net: mm.net } };
        setCache(cacheRef.current);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        inflight.current.delete(y);
        setPending(n => n - 1);
      }
    })).then(() => undefined);
  }, [clientId]);
  return { cache, load, loading: pending > 0, error };
}

// Rupiah nominal penuh; negatif ditulis dengan tanda minus (-Rp100.000.000).
const cfRp = (v: number) => {
  const full = Math.round(v);
  const t = `Rp${Math.abs(full).toLocaleString('id-ID')}`;
  return full < 0 ? `-${t}` : t;
};

// Ringkasan ramping di header chart (sebelah kiri pilihan Chart Type): bulan terdekat dari kursor +
// tiga arus kas + Net. Posisinya absolut di header, jadi tidak menutupi chart dan tidak menggeser layout.
type CfPoint = { x: number; Operating: number; Investing: number; Financing: number; Net: number };
function CfHoverStrip({ row, top, right }: { row: CfPoint | null; top: number; right: number }) {
  if (!row) return null;
  const items = [
    { name: 'Operating', v: row.Operating, color: CF_MONO.operating },
    { name: 'Investing', v: row.Investing, color: CF_MONO.investing },
    { name: 'Financing', v: row.Financing, color: CF_MONO.financing },
  ];
  return (
    <div className="pointer-events-none absolute z-10 flex h-5 items-center justify-end gap-x-4 overflow-hidden whitespace-nowrap text-[11px]"
      style={{ top, right, left: 150, transform: 'translateY(-50%)' }}>
      <span className="font-semibold uppercase tracking-[0.08em] text-neutral-500">{cfMonthLabel(row.x)}</span>
      {items.map(i => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="h-3 w-[3px] rounded-full" style={{ background: i.color }} />
          <span className="text-neutral-500">{i.name}</span>
          <span className={`tabular-nums font-medium ${i.v < 0 ? NEG : 'text-neutral-900'}`}>{cfRp(i.v)}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 border-l border-neutral-200 pl-4">
        <span className="h-3 w-[3px] rounded-full" style={{ background: CF_MONO.net }} />
        <span className="font-semibold text-neutral-900">Net</span>
        <span className={`tabular-nums font-semibold ${row.Net < 0 ? NEG : 'text-neutral-900'}`}>{cfRp(row.Net)}</span>
      </span>
    </div>
  );
}

// Crosshair ala chart Purchase: garis putus-putus horizontal + vertikal di kursor, label harga
// menempel di sumbu Y dan label bulan di sumbu X. Garis vertikal menempel ke bulan terdekat.
const CF_CHIP = 'absolute whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white shadow-sm';
function CfCrosshair({ wrapRef, plotLeft, plotTop, winFrom, yMin, yMax, maxIdx, data, onHover }: {
  wrapRef: React.RefObject<HTMLDivElement | null>; plotLeft: number; plotTop: number; winFrom: number; yMin: number; yMax: number; maxIdx: number; data: CfPoint[]; onHover: (row: CfPoint | null) => void;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') { setPos(null); return; }
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const inside = x >= plotLeft && x <= r.width - CF_PLOT_RIGHT && y >= plotTop && y <= r.height - CF_XAXIS_H;
      setPos(inside ? { x, y, w: r.width, h: r.height } : null);
    };
    const onLeave = () => setPos(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
  }, [wrapRef, plotLeft, plotTop]);
  // Bulan terdekat dari kursor -> dikirim ke header (hanya berubah saat pindah bulan).
  const hoverRow = pos
    ? data.find(d => d.x === Math.min(maxIdx, Math.max(0, Math.round(winFrom + ((pos.x - plotLeft) / Math.max(1, pos.w - CF_PLOT_RIGHT - plotLeft)) * CF_WINDOW))))
    : undefined;
  useEffect(() => { onHover(hoverRow ?? null); }, [hoverRow, onHover]);
  useEffect(() => () => onHover(null), [onHover]);
  if (!pos) return null;
  const plotRight = pos.w - CF_PLOT_RIGHT;
  const plotBottom = pos.h - CF_XAXIS_H;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);
  // Garis mengikuti kursor persis; tanggal dihitung dengan interpolasi di dalam bulan
  // (tengah antara tick Jun dan Jul = pertengahan Juni).
  const t = Math.min(maxIdx, Math.max(0, winFrom + ((pos.x - plotLeft) / plotW) * CF_WINDOW));
  const mi = Math.floor(t);
  const yr = CF_FIRST_YEAR + Math.floor(mi / 12);
  const mo = mi % 12;
  const dim = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
  const day = Math.min(dim, 1 + Math.floor((t - mi) * dim));
  const dateText = `${day} ${CF_MON[mo]} ${yr}`;
  const xPx = pos.x;
  const price = yMin + ((plotBottom - pos.y) / plotH) * (yMax - yMin);
  const dateCenter = Math.min(plotRight - 52, Math.max(plotLeft + 52, xPx));
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <line x1={xPx} y1={plotTop} x2={xPx} y2={plotBottom} stroke="#A3A3A3" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={plotLeft} y1={pos.y} x2={plotRight} y2={pos.y} stroke="#A3A3A3" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
      <div className={CF_CHIP} style={{ background: '#262626', right: pos.w - plotLeft + 4, top: pos.y - 10 }}>{cfRp(price)}</div>
      <div className={CF_CHIP} style={{ background: '#262626', left: dateCenter, top: plotBottom + 4, transform: 'translateX(-50%)' }}>{dateText}</div>
    </div>
  );
}

// Label sumbu X: bulan di baris atas, tahun (tebal) di baris bawah Januari / label pertama.
function CfXTick({ x, y, payload, info }: { x?: number; y?: number; payload?: { value: number }; info: Map<number, { label: string; sub?: string }> }) {
  const t = payload ? info.get(payload.value) : undefined;
  if (!t || x == null || y == null) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="#525252">{t.label}</text>
      {t.sub && <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">{t.sub}</text>}
    </g>
  );
}

function TrendChart({ clientId, method, defaultYear, lastYear, withType }: { clientId: string; method: Method; defaultYear: number; lastYear: number; withType?: boolean }) {
  const [type, setType] = useState<ChartType>('column_line');
  const [hover, setHover] = useState<CfPoint | null>(null);
  const div = 1; // grafik memakai nominal Rupiah penuh
  const maxIdx = (lastYear - CF_FIRST_YEAR) * 12 + 11;
  const maxFrom = maxIdx - CF_WINDOW;
  const defFrom = Math.min(maxFrom, Math.max(0, (defaultYear - CF_FIRST_YEAR) * 12));
  const [winFrom, setWinFrom] = useState(defFrom);
  useEffect(() => { setWinFrom(defFrom); }, [defFrom]);
  const fromRef = useRef(winFrom);
  fromRef.current = winFrom;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const { cache, load, loading, error } = useCfYearCache(clientId);
  // Zoom skala harga: tarik sumbu Y naik/turun (naik = zoom in). Tarik grafik juga menggeser skala.
  const [yZoom, setYZoom] = useState(1);
  const [yShift, setYShift] = useState(0);
  const yShiftRef = useRef(0);
  yShiftRef.current = yShift;
  useEffect(() => { setYZoom(1); setYShift(0); }, [method]);

  // Ambil data tahun yang terlihat dulu, lalu tahun di sekitarnya supaya geser tetap mulus.
  const iFrom = Math.floor(winFrom);
  const iTo = Math.ceil(winFrom + CF_WINDOW);
  useEffect(() => {
    const yrs = (a: number, b: number) => {
      const set = new Set<number>();
      for (let i = Math.max(0, a); i <= Math.min(maxIdx, b); i++) set.add(CF_FIRST_YEAR + Math.floor(i / 12));
      return Array.from(set);
    };
    const t = setTimeout(() => { load(yrs(iFrom, iTo)).then(() => load(yrs(iFrom - 6, iTo + 3))); }, 120);
    return () => clearTimeout(t);
  }, [iFrom, iTo, load, maxIdx]);

  const data = useMemo(() => {
    const out: { x: number; Operating: number; Investing: number; Financing: number; Net: number }[] = [];
    for (let i = Math.max(0, iFrom - 1); i <= Math.min(maxIdx, iTo + 1); i++) {
      const c = cache[CF_FIRST_YEAR + Math.floor(i / 12)];
      if (!c) continue;
      const mo = i % 12;
      out.push({ x: i, Operating: (method === 'direct' ? c.opDirect : c.opIndirect)[mo] / div, Investing: c.investing[mo] / div, Financing: c.financing[mo] / div, Net: c.net[mo] / div });
    }
    return out;
  }, [cache, iFrom, iTo, maxIdx, method, div]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = Math.ceil(winFrom); i <= Math.floor(winFrom + CF_WINDOW + 1e-9); i++) out.push(i);
    return out;
  }, [winFrom]);
  const tickInfo = useMemo(() => new Map(ticks.map((i, k) => [i, { label: CF_MON[i % 12], sub: i % 12 === 0 || k === 0 ? String(CF_FIRST_YEAR + Math.floor(i / 12)) : undefined }])), [ticks]);

  const yBase = useMemo(() => {
    let hi = 0, lo = 0;
    data.forEach(d => {
      if (d.x < winFrom || d.x > winFrom + CF_WINDOW) return;
      [d.Operating, d.Investing, d.Financing, d.Net].forEach(v => { if (v > hi) hi = v; if (v < lo) lo = v; });
    });
    if (hi <= 0 && lo >= 0) hi = 1;
    hi *= 1.08;
    return { lo: lo < 0 ? lo * 1.08 : -cfNiceStep(hi, 4), hi };
  }, [data, winFrom]);
  const yDomain = useMemo<[number, number]>(() => {
    const mid = (yBase.lo + yBase.hi) / 2 + yShift;
    const half = (yBase.hi - yBase.lo) / 2 / yZoom;
    return [mid - half, mid + half];
  }, [yBase, yZoom, yShift]);
  const yTicks = useMemo(() => cfNiceTicks(yDomain[0], yDomain[1], 5), [yDomain]);
  // Label sumbu harga selalu nominal penuh (mis. Rp10.000.000.000), negatif dalam kurung.
  const fmtAxisFull = (v: number) => cfRp(v * div);
  const yAxisW = Math.max(48, Math.ceil(Math.max(...yTicks.map(t => fmtAxisFull(t).length)) * 6.6) + 12);
  const plotLeft = yAxisW + CF_MARGIN_LEFT;
  const yDomainRef = useRef(yDomain);
  yDomainRef.current = yDomain;
  const resetY = () => { setYZoom(1); setYShift(0); };

  const onAxisPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startZoom = yZoom;
    const onMove = (ev: PointerEvent) => setYZoom(Math.min(6, Math.max(0.25, startZoom * Math.exp((startY - ev.clientY) / 150))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // withY = true: tarik di area grafik (ikut menggeser skala harga); false: tarik di label bulan (geser bulan saja).
  const startPan = (e: React.PointerEvent, withY: boolean) => {
    if (e.button !== 0) return;
    const el = wrapRef.current;
    if (!el) return;
    e.preventDefault();
    const plotW = Math.max(120, el.getBoundingClientRect().width - plotLeft - CF_PLOT_RIGHT);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = fromRef.current;
    const startShift = yShiftRef.current;
    const [yLo, yHi] = yDomainRef.current;
    setPanning(true);
    const onMove = (ev: PointerEvent) => {
      setWinFrom(Math.min(maxFrom, Math.max(0, start - ((ev.clientX - startX) / plotW) * CF_WINDOW)));
      if (withY) setYShift(startShift + ((ev.clientY - startY) / CF_PLOT_H) * (yHi - yLo));
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

  const series = [
    { key: 'Operating', name: 'Operating Cash Flow', color: CF_MONO.operating },
    { key: 'Investing', name: 'Investing Cash Flow', color: CF_MONO.investing },
    { key: 'Financing', name: 'Financing Cash Flow', color: CF_MONO.financing },
  ];
  return (
    <Panel title="Cash Flow Trend" className="relative min-w-0"
      right={
        <>
          {withType && (
            <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">Chart Type
              <BsDropdown value={type} onChange={v => setType(v as ChartType)} align="right"
                options={[{ value: 'column_line', label: 'Column & Line' }, { value: 'line', label: 'Line' }]} />
            </label>
          )}
        </>
      }>
      <CfHoverStrip row={hover} top={withType ? 32 : 26} right={withType ? 232 : 20} />
      <div
        ref={wrapRef}
        onPointerDown={e => startPan(e, true)}
        onDoubleClick={() => { setWinFrom(defFrom); resetY(); }}
        title="Tarik kanan/kiri untuk geser bulan · klik dua kali untuk reset"
        className={`relative h-72 select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ touchAction: 'pan-y' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: CF_PLOT_RIGHT, left: CF_MARGIN_LEFT, bottom: 0 }}>
            <CartesianGrid stroke="#E5E5E5" vertical={false} />
            <XAxis dataKey="x" type="number" scale="linear" domain={[winFrom, winFrom + CF_WINDOW]} allowDataOverflow ticks={ticks} interval={0}
              tick={(p: any) => <CfXTick {...p} info={tickInfo} />} tickLine={false} axisLine={CF_AXIS_LINE} height={CF_XAXIS_H} />
            <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={CF_AXIS_LINE} width={yAxisW} tickFormatter={fmtAxisFull}
              domain={yDomain} ticks={yTicks} allowDataOverflow />
            <ReferenceLine y={0} stroke="#A3A3A3" />
            {series.map(s => type === 'column_line'
              ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} barSize={10} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              : <Line key={s.key} type="natural" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={1.25} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={false} isAnimationActive={false} />)}
            <Line type="natural" dataKey="Net" name="Net Cash Change" stroke={CF_MONO.net} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
        <div
          onPointerDown={e => { e.stopPropagation(); startPan(e, false); }}
          onDoubleClick={e => { e.stopPropagation(); setWinFrom(defFrom); }}
          title="Tarik kanan/kiri untuk geser bulan · klik dua kali untuk reset"
          className="absolute bottom-0 cursor-ew-resize"
          style={{ left: plotLeft, right: CF_PLOT_RIGHT, height: CF_XAXIS_H, touchAction: 'none' }}
        />
        <div
          onPointerDown={onAxisPointerDown}
          onDoubleClick={e => { e.stopPropagation(); resetY(); }}
          title="Tarik naik/turun untuk zoom skala harga · klik dua kali untuk reset"
          className="absolute top-0 left-0 h-full cursor-ns-resize"
          style={{ width: plotLeft, touchAction: 'none' }}
        />
        <CfCrosshair wrapRef={wrapRef} plotLeft={plotLeft} plotTop={8} winFrom={winFrom} yMin={yDomain[0]} yMax={yDomain[1]} maxIdx={maxIdx} data={data} onHover={setHover} />
      </div>
      <div className="flex items-center justify-center gap-5 flex-wrap text-xs font-medium text-neutral-600 mt-2">
        {series.map(s => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>)}
        <span className="inline-flex items-center gap-1.5"><span className="w-5 h-0.5 rounded" style={{ background: CF_MONO.net }} />Net Cash Change</span>
        {loading && <span className="text-neutral-400">Loading…</span>}
        {error && <span className={NEG}>{error}</span>}
      </div>
    </Panel>
  );
}

function Composition({ m, method }: { m: CfMerged; method: Method }) {
  const T = m.TOTAL;
  const items = [
    { name: 'Operating Cash Flow', v: m.operating[method][T], color: CF_MONO.operating },
    { name: 'Investing Cash Flow', v: m.investing[T], color: CF_MONO.investing },
    { name: 'Financing Cash Flow', v: m.financing[T], color: CF_MONO.financing },
  ];
  const base = items.reduce((t, i) => t + Math.abs(i.v), 0);
  // Donut memakai nilai absolut; tanda asli (mis. Investing negatif) dibawa lewat `idx` -> items.
  const pie = items
    .map((i, idx) => ({ name: i.name, value: Math.abs(i.v), color: i.color, idx }))
    .filter(i => i.value >= 0.5);
  const p = pctChange(m.net[T], m.net[m.PREV]);

  // Interaksi seperti donut Purchase: klik segmen / baris legenda -> segmen membesar
  // & callout di tengah; klik lagi untuk melepas. `live` terisi saat garis pemisah ditarik.
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);
  useEffect(() => { setActive(null); }, [pie.length, method]);
  const toggle = (itemIdx: number) => {
    const pi = pie.findIndex(x => x.idx === itemIdx);
    if (pi < 0) return;
    setActive(prev => (prev === pi ? null : pi));
  };
  const activeItemIdx = active !== null ? pie[active]?.idx ?? null : null;
  const fmtShare = (share: number) => (share < 0 ? `(${Math.abs(share).toFixed(1)})%` : `${share.toFixed(1)}%`);
  const sgn = (pi: number) => (items[pie[pi]?.idx ?? 0]?.v < 0 ? -1 : 1);

  return (
    <Panel title="Cash Flow Composition">
      <div className="relative h-56">
        {pie.length > 0 ? (
          <InteractiveDonutChart
            data={pie}
            height={224}
            activeIndex={active}
            onActiveChange={setActive}
            onLiveChange={setLive}
            rawValue
            minVisibleDeg={5}
            formatValue={(v, i) => `Rp ${fmtCompact(sgn(i) * v, 1)}`}
            formatPct={(pc, i) => fmtShare(sgn(i) * pc)}
          />
        ) : <div className="absolute inset-[12%] rounded-full border-[14px] border-neutral-200" />}
        {active === null && live === null && (
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-[11px] font-medium text-neutral-500">Net Cash Change</span>
            <span className={`text-lg font-semibold tracking-tight ${m.net[T] < 0 ? NEG : 'text-neutral-900'}`}>Rp {fmtCompact(m.net[T], 1)}</span>
            {p !== null && <span className={`text-[11px] font-semibold ${m.net[T] >= m.net[m.PREV] ? 'text-neutral-900' : NEG}`}>{m.net[T] >= m.net[m.PREV] ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%</span>}
          </div>
        )}
      </div>
      <ul className="mt-4 space-y-1">
        {items.map((i, idx) => {
          const share = base < 0.5 ? null : (i.v / base) * 100;
          const isActive = activeItemIdx === idx;
          return (
            <li
              key={i.name}
              onClick={() => toggle(idx)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
            >
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: i.color }} />
              <span className={`text-neutral-700 ${isActive ? 'font-bold' : 'font-medium'}`}>{i.name}</span>
              <span className={`ml-auto tabular-nums font-semibold ${share !== null && share < 0 ? NEG : 'text-neutral-900'}`}>
                {share === null ? '–' : fmtShare(share)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] font-medium text-neutral-500 mt-3">Share of total absolute cash movement in the selected period. Click a slice to highlight it.</p>
    </Panel>
  );
}

// ── Tabel ────────────────────────────────────────────────────────────

// Gaya tabel disamakan dengan Balance Sheet (BsMono): header abu, baris grup
// abu muda, garis pemisah tipis, hover abu, tanpa warna per-aktivitas.
const GROUP_ROW = 'text-xs text-neutral-900 [&>td]:bg-neutral-200 [&>td]:shadow-[inset_0_-1px_0_#b4b4b4]';
const TOTAL_ROW = `${trCls} text-neutral-900 [&>td]:bg-neutral-100`;
const ghostBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50';

function CfTable({ m, method, labels, totalLabel, range, showCmp, setShowCmp, cmpBasis, setCmpBasis }: {
  m: CfMerged; method: Method; labels: string[]; totalLabel: string; range: { start: string; end: string };
  showCmp: boolean; setShowCmp: (v: boolean) => void; cmpBasis: CmpBasis; setCmpBasis: (v: CmpBasis) => void;
}) {
  // Default: ketiga seksi (Operating / Investing / Financing) tertutup saat halaman pertama dibuka.
  const [closed, setClosed] = useState<Set<string>>(() => new Set<string>(['operating', 'investing', 'financing']));
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [pctRev, setPctRev] = useState(false);
  const toggle = (set: React.Dispatch<React.SetStateAction<Set<string>>>, k: string) => set(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rows = m.rows[method];
  const lineKeys = rows.filter(r => r.kind === 'line' && r.accounts?.length).map(r => r.key);
  const allOpen = open.size > 0 && open.size >= lineKeys.length;
  const cmpIdx = cmpBasis === 'previous_period' ? m.PREV : m.LY;
  const cols = [...labels.map((_, i) => i), m.TOTAL];
  const colCount = cols.length + (showCmp ? 2 : 0) + 1;

  // Seksi yang sedang ditutup -> sembunyikan barisnya sampai total seksi itu.
  let hidden: Tone | null = null;

  const fmtV = (v: number, i: number, cash = false) => {
    if (pctRev && !cash) {
      const r = m.revenue[i];
      if (Math.abs(r) < 0.005) return '–';
      const p = (v / r) * 100;
      if (Math.abs(p) < 0.05) return '–';
      return p < 0 ? `(${Math.abs(p).toFixed(1)}%)` : `${p.toFixed(1)}%`;
    }
    return fmtAmount(v);
  };
  // Angka negatif selalu merah (menggantikan warna teks bawaan baris).
  const tone = (cls: string, neg: boolean) => (neg ? `${cls.replace(/text-neutral-\d+/g, '')} ${NEG}` : cls);
  const cell = (v: number[], i: number, cls: string, cash = false) => (
    <td key={i} className={`px-3 text-right tabular-nums whitespace-nowrap ${tone(cls, v[i] < -0.004)} ${i === m.TOTAL ? 'font-semibold border-l border-neutral-300' : ''}`}>{fmtV(v[i], i, cash)}</td>
  );
  const cmpCells = (v: number[], cls: string, upIsGood = true) => {
    if (!showCmp) return null;
    const d = v[m.TOTAL] - v[cmpIdx];
    const good = Math.abs(d) < 0.5 ? null : (d > 0) === upIsGood;
    return (
      <>
        <td className={`px-3 text-right tabular-nums whitespace-nowrap border-l border-neutral-300 ${tone(cls, v[cmpIdx] < -0.004)}`}>{fmtAmount(v[cmpIdx])}</td>
        <td className={`px-3 text-right tabular-nums whitespace-nowrap ${cls.replace(/text-neutral-\d+/g, '')} ${good === null ? 'text-neutral-500' : good ? 'text-neutral-900' : NEG}`}>{fmtAmount(d)}</td>
      </>
    );
  };
  const valueCells = (v: number[], cls: string, cash = false) => <>{cols.map(i => cell(v, i, cls, cash))}{cmpCells(v, cls)}</>;

  const render = (r: CfRow, idx: number): React.ReactNode => {
    if (r.kind === 'heading') {
      const isClosed = closed.has(r.tone!);
      hidden = isClosed ? r.tone! : null;
      // Seksi tanpa satu pun baris -> tampilkan keterangan, seperti "No balances" di Balance Sheet.
      const rest = rows.slice(idx + 1);
      const endAt = rest.findIndex(x => x.kind === 'total' && !!x.tone);
      const empty = !(endAt < 0 ? rest : rest.slice(0, endAt)).some(x => x.kind === 'line');
      return (
        <React.Fragment key={r.key}>
          <tr className={`${GROUP_ROW} cursor-pointer`} onClick={() => toggle(setClosed, r.tone!)}>
            <td colSpan={colCount} className="px-3 py-2 font-bold">
              <span className="inline-flex items-center gap-1.5">{isClosed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}{r.label}</span>
            </td>
          </tr>
          {!isClosed && empty && (
            <tr><td colSpan={colCount} className="pl-9 py-1.5 text-xs italic text-neutral-500">No cash movements</td></tr>
          )}
        </React.Fragment>
      );
    }
    if (r.kind === 'total' && r.tone) {
      hidden = null;
      return (
        <tr key={r.key} className={TOTAL_ROW}>
          <td className="pl-6 pr-3 py-2 font-semibold">{r.label}</td>
          {valueCells(r.v, 'py-2 font-semibold')}
        </tr>
      );
    }
    if (hidden) return null;
    if (r.kind === 'sub') {
      return <tr key={r.key}><td colSpan={colCount} className="pl-9 pr-3 pt-2 pb-1 text-xs font-semibold text-neutral-700">{r.label}</td></tr>;
    }
    if (r.kind === 'grand') {
      return (
        <tr key={r.key} className={GROUP_ROW}>
          <td className="px-3 py-2.5 font-bold">{r.label}</td>
          {valueCells(r.v, 'py-2.5 font-bold', r.key === 'end')}
        </tr>
      );
    }
    if (r.kind === 'cash') {
      return (
        <tr key={r.key} className={trCls}>
          <td className="px-3 py-2 text-neutral-900">{r.label}</td>
          {valueCells(r.v, 'py-2 text-neutral-900', true)}
        </tr>
      );
    }
    // line
    const isOpen = open.has(r.key);
    const hasAcc = !!r.accounts?.length;
    const indent = r.key.startsWith('nc:') || r.key.startsWith('wc:') ? 'pl-12' : 'pl-9';
    return (
      <React.Fragment key={r.key}>
        <tr className={`${trCls} ${hasAcc ? 'cursor-pointer' : ''}`} onClick={() => hasAcc && toggle(setOpen, r.key)}>
          <td className={`${indent} pr-3 py-1.5 text-neutral-800`}>
            <span className="inline-flex items-center gap-1">
              {hasAcc ? (isOpen ? <ChevronDown size={13} className="text-neutral-500" /> : <ChevronRight size={13} className="text-neutral-500" />) : <span className="w-[13px]" />}
              <span className={r.key === 'np' ? 'font-semibold' : ''}>{r.label}</span>
              {r.flag && <AlertTriangle size={13} className="text-neutral-500" />}
              {r.key === 'np' && (
                <Link href="/financial-statements/profit-loss" onClick={e => e.stopPropagation()} title="Open Profit & Loss" className="text-neutral-500 hover:text-neutral-900"><ExternalLink size={12} /></Link>
              )}
            </span>
          </td>
          {valueCells(r.v, `py-1.5 text-neutral-800 ${r.key === 'np' ? 'font-semibold' : ''}`)}
        </tr>
        {isOpen && r.accounts!.map(a => (
          <tr key={`${r.key}:${a.code}`} className={trCls}>
            <td className="pl-16 pr-3 py-1">
              <span className="inline-flex items-center gap-2 text-neutral-500">
                <span className="font-mono text-[11px]">{kodeAkun(a.code)}</span>
                <span className="truncate max-w-[220px]">{a.name}</span>
                <Link href={glHref(a.code, range.start, range.end)} target="_blank" title="Open in General Ledger" className="hover:text-neutral-900"><ExternalLink size={12} /></Link>
              </span>
            </td>
            {valueCells(a.v, 'py-1 text-neutral-500')}
          </tr>
        ))}
      </React.Fragment>
    );
  };

  return (
    <Panel
      title={
        <>
          <span className="block">Cash Flow Statement ({method === 'direct' ? 'Direct' : 'Indirect'} Method)</span>
          <span className="mt-0.5 block text-[11px] font-medium text-neutral-500">
            For the period {fmtRange(range.start, range.end)} · {pctRev ? 'Percent of revenue' : 'Amounts in IDR'}
          </span>
        </>
      }
      bodyClass="p-3 pt-2"
      right={
        <div className="flex flex-wrap items-center justify-end gap-2 print:hidden">
          <button type="button" onClick={() => setOpen(allOpen ? new Set() : new Set(lineKeys))} className={ghostBtn}>
            {allOpen ? <ChevronsDownUp size={14} /> : <ChevronsUpDown size={14} />} {allOpen ? 'Collapse accounts' : 'Expand accounts'}
          </button>
          {method === 'direct' ? (
            <Segmented
              value={pctRev ? 'pct' : 'nominal'}
              onChange={v => setPctRev(v === 'pct')}
              options={[['nominal', 'Amount: Nominal'], ['pct', '% of Revenue']] as const}
            />
          ) : (
            <>
              <label className="flex cursor-pointer select-none items-center gap-2 text-xs font-medium text-neutral-600">
                <button type="button" role="switch" aria-checked={showCmp} onClick={() => setShowCmp(!showCmp)}
                  className={`relative h-5 w-9 rounded-full transition-colors ${showCmp ? 'bg-neutral-900' : 'bg-neutral-300'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${showCmp ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
                Show Comparison
              </label>
              <div className={showCmp ? '' : 'pointer-events-none opacity-50'}>
                <BsDropdown
                  value={cmpBasis}
                  onChange={v => setCmpBasis(v as CmpBasis)}
                  align="right"
                  options={[{ value: 'previous_period', label: 'Previous Period' }, { value: 'last_year', label: 'Same Period Last Year' }]}
                />
              </div>
            </>
          )}
        </div>
      }
    >
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full border-separate border-spacing-0 text-xs" style={{ minWidth: 300 + cols.length * 96 }}>
          <thead>
            <tr className={thRowCls}>
              <th className={`${thCls} text-left min-w-[260px]`}>Description</th>
              {labels.map(l => <th key={l} className={`${thCls} text-right`}>{l}</th>)}
              <th className={`${thCls} text-right border-l border-l-neutral-400`}>{totalLabel}</th>
              {showCmp && (
                <>
                  <th className={`${thCls} text-right border-l border-l-neutral-400`}>{cmpBasis === 'previous_period' ? 'Previous Period' : 'Same Period LY'}</th>
                  <th className={`${thCls} text-right`}>Variance</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>{rows.map(render)}</tbody>
        </table>
      </div>
      {method === 'direct' && (
        <p className="px-2 pt-3 pb-1 text-[11px] font-medium text-neutral-500">
          Direct method: every journal that moves a cash account is split over its counter-accounts (revenue / receivables → customers, cost of sales / inventory / trade payables → suppliers, tax accounts → taxes, investing &amp; financing per the cash flow mapping). Transfers between cash accounts are excluded.
          {pctRev && ' % of Revenue = amount ÷ revenue of the same column.'}
        </p>
      )}
    </Panel>
  );
}