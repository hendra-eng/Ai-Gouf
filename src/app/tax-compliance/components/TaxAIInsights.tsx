'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { formatIDR } from '@/lib/financialData';
import { useTaxComplianceData } from '../lib/taxBridge';

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
  const { obligations, byType, ppn, health, exposure } = useTaxComplianceData();

  const insights = useMemo(() => {
    const dueSoon = obligations.filter((o) => o.status === 'Due Soon');
    const overdue = obligations.filter((o) => o.status === 'Overdue');
    const list: { id: string; title: string; summary: string; numbers: string[]; severity: keyof typeof SEVERITY_CONFIG; recommendation: string; icon: string }[] = [];

    if (dueSoon.length > 0) {
      const totalDue = dueSoon.reduce((s, o) => s + o.taxAmount, 0);
      list.push({
        id: 'tax-ai-due-soon',
        title: `${dueSoon.length} Obligation${dueSoon.length > 1 ? 's' : ''} Due Soon`,
        summary: `${dueSoon.map((o) => o.taxType).join(', ')} for ${dueSoon[0].period} ${dueSoon.length > 1 ? 'are' : 'is'} due within 10 days. Filing and payment should be initiated immediately.`,
        numbers: dueSoon.map((o) => `${o.taxType}: ${fx(formatIDR(o.taxAmount, true))}`).concat([`Combined Due: ${fx(formatIDR(totalDue, true))}`]),
        severity: 'warning',
        recommendation: 'Initiate filing and payment before the due date to allow processing time.',
        icon: 'BellAlertIcon',
      });
    }

    if (overdue.length > 0) {
      const totalOverdue = overdue.reduce((s, o) => s + o.taxAmount, 0);
      list.push({
        id: 'tax-ai-overdue',
        title: `${overdue.length} Overdue Obligation${overdue.length > 1 ? 's' : ''}`,
        summary: `Some tax obligations have passed their statutory due date and require immediate attention to avoid penalties.`,
        numbers: [`Total Overdue: ${fx(formatIDR(totalOverdue, true))}`],
        severity: 'negative',
        recommendation: 'Settle overdue obligations as soon as possible; penalties accrue the longer they remain unpaid.',
        icon: 'ExclamationTriangleIcon',
      });
    }

    list.push({
      id: 'tax-ai-status',
      title: `Overall Compliance Status: ${health.overallScore >= 90 ? 'Compliant' : health.overallScore >= 75 ? 'Mostly Compliant' : 'Needs Attention'}`,
      summary: `Based on ${obligations.length} recorded obligations, ${obligations.filter((o) => o.status === 'Paid').length} are filed and paid, ${overdue.length} are overdue.`,
      numbers: [`Filed & Paid: ${obligations.filter((o) => o.status === 'Paid').length} obligations`, `Overdue: ${overdue.length}`, `Compliance Score: ${health.overallScore}/100`],
      severity: overdue.length === 0 ? 'positive' : 'negative',
      recommendation: overdue.length === 0 ? 'Maintain current compliance cadence and schedule upcoming obligations proactively.' : 'Prioritize clearing overdue obligations to restore full compliance.',
      icon: 'ShieldCheckIcon',
    });

    if (ppn.inputVAT > 0) {
      list.push({
        id: 'tax-ai-vat-credit',
        title: 'PPN Input Credit Available',
        summary: `Input VAT credit of ${fx(formatIDR(ppn.inputVAT, true))} is available for offset against output VAT, estimated from posted purchase transactions.`,
        numbers: [`Available Input VAT: ${fx(formatIDR(ppn.inputVAT, true))}`, `Net PPN Payable: ${fx(formatIDR(ppn.netPayable, true))}`],
        severity: 'positive',
        recommendation: 'Verify all input tax invoices are properly recorded before filing PPN Masa.',
        icon: 'CurrencyDollarIcon',
      });
    }

    return list;
  }, [obligations, ppn, health, fx]);

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
            Generated from recorded tax data · Not legal advice — validate with qualified tax professionals
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

      {insights.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Not enough tax data yet to generate insights.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {insights.map((insight) => {
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
                    <span key={`tax-num-${insight.id}-${ni}`} className={`text-2xs font-medium px-2 py-1 rounded-full ${cfg.badge}`}>
                      {n}
                    </span>
                  ))}
                </div>
                <div className="pt-3 border-t border-border/40">
                  <p className="text-xs text-muted-foreground mb-2">
                    <span className="font-semibold text-foreground">Action: </span>
                    {insight.recommendation}
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
      )}
    </div>
  );
}
