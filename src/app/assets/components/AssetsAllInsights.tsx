'use client';
import React from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

export default function AssetsAIInsights() {
  const { fx } = useCurrency();
  return (
    <div className="fin-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="SparklesIcon" size={16} className="text-ai" />
        <span className="text-[14px] font-600 text-foreground">AI Asset Insights</span>
        <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
        <span className="text-[11px] text-muted-foreground ml-auto">Generated 26 Aug 2026, 00:39 WIB</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <FinancialInsightCard
          title="Fixed Asset Growth"
          description={fx("Fixed assets increased 18.4% compared with the previous period, driven primarily by the ERP software license acquisition in January 2026.")}
          metric={fx("+Rp 290M · Jan–Aug 2026")}
          severity="positive"
        />
        <FinancialInsightCard
          title="Depreciation Risk"
          description={fx("7 assets are approaching the end of their useful life within the next 24 months. Budget for replacements should be planned in Q4 2026.")}
          metric={fx("7 assets · Rp 142M replacement est.")}
          severity="warning"
        />
        <FinancialInsightCard
          title="Asset Concentration Risk"
          description={fx("62% of total fixed assets are concentrated in technology equipment and software. Consider diversifying or insuring these assets.")}
          metric={fx("62% · Rp 1.15M in tech assets")}
          severity="warning"
        />
        <FinancialInsightCard
          title="Cash Liquidity Strong"
          description={fx("Cash & Bank represents 43.3% of total assets, providing strong liquidity with 4.8 months of operational runway.")}
          metric={fx("Rp 2.96M · 4.8 mo runway")}
          severity="positive"
        />
        <FinancialInsightCard
          title="AR Overdue Concentration"
          description={fx("Rp 320M of accounts receivable is overdue, representing 25.8% of total AR. Top 3 customers account for 68% of overdue amount.")}
          metric={fx("Rp 320M · 25.8% of total AR")}
          severity="critical"
        />
        <FinancialInsightCard
          title="Maintenance Asset Alert"
          description="Mesin Produksi CNC-X200 has been under maintenance since 20 Aug 2026. Downtime may affect production capacity in Surabaya."
          metric="FA-2024-005 · Surabaya Plant"
          severity="warning"
        />
      </div>
    </div>
  );
}
