'use client';

// Cash & Bank -- terhubung ke backend modules/transactions/bank_cash_v1.py
// (/api/v1/transactions/bank-cash/...). Dipakai semua tab di
// /transactions/bank-cash (Overview, Cash Payment/Receipt, Bank Feed,
// Reconciliation, Journal Preview, Exceptions, Posted).
//
// Setiap aksi tulis memancarkan BANK_CASH_EVENT supaya hook di tab lain
// (dan tab Sales/Purchase yang membaca status bayar invoice) memuat ulang.

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const BC_URL = `${API_BASE_URL}/api/v1/transactions/bank-cash`;

export const BANK_CASH_EVENT = 'gouf-bank-cash-changed';

// ============================================================
// TIPE
// ============================================================

export type CashType = 'bank' | 'cash_on_hand' | 'petty_cash' | 'transit';
export type Direction = 'receipt' | 'payment';
export type TxStatus = 'draft' | 'approved' | 'posted' | 'reversed';
export type MutationStatus = 'unmatched' | 'matched' | 'ignored';
export type LineType = 'sales_invoice' | 'purchase' | 'account';
/** Keyakinan hasil ekstraksi per baris rekening koran (null = baris sebelum fitur ini). */
export type Confidence = 'high' | 'medium' | 'low';
export type ColumnRole = 'date' | 'description' | 'debit' | 'credit' | 'amount' | 'dc_flag' | 'balance' | 'balance_before' | 'reference' | 'ignore';
export type ExtractionMethod = 'grid' | 'words' | 'ocr' | 'table' | 'legacy';
export type ValidationStatus = 'verified' | 'partial' | 'unverified' | 'failed';

export interface BcAccount {
  id: string;
  code: string;
  name: string;
  classification: string | null;
  sub: string | null;
  cash_type: CashType | null;
  is_active: boolean;
}

export interface BcStatement {
  id: string;
  bank_coa_id: string;
  bank_account_code: string | null;
  bank_account_name: string | null;
  file_name: string;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  total_debit: number;
  total_credit: number;
  line_count: number;
  duplicate_count: number;
  matched_count: number;
  unmatched_count: number;
  ignored_count: number;
  warnings: string[];
  created_at: string;
  created_by_name: string | null;
  file_type: string | null;
  extraction_method: ExtractionMethod | null;
  template_id: string | null;
  template_name: string | null;
  validation: BcValidation | null;
  /** Baris unmatched dengan confidence low (perlu review). */
  low_confidence_count: number;
}

export interface BcValidationCheck {
  label: string;
  statement: number;
  extracted: number;
  ok: boolean;
}

/** Ringkasan validasi ekstraksi (saldo berjalan + total resmi rekening koran). */
export interface BcValidation {
  status: ValidationStatus;
  checks: BcValidationCheck[];
  balance_checkpoints: number;
  balance_mismatches: number;
  rows_high: number;
  rows_medium: number;
  rows_low: number;
  verified_pct: number;
  opening_balance: number | null;
  closing_balance: number | null;
  total_debit: number;
  total_credit: number;
}

export interface BcMutationTx {
  id: string;
  tx_number: string;
  status: TxStatus;
  kind: 'invoice' | 'non_invoice';
  category: string | null;
  counterparty: string | null;
  amount: number;
}

export interface BcMutation {
  id: string;
  statement_id: string;
  bank_coa_id: string;
  bank_account_code: string | null;
  bank_account_name: string | null;
  line_no: number;
  date: string;
  description: string | null;
  /** Uang KELUAR dari rekening. */
  debit: number;
  /** Uang MASUK ke rekening. */
  credit: number;
  balance_after: number | null;
  status: MutationStatus;
  ignore_reason: string | null;
  file_name: string | null;
  confidence: Confidence | null;
  confidence_notes: string[];
  page_no: number | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  transaction: BcMutationTx | null;
}

export interface BcTxLine {
  id: string;
  line_no: number;
  line_type: LineType;
  sales_invoice_id: string | null;
  purchase_transaction_id: string | null;
  invoice_no: string | null;
  party: string | null;
  coa_id: string | null;
  account_code: string;
  account_name: string;
  description: string | null;
  debit: number;
  credit: number;
  /** Nominal baris dari sudut pandang arah kas (positif = mengisi nominal kas). */
  amount: number;
}

