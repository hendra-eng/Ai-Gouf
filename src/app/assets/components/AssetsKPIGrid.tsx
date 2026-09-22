'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';
import type { AssetsKpiCard } from '../lib/useAssetsData';

// [UBAH] Data contoh di bawah ini sekarang cuma FALLBACK -- kalau client
// aktif sudah punya data (lihat AssetsContent.tsx -> useAssetsData()), kartu
// KPI di sini menampilkan angka ASLI client tsb lewat prop `cards`, bukan
// angka contoh ini lagi.
const ZERO_SPARK: { v: number }[] = Array(8).fill({ v: 0 });

const mockKpiCards: AssetsKpiCard[] = [
  { label: 'TOTAL ASSETS', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'CURRENT ASSETS', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'NON-CURRENT ASSETS', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'CASH & BANK', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'ACCOUNTS RECEIVABLE', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'INVENTORY', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'FIXED ASSETS (NET)', value: 'Rp 0', subValue: 'After accumulated depreciation', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'ACCUMULATED DEPRECIATION', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
];

export default function AssetsKPIGrid({ cards }: { cards?: AssetsKpiCard[] }) {
  const { fx } = useCurrency();
  const kpiCards = cards && cards.length > 0 ? cards : mockKpiCards;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`asset-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}