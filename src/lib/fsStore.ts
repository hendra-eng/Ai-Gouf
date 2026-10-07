// Data layer Financial Statements BERBASIS MAPPING COA (Task Plan 16-20),
// terhubung ke backend/modules/financial_statements/statements_v1.py
// (/api/v1/reports/financial-statements/...) dan fs_mapping_v1.py
// (/api/v1/management/fs-mapping).
//
// Semua angka dari GL posted (sama dengan General Ledger). Angka laporan
// sudah di sisi normal seksinya (aset/beban positif di debit, liabilitas/
// ekuitas/pendapatan positif di kredit), bukan saldo bertanda.
//
// Catatan: src/lib/financialStatementsStore.tsx (mesin lama) masih dipakai
// Overview/Analytics/Budget -- jangan dicampur.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const FS_URL = `${API_BASE_URL}/api/v1/reports/financial-statements`;
const MAP_URL = `${API_BASE_URL}/api/v1/management/fs-mapping`;

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  detail?: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = json?.detail;
    throw new Error(json?.message || (typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`);
  }
  return json.data as T;
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') p.set(k, String(v));
  });
  return p.toString();
}

// ── Periode ──────────────────────────────────────────────────────────

export type PeriodType = 'month' | 'quarter' | 'ytd' | 'year' | 'custom';
export type CompareMode = 'none' | 'previous_period' | 'previous_year' | 'custom';
export type BsCompareMode = 'none' | 'previous_month' | 'previous_year_end' | 'same_date_last_year' | 'custom';

export interface PeriodQuery {
  period_type: PeriodType;
  year?: number;
  month?: number;
  quarter?: number;
  start_date?: string;
  end_date?: string;
  compare: CompareMode;
  compare_start?: string;
  compare_end?: string;
}

export interface PeriodInfo {
  period_type: PeriodType;
  start: string;
  end: string;
  label: string;
  compare: { start: string; end: string; label: string } | null;
}

export interface ClientMeta {
  management_client_id: string;
  company_name: string | null;
  books_start: string | null;
  has_data: boolean;
}

export interface FsWarning { code: string; account_code: string; account_name: string; message: string }

export interface UnbalancedJournal { number: string; date: string; source: string; debit: number; credit: number; difference: number }

// ── Baris laporan ────────────────────────────────────────────────────

export interface FsAccountRow {
  code: string | null;
  name: string;
  coa_id: string | null;
  amount: number;
  compare_amount: number | null;
  warnings: string[];
  computed?: boolean;
  equity_component?: string | null;
  monthly?: number[];
}

export interface FsLine {
  key: string;
  label: string;
  amount: number;
  compare_amount: number | null;
  accounts: FsAccountRow[];
  monthly?: number[];
}

export interface FsSection {
  key: string;
  label: string;
  lines: FsLine[];
  total: number;
  compare_total: number | null;
  monthly?: number[] | null;
}

export interface BalanceSheet {
  as_of: string;
  compare_as_of: string | null;
  sections: FsSection[];
  totals: {
    assets: number; liabilities: number; equity: number; liabilities_and_equity: number;
    compare_assets: number | null; compare_liabilities: number | null; compare_equity: number | null;
    compare_liabilities_and_equity: number | null;
  };
  check: { balanced: boolean; difference: number; compare_difference: number | null; unbalanced_journals: UnbalancedJournal[] };
  warnings: FsWarning[];
  client: ClientMeta;
}

export interface PlSubtotal { key: string; label: string; amount: number; compare_amount: number | null; monthly: number[] | null }

export type PlRow = ({ type: 'section' } & FsSection) | ({ type: 'subtotal' } & PlSubtotal);

export interface ProfitLoss {
  period: { start: string; end: string };
  compare_period: { start: string; end: string } | null;
  segment: { type: string; value: string } | null;
  months: string[];
  rows: PlRow[];
  summary: Record<'gross_profit' | 'operating_profit' | 'profit_before_tax' | 'net_profit', PlSubtotal>;
  warnings: FsWarning[];
  period_info: PeriodInfo;
  client: ClientMeta;
}

export interface EquityDrillRow { code: string | null; name: string; coa_id: string | null; amount: number; computed?: boolean }

export interface EquityRow {
  key: string;
  label: string;
  type: 'opening' | 'movement' | 'closing';
  values: Record<string, number>;
  total: number;
  accounts: Record<string, EquityDrillRow[]>;
}

export interface ChangesInEquity {
  period: { start: string; end: string };
  components: { key: string; label: string }[];
  rows: EquityRow[];
  check: { closing_equity: number; balance_sheet_equity: number; difference: number; reconciled: boolean };
  warnings: FsWarning[];
  period_info: PeriodInfo;
  client: ClientMeta;
}

export interface CfAccountRow { code: string; name: string; coa_id: string | null; section: string; opening: number; closing: number; amount: number; warnings: string[] }
export interface CfLine { key: string; label: string; amount: number; accounts: CfAccountRow[] }

export interface CashFlowBody {
  period: { start: string; end: string };
  method: 'indirect';
  operating: { net_profit: number; non_cash_adjustments: CfLine[]; working_capital: CfLine[]; unmapped: CfLine[]; total: number };
  investing: { lines: CfLine[]; total: number };
  financing: { lines: CfLine[]; total: number };
  net_change: number;
  opening_cash: number;
  ending_cash: number;
  balance_sheet_ending_cash: number;
  check: { difference: number; reconciled: boolean; unbalanced_journals: UnbalancedJournal[] };
  cash_accounts: { code: string; name: string; coa_id: string | null; opening: number; closing: number }[];
  unmapped_accounts: { code: string; name: string; coa_id: string | null; section: string; in_coa: boolean; has_movement: boolean }[];
}

export interface CashFlow extends CashFlowBody {
  compare?: CashFlowBody;
  period_info: PeriodInfo;
  client: ClientMeta;
}

export interface SegmentType { key: string; label: string; values: string[] }

// ── CALK ─────────────────────────────────────────────────────────────

export interface NoteOverride {
  id: string;
  override_value: number;
  system_value_at_override: number | null;
  reason: string | null;
  created_at: string | null;
  created_by_name: string | null;
}

export interface NoteRow {
  code: string;
  name: string;
  coa_id: string | null;
  system_amount: number;
  amount: number;
  compare_amount: number | null;
  override: NoteOverride | null;
}

export interface NoteGroup {
  label: string;
  statement: 'BALANCE_SHEET' | 'PROFIT_LOSS';
  rows: NoteRow[];
  system_total: number;
  total: number;
  compare_total: number | null;
  difference: number;
  reconciled: boolean;
}

export interface FsNote {
  id: string;
  no: number;
  note_key: string;
  title: string;
  statement: string;
  note_type: 'policy' | 'account';
  is_custom: boolean;
  narrative: string;
  narrative_raw: string;
  narrative_source: 'period' | 'client' | 'template';
  status: 'draft' | 'final';
  groups: NoteGroup[];
  has_override: boolean;
}

export interface FsNotes {
  as_of: string;
  period: { start: string; end: string };
  compare_period: { start: string; end: string } | null;
  notes: FsNote[];
  accounts_without_note: { code: string; name: string; note_key: string | null; amount: number }[];
  period_info: PeriodInfo;
  client: ClientMeta;
  permissions: { edit_narrative: boolean; override: boolean };
  disabled_notes: { id: string; note_key: string; title: string; note_type: 'policy' | 'account'; is_custom: boolean }[];
}

export interface NoteAudit {
  id: string;
  period_end: string | null;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  user_name: string | null;
  created_at: string;
}

// ── Fetchers ─────────────────────────────────────────────────────────

const get = <T,>(path: string, params: Record<string, string | number | boolean | null | undefined>, signal?: AbortSignal) =>
  fetch(`${FS_URL}${path}?${qs(params)}`, { cache: 'no-store', signal }).then(r => baca<T>(r));

export const fetchBalanceSheet = (clientId: string, q: { as_of: string; compare: BsCompareMode; compare_as_of?: string; show_zero?: boolean }, signal?: AbortSignal) =>
  get<BalanceSheet>('/balance-sheet', { management_client_id: clientId, ...q }, signal);

export const fetchProfitLoss = (clientId: string, q: PeriodQuery & { segment_type?: string; segment_value?: string; breakdown?: 'none' | 'monthly' }, signal?: AbortSignal) =>
  get<ProfitLoss>('/profit-loss', { management_client_id: clientId, ...q }, signal);

export const fetchChangesInEquity = (clientId: string, q: PeriodQuery, signal?: AbortSignal) =>
  get<ChangesInEquity>('/changes-in-equity', { management_client_id: clientId, ...q }, signal);

export const fetchCashFlow = (clientId: string, q: PeriodQuery, signal?: AbortSignal) =>
  get<CashFlow>('/cash-flow', { management_client_id: clientId, ...q }, signal);

export const fetchSegments = (clientId: string) =>
  get<{ types: SegmentType[] }>('/segments', { management_client_id: clientId });

export const fetchNotes = (clientId: string, q: PeriodQuery, signal?: AbortSignal) =>
  get<FsNotes>('/notes', { management_client_id: clientId, ...q }, signal);

export const fetchNoteAudit = (clientId: string, noteId: string) =>
  get<NoteAudit[]>(`/notes/${noteId}/audit`, { management_client_id: clientId });

export function notesDocxUrl(clientId: string, q: PeriodQuery): string {
  return `${FS_URL}/notes/export.docx?${qs({ management_client_id: clientId, ...q })}`;
}

async function kirim<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return baca<T>(res);
}

export const saveNoteContent = (clientId: string, noteId: string, body: { period_end: string; narrative?: string; status?: 'draft' | 'final' }) =>
  kirim(`${FS_URL}/notes/${noteId}/content`, 'PUT', { management_client_id: clientId, ...body });

export const updateNote = (clientId: string, noteId: string, body: { title?: string; narrative?: string; is_enabled?: boolean; sort_order?: number }) =>
  kirim(`${FS_URL}/notes/${noteId}`, 'PUT', { management_client_id: clientId, ...body });

export const createNote = (clientId: string, body: { title: string; statement: string; note_type: 'policy' | 'account'; note_key?: string; narrative?: string }) =>
  kirim(`${FS_URL}/notes`, 'POST', { management_client_id: clientId, ...body });

export const deleteNote = (clientId: string, noteId: string) =>
  kirim(`${FS_URL}/notes/${noteId}?${qs({ management_client_id: clientId })}`, 'DELETE');

export const setNoteOverride = (clientId: string, noteId: string, body: { period_end: string; row_key: string; override_value: number; system_value: number; reason: string }) =>
  kirim(`${FS_URL}/notes/${noteId}/overrides`, 'POST', { management_client_id: clientId, ...body });

export const removeNoteOverride = (clientId: string, noteId: string, overrideId: string, reason?: string) =>
  kirim(`${FS_URL}/notes/${noteId}/overrides/${overrideId}?${qs({ management_client_id: clientId, reason })}`, 'DELETE');

// ── Mapping ──────────────────────────────────────────────────────────

export interface MappingFields {
  fs_section: string | null;
  fs_line: string | null;
  equity_component: string | null;
  cash_flow_category: string | null;
  cash_flow_line: string | null;
  note_key: string | null;
}

export interface MappedAccount {
  coa_id: string | null;
  code: string;
  name: string;
  classification: string | null;
  standard_account_code: string | null;
  in_coa: boolean;
  is_active: boolean;
  jenis: 'BS' | 'PL';
  section: string;
  line: string;
  equity_component: string | null;
  cash_flow_category: string | null;
  cash_flow_line: string | null;
  note_key: string | null;
  mapping_source: 'client' | 'default' | 'none';
  warnings: string[];
  account_head: string | null;
  account_sub: string | null;
  saved: (MappingFields & { id: string; coa_id: string }) | null;
}

export interface Option { key: string; label: string }

export interface FsMapping {
  accounts: MappedAccount[];
  summary: { accounts: number; saved: number; no_cash_flow_mapping: number; no_equity_component: number; with_warnings: number };
  options: {
    balance_sheet_sections: Option[];
    profit_loss_sections: Option[];
    equity_components: Option[];
    cash_flow_categories: Option[];
    notes: Option[];
    warnings: Record<string, string>;
  };
}

export const fetchFsMapping = (clientId: string) =>
  fetch(`${MAP_URL}?${qs({ client_id: clientId })}`, { cache: 'no-store' }).then(r => baca<FsMapping>(r));

export const saveFsMapping = (clientId: string, coaId: string, fields: Partial<MappingFields>) =>
  kirim(`${MAP_URL}/${coaId}`, 'PUT', { client_id: clientId, ...fields });

export const resetFsMapping = (clientId: string, coaId: string) =>
  kirim(`${MAP_URL}/${coaId}?${qs({ client_id: clientId })}`, 'DELETE');

export const applyFsMappingDefaults = (clientId: string, overwrite: boolean) =>
  kirim<{ created: number; updated: number; skipped: number; without_rule: number }>(`${MAP_URL}/apply-defaults`, 'POST', { client_id: clientId, overwrite });
