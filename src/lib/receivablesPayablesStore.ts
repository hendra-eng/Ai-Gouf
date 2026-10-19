'use client';

// Accounts Receivable & Accounts Payable -- terhubung ke backend
// modules/finance/receivables_payables_v1.py:
//   AR: /api/v1/finance/receivables/...  (piutang atas invoice Sales posted)
//   AP: /api/v1/finance/payables/...     (hutang atas Purchase posted)
// Kedua sisi punya endpoint & bentuk data yang sama, jadi semua fungsi di
// sini menerima `side`. Record Receipt / Record Payment disimpan backend
// sebagai transaksi Cash & Bank (source 'ar' / 'ap'), karena itu setiap aksi
// tulis memancarkan BANK_CASH_EVENT juga, dan hook di sini ikut memuat ulang
// saat Cash & Bank berubah (pelunasan dari Bank Feed mengubah saldo AR/AP).

import { useCallback, useEffect, useRef, useState } from 'react';
import { BANK_CASH_EVENT } from '@/lib/bankCashStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const BASE: Record<ArApSide, string> = {
  ar: `${API_BASE_URL}/api/v1/finance/receivables`,
  ap: `${API_BASE_URL}/api/v1/finance/payables`,
};

// ============================================================
// TIPE
// ============================================================

export type ArApSide = 'ar' | 'ap';
export type AgingBucket = 'current' | '1_30' | '31_60' | '61_90' | '91_plus';
export type DocStatus = 'open' | 'partial' | 'overdue' | 'paid';
export type SettlementStatus = 'draft' | 'approved' | 'posted' | 'reversed';
export type PaymentMethod = 'bank_transfer' | 'cash' | 'cheque' | 'giro' | 'virtual_account' | 'credit_card' | 'other';

export const BUCKETS: AgingBucket[] = ['current', '1_30', '31_60', '61_90', '91_plus'];

export interface ArApDoc {
  id: string;
  /** AR: nomor invoice Sales. AP: nomor invoice vendor (fallback nomor purchase). */
  no: string;
  /** AP: nomor purchase internal. */
  ref_no: string | null;
  party: string;
  party_tax_id: string | null;
  date: string;
  due_date: string;
  /** true = jatuh tempo dihitung dari termin (due date kosong di dokumen). */
  due_date_estimated: boolean;
  total: number;
  paid: number;
  outstanding: number;
  /** Alokasi draft/approved yang belum diposting. */
  in_process: number;
  /** outstanding - in_process: yang masih bisa dialokasikan. */
  available: number;
  days_overdue: number;
  bucket: AgingBucket | null;
  status: DocStatus;
  account_code: string;
  account_name: string;
  description: string | null;
  last_payment_date: string | null;
}

export interface ArApKpi {
  total_outstanding: number;
  total_outstanding_prev: number;
  overdue: number;
  overdue_prev: number;
  collected_month: number;
  collected_prev_month: number;
  avg_days_to_settle: number | null;
  avg_days_to_settle_prev: number | null;
  parties_with_balance: number;
  parties_with_balance_prev: number;
  open_count: number;
  overdue_count: number;
}

export interface ArApOverview {
  as_of: string;
  previous_as_of: string;
  kpi: ArApKpi;
  aging: { bucket: AgingBucket; amount: number; count: number }[];
  top_overdue: { party: string; amount: number; count: number; max_days: number; bucket: AgingBucket }[];
  trend: { month: string; invoiced: number; collected: number; balance: number }[];
  pending: Partial<Record<'draft' | 'approved', { count: number; amount: number }>>;
}

export interface AgingRow {
  party: string;
  party_tax_id: string | null;
  buckets: Record<AgingBucket, number>;
  total: number;
  invoice_count: number;
  open_count: number;
  invoices: ArApDoc[];
}

export interface AgingReport {
  as_of: string;
  rows: AgingRow[];
  totals: { buckets: Record<AgingBucket, number>; total: number };
}

