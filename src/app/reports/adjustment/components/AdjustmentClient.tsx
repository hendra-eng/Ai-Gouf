'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Download, FileSpreadsheet, FileText,
  Filter, Info, Loader2, RotateCcw, Scale, Search, SlidersHorizontal, TrendingDown, TrendingUp,
} from 'lucide-react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { KpiSectionLabel, PurchaseKpiTile } from '@/app/transactions/purchase/components/PurchaseKpiTile';
import { useActiveClient } from '@/lib/activeClient';
import { useAuth } from '@/lib/auth';
import { fetchTrialBalancePeriods, type TbPeriods } from '@/lib/trialBalanceStore';
import { fetchAdjustment, type AdjEntry, type AdjStatusFilter, type AdjTbRow, type AdjustmentReport } from '@/lib/adjustmentStore';
import { printReport, type PrintColumn, type PrintFormat, type PrintReport, type PrintRow, type PrintRowStyle } from '@/lib/printExport';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { readReportPeriodParams } from '@/lib/reportPeriodQuery';

// Reports > Adjustment. Dua tampilan dari satu sumber data:
//   1) Adjusting Journals   -- jurnal bertanda "Adjusting entry", dikelompokkan per jurnal.
//   2) Effect on Trial Balance -- Unadjusted + ADJ = Adjusted per akun yang tersentuh
//      (padanan kolom ADJ di sheet TB Excel). Trial Balance resmi tetap dari halaman
//      Trial Balance; jurnal penyesuaian sudah ikut di sana seperti jurnal biasa.
// Sumber data = SAMA dengan General Ledger / Trial Balance (Journal Preview: draft, pending,
// approved, posted). Filter "Posted only" = angka resmi.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_OPTIONS: { id: AdjStatusFilter; label: string }[] = [
  { id: 'all', label: 'All journals (incl. not yet posted)' },
  { id: 'posted', label: 'Posted only' },
];

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft', pending: 'Pending', approved: 'Approved', posted: 'Posted', exception: 'Exception',
};
const statusLabel = (s: string) => STATUS_LABEL[s?.toLowerCase()] ?? (s || '–');

const fmtNumber = (n: number) => Math.abs(n).toLocaleString('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** 0 -> "–"; negatif -> "(1.000)". */
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Math.abs(n) < 0.005) return '–';
  return n < 0 ? `(${fmtNumber(n)})` : fmtNumber(n);
}
const fmtDate = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const inputClass = 'w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm transition-colors focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300';
const labelClass = 'block text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-1.5';
const TH = 'border-t border-b border-neutral-800 bg-neutral-300 text-[11px] font-bold uppercase tracking-wide text-black';

type Tab = 'journals' | 'effect';

// ── Export ───────────────────────────────────────────────────────────

function periodText(d: AdjustmentReport) {
  return `Jan – ${MONTH_NAMES[d.periode.end_month - 1]} ${d.periode.year} · ${d.filter.status_filter === 'posted' ? 'Posted journals only' : 'All journals in Journal Preview (incl. not yet posted)'}`;
}

function buildJournalsReport(d: AdjustmentReport, entries: AdjEntry[], companyName: string, printedBy?: string): PrintReport {
  const columns: PrintColumn[] = [
    { key: 'code', header: 'No Account', width: 14 },
    { key: 'name', header: 'Account', width: 40 },
    { key: 'desc', header: 'Description', width: 36 },
    { key: 'debit', header: 'Debit', type: 'money', width: 18 },
    { key: 'kredit', header: 'Credit', type: 'money', width: 18 },
  ];
  const rows: PrintRow[] = [];
  const styles: (PrintRowStyle | undefined)[] = [];
  entries.forEach(e => {
    rows.push({ code: `${e.number} · ${fmtDate(e.date)} · ${statusLabel(e.status)}`, name: e.description }); styles.push('section');
    e.lines.forEach(l => { rows.push({ code: kodeAkun(l.account_code), name: l.account_name, desc: l.description, debit: l.debit || null, kredit: l.kredit || null }); styles.push(undefined); });
    rows.push({ name: `Total ${e.number}`, debit: e.total_debit, kredit: e.total_kredit }); styles.push('total');
  });
  const td = entries.reduce((s, e) => s + e.total_debit, 0);
  const tk = entries.reduce((s, e) => s + e.total_kredit, 0);
  return {
    title: 'Adjusting Journals',
    fileBase: `Adjusting-Journals-${d.periode.year}-${MONTH_NAMES[d.periode.end_month - 1]}`,
    companyName,
    subtitle: periodText(d),
    orientation: 'landscape',
    printedBy,
    table: { columns, rows, rowStyles: styles, totals: { name: 'TOTAL', debit: td, kredit: tk } },
  };
}

