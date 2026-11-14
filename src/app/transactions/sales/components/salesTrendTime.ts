// Logika sumbu waktu ala TradingView untuk chart "Tren Sales Bulanan".
//
// Prinsip:
//  - Chart punya jendela waktu (from..to, milidetik UTC) yang bisa digeser dan di-zoom.
//  - Semakin sempit jendelanya, semakin halus datanya: tahun -> bulan -> hari.
//  - Label sumbu X ikut menyesuaikan: tahun + bulan, atau bulan + tanggal.
//  - Semua fungsi di sini murni (tanpa React) supaya mudah dites.
//  - Semua perhitungan tanggal pakai UTC, supaya "2026-08-01" tidak bergeser
//    jadi 31 Juli di zona waktu lain.

export const DAY_MS = 86_400_000;
const AVG_MONTH_MS = 30.4375 * DAY_MS;
const AVG_YEAR_MS = 365.25 * DAY_MS;

export type Granularity = 'day' | 'month' | 'year';

export interface Bucket {
  total: number;
  count: number;
}

export interface TrendIndex {
  day: Map<number, Bucket>;
  month: Map<number, Bucket>;
  year: Map<number, Bucket>;
  minYear: number | null;
  maxYear: number | null;
}

export interface TrendPoint {
  /** Awal bucket (ms UTC) — posisi titik di sumbu X. */
  t: number;
  total: number;
  count: number;
  /** Teks untuk tooltip, mis. "15 Aug 2026", "Aug 2026", "2026". */
  label: string;
}

export interface TickInfo {
  t: number;
  kind: 'year' | 'month' | 'day';
  /** Teks utama tick. */
  label: string;
  /** Baris kedua (tahun di bawah Januari). */
  sub?: string;
}

export interface TimeRange {
  from: number;
  to: number;
}

export interface TimeBounds {
  minT: number;
  maxT: number;
  minSpan: number;
  maxSpan: number;
}

// ── Penanggalan UTC ─────────────────────────────────────────────

export const utc = (y: number, m: number, d = 1) => Date.UTC(y, m, d);

export function startOf(t: number, gran: Granularity): number {
  const d = new Date(t);
  if (gran === 'day') return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  if (gran === 'month') return utc(d.getUTCFullYear(), d.getUTCMonth(), 1);
  return utc(d.getUTCFullYear(), 0, 1);
}

export function addGran(t: number, gran: Granularity, n: number): number {
  const d = new Date(t);
  if (gran === 'day') return utc(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n);
  if (gran === 'month') return utc(d.getUTCFullYear(), d.getUTCMonth() + n, 1);
  return utc(d.getUTCFullYear() + n, 0, 1);
}

