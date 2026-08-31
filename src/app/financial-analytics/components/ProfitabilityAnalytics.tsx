'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';

const ProfitabilityChartInner = dynamic(() => import('./ProfitabilityChartInner'), { ssr: false, loading: () => (
  <div className="h-52 animate-pulse bg-muted rounded-xl" />
) });

const METRICS = ['Gross Margin', 'EBITDA Margin', 'EBIT Margin', 'Net Margin', 'ROA', 'ROE'];

export default function ProfitabilityAnalytics() {
  const router = useRouter();
  const [metric, setMetric] = useState('Net Margin');

  const VALUES: Record<string, { current: string; previous: string; benchmark: string; status: string }> = {
    'Gross Margin': { current: '44.2%', previous: '42.8%', benchmark: '40%', status: 'positive' },
    'EBITDA Margin': { current: '27.4%', previous: '25.9%', benchmark: '20%', status: 'positive' },
    'EBIT Margin': { current: '25.9%', previous: '24.3%', benchmark: '18%', status: 'positive' },
    'Net Margin': { current: '21.9%', previous: '20.1%', benchmark: '15%', status: 'positive' },
    'ROA': { current: '14.4%', previous: '12.8%', benchmark: '10%', status: 'positive' },
    'ROE': { current: '21.4%', previous: '18.2%', benchmark: '15%', status: 'positive' },
  };

  const val = VALUES[metric];

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-600 text-foreground">Profitability Analysis</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Monthly trend · FY 2026</p>
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
            className={`px-2.5 py-1 rounded-lg text-xs font-500 transition-all ${
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
          { label: 'Current', value: val.current, color: 'text-positive' },
          { label: 'Previous', value: val.previous, color: 'text-muted-foreground' },
          { label: 'Internal Target', value: `>${val.benchmark}`, color: 'text-info' },
        ].map((s) => (
          <div key={`prof-sum-${s.label}`} className="bg-muted rounded-xl p-3 text-center">
            <p className="text-2xs text-muted-foreground mb-1">{s.label}</p>
            <p className={`text-base font-700 font-tabular ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      <ProfitabilityChartInner metric={metric} />
    </div>
  );
}
