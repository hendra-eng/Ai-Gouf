'use client';

// Import data opening balance (tab "Import Data" + halaman monitoring &
// approval) -- terhubung ke backend modules/management/opening_balance_import_v1.py
// (/api/v1/management/opening-balances/{ob_id}/imports/... & /imports/{batch_id}/...).

import { OpeningBalanceError } from '@/lib/openingBalanceStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const OB_URL = `${API_BASE_URL}/api/v1/management/opening-balances`;

export type ImportModule = 'coa' | 'ar' | 'ap' | 'inventory' | 'asset';
export type ImportBatchStatus = 'validated' | 'submitted' | 'approved' | 'rejected' | 'cancelled';
export type ImportRowStatus = 'valid' | 'warning' | 'error';

export const IMPORT_MODULES: ImportModule[] = ['coa', 'ar', 'ap', 'inventory', 'asset'];

export interface ImportBatch {
  id: string;
  opening_balance_id: string;
  client_id: string;
  module: ImportModule;
  module_label: string;
  file_name: string;
  status: ImportBatchStatus;
  total_rows: number;
  valid_rows: number;
  warning_rows: number;
  error_rows: number;
  total_debit: number;
  total_credit: number;
  /** Isu yang memblok submit (baris error, total debit != kredit). Kosong = boleh submit. */
  /** Catatan untuk reviewer (baris error dilewati, debit != kredit) -- TIDAK memblokir submit/approve. */
  issues: string[];
  notes: string | null;
  created_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  submitted_at: string | null;
  submitted_by_name: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  cancelled_at: string | null;
}

export interface ImportModuleSummary {
  module: ImportModule;
  label: string;
  latest: ImportBatch | null;
  batch_count: number;
  pending_approval: number;
  /** Setup yang wajib untuk modul ini tapi belum lengkap (kosong = siap): Account Mapping,
   *  atau kategori aset tetap untuk modul asset. */
  missing_mappings: string[];
  /** Tempat melengkapinya (Settings > Account Mapping / Fixed Assets > Categories). */
  setup: { label: string; href: string };
}

export interface ImportOverview {
  modules: ImportModuleSummary[];
  batches: ImportBatch[];
}

export interface ImportRowMessage {
  level: 'error' | 'warning';
  message: string;
}

export interface ImportRow {
  id: string;
  row_no: number;
  coa_id: string | null;
  debit: number;
  credit: number;
  status: ImportRowStatus;
  messages: ImportRowMessage[];
  data: Record<string, unknown>;
  /** true = not selected by the reviewer on approval (not applied). */
  is_excluded: boolean;
}

export interface ImportBatchDetail extends ImportBatch {
  opening_balance: { id: string; fiscal_year: number; branch: string | null; as_of_date: string; status: string } | null;
  rows: ImportRow[];
  excluded_rows: number;
  /** Aksi yang boleh untuk user login (backend _izin_batch). no_review = approve langsung tanpa submit. */
  permissions: {
    can_input: boolean;
    no_review: boolean;
    can_submit: boolean;
    can_approve: boolean;
    can_reject: boolean;
    can_cancel: boolean;
  };
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: { code?: string } | null;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new OpeningBalanceError(
      json?.message || (typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`,
      json?.errors?.code,
    );
  }
  return json.data as T;
}

const kirim = (url: string, body?: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export async function fetchImportOverview(obId: string): Promise<ImportOverview> {
  return baca<ImportOverview>(await fetch(`${OB_URL}/${encodeURIComponent(obId)}/imports`, { cache: 'no-store' }));
}

export async function fetchImportBatch(batchId: string): Promise<ImportBatchDetail> {
  return baca<ImportBatchDetail>(await fetch(`${OB_URL}/imports/${encodeURIComponent(batchId)}`, { cache: 'no-store' }));
}

export async function uploadImportFile(obId: string, module: ImportModule, file: File): Promise<ImportBatch> {
  const fd = new FormData();
  fd.append('file', file);
  return baca<ImportBatch>(await fetch(`${OB_URL}/${encodeURIComponent(obId)}/imports/${module}`, { method: 'POST', body: fd }));
}

/** Download template dari server (semua modul). */
export async function downloadImportTemplate(obId: string, module: ImportModule): Promise<void> {
  const res = await fetch(`${OB_URL}/${encodeURIComponent(obId)}/imports/${module}/template`, { cache: 'no-store' });
  if (!res.ok) await baca<null>(res);
  const blob = await res.blob();
  const nama = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? `opening-${module}-template.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nama;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function submitImportBatch(batchId: string): Promise<ImportBatch> {
  return baca<ImportBatch>(await kirim(`${OB_URL}/imports/${encodeURIComponent(batchId)}/submit`));
}

/** rowIds = selected rows only; omit / null = approve all rows. */
export async function approveImportBatch(batchId: string, note?: string, rowIds?: string[] | null): Promise<ImportBatch> {
  return baca<ImportBatch>(await kirim(`${OB_URL}/imports/${encodeURIComponent(batchId)}/approve`, {
    note: note || null, row_ids: rowIds ?? null,
  }));
}

export async function rejectImportBatch(batchId: string, reason: string): Promise<ImportBatch> {
  return baca<ImportBatch>(await kirim(`${OB_URL}/imports/${encodeURIComponent(batchId)}/reject`, { reason }));
}

export async function cancelImportBatch(batchId: string): Promise<ImportBatch> {
  return baca<ImportBatch>(await kirim(`${OB_URL}/imports/${encodeURIComponent(batchId)}/cancel`));
}
