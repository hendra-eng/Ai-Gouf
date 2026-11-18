'use client';

// Tab Overview halaman Transactions > Journal Entry.
// Seluruh tampilan (kartu KPI, chart tren, donut, kartu peringkat, tabel, font, warna)
// disamakan 1:1 dengan tab Overview Sales (SalesOverview.tsx) supaya satu tema desain
// monokrom yang elegan. Sumber data TIDAK berubah: useJeDrafts & useJeActivityLogs.

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle, BookOpen, CheckCircle, ChevronLeft, ChevronRight, Clock, FileEdit, Info, Layers, PieChart,
  Scale, Search, ShieldAlert, TrendingDown, TrendingUp, Trophy, XCircle,
} from 'lucide-react';
import { formatIDR } from '@/app/transactions/lib/groupAnalytics';
import InteractiveDonutChart, { type DonutLivePreview } from '@/components/shared/InteractiveDonutChart';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeActivityLogs } from '@/lib/journalEntryStore';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import SalesLoading from '@/app/transactions/sales/components/SalesLoading';
import JeTrendCard from './JeTrendCard';
import {
  OverviewKpiTile, SectionLabel, CardHeader, FilterSelect, NAV_BTN, buildPageItems, STATUS_STYLE, STATUS_STYLE_FALLBACK,
  pctOf, fmtPct, allocatePcts, pctLabel, initialsOf,
} from './jeOverviewUi';

// Palet donut sama dengan "Sales per Branch" di Sales Overview.
const DONUT_COLORS = ['#171717', '#404040', '#737373', '#a3a3a3', '#d4d4d4', '#e5e5e5'];

const STATUS_LABEL: Record<string, string> = {
  posted: 'Posted',
  pending: 'Pending',
  draft: 'Draft',
  approved: 'Approved',
  exception: 'Exception',
  rejected: 'Rejected',
};
const STATUS_DONUT_LABEL: Record<string, string> = { ...STATUS_LABEL, pending: 'Pending Review' };

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
const fmtIdrCompact = (n: number) => formatIDR(n, true);

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
function formatWaktu(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dateTimeFmt.format(d);
}

