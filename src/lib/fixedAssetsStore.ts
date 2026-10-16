'use client';

// Fixed Assets -- terhubung ke backend modules/assets_and_equity/fixed_assets_v1.py
// (/api/v1/asset/fixed-assets/...). Jurnal FA yang diposting dibaca GL/FS
// sebagai sumber "fixed_asset", jadi aksi tulis juga memberi tahu halaman lain
// lewat event FIXED_ASSETS_EVENT.

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const FIXED_ASSETS_EVENT = 'gouf-fixed-assets-changed';
const api = createV1Api('/api/v1/asset/fixed-assets', FIXED_ASSETS_EVENT);

export const useFaData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) =>
  useV1Data(FIXED_ASSETS_EVENT, key, fn, awal);

// ============================================================
// TIPE
// ============================================================

export type DepMethod = 'straight_line' | 'declining_balance' | 'none';
export type AssetStatus = 'active' | 'under_construction' | 'inactive' | 'disposed';
export type DisplayStatus = AssetStatus | 'near_end_of_life' | 'fully_depreciated';
export type RunStatus = 'draft' | 'approved' | 'posted' | 'reversed';
export type DisposalStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'posted' | 'reversed';
export type DisposalMethod = 'sold' | 'scrapped' | 'lost' | 'transferred' | 'donated';
export type JournalType = 'acquisition' | 'depreciation' | 'disposal' | 'adjustment';
export type ReportType = 'asset_register' | 'depreciation_schedule' | 'asset_movement' | 'disposal' | 'nbv_summary' | 'near_end_of_life';

export interface AccountRef { id: string; code: string; name: string }

export interface CoaAccount extends AccountRef {
  classification: string | null;
  sub: string | null;
  standard_code: string | null;
  is_active: boolean;
}

export interface Category {
  id: string;
  name: string;
  description: string | null;
  is_depreciable: boolean;
  depreciation_method: DepMethod;
  useful_life_months: number | null;
  residual_rate: number;
  asset_account: AccountRef | null;
  accum_account: AccountRef | null;
  expense_account: AccountRef | null;
  asset_count: number;
}

export interface FixedAsset {
  id: string;
  asset_code: string;
  name: string;
  description: string | null;
  category_id: string | null;
  category: string | null;
  acquisition_date: string | null;
  depreciation_start_date: string | null;
  cost: number;
  original_cost: number;
  residual_value: number | null;
  accumulated_depreciation: number;
  net_book_value: number;
  opening_accumulated_depreciation: number;
  depreciation_method: DepMethod | null;
  method_override: DepMethod | null;
  useful_life_months: number | null;
  life_override: number | null;
  months_elapsed: number;
  remaining_life_months: number | null;
  monthly_depreciation: number;
  location: string | null;
  branch: string | null;
  department: string | null;
  custodian: string | null;
  serial_number: string | null;
  supplier: string | null;
  reference: string | null;
  status: AssetStatus;
  display_status: DisplayStatus;
  asset_account: AccountRef | null;
  accum_account: AccountRef | null;
  expense_account: AccountRef | null;
  asset_coa_override: string | null;
  accum_coa_override: string | null;
  expense_coa_override: string | null;
  acquisition_journal_id: string | null;
  disposal_date: string | null;
  disposal_value: number | null;
  issues: string[];
  created_at: string | null;
  created_by_name: string | null;
}

export interface Journal {
  id: string;
  journal_no: string;
  journal_type: JournalType;
  journal_date: string;
  asset_id: string | null;
  asset_code: string | null;
  asset_name: string | null;
  category: string | null;
  reference: string | null;
  description: string | null;
  amount: number;
  cost_change: number;
  accum_change: number;
  status: 'posted' | 'reversed';
  depreciation_run_id: string | null;
  disposal_id: string | null;
  posted_at: string | null;
  posted_by_name: string | null;
  reversal_date: string | null;
  reversal_reason: string | null;
  reversed_by_name: string | null;
  lines?: { line_no: number; account_code: string; account_name: string; description: string | null; debit: number; credit: number }[];
}

