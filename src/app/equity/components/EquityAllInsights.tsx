'use client';
import React, { useMemo } from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import type { EquityInsight } from '../lib/equityBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_INSIGHTS: EquityInsight[] = [
  {
    title: 'Strong Equity Growth',
    description: 'Total equity grew 9.6% YTD, driven by current-year net profit of Rp 1.84M. This reflects healthy retained earnings accumulation and no dilutive capital events.',
    metric: '+Rp 410M \u00b7 9.6% YTD growth',
    severity: 'positive',
  },
  {
    title: 'Retained Earnings Expansion',
    description: 'Retained earnings increased Rp 1.16M net of dividends paid, representing 24.7% growth. Profit retention rate is 52.2% after the Rp 880M dividend payment.',
    metric: 'Rp 2,040M \u00b7 +53.6% vs Jan 2026',
    severity: 'positive',
  },
  {
    title: 'Dividend Payout Impact',
    description: 'The Rp 880M final dividend paid in March 2026 represents 47.8% of FY2025 net profit. This is within normal range but reduces equity growth capacity.',
    metric: 'Rp 880M \u00b7 47.8% payout ratio',
    severity: 'info',
  },
  {
    title: 'Stable Capital Base',
    description: 'Paid-in capital of Rp 3.00M has remained unchanged in 2026. No share issuances or buybacks have occurred, maintaining a stable ownership structure.',
    metric: 'Rp 3.00M \u00b7 No capital movement',
    severity: 'info',
  },
  {
    title: 'OCI Negative Adjustment',
    description: 'Other Comprehensive Income decreased Rp 12M in August 2026 due to unrealized losses on investment portfolio revaluation. Monitor closely in Q4 2026.',
    metric: '(Rp 12M) \u00b7 Investment portfolio',
    severity: 'warning',
  },
  {
    title: 'Revaluation Reserve Gain',
    description: 'Property revaluation of the Jakarta office building added Rp 50M to equity in August 2026, reflecting current market appreciation of the asset.',
    metric: '+Rp 50M \u00b7 Gedung Kantor Jakarta',
    severity: 'positive',
  },
];

interface EquityAllInsightsProps {
  isSampleData: boolean;
  insights: EquityInsight[];
}

export default function EquityAIInsights({ isSampleData, insights }: EquityAllInsightsProps) {
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
        <span className="text-[14px] font-600 text-foreground">AI Equity Insights</span>
        <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
        <span className="text-[11px] text-muted-foreground ml-auto">{generatedLabel}</span>
      </div>
      {source.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-6 text-center">
          No notable equity movements detected in this client&apos;s posted journals yet.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {source.map((insight, i) => (
            <FinancialInsightCard
              key={`eq-insight-${i}`}
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
