'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, TrendingUp, AlertTriangle, CheckCircle, ArrowRight, ChevronRight } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';


// Backend integration point: replace with /api/ai/insights?company=&period=
const insights = [
  {
    id: 'ins-001',
    severity: 'warning' as const,
    icon: AlertTriangle,
    title: 'Marketing Expense Spike',
    body: 'Marketing expenses increased 24.3% compared with last month, exceeding budget by Rp 85M. This is the largest single-category variance this period.',
    metric: '+Rp 85M vs budget',
    metricVariant: 'negative' as const,
    action: 'Analyze Expenses',
  },
  {
    id: 'ins-002',
    severity: 'negative' as const,
    icon: AlertTriangle,
    title: 'Receivable Collection Risk',
    body: 'Rp 320M of receivables are more than 60 days overdue across 3 customers. PT Garuda Solusi (Rp 185M) has not responded to 2 reminders.',
    metric: 'Rp 320M at risk',
    metricVariant: 'negative' as const,
    action: 'Review AR',
  },
  {
    id: 'ins-003',
    severity: 'positive' as const,
    icon: CheckCircle,
    title: 'Cash Position Healthy',
    body: 'Current cash reserves of Rp 2.96B cover approximately 4.8 months of projected operating expenses. Cash generation is trending positively.',
    metric: '4.8 months runway',
    metricVariant: 'positive' as const,
    action: 'View Cash Flow',
  },
  {
    id: 'ins-004',
    severity: 'positive' as const,
    icon: TrendingUp,
    title: 'Revenue Growth Accelerating',
    body: 'Revenue increased 12.8% YoY, with Q3 2026 tracking above Q3 2025 by 15.4%. Enterprise segment contributing 68% of new revenue.',
    metric: '+12.8% YoY',
    metricVariant: 'positive' as const,
    action: 'Revenue Analysis',
  },
];

const bgMap = {
  warning: 'bg-warning-subtle border-warning/30',
  negative: 'bg-negative-subtle border-negative/20',
  positive: 'bg-positive-subtle border-positive/20',
  info: 'bg-info-subtle border-info/20',
};

const iconBgMap = {
  warning: 'bg-warning/10 text-warning',
  negative: 'bg-negative/10 text-negative',
  positive: 'bg-positive/10 text-positive',
  info: 'bg-info/10 text-info',
};

export default function AIInsightsPanel() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const { fx } = useCurrency();
  const { t } = useLanguage();

  return (
    <div className="card-elevated-md rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-ai-subtle flex items-center justify-center">
            <Sparkles size={16} className="text-ai" />
          </div>
          <div>
            <h2 className="text-base font-bold text-foreground">{t('AI Financial Insights')}</h2>
            <p className="text-xs text-muted-foreground">{t('Generated')} 25 Aug 2026, 05:48 WIB</p>
          </div>
        </div>
        <span className="badge-ai">{insights.length} {t(insights.length > 1 ? 'insights' : 'insight')}</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {insights.map((ins) => {
          const Icon = ins.icon;
          const isExpanded = expanded === ins.id;
          const title = t(ins.title);
          const action = t(ins.action);
          return (
            <div
              key={ins.id}
              className={`rounded-xl border p-4 transition-all duration-200 cursor-pointer hover:shadow-card-md ${bgMap[ins.severity]}`}
              onClick={() => setExpanded(isExpanded ? null : ins.id)}
            >
              <div className="flex items-start gap-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBgMap[ins.severity]}`}>
                  <Icon size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground leading-tight">{title}</p>
                  <p className={`text-xs font-semibold mt-1 font-mono ${
                    ins.metricVariant === 'positive' ? 'text-positive' : 'text-negative'
                  }`}>
                    {fx(t(ins.metric))}
                  </p>
                </div>
                <ChevronRight
                  size={14}
                  className={`text-muted-foreground flex-shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
                />
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border/50 fade-in">
                  <p className="text-xs text-muted-foreground leading-relaxed">{fx(t(ins.body))}</p>
                  <button
                    onClick={(e) => { e.stopPropagation(); toast.info(action, { description: title }); }}
                    className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                  >
                    {action}
                    <ArrowRight size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
