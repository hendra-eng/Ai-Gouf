'use client';

// Pilihan mata uang + kolom kurs untuk form dokumen valas (Invoice, Bill, Receipt, Payment).
// Kurs diisi otomatis dari master (Management > Exchange Rates, tipe 'middle', carry-forward
// bila tanggal kosong) saat mata uang / tanggal berubah, dan tetap bisa diubah manual.
// Saat membuka dokumen tersimpan (preserveInitial) kurs tersimpan TIDAK ditimpa.

import React, { useEffect, useRef, useState } from 'react';
import { CURRENCIES } from '@/lib/currency';
import { fmtRate, lookupRate, parseAngkaKurs, type RateLookup } from '@/lib/exchangeRateStore';
import { fmtDate } from '@/lib/receivablesPayablesStore';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';

const NAMA_MATA_UANG: Record<string, string> = {
  IDR: 'IDR - Indonesian Rupiah', USD: 'USD - US Dollar', SGD: 'SGD - Singapore Dollar',
};

type InfoKurs = { state: 'loading' | 'found' | 'missing' | 'error'; rate?: NonNullable<RateLookup['rate']> } | null;

/** Ambil kurs master untuk (mata uang, tanggal) dan panggil onRate bila boleh menimpa. */
export function useMasterRate(opts: {
  currency: string; date: string; enabled: boolean; preserveInitial?: boolean; onRate: (rate: number) => void;
}): InfoKurs {
  const { currency, date, enabled, preserveInitial, onRate } = opts;
  const [info, setInfo] = useState<InfoKurs>(null);
  const sudahMuat = useRef(false);
  const onRateRef = useRef(onRate);
  onRateRef.current = onRate;
  useEffect(() => {
    if (!enabled || currency === 'IDR' || !date) { setInfo(null); return; }
    const terapkan = !(preserveInitial && !sudahMuat.current);
    sudahMuat.current = true;
    const ctrl = new AbortController();
    setInfo({ state: 'loading' });
    lookupRate(currency, date, 'middle', ctrl.signal)
      .then(r => {
        if (!r.found || !r.rate) { setInfo({ state: 'missing' }); return; }
        setInfo({ state: 'found', rate: r.rate });
        if (terapkan) onRateRef.current(r.rate.rate);
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') setInfo({ state: 'error' }); });
    return () => ctrl.abort();
  }, [enabled, currency, date, preserveInitial]);
  return info;
}

export function InfoKursTeks({ info }: { info: InfoKurs }) {
  if (!info) return null;
  if (info.state === 'loading') return <p className="mt-1 text-[11px] text-muted-foreground">Looking up the master rate...</p>;
  if (info.state === 'missing') return <p className="mt-1 text-[11px] text-amber-700">No master rate on file — enter the rate manually.</p>;
  if (info.state === 'error') return <p className="mt-1 text-[11px] text-amber-700">Could not load the master rate — enter it manually.</p>;
  const r = info.rate!;
  return (
    <p className={`mt-1 text-[11px] ${r.days_old > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>
      Master rate {fmtRate(r.rate)} ({fmtDate(r.rate_date)}{r.days_old > 0 ? `, ${r.days_old} day${r.days_old === 1 ? '' : 's'} old` : ''})
    </p>
  );
}

/** Input kurs (IDR per 1 unit mata uang asing). `value` 0 = kosong. */
export function RateInput({ value, onChange, disabled, currency, className = '' }: {
  value: number; onChange: (n: number) => void; disabled?: boolean; currency: string; className?: string;
}) {
  const [teks, setTeks] = useState(value ? fmtRate(value) : '');
  const fokus = useRef(false);
  useEffect(() => { if (!fokus.current) setTeks(value ? fmtRate(value) : ''); }, [value]);
  return (
    <div className={`flex items-center rounded-xl border px-3 ${disabled ? 'border-border bg-slate-50 text-muted-foreground' : 'border-border bg-card focus-within:border-[#22C55E] focus-within:ring-2 focus-within:ring-[#22C55E]/20'} ${className}`}>
      <span className="whitespace-nowrap text-xs text-muted-foreground">1 {currency} = Rp</span>
      <input
        value={teks} disabled={disabled} inputMode="decimal" placeholder="0"
        onFocus={() => { fokus.current = true; }}
        onBlur={() => { fokus.current = false; setTeks(value ? fmtRate(value) : ''); }}
        onChange={e => {
          setTeks(e.target.value);
          const n = parseAngkaKurs(e.target.value);
          onChange(Number.isFinite(n) && n > 0 ? n : 0);
        }}
        className="w-full bg-transparent px-1.5 py-2.5 text-right text-sm focus:outline-none"
      />
    </div>
  );
}

export function CurrencySelect({ value, onChange, disabled }: { value: string; onChange: (c: string) => void; disabled?: boolean }) {
  const daftar = CURRENCIES.includes(value as never) ? CURRENCIES : [...CURRENCIES, value as never];
  return (
    <FilterSelect
      variant="elegant" block tall
      ariaLabel="Currency"
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={daftar.map(c => ({ value: c, label: NAMA_MATA_UANG[c] ?? c }))}
    />
  );
}
