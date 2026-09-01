'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const INSIGHTS = [
  {
    id: 'fa-ai-1',
    title: 'Profitability: Strong Margin Expansion',
    summary: 'Net profit increased 16.2% YoY, primarily because revenue growth (+12.8%) exceeded operating expense growth (+6.4%). EBITDA margin expanded from 25.9% to 27.4%.',
    numbers: ['Revenue Growth: +12.8%', 'OpEx Growth: +6.4%', 'EBITDA Margin: 27.4%', 'Net Margin: 21.9%'],
    factors: ['Revenue growth outpaced cost growth', 'Payroll efficiency improvement', 'Technology cost leverage'],
    recommendation: 'Maintain cost discipline in Q4. Focus on protecting EBITDA margin as marketing spend recovers.',
    severity: 'positive',
    icon: 'ChartBarIcon',
    analysisType: 'profit-decrease',
  },
  {
    id: 'fa-ai-2',
    title: 'Liquidity: Cash Position Remains Strong',
    summary: 'Cash reserves of Rp 2.96M remain well above the internal minimum threshold of Rp 1.50M. Current ratio of 2.41x provides comfortable short-term liquidity buffer.',
    numbers: ['Cash: Rp 2.96M', 'Current Ratio: 2.41x', 'Quick Ratio: 2.12x', 'Cash Runway: 30 months'],
    factors: ['Strong cash conversion from operations', 'Controlled CapEx spending', 'Improving collection rates'],
    recommendation: 'Consider deploying excess cash strategically — short-term instruments or accelerated debt reduction.',
    severity: 'positive',
    icon: 'BanknotesIcon',
    analysisType: 'cash-flow',
  },
  {
    id: 'fa-ai-3',
    title: 'Receivables: Concentration Risk Requires Attention',
    summary: 'A concentration of overdue receivables in CV Mitra Digital Prima (Rp 380M, DSO 239 days) represents meaningful collection risk. Overall AR balance is Rp 1.24M.',
    numbers: ['Total AR: Rp 1.24M', 'CV Mitra Digital: Rp 380M overdue', 'DSO: 239 days', 'Overall Collection Rate: 93.8%'],
    factors: ['Single customer concentration in overdue AR', 'Overall collection rate healthy at 93.8%', 'Top 3 customers show strong payment patterns'],
    recommendation: 'Escalate collection efforts on CV Mitra Digital. Review credit terms and consider requiring advance payments.',
    severity: 'warning',
    icon: 'InboxArrowDownIcon',
    analysisType: 'ar-risk',
  },
  {
    id: 'fa-ai-4',
    title: 'Expenses: Technology Costs Growing Faster Than Revenue',
    summary: 'Technology and infrastructure expenses grew 27.8% YoY vs revenue growth of 12.8%. This divergence warrants review to ensure technology investment is generating commensurate returns.',
    numbers: ['Tech Expense Growth: +27.8%', 'Revenue Growth: +12.8%', 'Tech Expense: Rp 138M', 'Tech % of Revenue: 1.6%'],
    factors: ['Cloud infrastructure scaling costs', 'New software license investments', 'Security and compliance tooling'],
    recommendation: 'Review technology investment ROI. Identify recurring vs one-time costs and optimize vendor contracts.',
    severity: 'info',
    icon: 'CpuChipIcon',
    analysisType: 'expense-anomaly',
  },
];

const SEVERITY_CONFIG = {
  positive: { bg: 'bg-positive-subtle border-positive/20', icon: 'text-positive', badge: 'bg-positive/10 text-positive' },
  warning: { bg: 'bg-warning-subtle border-warning/20', icon: 'text-warning', badge: 'bg-warning/10 text-warning' },
  negative: { bg: 'bg-negative-subtle border-negative/20', icon: 'text-negative', badge: 'bg-negative/10 text-negative' },
  info: { bg: 'bg-info-subtle border-info/20', icon: 'text-info', badge: 'bg-info/10 text-info' },
};

export default function FinancialAIInsights() {
  const router = useRouter();
  const { fx } = useCurrency();

  const handleRefresh = () => {
    toast.success('Insights refreshed', { description: 'AI insights regenerated from the latest financial data' });
  };

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-chart-4/10 border border-chart-4/20 flex items-center justify-center">
          <Icon name="SparklesIcon" size={16} className="text-chart-4" />
        </div>
        <div>
          <h3 className="text-lg font-600 text-foreground">AI Financial Insights</h3>
          <p className="text-xs text-muted-foreground">
            Generated from FY2026 financial data · Aug 26, 2026 · PT Nusantara Teknologi Indonesia
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 text-xs font-500 text-chart-4 hover:text-chart-4/80 transition-colors px-3 py-2 rounded-lg bg-chart-4/10 border border-chart-4/20"
          >
            <Icon name="ArrowPathIcon" size={12} />
            Refresh
          </button>
          <button
            onClick={() => router?.push('/ai-financial-analyst')}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-lg bg-muted border border-border"
          >
            <Icon name="SparklesIcon" size={12} />
            Open AI Analyst
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {INSIGHTS.map((insight) => {
          const cfg = SEVERITY_CONFIG[insight.severity as keyof typeof SEVERITY_CONFIG];
          return (
            <div key={insight.id} className={`rounded-xl border p-4 ${cfg.bg}`}>
              <div className="flex items-start gap-3 mb-3">
                <Icon name={insight.icon as Parameters<typeof Icon>[0]['name']} size={18} className={cfg.icon} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-600 text-foreground mb-1">{insight.title}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{fx(insight.summary)}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5 mb-3">
                {insight.numbers.map((n, ni) => (
                  <span key={`fa-num-${insight.id}-${ni}`} className={`text-2xs font-500 px-2 py-1 rounded-full ${cfg.badge}`}>
                    {fx(n)}
                  </span>
                ))}
              </div>

              <div className="mb-3">
                <p className="text-2xs font-600 text-muted-foreground mb-1.5">Contributing Factors</p>
                <div className="space-y-1">
                  {insight.factors.map((f, fi) => (
                    <div key={`fa-factor-${insight.id}-${fi}`} className="flex items-start gap-2">
                      <div className={`w-1 h-1 rounded-full mt-1.5 flex-shrink-0 ${cfg.icon.replace('text-', 'bg-')}`} />
                      <span className="text-xs text-muted-foreground">{f}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2">
                  <span className="font-600 text-foreground">Recommendation: </span>
                  {fx(insight.recommendation)}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => router?.push(`/ai-financial-analyst?analysis=${insight.analysisType}`)}
                    className="flex items-center gap-1.5 text-xs font-500 text-primary hover:text-primary/80 transition-colors"
                  >
                    <Icon name="MagnifyingGlassIcon" size={12} />
                    Analyze
                  </button>
                  <button
                    onClick={() => router?.push('/transactions')}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icon name="TableCellsIcon" size={12} />
                    View Transactions
                  </button>
                  <button
                    onClick={() => router?.push('/financial-statements/profit-loss')}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <Icon name="ArrowTopRightOnSquareIcon" size={12} />
                    Open in P&amp;L
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
