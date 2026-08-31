'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/equity/retained-earnings?period=...
const steps = [
  {
    label: 'Beginning Retained Earnings',
    value: 'Rp 1,080M',
    change: null,
    description: '1 Jan 2026 opening balance',
    type: 'base' as const,
  },
  {
    label: 'Net Profit (YTD)',
    value: '+ Rp 1,840M',
    change: '+8.4%',
    description: 'Per P&L Jan–Aug 2026',
    type: 'positive' as const,
  },
  {
    label: 'Dividends Paid',
    value: '− Rp 880M',
    change: null,
    description: 'Final dividend FY2025 paid Mar 2026',
    type: 'negative' as const,
  },
  {
    label: 'Prior Year Adjustments',
    value: '+ Rp 0',
    change: null,
    description: 'No retrospective adjustments',
    type: 'neutral' as const,
  },
  {
    label: 'Ending Retained Earnings',
    value: 'Rp 2,040M',
    change: null,
    description: '26 Aug 2026 balance',
    type: 'result' as const,
  },
];

export default function RetainedEarningsAnalysis() {
  const { fx } = useCurrency();
  return (
    <div className="fin-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div>
          <div className="text-[14px] font-600 text-foreground">Retained Earnings Analysis</div>
          <div className="text-[11px] text-muted-foreground">Movement from beginning to ending balance — Jan–Aug 2026</div>
        </div>
      </div>

      <div className="space-y-0">
        {steps.map((step, i) => (
          <div key={`re-step-${i}`}>
            <div className={`flex items-center justify-between py-3 px-4 rounded-lg ${step.type === 'result' ? 'bg-primary/5 border border-primary/20' : 'hover:bg-muted/40'} transition-colors`}>
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                  step.type === 'base' ? 'bg-blue-50 text-primary' :
                  step.type === 'positive' ? 'bg-green-50 text-positive' :
                  step.type === 'negative' ? 'bg-negative-subtle text-negative' :
                  step.type === 'result' ? 'bg-primary text-primary-foreground' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step.type === 'positive' && <Icon name="PlusIcon" size={12} />}
                  {step.type === 'negative' && <Icon name="MinusIcon" size={12} />}
                  {step.type === 'base' && <Icon name="HomeIcon" size={12} />}
                  {step.type === 'result' && <Icon name="EqualsIcon" size={12} />}
                  {step.type === 'neutral' && <Icon name="MinusIcon" size={12} />}
                </div>
                <div>
                  <div className={`text-[13px] font-600 ${step.type === 'result' ? 'text-primary' : 'text-foreground'}`}>
                    {step.label}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{step.description}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`text-[14px] font-700 financial-value ${
                  step.type === 'positive' ? 'text-positive' :
                  step.type === 'negative' ? 'text-negative' :
                  step.type === 'result'? 'text-primary' : 'text-foreground'
                }`}>
                  {fx(step.value)}
                </div>
                {step.change && (
                  <div className="text-[10px] text-positive mt-0.5">{step.change} vs prior year</div>
                )}
              </div>
            </div>
            {i < steps.length - 2 && (
              <div className="flex justify-start ml-7 my-0.5">
                <div className="w-0.5 h-3 bg-border" />
              </div>
            )}
            {i === steps.length - 2 && (
              <div className="border-t border-dashed border-border my-2" />
            )}
          </div>
        ))}
      </div>

      {/* Summary note */}
      <div className="mt-4 bg-muted/50 rounded-lg px-4 py-3 text-[11px] text-muted-foreground">
        Retained earnings of <span className="font-600 text-foreground">{fx('Rp 2,040M')}</span> represents accumulated undistributed profits. This connects directly to the Balance Sheet equity section and is reconciled with the Profit & Loss statement.
      </div>
    </div>
  );
}
