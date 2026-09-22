'use client';

// Data layer untuk fitur "Transactions > Sales" (src/app/transactions/sales/
// components/*), terhubung ke backend/modules/transactions/sales_v1.py:
// /api/v1/transactions/sales/... -- lihat file itu untuk daftar endpoint.
//
// Mengikuti pola YANG SAMA dengan src/lib/clientsStore.tsx (amplop response
// standar, authenticatedFetch, hook useXxxList yang dengar custom event) --
// baca komentar di file itu untuk alasan detailnya (kenapa fetch() polos
// tanpa header Authorization manual, kenapa 401 tidak memaksa redirect, dst).
//
// [PENTING] client_id: 6 tabel financial_transaction_sales_* di backend
// FK ke management_users(id_user) -- BUKAN management_clients (dropdown
// "Switch Company" di src/lib/activeClient.tsx pakai ID yang beda semesta,
// dan saat ini belum ada satupun baris management_users yang tertaut ke
// management_clients). Diputuskan (lihat percakapan pengembangan fitur ini):
// client_id yang dikirim/dipakai untuk filter di SELURUH fungsi di bawah
// adalah id_user milik akun yang SEDANG LOGIN (`useAuth().user.id`), bukan
// activeClientId. Artinya data Sales ini scope-nya "per akun yang membuat",
// cocok untuk akun client_lv_N yang login langsung mewakili perusahaannya
// sendiri -- staf internal (tahap_1..5) yang mencoba fitur ini akan melihat
// datanya sendiri (tertaut ke id_user staf tsb), bukan ke suatu "klien".

import { useEffect, useState, useCallback } from 'react';

const SALES_CHANGED_EVENT = 'gouf-sales-changed';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const SALES_BASE_URL = `${API_BASE_URL}/api/v1/transactions/sales`;

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

function notifySalesChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(SALES_CHANGED_EVENT));
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
// 1) Source Files (tab Source Data)
// ============================================================

