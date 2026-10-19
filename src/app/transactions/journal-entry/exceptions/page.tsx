'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import {
  useJeDrafts, useJeDraftLines, useJeSourceFiles, listJeSourceRows, mapJeDraftToUi, mapJeDraftLineToUi, jeFlagReasons,
  type JeUiEntry, type BackendJeSourceFile, type BackendJeSourceRow,
} from '@/lib/journalEntryStore';
import JePagination, { JE_PAGE_SIZE } from '@/app/transactions/journal-entry/components/JePagination';
import JeWorkflowActions from '@/app/transactions/journal-entry/components/JeWorkflowActions';

const fmt = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

interface FlaggedEntry {
  entry: JeUiEntry;
  reasons: string[];
}

// Aturan "bermasalah" dipakai bersama dengan badge tab (jeFlagReasons di journalEntryStore).
function detectExceptions(journalEntries: JeUiEntry[]): FlaggedEntry[] {
  return journalEntries
    .map(entry => ({ entry, reasons: jeFlagReasons(entry) }))
    .filter(f => f.reasons.length > 0);
}

interface SourceIssue { file: BackendJeSourceFile; row: BackendJeSourceRow }

export default function JournalEntryExceptionsPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { lines: expandedBackendLines } = useJeDraftLines(expandedId);
  const expandedLines = useMemo(() => expandedBackendLines.map(mapJeDraftLineToUi), [expandedBackendLines]);

  const flaggedEntries = useMemo(() => detectExceptions(journalEntries), [journalEntries]);

  // Baris hasil upload yang gagal validasi (tidak pernah jadi draft, jadi tidak muncul di daftar di atas).
  const router = useRouter();
  const { activeClientId } = useActiveClient();
  const { files } = useJeSourceFiles(activeClientId);
  const issueKey = files.filter(f => f.rows_invalid > 0).map(f => `${f.id}:${f.rows_invalid}`).join(',');
  const [sourceIssues, setSourceIssues] = useState<SourceIssue[]>([]);
  const [issuePage, setIssuePage] = useState(1);
  useEffect(() => {
    let batal = false;
    const bermasalah = files.filter(f => f.rows_invalid > 0);
    if (bermasalah.length === 0) { setSourceIssues([]); return; }
    Promise.all(bermasalah.map(async file => (await listJeSourceRows(file.id)).filter(r => !r.is_valid).map(row => ({ file, row }))))
      .then(hasil => { if (!batal) setSourceIssues(hasil.flat()); })
      .catch(() => { if (!batal) setSourceIssues([]); });
    return () => { batal = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);
  const issuePages = Math.max(1, Math.ceil(sourceIssues.length / JE_PAGE_SIZE));
  const issuePageSafe = Math.min(issuePage, issuePages);
  const pagedIssues = sourceIssues.slice((issuePageSafe - 1) * JE_PAGE_SIZE, issuePageSafe * JE_PAGE_SIZE);
  const sourceTypes = ['All', ...Array.from(new Set(flaggedEntries.map(f => f.entry.sourceType)))];

  const filtered = useMemo(() => {
    let data = flaggedEntries;
    if (search) data = data.filter(f =>
      f.entry.jeNumber.toLowerCase().includes(search.toLowerCase()) ||
      f.entry.description.toLowerCase().includes(search.toLowerCase())
    );
    if (sourceFilter !== 'All') data = data.filter(f => f.entry.sourceType === sourceFilter);
    return data;
  }, [flaggedEntries, search, sourceFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / JE_PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * JE_PAGE_SIZE, pageSafe * JE_PAGE_SIZE);

  const summary = useMemo(() => ({
    total: flaggedEntries.length,
    exceptionStatus: flaggedEntries.filter(f => f.entry.status === 'exception').length,
    imbalanced: flaggedEntries.filter(f => Math.abs(f.entry.totalDebit - f.entry.totalCredit) > 0.01).length,
  }), [flaggedEntries]);

  return (
      <div className="space-y-6">
        <JournalEntryTabs activeTab="exceptions" />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="je-card p-4">
            <p className="number-display text-xl font-bold text-slate-700 leading-none">{summary.total}</p>
            <p className="text-xs font-medium text-foreground mt-1">Total Flagged Entries</p>
          </div>
          <div className="je-card p-4">
            <p className="number-display text-xl font-bold text-orange-700 leading-none">{summary.exceptionStatus}</p>
            <p className="text-xs font-medium text-foreground mt-1">Marked as Exception</p>
          </div>
          <div className="je-card p-4">
            <p className="number-display text-xl font-bold text-red-700 leading-none">{summary.imbalanced}</p>
            <p className="text-xs font-medium text-foreground mt-1">Debit/Credit Imbalance</p>
          </div>
          <div className="je-card p-4">
            <p className="number-display text-xl font-bold text-red-700 leading-none">{sourceIssues.length}</p>
            <p className="text-xs font-medium text-foreground mt-1">Failed Source Rows</p>
          </div>
        </div>

        {/* Filters */}
        <div className="je-card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="je-input pl-9"
                placeholder="Search by JE number or description…"
                value={search}
                onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <FunnelIcon className="w-4 h-4 text-muted-foreground" />
              <select className="je-select text-sm" value={sourceFilter} onChange={e => { setSourceFilter(e.target.value); setCurrentPage(1); }}>
                {sourceTypes.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {flaggedEntries.length} flagged entries</p>
        </div>

        {/* Exception Cards */}
        <div className="space-y-3">
          {loading ? (
            <div className="je-card p-12 text-center text-sm text-muted-foreground">Loading journal entries…</div>
          ) : filtered.length === 0 ? (
            <div className="je-card p-12 text-center">
              <CheckCircleIcon className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No exceptions match your filters</p>
              <p className="text-xs text-muted-foreground mt-1">Adjust your filters or clear the search to see all flagged entries.</p>
            </div>
          ) : paginated.map(({ entry, reasons }) => (
            <div
              key={entry.id}
              className={`je-card p-5 cursor-pointer transition-all ${expandedId === entry.id ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold text-primary">{entry.jeNumber}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
                      <ExclamationTriangleIcon className="w-3 h-3" />{entry.status === 'exception' ? 'Exception' : entry.status === 'rejected' ? 'Rejected' : 'Imbalanced'}
                    </span>
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{entry.sourceType}</span>
                  </div>
                  <p className="text-sm text-foreground">{entry.description}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {reasons.map(r => (
                      <span key={r} className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">
                        <ExclamationCircleIcon className="w-3 h-3" />{r}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Source Ref: <span className="text-foreground font-medium">{entry.sourceReference}</span></span>
                    <span>Date: <span className="text-foreground font-medium">{entry.date}</span></span>
                    <span>Debit: <span className="text-foreground font-semibold tabular-nums">{fmt(entry.totalDebit)}</span></span>
                    <span>Credit: <span className="text-foreground font-semibold tabular-nums">{fmt(entry.totalCredit)}</span></span>
                    <span>Created by: <span className="text-foreground font-medium">{entry.createdBy}</span></span>
                  </div>
                </div>
                <JeWorkflowActions entries={[entry]} only={['approve', 'reopen', 'reject', 'bulk-delete']} className="sm:justify-end flex-shrink-0" />
              </div>

              {/* Expanded Detail */}
              {expandedId === entry.id && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Journal Lines</p>
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
                        {expandedLines.map(line => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 text-muted-foreground">{line.accountCode} · {line.accountName}</td>
                            <td className="px-3 py-2 text-foreground">{line.description}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {entry.notes && (
                    <div className="mt-3 bg-muted/40 rounded-lg p-3 text-xs text-foreground leading-relaxed">
                      {entry.notes}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        {!loading && filtered.length > 0 && (
          <div className="je-card overflow-hidden">
            <JePagination page={pageSafe} pageSize={JE_PAGE_SIZE} total={filtered.length} onPageChange={setCurrentPage} itemLabel="flagged entries" />
          </div>
        )}

        {/* Failed source rows */}
        {sourceIssues.length > 0 && (
          <div className="je-card overflow-hidden">
            <div className="px-5 py-3 border-b border-border">
              <h3 className="text-sm font-semibold text-foreground">Failed source rows</h3>
              <p className="text-xs text-muted-foreground mt-0.5">These journal entries from uploaded files failed validation, so no draft was created. Fix the file and upload it again.</p>
            </div>
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">File</th>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">JE Number</th>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Description</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Debit</th>
                    <th className="px-4 py-2 text-right font-semibold text-muted-foreground">Credit</th>
                    <th className="px-4 py-2 text-left font-semibold text-muted-foreground">Problem</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {pagedIssues.map(({ file, row }) => (
                    <tr key={row.id} className="table-row-hover">
                      <td className="px-4 py-2 whitespace-nowrap">
                        <button className="text-primary hover:underline" onClick={() => router.push('/transactions/journal-entry/source-data')}>{file.file_name}</button>
                      </td>
                      <td className="px-4 py-2 font-mono whitespace-nowrap">{row.je_number || '—'}</td>
                      <td className="px-4 py-2 max-w-xs truncate" title={row.description || ''}>{row.description || '—'}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmt(row.debit_total)}</td>
                      <td className="px-4 py-2 text-right tabular-nums whitespace-nowrap">{fmt(row.credit_total)}</td>
                      <td className="px-4 py-2 text-red-700">{row.validation_notes || 'Validation failed'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <JePagination page={issuePageSafe} pageSize={JE_PAGE_SIZE} total={sourceIssues.length} onPageChange={setIssuePage} itemLabel="failed rows" />
          </div>
        )}
      </div>
  );
}