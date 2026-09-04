'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const GrowthChartInner = dynamic(() => import('./GrowthChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

export default function GrowthAnalytics() {
  const { growth, comparisonLabel, isSampleData } = useAnalyticsData();

  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const barColor = (v: number) => v >= 0 ? { color: 'text-positive', bar: 'bg-positive' } : { color: 'text-negative', bar: 'bg-negative' };

  const GROWTH_METRICS = [
    { id: 'rev-growth', label: 'Revenue Growth', value: fmt(growth.revenue), bar: barColor(growth.revenue).bar, color: barColor(growth.revenue).color, pct: Math.abs(growth.revenue) },
    { id: 'gp-growth', label: 'Gross Profit Growth', value: fmt(growth.grossProfit), bar: 'bg-chart-2', color: barColor(growth.grossProfit).color, pct: Math.abs(growth.grossProfit) },
    { id: 'ebitda-growth', label: 'EBITDA Growth', value: fmt(growth.ebitda), bar: 'bg-chart-4', color: barColor(growth.ebitda).color, pct: Math.abs(growth.ebitda) },
    { id: 'np-growth', label: 'Net Profit Growth', value: fmt(growth.netProfit), bar: 'bg-chart-5', color: barColor(growth.netProfit).color, pct: Math.abs(growth.netProfit) },
    { id: 'asset-growth', label: 'Asset Growth', value: fmt(growth.assets), bar: 'bg-chart-6', color: barColor(growth.assets).color, pct: Math.abs(growth.assets) },
    { id: 'equity-growth', label: 'Equity Growth', value: fmt(growth.equity), bar: 'bg-chart-3', color: barColor(growth.equity).color, pct: Math.abs(growth.equity) },
  ];

  const allPositive = GROWTH_METRICS.every((m) => !m.value.startsWith('-'));

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Growth Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSampleData ? 'YoY comparison · FY 2026 vs FY 2025 (sample data)' : `Month-over-month · ${comparisonLabel}`}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${
          allPositive ? 'text-positive bg-positive-subtle border-positive/20' : 'text-warning bg-warning-subtle border-warning/20'
        }`}>
          {allPositive ? 'All Metrics Positive' : 'Mixed Performance'}
        </span>
      </div>

      <div className="space-y-3 mb-4">
        {GROWTH_METRICS?.map((m) => (
          <div key={m?.id}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-foreground font-medium">{m?.label}</span>
              <div className="flex items-center gap-3">
                <span className={`text-sm font-bold tabular-nums w-16 text-right ${m?.color}`}>{m?.value}</span>
              </div>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${m?.bar}`}
                style={{ width: `${Math.min(100, m?.pct * 4)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <GrowthChartInner growth={growth} />
    </div>
  );
}
