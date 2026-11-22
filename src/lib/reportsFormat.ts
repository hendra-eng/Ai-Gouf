// Format bersama untuk SEMUA sheet workbook Financial Statement (halaman Reports).
// - Satu jenis & ukuran font untuk seluruh sheet (ubah di sini kalau mau ganti).
// - Header: rata tengah, hijau tua, teks putih; 1 baris (tidak turun ke bawah), tidak terpotong (lebar kolom menyesuaikan
//   teks + tombol filter), rata tengah, dan tinggi baris header SAMA di semua sheet.
// - Baris atas tidak dikunci (ikut GL).

import type { Worksheet } from 'exceljs';

export const REPORT_FONT_NAME = 'Arial';
export const REPORT_FONT_SIZE = 10;

/** Warna header (hijau tua), sama di semua sheet. Teks header putih tebal. */
export const HEADER_FILL_ARGB = 'FF385623';

/** Tinggi baris header (poin), sama untuk semua header di semua sheet. */
export const HEADER_ROW_HEIGHT = 20;

/** Perkiraan lebar teks header (tebal) dalam satuan lebar kolom Excel. */
function textWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === ' ') w += 0.55;
    else if (/[A-Z0-9]/.test(ch)) w += 1.15;
    else if (/[a-z]/.test(ch)) w += 1.0;
    else w += 0.8; // tanda baca, dsb.
  }
  return w;
}

const PAD_PLAIN = 2; // ruang kiri-kanan
const PAD_FILTER = 4; // ruang tambahan untuk tombol filter

const BLACK_THIN = { style: 'thin', color: { argb: 'FF000000' } } as const;

/** Beri garis hitam penuh (semua sisi) pada setiap sel di rentang, supaya tabel tidak bolong-bolong. */
export function boxBorders(ws: Worksheet, fromRow: number, toRow: number, fromCol: number, toCol: number): void {
  for (let r = fromRow; r <= toRow; r++) {
    for (let c = fromCol; c <= toCol; c++) {
      ws.getCell(r, c).border = { left: BLACK_THIN, right: BLACK_THIN, top: BLACK_THIN, bottom: BLACK_THIN };
    }
  }
}

function filterColOf(ws: Worksheet): number {
  const af = ws.autoFilter as unknown;
  if (typeof af === 'string') {
    const m = /^([A-Z]+)\d+/.exec(af);
    if (m) return [...m[1]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  }
  return 1;
}

function filterRowOf(ws: Worksheet): number | null {
  const af = ws.autoFilter as unknown;
  if (typeof af === 'string') {
    const m = /^[A-Z]+(\d+)/.exec(af);
    return m ? Number(m[1]) : null;
  }
  const from = (af as { from?: { row?: number } } | undefined)?.from;
  return from?.row ?? null;
}

/** Rapikan baris header: 1 baris, tidak terpotong, rata tengah, tinggi seragam. */
export function polishHeaderRows(ws: Worksheet, rows: number[], lastCol?: number): void {
  const fRow = filterRowOf(ws);
  const fCol = filterColOf(ws);
  for (const r of rows) {
    const row = ws.getRow(r);
    // Pastikan semua kolom tabel di baris header ikut jadi header (termasuk sel kosong / baris filter).
    if (lastCol) for (let c = fCol; c <= lastCol; c++) row.getCell(c);
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const b = cell.border;
      const hasBorder = !!(b && (b.left || b.right || b.top || b.bottom));
      const inTable = !!lastCol && colNumber >= fCol && colNumber <= lastCol;
      const isHeaderCell = cell.value !== null && cell.value !== undefined && cell.value !== ''
        ? true
        : cell.isMerged || hasBorder || inTable;
      if (isHeaderCell) {
        // Semua header: rata tengah, hijau tua, teks putih tebal.
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
        cell.font = { ...cell.font, bold: true, color: { argb: 'FFFFFFFF' } };
        // Garis pinggir hitam di semua sisi sel header (termasuk di bawah kolom).
        cell.border = { left: BLACK_THIN, right: BLACK_THIN, top: BLACK_THIN, bottom: BLACK_THIN };
      }
      if (cell.value === null || cell.value === undefined) return;
      const col = ws.getColumn(colNumber);
      if (col.hidden || cell.isMerged) return;
      const v = cell.value;
      let need = 0;
      const pad = r === fRow ? PAD_FILTER : PAD_PLAIN;
      if (typeof v === 'string') need = Math.ceil(textWidth(v) + pad);
      else if (v instanceof Date || (v && typeof v === 'object')) need = 12; // tanggal / rumus
      if (need > (col.width ?? 8.43)) col.width = need;
    });
    row.height = HEADER_ROW_HEIGHT;
  }
}

