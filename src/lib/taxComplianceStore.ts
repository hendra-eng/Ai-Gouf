'use client';

// Tax Compliance -- terhubung ke backend modules/planning/tax_compliance_v1.py
// (/api/v1/planning/tax/...). Buku pajak disinkronkan dari transaksi posted
// (POST /sync); status bayar & lapor dihitung backend dari setoran & SPT.

import { createV1Api, useV1Data } from '@/lib/v1Api';
import { BANK_CASH_EVENT } from '@/lib/bankCashStore';

export const TAX_EVENT = 'gouf-tax-changed';
const api = createV1Api('/api/v1/planning/tax', TAX_EVENT);

export const useTaxData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) => useV1Data(TAX_EVENT, key, fn, awal);

/** Setoran yang membuat transaksi Cash & Bank juga memberi tahu halaman Cash & Bank. */
const kirimBank = async <T,>(p: Promise<T>) => {
  const r = await p;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(BANK_CASH_EVENT));
  return r;
};

// ============================================================
// TIPE
// ============================================================

export type TaxType = 'vat_output' | 'vat_input' | 'pph21' | 'pph22' | 'pph23' | 'pph26' | 'pph4_2' | 'pph15' | 'pph25' | 'pph29' | 'pph_credit' | 'pbb' | 'other';
export type PayType = 'vat' | 'pph21' | 'pph22' | 'pph23' | 'pph26' | 'pph4_2' | 'pph15' | 'pph25' | 'pph29' | 'pbb' | 'other';
export type ReturnType = 'ppn' | 'pph21' | 'unifikasi' | 'annual_corporate' | 'other';
export type PaymentStatus = 'paid' | 'partial' | 'unpaid' | 'credited';
export type ReportingStatus = 'reported' | 'unreported' | 'not_required' | 'n/a';
export type ExcStatus = 'open' | 'in_review' | 'on_hold' | 'resolved' | 'dismissed';
export type Severity = 'high' | 'medium' | 'low';
export type TaxReportType = 'withholding_summary' | 'vat_summary' | 'payment_register' | 'reconciliation' | 'exposure' | 'filing_status';

export interface Range { date_from: string; date_to: string }

export interface TaxAccount { id: string; code: string; name: string; classification: string | null; sub: string | null; standard_code: string | null; is_active: boolean; tax_type: TaxType | null }
export interface TaxAccountsData {
  saved: boolean; accounts: TaxAccount[];
  tax_types: { key: TaxType; label: string; nature: 'payable' | 'creditable' }[];
  payment_types: { key: PayType; label: string }[];
  return_types: { key: ReturnType; label: string }[];
}

export interface LedgerRow {
  id: string; date: string; tax_period: string; tax_type: TaxType; tax_type_label: string; nature: 'payable' | 'creditable';
  tax_code: string | null; tax_object: string | null; source_module: 'sales' | 'purchase' | 'journal_entry' | 'cash_bank' | 'manual';
  source_document: string | null; journal_no: string | null; party_name: string | null; party_type: string | null; party_npwp: string | null;
  dpp: number | null; dpp_estimated: boolean; rate: number | null; tax_amount: number; gl_account_code: string | null; gl_account_name: string | null;
  tax_document_no: string | null; tax_document_date: string | null; is_manual: boolean; notes: string | null;
  payment_status: PaymentStatus; paid_amount: number; outstanding: number; payment_due: string | null;
  reporting_status: ReportingStatus; filing_due: string | null; match_status: 'matched' | 'unmatched';
}

export interface SummaryKpi { total_dpp: number; pph_payable: number; vat_output: number; vat_input: number; tax_paid: number; unpaid: number; unreported: number; records: number; tax_amount: number }

export interface TaxException {
  id: string; exception_no: string; rule_code: string; ledger_id: string | null; tax_type: TaxType | null; tax_type_label: string; tax_period: string | null;
  source_document: string | null; party_name: string | null; reason: string; dpp: number | null; potential_tax: number; severity: Severity;
  assigned_to: string | null; status: ExcStatus; is_auto: boolean; detected_at: string; resolved_at: string | null; resolved_by_name: string | null;
  resolution_note: string | null; age_days: number;
}

export interface TaxOverview {
  period: { from: string; to: string; previous_from: string; previous_to: string };
  kpi: SummaryKpi & { unreported_returns: number; exceptions: number };
  previous: SummaryKpi & { unreported_returns: number; exceptions: number };
  by_type: { tax_type: TaxType; label: string; dpp: number; rate: string; tax_amount: number; paid: number; reported: string; status: 'on_track' | 'partial' | 'pending'; count: number }[];
  status_items: { paid_reported: number; paid_not_reported: number; unpaid: number; overdue: number };
  trend: { month: string; pph: number; vat: number; total: number }[];
  exposure: TaxException[];
}

