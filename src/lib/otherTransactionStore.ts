'use client';

// Other Transactions (Transactions > Other) -- terhubung ke backend
// modules/assets_and_equity/other_transactions_v1.py (/api/v1/asset/other-transactions/...).
// Template per jenis peristiwa bisnis + aturan jurnal; transaksi posted dibaca GL/FS sebagai sumber "other".

import { ApiError, createV1Api, qs, useV1Data } from '@/lib/v1Api';

export const OTHER_TX_EVENT = 'gouf-other-transaction-changed';
const BASE = '/api/v1/asset/other-transactions';
const api = createV1Api(BASE, OTHER_TX_EVENT);
const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export const useOtherTxData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) => useV1Data(OTHER_TX_EVENT, key, fn, awal);

export type TypeKey = 'employee_advance' | 'security_deposit' | 'loan_financing' | 'capital_injection' | 'intercompany' | 'refund_reimbursement' | 'other_event';
export type Role = 'main' | 'bank' | 'offset' | 'extra';
export type TxStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'posted' | 'reversed';

export interface AccountRef { id: string; code: string; name: string }
export interface TxAccount extends AccountRef { classification: string | null; sub: string | null; cash_type: string | null; standard_code: string | null; is_active: boolean }
export interface SubtypeDef { key: string; label: string; roles: Role[]; extra_label: string | null; lines: { side: 'D' | 'C'; role: Role; portion: 'total' | 'main' | 'extra' }[] }
export interface TypeDef { key: TypeKey; code: string; name: string; description: string; party_label: string; roles: Partial<Record<Role, string>>; subtypes: SubtypeDef[] }
export interface TemplateRule {
  id: string | null; subtype: string; label: string; is_active: boolean; roles: Role[]; required: Role[];
  accounts: Partial<Record<Role, AccountRef | null>>; complete: boolean;
}
export interface TxTemplate {
  id: string; type_key: TypeKey; type_name: string; code: string; name: string; description: string | null;
  requires_approval: boolean; auto_post: boolean; is_active: boolean; is_system: boolean; sort_order: number; rules: TemplateRule[]; usage: number;
}
export interface Meta {
  types: TypeDef[]; templates: TxTemplate[]; accounts: TxAccount[];
  suggestions: Record<'counterparty' | 'branch' | 'department' | 'project' | 'cost_center', string[]>;
  entities: { id: string; name: string }[]; client_name: string | null; next_number: string; can_post: boolean;
}
export interface Issue { code: string; level: 'error' | 'warning'; message: string }
export interface TxLine { role: Role | null; coa_id: string | null; account_code: string; account_name: string; description: string | null; debit: number; credit: number }
export interface OtherTx {
  id: string; journal_no: string; journal_date: string; type_key: TypeKey; type_name: string; subtype: string; subtype_label: string;
  template_id: string | null; template_name: string; counterparty: string | null; counterparty_code: string | null; reference_no: string | null;
  description: string | null; currency: string; exchange_rate: number; amount: number; extra_amount: number; amount_idr: number;
  accounts: Record<Role, AccountRef | null>; main_coa_id: string | null; bank_coa_id: string | null; offset_coa_id: string | null; extra_coa_id: string | null;
  branch: string | null; department: string | null; project: string | null; cost_center: string | null;
  due_date: string | null; period_start: string | null; period_end: string | null; details: Record<string, string | number>;
  notes: string | null; requires_approval: boolean; source: 'manual' | 'import' | 'legacy'; status: TxStatus; status_label: string;
  total_debit: number; total_credit: number; submitted_at: string | null; submitted_by_name: string | null;
  approved_at: string | null; approved_by_name: string | null; rejected_at: string | null; rejected_by_name: string | null; rejected_reason: string | null;
  posted_at: string | null; posted_by_name: string | null; reversal_date: string | null; reversal_reason: string | null; reversed_by_name: string | null;
  created_at: string; created_by_name: string | null; edited_at: string | null;
  lines: TxLine[]; issues: Issue[]; has_error: boolean; attachment_count: number;
  attachments?: { id: string; file_name: string; content_type: string | null; size_bytes: number; uploaded_at: string; uploaded_by_name: string | null }[];
  events?: { action: string; note: string | null; actor_name: string | null; created_at: string }[];
}
export interface Overview {
  kpi: { total: number; posted: number; pending_review: number; approved: number; draft: number; exceptions: number; posted_amount: number };
  recent: OtherTx[]; trend: { month: string; count: number; amount: number }[];
  rules: { active_rules: number; templates: number; auto_post: number; requires_approval: number; incomplete: number };
  top_categories: { type_key: TypeKey; type_name: string; count: number; amount: number; share: number }[];
  pending: OtherTx[]; templates: TxTemplate[];
}
export interface CategoryStat {
  type_key: TypeKey; name: string; description: string; code: string; count: number; posted: number; in_progress: number; posted_amount: number;
  last_date: string | null; subtypes: { subtype: string; label: string; count: number; amount: number }[]; templates: TxTemplate[];
}
export interface Preview { lines: TxLine[]; total_debit: number; total_credit: number; balanced: boolean; issues: Issue[]; has_error: boolean }

