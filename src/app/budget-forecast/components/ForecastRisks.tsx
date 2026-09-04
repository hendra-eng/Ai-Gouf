'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useBudgetData } from '../lib/budgetBridge';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions } from '@/app/transactions/lib/arBridge';
import { useCashFlowData } from '@/app/financial-statements/lib/useCashFlowData';

const SEVERITY_STYLES: Record<string, string> = {
  High: 'bg-negative-subtle text-negative border-negative/20',
  Medium: 'bg-warning-subtle text-warning border-warning/20',
  Low: 'bg-info-subtle text-info border-info/20',
};

export default function ForecastRisks() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();
  const { fx } = useCurrency();
  const { kpis, expenseCategoryVariance } = useBudgetData();
  const { transactions } = useTransactions();
  const { CF_CORE } = useCashFlowData();

  const RISKS = useMemo(() => {
    const risks: { id: string; title: string; description: string; impact: number; severity: 'High' | 'Medium' | 'Low'; category: string; icon: string; detail: string }[] = [];

    // Revenue risk (dari budgetBridge -- real)
    const revShortfall = kpis.totalActual - kpis.totalBudget;
    if (revShortfall < 0) {
      const pctAchieved = kpis.totalBudget !== 0 ? (kpis.totalActual / kpis.totalBudget) * 100 : 0;
      risks.push({
        id: 'risk-rev',
        title: 'Revenue Risk',
        description: `Actual revenue is below planned trajectory. YTD achievement at ${pctAchieved.toFixed(1)}% of budget.`,
        impact: Math.round(revShortfall * 1_000_000),
        severity: pctAchieved < 90 ? 'High' : pctAchieved < 97 ? 'Medium' : 'Low',
        category: 'Revenue',
        icon: 'ArrowTrendingDownIcon',
        detail: `Cumulative revenue shortfall of ${fx(formatIDR(Math.abs(revShortfall) * 1_000_000, true))} vs budget. Remaining months' pipeline needs to close the gap to meet the annual target.`,
      });
    }

    // Biggest expense overspend (real, dari EXPENSE_BREAKDOWN)
    const worstOverspend = [...expenseCategoryVariance].filter((v) => v.variance > 0).sort((a, b) => b.variance - a.variance)[0];
    if (worstOverspend) {
      risks.push({
        id: 'risk-expense',
        title: `${worstOverspend.name} Expense Risk`,
        description: `${worstOverspend.name} is trending ${worstOverspend.variancePct.toFixed(1)}% above budget.`,
        impact: Math.round(-worstOverspend.variance * 1_000_000),
        severity: worstOverspend.variancePct > 15 ? 'High' : worstOverspend.variancePct > 8 ? 'Medium' : 'Low',
        category: 'Expenses',
        icon: 'ReceiptPercentIcon',
        detail: `${worstOverspend.name} overspend of ${fx(formatIDR(worstOverspend.variance * 1_000_000, true))} YTD vs budget of ${fx(formatIDR(worstOverspend.budget * 1_000_000, true))}.`,
      });
    }

    // Cash flow risk (real, dari useCashFlowData)
    if (CF_CORE.endingCash < CF_CORE.beginningCash * 0.5) {
      risks.push({
        id: 'risk-cash',
        title: 'Cash Flow Risk',
        description: 'Ending cash position has declined significantly relative to the beginning balance this period.',
        impact: Math.round((CF_CORE.endingCash - CF_CORE.beginningCash) * 1_000_000),
        severity: CF_CORE.endingCash < CF_CORE.beginningCash * 0.25 ? 'High' : 'Medium',
        category: 'Cash Flow',
        icon: 'BanknotesIcon',
        detail: `Cash moved from ${fx(formatIDR(CF_CORE.beginningCash * 1_000_000, true))} to ${fx(formatIDR(CF_CORE.endingCash * 1_000_000, true))} this period. Monitor upcoming payables closely.`,
      });
    }

    // AR collection risk (real, dari arBridge -- invoice overdue > 60 hari)
    const invoices = invoicesFromTransactions(transactions);
    const overdue60 = invoices.filter((i) => i.daysOverdue > 60 && i.outstanding > 0);
    if (overdue60.length > 0) {
      const total = overdue60.reduce((s, i) => s + i.outstanding, 0);
      const top3 = [...overdue60].sort((a, b) => b.outstanding - a.outstanding).slice(0, 3);
      risks.push({
        id: 'risk-collection',
        title: 'AR Collection Risk',
        description: `${overdue60.length} customer invoice(s) have overdue AR balances totaling ${fx(formatIDR(total, true))} beyond 60 days.`,
        impact: -total,
        severity: total > 300_000_000 ? 'High' : total > 100_000_000 ? 'Medium' : 'Low',
        category: 'Receivables',
        icon: 'InboxArrowDownIcon',
        detail: `Top overdue accounts: ${top3.map((i) => `${i.customerName} (${fx(formatIDR(i.outstanding, true))})`).join(', ')}.`,
      });
    }

    return risks;
  }, [kpis, expenseCategoryVariance, transactions, CF_CORE, fx]);

  const counts = { High: RISKS.filter((r) => r.severity === 'High').length, Medium: RISKS.filter((r) => r.severity === 'Medium').length, Low: RISKS.filter((r) => r.severity === 'Low').length };

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Forecast Risks</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Key risks to the financial forecast, based on recorded data</p>
        </div>
        <div className="flex items-center gap-2">
          {counts.High > 0 && <span className="text-xs text-negative font-semibold bg-negative-subtle px-2 py-1 rounded-full border border-negative/20">{counts.High} High</span>}
          {counts.Medium > 0 && <span className="text-xs text-warning font-semibold bg-warning-subtle px-2 py-1 rounded-full border border-warning/20">{counts.Medium} Medium</span>}
          {counts.Low > 0 && <span className="text-xs text-info font-semibold bg-info-subtle px-2 py-1 rounded-full border border-info/20">{counts.Low} Low</span>}
        </div>
      </div>

      {RISKS.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">No significant forecast risks detected from current data.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {RISKS.map((risk) => (
            <div
              key={risk.id}
              className={`rounded-xl border p-4 transition-all duration-200 ${
                risk.severity === 'High' ?'border-negative/30 bg-negative-subtle/50'
                  : risk.severity === 'Medium' ?'border-warning/30 bg-warning-subtle/50' :'border-border bg-muted/30'
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  risk.severity === 'High' ? 'bg-negative/20' :
                  risk.severity === 'Medium' ? 'bg-warning/20' : 'bg-info/20'
                }`}>
                  <Icon
                    name={risk.icon as Parameters<typeof Icon>[0]['name']}
                    size={16}
                    className={risk.severity === 'High' ? 'text-negative' : risk.severity === 'Medium' ? 'text-warning' : 'text-info'}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-foreground">{risk.title}</span>
                    <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full border ${SEVERITY_STYLES[risk.severity]}`}>
                      {risk.severity}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{risk.description}</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border/50">
                <div>
                  <p className="text-2xs text-muted-foreground">Financial Impact</p>
                  <p className="text-sm font-semibold tabular-nums text-negative">{fx(formatIDR(risk.impact, true))}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setExpanded(expanded === risk.id ? null : risk.id)}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-lg hover:bg-muted"
                  >
                    {expanded === risk.id ? 'Less' : 'Details'}
                  </button>
                  <button
                    onClick={() => router.push(`/ai-financial-analyst?analysis=${risk.category.toLowerCase().replace(/\s+/g, '-')}-risk`)}
                    className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-lg hover:bg-primary/10"
                  >
                    <Icon name="MagnifyingGlassIcon" size={12} />
                    Analyze
                  </button>
                </div>
              </div>

              {expanded === risk.id && (
                <div className="mt-3 pt-3 border-t border-border/50 animate-fade-in">
                  <p className="text-xs text-muted-foreground leading-relaxed">{risk.detail}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
