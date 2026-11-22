// Kolom "Status Transaksi" di 6 sheet workbook Financial Statement (halaman Reports).
//
// Semua sheet membaca data dari Journal Preview (semua status: draft / pending / approved / posted),
// bukan hanya posted. Kolom ini memberi tahu status tiap baris di aplikasi supaya angka yang belum
// di-post tidak tertukar dengan angka resmi.
//   GL / ADJ : status per baris jurnal (nilai asli dari backend).
//   COA / TB / BS / PNL CF : status per akun, diringkas dari Trial Balance (jumlah baris belum posted).

import type { Worksheet } from 'exceljs';
import { boxBorders, HEADER_FILL_ARGB, REPORT_FONT_NAME, REPORT_FONT_SIZE } from './reportsFormat';
import type { TbAccount, TrialBalance } from './trialBalanceStore';

export const STATUS_HEADER = 'Status Transaksi';
export const STATUS_COL_WIDTH = 24;
export const STATUS_POSTED = 'Posted';
export const STATUS_NO_ACTIVITY = 'Tidak ada transaksi';

const LABELS: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', approved: 'Approved', posted: STATUS_POSTED, reversed: 'Reversed',
};

/** draft -> "Draft", posted -> "Posted", kosong -> "-". Status tak dikenal ditampilkan apa adanya (huruf awal besar). */
export function statusLabel(status?: string | null): string {
  const k = (status ?? '').trim().toLowerCase();
  if (!k) return '-';
  return LABELS[k] ?? k.charAt(0).toUpperCase() + k.slice(1);
}

/** Status satu akun dari data Trial Balance: Posted / "Belum posted (n baris)" / "Tidak ada transaksi". */
export function accountStatus(a?: TbAccount): string {
  if (!a) return STATUS_NO_ACTIVITY;
  const hasActivity = a.opening_balance !== 0 || a.total_debit !== 0 || a.total_kredit !== 0 || a.unposted_lines > 0;
  if (!hasActivity) return STATUS_NO_ACTIVITY;
  return a.unposted_lines > 0 ? `Belum posted (${a.unposted_lines} baris)` : STATUS_POSTED;
}

/** Index akun TB menurut kode akun, untuk lookup status per akun. */
export function tbAccountIndex(tb: TrialBalance | null | undefined): Map<string, TbAccount> {
  const m = new Map<string, TbAccount>();
  for (const g of tb?.groups ?? []) for (const a of g.accounts) m.set(String(a.account_code), a);
  return m;
}

const needsAttention = (v: string) => v !== '' && v !== STATUS_POSTED && v !== STATUS_NO_ACTIVITY && v !== '-';

function extendAutoFilter(ws: Worksheet, col: number, lastRow: number): void {
  const f = ws.autoFilter;
  if (!f) return;
  if (typeof f === 'string') {
    const m = f.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) return;
    ws.autoFilter = `${m[1]}${m[2]}:${ws.getColumn(col).letter}${Math.max(Number(m[4]), lastRow)}`;
  } else {
    const from = f.from as { row: number; column: number };
    const to = f.to as { row: number; column: number };
    ws.autoFilter = { from, to: { row: Math.max(to.row, lastRow), column: Math.max(to.column, col) } };
  }
}

export interface StatusColumnOptions {
  /** Nomor kolom (1-based) tempat kolom status ditaruh: tepat di kanan kolom terakhir tabel. */
  col: number;
  /** Baris header (dan baris kedua header kalau header 2 tingkat -> sel digabung vertikal). */
  headerRow: number;
  headerRowEnd?: number;
  /** Baris data pertama; default = baris tepat di bawah header. */
  firstDataRow?: number;
  /** Status per baris data, urut dari firstDataRow. Kosong = tabel hanya berisi header. */
  values?: string[];
}

/** Tambah kolom "Status Transaksi" (header + tabel bergaris) di sisi kanan tabel sheet. */
export function addStatusColumn(ws: Worksheet, o: StatusColumnOptions): void {
  const { col, headerRow } = o;
  const endRow = o.headerRowEnd ?? headerRow;
  const values = o.values ?? [];
  const first = o.firstDataRow ?? endRow + 1;

  for (let r = headerRow; r <= endRow; r++) {
    const c = ws.getCell(r, col);
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL_ARGB } };
    c.font = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE, bold: true, color: { argb: 'FFFFFFFF' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: false };
  }
  ws.getCell(headerRow, col).value = STATUS_HEADER;
  if (endRow > headerRow) ws.mergeCells(headerRow, col, endRow, col);
  boxBorders(ws, headerRow, endRow, col, col);

  values.forEach((v, i) => {
    const c = ws.getCell(first + i, col);
    if (v !== '') c.value = v;
    c.font = { name: REPORT_FONT_NAME, size: REPORT_FONT_SIZE };
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    // Selain Posted diberi latar kuning muda supaya jurnal yang belum di-post mudah terlihat.
    if (needsAttention(v)) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
  });
  if (values.length) boxBorders(ws, first, first + values.length - 1, col, col);

  const column = ws.getColumn(col);
  if ((column.width ?? 0) < STATUS_COL_WIDTH) column.width = STATUS_COL_WIDTH;
  extendAutoFilter(ws, col, values.length ? first + values.length - 1 : endRow);
}