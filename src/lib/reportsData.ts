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

/** Baris sheet COA + status per akun (dari TB: posted / belum posted / tidak ada transaksi). */
export function coaSheetRows(data: ReportsSourceData): { rows: CoaRow[]; statuses: string[] } {
  const tb = tbAccountIndex(data.tb);
  const rows: CoaRow[] = [];
  const statuses: string[] = [];
  for (const a of data.coa) {
    const shown = a.source_acc_no || a.acc_no; // kode yang ditampilkan di aplikasi
    // Asumsi pemetaan: Account Type <- account_classification, Category <- account_sub.
    rows.push([asCode(shown), a.account_name, a.account_classification, a.account_sub, true, false]);
    statuses.push(accountStatus(tb.get(shown) ?? tb.get(a.acc_no)));
  }
  return { rows, statuses };
}

/** Baris sheet GL (kolom A-O) + status tiap baris jurnal (nilai asli dari backend). */
export function glSheetRows(data: ReportsSourceData): { rows: GlCell[][]; statuses: string[] } {
  const rows: GlCell[][] = [];
  const statuses: string[] = [];
  let no = 1000;
  for (const acc of data.gl.accounts) {
    for (const l of acc.lines) {
      // Jurnal penyesuaian tidak masuk GL: ditampilkan di sheet ADJ (kolom ADJ di TB), supaya tidak terhitung dua kali.
      if (l.is_adjustment) continue;
      no += 1;
      rows.push([
        no, asCode(acc.account_code), null, '', Number(l.date.slice(5, 7)), l.date, l.description, l.party,
        l.debit, l.credit, null, l.number, null, null, l.source,
      ]);
      statuses.push(statusLabel(l.status));
    }
  }
  return { rows, statuses };
}

/** Baris sheet ADJ (kolom A-P) + status tiap jurnal penyesuaian (nilai asli dari backend). Satu baris per baris jurnal. */
export function adjSheetRows(data: ReportsSourceData): { rows: AdjCell[][]; statuses: string[] } {
  const rows: AdjCell[][] = [];
  const statuses: string[] = [];
  let no = 0;
  for (const e of data.adj.entries) {
    for (const l of e.lines) {
      no += 1;
      rows.push([
        no, asCode(l.account_code), null, '', Number(e.date.slice(5, 7)), e.date, l.description || e.description, '',
        l.debit, l.kredit, null, e.number, '', '', 'Adjustment', '',
      ]);
      statuses.push(statusLabel(e.status));
    }
  }
  return { rows, statuses };
}
