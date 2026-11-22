// Isi sheet "ADJ" untuk workbook Financial Statement (halaman Reports).
//
// Sumber: GET /api/v1/reports/adjustment (jurnal Journal Entry bertanda "Adjusting entry", semua status).
// Jurnal penyesuaian TIDAK ikut di sheet GL (baris is_adjustment dibuang di reportsData.glSheetRows),
// jadi kolom ADJ di sheet TB (SUMIFS ke ADJ!I / ADJ!J) tidak menghitung dua kali.
//
// Kolom A-P mengikuti header template (No, COA, Keterangan COA, Bank, Month, Tanggal, Keterangan, Supplier/Customer,
// Debit, Kredit, Balance, Voucher Bantu, Payment ID, Order ID, Category, Check Weda). Kolom Q = Status Transaksi.

import type { Worksheet, Borders, Alignment } from 'exceljs';
import { REPORT_FONT_NAME, REPORT_FONT_SIZE } from './reportsFormat';
import { addStatusColumn } from './reportsStatus';

export type AdjCell = string | number | null | { formula: string };

const NUM_ACCT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const DATE_FMT = '[$-409]d\\-mmm\\-yy;@';
const thin = { style: 'thin' } as const;
const BORDER: Partial<Borders> = { left: thin, right: thin, top: thin, bottom: thin };
const FONT = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE };
const LAST_COL = 16; // P = Check Weda

const DATA_FMT: Record<number, [string | undefined, Partial<Alignment>['horizontal']]> = {
  1: [undefined, 'center'], 2: [undefined, 'center'], 3: [undefined, 'left'], 4: [undefined, 'left'], 5: [undefined, 'center'],
  6: [DATE_FMT, 'center'], 7: [undefined, 'left'], 8: [undefined, 'left'],
  9: [NUM_ACCT, 'right'], 10: [NUM_ACCT, 'right'], 11: [NUM_ACCT, 'right'],
};

/**
 * `top` = jumlah baris judul di atas sheet. Header sudah ada (dari template, baris 3+top);
 * di sini ditambah judul seksi (baris 4+top), baris data, dan kolom Status Transaksi (Q).
 * Tanpa baris (template kosong) = hanya header + kolom status kosong.
 */
export function fillAdjSheet(ws: Worksheet, rows: AdjCell[][] = [], top = 0, statuses: string[] = []): number {
  const HEADER = 3 + top;
  const SECTION = 4 + top;
  const FIRST = 5 + top;

  if (rows.length) {
    for (let col = 1; col <= LAST_COL; col++) {
      const c = ws.getCell(SECTION, col);
      c.border = BORDER;
      c.font = FONT;
    }
    const sec = ws.getCell(SECTION, 1);
    sec.value = 'JURNAL PENYESUAIAN - SEMUA STATUS TRANSAKSI';
    sec.font = { ...FONT, bold: true };
  }

  rows.forEach((row, idx) => {
    const r = FIRST + idx;
    for (let col = 1; col <= LAST_COL; col++) {
      const raw = row[col - 1] ?? null;
      const c = ws.getCell(r, col);
      let v: AdjCell | Date = raw;
      if (col === 6 && typeof raw === 'string' && raw) v = new Date(`${raw}T00:00:00Z`);
      if (v !== null && v !== '') c.value = v as never;
      const [nf, h] = DATA_FMT[col] ?? [undefined, undefined];
      if (nf) c.numFmt = nf;
      c.alignment = h ? { horizontal: h } : {};
      c.border = BORDER;
      c.font = { ...FONT, bold: col === 1 };
    }
    // Nama akun dari sheet COA; Balance = Debit - Kredit (pola sama dengan GL).
    ws.getCell(r, 3).value = { formula: `_xlfn.XLOOKUP(B${r},COA!A:A,COA!B:B,"")` };
    ws.getCell(r, 11).value = { formula: `I${r}-J${r}` };
  });

  const lastRow = rows.length ? FIRST + rows.length - 1 : HEADER;
  ws.autoFilter = `A${HEADER}:P${lastRow}`;
  addStatusColumn(ws, { col: LAST_COL + 1, headerRow: HEADER, firstDataRow: FIRST, values: statuses });
  return lastRow;
}
