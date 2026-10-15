'use client';

// Year-End Closing (tutup buku tahunan + kunci periode) -- terhubung ke
// backend modules/management/year_end_closing_v1.py
// (/api/v1/management/year-end-closing/...). Dipakai halaman
// /year-end-closing dan badge "Closed" di Financial Statements.

import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const YEC_URL = `${API_BASE_URL}/api/v1/management/year-end-closing`;

export type FiscalYearStatus = 'open' | 'closed' | 'reopened';
export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface YecAccount {
  id: string;
  acc_no: string;
  account_name: string;
  account_classification: string | null;
}

export interface YecJournal {
  id: string;
  je_number: string;
  entry_date: string;
  status: string;
  total_debit: number;
  total_credit: number;
}

export interface YecSummary {
  revenue: number;
  expenses: number;
  net_profit: number;
}

export interface FiscalClosing {
  id: string;
  fiscal_year: number;
  status: Exclude<FiscalYearStatus, 'open'>;
  revision: number;
  period_start: string;
  period_end: string;
  net_profit: number;
  summary: YecSummary | null;
  retained_earnings_account: YecAccount | null;
  journal: YecJournal | null;
  reversal_journal: YecJournal | null;
  notes: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  reopened_at: string | null;
  reopened_by_name: string | null;
  reopen_reason: string | null;
  /** Hanya untuk tahun yang tertutup: laba versi angka sekarang vs snapshot. */
  current_net_profit?: number;
  in_sync?: boolean;
}

export interface FiscalYearRow {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  status: FiscalYearStatus;
  has_ended: boolean;
  net_profit: number;
  closing: FiscalClosing | null;
}

export interface YecOverview {
  lock_date: string | null;
  books_start: string | null;
  default_retained_earnings_account: YecAccount | null;
  years: FiscalYearRow[];
}

export interface YecCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  items?: Record<string, unknown>[];
  counts?: Record<string, number>;
}

export interface YecJournalLine {
  account_code: string;
  account_name: string;
  description: string;
  debit: number;
  credit: number;
}

export interface YecPreview {
  fiscal_year: number;
  period_start: string;
  period_end: string;
  summary: YecSummary;
  retained_earnings_account: YecAccount | null;
  retained_earnings_options: YecAccount[];
  checks: YecCheck[];
  can_close: boolean;
  journal_preview: { je_number: string; date: string; lines: YecJournalLine[]; total_debit: number; total_credit: number };
  balance_sheet: { assets: number; liabilities: number; equity: number };
}

export interface YecHistoryRow {
  id: string;
  fiscal_year: number;
  action: 'close' | 'reopen';
  net_profit: number | null;
  reason: string | null;
  journal: YecJournal | null;
  performed_by_name: string | null;
  performed_at: string;
}

export interface YecLockStatus {
  lock_date: string | null;
  closed_years: { fiscal_year: number; period_end: string; closed_at: string | null; closed_by_name: string | null }[];
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: { code?: string; detail?: unknown } | null;
}

export class YecError extends Error {
  code?: string;
  detail?: unknown;
  constructor(message: string, code?: string, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}

async function baca<T>(res: Response): Promise<{ data: T; message: string }> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new YecError(
      json?.message || (typeof detail === 'string' ? detail : '') || `Request failed (${res.status})`,
      json?.errors?.code,
      json?.errors?.detail,
    );
  }
  return { data: json.data as T, message: json.message };
}

const kirim = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchYecOverview(clientId: string): Promise<YecOverview> {
  return (await baca<YecOverview>(await fetch(`${YEC_URL}?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }))).data;
}

export async function fetchYecPreview(clientId: string, fiscalYear: number, retainedEarningsCoaId?: string | null): Promise<YecPreview> {
  const qs = new URLSearchParams({ client_id: clientId, fiscal_year: String(fiscalYear) });
  if (retainedEarningsCoaId) qs.set('retained_earnings_coa_id', retainedEarningsCoaId);
  return (await baca<YecPreview>(await fetch(`${YEC_URL}/preview?${qs}`, { cache: 'no-store' }))).data;
}

export async function fetchYecHistory(clientId: string): Promise<YecHistoryRow[]> {
  return (await baca<YecHistoryRow[]>(await fetch(`${YEC_URL}/history?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }))).data;
}