export interface BcJournalLine {
  line_no: number;
  account_code: string;
  account_name: string;
  description: string | null;
  debit: number;
  credit: number;
}

export interface BcTransaction {
  id: string;
  tx_number: string;
  direction: Direction;
  tx_date: string;
  bank_coa_id: string;
  bank_account_code: string;
  bank_account_name: string;
  amount: number;
  kind: 'invoice' | 'non_invoice';
  category: string | null;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  source: 'bank_feed' | 'manual';
  mutation: { id: string; date: string; description: string | null; debit: number; credit: number; statement_id: string } | null;
  status: TxStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  posted_at: string | null;
  posted_by_name: string | null;
  reversal_date: string | null;
  reversal_reason: string | null;
  reversed_at: string | null;
  reversed_by_name: string | null;
  created_at: string;
  created_by_name: string | null;
  lines: BcTxLine[];
  journal: BcJournalLine[];
}

export interface BcInvoice {
  type: 'sales' | 'purchase';
  id: string;
  no: string;
  purchase_no?: string;
  invoice_number?: string | null;
  party: string | null;
  date: string;
  purchase_date?: string;
  due_date: string | null;
  description: string | null;
  category: string | null;
  total: number;
  /** Sudah dibayar/diterima (posted). */
  paid: number;
  /** Sudah dicocokkan/diinput tapi transaksinya belum diposting. */
  in_process: number;
  outstanding: number;
  status: string;
  payment_status?: string;
}

export interface BcAllocation {
  type: 'sales_invoice' | 'purchase';
  invoice_id: string;
  invoice_no: string | null;
  party: string | null;
  outstanding: number;
  amount: number;
}

export interface BcCandidate {
  kind: 'single' | 'combo';
  exact: boolean;
  ref_hit: boolean;
  party_ratio: number;
  score: number;
  allocations: BcAllocation[];
}

export interface BcSuggestion {
  mutation_id: string;
  direction: Direction;
  amount: number;
  candidates: BcCandidate[];
  auto_match: boolean;
}

export interface BcOverviewAccount extends BcAccount {
  book_balance: number;
  bank_balance: number | null;
  bank_balance_date: string | null;
  unmatched_count: number;
}

export interface BcOverview {
  year: number;
  accounts: BcOverviewAccount[];
  monthly: { month: number; cash_in: number; cash_out: number }[];
  pipeline: Record<TxStatus, { count: number; amount: number }>;
  mutations: Record<MutationStatus, number>;
}

/** Baris lawan untuk membuat/mengubah transaksi. */
export interface BcLineInput {
  type: LineType;
  invoice_id?: string | null;
  coa_id?: string | null;
  amount: number;
  /** Akun bebas saja; default = sisi lawan kas (receipt -> credit, payment -> debit). */
  side?: 'debit' | 'credit' | null;
  description?: string | null;
}

export interface BcTxInput {
  client_id: string;
  direction: Direction;
  tx_date: string;
  bank_coa_id: string;
  category?: string | null;
  counterparty?: string | null;
  description?: string | null;
  reference?: string | null;
  lines: BcLineInput[];
}

export interface BcUploadResult {
  statement_id: string;
  file_name: string;
  imported: number;
  duplicates: number;
  period_start: string | null;
  period_end: string | null;
  opening_balance: number | null;
  closing_balance: number | null;
  warnings: string[];
  method: ExtractionMethod;
  validation_status: ValidationStatus;
  template: { id: string; name: string | null; action: 'used' | 'created' | 'updated'; detected_by: 'auto' | 'manual' } | null;
  confidence: Record<Confidence, number>;
  bank_coa_id: string;
  bank_account_code: string;
  bank_account_name: string;
  /** Mapping bank yang dipakai ('used') atau baru dipelajari dari upload ini ('created'). */
  bank_mapping: (BcBankMapping & { match_by: BankMappingMatch | null; action: 'used' | 'created' }) | null;
}

/** Cara file dicocokkan ke mapping bank (urutan prioritas backend). */
export type BankMappingMatch = 'account_number' | 'keyword' | 'template' | 'bank_name';