export interface ArApParty {
  name: string;
  tax_id: string | null;
  invoice_count: number;
  open_count: number;
  outstanding: number;
  overdue: number;
}

export interface StatementLine {
  date: string;
  type: 'invoice' | 'bill' | 'settlement' | 'reversal' | 'settled_outside';
  number: string;
  description: string;
  due_date: string | null;
  charge: number;
  settlement: number;
  balance: number;
}

export interface PartyStatement {
  party: string;
  party_tax_id: string | null;
  date_from: string;
  date_to: string;
  opening_balance: number;
  closing_balance: number;
  total_charges: number;
  total_settlements: number;
  lines: StatementLine[];
  aging: Record<AgingBucket, number>;
  open_invoices: ArApDoc[];
}

export interface SettlementLine {
  id: string;
  line_no: number;
  line_type: 'sales_invoice' | 'purchase' | 'account';
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
  amount: number;
}

export interface Settlement {
  id: string;
  tx_number: string;
  direction: 'receipt' | 'payment';
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
  reference_date: string | null;
  payment_method: PaymentMethod | null;
  currency: string;
  source: 'bank_feed' | 'manual' | 'ar' | 'ap';
  status: SettlementStatus;
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
  lines: SettlementLine[];
  journal: { line_no: number; account_code: string; account_name: string; description: string | null; debit: number; credit: number }[];
  allocated: number;
  unapplied: number;
  /** Bisa diubah/dihapus dari menu ini (dibuat di sini & belum diposting). */
  editable: boolean;
}

export interface SettlementInput {
  client_id: string;
  number?: string | null;
  tx_date: string;
  party: string;
  bank_coa_id: string;
  payment_method: PaymentMethod;
  currency: string;
  reference?: string | null;
  reference_date?: string | null;
  notes?: string | null;
  allocations: { invoice_id: string; amount: number }[];
  unapplied_amount?: number;
  unapplied_coa_id?: string | null;
  submit: boolean;
}

export interface SettlementResult {
  settlement: Settlement;
  result: 'draft' | 'approved' | 'posted';
}

// ============================================================
// FETCH
// ============================================================

export class ArApError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
  }
}

type Params = Record<string, string | number | boolean | null | undefined>;

function qs(params: Params): string {
  const e = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return e.length ? '?' + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
}

