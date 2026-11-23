// Isi sheet "GL" untuk workbook Financial Statement (halaman Reports).
// Disalin dari workbook acuan PT_BIT_WS_Financial_Statement, sheet GL:
//   - 30 kolom A-AD, header di baris 3 (tinggi 34,15), data mulai baris 5 (tanpa baris kosong setelah judul seksi)
//   - baris 1-2 = rumus bantu (cek selisih, total SUBTOTAL, contoh XLOOKUP/MONTH)
//   - baris judul seksi di kolom A (mis. "BANK BCA - JOURNAL") tebal & berborder
//   - kolom C = XLOOKUP nama akun dari sheet COA, E = MONTH(F), K = Debit - Kredit
//   - kolom A-B terkunci di kiri (baris atas tidak dikunci), autofilter di header, kolom L sampai Z digrup (outline 1)
//   - aturan highlight: VOC BANTU (V) duplikat & kolom Check (AA) berisi "x"
//
// TAHAP 1: yang dibawa hanya struktur + 10 baris CONTOH (seksi pertama acuan).
// Data transaksi sebenarnya diisi nanti dari General Ledger aplikasi.

import type { Worksheet, Borders, Alignment } from 'exceljs';
import { REPORT_FONT_NAME, REPORT_FONT_SIZE } from './reportsFormat';
import { addStatusColumn } from './reportsStatus';

type Cell = string | number | null | { formula: string };
export type GlCell = Cell;

export const GL_HEADERS = [
  'No', 'COA', 'AKUN', 'Bank', 'MONTH', 'Tanggal Transaksi', 'Keterangan', 'Supplier/Customer',
  'Debit', 'Kredit', 'Balance', 'Voucher Bantu', 'Payment ID', 'Order ID', 'Category',
  'rekon', 'selisih', 'Refund', 'Rekon Pendapatan', 'No Kamar/No Rekon', 'No Voucher Bantu',
  'VOC BANTU DI BUKU BANTU', 'LOOKUP', 'KETERANGAN', 'NOMINAL', 'SELISIH', 'Check',
  'Notes Hanif', 'no akun reklass', 'nama akun reklass',
] as const;

// Lebar kolom persis seperti acuan (kolom O, S, V-Z sebelumnya salah, jadi teks header terpotong).
const COL_WIDTHS = [
  6.29, 14, 28.86, 7.29, 9.86, 9.71, 52.29, 28.57, 16, 16, 14.14, 19.71, 31.14, 15.43, 15.43,
  16.14, 16.57, 23.14, 23.14, 15.43, 15.14, 15.14, 15.14, 15.14, 15.14, 15.14, 12.86, 15.71, 17.14, 17,
];
// Header yang rata kiri di acuan: Bank (D), No Kamar/No Rekon (T), Notes Hanif (AB). Lainnya tengah.
const HEADER_LEFT = new Set([4, 20, 28]);
// Kolom yang digrup (outline level 1) seperti acuan: L sampai Z (kolom 12-26).
const OUTLINE_COLS = new Set([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]);

const NUM_ACCT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const NUM_2DP = '_-* #,##0.00_-;\\-* #,##0.00_-;_-* "-"??_-;_-@_-';
const DATE_FMT = '[$-409]d\\-mmm\\-yy;@';

const HEADER_GREEN = 'FF385623'; // accent6 (70AD47) gelap 50%, sama dengan acuan
const ORANGE = 'FFFFC000';
const thin = { style: 'thin' } as const;
const BORDER: Partial<Borders> = { left: thin, right: thin, top: thin, bottom: thin };
const FONT = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE };

// Data langsung di bawah judul seksi (baris 4), tanpa baris kosong di antaranya.
/** Baris data pertama (sebelum digeser blok judul). */
export const FIRST_DATA_ROW = 5;

