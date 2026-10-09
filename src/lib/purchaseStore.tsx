'use client';

// Data layer untuk fitur "Transactions > Purchase" (src/app/transactions/
// purchase/*), terhubung ke backend/modules/transactions/purchase_v1.py:
// /api/v1/transactions/purchase/... -- lihat file itu untuk daftar endpoint.
//
// Mengikuti pola YANG SAMA dengan src/lib/journalEntryStore.tsx & src/lib/
// salesStore.tsx (amplop response standar, authenticatedFetch, hook
// useXxxList yang dengar custom event) -- baca komentar di file-file itu
// untuk alasan detailnya.
//
// [PENTING] client_id di tabel financial_transaction_purchase_* = id_user
// akun yang meng-import (management_users). Filter list di SELURUH hook di
// bawah BUKAN client_id itu, tapi COMPANY aktif (`useActiveClient().
// activeClientId` = management_clients.id) yang dikirim sebagai
// management_client_id -- pola sama dengan useSalesInvoices di salesStore.tsx.
//
// Mapper di bagian bawah file ini mengubah bentuk snake_case backend
// menjadi bentuk UI (`PurchaseTransaction`/`PurchaseLine`/
// `PurchaseSourceRecord`/`PurchaseException`) yang TYPE-nya dipakai ULANG
// dari src/data/purchaseData.ts (bukan didefinisikan ulang) -- supaya
// halaman-halaman di src/app/transactions/purchase/* yang sudah dibangun
// di atas bentuk itu tidak perlu diubah strukturnya, cuma sumber datanya
// yang diganti dari array mock statis menjadi hasil mapping API ini.
// `vendors` (daftar master vendor) TETAP diimpor dari purchaseData.ts apa
// adanya -- belum ada tabel vendor master di backend (lihat catatan di
// root/ddl-table bagian "FITUR TRANSACTIONS > PURCHASE").

import { useEffect, useState, useCallback } from 'react';
import { swrClear, swrGet, swrSet } from './swrCache';
import type {
  PurchaseStatus,
  PaymentStatus,
  PurchaseCategory,
  SourceDocType,
  ExceptionType,
  ExceptionSeverity,
  ExceptionStatus,
  PurchaseLine,
  PurchaseTransaction,
  PurchaseSourceRecord,
  PurchaseException,
} from '@/data/purchaseData';

const PURCHASE_CHANGED_EVENT = 'gouf-purchase-changed';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const PURCHASE_BASE_URL = `${API_BASE_URL}/api/v1/transactions/purchase`;

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

function notifyPurchaseChanged() {
  swrClear('purchase:'); // data lama tidak boleh tampil setelah ada perubahan
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(PURCHASE_CHANGED_EVENT));
}

/** Amplop response standar /api/v1/... -- lihat backend/modules/api_response.py. */
interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    throw new Error(json?.message || `Request failed (${res.status})`);
  }
  return json.data as T;
}

