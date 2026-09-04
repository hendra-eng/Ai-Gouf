'use client';
import React from 'react';
import FinancialKPICard from '@/components/ui/FinancialKPICard';
import { useCurrency } from '@/lib/currency';
import type { AssetsKpiCard } from '../lib/useAssetsData';

// [UBAH] Data contoh di bawah ini sekarang cuma FALLBACK -- kalau client
// aktif sudah punya data (lihat AssetsContent.tsx -> useAssetsData()), kartu
// KPI di sini menampilkan angka ASLI client tsb lewat prop `cards`, bukan
// angka contoh ini lagi.
const mockKpiCards: AssetsKpiCard[] = [
  {
    label: 'TOTAL ASSETS',
    value: 'Rp 6,84M',
    subValue: 'Jan–Aug 2026 YTD',
    change: 14.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 5.2 }, { v: 5.5 }, { v: 5.8 }, { v: 6.0 }, { v: 6.2 }, { v: 6.5 }, { v: 6.7 }, { v: 6.84 }],
    status: 'neutral',
  },
  {
    label: 'CURRENT ASSETS',
    value: 'Rp 4,12M',
    subValue: '60.2% of total assets',
    change: 8.6,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 3.2 }, { v: 3.4 }, { v: 3.5 }, { v: 3.7 }, { v: 3.8 }, { v: 3.9 }, { v: 4.0 }, { v: 4.12 }],
    status: 'neutral',
  },
  {
    label: 'NON-CURRENT ASSETS',
    value: 'Rp 2,72M',
    subValue: '39.8% of total assets',
    change: 22.5,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.8 }, { v: 1.9 }, { v: 2.0 }, { v: 2.1 }, { v: 2.3 }, { v: 2.5 }, { v: 2.6 }, { v: 2.72 }],
    status: 'neutral',
  },
  {
    label: 'CASH & BANK',
    value: 'Rp 2,96M',
    subValue: '4.8 mo runway',
    change: 5.7,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 2.4 }, { v: 2.5 }, { v: 2.6 }, { v: 2.7 }, { v: 2.75 }, { v: 2.8 }, { v: 2.9 }, { v: 2.96 }],
    status: 'neutral',
  },
  {
    label: 'ACCOUNTS RECEIVABLE',
    value: 'Rp 1,24M',
    subValue: 'Rp 320M overdue',
    change: -4.3,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.5 }, { v: 1.45 }, { v: 1.4 }, { v: 1.35 }, { v: 1.3 }, { v: 1.28 }, { v: 1.25 }, { v: 1.24 }],
    status: 'negative',
    highlight: true,
  },
  {
    label: 'INVENTORY',
    value: 'Rp 420M',
    subValue: 'Avg turnover: 42 days',
    change: 3.2,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 360 }, { v: 370 }, { v: 380 }, { v: 385 }, { v: 395 }, { v: 405 }, { v: 415 }, { v: 420 }],
    status: 'neutral',
  },
  {
    label: 'FIXED ASSETS (NET)',
    value: 'Rp 1,85M',
    subValue: 'After accumulated depreciation',
    change: 18.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 1.3 }, { v: 1.4 }, { v: 1.5 }, { v: 1.55 }, { v: 1.65 }, { v: 1.72 }, { v: 1.80 }, { v: 1.85 }],
    status: 'neutral',
  },
  {
    label: 'ACCUMULATED DEPRECIATION',
    value: '(Rp 410M)',
    subValue: '18.2% of gross fixed assets',
    change: -8.4,
    changeLabel: 'vs prev period',
    sparkData: [{ v: 280 }, { v: 300 }, { v: 320 }, { v: 340 }, { v: 360 }, { v: 380 }, { v: 395 }, { v: 410 }],
    status: 'warning',
  },
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
