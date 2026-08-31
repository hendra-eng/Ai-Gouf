'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';

import { FINANCIALS, formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const SolvencyChartInner = dynamic(() => import('./SolvencyChartInner'), { ssr: false, loading: () => (
  <div className="h-44 animate-pulse bg-muted rounded-xl" />
) });

const dso = Math.round((FINANCIALS.accountsReceivable / FINANCIALS.revenue) * 365);
const dpo = Math.round((FINANCIALS.accountsPayable / FINANCIALS.cogs) * 365);
const assetTurnover = (FINANCIALS.revenue / FINANCIALS.totalAssets).toFixed(2);
const interestCoverage = (FINANCIALS.ebitda / FINANCIALS.interestExpense).toFixed(1);
const debtRatio = (FINANCIALS.totalDebt / FINANCIALS.totalAssets).toFixed(3);

type TabType = 'solvency' | 'efficiency';

export default function SolvencyEfficiencyAnalytics() {
  const { fx } = useCurrency();
  const [tab, setTab] = useState<TabType>('solvency');

  const SOLVENCY = [
    { label: 'Debt-to-Equity', value: '0.21', sub: 'Low leverage' },
    { label: 'Debt Ratio', value: debtRatio, sub: 'Assets financed by debt' },
    { label: 'Interest Coverage', value: `${interestCoverage}x`, sub: 'EBITDA / Interest' },
    { label: 'Total Debt', value: formatIDR(FINANCIALS.totalDebt, true), sub: 'Rp 1.80B' },
  ];

  const EFFICIENCY = [
    { label: 'Asset Turnover', value: `${assetTurnover}x`, sub: 'Revenue / Assets' },
    { label: 'DSO', value: `${dso}d`, sub: 'Days Sales Outstanding' },
    { label: 'DPO', value: `${dpo}d`, sub: 'Days Payable Outstanding' },
    { label: 'Cash Conv. Cycle', value: `${dso - dpo}d`, sub: 'DSO - DPO' },
  ];

  const items = tab === 'solvency' ? SOLVENCY : EFFICIENCY;

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-600 text-foreground">
          {tab === 'solvency' ? 'Solvency Analysis' : 'Operational Efficiency'}
        </h3>
        <div className="flex items-center bg-muted border border-border rounded-lg p-0.5">
          {(['solvency', 'efficiency'] as TabType[]).map((t) => (
            <button
              key={`solvtab-${t}`}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-500 transition-all ${
                t === tab ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'solvency' ? 'Solvency' : 'Efficiency'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        {items.map((item) => (
          <div key={`solv-${item.label}`} className="bg-muted rounded-xl p-3">
            <p className="text-2xs text-muted-foreground mb-1">{item.label}</p>
            <p className="text-xl font-700 font-tabular text-foreground">{fx(item.value)}</p>
            <p className="text-2xs text-muted-foreground mt-0.5">{fx(item.sub)}</p>
          </div>
        ))}
      </div>

      <SolvencyChartInner mode={tab} />
    </div>
  );
}
