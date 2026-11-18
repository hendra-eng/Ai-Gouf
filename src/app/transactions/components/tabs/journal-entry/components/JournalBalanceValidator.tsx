
'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle, AlertTriangle } from 'lucide-react';

const JournalActivityChart = dynamic(() => import('./JournalActivityChart'), { ssr: false });

const periodSummary = [
  { period: 'Sep 2026', totalDebit: 0, totalCredit: 0, entries: 0, status: 'balanced' as const },
  { period: 'Aug 2026', totalDebit: 0, totalCredit: 0, entries: 0, status: 'balanced' as const },
  { period: 'Jul 2026', totalDebit: 0, totalCredit: 0, entries: 0, status: 'balanced' as const },
];

export default function JournalBalanceValidator() {
  const currentPeriod = periodSummary[0];
  const diff = currentPeriod.totalDebit - currentPeriod.totalCredit;
  const isBalanced = diff === 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Balance validator */}
      <div className="xl:col-span-1 bg-card rounded-xl border border-border p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-foreground mb-1">Debit / Credit Validator</h3>
        <p className="text-xs text-muted-foreground mb-4">Current period balance check — Sep 2026</p>

        <div className={`rounded-lg border p-4 mb-4 ${isBalanced ? 'bg-neutral-100 border-neutral-300' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            {isBalanced ? (
              <CheckCircle size={16} className="text-neutral-900" />
            ) : (
              <AlertTriangle size={16} className="text-red-600" />
            )}
            <span className={`text-sm font-bold ${isBalanced ? 'text-neutral-900' : 'text-red-700'}`}>
              {isBalanced ? 'Period is Balanced' : 'Period is Unbalanced'}
            </span>
          </div>
          <p className={`text-xs ${isBalanced ? 'text-neutral-900' : 'text-red-600'}`}>
            {isBalanced
              ? 'All journal entries for Sep 2026 are balanced. Total DR = Total CR.'
              : `Difference of $${Math.abs(diff).toLocaleString()} detected. Review unbalanced entries.`}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 text-[10px] font-bold text-neutral-700 bg-neutral-200 rounded px-1 py-0.5 text-center">DR</span>
              <span className="text-sm text-muted-foreground">Total Debit</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground">
              ${currentPeriod.totalDebit.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 text-[10px] font-bold text-neutral-900 bg-neutral-100 rounded px-1 py-0.5 text-center">CR</span>
              <span className="text-sm text-muted-foreground">Total Credit</span>
            </div>
            <span className="text-sm font-bold tabular-nums text-foreground">
              ${currentPeriod.totalCredit.toLocaleString()}
            </span>
          </div>
          <div className="border-t border-border pt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Difference</span>
            <span className={`text-sm font-bold tabular-nums ${isBalanced ? 'text-neutral-900' : 'text-red-600'}`}>
              ${diff.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">Prior Periods</p>
          <div className="space-y-2">
            {periodSummary.slice(1).map((p) => (
              <div key={`period-${p.period}`} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{p.period}</span>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-foreground">${p.totalDebit.toLocaleString()}</span>
                  <span className="flex items-center gap-1 text-neutral-900 bg-neutral-100 px-1.5 py-0.5 rounded-full text-[10px] font-semibold">
                    <CheckCircle size={9} /> Balanced
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Activity chart */}
      <div className="xl:col-span-2 bg-card rounded-xl border border-border p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Journal Entry Activity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly entries by status — FY 2026</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-neutral-800 inline-block" />
              Posted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-neutral-500 inline-block" />
              Pending
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-neutral-300 inline-block" />
              Rejected
            </span>
          </div>
        </div>
        <JournalActivityChart />
      </div>
    </div>
  );
}