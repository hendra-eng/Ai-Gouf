'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/equity/kpi?period=...
const kpiCards = [
  {
    label: 'TOTAL EQUITY',
    value: 'Rp 4,70M',
    subValue: 'Jan–Aug 2026 YTD',
    change: 9.6,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 3.8 }, { v: 3.9 }, { v: 4.0 }, { v: 4.1 }, { v: 4.2 }, { v: 4.4 }, { v: 4.55 }, { v: 4.70 }],
    status: 'neutral' as const,
  },
  {
    label: 'PAID-IN CAPITAL',
    value: 'Rp 3,00M',
    subValue: 'Authorized share capital',
    change: 0.0,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 3.0 }, { v: 3.0 }, { v: 3.0 }, { v: 3.0 }, { v: 3.0 }, { v: 3.0 }, { v: 3.0 }, { v: 3.0 }],
    status: 'neutral' as const,
  },
  {
    label: 'RETAINED EARNINGS',
    value: 'Rp 1,24M',
    subValue: 'Accumulated prior years',
    change: 14.8,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 0.9 }, { v: 0.95 }, { v: 1.0 }, { v: 1.05 }, { v: 1.1 }, { v: 1.15 }, { v: 1.20 }, { v: 1.24 }],
    status: 'neutral' as const,
  },
  {
    label: 'CURRENT YEAR PROFIT',
    value: 'Rp 1,84M',
    subValue: 'Net profit YTD 2026',
    change: 8.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.4 }, { v: 1.5 }, { v: 1.6 }, { v: 1.65 }, { v: 1.7 }, { v: 1.75 }, { v: 1.80 }, { v: 1.84 }],
    status: 'neutral' as const,
  },
  {
    label: 'OTHER EQUITY',
    value: 'Rp 460M',
    subValue: 'OCI + Revaluation Reserve',
    change: 12.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 340 }, { v: 355 }, { v: 370 }, { v: 390 }, { v: 410 }, { v: 425 }, { v: 440 }, { v: 460 }],
    status: 'neutral' as const,
  },
  {
    label: 'EQUITY GROWTH',
    value: '+9.6%',
    subValue: 'vs prior period',
    change: 9.6,
    changeLabel: 'YTD 2026',
    sparkData: [{ v: 5.2 }, { v: 6.1 }, { v: 7.4 }, { v: 8.0 }, { v: 8.8 }, { v: 9.1 }, { v: 9.4 }, { v: 9.6 }],
    status: 'neutral' as const,
  },
];

export default function EquityKPIGrid() {
  const { fx } = useCurrency();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-6 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`equity-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}
