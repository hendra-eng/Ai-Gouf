'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const SolvencyChartInner = dynamic(() => import('./SolvencyChartInner'), { ssr: false, loading: () => (
  <div className="h-44 animate-pulse bg-muted rounded-xl" />
) });

type TabType = 'solvency' | 'efficiency';

export default function SolvencyEfficiencyAnalytics() {
  const { fx } = useCurrency();
  const [tab, setTab] = useState<TabType>('solvency');
  const { solvency, efficiency, monthlyTrend, isSampleData } = useAnalyticsData();

  const SOLVENCY = [
    { label: 'Debt-to-Equity', value: solvency.debtToEquity.current.toFixed(2), sub: solvency.debtToEquity.current < 0.5 ? 'Low leverage' : solvency.debtToEquity.current < 1 ? 'Moderate leverage' : 'High leverage' },
    { label: 'Debt Ratio', value: solvency.debtRatio.current.toFixed(3), sub: 'Assets financed by debt' },
    { label: 'Interest Coverage', value: `${solvency.interestCoverage.current.toFixed(1)}x`, sub: 'EBITDA / Interest' },
    { label: 'Total Liabilities', value: formatIDR(solvency.totalDebt.current, true), sub: isSampleData ? 'Rp 1.80M' : 'Current + Non-Current' },
  ];

  const EFFICIENCY = [
    { label: 'Asset Turnover', value: `${efficiency.assetTurnover.current.toFixed(2)}x`, sub: 'Revenue / Assets' },
    { label: 'DSO', value: `${Math.round(efficiency.dso.current)}d`, sub: 'Days Sales Outstanding' },
    { label: 'DPO', value: `${Math.round(efficiency.dpo.current)}d`, sub: 'Days Payable Outstanding' },
    { label: 'Cash Conv. Cycle', value: `${Math.round(efficiency.cashConversionCycle.current)}d`, sub: 'DSO - DPO' },
  ];

  const items = tab === 'solvency' ? SOLVENCY : EFFICIENCY;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-foreground">
          {tab === 'solvency' ? 'Solvency Analysis' : 'Operational Efficiency'}
        </h3>
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {(['solvency', 'efficiency'] as TabType[]).map((t) => (
            <button
              key={`solvtab-${t}`}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                t === tab ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'solvency' ? 'Solvency' : 'Efficiency'}
            </button>
          ))}
        </div>
      </div>
      {isSampleData && (
        <p className="text-xs text-muted-foreground -mt-2 mb-3">Showing sample data</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        {items.map((item) => (
          <div key={`solv-${item.label}`} className="bg-muted rounded-xl p-3">
            <p className="text-2xs text-muted-foreground mb-1">{item.label}</p>
            <p className="text-xl font-bold tabular-nums text-foreground">{fx(item.value)}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">{fx(item.sub)}</p>
          </div>
        ))}
      </div>

      <SolvencyChartInner mode={tab} monthlyTrend={monthlyTrend} />
    </div>
  );
}
