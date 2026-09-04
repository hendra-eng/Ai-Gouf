'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const COLORS = ['bg-chart-2', 'bg-chart-4', 'bg-chart-5', 'bg-negative', 'bg-positive', 'bg-chart-6', 'bg-chart-3', 'bg-muted-foreground'];

export default function ExpenseDrivers() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { expenseBreakdown, isSampleData } = useAnalyticsData();

  const EXPENSES = expenseBreakdown.map((e, i) => ({
    id: e.id,
    category: e.name,
    current: e.current * 1_000_000,
    previous: e.previous * 1_000_000,
    growth: e.growth,
    contribution: e.contribution,
    color: COLORS[i % COLORS.length],
  }));

  const totalExpense = EXPENSES?.reduce((sum, e) => sum + e?.current, 0);
  const fastest = [...EXPENSES]?.sort((a, b) => b?.growth - a?.growth)?.slice(0, 3);
  const maxCurrent = EXPENSES?.[0]?.current || 1;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Expense Drivers</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSampleData ? 'Ranked by materiality · FY 2026 (sample data)' : 'Ranked by materiality · Connected to active client'}
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xs text-muted-foreground">Total Expenses</p>
          <p className="text-base font-bold tabular-nums text-foreground">{fx(formatIDR(totalExpense, true))}</p>
        </div>
      </div>

      {/* Fastest growing alert */}
      {fastest.length > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-warning-subtle border border-warning/20">
          <p className="text-xs font-semibold text-warning mb-1.5 flex items-center gap-1.5">
            <Icon name="ArrowTrendingUpIcon" size={13} />
            Fastest Growing Categories
          </p>
          <div className="flex flex-wrap gap-2">
            {fastest?.map((f) => (
              <span key={`fast-${f?.id}`} className="text-2xs font-medium px-2 py-1 rounded-full bg-warning/10 text-warning">
                {f?.category}: {f?.growth >= 0 ? '+' : ''}{f?.growth?.toFixed(1)}%
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {EXPENSES?.map((item) => {
          const isGrowing = item?.growth > 0;
          const barWidth = (item?.current / maxCurrent) * 100;
          return (
            <div
              key={item?.id}
              className="group cursor-pointer rounded-xl p-3 hover:bg-muted/40 transition-colors"
              onClick={() => router?.push('/transactions')}
            >
              <div className="flex items-center gap-3 mb-1.5">
                <div className={`w-2 h-2 rounded-sm flex-shrink-0 ${item?.color}`} />
                <span className="text-sm font-medium text-foreground flex-1 truncate">{item?.category}</span>
                <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ${isGrowing ? 'text-negative' : 'text-positive'}`}>
                  {isGrowing ? '+' : ''}{item?.growth?.toFixed(1)}%
                </span>
                <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0 w-10 text-right">{item?.contribution?.toFixed(1)}%</span>
                <span className="text-sm font-semibold tabular-nums text-foreground flex-shrink-0 w-20 text-right">{fx(formatIDR(item?.current, true))}</span>
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
        {EXPENSES.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">No operating expense data yet for this client.</p>
        )}
      </div>
    </div>
  );
}