function qs(params: Record<string, string | undefined | null>): string {
  const entries = Object.entries(params).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`).join('&');
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return baca<T>(res);
}

async function put<T>(url: string, body: unknown): Promise<T> {
  const res = await authenticatedFetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return baca<T>(res);
}

async function del(url: string): Promise<void> {
  const res = await authenticatedFetch(url, { method: 'DELETE' });
  await baca<null>(res);
}

// ============================================================
// 1) Source Records (tab Source Data)
// ============================================================

export interface BackendPurchaseSourceRecord {
  id: string;
  client_id: string | null;
  source_code: string;
  source_type: string;
  vendor_name: string;
  vendor_code: string | null;
  source_date: string | null;
  invoice_number: string | null;
  po_number: string | null;
  description: string | null;
  amount: number;
  tax_amount: number;
  total_amount: number;
  currency: string;
  status: string;
  validation_status: string;
  related_transaction_id: string | null;
  period_label: string;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listPurchaseSourceRecords(
  companyId?: string | null,
  sourceType?: string,
  status?: string,
): Promise<BackendPurchaseSourceRecord[]> {
  const res = await authenticatedFetch(
    `${PURCHASE_BASE_URL}/source-records${qs({ management_client_id: companyId, source_type: sourceType, status })}`,
  );
  return baca<BackendPurchaseSourceRecord[]>(res);
}

export async function createPurchaseSourceRecord(payload: Partial<BackendPurchaseSourceRecord>): Promise<BackendPurchaseSourceRecord> {
  const row = await post<BackendPurchaseSourceRecord>(`${PURCHASE_BASE_URL}/source-records`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function updatePurchaseSourceRecord(id: string, payload: Partial<BackendPurchaseSourceRecord>): Promise<BackendPurchaseSourceRecord> {
  const row = await put<BackendPurchaseSourceRecord>(`${PURCHASE_BASE_URL}/source-records/${id}`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function deletePurchaseSourceRecord(id: string): Promise<void> {
  await del(`${PURCHASE_BASE_URL}/source-records/${id}`);
  notifyPurchaseChanged();
}

export function usePurchaseSourceRecords(companyId: string | null | undefined): {
  records: BackendPurchaseSourceRecord[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `purchase:usePurchaseSourceRecords:${companyId ?? ''}`;
  const [records, setRecords] = useState<BackendPurchaseSourceRecord[]>(() => swrGet<BackendPurchaseSourceRecord[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!companyId) { setRecords([]); setLoading(false); return; }
    const hit = swrGet<typeof records>(cacheKey);
    if (hit !== undefined) { setRecords(hit); setLoading(false); } else { setLoading(true); }
    listPurchaseSourceRecords(companyId)
      .then(data => { const value = data; swrSet(cacheKey, value); setRecords(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load source records'))
      .finally(() => setLoading(false));
  }, [companyId, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { records, loading, error, refresh: muatUlang };
}

// ============================================================
// 2) Transactions (entitas inti: tab Purchase Transaction / Preview /
// Exceptions (via vendor/date) / Posted)
// ============================================================

export interface BackendPurchaseTransaction {
  id: string;
  client_id: string | null;
  /** id management_clients -- klien pemilik transaksi (filter Financial Statements). */
  management_client_id?: string | null;
  purchase_no: string;
  purchase_date: string;
  invoice_date: string | null;
  invoice_number: string | null;
  po_number: string | null;
  vendor_name: string;
  vendor_code: string | null;
  source_doc_type: string;
  source_ref: string | null;
  source_record_id: string | null;
  description: string | null;
  category: string | null;
  subtotal: number;
  discount: number;
  tax_amount: number;
  total: number;
  accounts_payable: number;
  currency: string;
  payment_status: string;
  payment_terms: string | null;
  due_date: string | null;
  status: string;
  period_label: string;
  created_by_name: string | null;
  approved_by_name: string | null;
  posted_by_name: string | null;
  notes: string | null;
  journal_entry_id: number | null;
  posting_date: string | null;
  posted_at: string | null;
  /** Akun Cr Hutang Usaha / Dr PPN Masukan per transaksi -- null = akun default (2100 / 1300). */
  ap_account_code: string | null;
  ap_account_name: string | null;
  tax_account_code: string | null;
  tax_account_name: string | null;
  approved_at: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listPurchaseTransactions(companyId?: string | null, status?: string): Promise<BackendPurchaseTransaction[]> {
  const res = await authenticatedFetch(`${PURCHASE_BASE_URL}/transactions${qs({ management_client_id: companyId, status })}`);
  return baca<BackendPurchaseTransaction[]>(res);
}

export async function createPurchaseTransaction(payload: Partial<BackendPurchaseTransaction>): Promise<BackendPurchaseTransaction> {
  const row = await post<BackendPurchaseTransaction>(`${PURCHASE_BASE_URL}/transactions`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function updatePurchaseTransaction(id: string, payload: Partial<BackendPurchaseTransaction>): Promise<BackendPurchaseTransaction> {
  const row = await put<BackendPurchaseTransaction>(`${PURCHASE_BASE_URL}/transactions/${id}`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function deletePurchaseTransaction(id: string): Promise<void> {
  await del(`${PURCHASE_BASE_URL}/transactions/${id}`);
  notifyPurchaseChanged();
}

// Alur status: draft --approve--> approved --post--> posted (tab Posted + Financial Statements).
// Transaksi yang tidak memenuhi syarat dilewati backend (lihat `skipped`), sisanya tetap diproses.
export interface PurchaseStatusActionResult {
  done: BackendPurchaseTransaction[];
  skipped: { id: string; purchase_no: string | null; reason: string }[];
}

export async function approvePurchaseTransactions(ids: string[]): Promise<PurchaseStatusActionResult> {
  const hasil = await post<PurchaseStatusActionResult>(`${PURCHASE_BASE_URL}/transactions/approve`, { transaction_ids: ids });
  notifyPurchaseChanged();
  return hasil;
}

export async function postPurchaseTransactions(ids: string[], postingDate?: string): Promise<PurchaseStatusActionResult> {
  const hasil = await post<PurchaseStatusActionResult>(`${PURCHASE_BASE_URL}/transactions/post`, {
    transaction_ids: ids,
    ...(postingDate ? { posting_date: postingDate } : {}),
  });
  notifyPurchaseChanged();
  return hasil;
}

export interface PurchaseTransactionLineInput {
  line_no?: number;
  item_code?: string;
  description: string;
  quantity: number;
  unit?: string;
  unit_price: number;
  discount?: number;
  tax_rate?: number;
  tax_amount?: number;
  subtotal: number;
  total: number;
  account_code: string;
  account_name?: string;
}

export interface PurchaseTransactionWithLinesInput {
  client_id?: string | null;
  /** id management_clients -- klien pemilik transaksi (filter Financial Statements). */
  management_client_id?: string | null;
  purchase_no: string;
  purchase_date: string;
  invoice_date?: string | null;
  invoice_number?: string;
  po_number?: string;
  vendor_name: string;
  vendor_code?: string;
  source_doc_type?: string;
  source_ref?: string;
  source_record_id?: string | null;
  description?: string;
  category?: string;
  accounts_payable?: number;
  currency?: string;
  payment_status?: string;
  payment_terms?: string;
  due_date?: string | null;
  status?: string;
  period_label: string;
  created_by_name?: string;
  notes?: string;
  lines: PurchaseTransactionLineInput[];
}

/** Buat transaksi + seluruh baris item/jasanya sekaligus, atomik --
 *  header (subtotal/discount/tax_amount/total) dihitung ulang dari SUM
 *  baris di backend, pola sama seperti createJeDraftWithLines(). */
export async function createPurchaseTransactionWithLines(
  payload: PurchaseTransactionWithLinesInput,
): Promise<BackendPurchaseTransaction & { lines: BackendPurchaseTransactionLine[] }> {
  const row = await post<BackendPurchaseTransaction & { lines: BackendPurchaseTransactionLine[] }>(`${PURCHASE_BASE_URL}/transactions/full`, payload);
  notifyPurchaseChanged();
  return row;
}

export interface PurchaseImportTransactionResult {
  purchase_no: string;
  ok: boolean;
  message: string;
}

/** Ringkasan hasil POST /import/upload -- lihat backend/modules/
 *  transactions/purchase_import_v1.py::upload_purchase_import. */
export interface UploadPurchaseSourceFileResult {
  template_matched: boolean;
  transactions_detected: number;
  created: number;
  skipped_invalid?: number;
  skipped_duplicate?: number;
  transactions: PurchaseImportTransactionResult[];
}

/**
 * Upload file laporan pembelian MENTAH (CSV/Excel) -- backend mencocokkan
 * pola kolomnya ke Purchase Import Template milik klien aktif (mis.
 * "Data Pembelian Detail" SAU), lalu langsung membuat Purchase Transaction
 * draft + baris itemnya. Pola sama dengan uploadJeSourceFile() di
 * journalEntryStore.tsx.
 *
 * managementClientId WAJIB -- ID management_clients (klien aktif di
 * dropdown "Switch Company"), BUKAN client_id akun yang login.
 */
export async function uploadPurchaseSourceFile(file: File, managementClientId: string): Promise<UploadPurchaseSourceFileResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('management_client_id', managementClientId);
  const res = await authenticatedFetch(`${PURCHASE_BASE_URL}/import/upload`, {
    method: 'POST',
    body: form, // JANGAN set Content-Type manual -- browser yang mengisi boundary multipart-nya
  });
  const row = await baca<UploadPurchaseSourceFileResult>(res);
  if (row.created > 0) notifyPurchaseChanged();
  return row;
}

export function usePurchaseTransactions(companyId: string | null | undefined, status?: string): {
  transactions: BackendPurchaseTransaction[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `purchase:usePurchaseTransactions:${companyId ?? ''}:${status ?? ''}`;
  const [transactions, setTransactions] = useState<BackendPurchaseTransaction[]>(() => swrGet<BackendPurchaseTransaction[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!companyId) { setTransactions([]); setLoading(false); return; }
    const hit = swrGet<typeof transactions>(cacheKey);
    if (hit !== undefined) { setTransactions(hit); setLoading(false); } else { setLoading(true); }
    listPurchaseTransactions(companyId, status)
      .then(data => { const value = data; swrSet(cacheKey, value); setTransactions(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load purchase transactions'))
      .finally(() => setLoading(false));
  }, [companyId, status, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { transactions, loading, error, refresh: muatUlang };
}

// ============================================================
// 3) Transaction Lines (baris item/jasa, dimuat lazy per transaksi)
// ============================================================

export interface BackendPurchaseTransactionLine {
  id: string;
  transaction_id: string;
  client_id: string | null;
  line_no: number;
  item_code: string | null;
  description: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  subtotal: number;
  total: number;
  account_code: string;
  account_name: string | null;
  aktif: boolean;
}

export async function listPurchaseTransactionLines(transactionId?: string | null, clientId?: string | null): Promise<BackendPurchaseTransactionLine[]> {
  const res = await authenticatedFetch(`${PURCHASE_BASE_URL}/transaction-lines${qs({ transaction_id: transactionId, client_id: clientId })}`);
  return baca<BackendPurchaseTransactionLine[]>(res);
}

export async function createPurchaseTransactionLine(payload: Partial<BackendPurchaseTransactionLine>): Promise<BackendPurchaseTransactionLine> {
  const row = await post<BackendPurchaseTransactionLine>(`${PURCHASE_BASE_URL}/transaction-lines`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function updatePurchaseTransactionLine(id: string, payload: Partial<BackendPurchaseTransactionLine>): Promise<BackendPurchaseTransactionLine> {
  const row = await put<BackendPurchaseTransactionLine>(`${PURCHASE_BASE_URL}/transaction-lines/${id}`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function deletePurchaseTransactionLine(id: string): Promise<void> {
  await del(`${PURCHASE_BASE_URL}/transaction-lines/${id}`);
  notifyPurchaseChanged();
}

/** Baris item/jasa milik 1 transaksi -- dipakai lazy (cuma di-fetch begitu
 *  user membuka detail/preview 1 transaksi), BUKAN di-load untuk semua
 *  transaksi sekaligus, pola sama persis dengan useJeDraftLines(). */
export function usePurchaseTransactionLines(transactionId: string | null | undefined): {
  lines: BackendPurchaseTransactionLine[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `purchase:usePurchaseTransactionLines:${transactionId ?? ''}`;
  const [lines, setLines] = useState<BackendPurchaseTransactionLine[]>(() => swrGet<BackendPurchaseTransactionLine[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!transactionId) { setLines([]); setLoading(false); return; }
    const hit = swrGet<typeof lines>(cacheKey);
    if (hit !== undefined) { setLines(hit); setLoading(false); } else { setLoading(true); }
    listPurchaseTransactionLines(transactionId)
      .then(data => { const value = [...data].sort((a, b) => a.line_no - b.line_no); swrSet(cacheKey, value); setLines(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load item/service lines'))
      .finally(() => setLoading(false));
  }, [transactionId, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { lines, loading, error, refresh: muatUlang };
}

// ============================================================
// 4) Exceptions (tab Exceptions)
// ============================================================

export interface BackendPurchaseException {
  id: string;
  client_id: string | null;
  transaction_id: string | null;
  source_record_id: string | null;
  exception_type: string;
  severity: string;
  status: string;
  vendor_name: string | null;
  invoice_number: string | null;
  purchase_date: string | null;
  amount: number;
  currency: string;
  description: string;
  detected_at: string;
  assigned_to: string | null;
  resolution: string | null;
  resolved_at: string | null;
  period_label: string;
  aktif: boolean;
}

export async function listPurchaseExceptions(companyId?: string | null, status?: string): Promise<BackendPurchaseException[]> {
  const res = await authenticatedFetch(`${PURCHASE_BASE_URL}/exceptions${qs({ management_client_id: companyId, status })}`);
  return baca<BackendPurchaseException[]>(res);
}

export async function createPurchaseException(payload: Partial<BackendPurchaseException>): Promise<BackendPurchaseException> {
  const row = await post<BackendPurchaseException>(`${PURCHASE_BASE_URL}/exceptions`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function updatePurchaseException(id: string, payload: Partial<BackendPurchaseException>): Promise<BackendPurchaseException> {
  const row = await put<BackendPurchaseException>(`${PURCHASE_BASE_URL}/exceptions/${id}`, payload);
  notifyPurchaseChanged();
  return row;
}

export async function deletePurchaseException(id: string): Promise<void> {
  await del(`${PURCHASE_BASE_URL}/exceptions/${id}`);
  notifyPurchaseChanged();
}

export function usePurchaseExceptions(companyId: string | null | undefined): {
  exceptions: BackendPurchaseException[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `purchase:usePurchaseExceptions:${companyId ?? ''}`;
  const [exceptions, setExceptions] = useState<BackendPurchaseException[]>(() => swrGet<BackendPurchaseException[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!companyId) { setExceptions([]); setLoading(false); return; }
    const hit = swrGet<typeof exceptions>(cacheKey);
    if (hit !== undefined) { setExceptions(hit); setLoading(false); } else { setLoading(true); }
    listPurchaseExceptions(companyId)
      .then(data => { const value = data; swrSet(cacheKey, value); setExceptions(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load exceptions'))
      .finally(() => setLoading(false));
  }, [companyId, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(PURCHASE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { exceptions, loading, error, refresh: muatUlang };
}

// ============================================================
// Mapper: Backend*  -> bentuk UI dari src/data/purchaseData.ts (dulu
// datang dari mock, sekarang dipetakan dari backend di SATU tempat ini,
// bukan diduplikasi per halaman). `lines` di mapTransactionToUi() default
// [] -- diisi belakangan lewat mapTransactionLineToUi() + usePurchase
// TransactionLines() begitu user membuka detail 1 transaksi (lazy, sama
// seperti pola JE).
// ============================================================

export function mapSourceRecordToUi(r: BackendPurchaseSourceRecord): PurchaseSourceRecord {
  return {
    id: r.id,
    sourceId: r.source_code,
    sourceType: r.source_type as SourceDocType,
    vendor: r.vendor_name,
    vendorId: r.vendor_code || '',
    sourceDate: r.source_date || '',
    invoiceNumber: r.invoice_number || '',
    poNumber: r.po_number || '',
    description: r.description || '',
    amount: r.amount,
    taxAmount: r.tax_amount,
    totalAmount: r.total_amount,
    currency: r.currency,
    status: r.status as PurchaseSourceRecord['status'],
    relatedPurchaseId: r.related_transaction_id,
    period: r.period_label,
    createdBy: '',
    createdDate: (r.created_at || '').slice(0, 10),
    validationStatus: r.validation_status as PurchaseSourceRecord['validationStatus'],
  };
}

export function mapTransactionToUi(t: BackendPurchaseTransaction, lines: PurchaseLine[] = []): PurchaseTransaction {
  return {
    id: t.id,
    purchaseId: t.purchase_no,
    purchaseDate: t.purchase_date,
    invoiceDate: t.invoice_date || '',
    invoiceNumber: t.invoice_number || '',
    poNumber: t.po_number || '',
    vendor: t.vendor_name,
    vendorId: t.vendor_code || '',
    sourceDocType: t.source_doc_type as SourceDocType,
    sourceRef: t.source_ref || '',
    description: t.description || '',
    category: (t.category || 'Other') as PurchaseCategory,
    subtotal: t.subtotal,
    discount: t.discount,
    taxAmount: t.tax_amount,
    total: t.total,
    accountsPayable: t.accounts_payable,
    currency: t.currency,
    paymentStatus: t.payment_status as PaymentStatus,
    paymentTerms: t.payment_terms || '',
    dueDate: t.due_date || '',
    status: t.status as PurchaseStatus,
    period: t.period_label,
    createdBy: t.created_by_name || 'System',
    approvedBy: t.approved_by_name || undefined,
    createdDate: (t.created_at || '').slice(0, 10),
    updatedDate: (t.edited_at || t.created_at || '').slice(0, 10),
    lines,
    notes: t.notes || undefined,
    postingDate: t.posting_date || undefined,
    postedBy: t.posted_by_name || undefined,
    postedTimestamp: t.posted_at || undefined,
    apAccountCode: t.ap_account_code || undefined,
    apAccountName: t.ap_account_name || undefined,
    taxAccountCode: t.tax_account_code || undefined,
    taxAccountName: t.tax_account_name || undefined,
  };
}

export function mapTransactionLineToUi(l: BackendPurchaseTransactionLine): PurchaseLine {
  return {
    id: l.id,
    itemCode: l.item_code || undefined,
    description: l.description,
    quantity: l.quantity,
    unit: l.unit || '',
    unitPrice: l.unit_price,
    discount: l.discount,
    taxRate: l.tax_rate,
    taxAmount: l.tax_amount,
    subtotal: l.subtotal,
    total: l.total,
    accountCode: l.account_code,
    accountName: l.account_name || '',
  };
}

export function mapExceptionToUi(e: BackendPurchaseException): PurchaseException {
  return {
    id: e.id,
    purchaseId: e.transaction_id || '',
    exceptionType: e.exception_type as ExceptionType,
    severity: e.severity as ExceptionSeverity,
    vendor: e.vendor_name || '',
    invoiceNumber: e.invoice_number || '',
    purchaseDate: e.purchase_date || '',
    amount: e.amount,
    currency: e.currency,
    description: e.description,
    detectedDate: (e.detected_at || '').slice(0, 10),
    assignedTo: e.assigned_to || '',
    status: e.status as ExceptionStatus,
    resolution: e.resolution || undefined,
    resolutionDate: e.resolved_at ? e.resolved_at.slice(0, 10) : undefined,
    period: e.period_label,
  };
}
