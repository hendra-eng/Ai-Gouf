'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const HealthRadarInner = dynamic(() => import('./HealthRadarInner'), { ssr: false, loading: () => (
  <div className="h-56 animate-pulse bg-muted rounded-xl" />
) });

const DIMENSIONS = [
  { label: 'Profitability', score: 88, icon: 'ChartBarIcon', color: 'text-positive', detail: 'Net Margin 21.9%, EBITDA 27.4%' },
  { label: 'Liquidity', score: 92, icon: 'BanknotesIcon', color: 'text-chart-2', detail: 'Current Ratio 2.41, Cash Rp 2.96M' },
  { label: 'Solvency', score: 79, icon: 'ScaleIcon', color: 'text-chart-3', detail: 'D/E 0.21, Interest Coverage 27.5x' },
  { label: 'Efficiency', score: 74, icon: 'ArrowPathIcon', color: 'text-chart-4', detail: 'DSO 53.8d, DPO 66.8d' },
  { label: 'Growth', score: 83, icon: 'ArrowTrendingUpIcon', color: 'text-chart-5', detail: 'Revenue +12.8%, NP +16.2%' },
];

const overallScore = Math.round(DIMENSIONS.reduce((sum, d) => sum + d.score, 0) / DIMENSIONS.length);

export default function FinancialHealthHero() {
  const { fx } = useCurrency();
  return (
    <div className="card-base p-6 bg-gradient-to-br from-card to-muted/40">
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
                strokeDasharray={`${(overallScore / 100) * 376.99} 376.99`}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-extrabold tabular-nums text-foreground">{overallScore}</span>
              <span className="text-xs text-muted-foreground">/100</span>
            </div>
          </div>
          <p className="text-sm font-semibold text-foreground mt-2">Financial Health</p>
          <p className="text-2xs text-muted-foreground text-center mt-0.5">PT Nusantara Teknologi · FY 2026</p>
          <span className="mt-2 px-2.5 py-1 rounded-full bg-positive-subtle text-positive text-xs font-semibold border border-positive/20">
            ✓ Healthy
          </span>
        </div>

        {/* Center: Radar chart */}
        <div className="flex-1 min-w-0">
          <HealthRadarInner dimensions={DIMENSIONS} />
        </div>

        {/* Right: Dimension breakdown */}
        <div className="lg:w-64 flex-shrink-0 space-y-3">
          {DIMENSIONS.map((d) => (
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
