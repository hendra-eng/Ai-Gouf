// Isi sheet "TB" (Neraca Saldo) untuk workbook Financial Statement (halaman Reports).
//
// Sumber = Trial Balance backend (semua status Journal Preview) untuk DAFTAR AKUN, SALDO AWAL, dan STATUS per akun.
// ANGKA tiap bulan TIDAK ditempel, tapi dihitung rumus Excel yang merujuk ke sheet GL dan ADJ (rantai GL -> TB -> BS/PNL CF):
//   Debet / Kredit bulan   = SUMIFS(GL!I / GL!J,  GL!B = akun, GL!E = bulan)
//   ADJ debit / kredit     = SUMIFS(ADJ!I / ADJ!J, ADJ!B = akun, ADJ!E = bulan)
//   Balance                = saldo sebelumnya +/- mutasi bulan itu
//   Balance after ADJ      = Balance +/- ADJ
//
// Aturan saldo (sama dengan backend trial_balance_core.py dan template acuan):
//   - Akun NERACA (kelompok ASSET / LIABILITY / EQUITY): kumulatif; Jan = Saldo Awal + mutasi; bulan berikutnya = after ADJ bulan lalu + mutasi.
//   - Akun LABA RUGI (kelompok lainnya): hanya mutasi bulan itu; YTD = jumlah after ADJ Jan s.d. Des.
//   - Saldo ditampilkan di sisi normal KELOMPOK (aset/beban = debit - kredit; liabilitas/ekuitas/pendapatan = kredit - debit),
//     jadi akun kontra (mis. akumulasi penyusutan) otomatis bernilai negatif dan total kelompok cukup dijumlahkan.
//   - "Current Year Profit / Loss" dihitung dari baris PROFIT (LOSS) di bawah (bukan dari GL), seperti baris 3300 di acuan.
//   - Laba tahun lalu yang belum ditutup (carry_forward) jadi baris ekuitas sendiri.
//
// Tata letak kolom (1-based): A kode, B nama, C saldo awal tahun lalu (kosong), D saldo awal tahun terpilih,
// lalu 12 blok bulan @6 kolom [Debet, Kredit, Balance, ADJ Debit, ADJ Kredit, Balance after ADJ] mulai kolom E,
// BY = YTD, BZ = Check. Kolom CE (Status Transaksi) ditambahkan oleh addStatusColumn.

import type { Worksheet } from 'exceljs';
import { boxBorders } from './reportsFormat';
import { accountStatus, STATUS_NO_ACTIVITY, STATUS_POSTED } from './reportsStatus';
import type { TbAccount, TbGroup, TrialBalance } from './trialBalanceStore';

const NUM_ACCT = '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)';
const FILL_LABEL = 'FFE2EFDA';
const FILL_TOTAL = 'FFF2F2F2';

const BULAN_ID = ['JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI', 'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'];