/** Mapping bank / rekening -> akun kas-bank COA (financial_transaction_bank_cash_bank_mappings). */
export interface BcBankMapping {
  id: string;
  bank_name: string;
  account_number: string | null;
  match_keyword: string | null;
  bank_coa_id: string;
  bank_account_code: string | null;
  bank_account_name: string | null;
  template_id: string | null;
  template_name: string | null;
  notes: string | null;
  is_active: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface BcBankMappingInput {
  bank_name: string;
  bank_coa_id: string;
  account_number?: string | null;
  match_keyword?: string | null;
  template_id?: string | null;
  notes?: string | null;
  is_active?: boolean;
}

export interface BcPreviewColumn {
  header: string;
  role: ColumnRole;
  /** Peran hasil deteksi otomatis dari teks header (null = tidak dikenali). */
  detected_role: ColumnRole | null;
}

export interface BcPreviewRow {
  date: string | null;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  page: number | null;
  confidence: Confidence;
  notes: string[];
}

/** Aturan ekstraksi (= mapping_rules template) yang bisa dikoreksi user di modal review. */
export interface BcMappingRules {
  columns: { header: string; role: ColumnRole }[];
  number_format: 'en' | 'id';
  date_order: 'dmy' | 'mdy';
  default_direction: 'credit' | 'debit' | null;
  method?: ExtractionMethod;
}

export interface BcPreview {
  file_name: string;
  file_type: string;
  method: ExtractionMethod;
  bank_name: string | null;
  /** Nomor rekening yang terbaca di header dokumen. */
  account_number: string | null;
  /** Akun tujuan: pilihan user, atau hasil mapping bank kalau Auto-detect. */
  bank_coa_id: string;
  bank_account_code: string;
  bank_account_name: string;
  /** Mapping bank yang cocok dengan file (conflict = menunjuk akun lain dari yang dipilih user). */
  bank_mapping: (BcBankMapping & { match_by: BankMappingMatch; conflict?: boolean }) | null;
  period_start: string | null;
  period_end: string | null;
  columns: BcPreviewColumn[];
  amount_mode: 'split' | 'single';
  default_direction: 'credit' | 'debit' | null;
  number_format: 'en' | 'id';
  date_order: 'dmy' | 'mdy';
  validation: BcValidation;
  warnings: string[];
  template: { id: string; name: string | null; detected_by: 'auto' | 'manual' } | null;
  rows: BcPreviewRow[];
  row_count: number;
  recognized: boolean;
  template_matched: boolean;
  will_learn_template: boolean;
  already_uploaded_on: string | null;
  importable: number;
  already_in_feed: number;
  without_date: number;
}

export interface BcTemplate {
  id: string;
  template_name: string | null;
  file_type: string;
  header_columns: string[];
  mapping_rules: BcMappingRules & { amount_mode?: 'split' | 'single'; bank_name?: string | null };
  method: ExtractionMethod | null;
  bank_name: string | null;
  detected_by: 'auto' | 'manual';
  verified_pct: number | null;
  is_active: boolean;
  usage_count: number;
  last_used_at: string | null;
  created_at: string;
  edited_at: string | null;
}

export interface BcReviewInput {
  mutation_date?: string;
  description?: string;
  debit?: number;
  credit?: number;
  balance_after?: number | null;
}

export interface BcBulkResult {
  done: string[];
  failed: { id: string; tx_number?: string; reason: string }[];
}

// ============================================================
// HTTP
// ============================================================

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: { code?: string; detail?: unknown } | null;
}

export class BankCashError extends Error {
  constructor(message: string, public code?: string, public detail?: unknown) {
    super(message);
  }
}

