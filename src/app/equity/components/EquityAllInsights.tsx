'use client';
import React from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

export default function EquityAIInsights() {
  const { fx } = useCurrency();
  return (
    <div className="fin-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="SparklesIcon" size={16} className="text-ai" />
        <span className="text-[14px] font-600 text-foreground">AI Equity Insights</span>
        <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
        <span className="text-[11px] text-muted-foreground ml-auto">Generated 26 Aug 2026, 00:39 WIB</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <FinancialInsightCard
          title="Strong Equity Growth"
          description={fx("Total equity grew 9.6% YTD, driven by current-year net profit of Rp 1.84B. This reflects healthy retained earnings accumulation and no dilutive capital events.")}
          metric={fx("+Rp 410M · 9.6% YTD growth")}
          severity="positive"
        />
        <FinancialInsightCard
          title="Retained Earnings Expansion"
          description={fx("Retained earnings increased Rp 1.16B net of dividends paid, representing 24.7% growth. Profit retention rate is 52.2% after the Rp 880M dividend payment.")}
          metric={fx("Rp 2,040M · +53.6% vs Jan 2026")}
          severity="positive"
        />
        <FinancialInsightCard
          title="Dividend Payout Impact"
          description={fx("The Rp 880M final dividend paid in March 2026 represents 47.8% of FY2025 net profit. This is within normal range but reduces equity growth capacity.")}
          metric={fx("Rp 880M · 47.8% payout ratio")}
          severity="info"
        />
        <FinancialInsightCard
          title="Stable Capital Base"
          description={fx("Paid-in capital of Rp 3.00B has remained unchanged in 2026. No share issuances or buybacks have occurred, maintaining a stable ownership structure.")}
          metric={fx("Rp 3.00B · No capital movement")}
          severity="info"
        />
        <FinancialInsightCard
          title="OCI Negative Adjustment"
          description={fx("Other Comprehensive Income decreased Rp 12M in August 2026 due to unrealized losses on investment portfolio revaluation. Monitor closely in Q4 2026.")}
          metric={fx("(Rp 12M) · Investment portfolio")}
          severity="warning"
        />
        <FinancialInsightCard
          title="Revaluation Reserve Gain"
          description={fx("Property revaluation of the Jakarta office building added Rp 50M to equity in August 2026, reflecting current market appreciation of the asset.")}
          metric={fx("+Rp 50M · Gedung Kantor Jakarta")}
          severity="positive"
        />
      </div>
    </div>
  );
}