async function baca<T>(res: Response): Promise<{ data: T; message: string }> {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.status !== 'success') {
    const detail = json?.detail;
    throw new ArApError(
      json?.message || (typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`,
      json?.errors?.code,
    );
  }
  return { data: json.data as T, message: json.message };
}

const ambil = async <T,>(side: ArApSide, path: string, params: Params, signal?: AbortSignal) =>
  (await baca<T>(await fetch(`${BASE[side]}${path}${qs(params)}`, { cache: 'no-store', signal }))).data;

export const ARAP_EVENT = 'gouf-arap-changed';

function beritahu() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ARAP_EVENT));
  window.dispatchEvent(new Event(BANK_CASH_EVENT));
}

async function kirim<T>(side: ArApSide, method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, params: Params = {}) {
  const res = await fetch(`${BASE[side]}${path}${qs(params)}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const hasil = await baca<T>(res);
  beritahu();
  return hasil;
}

export const fetchArApOverview = (side: ArApSide, clientId: string, asOf?: string, months = 6, signal?: AbortSignal) =>
  ambil<ArApOverview>(side, '/overview', { client_id: clientId, as_of: asOf, months }, signal);
export const fetchArApDocs = (
  side: ArApSide, clientId: string,
  f: { as_of?: string; party?: string; only_open?: boolean; exclude_settlement?: string } = {}, signal?: AbortSignal,
) => ambil<ArApDoc[]>(side, '/invoices', { client_id: clientId, ...f }, signal);
export const fetchArApAging = (
  side: ArApSide, clientId: string, f: { as_of?: string; include_zero?: boolean; include_details?: boolean } = {}, signal?: AbortSignal,
) => ambil<AgingReport>(side, '/aging', { client_id: clientId, ...f }, signal);
export const fetchArApParties = (side: ArApSide, clientId: string, signal?: AbortSignal) =>
  ambil<ArApParty[]>(side, '/parties', { client_id: clientId }, signal);
export const fetchPartyStatement = (side: ArApSide, clientId: string, party: string, dateFrom: string, dateTo: string, signal?: AbortSignal) =>
  ambil<PartyStatement>(side, '/statement', { client_id: clientId, party, date_from: dateFrom, date_to: dateTo }, signal);
export const fetchSettlements = (side: ArApSide, clientId: string, status?: string, signal?: AbortSignal) =>
  ambil<Settlement[]>(side, '/settlements', { client_id: clientId, status }, signal);
export const fetchSettlement = (side: ArApSide, clientId: string, id: string) =>
  ambil<Settlement>(side, `/settlements/${id}`, { client_id: clientId });
export const fetchNextSettlementNumber = async (side: ArApSide, clientId: string, date?: string) =>
  (await ambil<{ number: string }>(side, '/settlements/next-number', { client_id: clientId, date })).number;

export const createSettlement = (side: ArApSide, input: SettlementInput) =>
  kirim<SettlementResult>(side, 'POST', '/settlements', input);
export const updateSettlement = (side: ArApSide, id: string, input: SettlementInput) =>
  kirim<SettlementResult>(side, 'PUT', `/settlements/${id}`, input);
export const submitSettlement = (side: ArApSide, clientId: string, id: string) =>
  kirim<SettlementResult>(side, 'POST', `/settlements/${id}/submit`, { client_id: clientId });
export const deleteSettlement = (side: ArApSide, clientId: string, id: string) =>
  kirim<{ id: string }>(side, 'DELETE', `/settlements/${id}`, undefined, { client_id: clientId });
export const reverseSettlement = (side: ArApSide, clientId: string, id: string, reason: string, reversalDate?: string | null) =>
  kirim<Settlement>(side, 'POST', `/settlements/${id}/reverse`, { client_id: clientId, reason, reversal_date: reversalDate || null });

// ============================================================
// AR: CUSTOMER, CREATE INVOICE, COLLECTIONS, STATEMENT LOG
// (backend modules/finance/receivables_ar_v1.py)
// ============================================================

export type TaxCode = 'ppn_11' | 'ppn_12' | 'non_ppn';
export type DiscountType = 'percent' | 'amount';
export type CollectionStatus = 'to_contact' | 'promised' | 'escalated' | 'resolved';
export type CollectionPriority = 'high' | 'medium' | 'low';
export type ContactMethod = 'call' | 'email' | 'whatsapp' | 'visit' | 'meeting' | 'letter' | 'other';

export interface ArCustomer {
  /** null = nama hanya ada di invoice Sales (belum masuk master). */
  id: string | null;
  code: string | null;
  name: string;
  npwp: string | null;
  billing_address: string | null;
  phone: string | null;
  email: string | null;
  contact_person: string | null;
  payment_terms: string | null;
  in_master: boolean;
  outstanding: number;
}

export interface ArCustomerInput {
  client_id: string;
  code?: string | null;
  name: string;
  npwp?: string | null;
  billing_address?: string | null;
  phone?: string | null;
  email?: string | null;
  contact_person?: string | null;
  payment_terms?: string | null;
}

export interface InvoiceProductOption {
  name: string;
  description: string | null;
  unit: string | null;
  unit_price: number;
  tax_code: TaxCode;
  last_used: string;
  times_used: number;
}

export interface InvoiceFormOptions {
  next_number: string;
  branches: string[];
  projects: string[];
  products: InvoiceProductOption[];
  payment_terms: string[];
  tax_types: { code: TaxCode; label: string; rate: number }[];
}

export interface InvoiceLineInput {
  product_name: string;
  description?: string | null;
  quantity: number;
  unit?: string | null;
  unit_price: number;
  discount_type: DiscountType;
  discount_value: number;
  tax_code: TaxCode;
}

export interface InvoiceEntryInput {
  client_id: string;
  invoice_no?: string | null;
  invoice_date: string;
  due_date?: string | null;
  payment_terms: string;
  currency: string;
  branch: string;
  project?: string | null;
  customer_id?: string | null;
  customer_name: string;
  customer_npwp?: string | null;
  billing_address?: string | null;
  tax_type: TaxCode;
  tax_inclusive: boolean;
  notes?: string | null;
  lines: InvoiceLineInput[];
  submit: boolean;
}

export interface InvoiceEntryLine extends InvoiceLineInput {
  line_no: number;
  discount_amount: number;
  tax_rate: number;
  dpp: number;
  tax_amount: number;
  line_total: number;
}

export interface InvoiceEntry {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  payment_terms: string | null;
  branch: string | null;
  project: string | null;
  customer_id: string | null;
  customer_code: string | null;
  customer_name: string;
  customer_npwp: string | null;
  billing_address: string | null;
  currency: string;
  tax_type: TaxCode;
  tax_inclusive: boolean;
  notes: string | null;
  /** posting_status Sales: Draft / Review / Approved / Posted. */
  status: string;
  editable: boolean;
  created_here: boolean;
  subtotal: number;
  discount_total: number;
  dpp: number;
  tax_total: number;
  total: number;
  created_at: string;
  created_by_name: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  lines: InvoiceEntryLine[];
}

export interface PendingInvoice {
  id: string;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string;
  total: number;
  status: string;
  created_here: boolean;
  editable: boolean;
  created_by_name: string | null;
}

export interface CollectionAccount {
  party: string;
  customer_code: string | null;
  email: string | null;
  phone: string | null;
  outstanding: number;
  overdue: number;
  open_count: number;
  max_days_overdue: number;
  bucket: AgingBucket | null;
  last_payment_date: string | null;
  priority: CollectionPriority;
  priority_auto: CollectionPriority;
  priority_overridden: boolean;
  status: CollectionStatus;
  stored_status: CollectionStatus | null;
  collector_name: string | null;
  next_follow_up_date: string | null;
  last_contact_date: string | null;
  last_contact_method: ContactMethod | null;
  promise_amount: number | null;
  promise_date: string | null;
  notes: string | null;
}

export interface CollectionsReport {
  as_of: string;
  period: { month: string; from: string; to: string };
  performance: {
    collected: number;
    collected_prev: number;
    promise_to_pay: number;
    promise_count: number;
    high_priority_count: number;
    high_priority_amount: number;
    high_priority_pct: number;
    avg_days_to_collect: number | null;
    avg_days_to_collect_prev: number | null;
    total_outstanding: number;
  };
  follow_up: { counts: Record<CollectionStatus, number>; total: number };
  queue: CollectionAccount[];
  collectors: string[];
}

export interface CollectionActivity {
  id: string;
  activity_date: string;
  method: ContactMethod;
  status_after: CollectionStatus;
  notes: string | null;
  promise_amount: number | null;
  promise_date: string | null;
  next_follow_up_date: string | null;
  created_at: string;
  created_by_name: string | null;
}

export interface CollectionActivityInput {
  client_id: string;
  party: string;
  activity_date: string;
  method: ContactMethod;
  status_after: CollectionStatus;
  notes?: string | null;
  promise_amount?: number | null;
  promise_date?: string | null;
  next_follow_up_date?: string | null;
  collector_name?: string | null;
}

export interface CollectionAccountInput {
  client_id: string;
  party: string;
  status?: CollectionStatus;
  priority?: CollectionPriority | 'auto';
  collector_name?: string | null;
  next_follow_up_date?: string | null;
  clear_next_follow_up?: boolean;
  notes?: string | null;
}

export interface StatementLog {
  id: string;
  side: ArApSide;
  party: string;
  party_code: string | null;
  party_email: string | null;
  date_from: string;
  date_to: string;
  currency: string;
  open_items_only: boolean;
  opening_balance: number;
  closing_balance: number;
  delivery_method: 'email' | 'download' | null;
  delivery_status: 'generated' | 'sent' | 'downloaded' | 'failed';
  recipient_email: string | null;
  delivered_at: string | null;
  generated_at: string;
  generated_by_name: string | null;
}

export const fetchArCustomers = (clientId: string, signal?: AbortSignal) =>
  ambil<ArCustomer[]>('ar', '/customers', { client_id: clientId }, signal);
export const createArCustomer = (input: ArCustomerInput) => kirim<ArCustomer>('ar', 'POST', '/customers', input);
export const updateArCustomer = (id: string, input: ArCustomerInput) => kirim<ArCustomer>('ar', 'PUT', `/customers/${id}`, input);

export const fetchInvoiceFormOptions = (clientId: string, invoiceDate?: string, signal?: AbortSignal) =>
  ambil<InvoiceFormOptions>('ar', '/invoice-form', { client_id: clientId, invoice_date: invoiceDate }, signal);
export const fetchPendingInvoices = (clientId: string, signal?: AbortSignal) =>
  ambil<PendingInvoice[]>('ar', '/invoice-entries', { client_id: clientId }, signal);
export const fetchInvoiceEntry = (clientId: string, id: string, signal?: AbortSignal) =>
  ambil<InvoiceEntry>('ar', `/invoice-entries/${id}`, { client_id: clientId }, signal);
export const createInvoiceEntry = (input: InvoiceEntryInput) => kirim<InvoiceEntry>('ar', 'POST', '/invoice-entries', input);
export const updateInvoiceEntry = (id: string, input: InvoiceEntryInput) => kirim<InvoiceEntry>('ar', 'PUT', `/invoice-entries/${id}`, input);
export const deleteInvoiceEntry = (clientId: string, id: string) =>
  kirim<{ id: string }>('ar', 'DELETE', `/invoice-entries/${id}`, undefined, { client_id: clientId });

export const fetchCollections = (clientId: string, f: { as_of?: string; month?: string } = {}, signal?: AbortSignal) =>
  ambil<CollectionsReport>('ar', '/collections', { client_id: clientId, ...f }, signal);
export const updateCollectionAccount = (input: CollectionAccountInput) =>
  kirim<CollectionAccount>('ar', 'PUT', '/collections/account', input);
export const fetchCollectionActivities = (clientId: string, party: string, signal?: AbortSignal) =>
  ambil<CollectionActivity[]>('ar', '/collections/activities', { client_id: clientId, party }, signal);
export const createCollectionActivity = (input: CollectionActivityInput) =>
  kirim<CollectionAccount>('ar', 'POST', '/collections/activities', input);

export const fetchStatementLogs = (side: ArApSide, clientId: string, signal?: AbortSignal) =>
  ambil<StatementLog[]>(side, '/statements', { client_id: clientId }, signal);
export const createStatementLog = (side: ArApSide, input: {
  client_id: string; party: string; date_from: string; date_to: string; currency: string; open_items_only: boolean;
}) => kirim<StatementLog>(side, 'POST', '/statements', input);
export const markStatementDownloaded = (side: ArApSide, clientId: string, id: string) =>
  kirim<StatementLog>(side, 'POST', `/statements/${id}/delivery`, { client_id: clientId, method: 'download' });
export const emailStatement = (side: ArApSide, id: string, input: {
  client_id: string; to: string; cc?: string | null; subject: string; message: string; pdf_base64: string; file_name: string;
  save_as_customer_email?: boolean;
}) => kirim<StatementLog>(side, 'POST', `/statements/${id}/email`, input);
export const deleteStatementLog = (side: ArApSide, clientId: string, id: string) =>
  kirim<{ id: string }>(side, 'DELETE', `/statements/${id}`, undefined, { client_id: clientId });

export const TAX_LABEL: Record<TaxCode, string> = { ppn_11: 'PPN 11%', ppn_12: 'PPN 12%', non_ppn: 'Non-PPN' };
export const TAX_RATE: Record<TaxCode, number> = { ppn_11: 0.11, ppn_12: 0.12, non_ppn: 0 };

/** Sama dengan backend receivables_ar_v1.hitung_baris (dibulatkan ke sen). */
export function computeInvoiceLine(
  l: Pick<InvoiceLineInput, 'quantity' | 'unit_price' | 'discount_type' | 'discount_value' | 'tax_code'>, taxInclusive: boolean,
) {
  const sen = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
  const gross = sen((l.quantity || 0) * (l.unit_price || 0));
  const discount = l.discount_type === 'percent'
    ? sen((gross * Math.min(l.discount_value || 0, 100)) / 100)
    : sen(Math.min(l.discount_value || 0, gross));
  const amount = sen(gross - discount);
  const rate = TAX_RATE[l.tax_code];
  const dpp = taxInclusive && rate ? sen(amount / (1 + rate)) : amount;
  const tax = taxInclusive && rate ? sen(amount - dpp) : sen(amount * rate);
  return { gross, discount, amount, dpp, tax };
}

export const COLLECTION_STATUS_LABEL: Record<CollectionStatus, string> = {
  to_contact: 'To Contact', promised: 'Promised', escalated: 'Escalated', resolved: 'Resolved',
};
export const COLLECTION_STATUS_DOT: Record<CollectionStatus, string> = {
  to_contact: 'bg-sky-500', promised: 'bg-emerald-500', escalated: 'bg-orange-500', resolved: 'bg-violet-500',
};
export const COLLECTION_STATUS_TEXT: Record<CollectionStatus, string> = {
  to_contact: 'text-sky-700', promised: 'text-emerald-700', escalated: 'text-orange-600', resolved: 'text-violet-700',
};
export const PRIORITY_LABEL: Record<CollectionPriority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_STYLE: Record<CollectionPriority, string> = {
  high: 'bg-rose-50 text-rose-700', medium: 'bg-amber-50 text-amber-700', low: 'bg-emerald-50 text-emerald-700',
};
export const PRIORITY_DOT: Record<CollectionPriority, string> = { high: 'bg-rose-500', medium: 'bg-amber-500', low: 'bg-emerald-500' };
export const CONTACT_METHOD_LABEL: Record<ContactMethod, string> = {
  call: 'Phone Call', email: 'Email', whatsapp: 'WhatsApp', visit: 'Site Visit', meeting: 'Meeting', letter: 'Letter', other: 'Other',
};

// ============================================================
// HOOK
// ============================================================

/** Muat `fn` saat `key` berubah, dan muat ulang saat AR/AP atau Cash & Bank berubah. */
export function useArApData<T>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) {
  const [data, setData] = useState<T>(awal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const awalRef = useRef(awal);
  const refresh = useCallback(() => setVersi(v => v + 1), []);

  useEffect(() => {
    window.addEventListener(ARAP_EVENT, refresh);
    window.addEventListener(BANK_CASH_EVENT, refresh);
    return () => {
      window.removeEventListener(ARAP_EVENT, refresh);
      window.removeEventListener(BANK_CASH_EVENT, refresh);
    };
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

// ============================================================
// LABEL & FORMAT
// ============================================================

export interface SideConfig {
  side: ArApSide;
  title: string;
  short: string;
  subtitle: string;
  basePath: string;
  party: string;
  parties: string;
  doc: string;
  docs: string;
  settle: string;            // Receipt / Payment
  settled: string;           // Collected / Paid
  settlementsTab: string;    // Collections / Payments
  settleNumberHint: string;
  createDocLabel: string;
  createDocHref: string;
  sourceModule: string;      // Sales / Purchase
  kpi: { total: string; overdue: string; month: string; avgDays: string; parties: string };
  trend: { invoiced: string; settled: string; balance: string };
  unappliedHint: string;
}

export const SIDE_CONFIG: Record<ArApSide, SideConfig> = {
  ar: {
    side: 'ar',
    title: 'Accounts Receivable',
    short: 'AR',
    subtitle: 'Manage customer receivables, collections, receivable aging and settlement status.',
    basePath: '/accounts-receivable',
    party: 'Customer',
    parties: 'Customers',
    doc: 'Invoice',
    docs: 'Invoices',
    settle: 'Receipt',
    settled: 'Collected',
    settlementsTab: 'Collections',
    settleNumberHint: 'RCV/YYYY/####',
    createDocLabel: 'Create Invoice',
    createDocHref: '/accounts-receivable/invoices/new',
    sourceModule: 'Sales',
    kpi: {
      total: 'Total Receivables', overdue: 'Overdue Invoices', month: 'Collected This Month',
      avgDays: 'Avg. Days to Collect', parties: 'Customers with Balance',
    },
    trend: { invoiced: 'Total Invoiced', settled: 'Collected', balance: 'Receivable Balance' },
    unappliedHint: 'Overpayment / customer deposit — credited to the account you choose (e.g. Customer Deposits).',
  },
  ap: {
    side: 'ap',
    title: 'Accounts Payable',
    short: 'AP',
    subtitle: 'Manage vendor bills, payments, payable aging and settlement status.',
    basePath: '/accounts-payable',
    party: 'Vendor',
    parties: 'Vendors',
    doc: 'Bill',
    docs: 'Bills',
    settle: 'Payment',
    settled: 'Paid',
    settlementsTab: 'Payments',
    settleNumberHint: 'PAY/YYYY/####',
    createDocLabel: 'Create Bill',
    createDocHref: '/transactions/purchase/bills/new',
    sourceModule: 'Purchase',
    kpi: {
      total: 'Total Payables', overdue: 'Overdue Bills', month: 'Paid This Month',
      avgDays: 'Avg. Days to Pay', parties: 'Vendors with Balance',
    },
    trend: { invoiced: 'Total Billed', settled: 'Paid', balance: 'Payable Balance' },
    unappliedHint: 'Advance payment to the vendor — debited to the account you choose (e.g. Vendor Advances).',
  },
};

export const BUCKET_LABEL: Record<AgingBucket, string> = {
  current: 'Current',
  '1_30': '1 - 30 days',
  '31_60': '31 - 60 days',
  '61_90': '61 - 90 days',
  '91_plus': '91+ days',
};

export const BUCKET_STYLE: Record<AgingBucket, string> = {
  current: 'bg-emerald-50 text-emerald-700',
  '1_30': 'bg-teal-50 text-teal-700',
  '31_60': 'bg-amber-50 text-amber-700',
  '61_90': 'bg-orange-50 text-orange-700',
  '91_plus': 'bg-rose-50 text-rose-700',
};

export const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: '#22C55E',
  '1_30': '#14B8A6',
  '31_60': '#FACC15',
  '61_90': '#FB923C',
  '91_plus': '#EF4444',
};

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  open: 'Open', partial: 'Partially Paid', overdue: 'Overdue', paid: 'Paid',
};

export const DOC_STATUS_DOT: Record<DocStatus, string> = {
  open: 'bg-sky-500', partial: 'bg-violet-500', overdue: 'bg-rose-500', paid: 'bg-emerald-500',
};

export const DOC_STATUS_TEXT: Record<DocStatus, string> = {
  open: 'text-sky-700', partial: 'text-violet-700', overdue: 'text-rose-600', paid: 'text-emerald-700',
};

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatus, string> = {
  draft: 'Draft', approved: 'Awaiting Post', posted: 'Posted', reversed: 'Reversed',
};

export const SETTLEMENT_STATUS_STYLE: Record<SettlementStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  approved: 'bg-sky-50 text-sky-700',
  posted: 'bg-emerald-50 text-emerald-700',
  reversed: 'bg-rose-50 text-rose-700',
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  bank_transfer: 'Bank Transfer',
  cash: 'Cash',
  cheque: 'Cheque',
  giro: 'Giro',
  virtual_account: 'Virtual Account',
  credit_card: 'Credit Card',
  other: 'Other',
};

export const SOURCE_LABEL: Record<Settlement['source'], string> = {
  ar: 'Accounts Receivable', ap: 'Accounts Payable', bank_feed: 'Cash & Bank · Source Data', manual: 'Cash & Bank · Manual',
};

/** Level role (tahap_N -> N); harus sama dengan backend. Backend tetap penentu akhirnya. */
export const roleLevel = (role?: string | null) => {
  if (role === 'super_admin') return 999;
  const m = /^tahap_(\d+)$/.exec(role ?? '');
  return m ? Number(m[1]) : 0;
};
export const LEVEL_INPUT = 3;
export const LEVEL_POST = 4;

const fmtAngka = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** "Rp 1.284.550.000" (negatif: "-Rp 5.000"). */
export const rupiah = (n: number | null | undefined) => {
  const v = n || 0;
  return `${v < 0 ? '-' : ''}Rp ${fmtAngka.format(Math.abs(v))}`;
};

/** "Rp 1,28 M" / "Rp 450 jt" -> versi English: "Rp 1.28B" / "Rp 450M". */
export const rupiahShort = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e12) return `${s}Rp ${(a / 1e12).toFixed(1).replace(/\.0$/, '')}T`;
  if (a >= 1e9) return `${s}Rp ${(a / 1e9).toFixed(1).replace(/\.0$/, '')}B`;
  if (a >= 1e6) return `${s}Rp ${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}Rp ${(a / 1e3).toFixed(0)}K`;
  return `${s}Rp ${a}`;
};

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BULAN_PANJANG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-06-30" -> "30 Jun 2026". */
export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${String(d).padStart(2, '0')} ${BULAN[m - 1]} ${y}`;
};

/** "2026-06-30" -> "30 June 2026". */
export const fmtDateLong = (iso?: string | null) => {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${BULAN_PANJANG[m - 1]} ${y}`;
};