function buildEffectReport(d: AdjustmentReport, rows_: AdjTbRow[], companyName: string, printedBy?: string): PrintReport {
  const columns: PrintColumn[] = [
    { key: 'code', header: 'No Account', width: 14 },
    { key: 'name', header: 'Account', width: 40 },
    { key: 'ud', header: 'Unadjusted Debit', type: 'money', width: 20 },
    { key: 'uk', header: 'Unadjusted Credit', type: 'money', width: 20 },
    { key: 'ad', header: 'ADJ Debit', type: 'money', width: 18 },
    { key: 'ak', header: 'ADJ Credit', type: 'money', width: 18 },
    { key: 'jd', header: 'Adjusted Debit', type: 'money', width: 20 },
    { key: 'jk', header: 'Adjusted Credit', type: 'money', width: 20 },
  ];
  const t = d.tb_effect_totals;
  return {
    title: 'Adjustment — Effect on Trial Balance',
    fileBase: `Adjustment-Effect-${d.periode.year}-${MONTH_NAMES[d.periode.end_month - 1]}`,
    companyName,
    subtitle: `${periodText(d)} · Only accounts touched by an adjusting journal`,
    orientation: 'landscape',
    printedBy,
    table: {
      columns,
      rows: rows_.map(r => ({
        code: kodeAkun(r.account_code), name: r.account_name,
        ud: r.unadj_debit || null, uk: r.unadj_kredit || null, ad: r.adj_debit || null, ak: r.adj_kredit || null,
        jd: r.adjusted_debit || null, jk: r.adjusted_kredit || null,
      })),
      totals: { name: 'TOTAL', ud: t.unadj_debit, uk: t.unadj_kredit, ad: t.adj_debit, ak: t.adj_kredit, jd: t.adjusted_debit, jk: t.adjusted_kredit },
    },
  };
}

// ── Tabel ────────────────────────────────────────────────────────────

