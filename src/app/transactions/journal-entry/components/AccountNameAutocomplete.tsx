'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CoaAccount } from '@/lib/coaStore';

const MAX_SUGGESTIONS = 30;

/** Input Account Name dengan saran dari COA klien aktif (management_client_coa).
 *  Cocok ke acc_no ATAU account_name; memilih saran mengisi kode + nama akun.
 *  Dropdown pakai position: fixed supaya tidak terpotong overflow tabel/modal. */
export default function AccountNameAutocomplete({
  value,
  accounts,
  loading,
  noClient,
  onChange,
  onSelect,
  placeholder,
  className,
}: {
  value: string;
  accounts: CoaAccount[];
  loading?: boolean;
  noClient?: boolean;
  onChange: (value: string) => void;
  onSelect: (account: CoaAccount) => void;
  placeholder?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; bottom: number; width: number } | null>(null);

  const suggestions = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return accounts.slice(0, MAX_SUGGESTIONS);
    // Awalan nama/kode diurutkan duluan, lalu yang sekadar mengandung.
    const awalan: CoaAccount[] = [];
    const mengandung: CoaAccount[] = [];
    for (const a of accounts) {
      const nama = a.account_name.toLowerCase();
      const kode = a.acc_no.toLowerCase();
      if (nama.startsWith(q) || kode.startsWith(q)) awalan.push(a);
      else if (nama.includes(q) || kode.includes(q)) mengandung.push(a);
    }
    return [...awalan, ...mengandung].slice(0, MAX_SUGGESTIONS);
  }, [accounts, value]);

  const updateRect = () => {
    const r = inputRef.current?.getBoundingClientRect();
    if (r) setRect({ left: r.left, top: r.top, bottom: r.bottom, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    updateRect();
    // capture: true -> ikut menangkap scroll di dalam modal/tabel, bukan cuma window.
    window.addEventListener('scroll', updateRect, true);
    window.addEventListener('resize', updateRect);
    return () => {
      window.removeEventListener('scroll', updateRect, true);
      window.removeEventListener('resize', updateRect);
    };
  }, [open]);

  useEffect(() => { setHighlight(0); }, [value]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pilih = (a: CoaAccount) => {
    onSelect(a);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight(h => Math.min(h + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (suggestions[highlight]) {
        e.preventDefault();
        pilih(suggestions[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Buka ke atas kalau ruang di bawah input sempit.
  const bukaKeAtas = rect ? window.innerHeight - rect.bottom < 260 && rect.top > 260 : false;

  return (
    <>
      <input
        ref={inputRef}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {open && rect && (
        <ul
          ref={listRef}
          role="listbox"
          // mousedown preventDefault: input tidak blur duluan sebelum klik saran terdaftar.
          onMouseDown={e => e.preventDefault()}
          style={{
            position: 'fixed',
            left: rect.left,
            width: Math.max(rect.width, 320),
            ...(bukaKeAtas ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
          }}
          className="z-[60] max-h-60 overflow-y-auto scrollbar-thin rounded-lg border border-border bg-card shadow-xl py-1 text-xs"
        >
          {noClient ? (
            <li className="px-3 py-2 text-muted-foreground">Select a client in the header to get account suggestions.</li>
          ) : loading && accounts.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">Loading chart of accounts…</li>
          ) : accounts.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">This client has no chart of accounts yet (Management &gt; Chart of Accounts).</li>
          ) : suggestions.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground">No matching account.</li>
          ) : suggestions.map((a, i) => (
            <li
              key={a.id}
              data-idx={i}
              role="option"
              aria-selected={i === highlight}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => pilih(a)}
              className={`px-3 py-1.5 cursor-pointer flex items-baseline gap-2 ${i === highlight ? 'bg-primary/10' : ''}`}
            >
              <span className="font-mono text-muted-foreground shrink-0">{a.acc_no}</span>
              <span className="text-foreground truncate flex-1">{a.account_name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{a.account_classification}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
