'use client';

// Chart tren multi-seri untuk halaman Fixed Assets (Overview & Depreciation).
// Desain + semua interaksinya meniru "Cash Flow Trend" di Financial Statements
// (financial-statements/components/fs/cf/CashFlowView.tsx > TrendChart):
//   - jendela 12 bulan yang bisa digeser (tarik grafik / label bulan) sampai Jan 2000
//   - zoom skala harga (tarik sumbu Y naik/turun), tarik grafik juga menggeser skala
//   - crosshair garis putus-putus + label harga di sumbu Y + label tanggal di sumbu X
//   - ringkasan nilai tiap seri untuk bulan terdekat dari kursor
//   - pilihan Chart Type: "Column & Line" atau "Line"
//   - klik dua kali untuk reset
// Data: GET /api/v1/asset/fixed-assets/trend?year=YYYY (per tahun, di-cache).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { BsDropdown, Panel } from '@/app/financial-statements/components/fs/bs/BsMono';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { FIXED_ASSETS_EVENT, fetchTrendYear } from '@/lib/fixedAssetsStore';

/** Satu baris bulan dari endpoint tren (FA: cost/accumulated/nbv/..., Inventory: value/stock_in/stock_out). */
export type FaTrendMonth = { month: string } & Record<string, any>;
/** Pengambil data tren per tahun. Harus stabil (didefinisikan di luar komponen). */
export type FaYearFetcher = (clientId: string, year: number, asOf: string) => Promise<{ months: FaTrendMonth[] }>;

export interface FaSeries {
  key: string;
  name: string;
  color: string;
  /** 'bar' = kolom pada mode "Column & Line"; 'line' = selalu garis. Pada mode "Line" semuanya garis. */
  kind: 'bar' | 'line';
  /** Seri penutup (mis. Net Book Value): garis lebih tebal & dipisah garis di ringkasan hover. */
  emphasis?: boolean;
}

export type FaMonthGetter = (idx: number) => FaTrendMonth | undefined;
export type FaPointBuilder = (idx: number, get: FaMonthGetter) => Record<string, number | null>;

type ChartType = 'column_line' | 'line';
type FaPoint = { x: number } & Record<string, number | null>;

const FA_FIRST_YEAR = 2000;
const FA_WINDOW = 11; // Jan..Des = 11 langkah bulan
const FA_PAD = 0.5; // ruang setengah bulan di kiri/kanan sumbu X agar kolom di tepi tidak terpotong
const FA_SPAN = FA_WINDOW + 2 * FA_PAD;
const FA_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const faMonthLabel = (i: number) => `${FA_MON[((i % 12) + 12) % 12]} ${FA_FIRST_YEAR + Math.floor(i / 12)}`;
const FA_AXIS_LINE = { stroke: '#404040', strokeWidth: 1.5 };
const FA_MARGIN_LEFT = 4;
const FA_PLOT_RIGHT = 14;
const FA_XAXIS_H = 44;
const FA_PLOT_H = 288 - FA_XAXIS_H - 8; // tinggi chart (h-72) - sumbu X - margin atas
const NEG = 'text-red-700';
const FA_CHIP = 'absolute whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium leading-4 text-white shadow-sm';

// Langkah tick "bulat" untuk skala harga.
function faNiceStep(span: number, target = 5): number {
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}
function faNiceTicks(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [0];
  const step = faNiceStep(span, target);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k++) out.push(k * step || 0);
  return out;
}

// Rupiah nominal penuh; negatif ditulis dengan tanda minus (-Rp100.000.000).
const faRp = (v: number) => {
  const full = Math.round(v);
  const t = `Rp${Math.abs(full).toLocaleString('id-ID')}`;
  return full < 0 ? `-${t}` : t;
};

