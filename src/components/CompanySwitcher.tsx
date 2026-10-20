'use client';

// Dropdown "Switch Company" di header (Topbar) -- versi autocomplete.
//
// Daftar di dropdown TIDAK lagi diambil dari seluruh client di context,
// tapi dari GET /api/v1/management/clients?q=&limit=10:
//   - saat dibuka (input kosong) -> 10 client teratas,
//   - saat mengetik -> dicari di backend setelah user berhenti mengetik
//     DEBOUNCE_MS (debounce), request lama dibatalkan (AbortController)
//     supaya hasil yang basi tidak menimpa hasil terbaru.
// Client aktif tetap disimpan di context global (src/lib/activeClient.tsx).
import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Building2, Check, Search, Loader2 } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { searchClients, type Client } from '@/lib/clientsStore';

const DEBOUNCE_MS = 300;
const LIMIT = 10;

// Indonesian legal-entity prefixes to skip when generating a short 2–3 letter
// code for the company switcher (e.g. "PT Nusantara Teknologi" -> "NT").
const LEGAL_PREFIXES = new Set(['PT', 'CV', 'UD', 'TBK', 'PD', 'FA']);

function companyShortCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '—';
  const significant = words[0] && LEGAL_PREFIXES.has(words[0].toUpperCase()) ? words.slice(1) : words;
  const source = significant.length > 0 ? significant : words;
  const initials = source.slice(0, 3).map((w) => w[0]?.toUpperCase() ?? '').join('');
  return initials || name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase() || '—';
}

interface CompanySwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function CompanySwitcher({ open, onOpenChange }: CompanySwitcherProps) {
  const router = useRouter();
  const { clients, loading: clientsLoading, activeClientId, activeClientName, setActiveClient } = useActiveClient();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Client[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState(0);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const activeName = activeClientName || clients.find((c) => c.id === activeClientId)?.companyName || null;
  const noClientsAtAll = !clientsLoading && clients.length === 0;

  // Reset input tiap dropdown dibuka, lalu fokus ke kotak pencarian.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  // Cari ke backend: langsung saat input kosong (default 10 client),
  // di-debounce saat user mengetik.
  useEffect(() => {
    if (!open || noClientsAtAll) return;
    const controller = new AbortController();
    const kata = query.trim();
    setSearching(true);
    const timer = window.setTimeout(() => {
      searchClients(kata, LIMIT, controller.signal)
        .then((rows) => {
          setResults(rows);
          setError(null);
          setHighlight(0);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(err instanceof Error ? err.message : 'Failed to load companies');
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, kata ? DEBOUNCE_MS : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, noClientsAtAll]);

  // Tutup saat klik di luar dropdown.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onOpenChange]);

  // Jaga item yang di-highlight tetap terlihat saat navigasi keyboard.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const pick = (c: Client) => {
    setActiveClient(c.id, c.companyName);
    onOpenChange(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (results.length ? (h + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (results.length ? (h - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const c = results[highlight];
      if (c) pick(c);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onOpenChange(false);
    }
  };

  return (
    <div ref={wrapperRef} className="relative hidden sm:block">
      <button
        onClick={() => onOpenChange(!open)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:bg-muted transition-colors text-sm"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <div className="w-6 h-6 rounded bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Building2 size={12} className="text-primary" />
        </div>
        <span className="font-semibold text-foreground truncate max-w-[160px] hidden lg:block">
          {activeName || 'No clients yet'}
        </span>
        <span className="font-semibold text-foreground lg:hidden">
          {activeName ? companyShortCode(activeName) : '—'}
        </span>
        <ChevronDown size={14} className={`text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-card border border-border rounded-xl shadow-card-lg z-50 py-1 fade-in">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-3 py-2">Switch Company</p>

          {noClientsAtAll ? (
            <button
              onClick={() => { onOpenChange(false); router.push('/clients'); }}
              className="w-full flex items-center gap-3 px-3 py-3 hover:bg-muted transition-colors text-left"
            >
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">No clients yet</p>
                <p className="text-xs text-muted-foreground mt-0.5">Add your first client on the Clients page</p>
              </div>
            </button>
          ) : (
            <>
              <div className="px-3 pb-2">
                <div className="relative">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search company name or code…"
                    maxLength={100}
                    className="w-full pl-8 pr-8 py-2 text-sm rounded-lg border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-[#22C55E]/40 focus:border-[#22C55E]"
                    role="combobox"
                    aria-expanded
                    aria-controls="company-switcher-list"
                    aria-autocomplete="list"
                  />
                  {searching && (
                    <Loader2 size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground animate-spin" />
                  )}
                </div>
              </div>

              <div id="company-switcher-list" ref={listRef} role="listbox" className="max-h-80 overflow-y-auto">
                {error ? (
                  <p className="px-3 py-3 text-xs text-negative">{error}</p>
                ) : results.length === 0 ? (
                  <p className="px-3 py-3 text-xs text-muted-foreground">
                    {searching ? 'Searching…' : query.trim() ? `No companies match "${query.trim()}"` : 'No companies found'}
                  </p>
                ) : (
                  results.map((co, i) => (
                    <button
                      key={co.id}
                      data-index={i}
                      role="option"
                      aria-selected={co.id === activeClientId}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => pick(co)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 transition-colors text-left ${i === highlight ? 'bg-muted' : ''}`}
                    >
                      <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-primary">{companyShortCode(co.companyName)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{co.companyName}</p>
                        {co.clientCode && co.clientCode !== '-' && (
                          <p className="text-[11px] text-muted-foreground truncate">{co.clientCode}</p>
                        )}
                      </div>
                      {co.id === activeClientId && <Check size={14} className="text-primary flex-shrink-0" />}
                    </button>
                  ))
                )}
              </div>

              {!error && results.length >= LIMIT && (
                <p className="px-3 pt-2 pb-1 text-[10px] text-muted-foreground border-t border-border">
                  Showing the first {LIMIT} results. Type to narrow down.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