// Contoh: 10 baris pertama seksi "BANK BCA - JOURNAL" (kolom A-O).
const SAMPLE: Cell[][] = [
  [1001, 1104, { formula: "_xlfn.XLOOKUP(B6,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-05", "Xendit Payout-Incoming", "SINAR DIGITAL TERD", 0, 7430000, { formula: "I6-J6" }, "BCA/1/2026/1001", "20260105-7430000-SINAR -2", "Internal Transfer", "Transfer"],
  [1002, 6101, { formula: "_xlfn.XLOOKUP(B7,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-05", "Marketing-Google Ads", "PT GOOGLE INDONESIA", 7000000, 0, { formula: "I7-J7" }, "BCA/1/2026/1002", "20260105-7000000-PT GOO-3", "OPEX", "OPEX"],
  [1003, 6301, { formula: "_xlfn.XLOOKUP(B8,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-05", "Fee-Fee", "PT GOOGLE INDONESIA", 2500, 0, { formula: "I8-J8" }, "BCA/1/2026/1003", "20260105-2500-PT GOO-4", "OPEX", "OPEX"],
  [1004, 4137, { formula: "_xlfn.XLOOKUP(B9,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-06", "Tour Income-Bali tour", "ELIZAVETA KONIUKHO", 0, 330000, { formula: "I9-J9" }, "BCA/1/2026/1004", "20260106-330000-ELIZAV-5", "O-46028-04", "Income"],
  [1005, 1104, { formula: "_xlfn.XLOOKUP(B10,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-06", "Xendit Payout-Incoming", "SINAR DIGITAL TERD", 0, 1972674, { formula: "I10-J10" }, "BCA/1/2026/1005", "20260106-1972674-SINAR -6", "Internal Transfer", "Transfer"],
  [1006, 6204, { formula: "_xlfn.XLOOKUP(B11,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-07", "Healty BPJS January ", "HERMINA HARYATI", 450000, 0, { formula: "I11-J11" }, "BCA/1/2026/1006", "20260107-1981000-HERMIN-7", "OPEX", "OPEX"],
  [1006, 6204, { formula: "_xlfn.XLOOKUP(B12,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-07", "Social Sencontry BPJS", "HERMINA HARYATI", 595120, null, { formula: "I12-J12" }, "BCA/1/2026/1006", "20260107-1981000-HERMIN-7", "OPEX", "OPEX"],
  [1006, 2300, { formula: "_xlfn.XLOOKUP(B13,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-07", "Income Tax December 2025", "HERMINA HARYATI", 185875, null, { formula: "I13-J13" }, "BCA/1/2026/1006", "20260107-1981000-HERMIN-7", "OPEX", "OPEX"],
  [1006, 6401, { formula: "_xlfn.XLOOKUP(B14,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-07", "Tax Service", "HERMINA HARYATI", 750000, null, { formula: "I14-J14" }, "BCA/1/2026/1006", "20260107-1981000-HERMIN-7", "OPEX", "OPEX"],
  [1006, 6204, { formula: "_xlfn.XLOOKUP(B15,COA!A:A,COA!B:B)" }, "BCA", 1, "2026-01-07", "Rounding", "HERMINA HARYATI", 5, null, { formula: "I15-J15" }, "BCA/1/2026/1006", "20260107-1981000-HERMIN-7", "OPEX", "OPEX"],
];

// Format per kolom data (A-O): [format angka, rata]
const DATA_FMT: Record<number, [string | undefined, Partial<Alignment>['horizontal']]> = {
  2: [undefined, 'center'], 3: [undefined, 'left'], 4: [undefined, 'left'], 5: [undefined, 'center'],
  6: [DATE_FMT, 'center'], 7: [undefined, 'left'], 8: [undefined, 'left'],
  9: [NUM_ACCT, 'right'], 10: [NUM_ACCT, 'right'], 11: [NUM_ACCT, 'right'],
  12: [NUM_2DP, undefined], 13: [NUM_2DP, undefined], 14: [NUM_2DP, undefined], 15: [NUM_2DP, undefined],
};

/** `rows` = baris transaksi dari aplikasi (kolom A-O); default kosong (template hanya header). SAMPLE di atas hanya contoh acuan. */
export function fillGlSheet(
  ws: Worksheet, rows: Cell[][] = [], top = 0, statuses: string[] = [],
  /** Mode file 1 sheet (sheet COA tidak ikut): nama akun per baris ditulis sebagai teks, bukan XLOOKUP ke COA. */
  names?: string[],
): void {
  // `top` = jumlah baris judul di atas sheet; semua baris template digeser sebesar ini.
  const R1 = 1 + top;
  const R2 = 2 + top;
  const R3 = 3 + top;
  const R4 = 4 + top;
  const FIRST = FIRST_DATA_ROW + top;
  ws.columns = COL_WIDTHS.map((width, i) => ({ width, outlineLevel: OUTLINE_COLS.has(i + 1) ? 1 : 0 }));

  // ── Baris 1-2: rumus bantu ───────────────────────────────────────────────
  const j1 = ws.getCell(`J${R1}`);
  j1.value = { formula: `J${R2}-I${R2}` };
  j1.numFmt = NUM_ACCT;
  j1.font = FONT;

  const c2 = ws.getCell(`C${R2}`);
  if (!names) c2.value = { formula: `_xlfn.XLOOKUP(B${R2},COA!A:A,COA!B:B)` }; // file 1 sheet: sel bantu ini dibiarkan kosong
  c2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
  c2.border = BORDER;
  c2.alignment = { horizontal: 'left' };
  c2.font = FONT;

  const e2 = ws.getCell(`E${R2}`);
  e2.value = { formula: `MONTH(F${R2})` };
  e2.border = BORDER;
  e2.alignment = { horizontal: 'center' };
  e2.font = FONT;

  for (const colLetter of ['I', 'J']) {
    const c = ws.getCell(`${colLetter}${R2}`);
    c.value = { formula: `SUBTOTAL(9,${colLetter}${FIRST}:${colLetter}1048576)` };
    c.numFmt = NUM_ACCT;
    c.border = BORDER;
    c.font = FONT;
  }

  // Kotak baris 2 (di atas header): garis pinggir hitam di semua kolom A sampai K (Balance).
  for (let col = 1; col <= 11; col++) {
    const c = ws.getCell(R2, col);
    c.border = BORDER;
    if (!c.font) c.font = FONT;
  }

  // ── Baris 3: header ──────────────────────────────────────────────────────
  const header = ws.getRow(R3);
  header.height = 34.15;
  GL_HEADERS.forEach((h, i) => {
    const c = header.getCell(i + 1);
    const col = i + 1;
    c.value = h;
    c.alignment = { horizontal: HEADER_LEFT.has(col) ? 'left' : 'center', vertical: 'middle', wrapText: true };
    if (col <= 15) {
      c.font = { ...FONT, bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_GREEN } };
      c.border = BORDER;
    } else {
      c.font = { ...FONT, bold: true };
      if (col === 27 || col === 28) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ORANGE } };
      }
    }
  });

  // ── Baris 4: judul seksi ─────────────────────────────────────────────────
  // Template kosong: tanpa judul seksi; baris 4 baru dipakai kalau ada data dari aplikasi.
  if (rows.length) {
    for (let col = 1; col <= GL_HEADERS.length; col++) {
      const c = ws.getCell(R4, col);
      c.border = BORDER;
      c.font = FONT;
    }
    const sec = ws.getCell(`A${R4}`);
    sec.value = 'GENERAL LEDGER - SEMUA STATUS TRANSAKSI';
    sec.font = { ...FONT, bold: true };
  }

  // ── Baris data contoh ────────────────────────────────────────────────────
  rows.forEach((row, idx) => {
    const r = FIRST + idx;
    row.forEach((raw, i) => {
      const col = i + 1;
      const c = ws.getCell(r, col);
      let v: Cell | Date = raw;
      if (col === 6 && typeof raw === 'string') v = new Date(`${raw}T00:00:00Z`);
      if (v !== null) c.value = v as never;
      const [nf, h] = DATA_FMT[col] ?? [undefined, undefined];
      if (nf) c.numFmt = nf;
      c.alignment = h ? { horizontal: h } : {};
      c.border = BORDER;
      c.font = { ...FONT, bold: col === 1 };
    });
    // Rumus yang pola barisnya sama di seluruh sheet acuan.
    ws.getCell(r, 3).value = names ? (names[idx] ?? '') : { formula: `_xlfn.XLOOKUP(B${r},COA!A:A,COA!B:B)` };
    ws.getCell(r, 11).value = { formula: `I${r}-J${r}` };
  });

  const lastRow = rows.length ? FIRST + rows.length - 1 : R3;

  // Kolom P-AD (header tanpa data contoh): tabel yang sama (garis & font) tapi isi kosong.
  for (let r = FIRST; r <= lastRow; r++) {
    for (let col = 16; col <= GL_HEADERS.length; col++) {
      const c = ws.getCell(r, col);
      c.border = BORDER;
      c.font = FONT;
    }
  }

  // ── Tampilan ─────────────────────────────────────────────────────────────
  // Hanya kolom A-B (No, COA) yang terkunci di kiri; baris atas TIDAK dikunci
  // supaya header & baris 1-2 ikut bergulir saat di-scroll.
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 0, topLeftCell: 'C1', activeCell: 'C4', showGridLines: false }];
  ws.autoFilter = `A${R3}:AD${lastRow}`;

  // Kolom AE "Status Transaksi": status tiap baris jurnal di aplikasi (Draft / Pending / Approved / Posted).
  addStatusColumn(ws, { col: GL_HEADERS.length + 1, headerRow: R3, firstDataRow: FIRST, values: statuses });
  ws.properties.tabColor = { argb: 'FF92D050' };

  // ── Aturan highlight (merah muda / teks merah tua) ───────────────────────
  const red = {
    font: { color: { argb: 'FF9C0006' } },
    fill: { type: 'pattern' as const, pattern: 'solid' as const, bgColor: { argb: 'FFFFC7CE' } },
  };
  ws.addConditionalFormatting({
    ref: 'V1:V1048576',
    rules: [{ type: 'expression', priority: 1, formulae: ['AND(V1<>"",COUNTIF($V:$V,V1)>1)'], style: red }],
  });
  ws.addConditionalFormatting({
    ref: 'AA1:AA1048576',
    rules: [{
      type: 'containsText', operator: 'containsText', text: 'x', priority: 2,
      formulae: ['NOT(ISERROR(SEARCH("x",AA1)))'], style: red,
    } as never],
  });
}