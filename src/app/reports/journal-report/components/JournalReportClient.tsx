'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, FileSpreadsheet,
  FileText, Filter, Loader2, NotebookText, RotateCcw, Search, Layers, ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { KpiSectionLabel, PurchaseKpiTile } from '@/app/transactions/purchase/components/PurchaseKpiTile';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchGeneralLedger, type GeneralLedger } from '@/lib/generalLedgerStore';
import { printReport, type PrintFormat, type PrintReport, type PrintRow, type PrintRowStyle } from '@/lib/printExport';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import {
  NeutralSelect, StatusBadge, PERIODS, rangeFor, fmtDate, fmtNumber, inputClass, isUnposted, statusText,
  type PeriodId,
} from '@/app/reports/general-ledger/components/GeneralLedgerClient';

// Reports > Journal Report. Laporan murni (read-only): semua jurnal pada periode terpilih,
// satu jurnal = satu kartu berisi baris debit/kredit-nya.
//
// SUMBER DATA = endpoint General Ledger yang sama (/api/v1/reports/general-ledger), sehingga
// angka Journal Report SELALU sama dengan General Ledger & Trial Balance (status, jurnal
// penyesuaian, transaksi yang dikecualikan semuanya ikut aturan GL). Baris GL per akun
// dikelompokkan ulang per nomor jurnal di sini -- tidak perlu endpoint backend baru.

interface JeLine {
  code: string;
  name: string;
  description: string;
  party: string;
  debit: number;
  credit: number;
}

interface Journal {
  key: string;
  date: string;
  source: string;
  number: string;
  status?: string;
  isAdjustment: boolean;
  description: string;
  lines: JeLine[];
  debit: number;
  credit: number;
}

function groupJournals(gl: GeneralLedger): Journal[] {
  const map = new Map<string, Journal>();
  let orphan = 0;
  gl.accounts.forEach(a => {
    a.lines.forEach(l => {
      // Baris tanpa nomor jurnal tidak bisa digabung -> jadi jurnal sendiri.
      const key = l.number ? `${l.source}|${l.number}` : `__no_number_${orphan++}`;
      let j = map.get(key);
      if (!j) {
        j = {
          key, date: l.date, source: l.source, number: l.number, status: l.status,
          isAdjustment: !!l.is_adjustment, description: l.description || '', lines: [], debit: 0, credit: 0,
        };
        map.set(key, j);
      }
      if (!j.description && l.description) j.description = l.description;
      j.lines.push({
        code: a.account_code, name: a.account_name, description: l.description || '', party: l.party || '',
        debit: l.debit || 0, credit: l.credit || 0,
      });
      j.debit += l.debit || 0;
      j.credit += l.credit || 0;
    });
  });
  return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date) || x.number.localeCompare(y.number));
}

const isBalanced = (j: Journal) => Math.abs(j.debit - j.credit) < 0.005;
const fmtAmount = (n: number) => (n ? fmtNumber(n) : '–');

function buildPrintReport(journals: Journal[], start: string, end: string, companyName: string, printedBy?: string): PrintReport {
  const rows: PrintRow[] = [];
  const rowStyles: (PrintRowStyle | undefined)[] = [];
  const push = (row: PrintRow, style?: PrintRowStyle) => { rows.push(row); rowStyles.push(style); };
  let td = 0;
  let tc = 0;
  journals.forEach(j => {
    push({
      date: j.date, source: j.source, number: j.number || '–', status: statusText(j.status),
      account: j.isAdjustment ? `${j.description || ''} (Adjustment)` : j.description || '',
    }, 'section');
    j.lines.forEach(l => push({
      account: `${kodeAkun(l.code)} — ${l.name}`, description: l.description, debit: l.debit || null, credit: l.credit || null,
    }));
    push({ account: `Total ${j.number || 'journal'}`, debit: j.debit, credit: j.credit }, 'total');
    td += j.debit;
    tc += j.credit;
  });
  return {
    title: 'Journal Report',
    fileBase: `Journal-Report-${start}_to_${end}`,
    companyName,
    subtitle: `Period ${fmtDate(start)} – ${fmtDate(end)} · ${journals.length} journals`,
    orientation: 'landscape',
    printedBy,
    table: {
      columns: [
        { key: 'date', header: 'Date', width: 14 },
        { key: 'source', header: 'Source', width: 14 },
        { key: 'number', header: 'Journal No.', width: 22 },
        { key: 'status', header: 'Status', width: 12 },
        { key: 'account', header: 'Account', width: 44 },
        { key: 'description', header: 'Description', width: 40 },
        { key: 'debit', header: 'Debit', type: 'money', width: 18 },
        { key: 'credit', header: 'Credit', type: 'money', width: 18 },
      ],
      rows,
      rowStyles,
      totals: { account: 'GRAND TOTAL', debit: td, credit: tc },
    },
  };
}

