'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import {
  ChevronLeft, ChevronRight, ChevronDown, Check, Search, X, MoreHorizontal, Eye,
  FileText, AlertTriangle, Ban, Scale,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiEntry } from '@/lib/journalEntryStore';
import { JeErrorBanner } from '@/app/transactions/journal-entry/components/JeNotice';
import SalesLoading from '@/app/transactions/sales/components/SalesLoading';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');
const fmtCompact = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

type ExceptionKind = 'Exception' | 'Rejected' | 'Imbalanced';
type PillStyle = { pill: string; dot: string };

// Pill bergaris + titik berwarna -- gaya sama dengan tab Exceptions / Source Data Sales.
const KIND_STYLE: Record<ExceptionKind, PillStyle> = {
  Exception: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Rejected: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  Imbalanced: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
};
const PILL_FALLBACK: PillStyle = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

function Pill({ style, label }: { style?: PillStyle; label: string }) {
  const st = style || PILL_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

function ExceptionKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string; count: number; detail: string; detailUnit: string; pct: number; pctLabel: string; icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Dropdown filter kustom -- sama dengan FilterSelect di SalesExceptions.
interface FilterOption { value: string; label: string }
function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: FilterOption[] }) {
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
  const current = options.find(o => o.value === value) ?? options[0];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-neutral-900 transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-neutral-300 bg-white shadow-xl">
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {options.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-medium text-neutral-900' : 'text-neutral-700'}`}
                  >
                    <span className="truncate">{o.label}</span>
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

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

interface FlaggedEntry {
  entry: JeUiEntry;
  kind: ExceptionKind;
  reasons: string[];
}

// Deteksi exception dari data asli -- tanpa field severity/assignee buatan.
function detectExceptions(journalEntries: JeUiEntry[]): FlaggedEntry[] {
  const flagged: FlaggedEntry[] = [];
  journalEntries.forEach(je => {
    const reasons: string[] = [];
    if (je.status === 'exception') reasons.push('Flagged as exception');
    if (je.status === 'rejected') reasons.push('Rejected');
    const imbalance = Math.abs(je.totalDebit - je.totalCredit);
    if (imbalance > 0.01) reasons.push(`Debit/credit imbalance of ${fmt(imbalance)}`);
    if (reasons.length > 0) {
      const kind: ExceptionKind = je.status === 'exception' ? 'Exception' : je.status === 'rejected' ? 'Rejected' : 'Imbalanced';
      flagged.push({ entry: je, kind, reasons });
    }
  });
  return flagged;
}

export default function JournalEntryExceptionsPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading, error, refresh } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const { lines: selectedBackendLines } = useJeDraftLines(selectedId);
  const selectedLines = useMemo(() => selectedBackendLines.map(mapJeDraftLineToUi), [selectedBackendLines]);

  const flaggedEntries = useMemo(() => detectExceptions(journalEntries), [journalEntries]);
  const sourceTypes = useMemo(() => Array.from(new Set(flaggedEntries.map(f => f.entry.sourceType))), [flaggedEntries]);

  const filtered = useMemo(() => {
    let data = flaggedEntries;
    const q = search.trim().toLowerCase();
    if (q) data = data.filter(f => f.entry.jeNumber.toLowerCase().includes(q) || f.entry.description.toLowerCase().includes(q));
    if (kindFilter !== 'all') data = data.filter(f => f.kind === kindFilter);
    if (sourceFilter !== 'all') data = data.filter(f => f.entry.sourceType === sourceFilter);
    return data;
  }, [flaggedEntries, search, kindFilter, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));
  const selected = flaggedEntries.find(f => f.entry.id === selectedId) ?? null;

  const resetFilters = () => { setSearch(''); setKindFilter('all'); setSourceFilter('all'); setCurrentPage(1); };

  const tiles = useMemo(() => {
    const total = flaggedEntries.length;
    const sumDebit = (rows: FlaggedEntry[]) => rows.reduce((a, f) => a + f.entry.totalDebit, 0);
    const imbalanced = flaggedEntries.filter(f => Math.abs(f.entry.totalDebit - f.entry.totalCredit) > 0.01);
    const sets: { label: string; rows: FlaggedEntry[]; icon: React.ElementType }[] = [
      { label: 'Total Flagged Entries', rows: flaggedEntries, icon: FileText },
      { label: 'Marked as Exception', rows: flaggedEntries.filter(f => f.entry.status === 'exception'), icon: AlertTriangle },
      { label: 'Rejected', rows: flaggedEntries.filter(f => f.entry.status === 'rejected'), icon: Ban },
      { label: 'Debit/Credit Imbalance', rows: imbalanced, icon: Scale },
    ];
    return sets.map(k => ({
      ...k,
      detail: fmtCompact(sumDebit(k.rows)),
      pct: total > 0 ? Math.round((k.rows.length / total) * 100) : 0,
    }));
  }, [flaggedEntries]);

  const headers = ['Type', 'Date', 'JE Number', 'Description', 'Source Type', 'Debit', 'Credit', 'Created By', 'Action'];
  const numericCols = ['Debit', 'Credit'];

  return (
    <div className="fade-in">
      <JournalEntryTabs activeTab="exceptions" />

      <div className={`${salesFont.className} space-y-4`}>
        {error && <JeErrorBanner message={error} onRetry={refresh} />}

        {/* KPI Cards */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
          {tiles.map(k => (
            <ExceptionKpiTile
              key={k.label}
              label={k.label}
              count={k.rows.length}
              detail={k.detail}
              detailUnit="total debit"
              pct={k.pct}
              pctLabel="of total flagged"
              icon={k.icon}
            />
          ))}
        </div>

        {/* Filters */}
        <div className="card relative px-0 pb-0 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              value={kindFilter}
              onChange={v => { setKindFilter(v); setCurrentPage(1); }}
              options={[
                { value: 'all', label: 'All (Exception Type)' },
                { value: 'Exception', label: 'Marked as Exception' },
                { value: 'Rejected', label: 'Rejected' },
                { value: 'Imbalanced', label: 'Imbalanced' },
              ]}
            />
            <FilterSelect
              value={sourceFilter}
              onChange={v => { setSourceFilter(v); setCurrentPage(1); }}
              options={[{ value: 'all', label: 'All (Source Type)' }, ...sourceTypes.map(s => ({ value: s, label: s }))]}
            />
          </div>
        </div>

        {/* Table + Drawer */}
        <div className="flex gap-4">
          {loading && flaggedEntries.length === 0 ? (
            <SalesLoading loading message="Loading..." className="flex-1 min-w-0" />
          ) : (
          <div className="card overflow-hidden flex-1 min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Exception List</h3>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {loading
                    ? 'Loading...'
                    : filtered.length === 0
                    ? 'Showing 0 of 0 entries'
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} entries`}
                </p>
              </div>
              <div className="ml-auto flex w-full flex-col items-end gap-1.5 sm:w-auto">
                <div className="flex items-center justify-end gap-2">
                  <button onClick={resetFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">Reset</button>
                </div>
                <div className="relative w-full sm:w-[400px]">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
                    placeholder="Search JE number or description..."
                    className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[800px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    {headers.map(h => (
                      <th key={h} className={`py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 ${numericCols.includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={headers.length} className="py-2 px-2 text-center text-xs text-neutral-500">Loading journal entries...</td></tr>
                  )}
                  {!loading && paginated.length === 0 && (
                    <tr>
                      <td colSpan={headers.length} className="py-2 px-2 text-center text-xs text-neutral-500">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No exceptions match your filters.</span>
                      </td>
                    </tr>
                  )}
                  {paginated.map(({ entry, kind }) => (
                    <tr
                      key={entry.id}
                      onClick={() => setSelectedId(entry.id)}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedId === entry.id ? '[&>td]:bg-neutral-100' : ''}`}
                    >
                      <td className="py-2 px-2"><Pill style={KIND_STYLE[kind]} label={kind} /></td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{entry.date}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{entry.jeNumber}</td>
                      <td className="py-2 px-2 max-w-[240px] truncate font-medium text-neutral-900" title={entry.description}>{entry.description}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{entry.sourceType}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{entry.totalDebit.toLocaleString('id-ID')}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{entry.totalCredit.toLocaleString('id-ID')}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{entry.createdBy || '—'}</td>
                      <td className="py-2 px-2 relative" onClick={ev => ev.stopPropagation()}>
                        <button
                          onClick={() => setOpenMenuId(prev => (prev === entry.id ? null : entry.id))}
                          className="p-1 hover:bg-neutral-300 rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={13} className="text-neutral-600" />
                        </button>
                        {openMenuId === entry.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                            <div className="absolute z-20 right-2 top-full mt-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg">
                              <button onClick={() => { setSelectedId(entry.id); setOpenMenuId(null); }} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md">
                                <Eye size={12} /> View Detail
                              </button>
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* Baris pengisi: tinggi tabel selalu = rows per page, supaya layar tidak bergeser. */}
                  {Array.from({ length: Math.max(0, pageSize - (paginated.length > 0 ? paginated.length : (!loading ? 1 : 0))) }).map((_, i) => (
                    <tr key={`pad-${i}`} aria-hidden="true" className="invisible text-xs">
                      <td colSpan={headers.length} className="py-2 px-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium">&nbsp;</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2">
                  <span>Rows per page</span>
                  <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-900 bg-card focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300">
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
                <span className="hidden sm:inline text-slate-300">|</span>
                <span>
                  <span className="font-semibold text-neutral-900">{filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}</span>{' '}
                  of <span className="font-semibold text-neutral-900">{filtered.length}</span> entries
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                  <ChevronLeft size={15} />
                </button>
                {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                  )
                )}
                <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-card">
                  <ChevronRight size={15} />
                </button>
              </div>
            </div>
          </div>
          )}

          {/* Detail Drawer */}
          {selected && (
            <div className="w-80 flex-shrink-0 self-start sticky top-4 space-y-3 overflow-hidden rounded-xl border border-neutral-300 bg-white p-4 pt-5 shadow-sm">
              <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">Exception Detail</h3>
                <button onClick={() => setSelectedId(null)} className="p-1 hover:bg-neutral-100 rounded" aria-label="Close"><X size={14} /></button>
              </div>
              <div className="flex items-center justify-between">
                <Pill style={KIND_STYLE[selected.kind]} label={selected.kind} />
                <span className="text-xs text-neutral-500">{selected.entry.jeNumber}</span>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-neutral-900">{selected.entry.description}</h4>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {selected.reasons.map(r => (
                    <span key={r} className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700">
                      <AlertTriangle size={10} />{r}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5 text-xs">
                {([
                  ['Date', selected.entry.date],
                  ['Source Type', selected.entry.sourceType],
                  ['Source Ref', selected.entry.sourceReference || '—'],
                  ['Debit', fmt(selected.entry.totalDebit)],
                  ['Credit', fmt(selected.entry.totalCredit)],
                  ['Created By', selected.entry.createdBy || '—'],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <span className="text-neutral-500">{k}</span>
                    <span className="text-right font-medium tabular-nums text-neutral-900">{v}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-neutral-200 pt-3">
                <p className="mb-2 text-xs font-semibold text-neutral-900">Journal Lines</p>
                <div className="overflow-x-auto scrollbar-thin">
                  <table className="w-full select-text border-separate border-spacing-0 text-[11px]">
                    <thead>
                      <tr className="bg-neutral-300">
                        <th className="border-b border-t border-neutral-800 px-2 py-1.5 text-left font-bold text-black">Account</th>
                        <th className="border-b border-t border-neutral-800 px-2 py-1.5 text-right font-bold text-black">Debit</th>
                        <th className="border-b border-t border-neutral-800 px-2 py-1.5 text-right font-bold text-black">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedLines.length === 0 && (
                        <tr><td colSpan={3} className="px-2 py-3 text-center text-neutral-500">No journal lines.</td></tr>
                      )}
                      {selectedLines.map(line => (
                        <tr key={line.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                          <td className="px-2 py-1.5 text-neutral-900">
                            <span className="font-medium">{kodeAkun(line.accountCode)}</span>
                            <span className="block text-neutral-500">{line.accountName}</span>
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{line.debit > 0 ? line.debit.toLocaleString('id-ID') : '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{line.credit > 0 ? line.credit.toLocaleString('id-ID') : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {selected.entry.notes && (
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs leading-relaxed text-neutral-900">
                  {selected.entry.notes}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}