function Num({ v, bold, shaded }: { v: number; bold?: boolean; shaded?: boolean }) {
  return (
    <td className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${bold ? 'font-semibold text-neutral-900' : 'text-neutral-800'} ${shaded ? 'bg-neutral-50' : ''}`}>
      {fmt(v)}
    </td>
  );
}

function JournalsTable({ entries }: { entries: AdjEntry[] }) {
  const td = entries.reduce((s, e) => s + e.total_debit, 0);
  const tk = entries.reduce((s, e) => s + e.total_kredit, 0);
  return (
    <div className="overflow-x-auto rounded-[10px] border border-neutral-300 bg-white shadow-sm">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className={TH}>
            <th className="px-4 py-2.5 text-left">No Account</th>
            <th className="px-3 py-2.5 text-left">Account</th>
            <th className="px-3 py-2.5 text-right">Debit</th>
            <th className="px-3 py-2.5 text-right">Credit</th>
          </tr>
        </thead>
        {entries.map(e => (
          <tbody key={e.id} className="border-t border-neutral-300">
            <tr className="bg-neutral-100">
              <td colSpan={4} className="px-4 py-2.5">
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-semibold text-neutral-900">{e.number}</span>
                  <span className="text-neutral-500">{fmtDate(e.date)}</span>
                  <span className="min-w-0 flex-1 truncate text-neutral-800">{e.description}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${e.posted ? 'border-neutral-400 text-neutral-700' : 'border-amber-400 bg-amber-50 text-amber-900'}`}>
                    {statusLabel(e.status)}
                  </span>
                </span>
              </td>
            </tr>
            {e.lines.map((l, i) => (
              <tr key={i} className="border-t border-neutral-200 hover:bg-neutral-50">
                <td className="w-28 px-4 py-2 font-mono text-xs text-neutral-900">{kodeAkun(l.account_code)}</td>
                <td className={`px-3 py-2 text-neutral-900 ${l.kredit > 0 ? 'pl-8' : ''}`}>{l.account_name}</td>
                <Num v={l.debit} />
                <Num v={l.kredit} />
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-t-2 border-neutral-800 bg-neutral-50 font-semibold">
            <td colSpan={2} className="px-4 py-2.5 text-neutral-900">Total</td>
            <Num v={td} bold /><Num v={tk} bold />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function EffectTable({ rows, totals, start, end }: { rows: AdjTbRow[]; totals: AdjustmentReport['tb_effect_totals']; start: string; end: string }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-neutral-300 bg-white shadow-sm">
      <table className="w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className={TH}>
            <th rowSpan={2} className="px-4 py-2.5 text-left align-bottom">No Account</th>
            <th rowSpan={2} className="px-3 py-2.5 text-left align-bottom">Account</th>
            <th colSpan={2} className="px-3 py-1.5 text-center">Unadjusted</th>
            <th colSpan={2} className="px-3 py-1.5 text-center bg-neutral-400">ADJ</th>
            <th colSpan={2} className="px-3 py-1.5 text-center">Adjusted</th>
          </tr>
          <tr className={TH}>
            {['Debit', 'Credit'].map(h => <th key={`u${h}`} className="px-3 py-1.5 text-right">{h}</th>)}
            {['Debit', 'Credit'].map(h => <th key={`a${h}`} className="px-3 py-1.5 text-right bg-neutral-400">{h}</th>)}
            {['Debit', 'Credit'].map(h => <th key={`j${h}`} className="px-3 py-1.5 text-right">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.account_code} className="border-t border-neutral-200 hover:bg-neutral-50">
              <td className="w-28 px-4 py-2 font-mono text-xs">
                <Link
                  href={`/reports/general-ledger?account=${encodeURIComponent(r.account_code)}&start=${start}&end=${end}`}
                  className="text-neutral-900 underline decoration-neutral-300 underline-offset-2 hover:decoration-neutral-700"
                  title="Open in General Ledger"
                >
                  {kodeAkun(r.account_code)}
                </Link>
              </td>
              <td className="px-3 py-2 text-neutral-900">{r.account_name}</td>
              <Num v={r.unadj_debit} /><Num v={r.unadj_kredit} />
              <Num v={r.adj_debit} shaded bold /><Num v={r.adj_kredit} shaded bold />
              <Num v={r.adjusted_debit} bold /><Num v={r.adjusted_kredit} bold />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-800 bg-neutral-50 font-semibold">
            <td colSpan={2} className="px-4 py-2.5 text-neutral-900">Total</td>
            <Num v={totals.unadj_debit} bold /><Num v={totals.unadj_kredit} bold />
            <Num v={totals.adj_debit} bold shaded /><Num v={totals.adj_kredit} bold shaded />
            <Num v={totals.adjusted_debit} bold /><Num v={totals.adjusted_kredit} bold />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Halaman ──────────────────────────────────────────────────────────

export default function AdjustmentClient() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { clients, activeClientId, activeClientName, hydrated } = useActiveClient();
  const { user } = useAuth();

  const [periods, setPeriods] = useState<TbPeriods | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [endMonth, setEndMonth] = useState<number>(12);
  const [statusFilter, setStatusFilter] = useState<AdjStatusFilter>('all');
  const [data, setData] = useState<AdjustmentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('journals');
  const [search, setSearch] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [downloading, setDownloading] = useState<PrintFormat | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<HTMLDivElement>(null);

  const companyName = activeClientName ?? clients.find(c => c.id === activeClientId)?.companyName ?? '';

  const runQuery = useCallback(async (q: { year: number; endMonth: number; statusFilter: AdjStatusFilter }) => {
    if (!activeClientId) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      setData(await fetchAdjustment({ managementClientId: activeClientId, ...q }, ctrl.signal));
      setSearch('');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Failed to load adjustment report');
      setData(null);
    } finally {
      if (abortRef.current === ctrl) setLoading(false);
    }
  }, [activeClientId]);

  // Klien aktif siap / berganti -> muat daftar tahun, lalu tampilkan tahun terbaru.
  useEffect(() => {
    abortRef.current?.abort();
    setData(null);
    setError(null);
    setPeriods(null);
    if (!hydrated || !activeClientId) return;
    const ctrl = new AbortController();
    fetchTrialBalancePeriods(activeClientId, statusFilter, ctrl.signal)
      .then(p => {
        setPeriods(p);
        // Dari halaman Reports: ?year=2026&month=10 -> periode terpilih dipakai; selain itu default.
        const dariReports = readReportPeriodParams(window.location.search);
        const y = dariReports ? dariReports.year : p.default_year;
        const m = dariReports ? dariReports.month : 12;
        setYear(y);
        setEndMonth(m);
        runQuery({ year: y, endMonth: m, statusFilter });
      })
      .catch(e => { if ((e as Error).name !== 'AbortError') setError(e instanceof Error ? e.message : 'Failed to load periods'); });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat klien aktif berganti
  }, [hydrated, activeClientId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!downloadOpen) return;
    const close = (e: MouseEvent) => { if (downloadRef.current && !downloadRef.current.contains(e.target as Node)) setDownloadOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [downloadOpen]);

  const yearOptions = useMemo(() => {
    const ys = periods?.years.map(y => y.year) ?? [];
    if (!ys.includes(year)) ys.unshift(year);
    return ys;
  }, [periods, year]);

  const q = search.trim().toLowerCase();
  const matches = (code: string, name: string) => !q || code.toLowerCase().includes(q) || kodeAkun(code).toLowerCase().includes(q) || name.toLowerCase().includes(q);
  const entries = useMemo(() => (data?.entries ?? [])
    .map(e => ({ ...e, lines: e.lines.filter(l => matches(l.account_code, l.account_name) || e.number.toLowerCase().includes(q)) }))
    .filter(e => e.lines.length > 0), // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, q]);
  const effectRows = useMemo(() => (data?.tb_effect ?? []).filter(r => matches(r.account_code, r.account_name)), // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, q]);

  const validation = !activeClientId ? 'Select a company first.' : null;
  const apply = () => { if (!validation) runQuery({ year, endMonth, statusFilter }); };
  const reset = () => {
    const y = periods?.default_year ?? new Date().getFullYear();
    setYear(y); setEndMonth(12); setStatusFilter('all');
    runQuery({ year: y, endMonth: 12, statusFilter: 'all' });
  };

  const download = async (format: PrintFormat) => {
    if (!data) return;
    setDownloadOpen(false);
    setDownloading(format);
    try {
      const by = user?.nama || user?.username;
      await printReport(tab === 'journals' ? buildJournalsReport(data, entries, companyName, by) : buildEffectReport(data, effectRows, companyName, by), format);
    } finally {
      setDownloading(null);
    }
  };

  const s = data?.summary;
  const profitEffect = s?.net_profit_effect ?? 0;

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
              <SlidersHorizontal size={22} className="text-neutral-700" />
            </span>
            Adjustment
          </h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">
            Adjusting journals and their effect on the trial balance{companyName ? ` · ${companyName}` : ''}.
          </p>
        </div>

        <div className="relative" ref={downloadRef}>
          <button
            type="button" onClick={() => setDownloadOpen(o => !o)}
            disabled={!data || !data.has_data || downloading !== null}
            aria-haspopup="menu" aria-expanded={downloadOpen}
            className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Download <ChevronDown size={15} />
          </button>
          {downloadOpen && (
            <div role="menu" className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-neutral-300 bg-white py-1 shadow-lg">
              {([['pdf', 'PDF', FileText], ['csv', 'CSV', FileText], ['excel', 'Excel (XLSX)', FileSpreadsheet]] as const).map(([fmtId, label, Icon]) => (
                <button
                  key={fmtId} type="button" role="menuitem" onClick={() => download(fmtId)}
                  className="w-full flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-neutral-200"
                >
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
        <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-[8rem_10rem_minmax(0,22rem)] gap-4">
          <label className="block">
            <span className={labelClass}>Year</span>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className={inputClass}>
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Until</span>
            <select value={endMonth} onChange={e => setEndMonth(Number(e.target.value))} className={inputClass}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>Up to {m}</option>)}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Journal Status</span>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as AdjStatusFilter)} className={inputClass}>
              {STATUS_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
          <p className={`text-xs font-medium ${validation && hydrated ? 'text-amber-700' : 'text-neutral-500'}`}>
            {hydrated && validation ? validation : 'Shows journals marked “Adjusting entry” in Transactions › Journal Entry. They are already part of the General Ledger and Trial Balance.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={reset} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
              <RotateCcw size={15} /> Reset
            </button>
            <button
              type="submit" disabled={!!validation || loading}
              className="inline-flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-800 px-5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Filter size={15} />} Apply Filter
            </button>
          </div>
        </div>
      </form>

      {error && <div role="alert" className="border border-neutral-800 bg-neutral-100 text-neutral-900 rounded-[10px] px-4 py-3 text-sm">{error}</div>}

      {loading && !data && (
        <div className="space-y-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-16 rounded-[10px] bg-neutral-100 animate-pulse" />)}</div>
      )}

      {data && s && (
        <div className={`space-y-4 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
          {!data.has_data ? (
            <div className="bg-white border border-dashed border-neutral-300 rounded-[10px] p-10 text-center">
              <SlidersHorizontal size={30} className="mx-auto text-neutral-300 mb-3" />
              <p className="text-sm font-semibold text-neutral-900">No adjusting journals for this period</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-neutral-500">
                To list a journal here, tick <b>Adjusting entry</b> when creating it in Transactions › Journal Entry.
                Journals created before this feature are not marked automatically.
              </p>
              <Link href="/transactions/journal-entry" className="mt-4 inline-flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-900 shadow-sm hover:border-neutral-700">
                Open Journal Entry
              </Link>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <div className={`flex items-start gap-2.5 rounded-[10px] border px-4 py-3 text-sm ${s.balanced ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-red-300 bg-red-50 text-red-900'}`}>
                  {s.balanced ? <CheckCircle2 size={18} className="mt-0.5 shrink-0" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0" />}
                  <p>{s.balanced ? `Balanced: total debit equals total credit (${fmtNumber(s.total_debit)}).` : `Out of balance: debit − credit = ${fmtNumber(s.total_debit - s.total_kredit)}.`}</p>
                </div>
                {s.unposted_entries > 0 && (
                  <div className="flex items-start gap-2.5 rounded-[10px] border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <AlertTriangle size={18} className="mt-0.5 shrink-0" />
                    <p>{s.unposted_entries} adjusting journal(s) are not posted yet. They are included here and in the Trial Balance. Switch to “Posted only” for official figures.</p>
                  </div>
                )}
              </div>

              <div>
                <KpiSectionLabel>Adjustment Summary · Jan – {MONTH_NAMES[data.periode.end_month - 1]} {data.periode.year}</KpiSectionLabel>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <PurchaseKpiTile label="Adjusting Entries" value={s.entry_count.toLocaleString('id-ID')} icon={SlidersHorizontal} sub={`${s.line_count.toLocaleString('id-ID')} journal lines`} pct={100} pctLabel="in this period" />
                  <PurchaseKpiTile label="Total Debit" value={fmtNumber(s.total_debit)} icon={Scale} sub="Adjusting journals" pct={s.total_debit ? 100 : 0} pctLabel="debit side" />
                  <PurchaseKpiTile label="Total Credit" value={fmtNumber(s.total_kredit)} icon={Scale} sub={s.balanced ? 'Balanced' : 'Needs review'} pct={s.balanced ? 100 : 0} pctLabel={s.balanced ? 'balanced' : 'out of balance'} />
                  <PurchaseKpiTile
                    label="Effect on Net Profit" value={`${profitEffect < 0 ? '−' : profitEffect > 0 ? '+' : ''}${fmtNumber(profitEffect)}`}
                    icon={profitEffect < 0 ? TrendingDown : TrendingUp}
                    sub={profitEffect < 0 ? 'Profit decreases' : profitEffect > 0 ? 'Profit increases' : 'No P&L impact'} pct={profitEffect ? 100 : 0} pctLabel="P&L accounts only"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                <div role="tablist" aria-label="Adjustment views" className="flex gap-1 border-b border-neutral-300">
                  {([['journals', 'Adjusting Journals'], ['effect', 'Effect on Trial Balance']] as const).map(([id, label]) => (
                    <button
                      key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
                      className={`-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors ${tab === id ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:text-neutral-900'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    value={search} onChange={e => setSearch(e.target.value)} placeholder="Find account or journal" aria-label="Find account or journal"
                    className="w-64 rounded-lg border border-neutral-300 bg-white py-2 pl-8 pr-3 text-sm text-neutral-900 shadow-sm placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              </div>

              {tab === 'journals' ? (
                entries.length === 0 ? <NoMatch /> : <JournalsTable entries={entries} />
              ) : (
                <>
                  <p className="flex items-start gap-2 text-sm text-neutral-500">
                    <Info size={15} className="mt-0.5 shrink-0" />
                    Only accounts touched by an adjusting journal are listed. Unadjusted + ADJ = Adjusted. Click an account code to open it in the General Ledger.
                  </p>
                  {effectRows.length === 0 ? <NoMatch /> : <EffectTable rows={effectRows} totals={data.tb_effect_totals} start={data.periode.start_date} end={data.periode.end_date} />}
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NoMatch() {
  return (
    <div className="bg-white border border-dashed border-neutral-300 rounded-[10px] p-10 text-center">
      <Search size={26} className="mx-auto text-neutral-300 mb-3" />
      <p className="text-sm font-semibold text-neutral-900">Nothing matches your search</p>
    </div>
  );
}