// ── Kartu "Entry Status Distribution" (donut) -- sama dengan BranchDonutCard di Sales ──
function StatusDonutCard({ items, total }: { items: { name: string; value: number }[]; total: number }) {
  const [active, setActive] = useState<number | null>(null);
  const [live, setLive] = useState<DonutLivePreview[] | null>(null);

  const segs = useMemo(
    () => items.map((it, i) => ({ name: it.name, value: it.value, color: DONUT_COLORS[i % DONUT_COLORS.length] })),
    [items]
  );
  useEffect(() => { setActive(null); }, [segs.length]);

  const shownValues = useMemo(() => (live ? live.map((p) => p.value) : segs.map((sg) => sg.value)), [live, segs]);
  const shownPcts = useMemo(() => allocatePcts(shownValues), [shownValues]);
  const toggle = (i: number) => setActive((prev) => (prev === i ? null : i));
  const unit = (n: number) => `${fmtInt(n)} ${Math.round(n) === 1 ? 'entry' : 'entries'}`;

  return (
    <div className="card-elevated-md flex h-full flex-col rounded-xl p-5">
      <CardHeader icon={PieChart} title="Entry Status Distribution" subtitle={`${fmtInt(total)} total entries`} />
      {segs.length === 0 || total <= 0 ? (
        <p className="py-10 text-center text-xs text-muted-foreground">No data yet.</p>
      ) : (
        <>
          <div className="mx-auto w-full max-w-[220px] shrink-0">
            <InteractiveDonutChart
              data={segs}
              height={190}
              centerLabel={fmtInt(total)}
              centerSubLabel="Total Entries"
              activeIndex={active}
              onActiveChange={setActive}
              onLiveChange={setLive}
              rawValue
              minVisibleDeg={5}
              formatValue={(v, i) => unit(shownValues[i] ?? v)}
              formatPct={(p, i) => pctLabel(shownPcts[i] ?? p, shownValues[i] ?? 1)}
            />
          </div>

          <ul className="mt-4 space-y-1">
            {segs.map((a, i) => (
              <li
                key={`legend-${a.name}-${i}`}
                onClick={() => toggle(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors ${active === i ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color }} />
                <span className={`min-w-0 flex-1 truncate ${active === i ? 'font-bold' : 'font-medium'} text-foreground`} title={a.name}>{a.name}</span>
                <span className="font-semibold tabular-nums text-foreground">{fmtInt(shownValues[i] ?? a.value)}</span>
                <span className="w-10 shrink-0 rounded-full bg-neutral-100 py-0.5 text-center text-[10px] font-semibold tabular-nums text-neutral-600">
                  {pctLabel(shownPcts[i], shownValues[i])}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ── Kartu "Source Distribution" (leaderboard) -- sama dengan TopCustomerCard di Sales ──
function SourceDistributionCard({ sources, total }: { sources: { name: string; amount: number; count: number }[]; total: number }) {
  const max = sources[0]?.amount || 1;

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <CardHeader
        icon={Layers}
        title="Source Distribution"
        subtitle="By transaction origin, based on total debit"
        right={sources.length > 0 ? (
          <span className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-300">
            {sources.length} {sources.length === 1 ? 'source' : 'sources'} · {formatIDR(total, true)}
          </span>
        ) : undefined}
      />
      {sources.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No journal entries yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {sources.map((c, i) => {
            const first = i === 0;
            const share = total > 0 ? (c.amount / total) * 100 : 0;
            const badge = first ? 'bg-neutral-900 text-white' : 'bg-neutral-100 text-neutral-700';
            return (
              <div
                key={`source-${c.name}`}
                className="rounded-[10px] border border-neutral-300 bg-white p-4 transition-colors duration-200 hover:border-neutral-500 hover:bg-neutral-50"
              >
                <div className="flex items-center justify-between">
                  <span className={`inline-flex h-6 min-w-[24px] items-center justify-center gap-1 rounded-full px-1.5 text-[11px] font-semibold ${badge}`}>
                    {first ? <Trophy size={12} /> : null}#{i + 1}
                  </span>
                  <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-600">
                    {fmtPct(share)}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-xs font-semibold text-neutral-700 ring-1 ring-neutral-200">
                    {initialsOf(c.name)}
                  </span>
                  <p className="min-w-0 truncate text-sm font-semibold text-neutral-900" title={c.name}>{c.name}</p>
                </div>
                <p className="mt-3 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={formatIDR(c.amount)}>
                  {formatIDR(c.amount)}
                </p>
                <p className="text-[11px] font-medium text-neutral-500">
                  {c.count} {c.count === 1 ? 'entry' : 'entries'}
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full bg-neutral-800"
                    style={{ width: `${Math.max(3, (c.amount / max) * 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Kartu "Exception Breakdown" -- kartu mini gaya Top Customer (angka, bar proporsi) ──
function ExceptionBreakdownCard({ items, totalEntries }: { items: { type: string; count: number; icon: React.ElementType }[]; totalEntries: number }) {
  return (
    <div className="card-elevated-md rounded-xl p-5">
      <CardHeader
        icon={ShieldAlert}
        title="Exception Breakdown"
        subtitle="Entries that need review before period close"
        right={
          <Link
            href="/transactions/journal-entry/exceptions"
            className="shrink-0 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold text-neutral-700 ring-1 ring-neutral-300 transition-colors hover:bg-neutral-200"
          >
            View All Exceptions →
          </Link>
        }
      />
      {items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">No exceptions at the moment.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => {
            const Icon = it.icon;
            const share = pctOf(it.count, totalEntries);
            return (
              <div
                key={`exc-${it.type}`}
                className="rounded-[10px] border border-neutral-300 bg-white p-4 transition-colors duration-200 hover:border-neutral-500 hover:bg-neutral-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
                      <Icon size={16} />
                    </span>
                    <p className="min-w-0 truncate text-sm font-semibold text-neutral-900" title={it.type}>{it.type}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-neutral-600">
                    {fmtPct(share)}
                  </span>
                </div>
                <p className="mt-3 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{fmtInt(it.count)}</p>
                <p className="text-[11px] font-medium text-neutral-500">
                  {it.count === 1 ? 'entry' : 'entries'} · of {fmtInt(totalEntries)} total
                </p>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div className="h-full rounded-full bg-neutral-800" style={{ width: `${Math.max(3, share)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function JournalEntryOverview() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts, loading: draftsLoading, error: draftsError } = useJeDrafts(clientId);
  const { logs, loading: logsLoading } = useJeActivityLogs(clientId);

  // ── Angka KPI (rumus sama dengan versi lama) ──
  const stats = useMemo(() => {
    const total = drafts.length;
    const posted = drafts.filter((d) => d.status === 'posted').length;
    const pending = drafts.filter((d) => d.status === 'pending').length;
    const draft = drafts.filter((d) => d.status === 'draft').length;
    const unbalanced = drafts.filter((d) => Math.abs(d.total_debit - d.total_credit) > 0.01).length;
    const exceptions = drafts.filter((d) => d.status === 'exception').length;
    const rejected = drafts.filter((d) => d.status === 'rejected').length;
    const totalDebit = drafts.reduce((s, d) => s + d.total_debit, 0);
    const totalCredit = drafts.reduce((s, d) => s + d.total_credit, 0);
    return { total, posted, pending, draft, unbalanced, exceptions, rejected, totalDebit, totalCredit, imbalance: totalDebit - totalCredit };
  }, [drafts]);
  const notPosted = stats.total - stats.posted;

  // ── Distribusi status (donut) ──
  const statusItems = useMemo(() => {
    const map = new Map<string, number>();
    drafts.forEach((d) => map.set(d.status, (map.get(d.status) || 0) + 1));
    return Array.from(map, ([status, value]) => ({ name: STATUS_DONUT_LABEL[status] ?? status, value })).sort((a, b) => b.value - a.value);
  }, [drafts]);

  // ── Distribusi sumber (kartu peringkat) ──
  const sources = useMemo(() => {
    const map = new Map<string, { amount: number; count: number }>();
    drafts.forEach((d) => {
      const key = (d.source_type || '').trim() || '-';
      const cur = map.get(key) ?? { amount: 0, count: 0 };
      cur.amount += d.total_debit;
      cur.count += 1;
      map.set(key, cur);
    });
    return Array.from(map, ([name, v]) => ({ name, amount: v.amount, count: v.count })).sort((a, b) => b.amount - a.amount);
  }, [drafts]);
  const sourcesTotal = useMemo(() => sources.reduce((s, x) => s + x.amount, 0), [sources]);

  // ── Exception breakdown ──
  const exceptionItems = useMemo(
    () => [
      { type: 'Debit/Credit Mismatch', count: stats.unbalanced, icon: Scale },
      { type: 'Flagged as Exception', count: stats.exceptions, icon: AlertTriangle },
      { type: 'Rejected', count: stats.rejected, icon: XCircle },
    ].filter((r) => r.count > 0),
    [stats.unbalanced, stats.exceptions, stats.rejected]
  );

  // ── Tabel Recent Activity (cari + filter aktivitas + paging) ──
  const [search, setSearch] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [tablePage, setTablePage] = useState(1);
  const [tablePageSize, setTablePageSize] = useState(10);
  const eventTypes = useMemo(() => Array.from(new Set(logs.map((l) => l.event_type).filter(Boolean))).sort(), [logs]);
  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs
      .filter((l) => {
        if (eventFilter !== 'all' && l.event_type !== eventFilter) return false;
        if (!q) return true;
        return [l.je_number, l.description, l.performed_by, l.event_type].some((v) => (v || '').toLowerCase().includes(q));
      })
      .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  }, [logs, search, eventFilter]);
  const tableTotalPages = Math.max(1, Math.ceil(tableRows.length / tablePageSize));
  const tablePageSafe = Math.min(tablePage, tableTotalPages);
  const pagedRows = tableRows.slice((tablePageSafe - 1) * tablePageSize, tablePageSafe * tablePageSize);

  const HEADERS = ['Date & Time', 'JE Number', 'Activity', 'Description', 'Performed By', 'Status'];

  return (
    <div className={`${salesFont.className} space-y-6`}>
      {draftsError && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
          <span className="font-semibold">Error:</span>
          <span>{draftsError}</span>
        </div>
      )}

      {/* Peringatan -- gaya sama dengan banner "Perhatian" di Sales Overview */}
      {(stats.unbalanced > 0 || stats.exceptions > 0) && (
        <div className="flex items-start gap-3 rounded-lg border border-neutral-300 border-l-[3px] border-l-neutral-800 bg-neutral-50 px-4 py-3 text-xs text-neutral-700">
          <Info size={15} className="mt-px shrink-0 text-neutral-700" />
          <p className="leading-relaxed">
            <span className="font-semibold text-neutral-900">Attention:</span>{' '}
            {stats.unbalanced > 0 && `${stats.unbalanced} unbalanced ${stats.unbalanced === 1 ? 'entry requires' : 'entries require'} correction`}
            {stats.unbalanced > 0 && stats.exceptions > 0 && ' and '}
            {stats.exceptions > 0 && `${stats.exceptions} ${stats.exceptions === 1 ? 'exception is' : 'exceptions are'} still open`}
            . Review them before the period is closed.
          </p>
        </div>
      )}

      {/* KPI Cards */}
      <div>
        <SectionLabel>Journal Status</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <OverviewKpiTile
            label="Total Journal Entries" value={fmtInt(stats.total)} icon={BookOpen}
            sub={stats.total > 0 ? `${fmtInt(stats.posted)} posted` : undefined}
            pct={pctOf(stats.posted, stats.total)} pctLabel="of entries posted"
          />
          <OverviewKpiTile
            label="Posted" value={fmtInt(stats.posted)} icon={CheckCircle}
            sub={stats.total > 0 ? `${fmtInt(notPosted)} not posted yet` : undefined}
            pct={pctOf(stats.posted, stats.total)} pctLabel="of total entries"
          />
          <OverviewKpiTile
            label="Pending Review" value={fmtInt(stats.pending)} icon={Clock}
            sub={stats.pending > 0 ? 'Awaiting action' : undefined}
            pct={pctOf(stats.pending, stats.total)} pctLabel="of total entries"
          />
          <OverviewKpiTile
            label="Draft" value={fmtInt(stats.draft)} icon={FileEdit}
            sub={stats.draft > 0 ? 'In progress' : undefined}
            pct={pctOf(stats.draft, stats.total)} pctLabel="of total entries"
          />
        </div>
      </div>

      <div>
        <SectionLabel>Balance & Exceptions</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <OverviewKpiTile
            label="Unbalanced Entries" value={fmtInt(stats.unbalanced)} icon={Scale}
            sub={stats.unbalanced > 0 ? 'Require correction' : undefined}
            pct={pctOf(stats.unbalanced, stats.total)} pctLabel="of total entries"
          />
          <OverviewKpiTile
            label="Exceptions" value={fmtInt(stats.exceptions)} icon={AlertTriangle}
            sub={stats.exceptions > 0 ? 'Open issues' : undefined}
            pct={pctOf(stats.exceptions, stats.total)} pctLabel="of total entries"
          />
          <OverviewKpiTile
            label="Total Debits" value={formatIDR(stats.totalDebit)} icon={TrendingUp}
            sub="All periods"
            pct={pctOf(stats.totalDebit, Math.max(stats.totalDebit, stats.totalCredit))} pctLabel="of the larger side"
          />
          <OverviewKpiTile
            label="Total Credits" value={formatIDR(stats.totalCredit)} icon={TrendingDown}
            sub={Math.abs(stats.imbalance) > 0.01 ? `${fmtIdrCompact(Math.abs(stats.imbalance))} imbalance` : 'Balanced'}
            pct={pctOf(stats.totalCredit, Math.max(stats.totalDebit, stats.totalCredit))} pctLabel="of the larger side"
          />
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <JeTrendCard drafts={drafts} loading={draftsLoading} />
        <StatusDonutCard items={statusItems} total={stats.total} />
      </div>

      {/* Source distribution -- leaderboard lebar penuh */}
      <SourceDistributionCard sources={sources} total={sourcesTotal} />

      {/* Exception breakdown */}
      <ExceptionBreakdownCard items={exceptionItems} totalEntries={stats.total} />

      {/* Tabel Recent Activity */}
      {logs.length === 0 ? (
        logsLoading ? (
          <SalesLoading loading message="Loading..." />
        ) : (
          <div className="card p-8 text-center text-xs text-muted-foreground">
            No journal entry activity yet.
          </div>
        )
      ) : (
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border">
            <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Recent Activity</h3>
            <p className="text-sm text-neutral-500 mt-0.5">
              {tableRows.length === 0
                ? 'Showing 0 of 0 activities'
                : `Showing ${(tablePageSafe - 1) * tablePageSize + 1} - ${Math.min(tablePageSafe * tablePageSize, tableRows.length)} of ${tableRows.length} activities`}
            </p>
          </div>

          <div className="py-3 flex flex-wrap items-center gap-2 border-b border-border">
            <FilterSelect
              value={eventFilter}
              onChange={(v) => { setEventFilter(v); setTablePage(1); }}
              options={[{ value: 'all', label: 'All Activities' }, ...eventTypes.map((e) => ({ value: e, label: e }))]}
            />
            <div className="relative ml-auto w-full sm:w-[400px]">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setTablePage(1); }}
                placeholder="Search JE number, description, user..."
                className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1100px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  {HEADERS.map((h) => (
                    <th key={h} className="py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 && (
                  <tr>
                    <td colSpan={HEADERS.length} className="py-2 px-2 text-center text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No activity matches the filter.</span>
                    </td>
                  </tr>
                )}
                {pagedRows.map((r) => {
                  const statusKey = (r.status_snapshot ?? '').toLowerCase();
                  const statusLabel = STATUS_LABEL[statusKey] ?? r.status_snapshot ?? '';
                  const st = STATUS_STYLE[statusLabel] || STATUS_STYLE_FALLBACK;
                  return (
                    <tr key={r.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs">
                      <td className="py-2 px-2 text-foreground whitespace-nowrap tabular-nums">{formatWaktu(r.created_at)}</td>
                      <td className="py-2 px-2 font-medium text-blue-700 whitespace-nowrap">{r.je_number ?? '—'}</td>
                      <td className="py-2 px-2 font-medium text-neutral-900 whitespace-nowrap">{r.event_type}</td>
                      <td className="py-2 px-2 text-neutral-600 max-w-[360px] truncate" title={r.description}>{r.description}</td>
                      <td className="py-2 px-2 text-neutral-600 whitespace-nowrap">{r.performed_by || '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {statusLabel ? (
                          <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{statusLabel}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
                {/* Baris kosong pengisi: tinggi tabel selalu = "Rows per page", layar tidak bergeser. */}
                {Array.from({ length: Math.max(0, tablePageSize - Math.max(pagedRows.length, 1)) }).map((_, i) => (
                  <tr key={`pad-${i}`} aria-hidden="true" className="invisible text-xs">
                    <td colSpan={HEADERS.length} className="py-2 px-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium">&nbsp;</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>Rows per page</span>
                <select value={tablePageSize} onChange={(e) => { setTablePageSize(Number(e.target.value)); setTablePage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-neutral-700/30">
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {tableRows.length === 0 ? 0 : (tablePageSafe - 1) * tablePageSize + 1}–{Math.min(tablePageSafe * tablePageSize, tableRows.length)}
                </span>{' '}
                of <span className="font-semibold text-foreground">{tableRows.length}</span> activities
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => setTablePage(tablePageSafe - 1)} disabled={tablePageSafe <= 1} aria-label="Previous page" className={NAV_BTN}><ChevronLeft size={16} /></button>
              {buildPageItems(tablePageSafe, tableTotalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => setTablePage(p)} aria-current={p === tablePageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === tablePageSafe ? 'bg-neutral-800 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => setTablePage(tablePageSafe + 1)} disabled={tablePageSafe >= tableTotalPages} aria-label="Next page" className={NAV_BTN}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
