'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { useAnalyticsData } from '../lib/useAnalyticsData';

const ProfitabilityChartInner = dynamic(() => import('./ProfitabilityChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

const METRICS = ['Gross Margin', 'EBITDA Margin', 'EBIT Margin', 'Net Margin', 'ROA', 'ROE'];

export default function ProfitabilityAnalytics() {
  const router = useRouter();
  const [metric, setMetric] = useState('Net Margin');
  const data = useAnalyticsData();
  const { margins, monthlyTrend, periodLabel, isSampleData } = data;

  const BENCHMARK: Record<string, number> = { 'Gross Margin': 40, 'EBITDA Margin': 20, 'EBIT Margin': 18, 'Net Margin': 15, 'ROA': 10, 'ROE': 15 };
  const VALUES: Record<string, { current: number; previous: number }> = {
    'Gross Margin': margins.gross, 'EBITDA Margin': margins.ebitda, 'EBIT Margin': margins.ebit,
    'Net Margin': margins.net, 'ROA': margins.roa, 'ROE': margins.roe,
  };

  const val = VALUES[metric];

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Profitability Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isSampleData ? 'Monthly trend · FY 2026 (sample data)' : `Monthly trend · ${periodLabel}`}
          </p>
        </div>
        <button
          onClick={() => router?.push('/ai-financial-analyst?analysis=profit-decrease')}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Icon name="ArrowTopRightOnSquareIcon" size={14} />
          Drill Down
        </button>
      </div>

      {/* Metric switcher */}
      <div className="flex flex-wrap gap-1 mb-4">
        {METRICS.map((m) => (
          <button
            key={`prof-${m}`}
            onClick={() => setMetric(m)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
              m === metric ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {m}
          </button>
        ))}
      </div>

      {/* Summary row */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Current', value: `${val.current.toFixed(1)}%`, color: val.current >= (BENCHMARK[metric] || 0) ? 'text-positive' : 'text-warning' },
          { label: isSampleData ? 'Previous' : 'Prev. Month', value: `${val.previous.toFixed(1)}%`, color: 'text-muted-foreground' },
          { label: 'Internal Target', value: `>${BENCHMARK[metric]}%`, color: 'text-info' },
        ].map((s) => (
          <div key={`prof-sum-${s.label}`} className="bg-muted rounded-xl p-3 text-center">
            <p className="text-2xs text-muted-foreground mb-1">{s.label}</p>
            <p className={`text-base font-bold tabular-nums ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <ProfitabilityChartInner metric={metric} monthlyTrend={monthlyTrend} benchmark={BENCHMARK[metric] || 15} />
    </div>
  );
}