/** "YYYY-MM-DD..." -> ms UTC awal hari; null kalau tidak valid. */
export function parseIsoDay(iso: string | null | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const da = Number(m[3]);
  if (!y || mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  return utc(y, mo - 1, da);
}

// ── Agregasi ────────────────────────────────────────────────────

function bump(map: Map<number, Bucket>, key: number, amount: number) {
  const b = map.get(key);
  if (b) {
    b.total += amount;
    b.count += 1;
  } else {
    map.set(key, { total: amount, count: 1 });
  }
}

/** Satu kali lewat semua invoice -> total per hari, bulan, dan tahun. */
export function buildTrendIndex<T>(
  rows: T[],
  getDate: (r: T) => string | null | undefined,
  getAmount: (r: T) => number,
): TrendIndex {
  const idx: TrendIndex = { day: new Map(), month: new Map(), year: new Map(), minYear: null, maxYear: null };
  for (const r of rows) {
    const t = parseIsoDay(getDate(r));
    if (t == null) continue;
    const amount = getAmount(r);
    bump(idx.day, t, amount);
    bump(idx.month, startOf(t, 'month'), amount);
    bump(idx.year, startOf(t, 'year'), amount);
    const y = new Date(t).getUTCFullYear();
    if (idx.minYear == null || y < idx.minYear) idx.minYear = y;
    if (idx.maxYear == null || y > idx.maxYear) idx.maxYear = y;
  }
  return idx;
}

/** Berapa halus datanya, berdasarkan lebar jendela. */
export function pickGranularity(span: number): Granularity {
  const days = span / DAY_MS;
  if (days <= 120) return 'day';
  if (days <= 12 * 366) return 'month';
  return 'year';
}

export type LabelFormatter = (t: number, gran: Granularity) => string;

/** Titik untuk jendela from..to. Ditambah satu bucket di tiap sisi supaya garis menyentuh tepi chart. */
export function buildSeries(
  idx: TrendIndex,
  from: number,
  to: number,
  gran: Granularity,
  fmt: LabelFormatter,
): TrendPoint[] {
  const map = idx[gran];
  const out: TrendPoint[] = [];
  const end = addGran(startOf(to, gran), gran, 1);
  for (let t = addGran(startOf(from, gran), gran, -1); t <= end; t = addGran(t, gran, 1)) {
    const b = map.get(t);
    out.push({ t, total: b?.total ?? 0, count: b?.count ?? 0, label: fmt(t, gran) });
  }
  return out;
}

// ── Label sumbu X ───────────────────────────────────────────────

function smallest(options: number[], fits: (n: number) => boolean): number {
  for (const o of options) if (fits(o)) return o;
  return options[options.length - 1];
}

export interface TickFormatters {
  monthShort: (t: number) => string;
}

/**
 * Tick sumbu X sesuai tingkat zoom:
 *  - hari   : tanggal (1, 5, 10, ...) dengan nama bulan di tanggal 1
 *  - bulan  : nama bulan, tahun di bawah Januari (atau hanya tahun kalau sudah jauh)
 *  - tahun  : tahun saja
 */
export function buildTicks(from: number, to: number, gran: Granularity, f: TickFormatters): TickInfo[] {
  const span = to - from;
  const ticks: TickInfo[] = [];

  if (gran === 'day') {
    const days = span / DAY_MS;
    const step = smallest([1, 2, 5, 10, 15], (s) => days / s <= 14);
    for (let t = startOf(from, 'day'); t <= to; t = addGran(t, 'day', 1)) {
      if (t < from) continue;
      const d = new Date(t).getUTCDate();
      if (d === 1) {
        ticks.push({ t, kind: 'month', label: f.monthShort(t) });
      } else if (step === 1 || (step === 2 ? d % 2 === 1 : d % step === 0)) {
        // Hindari tanggal yang terlalu dekat dengan tanggal 1 bulan berikutnya.
        const next = addGran(startOf(t, 'month'), 'month', 1);
        if ((next - t) / DAY_MS >= Math.max(2, step / 2)) {
          ticks.push({ t, kind: 'day', label: String(d) });
        }
      }
    }
    return ticks;
  }

  if (gran === 'month') {
    const months = span / AVG_MONTH_MS;
    const step = smallest([1, 2, 3, 6, 12], (s) => months / s <= 14);
    for (let t = startOf(from, 'month'); t <= to; t = addGran(t, 'month', 1)) {
      if (t < from) continue;
      const dt = new Date(t);
      const mi = dt.getUTCMonth();
      if (mi % step !== 0) continue;
      const year = String(dt.getUTCFullYear());
      if (step === 12) ticks.push({ t, kind: 'year', label: year });
      else if (mi === 0) ticks.push({ t, kind: 'month', label: f.monthShort(t), sub: year });
      else ticks.push({ t, kind: 'month', label: f.monthShort(t) });
    }
    return ticks;
  }

  const years = span / AVG_YEAR_MS;
  const step = smallest([1, 2, 5, 10, 20], (s) => years / s <= 12);
  for (let t = startOf(from, 'year'); t <= to; t = addGran(t, 'year', 1)) {
    if (t < from) continue;
    const y = new Date(t).getUTCFullYear();
    if (y % step === 0) ticks.push({ t, kind: 'year', label: String(y) });
  }
  return ticks;
}

// ── Zoom dan geser ──────────────────────────────────────────────

/** Tahun paling awal yang bisa dijelajahi di chart. */
export const TREND_FIRST_YEAR = 1950;

/**
 * Batas geser/zoom: dari 1 Jan 1950 (atau tahun data tertua kalau lebih awal) sampai akhir tahun berjalan
 * (atau tahun data terbaru kalau lebih akhir). Zoom out terjauh = seluruh rentang itu.
 */
export function makeBounds(idx: TrendIndex, defaultYear: number, now: number = Date.now()): TimeBounds {
  const firstYear = Math.min(TREND_FIRST_YEAR, idx.minYear ?? TREND_FIRST_YEAR, defaultYear);
  const lastYear = Math.max(new Date(now).getUTCFullYear(), idx.maxYear ?? defaultYear, defaultYear);
  const minT = utc(firstYear, 0, 1);
  const maxT = utc(lastYear + 1, 0, 1);
  return {
    minT,
    maxT,
    minSpan: 10 * DAY_MS,
    maxSpan: maxT - minT,
  };
}

function fit(from: number, span: number, b: TimeBounds): TimeRange {
  let f = from;
  if (f < b.minT) f = b.minT;
  if (f + span > b.maxT) f = b.maxT - span;
  if (f < b.minT) f = b.minT;
  return { from: f, to: f + span };
}

/**
 * Zoom di sekitar titik jangkar.
 * factor > 1 = jendela melebar (zoom out: tahun), factor < 1 = menyempit (zoom in: hari).
 * anchorRatio 0..1 = posisi jangkar di dalam jendela; titik itu tidak bergeser saat zoom.
 */
export function zoomRange(start: TimeRange, factor: number, anchorRatio: number, b: TimeBounds): TimeRange {
  const span = start.to - start.from;
  const newSpan = Math.min(b.maxSpan, Math.max(b.minSpan, span * factor));
  const ratio = Math.min(1, Math.max(0, anchorRatio));
  const anchor = start.from + span * ratio;
  return fit(anchor - newSpan * ratio, newSpan, b);
}

export function panRange(start: TimeRange, deltaMs: number, b: TimeBounds): TimeRange {
  return fit(start.from + deltaMs, start.to - start.from, b);
}

// ── Interval ala TradingView (5m, 15m, ... 1Y) ──────────────────
// Data invoice hanya punya TANGGAL (tanpa jam), jadi:
//  - interval >= 1 hari  : total = jumlah asli invoice di dalam bucket (tidak ada data karangan)
//  - interval  < 1 hari  : total harian dibagi rata ke semua bucket di hari itu
//    (total per hari tetap persis sama, hanya "dipotong" lebih halus)

export type IntervalId = '5m' | '15m' | '30m' | '45m' | '1h' | '4h' | '1d' | '4d' | '1w' | '4w' | '1M' | '6M' | '1Y';

export interface IntervalDef {
  id: IntervalId;
  label: string;
  title: string;
  kind: 'fixed' | 'months';
  /** kind 'fixed': panjang bucket (ms). */
  ms: number;
  /** kind 'months': panjang bucket (bulan kalender). */
  months: number;
  /** Titik acuan penyelarasan bucket 'fixed' (minggu mulai Senin). */
  anchor: number;
  /** Jumlah bucket di jendela bawaan saat interval dipilih. */
  bars: number;
}

const MIN_MS = 60_000;
const HOUR_MS = 60 * MIN_MS;
const EPOCH_MONDAY = Date.UTC(1970, 0, 5);

const fixedDef = (id: IntervalId, title: string, ms: number, bars: number, anchor = 0): IntervalDef =>
  ({ id, label: id, title, kind: 'fixed', ms, months: 0, anchor, bars });
const monthsDef = (id: IntervalId, title: string, months: number, bars: number): IntervalDef =>
  ({ id, label: id, title, kind: 'months', ms: 0, months, anchor: 0, bars });

export const INTERVALS: IntervalDef[] = [
  fixedDef('5m', '5 menit', 5 * MIN_MS, 72),
  fixedDef('15m', '15 menit', 15 * MIN_MS, 64),
  fixedDef('30m', '30 menit', 30 * MIN_MS, 48),
  fixedDef('45m', '45 menit', 45 * MIN_MS, 64),
  fixedDef('1h', '1 jam', HOUR_MS, 72),
  fixedDef('4h', '4 jam', 4 * HOUR_MS, 60),
  fixedDef('1d', '1 hari', DAY_MS, 90),
  fixedDef('4d', '4 hari', 4 * DAY_MS, 90),
  fixedDef('1w', '1 minggu', 7 * DAY_MS, 52, EPOCH_MONDAY),
  fixedDef('4w', '4 minggu', 28 * DAY_MS, 39, EPOCH_MONDAY),
  monthsDef('1M', '1 bulan', 1, 24),
  monthsDef('6M', '6 bulan', 6, 10),
  monthsDef('1Y', '1 tahun', 12, 8),
];

export const INTERVAL_BY_ID = INTERVALS.reduce((acc, d) => { acc[d.id] = d; return acc; }, {} as Record<IntervalId, IntervalDef>);

export const isIntraday = (d: IntervalDef) => d.kind === 'fixed' && d.ms < DAY_MS;
const barMs = (d: IntervalDef) => (d.kind === 'fixed' ? d.ms : d.months * AVG_MONTH_MS);

/** Awal bucket yang memuat waktu t. */
export function intervalStart(t: number, d: IntervalDef): number {
  if (d.kind === 'fixed') return d.anchor + Math.floor((t - d.anchor) / d.ms) * d.ms;
  const dt = new Date(t);
  const idx = dt.getUTCFullYear() * 12 + dt.getUTCMonth();
  const b = Math.floor(idx / d.months) * d.months;
  return utc(Math.floor(b / 12), b % 12, 1);
}

/** Bucket ke-n setelah t (n boleh negatif). */
export function intervalNext(t: number, d: IntervalDef, n = 1): number {
  return d.kind === 'fixed' ? t + d.ms * n : addGran(t, 'month', d.months * n);
}

function bucketValue(idx: TrendIndex, t: number, d: IntervalDef): Bucket | undefined {
  if (d.kind === 'fixed') {
    if (d.ms < DAY_MS) {
      const b = idx.day.get(startOf(t, 'day'));
      return b ? { total: b.total * (d.ms / DAY_MS), count: b.count } : undefined;
    }
    let total = 0, count = 0, found = false;
    for (let x = t; x < t + d.ms; x += DAY_MS) {
      const b = idx.day.get(x);
      if (b) { total += b.total; count += b.count; found = true; }
    }
    return found ? { total, count } : undefined;
  }
  let total = 0, count = 0, found = false;
  for (let m = 0; m < d.months; m++) {
    const b = idx.month.get(addGran(t, 'month', m));
    if (b) { total += b.total; count += b.count; found = true; }
  }
  return found ? { total, count } : undefined;
}

/** Titik chart untuk jendela from..to dengan bucket sesuai interval (+1 bucket di tiap sisi). */
export function buildSeriesInterval(
  idx: TrendIndex,
  from: number,
  to: number,
  d: IntervalDef,
  fmt: (t: number) => string,
): TrendPoint[] {
  const out: TrendPoint[] = [];
  const end = intervalNext(intervalStart(to, d), d, 1);
  let guard = 0;
  for (let t = intervalNext(intervalStart(from, d), d, -1); t <= end && guard < 3000; t = intervalNext(t, d, 1), guard++) {
    const b = bucketValue(idx, t, d);
    out.push({ t, total: b?.total ?? 0, count: b?.count ?? 0, label: fmt(t) });
  }
  return out;
}

/** Tick sumbu X untuk interval < 1 hari: jam (HH:mm), tanggal tebal di tengah malam. */
export function buildIntradayTicks(from: number, to: number, f: TickFormatters): TickInfo[] {
  const span = to - from;
  const step = smallest([5, 15, 30, 60, 120, 240, 360, 720].map((m) => m * MIN_MS), (s) => span / s <= 10);
  const ticks: TickInfo[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) {
    const dt = new Date(t);
    if (t % DAY_MS === 0) {
      ticks.push({ t, kind: 'month', label: `${dt.getUTCDate()} ${f.monthShort(t)}` });
    } else {
      const hh = String(dt.getUTCHours()).padStart(2, '0');
      const mm = String(dt.getUTCMinutes()).padStart(2, '0');
      ticks.push({ t, kind: 'day', label: `${hh}:${mm}` });
    }
  }
  return ticks;
}

/**
 * Jendela bawaan saat interval dipilih: `bars` bucket yang berakhir di hari invoice terakhir
 * pada tahun `year` (atau akhir tahun itu kalau belum ada invoice).
 */
export function defaultWindowForInterval(idx: TrendIndex, d: IntervalDef, year: number): TimeRange {
  let lastDay: number | null = null;
  for (const k of Array.from(idx.day.keys())) {
    if (new Date(k).getUTCFullYear() === year && (lastDay === null || k > lastDay)) lastDay = k;
  }
  const anchorEnd = (lastDay ?? utc(year, 11, 31)) + DAY_MS;
  const to = intervalNext(intervalStart(anchorEnd - 1, d), d, 1);
  return { from: intervalNext(to, d, -d.bars), to };
}

/** Batas zoom/geser saat interval dipilih: 8 s/d 600 bucket supaya jumlah titik tetap wajar. */
export function makeBoundsForInterval(idx: TrendIndex, defaultYear: number, d: IntervalDef, now: number = Date.now()): TimeBounds {
  const b = makeBounds(idx, defaultYear, now);
  const bar = barMs(d);
  return { ...b, minSpan: 8 * bar, maxSpan: Math.min(b.maxSpan, 600 * bar) };
}

/** Tick sumbu Y yang "bulat" untuk rentang lo..hi (boleh melewati 0 / negatif). */
export function niceStep(span: number, target = 5): number {
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / pow;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
}

export function niceTicksRange(lo: number, hi: number, target = 5): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [0];
  const step = niceStep(span, target);
  const out: number[] = [];
  for (let k = Math.ceil(lo / step); k * step <= hi + step * 1e-9; k++) out.push(k * step || 0);
  return out;
}

/**
 * Haluskan garis (Gaussian) supaya dataran + lompatan antar-hari jadi lengkung mulus.
 * Hanya untuk tampilan; dipakai di interval < 1 hari, di mana nilai di dalam satu hari memang
 * hasil bagi rata (bukan data asli per jam). sigma dalam satuan bucket.
 */
export function smoothSeries(points: TrendPoint[], sigma: number): TrendPoint[] {
  const n = points.length;
  if (sigma <= 0 || n < 3) return points;
  const radius = Math.ceil(sigma * 3);
  const w: number[] = [];
  for (let k = -radius; k <= radius; k++) w.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
  return points.map((p, i) => {
    let sum = 0;
    let ws = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= n) continue;
      const wk = w[k + radius];
      sum += points[j].total * wk;
      ws += wk;
    }
    return { ...p, total: sum / ws };
  });
}