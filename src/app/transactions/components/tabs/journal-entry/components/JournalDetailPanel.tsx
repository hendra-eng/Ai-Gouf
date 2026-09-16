'use client';
import React from 'react';
import { X, BookOpen, User, Calendar, Link2, AlertTriangle, CheckCircle } from 'lucide-react';
import StatusBadge from '../../shared/TabStatusBadge';
import type { JournalEntry } from './JournalEntryTable';

interface Props {
  entry: JournalEntry;
  onClose: () => void;
}

export default function JournalDetailPanel({ entry, onClose }: Props) {
  const isBalanced = entry.balanceStatus === 'balanced';

  return (
    <div className="p-5 bg-muted/20">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <BookOpen size={18} className="text-primary" />
          <div>
            <h4 className="text-sm font-700 text-foreground">{entry.jeNumber}</h4>
            <p className="text-xs text-muted-foreground">{entry.sourceReference} · {entry.source}</p>
          </div>
          <StatusBadge status={entry.postingStatus as 'posted' | 'draft' | 'pending' | 'rejected'} />
          <StatusBadge
            status={
              entry.reviewStatus === 'review' ?'review' : (entry.reviewStatus as'approved' | 'pending' | 'rejected' | 'draft')
            }
          />
          <StatusBadge status={entry.balanceStatus} />
        </div>
        <button onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <X size={14} />
        </button>
      </div>

      {/* Meta row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Description</p>
          <p className="text-sm font-500 text-foreground leading-snug">{entry.description}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Dates</p>
          <div className="flex items-center gap-1.5">
            <Calendar size={12} className="text-muted-foreground" />
            <span className="text-sm font-500 text-foreground">Journal: {entry.journalDate}</span>
          </div>
          {entry.postingDate && (
            <p className="text-xs text-muted-foreground">Posted: {entry.postingDate}</p>
          )}
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Workflow</p>
          <div className="flex items-center gap-1.5">
            <User size={12} className="text-muted-foreground" />
            <span className="text-xs text-foreground">Created: {entry.createdBy}</span>
          </div>
          <p className="text-xs text-muted-foreground">Reviewed: {entry.reviewedBy}</p>
          <p className="text-xs text-muted-foreground">Approved: {entry.approvedBy}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-1">Source Reference</p>
          <div className="flex items-center gap-1.5">
            <Link2 size={12} className="text-muted-foreground" />
            <span className="text-sm font-500 text-foreground">{entry.sourceReference}</span>
          </div>
          <p className="text-xs text-muted-foreground">{entry.accountingPeriod}</p>
        </div>
      </div>

      {/* Balance summary */}
      <div className={`rounded-lg border p-3 mb-4 flex items-center gap-4 flex-wrap ${isBalanced ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
        {isBalanced
          ? <CheckCircle size={14} className="text-emerald-600 shrink-0" />
          : <AlertTriangle size={14} className="text-red-600 shrink-0" />
        }
        <span className={`text-xs font-600 ${isBalanced ? 'text-emerald-700' : 'text-red-700'}`}>
          {isBalanced ? 'Entry is balanced — Total DR = Total CR' : `Entry is unbalanced — Difference: $${Math.abs(entry.difference).toLocaleString()}`}
        </span>
        <div className="flex items-center gap-4 ml-auto text-xs">
          <span className="text-blue-600 font-600 font-tabular">DR: ${entry.totalDebit.toLocaleString()}</span>
          <span className="text-emerald-600 font-600 font-tabular">CR: ${entry.totalCredit.toLocaleString()}</span>
          <span className={`font-700 font-tabular ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
            Diff: ${entry.difference.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Journal lines table */}
      <div className="bg-card rounded-lg border border-border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/30 border-b border-border">
          <p className="text-xs font-600 text-muted-foreground uppercase tracking-wider">Journal Lines — {entry.lines.length} lines</p>
        </div>
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-2.5 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Account Code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Account Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Description</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Debit</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Credit</th>
              </tr>
            </thead>
            <tbody>
              {entry.lines.map((line) => (
                <tr key={`jline-${line.id}`} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-2.5 font-tabular font-500 text-primary text-xs">{line.accountCode}</td>
                  <td className="px-4 py-2.5 font-500 text-foreground text-xs">{line.accountName}</td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs">{line.description}</td>
                  <td className="px-4 py-2.5 text-right font-tabular text-xs">
                    {line.debit > 0 ? (
                      <span className="font-600 text-blue-600">${line.debit.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-tabular text-xs">
                    {line.credit > 0 ? (
                      <span className="font-600 text-emerald-600">${line.credit.toLocaleString()}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {/* Totals row */}
              <tr className="bg-muted/30 border-t-2 border-border">
                <td colSpan={3} className="px-4 py-2.5 text-xs font-700 text-foreground">Totals</td>
                <td className="px-4 py-2.5 text-right font-tabular font-700 text-blue-600 text-xs">
                  ${entry.totalDebit.toLocaleString()}
                </td>
                <td className="px-4 py-2.5 text-right font-tabular font-700 text-emerald-600 text-xs">
                  ${entry.totalCredit.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}