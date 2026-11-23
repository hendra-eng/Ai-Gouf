// Ambil data asli untuk workbook Financial Statement (halaman Reports).
//
// Sumber = Journal Preview, SEMUA status (draft / pending / approved / posted), bukan hanya posted:
//   COA : GET /api/v1/management/coa/client/{id}
//   GL  : GET /api/v1/reports/general-ledger   (backend sudah memasukkan semua status; tiap baris membawa `status`)
//   TB  : GET /api/v1/reports/trial-balance    (status_filter=all; per akun ada unposted_lines)
// Periode = 1 Januari tahun terpilih s.d. akhir bulan terpilih.

import { fetchClientCoa, type CoaAccount } from './coaStore';
import { fetchGeneralLedger, type GeneralLedger } from './generalLedgerStore';
import { fetchTrialBalance, type TrialBalance } from './trialBalanceStore';
import { fetchAdjustment, type AdjustmentReport } from './adjustmentStore';
import type { CoaRow } from './reportsCoaSheet';
import type { GlCell } from './reportsGlSheet';
import type { AdjCell } from './reportsAdjSheet';
import { accountStatus, statusLabel, tbAccountIndex } from './reportsStatus';
import { partyForLine, type ReportsAiResult } from './reportsAiFill';
import { extrasForLine, type GlExtra } from './reportsGlExtract';

export interface ReportsSourceData {
  coa: CoaAccount[];
  gl: GeneralLedger;
  tb: TrialBalance;
  /** Jurnal penyesuaian (semua status). */
  adj: AdjustmentReport;
}

