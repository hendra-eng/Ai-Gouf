'use client';

// Saldo awal (opening balance) COA per tahun buku & cabang -- terhubung ke
// backend modules/management/opening_balance_v1.py
// (/api/v1/management/opening-balances/...). Dipakai halaman
// /coa/opening-balances (daftar, buat baru, editor).

import { useCallback, useEffect, useState } from 'react';
import type { AccountClassification, NormalBalance } from '@/lib/coaStore';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const OB_URL = `${API_BASE_URL}/api/v1/management/opening-balances`;

export type OpeningBalanceStatus = 'draft' | 'posted' | 'locked';

export interface ObAccount {
  id: string;
  acc_no: string;
  account_name: string;
  account_classification: AccountClassification;
  normal_balance: NormalBalance | null;
}

export interface OpeningBalanceSummary {
  id: string;
  client_id: string;
  fiscal_year: number;
  as_of_date: string;
  /** true = cut-off 31 Des tahun sebelumnya (hanya akun Neraca). */
  is_year_start: boolean;
  /** null = tanpa cabang. */
  branch: string | null;
  reference: string | null;
  notes: string | null;
  status: OpeningBalanceStatus;
  revision: number;
  suspense_account: ObAccount | null;
  total_debit: number;
  total_credit: number;
  /** >0 = debit lebih besar (penampung dikredit), <0 = sebaliknya. */
  difference: number;
  line_count: number;
  journal: { id: string; je_number: string; status: string } | null;
  posted_at: string | null;
  locked_at: string | null;
  created_at: string | null;
  edited_at: string | null;
}

export interface OpeningBalanceLine {
  id: string;
  coa_id: string;
  debit: number;
  credit: number;
  notes: string | null;
  account: ObAccount;
}

export interface OpeningBalanceDetail extends OpeningBalanceSummary {
  lines: OpeningBalanceLine[];
}

export interface OpeningBalanceCreateInput {
  client_id: string;
  fiscal_year: number;
  as_of_date?: string | null;
  branch?: string | null;
  suspense_coa_id?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface OpeningBalanceHeaderInput {
  as_of_date?: string;
  suspense_coa_id?: string | null;
  reference?: string | null;
  notes?: string | null;
}

export interface OpeningBalanceLineInput {
  coa_id: string;
  debit: number;
  credit: number;
  notes?: string | null;
}

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: { code?: string } | null;
}

/** Error API dengan kode (mis. SUSPENSE_REQUIRED) supaya UI bisa bereaksi spesifik. */
export class OpeningBalanceError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.code = code;
  }
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new OpeningBalanceError(
      json?.message || (typeof detail === 'string' ? detail : '') || `Request gagal (${res.status})`,
      json?.errors?.code,
    );
  }
  return json.data as T;
}

const kirim = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export async function fetchOpeningBalances(clientId: string, fiscalYear?: number): Promise<OpeningBalanceSummary[]> {
  const qs = new URLSearchParams({ client_id: clientId });
  if (fiscalYear) qs.set('fiscal_year', String(fiscalYear));
  return baca<OpeningBalanceSummary[]>(await fetch(`${OB_URL}?${qs}`, { cache: 'no-store' }));
}

export async function fetchOpeningBalance(id: string): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await fetch(`${OB_URL}/${encodeURIComponent(id)}`, { cache: 'no-store' }));
}

/** Saran nama cabang (belum ada master cabang -- diambil dari data yang sudah ada). */
export async function fetchBranchSuggestions(clientId: string): Promise<string[]> {
  return baca<string[]>(await fetch(`${OB_URL}/branches?client_id=${encodeURIComponent(clientId)}`, { cache: 'no-store' }));
}

export async function createOpeningBalance(data: OpeningBalanceCreateInput): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(OB_URL, 'POST', data));
}

export async function updateOpeningBalance(id: string, data: OpeningBalanceHeaderInput): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}`, 'PUT', data));
}

export async function saveOpeningBalanceLines(id: string, lines: OpeningBalanceLineInput[]): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}/lines`, 'PUT', { lines }));
}

export async function postOpeningBalance(id: string): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}/post`, 'POST'));
}

export async function reviseOpeningBalance(id: string, reason?: string): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}/revise`, 'POST', { reason: reason ?? null }));
}

export async function lockOpeningBalance(id: string): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}/lock`, 'POST'));
}

export async function unlockOpeningBalance(id: string): Promise<OpeningBalanceDetail> {
  return baca<OpeningBalanceDetail>(await kirim(`${OB_URL}/${encodeURIComponent(id)}/unlock`, 'POST'));
}

export async function deleteOpeningBalance(id: string): Promise<void> {
  await baca<null>(await kirim(`${OB_URL}/${encodeURIComponent(id)}`, 'DELETE'));
}

/** Daftar opening balance 1 klien (refresh otomatis saat klien berganti). */
export function useOpeningBalances(clientId: string | null) {
  const [items, setItems] = useState<OpeningBalanceSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!clientId) {
      setItems([]);
      return;
    }
    let batal = false;
    setLoading(true);
    fetchOpeningBalances(clientId)
      .then(d => { if (!batal) { setItems(d); setError(null); } })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load opening balances.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [clientId, tick]);

  return { items, loading, error, refresh };
}

const fmtIdr = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 1234567.5 -> "1.234.567,5" */
export function formatAmount(n: number): string {
  return fmtIdr.format(n || 0);
}

/** Parse input user format Indonesia ("1.234.567,50") atau polos ("1234567.50"). */
export function parseAmount(raw: string): number {
  const s = raw.trim().replace(/\s|Rp/gi, '');
  if (!s) return 0;
  // Ada koma -> format Indonesia: titik = ribuan, koma = desimal.
  // Tanpa koma: "1.000" / "1.250.000" (grup 3 digit) = ribuan; selain itu titik = desimal.
  const normal = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s;
  const n = Number(normal);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}
