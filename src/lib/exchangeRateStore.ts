'use client';

// Master kurs (Management > Exchange Rates) -- terhubung ke backend
// modules/management/exchange_rates_v1.py (/api/v1/management/exchange-rates/...).
// Kurs GLOBAL (bukan per klien): IDR per 1 unit mata uang asing pada satu tanggal.
// Dipakai halaman /exchange-rates, form Other Transactions (isi kurs otomatis),
// dan tampilan konversi mata uang di currency.tsx.

import { createV1Api, useV1Data } from '@/lib/v1Api';

export const EXCHANGE_RATE_EVENT = 'gouf-exchange-rate-changed';
const api = createV1Api('/api/v1/management/exchange-rates', EXCHANGE_RATE_EVENT);

export const useExchangeRateData = <T,>(key: string | null, fn: (signal: AbortSignal) => Promise<T>, awal: T) =>
  useV1Data(EXCHANGE_RATE_EVENT, key, fn, awal);

export type RateType = 'middle' | 'buy' | 'sell' | 'tax';
export type RateSource = 'manual' | 'auto';

export interface ExchangeRate {
  id: string; currency: string; rate_date: string; rate_type: RateType; rate: number;
  source: RateSource; source_name: string | null; notes: string | null;
  created_at: string | null; created_by_name: string | null; edited_at: string | null; edited_by_name: string | null;
}
export interface RateList { total: number; items: ExchangeRate[] }
export interface LatestRate {
  currency: string; rate_type: RateType; rate: number; rate_date: string; source: RateSource; source_name: string | null;
  days_old: number; previous_rate: number | null; previous_date: string | null; change: number | null; change_pct: number | null;
}
export interface RateMeta {
  base_currency: string; currencies: { code: string; name: string }[]; rate_types: { key: RateType; label: string }[];
  provider: { name: string; note: string }; auto_fetch_enabled: boolean; can_write_level: number;
}
export interface RateLookup {
  found: boolean;
  rate: { currency: string; rate_type: RateType; rate: number; rate_date: string; requested_date: string; exact: boolean; days_old: number; source: RateSource; source_name: string | null } | null;
}
export interface RateInput { currency: string; rate_date: string; rate_type: RateType; rate: number; source_name?: string | null; notes?: string | null }
export interface BulkResult { created: number; updated: number; failed: number; errors: { row: number; currency: string; rate_date: string; error: string }[] }
export interface FetchResult {
  provider: string; saved: number; failed: number;
  results: { currency: string; ok: boolean; rate_date?: string; rate?: number; created?: boolean; error?: string }[];
}
export interface RateFilter { currency?: string; rate_type?: RateType | ''; source?: RateSource | ''; date_from?: string; date_to?: string; limit?: number; offset?: number }

export const fetchRateMeta = (s?: AbortSignal) => api.get<RateMeta>('/meta', {}, s);
export const fetchRates = (f: RateFilter, s?: AbortSignal) => api.get<RateList>('', { ...f }, s);
export const fetchLatestRates = (rateType: RateType = 'middle', s?: AbortSignal) => api.get<LatestRate[]>('/latest', { rate_type: rateType }, s);
export const lookupRate = (currency: string, date: string, rateType: RateType = 'middle', s?: AbortSignal) =>
  api.get<RateLookup>('/lookup', { currency, date, rate_type: rateType }, s);
export const saveRate = (body: RateInput, id?: string | null) =>
  api.send<ExchangeRate>(id ? 'PUT' : 'POST', id ? `/${id}` : '', body);
export const saveRatesBulk = (rows: RateInput[]) => api.send<BulkResult>('POST', '/bulk', { rows });
export const deleteRate = (id: string) => api.send<{ id: string }>('DELETE', `/${id}`);
export const fetchRatesAuto = (currencies: string[], rateDate?: string | null) =>
  api.send<FetchResult>('POST', '/fetch', { currencies, rate_date: rateDate || null });

/** Format kurs: 2-6 desimal tanpa nol berlebih, pemisah ribuan lokal Indonesia. */
export const fmtRate = (n: number | null | undefined): string =>
  n == null ? '-' : new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(n);

/** Angka kurs dari teks: "16000", "16,000.50" (US) atau "16.000,50" (ID). */
export function parseAngkaKurs(t: string): number {
  const x = t.trim();
  if (!/^[\d.,]+$/.test(x)) return NaN;
  const titik = x.lastIndexOf('.'), koma = x.lastIndexOf(',');
  if (titik >= 0 && koma >= 0) return Number(titik > koma ? x.replace(/,/g, '') : x.replace(/\./g, '').replace(',', '.'));
  if (koma >= 0) return Number(/^\d{1,3}(,\d{3})+$/.test(x) ? x.replace(/,/g, '') : x.replace(',', '.'));
  if (titik >= 0) return Number(/^\d{1,3}(\.\d{3})+$/.test(x) ? x.replace(/\./g, '') : x);
  return Number(x);
}

/** Tempel dari spreadsheet: baris "USD <tab> 2026-11-12 <tab> 16000 [<tab> middle|buy|sell|tax]" (pemisah tab / spasi / koma / titik koma). */
export function parsePasteRates(teks: string, defaultType: RateType): { rows: RateInput[]; bad: string[] } {
  const rows: RateInput[] = [];
  const bad: string[] = [];
  const POLA = /^([A-Za-z]{3})[\s,;]+(\d{4}-\d{2}-\d{2})[\s;]+([\d.,]+)(?:[\s,;]+(middle|buy|sell|tax))?$/i;
  teks.split(/\r?\n/).map(l => l.trim()).filter(Boolean).forEach((line, i) => {
    const m = line.match(POLA);
    const kurs = m ? parseAngkaKurs(m[3]) : NaN;
    if (!m || !Number.isFinite(kurs) || kurs <= 0) { bad.push(`Line ${i + 1}: ${line}`); return; }
    rows.push({ currency: m[1].toUpperCase(), rate_date: m[2], rate: kurs, rate_type: (m[4]?.toLowerCase() as RateType) || defaultType });
  });
  return { rows, bad };
}