export interface Disposal {
  id: string;
  disposal_no: string;
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  category: string | null;
  disposal_date: string;
  method: DisposalMethod;
  reason: string | null;
  counterparty: string | null;
  proceeds: number;
  cost: number | null;
  accumulated: number | null;
  net_book_value: number | null;
  gain_loss: number | null;
  values_final: boolean;
  proceeds_account: AccountRef | null;
  gain_loss_account: AccountRef | null;
  proceeds_coa_id: string | null;
  gain_loss_coa_id: string | null;
  status: DisposalStatus;
  journal_id: string | null;
  rejected_reason: string | null;
  created_by_name: string | null;
  created_at: string | null;
  submitted_at: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  reversal_date: string | null;
  reversal_reason: string | null;
  reversed_by_name: string | null;
  journal?: { posted: boolean; journal_no: string | null; error: string | null; lines: { account_code: string; account_name: string; debit: number; credit: number }[] };
}

export interface KpiSet {
  total_cost: number;
  accumulated: number;
  nbv: number;
  active_cost: number;
  under_construction: number;
  near_end: number;
  additions_ytd: number;
  count: number;
}

export interface RegisterKpi { as_of: string; previous_as_of: string; current: KpiSet; previous: KpiSet }

export interface CategoryValue { category: string; cost: number; accumulated: number; nbv: number; count: number }

export interface Overview {
  as_of: string;
  kpi: RegisterKpi;
  trend: { month: string; nbv: number; cost: number }[];
  by_category: CategoryValue[];
  near_end_of_life: FixedAsset[];
  issues_count: number;
  category_count: number;
}

export interface Register { as_of: string; kpi: RegisterKpi; assets: FixedAsset[]; next_code: string }

export interface AssetDetail extends FixedAsset {
  journals: Journal[];
  disposals: Disposal[];
  schedule: { period: string; depreciation: number; accumulated: number; nbv: number }[];
}

export interface ReviewItem { asset_id: string; asset_code: string; name: string; nbv: number; issues: string[] }

export interface DepRun {
  id: string;
  run_no: string;
  period: string;
  posting_date: string;
  asset_count: number;
  total_amount: number;
  status: RunStatus;
  notes: string | null;
  prepared_by_name: string | null;
  created_at: string;
  approved_by_name: string | null;
  approved_at: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  reversal_date: string | null;
  reversal_reason: string | null;
  reversed_by_name: string | null;
  journal_count?: number;
  skipped?: ReviewItem[];
  lines?: {
    asset_id: string; asset_code: string | null; name: string | null; category: string | null; method: DepMethod;
    cost: number; accumulated_before: number; amount: number; nbv_after: number;
    expense_account: string; accum_account: string; journal_id: string | null;
  }[];
}

export interface DepreciationSummary {
  as_of: string;
  kpi: {
    current_month: number; previous_month: number; ytd: number; ytd_prev: number;
    pending_batches: number; pending_prev_month: number; posted_entries_ytd: number; posted_entries_prev_ytd: number;
  };
  trend: { month: string; amount: number }[];
  next_run: {
    period: string; eligible_assets: number; estimated_amount: number; methods: DepMethod[]; issues: number;
    existing_run_id: string | null; status: 'ready' | 'exists' | 'nothing_to_run';
  };
  runs: DepRun[];
  review: ReviewItem[];
}

export interface DepPreview {
  period: string;
  total: number;
  issues: ReviewItem[];
  lines: { asset_id: string; asset_code: string; name: string; category: string | null; method: DepMethod; cost: number;
    accumulated_before: number; amount: number; expense_account: string; accum_account: string }[];
}

export interface DisposalSummary {
  as_of: string;
  kpi: {
    pending: number; pending_value: number; disposed_ytd: number; disposed_prev_ytd: number;
    proceeds_ytd: number; proceeds_prev_ytd: number; gain_loss_ytd: number; gain_loss_prev_ytd: number;
  };
  queue: Disposal[];
  by_reason: { method: DisposalMethod; count: number }[];
  disposals: Disposal[];
}

export interface JournalList {
  kpi: {
    entries_ytd: number; entries_prev_ytd: number; entries_month: number; entries_prev_month: number;
    depreciation_ytd: number; depreciation_prev_ytd: number; disposals_ytd: number; disposals_prev_ytd: number;
  };
  journals: Journal[];
}

export interface ReportFilters { date_from: string; date_to: string; branch?: string; category_id?: string; location?: string }

