'use client';
import React, { useState } from 'react';
import InteractiveAgingDonut, { AgingLivePreview } from '@/app/components/InteractiveAgingDonut';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

interface BSDonutChartProps {
  totalAssets: number;
  currentAssets: number;
  nonCurrentAssets: number;
  totalLiabilities: number;
  totalEquity: number;
}

export default function BSDonutChart({ totalAssets, currentAssets, nonCurrentAssets, totalLiabilities, totalEquity }: BSDonutChartProps) {
  const { currency } = useCurrency();
  const { t } = useLanguage();

  const [assetActive, setAssetActive] = useState<number | null>(null);
  const [assetLivePreview, setAssetLivePreview] = useState<AgingLivePreview[] | null>(null);
  const [fundingActive, setFundingActive] = useState<number | null>(null);
  const [fundingLivePreview, setFundingLivePreview] = useState<AgingLivePreview[] | null>(null);

  const assetData = [
    { name: 'Current Assets', value: currentAssets, color: 'var(--primary)' },
    { name: 'Non-Current Assets', value: nonCurrentAssets, color: '#3B82F6' },
  ];

  const fundingData = [
    { name: 'Liabilities', value: totalLiabilities, color: 'var(--negative)' },
    { name: 'Equity', value: totalEquity, color: 'var(--positive)' },
  ];

  const renderLegend = (
    data: { name: string; value: number; color: string }[],
    activeIndex: number | null,
    setActiveIndex: (updater: (prev: number | null) => number | null) => void,
    livePreview: AgingLivePreview[] | null,
    total: number
  ) =>
    data.map((item, index) => {
      const preview = livePreview?.[index];
      const displayValue = preview ? preview.value : item.value;
      const displayPct = preview ? preview.pct : (item.value / total) * 100;
      return (
        <div
          key={`bs-legend-${item.name}`}
          onClick={() => setActiveIndex((prev) => (prev === index ? null : index))}
          className={`flex items-center justify-between text-xs cursor-pointer rounded-md px-1 py-0.5 transition-colors ${
            activeIndex === index ? 'bg-secondary' : 'hover:bg-secondary/50'
          }`}
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: item.color }} />
            <span className={activeIndex === index ? 'text-foreground font-600' : 'text-muted-foreground'}>{t(item.name)}</span>
          </div>
          <span className="font-600 text-foreground tabular-nums">{formatMoney(displayValue * 1e6, currency)}</span>
          <span className="text-muted-foreground w-10 text-right">{displayPct.toFixed(0)}%</span>
        </div>
      );
    });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <p className="text-xs font-semibold text-center text-muted-foreground mb-2">{t('Asset Mix')}</p>
        <InteractiveAgingDonut
          data={assetData}
          activeIndex={assetActive}
          onActiveChange={setAssetActive}
          onLiveChange={setAssetLivePreview}
        />
        <div className="space-y-1.5 mt-2">
          {renderLegend(assetData, assetActive, setAssetActive, assetLivePreview, totalAssets)}
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold text-center text-muted-foreground mb-2">{t('Funding Structure')}</p>
        <InteractiveAgingDonut
          data={fundingData}
          activeIndex={fundingActive}
          onActiveChange={setFundingActive}
          onLiveChange={setFundingLivePreview}
        />
        <div className="space-y-1.5 mt-2">
          {renderLegend(fundingData, fundingActive, setFundingActive, fundingLivePreview, totalAssets)}
        </div>
      </div>
    </div>
  );
}
