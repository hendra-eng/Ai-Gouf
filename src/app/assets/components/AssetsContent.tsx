'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import PageHeader from '@/components/ui/PageHeader';
import BalanceValidationCard from '@/components/ui/BalanceValidationCard';
import { useCurrency } from '@/lib/currency';

const AssetsKPIGrid = dynamic(() => import('./AssetsKPIGrid'), { ssr: false });
const AssetsChartsSection = dynamic(() => import('./AssetsChartsSection'), { ssr: false });
const FixedAssetRegister = dynamic(() => import('./FixedAssetRegister'), { ssr: false });
const DepreciationSection = dynamic(() => import('./DepreciationSection'), { ssr: false });
const AssetTransactions = dynamic(() => import('./AssetTransactions'), { ssr: false });
const AssetsAIInsights = dynamic(() => import('./AssetsAllInsights'), { ssr: false });

export default function AssetsContent() {
  const { fx } = useCurrency();
  return (
    <div>
      <PageHeader
        title="Assets"
        subtitle="Monitor company assets, asset values, depreciation, and financial utilization"
        period="Jan 2026 – Aug 2026"
        periodOptions={['Jan 2026 – Aug 2026','Jan 2025 – Dec 2025','Jan 2025 – Aug 2025','Q2 2026','Q1 2026']}
        filters={[
          { key: 'branch', label: 'Branch', options: ['All Branches','Jakarta HQ','Surabaya','Bandung','Medan'] },
          { key: 'currency', label: 'Currency', options: ['IDR','USD','EUR'] },
          { key: 'category', label: 'Category', options: ['All Categories','Current Assets','Non-Current Assets','Fixed Assets','Intangible Assets'] },
          { key: 'status', label: 'Status', options: ['All Status','Active','Under Maintenance','Fully Depreciated','Disposed','Inactive'] },
        ]}
      />

      {/* Balance Sheet Validation */}
      <div className="mb-5">
        <BalanceValidationCard
          assets={fx('Rp 6,84B')}
          liabilities={fx('Rp 2,14B')}
          equity={fx('Rp 4,70B')}
          difference={fx('Rp 0')}
          balanced={true}
        />
      </div>

      <AssetsKPIGrid />
      <AssetsChartsSection />
      <FixedAssetRegister />
      <DepreciationSection />
      <AssetTransactions />
      <AssetsAIInsights />
    </div>
  );
}