export interface LedgerData {
  period: { from: string; to: string }; kpi: SummaryKpi; previous: SummaryKpi; rows: LedgerRow[];
  lifecycle: { posted: number; paid: number; unpaid: number; reported: number; unreported: number; manual: number };
  by_type: { tax_type: TaxType; label: string; count: number; paid: number; partial: number; unpaid: number }[];
  journal_links: { date: string; journal_no: string; source_module: string; description: string; tax_amount: number }[];
}

export interface PphData {
  period: { from: string; to: string };
  kpi: { total_dpp: number; pph_payable: number; paid: number; unpaid: number; reported: number; needs_review: number };
  previous: PphData['kpi']; rows: LedgerRow[]; breakdown: { tax_type: TaxType; label: string; amount: number }[]; gaps: TaxException[];
}

export interface VatData {
  period: { from: string; to: string };
  kpi: { output: number; input: number; net: number; matched: number; total: number; unmatched: number; draft_returns: number };
  previous: VatData['kpi']; output: LedgerRow[]; input: LedgerRow[]; trend: { month: string; output: number; input: number; net: number }[];
  vs_gl: { ledger_output: number; ledger_input: number; ledger_net: number; gl_output: number; gl_input: number; gl_net: number; difference: number };
}

export interface TaxPayment {
  id: string; payment_no: string; payment_date: string; tax_type: PayType; tax_type_label: string; tax_period: string; related_liability: string | null;
  dpp: number | null; amount: number; billing_code: string | null; ntpn: string | null; bank_account: string | null; bank_coa_id: string | null;
  payable_coa_id: string | null; bank_cash_transaction_id: string | null; status: 'pending' | 'paid' | 'cancelled'; notes: string | null;
  created_by_name: string | null; created_at: string; overdue: boolean; due_date: string | null;
}

export interface Filing {
  id: string | null; return_type: ReturnType; return_label: string; tax_period: string; due_date: string | null; filed_date: string | null;
  status: 'draft' | 'filed' | 'not_required' | 'not_filed'; receipt_no: string | null; amount: number; is_amendment: boolean; notes: string | null; late: boolean;
}

export interface PaymentsData {
  period: { from: string; to: string };
  kpi: { total_due: number; total_paid: number; overdue: number; upcoming: number; success_rate: number | null; unallocated: number };
  previous: PaymentsData['kpi']; payments: TaxPayment[]; monthly: Record<string, number | string>[];
  deadlines: { due_date: string | null; tax_period: string; tax_type: PayType; tax_type_label: string; amount: number; status: 'overdue' | 'due_soon' | 'not_due' }[];
  filings: Filing[];
}

export interface ReconRow {
  tax_type: TaxType; label: string; ledger_amount: number; gl_amount: number; difference: number; payment_amount: number;
  filing_status: 'filed' | 'partial' | 'not_filed' | 'not_required'; items: number; status: 'reconciled' | 'difference';
}
export interface ReconData {
  period: { from: string; to: string }; rows: ReconRow[];
  kpi: { reconciled_amount: number; unreconciled_amount: number; matched_items: number; difference_count: number }; previous: ReconData['kpi'];
  fixes: { tax_type: TaxType; title: string; amount: number; detail: string; action: 'review' | 'create_je'; severity: Severity }[];
  mapping_saved: boolean;
  last_run: { run_at: string; run_by_name: string | null; difference_count: number; period_from: string; period_to: string } | null;
}

export interface ExceptionsData {
  period: { from: string; to: string };
  kpi: { total: number; high: number; medium: number; overdue_review: number; resolved_month: number; exposure: number }; previous: ExceptionsData['kpi'];
  rows: TaxException[]; exposure_by_type: { tax_type: TaxType; label: string; amount: number }[];
  aging: { '0_7': number; '8_30': number; '31_60': number; '60_plus': number }; insights: { level: 'info' | 'high' | 'medium' | 'tip'; text: string }[];
}

export interface TaxReport {
  report_type: TaxReportType; period: { from: string; to: string }; client: { name: string; npwp: string | null; address: string };
  rows: Record<string, unknown>[];
  summary?: { total_dpp: number; total_tax: number; transactions: number; types: number; prev_total_dpp: number; prev_total_tax: number; prev_transactions: number; type_labels: string };
}

