// Pemasang spesifikasi sheet (JSON) ke worksheet ExcelJS.
// Dipakai untuk sheet ADJ, TB, BS, PNL CF yang disalin dari workbook acuan
// PT_BIT_WS_Financial_Statement (lihat folder ./reportsSheets/*.json).
// Isi JSON: sel (nilai / rumus / tanggal) + indeks gaya, lebar kolom, tinggi baris,
// merge, freeze, autofilter, grup kolom, warna tab, dan aturan highlight.

import type { Worksheet, Borders, Alignment, Border } from 'exceljs';

type Val = string | number | boolean | null | { f: string } | { d: string };
interface StyleDef {
  f: [string | null, number | null, number, number, string | null, string | null];
  fl: string | null;
  b: [string | null, string | null][];
  a: [string | null, string | null, number, number];
  n: string;
}
type CfDef =
  | { t: 'cellIs'; op: string; fm: string[]; ref: string; fill: string | null; font: string | null }
  | { t: 'dup'; ref: string; fill: string | null; font: string | null }
  | { t: 'text'; text: string; ref: string; fill: string | null; font: string | null };

export interface SheetSpec {
  name: string;
  tab: string | null;
  grid: boolean;
  zoom: number | null;
  freeze: string | null;
  filter: string | null;
  cols: [number, number | null, number, number][];
  rows: Record<string, number>;
  merges: string[];
  styles: StyleDef[];
  cells: [number, number, Val, number][];
  cf: CfDef[];
}

export interface SpecContext {
  /** Nama perusahaan aktif; menggantikan judul perusahaan bawaan acuan. */
  companyName?: string;
}

const ACUAN_COMPANY = 'PT BALILOOK INDONESIA TRAVEL';

function colNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function splitRef(ref: string): { c: number; r: number } {
  const m = /^([A-Z]+)(\d+)$/.exec(ref)!;
  return { c: colNum(m[1]), r: Number(m[2]) };
}

