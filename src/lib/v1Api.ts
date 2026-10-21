'use client';

// Helper fetch untuk endpoint backend berformat amplop
// {status, message, data, errors} (modules/api_response.py). Dipakai store
// Fixed Assets, Inventory, dan Tax Compliance: `createV1Api(base, event)`
// memberi get/send, dan setiap aksi tulis memancarkan `event` supaya hook
// `useV1Data` di halaman yang sama memuat ulang datanya.

import { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || '';

export class ApiError extends Error {
  constructor(message: string, public code?: string, public detail?: unknown) {
    super(message);
  }
}

export type Params = Record<string, string | number | boolean | null | undefined>;

export function qs(params: Params = {}): string {
  const e = Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '');
  return e.length ? '?' + e.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&') : '';
}

async function baca<T>(res: Response): Promise<{ data: T; message: string }> {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.status !== 'success') {
    const detail = json?.detail;
    const pesanDetail = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d: { msg?: string }) => d?.msg).filter(Boolean).join('; ') : '';
    throw new ApiError(json?.message || pesanDetail || `Request failed (${res.status})`, json?.errors?.code, json?.errors?.detail);
  }
  return { data: json.data as T, message: json.message };
}

export function createV1Api(base: string, event: string) {
  const url = (path: string, params?: Params) => `${API_BASE_URL}${base}${path}${qs(params)}`;
  return {
    event,
    get: async <T,>(path: string, params: Params = {}, signal?: AbortSignal) =>
      (await baca<T>(await fetch(url(path, params), { cache: 'no-store', signal }))).data,
    send: async <T,>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, params: Params = {}, notify = true) => {
      const res = await fetch(url(path, params), {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const hasil = await baca<T>(res);
      if (notify && typeof window !== 'undefined') window.dispatchEvent(new Event(event));
      return hasil;
    },
  };
}

/** Muat `fn` saat `key` berubah, dan muat ulang saat event modul dipancarkan. */
export function useV1Data<T>(event: string, key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) {
  const [data, setData] = useState<T>(awal);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [versi, setVersi] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const awalRef = useRef(awal);
  const refresh = useCallback(() => setVersi(v => v + 1), []);

  useEffect(() => {
    window.addEventListener(event, refresh);
    return () => window.removeEventListener(event, refresh);
  }, [event, refresh]);

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