// ── Cache data per tahun (diambil bila dibutuhkan; dibuang saat klien / as_of / data FA berubah) ──
function useFaYearCache(clientId: string, asOf: string, fetchYear: FaYearFetcher, changeEvent: string) {
  const cacheRef = useRef<Record<number, FaTrendMonth[]>>({});
  const inflight = useRef(new Set<number>());
  const gen = useRef(0);
  const [cache, setCache] = useState<Record<number, FaTrendMonth[]>>({});
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reset = useCallback(() => {
    gen.current += 1;
    cacheRef.current = {};
    inflight.current.clear();
    setCache({});
    setPending(0);
    setVersion(v => v + 1);
  }, []);
  useEffect(() => { reset(); }, [clientId, asOf, reset]);
  useEffect(() => {
    window.addEventListener(changeEvent, reset);
    return () => window.removeEventListener(changeEvent, reset);
  }, [reset, changeEvent]);

  const load = useCallback((years: number[]): Promise<void> => {
    const g = gen.current;
    const todo = years.filter(y => !cacheRef.current[y] && !inflight.current.has(y));
    if (!clientId || todo.length === 0) return Promise.resolve();
    todo.forEach(y => inflight.current.add(y));
    setPending(n => n + todo.length);
    return Promise.all(todo.map(async y => {
      try {
        const res = await fetchYear(clientId, y, asOf);
        if (g !== gen.current) return;
        cacheRef.current = { ...cacheRef.current, [y]: res.months };
        setCache(cacheRef.current);
        setError(null);
      } catch (e) {
        if (g === gen.current) setError((e as Error).message);
      } finally {
        if (g === gen.current) {
          inflight.current.delete(y);
          setPending(n => n - 1);
        }
      }
    })).then(() => undefined);
  }, [clientId, asOf, fetchYear]);
  return { cache, load, loading: pending > 0, error, version };
}