export interface BackendSalesSourceFile {
  id: string;
  client_id: string | null;
  // [BARU] Klien (management_clients) yang laporannya sedang diupload --
  // WAJIB diisi (lihat root/SALES_IMPORT_TEMPLATES.md). Dropdown pilih
  // klien di UI upload (SalesSourceData.tsx) BELUM dibangun -- sampai itu
  // ada, createSalesSourceFile() akan ditolak backend (422) kalau field
  // ini tidak diisi.
  management_client_id: string;
  template_id: string | null;
  file_name: string;
  file_type: string | null;
  storage_path: string | null;
  period_label: string | null;
  customer_hint: string | null;
  rows_detected: number;
  rows_valid: number;
  rows_invalid: number;
  duplicate_count: number;
  status_ekstraksi: string;
  status_mapping: string;
  confidence_score: number | null;
  dpp_total: number;
  ppn_total: number;
  grand_total: number;
  extraction_duration_ms: number | null;
  ai_model_version: string | null;
  // [FIX] Bukan cuma {field_key: nama_kolom} flat lagi -- kalau file ini
  // diekstrak lewat Sales Import Template "grouped_invoice_report" (lihat
  // SALES_IMPORT_TEMPLATES.md), isinya resep parsing bertingkat (delimiter,
  // encoding, invoice_header, field_mapping, dst), jadi tipenya dilebarkan
  // ke `any` per key -- komponen yang membaca ini (SalesSourceData.tsx)
  // sudah mengecek bentuknya (`'format_type' in rules`) sebelum dipakai.
  mapping_rules: Record<string, any> | null;
  processed_by: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listSalesSourceFiles(clientId?: string | null): Promise<BackendSalesSourceFile[]> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/source-files${qs({ client_id: clientId })}`);
  return baca<BackendSalesSourceFile[]>(res);
}

export async function createSalesSourceFile(payload: Partial<BackendSalesSourceFile>): Promise<BackendSalesSourceFile> {
  const row = await post<BackendSalesSourceFile>(`${SALES_BASE_URL}/source-files`, payload);
  notifySalesChanged();
  return row;
}

export async function updateSalesSourceFile(id: string, payload: Partial<BackendSalesSourceFile>): Promise<BackendSalesSourceFile> {
  const row = await put<BackendSalesSourceFile>(`${SALES_BASE_URL}/source-files/${id}`, payload);
  notifySalesChanged();
  return row;
}

/** Hasil upload -- BackendSalesSourceFile ditambah 2 field yang cuma
 *  dikembalikan endpoint upload ini (bukan kolom tabel sungguhan). */
export interface UploadSalesSourceFileResult extends BackendSalesSourceFile {
  template_matched: boolean;
  rows_extracted: number;
}

/**
 * Upload file laporan penjualan (CSV/Excel) SUNGGUHAN ke backend --
 * backend yang mendeteksi pola kolom, mencocokkan ke template yang sudah
 * pernah dipelajari untuk klien+format ini, lalu mengekstrak barisnya
 * langsung ke financial_transaction_sales_source_rows. Lihat root/
 * SALES_IMPORT_TEMPLATES.md untuk alur lengkapnya.
 *
 * BEDA dari createSalesSourceFile() di atas (yang cuma bikin baris
 * metadata kosong tanpa isi file apa pun) -- fungsi ini yang dipakai tombol
 * "Upload File" sungguhan di SalesSourceData.tsx.
 */
export async function uploadSalesSourceFile(file: File, managementClientId: string): Promise<UploadSalesSourceFileResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('management_client_id', managementClientId);
  const res = await authenticatedFetch(`${SALES_BASE_URL}/source-files/upload`, {
    method: 'POST',
    body: form, // JANGAN set Content-Type manual -- browser yang mengisi boundary multipart-nya
  });
  const row = await baca<UploadSalesSourceFileResult>(res);
  notifySalesChanged();
  return row;
}

/** Ringkasan hasil promote-to-invoices -- lihat backend/modules/
 *  transactions/sales_import_v1.py::promote_source_file_to_invoices. */
export interface PromoteToInvoicesResult {
  total_baris: number;
  invoice_dibuat: number;
  dilewati_tidak_valid: number;
  dilewati_sudah_pernah_dipromosikan: number;
  dilewati_invoice_no_bentrok: number;
}

/**
 * Naikkan baris VALID hasil ekstraksi 1 source file jadi
 * financial_transaction_sales_invoices resmi (status Draft) -- baru dari
 * titik ini transaksinya ikut muncul di tab Sales Transaction/Journal
 * Preview/Posted/Overview (semua baca dari tabel invoices, BUKAN
 * source_rows). Aman dipanggil berkali-kali (idempoten) -- baris yang
 * sudah pernah dipromosikan atau invoice_no-nya bentrok otomatis
 * dilewati, lihat ringkasan di hasilnya.
 */
export async function promoteSourceFileToInvoices(sourceFileId: string): Promise<PromoteToInvoicesResult> {
  const result = await post<PromoteToInvoicesResult>(`${SALES_BASE_URL}/source-files/${sourceFileId}/promote-to-invoices`, {});
  notifySalesChanged();
  return result;
}

export function useSalesSourceFiles(clientId: string | null | undefined): {
  files: BackendSalesSourceFile[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [files, setFiles] = useState<BackendSalesSourceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setFiles([]); setLoading(false); return; }
    setLoading(true);
    listSalesSourceFiles(clientId)
      .then(data => { setFiles(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load source files'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(SALES_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(SALES_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { files, loading, error, refresh: muatUlang };
}

// ============================================================
// 1b) Source Rows (tab Source Data -- panel "File Preview")
// ============================================================
// Baris mentah hasil parsing 1 source file. TIDAK ada proses ekstraksi/AI
// otomatis di backend yang mengisi tabel ini -- baris di sini HANYA ada
// kalau memang di-input lewat POST /source-rows (mis. proses manual/masa
// depan). Kalau kosong, tampilkan apa adanya sebagai kosong (jangan
// diisi data contoh) -- lihat SalesSourceData.tsx.

export interface BackendSalesSourceRow {
  id: string;
  source_file_id: string;
  client_id: string | null;
  row_no: number;
  tanggal: string | null;
  no_invoice: string | null;
  nama_customer: string | null;
  cabang: string | null;
  dpp: number;
  ppn: number;
  total: number;
  is_valid: boolean;
  validation_notes: string | null;
  is_duplicate_candidate: boolean;
  aktif: boolean;
}

export async function listSalesSourceRows(sourceFileId?: string | null, clientId?: string | null): Promise<BackendSalesSourceRow[]> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/source-rows${qs({ source_file_id: sourceFileId, client_id: clientId })}`);
  return baca<BackendSalesSourceRow[]>(res);
}

