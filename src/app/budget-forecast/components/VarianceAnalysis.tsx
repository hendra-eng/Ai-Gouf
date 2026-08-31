'use client';
import React, { useState } from 'react';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const VARIANCES = [
  { id: 'var-rev', category: 'Revenue', budget: 8_500_000_000, actual: 8_420_000_000, type: 'revenue', impact: 'High' },
  { id: 'var-payroll', category: 'Payroll', budget: 620_000_000, actual: 598_000_000, type: 'expense', impact: 'High' },
  { id: 'var-marketing', category: 'Marketing', budget: 180_000_000, actual: 202_000_000, type: 'expense', impact: 'Medium' },
  { id: 'var-tech', category: 'Technology', budget: 145_000_000, actual: 138_000_000, type: 'expense', impact: 'Medium' },
  { id: 'var-admin', category: 'Administration', budget: 98_000_000, actual: 92_000_000, type: 'expense', impact: 'Low' },
  { id: 'var-profsvc', category: 'Professional Services', budget: 72_000_000, actual: 68_000_000, type: 'expense', impact: 'Low' },
  { id: 'var-travel', category: 'Travel', budget: 35_000_000, actual: 41_000_000, type: 'expense', impact: 'Low' },
  { id: 'var-other', category: 'Other Expenses', budget: 30_000_000, actual: 27_000_000, type: 'expense', impact: 'Low' },
  { id: 'var-cogs', category: 'COGS', budget: 4_760_000_000, actual: 4_700_000_000, type: 'expense', impact: 'High' },
];

export default function VarianceAnalysis() {
  const [sortBy, setSortBy] = useState<'impact' | 'variance'>('impact');
  const { fx } = useCurrency();

  const sorted = [...VARIANCES].sort((a, b) => {
    if (sortBy === 'variance') {
      return Math.abs(b.actual - b.budget) - Math.abs(a.actual - a.budget);
    }
    const impactOrder = { High: 0, Medium: 1, Low: 2 };
    return impactOrder[a.impact as keyof typeof impactOrder] - impactOrder[b.impact as keyof typeof impactOrder];
  });

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">Budget Variance Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Favorable and unfavorable variances by category</p>
        </div>
        <div className="flex items-center gap-1 bg-muted border border-border rounded-lg p-0.5">
          {(['impact', 'variance'] as const).map((s) => (
            <button
              key={`sort-${s}`}
              onClick={() => setSortBy(s)}
              className={`px-2.5 py-1 rounded-md text-xs font-500 transition-all ${
                s === sortBy ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {s === 'impact' ? 'By Impact' : 'By Variance'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map((item) => {
          const diff = item.actual - item.budget;
          const pct = ((diff / item.budget) * 100);
          // For expenses: negative diff = favorable (under budget)
          // For revenue: positive diff = favorable
          const isFavorable = item.type === 'revenue' ? diff >= 0 : diff <= 0;
          const maxBar = Math.max(...VARIANCES.map(v => Math.abs(v.actual - v.budget)));
          const barWidth = (Math.abs(diff) / maxBar) * 100;

          return (
            <div key={item.id} className="group">
              <div className="flex items-center gap-3 mb-1.5">
                <span className="text-sm text-foreground font-medium w-40 flex-shrink-0">{item.category}</span>
                <div className="flex-1 relative h-5 flex items-center">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${isFavorable ? 'bg-positive' : 'bg-negative'}`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className={`text-sm font-600 font-tabular w-20 text-right ${isFavorable ? 'text-positive' : 'text-negative'}`}>
                    {isFavorable ? '+' : ''}{fx(formatIDR(diff, true))}
                  </span>
                  <span className={`text-xs font-500 w-14 text-right font-tabular ${isFavorable ? 'text-positive' : 'text-negative'}`}>
                    {isFavorable ? '+' : ''}{pct.toFixed(1)}%
                  </span>
                  <span className={`text-2xs font-600 px-1.5 py-0.5 rounded-full w-14 text-center ${
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
    </div>
  );
}
