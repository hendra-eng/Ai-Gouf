'use client';

// Data layer untuk fitur "Transactions > Journal Entry" (src/app/transactions/
// journal-entry/*), terhubung ke backend/modules/transactions/journal_entry_v1.py:
// /api/v1/transactions/journal-entries/... -- lihat file itu untuk daftar endpoint.
//
// Mengikuti pola YANG SAMA dengan src/lib/salesStore.tsx (amplop response
// standar, authenticatedFetch, hook useXxxList yang dengar custom event) --
// baca komentar di file itu untuk alasan detailnya.
//
// [PENTING] client_id: 4 tabel financial_transaction_journal_entry_* di
// backend FK ke management_users(id_user) -- pola sama persis dengan Sales.
// client_id yang dikirim/dipakai untuk filter di SELURUH fungsi di bawah
// adalah id_user milik akun yang SEDANG LOGIN (`useAuth().user.id`).

import { useEffect, useState, useCallback } from 'react';

const JE_CHANGED_EVENT = 'gouf-journal-entry-changed';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const JE_BASE_URL = `${API_BASE_URL}/api/v1/transactions/journal-entries`;

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

function notifyJeChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(JE_CHANGED_EVENT));
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

export interface BackendJeSourceRecord {
  id: string;
  client_id: string | null;
  source_code: string;
  source_type: string;
  source_date: string | null;
  description: string | null;
  amount: number;
  currency: string;
  related_account_code: string | null;
  related_account_name: string | null;
  party_name: string | null;
  mapping_status: string;
  sync_status: string;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listJeSourceRecords(
  clientId?: string | null,
  sourceType?: string,
  mappingStatus?: string,
): Promise<BackendJeSourceRecord[]> {
  const res = await authenticatedFetch(
    `${JE_BASE_URL}/source-records${qs({ client_id: clientId, source_type: sourceType, mapping_status: mappingStatus })}`,
  );
  return baca<BackendJeSourceRecord[]>(res);
}

export async function createJeSourceRecord(payload: Partial<BackendJeSourceRecord>): Promise<BackendJeSourceRecord> {
  const row = await post<BackendJeSourceRecord>(`${JE_BASE_URL}/source-records`, payload);
  notifyJeChanged();
  return row;
}

export async function updateJeSourceRecord(id: string, payload: Partial<BackendJeSourceRecord>): Promise<BackendJeSourceRecord> {
  const row = await put<BackendJeSourceRecord>(`${JE_BASE_URL}/source-records/${id}`, payload);
  notifyJeChanged();
  return row;
}

export async function deleteJeSourceRecord(id: string): Promise<void> {
  await del(`${JE_BASE_URL}/source-records/${id}`);
  notifyJeChanged();
}

export function useJeSourceRecords(clientId: string | null | undefined): {
  records: BackendJeSourceRecord[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [records, setRecords] = useState<BackendJeSourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setRecords([]); setLoading(false); return; }
    setLoading(true);
    listJeSourceRecords(clientId)
      .then(data => { setRecords(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat source records'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { records, loading, error, refresh: muatUlang };
}

// ============================================================
// 2) Drafts (entitas inti: tab JE Transaction / Journal Preview /
// Exceptions (via status) / Posted)
// ============================================================

export interface BackendJeDraft {
  id: string;
  client_id: string | null;
  je_number: string;
  entry_date: string;
  posting_date: string | null;
  period_label: string;
  description: string | null;
  source_type: string;
  source_reference: string | null;
  source_record_id: string | null;
  total_debit: number;
  total_credit: number;
  currency: string;
  status: string;
  created_by_name: string | null;
  reviewed_by_name: string | null;
  approved_by_name: string | null;
  notes: string | null;
  journal_entry_id: number | null;
  posted_at: string | null;
  posted_by: string | null;
  created_at: string;
  created_by: string | null;
  edited_at: string | null;
  edited_by: string | null;
  aktif: boolean;
}

export async function listJeDrafts(clientId?: string | null, status?: string): Promise<BackendJeDraft[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/drafts${qs({ client_id: clientId, status })}`);
  return baca<BackendJeDraft[]>(res);
}

export async function createJeDraft(payload: Partial<BackendJeDraft>): Promise<BackendJeDraft> {
  const row = await post<BackendJeDraft>(`${JE_BASE_URL}/drafts`, payload);
  notifyJeChanged();
  return row;
}

export async function updateJeDraft(id: string, payload: Partial<BackendJeDraft>): Promise<BackendJeDraft> {
  const row = await put<BackendJeDraft>(`${JE_BASE_URL}/drafts/${id}`, payload);
  notifyJeChanged();
  return row;
}

export async function deleteJeDraft(id: string): Promise<void> {
  await del(`${JE_BASE_URL}/drafts/${id}`);
  notifyJeChanged();
}

export interface JeDraftLineInput {
  line_no?: number;
  account_code: string;
  account_name?: string;
  description?: string;
  debit: number;
  credit: number;
  cost_center?: string;
}

export interface JeDraftWithLinesInput {
  client_id?: string | null;
  je_number: string;
  entry_date: string;
  posting_date?: string | null;
  period_label: string;
  description?: string;
  source_type?: string;
  source_reference?: string;
  source_record_id?: string | null;
  currency?: string;
  status?: string;
  created_by_name?: string;
  notes?: string;
  lines: JeDraftLineInput[];
}

/** Buat draft + seluruh baris debit/kreditnya sekaligus, atomik --
 *  dipakai form "New Journal Entry" & alur "Import Journal" (1 panggilan
 *  per JE yang diimpor). BEDA dari createJeDraft() + createJeDraftLine()
 *  berkali-kali -- endpoint ini satu transaksi DB, jadi tidak mungkin ada
 *  draft "yatim" tanpa baris kalau salah satu insert baris gagal. */
export async function createJeDraftWithLines(payload: JeDraftWithLinesInput): Promise<BackendJeDraft & { lines: BackendJeDraftLine[] }> {
  const row = await post<BackendJeDraft & { lines: BackendJeDraftLine[] }>(`${JE_BASE_URL}/drafts/full`, payload);
  notifyJeChanged();
  return row;
}

/** Ringkasan hasil 1 journal entry yang dicoba diimpor lewat template --
 *  lihat backend/modules/transactions/journal_entry_import_v1.py. */
export interface JeImportDraftResult {
  je_number: string;
  ok: boolean;
  message: string;
}

/** Ringkasan hasil POST /import/upload -- lihat backend/modules/
 *  transactions/journal_entry_import_v1.py::upload_journal_entry_import. */
export interface UploadJeSourceFileResult {
  template_matched: boolean;
  groups_detected: number;
  skipped_no_key_rows?: number;
  created: number;
  skipped_unbalanced?: number;
  skipped_duplicate?: number;
  drafts: JeImportDraftResult[];
}

/**
 * Upload file laporan jurnal (CSV/Excel) SUNGGUHAN ke backend -- backend
 * yang mendeteksi pola kolom, mencocokkan ke Journal Entry Import Template
 * yang sudah pernah dipelajari untuk klien+format ini, lalu langsung
 * membuat draft + baris debit/kreditnya (lewat dbc.create_je_draft_with_
 * lines) tanpa tahap staging terpisah. BEDA dari createJeDraftWithLines()
 * (yang kirim journal entry yang SUDAH diparse/dikelompokkan) -- fungsi
 * ini yang kirim FILE MENTAH, dipakai ImportJournalModal.tsx sebagai jalur
 * pertama (fallback ke parsing alias kolom generik di browser kalau
 * template_matched=false, mis. klien yang belum punya template).
 *
 * managementClientId WAJIB -- ID management_clients (klien aktif di
 * dropdown "Switch Company"), BUKAN client_id akun yang login (pola sama
 * seperti uploadSalesSourceFile() di salesStore.tsx).
 */
export async function uploadJeSourceFile(file: File, managementClientId: string): Promise<UploadJeSourceFileResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('management_client_id', managementClientId);
  const res = await authenticatedFetch(`${JE_BASE_URL}/import/upload`, {
    method: 'POST',
    body: form, // JANGAN set Content-Type manual -- browser yang mengisi boundary multipart-nya
  });
  const row = await baca<UploadJeSourceFileResult>(res);
  if (row.created > 0) notifyJeChanged();
  return row;
}

export function useJeDrafts(clientId: string | null | undefined, status?: string): {
  drafts: BackendJeDraft[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [drafts, setDrafts] = useState<BackendJeDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setDrafts([]); setLoading(false); return; }
    setLoading(true);
    listJeDrafts(clientId, status)
      .then(data => { setDrafts(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat journal entry'))
      .finally(() => setLoading(false));
  }, [clientId, status]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { drafts, loading, error, refresh: muatUlang };
}

// ============================================================
// 3) Draft Lines (baris debit/kredit, tab Journal Preview & detail panel)
// ============================================================

export interface BackendJeDraftLine {
  id: string;
  draft_id: string;
  client_id: string | null;
  line_no: number;
  account_code: string;
  account_name: string | null;
  description: string | null;
  debit: number;
  credit: number;
  cost_center: string | null;
  aktif: boolean;
}

export async function listJeDraftLines(draftId?: string | null, clientId?: string | null): Promise<BackendJeDraftLine[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/draft-lines${qs({ draft_id: draftId, client_id: clientId })}`);
  return baca<BackendJeDraftLine[]>(res);
}

export async function createJeDraftLine(payload: Partial<BackendJeDraftLine>): Promise<BackendJeDraftLine> {
  const row = await post<BackendJeDraftLine>(`${JE_BASE_URL}/draft-lines`, payload);
  notifyJeChanged();
  return row;
}

export async function updateJeDraftLine(id: string, payload: Partial<BackendJeDraftLine>): Promise<BackendJeDraftLine> {
  const row = await put<BackendJeDraftLine>(`${JE_BASE_URL}/draft-lines/${id}`, payload);
  notifyJeChanged();
  return row;
}

export async function deleteJeDraftLine(id: string): Promise<void> {
  await del(`${JE_BASE_URL}/draft-lines/${id}`);
  notifyJeChanged();
}

/** Baris debit/kredit milik 1 draft -- dipakai lazy (cuma di-fetch begitu
 *  user membuka detail/preview 1 journal entry), BUKAN di-load untuk semua
 *  draft sekaligus (draft bisa banyak, baris-nya baru relevan per 1 entry). */
export function useJeDraftLines(draftId: string | null | undefined): {
  lines: BackendJeDraftLine[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [lines, setLines] = useState<BackendJeDraftLine[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!draftId) { setLines([]); setLoading(false); return; }
    setLoading(true);
    listJeDraftLines(draftId)
      .then(data => { setLines([...data].sort((a, b) => a.line_no - b.line_no)); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat baris jurnal'))
      .finally(() => setLoading(false));
  }, [draftId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { lines, loading, error, refresh: muatUlang };
}

// ============================================================
// 4) Activity Log (tab Overview -- append-only, tidak ada update/delete)
// ============================================================

export interface BackendJeActivityLog {
  id: string;
  client_id: string | null;
  draft_id: string | null;
  je_number: string | null;
  event_type: string;
  description: string;
  status_snapshot: string | null;
  performed_by: string;
  created_at: string;
}

export async function listJeActivityLogs(clientId?: string | null, draftId?: string): Promise<BackendJeActivityLog[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/activity-log${qs({ client_id: clientId, draft_id: draftId })}`);
  return baca<BackendJeActivityLog[]>(res);
}

export async function createJeActivityLog(payload: Partial<BackendJeActivityLog>): Promise<BackendJeActivityLog> {
  const row = await post<BackendJeActivityLog>(`${JE_BASE_URL}/activity-log`, payload);
  notifyJeChanged();
  return row;
}

export function useJeActivityLogs(clientId: string | null | undefined): {
  logs: BackendJeActivityLog[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const [logs, setLogs] = useState<BackendJeActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setLogs([]); setLoading(false); return; }
    setLoading(true);
    listJeActivityLogs(clientId)
      .then(data => { setLogs(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat activity log'))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { logs, loading, error, refresh: muatUlang };
}

// ============================================================
// Mapper: BackendJeDraft -> bentuk UI `JournalEntry` yang dipakai SELURUH
// tab (Transactions/Preview/Exceptions/Posted) -- dulu datang dari mock
// src/data/journalEntryData.ts, sekarang dipetakan dari backend di SATU
// tempat ini (bukan diduplikasi per halaman) karena bentuknya identik
// persis di semua tab, beda dari Sales yang tiap tab punya bentuk lokal
// sendiri.
// ============================================================

export type JeUiStatus = 'draft' | 'pending' | 'approved' | 'posted' | 'rejected' | 'exception';

export interface JeUiLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
  costCenter?: string;
}

export interface JeUiEntry {
  id: string; // BackendJeDraft.id (UUID)
  jeNumber: string;
  date: string;
  postingDate: string;
  period: string;
  description: string;
  sourceType: string;
  sourceReference: string;
  totalDebit: number;
  totalCredit: number;
  currency: string;
  status: JeUiStatus;
  createdBy: string;
  reviewedBy?: string;
  approvedBy?: string;
  createdDate: string;
  lastUpdated: string;
  notes?: string;
}

export function mapJeDraftToUi(d: BackendJeDraft): JeUiEntry {
  return {
    id: d.id,
    jeNumber: d.je_number,
    date: d.entry_date,
    postingDate: d.posting_date || '',
    period: d.period_label,
    description: d.description || '',
    sourceType: d.source_type,
    sourceReference: d.source_reference || '',
    totalDebit: d.total_debit,
    totalCredit: d.total_credit,
    currency: d.currency,
    status: (d.status as JeUiStatus) || 'draft',
    createdBy: d.created_by_name || 'System',
    reviewedBy: d.reviewed_by_name || undefined,
    approvedBy: d.approved_by_name || undefined,
    createdDate: (d.created_at || '').slice(0, 10),
    lastUpdated: (d.edited_at || d.created_at || '').slice(0, 10),
    notes: d.notes || undefined,
  };
}

export function mapJeDraftLineToUi(l: BackendJeDraftLine): JeUiLine {
  return {
    id: l.id,
    accountCode: l.account_code,
    accountName: l.account_name || '',
    description: l.description || '',
    debit: l.debit,
    credit: l.credit,
    costCenter: l.cost_center || undefined,
  };
}