// Ringkasan di atas chart: bulan terdekat dari kursor di kiri, lalu satu kolom per seri
// (nama kecil di atas, nilai di bawah) yang dibagi rata. Tinggi tetap supaya layout tidak bergeser.
function FaHoverStrip({ row, series }: { row: FaPoint | null; series: FaSeries[] }) {
  const nilai = (v: number | null | undefined) => (v == null ? '—' : faRp(v));
  return (
    <div className="pointer-events-none mb-2 flex h-9 items-center gap-x-5 overflow-hidden">
      {row ? (
        <>
          <span className="w-[76px] shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-neutral-500">{faMonthLabel(row.x)}</span>
          <div className="flex min-w-0 flex-1 items-center justify-between gap-x-4">
            {series.map(s => {
              const v = row[s.key];
              return (
                <div key={s.key} className={`min-w-0 ${s.emphasis ? 'border-l border-neutral-200 pl-4' : ''}`}>
                  <div className="flex items-center gap-1.5 whitespace-nowrap text-[10.5px] leading-4 text-neutral-500">
                    <span className="h-2.5 w-[3px] rounded-full" style={{ background: s.color }} />{s.name}
                  </div>
                  <div className={`whitespace-nowrap text-xs leading-4 tabular-nums ${s.emphasis ? 'font-semibold' : 'font-medium'} ${v != null && v < 0 ? NEG : 'text-neutral-900'}`}>{nilai(v)}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <span className="text-[11px] text-neutral-400">Hover over the chart to see values · drag to pan · double-click to reset</span>
      )}
    </div>
  );
}

// Crosshair: garis putus-putus horizontal + vertikal di kursor, label harga menempel di sumbu Y
// dan label tanggal di sumbu X. Ringkasan bulan terdekat dikirim ke strip lewat onHover.
function FaCrosshair({ wrapRef, plotLeft, plotTop, winFrom, yMin, yMax, maxIdx, data, onHover }: {
  wrapRef: React.RefObject<HTMLDivElement | null>; plotLeft: number; plotTop: number; winFrom: number; yMin: number; yMax: number; maxIdx: number; data: FaPoint[]; onHover: (row: FaPoint | null) => void;
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
      const inside = x >= plotLeft && x <= r.width - FA_PLOT_RIGHT && y >= plotTop && y <= r.height - FA_XAXIS_H;
      setPos(inside ? { x, y, w: r.width, h: r.height } : null);
    };
    const onLeave = () => setPos(null);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerleave', onLeave); };
  }, [wrapRef, plotLeft, plotTop]);
  const hoverRow = pos
    ? data.find(d => d.x === Math.min(maxIdx, Math.max(0, Math.round(winFrom - FA_PAD + ((pos.x - plotLeft) / Math.max(1, pos.w - FA_PLOT_RIGHT - plotLeft)) * FA_SPAN))))
    : undefined;
  useEffect(() => { onHover(hoverRow ?? null); }, [hoverRow, onHover]);
  useEffect(() => () => onHover(null), [onHover]);
  if (!pos) return null;
  const plotRight = pos.w - FA_PLOT_RIGHT;
  const plotBottom = pos.h - FA_XAXIS_H;
  const plotW = Math.max(1, plotRight - plotLeft);
  const plotH = Math.max(1, plotBottom - plotTop);
  // Tanggal dihitung dengan interpolasi di dalam bulan (tengah antara tick Jun dan Jul = pertengahan Juni).
  const t = Math.min(maxIdx, Math.max(0, winFrom - FA_PAD + ((pos.x - plotLeft) / plotW) * FA_SPAN));
  const mi = Math.floor(t);
  const yr = FA_FIRST_YEAR + Math.floor(mi / 12);
  const mo = mi % 12;
  const dim = new Date(Date.UTC(yr, mo + 1, 0)).getUTCDate();
  const day = Math.min(dim, 1 + Math.floor((t - mi) * dim));
  const dateText = `${day} ${FA_MON[mo]} ${yr}`;
  const xPx = pos.x;
  const price = yMin + ((plotBottom - pos.y) / plotH) * (yMax - yMin);
  const dateCenter = Math.min(plotRight - 52, Math.max(plotLeft + 52, xPx));
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <line x1={xPx} y1={plotTop} x2={xPx} y2={plotBottom} stroke="#60A5FA" strokeWidth={1} strokeDasharray="4 3" />
        <line x1={plotLeft} y1={pos.y} x2={plotRight} y2={pos.y} stroke="#A3A3A3" strokeWidth={1} strokeDasharray="4 3" />
      </svg>
      <div className={FA_CHIP} style={{ background: '#1D4ED8', right: pos.w - plotLeft + 4, top: pos.y - 10 }}>{faRp(price)}</div>
      <div className={FA_CHIP} style={{ background: '#1D4ED8', left: dateCenter, top: plotBottom + 4, transform: 'translateX(-50%)' }}>{dateText}</div>
    </div>
  );
}

// Label sumbu X: bulan di baris atas, tahun (tebal) di baris bawah Januari / label pertama.
function FaXTick({ x, y, payload, info }: { x?: number; y?: number; payload?: { value: number }; info: Map<number, { label: string; sub?: string }> }) {
  const t = payload ? info.get(payload.value) : undefined;
  if (!t || x == null || y == null) return null;
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} dy={12} textAnchor="middle" fontSize={11} fontWeight={600} fill="#525252">{t.label}</text>
      {t.sub && <text x={0} y={0} dy={26} textAnchor="middle" fontSize={11} fontWeight={700} fill="#404040">{t.sub}</text>}
    </g>
  );
}

