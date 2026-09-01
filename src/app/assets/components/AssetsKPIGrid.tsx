'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/assets/kpi?period=...&branch=...
const kpiCards = [
  {
    label: 'TOTAL ASSETS',
    value: 'Rp 6,84M',
    subValue: 'Jan–Aug 2026 YTD',
    change: 14.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 5.2 }, { v: 5.5 }, { v: 5.8 }, { v: 6.0 }, { v: 6.2 }, { v: 6.5 }, { v: 6.7 }, { v: 6.84 }],
    status: 'neutral' as const,
  },
  {
    label: 'CURRENT ASSETS',
    value: 'Rp 4,12M',
    subValue: '60.2% of total assets',
    change: 8.6,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 3.2 }, { v: 3.4 }, { v: 3.5 }, { v: 3.7 }, { v: 3.8 }, { v: 3.9 }, { v: 4.0 }, { v: 4.12 }],
    status: 'neutral' as const,
  },
  {
    label: 'NON-CURRENT ASSETS',
    value: 'Rp 2,72M',
    subValue: '39.8% of total assets',
    change: 22.5,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.8 }, { v: 1.9 }, { v: 2.0 }, { v: 2.1 }, { v: 2.3 }, { v: 2.5 }, { v: 2.6 }, { v: 2.72 }],
    status: 'neutral' as const,
  },
  {
    label: 'CASH & BANK',
    value: 'Rp 2,96M',
    subValue: '4.8 mo runway',
    change: 5.7,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 2.4 }, { v: 2.5 }, { v: 2.6 }, { v: 2.7 }, { v: 2.75 }, { v: 2.8 }, { v: 2.9 }, { v: 2.96 }],
    status: 'neutral' as const,
  },
  {
    label: 'ACCOUNTS RECEIVABLE',
    value: 'Rp 1,24M',
    subValue: 'Rp 320M overdue',
    change: -4.3,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.5 }, { v: 1.45 }, { v: 1.4 }, { v: 1.35 }, { v: 1.3 }, { v: 1.28 }, { v: 1.25 }, { v: 1.24 }],
    status: 'negative' as const,
    highlight: true,
  },
  {
    label: 'INVENTORY',
    value: 'Rp 420M',
    subValue: 'Avg turnover: 42 days',
    change: 3.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 360 }, { v: 370 }, { v: 380 }, { v: 385 }, { v: 395 }, { v: 405 }, { v: 415 }, { v: 420 }],
    status: 'neutral' as const,
  },
  {
    label: 'FIXED ASSETS (NET)',
    value: 'Rp 1,85M',
    subValue: 'After accumulated depreciation',
    change: 18.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.3 }, { v: 1.4 }, { v: 1.5 }, { v: 1.55 }, { v: 1.65 }, { v: 1.72 }, { v: 1.80 }, { v: 1.85 }],
    status: 'neutral' as const,
  },
  {
    label: 'ACCUMULATED DEPRECIATION',
    value: '(Rp 410M)',
    subValue: '18.2% of gross fixed assets',
    change: -8.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 280 }, { v: 300 }, { v: 320 }, { v: 340 }, { v: 360 }, { v: 380 }, { v: 395 }, { v: 410 }],
    status: 'warning' as const,
  },
];

export default function AssetsKPIGrid() {
  const { fx } = useCurrency();
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-3 mb-6">
      {kpiCards.map((kpi, i) => (
        <FinancialKPICard key={`asset-kpi-${i}`} {...kpi} value={fx(kpi.value)} subValue={fx(kpi.subValue)} />
      ))}
    </div>
  );
}