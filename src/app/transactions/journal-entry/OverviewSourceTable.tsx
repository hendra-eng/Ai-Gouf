'use client';

import React, { useMemo } from 'react';
import { useAuth } from '@/lib/auth';
import { useJeDrafts, type BackendJeDraft } from '@/lib/journalEntryStore';

interface SourceRow {
  source: string;
  count: number;
  totalAmount: number;
  percentOfTotal: number;
}

function hitungDistribusiSumber(drafts: BackendJeDraft[]): SourceRow[] {
  const perSumber = new Map<string, { count: number; totalAmount: number }>();
  let grandTotal = 0;
  drafts.forEach(d => {
    const row = perSumber.get(d.source_type) || { count: 0, totalAmount: 0 };
    row.count += 1;
    row.totalAmount += d.total_debit;
    grandTotal += d.total_debit;
    perSumber.set(d.source_type, row);
  });
  return Array.from(perSumber.entries())
    .map(([source, v]) => ({
      source,
      count: v.count,
      totalAmount: v.totalAmount,
      percentOfTotal: grandTotal > 0 ? Math.round((v.totalAmount / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

export default function OverviewSourceTable() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { drafts, loading } = useJeDrafts(clientId);
  const sourceDistribution = useMemo(() => hitungDistribusiSumber(drafts), [drafts]);
  const maxAmount = sourceDistribution.length > 0 ? Math.max(...sourceDistribution.map(s => s.totalAmount)) : 0;
  const periodTotal = sourceDistribution.reduce((a, b) => a + b.totalAmount, 0);

  return (
    <div className="je-card">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <h2 className="text-sm font-700 text-foreground">Source Distribution</h2>
        <p className="text-xs text-muted-foreground mt-0.5">by transaction origin</p>
      </div>
      <div className="p-5 space-y-4">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : sourceDistribution.length === 0 ? (
          <p className="text-xs text-muted-foreground">No journal entries yet.</p>
        ) : sourceDistribution.map((item) => (
          <div key={`src-${item.source}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-600 text-foreground">{item.source}</span>
                <span className="text-[10px] font-600 text-muted-foreground bg-muted rounded px-1.5 py-0.5 tabular-nums">{item.count} JEs</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-700 text-foreground tabular-nums">
                  Rp{(item.totalAmount / 1000).toFixed(0)}K
                </span>
                <span className="text-[11px] text-muted-foreground ml-1">({item.percentOfTotal}%)</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${maxAmount > 0 ? (item.totalAmount / maxAmount) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-4 border-t border-border pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-500">Period Total</span>
          <span className="font-800 text-foreground tabular-nums">
            Rp{(periodTotal / 1000000).toFixed(2)}M
          </span>
        </div>
      </div>
    </div>
  );
}
