'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { useBalanceSheetStatement, useProfitLossStatement } from '../lib/useStatementData';

const BSDonutChart = dynamic(() => import('./BSDonutChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-xl" />,
});

interface BSSection {
  title: string;
  items: { label: string; value: number }[];
  subtotalLabel: string;
  subtotal: number;
  accent?: string;
}

function BSSectionTable({ title, items, subtotalLabel, subtotal, accent = 'text-foreground' }: BSSection) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-5 py-3 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground">{t(title)}</span>
      </button>
      {expanded && (
        <>
          {items.map((item, i) => (
            <div key={`bsitem-${title}-${i}`} className={`flex items-center justify-between px-8 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'bg-muted/10' : ''}`}>
              <span className="text-sm text-muted-foreground">{t(item.label)}</span>
              <span className="text-sm font-semibold font-mono text-foreground">{formatRp(item.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3 bg-muted/20 border-b border-border">
            <span className={`text-sm font-bold ${accent}`}>{t(subtotalLabel)}</span>
            <span className={`text-sm font-bold font-mono ${accent}`}>{formatRp(subtotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// Rasio aman dari pembagian nol -- null kalau penyebut 0.
function rasio(a: number, b: number): number | null {
  return b ? a / b : null;
}

export default function BalanceSheetStatement() {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const bs = useBalanceSheetStatement();
  const { PL_CORE } = useProfitLossStatement();
  const keItems = (items: { name: string; current: number }[]) => items.map((i) => ({ label: i.name, value: i.current }));
  const bsData = {
    assets: { current: keItems(bs.currentAssets.items), nonCurrent: keItems(bs.nonCurrentAssets.items) },
    liabilities: { current: keItems(bs.currentLiabilities.items), nonCurrent: keItems(bs.nonCurrentLiabilities.items) },
    equity: keItems(bs.equity.items),
  };
  const currentAssetsTotal = bs.currentAssets.total;
  const nonCurrentAssetsTotal = bs.nonCurrentAssets.total;
  const totalAssets = bs.totalAssets;
  const currentLiabTotal = bs.currentLiabilities.total;
  const nonCurrentLiabTotal = bs.nonCurrentLiabilities.total;
  const totalLiabilities = bs.totalLiabilities;
  const totalEquity = bs.totalEquity;
  const totalLiabEquity = Math.round((totalLiabilities + totalEquity) * 100) / 100;
  const isBalanced = bs.isBalanced;
  const currentRatio = rasio(currentAssetsTotal, currentLiabTotal);
  const debtToEquity = rasio(totalLiabilities, totalEquity);
  const assetTurnover = rasio(PL_CORE.revenue, totalAssets);
  const equityRatio = rasio(totalEquity, totalAssets);
  return (
    <div className="space-y-6">
      {/* Chart + Balance validation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <h3 className="text-base font-bold text-foreground mb-1">{t('Asset Composition')}</h3>
          <p className="text-xs text-muted-foreground mb-4">{t('Assets = Liabilities + Equity')}</p>
          <BSDonutChart
            totalAssets={totalAssets}
            currentAssets={currentAssetsTotal}
            nonCurrentAssets={nonCurrentAssetsTotal}
            totalLiabilities={totalLiabilities}
            totalEquity={totalEquity}
          />
        </div>

        <div className="space-y-4">
          {/* Balance validation */}
          <div className={`card-elevated-md rounded-xl p-5 ${isBalanced ? 'border-positive/30 bg-positive-subtle' : 'border-negative/30 bg-negative-subtle'}`}>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={18} className={isBalanced ? 'text-positive' : 'text-negative'} />
              <span className={`text-sm font-bold ${isBalanced ? 'text-positive' : 'text-negative'}`}>
                {isBalanced ? t('Balance Sheet Balanced') : `${t('Balance Sheet Error')} (${formatRp(bs.difference)})`}
              </span>
            </div>
            <div className="space-y-2">
              {[
                { label: 'Total Assets', value: totalAssets },
                { label: 'Total Liabilities', value: totalLiabilities },
                { label: 'Total Equity', value: totalEquity },
                { label: 'Liab + Equity', value: totalLiabEquity },
              ].map((r) => (
                <div key={`bsval-${r.label}`} className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t(r.label)}</span>
                  <span className="text-xs font-bold font-mono text-foreground">{formatRp(r.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key ratios */}
          <div className="card-elevated-md rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">{t('Key Ratios')}</p>
            {[
              { label: 'Current Ratio', value: currentRatio == null ? '—' : currentRatio.toFixed(2), good: (currentRatio ?? 0) > 1.5 },
              { label: 'Debt-to-Equity', value: debtToEquity == null ? '—' : debtToEquity.toFixed(2), good: debtToEquity != null && debtToEquity >= 0 && debtToEquity < 1.5 },
              { label: 'Asset Turnover', value: assetTurnover == null ? '—' : `${assetTurnover.toFixed(2)}×`, good: (assetTurnover ?? 0) > 0 },
              { label: 'Equity Ratio', value: equityRatio == null ? '—' : `${(equityRatio * 100).toFixed(1)}%`, good: (equityRatio ?? 0) > 0 },
            ].map((r) => (
              <div key={`bsratio-${r.label}`} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{t(r.label)}</span>
                <span className={`text-sm font-bold font-mono ${r.good ? 'text-positive' : 'text-warning'}`}>{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Balance Sheet Table */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Assets */}
        <div className="card-elevated-md rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-bold text-foreground">{t('ASET')}</h3>
            <p className="text-xs text-muted-foreground">{bs.periodLabelId}</p>
          </div>
          <BSSectionTable
            title="Aset Lancar (Current Assets)"
            items={bsData.assets.current}
            subtotalLabel="Total Aset Lancar"
            subtotal={currentAssetsTotal}
            accent="text-primary"
          />
          <BSSectionTable
            title="Aset Tidak Lancar (Non-Current Assets)"
            items={bsData.assets.nonCurrent}
            subtotalLabel="Total Aset Tidak Lancar"
            subtotal={nonCurrentAssetsTotal}
            accent="text-primary"
          />
          <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-t-2 border-primary/20">
            <span className="text-base font-bold text-primary">{t('TOTAL ASET')}</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(totalAssets)}</span>
          </div>
        </div>

        {/* Liabilities + Equity */}
        <div className="card-elevated-md rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-bold text-foreground">{t('KEWAJIBAN & EKUITAS')}</h3>
            <p className="text-xs text-muted-foreground">{bs.periodLabelId}</p>
          </div>
          <BSSectionTable
            title="Kewajiban Lancar (Current Liabilities)"
            items={bsData.liabilities.current}
            subtotalLabel="Total Kewajiban Lancar"
            subtotal={currentLiabTotal}
            accent="text-negative"
          />
          <BSSectionTable
            title="Kewajiban Tidak Lancar (Non-Current Liabilities)"
            items={bsData.liabilities.nonCurrent}
            subtotalLabel="Total Kewajiban Tidak Lancar"
            subtotal={nonCurrentLiabTotal}
            accent="text-negative"
          />
          <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-t border-border">
            <span className="text-sm font-bold text-foreground">{t('Total Kewajiban')}</span>
            <span className="text-sm font-bold font-mono text-negative">{formatRp(totalLiabilities)}</span>
          </div>

          <BSSectionTable
            title="Ekuitas (Equity)"
            items={bsData.equity}
            subtotalLabel="Total Ekuitas"
            subtotal={totalEquity}
            accent="text-positive"
          />
          <div className="flex items-center justify-between px-5 py-4 bg-primary/5 border-t-2 border-primary/20">
            <span className="text-base font-bold text-primary">{t('TOTAL KEWAJIBAN & EKUITAS')}</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(totalLiabEquity)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
