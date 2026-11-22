// Data layer report "Trial Balance" (src/app/reports/trial-balance),
// terhubung ke backend/modules/financial_statements/trial_balance_v1.py:
//   GET /api/v1/reports/trial-balance
//   GET /api/v1/reports/trial-balance/periods
//
// Sumber backend = SAMA dengan General Ledger: semua transaksi yang sudah masuk
// Journal Preview (draft / pending / approved / posted) langsung ikut TB tanpa
// menunggu Post -- rejected / void / cancelled / dihapus tidak ikut. Mode
// `statusFilter: 'posted'` membatasi ke transaksi POSTED saja. Tiap akun membawa
// nominal yang BELUM posted (`unposted_*`) dan respons membawa ringkasan per status.
//
// Nilai saldo dikirim di SISI NORMAL akun (aset/beban = debit, liabilitas/ekuitas/
// pendapatan = kredit); angka negatif = saldo berlawanan dengan sisi normalnya.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const TB_URL = `${API_BASE_URL}/api/v1/reports/trial-balance`;

export type TbInclude = 'non_zero' | 'with_activity' | 'all';
export type TbStatusFilter = 'all' | 'posted';
export type TbGroupKey =
  | 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'COST OF SALES'
  | 'EXPENSE' | 'OTHER INCOME' | 'OTHER EXPENSE' | 'INCOME TAX';

export interface TbMonth {
  debit: number;
  kredit: number;
  /** Akun neraca: saldo kumulatif akhir bulan. Akun laba rugi: mutasi bulan itu saja (seperti sheet TB Excel). */
  balance: number;
}

export interface TbAccount {
  account_code: string;
  account_name: string;
  account_head: string | null;
  group: TbGroupKey;
  tipe: 'neraca' | 'pnl';
  normal_balance: 'DEBIT' | 'CREDIT';
  /** false = kode akun ada di jurnal tetapi tidak ada di COA klien. */
  in_coa: boolean;
  opening_balance: number;
  months: TbMonth[];
  total_debit: number;
  total_kredit: number;
  /** Akun neraca: saldo akhir periode. Akun laba rugi: jumlah mutasi Jan s.d. bulan akhir. */
  ytd: number;
  /** Nominal transaksi berstatus draft/pending/approved (belum posted) s.d. akhir periode. */
  unposted_debit: number;
  unposted_kredit: number;
  unposted_lines: number;
}

export interface TbGroupTotal {
  opening_balance: number;
  months: TbMonth[];
  ytd: number;
  unposted_debit: number;
  unposted_kredit: number;
}

export interface TbGroup {
  key: TbGroupKey;
  label: string;
  tipe: 'neraca' | 'pnl';
  normal_balance: 'DEBIT' | 'CREDIT';
  accounts: TbAccount[];
  total: TbGroupTotal;
}

export interface TbStatusRow {
  status: string;
  /** posted / reversed = true; draft / pending / approved = false. */
  posted: boolean;
  journals: number;
  lines: number;
  debit: number;
  kredit: number;
}

export interface TrialBalance {
  periode: {
    year: number;
    end_month: number;
    start_date: string;
    end_date: string;
    months: string[];
    include: TbInclude;
  };
  groups: TbGroup[];
  carry_forward: {
    /** Laba (+) / rugi (−) tahun-tahun lalu yang belum ditutup lewat jurnal penutup; tampil di ekuitas. */
    prior_year_profit: number;
  };
  current_year_profit: {
    /** Laba bersih tiap bulan. */
    months: number[];
    /** Laba berjalan kumulatif (baris Current Year Profit / Loss). */
    cumulative: number[];
    ytd: number;
  };
  totals: {
    total_asset: number[];
    total_liabilities_equity: number[];
    control: number[];
    total_asset_ytd: number;
    total_liabilities_equity_ytd: number;
    control_ytd: number;
  };
  balance_check: {
    total_debit: number;
    total_kredit: number;
    difference: number;
    debit_equals_kredit: boolean;
    balance_sheet_balanced: boolean;
  };
  status_summary: TbStatusRow[];
  unposted: { lines: number; has_unposted: boolean; debit: number; kredit: number };
  tanpa_coa: { accounts: number; codes: string[]; debit: number; kredit: number; coa_available: boolean };
  has_data: boolean;
  filter: { status_filter: TbStatusFilter; management_client_id: string | null; client_id: string | null };
}

export interface TbPeriods {
  years: { year: number; last_month: number; active_months: number[] }[];
  default_year: number;
}

export interface TbQuery {
  managementClientId: string;
  year?: number;
  /** Kosong = bulan terakhir yang ada transaksi di tahun itu. */
  endMonth?: number;
  include: TbInclude;
  statusFilter: TbStatusFilter;
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
}

async function bacaJson<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as T;
}

export async function fetchTrialBalance(q: TbQuery, signal?: AbortSignal): Promise<TrialBalance> {
  const params = new URLSearchParams({
    management_client_id: q.managementClientId,
    include: q.include,
    status_filter: q.statusFilter,
  });
  if (q.year) params.set('year', String(q.year));
  if (q.endMonth) params.set('end_month', String(q.endMonth));
  const res = await fetch(`${TB_URL}?${params}`, { signal, cache: 'no-store' });
  return bacaJson<TrialBalance>(res);
}

export async function fetchTrialBalancePeriods(
  managementClientId: string, statusFilter: TbStatusFilter, signal?: AbortSignal,
): Promise<TbPeriods> {
  const params = new URLSearchParams({ management_client_id: managementClientId, status_filter: statusFilter });
  const res = await fetch(`${TB_URL}/periods?${params}`, { signal, cache: 'no-store' });
  return bacaJson<TbPeriods>(res);
}