function colLetters(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * Geser semua kolom mulai `fromCol` ke kiri sebanyak `by` kolom (kolom `fromCol-by` s.d. `fromCol-1` ditutup).
 * Sel, lebar kolom, filter, aturan highlight, dan rumus yang menunjuk ke kolom yang digeser ikut disesuaikan.
 */
export function shiftSpecColumns(spec: SheetSpec, fromCol: number, by: number): SheetSpec {
  const gapStart = fromCol - by;
  const shiftCol = (n: number) => (n >= fromCol ? n - by : n);
  const shiftA1 = (s: string) =>
    s.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (m, d1: string, col: string, d2: string, row: string) => {
      const n = colNum(col);
      return n >= fromCol ? `${d1}${colLetters(n - by)}${d2}${row}` : m;
    });
  const shiftFormula = (f: string) =>
    f.replace(/(^|[^A-Za-z0-9_!.$:'])(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g, (_m, pre: string, ref: string) => pre + shiftA1(ref));
  return {
    ...spec,
    cells: spec.cells
      .filter(([, c]) => c < gapStart || c >= fromCol)
      .map(([r, c, v, s]) => [
        r, shiftCol(c),
        v && typeof v === 'object' && 'f' in v ? { f: shiftFormula(v.f) } : v,
        s,
      ] as SheetSpec['cells'][number]),
    cols: spec.cols
      .filter(([i]) => i < gapStart || i >= fromCol)
      .map(([i, ...rest]) => [shiftCol(i), ...rest] as SheetSpec['cols'][number]),
    merges: spec.merges.map(shiftA1),
    filter: spec.filter ? shiftA1(spec.filter) : null,
    cf: spec.cf.map(rule => ({ ...rule, ref: shiftA1(rule.ref) } as CfDef)),
  };
}

/** Tukar posisi kolom sesuai `map` (kolom lama -> kolom baru); rumus yang menunjuk ke kolom itu ikut disesuaikan. */
export function permuteSpecColumns(spec: SheetSpec, map: Record<number, number>): SheetSpec {
  const to = (n: number) => map[n] ?? n;
  const mapA1 = (s: string) =>
    s.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_m, d1: string, col: string, d2: string, row: string) =>
      `${d1}${colLetters(to(colNum(col)))}${d2}${row}`);
  const mapFormula = (f: string) =>
    f.replace(/(^|[^A-Za-z0-9_!.$:'])(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g, (_m, pre: string, ref: string) => pre + mapA1(ref));
  return {
    ...spec,
    cells: spec.cells.map(([r, c, v, s]) => [
      r, to(c),
      v && typeof v === 'object' && 'f' in v ? { f: mapFormula(v.f) } : v,
      s,
    ] as SheetSpec['cells'][number]),
    cols: spec.cols.map(([i, ...rest]) => [to(i), ...rest] as SheetSpec['cols'][number]),
  };
}

/** Buang sel tertentu ([baris, kolom]) dari spesifikasi, mis. judul lama yang diganti blok judul baru. */
export function dropSpecCells(spec: SheetSpec, addrs: [number, number][]): SheetSpec {
  const drop = new Set(addrs.map(([r, c]) => `${r}:${c}`));
  return { ...spec, cells: spec.cells.filter(([r, c]) => !drop.has(`${r}:${c}`)) };
}

/** Buang seluruh isi baris tertentu dari spesifikasi. */
export function dropSpecRows(spec: SheetSpec, rows: number[]): SheetSpec {
  const drop = new Set(rows);
  return { ...spec, cells: spec.cells.filter(([r]) => !drop.has(r)) };
}

/**
 * Geser semua baris ke bawah sebanyak `by` (untuk memberi ruang blok judul di atas sheet).
 * Sel, tinggi baris, merge, freeze, filter, aturan highlight, dan rumus yang menunjuk baris di sheet yang sama ikut disesuaikan.
 * Referensi ke sheet lain (mis. TB!A:A) tidak diubah; baris terakhir Excel (1048576) tidak digeser.
 */
export function shiftSpecRows(spec: SheetSpec, by: number): SheetSpec {
  const MAX_ROW = 1048576;
  const shiftRow = (n: number) => (n >= MAX_ROW ? n : n + by);
  const shiftA1 = (s: string) =>
    s.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_m, d1: string, col: string, d2: string, row: string) =>
      `${d1}${col}${d2}${shiftRow(Number(row))}`);
  const shiftFormula = (f: string) =>
    f.replace(/(^|[^A-Za-z0-9_!.$:'])(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g, (_m, pre: string, ref: string) => pre + shiftA1(ref));
  return {
    ...spec,
    cells: spec.cells.map(([r, c, v, s]) => [
      shiftRow(r), c,
      v && typeof v === 'object' && 'f' in v ? { f: shiftFormula(v.f) } : v,
      s,
    ] as SheetSpec['cells'][number]),
    rows: Object.fromEntries(Object.entries(spec.rows).map(([r, h]) => [String(shiftRow(Number(r))), h])),
    merges: spec.merges.map(shiftA1),
    freeze: spec.freeze ? shiftA1(spec.freeze) : null,
    filter: spec.filter ? shiftA1(spec.filter) : null,
    cf: spec.cf.map(rule => ({ ...rule, ref: shiftA1(rule.ref) } as CfDef)),
  };
}

const HIGHLIGHT_RED = { fill: 'FFFFC7CE', font: 'FF9C0006' };

/**
 * Ganti semua aturan highlight acuan (yang menunjuk sel/baris tertentu milik satu PT) dengan aturan berbasis DATA
 * untuk seluruh tabel: angka negatif -> merah muda, dan kode akun duplikat -> merah muda.
 * Dengan begitu warna mengikuti isi sel, bukan posisi baris/kolom, jadi tetap benar walau urutan akun tiap PT berbeda.
 */
export function normalizeSpecCf(spec: SheetSpec, opts: { negative: string; duplicates: string }): SheetSpec {
  return {
    ...spec,
    cf: [
      { t: 'dup', ref: opts.duplicates, ...HIGHLIGHT_RED },
      { t: 'cellIs', op: 'lessThan', fm: ['0'], ref: opts.negative, ...HIGHLIGHT_RED },
    ],
  };
}

export function applySheetSpec(ws: Worksheet, spec: SheetSpec, ctx: SpecContext = {}): void {
  // Kolom: lebar, tersembunyi, grup.
  for (const [i, width, hidden, outline] of spec.cols) {
    const col = ws.getColumn(i);
    if (width) col.width = width;
    if (hidden) col.hidden = true;
    if (outline) col.outlineLevel = outline;
  }
  for (const [r, h] of Object.entries(spec.rows)) ws.getRow(Number(r)).height = h;

  // Gaya per indeks.
  const border = (b: [string | null, string | null]): Partial<Border> | undefined =>
    b[0] ? ({ style: b[0], color: b[1] ? { argb: b[1] } : undefined } as Partial<Border>) : undefined;
  const styleOf = (s: StyleDef) => {
    const [name, size, bold, italic, underline, color] = s.f;
    return {
      font: {
        name: name ?? 'Calibri',
        size: size ?? 11,
        bold: !!bold,
        italic: !!italic,
        underline: underline ? true : undefined,
        color: color ? { argb: color } : undefined,
      },
      fill: s.fl ? ({ type: 'pattern', pattern: 'solid', fgColor: { argb: s.fl } } as const) : undefined,
      border: {
        left: border(s.b[0]),
        right: border(s.b[1]),
        top: border(s.b[2]),
        bottom: border(s.b[3]),
      } as Partial<Borders>,
      alignment: {
        horizontal: (s.a[0] ?? undefined) as Alignment['horizontal'],
        vertical: (s.a[1] ?? undefined) as Alignment['vertical'],
        wrapText: !!s.a[2],
        indent: s.a[3] || undefined,
      } as Partial<Alignment>,
      numFmt: s.n && s.n !== 'General' ? s.n : undefined,
    };
  };
  const styles = spec.styles.map(styleOf);

  for (const [r, c, v, si] of spec.cells) {
    const cell = ws.getCell(r, c);
    if (v !== null) {
      if (typeof v === 'object') {
        if ('f' in v) cell.value = { formula: v.f };
        else cell.value = new Date(`${v.d}T00:00:00Z`);
      } else if (v === ACUAN_COMPANY && ctx.companyName) {
        cell.value = ctx.companyName;
      } else {
        cell.value = v;
      }
    }
    const st = styles[si];
    cell.font = st.font;
    if (st.fill) cell.fill = st.fill;
    cell.border = st.border;
    cell.alignment = st.alignment;
    if (st.numFmt) cell.numFmt = st.numFmt;
  }

  for (const m of spec.merges) ws.mergeCells(m);

  // Tampilan.
  if (spec.freeze) {
    const { c, r } = splitRef(spec.freeze);
    ws.views = [{
      state: 'frozen', xSplit: c - 1, ySplit: r - 1, topLeftCell: spec.freeze, activeCell: spec.freeze,
      showGridLines: spec.grid, zoomScale: spec.zoom ?? undefined,
    }];
  } else {
    ws.views = [{ showGridLines: spec.grid, zoomScale: spec.zoom ?? undefined }];
  }
  if (spec.filter) ws.autoFilter = spec.filter;
  if (spec.tab) ws.properties.tabColor = { argb: spec.tab };

  // Aturan highlight.
  let priority = 1;
  for (const rule of spec.cf) {
    const style = {
      font: rule.font ? { color: { argb: rule.font } } : undefined,
      fill: rule.fill
        ? ({ type: 'pattern', pattern: 'solid', bgColor: { argb: rule.fill } } as const)
        : undefined,
    };
    if (rule.t === 'cellIs') {
      ws.addConditionalFormatting({
        ref: rule.ref,
        rules: [{ type: 'cellIs', operator: rule.op as never, formulae: rule.fm, priority: priority++, style }],
      });
    } else if (rule.t === 'dup') {
      const first = rule.ref.split(':')[0];
      const { c, r } = splitRef(first);
      const abs = rule.ref.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2');
      ws.addConditionalFormatting({
        ref: rule.ref,
        rules: [{
          type: 'expression', priority: priority++, style,
          formulae: [`AND(${colLetters(c)}${r}<>"",COUNTIF(${abs},${colLetters(c)}${r})>1)`],
        }],
      });
    } else {
      const first = rule.ref.split(' ')[0].split(':')[0];
      ws.addConditionalFormatting({
        ref: rule.ref,
        rules: [{
          type: 'containsText', operator: 'containsText', text: rule.text, priority: priority++, style,
          formulae: [`NOT(ISERROR(SEARCH("${rule.text}",${first})))`],
        } as never],
      });
    }
  }
}