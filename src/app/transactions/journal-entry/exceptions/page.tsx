'use client';

import React, { useState, useMemo } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ExclamationTriangleIcon,
  ExclamationCircleIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, useJeDraftLines, mapJeDraftToUi, mapJeDraftLineToUi, type JeUiEntry } from '@/lib/journalEntryStore';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

interface FlaggedEntry {
  entry: JeUiEntry;
  reasons: string[];
}

// Real, derivable exception detection — no fabricated severity/assignee fields.
function detectExceptions(journalEntries: JeUiEntry[]): FlaggedEntry[] {
  const flagged: FlaggedEntry[] = [];
  journalEntries.forEach(je => {
    const reasons: string[] = [];
    if (je.status === 'exception') reasons.push('Flagged as exception');
    if (je.status === 'rejected') reasons.push('Rejected');
    const imbalance = Math.abs(je.totalDebit - je.totalCredit);
    if (imbalance > 0.01) reasons.push(`Debit/credit imbalance of ${fmt(imbalance)}`);
    if (reasons.length > 0) flagged.push({ entry: je, reasons });
  });
  return flagged;
}

export default function JournalEntryExceptionsPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts: backendDrafts, loading } = useJeDrafts(clientId);
  const journalEntries = useMemo(() => backendDrafts.map(mapJeDraftToUi), [backendDrafts]);

  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { lines: expandedBackendLines } = useJeDraftLines(expandedId);
  const expandedLines = useMemo(() => expandedBackendLines.map(mapJeDraftLineToUi), [expandedBackendLines]);

  const flaggedEntries = useMemo(() => detectExceptions(journalEntries), [journalEntries]);
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

  const summary = useMemo(() => ({
    total: flaggedEntries.length,
    exceptionStatus: flaggedEntries.filter(f => f.entry.status === 'exception').length,
    imbalanced: flaggedEntries.filter(f => Math.abs(f.entry.totalDebit - f.entry.totalCredit) > 0.01).length,
  }), [flaggedEntries]);

  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="exceptions" />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div className="je-card p-4">
            <p className="text-2xl font-bold tabular-nums text-slate-700">{summary.total}</p>
            <p className="text-xs font-medium text-foreground mt-1">Total Flagged Entries</p>
          </div>
          <div className="je-card p-4">
            <p className="text-2xl font-bold tabular-nums text-orange-700">{summary.exceptionStatus}</p>
            <p className="text-xs font-medium text-foreground mt-1">Marked as Exception</p>
          </div>
          <div className="je-card p-4">
            <p className="text-2xl font-bold tabular-nums text-red-700">{summary.imbalanced}</p>
            <p className="text-xs font-medium text-foreground mt-1">Debit/Credit Imbalance</p>
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
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <FunnelIcon className="w-4 h-4 text-muted-foreground" />
              <select className="je-select text-sm" value={sourceFilter} onChange={e => setSourceFilter(e.target.value)}>
                {sourceTypes.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {flaggedEntries.length} flagged entries</p>
        </div>

        {/* Exception Cards */}
        <div className="space-y-3">
          {loading ? (
            <div className="je-card p-12 text-center text-sm text-muted-foreground">Memuat journal entries…</div>
          ) : filtered.length === 0 ? (
            <div className="je-card p-12 text-center">
              <CheckCircleIcon className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No exceptions match your filters</p>
              <p className="text-xs text-muted-foreground mt-1">Adjust your filters or clear the search to see all flagged entries.</p>
            </div>
          ) : filtered.map(({ entry, reasons }) => (
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
      </div>
  );
}