export interface ReportsSummary {
  period: { from: string; to: string };
  kpi: { categories: number; nbv: number; nbv_prev: number; monthly_depreciation: number; monthly_depreciation_prev: number; disposals: number; disposals_prev: number };
  nbv_by_category: CategoryValue[];
  options: { branches: string[]; locations: string[]; categories: { id: string; name: string }[] };
  recent: { id: string; report_type: ReportType; period_from: string | null; period_to: string | null; format: 'pdf' | 'xlsx' | 'csv';
    row_count: number | null; created_at: string; created_by_name: string | null }[];
}

// Data laporan: bentuknya beda-beda per jenis.
export interface ReportData {
  report_type: ReportType;
  period: { from: string; to: string };
  client_name: string;
  rows?: Record<string, unknown>[];
  months?: string[];
  details?: Record<string, unknown>[];
  by_category?: { group: string; count: number; cost: number; accumulated: number; nbv: number }[];
  by_location?: { group: string; count: number; cost: number; accumulated: number; nbv: number }[];
  by_branch?: { group: string; count: number; cost: number; accumulated: number; nbv: number }[];
}

export interface CategoryInput {
  name: string;
  description?: string | null;
  is_depreciable: boolean;
  depreciation_method: DepMethod;
  useful_life_months: number | null;
  residual_rate: number;
  asset_coa_id: string | null;
  accum_coa_id: string | null;
  expense_coa_id: string | null;
}

export interface AssetInput {
  asset_code?: string | null;
  name: string;
  description?: string | null;
  category_id: string;
  acquisition_date: string;
  depreciation_start_date?: string | null;
  cost: number;
  residual_value: number | null;
  useful_life_months: number | null;
  depreciation_method: DepMethod | null;
  opening_accumulated_depreciation: number;
  location?: string | null;
  branch?: string | null;
  department?: string | null;
  custodian?: string | null;
  serial_number?: string | null;
  supplier?: string | null;
  reference?: string | null;
  status: 'active' | 'under_construction' | 'inactive';
  asset_coa_id?: string | null;
  accum_coa_id?: string | null;
  expense_coa_id?: string | null;
  post_acquisition: boolean;
  acquisition_credit_coa_id?: string | null;
}

export interface DisposalInput {
  asset_id: string;
  disposal_date: string;
  method: DisposalMethod;
  reason?: string | null;
  counterparty?: string | null;
  proceeds: number;
  proceeds_coa_id?: string | null;
  gain_loss_coa_id?: string | null;
  submit: boolean;
}

// ============================================================
// API
// ============================================================

const c = (clientId: string) => ({ client_id: clientId });

export const fetchFaAccounts = (clientId: string, signal?: AbortSignal) => api.get<CoaAccount[]>('/accounts', c(clientId), signal);
export const fetchCategories = (clientId: string, signal?: AbortSignal) => api.get<Category[]>('/categories', c(clientId), signal);
export const saveCategory = (clientId: string, body: CategoryInput, id?: string) =>
  api.send<Category>(id ? 'PUT' : 'POST', id ? `/categories/${id}` : '/categories', { client_id: clientId, ...body });
export const deleteCategory = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/categories/${id}`, undefined, c(clientId));
export const seedCategoriesFromCoa = (clientId: string) =>
  api.send<{ created: string[]; fixed_asset_accounts: number }>('POST', '/categories/seed-from-coa', c(clientId));

export const fetchOverview = (clientId: string, asOf: string, months = 12, signal?: AbortSignal) =>
  api.get<Overview>('/overview', { ...c(clientId), as_of: asOf, months }, signal);
export const fetchRegister = (clientId: string, asOf: string, signal?: AbortSignal) =>
  api.get<Register>('/assets', { ...c(clientId), as_of: asOf }, signal);
export const fetchAssetDetail = (clientId: string, id: string, asOf: string, signal?: AbortSignal) =>
  api.get<AssetDetail>(`/assets/${id}`, { ...c(clientId), as_of: asOf }, signal);
export const saveAsset = (clientId: string, body: AssetInput, id?: string) =>
  api.send<FixedAsset>(id ? 'PUT' : 'POST', id ? `/assets/${id}` : '/assets', { client_id: clientId, ...body });
export const deleteAsset = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/assets/${id}`, undefined, c(clientId));
export const postAcquisition = (clientId: string, id: string, creditCoaId: string) =>
  api.send<Journal>('POST', `/assets/${id}/acquisition-journal`, { client_id: clientId, credit_coa_id: creditCoaId });
