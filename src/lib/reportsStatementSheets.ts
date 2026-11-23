// Isi sheet "BS" (Neraca) dan "PNL CF" (Laba Rugi) untuk workbook Financial Statement (halaman Reports).
//
// Keduanya dibangun dari sheet TB (bukan dari endpoint financial-statements yang hanya membaca jurnal posted),
// jadi seluruh workbook memakai dasar data yang sama: Journal Preview semua status (rantai GL -> TB -> BS / PNL CF).
// Tiap sel angka = rujukan langsung ke sel sheet TB (=TB!J14, dst.) pada baris akun yang sama; baris total berupa SUM.
// Daftar akun mengikuti TB (yang berasal dari COA klien), sehingga susunan akun tiap PT otomatis menyesuaikan.
//
// Kolom nilai (15 kolom berurutan): saldo awal 2 tahun lalu, saldo awal tahun lalu, Jan..Des (Balance after ADJ TB), YTD.
//   BS     : D..R   (kode di B, nama di C, Check di S)
//   PNL CF : G..U   (kode di E, nama di F, Check di V)
// Status Transaksi tiap baris diturunkan dari status akun di TB (ditulis oleh addStatusColumn di reportsWorkbook).

import type { Worksheet } from 'exceljs';
import { boxBorders } from './reportsFormat';
import { colLetter, tbColAfter, TB_COL_YTD, type TbRowRef, type TbSheetResult } from './reportsTbSheet';
import type { TbGroup, TrialBalance } from './trialBalanceStore';

const NUM_ACCT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const FILL_LABEL = 'FFE2EFDA';
const FILL_TOTAL = 'FFF2F2F2';
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Kolom sheet TB yang dirujuk untuk 15 kolom nilai: C, D, Balance after ADJ Jan..Des, YTD. */
const TB_SOURCE_COLS = [3, 4, ...Array.from({ length: 12 }, (_, i) => tbColAfter(i + 1)), TB_COL_YTD];

const asCode = (s: string): number | string => (/^\d+$/.test(s) ? Number(s) : s);

/**
 * Rujukan ke sel sheet TB. Workbook penuh: `TB!J14`. Mode sheet tunggal (tbValues ada, sheet TB tidak ikut di file):
 * diganti angka hasil hitung yang sama dengan isi sel itu (negatif diberi kurung supaya aman di dalam rumus).
 */
function tbRefOf(tbValues: Map<number, number[]> | undefined, tbCol: number, row: number): string {
  if (!tbValues) return `TB!${colLetter(tbCol)}${row}`;
  const idx = TB_SOURCE_COLS.indexOf(tbCol);
  const v = Number(((tbValues.get(row) ?? [])[idx] ?? 0).toFixed(6));
  return v < 0 ? `(${v})` : String(v);
}

export interface StatementResult {
  firstDataRow: number;
  lastRow: number;
  /** status[i] = Status Transaksi baris firstDataRow + i ('' = baris judul/total). */
  statuses: string[];
  /** Hanya PNL CF: nomor baris SELISIH (profit terhadap TB, saldo kas/bank terhadap TB) dan rentang kolom nilainya; dipakai untuk catatan AI. */
  selisih?: { profit?: number; kas?: number; firstCol: number; lastCol: number };
}

interface Layout {
  codeCol: number;
  nameCol: number;
  /** Kolom label judul/total (BS di B, PNL CF di E). */
  labelCol: number;
  firstValueCol: number;
  checkCol: number;
  firstRow: number;
}

const BS_LAYOUT = (top: number): Layout => ({ codeCol: 2, nameCol: 3, labelCol: 2, firstValueCol: 4, checkCol: 19, firstRow: 5 + top });
const PNL_LAYOUT = (top: number): Layout => ({ codeCol: 5, nameCol: 6, labelCol: 5, firstValueCol: 7, checkCol: 22, firstRow: 6 + top });

/** Judul kolom ber-tahun (acuan hardcode 2026) diganti sesuai tahun terpilih, format "Jan-2026". */
function relabelHeaders(ws: Worksheet, headerRow: number, firstValueCol: number, year: number): void {
  const labels = [`Dec-${year - 2}`, `Dec-${year - 1}`, ...MON.map(m => `${m}-${year}`), `YTD ${year}`];
  labels.forEach((t, i) => { ws.getCell(headerRow, firstValueCol + i).value = t; });
}

