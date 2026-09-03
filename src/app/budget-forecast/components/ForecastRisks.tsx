'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const RISKS = [
  {
    id: 'risk-rev',
    title: 'Revenue Risk',
    description: 'Actual revenue is below planned trajectory for Aug 2026. YTD achievement at 94.8% of budget.',
    impact: -380_000_000,
    severity: 'Medium',
    category: 'Revenue',
    icon: 'ArrowTrendingDownIcon',
    detail: 'Revenue in Aug fell short of budget by Rp 150M. Q4 pipeline needs to close to meet annual target.',
  },
  {
    id: 'risk-marketing',
    title: 'Marketing Expense Risk',
    description: 'Marketing expenses are trending 12.4% above budget. Campaign ROI requires review.',
    impact: -22_000_000,
    severity: 'Low',
    category: 'Expenses',
    icon: 'MegaphoneIcon',
    detail: 'Marketing overspend of Rp 22M YTD. If trend continues, full-year overspend could reach Rp 33M.',
  },
  {
    id: 'risk-cash',
    title: 'Cash Flow Risk',
    description: 'Projected Q4 cash position may approach minimum threshold if large AP payments cluster.',
    impact: -180_000_000,
    severity: 'Low',
    category: 'Cash Flow',
    icon: 'BanknotesIcon',
    detail: 'Three major vendor payments due in Oct totaling Rp 180M. Cash buffer remains adequate but warrants monitoring.',
  },
  {
    id: 'risk-collection',
    title: 'AR Collection Risk',
    description: 'Three enterprise customers have overdue AR balances totaling Rp 340M beyond 60 days.',
    impact: -340_000_000,
    severity: 'High',
    category: 'Receivables',
    icon: 'InboxArrowDownIcon',
    detail: 'Top 3 overdue accounts: PT Mitra Solusi (Rp 180M), CV Teknindo (Rp 96M), PT Artha Digital (Rp 64M).',
  },
];

const SEVERITY_STYLES: Record<string, string> = {
  High: 'bg-negative-subtle text-negative border-negative/20',
  Medium: 'bg-warning-subtle text-warning border-warning/20',
  Low: 'bg-info-subtle text-info border-info/20',
};

export default function ForecastRisks() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();
  const { fx } = useCurrency();

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Forecast Risks</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Key risks to the FY2026 financial forecast</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-negative font-semibold bg-negative-subtle px-2 py-1 rounded-full border border-negative/20">1 High</span>
          <span className="text-xs text-warning font-semibold bg-warning-subtle px-2 py-1 rounded-full border border-warning/20">1 Medium</span>
          <span className="text-xs text-info font-semibold bg-info-subtle px-2 py-1 rounded-full border border-info/20">2 Low</span>
        </div>
      </div>

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
    </div>
  );
}