export const postAdjustment = (clientId: string, id: string, body: {
  target: 'cost' | 'accumulated_depreciation'; amount: number; adjustment_date: string; offset_coa_id: string; reference?: string | null; description: string;
}) => api.send<Journal>('POST', `/assets/${id}/adjustments`, { client_id: clientId, ...body });

export const fetchDepreciation = (clientId: string, asOf: string, signal?: AbortSignal) =>
  api.get<DepreciationSummary>('/depreciation', { ...c(clientId), as_of: asOf }, signal);
export const previewDepreciation = (clientId: string, period: string) =>
  api.send<DepPreview>('POST', '/depreciation/preview', { client_id: clientId, period }, {}, false);
export const createRun = (clientId: string, period: string, notes: string | null, postNow: boolean) =>
  api.send<DepRun>('POST', '/depreciation/runs', { client_id: clientId, period, notes, post_now: postNow });
export const fetchRun = (clientId: string, id: string, signal?: AbortSignal) => api.get<DepRun>(`/depreciation/runs/${id}`, c(clientId), signal);
export const runAction = (clientId: string, id: string, action: 'approve' | 'return-to-draft' | 'post' | 'recalculate') =>
  api.send<DepRun>('POST', `/depreciation/runs/${id}/${action}`, c(clientId));
export const deleteRun = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/depreciation/runs/${id}`, undefined, c(clientId));
export const reverseRun = (clientId: string, id: string, reason: string, reversalDate?: string) =>
  api.send<DepRun>('POST', `/depreciation/runs/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

export const fetchDisposals = (clientId: string, asOf: string, signal?: AbortSignal) =>
  api.get<DisposalSummary>('/disposals', { ...c(clientId), as_of: asOf }, signal);
export const fetchDisposal = (clientId: string, id: string, signal?: AbortSignal) => api.get<Disposal>(`/disposals/${id}`, c(clientId), signal);
export const saveDisposal = (clientId: string, body: DisposalInput, id?: string) =>
  api.send<Disposal>(id ? 'PUT' : 'POST', id ? `/disposals/${id}` : '/disposals', { client_id: clientId, ...body });
export const deleteDisposal = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/disposals/${id}`, undefined, c(clientId));
export const disposalAction = (clientId: string, id: string, action: 'submit' | 'approve' | 'post') =>
  api.send<Disposal>('POST', `/disposals/${id}/${action}`, c(clientId));
export const rejectDisposal = (clientId: string, id: string, reason: string) =>
  api.send<Disposal>('POST', `/disposals/${id}/reject`, { client_id: clientId, reason });
export const reverseDisposal = (clientId: string, id: string, reason: string, reversalDate?: string) =>
  api.send<Disposal>('POST', `/disposals/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

export const fetchJournals = (clientId: string, f: { date_from?: string; date_to?: string; as_of?: string }, signal?: AbortSignal) =>
  api.get<JournalList>('/journals', { ...c(clientId), ...f }, signal);