/** Paksa semua sel memakai font & ukuran yang sama (gaya tebal/miring/warna tetap). */
export function normalizeFonts(ws: Worksheet, titleRows = 0): void {
  ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      // Baris blok judul menyimpan ukuran hurufnya sendiri; hanya jenis font yang diseragamkan.
      cell.font = rowNumber <= titleRows
        ? { ...cell.font, name: REPORT_FONT_NAME }
        : { ...cell.font, name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE };
    });
  });
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
 * Semua sheet mengikuti GL: baris atas TIDAK dikunci (ikut bergulir saat di-scroll).
 * Kolom yang sudah terkunci di kiri tetap dipertahankan.
 */
export function unfreezeTopRows(ws: Worksheet): void {
  const v = ws.views?.[0];
  if (!v) return;
  const common = { showGridLines: v.showGridLines, zoomScale: v.zoomScale };
  const x = v.state === 'frozen' ? (v.xSplit ?? 0) : 0;
  ws.views = x > 0
    ? [{ ...common, state: 'frozen', xSplit: x, ySplit: 0, topLeftCell: `${colLetters(x + 1)}1`, activeCell: `${colLetters(x + 1)}1` }]
    : [{ ...common }];
}

/**
 * Warna manual di baris akun (kuning, oranye, dst.) yang di workbook acuan menempel di posisi baris tertentu diubah
 * jadi aturan conditional formatting yang dikunci ke KODE AKUN di kolom `codeCol`.
 * Hasilnya warna selalu jatuh di akun yang sama, di baris mana pun akun itu berada untuk PT yang berbeda.
 * Hanya baris yang kode akunnya angka yang diproses; baris judul/total (TOTAL ASSET, CONTROL, PROFIT (LOSS)) tetap statis.
 */
export function highlightByAccount(
  ws: Worksheet,
  opts: { codeCol: number; firstRow: number; lastRow: number },
): void {
  const { codeCol, firstRow, lastRow } = opts;
  const groups = new Map<string, { argb: string; c1: number; c2: number; codes: number[] }>();
  const solidArgb = (cell: { fill?: unknown }): string | null => {
    const f = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
    return f && f.type === 'pattern' && f.pattern === 'solid' && f.fgColor?.argb ? f.fgColor.argb : null;
  };

  for (let r = firstRow; r <= lastRow; r++) {
    const code = ws.getCell(r, codeCol).value;
    if (typeof code !== 'number') continue;
    const row = ws.getRow(r);
    let runStart = 0;
    let runColor: string | null = null;
    const flush = (endCol: number) => {
      if (runColor && runStart) {
        const key = `${runColor}|${runStart}|${endCol}`;
        const g = groups.get(key) ?? { argb: runColor, c1: runStart, c2: endCol, codes: [] };
        g.codes.push(code);
        groups.set(key, g);
      }
      runColor = null;
      runStart = 0;
    };
    const lastCol = Math.max(row.cellCount, ws.columnCount);
    for (let c = 1; c <= lastCol + 1; c++) {
      const cell = row.getCell(c);
      const argb = c <= lastCol ? solidArgb(cell) : null;
      if (argb !== runColor) {
        flush(c - 1);
        if (argb) { runColor = argb; runStart = c; }
      }
      if (argb) cell.fill = { type: 'pattern', pattern: 'none' };
    }
  }

  const codeLetter = colLetters(codeCol);
  let priority = 100;
  for (const g of groups.values()) {
    const ref = `${colLetters(g.c1)}${firstRow}:${colLetters(g.c2)}${lastRow}`;
    // Daftar kode dipecah per 100 supaya rumus tidak kepanjangan.
    for (let i = 0; i < g.codes.length; i += 100) {
      const list = g.codes.slice(i, i + 100).join(',');
      ws.addConditionalFormatting({
        ref,
        rules: [{
          type: 'expression',
          priority: priority++,
          formulae: [`ISNUMBER(MATCH($${codeLetter}${firstRow},{${list}},0))`],
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: g.argb } } },
        }],
      });
    }
  }
}