/** Penulis baris bersama untuk BS dan PNL CF. */
function makeWriter(ws: Worksheet, lay: Layout, tbValues?: Map<number, number[]>) {
  const lastValueCol = lay.firstValueCol + TB_SOURCE_COLS.length - 1;
  const statuses: string[] = [];
  let r = lay.firstRow;

  const band = (row: number, fill: string) => {
    for (let c = 1; c <= lay.checkCol; c++) {
      const cell = ws.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.font = { bold: true };
    }
  };
  const next = (status = ''): number => {
    statuses.push(status);
    return r++;
  };

  return {
    get row() { return r; },
    statuses,
    lastValueCol,
    label(text: string): number {
      const row = next();
      ws.getCell(row, lay.labelCol).value = text;
      band(row, FILL_LABEL);
      return row;
    },
    blank(): number { return next(); },
    account(ref: TbRowRef): number {
      const row = next(ref.status);
      if (ref.code) ws.getCell(row, lay.codeCol).value = asCode(ref.shownCode || ref.code);
      // Mode sheet tunggal (tbValues ada): sheet TB tidak ikut di file, jadi nama & angka ditulis sebagai nilai.
      const own = tbValues?.get(ref.row);
      ws.getCell(row, lay.nameCol).value = own ? ref.name : { formula: `TB!B${ref.row}` };
      TB_SOURCE_COLS.forEach((tc, i) => {
        const cell = ws.getCell(row, lay.firstValueCol + i);
        cell.value = own ? (own[i] ?? 0) : { formula: `TB!${colLetter(tc)}${ref.row}` };
        cell.numFmt = NUM_ACCT;
      });
      ws.getCell(row, lay.checkCol).value = {
        formula: `SUM(${colLetter(lay.firstValueCol)}${row}:${colLetter(lastValueCol)}${row})<>0`,
      };
      return row;
    },
    /** Baris total: `build(L)` menghasilkan rumus untuk kolom bernama L; `from` kolom nilai pertama yang diisi. */
    total(text: string, build: (L: string) => string, fromIndex = 0): number {
      const row = next();
      ws.getCell(row, lay.labelCol).value = text;
      band(row, FILL_TOTAL);
      for (let i = fromIndex; i < TB_SOURCE_COLS.length; i++) {
        const cell = ws.getCell(row, lay.firstValueCol + i);
        cell.value = { formula: build(colLetter(lay.firstValueCol + i)) };
        cell.numFmt = NUM_ACCT;
      }
      return row;
    },
    /** Baris biasa (tanpa warna latar) berisi rumus per kolom bulan. */
    line(text: string, build: (L: string) => string, fromIndex = 0): number {
      const row = next();
      ws.getCell(row, lay.labelCol).value = text;
      for (let i = fromIndex; i < TB_SOURCE_COLS.length; i++) {
        const cell = ws.getCell(row, lay.firstValueCol + i);
        cell.value = { formula: build(colLetter(lay.firstValueCol + i)) };
        cell.numFmt = NUM_ACCT;
      }
      return row;
    },
    sum(from: number, to: number) {
      return (L: string) => (to < from ? '0' : `SUM(${L}${from}:${L}${to})`);
    },
    finish(): StatementResult {
      const lastRow = r - 1;
      for (let row = lay.firstRow; row <= lastRow; row++) {
        ws.getCell(row, lay.checkCol).alignment = { horizontal: 'center' };
        for (let c = lay.firstValueCol; c <= lastValueCol; c++) {
          const cell = ws.getCell(row, c);
          if (!cell.numFmt) cell.numFmt = NUM_ACCT;
        }
      }
      boxBorders(ws, lay.firstRow, lastRow, 1, lay.checkCol);
      return { firstDataRow: lay.firstRow, lastRow, statuses: statuses.slice() };
    },
  };
}

/** Akun aset tetap (termasuk kontra seperti akumulasi penyusutan) dipisah dari aset lancar lewat Category COA. */
const FIXED_ASSET_RE = /fix|tetap|non[\s-]*current/i;

