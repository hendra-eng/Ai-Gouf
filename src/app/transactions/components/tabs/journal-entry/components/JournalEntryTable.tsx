'use client';
import React, { useState, useMemo } from 'react';
import {
  Search, ChevronDown, ChevronUp, Eye, Edit2, MoreHorizontal,
  X, ChevronLeft, ChevronRight, Download, Filter, AlertTriangle
} from 'lucide-react';
import StatusBadge from '../../shared/TabStatusBadge';
import JournalDetailPanel from './JournalDetailPanel';
import { toast } from 'sonner';

export interface JournalLine {
  id: string;
  accountCode: string;
  accountName: string;
  description: string;
  debit: number;
  credit: number;
}

export interface JournalEntry {
  id: string;
  jeNumber: string;
  journalDate: string;
  postingDate: string;
  description: string;
  source: string;
  sourceReference: string;
  accountingPeriod: string;
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanceStatus: 'balanced' | 'unbalanced';
  postingStatus: 'posted' | 'draft' | 'pending' | 'rejected';
  reviewStatus: 'approved' | 'pending' | 'review' | 'rejected' | 'draft';
  createdBy: string;
  reviewedBy: string;
  approvedBy: string;
  createdDate: string;
  lines: JournalLine[];
}

// Backend integration point: replace with API call to /api/transactions/journal-entries
const journalData: JournalEntry[] = [];

type SortField = keyof JournalEntry;
type SortDir = 'asc' | 'desc';

