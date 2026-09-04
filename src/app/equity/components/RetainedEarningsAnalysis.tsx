'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { RetainedEarningsStep } from '../lib/equityBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_STEPS: RetainedEarningsStep[] = [
  { label: 'Beginning Retained Earnings', amount: 1_080_000_000, description: '1 Jan 2026 opening balance', type: 'base' },
  { label: 'Net Profit (YTD)', amount: 1_840_000_000, description: 'Per P&L Jan\u2013Aug 2026', type: 'positive' },
  { label: 'Dividends Paid', amount: -880_000_000, description: 'Final dividend FY2025 paid Mar 2026', type: 'negative' },
  { label: 'Prior Year Adjustments', amount: 0, description: 'No retrospective adjustments', type: 'neutral' },
  { label: 'Ending Retained Earnings', amount: 2_040_000_000, description: '26 Aug 2026 balance', type: 'result' },
];
const SAMPLE_PERIOD_LABEL = 'Jan\u2013Aug 2026';

interface RetainedEarningsAnalysisProps {
  isSampleData: boolean;
  steps: RetainedEarningsStep[];
  periodLabel: string;
}

export default function RetainedEarningsAnalysis({ isSampleData, steps, periodLabel }: RetainedEarningsAnalysisProps) {
  const { fx } = useCurrency();
  const source = isSampleData ? SAMPLE_STEPS : steps;
  const period = isSampleData ? SAMPLE_PERIOD_LABEL : periodLabel;
  const ending = source.find(s => s.type === 'result');

  return (
    <div className="fin-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <div>
          <div className="text-[14px] font-600 text-foreground">Retained Earnings Analysis</div>
          <div className="text-[11px] text-muted-foreground">Movement from beginning to ending balance \u2014 {period}</div>
        </div>
      </div>

      {!isSampleData && source.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-6 text-center">
          No retained earnings movement found for this client yet.
        </div>
      ) : (
        <>
          <div className="space-y-0">
            {source.map((step, i) => (
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
                      step.type === 'result' ? 'text-primary' : 'text-foreground'
                    }`}>
                      {fx(formatMoney(step.amount, 'IDR'))}
                    </div>
                  </div>
                </div>
                {i < source.length - 2 && (
                  <div className="flex justify-start ml-7 my-0.5">
                    <div className="w-0.5 h-3 bg-border" />
                  </div>
                )}
                {i === source.length - 2 && (
                  <div className="border-t border-dashed border-border my-2" />
                )}
              </div>
            ))}
          </div>

          {/* Summary note */}
          {ending && (
            <div className="mt-4 bg-muted/50 rounded-lg px-4 py-3 text-[11px] text-muted-foreground">
              Retained earnings of <span className="font-600 text-foreground">{fx(formatMoney(ending.amount, 'IDR'))}</span> represents accumulated undistributed profits. This connects directly to the Balance Sheet equity section and is reconciled with the Profit &amp; Loss statement.
            </div>
          )}
        </>
      )}
    </div>
  );
}