export async function fetchYecLockStatus(clientId: string, signal?: AbortSignal): Promise<YecLockStatus> {
  return (await baca<YecLockStatus>(await fetch(`${YEC_URL}/status?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store', signal }))).data;
}

export async function closeFiscalYear(input: {
  client_id: string; fiscal_year: number; retained_earnings_coa_id?: string | null; notes?: string | null;
}): Promise<{ data: FiscalClosing; message: string }> {
  return baca<FiscalClosing>(await kirim(`${YEC_URL}/close`, input));
}

export async function reopenFiscalYear(input: { client_id: string; fiscal_year: number; reason: string }): Promise<{ data: FiscalClosing; message: string }> {
  return baca<FiscalClosing>(await kirim(`${YEC_URL}/reopen`, input));
}

// ---- Workspace (semua klien) & detail tahun tertutup ----

export interface WorkspaceYear {
  client_id: string;
  client_name: string;
  client_code: string | null;
  fiscal_year: number;
  period_start: string;
  period_end: string;
  status: FiscalYearStatus;
  has_ended: boolean;
  ever_reopened: boolean;
  can_reopen: boolean;
  net_profit: number | null;
  journal_number: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
  reopened_at: string | null;
  reopened_by_name: string | null;
  reopen_reason: string | null;
}

export interface YecWorkspace {
  kpi: { open: number; closed: number; reopened: number; pending_checks: number };
  years: WorkspaceYear[];
}

export interface YecAuditStep {
  step: 'precheck' | 'close' | 'posted' | 'reopen' | 'reversed';
  title: string;
  at: string;
  by: string | null;
  detail: string | null;
}

export interface YecDetail extends FiscalClosing {
  client_id: string;
  client_name: string;
  snapshot: {
    balance_sheet: { assets: number; liabilities: number; equity: number } | null;
    summary: YecSummary | null;
    checks: { id: string; label?: string; status: CheckStatus; detail: string }[];
    checked_at: string | null;
  };
  audit_trail: YecAuditStep[];
}

export async function fetchYecWorkspace(): Promise<YecWorkspace> {
  return (await baca<YecWorkspace>(await fetch(`${YEC_URL}/workspace`, { cache: 'no-store' }))).data;
}

export async function fetchYecDetail(clientId: string, fiscalYear: number): Promise<YecDetail> {
  const qs = new URLSearchParams({ client_id: clientId, fiscal_year: String(fiscalYear) });
  return (await baca<YecDetail>(await fetch(`${YEC_URL}/detail?${qs}`, { cache: 'no-store' }))).data;
}

/** KPI + daftar tahun buku semua klien. */
export function useYecWorkspace() {
  const [data, setData] = useState<YecWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let batal = false;
    setLoading(true);
    fetchYecWorkspace()
      .then(d => { if (!batal) { setData(d); setError(null); } })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load fiscal years.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [tick]);

  return { data, loading, error, refresh };
}

/** Ringkasan tahun buku + riwayat 1 klien (refresh otomatis saat klien berganti). */
export function useYearEndClosing(clientId: string | null) {
  const [overview, setOverview] = useState<YecOverview | null>(null);
  const [history, setHistory] = useState<YecHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!clientId) {
      setOverview(null);
      setHistory([]);
      return;
    }
    let batal = false;
    setLoading(true);
    Promise.all([fetchYecOverview(clientId), fetchYecHistory(clientId)])
      .then(([o, h]) => { if (!batal) { setOverview(o); setHistory(h); setError(null); } })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load fiscal years.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [clientId, tick]);

  return { overview, history, loading, error, refresh };
}

/** Tanggal kunci periode klien (null = belum ada tahun yang ditutup). */
export function useLockStatus(clientId: string | null) {
  const [status, setStatus] = useState<YecLockStatus | null>(null);
  useEffect(() => {
    setStatus(null);
    if (!clientId) return;
    const ac = new AbortController();
    fetchYecLockStatus(clientId, ac.signal).then(setStatus).catch(() => { /* badge opsional */ });
    return () => ac.abort();
  }, [clientId]);
  return status;
}

const fmtIdr = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export function formatAmount(n: number | null | undefined): string {
  const v = n || 0;
  return v < 0 ? `(${fmtIdr.format(-v)})` : fmtIdr.format(v);
}

const fmtTanggal = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const fmtWaktu = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** "2025-12-31" -> "31 Dec 2025" */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return fmtTanggal.format(new Date(y, m - 1, d));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : fmtWaktu.format(d);
}