async function baca<T>(res: Response): Promise<{ data: T; message: string }> {
  const json = (await res.json().catch(() => null)) as (ApiEnvelope<T> & { detail?: unknown }) | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = json?.detail;
    throw new BankCashError(
      json?.message || (typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`,
      json?.errors?.code,
      json?.errors?.detail,
    );
  }
  return { data: json.data as T, message: json.message };
}

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const e = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return e.length ? '?' + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
}

const ambil = async <T,>(path: string, params: Record<string, string | number | boolean | null | undefined>, signal?: AbortSignal) =>
  (await baca<T>(await fetch(`${BC_URL}${path}${qs(params)}`, { cache: 'no-store', signal }))).data;

function beritahu() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BANK_CASH_EVENT));
}

async function kirim<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<{ data: T; message: string }> {
  const res = await fetch(`${BC_URL}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const hasil = await baca<T>(res);
  beritahu();
  return hasil;
}

// ============================================================
// API
// ============================================================

export const fetchBcAccounts = (clientId: string) => ambil<BcAccount[]>('/accounts', { client_id: clientId });
export const fetchBcOpenInvoices = (clientId: string, type: 'sales' | 'purchase', onlyOpen = false) =>
  ambil<BcInvoice[]>('/open-invoices', { client_id: clientId, type, only_open: onlyOpen });
export const fetchBcStatements = (clientId: string) => ambil<BcStatement[]>('/statements', { client_id: clientId });
export const fetchBcMutations = (clientId: string, f: { status?: MutationStatus; bank_coa_id?: string; statement_id?: string } = {}) =>
  ambil<BcMutation[]>('/mutations', { client_id: clientId, ...f });
export const fetchBcSuggestions = (clientId: string) => ambil<BcSuggestion[]>('/mutations/suggestions', { client_id: clientId });
export const fetchBcTransactions = (
  clientId: string,
  f: { status?: TxStatus | TxStatus[]; direction?: Direction; date_from?: string; date_to?: string } = {},
) => ambil<BcTransaction[]>('/transactions', { ...f, client_id: clientId, status: Array.isArray(f.status) ? f.status.join(',') : f.status });
export const fetchBcTransaction = (clientId: string, id: string) => ambil<BcTransaction>(`/transactions/${id}`, { client_id: clientId });
export const fetchBcOverview = (clientId: string, year?: number) => ambil<BcOverview>('/overview', { client_id: clientId, year });

/** bankCoaId kosong = Auto-detect: backend memilih akun dari mapping bank (error BANK_ACCOUNT_REQUIRED kalau tidak ada). */
function formStatement(clientId: string, bankCoaId: string, file: File, mappingRules?: BcMappingRules | null) {
  const form = new FormData();
  form.append('client_id', clientId);
  if (bankCoaId) form.append('bank_coa_id', bankCoaId);
  form.append('file', file);
  if (mappingRules) form.append('mapping_rules', JSON.stringify(mappingRules));
  return form;
}

/** Baca rekening koran TANPA menyimpan: kolom terdeteksi, template, validasi & confidence per baris. */
export async function previewBankStatement(clientId: string, bankCoaId: string, file: File, mappingRules?: BcMappingRules | null) {
  return baca<BcPreview>(await fetch(`${BC_URL}/statements/preview`, { method: 'POST', body: formStatement(clientId, bankCoaId, file, mappingRules) }));
}

/**
 * Import rekening koran. mappingRules = koreksi user dari modal review (kosong = deteksi otomatis /
 * template yang cocok). saveTemplate: simpan pola ini sebagai template ekstraksi (default true).
 */
export async function uploadBankStatement(
  clientId: string, bankCoaId: string, file: File,
  opsi: { mappingRules?: BcMappingRules | null; saveTemplate?: boolean; saveMapping?: boolean } = {},
) {
  const form = formStatement(clientId, bankCoaId, file, opsi.mappingRules);
  form.append('save_template', String(opsi.saveTemplate ?? true));
  form.append('save_mapping', String(opsi.saveMapping ?? true));
  const hasil = await baca<BcUploadResult>(await fetch(`${BC_URL}/statements/upload`, { method: 'POST', body: form }));
  beritahu();
  return hasil;
}

export const fetchBcTemplates = (clientId: string) => ambil<BcTemplate[]>('/import-templates', { client_id: clientId });
export const updateBcTemplate = (clientId: string, id: string, input: { template_name?: string; is_active?: boolean }) =>
  kirim<BcTemplate>('PUT', `/import-templates/${id}`, { client_id: clientId, ...input });
export const deleteBcTemplate = (clientId: string, id: string) =>
  kirim<{ id: string }>('DELETE', `/import-templates/${id}${qs({ client_id: clientId })}`);
export const fetchBcBankMappings = (clientId: string) => ambil<BcBankMapping[]>('/bank-mappings', { client_id: clientId });
export const createBcBankMapping = (clientId: string, input: BcBankMappingInput) =>
  kirim<BcBankMapping>('POST', '/bank-mappings', { client_id: clientId, ...input });
export const updateBcBankMapping = (clientId: string, id: string, input: BcBankMappingInput) =>
  kirim<BcBankMapping>('PUT', `/bank-mappings/${id}`, { client_id: clientId, ...input });
export const deleteBcBankMapping = (clientId: string, id: string) =>
  kirim<{ id: string }>('DELETE', `/bank-mappings/${id}${qs({ client_id: clientId })}`);
export const reviewMutation = (clientId: string, id: string, input: BcReviewInput = {}) =>
  kirim<BcMutation>('POST', `/mutations/${id}/review`, { client_id: clientId, ...input });

export const deleteBankStatement = (clientId: string, id: string) =>
  kirim<{ id: string }>('DELETE', `/statements/${id}${qs({ client_id: clientId })}`);
export const deleteMutation = (clientId: string, id: string) =>
  kirim<{ id: string }>('DELETE', `/mutations/${id}${qs({ client_id: clientId })}`);
export const ignoreMutation = (clientId: string, id: string, reason?: string | null) =>
  kirim<{ id: string }>('POST', `/mutations/${id}/ignore`, { client_id: clientId, reason: reason || null });
export const restoreMutation = (clientId: string, id: string) =>
  kirim<{ id: string }>('POST', `/mutations/${id}/restore`, { client_id: clientId });
export const matchMutationToInvoices = (clientId: string, mutationId: string, allocations: BcLineInput[], description?: string | null) =>
  kirim<BcTransaction>('POST', `/mutations/${mutationId}/match`, { client_id: clientId, allocations, description: description || null });
export const matchMutationToAccounts = (
  clientId: string, mutationId: string,
  input: { category: string; counterparty?: string | null; description?: string | null; lines: BcLineInput[] },
) => kirim<BcTransaction>('POST', `/mutations/${mutationId}/match-account`, { client_id: clientId, ...input });
export const autoMatchMutations = (clientId: string) =>
  kirim<{ matched: { mutation_id: string; tx_number: string; invoices: string[] }[]; skipped: number }>('POST', '/mutations/auto-match', { client_id: clientId });
export const unmatchMutation = (clientId: string, mutationId: string) =>
  kirim<{ id: string }>('POST', `/mutations/${mutationId}/unmatch`, { client_id: clientId });

export const createBcTransaction = (input: BcTxInput) => kirim<BcTransaction>('POST', '/transactions', input);
export const updateBcTransaction = (id: string, input: BcTxInput) => kirim<BcTransaction>('PUT', `/transactions/${id}`, input);
export const deleteBcTransaction = (clientId: string, id: string) =>
  kirim<{ id: string }>('DELETE', `/transactions/${id}${qs({ client_id: clientId })}`);
export const approveBcTransactions = (clientId: string, ids: string[]) =>
  kirim<BcBulkResult>('POST', '/transactions/approve', { client_id: clientId, ids });
export const returnBcTransactionsToDraft = (clientId: string, ids: string[]) =>
  kirim<BcBulkResult>('POST', '/transactions/return-to-draft', { client_id: clientId, ids });
export const postBcTransactions = (clientId: string, ids: string[]) =>
  kirim<BcBulkResult>('POST', '/transactions/post', { client_id: clientId, ids });
export const reverseBcTransaction = (clientId: string, id: string, reason: string, reversalDate?: string | null) =>
  kirim<BcTransaction>('POST', `/transactions/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

// ============================================================
// HOOK
// ============================================================

/**
 * Pola bersama: muat `fn` untuk klien aktif, muat ulang saat argumen berubah
 * atau saat BANK_CASH_EVENT dipancarkan (aksi tulis di tab mana pun).
 */
function useBcData<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) {
  const [data, setData] = useState<T>(awal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const awalRef = useRef(awal);

  const refresh = useCallback(() => setVersi(v => v + 1), []);

  useEffect(() => {
    window.addEventListener(BANK_CASH_EVENT, refresh);
    return () => window.removeEventListener(BANK_CASH_EVENT, refresh);
  }, [refresh]);

  useEffect(() => {
    if (!key) {
      setData(awalRef.current);
      setError(null);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fnRef.current(ctrl.signal)
      .then(d => { setData(d); setError(null); })
      .catch(e => { if ((e as Error).name !== 'AbortError') setError((e as Error).message || 'Failed to load data.'); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [key, versi]);

  return { data, loading, error, refresh };
}

const KOSONG: never[] = [];

export function useBcAccounts(clientId: string | null) {
  const r = useBcData<BcAccount[]>(clientId ? `acc:${clientId}` : null, () => fetchBcAccounts(clientId!), KOSONG);
  return { accounts: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcStatements(clientId: string | null) {
  const r = useBcData<BcStatement[]>(clientId ? `st:${clientId}` : null, () => fetchBcStatements(clientId!), KOSONG);
  return { statements: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcMutations(clientId: string | null, f: { status?: MutationStatus; bank_coa_id?: string } = {}) {
  const r = useBcData<BcMutation[]>(
    clientId ? `mu:${clientId}:${f.status ?? ''}:${f.bank_coa_id ?? ''}` : null,
    () => fetchBcMutations(clientId!, f), KOSONG,
  );
  return { mutations: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcTemplates(clientId: string | null) {
  const r = useBcData<BcTemplate[]>(clientId ? `tpl:${clientId}` : null, () => fetchBcTemplates(clientId!), KOSONG);
  return { templates: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcBankMappings(clientId: string | null) {
  const r = useBcData<BcBankMapping[]>(clientId ? `map:${clientId}` : null, () => fetchBcBankMappings(clientId!), KOSONG);
  return { mappings: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcSuggestions(clientId: string | null) {
  const r = useBcData<BcSuggestion[]>(clientId ? `sg:${clientId}` : null, () => fetchBcSuggestions(clientId!), KOSONG);
  return { suggestions: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcTransactions(clientId: string | null, f: { status?: TxStatus | TxStatus[]; direction?: Direction } = {}) {
  const st = Array.isArray(f.status) ? f.status.join(',') : f.status ?? '';
  const r = useBcData<BcTransaction[]>(
    clientId ? `tx:${clientId}:${st}:${f.direction ?? ''}` : null,
    () => fetchBcTransactions(clientId!, f), KOSONG,
  );
  return { transactions: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcOpenInvoices(clientId: string | null, type: 'sales' | 'purchase', onlyOpen = false) {
  const r = useBcData<BcInvoice[]>(
    clientId ? `inv:${clientId}:${type}:${onlyOpen}` : null,
    () => fetchBcOpenInvoices(clientId!, type, onlyOpen), KOSONG,
  );
  return { invoices: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

export function useBcOverview(clientId: string | null, year?: number) {
  const r = useBcData<BcOverview | null>(clientId ? `ov:${clientId}:${year ?? ''}` : null, () => fetchBcOverview(clientId!, year), null);
  return { overview: r.data, loading: r.loading, error: r.error, refresh: r.refresh };
}

// ============================================================
// UTIL
// ============================================================

export const CASH_TYPE_LABEL: Record<CashType, string> = {
  bank: 'Bank',
  cash_on_hand: 'Cash on hand',
  petty_cash: 'Petty cash',
  transit: 'In transit',
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'Verified',
  medium: 'Unverified',
  low: 'Needs review',
};

export const METHOD_LABEL: Record<ExtractionMethod, string> = {
  grid: 'PDF table lines',
  words: 'PDF text layout',
  ocr: 'OCR (scanned PDF)',
  table: 'Spreadsheet',
  legacy: 'Generic parser',
};

export const MATCH_BY_LABEL: Record<BankMappingMatch, string> = {
  account_number: 'account number',
  keyword: 'document title',
  template: 'extraction template',
  bank_name: 'bank name',
};

export const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  verified: 'Verified',
  partial: 'Partially verified',
  unverified: 'Not verified',
  failed: 'Failed',
};

export const ROLE_LABEL: Record<ColumnRole, string> = {
  date: 'Date',
  description: 'Description',
  debit: 'Debit (money out)',
  credit: 'Credit (money in)',
  amount: 'Amount (one column)',
  dc_flag: 'Debit/Credit marker',
  balance: 'Balance',
  balance_before: 'Balance before transaction',
  reference: 'Reference (added to description)',
  ignore: 'Ignore',
};

export const TX_STATUS_LABEL: Record<TxStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  posted: 'Posted',
  reversed: 'Reversed',
};

/** Nominal mutasi (selalu positif) + arahnya dari sudut pandang buku. */
export const arahMutasi = (m: Pick<BcMutation, 'debit' | 'credit'>): { direction: Direction; amount: number } =>
  m.credit > 0 ? { direction: 'receipt', amount: m.credit } : { direction: 'payment', amount: m.debit };

export const labelAkun = (a: { code: string; name: string } | null | undefined) => (a ? `${a.code} · ${a.name}` : '—');
