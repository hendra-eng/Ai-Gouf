'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const INSIGHTS = [
  {
    id: 'tax-ai-1',
    title: 'PPh 21 & PPh 23 Deadline Approaching',
    summary: 'Two withholding tax obligations for Aug 2026 are due in 15 days (Sep 10). Filing and payment workflows should be initiated immediately.',
    numbers: ['PPh 21: Rp 38.4M', 'PPh 23: Rp 12.8M', 'Combined Due: Rp 51.2M'],
    severity: 'warning',
    recommendation: 'Initiate filing process for PPh 21 and PPh 23 before Sep 5 to allow processing time.',
    icon: 'BellAlertIcon',
  },
  {
    id: 'tax-ai-2',
    title: 'Depreciation Reconciliation Difference',
    summary: 'A difference of Rp 24M exists between accounting depreciation and tax-deductible depreciation. This may require a fiscal correction in the annual tax return.',
    numbers: ['Accounting Depreciation: Rp 248M', 'Tax Depreciation: Rp 224M', 'Difference: Rp 24M (9.7%)'],
    severity: 'info',
    recommendation: 'Review asset depreciation schedule and prepare fiscal adjustment documentation. Validate with applicable PPh regulations.',
    icon: 'DocumentMagnifyingGlassIcon',
  },
  {
    id: 'tax-ai-3',
    title: 'Overall Compliance Status: Compliant',
    summary: 'All tax obligations for periods prior to Aug 2026 have been filed and paid. No overdue items are recorded in the system.',
    numbers: ['Filed & Paid: 8 obligations', 'Overdue: 0', 'Compliance Score: 94/100'],
    severity: 'positive',
    recommendation: 'Maintain current compliance cadence. Schedule Sep obligations proactively.',
    icon: 'ShieldCheckIcon',
  },
  {
    id: 'tax-ai-4',
    title: 'PPN Input Credit Opportunity',
    summary: 'Input VAT credit of Rp 48.5M is available for offset against output VAT. Ensure all input tax invoices are properly documented and claimed.',
    numbers: ['Available Input VAT: Rp 48.5M', 'Reduces Net PPN Payable by: Rp 48.5M', 'Net PPN After Credit: Rp 94.2M'],
    severity: 'positive',
    recommendation: 'Verify all input tax invoices are properly recorded before filing PPN Masa. Missing invoices may reduce claimable credit.',
    icon: 'CurrencyDollarIcon',
  },
];

const SEVERITY_CONFIG = {
  positive: { bg: 'bg-positive-subtle border-positive/20', icon: 'text-positive', badge: 'bg-positive/10 text-positive' },
  warning: { bg: 'bg-warning-subtle border-warning/20', icon: 'text-warning', badge: 'bg-warning/10 text-warning' },
  negative: { bg: 'bg-negative-subtle border-negative/20', icon: 'text-negative', badge: 'bg-negative/10 text-negative' },
  info: { bg: 'bg-info-subtle border-info/20', icon: 'text-info', badge: 'bg-info/10 text-info' },
};

export default function TaxAIInsights() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 900);
  };

  const handleAnalyze = (insightId: string) => {
    router.push(`/ai-financial-analyst?insight=${insightId}`);
  };

  const handleViewRecords = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-chart-3/10 border border-chart-3/20 flex items-center justify-center">
          <Icon name="SparklesIcon" size={16} className="text-chart-3" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">AI Compliance Insights</h3>
          <p className="text-xs text-muted-foreground">
            Generated from recorded tax data · Aug 2026 · Not legal advice — validate with qualified tax professionals
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="ml-auto flex items-center gap-1.5 text-xs font-medium text-chart-3 hover:text-chart-3/80 transition-colors px-3 py-2 rounded-lg bg-chart-3/10 border border-chart-3/20"
        >
          <Icon name="ArrowPathIcon" size={12} className={isRefreshing ? 'animate-spin' : ''} />
          Refresh
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
                  <p className="text-xs text-muted-foreground leading-relaxed">{fx(insight.summary)}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {insight.numbers.map((n, ni) => (
                  <span key={`tax-num-${insight.id}-${ni}`} className={`text-2xs font-medium px-2 py-1 rounded-full ${cfg.badge}`}>
                    {fx(n)}
                  </span>
                ))}
              </div>
              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2">
                  <span className="font-semibold text-foreground">Action: </span>
                  {fx(insight.recommendation)}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleAnalyze(insight.id)}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  >
                    <Icon name="MagnifyingGlassIcon" size={12} />
                    Analyze
                  </button>
                  <button
                    onClick={handleViewRecords}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icon name="ArrowTopRightOnSquareIcon" size={12} />
                    View Records
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
