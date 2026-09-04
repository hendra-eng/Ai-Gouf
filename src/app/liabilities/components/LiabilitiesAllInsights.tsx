'use client';
import React, { useMemo } from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import type { LiabilityInsight } from '../lib/liabilitiesBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_INSIGHTS: LiabilityInsight[] = [
  {
    title: 'Tax Obligation Urgent',
    description: 'PPh 21 of Rp 182M is due in 13 days on 8 Sep 2026. Ensure cash is allocated and payment is initiated at least 3 business days before the deadline.',
    metric: 'Rp 182M \u00b7 Due 8 Sep 2026 \u00b7 13 days',
    severity: 'critical',
  },
  {
    title: 'Payables Concentration',
    description: 'Top 5 vendors represent 78.4% of total outstanding accounts payable. PT Sinar Abadi Makmur alone accounts for 16.5% of total AP balance.',
    metric: 'Rp 672M \u00b7 78.4% of total AP',
    severity: 'warning',
  },
  {
    title: 'Healthy Debt Leverage',
    description: 'Debt-to-equity ratio of 0.18x is well below the 1.0x threshold, indicating conservative financial leverage and strong equity base.',
    metric: 'D/E: 0.18x \u00b7 Interest Coverage: 12.7x',
    severity: 'positive',
  },
  {
    title: 'Long-Term Debt Increase',
    description: 'Long-term debt increased 3.3% compared with the previous period due to the BNI bond facility drawn in Q1 2026.',
    metric: '+Rp 20M \u00b7 Q1 2026 bond facility',
    severity: 'info',
  },
  {
    title: 'Overdue Payable Detected',
    description: 'PT Bintang Mas Sejahtera invoice of Rp 58M is 2 days overdue. Contact vendor to negotiate extension or initiate payment immediately.',
    metric: 'Rp 58M \u00b7 OBL-2026-008 \u00b7 2 days overdue',
    severity: 'critical',
  },
  {
    title: 'Accrued Expense Trend',
    description: 'Accrued expenses increased 5.5% this period, primarily driven by higher payroll accruals reflecting headcount growth in engineering.',
    metric: 'Rp 118M \u00b7 +5.5% vs prev period',
    severity: 'info',
  },
];

interface LiabilitiesAllInsightsProps {
  isSampleData: boolean;
  insights: LiabilityInsight[];
}

export default function LiabilitiesAIInsights({ isSampleData, insights }: LiabilitiesAllInsightsProps) {
  const { fx } = useCurrency();
  const source = isSampleData ? SAMPLE_INSIGHTS : insights;

  const generatedLabel = useMemo(() => {
    if (isSampleData) return 'Sample \u2014 select a client to generate real insights';
    return `Generated ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }, [isSampleData]);

  return (
    <div className="fin-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="SparklesIcon" size={16} className="text-ai" />
        <span className="text-[14px] font-600 text-foreground">AI Liability Insights</span>
        <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
        <span className="text-[11px] text-muted-foreground ml-auto">{generatedLabel}</span>
      </div>
      {source.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-6 text-center">
          No notable liability risks detected in this client&apos;s posted journals yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {source.map((insight, i) => (
            <FinancialInsightCard
              key={`liab-insight-${i}`}
              title={insight.title}
              description={fx(insight.description)}
              metric={fx(insight.metric)}
              severity={insight.severity}
            />
          ))}
        </div>
      )}
    </div>
  );
}
