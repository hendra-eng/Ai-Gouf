'use client';
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';

const WaterfallChartInner = dynamic(() => import('./WaterfallChartInner'), { ssr: false, loading: () => (
  <div className="h-64 animate-pulse bg-muted rounded-xl" />
) });

export default function VarianceWaterfall() {
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const { fx } = useCurrency();
  const { waterfall, expenseCategoryVariance, revenueCategoryVariance } = useBudgetData();

  const chartItems = waterfall.map((w) => ({ name: w.label.replace(/ /g, '\n'), value: w.value, isBase: w.type === 'total' }));

  // Top driver kartu dibuat dari kategori revenue/expense dengan variance
  // absolut terbesar (real, dari REVENUE_BY_CATEGORY/EXPENSE_BREAKDOWN).
  const driverCards = useMemo(() => {
    const revDrivers = revenueCategoryVariance.map((v) => ({
      label: `${v.name} (Revenue)`,
      value: Math.round(v.variance * 1_000_000),
      type: v.variance >= 0 ? 'positive' as const : 'negative' as const,
    }));
    const expDrivers = expenseCategoryVariance.map((v) => ({
      label: `${v.name} ${v.variance <= 0 ? 'Savings' : 'Overspend'}`,
      value: Math.round(-v.variance * 1_000_000), // savings (actual < budget) shown as positive contribution
      type: v.variance <= 0 ? 'positive' as const : 'negative' as const,
    }));
    return [...revDrivers, ...expDrivers]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 6);
  }, [revenueCategoryVariance, expenseCategoryVariance]);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">What Is Driving the Budget Variance?</h3>
          <p className="text-xs text-muted-foreground mt-0.5">EBITDA bridge: Budget → Actual</p>
        </div>
        <button
          onClick={() => toast.info('Membuka tampilan penuh grafik variance')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="ArrowsPointingOutIcon" size={14} />
          Expand
        </button>
      </div>
      <WaterfallChartInner items={chartItems} />
      {driverCards.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          {driverCards.map((item) => (
            <button
              key={`wf-${item.label}`}
              onClick={() => { setSelectedDriver(item.label); toast.info(item.label, { description: `${item.value > 0 ? '+' : ''}${fx(formatIDR(item.value, true))} terhadap EBITDA` }); }}
              className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors group text-left ${selectedDriver === item.label ? 'bg-secondary' : 'bg-muted hover:bg-secondary'}`}
            >
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">{item.label}</span>
              <span className={`text-xs font-semibold tabular-nums flex-shrink-0 ml-2 ${
                item.type === 'positive' ? 'text-positive' : 'text-negative'
              }`}>
                {item.value > 0 ? '+' : ''}{fx(formatIDR(item.value, true))}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
