'use client';

import React, { useState, useMemo } from 'react';
import { toast } from 'sonner';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import NewJournalEntryModal from '@/app/transactions/journal-entry/components/NewJournalEntryModal';
import ImportJournalModal from '@/app/transactions/journal-entry/components/ImportJournalModal';
import { exportJournalEntriesToPdf, exportJournalEntriesToExcel, type JeExportRow } from '@/app/transactions/journal-entry/components/exportJournalEntry';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  EyeIcon,
  PlusIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  TableCellsIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeDraftLines, listJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiEntry, type JeUiStatus } from '@/lib/journalEntryStore';

type JEStatus = JeUiStatus;

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const statusColors: Record<JEStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  posted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
};

const statusLabels: Record<JEStatus, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
};

export default function JournalEntryTransactionPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [sortField, setSortField] = useState('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRow, setSelectedRow] = useState<JeUiEntry | null>(null);
  const { lines: selectedLines } = useJeDraftLines(selectedRow?.id);
  const mappedLines = useMemo(() => selectedLines.map(mapJeDraftLineToUi), [selectedLines]);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [exporting, setExporting] = useState<'pdf' | 'excel' | null>(null);

  const sourceTypes = ['All', ...Array.from(new Set(journalEntries.map(t => t.sourceType)))];
  const periods = ['All', ...Array.from(new Set(journalEntries.map(t => t.period)))];

  const filtered = useMemo(() => {
    let data = [...journalEntries];
    if (search) data = data.filter(r =>
      r.jeNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.sourceReference.toLowerCase().includes(search.toLowerCase())
    );
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (sourceFilter !== 'All') data = data.filter(r => r.sourceType === sourceFilter);
    if (periodFilter !== 'All') data = data.filter(r => r.period === periodFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [journalEntries, search, statusFilter, sourceFilter, periodFilter, sortField, sortDir]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const runExport = async (format: 'pdf' | 'excel') => {
    if (filtered.length === 0) {
      toast.error('Tidak ada journal entry untuk diexport.');
      return;
    }
    setExporting(format);
    try {
      const rows: JeExportRow[] = await Promise.all(filtered.map(async (je) => ({
        ...je,
        lines: (await listJeDraftLines(je.id)).map(mapJeDraftLineToUi),
      })));
      if (format === 'pdf') exportJournalEntriesToPdf(rows);
      else await exportJournalEntriesToExcel(rows);
      toast.success('Export berhasil', { description: `${rows.length} journal entry diexport.` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Gagal export journal entry.');
    } finally {
      setExporting(null);
    }
  };

  const summary = useMemo(() => ({
    total: journalEntries.length,
    pending: journalEntries.filter(t => t.status === 'pending').length,
    approved: journalEntries.filter(t => t.status === 'approved').length,
    posted: journalEntries.filter(t => t.status === 'posted').length,
    exceptions: journalEntries.filter(t => t.status === 'exception').length,
    totalDebit: journalEntries.reduce((s, t) => s + t.totalDebit, 0),
  }), [journalEntries]);

  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="transaction" />

        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            onClick={() => runExport('excel')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50"
          >
            <TableCellsIcon className="w-4 h-4" /> {exporting === 'excel' ? 'Exporting…' : 'Export Excel'}
          </button>
          <button
            onClick={() => runExport('pdf')}
            disabled={exporting !== null}
            className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors disabled:opacity-50"
          >
            <DocumentTextIcon className="w-4 h-4" /> {exporting === 'pdf' ? 'Exporting…' : 'Export PDF'}
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 text-xs font-medium border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
          >
            <ArrowUpTrayIcon className="w-4 h-4" /> Import
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg px-3 py-2 hover:opacity-90 transition-colors"
          >
            <PlusIcon className="w-4 h-4" /> New Journal Entry
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: summary.total, color: 'text-slate-700' },
            { label: 'Pending', value: summary.pending, color: 'text-amber-700' },
            { label: 'Approved', value: summary.approved, color: 'text-blue-700' },
            { label: 'Posted', value: summary.posted, color: 'text-green-700' },
            { label: 'Exceptions', value: summary.exceptions, color: 'text-orange-700' },
            { label: 'Total Debit', value: fmt(summary.totalDebit), color: 'text-foreground' },
          ].map(card => (
            <div key={card.label} className="je-card p-3">
              <p className={`text-lg font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
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
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4 text-muted-foreground" />
                <select className="je-select text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  {['All', 'draft', 'pending', 'approved', 'posted', 'rejected', 'exception'].map(s => (
                    <option key={s} value={s}>{s === 'All' ? 'All' : statusLabels[s as JEStatus]}</option>
                  ))}
                </select>
              </div>
              <select className="je-select text-sm" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                {sourceTypes.map(t => <option key={t}>{t}</option>)}
              </select>
              <select className="je-select text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
                {periods.map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {journalEntries.length} journal entries</p>
        </div>

        {/* Table */}
        <div className="je-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: 'JE Number', field: 'jeNumber' },
                    { label: 'Date', field: 'date' },
                    { label: 'Description', field: 'description' },
                    { label: 'Source', field: 'sourceType' },
                    { label: 'Debit', field: 'totalDebit' },
                    { label: 'Credit', field: 'totalCredit' },
                    { label: 'Status', field: 'status' },
                    { label: 'Period', field: 'period' },
                    { label: 'Created By', field: 'createdBy' },
                  ].map(col => (
                    <th key={col.field} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap" onClick={() => handleSort(col.field)}>
                      <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">Memuat journal entries…</td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">No journal entries match your filters.</td></tr>
                ) : filtered.map(row => (
                  <tr
                    key={row.id}
                    className="table-row-hover cursor-pointer"
                    onClick={() => setSelectedRow(selectedRow?.id === row.id ? null : row)}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.jeNumber}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.date}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" title={row.description}>{row.description}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">{row.sourceType}</span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.totalDebit)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.totalCredit)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[row.status]}`}>{statusLabels[row.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.period}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.createdBy}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button className="text-xs text-primary hover:underline flex items-center gap-0.5" onClick={e => { e.stopPropagation(); setSelectedRow(row); }}>
                        <EyeIcon className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedRow && (
          <div className="je-card p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-sm font-bold text-primary">{selectedRow.jeNumber}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedRow.status]}`}>{statusLabels[selectedRow.status]}</span>
                </div>
                <p className="text-sm text-foreground font-medium">{selectedRow.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{selectedRow.sourceType} · {selectedRow.sourceReference}</p>
              </div>
              <button className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 border border-border rounded" onClick={() => setSelectedRow(null)}>✕ Close</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
              {[
                { label: 'Posting Date', value: selectedRow.postingDate },
                { label: 'Period', value: selectedRow.period },
                { label: 'Currency', value: selectedRow.currency },
                { label: 'Created By', value: selectedRow.createdBy },
                { label: 'Reviewed By', value: selectedRow.reviewedBy || '—' },
                { label: 'Approved By', value: selectedRow.approvedBy || '—' },
                { label: 'Created Date', value: selectedRow.createdDate },
                { label: 'Last Updated', value: selectedRow.lastUpdated },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            {/* Journal Lines */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Account</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Debit</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mappedLines.map(line => (
                    <tr key={line.id} className="table-row-hover">
                      <td className="px-3 py-2 text-muted-foreground">{line.accountCode} · {line.accountName}</td>
                      <td className="px-3 py-2 text-foreground">{line.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 border-t border-border">
                    <td colSpan={2} className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(selectedRow.totalDebit)}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{fmt(selectedRow.totalCredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            {selectedRow.notes && (
              <div className="mt-3 bg-amber-50 rounded-lg px-4 py-2.5">
                <p className="text-xs text-amber-700">{selectedRow.notes}</p>
              </div>
            )}
          </div>
        )}

        {showNewModal && clientId && (
          <NewJournalEntryModal
            clientId={clientId}
            createdByName={user?.nama || user?.username || 'System'}
            onClose={() => setShowNewModal(false)}
          />
        )}
        {showImportModal && clientId && (
          <ImportJournalModal
            clientId={clientId}
            createdByName={user?.nama || user?.username || 'System'}
            onClose={() => setShowImportModal(false)}
          />
        )}
      </div>
  );
}