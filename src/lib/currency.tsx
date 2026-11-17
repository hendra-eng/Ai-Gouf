'use client';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { EXCHANGE_RATE_EVENT, fetchLatestRates } from '@/lib/exchangeRateStore';

export type CurrencyCode = 'IDR' | 'USD' | 'SGD';

export const CURRENCIES: CurrencyCode[] = ['IDR', 'USD', 'SGD'];

// IDR value of 1 unit of each currency, used ONLY to display amounts in the selected
// currency. The values below are fallbacks; CurrencyProvider replaces them with the latest
// 'middle' rates from the Exchange Rates master (Management > Exchange Rates) once loaded.
// Journals never use these -- transactions store their own exchange_rate.
export const EXCHANGE_RATES: Record<CurrencyCode, number> = {
  IDR: 1,
  USD: 15800,
  SGD: 11700,
};

/** Overwrite the fallback rates with the master's latest rates. Returns true if anything changed. */
function applyLatestRates(rows: { currency: string; rate: number }[]): boolean {
  let berubah = false;
  for (const r of rows) {
    const kode = r.currency as CurrencyCode;
    if (kode !== 'IDR' && CURRENCIES.includes(kode) && r.rate > 0 && EXCHANGE_RATES[kode] !== r.rate) {
      EXCHANGE_RATES[kode] = r.rate;
      berubah = true;
    }
  }
  return berubah;
}

const SYMBOLS: Record<CurrencyCode, string> = {
  IDR: 'Rp',
  USD: '$',
  SGD: 'S$',
};

// Multipliers used by the Indonesian shorthand suffixes found across the app.
// Canonical IDR structure: T (Triliun) > M (Milyar) > Jt (Juta) > Rb (Ribu).
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  t: 1e12, // triliun
  b: 1e9, // milyar (alt spelling "B", still accepted when parsing legacy text)
  m: 1e9, // milyar
  jt: 1e6, // juta
  rb: 1e3, // ribu
  k: 1e3, // ribu (alt spelling "K", still accepted when parsing legacy text)
};

// Matches things like "Rp 8,42M", "Rp 1,24T", "Rp 860Jt", "Rp 320Rb", "Rp 15.000.000", "Rp 58Rb"
const RP_PATTERN = /Rp\s?(\d[\d.,]*)\s?(Jt|Rb|K|M|B|T)?\b/gi;

/** Parses a single "Rp ..." shorthand string into a raw IDR number. */
export function parseRupiah(match: string): number {
  const m = match.match(/Rp\s?(\d[\d.,]*)\s?(Jt|Rb|K|M|B|T)?\b/i);
  if (!m) return NaN;
  const [, numStr, suffixRaw] = m;
  const normalized = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
  if (!suffixRaw) return normalized;
  const mult = SUFFIX_MULTIPLIERS[suffixRaw.toLowerCase()];
  return normalized * (mult || 1);
}

/** Nominal LENGKAP (tanpa singkatan Jt/Rb/M), mis. Rp 444.050,00. Untuk saldo kas & bank. */
export function formatMoneyFull(rawIDR: number, currency: CurrencyCode): string {
  if (!isFinite(rawIDR)) return '';
  const value = rawIDR / EXCHANGE_RATES[currency];
  const locale = currency === 'IDR' ? 'id-ID' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Formats a raw IDR amount into the target currency's display shorthand. */
export function formatMoney(rawIDR: number, currency: CurrencyCode): string {
  if (!isFinite(rawIDR)) return '';
  const value = rawIDR / EXCHANGE_RATES[currency];
  const symbol = SYMBOLS[currency];
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (currency === 'IDR') {
    // T = Triliun, M = Milyar, Jt = Juta, Rb = Ribu
    if (abs >= 1e12) return `${sign}${symbol} ${(abs / 1e12).toFixed(2).replace('.', ',')}T`;
    if (abs >= 1e9) return `${sign}${symbol} ${(abs / 1e9).toFixed(2).replace('.', ',')}M`;
    if (abs >= 1e6) return `${sign}${symbol} ${Math.round(abs / 1e6)}Jt`;
    if (abs >= 1e3) return `${sign}${symbol} ${Math.round(abs / 1e3)}Rb`;
    return `${sign}${symbol} ${Math.round(abs)}`;
  }

  // USD / SGD — western compact notation
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${symbol}${abs.toFixed(0)}`;
}

/**
 * Converts every "Rp ..." shorthand occurrence found inside a string to the
 * target currency, leaving surrounding text untouched. Safe to call on plain
 * text that has no currency mentions at all (returns it unchanged).
 */
export function convertText(text: string, currency: CurrencyCode): string {
  if (!text || currency === 'IDR') return text;
  return text.replace(RP_PATTERN, (match) => {
    const raw = parseRupiah(match);
    if (isNaN(raw)) return match;
    return formatMoney(raw, currency);
  });
}

interface CurrencyContextValue {
  currency: CurrencyCode;
  setCurrency: (c: CurrencyCode) => void;
  /** Converts any "Rp ..." mentions in a string to the currently selected currency. */
  fx: (text: string) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | undefined>(undefined);

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<CurrencyCode>('IDR');
  const [rateVersion, setRateVersion] = useState(0);

  // Load the latest master rates on mount, when the rates change, and when the tab becomes
  // visible again. A failure (not logged in yet, backend down) keeps the fallback rates.
  useEffect(() => {
    let aktif = true;
    const muat = () => {
      fetchLatestRates('middle')
        .then(rows => { if (aktif && applyLatestRates(rows)) setRateVersion(v => v + 1); })
        .catch(() => { /* keep fallback rates */ });
    };
    const saatTampil = () => { if (document.visibilityState === 'visible') muat(); };
    muat();
    window.addEventListener(EXCHANGE_RATE_EVENT, muat);
    document.addEventListener('visibilitychange', saatTampil);
    return () => {
      aktif = false;
      window.removeEventListener(EXCHANGE_RATE_EVENT, muat);
      document.removeEventListener('visibilitychange', saatTampil);
    };
  }, []);

  // rateVersion makes consumers re-render (and fx() re-run) after the rates are replaced.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fx = useCallback((text: string) => convertText(text, currency), [currency, rateVersion]);
  const value = useMemo(() => ({ currency, setCurrency, fx }), [currency, fx]);
  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): CurrencyContextValue {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return ctx;
}