'use client';

import React, { useState, useMemo } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  CheckBadgeIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi } from '@/lib/journalEntryStore';
import JePagination, { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

const sourceColors: Record<string, string> = {
  Sales: 'bg-emerald-100 text-emerald-700',
  Purchase: 'bg-blue-100 text-blue-700',
  Payroll: 'bg-purple-100 text-purple-700',
  Bank: 'bg-cyan-100 text-cyan-700',
  Cash: 'bg-teal-100 text-teal-700',
  Expense: 'bg-orange-100 text-orange-700',
  Inventory: 'bg-yellow-100 text-yellow-700',
  'Fixed Assets': 'bg-indigo-100 text-indigo-700',
  Tax: 'bg-red-100 text-red-700',
  Manual: 'bg-slate-100 text-slate-700',
};

export default function JournalEntryPostedPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendPosted, loading } = useJeDrafts(clientId, 'posted');
  const postedEntries = useMemo(() => backendPosted.map(mapJeDraftToUi), [backendPosted]);

  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [sortField, setSortField] = useState('postingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { lines: expandedBackendLines } = useJeDraftLines(expandedId);
  const expandedLines = useMemo(() => expandedBackendLines.map(mapJeDraftLineToUi), [expandedBackendLines]);

  const periods = ['All', ...Array.from(new Set(postedEntries.map(t => t.period)))];
  const sourceTypes = ['All', ...Array.from(new Set(postedEntries.map(t => t.sourceType)))];

  const filtered = useMemo(() => {
    let data = [...postedEntries];
    if (search) data = data.filter(r =>
      r.jeNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.sourceReference.toLowerCase().includes(search.toLowerCase())
    );
    if (periodFilter !== 'All') data = data.filter(r => r.period === periodFilter);
    if (sourceFilter !== 'All') data = data.filter(r => r.sourceType === sourceFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [postedEntries, search, periodFilter, sourceFilter, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / JE_PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * JE_PAGE_SIZE, pageSafe * JE_PAGE_SIZE);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
    setCurrentPage(1);
  };

  const summary = useMemo(() => ({
    total: postedEntries.length,
    totalDebit: postedEntries.reduce((s, t) => s + t.totalDebit, 0),
    totalCredit: postedEntries.reduce((s, t) => s + t.totalCredit, 0),
    periods: [...new Set(postedEntries.map(t => t.period))].length,
  }), [postedEntries]);

  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="posted" />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Posted Entries', value: summary.total.toString(), sub: 'Finalized to GL', cls: 'text-green-700' },
            { label: 'Total Debit', value: fmt(summary.totalDebit), sub: 'Sum of posted debits', cls: 'text-slate-700' },
            { label: 'Total Credit', value: fmt(summary.totalCredit), sub: 'Sum of posted credits', cls: 'text-slate-700' },
            { label: 'Accounting Periods', value: summary.periods.toString(), sub: 'Periods covered', cls: 'text-slate-700' },
          ].map(card => (
            <div key={card.label} className="je-card p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckBadgeIcon className="w-4 h-4 text-green-400" />
                <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
              </div>
              <p className={`text-lg font-bold tabular-nums ${card.cls}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="je-card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="je-input pl-9"
                placeholder="Search by JE number, description, or source reference…"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4 text-muted-foreground" />
                <select className="je-select text-sm" value={periodFilter} onChange={e => { setPeriodFilter(e.target.value); setCurrentPage(1); }}>
                  {periods.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <select className="je-select text-sm" value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setCurrentPage(1); }}>
                {sourceTypes.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {postedEntries.length} posted entries</p>
        </div>

        {/* Table */}
        <div className="je-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: 'JE Number', field: 'jeNumber' },
                    { label: 'Posting Date', field: 'postingDate' },
                    { label: 'Entry Date', field: 'date' },
                    { label: 'Description', field: 'description' },
                    { label: 'Source', field: 'sourceType' },
                    { label: 'Debit', field: 'totalDebit' },
                    { label: 'Credit', field: 'totalCredit' },
                    { label: 'Period', field: 'period' },
                    { label: 'Approved By', field: 'approvedBy' },
                  ].map(col => (
                    <th
                      key={col.field}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                      onClick={() => handleSort(col.field)}
                    >
                      <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">Loading posted journal entries…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">No posted journal entries match your filters.</td></tr>
                ) : paginated.map(row => (
                  <React.Fragment key={row.id}>
                    <tr className="table-row-hover">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.jeNumber}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.postingDate}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.date}</td>
                      <td className="px-4 py-3 text-xs max-w-xs truncate" title={row.description}>{row.description}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceColors[row.sourceType] || 'bg-gray-100 text-gray-700'}`}>{row.sourceType}</span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.totalDebit)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.totalCredit)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.period}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.approvedBy || '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          {expandedId === row.id ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
                          {expandedId === row.id ? 'Hide' : 'Detail'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr>
                        <td colSpan={10} className="px-4 py-0 bg-muted/20">
                          <div className="py-4 space-y-3">
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {[
                                { label: 'Source Reference', value: row.sourceReference },
                                { label: 'Created By', value: row.createdBy },
                                { label: 'Reviewed By', value: row.reviewedBy || '—' },
                                { label: 'Last Updated', value: row.lastUpdated },
                              ].map(item => (
                                <div key={item.label} className="bg-card rounded-lg px-3 py-2 border border-border">
                                  <p className="text-xs text-muted-foreground">{item.label}</p>
                                  <p className="text-xs font-semibold text-foreground mt-0.5">{item.value}</p>
                                </div>
                              ))}
                            </div>
                            <div className="bg-card rounded-lg border border-border overflow-hidden">
                              <div className="px-3 py-2 bg-muted/30 border-b border-border">
                                <p className="text-xs font-semibold text-foreground">Journal Lines</p>
                              </div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Account</th>
                                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Debit</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Credit</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {expandedLines.map(line => (
                                    <tr key={line.id}>
                                      <td className="px-3 py-2 text-muted-foreground">{line.accountCode} · {line.accountName}</td>
                                      <td className="px-3 py-2 text-foreground">{line.description}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-green-50 border-t border-green-200">
                                    <td colSpan={2} className="px-3 py-2 text-right font-bold text-green-700">Total Posted</td>
                                    <td className="px-3 py-2 text-right font-bold tabular-nums text-green-700">{fmt(row.totalDebit)}</td>
                                    <td className="px-3 py-2 text-right font-bold tabular-nums text-green-700">{fmt(row.totalCredit)}</td>
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            <div className="flex items-center gap-2 bg-green-50 rounded-lg px-4 py-2.5">
                              <CheckBadgeIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                              <p className="text-xs text-green-700 font-medium">Posted to General Ledger — {row.period}</p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <JePagination page={pageSafe} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setCurrentPage} itemLabel="posted entries" />
        </div>
      </div>
  );
}