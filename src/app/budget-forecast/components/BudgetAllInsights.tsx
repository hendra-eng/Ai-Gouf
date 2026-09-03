'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const INSIGHTS = [
  {
    id: 'ai-budget-1',
    title: 'Revenue Recovery Trajectory',
    summary: 'Revenue is currently below the annual budget trajectory, but the latest forecast indicates recovery in Q4 driven by three enterprise contracts expected to close.',
    numbers: ['YTD Budget Achievement: 94.8%', 'Forecast FY Revenue: Rp 10.48M (+2.7% vs Budget)', 'Q4 Pipeline: Rp 1.92M'],
    recommendation: 'Prioritize Q4 pipeline conversion. Ensure enterprise deals in Oct–Nov close on schedule.',
    severity: 'info',
    icon: 'ArrowTrendingUpIcon',
  },
  {
    id: 'ai-budget-2',
    title: 'Marketing Overspend Alert',
    summary: 'Marketing expenses are currently 12.4% above budget. The overspend is concentrated in digital campaign spend and event costs in Q2–Q3.',
    numbers: ['Budget: Rp 180M', 'Actual YTD: Rp 202M', 'Overspend: Rp 22M (+12.4%)'],
    recommendation: 'Review marketing budget allocation for Q4. Consider reallocating from brand to performance campaigns.',
    severity: 'warning',
    icon: 'ExclamationTriangleIcon',
  },
  {
    id: 'ai-budget-3',
    title: 'EBITDA Forecast Positive',
    summary: 'Based on current trends, projected EBITDA is expected to exceed budget by 6.7% due to payroll savings and COGS efficiency improvements.',
    numbers: ['Budget EBITDA: Rp 2.55M', 'Forecast EBITDA: Rp 2.72M', 'Upside: +Rp 170M (+6.7%)'],
    recommendation: 'Protect EBITDA margin by maintaining cost discipline in Q4 OpEx categories.',
    severity: 'positive',
    icon: 'CheckCircleIcon',
  },
  {
    id: 'ai-budget-4',
    title: 'Cash Flow Adequacy',
    summary: 'Cash position remains strong at Rp 2.96M. Forecast ending cash of Rp 3.84M indicates healthy liquidity through FY2026.',
    numbers: ['Current Cash: Rp 2.96M', 'Forecast Ending Cash: Rp 3.84M', 'Minimum Threshold: Rp 1.50M'],
    recommendation: 'Consider deploying excess cash into short-term instruments to optimize returns.',
    severity: 'positive',
    icon: 'BanknotesIcon',
  },
];

const SEVERITY_CONFIG = {
  positive: { bg: 'bg-positive-subtle border-positive/20', icon: 'text-positive', badge: 'bg-positive/10 text-positive' },
  warning: { bg: 'bg-warning-subtle border-warning/20', icon: 'text-warning', badge: 'bg-warning/10 text-warning' },
  negative: { bg: 'bg-negative-subtle border-negative/20', icon: 'text-negative', badge: 'bg-negative/10 text-negative' },
  info: { bg: 'bg-info-subtle border-info/20', icon: 'text-info', badge: 'bg-info/10 text-info' },
};

export default function BudgetAIInsights() {
  const router = useRouter();
  const { fx } = useCurrency();

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon name="SparklesIcon" size={16} className="text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">AI Planning Insights</h3>
          <p className="text-xs text-muted-foreground">Generated from FY2026 budget and forecast data · Aug 26, 2026</p>
        </div>
        <button
          onClick={() => toast.info('Memperbarui insight AI...')}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-lg bg-primary/10 border border-primary/20"
        >
          <Icon name="ArrowPathIcon" size={12} />
          Refresh Insights
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INSIGHTS.map((insight) => {
          const cfg = SEVERITY_CONFIG[insight.severity as keyof typeof SEVERITY_CONFIG];
          return (
            <div key={insight.id} className={`rounded-xl border p-4 ${cfg.bg}`}>
              <div className="flex items-start gap-3 mb-3">
                <Icon name={insight.icon as Parameters<typeof Icon>[0]['name']} size={18} className={cfg.icon} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground mb-1">{insight.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{insight.summary}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {insight.numbers.map((n, ni) => (
                  <span key={`num-${insight.id}-${ni}`} className={`text-2xs font-medium px-2 py-1 rounded-full ${cfg.badge}`}>
                    {fx(n)}
                  </span>
                ))}
              </div>

              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2">
                  <span className="font-semibold text-foreground">Recommendation: </span>
                  {insight.recommendation}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router.push('/ai-financial-analyst?analysis=budget-forecast')}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Icon name="MagnifyingGlassIcon" size={12} />
                    Analyze
                  </button>
                  <button
                    onClick={() => toast.info(insight.title, { description: fx(insight.numbers.join(' · ')) })}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icon name="TableCellsIcon" size={12} />
                    View Data
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