export interface ReportsSourceQuery {
  managementClientId: string | null;
  year: number;
  endMonth: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export async function fetchReportsSourceData(q: ReportsSourceQuery): Promise<ReportsSourceData> {
  if (!q.managementClientId) throw new Error('Pilih company terlebih dahulu sebelum download Excel.');
  const clientId = q.managementClientId;
  const lastDay = new Date(q.year, q.endMonth, 0).getDate();
  const [coa, gl, tb, adj] = await Promise.all([
    fetchClientCoa(clientId),
    fetchGeneralLedger({
      managementClientId: clientId,
      startDate: `${q.year}-01-01`,
      endDate: `${q.year}-${pad2(q.endMonth)}-${pad2(lastDay)}`,
      include: 'with_activity',
    }),
    fetchTrialBalance({ managementClientId: clientId, year: q.year, endMonth: q.endMonth, include: 'all', statusFilter: 'all' }),
    fetchAdjustment({ managementClientId: clientId, year: q.year, endMonth: q.endMonth, statusFilter: 'all' }),
  ]);
  return { coa, gl, tb, adj };
}

const asCode = (s: string): number | string => (/^\d+$/.test(s) ? Number(s) : s);

/**
 * Peta kode internal (acc_no, kunci di GL/TB/ADJ) -> kode tampilan (source_acc_no, kalau kosong acc_no).
 * Sheet COA memakai kode tampilan di kolom A, jadi GL/ADJ/TB/BS/PNL CF harus memakai kode yang sama
 * supaya XLOOKUP/SUMIFS antar sheet cocok. Kode yang tidak dikenal dikembalikan apa adanya.
 */
export function displayCodeFn(coa: CoaAccount[] | undefined): (code: string) => string {
  const m = new Map<string, string>();
  for (const a of coa ?? []) m.set(String(a.acc_no), String(a.source_acc_no || a.acc_no));
  return code => m.get(String(code)) ?? code;
}

/** Nama kepala/judul kelompok akun (ASSETS, LIABILITIES, ...): Category-nya memang boleh kosong, jadi tidak ditandai. */
const COA_HEADER_NAME_RE = /^(assets?|liabilit(y|ies)|equit(y|ies)|revenues?|expenses?|cost of sales|other income|other expenses?)$/i;

/** Akun yang Category-nya dipakai Neraca dan Arus Kas (aset tetap, kas/bank, utang jangka panjang). */
const FS_CLASSIFICATIONS = new Set(['ASSET', 'LIABILITY']);

export interface MissingCategory {
  /** Indeks baris di `rows` (bukan nomor baris Excel). */
  idx: number;
  /** true = akun aset/liabilitas: Category kosong bisa menggeser pemisahan di Neraca / Arus Kas. */
  impactsFs: boolean;
}

/**
 * Baris sheet COA + status per akun (dari TB: posted / belum posted / tidak ada transaksi).
 * Category SELALU apa adanya dari COA klien (account_sub). Category tidak diisi AI maupun tebakan pola: Neraca dan Arus Kas
 * membacanya dari COA yang sama, jadi sheet COA dan laporan harus konsisten. Akun aktif yang Category-nya kosong dikembalikan
 * di `missingCategory` supaya diberi penanda dan diisi di Chart of Accounts.
 */
export function coaSheetRows(data: ReportsSourceData): { rows: CoaRow[]; statuses: string[]; missingCategory: MissingCategory[] } {
  const tb = tbAccountIndex(data.tb);
  const rows: CoaRow[] = [];
  const statuses: string[] = [];
  const missingCategory: MissingCategory[] = [];
  for (const a of data.coa) {
    const shown = a.source_acc_no || a.acc_no; // kode yang ditampilkan di aplikasi
    // Asumsi pemetaan: Account Type <- account_classification, Category <- account_sub.
    const category = a.account_sub;
    if (!(category ?? '').trim() && a.is_active && !COA_HEADER_NAME_RE.test((a.account_name ?? '').trim())) {
      missingCategory.push({ idx: rows.length, impactsFs: FS_CLASSIFICATIONS.has((a.account_classification ?? '').toUpperCase()) });
    }
    rows.push([asCode(shown), a.account_name, a.account_classification, category, true, false]);
    statuses.push(accountStatus(tb.get(shown) ?? tb.get(a.acc_no)));
  }
  return { rows, statuses, missingCategory };
}

/** Baris sheet GL (kolom A-O) + status tiap baris jurnal (nilai asli dari backend). */
export function glSheetRows(data: ReportsSourceData, ai?: ReportsAiResult): { rows: GlCell[][]; statuses: string[]; autoParty: number[]; extras: GlExtra[]; names: string[] } {
  const rows: GlCell[][] = [];
  const statuses: string[] = [];
  const names: string[] = []; // nama akun per baris (dipakai file 1 sheet GL, yang tidak punya sheet COA untuk XLOOKUP)
  const autoParty: number[] = []; // indeks baris yang kolom Supplier/Customer-nya diisi otomatis
  const extras: GlExtra[] = []; // sel tambahan hasil ekstraksi (Bank, Payment ID, Order ID, Refund, No Kamar)
  let no = 1000;
  const shownCode = displayCodeFn(data.coa);
  for (const acc of data.gl.accounts) {
    for (const l of acc.lines) {
      // Jurnal penyesuaian tidak masuk GL: ditampilkan di sheet ADJ (kolom ADJ di TB), supaya tidak terhitung dua kali.
      if (l.is_adjustment) continue;
      no += 1;
      const party = partyForLine(ai, l.party, l.description);
      if (party.auto) autoParty.push(rows.length);
      extras.push(...extrasForLine(rows.length, acc.account_name, l.description));
      rows.push([
        no, asCode(shownCode(acc.account_code)), null, '', Number(l.date.slice(5, 7)), l.date, l.description, party.value,
        l.debit, l.credit, null, l.number, null, null, l.source,
      ]);
      statuses.push(statusLabel(l.status));
      names.push(acc.account_name);
    }
  }
  return { rows, statuses, autoParty, extras, names };
}

/** Baris sheet ADJ (kolom A-P) + status tiap jurnal penyesuaian (nilai asli dari backend). Satu baris per baris jurnal. */
export function adjSheetRows(data: ReportsSourceData): { rows: AdjCell[][]; statuses: string[]; names: string[] } {
  const rows: AdjCell[][] = [];
  const statuses: string[] = [];
  const names: string[] = []; // nama akun per baris (dipakai file 1 sheet ADJ, tanpa sheet COA)
  let no = 0;
  const shownCode = displayCodeFn(data.coa);
  for (const e of data.adj.entries) {
    for (const l of e.lines) {
      no += 1;
      rows.push([
        no, asCode(shownCode(l.account_code)), null, '', Number(e.date.slice(5, 7)), e.date, l.description || e.description, '',
        l.debit, l.kredit, null, e.number, '', '', 'Adjustment', '',
      ]);
      statuses.push(statusLabel(e.status));
      names.push(l.account_name);
    }
  }
  return { rows, statuses, names };
}