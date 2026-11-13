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
export const TREND_FIRST_YEAR = 2020;

/**
 * Batas geser/zoom: dari 1 Jan 2020 (atau tahun data tertua kalau lebih awal) sampai akhir tahun berjalan
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