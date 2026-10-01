'use client';
import React, { useMemo } from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import type { EquityInsight } from '../lib/equityBridge';

// [UBAH] Data contoh dikosongkan — tampil hanya kalau belum ada client aktif
// / belum ada jurnal (isSampleData); sekarang tetap 0 insight.
const SAMPLE_INSIGHTS: EquityInsight[] = [];

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