// ── Peta kolom ───────────────────────────────────────────────────────────────
const COL_CODE = 1;
const COL_NAME = 2;
const COL_BEGIN_PRIOR = 3;
const COL_OPEN = 4;
const blockStart = (m: number) => 5 + 6 * (m - 1); // m = 1..12
const cDebit = (m: number) => blockStart(m);
const cKredit = (m: number) => blockStart(m) + 1;
const cBal = (m: number) => blockStart(m) + 2;
const cAdjD = (m: number) => blockStart(m) + 3;
const cAdjK = (m: number) => blockStart(m) + 4;
const cAfter = (m: number) => blockStart(m) + 5;
export const tbColAfter = cAfter;
export const TB_COL_YTD = 77; // BY
export const TB_COL_CHECK = 78; // BZ
export const TB_COL_LAST = 82; // CD (kolom kerja terakhir sebelum Status Transaksi)

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function colLetter(n: number): string {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const asCode = (s: string): number | string => (/^\d+$/.test(s) ? Number(s) : s);
const q = (s: string) => `"${s.replace(/"/g, '""')}"`; // literal teks di dalam rumus Excel

const PROFIT_ACCOUNT_RE = /current\s*year|current\s*period|current\s*earning|tahun\s*berjalan|laba\s*(\(?rugi\)?\s*)?berjalan/i;

const DEBIT_GROUPS = new Set(['ASSET', 'COST OF SALES', 'EXPENSE', 'OTHER EXPENSE', 'INCOME TAX']);

/** Satu baris akun di sheet TB; dipakai sheet BS dan PNL CF untuk merujuk sel TB langsung. */
export interface TbRowRef {
  row: number;
  kind: 'account' | 'profit' | 'prior';
  /** Kode akun ('' untuk baris bawaan tanpa kode). */
  code: string;
  name: string;
  /** Kunci kelompok TB (ASSET, LIABILITY, EQUITY, REVENUE, ...). */
  group: string;
  /** Status Transaksi akun ini ('' = tidak ada). */
  status: string;
}

export interface TbSheetResult {
  /** Baris data pertama (spacer) dan terakhir; status[i] = status untuk baris firstDataRow + i ('' = bukan baris akun). */
  firstDataRow: number;
  lastRow: number;
  statuses: string[];
  /** Semua baris akun (urut seperti di sheet TB). */
  refs: TbRowRef[];
  /** Nomor baris PROFIT (LOSS) di sheet TB (0 kalau tidak ada data). */
  profitRow: number;
}

/** Judul kolom yang memuat tahun/bulan (acuan hardcode 2026) diganti sesuai tahun terpilih. */
export function relabelTbHeaders(ws: Worksheet, headerRow: number, year: number): void {
  ws.getCell(headerRow, COL_BEGIN_PRIOR).value = `BEGINNING BALANCE ${year - 1}`;
  ws.getCell(headerRow, COL_OPEN).value = `BEGINNING BALANCE ${year}`;
  for (const m of MONTHS) {
    ws.getCell(headerRow, cBal(m)).value = `BALANCE ${BULAN_ID[m - 1]} ${year}`;
    ws.getCell(headerRow, cAfter(m)).value = `BALANCE AFTER ADJUSTMENT ${BULAN_ID[m - 1]} ${year}`;
  }
  ws.getCell(headerRow, TB_COL_YTD).value = `YTD ${year}`;
}

type Side = 'DEBIT' | 'CREDIT';

/**
 * Isi baris tabel TB. `top` = jumlah baris blok judul; baris bantu nomor bulan ada di (4 + top) dan data mulai di (7 + top),
 * sama dengan template yang digeser. Tanpa `tb` (template kosong) tidak ada baris yang ditulis.
 */
export function fillTbSheet(ws: Worksheet, tb: TrialBalance | null | undefined, top: number): TbSheetResult {
  const monthRow = 4 + top;
  const first = 7 + top;
  if (!tb) return { firstDataRow: first, lastRow: first - 1, statuses: [], refs: [], profitRow: 0 };

  const writers: Array<() => void> = [];
  const refs: TbRowRef[] = [];
  const statusAt = new Map<number, string>();
  let r = first + 1; // baris `first` = spacer kosong seperti acuan

  const groupOf = (key: string): TbGroup | undefined => tb.groups.find(g => g.key === key);
  const sideOf = (g: TbGroup): Side => (DEBIT_GROUPS.has(g.key) ? 'DEBIT' : 'CREDIT');

  const setNumFmtRow = (row: number) => {
    for (let c = COL_BEGIN_PRIOR; c <= TB_COL_YTD; c++) ws.getCell(row, c).numFmt = NUM_ACCT;
  };
  const styleBand = (row: number, fill: string, bold = true) => {
    for (let c = 1; c <= TB_COL_LAST; c++) {
      const cell = ws.getCell(row, c);
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      cell.font = { bold };
    }
  };

  const labelRow = (text: string): number => {
    const row = r++;
    writers.push(() => {
      ws.getCell(row, COL_CODE).value = text;
      styleBand(row, FILL_LABEL);
    });
    return row;
  };
  const blankRow = (): number => r++;

  // Jumlah kolom D, balance, after ADJ, dan YTD dari baris `from` s.d. `to` (label/total di dalam rentang kosong di kolom ini).
  const totalCols = [COL_OPEN, ...MONTHS.flatMap(m => [cBal(m), cAfter(m)]), TB_COL_YTD];

  const totalRow = (text: string, from: () => number, to: () => number): number => {
    const row = r++;
    writers.push(() => {
      ws.getCell(row, COL_CODE).value = text;
      styleBand(row, FILL_TOTAL);
      setNumFmtRow(row);
      const f = from();
      const t = to();
      for (const c of totalCols) {
        const L = colLetter(c);
        // Kelompok tanpa akun: rentang terbalik akan menunjuk baris total itu sendiri (sirkular), jadi isi 0.
        ws.getCell(row, c).value = { formula: t < f ? '0' : `SUM(${L}${f}:${L}${t})` };
      }
    });
    return row;
  };

  // ── Baris akun biasa ───────────────────────────────────────────────────────
  const writeAccount = (row: number, a: TbAccount, g: TbGroup) => {
    const side = sideOf(g);
    const neraca = g.tipe === 'neraca';
    const debitSide = side === 'DEBIT';
    const net = (d: string, k: string) => (debitSide ? `${d}${row}-${k}${row}` : `${k}${row}-${d}${row}`);

    ws.getCell(row, COL_CODE).value = asCode(a.account_code);
    ws.getCell(row, COL_NAME).value = a.in_coa
      ? { formula: `IFERROR(_xlfn.XLOOKUP(A${row},COA!A:A,COA!B:B),${q(a.account_name)})` }
      : a.account_name;

    if (neraca) {
      // opening_balance dari backend ada di sisi normal AKUN -> ubah ke sisi normal KELOMPOK (kontra jadi negatif).
      const open = a.normal_balance === g.normal_balance ? a.opening_balance : -a.opening_balance;
      if (Math.abs(open) >= 0.005) ws.getCell(row, COL_OPEN).value = open;
    }

    for (const m of MONTHS) {
      const dL = colLetter(cDebit(m));
      const kL = colLetter(cKredit(m));
      const adL = colLetter(cAdjD(m));
      const akL = colLetter(cAdjK(m));
      ws.getCell(row, cDebit(m)).value = { formula: `SUMIFS(GL!$I:$I,GL!$B:$B,$A${row},GL!$E:$E,${dL}$${monthRow})` };
      ws.getCell(row, cKredit(m)).value = { formula: `SUMIFS(GL!$J:$J,GL!$B:$B,$A${row},GL!$E:$E,${kL}$${monthRow})` };
      ws.getCell(row, cAdjD(m)).value = { formula: `SUMIFS(ADJ!$I:$I,ADJ!$E:$E,${adL}$${monthRow},ADJ!$B:$B,$A${row})` };
      ws.getCell(row, cAdjK(m)).value = { formula: `SUMIFS(ADJ!$J:$J,ADJ!$E:$E,${akL}$${monthRow},ADJ!$B:$B,$A${row})` };
      const prev = m === 1 ? `D${row}` : `${colLetter(cAfter(m - 1))}${row}`;
      const mutasi = net(dL, kL);
      ws.getCell(row, cBal(m)).value = { formula: neraca ? `${prev}+${mutasi}` : mutasi };
      ws.getCell(row, cAfter(m)).value = { formula: `${colLetter(cBal(m))}${row}+${net(adL, akL)}` };
    }
    ws.getCell(row, TB_COL_YTD).value = {
      formula: neraca ? `${colLetter(cAfter(12))}${row}` : MONTHS.map(m => `${colLetter(cAfter(m))}${row}`).join('+'),
    };
    ws.getCell(row, TB_COL_CHECK).value = { formula: `SUM(D${row}:${colLetter(cAfter(12))}${row})<>0` };
    statusAt.set(row, accountStatus(a));
  };

  // ── Baris ekuitas khusus ───────────────────────────────────────────────────
  let profitRowNo = 0; // baris PROFIT (LOSS), diisi nanti
  const pnlUnposted = tb.groups.filter(g => g.tipe === 'pnl').flatMap(g => g.accounts).reduce((n, a) => n + a.unposted_lines, 0);
  const profitStatus = pnlUnposted > 0 ? `Belum posted (${pnlUnposted} baris)` : tb.current_year_profit.months.some(v => v !== 0) ? STATUS_POSTED : STATUS_NO_ACTIVITY;

  /** Baris "Current Year Profit / Loss": saldo = (after ADJ bulan lalu) + laba bulan itu dari baris PROFIT (LOSS). */
  const writeProfitEquity = (row: number, a: TbAccount | null) => {
    if (a) {
      ws.getCell(row, COL_CODE).value = asCode(a.account_code);
      ws.getCell(row, COL_NAME).value = a.in_coa
        ? { formula: `IFERROR(_xlfn.XLOOKUP(A${row},COA!A:A,COA!B:B),${q(a.account_name)})` }
        : a.account_name;
    } else {
      ws.getCell(row, COL_NAME).value = 'Current Year Profit / Loss';
    }
    for (const m of MONTHS) {
      const prev = m === 1 ? `D${row}` : `${colLetter(cAfter(m - 1))}${row}`;
      ws.getCell(row, cBal(m)).value = { formula: `${prev}+${colLetter(cBal(m))}${profitRowNo}` };
      ws.getCell(row, cAfter(m)).value = { formula: `${prev}+${colLetter(cAfter(m))}${profitRowNo}` };
    }
    ws.getCell(row, TB_COL_YTD).value = { formula: `${colLetter(cAfter(12))}${row}` };
    ws.getCell(row, TB_COL_CHECK).value = { formula: `SUM(D${row}:${colLetter(cAfter(12))}${row})<>0` };
    statusAt.set(row, profitStatus);
  };

  /** Laba tahun lalu yang belum ditutup (carry_forward): konstan sepanjang tahun. */
  const writePriorYear = (row: number, value: number) => {
    ws.getCell(row, COL_NAME).value = 'Prior Year Profit / Loss (belum ditutup)';
    ws.getCell(row, COL_OPEN).value = value;
    for (const m of MONTHS) {
      const prev = m === 1 ? `D${row}` : `${colLetter(cAfter(m - 1))}${row}`;
      ws.getCell(row, cBal(m)).value = { formula: prev };
      ws.getCell(row, cAfter(m)).value = { formula: `${colLetter(cBal(m))}${row}` };
    }
    ws.getCell(row, TB_COL_YTD).value = { formula: `${colLetter(cAfter(12))}${row}` };
    ws.getCell(row, TB_COL_CHECK).value = { formula: `SUM(D${row}:${colLetter(cAfter(12))}${row})<>0` };
  };

  const accountRows = (g: TbGroup, allowProfit = false): { from: number; to: number } => {
    const from = r;
    let profitPlaced = false;
    for (const a of g.accounts) {
      const row = r++;
      if (allowProfit && !profitPlaced && PROFIT_ACCOUNT_RE.test(a.account_name)) {
        profitPlaced = true;
        refs.push({ row, kind: 'profit', code: a.account_code, name: a.account_name, group: g.key, status: profitStatus });
        writers.push(() => writeProfitEquity(row, a));
      } else {
        refs.push({ row, kind: 'account', code: a.account_code, name: a.account_name, group: g.key, status: accountStatus(a) });
        writers.push(() => writeAccount(row, a, g));
      }
    }
    if (allowProfit) {
      if (!profitPlaced) {
        const row = r++;
        refs.push({ row, kind: 'profit', code: '', name: 'Current Year Profit / Loss', group: g.key, status: profitStatus });
        writers.push(() => writeProfitEquity(row, null));
      }
      const prior = tb.carry_forward.prior_year_profit;
      if (Math.abs(prior) >= 0.005) {
        const row = r++;
        refs.push({ row, kind: 'prior', code: '', name: 'Prior Year Profit / Loss (belum ditutup)', group: g.key, status: '' });
        writers.push(() => writePriorYear(row, prior));
      }
    }
    return { from, to: r - 1 };
  };

  // ── NERACA ─────────────────────────────────────────────────────────────────
  const gAsset = groupOf('ASSET');
  const gLiab = groupOf('LIABILITY');
  const gEq = groupOf('EQUITY');

  labelRow('ASSETS');
  const assetRange = gAsset ? accountRows(gAsset) : { from: r, to: r - 1 };
  const totalAssetRow = totalRow('TOTAL ASSET', () => assetRange.from, () => assetRange.to);
  blankRow();

  labelRow('LIABILITIES AND EQUITIES');
  labelRow('LIABILITIES');
  const liabFrom = r;
  if (gLiab) accountRows(gLiab);
  blankRow();
  labelRow('EQUITIES');
  if (gEq) accountRows(gEq, true);
  const eqTo = r - 1;
  const totalLeRow = totalRow('TOTAL LIABILITAS DAN EKUITAS', () => liabFrom, () => eqTo);

  const controlRow = r++;
  writers.push(() => {
    ws.getCell(controlRow, COL_CODE).value = 'CONTROL';
    styleBand(controlRow, FILL_TOTAL);
    setNumFmtRow(controlRow);
    for (const c of totalCols) {
      const L = colLetter(c);
      ws.getCell(controlRow, c).value = { formula: `${L}${totalAssetRow}-${L}${totalLeRow}` };
    }
  });
  blankRow();

  // ── LABA RUGI ──────────────────────────────────────────────────────────────
  const pnlTotals: Array<{ row: number; side: Side }> = [];
  for (const g of tb.groups.filter(x => x.tipe === 'pnl')) {
    labelRow(g.label);
    const range = accountRows(g);
    const row = totalRow(`TOTAL ${g.label}`, () => range.from, () => range.to);
    pnlTotals.push({ row, side: sideOf(g) === 'CREDIT' ? 'CREDIT' : 'DEBIT' });
    blankRow();
  }

  // PROFIT (LOSS) = (pendapatan) - (beban); kolom Balance, Balance after ADJ, dan YTD.
  profitRowNo = r++;
  const profitRow = profitRowNo;
  writers.push(() => {
    ws.getCell(profitRow, COL_CODE).value = 'PROFIT (LOSS)';
    styleBand(profitRow, FILL_TOTAL);
    setNumFmtRow(profitRow);
    const cols = [...MONTHS.flatMap(m => [cBal(m), cAfter(m)]), TB_COL_YTD];
    const inc = pnlTotals.filter(t => t.side === 'CREDIT').map(t => t.row);
    const exp = pnlTotals.filter(t => t.side === 'DEBIT').map(t => t.row);
    for (const c of cols) {
      const L = colLetter(c);
      const plus = inc.length ? inc.map(x => `${L}${x}`).join('+') : '0';
      const minus = exp.length ? `-(${exp.map(x => `${L}${x}`).join('+')})` : '';
      ws.getCell(profitRow, c).value = { formula: `${plus}${minus}` };
    }
  });
  blankRow();

  // Cek total debet = kredit (GL) dan ADJ per bulan, seperti baris bantu di acuan.
  const lastAccountRow = profitRow - 1;
  const sumRow = r++;
  const diffRow = r++;
  writers.push(() => {
    ws.getCell(sumRow, COL_CODE).value = 'TOTAL DEBET / KREDIT';
    ws.getCell(diffRow, COL_CODE).value = 'SELISIH DEBET - KREDIT';
    for (const row of [sumRow, diffRow]) styleBand(row, FILL_TOTAL);
    for (const m of MONTHS) {
      for (const c of [cDebit(m), cKredit(m), cAdjD(m), cAdjK(m)]) {
        const L = colLetter(c);
        const cell = ws.getCell(sumRow, c);
        cell.value = { formula: `SUM(${L}${first}:${L}${lastAccountRow})` };
        cell.numFmt = NUM_ACCT;
      }
      for (const [d, k] of [[cDebit(m), cKredit(m)], [cAdjD(m), cAdjK(m)]]) {
        const cell = ws.getCell(diffRow, d);
        cell.value = { formula: `${colLetter(d)}${sumRow}-${colLetter(k)}${sumRow}` };
        cell.numFmt = NUM_ACCT;
      }
    }
  });

  const lastRow = r - 1;
  writers.forEach(w => w());
  for (let row = first; row <= lastRow; row++) setNumFmtRowIfEmpty(ws, row);
  boxBorders(ws, first, lastRow, 1, TB_COL_LAST);
  for (let row = first; row <= lastRow; row++) {
    ws.getCell(row, TB_COL_CHECK).alignment = { horizontal: 'center' };
    ws.getCell(row, COL_CODE).alignment = { horizontal: 'left' };
  }

  const statuses: string[] = [];
  for (let row = first; row <= lastRow; row++) statuses.push(statusAt.get(row) ?? '');
  return { firstDataRow: first, lastRow, statuses, refs, profitRow: profitRowNo };
}

function setNumFmtRowIfEmpty(ws: Worksheet, row: number): void {
  for (let c = COL_BEGIN_PRIOR; c <= TB_COL_YTD; c++) {
    const cell = ws.getCell(row, c);
    if (!cell.numFmt) cell.numFmt = NUM_ACCT;
  }
}