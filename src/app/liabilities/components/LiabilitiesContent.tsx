'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import { useCurrency } from '@/lib/currency';

const LiabilitiesKPIGrid = dynamic(() => import('./LiabilitiesKPIGrid'), { ssr: false });
const LiabilitiesChartsSection = dynamic(() => import('./LiabilitiesChartsSection'), { ssr: false });
const DebtAnalysisSection = dynamic(() => import('./DebtAnalysisSection'), { ssr: false });
const LiabilityDueSchedule = dynamic(() => import('./LiabilityDueSchedule'), { ssr: false });
const LiabilityTransactions = dynamic(() => import('./LiabilityTransactions'), { ssr: false });
const LiabilitiesAllInsights = dynamic(() => import('./LiabilitiesAllInsights'), { ssr: false });

export default function LiabilitiesContent() {
  const { fx } = useCurrency();
  return (
    <div>
      <PageHeader
        title="Liabilities"
        subtitle="Monitor company obligations, debt, payables, and upcoming financial commitments"
        period="Jan 2026 – Aug 2026"
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
          { key: 'type', label: 'Liability Type', options: ['All Types','Current Liabilities','Non-Current Liabilities','Debt','Trade Payables','Tax Obligations'] },
          { key: 'status', label: 'Status', options: ['All Status','Scheduled','Due Soon','Overdue','Paid'] },
          { key: 'due', label: 'Due Date', options: ['All Dates','Due within 30 days','Due 31–90 days','Due 3–6 months','Due 6–12 months'] },
        ]}
      />

      <div className="mb-5">
        <BalanceValidationCard
          assets={fx('Rp 6,84B')}
          liabilities={fx('Rp 2,14B')}
          equity={fx('Rp 4,70B')}
          difference={fx('Rp 0')}
          balanced={true}
        />
      </div>

      <LiabilitiesKPIGrid />
      <LiabilitiesChartsSection />
      <DebtAnalysisSection />
      <LiabilityDueSchedule />
      <LiabilityTransactions />
      <LiabilitiesAllInsights />
    </div>
  );
}
