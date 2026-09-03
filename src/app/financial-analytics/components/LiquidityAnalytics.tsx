'use client';
import React from 'react';
import dynamic from 'next/dynamic';

import { FINANCIALS, formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const LiquidityChartInner = dynamic(() => import('./LiquidityChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

const currentRatio = ((FINANCIALS.cash + FINANCIALS.accountsReceivable + FINANCIALS.inventory) / FINANCIALS.accountsPayable);
const quickRatio = ((FINANCIALS.cash + FINANCIALS.accountsReceivable) / FINANCIALS.accountsPayable);
const cashRatio = (FINANCIALS.cash / FINANCIALS.accountsPayable);
const workingCapital = FINANCIALS.cash + FINANCIALS.accountsReceivable + FINANCIALS.inventory - FINANCIALS.accountsPayable;
const cashRunway = Math.round(FINANCIALS.cash / (FINANCIALS.operatingExpenses / 12));

const METRICS = [
  { label: 'Current Ratio', value: currentRatio.toFixed(2), threshold: 2.0, status: currentRatio >= 2 ? 'Healthy' : currentRatio >= 1.5 ? 'Watch' : 'Risk' },
  { label: 'Quick Ratio', value: quickRatio.toFixed(2), threshold: 1.0, status: quickRatio >= 1 ? 'Healthy' : quickRatio >= 0.8 ? 'Watch' : 'Risk' },
  { label: 'Cash Ratio', value: cashRatio.toFixed(2), threshold: 0.5, status: cashRatio >= 0.5 ? 'Healthy' : 'Watch' },
  { label: 'Working Capital', value: formatIDR(workingCapital, true), threshold: 0, status: workingCapital > 0 ? 'Healthy' : 'Risk' },
  { label: 'Cash Runway', value: `${cashRunway}mo`, threshold: 6, status: cashRunway >= 6 ? 'Healthy' : 'Watch' },
];

const STATUS_COLORS: Record<string, string> = {
  Healthy: 'text-positive',
  Watch: 'text-warning',
  Risk: 'text-negative',
};

export default function LiquidityAnalytics() {
  const { fx } = useCurrency();
  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Liquidity Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Thresholds are internal targets, not universal financial advice</p>
        </div>
        <span className="text-xs font-semibold text-positive bg-positive-subtle px-2.5 py-1 rounded-full border border-positive/20">
          ✓ Healthy
        </span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
        {METRICS.map((m) => (
          <div key={`liq-${m.label}`} className="bg-muted rounded-xl p-3 text-center">
            <p className="text-2xs text-muted-foreground mb-1 leading-tight">{m.label}</p>
            <p className={`text-base font-bold tabular-nums ${STATUS_COLORS[m.status]}`}>{fx(m.value)}</p>
            <span className={`text-2xs font-medium ${STATUS_COLORS[m.status]}`}>{m.status}</span>
          </div>
        ))}
      </div>

      <LiquidityChartInner />
    </div>
  );
}