// ── Blok judul di atas setiap sheet ─────────────────────────────────────────
// Baris 1 nama PT, baris 2 judul sheet, baris 3 periode, baris 4 deskripsi (bahasa Indonesia), baris 5 pemisah.
// Header & tabel setiap sheet dimulai tepat di bawah blok ini (lihat TITLE_BLOCK_ROWS di reportsWorkbook.ts).

export const TITLE_BLOCK_ROWS = 5;

export type TitlePeriodKind = 'range' | 'asof' | 'year';

export interface SheetTitle {
  /** Judul sheet (bahasa Indonesia). */
  title: string;
  /** Deskripsi singkat isi sheet (bahasa Indonesia). */
  description: string;
  /** range = "Periode 1 Januari – 31 Oktober 2026", asof = "Per 31 Oktober 2026", year = "Tahun buku 2026". */
  period: TitlePeriodKind;
  /** Kolom awal teks (kolom pertama yang tampil) dan kolom akhir lebar deskripsi. */
  firstCol: number;
  lastCol: number;
}

const BULAN_ID = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

export function periodTextId(kind: TitlePeriodKind, year: number, endMonth: number): string {
  const lastDay = new Date(year, endMonth, 0).getDate();
  const end = `${lastDay} ${BULAN_ID[endMonth - 1]} ${year}`;
  if (kind === 'asof') return `Per ${end}`;
  if (kind === 'year') return `Tahun buku ${year}`;
  return `Periode 1 Januari - ${end}`;
}

export function writeTitleBlock(
  ws: Worksheet,
  ctx: { companyName: string; year: number; endMonth: number },
  t: SheetTitle,
): void {
  const base = { name: REPORT_FONT_NAME };
  const left = { horizontal: 'left', vertical: 'middle' } as const;

  const company = ws.getCell(1, t.firstCol);
  company.value = ctx.companyName;
  company.font = { ...base, size: 14, bold: true };
  company.alignment = left;

  const title = ws.getCell(2, t.firstCol);
  title.value = t.title;
  title.font = { ...base, size: 12, bold: true };
  title.alignment = left;

  const period = ws.getCell(3, t.firstCol);
  period.value = periodTextId(t.period, ctx.year, ctx.endMonth);
  period.font = { ...base, size: REPORT_FONT_SIZE };
  period.alignment = left;

  const desc = ws.getCell(4, t.firstCol);
  desc.value = t.description;
  desc.font = { ...base, size: REPORT_FONT_SIZE, italic: true, color: { argb: 'FF595959' } };
  desc.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
  ws.mergeCells(4, t.firstCol, 4, t.lastCol);

  // Tinggi baris deskripsi mengikuti perkiraan jumlah baris teks (lebar kolom yang tampil, tanpa kolom tersembunyi).
  let width = 0;
  for (let c = t.firstCol; c <= t.lastCol; c++) {
    const col = ws.getColumn(c);
    if (!col.hidden) width += col.width ?? 8.43;
  }
  const lines = Math.max(1, Math.ceil(t.description.length / Math.max(width * 0.95, 20)));
  ws.getRow(1).height = 22;
  ws.getRow(2).height = 18;
  ws.getRow(3).height = 15;
  ws.getRow(4).height = lines * 13.5 + 3;
  ws.getRow(5).height = 8;
}