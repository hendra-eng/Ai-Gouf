'use client';

import React, { useState } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { journalEntries } from '@/data/journalEntryData';
import type { JEStatus } from '@/data/journalEntryData';
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  DocumentTextIcon,
  CalendarIcon,
} from '@heroicons/react/24/outline';

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

export default function JournalPreviewPage() {
  const [selectedId, setSelectedId] = useState(journalEntries[0]?.id ?? null);

  const je = journalEntries.find(t => t.id === selectedId) || journalEntries[0];

  if (!je) {
    return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="preview" />
        <div className="je-card p-10 flex flex-col items-center justify-center text-center gap-2">
          <DocumentTextIcon className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm font-semibold text-foreground">No journal entries yet</p>
          <p className="text-xs text-muted-foreground">Once journal entries are posted, you'll be able to preview them here.</p>
        </div>
      </div>
    );
  }

  const totalDebit = je.lines.reduce((s, l) => s + l.debit, 0);
  const totalCredit = je.lines.reduce((s, l) => s + l.credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="preview" />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Selector Panel */}
          <div className="je-card p-4 lg:col-span-1">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Select Journal Entry</h3>
            <div className="space-y-1.5 max-h-[600px] overflow-y-auto scrollbar-thin">
              {journalEntries.map(t => (
                <button
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-all text-xs ${
                    selectedId === t.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-foreground'
                  }`}
                >
                  <p className="font-mono font-semibold">{t.jeNumber}</p>
                  <p className={`truncate mt-0.5 ${selectedId === t.id ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>{t.description}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${selectedId === t.id ? 'bg-white/20 text-white' : statusColors[t.status]}`}>
                      {statusLabels[t.status]}
                    </span>
                    <span className={`font-semibold tabular-nums ${selectedId === t.id ? 'text-primary-foreground' : ''}`}>{fmt(t.totalDebit)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Preview Document */}
          <div className="lg:col-span-3 space-y-4">
            {/* Header */}
            <div className="je-card p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <DocumentTextIcon className="w-5 h-5 text-primary" />
                    <h2 className="text-lg font-bold text-foreground">Journal Entry Preview</h2>
                  </div>
                  <p className="text-sm text-muted-foreground">{je.description}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColors[je.status]}`}>{statusLabels[je.status]}</span>
                  <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${isBalanced ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                    {isBalanced ? <CheckCircleIcon className="w-3.5 h-3.5" /> : <ExclamationTriangleIcon className="w-3.5 h-3.5" />}
                    {isBalanced ? 'Balanced' : 'Unbalanced'}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DocumentTextIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reference</p>
                  </div>
                  <p className="text-sm font-bold text-foreground">{je.jeNumber}</p>
                  <p className="text-xs text-muted-foreground">Source: {je.sourceType} — {je.sourceReference}</p>
                </div>
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <CalendarIcon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dates</p>
                  </div>
                  <p className="text-xs text-foreground">Entry: <span className="font-medium">{je.date}</span></p>
                  <p className="text-xs text-foreground">Posting: <span className="font-medium">{je.postingDate}</span></p>
                  <p className="text-xs text-foreground">Period: <span className="font-medium">{je.period}</span></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Workflow</p>
                  <p className="text-xs text-foreground">Created by: <span className="font-medium">{je.createdBy}</span></p>
                  <p className="text-xs text-foreground">Reviewed by: <span className="font-medium">{je.reviewedBy || '— Pending —'}</span></p>
                  <p className="text-xs text-foreground">Approved by: <span className="font-medium">{je.approvedBy || '— Pending —'}</span></p>
                </div>
              </div>
            </div>

            {/* Journal Lines */}
            <div className="je-card overflow-hidden">
              <div className="px-5 py-3 border-b border-border bg-muted/30">
                <h3 className="text-sm font-semibold text-foreground">Journal Lines</h3>
              </div>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/20">
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Account</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Description</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground">Cost Center</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Debit</th>
                      <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {je.lines.map(line => (
                      <tr key={line.id} className="table-row-hover">
                        <td className="px-4 py-2.5 font-medium text-foreground whitespace-nowrap">{line.accountCode} · {line.accountName}</td>
                        <td className="px-4 py-2.5 text-foreground max-w-[240px] truncate">{line.description}</td>
                        <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">{line.costCenter || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{line.debit > 0 ? fmt(line.debit) : '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{line.credit > 0 ? fmt(line.credit) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className={`border-t ${isBalanced ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                      <td colSpan={3} className={`px-4 py-2.5 text-right font-bold ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>Total</td>
                      <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totalDebit)}</td>
                      <td className={`px-4 py-2.5 text-right font-bold tabular-nums ${isBalanced ? 'text-green-700' : 'text-red-700'}`}>{fmt(totalCredit)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {je.notes && (
              <div className="je-card p-4 bg-amber-50">
                <p className="text-xs text-amber-700">{je.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
  );
}