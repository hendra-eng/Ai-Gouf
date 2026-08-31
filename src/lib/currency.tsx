'use client';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type CurrencyCode = 'IDR' | 'USD' | 'SGD';

export const CURRENCIES: CurrencyCode[] = ['IDR', 'USD', 'SGD'];

// Indicative exchange rates — IDR value of 1 unit of each currency.
// Centralized here so the whole app converts consistently.
export const EXCHANGE_RATES: Record<CurrencyCode, number> = {
  IDR: 1,
  USD: 15800,
  SGD: 11700,
};

const SYMBOLS: Record<CurrencyCode, string> = {
  IDR: 'Rp',
  USD: '$',
  SGD: 'S$',
};

// Multipliers used by the Indonesian shorthand suffixes found across the app.
const SUFFIX_MULTIPLIERS: Record<string, number> = {
  t: 1e12, // triliun
  b: 1e9, // billion (miliar, alt spelling)
  m: 1e9, // miliar
  jt: 1e6, // juta
  rb: 1e3, // ribu
  k: 1e3, // thousand (dipakai formatRupiah/mockData)
};

// Matches things like "Rp 8,42M", "Rp 1.24B", "Rp 860Jt", "Rp 320M", "Rp 15.000.000", "Rp 58K"
const RP_PATTERN = /Rp\s?(\d[\d.,]*)\s?(Jt|Rb|K|M|B|T)?\b/gi;

/** Parses a single "Rp ..." shorthand string into a raw IDR number. */
export function parseRupiah(match: string): number {
  const m = match.match(/Rp\s?(\d[\d.,]*)\s?(Jt|Rb|M|B|T)?\b/i);
  if (!m) return NaN;
  const [, numStr, suffixRaw] = m;
  const normalized = parseFloat(numStr.replace(/\./g, '').replace(',', '.'));
  if (!suffixRaw) return normalized;
  const mult = SUFFIX_MULTIPLIERS[suffixRaw.toLowerCase()];
  return normalized * (mult || 1);
}

/** Formats a raw IDR amount into the target currency's display shorthand. */
export function formatMoney(rawIDR: number, currency: CurrencyCode): string {
  if (!isFinite(rawIDR)) return '';
  const value = rawIDR / EXCHANGE_RATES[currency];
  const symbol = SYMBOLS[currency];
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);

  if (currency === 'IDR') {
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
  const fx = useCallback((text: string) => convertText(text, currency), [currency]);
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