function JournalCard({ j, expanded, onToggle }: { j: Journal; expanded: boolean; onToggle: () => void }) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-neutral-300 bg-white shadow-sm transition-colors duration-200 hover:border-neutral-500">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`w-full grid grid-cols-[1.25rem_minmax(0,1fr)] lg:grid-cols-[1.25rem_7rem_minmax(0,1fr)_9rem_9rem] items-center gap-x-4 gap-y-2 px-4 py-3.5 text-left hover:bg-neutral-50 ${expanded ? 'bg-neutral-50 border-b border-neutral-300' : ''}`}
      >
        <span className="text-neutral-500">{expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}</span>
        <span className="text-sm font-medium text-neutral-900 whitespace-nowrap">{fmtDate(j.date)}</span>
        <span className="min-w-0 flex items-center gap-2.5 flex-wrap">
          <span className="font-mono text-sm font-semibold text-neutral-900">{j.number || '–'}</span>
          <span className="text-xs text-neutral-500">{j.source}</span>
          <StatusBadge status={j.status} />
          {j.isAdjustment && <span className="rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-700">Adjustment</span>}
          {!isBalanced(j) && <span className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800">Not balanced</span>}
          <span className="text-sm text-neutral-700 truncate">{j.description}</span>
        </span>
        <Figure label="Debit" value={fmtAmount(j.debit)} />
        <Figure label="Credit" value={fmtAmount(j.credit)} />
      </button>

      {expanded && (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="bg-neutral-300 text-xs uppercase tracking-wide text-black">
                <th className="text-left font-bold border-t border-b border-neutral-800 px-4 py-2.5 w-36">Account Code</th>
                <th className="text-left font-bold border-t border-b border-neutral-800 px-3 py-2.5">Account Name</th>
                <th className="text-left font-bold border-t border-b border-neutral-800 px-3 py-2.5">Description</th>
                <th className="text-right font-bold border-t border-b border-neutral-800 px-3 py-2.5 w-36">Debit</th>
                <th className="text-right font-bold border-t border-b border-neutral-800 px-4 py-2.5 w-36">Credit</th>
              </tr>
            </thead>
            <tbody>
              {j.lines.map((l, i) => (
                <tr key={`${l.code}-${i}`} className="border-t border-neutral-200 transition-colors hover:bg-neutral-50">
                  <td className="px-4 py-2 font-mono text-neutral-900 whitespace-nowrap">{kodeAkun(l.code)}</td>
                  <td className={`px-3 py-2 text-neutral-900 ${l.credit && !l.debit ? 'pl-8' : ''}`}>{l.name}</td>
                  <td className="px-3 py-2 text-neutral-500">{l.description || '–'}{l.party ? ` · ${l.party}` : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtAmount(l.debit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtAmount(l.credit)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-neutral-800 bg-neutral-50 font-semibold">
                <td className="px-4 py-2.5 text-neutral-900" colSpan={3}>Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{fmtAmount(j.debit)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{fmtAmount(j.credit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="col-start-2 lg:col-start-auto flex lg:block items-baseline justify-between lg:text-right">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{label}</span>
      <span className="block tabular-nums text-sm font-medium text-neutral-800">{value}</span>
    </span>
  );
}

export default function JournalReportClient() {
  useKodeAkun(); // re-render saat peta kode akun dimuat
  const { clients, activeClientId, activeClientName, hydrated } = useActiveClient();
  const { user } = useAuth();

  const initial = rangeFor('this_month')!;
  const [period, setPeriod] = useState<PeriodId>('this_month');
  const [startDate, setStartDate] = useState(initial.start);
  const [endDate, setEndDate] = useState(initial.end);
  const [sourceFilter, setSourceFilter] = useState('all');
  const [data, setData] = useState<GeneralLedger | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState<PrintFormat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const companyName = activeClientName ?? clients.find(c => c.id === activeClientId)?.companyName ?? '';

  useEffect(() => {
    abortRef.current?.abort();
    setData(null);
    setError(null);
    setExpanded(new Set());
    setSourceFilter('all');
  }, [activeClientId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!downloadOpen) return;
    const close = (e: MouseEvent) => { if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) setDownloadOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [downloadOpen]);

  const changePeriod = (p: PeriodId) => {
    setPeriod(p);
    const r = rangeFor(p);
    if (r) { setStartDate(r.start); setEndDate(r.end); }
  };

  const validation = !activeClientId
    ? 'Select a company first.'
    : !startDate || !endDate
      ? 'Start date and end date are required.'
      : startDate > endDate
        ? 'Start date must be on or before end date.'
        : null;

  const runQuery = async (start: string, end: string) => {
    if (!activeClientId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const gl = await fetchGeneralLedger({ managementClientId: activeClientId, startDate: start, endDate: end, include: 'with_activity' }, ctrl.signal);
      setData(gl);
      setExpanded(new Set());
      setSearch('');
      setSourceFilter('all');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load journal report');
      setData(null);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  };

  const apply = () => { if (!validation) runQuery(startDate, endDate); };

  // Dari halaman Reports: /reports/journal-report?start=..&end=.. -> periode diisi & langsung dijalankan sekali.
  const searchParams = useSearchParams();
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !hydrated || !activeClientId) return;
    const s = searchParams.get('start');
    const e = searchParams.get('end');
    if (!s || !e || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e) || s > e) return;
    autoDone.current = true;
    setPeriod('custom');
    setStartDate(s);
    setEndDate(e);
    runQuery(s, e);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dijalankan sekali per kunjungan
  }, [hydrated, activeClientId, searchParams]);

  const reset = () => {
    abortRef.current?.abort();
    setLoading(false);
    changePeriod('this_month');
    setData(null);
    setError(null);
  };

  const journals = useMemo(() => (data ? groupJournals(data) : []), [data]);
  const sources = useMemo(() => Array.from(new Set(journals.map(j => j.source))).sort(), [journals]);
  const sourceOptions = useMemo(
    () => [{ id: 'all', label: 'All sources' }, ...sources.map(s => ({ id: s, label: s }))],
    [sources],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return journals.filter(j => {
      if (sourceFilter !== 'all' && j.source !== sourceFilter) return false;
      if (!q) return true;
      return j.number.toLowerCase().includes(q) || j.description.toLowerCase().includes(q)
        || j.lines.some(l => l.name.toLowerCase().includes(q) || kodeAkun(l.code).toLowerCase().includes(q));
    });
  }, [journals, sourceFilter, search]);

  const allExpanded = visible.length > 0 && visible.every(j => expanded.has(j.key));
  const toggle = (key: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const totalDebit = visible.reduce((s, j) => s + j.debit, 0);
  const totalCredit = visible.reduce((s, j) => s + j.credit, 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.005;
  const unposted = visible.filter(j => isUnposted(j.status)).length;
  const unbalanced = visible.filter(j => !isBalanced(j)).length;

  const download = async (format: PrintFormat) => {
    if (!data || visible.length === 0) return;
    setDownloadOpen(false);
    setDownloading(format);
    try {
      await printReport(buildPrintReport(visible, data.filter.start_date, data.filter.end_date, companyName, user?.nama || user?.username), format);
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className={`${salesFont.className} px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-5 fade-in`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <Link href="/reports" className="mb-2 inline-flex items-center gap-1.5 text-sm font-medium text-neutral-500 transition-colors hover:text-neutral-900">
            <ArrowLeft size={15} /> Reports
          </Link>
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-neutral-900">
            <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-neutral-100 ring-1 ring-neutral-200">
              <NotebookText size={22} className="text-neutral-700" />
            </span>
            Journal Report
          </h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">
            All journal entries in the selected period, with their debit and credit lines{companyName ? ` · ${companyName}` : ''}.
          </p>
        </div>

        <div className="relative" ref={downloadRef}>
          <button
            type="button"
            onClick={() => setDownloadOpen(o => !o)}
            disabled={!data || visible.length === 0 || downloading !== null}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download <ChevronDown size={15} />
          </button>
          {downloadOpen && (
            <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-neutral-300 bg-white py-1 shadow-lg">
              {([
                ['pdf', 'PDF', FileText],
                ['csv', 'CSV', FileText],
                ['excel', 'Excel (XLSX)', FileSpreadsheet],
              ] as const).map(([fmt, label, Icon]) => (
                <button key={fmt} type="button" onClick={() => download(fmt)} className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200">
                  <Icon size={16} className="text-neutral-600" /> {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter */}
      <form onSubmit={e => { e.preventDefault(); apply(); }} className="relative space-y-4 rounded-[10px] border border-neutral-300 bg-white p-5 pt-6 shadow-sm">
        <span className="absolute inset-x-0 top-0 h-0.5 rounded-t-[10px] bg-neutral-800" />
        <KpiSectionLabel><Filter size={14} className="text-neutral-700" /> Filters</KpiSectionLabel>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Period</span>
            <NeutralSelect value={period} onChange={changePeriod} options={PERIODS} />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">Start Date</span>
            <input type="date" value={startDate} max={endDate || undefined} onChange={e => { setStartDate(e.target.value); setPeriod('custom'); }} className={inputClass} required />
          </label>
          <label className="block">
            <span className="block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5">End Date</span>
            <input type="date" value={endDate} min={startDate || undefined} onChange={e => { setEndDate(e.target.value); setPeriod('custom'); }} className={inputClass} required />
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className={`text-xs font-medium ${validation && hydrated ? 'text-amber-700' : 'text-neutral-500'}`}>
            {hydrated && validation ? validation : 'Same data source as the General Ledger: every journal in Journal Preview, including unposted ones (see the Status badge). Rejected and voided are excluded.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
              <RotateCcw size={15} /> Reset
            </button>
            <button type="submit" disabled={!!validation || loading} className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply Filter
            </button>
          </div>
        </div>
      </form>

      {error && <div className="border border-neutral-800 bg-neutral-100 text-neutral-900 rounded-[10px] px-4 py-3 text-sm">{error}</div>}

      {!data && !loading && !error && (
        <div className="bg-white border border-dashed border-neutral-300 rounded-[10px] p-12 text-center">
          <NotebookText size={30} className="mx-auto text-neutral-300 mb-3" />
          <p className="text-sm font-semibold text-neutral-900">Set your filters to view the journal report</p>
          <p className="text-xs text-neutral-500 mt-1">Choose a period or date range, then click <b>Apply Filter</b>.</p>
        </div>
      )}

      {loading && !data && (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-[10px] bg-neutral-100 animate-pulse" />)}</div>
      )}

      {data && (
        <div className={`space-y-4 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          <div>
            <KpiSectionLabel>Journal Summary</KpiSectionLabel>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <PurchaseKpiTile
                label="Journals" value={visible.length.toLocaleString('id-ID')} icon={Layers}
                sub={`${sources.length} source${sources.length === 1 ? '' : 's'}`}
                pct={journals.length > 0 ? (visible.length / journals.length) * 100 : 0} pctLabel="of journals in period"
              />
              <PurchaseKpiTile
                label="Not Posted" value={unposted.toLocaleString('id-ID')} icon={NotebookText}
                sub="Draft, pending, or approved"
                pct={visible.length > 0 ? (unposted / visible.length) * 100 : 0} pctLabel="of journals"
              />
              <PurchaseKpiTile
                label="Total Debit" value={fmtNumber(totalDebit)} icon={ArrowDownToLine}
                sub={balanced ? 'Balanced with credit' : `Difference ${fmtNumber(totalDebit - totalCredit)}`}
                pct={totalCredit > 0 ? (totalDebit / totalCredit) * 100 : totalDebit > 0 ? 100 : 0} pctLabel="of total credit"
              />
              <PurchaseKpiTile
                label="Total Credit" value={fmtNumber(totalCredit)} icon={ArrowUpFromLine}
                sub={balanced ? 'Balanced with debit' : `Difference ${fmtNumber(totalCredit - totalDebit)}`}
                pct={totalDebit > 0 ? (totalCredit / totalDebit) * 100 : totalCredit > 0 ? 100 : 0} pctLabel="of total debit"
              />
            </div>
          </div>

          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <p className="text-sm text-neutral-500">{fmtDate(data.filter.start_date)} – {fmtDate(data.filter.end_date)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-44"><NeutralSelect value={sourceFilter} onChange={setSourceFilter} options={sourceOptions} /></div>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Find journal no., description, account"
                  className="w-72 rounded-lg border border-neutral-300 bg-white py-2 pl-8 pr-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                />
              </div>
              <button
                type="button"
                onClick={() => setExpanded(allExpanded ? new Set() : new Set(visible.map(j => j.key)))}
                disabled={visible.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
              >
                {allExpanded ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
                {allExpanded ? 'Collapse all' : 'Expand all'}
              </button>
            </div>
          </div>

          {unposted > 0 && (
            <div className="rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
              {unposted.toLocaleString('id-ID')} journals are not posted yet (draft, pending, or approved). They are included here, same as in the General Ledger.
            </div>
          )}
          {unbalanced > 0 && (
            <div className="rounded-[10px] border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900">
              {unbalanced.toLocaleString('id-ID')} journals have debit ≠ credit within this period. Check them before closing the books.
            </div>
          )}

          {visible.length === 0 ? (
            <div className="bg-white border border-dashed border-neutral-300 rounded-[10px] p-10 text-center">
              <p className="text-sm font-semibold text-neutral-900">No journals to show</p>
              <p className="text-xs text-neutral-500 mt-1">{search || sourceFilter !== 'all' ? 'No journal matches your search or source filter.' : 'There are no journals for this period.'}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visible.map(j => <JournalCard key={j.key} j={j} expanded={expanded.has(j.key)} onToggle={() => toggle(j.key)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
