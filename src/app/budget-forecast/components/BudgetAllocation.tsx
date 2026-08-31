'use client';
import React, { useState } from 'react';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const DEPARTMENTS = [
  { id: 'dept-sales', name: 'Sales', budget: 380, actual: 362, color: 'bg-chart-1' },
  { id: 'dept-eng', name: 'Engineering', budget: 320, actual: 308, color: 'bg-chart-2' },
  { id: 'dept-marketing', name: 'Marketing', budget: 180, actual: 202, color: 'bg-chart-5' },
  { id: 'dept-ops', name: 'Operations', budget: 148, actual: 141, color: 'bg-chart-4' },
  { id: 'dept-finance', name: 'Finance', budget: 62, actual: 58, color: 'bg-chart-6' },
  { id: 'dept-hr', name: 'HR', budget: 54, actual: 51, color: 'bg-chart-3' },
  { id: 'dept-admin', name: 'Administration', budget: 36, actual: 34, color: 'bg-primary' },
];

const CATEGORIES = [
  { id: 'cat-payroll', name: 'Payroll', budget: 620, actual: 598, color: 'bg-chart-1' },
  { id: 'cat-tech', name: 'Technology', budget: 145, actual: 138, color: 'bg-chart-2' },
  { id: 'cat-marketing', name: 'Marketing', budget: 180, actual: 202, color: 'bg-chart-5' },
  { id: 'cat-travel', name: 'Travel & Entertainment', budget: 35, actual: 41, color: 'bg-chart-3' },
  { id: 'cat-profsvc', name: 'Professional Services', budget: 72, actual: 68, color: 'bg-chart-4' },
  { id: 'cat-admin', name: 'Administration', budget: 98, actual: 92, color: 'bg-chart-6' },
  { id: 'cat-other', name: 'Other', budget: 30, actual: 27, color: 'bg-muted-foreground' },
];

type ViewType = 'department' | 'category';

export default function BudgetAllocation() {
  const { fx } = useCurrency();
  const [view, setView] = useState<ViewType>('department');
  const [selected, setSelected] = useState<string | null>(null);

  const data = view === 'department' ? DEPARTMENTS : CATEGORIES;
  const total = data.reduce((sum, d) => sum + d.budget, 0);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">Budget Allocation</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Distribution by department and category</p>
        </div>
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {(['department', 'category'] as ViewType[]).map((v) => (
            <button
              key={`alloc-view-${v}`}
              onClick={() => { setView(v); setSelected(null); }}
              className={`px-3 py-1.5 rounded-md text-xs font-500 transition-all ${
                v === view ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {v === 'department' ? 'By Department' : 'By Category'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {data.map((item) => {
          const budgetPct = (item.budget / total) * 100;
          const actualPct = (item.actual / item.budget) * 100;
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
                <span className="text-sm font-500 text-foreground flex-1">{item.name}</span>
                <span className="text-xs text-muted-foreground font-tabular">{budgetPct.toFixed(1)}%</span>
                <span className={`text-xs font-600 font-tabular ${isOver ? 'text-negative' : 'text-positive'}`}>
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
                    <p className="text-sm font-600 font-tabular text-foreground">{fx(formatIDR(item.budget, true))}</p>
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">Actual</p>
                    <p className={`text-sm font-600 font-tabular ${isOver ? 'text-negative' : 'text-positive'}`}>
                      {fx(formatIDR(item.actual, true))}
                    </p>
                  </div>
                  <div>
                    <p className="text-2xs text-muted-foreground">Utilization</p>
                    <p className={`text-sm font-600 font-tabular ${isOver ? 'text-negative' : 'text-foreground'}`}>
                      {actualPct.toFixed(1)}%
                    </p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
