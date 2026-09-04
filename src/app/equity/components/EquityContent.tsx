'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useEquityData } from '../lib/useEquityData';

// [DIPERBAIKI] File ini sebelumnya isinya duplikat dari EquityAllInsights.tsx
// (halaman Equity cuma menampilkan kartu "AI Equity Insights" saja, tanpa
// KPI/Chart/Transaksi). Sekarang dijadikan orchestrator yang benar, mengikuti
// pola persis AssetsContent.tsx / LiabilitiesContent.tsx, sekaligus
// disambungkan ke data ASLI client aktif lewat lib/useEquityData.ts.
const EquityKPIGrid = dynamic(() => import('./EquityKPIGrid'), { ssr: false });
const EquityMovementChart = dynamic(() => import('./EquityMovementChart'), { ssr: false });
const EquityTrendChart = dynamic(() => import('./EquityTrendChart'), { ssr: false });
const EquityClassification = dynamic(() => import('./EquityClassification'), { ssr: false });
const EquityTransactions = dynamic(() => import('./EquityTransactions'), { ssr: false });
const RetainedEarningsAnalysis = dynamic(() => import('./RetainedEarningsAnalysis'), { ssr: false });
const EquityAllInsights = dynamic(() => import('./EquityAllInsights'), { ssr: false });

export default function EquityContent() {
  const { fx } = useCurrency();
  const equityData = useEquityData();

  return (
    <div>
      <PageHeader
        title="Equity"
        subtitle="Monitor shareholder equity, capital structure, and retained earnings movement"
        period={equityData.periodLabel || 'Jan 2026 – Aug 2026'}
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
        ]}
      />

      <div className="mb-5">
        <BalanceValidationCard
          assets={fx('Rp 6,84M')}
          liabilities={fx('Rp 2,14M')}
          equity={fx(equityData.isSampleData ? 'Rp 4,70M' : formatMoney(equityData.totalEquity, 'IDR'))}
          difference={fx('Rp 0')}
          balanced={true}
        />
      </div>

      <EquityKPIGrid cards={equityData.kpiCards} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 mb-6">
        <EquityMovementChart steps={equityData.waterfall} periodLabel={equityData.periodLabel} />
        <EquityTrendChart trendData={equityData.trendData} companyName={equityData.companyName} />
      </div>

      <EquityClassification />
      <EquityTransactions />
      <RetainedEarningsAnalysis />
      <EquityAllInsights />
    </div>
  );
}
