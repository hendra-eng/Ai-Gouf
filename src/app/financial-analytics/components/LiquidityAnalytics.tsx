'use client';
import React from 'react';
import dynamic from 'next/dynamic';

import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const LiquidityChartInner = dynamic(() => import('./LiquidityChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

const STATUS_COLORS: Record<string, string> = {
  Healthy: 'text-positive',
  Watch: 'text-warning',
  Risk: 'text-negative',
};

export default function LiquidityAnalytics() {
  const { fx } = useCurrency();
  const { liquidity, monthlyTrend, isSampleData } = useAnalyticsData();

  const currentRatio = liquidity.currentRatio.current;
  const quickRatio = liquidity.quickRatio.current;
  const cashRatio = liquidity.cashRatio.current;
  const workingCapital = liquidity.workingCapital.current;
  const cashRunway = Math.round(liquidity.cashRunwayMonths.current);

  const METRICS = [
    { label: 'Current Ratio', value: currentRatio.toFixed(2), status: currentRatio >= 2 ? 'Healthy' : currentRatio >= 1.5 ? 'Watch' : 'Risk' },
    { label: 'Quick Ratio', value: quickRatio.toFixed(2), status: quickRatio >= 1 ? 'Healthy' : quickRatio >= 0.8 ? 'Watch' : 'Risk' },
    { label: 'Cash Ratio', value: cashRatio.toFixed(2), status: cashRatio >= 0.5 ? 'Healthy' : 'Watch' },
    { label: 'Working Capital', value: formatIDR(workingCapital, true), status: workingCapital > 0 ? 'Healthy' : 'Risk' },
    { label: 'Cash Runway', value: `${cashRunway}mo`, status: cashRunway >= 6 ? 'Healthy' : 'Watch' },
  ];

  const overallHealthy = METRICS.every((m) => m.status === 'Healthy');

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Liquidity Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSampleData ? 'Thresholds are internal targets, not universal financial advice (sample data)' : 'Thresholds are internal targets, not universal financial advice'}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
          overallHealthy ? 'text-positive bg-positive-subtle border-positive/20' : 'text-warning bg-warning-subtle border-warning/20'
        }`}>
          {overallHealthy ? '✓ Healthy' : '⚠ Watch'}
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

      <LiquidityChartInner monthlyTrend={monthlyTrend} />
    </div>
  );
}