// ============================================================
// API
// ============================================================

const c = (clientId: string) => ({ client_id: clientId });

export const syncTax = (clientId: string) => api.send<{ created: number; updated: number; removed: number; exceptions: { new: number; auto_resolved: number } }>('POST', '/sync', c(clientId));
export const fetchTaxAccounts = (clientId: string, s?: AbortSignal) => api.get<TaxAccountsData>('/accounts', c(clientId), s);
export const saveTaxMappings = (clientId: string, mappings: { coa_id: string; tax_type: TaxType }[]) =>
  api.send<{ saved: number }>('PUT', '/account-mappings', { client_id: clientId, mappings });

export const fetchTaxOverview = (clientId: string, r: Range, s?: AbortSignal) => api.get<TaxOverview>('/overview', { ...c(clientId), ...r }, s);
export const fetchLedger = (clientId: string, r: Range, s?: AbortSignal) => api.get<LedgerData>('/ledger', { ...c(clientId), ...r }, s);
export const addLedgerAdjustment = (clientId: string, body: Record<string, unknown>) => api.send<LedgerRow>('POST', '/ledger', { client_id: clientId, ...body });
export const updateLedger = (clientId: string, id: string, body: Record<string, unknown>) => api.send<LedgerRow>('PUT', `/ledger/${id}`, { client_id: clientId, ...body });
export const deleteLedger = (clientId: string, id: string) => api.send<{ id: string }>('DELETE', `/ledger/${id}`, undefined, c(clientId));
export const fetchPph = (clientId: string, r: Range, s?: AbortSignal) => api.get<PphData>('/pph', { ...c(clientId), ...r }, s);
export const fetchVat = (clientId: string, r: Range, s?: AbortSignal) => api.get<VatData>('/vat', { ...c(clientId), ...r }, s);
export const fetchTaxPayments = (clientId: string, r: Range, s?: AbortSignal) => api.get<PaymentsData>('/payments', { ...c(clientId), ...r }, s);
export const recordTaxPayment = (clientId: string, body: Record<string, unknown>) => kirimBank(api.send<TaxPayment>('POST', '/payments', { client_id: clientId, ...body }));
export const updateTaxPayment = (clientId: string, id: string, body: Record<string, unknown>) => api.send<TaxPayment>('PUT', `/payments/${id}`, { client_id: clientId, ...body });
export const cancelTaxPayment = (clientId: string, id: string, reason: string) => kirimBank(api.send<TaxPayment>('POST', `/payments/${id}/cancel`, { client_id: clientId, reason }));
export const saveFiling = (clientId: string, body: Record<string, unknown>) => api.send<{ id: string }>('PUT', '/filings', { client_id: clientId, ...body });
export const fetchRecon = (clientId: string, r: Range, s?: AbortSignal) => api.get<ReconData>('/reconciliation', { ...c(clientId), ...r }, s);
export const runRecon = (clientId: string, r: Range) => api.send<{ id: string; difference_count: number }>('POST', '/reconciliation/run', { client_id: clientId, ...r });
export const fetchExceptions = (clientId: string, r: Range, s?: AbortSignal) => api.get<ExceptionsData>('/exceptions', { ...c(clientId), ...r }, s);
export const addException = (clientId: string, body: Record<string, unknown>) => api.send<TaxException>('POST', '/exceptions', { client_id: clientId, ...body });
export const updateException = (clientId: string, id: string, body: Record<string, unknown>) => api.send<TaxException>('PUT', `/exceptions/${id}`, { client_id: clientId, ...body });
export const fetchTaxReport = (clientId: string, type: TaxReportType, r: Range, s?: AbortSignal) => api.get<TaxReport>(`/reports/${type}`, { ...c(clientId), ...r }, s);

// ============================================================
// LABEL
// ============================================================

