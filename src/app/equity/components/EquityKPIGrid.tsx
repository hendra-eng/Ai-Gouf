'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';
import type { EquityKpiCard } from '../lib/useEquityData';

// [UBAH] Data contoh di bawah cuma FALLBACK -- lihat EquityContent.tsx
// (useEquityData()) untuk sumber data ASLI client aktif.
const ZERO_SPARK: { v: number }[] = Array(8).fill({ v: 0 });

const mockKpiCards: EquityKpiCard[] = [
  { label: 'TOTAL EQUITY', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'PAID-IN CAPITAL', value: 'Rp 0', subValue: 'Authorized share capital', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'RETAINED EARNINGS', value: 'Rp 0', subValue: 'Accumulated prior years', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'CURRENT YEAR PROFIT', value: 'Rp 0', subValue: '', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'OTHER EQUITY', value: 'Rp 0', subValue: 'OCI + Revaluation Reserve', change: 0, changeLabel: 'vs prev period', sparkData: ZERO_SPARK, status: 'neutral' },
  { label: 'EQUITY GROWTH', value: '0%', subValue: 'vs prior period', change: 0, changeLabel: '', sparkData: ZERO_SPARK, status: 'neutral' },
];

export default function EquityKPIGrid({ cards }: { cards?: EquityKpiCard[] }) {
  const { fx } = useCurrency();
  const kpiCards = cards && cards.length > 0 ? cards : mockKpiCards;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`equity-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}