// ── BS ───────────────────────────────────────────────────────────────────────
export function fillBsSheet(
  ws: Worksheet,
  tbSheet: TbSheetResult | null | undefined,
  /** kode akun -> Category COA (account_sub), untuk memisahkan aset lancar & aset tetap. */
  categoryOf: (code: string) => string | null | undefined,
  top: number,
  year: number,
): StatementResult {
  const lay = BS_LAYOUT(top);
  relabelHeaders(ws, 4 + top, lay.firstValueCol, year);
  if (!tbSheet || !tbSheet.refs.length) return { firstDataRow: lay.firstRow, lastRow: lay.firstRow - 1, statuses: [] };

  const w = makeWriter(ws, lay, tbSheet.values);
  const of = (key: string) => tbSheet.refs.filter(x => x.group === key);
  const block = (refs: TbRowRef[]) => {
    const from = w.row;
    refs.forEach(x => w.account(x));
    return { from, to: w.row - 1 };
  };

  w.label('ASSETS');
  const assets = of('ASSET');
  const fixed = assets.filter(x => FIXED_ASSET_RE.test(categoryOf(x.code) ?? ''));
  const current = assets.filter(x => !fixed.includes(x));
  const assetTotals: number[] = [];
  if (fixed.length) {
    w.label('CURRENT ASSETS');
    const b = block(current);
    assetTotals.push(w.total('TOTAL CURRENT ASSETS', w.sum(b.from, b.to)));
    w.blank();
    w.label('FIX ASSETS');
    const f = block(fixed);
    assetTotals.push(w.total('TOTAL FIX ASSETS', w.sum(f.from, f.to)));
  } else {
    const b = block(current);
    assetTotals.push(w.total('TOTAL CURRENT ASSETS', w.sum(b.from, b.to)));
  }
  const totalAssets = w.total('TOTAL ASSETS', L => assetTotals.map(x => `${L}${x}`).join('+'));
  w.blank();

  w.label('LIABILITIES AND EQUITIES');
  w.label('LIABILITIES');
  const l = block(of('LIABILITY'));
  const totalLiab = w.total('TOTAL LIABILITAS', w.sum(l.from, l.to));
  w.blank();
  w.label('EKUITAS');
  const e = block(of('EQUITY'));
  const totalEq = w.total('TOTAL EKUITAS', w.sum(e.from, e.to));
  const totalLe = w.total('TOTAL LIABILITAS DAN EKUITAS', L => `${L}${totalLiab}+${L}${totalEq}`);
  w.total('CONTROL', L => `${L}${totalAssets}-${L}${totalLe}`);

  return w.finish();
}

// ── PNL CF ───────────────────────────────────────────────────────────────────
export function fillPnlSheet(
  ws: Worksheet,
  tb: TrialBalance | null | undefined,
  tbSheet: TbSheetResult | null | undefined,
  top: number,
  year: number,
  /** kode akun -> Category COA (account_sub), untuk memisahkan akun kas/bank, aset tetap, dan utang jangka panjang di arus kas. */
  categoryOf: (code: string) => string | null | undefined = () => null,
): StatementResult {
  const lay = PNL_LAYOUT(top);
  relabelHeaders(ws, 5 + top, lay.firstValueCol, year);
  if (!tb || !tbSheet || !tbSheet.refs.length) return { firstDataRow: lay.firstRow, lastRow: lay.firstRow - 1, statuses: [] };

  const w = makeWriter(ws, lay, tbSheet.values);
  const groupByKey = new Map<string, TbGroup>(tb.groups.filter(g => g.tipe === 'pnl').map(g => [g.key, g]));
  const totals = new Map<string, number>();

  // Urutan seperti acuan: pendapatan, pendapatan lain, HPP, beban operasional, beban non-operasional.
  const ORDER = ['REVENUE', 'OTHER INCOME', 'COST OF SALES', 'EXPENSE', 'OTHER EXPENSE'];
  const section = (key: string) => {
    const g = groupByKey.get(key);
    if (!g) return;
    w.label(g.label);
    const from = w.row;
    tbSheet.refs.filter(x => x.group === key).forEach(x => w.account(x));
    totals.set(key, w.total(`TOTAL ${g.label}`, w.sum(from, w.row - 1)));
    w.blank();
  };
  ORDER.forEach(section);

  const plus = (L: string, keys: string[]) => keys.filter(k => totals.has(k)).map(k => `${L}${totals.get(k)}`);
  const profitBefore = w.total('PROFIT/(LOSS) BEFORE TAX', L => {
    const inc = plus(L, ['REVENUE', 'OTHER INCOME']);
    const exp = plus(L, ['COST OF SALES', 'EXPENSE', 'OTHER EXPENSE']);
    return `${inc.length ? inc.join('+') : '0'}${exp.length ? `-(${exp.join('+')})` : ''}`;
  });

  let finalRow = profitBefore;
  if (groupByKey.has('INCOME TAX')) {
    w.blank();
    section('INCOME TAX');
    finalRow = w.total('PROFIT/(LOSS) AFTER TAX', L => `${L}${profitBefore}-${L}${totals.get('INCOME TAX')}`);
  }
  w.blank();

  // Cek terhadap baris PROFIT (LOSS) di TB: seharusnya 0 di setiap bulan dan YTD (dimulai dari kolom Jan).
  let profitDiffRow: number | undefined;
  if (tbSheet.profitRow) {
    profitDiffRow = w.total('SELISIH TERHADAP TB (PROFIT/LOSS)', L => {
      const idx = L.length === 1 ? L.charCodeAt(0) - 64 : 26 * (L.charCodeAt(0) - 64) + (L.charCodeAt(1) - 64);
      const tbCol = TB_SOURCE_COLS[idx - lay.firstValueCol];
      return `${tbRefOf(tbSheet.values, tbCol, tbSheet.profitRow)}-${L}${finalRow}`;
    }, 2);
  }

  const cashDiffRow = fillCashFlow(w, tbSheet, categoryOf, lay.firstValueCol, finalRow);

  return { ...w.finish(), selisih: { profit: profitDiffRow, kas: cashDiffRow, firstCol: lay.firstValueCol, lastCol: w.lastValueCol } };
}