export const TAX_LABEL: Record<TaxType, string> = {
  vat_output: 'VAT Output', vat_input: 'VAT Input', pph21: 'PPh 21', pph22: 'PPh 22', pph23: 'PPh 23', pph26: 'PPh 26', pph4_2: 'PPh 4(2)',
  pph15: 'PPh 15', pph25: 'PPh 25', pph29: 'PPh 29', pph_credit: 'PPh Credit', pbb: 'PBB', other: 'Other Tax',
};
export const PAY_LABEL: Record<PayType, string> = {
  vat: 'VAT (PPN)', pph21: 'PPh 21', pph22: 'PPh 22', pph23: 'PPh 23', pph26: 'PPh 26', pph4_2: 'PPh 4(2)', pph15: 'PPh 15', pph25: 'PPh 25', pph29: 'PPh 29', pbb: 'PBB', other: 'Other',
};
export const RETURN_LABEL: Record<ReturnType, string> = {
  ppn: 'SPT Masa PPN', pph21: 'SPT Masa PPh 21/26', unifikasi: 'SPT Masa PPh Unifikasi', annual_corporate: 'SPT Tahunan PPh Badan', other: 'Other Return',
};
export const SOURCE_LABEL: Record<LedgerRow['source_module'], string> = {
  sales: 'Sales', purchase: 'Purchase', journal_entry: 'Journal Entry', cash_bank: 'Cash & Bank', manual: 'Adjustment',
};
export const PAYMENT_STYLE: Record<PaymentStatus, { label: string; style: string }> = {
  paid: { label: 'Paid', style: 'bg-emerald-50 text-emerald-700' }, partial: { label: 'Partial', style: 'bg-amber-50 text-amber-700' },
  unpaid: { label: 'Unpaid', style: 'bg-rose-50 text-rose-700' }, credited: { label: 'Credited', style: 'bg-sky-50 text-sky-700' },
};
export const REPORTING_STYLE: Record<ReportingStatus, { label: string; style: string }> = {
  reported: { label: 'Reported', style: 'bg-emerald-50 text-emerald-700' }, unreported: { label: 'Unreported', style: 'bg-rose-50 text-rose-700' },
  not_required: { label: 'Not Required', style: 'bg-slate-100 text-slate-600' }, 'n/a': { label: 'n/a', style: 'bg-slate-100 text-slate-500' },
};
export const EXC_STATUS: Record<ExcStatus, { label: string; style: string }> = {
  open: { label: 'Open', style: 'bg-rose-50 text-rose-700' }, in_review: { label: 'In Review', style: 'bg-amber-50 text-amber-700' },
  on_hold: { label: 'On Hold', style: 'bg-slate-100 text-slate-700' }, resolved: { label: 'Resolved', style: 'bg-emerald-50 text-emerald-700' },
  dismissed: { label: 'Dismissed', style: 'bg-slate-100 text-slate-500' },
};
export const SEVERITY_STYLE: Record<Severity, { label: string; dot: string; style: string }> = {
  high: { label: 'High', dot: 'bg-rose-500', style: 'bg-rose-50 text-rose-700' },
  medium: { label: 'Medium', dot: 'bg-amber-500', style: 'bg-amber-50 text-amber-700' },
  low: { label: 'Low', dot: 'bg-slate-400', style: 'bg-slate-100 text-slate-600' },
};
export const FILING_STYLE: Record<Filing['status'], { label: string; style: string }> = {
  filed: { label: 'Filed', style: 'bg-emerald-50 text-emerald-700' }, draft: { label: 'Draft', style: 'bg-amber-50 text-amber-700' },
  not_filed: { label: 'Not Filed', style: 'bg-rose-50 text-rose-700' }, not_required: { label: 'Not Required', style: 'bg-slate-100 text-slate-600' },
};
export const TAX_COLORS: Record<string, string> = {
  vat: '#0B5E5C', vat_output: '#0B5E5C', vat_input: '#86EFAC', pph21: '#22C55E', pph22: '#14B8A6', pph23: '#38BDF8', pph26: '#F59E0B', pph4_2: '#A855F7',
  pph15: '#64748B', pph25: '#0EA5E9', pph29: '#6366F1', pph_credit: '#94A3B8', pbb: '#CBD5E1', other: '#CBD5E1',
};
export const TAX_REPORTS: { type: TaxReportType; title: string; description: string }[] = [
  { type: 'withholding_summary', title: 'Withholding Tax Summary', description: 'Summary of PPh 21, 23, 4(2) and other withholding taxes.' },
  { type: 'vat_summary', title: 'VAT Summary', description: 'Summary of VAT output, input and payable per month.' },
  { type: 'payment_register', title: 'Tax Payment Register', description: 'List of tax payments and deposit slips (SSP / e-Billing).' },
  { type: 'reconciliation', title: 'Tax Reconciliation Report', description: 'Reconciliation between tax ledger, GL, payments and returns.' },
  { type: 'exposure', title: 'Tax Exposure Report', description: 'Analysis of tax exposure and potential risks.' },
  { type: 'filing_status', title: 'Filing Status Report', description: 'Status of tax return filings and compliance timeline.' },
];
