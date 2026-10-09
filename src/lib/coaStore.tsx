'use client';

// Master Chart of Accounts per klien -- terhubung ke backend
// modules/management/coa_v1.py (/api/v1/management/coa/...), tabel
// management_client_coa. client_id = management_clients.id (UUID), sama
// dengan activeClientId dari src/lib/activeClient.tsx.
//
// Dipakai halaman Management > Chart of Accounts (/coa) dan autocomplete
// Account Name di New Journal Entry.
//
// Akun "unassigned" = client_id null: dibuat tanpa klien, lalu kelak
// dihubungkan ke klien aktif lewat assignCoaAccounts() (baris yang sama
// diisi client_id-nya, akun keluar dari daftar unassigned).

import { useCallback, useEffect, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';
const COA_URL = `${API_BASE_URL}/api/v1/management/coa`;
const COA_CHANGED_EVENT = 'gouf-coa-changed';

export const ACCOUNT_CLASSIFICATIONS = [
  'ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'COST OF SALES',
  'EXPENSE', 'OTHER INCOME', 'OTHER EXPENSE', 'INCOME TAX',
] as const;
export type AccountClassification = (typeof ACCOUNT_CLASSIFICATIONS)[number];
export type NormalBalance = 'DEBIT' | 'CREDIT';

export interface CoaAccount {
  id: string;
  /** null = akun unassigned (belum terhubung ke klien mana pun). */
  client_id: string | null;
  client_code: string | null;
  acc_no: string;
  account_name: string;
  account_classification: AccountClassification;
  account_head: string | null;
  account_sub: string | null;
  normal_balance: NormalBalance | null;
  description: string | null;
  international_standard_group: string | null;
  standard_account_code: string | null;
  ifrs_taxonomy_reference: string | null;
  ifrs_source: string | null;
  is_active: boolean;
  created_at: string | null;
  edited_at: string | null;
}

/** Field yang bisa dikirim saat tambah/ubah akun. */
export type CoaAccountInput = Partial<Omit<CoaAccount, 'id' | 'client_id' | 'client_code' | 'created_at' | 'edited_at'>>;

interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T | null;
  errors: unknown;
}

async function baca<T>(res: Response): Promise<T> {
  const json = (await res.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!res.ok || !json || json.status !== 'success') {
    const detail = (json as { detail?: unknown } | null)?.detail;
    throw new Error(json?.message || (typeof detail === 'string' ? detail : '') || `Request gagal (${res.status})`);
  }
  return json.data as T;
}

function notifyCoaChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COA_CHANGED_EVENT));
}

interface CoaQuery { search?: string; classification?: string; activeOnly?: boolean; limit?: number }

function queryString(params: CoaQuery): string {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.classification) qs.set('classification', params.classification);
  if (params.activeOnly) qs.set('active_only', 'true');
  if (params.limit) qs.set('limit', String(params.limit));
  return qs.toString() ? `?${qs}` : '';
}

export async function fetchClientCoa(clientId: string, params: CoaQuery = {}): Promise<CoaAccount[]> {
  const url = `${COA_URL}/client/${encodeURIComponent(clientId)}${queryString(params)}`;
  return baca<CoaAccount[]>(await fetch(url, { cache: 'no-store' }));
}

/** Akun yang belum terhubung ke klien mana pun. */
export async function fetchUnassignedCoa(params: CoaQuery = {}): Promise<CoaAccount[]> {
  return baca<CoaAccount[]>(await fetch(`${COA_URL}/unassigned${queryString(params)}`, { cache: 'no-store' }));
}

export interface CoaBalance {
  acc_no: string;
  debit: number;
  credit: number;
  /** debit - kredit (bertanda). Lihat balanceOnNormalSide() untuk tampilan. */
  balance: number;
}

/** Saldo per akun dari SEMUA jurnal POSTED klien (sumber sama dengan Financial Statements). */
export async function fetchCoaBalances(clientId: string, asOf?: string): Promise<CoaBalance[]> {
  const qs = asOf ? `?as_of=${encodeURIComponent(asOf)}` : '';
  return baca<CoaBalance[]>(await fetch(`${COA_URL}/client/${encodeURIComponent(clientId)}/balances${qs}`, { cache: 'no-store' }));
}