// ── Arus kas (metode tidak langsung) ─────────────────────────────────────────
const CASH_RE = /\b(kas|bank|cash)\b/i;
const ACCUM_RE = /akumulasi|accum/i;
const NONCURRENT_LIAB_RE = /long|non[\s-]*current|panjang/i;
const MONTH_FIRST_IDX = 2; // indeks kolom nilai Jan (0 = Dec-2 tahun lalu, 1 = saldo awal)
const YTD_IDX = TB_SOURCE_COLS.length - 1;

const colNum = (L: string): number => (L.length === 1 ? L.charCodeAt(0) - 64 : 26 * (L.charCodeAt(0) - 64) + (L.charCodeAt(1) - 64));

/**
 * Laporan arus kas dari perubahan saldo akun neraca di sheet TB (rumus Excel, per bulan + YTD):
 *   Operasional  = laba setelah pajak + penyusutan (perubahan akumulasi) - kenaikan aset lancar non-kas + kenaikan utang lancar
 *   Investasi    = - kenaikan aset tetap (bruto)
 *   Pembiayaan   = perubahan utang jangka panjang + perubahan akun ekuitas (modal, dividen, dll.)
 * Baris laba tahun berjalan / laba tahun lalu di ekuitas tidak dihitung lagi (sudah ada lewat laba bersih).
 * Penutup: saldo kas awal + kenaikan kas = saldo kas akhir, dicek terhadap akun kas/bank di TB (harus 0).
 */
