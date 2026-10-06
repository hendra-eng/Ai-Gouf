'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';
import type { LiabKpiCard } from '../lib/useLiabilitiesData';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat LiabilitiesContent.tsx
// (useLiabilitiesData()) untuk sumber data ASLI client aktif.
const ZERO_SPARK: { v: number }[] = Array(8).fill({ v: 0 });

const mockKpiCards: LiabKpiCard[] = [
  { label: 'TOTAL LIABILITIES', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'CURRENT LIABILITIES', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'NON-CURRENT LIABILITIES', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'ACCOUNTS PAYABLE', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'TAX PAYABLE', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'SHORT-TERM DEBT', value: 'Rp 0', subValue: 'Due within 12 months', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'LONG-TERM DEBT', value: 'Rp 0', subValue: 'Maturity > 12 months', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'TOTAL DEBT', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
];

export default function LiabilitiesKPIGrid({ cards }: { cards?: LiabKpiCard[] }) {
  const { fx } = useCurrency();
  const kpiCards = cards && cards.length > 0 ? cards : mockKpiCards;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`liab-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}