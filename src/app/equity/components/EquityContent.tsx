'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import { useCurrency } from '@/lib/currency';

const EquityKPIGrid = dynamic(() => import('./EquityKPIGrid'), { ssr: false });
const EquityMovementChart = dynamic(() => import('./EquityMovementChart'), { ssr: false });
const EquityTrendChart = dynamic(() => import('./EquityTrendChart'), { ssr: false });
const RetainedEarningsAnalysis = dynamic(() => import('./RetainedEarningsAnalysis'), { ssr: false });
const EquityClassification = dynamic(() => import('./EquityClassification'), { ssr: false });
const EquityTransactions = dynamic(() => import('./EquityTransactions'), { ssr: false });
const EquityAIInsights = dynamic(() => import('./EquityAllInsights'), { ssr: false });

export default function EquityContent() {
  const { fx } = useCurrency();
  return (
    <div>
      <PageHeader
        title="Equity"
        subtitle="Monitor shareholder equity, retained earnings, capital movements, and accumulated profits"
        period="Jan 2026 – Aug 2026"
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
          { key: 'type', label: 'Equity Type', options: ['All Types','Share Capital','Retained Earnings','Other Comprehensive Income','Revaluation Reserve'] },
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

      <EquityKPIGrid />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <EquityMovementChart />
        <EquityTrendChart />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <RetainedEarningsAnalysis />
        <EquityClassification />
      </div>

      <EquityTransactions />
      <EquityAIInsights />
    </div>
  );
}
