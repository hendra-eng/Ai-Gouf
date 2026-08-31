'use client';
import React from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

export default function LiabilitiesAIInsights() {
  const { fx } = useCurrency();
  return (
    <div className="fin-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="SparklesIcon" size={16} className="text-ai" />
        <span className="text-[14px] font-600 text-foreground">AI Liability Insights</span>
        <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">AI</span>
        <span className="text-[11px] text-muted-foreground ml-auto">Generated 26 Aug 2026, 00:39 WIB</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        <FinancialInsightCard
          title="Tax Obligation Urgent"
          description={fx("PPh 21 of Rp 182M is due in 13 days on 8 Sep 2026. Ensure cash is allocated and payment is initiated at least 3 business days before the deadline.")}
          metric={fx("Rp 182M · Due 8 Sep 2026 · 13 days")}
          severity="critical"
        />
        <FinancialInsightCard
          title="Payables Concentration"
          description={fx("Top 5 vendors represent 78.4% of total outstanding accounts payable. PT Sinar Abadi Makmur alone accounts for 16.5% of total AP balance.")}
          metric={fx("Rp 672M · 78.4% of total AP")}
          severity="warning"
        />
        <FinancialInsightCard
          title="Healthy Debt Leverage"
          description="Debt-to-equity ratio of 0.18x is well below the 1.0x threshold, indicating conservative financial leverage and strong equity base."
          metric="D/E: 0.18x · Interest Coverage: 12.7x"
          severity="positive"
        />
        <FinancialInsightCard
          title="Long-Term Debt Increase"
          description={fx("Long-term debt increased 3.3% compared with the previous period due to the BNI bond facility drawn in Q1 2026.")}
          metric={fx("+Rp 20M · Q1 2026 bond facility")}
          severity="info"
        />
        <FinancialInsightCard
          title="Overdue Payable Detected"
          description={fx("PT Bintang Mas Sejahtera invoice of Rp 58M is 2 days overdue. Contact vendor to negotiate extension or initiate payment immediately.")}
          metric={fx("Rp 58M · OBL-2026-008 · 2 days overdue")}
          severity="critical"
        />
        <FinancialInsightCard
          title="Accrued Expense Trend"
          description={fx("Accrued expenses increased 5.5% this period, primarily driven by higher payroll accruals reflecting headcount growth in engineering.")}
          metric={fx("Rp 118M · +5.5% vs prev period")}
          severity="info"
        />
      </div>
    </div>
  );
}
