import React from 'react';
import { sourceDistribution } from '@/data/journalEntryData';

export default function OverviewSourceTable() {
  const maxAmount = Math.max(...sourceDistribution?.map(s => s?.totalAmount));

  return (
    <div className="je-card">
      <div className="px-5 pt-5 pb-3 border-b border-border">
        <h2 className="text-sm font-700 text-foreground">Source Distribution</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Sep 2026 · by transaction origin</p>
      </div>
      <div className="p-5 space-y-4">
        {sourceDistribution?.map((item) => (
          <div key={`src-${item?.source}`}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-600 text-foreground">{item?.source}</span>
                <span className="text-[10px] font-600 text-muted-foreground bg-muted rounded px-1.5 py-0.5 tabular-nums">{item?.count} JEs</span>
              </div>
              <div className="text-right">
                <span className="text-sm font-700 text-foreground tabular-nums">
                  ${(item?.totalAmount / 1000)?.toFixed(0)}K
                </span>
                <span className="text-[11px] text-muted-foreground ml-1">({item?.percentOfTotal}%)</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${(item?.totalAmount / maxAmount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-4 border-t border-border pt-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-500">Period Total</span>
          <span className="font-800 text-foreground tabular-nums">
            ${(sourceDistribution?.reduce((a, b) => a + b?.totalAmount, 0) / 1000000)?.toFixed(2)}M
          </span>
        </div>
      </div>
    </div>
  );
}