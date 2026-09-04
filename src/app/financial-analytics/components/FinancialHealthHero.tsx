'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const HealthRadarInner = dynamic(() => import('./HealthRadarInner'), { ssr: false, loading: () => (
  <div className="h-56 animate-pulse bg-muted rounded-xl" />
) });

export default function FinancialHealthHero() {
  const { fx } = useCurrency();
  const { healthDimensions, overallHealthScore, companyName, periodLabel, isSampleData } = useAnalyticsData();

  return (
    <div className="card-base p-6 bg-gradient-to-br from-card to-muted/40">
      {isSampleData && (
        <p className="text-xs text-muted-foreground mb-3">Showing sample data</p>
      )}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: Overall score */}
        <div className="flex flex-col items-center justify-center lg:w-48 flex-shrink-0">
          <div className="relative w-36 h-36">
            <svg viewBox="0 0 144 144" className="w-full h-full -rotate-90">
              <circle cx="72" cy="72" r="60" fill="none" stroke="var(--muted)" strokeWidth="12" />
              <circle
                cx="72" cy="72" r="60"
                fill="none"
                stroke="var(--primary)"
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${(overallHealthScore / 100) * 376.99} 376.99`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-extrabold tabular-nums text-foreground">{overallHealthScore}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <p className="text-sm font-semibold text-foreground mt-2">Financial Health</p>
          <p className="text-2xs text-muted-foreground text-center mt-0.5">{companyName} · {periodLabel}</p>
          <span className={`mt-2 px-2.5 py-1 rounded-full text-xs font-semibold border ${
            overallHealthScore >= 70 ? 'bg-positive-subtle text-positive border-positive/20' : overallHealthScore >= 50 ? 'bg-warning-subtle text-warning border-warning/20' : 'bg-negative-subtle text-negative border-negative/20'
          }`}>
            {overallHealthScore >= 70 ? '✓ Healthy' : overallHealthScore >= 50 ? '⚠ Watch' : '⚠ At Risk'}
          </span>
        </div>

        {/* Center: Radar chart */}
        <div className="flex-1 min-w-0">
          <HealthRadarInner dimensions={healthDimensions} />
        </div>

        {/* Right: Dimension breakdown */}
        <div className="lg:w-64 flex-shrink-0 space-y-3">
          {healthDimensions.map((d) => (
            <div key={`health-dim-${d.label}`} className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Icon name={d.icon as Parameters<typeof Icon>[0]['name']} size={14} className={d.color} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-foreground">{d.label}</span>
                  <span className={`text-xs font-bold tabular-nums ${d.color}`}>{d.score}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      d.score >= 85 ? 'bg-positive' : d.score >= 70 ? 'bg-warning' : 'bg-negative'
                    }`}
                    style={{ width: `${d.score}%` }}
                  />
                </div>
                <p className="text-2xs text-muted-foreground mt-0.5 truncate">{fx(d.detail)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