export function useSalesSourceRows(sourceFileId: string | null | undefined): {
  rows: BackendSalesSourceRow[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [rows, setRows] = useState<BackendSalesSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!sourceFileId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    listSalesSourceRows(sourceFileId)
      .then(data => { setRows(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load source data rows'))
      .finally(() => setLoading(false));
  }, [sourceFileId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(SALES_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(SALES_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { rows, loading, error, refresh: muatUlang };
}

// ============================================================
// 2) Invoices (tab Sales Transaction / Journal Preview / Posted)
// ============================================================

export interface BackendSalesInvoice {
  id: string;
  client_id: string | null;
  invoice_no: string;
  invoice_date: string;
  due_date: string | null;
  customer_name: string;
  customer_npwp: string | null;
  description: string | null;
  transaction_type: string | null;
  project_name: string | null;
  sales_person: string | null;
  term_of_payment: string | null;
  // Branch where the transaction happened (free text). null = not set yet.
  cabang: string | null;
  dpp: number;
  ppn: number;
  pph: number;
  gross_amount: number;
  paid_amount: number;
  outstanding_amount: number;
  tax_invoice_status: string;
  posting_status: string;
  reconcile_status: string;
  journal_sync_status: string;
  journal_entry_id: number | null;
  source_row_id: string | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listSalesInvoices(clientId?: string | null, postingStatus?: string): Promise<BackendSalesInvoice[]> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/invoices${qs({ client_id: clientId, posting_status: postingStatus })}`);
  return baca<BackendSalesInvoice[]>(res);
}

export async function createSalesInvoice(payload: Partial<BackendSalesInvoice>): Promise<BackendSalesInvoice> {
  const row = await post<BackendSalesInvoice>(`${SALES_BASE_URL}/invoices`, payload);
  notifySalesChanged();
  return row;
}

export async function updateSalesInvoice(id: string, payload: Partial<BackendSalesInvoice>): Promise<BackendSalesInvoice> {
  const row = await put<BackendSalesInvoice>(`${SALES_BASE_URL}/invoices/${id}`, payload);
  notifySalesChanged();
  return row;
}

export async function deleteSalesInvoice(id: string): Promise<void> {
  await del(`${SALES_BASE_URL}/invoices/${id}`);
  notifySalesChanged();
}

export function useSalesInvoices(clientId: string | null | undefined, postingStatus?: string): {
  invoices: BackendSalesInvoice[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [invoices, setInvoices] = useState<BackendSalesInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setInvoices([]); setLoading(false); return; }
    setLoading(true);
    listSalesInvoices(clientId, postingStatus)
      .then(data => { setInvoices(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load invoices'))
      .finally(() => setLoading(false));
  }, [clientId, postingStatus]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(SALES_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(SALES_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { invoices, loading, error, refresh: muatUlang };
}

// ============================================================
// 3) Account Mappings (tab Journal Preview -- Accounting Classification)
// ============================================================

export interface BackendSalesAccountMapping {
  id: string;
  client_id: string | null;
  invoice_id: string;
  piutang_account_code: string;
  piutang_account_name: string | null;
  pendapatan_account_code: string;
  pendapatan_account_name: string | null;
  ppn_account_code: string | null;
  ppn_account_name: string | null;
  pph_account_code: string | null;
  pph_account_name: string | null;
  is_ai_suggested: boolean;
  ai_confidence: number | null;
  mapped_by: string | null;
  mapped_at: string;
  aktif: boolean;
}

export async function getSalesAccountMappingByInvoice(invoiceId: string): Promise<BackendSalesAccountMapping | null> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/invoices/${invoiceId}/account-mapping`);
  if (res.status === 404) return null;
  return baca<BackendSalesAccountMapping>(res);
}

export async function createSalesAccountMapping(payload: Partial<BackendSalesAccountMapping>): Promise<BackendSalesAccountMapping> {
  const row = await post<BackendSalesAccountMapping>(`${SALES_BASE_URL}/account-mappings`, payload);
  notifySalesChanged();
  return row;
}

export async function updateSalesAccountMapping(id: string, payload: Partial<BackendSalesAccountMapping>): Promise<BackendSalesAccountMapping> {
  const row = await put<BackendSalesAccountMapping>(`${SALES_BASE_URL}/account-mappings/${id}`, payload);
  notifySalesChanged();
  return row;
}

/** Buat mapping baru kalau invoice ini belum punya, atau update kalau sudah ada (relasinya 1:1). */
export async function upsertSalesAccountMapping(
  invoiceId: string,
  clientId: string | null | undefined,
  fields: Omit<Partial<BackendSalesAccountMapping>, 'invoice_id' | 'client_id'>,
): Promise<BackendSalesAccountMapping> {
  const existing = await getSalesAccountMappingByInvoice(invoiceId);
  if (existing) {
    return updateSalesAccountMapping(existing.id, fields);
  }
  return createSalesAccountMapping({ ...fields, invoice_id: invoiceId, client_id: clientId ?? undefined });
}

// ============================================================
// 4) Exceptions (tab Exceptions)
// ============================================================

export interface BackendSalesException {
  id: string;
  client_id: string | null;
  invoice_id: string | null;
  source_row_id: string | null;
  exception_type: string;
  priority: string;
  status: string;
  ai_confidence: number | null;
  ai_suggestion: string | null;
  source_snippet: Record<string, unknown> | null;
  assigned_to: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listSalesExceptions(clientId?: string | null, status?: string): Promise<BackendSalesException[]> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/exceptions${qs({ client_id: clientId, status })}`);
  return baca<BackendSalesException[]>(res);
}

export async function createSalesException(payload: Partial<BackendSalesException>): Promise<BackendSalesException> {
  const row = await post<BackendSalesException>(`${SALES_BASE_URL}/exceptions`, payload);
  notifySalesChanged();
  return row;
}

export async function updateSalesException(id: string, payload: Partial<BackendSalesException>): Promise<BackendSalesException> {
  const row = await put<BackendSalesException>(`${SALES_BASE_URL}/exceptions/${id}`, payload);
  notifySalesChanged();
  return row;
}

export function useSalesExceptions(clientId: string | null | undefined): {
  exceptions: BackendSalesException[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [exceptions, setExceptions] = useState<BackendSalesException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setExceptions([]); setLoading(false); return; }
    setLoading(true);
    listSalesExceptions(clientId)
      .then(data => { setExceptions(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load exceptions'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(SALES_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(SALES_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { exceptions, loading, error, refresh: muatUlang };
}

// ============================================================
// 5) Activity Log (tab Posted -- append-only, tidak ada update/delete)
// ============================================================

export interface BackendSalesActivityLog {
  id: string;
  client_id: string | null;
  invoice_id: string | null;
  event_type: string;
  description: string;
  reference_no: string | null;
  performed_by: string;
  created_at: string;
}

export async function listSalesActivityLogs(clientId?: string | null, invoiceId?: string): Promise<BackendSalesActivityLog[]> {
  const res = await authenticatedFetch(`${SALES_BASE_URL}/activity-log${qs({ client_id: clientId, invoice_id: invoiceId })}`);
  return baca<BackendSalesActivityLog[]>(res);
}

export async function createSalesActivityLog(payload: Partial<BackendSalesActivityLog>): Promise<BackendSalesActivityLog> {
  const row = await post<BackendSalesActivityLog>(`${SALES_BASE_URL}/activity-log`, payload);
  notifySalesChanged();
  return row;
}

export function useSalesActivityLogs(clientId: string | null | undefined): {
  logs: BackendSalesActivityLog[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [logs, setLogs] = useState<BackendSalesActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    listSalesActivityLogs(clientId)
      .then(data => { setLogs(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load activity log'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(SALES_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(SALES_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { logs, loading, error, refresh: muatUlang };
}

// ============================================================
// Helper format tampilan -- dipakai bersama oleh komponen tab Sales
// ============================================================

const MONTH_NAMES_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "02 Jan 2024" -- English month names, independent of the browser locale. */
export function formatTanggalSingkat(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTH_NAMES_EN[d.getMonth()]} ${d.getFullYear()}`;
}

/** "2 Jan 2024, 14:30" -- English month names, independent of the browser locale. */
export function formatTanggalWaktu(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTH_NAMES_EN[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}
