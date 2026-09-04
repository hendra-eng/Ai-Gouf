'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';

const PALETTE = ['bg-chart-1', 'bg-chart-2', 'bg-chart-5', 'bg-chart-4', 'bg-chart-6', 'bg-chart-3', 'bg-primary'];

type ViewType = 'department' | 'category';

export default function BudgetAllocation() {
  const { fx } = useCurrency();
  const [view, setView] = useState<ViewType>('category');
  const [selected, setSelected] = useState<string | null>(null);
  const { expenseCategoryVariance } = useBudgetData();

  const data = expenseCategoryVariance.map((v, i) => ({
    id: `cat-${v.name}`,
    name: v.name,
    budget: v.budget,
    actual: v.actual,
    color: PALETTE[i % PALETTE.length],
  }));
  const total = data.reduce((sum, d) => sum + d.budget, 0) || 1;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Budget Allocation</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Distribution by expense category</p>
        </div>
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {(['department', 'category'] as ViewType[]).map((v) => (
            <button
              key={`alloc-view-${v}`}
              onClick={() => { setView(v); setSelected(null); }}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                v === view ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'department' ? 'By Department' : 'By Category'}
            </button>
          ))}
        </div>
      </div>

      {view === 'department' ? (
        <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
          <Icon name="InformationCircleIcon" size={22} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground max-w-sm">
            Department-level allocation isn&apos;t available yet — the chart of accounts doesn&apos;t track a department dimension. Showing spend by expense category instead.
          </p>
          <button onClick={() => setView('category')} className="text-xs text-primary hover:text-primary/80 font-medium mt-1">
            View By Category
          </button>
        </div>
      ) : data.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No expense category data available yet for this client.</p>
      ) : (
        <div className="space-y-3">
          {data.map((item) => {
            const budgetPct = (item.budget / total) * 100;
            const actualPct = item.budget !== 0 ? (item.actual / item.budget) * 100 : 0;
            const isOver = item.actual > item.budget;
            const isSelected = selected === item.id;

            return (
              <div
                key={item.id}
                className={`cursor-pointer rounded-xl p-3 transition-all duration-150 border ${
                  isSelected ? 'border-primary/30 bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/40'
                }`}
                onClick={() => setSelected(isSelected ? null : item.id)}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${item.color}`} />
                  <span className="text-sm font-medium text-foreground flex-1 truncate">{item.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{budgetPct.toFixed(1)}%</span>
                  <span className={`text-xs font-semibold tabular-nums ${isOver ? 'text-negative' : 'text-positive'}`}>
                    {isOver ? '▲' : '▼'} {fx(`Rp ${Math.abs(item.actual - item.budget)}M`)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${isOver ? 'bg-negative' : item.color}`}
                    style={{ width: `${Math.min(100, actualPct)}%` }}
                  />
                </div>
                {isSelected && (
                  <div className="mt-3 grid grid-cols-3 gap-2 pt-3 border-t border-border">
                    <div>
                      <p className="text-2xs text-muted-foreground">Budget</p>
                      <p className="text-sm font-semibold tabular-nums text-foreground">{fx(formatIDR(item.budget * 1_000_000, true))}</p>
                    </div>
                    <div>
                      <p className="text-2xs text-muted-foreground">Actual</p>
                      <p className={`text-sm font-semibold tabular-nums ${isOver ? 'text-negative' : 'text-positive'}`}>
                        {fx(formatIDR(item.actual * 1_000_000, true))}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xs text-muted-foreground">Utilization</p>
                      <p className={`text-sm font-semibold tabular-nums ${isOver ? 'text-negative' : 'text-foreground'}`}>
                        {actualPct.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
