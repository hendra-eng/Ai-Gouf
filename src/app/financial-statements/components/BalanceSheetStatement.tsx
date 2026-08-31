'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight, CheckCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';

const BSDonutChart = dynamic(() => import('./BSDonutChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full rounded-xl" />,
});

// Backend integration point: replace with /api/statements/balance-sheet?company=&period=
const bsData = {
  assets: {
    current: [
      { label: 'Kas & Bank', value: 2960 },
      { label: 'Piutang Usaha', value: 1240 },
      { label: 'Persediaan', value: 380 },
      { label: 'Biaya Dibayar Dimuka', value: 145 },
      { label: 'Aset Lancar Lainnya', value: 82 },
    ],
    nonCurrent: [
      { label: 'Properti & Bangunan', value: 1850 },
      { label: 'Peralatan & Mesin', value: 920 },
      { label: 'Kendaraan', value: 340 },
      { label: 'Aset Tak Berwujud', value: 480 },
      { label: 'Investasi Jangka Panjang', value: 620 },
    ],
  },
  liabilities: {
    current: [
      { label: 'Hutang Usaha', value: 860 },
      { label: 'Hutang Pajak', value: 182 },
      { label: 'Hutang Jangka Pendek', value: 450 },
      { label: 'Pendapatan Diterima Dimuka', value: 240 },
      { label: 'Kewajiban Lancar Lainnya', value: 96 },
    ],
    nonCurrent: [
      { label: 'Hutang Bank Jangka Panjang', value: 1280 },
      { label: 'Kewajiban Sewa (Lease)', value: 420 },
      { label: 'Kewajiban Imbalan Kerja', value: 185 },
    ],
  },
  equity: [
    { label: 'Modal Disetor', value: 3000 },
    { label: 'Laba Ditahan', value: 2944 },
    { label: 'Laba Tahun Berjalan', value: 1840 },
  ],
};

const currentAssetsTotal = bsData.assets.current.reduce((s, i) => s + i.value, 0);
const nonCurrentAssetsTotal = bsData.assets.nonCurrent.reduce((s, i) => s + i.value, 0);
const totalAssets = currentAssetsTotal + nonCurrentAssetsTotal;

const currentLiabTotal = bsData.liabilities.current.reduce((s, i) => s + i.value, 0);
const nonCurrentLiabTotal = bsData.liabilities.nonCurrent.reduce((s, i) => s + i.value, 0);
const totalLiabilities = currentLiabTotal + nonCurrentLiabTotal;

const totalEquity = bsData.equity.reduce((s, i) => s + i.value, 0);
const totalLiabEquity = totalLiabilities + totalEquity;
const isBalanced = Math.abs(totalAssets - totalLiabEquity) < 1;

interface BSSection {
  title: string;
  items: { label: string; value: number }[];
  subtotalLabel: string;
  subtotal: number;
  accent?: string;
}

function BSSectionTable({ title, items, subtotalLabel, subtotal, accent = 'text-foreground' }: BSSection) {
  const { currency } = useCurrency();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(true);
  return (
    <div>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-5 py-3 bg-muted/40 border-y border-border hover:bg-muted/60 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </button>
      {expanded && (
        <>
          {items.map((item, i) => (
            <div key={`bsitem-${title}-${i}`} className={`flex items-center justify-between px-8 py-2.5 border-b border-border/50 hover:bg-muted/30 transition-colors ${i % 2 === 1 ? 'bg-muted/10' : ''}`}>
              <span className="text-sm text-muted-foreground">{item.label}</span>
              <span className="text-sm font-semibold font-mono text-foreground">{formatRp(item.value)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-5 py-3 bg-muted/20 border-b border-border">
            <span className={`text-sm font-bold ${accent}`}>{subtotalLabel}</span>
            <span className={`text-sm font-bold font-mono ${accent}`}>{formatRp(subtotal)}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default function BalanceSheetStatement() {
  const { currency } = useCurrency();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  return (
    <div className="space-y-6">
      {/* Chart + Balance validation */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card-elevated-md rounded-xl p-5">
          <h3 className="text-base font-bold text-foreground mb-1">Asset Composition</h3>
          <p className="text-xs text-muted-foreground mb-4">Assets = Liabilities + Equity</p>
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
                {isBalanced ? 'Balance Sheet Balanced' : 'Balance Sheet Error'}
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
                  <span className="text-xs text-muted-foreground">{r.label}</span>
                  <span className="text-xs font-bold font-mono text-foreground">{formatRp(r.value)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Key ratios */}
          <div className="card-elevated-md rounded-xl p-5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Key Ratios</p>
            {[
              { label: 'Current Ratio', value: (currentAssetsTotal / currentLiabTotal).toFixed(2), good: currentAssetsTotal / currentLiabTotal > 1.5 },
              { label: 'Debt-to-Equity', value: (totalLiabilities / totalEquity).toFixed(2), good: totalLiabilities / totalEquity < 1.5 },
              { label: 'Asset Turnover', value: '1.84×', good: true },
              { label: 'Equity Ratio', value: `${((totalEquity / totalAssets) * 100).toFixed(1)}%`, good: true },
            ].map((r) => (
              <div key={`bsratio-${r.label}`} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <span className="text-xs text-muted-foreground">{r.label}</span>
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
            <h3 className="text-base font-bold text-foreground">ASET</h3>
            <p className="text-xs text-muted-foreground">Per 31 Agustus 2026</p>
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
            <span className="text-base font-bold text-primary">TOTAL ASET</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(totalAssets)}</span>
          </div>
        </div>

        {/* Liabilities + Equity */}
        <div className="card-elevated-md rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <h3 className="text-base font-bold text-foreground">KEWAJIBAN & EKUITAS</h3>
            <p className="text-xs text-muted-foreground">Per 31 Agustus 2026</p>
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
            <span className="text-sm font-bold text-foreground">Total Kewajiban</span>
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
            <span className="text-base font-bold text-primary">TOTAL KEWAJIBAN & EKUITAS</span>
            <span className="text-base font-bold font-mono text-primary">{formatRp(totalLiabEquity)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
