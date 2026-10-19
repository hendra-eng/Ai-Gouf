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
import { swrClear, swrGet, swrSet } from './swrCache';

const JE_CHANGED_EVENT = 'gouf-journal-entry-changed';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const JE_BASE_URL = `${API_BASE_URL}/api/v1/transactions/journal-entries`;

async function authenticatedFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, init);
}

function notifyJeChanged() {
  swrClear('je:'); // data lama tidak boleh tampil setelah ada perubahan
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
  const cacheKey = `je:useJeSourceRecords:${clientId ?? ''}`;
  const [records, setRecords] = useState<BackendJeSourceRecord[]>(() => swrGet<BackendJeSourceRecord[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setRecords([]); setLoading(false); return; }
    const hit = swrGet<typeof records>(cacheKey);
    if (hit !== undefined) { setRecords(hit); setLoading(false); } else { setLoading(true); }
    listJeSourceRecords(clientId)
      .then(data => { const value = data; swrSet(cacheKey, value); setRecords(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat source records'))
      .finally(() => setLoading(false));
  }, [clientId, cacheKey]);

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
  /** id management_clients -- klien pemilik transaksi (filter Financial Statements). */
  management_client_id?: string | null;
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
  journal_entry_id: string | null;
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
  /** id management_clients -- klien pemilik transaksi (filter Financial Statements). */
  management_client_id?: string | null;
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

/** Ringkasan hasil POST /import/upload -- BackendJeSourceFile + info pencocokan template.
 *  Lihat backend/modules/transactions/journal_entry_import_v1.py::upload_journal_entry_import.
 *  `created` selalu 0 di tahap upload (journal entry baru dibuat lewat promoteJeSourceFileToJournals). */
export interface UploadJeSourceFileResult extends Partial<BackendJeSourceFile> {
  template_matched: boolean;
  groups_detected: number;
  rows_extracted?: number;
  skipped_no_key_rows?: number;
  created: number;
  drafts: JeImportDraftResult[];
  /** Pesan tambahan dari backend (mis. ekstraksi gagal walau template cocok). */
  note?: string;
}

/**
 * Upload file laporan jurnal (CSV/Excel) SUNGGUHAN ke backend -- backend
 * yang mendeteksi pola kolom, mencocokkan ke Journal Entry Import Template
 * yang sudah pernah dipelajari untuk klien+format ini, lalu mencatat file ke
 * daftar Source Data + 1 baris staging per journal entry. Draft BARU dibuat
 * lewat promoteJeSourceFileToJournals() ("Create Journal"). BEDA dari createJeDraftWithLines()
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
  notifyJeChanged(); // file baru muncul di daftar Source Data walau belum ada draft yang dibuat
  return row;
}

// ============================================================
// 1b) Source Files & Source Rows (tab Source Data -- daftar file upload,
// File Preview, "Create Journal"). Backend: journal_entry_import_v1.py.
// ============================================================

/** Status ekstraksi/mapping file sumber -- label Inggris langsung dari backend. */
export type JeSourceStatus = 'Completed' | 'Processing' | 'Needs Review' | 'Failed';

export interface BackendJeSourceFile {
  id: string;
  client_id: string | null;
  /** id management_clients -- company yang laporannya diupload. */
  management_client_id: string;
  file_name: string;
  file_type: string | null;
  period_label: string | null;
  /** Jumlah journal entry (voucher) yang terdeteksi -- BUKAN jumlah baris debit/kredit. */
  rows_detected: number;
  rows_valid: number;
  rows_invalid: number;
  duplicate_count: number;
  status_ekstraksi: JeSourceStatus;
  status_mapping: JeSourceStatus;
  confidence_score: number | null;
  debit_total: number;
  credit_total: number;
  extraction_duration_ms: number | null;
  ai_model_version: string | null;
  mapping_rules: Record<string, unknown> | null;
  template_id: string | null;
  processed_by: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
  created_at: string;
  aktif: boolean;
}

export interface BackendJeSourceRow {
  id: string;
  source_file_id: string;
  row_no: number;
  tanggal: string | null;
  je_number: string | null;
  description: string | null;
  source_type: string | null;
  line_count: number;
  debit_total: number;
  credit_total: number;
  is_valid: boolean;
  validation_notes: string | null;
  is_duplicate_candidate: boolean;
  /** Terisi setelah baris dipromosikan jadi draft JE (penanda "sudah dibuat"). */
  draft_id: string | null;
}

export async function listJeSourceFiles(managementClientId?: string | null): Promise<BackendJeSourceFile[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/source-files${qs({ management_client_id: managementClientId })}`);
  return baca<BackendJeSourceFile[]>(res);
}

export async function updateJeSourceFile(id: string, payload: Partial<BackendJeSourceFile>): Promise<BackendJeSourceFile> {
  const row = await put<BackendJeSourceFile>(`${JE_BASE_URL}/source-files/${id}`, payload);
  notifyJeChanged();
  return row;
}

/** Soft-delete file sumber -- journal entry yang sudah dibuat dari file ini TIDAK ikut terhapus. */
export async function deleteJeSourceFile(id: string): Promise<void> {
  await del(`${JE_BASE_URL}/source-files/${id}`);
  notifyJeChanged();
}

export async function listJeSourceRows(sourceFileId?: string | null): Promise<BackendJeSourceRow[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/source-rows${qs({ source_file_id: sourceFileId })}`);
  return baca<BackendJeSourceRow[]>(res);
}

export interface PromoteToJournalsResult {
  total_rows: number;
  journals_created: number;
  skipped_invalid: number;
  skipped_already_promoted: number;
  skipped_number_conflict: number;
}

/** "Create Journal": naikkan baris VALID dari file ini jadi draft Journal Entry (muncul di tab JE
 *  Transaction akun yang login). Idempoten -- baris yang sudah pernah dibuat dilewati. */
export async function promoteJeSourceFileToJournals(sourceFileId: string): Promise<PromoteToJournalsResult> {
  const hasil = await post<PromoteToJournalsResult>(`${JE_BASE_URL}/source-files/${sourceFileId}/promote-to-journals`, {});
  notifyJeChanged(); // baris source (draft_id) & daftar draft berubah
  return hasil;
}

export function useJeSourceFiles(managementClientId: string | null | undefined): {
  files: BackendJeSourceFile[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `je:useJeSourceFiles:${managementClientId ?? ''}`;
  const [files, setFiles] = useState<BackendJeSourceFile[]>(() => swrGet<BackendJeSourceFile[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!managementClientId) { setFiles([]); setLoading(false); return; }
    const hit = swrGet<BackendJeSourceFile[]>(cacheKey);
    if (hit !== undefined) { setFiles(hit); setLoading(false); } else { setLoading(true); }
    listJeSourceFiles(managementClientId)
      .then(data => { swrSet(cacheKey, data); setFiles(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load source files'))
      .finally(() => setLoading(false));
  }, [managementClientId, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { files, loading, error, refresh: muatUlang };
}

export function useJeSourceRows(sourceFileId: string | null | undefined): {
  rows: BackendJeSourceRow[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `je:useJeSourceRows:${sourceFileId ?? ''}`;
  const [rows, setRows] = useState<BackendJeSourceRow[]>(() => swrGet<BackendJeSourceRow[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!sourceFileId) { setRows([]); setLoading(false); return; }
    const hit = swrGet<BackendJeSourceRow[]>(cacheKey);
    if (hit !== undefined) { setRows(hit); setLoading(false); } else { setLoading(true); }
    listJeSourceRows(sourceFileId)
      .then(data => { swrSet(cacheKey, data); setRows(data); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load source rows'))
      .finally(() => setLoading(false));
  }, [sourceFileId, cacheKey]);

  useEffect(() => {
    muatUlang();
    window.addEventListener(JE_CHANGED_EVENT, muatUlang);
    return () => window.removeEventListener(JE_CHANGED_EVENT, muatUlang);
  }, [muatUlang]);

  return { rows, loading, error, refresh: muatUlang };
}

export function useJeDrafts(clientId: string | null | undefined, status?: string): {
  drafts: BackendJeDraft[]; loading: boolean; error: string | null; refresh: () => void;
} {
  const cacheKey = `je:useJeDrafts:${clientId ?? ''}:${status ?? ''}`;
  const [drafts, setDrafts] = useState<BackendJeDraft[]>(() => swrGet<BackendJeDraft[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setDrafts([]); setLoading(false); return; }
    const hit = swrGet<typeof drafts>(cacheKey);
    if (hit !== undefined) { setDrafts(hit); setLoading(false); } else { setLoading(true); }
    listJeDrafts(clientId, status)
      .then(data => { const value = data; swrSet(cacheKey, value); setDrafts(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat journal entry'))
      .finally(() => setLoading(false));
  }, [clientId, status, cacheKey]);

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

// ============================================================
// 2b) Halaman Other -- jurnal source_type="Other" + aksi status massal
// (backend: GET /drafts-with-lines, POST /drafts/approve|post|reject|reopen|
// bulk-delete, PUT /drafts/{id}/full)
// ============================================================

export type BackendJeDraftWithLines = BackendJeDraft & { lines: BackendJeDraftLine[] };

export async function listJeDraftsWithLines(clientId?: string | null, sourceType?: string, status?: string): Promise<BackendJeDraftWithLines[]> {
  const res = await authenticatedFetch(`${JE_BASE_URL}/drafts-with-lines${qs({ client_id: clientId, source_type: sourceType, status })}`);
  return baca<BackendJeDraftWithLines[]>(res);
}

export interface JeStatusActionResult {
  done: Partial<BackendJeDraft>[];
  skipped: { id: string; je_number: string | null; reason: string }[];
}

export type JeStatusAction = 'approve' | 'post' | 'reject' | 'reopen' | 'bulk-delete';

/** Approve / Post / Reject / Reopen / Hapus banyak draft sekaligus. Draft yang tidak memenuhi syarat masuk `skipped` (beserta alasannya). */
export async function runJeDraftAction(
  action: JeStatusAction,
  draftIds: string[],
  opts: { postingDate?: string; reason?: string } = {},
): Promise<JeStatusActionResult> {
  const hasil = await post<JeStatusActionResult>(`${JE_BASE_URL}/drafts/${action}`, {
    draft_ids: draftIds,
    posting_date: opts.postingDate || undefined,
    reason: opts.reason || undefined,
  });
  notifyJeChanged();
  return hasil;
}

export interface JeDraftFullUpdateInput {
  je_number?: string;
  entry_date?: string;
  posting_date?: string | null;
  period_label?: string;
  description?: string;
  source_reference?: string;
  notes?: string | null;
  lines?: JeDraftLineInput[];
}

/** Edit header + ganti seluruh baris draft yang belum diposting. */
export async function updateJeDraftFull(id: string, payload: JeDraftFullUpdateInput): Promise<BackendJeDraftWithLines> {
  const row = await put<BackendJeDraftWithLines>(`${JE_BASE_URL}/drafts/${id}/full`, payload);
  notifyJeChanged();
  return row;
}

/** Dengarkan perubahan data JE (create/edit/approve/post/dst) dari mana pun di aplikasi. */
export function onJeChanged(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(JE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(JE_CHANGED_EVENT, handler);
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
  const cacheKey = `je:useJeDraftLines:${draftId ?? ''}`;
  const [lines, setLines] = useState<BackendJeDraftLine[]>(() => swrGet<BackendJeDraftLine[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!draftId) { setLines([]); setLoading(false); return; }
    const hit = swrGet<typeof lines>(cacheKey);
    if (hit !== undefined) { setLines(hit); setLoading(false); } else { setLoading(true); }
    listJeDraftLines(draftId)
      .then(data => { const value = [...data].sort((a, b) => a.line_no - b.line_no); swrSet(cacheKey, value); setLines(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat baris jurnal'))
      .finally(() => setLoading(false));
  }, [draftId, cacheKey]);

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
  const cacheKey = `je:useJeActivityLogs:${clientId ?? ''}`;
  const [logs, setLogs] = useState<BackendJeActivityLog[]>(() => swrGet<BackendJeActivityLog[]>(cacheKey) ?? []);
  const [loading, setLoading] = useState(() => swrGet(cacheKey) === undefined);
  const [error, setError] = useState<string | null>(null);

  const muatUlang = useCallback(() => {
    if (!clientId) { setLogs([]); setLoading(false); return; }
    const hit = swrGet<typeof logs>(cacheKey);
    if (hit !== undefined) { setLogs(hit); setLoading(false); } else { setLoading(true); }
    listJeActivityLogs(clientId)
      .then(data => { const value = data; swrSet(cacheKey, value); setLogs(value); setError(null); })
      .catch(err => setError(err instanceof Error ? err.message : 'Gagal memuat activity log'))
      .finally(() => setLoading(false));
  }, [clientId, cacheKey]);

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
  /** Tanggal posting ke buku besar (BackendJeDraft.posted_at, 'YYYY-MM-DD'); kosong kalau belum diposting. */
  postedAt?: string;
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
    postedAt: d.posted_at ? d.posted_at.slice(0, 10) : undefined,
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

// ============================================================
// Aturan workflow (SAMA dengan backend db_client.JE_STATUS_BISA_* dan
// journal_entry_v1.LEVEL_*; backend tetap penentu akhirnya) -- dipakai
// semua tab JE supaya tombol aksi & badge konsisten.
// ============================================================

export const JE_LEVEL_APPROVE = 3; // approve / reject / reopen / hapus (Supervisor ke atas)
export const JE_LEVEL_POST = 4;    // posting ke buku besar (Manager ke atas)

/** "tahap_N" -> N, super_admin -> 999. */
export function jeRoleLevel(role?: string | null): number {
  if (role === 'super_admin') return 999;
  const m = /^tahap_(\d+)$/.exec(role ?? '');
  return m ? Number(m[1]) : 0;
}

/** Status asal yang boleh dikenai tiap aksi. */
export const JE_ACTION_FROM: Record<JeStatusAction, JeUiStatus[]> = {
  approve: ['draft', 'pending', 'exception'],
  post: ['approved'],
  reject: ['draft', 'pending', 'exception', 'approved'],
  reopen: ['rejected'],
  'bulk-delete': ['draft', 'pending', 'exception', 'rejected'],
};

export const JE_ACTION_LEVEL: Record<JeStatusAction, number> = {
  approve: JE_LEVEL_APPROVE,
  post: JE_LEVEL_POST,
  reject: JE_LEVEL_APPROVE,
  reopen: JE_LEVEL_APPROVE,
  'bulk-delete': JE_LEVEL_APPROVE,
};

/** Alasan sebuah JE masuk tab Exceptions (kosong = tidak bermasalah). Jurnal yang sudah diposting tidak pernah dianggap bermasalah. */
export function jeFlagReasons(je: JeUiEntry): string[] {
  if (je.status === 'posted') return [];
  const reasons: string[] = [];
  if (je.status === 'exception') reasons.push('Flagged as exception');
  if (je.status === 'rejected') reasons.push('Rejected');
  const imbalance = Math.abs(je.totalDebit - je.totalCredit);
  if (imbalance > 0.01) reasons.push(`Debit/credit imbalance of Rp ${imbalance.toLocaleString('id-ID')}`);
  return reasons;
}