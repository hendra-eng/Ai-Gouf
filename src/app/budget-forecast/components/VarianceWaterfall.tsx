'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const WaterfallChartInner = dynamic(() => import('./WaterfallChartInner'), { ssr: false, loading: () => (
  <div className="h-64 animate-pulse bg-muted rounded-xl" />
) });

export default function VarianceWaterfall() {
  const [selectedDriver, setSelectedDriver] = useState<string | null>(null);
  const { fx } = useCurrency();

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">What Is Driving the Budget Variance?</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Net Profit bridge: Budget → Forecast</p>
        </div>
        <button
          onClick={() => toast.info('Membuka tampilan penuh grafik variance')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="ArrowsPointingOutIcon" size={14} />
          Expand
        </button>
      </div>
      <WaterfallChartInner />
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[
          { label: 'Budget Net Profit', value: 1_760_000_000, type: 'base' },
          { label: 'Revenue Upside', value: 80_000_000, type: 'positive' },
          { label: 'COGS Savings', value: 60_000_000, type: 'positive' },
          { label: 'Payroll Savings', value: 22_000_000, type: 'positive' },
          { label: 'Marketing Overspend', value: -22_000_000, type: 'negative' },
          { label: 'Other Savings', value: 10_000_000, type: 'positive' },
        ]?.map((item) => (
          <button
            key={`wf-${item?.label}`}
            onClick={() => { setSelectedDriver(item?.label); toast.info(item?.label, { description: `${item?.value > 0 ? '+' : ''}${fx(formatIDR(item?.value, true))} terhadap Net Profit` }); }}
            className={`flex items-center justify-between px-3 py-2 rounded-lg transition-colors group text-left ${selectedDriver === item?.label ? 'bg-secondary' : 'bg-muted hover:bg-secondary'}`}
          >
            <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{item?.label}</span>
            <span className={`text-xs font-semibold tabular-nums ${
              item?.type === 'positive' ? 'text-positive' :
              item?.type === 'negative'? 'text-negative' : 'text-foreground'
            }`}>
              {item?.value > 0 ? '+' : ''}{fx(formatIDR(item?.value, true))}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
