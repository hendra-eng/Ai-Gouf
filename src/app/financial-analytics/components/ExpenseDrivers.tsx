'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const EXPENSES = [
  { id: 'exp-cogs', category: 'Cost of Revenue', current: 4_700_000_000, previous: 4_180_000_000, growth: 12.4, contribution: 79.9, color: 'bg-chart-2' },
  { id: 'exp-payroll', category: 'Payroll & Benefits', current: 598_000_000, previous: 542_000_000, growth: 10.3, contribution: 10.2, color: 'bg-chart-4' },
  { id: 'exp-tech', category: 'Technology & Infrastructure', current: 138_000_000, previous: 108_000_000, growth: 27.8, contribution: 2.3, color: 'bg-chart-5' },
  { id: 'exp-marketing', category: 'Marketing & Sales', current: 202_000_000, previous: 164_000_000, growth: 23.2, contribution: 3.4, color: 'bg-negative' },
  { id: 'exp-profsvc', category: 'Professional Services', current: 68_000_000, previous: 72_000_000, growth: -5.6, contribution: 1.2, color: 'bg-positive' },
  { id: 'exp-admin', category: 'Administration', current: 92_000_000, previous: 88_000_000, growth: 4.5, contribution: 1.6, color: 'bg-chart-6' },
  { id: 'exp-travel', category: 'Travel & Entertainment', current: 41_000_000, previous: 32_000_000, growth: 28.1, contribution: 0.7, color: 'bg-chart-3' },
  { id: 'exp-other', category: 'Other Operating', current: 27_000_000, previous: 28_000_000, growth: -3.6, contribution: 0.5, color: 'bg-muted-foreground' },
];

const totalExpense = EXPENSES?.reduce((sum, e) => sum + e?.current, 0);

export default function ExpenseDrivers() {
  const router = useRouter();
  const { fx } = useCurrency();
  const fastest = [...EXPENSES]?.sort((a, b) => b?.growth - a?.growth)?.slice(0, 3);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-600 text-foreground">Expense Drivers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Ranked by materiality · FY 2026</p>
        </div>
        <div className="text-right">
          <p className="text-2xs text-muted-foreground">Total Expenses</p>
          <p className="text-base font-700 font-tabular text-foreground">{fx(formatIDR(totalExpense, true))}</p>
        </div>
      </div>

      {/* Fastest growing alert */}
      <div className="mb-4 p-3 rounded-xl bg-warning-subtle border border-warning/20">
        <p className="text-xs font-600 text-warning mb-1.5 flex items-center gap-1.5">
          <Icon name="ArrowTrendingUpIcon" size={13} />
          Fastest Growing Categories
        </p>
        <div className="flex flex-wrap gap-2">
          {fastest?.map((f) => (
            <span key={`fast-${f?.id}`} className="text-2xs font-500 px-2 py-1 rounded-full bg-warning/10 text-warning">
              {f?.category}: +{f?.growth?.toFixed(1)}%
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-2.5">
        {EXPENSES?.map((item) => {
          const isGrowing = item?.growth > 0;
          const barWidth = (item?.current / EXPENSES?.[0]?.current) * 100;
          return (
            <div
              key={item?.id}
              className="group cursor-pointer rounded-xl p-3 hover:bg-muted/40 transition-colors"
              onClick={() => router?.push('/transactions')}
            >
              <div className="flex items-center gap-3 mb-1.5">
                <div className={`w-2 h-2 rounded-sm flex-shrink-0 ${item?.color}`} />
                <span className="text-sm font-500 text-foreground flex-1 truncate">{item?.category}</span>
                <span className={`text-xs font-600 font-tabular flex-shrink-0 ${isGrowing ? 'text-negative' : 'text-positive'}`}>
                  {isGrowing ? '+' : ''}{item?.growth?.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground font-tabular flex-shrink-0 w-10 text-right">{item?.contribution?.toFixed(1)}%</span>
                <span className="text-sm font-600 font-tabular text-foreground flex-shrink-0 w-20 text-right">{fx(formatIDR(item?.current, true))}</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${item?.color}`}
                  style={{ width: `${Math.min(100, barWidth)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
