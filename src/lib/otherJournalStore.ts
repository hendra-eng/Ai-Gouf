'use client';

// Transactions > Other -- terhubung ke backend modules/transactions/other_v1.py
// (/api/v1/transactions/other/...). Jurnal posted dibaca GL/FS sebagai sumber "other".

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const OTHER_EVENT = 'gouf-other-journal-changed';
const api = createV1Api('/api/v1/transactions/other', OTHER_EVENT);

export const useOtherData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) => useV1Data(OTHER_EVENT, key, fn, awal);

export type OtherStatus = 'draft' | 'approved' | 'rejected' | 'posted' | 'reversed';
export type OtherCategory = 'general' | 'capex' | 'accrual' | 'prepaid' | 'reclass' | 'correction' | 'payroll' | 'uncategorized' | 'other';

export interface OtherIssue { code: string; level: 'error' | 'warning'; message: string }
export interface OtherLine { id: string; line_no: number; coa_id: string | null; account_code: string; account_name: string; description: string | null; debit: number; credit: number }
export interface OtherJournal {
  id: string; journal_no: string; journal_date: string; category: OtherCategory; category_label: string; reference: string | null;
  description: string | null; review_note: string | null; total_debit: number; total_credit: number; amount: number; source: string;
  status: OtherStatus; approved_by_name: string | null; approved_at: string | null; rejected_reason: string | null;
  posted_by_name: string | null; posted_at: string | null; reversal_date: string | null; reversal_reason: string | null; reversed_by_name: string | null;
  created_by_name: string | null; created_at: string; edited_at: string | null; lines: OtherLine[]; issues: OtherIssue[]; has_error: boolean;
}
export interface OtherAccount { id: string; code: string; name: string; classification: string | null; sub: string | null; standard_code: string | null; is_active: boolean }
export interface OtherOverview {
  kpi: { total: number; count: number; average: number; unposted: number; needs_review: number; draft_count: number; draft_total: number };
  trend: { month: string; total: number; count: number }[]; by_category: { category: string; amount: number }[];
  top_parties: { party: string; amount: number; count: number }[]; journals: OtherJournal[];
}
export interface SourceLine {
  journal_id: string; journal_no: string; date: string; category: string; reference: string | null; account_code: string; account_name: string;
  description: string | null; debit: number; credit: number; status: OtherStatus; standard_code: string | null; problems: string[];
}
export interface SourceData { rows: SourceLine[]; quality: { total: number; clean: number; with_number: number; mapped: number }; composition: { category: string; count: number }[] }
export interface PostedData { monthly: { month: string; total: number }[]; total: number; count: number; average: number | null; reversed_count: number; journals: OtherJournal[] }

export interface JournalInput {
  journal_no?: string | null; journal_date: string; category: OtherCategory; reference?: string | null; description?: string | null; review_note?: string | null;
  lines: { coa_id: string | null; description?: string | null; debit: number; credit: number }[];
}

const c = (clientId: string) => ({ client_id: clientId });
export const fetchOtherAccounts = (clientId: string, s?: AbortSignal) => api.get<OtherAccount[]>('/accounts', c(clientId), s);
export const fetchOtherJournals = (clientId: string, s?: AbortSignal) =>
  api.get<{ journals: OtherJournal[]; categories: { key: OtherCategory; label: string }[]; next_number: string }>('/journals', c(clientId), s);
export const fetchOtherOverview = (clientId: string, s?: AbortSignal) => api.get<OtherOverview>('/overview', c(clientId), s);
export const fetchOtherSource = (clientId: string, s?: AbortSignal) => api.get<SourceData>('/source-lines', c(clientId), s);
export const fetchOtherPosted = (clientId: string, s?: AbortSignal) => api.get<PostedData>('/posted', c(clientId), s);
export const saveOtherJournal = (clientId: string, body: JournalInput, id?: string) =>
  api.send<OtherJournal>(id ? 'PUT' : 'POST', id ? `/journals/${id}` : '/journals', { client_id: clientId, ...body });
export const deleteOtherJournal = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/journals/${id}`, undefined, c(clientId));
export const otherAction = (clientId: string, action: 'approve' | 'return-to-draft' | 'reject' | 'post', ids: string[], reason?: string) =>
  api.send<{ done: string[]; failed: { id: string; journal_no?: string; reason: string }[] }>('POST', `/journals/${action}`, { client_id: clientId, ids, reason });
export const reverseOtherJournal = (clientId: string, id: string, reason: string, reversalDate?: string) =>
  api.send<OtherJournal>('POST', `/journals/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

export const OTHER_STATUS: Record<OtherStatus, { label: string; style: string }> = {
  draft: { label: 'Draft', style: 'bg-amber-50 text-amber-700' }, approved: { label: 'Approved', style: 'bg-sky-50 text-sky-700' },
  rejected: { label: 'Rejected', style: 'bg-rose-50 text-rose-700' }, posted: { label: 'Posted', style: 'bg-emerald-50 text-emerald-700' },
  reversed: { label: 'Reversed', style: 'bg-slate-100 text-slate-600' },
};
export const OTHER_CATEGORY: Record<OtherCategory, string> = {
  general: 'General Journal', capex: 'CapEx', accrual: 'Accrual', prepaid: 'Prepaid / Amortization', reclass: 'Reclassification',
  correction: 'Correction', payroll: 'Payroll', uncategorized: 'Uncategorized', other: 'Other',
};