export default function FaTrendChart({ title, clientId, asOf, series, build, className = '', titleLarge = false, fetchYear = fetchTrendYear, changeEvent = FIXED_ASSETS_EVENT }: {
  title: string;
  /** Judul seukuran judul tabel (text-2xl), sama dengan FaCard. */
  titleLarge?: boolean;
  clientId: string;
  asOf: string;
  series: FaSeries[];
  /** Harus stabil (didefinisikan di luar komponen) -- dipanggil per bulan untuk menyusun titik chart. */
  build: FaPointBuilder;
  className?: string;
  /** Sumber data tren per tahun; default = Fixed Assets. */
  fetchYear?: FaYearFetcher;
  /** Event window yang memicu muat ulang data; default = event Fixed Assets. */
  changeEvent?: string;
}) {
  const [type, setType] = useState<ChartType>('column_line');
  const [hover, setHover] = useState<FaPoint | null>(null);
  const lastYear = Number(asOf.slice(0, 4)) || new Date().getFullYear();
  const maxIdx = (lastYear - FA_FIRST_YEAR) * 12 + 11;
  const maxFrom = maxIdx - FA_WINDOW;
  const defFrom = Math.min(maxFrom, Math.max(0, (lastYear - FA_FIRST_YEAR) * 12));
  const [winFrom, setWinFrom] = useState(defFrom);
  useEffect(() => { setWinFrom(defFrom); }, [defFrom]);
  const fromRef = useRef(winFrom);
  fromRef.current = winFrom;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [panning, setPanning] = useState(false);
  const { cache, load, loading, error, version } = useFaYearCache(clientId, asOf, fetchYear, changeEvent);
  // Zoom skala harga: tarik sumbu Y naik/turun (naik = zoom in). Tarik grafik juga menggeser skala.
  const [yZoom, setYZoom] = useState(1);
  const [yShift, setYShift] = useState(0);
  const yShiftRef = useRef(0);
  yShiftRef.current = yShift;

  // Ambil data tahun yang terlihat dulu (+ setahun sebelumnya untuk pembanding), lalu tahun di sekitarnya.
  const iFrom = Math.floor(winFrom);
  const iTo = Math.ceil(winFrom + FA_WINDOW);
  useEffect(() => {
    const yrs = (a: number, b: number) => {
      const set = new Set<number>();
      for (let i = Math.max(0, a); i <= Math.min(maxIdx, b); i++) set.add(FA_FIRST_YEAR + Math.floor(i / 12));
      return Array.from(set);
    };
    const t = setTimeout(() => { load(yrs(iFrom - 12, iTo)).then(() => load(yrs(iFrom - 18, iTo + 3))); }, 120);
    return () => clearTimeout(t);
  }, [iFrom, iTo, load, maxIdx, version]);

  const data = useMemo<FaPoint[]>(() => {
    const get: FaMonthGetter = i => cache[FA_FIRST_YEAR + Math.floor(i / 12)]?.[((i % 12) + 12) % 12];
    const out: FaPoint[] = [];
    for (let i = Math.max(0, iFrom - 1); i <= Math.min(maxIdx, iTo + 1); i++) {
      if (!get(i)) continue;
      out.push({ x: i, ...build(i, get) });
    }
    return out;
  }, [cache, iFrom, iTo, maxIdx, build]);

  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let i = Math.ceil(winFrom); i <= Math.floor(winFrom + FA_WINDOW + 1e-9); i++) out.push(i);
    return out;
  }, [winFrom]);
  const tickInfo = useMemo(() => new Map(ticks.map((i, k) => [i, { label: FA_MON[i % 12], sub: i % 12 === 0 || k === 0 ? String(FA_FIRST_YEAR + Math.floor(i / 12)) : undefined }])), [ticks]);

  const yBase = useMemo(() => {
    let hi = 0, lo = 0;
    data.forEach(d => {
      if (d.x < winFrom - FA_PAD || d.x > winFrom + FA_WINDOW + FA_PAD) return;
      series.forEach(s => { const v = d[s.key]; if (v == null) return; if (v > hi) hi = v; if (v < lo) lo = v; });
    });
    if (hi <= 0 && lo >= 0) hi = 1;
    hi *= 1.08;
    return { lo: lo < 0 ? lo * 1.08 : 0, hi };
  }, [data, winFrom, series]);
  const yDomain = useMemo<[number, number]>(() => {
    const mid = (yBase.lo + yBase.hi) / 2 + yShift;
    const half = (yBase.hi - yBase.lo) / 2 / yZoom;
    return [mid - half, mid + half];
  }, [yBase, yZoom, yShift]);
  const yTicks = useMemo(() => faNiceTicks(yDomain[0], yDomain[1], 5), [yDomain]);
  const yAxisW = Math.max(48, Math.ceil(Math.max(...yTicks.map(t => faRp(t).length)) * 6.6) + 12);
  const plotLeft = yAxisW + FA_MARGIN_LEFT;
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
    const plotW = Math.max(120, el.getBoundingClientRect().width - plotLeft - FA_PLOT_RIGHT);
    const startX = e.clientX;
    const startY = e.clientY;
    const start = fromRef.current;
    const startShift = yShiftRef.current;
    const [yLo, yHi] = yDomainRef.current;
    setPanning(true);
    const onMove = (ev: PointerEvent) => {
      setWinFrom(Math.min(maxFrom, Math.max(0, start - ((ev.clientX - startX) / plotW) * FA_SPAN)));
      if (withY) setYShift(startShift + ((ev.clientY - startY) / FA_PLOT_H) * (yHi - yLo));
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

  const asBar = (s: FaSeries) => type === 'column_line' && s.kind === 'bar';
  return (
    <Panel title={titleLarge ? <span className={`${salesFont.className} text-2xl font-semibold tracking-tight`}>{title}</span> : title} className={`relative min-w-0 ${className}`}
      right={
        <label className="flex items-center gap-2 text-xs font-medium text-neutral-600">Chart Type
          <BsDropdown value={type} onChange={v => setType(v as ChartType)} align="right"
            options={[{ value: 'column_line', label: 'Column & Line' }, { value: 'line', label: 'Line' }]} />
        </label>
      }>
      <FaHoverStrip row={hover} series={series} />
      <div
        ref={wrapRef}
        onPointerDown={e => startPan(e, true)}
        onDoubleClick={() => { setWinFrom(defFrom); resetY(); }}
        title="Tarik kanan/kiri untuk geser bulan · klik dua kali untuk reset"
        className={`relative h-72 select-none ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
        style={{ touchAction: 'pan-y' }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: FA_PLOT_RIGHT, left: FA_MARGIN_LEFT, bottom: 0 }}>
            <CartesianGrid stroke="#E5E5E5" vertical={false} />
            <XAxis dataKey="x" type="number" scale="linear" domain={[winFrom - FA_PAD, winFrom + FA_WINDOW + FA_PAD]} allowDataOverflow ticks={ticks} interval={0}
              tick={(p: any) => <FaXTick {...p} info={tickInfo} />} tickLine={false} axisLine={FA_AXIS_LINE} height={FA_XAXIS_H} />
            <YAxis tick={{ fontSize: 11, fill: '#737373' }} tickLine={false} axisLine={FA_AXIS_LINE} width={yAxisW} tickFormatter={faRp}
              domain={yDomain} ticks={yTicks} allowDataOverflow />
            <ReferenceLine y={0} stroke="#A3A3A3" />
            {series.map(s => asBar(s)
              ? <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} barSize={type === 'column_line' && series.filter(asBar).length > 3 ? 8 : 10} radius={[2, 2, 0, 0]} isAnimationActive={false} />
              : <Line key={s.key} type="natural" dataKey={s.key} name={s.name} stroke={s.color} strokeWidth={s.emphasis ? 1.75 : 1.25} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={false} isAnimationActive={false} />)}
          </ComposedChart>
        </ResponsiveContainer>
        <div
          onPointerDown={e => { e.stopPropagation(); startPan(e, false); }}
          onDoubleClick={e => { e.stopPropagation(); setWinFrom(defFrom); }}
          title="Tarik kanan/kiri untuk geser bulan · klik dua kali untuk reset"
          className="absolute bottom-0 cursor-ew-resize"
          style={{ left: plotLeft, right: FA_PLOT_RIGHT, height: FA_XAXIS_H, touchAction: 'none' }}
        />
        <div
          onPointerDown={onAxisPointerDown}
          onDoubleClick={e => { e.stopPropagation(); resetY(); }}
          title="Tarik naik/turun untuk zoom skala harga · klik dua kali untuk reset"
          className="absolute top-0 left-0 h-full cursor-ns-resize"
          style={{ width: plotLeft, touchAction: 'none' }}
        />
        <FaCrosshair wrapRef={wrapRef} plotLeft={plotLeft} plotTop={8} winFrom={winFrom} yMin={yDomain[0]} yMax={yDomain[1]} maxIdx={maxIdx} data={data} onHover={setHover} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-5 text-xs font-medium text-neutral-600">
        {series.map(s => asBar(s)
          ? <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.name}</span>
          : <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5 rounded" style={{ background: s.color }} />{s.name}</span>)}
        {loading && <span className="text-neutral-400">Loading…</span>}
        {error && <span className={NEG}>{error}</span>}
      </div>
    </Panel>
  );
}