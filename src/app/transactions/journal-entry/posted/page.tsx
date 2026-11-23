'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Search, ArrowUpDown, MoreHorizontal, X, Eye, Copy, Download, Printer, ChevronLeft, ChevronRight, ChevronDown, Check,
  FileText, FileSpreadsheet, Sheet, BookOpen, Wallet, CalendarDays, CheckCircle, LayoutGrid, Clock, ShieldCheck,
} from 'lucide-react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import JePostedKpiTile from '@/app/transactions/journal-entry/components/JePostedKpiTile';
import JePostedPanel, { jeIconBadge } from '@/app/transactions/journal-entry/components/JePostedPanel';
import { buildJeListReport, buildJeDetailReport, type JePrintRow } from '@/app/transactions/journal-entry/components/jePrintReports';
import { printReport, type PrintFormat } from '@/lib/printExport';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useJeDrafts, useJeDraftLines, useJeActivityLogs, listJeDraftLines,
  mapJeDraftToUi, mapJeDraftLineToUi, type JeUiEntry,
} from '@/lib/journalEntryStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "02 Jan 2024" -- nama bulan Inggris, tidak bergantung locale browser (sama dengan Sales). */
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
/** "2 Jan 2024, 14:30" */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}`;
}
const todayLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const isBalanced = (r: JeUiEntry) => Math.abs(r.totalDebit - r.totalCredit) < 0.01;

// Gaya tombol netral -- sama dengan ACTION_BTN_* di Sales > Posted.
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

// Pill bergaris + titik berwarna -- sama dengan Pill di Sales > Posted.
const POSTED_PILL = { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' };
function PostedPill({ label }: { label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${POSTED_PILL.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${POSTED_PILL.dot}`} />{label}
    </span>
  );
}

// Dropdown filter kustom -- sama persis dengan FilterSelect di Sales > Posted:
// selalu terbuka ke bawah, bisa di-scroll, hover/terpilih abu netral.
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-neutral-900 transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-neutral-300 bg-white shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-neutral-500">No results</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`}
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

const TABLE_COLUMNS: { label: string; field: string; align?: 'right' }[] = [
  { label: 'Posting Date', field: 'postingDate' },
  { label: 'JE Number', field: 'jeNumber' },
  { label: 'Entry Date', field: 'date' },
  { label: 'Description', field: 'description' },
  { label: 'Source', field: 'sourceType' },
  { label: 'Debit', field: 'totalDebit', align: 'right' },
  { label: 'Credit', field: 'totalCredit', align: 'right' },
  { label: 'Period', field: 'period' },
  { label: 'Approved By', field: 'approvedBy' },
];