export default function JournalEntryTable() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [periodFilter, setPeriodFilter] = useState('all');
  const [balanceFilter, setBalanceFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('journalDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let data = [...journalData];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.jeNumber.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.sourceReference.toLowerCase().includes(q) ||
          r.source.toLowerCase().includes(q)
      );
    }
    if (statusFilter !== 'all') data = data.filter((r) => r.postingStatus === statusFilter);
    if (reviewFilter !== 'all') data = data.filter((r) => r.reviewStatus === reviewFilter);
    if (balanceFilter !== 'all') data = data.filter((r) => r.balanceStatus === balanceFilter);
    if (periodFilter !== 'all') data = data.filter((r) => r.accountingPeriod === periodFilter);
    data.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [search, statusFilter, reviewFilter, balanceFilter, periodFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((r) => r.id)));
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="inline-flex flex-col ml-1">
      {sortField === field ? (
        sortDir === 'asc'
          ? <ChevronUp size={12} className="text-primary" />
          : <ChevronDown size={12} className="text-primary" />
      ) : (
        <ChevronDown size={12} className="text-muted-foreground opacity-40" />
      )}
    </span>
  );

  const selectedEntry = journalData.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      {/* Unbalanced warning banner */}
      {journalData.some((j) => j.balanceStatus === 'unbalanced') && (
        <div className="px-5 py-3 bg-red-50 border-b border-red-200 flex items-center gap-2">
          <AlertTriangle size={14} className="text-red-600 shrink-0" />
          <p className="text-xs font-500 text-red-700">
            {journalData.filter((j) => j.balanceStatus === 'unbalanced').length} unbalanced journal{' '}
            {journalData.filter((j) => j.balanceStatus === 'unbalanced').length === 1 ? 'entry requires' : 'entries require'} correction before posting.
            Total DR ≠ Total CR on these entries.
          </p>
          <button
            onClick={() => setBalanceFilter('unbalanced')}
            className="ml-auto text-xs font-600 text-red-700 underline hover:no-underline"
          >
            Show only unbalanced
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search JE number, description…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={periodFilter}
          onChange={(e) => { setPeriodFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Periods</option>
          <option value="Sep 2026">Sep 2026</option>
          <option value="Aug 2026">Aug 2026</option>
          <option value="Jul 2026">Jul 2026</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Posting</option>
          <option value="posted">Posted</option>
          <option value="pending">Pending</option>
          <option value="draft">Draft</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={reviewFilter}
          onChange={(e) => { setReviewFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Reviews</option>
          <option value="approved">Approved</option>
          <option value="review">In Review</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={balanceFilter}
          onChange={(e) => { setBalanceFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Balance</option>
          <option value="balanced">Balanced</option>
          <option value="unbalanced">Unbalanced</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} entries</span>
          <button
            onClick={() => toast.success('Exporting journal entries…')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
          >
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedRows.size > 0 && (
        <div className="animate-slide-up px-5 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-3">
          <span className="text-sm font-500 text-primary">{selectedRows.size} selected</span>
          <button
            onClick={() => { toast.success(`${selectedRows.size} entry/entries submitted for review`); setSelectedRows(new Set()); }}
            className="text-sm font-500 text-primary hover:underline"
          >
            Submit for Review
          </button>
          <button
            onClick={() => { toast.success(`${selectedRows.size} entry/entries posted to GL`); setSelectedRows(new Set()); }}
            className="text-sm font-500 text-primary hover:underline"
          >
            Post to GL
          </button>
          <button onClick={() => setSelectedRows(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm min-w-[1200px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedRows.size === paginated.length && paginated.length > 0}
                  onChange={toggleAll}
                  className="rounded border-border"
                />
              </th>
              {[
                { key: 'jeNumber', label: 'JE Number' },
                { key: 'journalDate', label: 'Journal Date' },
                { key: 'description', label: 'Description' },
                { key: 'source', label: 'Source' },
                { key: 'accountingPeriod', label: 'Period' },
                { key: 'totalDebit', label: 'Total Debit' },
                { key: 'totalCredit', label: 'Total Credit' },
                { key: 'difference', label: 'Difference' },
                { key: 'balanceStatus', label: 'Balance' },
                { key: 'reviewStatus', label: 'Review' },
                { key: 'postingStatus', label: 'Posting' },
              ].map((col) => (
                <th
                  key={`jcol-${col.key}`}
                  onClick={() => handleSort(col.key as SortField)}
                  className="px-4 py-3 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                >
                  {col.label}
                  <SortIcon field={col.key as SortField} />
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Filter size={28} className="text-muted-foreground opacity-40" />
                    <p className="text-sm font-500 text-muted-foreground">No journal entries match your filters</p>
                    <button
                      onClick={() => { setSearch(''); setStatusFilter('all'); setReviewFilter('all'); setBalanceFilter('all'); setPeriodFilter('all'); }}
                      className="text-xs text-primary hover:underline"
                    >
                      Clear all filters
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row) => (
                <React.Fragment key={`je-row-${row.id}`}>
                  <tr
                    className={`border-b border-border transition-colors duration-100 cursor-pointer ${
                      selectedId === row.id ? 'bg-primary/5' : 'hover:bg-muted/40'
                    } ${selectedRows.has(row.id) ? 'bg-primary/5' : ''} ${
                      row.balanceStatus === 'unbalanced' ? 'border-l-2 border-l-red-400' : ''
                    }`}
                    onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedRows.has(row.id)}
                        onChange={() => toggleRow(row.id)}
                        className="rounded border-border"
                      />
                    </td>
                    <td className="px-4 py-3 font-500 text-primary font-tabular whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {row.balanceStatus === 'unbalanced' && (
                          <AlertTriangle size={12} className="text-red-500 shrink-0" />
                        )}
                        {row.jeNumber}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground font-tabular whitespace-nowrap">
                      {row.journalDate}
                    </td>
                    <td className="px-4 py-3 text-foreground max-w-[240px]">
                      <p className="truncate text-sm">{row.description}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                      {row.source}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md font-500">
                        {row.accountingPeriod}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-tabular font-500 text-blue-600 whitespace-nowrap">
                      ${row.totalDebit.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-tabular font-500 text-emerald-600 whitespace-nowrap">
                      ${row.totalCredit.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right font-tabular whitespace-nowrap">
                      <span className={`font-700 ${row.difference === 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {row.difference === 0 ? '$0' : `$${Math.abs(row.difference).toLocaleString()}`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.balanceStatus} size="sm" />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        status={
                          row.reviewStatus === 'review' ?'review' : (row.reviewStatus as'approved' | 'pending' | 'rejected' | 'draft')
                        }
                        size="sm"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={row.postingStatus as 'posted' | 'draft' | 'pending' | 'rejected'} size="sm" />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                          title="View journal lines"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          onClick={() => toast.info(`Editing ${row.jeNumber}`)}
                          title="Edit entry"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => toast.info('More actions')}
                          title="More actions"
                          className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail panel */}
      {selectedEntry && (
        <div className="border-t border-border animate-fade-in">
          <JournalDetailPanel entry={selectedEntry} onClose={() => setSelectedId(null)} />
        </div>
      )}

      {/* Pagination */}
      <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} journal entries
        </p>
        <div className="flex items-center gap-1">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => p - 1)}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={`jpage-${p}`}
              onClick={() => setPage(p)}
              className={`w-7 h-7 text-xs rounded-md font-500 transition-colors ${
                page === p
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {p}
            </button>
          ))}
          <button
            disabled={page === totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}