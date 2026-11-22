// Data layer report "Adjustment" (src/app/reports/adjustment),
// terhubung ke backend/modules/financial_statements/adjustment_v1.py:
//   GET /api/v1/reports/adjustment   jurnal penyesuaian + efeknya ke Trial Balance
//
// Jurnal penyesuaian = Journal Entry bertanda `is_adjustment` (checkbox "Adjusting entry"
// di form New Journal Entry; backend/migrations/63-*.py). Daftar tahun yang punya
// transaksi: pakai fetchTrialBalancePeriods() dari trialBalanceStore.ts.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const ADJ_URL = `${API_BASE_URL}/api/v1/reports/adjustment`;

export type AdjStatusFilter = 'all' | 'posted';

export interface AdjLine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  kredit: number;
}

export interface AdjEntry {
  id: string;
  number: string;
  /** 'YYYY-MM-DD' */
  date: string;
  description: string;
  status: string;
  posted: boolean;
  lines: AdjLine[];
  total_debit: number;
  total_kredit: number;
}

export interface AdjTbRow {
  account_code: string;
  account_name: string;
  tipe: 'neraca' | 'pnl';
  unadj_debit: number;
  unadj_kredit: number;
  adj_debit: number;
  adj_kredit: number;
  adjusted_debit: number;
  adjusted_kredit: number;
}

export interface AdjTbTotals {
  unadj_debit: number;
  unadj_kredit: number;
  adj_debit: number;
  adj_kredit: number;
  adjusted_debit: number;
  adjusted_kredit: number;
}

export interface AdjustmentReport {
  periode: { year: number; end_month: number; start_date: string; end_date: string };
  summary: {
    entry_count: number;
    line_count: number;
    total_debit: number;
    total_kredit: number;
    balanced: boolean;
    /** Pengaruh ke laba bersih (negatif = laba turun). */
    net_profit_effect: number;
    unposted_entries: number;
  };
  entries: AdjEntry[];
  tb_effect: AdjTbRow[];
  tb_effect_totals: AdjTbTotals;
  has_data: boolean;
  filter: { status_filter: AdjStatusFilter; management_client_id: string | null; client_id: string | null };
}

export interface AdjQuery {
  managementClientId: string;
  year: number;
  endMonth: number;
  statusFilter: AdjStatusFilter;
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
}

export async function fetchAdjustment(q: AdjQuery, signal?: AbortSignal): Promise<AdjustmentReport> {
  const params = new URLSearchParams({
    management_client_id: q.managementClientId,
    year: String(q.year),
    end_month: String(q.endMonth),
    status_filter: q.statusFilter,
  });
  const res = await fetch(`${ADJ_URL}?${params}`, { signal, cache: 'no-store' });
  const json = (await res.json().catch(() => null)) as ApiEnvelope<AdjustmentReport> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as AdjustmentReport;
}