export interface TxInput {
  template_id: string | null; type_key: TypeKey; subtype: string; journal_no?: string | null; journal_date: string;
  counterparty?: string | null; counterparty_code?: string | null; reference_no?: string | null; description?: string | null;
  currency: string; exchange_rate: number; amount: number; extra_amount: number;
  main_coa_id: string | null; bank_coa_id: string | null; offset_coa_id: string | null; extra_coa_id: string | null;
  branch?: string | null; department?: string | null; project?: string | null; cost_center?: string | null;
  due_date?: string | null; period_start?: string | null; period_end?: string | null; details: Record<string, string | number>;
  notes?: string | null; requires_approval: boolean;
}
export interface TemplateInput {
  type_key?: TypeKey; code?: string | null; name: string; description?: string | null; requires_approval: boolean; auto_post: boolean; is_active: boolean;
  rules: { subtype: string; is_active: boolean; main_coa_id: string | null; bank_coa_id: string | null; offset_coa_id: string | null; extra_coa_id: string | null }[];
}
export type BulkAction = 'submit' | 'approve' | 'reject' | 'return-to-draft' | 'post';
export interface BulkResult { done: string[]; failed: { id: string; journal_no?: string; reason: string }[] }
export interface ImportRow {
  row: number; type_key: string; subtype?: string | null; journal_date?: string | null; reference_no?: string | null; counterparty?: string | null;
  description?: string | null; amount: number; extra_amount: number; main_account?: string | null; bank_account?: string | null;
  offset_account?: string | null; extra_account?: string | null; branch?: string | null; department?: string | null; project?: string | null;
  cost_center?: string | null; due_date?: string | null; notes?: string | null;
}

const c = (clientId: string) => ({ client_id: clientId });
export const fetchMeta = (clientId: string, s?: AbortSignal) => api.get<Meta>('/meta', c(clientId), s);
export const fetchOverview = (clientId: string, months: number, s?: AbortSignal) => api.get<Overview>('/overview', { ...c(clientId), months }, s);
export const fetchCategories = (clientId: string, s?: AbortSignal) => api.get<CategoryStat[]>('/categories', c(clientId), s);
export const fetchTransactions = (clientId: string, s?: AbortSignal) => api.get<OtherTx[]>('/transactions', c(clientId), s);
export const fetchTransaction = (clientId: string, id: string, s?: AbortSignal) => api.get<OtherTx>(`/transactions/${id}`, c(clientId), s);
export const previewTransaction = async (clientId: string, body: TxInput) =>
  (await api.send<Preview>('POST', '/preview', { client_id: clientId, ...body }, {}, false)).data;
export const saveTransaction = (clientId: string, body: TxInput, action: 'draft' | 'submit', id?: string) =>
  api.send<OtherTx>(id ? 'PUT' : 'POST', id ? `/transactions/${id}` : '/transactions', { client_id: clientId, ...body, action });
export const deleteTransaction = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/transactions/${id}`, undefined, c(clientId));
export const bulkAction = (clientId: string, action: BulkAction, ids: string[], reason?: string) =>
  api.send<BulkResult>('POST', `/transactions/${action}`, { client_id: clientId, ids, reason });
export const reverseTransaction = (clientId: string, id: string, reason: string, reversalDate?: string) =>
  api.send<OtherTx>('POST', `/transactions/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });
export const saveTemplate = (clientId: string, body: TemplateInput, id?: string) =>
  api.send<TxTemplate>(id ? 'PUT' : 'POST', id ? `/templates/${id}` : '/templates', { client_id: clientId, ...body });
export const deleteTemplate = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/templates/${id}`, undefined, c(clientId));
export const importRows = (clientId: string, rows: ImportRow[]) =>
  api.send<{ created: string[]; failed: { row: number; reason: string }[] }>('POST', '/import', { client_id: clientId, rows });
export const deleteAttachment = (clientId: string, id: string) => api.send<OtherTx>('DELETE', `/attachments/${id}`, undefined, c(clientId));
export const attachmentUrl = (clientId: string, id: string) => `${API_BASE_URL}${BASE}/attachments/${id}${qs(c(clientId))}`;

export async function uploadAttachments(clientId: string, txId: string, files: File[]): Promise<{ data: OtherTx; message: string }> {
  const form = new FormData();
  form.append('client_id', clientId);
  files.forEach(f => form.append('files', f));
  const res = await fetch(`${API_BASE_URL}${BASE}/transactions/${txId}/attachments`, { method: 'POST', body: form });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.status !== 'success') throw new ApiError(json?.message || `Upload failed (${res.status})`, json?.errors?.code);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OTHER_TX_EVENT));
  return { data: json.data as OtherTx, message: json.message };
}

export const TX_STATUS: Record<TxStatus, { label: string; style: string }> = {
  draft: { label: 'Draft', style: 'bg-slate-100 text-slate-700' },
  pending_review: { label: 'Under Review', style: 'bg-sky-50 text-sky-700' },
  approved: { label: 'Approved', style: 'bg-amber-50 text-amber-700' },
  rejected: { label: 'Rejected', style: 'bg-rose-50 text-rose-700' },
  posted: { label: 'Posted', style: 'bg-emerald-50 text-emerald-700' },
  reversed: { label: 'Reversed', style: 'bg-slate-100 text-slate-500' },
};

export const CURRENCIES = [
  { code: 'IDR', label: 'IDR - Indonesian Rupiah' }, { code: 'USD', label: 'USD - US Dollar' },
  { code: 'SGD', label: 'SGD - Singapore Dollar' }, { code: 'EUR', label: 'EUR - Euro' },
];
