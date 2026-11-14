'use client';

// Rentang tanggal bersama untuk halaman Purchase (header PurchaseTabs <-> halaman tab).
// State disimpan di level modul + event, jadi header dan tabel selalu sinkron.
import { useEffect, useState } from 'react';

export interface PurchaseDateRange { from: string; to: string } // format YYYY-MM-DD

const EVENT = 'gouf-purchase-date-range-changed';

export function defaultPurchaseDateRange(): PurchaseDateRange {
  const y = new Date().getFullYear();
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

let current: PurchaseDateRange = defaultPurchaseDateRange();

export function setPurchaseDateRange(r: PurchaseDateRange) {
  current = r;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EVENT));
}

export function usePurchaseDateRange(): [PurchaseDateRange, (r: PurchaseDateRange) => void] {
  const [range, setRange] = useState<PurchaseDateRange>(current);
  useEffect(() => {
    const sync = () => setRange(current);
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [range, setPurchaseDateRange];
}

/** Tanggal 'YYYY-MM-DD' (atau diawali itu) berada dalam rentang, inklusif. */
export function inPurchaseDateRange(date: string | null | undefined, r: PurchaseDateRange): boolean {
  const d = (date || '').slice(0, 10);
  if (!d) return true; // tanpa tanggal: jangan disembunyikan diam-diam
  if (r.from && d < r.from) return false;
  if (r.to && d > r.to) return false;
  return true;
}

export function formatRangeLabel(r: PurchaseDateRange): string {
  const f = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    if (!y || !m || !d) return s;
    return `${String(d).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1]} ${y}`;
  };
  return `${f(r.from)} – ${f(r.to)}`;
}
