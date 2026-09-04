'use client';
import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';
import { useCashFlowData } from '@/app/financial-statements/lib/useCashFlowData';

const SEVERITY_CONFIG = {
  positive: { bg: 'bg-positive-subtle border-positive/20', icon: 'text-positive', badge: 'bg-positive/10 text-positive' },
  warning: { bg: 'bg-warning-subtle border-warning/20', icon: 'text-warning', badge: 'bg-warning/10 text-warning' },
  negative: { bg: 'bg-negative-subtle border-negative/20', icon: 'text-negative', badge: 'bg-negative/10 text-negative' },
  info: { bg: 'bg-info-subtle border-info/20', icon: 'text-info', badge: 'bg-info/10 text-info' },
};

export default function BudgetAIInsights() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { kpis, lines, periodLabel, expenseCategoryVariance } = useBudgetData();
  const { CF_CORE } = useCashFlowData();

  const INSIGHTS = useMemo(() => {
    const list: { id: string; title: string; summary: string; numbers: string[]; recommendation: string; severity: keyof typeof SEVERITY_CONFIG; icon: string }[] = [];
    const achievement = kpis.totalBudget !== 0 ? (kpis.totalActual / kpis.totalBudget) * 100 : 0;
    const revForecastVar = lines.revenue.budget !== 0 ? ((lines.revenue.forecast - lines.revenue.budget) / lines.revenue.budget) * 100 : 0;

    list.push({
      id: 'ai-budget-revenue',
      title: achievement >= 95 ? 'Revenue On Track' : 'Revenue Below Trajectory',
      summary: achievement >= 95
        ? 'Revenue is tracking close to or above the annual budget trajectory based on posted transactions.'
        : 'Revenue is currently below the annual budget trajectory based on posted transactions.',
      numbers: [`YTD Budget Achievement: ${achievement.toFixed(1)}%`, `Forecast FY Revenue: ${fx(formatIDR(lines.revenue.forecast * 1_000_000, true))} (${revForecastVar >= 0 ? '+' : ''}${revForecastVar.toFixed(1)}% vs Budget)`],
      recommendation: achievement >= 95 ? 'Maintain current sales cadence to protect the FY trajectory.' : 'Prioritize pipeline conversion in the remaining months to close the gap to budget.',
      severity: achievement >= 95 ? 'positive' : 'info',
      icon: 'ArrowTrendingUpIcon',
    });

    const worstOverspend = [...expenseCategoryVariance].filter((v) => v.variance > 0).sort((a, b) => b.variance - a.variance)[0];
    if (worstOverspend) {
      list.push({
        id: 'ai-budget-expense',
        title: `${worstOverspend.name} Overspend Alert`,
        summary: `${worstOverspend.name} expenses are currently ${worstOverspend.variancePct.toFixed(1)}% above budget for the period.`,
        numbers: [`Budget: ${fx(formatIDR(worstOverspend.budget * 1_000_000, true))}`, `Actual YTD: ${fx(formatIDR(worstOverspend.actual * 1_000_000, true))}`, `Overspend: ${fx(formatIDR(worstOverspend.variance * 1_000_000, true))} (+${worstOverspend.variancePct.toFixed(1)}%)`],
        recommendation: `Review ${worstOverspend.name.toLowerCase()} spend for the remaining months and consider reallocating budget.`,
        severity: 'warning',
        icon: 'ExclamationTriangleIcon',
      });
    }

    const ebitdaVar = lines.ebitda.budget !== 0 ? ((lines.ebitda.forecast - lines.ebitda.budget) / lines.ebitda.budget) * 100 : 0;
    list.push({
      id: 'ai-budget-ebitda',
      title: ebitdaVar >= 0 ? 'EBITDA Forecast Positive' : 'EBITDA Below Budget',
      summary: ebitdaVar >= 0
        ? `Based on current trends, projected full-year EBITDA is expected to exceed budget by ${ebitdaVar.toFixed(1)}%.`
        : `Based on current trends, projected full-year EBITDA is tracking ${Math.abs(ebitdaVar).toFixed(1)}% below budget.`,
      numbers: [`Budget EBITDA: ${fx(formatIDR(lines.ebitda.budget * 1_000_000, true))}`, `Forecast EBITDA: ${fx(formatIDR(lines.ebitda.forecast * 1_000_000, true))}`],
      recommendation: ebitdaVar >= 0 ? 'Protect the EBITDA margin by maintaining cost discipline in remaining months.' : 'Identify cost efficiencies or revenue upside to close the EBITDA gap.',
      severity: ebitdaVar >= 0 ? 'positive' : 'negative',
      icon: 'CheckCircleIcon',
    });

    list.push({
      id: 'ai-budget-cash',
      title: 'Cash Position Update',
      summary: `Current cash position is ${fx(formatIDR(CF_CORE.endingCash * 1_000_000, true))}, based on posted cash flow transactions for ${periodLabel || 'the period'}.`,
      numbers: [`Current Cash: ${fx(formatIDR(CF_CORE.endingCash * 1_000_000, true))}`, `Beginning Cash: ${fx(formatIDR(CF_CORE.beginningCash * 1_000_000, true))}`],
      recommendation: CF_CORE.endingCash >= CF_CORE.beginningCash ? 'Consider deploying excess cash into short-term instruments to optimize returns.' : 'Monitor upcoming payables closely to maintain adequate liquidity.',
      severity: CF_CORE.endingCash >= CF_CORE.beginningCash ? 'positive' : 'warning',
      icon: 'BanknotesIcon',
    });

    return list;
  }, [kpis, lines, expenseCategoryVariance, CF_CORE, periodLabel, fx]);

  return (
    <div className="card-base p-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Icon name="SparklesIcon" size={16} className="text-primary" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">AI Planning Insights</h3>
          <p className="text-xs text-muted-foreground">Generated from {periodLabel || 'current'} budget and forecast data</p>
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
          const cfg = SEVERITY_CONFIG[insight.severity];
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
                    {n}
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
                    onClick={() => toast.info(insight.title, { description: insight.numbers.join(' · ') })}
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
