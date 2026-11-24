'use client';

// UI primitif Inventory -- disamakan dengan halaman Purchase / Sales (tema monokrom "elegant"):
// tombol (btnPrimary/btnOutline/btnSmall), kolom cari, pemilih periode tanggal, dan dropdown filter
// (FilterSelect Purchase). Semua tab & drawer Inventory memakai file ini, jadi ubah di sini saja.

import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Search } from 'lucide-react';
import FilterSelect, { type FilterOption } from '@/app/transactions/purchase/components/FilterSelect';
import { formatTanggalSingkat } from '@/lib/salesStore';

// --- Tombol (sama dengan BTN_SECONDARY / BTN_PRIMARY / PRINT_BTN di Purchase Transaction) ---
const BTN_BASE = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary = `${BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
export const btnOutline = `${BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
export const btnSmall = btnOutline;
// Versi ringkas untuk baris yang padat (mis. header Stock Movement): padding & teks lebih kecil.
export const btnPrimarySm = `${btnPrimary} !px-2.5 !py-1 !text-[11px]`;
export const btnOutlineSm = `${btnOutline} !px-2.5 !py-1 !text-[11px]`;

// --- Input teks / select native di dalam drawer & form (fokus abu-hitam seperti Purchase) ---
export const inputCls = 'w-full rounded-lg border border-neutral-300 bg-card px-3 py-2 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300 disabled:bg-neutral-50';

// --- Kolom cari (sama dengan search di Purchase Transaction List) ---
export function InvSearch({ value, onChange, placeholder, className = 'w-full sm:w-[400px]' }: {
  value: string; onChange: (v: string) => void; placeholder: string; className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-neutral-300 bg-card py-1.5 pl-9 pr-3 text-xs text-neutral-900 placeholder:text-neutral-400 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300"
      />
    </div>
  );
}

// --- Dropdown filter: FilterSelect Purchase varian elegant. Nilai '' = semua ---
export function InvSelect({ value, onChange, options, allLabel, searchPlaceholder }: {
  value: string; onChange: (v: string) => void; options: FilterOption[]; allLabel: string; searchPlaceholder?: string;
}) {
  return (
    <FilterSelect
      variant="elegant"
      value={value}
      onChange={onChange}
      options={[{ value: '', label: allLabel }, ...options]}
      searchPlaceholder={searchPlaceholder}
    />
  );
}

// --- Periode tanggal: tombol + popover From/To (sama dengan "Date Period" di Purchase Transaction) ---
const dateInputCls = 'mt-0.5 w-full rounded-[6px] border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-900 focus:border-neutral-700 focus:outline-none focus:ring-2 focus:ring-neutral-300';

export function InvDatePeriod({ from, to, onFrom, onTo, label = 'Date Period', single = false, onClear }: {
  from?: string; to: string; onFrom?: (v: string) => void; onTo: (v: string) => void;
  label?: string; single?: boolean; onClear?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const text = single
    ? (to ? formatTanggalSingkat(to) : 'All')
    : `${from ? formatTanggalSingkat(from) : 'All'}${to ? ` – ${formatTanggalSingkat(to)}` : ''}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 rounded-[6px] border bg-card px-3 py-1.5 text-xs transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
      >
        <Calendar size={12} className="text-neutral-500" />
        <span className="text-neutral-500">{label}</span>
        <span className="font-medium text-neutral-900">{text}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
          {!single && onFrom && (
            <div>
              <label className="text-[11px] font-medium text-neutral-500">From</label>
              <input type="date" value={from ?? ''} max={to || undefined} onChange={e => onFrom(e.target.value)} className={dateInputCls} />
            </div>
          )}
          <div>
            <label className="text-[11px] font-medium text-neutral-500">{single ? 'Date' : 'To'}</label>
            <input type="date" value={to} min={(!single && from) || undefined} max="2999-12-31" onChange={e => onTo(e.target.value)} className={dateInputCls} />
          </div>
          <div className="flex gap-2">
            {onClear && (
              <button type="button" onClick={() => { onClear(); setOpen(false); }} className="flex-1 rounded-[6px] border border-neutral-300 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                Reset
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="flex-1 rounded-[6px] bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700">
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Subjudul daftar tabel: "Showing 1 - 10 of 25 items" / "Showing 0 of 40 items" (sama dengan Purchase) ---
export function showingText(page: number, pageSize: number, filtered: number, all: number, noun: string) {
  return filtered === 0
    ? `Showing 0 of ${all} ${noun}`
    : `Showing ${page * pageSize + 1} - ${Math.min((page + 1) * pageSize, filtered)} of ${filtered} ${noun}`;
}