export default function JournalEntryPostedPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { clients, activeClientId, activeClientName } = useActiveClient();
  const companyName = clients.find(c => c.id === activeClientId)?.companyName || activeClientName || undefined;
  const printedBy = user?.nama || user?.username || undefined;

  // Semua JE (bukan hanya posted) supaya KPI bisa menghitung proporsi terhadap seluruh JE.
  const { drafts: backendDrafts, loading, error, refresh } = useJeDrafts(clientId);
  const { logs: activityLogs } = useJeActivityLogs(clientId);
  const allEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);
  const postedEntries = useMemo(() => allEntries.filter(e => e.status === 'posted'), [allEntries]);

  // Filters
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sortField, setSortField] = useState('postingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Selection / detail
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const periods = useMemo(() => Array.from(new Set(postedEntries.map(t => t.period))), [postedEntries]);
  const sourceTypes = useMemo(() => Array.from(new Set(postedEntries.map(t => t.sourceType))), [postedEntries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    const data = postedEntries.filter(r => {
      if (q && !(r.jeNumber.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.sourceReference.toLowerCase().includes(q))) return false;
      if (periodFilter !== 'all' && r.period !== periodFilter) return false;
      if (sourceFilter !== 'all' && r.sourceType !== sourceFilter) return false;
      const raw = r.postingDate || r.date;
      const d = raw ? new Date(raw) : null;
      if (start && d && d < start) return false;
      if (end && d && d > end) return false;
      return true;
    });
    data.sort((a, b) => {
      const av = ((a as unknown as Record<string, unknown>)[sortField] ?? '') as string | number;
      const bv = ((b as unknown as Record<string, unknown>)[sortField] ?? '') as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [postedEntries, search, periodFilter, sourceFilter, dateStart, dateEnd, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const selected = postedEntries.find(r => r.id === selectedId) || null;
  const { lines: selectedBackendLines } = useJeDraftLines(selectedId);
  const selectedLines = useMemo(() => selectedBackendLines.map(mapJeDraftLineToUi), [selectedBackendLines]);

  // KPI
  const totalPosted = postedEntries.length;
  const totalDebit = postedEntries.reduce((s, r) => s + r.totalDebit, 0);
  const totalCredit = postedEntries.reduce((s, r) => s + r.totalCredit, 0);
  const allDebit = allEntries.reduce((s, r) => s + r.totalDebit, 0);
  const allCredit = allEntries.reduce((s, r) => s + r.totalCredit, 0);
  const today = todayLocal();
  const postedToday = postedEntries.filter(r => (r.postingDate || '').slice(0, 10) === today).length;
  const balancedCount = postedEntries.filter(isBalanced).length;
  const periodsCovered = new Set(postedEntries.map(r => r.period)).size;
  const allPeriods = new Set(allEntries.map(r => r.period)).size;
  const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
    setCurrentPage(1);
  };

  const resetFilters = () => {
    setSearch(''); setPeriodFilter('all'); setSourceFilter('all');
    setDateStart(''); setDateEnd('');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.id));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(r => next.delete(r.id));
      else paginated.forEach(r => next.add(r.id));
      return next;
    });
  };

  const openDetail = (row: JeUiEntry) => {
    setSelectedId(row.id);
    setOpenMenuId(null);
  };

  const copyNumber = (no: string) => {
    navigator.clipboard?.writeText(no);
    toast.success('JE number copied', { description: no });
    setOpenMenuId(null);
  };

  // Export / cetak daftar: format General Journal (1 baris per journal line), memakai builder yang sama dengan tab JE Transaction.
  const exportEntries = async (entries: JeUiEntry[], format: PrintFormat, label: string) => {
    if (entries.length === 0) {
      toast.error('No data to export');
      return;
    }
    try {
      const rows: JePrintRow[] = await Promise.all(entries.map(async (je) => ({
        ...je,
        lines: (await listJeDraftLines(je.id)).map(mapJeDraftLineToUi),
      })));
      await printReport(buildJeListReport(rows, companyName, printedBy), format);
      toast.success('Export successful', { description: `${label}: ${rows.length} entries` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate file.');
    }
  };
  const exportSelected = () => exportEntries(postedEntries.filter(r => selectedRows.has(r.id)), 'csv', 'Selected entries');

  const printEntry = async (row: JeUiEntry, lines?: ReturnType<typeof mapJeDraftLineToUi>[]) => {
    try {
      const l = lines ?? (await listJeDraftLines(row.id)).map(mapJeDraftLineToUi);
      await printReport(buildJeDetailReport(row, l, companyName, printedBy), 'pdf');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate file.');
    }
    setOpenMenuId(null);
  };

  const recentActivity = showAllActivity ? activityLogs : activityLogs.slice(0, 5);

  // Tombol aksi di baris tab -- gaya tombol sama dengan Sales > Posted.
  const actionBar = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button onClick={() => exportEntries(filtered, 'csv', 'All data (filtered)')} className={ACTION_BTN_SECONDARY}>
        <FileSpreadsheet size={13} /> Export
      </button>
      <button onClick={() => exportEntries(filtered, 'pdf', 'All data (filtered)')} className={ACTION_BTN_SECONDARY}>
        <Printer size={13} /> Print List
      </button>
      {selectedRows.size > 0 && (
        <button onClick={exportSelected} className={ACTION_BTN_PRIMARY}>
          <Download size={13} /> Export Selected ({selectedRows.size})
        </button>
      )}
    </div>
  );

  const quickActions: { icon: React.ElementType; label: string; sub: string; onClick: () => void }[] = [
    { icon: FileSpreadsheet, label: 'Export to Excel', sub: 'Export filtered entries (XLSX)', onClick: () => exportEntries(filtered, 'excel', 'All data (filtered)') },
    { icon: Sheet, label: 'Export to CSV', sub: 'Export filtered entries (CSV)', onClick: () => exportEntries(filtered, 'csv', 'All data (filtered)') },
    { icon: Printer, label: 'Print List', sub: 'Print general journal (PDF)', onClick: () => exportEntries(filtered, 'pdf', 'All data (filtered)') },
    {
      icon: FileText, label: 'Export Selected', sub: 'Export ticked entries (CSV)',
      onClick: () => (selectedRows.size > 0 ? exportSelected() : toast.info('Select entries first', { description: 'Tick the checkbox on one or more rows in the table.' })),
    },
  ];

  return (
    <div className="fade-in">
      <JournalEntryTabs activeTab="posted" tabActions={actionBar} />

      <div className={`${salesFont.className} space-y-4`}>
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={refresh} className="underline font-medium">Retry</button>
          </div>
        )}

        {/* KPI Cards -- desain sama dengan Sales > Posted */}
        <div className="!mt-4 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <JePostedKpiTile label="Total Posted" value={String(totalPosted)} pct={pctOf(totalPosted, allEntries.length)} pctLabel="of all entries" icon={FileText} />
          <JePostedKpiTile label="Total Debit" value={fmt(totalDebit)} pct={pctOf(totalDebit, allDebit)} pctLabel="of all entry value" icon={BookOpen} />
          <JePostedKpiTile label="Total Credit" value={fmt(totalCredit)} pct={pctOf(totalCredit, allCredit)} pctLabel="of all entry value" icon={Wallet} />
          <JePostedKpiTile label="Posted Today" value={String(postedToday)} pct={pctOf(postedToday, totalPosted)} pctLabel="of total posted" icon={CalendarDays} />
          <JePostedKpiTile label="Balanced Entries" value={String(balancedCount)} pct={pctOf(balancedCount, totalPosted)} pctLabel="of total posted" icon={CheckCircle} />
          <JePostedKpiTile label="Periods Covered" value={String(periodsCovered)} pct={pctOf(periodsCovered, allPeriods)} pctLabel="of all periods" icon={LayoutGrid} />
        </div>

        {/* Filters -- desain sama dengan filter di Sales > Posted */}
        <div className="card relative px-0 pb-0 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}>
                <CalendarDays size={12} className="text-neutral-500" />
                <span className="text-neutral-500">Posting Period</span>
                <span className="font-medium text-neutral-900">
                  {dateStart ? fmtDate(dateStart) : 'All'}
                  {dateEnd ? ` – ${fmtDate(dateEnd)}` : ''}
                </span>
              </button>
              {showDatePicker && (
                <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500">From</label>
                    <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-neutral-500">To</label>
                    <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                  </div>
                  <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full rounded-[6px] bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700">
                    Apply
                  </button>
                </div>
              )}
            </div>

            <FilterSelect
              value={periodFilter}
              onChange={v => { setPeriodFilter(v); setCurrentPage(1); }}
              options={[{ value: 'all', label: 'All Periods' }, ...periods.map(p => ({ value: p, label: p }))]}
            />
            <FilterSelect
              value={sourceFilter}
              onChange={v => { setSourceFilter(v); setCurrentPage(1); }}
              options={[{ value: 'all', label: 'All Sources' }, ...sourceTypes.map(s => ({ value: s, label: s }))]}
            />
          </div>
        </div>

        {/* Table + Drawer */}
        <div className="flex gap-4 items-start !mt-1">
          <div className="card overflow-hidden flex-1 min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Posted Journal Entries</h3>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {loading
                    ? 'Loading…'
                    : filtered.length === 0
                    ? 'Showing 0 of 0 journal entries'
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} journal entries`}
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
                    placeholder="Search JE number, description, or source…"
                    className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              </div>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1200px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className="py-2 px-3 w-8 leading-none border-t border-b border-neutral-800">
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="block rounded border-neutral-400 accent-neutral-800" />
                    </th>
                    {TABLE_COLUMNS.map(col => (
                      <th
                        key={col.field}
                        className={`py-2 px-2 ${col.align === 'right' ? 'text-right' : 'text-left'} text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800`}
                      >
                        <button
                          type="button"
                          onClick={() => handleSort(col.field)}
                          className={`inline-flex items-center gap-1 select-none hover:text-neutral-700 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
                        >
                          {col.label}
                          <ArrowUpDown size={11} className={sortField === col.field ? 'opacity-100' : 'opacity-50'} />
                        </button>
                      </th>
                    ))}
                    <th className="text-left py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan={11} className="py-2 px-2 text-center text-xs text-neutral-500">Loading posted journal entries…</td></tr>
                  )}
                  {!loading && paginated.length === 0 && (
                    <tr>
                      <td colSpan={11} className="py-2 px-2 text-center text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No posted journal entries match your filters.</span></td>
                    </tr>
                  )}
                  {!loading && paginated.map(row => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedId === row.id ? '[&>td]:bg-neutral-100' : ''}`}
                      onClick={() => openDetail(row)}
                    >
                      <td className="py-2 px-3" onClick={ev => ev.stopPropagation()}>
                        <input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRow(row.id)} className="rounded border-neutral-400 accent-neutral-800" />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{fmtDate(row.postingDate)}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{row.jeNumber}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{fmtDate(row.date)}</td>
                      <td className="py-2 px-2 max-w-[200px] truncate text-neutral-600" title={row.description}>{row.description}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.sourceType}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.totalDebit)}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.totalCredit)}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.period}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.approvedBy || '—'}</td>
                      <td className="py-2 px-2" onClick={ev => ev.stopPropagation()}>
                        <div className="relative flex items-center gap-1">
                          <button onClick={() => openDetail(row)} className="text-xs font-semibold text-neutral-800 hover:text-neutral-900 hover:underline">View</button>
                          <button onClick={() => setOpenMenuId(prev => (prev === row.id ? null : row.id))} className="p-1 hover:bg-neutral-300 rounded transition-colors">
                            <MoreHorizontal size={13} className="text-neutral-600" />
                          </button>
                          {openMenuId === row.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                              <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-lg border border-neutral-300 bg-white shadow-lg py-1">
                                <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                  <Eye size={12} /> View Detail
                                </button>
                                <button onClick={() => copyNumber(row.jeNumber)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                  <Copy size={12} /> Copy JE Number
                                </button>
                                <button onClick={() => printEntry(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                  <Download size={12} /> Download PDF
                                </button>
                              </div>
                            </>
                          )}
                        </div>
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
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
                <span className="hidden sm:inline text-slate-300">|</span>
                <span>
                  <span className="font-semibold text-neutral-900">
                    {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                  </span>{' '}
                  of <span className="font-semibold text-neutral-900">{filtered.length}</span> journal entries
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className={NAV_BTN}><ChevronLeft size={16} /></button>
                {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                  )
                )}
                <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className={NAV_BTN}><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>

          {/* Detail Drawer -- gaya panel & ringkasan seperti Sales > Posted */}
          {selected && (() => {
            const matchPct = selected.totalDebit > 0 ? Math.min(100, Math.round((Math.min(selected.totalCredit, selected.totalDebit) / selected.totalDebit) * 100)) : 0;
            const rows: [string, React.ReactNode][] = [
              ['Posting Date', fmtDate(selected.postingDate)],
              ['Entry Date', fmtDate(selected.date)],
              ['Source', selected.sourceType],
              ['Source Ref', selected.sourceReference || '—'],
              ['Period', selected.period],
              ['Currency', selected.currency],
              ['Total Credit', fmt(selected.totalCredit)],
              ['Created By', selected.createdBy],
              ['Reviewed By', selected.reviewedBy || '—'],
              ['Approved By', selected.approvedBy || '—'],
              ['Last Updated', fmtDate(selected.lastUpdated)],
            ];
            return (
              <JePostedPanel
                className="w-80 flex-shrink-0 sticky top-4"
                title="Entry Detail"
                leading={jeIconBadge(<FileText size={17} />)}
                action={<button onClick={() => setSelectedId(null)} aria-label="Close" className="p-1 hover:bg-neutral-100 rounded transition-colors"><X size={16} className="text-neutral-500" /></button>}
              >
                <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold uppercase tracking-wider text-white">JE</div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{selected.jeNumber}</p>
                    <p className="truncate text-xs font-medium text-neutral-500">{selected.description || selected.sourceType}</p>
                  </div>
                  <span className="ml-auto shrink-0"><PostedPill label="Posted" /></span>
                </div>

                <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                  <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">Total Debit</p>
                  <p className="mt-1.5 truncate text-lg font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{fmt(selected.totalDebit)}</p>
                </div>
                <div className="mt-3">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${matchPct > 0 ? Math.max(matchPct, 3) : 0}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] font-medium text-neutral-600">{matchPct}% {isBalanced(selected) ? 'balanced' : 'credit matches debit'}</p>
                </div>

                <div className="mt-3 divide-y divide-neutral-200 text-xs">
                  {rows.map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-neutral-500">{k}</span>
                      <span className="text-sm font-semibold tabular-nums text-neutral-900 text-right break-words">{v}</span>
                    </div>
                  ))}
                </div>

                <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Journal Lines</p>
                <div className="mt-1 divide-y divide-neutral-200 text-xs">
                  {selectedLines.length === 0 && <p className="py-3 text-center text-neutral-500">No journal lines.</p>}
                  {selectedLines.map(line => (
                    <div key={line.id} className="py-2 space-y-0.5">
                      <p className="font-medium text-neutral-900">{kodeAkun(line.accountCode)} · {line.accountName}</p>
                      {line.description && <p className="text-[11px] text-neutral-500">{line.description}</p>}
                      <div className="flex justify-between pt-0.5">
                        <span className="text-neutral-500">{line.debit > 0 ? 'Debit' : 'Credit'}</span>
                        <span className="font-semibold tabular-nums text-neutral-900">{fmt(line.debit > 0 ? line.debit : line.credit)}</span>
                      </div>
                    </div>
                  ))}
                </div>

                {selected.notes && (
                  <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                    <p className="text-xs text-neutral-700">{selected.notes}</p>
                  </div>
                )}

                <div className="mt-3 flex gap-2 border-t border-neutral-200 pt-3">
                  <button onClick={() => copyNumber(selected.jeNumber)} className={`${ACTION_BTN_SECONDARY} flex-1 justify-center`}>
                    <Copy size={12} /> Copy JE No.
                  </button>
                </div>
                <button onClick={() => printEntry(selected, selectedLines)} className={`${ACTION_BTN_PRIMARY} mt-2 w-full justify-center`}>
                  <Printer size={12} /> Print
                </button>
              </JePostedPanel>
            );
          })()}
        </div>

        {/* Bottom Section -- panel sama dengan panel bawah Sales > Posted */}
        <div className="grid grid-cols-1 items-start xl:grid-cols-2 gap-4">
          <JePostedPanel
            title="Recent Activity"
            leading={jeIconBadge(<Clock size={17} />)}
            action={activityLogs.length > 5 ? (
              <button onClick={() => setShowAllActivity(v => !v)} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">
                {showAllActivity ? 'Show Less' : 'View All'}
              </button>
            ) : undefined}
          >
            <div className="space-y-2">
              {recentActivity.length === 0 && (
                <p className="py-6 text-center text-xs text-neutral-500">No journal activity yet.</p>
              )}
              {recentActivity.map(a => (
                <div key={a.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
                    {a.performed_by === 'System' ? <ShieldCheck size={15} /> : <FileText size={15} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-neutral-900">{a.description}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
                      <span>{fmtDateTime(a.created_at)}</span>
                      {a.je_number && <span className="font-semibold text-blue-700">{a.je_number}</span>}
                      <span>{a.performed_by}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </JePostedPanel>

          <JePostedPanel title="Quick Actions" leading={jeIconBadge(<LayoutGrid size={17} />)}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {quickActions.map(a => (
                <button
                  key={a.label}
                  onClick={a.onClick}
                  className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-100"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 ring-1 ring-neutral-200">
                    <a.icon size={16} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-neutral-900">{a.label}</p>
                    <p className="truncate text-xs font-medium text-neutral-500">{a.sub}</p>
                  </div>
                </button>
              ))}
            </div>
          </JePostedPanel>
        </div>
      </div>
    </div>
  );
}