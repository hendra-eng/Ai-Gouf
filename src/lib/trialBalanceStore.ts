// Data layer report "Trial Balance" (src/app/reports/trial-balance),
// terhubung ke backend/modules/financial_statements/trial_balance_v1.py:
//   GET /api/v1/reports/trial-balance            TB per akun per bulan + YTD
//   GET /api/v1/reports/trial-balance/periods    tahun yang punya transaksi
//
// Sumber backend = sama dengan General Ledger: semua transaksi yang sudah masuk
// Journal Preview (draft / pending / approved / posted) langsung masuk TB tanpa
// menunggu Post. `status_filter=posted` = hanya yang sudah posted (angka resmi).

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const TB_URL = `${API_BASE_URL}/api/v1/reports/trial-balance`;

export type TbInclude = 'non_zero' | 'with_activity' | 'all';
export type TbStatusFilter = 'all' | 'posted';

export interface TbMonth { debit: number; kredit: number; balance: number }

export interface TbAccount {
  account_code: string;
  account_name: string;
  account_head: string | null;
  group: string;
  tipe: 'neraca' | 'pnl';
  normal_balance: 'DEBIT' | 'CREDIT';
  in_coa: boolean;
  opening_balance: number;
  months: TbMonth[];
  total_debit: number;
  total_kredit: number;
  ytd: number;
  /** Nominal yang statusnya belum posted (draft / pending / approved) s.d. akhir periode. */
  unposted_debit: number;
  unposted_kredit: number;
  unposted_lines: number;
}

export interface TbGroup {
  key: string;
  label: string;
  tipe: 'neraca' | 'pnl';
  normal_balance: 'DEBIT' | 'CREDIT';
  accounts: TbAccount[];
  total: {
    opening_balance: number;
    months: TbMonth[];
    ytd: number;
    unposted_debit: number;
    unposted_kredit: number;
  };
}

export interface TbStatusSummary {
  status: string;
  posted: boolean;
  journals: number;
  lines: number;
  debit: number;
  kredit: number;
}

export interface TrialBalance {
  periode: { year: number; end_month: number; start_date: string; end_date: string; months: string[]; include: TbInclude };
  groups: TbGroup[];
  carry_forward: { prior_year_profit: number };
  current_year_profit: { months: number[]; cumulative: number[]; ytd: number };
  totals: {
    total_asset: number[];
    total_liabilities_equity: number[];
    control: number[];
    total_asset_ytd: number;
    total_liabilities_equity_ytd: number;
    control_ytd: number;
  };
  balance_check: { total_debit: number; total_kredit: number; difference: number; debit_equals_kredit: boolean; balance_sheet_balanced: boolean };
  status_summary: TbStatusSummary[];
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
  year: number;
  endMonth?: number;
  include: TbInclude;
  statusFilter: TbStatusFilter;
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, cache: 'no-store' });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as T;
}

export function fetchTrialBalance(q: TbQuery, signal?: AbortSignal): Promise<TrialBalance> {
  const params = new URLSearchParams({
    management_client_id: q.managementClientId,
    year: String(q.year),
    include: q.include,
    status_filter: q.statusFilter,
  });
  if (q.endMonth) params.set('end_month', String(q.endMonth));
  return getJson<TrialBalance>(`${TB_URL}?${params}`, signal);
}

export function fetchTrialBalancePeriods(managementClientId: string, statusFilter: TbStatusFilter, signal?: AbortSignal): Promise<TbPeriods> {
  const params = new URLSearchParams({ management_client_id: managementClientId, status_filter: statusFilter });
  return getJson<TbPeriods>(`${TB_URL}/periods?${params}`, signal);
}