/** Saldo dilihat dari sisi saldo normal akun: positif = wajar, negatif = abnormal. */
export function balanceOnNormalSide(balance: number, normal: NormalBalance | null): number {
  return normal === 'CREDIT' ? -balance : balance;
}

/** Peta acc_no -> saldo untuk 1 klien. Refresh saat klien berganti / refresh() dipanggil. */
export function useCoaBalances(clientId: string | null) {
  const [balances, setBalances] = useState<Record<string, CoaBalance>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!clientId) {
      setBalances({});
      return;
    }
    let batal = false;
    setLoading(true);
    fetchCoaBalances(clientId)
      .then(rows => {
        if (batal) return;
        setBalances(Object.fromEntries(rows.map(r => [r.acc_no, r])));
        setError(null);
      })
      .catch(e => { if (!batal) setError(e instanceof Error ? e.message : 'Failed to load balances.'); })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [clientId, tick]);

  return { balances, loading, error, refresh };
}

/** Detail 1 akun (dipakai halaman edit /coa/[id]/edit). */
export async function fetchCoaAccount(id: string): Promise<CoaAccount> {
  return baca<CoaAccount>(await fetch(`${COA_URL}/${encodeURIComponent(id)}`, { cache: 'no-store' }));
}

export interface CoaAssignResult {
  assigned: CoaAccount[];
  skipped: { id: string; acc_no: string | null; account_name: string | null; reason: string }[];
}

/** Hubungkan akun unassigned ke 1 klien. Akun yang bentrok ACC NO dsb.
 *  dilewati (lihat `skipped`), sisanya tetap di-assign. */
export async function assignCoaAccounts(clientId: string, coaIds: string[]): Promise<CoaAssignResult & { message: string }> {
  const res = await fetch(`${COA_URL}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, coa_ids: coaIds }),
  });
  const json = (await res.clone().json().catch(() => null)) as ApiEnvelope<CoaAssignResult> | null;
  const hasil = await baca<CoaAssignResult>(res);
  notifyCoaChanged();
  return { ...hasil, message: json?.message ?? '' };
}

/** clientId null = buat akun unassigned. */
export async function createCoaAccount(clientId: string | null, data: CoaAccountInput): Promise<CoaAccount> {
  const res = await fetch(COA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, client_id: clientId }),
  });
  const hasil = await baca<CoaAccount>(res);
  notifyCoaChanged();
  return hasil;
}

export async function updateCoaAccount(id: string, data: CoaAccountInput): Promise<CoaAccount> {
  const res = await fetch(`${COA_URL}/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const hasil = await baca<CoaAccount>(res);
  notifyCoaChanged();
  return hasil;
}

export async function deleteCoaAccount(id: string): Promise<void> {
  await baca<null>(await fetch(`${COA_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  notifyCoaChanged();
}

/** Seluruh COA 1 klien (sekali fetch; filter/search dilakukan di client).
 *  Otomatis refresh saat klien berganti atau ada akun ditambah/diubah/dihapus. */
export function useClientCoa(clientId: string | null, options: { activeOnly?: boolean } = {}) {
  return useCoaList(clientId ? `client:${clientId}` : null, options.activeOnly ?? false);
}

/** Seluruh akun unassigned (client_id null). `enabled` false = tidak fetch. */
export function useUnassignedCoa(enabled = true) {
  return useCoaList(enabled ? 'unassigned' : null, false);
}

function useCoaList(sumber: string | null, activeOnly: boolean) {
  const [accounts, setAccounts] = useState<CoaAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!sumber) {
      setAccounts([]);
      setError(null);
      return;
    }
    let batal = false;
    setLoading(true);
    setError(null);
    const permintaan = sumber === 'unassigned'
      ? fetchUnassignedCoa({ activeOnly })
      : fetchClientCoa(sumber.slice('client:'.length), { activeOnly });
    permintaan
      .then(data => { if (!batal) setAccounts(data); })
      .catch(err => {
        if (batal) return;
        setAccounts([]);
        setError(err instanceof Error ? err.message : 'Failed to load chart of accounts');
      })
      .finally(() => { if (!batal) setLoading(false); });
    return () => { batal = true; };
  }, [sumber, activeOnly, tick]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener(COA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(COA_CHANGED_EVENT, refresh);
  }, [refresh]);

  return { accounts, loading, error, refresh };
}
