'use client';
import React, { useState } from 'react';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';

export default function VarianceAnalysis() {
  const [sortBy, setSortBy] = useState<'impact' | 'variance'>('impact');
  const { fx } = useCurrency();
  const { revenueCategoryVariance, expenseCategoryVariance } = useBudgetData();

  const impactFor = (variancePct: number) => (Math.abs(variancePct) >= 8 ? 'High' : Math.abs(variancePct) >= 3 ? 'Medium' : 'Low');

  const VARIANCES = [
    ...revenueCategoryVariance.map((v) => ({ id: `var-rev-${v.name}`, category: v.name, budget: v.budget * 1_000_000, actual: v.actual * 1_000_000, type: 'revenue' as const, impact: impactFor(v.variancePct) })),
    ...expenseCategoryVariance.map((v) => ({ id: `var-exp-${v.name}`, category: v.name, budget: v.budget * 1_000_000, actual: v.actual * 1_000_000, type: 'expense' as const, impact: impactFor(v.variancePct) })),
  ];

  const sorted = [...VARIANCES].sort((a, b) => {
    if (sortBy === 'variance') {
      return Math.abs(b.actual - b.budget) - Math.abs(a.actual - a.budget);
    }
    const impactOrder = { High: 0, Medium: 1, Low: 2 };
    return impactOrder[a.impact as keyof typeof impactOrder] - impactOrder[b.impact as keyof typeof impactOrder];
  });

  const maxBar = Math.max(1, ...VARIANCES.map((v) => Math.abs(v.actual - v.budget)));

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Budget Variance Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Favorable and unfavorable variances by category</p>
        </div>
        <div className="flex items-center gap-1 bg-muted border border-border rounded-lg p-0.5">
          {(['impact', 'variance'] as const).map((s) => (
            <button
              key={`sort-${s}`}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                s === sortBy ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'impact' ? 'By Impact' : 'By Variance'}
            </button>
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No category data available yet for this client.</p>
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const diff = item.actual - item.budget;
            const pct = item.budget !== 0 ? (diff / item.budget) * 100 : 0;
            // For expenses: negative diff = favorable (under budget)
            // For revenue: positive diff = favorable
            const isFavorable = item.type === 'revenue' ? diff >= 0 : diff <= 0;
            const barWidth = (Math.abs(diff) / maxBar) * 100;

            return (
              <div key={item.id} className="group">
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="text-sm text-foreground font-medium w-40 flex-shrink-0 truncate">{item.category}</span>
                  <div className="flex-1 relative h-5 flex items-center">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${isFavorable ? 'bg-positive' : 'bg-negative'}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-sm font-semibold tabular-nums w-20 text-right ${isFavorable ? 'text-positive' : 'text-negative'}`}>
                      {isFavorable ? '+' : ''}{fx(formatIDR(diff, true))}
                    </span>
                    <span className={`text-xs font-medium w-14 text-right tabular-nums ${isFavorable ? 'text-positive' : 'text-negative'}`}>
                      {isFavorable ? '+' : ''}{pct.toFixed(1)}%
                    </span>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full w-14 text-center ${
                      item.impact === 'High' ? 'bg-negative-subtle text-negative' :
                      item.impact === 'Medium'? 'bg-warning-subtle text-warning' : 'bg-muted text-muted-foreground'
                    }`}>
                      {item.impact}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 pl-40 text-2xs text-muted-foreground">
                  <span>Budget: {fx(formatIDR(item.budget, true))}</span>
                  <span>Actual: {fx(formatIDR(item.actual, true))}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
