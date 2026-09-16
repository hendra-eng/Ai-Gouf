
'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { CheckCircle, AlertTriangle } from 'lucide-react';

const JournalActivityChart = dynamic(() => import('./JournalActivityChart'), { ssr: false });

const periodSummary = [
  { period: 'Sep 2026', totalDebit: 1284600, totalCredit: 1284600, entries: 48, status: 'balanced' as const },
  { period: 'Aug 2026', totalDebit: 1148200, totalCredit: 1148200, entries: 52, status: 'balanced' as const },
  { period: 'Jul 2026', totalDebit: 1091400, totalCredit: 1091400, entries: 44, status: 'balanced' as const },
];

export default function JournalBalanceValidator() {
  const currentPeriod = periodSummary[0];
  const diff = currentPeriod.totalDebit - currentPeriod.totalCredit;
  const isBalanced = diff === 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {/* Balance validator */}
      <div className="xl:col-span-1 bg-card rounded-xl border border-border p-5 shadow-sm">
        <h3 className="text-sm font-600 text-foreground mb-1">Debit / Credit Validator</h3>
        <p className="text-xs text-muted-foreground mb-4">Current period balance check — Sep 2026</p>

        <div className={`rounded-lg border p-4 mb-4 ${isBalanced ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            {isBalanced ? (
              <CheckCircle size={16} className="text-emerald-600" />
            ) : (
              <AlertTriangle size={16} className="text-red-600" />
            )}
            <span className={`text-sm font-700 ${isBalanced ? 'text-emerald-700' : 'text-red-700'}`}>
              {isBalanced ? 'Period is Balanced' : 'Period is Unbalanced'}
            </span>
          </div>
          <p className={`text-xs ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
            {isBalanced
              ? 'All journal entries for Sep 2026 are balanced. Total DR = Total CR.'
              : `Difference of $${Math.abs(diff).toLocaleString()} detected. Review unbalanced entries.`}
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 text-[10px] font-700 text-blue-600 bg-blue-50 rounded px-1 py-0.5 text-center">DR</span>
              <span className="text-sm text-muted-foreground">Total Debit</span>
            </div>
            <span className="text-sm font-700 font-tabular text-foreground">
              ${currentPeriod.totalDebit.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-5 text-[10px] font-700 text-emerald-600 bg-emerald-50 rounded px-1 py-0.5 text-center">CR</span>
              <span className="text-sm text-muted-foreground">Total Credit</span>
            </div>
            <span className="text-sm font-700 font-tabular text-foreground">
              ${currentPeriod.totalCredit.toLocaleString()}
            </span>
          </div>
          <div className="border-t border-border pt-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Difference</span>
            <span className={`text-sm font-700 font-tabular ${isBalanced ? 'text-emerald-600' : 'text-red-600'}`}>
              ${diff.toLocaleString()}
            </span>
          </div>
        </div>

        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-600 mb-2">Prior Periods</p>
          <div className="space-y-2">
            {periodSummary.slice(1).map((p) => (
              <div key={`period-${p.period}`} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{p.period}</span>
                <div className="flex items-center gap-2">
                  <span className="font-tabular text-foreground">${p.totalDebit.toLocaleString()}</span>
                  <span className="flex items-center gap-1 text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full text-[10px] font-600">
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
            <h3 className="text-sm font-600 text-foreground">Journal Entry Activity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Monthly entries by status — FY 2026</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-primary inline-block" />
              Posted
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />
              Pending
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block" />
              Rejected
            </span>
          </div>
        </div>
        <JournalActivityChart />
      </div>
    </div>
  );
}