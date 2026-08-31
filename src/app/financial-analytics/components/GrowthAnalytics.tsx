'use client';
import React from 'react';
import dynamic from 'next/dynamic';


const GrowthChartInner = dynamic(() => import('./GrowthChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

const GROWTH_METRICS = [
  { id: 'rev-growth', label: 'Revenue Growth', value: '+12.8%', prev: '+9.4%', color: 'text-positive', bar: 'bg-positive', pct: 12.8 },
  { id: 'gp-growth', label: 'Gross Profit Growth', value: '+15.2%', prev: '+11.8%', color: 'text-positive', bar: 'bg-chart-2', pct: 15.2 },
  { id: 'ebitda-growth', label: 'EBITDA Growth', value: '+18.4%', prev: '+14.2%', color: 'text-positive', bar: 'bg-chart-4', pct: 18.4 },
  { id: 'np-growth', label: 'Net Profit Growth', value: '+16.2%', prev: '+12.6%', color: 'text-positive', bar: 'bg-chart-5', pct: 16.2 },
  { id: 'asset-growth', label: 'Asset Growth', value: '+8.4%', prev: '+6.2%', color: 'text-positive', bar: 'bg-chart-6', pct: 8.4 },
  { id: 'equity-growth', label: 'Equity Growth', value: '+11.6%', prev: '+9.8%', color: 'text-positive', bar: 'bg-chart-3', pct: 11.6 },
];

export default function GrowthAnalytics() {
  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-600 text-foreground">Growth Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">YoY comparison · FY 2026 vs FY 2025</p>
        </div>
        <span className="text-xs font-600 text-positive bg-positive-subtle px-2.5 py-1 rounded-full border border-positive/20">
          All Metrics Positive
        </span>
      </div>

      <div className="space-y-3 mb-4">
        {GROWTH_METRICS?.map((m) => (
          <div key={m?.id}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm text-foreground font-500">{m?.label}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground font-tabular">Prev: {m?.prev}</span>
                <span className={`text-sm font-700 font-tabular w-16 text-right ${m?.color}`}>{m?.value}</span>
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

      <GrowthChartInner />
    </div>
  );
}