function fillCashFlow(
  w: ReturnType<typeof makeWriter>,
  tbSheet: TbSheetResult,
  categoryOf: (code: string) => string | null | undefined,
  firstValueCol: number,
  profitRow: number,
): number {
  const accounts = tbSheet.refs.filter(x => x.kind === 'account');
  const isCash = (x: TbRowRef) => x.group === 'ASSET' && (CASH_RE.test(categoryOf(x.code) ?? '') || CASH_RE.test(x.name));
  const isFixed = (x: TbRowRef) => FIXED_ASSET_RE.test(categoryOf(x.code) ?? '');
  const cash = accounts.filter(isCash);
  const assets = accounts.filter(x => x.group === 'ASSET' && !isCash(x));
  const accum = assets.filter(x => isFixed(x) && ACCUM_RE.test(x.name));
  const fixedGross = assets.filter(x => isFixed(x) && !ACCUM_RE.test(x.name));
  const current = assets.filter(x => !isFixed(x));
  const liabs = accounts.filter(x => x.group === 'LIABILITY');
  const liabLong = liabs.filter(x => NONCURRENT_LIAB_RE.test(categoryOf(x.code) ?? ''));
  const liabCurrent = liabs.filter(x => !liabLong.includes(x));
  const equity = accounts.filter(x => x.group === 'EQUITY');

  const tbCell = (L: string, offset: number, x: TbRowRef) => tbRefOf(tbSheet.values, TB_SOURCE_COLS[colNum(L) - firstValueCol + offset], x.row);
  /** Jumlah perubahan saldo bulan ini (kolom L) untuk sekumpulan akun; YTD = jumlah Jan..Des. */
  const delta = (xs: TbRowRef[], sign: 1 | -1) => (L: string) => {
    const i = colNum(L) - firstValueCol;
    if (!xs.length) return '0';
    if (i === YTD_IDX) return `SUM(${colLetter(firstValueCol + MONTH_FIRST_IDX)}{ROW}:${colLetter(firstValueCol + YTD_IDX - 1)}{ROW})`;
    const body = xs.map(x => `(${tbCell(L, 0, x)}-${tbCell(L, -1, x)})`).join('+');
    return `${sign < 0 ? '-' : ''}(${body})`;
  };
  // Baris `{ROW}` diganti nomor baris sebenarnya (rumus YTD merujuk baris yang sama).
  const flow = (text: string, build: (L: string) => string) => {
    const row = w.row;
    return w.line(text, L => build(L).replace(/\{ROW\}/g, String(row)), MONTH_FIRST_IDX);
  };
  const sumRows = (rows: number[]) => (L: string) => rows.map(r => `${L}${r}`).join('+') || '0';
  const sumCash = (offset: number) => (L: string) => {
    if (!cash.length) return '0';
    return cash.map(x => tbCell(L, offset, x)).join('+');
  };

  w.blank();
  w.label('CASH FLOW (METODE TIDAK LANGSUNG)');
  w.label('ARUS KAS DARI AKTIVITAS OPERASI');
  const ni = flow('Laba/(rugi) setelah pajak', L => `${L}${profitRow}`);
  const dep = flow('Penyusutan & amortisasi (perubahan akumulasi)', delta(accum, -1));
  const wcA = flow('(Kenaikan)/penurunan aset lancar selain kas', delta(current, -1));
  const wcL = flow('Kenaikan/(penurunan) utang lancar', delta(liabCurrent, 1));
  const op = w.total('ARUS KAS BERSIH DARI AKTIVITAS OPERASI', sumRows([ni, dep, wcA, wcL]), MONTH_FIRST_IDX);

  w.label('ARUS KAS DARI AKTIVITAS INVESTASI');
  const fa = flow('(Pembelian)/pelepasan aset tetap', delta(fixedGross, -1));
  const inv = w.total('ARUS KAS BERSIH DARI AKTIVITAS INVESTASI', sumRows([fa]), MONTH_FIRST_IDX);

  w.label('ARUS KAS DARI AKTIVITAS PENDANAAN');
  const ll = flow('Kenaikan/(penurunan) utang jangka panjang', delta(liabLong, 1));
  const eq = flow('Perubahan ekuitas (modal, dividen, dll.)', delta(equity, 1));
  const fin = w.total('ARUS KAS BERSIH DARI AKTIVITAS PENDANAAN', sumRows([ll, eq]), MONTH_FIRST_IDX);

  const net = w.total('KENAIKAN/(PENURUNAN) BERSIH KAS', sumRows([op, inv, fin]), MONTH_FIRST_IDX);
  const open = w.line('Saldo kas awal', L => (colNum(L) - firstValueCol === YTD_IDX ? sumCash(-(YTD_IDX - 1))(L) : sumCash(-1)(L)), MONTH_FIRST_IDX);
  const close = w.total('SALDO KAS AKHIR', L => `${L}${open}+${L}${net}`, MONTH_FIRST_IDX);
  return w.total('SELISIH TERHADAP SALDO KAS/BANK DI TB', L => {
    const i = colNum(L) - firstValueCol;
    const tbClose = i === YTD_IDX ? sumCash(-1)(L) : sumCash(0)(L);
    return `${L}${close}-(${tbClose})`;
  }, MONTH_FIRST_IDX);
}