export const fetchJournal = (clientId: string, id: string, signal?: AbortSignal) => api.get<Journal>(`/journals/${id}`, c(clientId), signal);
export const reverseJournal = (clientId: string, id: string, reason: string, reversalDate?: string) =>
  api.send<Journal>('POST', `/journals/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

export const fetchReportsSummary = (clientId: string, f: ReportFilters, signal?: AbortSignal) =>
  api.get<ReportsSummary>('/reports', { ...c(clientId), ...f }, signal);
export const fetchReport = (clientId: string, type: ReportType, f: ReportFilters, signal?: AbortSignal) =>
  api.get<ReportData>(`/reports/${type}`, { ...c(clientId), ...f }, signal);
export const logReport = (clientId: string, body: { report_type: ReportType; period_from: string; period_to: string; format: 'pdf' | 'xlsx' | 'csv'; row_count: number; filters?: Record<string, unknown> }) =>
  api.send<{ id: string }>('POST', '/reports/log', { client_id: clientId, ...body });

// ============================================================
// LABEL
// ============================================================

export const METHOD_LABEL: Record<DepMethod, string> = { straight_line: 'Straight Line', declining_balance: 'Double Declining', none: 'Not Depreciated' };

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  active: 'Active', under_construction: 'Under Construction', inactive: 'Inactive', disposed: 'Disposed',
  near_end_of_life: 'Near End of Life', fully_depreciated: 'Fully Depreciated',
};
export const STATUS_STYLE: Record<DisplayStatus, string> = {
  active: 'bg-emerald-50 text-emerald-700', under_construction: 'bg-sky-50 text-sky-700', inactive: 'bg-slate-100 text-slate-600',
  disposed: 'bg-rose-50 text-rose-700', near_end_of_life: 'bg-amber-50 text-amber-700', fully_depreciated: 'bg-violet-50 text-violet-700',
};

export const RUN_STATUS_STYLE: Record<RunStatus, string> = {
  draft: 'bg-slate-100 text-slate-600', approved: 'bg-emerald-50 text-emerald-700', posted: 'bg-emerald-100 text-emerald-800', reversed: 'bg-rose-50 text-rose-700',
};

export const DISPOSAL_METHOD_LABEL: Record<DisposalMethod, string> = {
  sold: 'Sold', scrapped: 'Scrapped', lost: 'Lost', transferred: 'Transferred', donated: 'Donated',
};
export const DISPOSAL_METHOD_COLOR: Record<DisposalMethod, string> = {
  sold: '#0F7D4E', scrapped: '#14B8A6', lost: '#5EEAD4', transferred: '#CBD5E1', donated: '#94A3B8',
};

/** Kolom "Approval Status" & "Posting Status" di tabel Disposal Transactions. */
export const disposalApproval = (s: DisposalStatus): { label: string; style: string } => {
  if (s === 'draft') return { label: 'Draft', style: 'bg-slate-100 text-slate-600' };
  if (s === 'pending') return { label: 'Pending', style: 'bg-amber-50 text-amber-700' };
  if (s === 'rejected') return { label: 'Rejected', style: 'bg-rose-50 text-rose-700' };
  return { label: 'Approved', style: 'bg-emerald-50 text-emerald-700' };
};
export const disposalPosting = (s: DisposalStatus): { label: string; style: string } => {
  if (s === 'posted') return { label: 'Posted', style: 'bg-emerald-50 text-emerald-700' };
  if (s === 'reversed') return { label: 'Reversed', style: 'bg-rose-50 text-rose-700' };
  return { label: 'Unposted', style: 'bg-rose-50 text-rose-600' };
};

export const JOURNAL_TYPE_LABEL: Record<JournalType, string> = {
  acquisition: 'Acquisition', depreciation: 'Depreciation', disposal: 'Disposal', adjustment: 'Adjustment',
};
export const JOURNAL_TYPE_STYLE: Record<JournalType, string> = {
  acquisition: 'bg-emerald-50 text-emerald-700', depreciation: 'bg-sky-50 text-sky-700',
  disposal: 'bg-rose-50 text-rose-700', adjustment: 'bg-amber-50 text-amber-700',
};

export const REPORT_META: Record<ReportType, { title: string; description: string }> = {
  asset_register: { title: 'Asset Register Report', description: 'Complete list of fixed assets with details including acquisition cost, location, and status.' },
  depreciation_schedule: { title: 'Depreciation Schedule', description: 'Detailed depreciation schedule by asset including monthly and yearly depreciation.' },
  asset_movement: { title: 'Asset Movement Report', description: 'Track asset additions, adjustments, and disposals within a selected period.' },
  disposal: { title: 'Disposal Report', description: 'List of disposed assets with disposal date, method, and proceeds (if any).' },
  nbv_summary: { title: 'Net Book Value Summary', description: 'Net book value analysis by category, location, or branch.' },
  near_end_of_life: { title: 'Assets Near End of Useful Life', description: 'Assets that are approaching the end of their useful life.' },
};

export const lifeLabel = (months: number | null | undefined) => {
  if (months === null || months === undefined) return '—';
  if (months % 12 === 0) return `${months / 12} ${months === 12 ? 'year' : 'years'}`;
  if (months < 12) return `${months} mo`;
  return `${Math.floor(months / 12)}y ${months % 12}m`;
};
