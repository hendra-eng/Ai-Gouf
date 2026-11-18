'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Check } from 'lucide-react';

// Dropdown filter -- sama dengan FilterSelect di Purchase Source Data / Sales Transaction:
// tombol berborder hijau, selalu terbuka ke bawah, kolom cari bila opsi banyak, hover/terpilih hijau brand.
// Opsi `meta` (teks kanan) dan `sub` (baris kecil di bawah label) bersifat opsional -- dipakai picker
// vendor di Accounts Payable; tanpa keduanya tampilan identik dengan Purchase.
export interface FilterOption { value: string; label: string; meta?: string; sub?: string }

// variant="elegant" = tema monokrom yang sama dengan Sales Transaction (border abu, fokus hitam,
// opsi terpilih abu). Default tetap hijau supaya halaman lain tidak berubah.
// Props tambahan (semuanya opsional, default = perilaku lama):
//  block       tombol & panel selebar kolom (untuk field form)
//  tall        tombol lebih tinggi (py-3) agar sejajar dengan input form di sebelahnya
//  size        'md' = py-2 (sejajar dengan input py-2); default 'sm' = py-1.5 seperti Purchase
//  disabled    tombol nonaktif
//  icon        ikon di kiri teks tombol
//  searchable  paksa kolom cari (default: hanya bila opsi > 10)
//  placeholder teks bila `value` tidak cocok dengan opsi mana pun (default: opsi pertama)
export default function FilterSelect({
  value, onChange, options, variant = 'default', block = false, tall = false, size = 'sm', disabled = false, icon, searchable: forceSearch,
  searchPlaceholder = 'Search...', emptyText = 'Not found', placeholder, ariaLabel, className = '',
}: {
  value: string; onChange: (v: string) => void; options: FilterOption[]; variant?: 'default' | 'elegant';
  block?: boolean; tall?: boolean; size?: 'sm' | 'md'; disabled?: boolean; icon?: React.ReactNode; searchable?: boolean; searchPlaceholder?: string;
  emptyText?: string; placeholder?: string; ariaLabel?: string; className?: string;
}) {
  const elegant = variant === 'elegant';
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const matched = options.find(o => o.value === value);
  const current = matched ?? (placeholder ? undefined : options[0]);
  const searchable = forceSearch ?? options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className={`relative ${block ? 'w-full' : ''} ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 ${tall ? 'py-3' : size === 'md' ? 'py-2' : 'py-1.5'} bg-card transition-colors disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:opacity-70 ${block ? 'w-full justify-between text-left' : ''} ${elegant
          ? `text-neutral-900 ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : `border-neutral-300 ${disabled ? '' : 'hover:border-neutral-500 hover:bg-neutral-50'}`}`
          : `text-foreground ${open ? 'border-primary ring-2 ring-primary/20' : `border-primary/60 ${disabled ? '' : 'hover:border-primary hover:bg-slate-50'}`}`}`}
      >
        {icon && <span className={`shrink-0 ${elegant ? 'text-neutral-500' : 'text-muted-foreground'}`}>{icon}</span>}
        <span className={`truncate ${block ? 'min-w-0 flex-1' : 'max-w-[170px]'} ${current ? '' : 'text-neutral-400'}`}>{current ? current.label : placeholder}</span>
        <ChevronDown size={14} className={`shrink-0 ${elegant ? 'text-neutral-500' : 'text-muted-foreground'} transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`absolute left-0 top-full z-30 mt-1 ${block ? 'w-full' : 'w-max min-w-full max-w-[320px]'} rounded-[6px] border ${elegant ? 'border-neutral-300 bg-white' : 'border-slate-300 bg-card'} shadow-xl`}>
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder={searchPlaceholder}
                className={`w-full rounded-md border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 ${elegant ? 'border-neutral-300 focus:border-neutral-700 focus:ring-neutral-300' : 'border-border focus:ring-primary/30'}`}
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className={`px-4 py-2 text-sm ${elegant ? 'text-neutral-500' : 'text-muted-foreground'}`}>{emptyText}</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors ${elegant
                      ? `hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`
                      : `hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{o.label}</span>
                      {o.sub && <span className="block truncate text-[11px] font-normal text-neutral-500">{o.sub}</span>}
                    </span>
                    {o.meta && <span className="shrink-0 text-xs font-normal text-neutral-500">{o.meta}</span>}
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
