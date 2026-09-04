'use client';
import React, { useMemo } from 'react';
import FinancialInsightCard from '@/components/ui/FinancialInsightCard';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';
import { formatIDR } from '@/lib/financialData';
import { useAssetsData } from '../lib/useAssetsData';
import { useAssetRegisterData } from '../lib/assetRegisterBridge';

// Data contoh -- HANYA dipakai kalau client aktif belum punya data neraca
// DAN register aset tetap sama sekali (kedua sumber kosong).
const SAMPLE_INSIGHTS = [
  { title: 'Fixed Asset Growth', description: 'Fixed assets increased 18.4% compared with the previous period, driven primarily by the ERP software license acquisition in January 2026.', metric: '+Rp 290M · Jan–Aug 2026', severity: 'positive' as const },
  { title: 'Depreciation Risk', description: '7 assets are approaching the end of their useful life within the next 24 months. Budget for replacements should be planned in Q4 2026.', metric: '7 assets · Rp 142M replacement est.', severity: 'warning' as const },
  { title: 'Asset Concentration Risk', description: '62% of total fixed assets are concentrated in technology equipment and software. Consider diversifying or insuring these assets.', metric: '62% · Rp 1.15M in tech assets', severity: 'warning' as const },
];

export default function AssetsAIInsights() {
  const { fx } = useCurrency();
  const assetsData = useAssetsData();
  const registerData = useAssetRegisterData();

  // Insight dihitung dari angka REAL (aturan sederhana berbasis threshold,
  // bukan judgment AI generatif -- pola sama seperti TaxAIInsights.tsx),
  // supaya tidak pernah menampilkan angka karangan.
  const insights = useMemo(() => {
    if (assetsData.isSampleData && registerData.isSampleData) return null;
    const list: { title: string; description: string; metric: string; severity: 'positive' | 'warning' | 'critical' | 'info' }[] = [];

    const fixedNet = assetsData.kpiCards.find((c) => c.label === 'FIXED ASSETS (NET)');
    if (fixedNet) {
      list.push({
        title: 'Fixed Asset Growth',
        description: `Net fixed assets ${fixedNet.change >= 0 ? 'increased' : 'decreased'} ${Math.abs(fixedNet.change)}% vs the previous period.`,
        metric: `${fixedNet.value} · ${assetsData.periodLabel}`,
        severity: fixedNet.change >= 0 ? 'positive' : 'warning',
      });
    }

    if (!registerData.isSampleData) {
      if (registerData.assetsNearFullDepreciationCount > 0) {
        const nearIds = new Set(registerData.nearlyDepreciated.map((a) => a.id));
        const replacementEst = registerData.assets.filter((a) => nearIds.has(a.id)).reduce((s, a) => s + a.cost, 0);
        list.push({
          title: 'Depreciation Risk',
          description: `${registerData.assetsNearFullDepreciationCount} asset${registerData.assetsNearFullDepreciationCount > 1 ? 's are' : ' is'} approaching the end of their useful life within the next 24 months. Plan replacement budget ahead.`,
          metric: `${registerData.assetsNearFullDepreciationCount} assets · ${fx(formatIDR(replacementEst / 1_000_000, true))} original cost`,
          severity: 'warning',
        });
      }

      if (registerData.categoryBreakdown.length > 0 && registerData.totalCost > 0) {
        const top = registerData.categoryBreakdown[0];
        const pct = Math.round((top.cost / registerData.totalCost) * 1000) / 10;
        if (pct >= 40) {
          list.push({
            title: 'Asset Concentration Risk',
            description: `${pct}% of total fixed assets are concentrated in "${top.name}". Consider diversifying or reviewing insurance coverage for this category.`,
            metric: `${pct}% · ${fx(formatIDR(top.cost / 1_000_000, true))} in ${top.name}`,
            severity: 'warning',
          });
        }
      }

      const fullyDepreciatedInUse = registerData.assets.filter((a) => a.status === 'fully-depreciated').length;
      if (fullyDepreciatedInUse > 0) {
        list.push({
          title: 'Fully Depreciated Assets Still Recorded',
          description: `${fullyDepreciatedInUse} asset${fullyDepreciatedInUse > 1 ? 's have' : ' has'} reached their net book value floor (residual value) but remain on the register — verify whether still in active use or ready to write off.`,
          metric: `${fullyDepreciatedInUse} assets`,
          severity: 'info',
        });
      }

      const needsReview = registerData.assets.filter((a) => a.needsReview).length;
      if (needsReview > 0) {
        list.push({
          title: 'Asset Data Needs Review',
          description: `${needsReview} asset${needsReview > 1 ? 's have' : ' has'} data flagged for review during processing (e.g. missing useful life, unusual depreciation figures, or duplicate codes).`,
          metric: `${needsReview} assets`,
          severity: 'critical',
        });
      }
    }

    return list;
  }, [assetsData, registerData, fx]);

  const displayInsights = insights && insights.length > 0 ? insights : SAMPLE_INSIGHTS;
  const isSample = !insights || insights.length === 0;

  return (
    <div className="fin-card p-5 mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Icon name="SparklesIcon" size={16} className="text-ai" />
        <span className="text-[14px] font-600 text-foreground">Asset Insights</span>
        {!isSample && <span className="fin-badge bg-ai-subtle text-ai border border-purple-200 text-[10px]">Computed</span>}
        <span className="text-[11px] text-muted-foreground ml-auto">
          {isSample ? 'Sample data' : `Based on ${assetsData.periodLabel || registerData.periodLabel}`}
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {displayInsights.map((ins) => (
          <FinancialInsightCard
            key={ins.title}
            title={ins.title}
            description={isSample ? fx(ins.description) : ins.description}
            metric={isSample ? fx(ins.metric) : ins.metric}
            severity={ins.severity}
          />
        ))}
      </div>
    </div>
  );
}
