'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/liabilities/kpi?period=...
const kpiCards = [
  {
    label: 'TOTAL LIABILITIES',
    value: 'Rp 2,14M',
    subValue: 'Jan–Aug 2026 YTD',
    change: 4.8,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.8 }, { v: 1.88 }, { v: 1.92 }, { v: 1.98 }, { v: 2.02 }, { v: 2.08 }, { v: 2.11 }, { v: 2.14 }],
    status: 'neutral' as const,
  },
  {
    label: 'CURRENT LIABILITIES',
    value: 'Rp 1,28M',
    subValue: '59.8% of total liabilities',
    change: 6.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.0 }, { v: 1.05 }, { v: 1.08 }, { v: 1.12 }, { v: 1.16 }, { v: 1.20 }, { v: 1.25 }, { v: 1.28 }],
    status: 'neutral' as const,
  },
  {
    label: 'NON-CURRENT LIABILITIES',
    value: 'Rp 860M',
    subValue: '40.2% of total liabilities',
    change: 2.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 780 }, { v: 790 }, { v: 800 }, { v: 810 }, { v: 820 }, { v: 835 }, { v: 845 }, { v: 860 }],
    status: 'neutral' as const,
  },
  {
    label: 'ACCOUNTS PAYABLE',
    value: 'Rp 860M',
    subValue: 'Rp 142M due this week',
    change: 3.1,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 720 }, { v: 740 }, { v: 760 }, { v: 780 }, { v: 800 }, { v: 820 }, { v: 840 }, { v: 860 }],
    status: 'neutral' as const,
  },
  {
    label: 'TAX PAYABLE',
    value: 'Rp 182M',
    subValue: 'Due in 14 days — 8 Sep 2026',
    change: 6.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 140 }, { v: 150 }, { v: 155 }, { v: 160 }, { v: 165 }, { v: 170 }, { v: 175 }, { v: 182 }],
    status: 'warning' as const,
    highlight: true,
  },
  {
    label: 'SHORT-TERM DEBT',
    value: 'Rp 240M',
    subValue: 'Due within 12 months',
    change: 0.0,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 240 }, { v: 240 }, { v: 240 }, { v: 240 }, { v: 240 }, { v: 240 }, { v: 240 }, { v: 240 }],
    status: 'neutral' as const,
  },
  {
    label: 'LONG-TERM DEBT',
    value: 'Rp 620M',
    subValue: 'Maturity > 12 months',
    change: 3.3,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 560 }, { v: 565 }, { v: 570 }, { v: 580 }, { v: 590 }, { v: 600 }, { v: 610 }, { v: 620 }],
    status: 'neutral' as const,
  },
  {
    label: 'TOTAL DEBT',
    value: 'Rp 860M',
    subValue: 'D/E Ratio: 0.18x',
    change: 2.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 780 }, { v: 790 }, { v: 800 }, { v: 810 }, { v: 820 }, { v: 835 }, { v: 845 }, { v: 860 }],
    status: 'neutral' as const,
  },
];

export default function LiabilitiesKPIGrid() {
  const { fx } = useCurrency();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`liab-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}