/** "2026-06" -> "Jun 2026". */
export const fmtMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return `${BULAN[m - 1]} ${y}`;
};

export const fmtDateTime = (iso?: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')} ${BULAN[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Perubahan relatif dalam persen (null kalau pembanding 0). */
export const pctChange = (now: number, prev: number) => (prev ? ((now - prev) / Math.abs(prev)) * 100 : null);

// ---- Angka -> kata (English) untuk ringkasan & bukti penerimaan ----

const SATUAN = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const PULUHAN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SKALA = ['', 'thousand', 'million', 'billion', 'trillion'];

function ratusan(n: number): string {
  const r = Math.floor(n / 100);
  const s = n % 100;
  const bagian: string[] = [];
  if (r) bagian.push(`${SATUAN[r]} hundred`);
  if (s >= 20) bagian.push(PULUHAN[Math.floor(s / 10)] + (s % 10 ? `-${SATUAN[s % 10]}` : ''));
  else if (s) bagian.push(SATUAN[s]);
  return bagian.join(' ');
}

/** 275000000 -> "Two hundred seventy-five million rupiah". */
export function amountInWords(n: number): string {
  let v = Math.round(Math.abs(n));
  if (v === 0) return 'Zero rupiah';
  const bagian: string[] = [];
  let i = 0;
  while (v > 0 && i < SKALA.length) {
    const blok = v % 1000;
    if (blok) bagian.unshift(`${ratusan(blok)}${SKALA[i] ? ` ${SKALA[i]}` : ''}`);
    v = Math.floor(v / 1000);
    i += 1;
  }
  const teks = bagian.join(' ');
  return `${teks.charAt(0).toUpperCase()}${teks.slice(1)} rupiah`;
}
