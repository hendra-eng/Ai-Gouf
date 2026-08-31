'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import MetricCard from '@/components/ui/MetricCard';
import { useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

// Bento grid plan: 8 cards → grid-cols-4
// Row 1: Revenue (hero, spans 2 cols) + Net Profit + Gross Profit
// Row 2: Cash & Bank + AR + AP + EBITDA + Tax Payable
// Adjusted: Row 1: 2+1+1 = 4 cols, Row 2: 1+1+1+1 = 4 cols → ✓ no orphans

// Backend integration point: replace mock sparkline data with time-series from financial_periods API

const revenueSparkline = [
  { v: 820 }, { v: 945 }, { v: 880 }, { v: 1020 }, { v: 1100 }, { v: 1050 },
  { v: 1180 }, { v: 1220 },
];
const profitSparkline = [
  { v: 180 }, { v: 210 }, { v: 195 }, { v: 240 }, { v: 260 }, { v: 230 },
  { v: 280 }, { v: 290 },
];
const grossSparkline = [
  { v: 380 }, { v: 420 }, { v: 395 }, { v: 450 }, { v: 490 }, { v: 460 },
  { v: 510 }, { v: 530 },
];
const cashSparkline = [
  { v: 240 }, { v: 260 }, { v: 280 }, { v: 270 }, { v: 310 }, { v: 290 },
  { v: 320 }, { v: 296 },
];
const arSparkline = [
  { v: 140 }, { v: 155 }, { v: 148 }, { v: 162 }, { v: 158 }, { v: 150 },
  { v: 135 }, { v: 124 },
];
const apSparkline = [
  { v: 72 }, { v: 80 }, { v: 75 }, { v: 88 }, { v: 82 }, { v: 90 },
  { v: 85 }, { v: 86 },
];
const ebitdaSparkline = [
  { v: 195 }, { v: 220 }, { v: 210 }, { v: 248 }, { v: 265 }, { v: 240 },
  { v: 278 }, { v: 285 },
];
const taxSparkline = [
  { v: 15 }, { v: 18 }, { v: 16 }, { v: 22 }, { v: 20 }, { v: 19 },
  { v: 21 }, { v: 18 },
];

export default function KPIBentoGrid() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
      {/* Row 1 */}
      {/* Hero: Total Revenue — spans 2 cols */}
      <div className="col-span-2">
        <MetricCard
          id="kpi-revenue"
          label={t('Total Revenue')}
          value={fx('Rp 8,42M')}
          change={12.8}
          changePeriod={t('vs Jan–Aug 2025')}
          sparkline={revenueSparkline}
          status="positive"
          subtitle={t('Jan–Aug 2026 YTD')}
          onClick={() => router?.push('/financial-statements')}
          hero
        />
      </div>
      {/* Net Profit */}
      <MetricCard
        id="kpi-netprofit"
        label={t('Net Profit')}
        value={fx('Rp 1,84M')}
        change={8.4}
        changePeriod={t('vs prev period')}
        sparkline={profitSparkline}
        status="positive"
        subtitle={t('Margin 21.8%')}
        onClick={() => router?.push('/financial-statements')}
      />
      {/* Gross Profit */}
      <MetricCard
        id="kpi-grossprofit"
        label={t('Gross Profit')}
        value={fx('Rp 3,72M')}
        change={10.2}
        changePeriod={t('vs prev period')}
        sparkline={grossSparkline}
        status="positive"
        subtitle={t('Margin 44.2%')}
        onClick={() => router?.push('/financial-statements')}
      />
      {/* Row 2 */}
      {/* Cash & Bank */}
      <MetricCard
        id="kpi-cash"
        label={t('Cash & Bank')}
        value={fx('Rp 2,96M')}
        change={5.7}
        changePeriod={t('vs prev period')}
        sparkline={cashSparkline}
        status="positive"
        subtitle={t('4.8 mo runway')}
        onClick={() => router?.push('/financial-statements')}
      />
      {/* Accounts Receivable */}
      <MetricCard
        id="kpi-ar"
        label={t('Accounts Receivable')}
        value={fx('Rp 1,24M')}
        change={-4.3}
        changePeriod={t('vs prev period')}
        sparkline={arSparkline}
        status="negative"
        subtitle={fx(t('Rp 320M overdue'))}
        onClick={() => router?.push('/transactions')}
      />
      {/* Accounts Payable */}
      <MetricCard
        id="kpi-ap"
        label={t('Accounts Payable')}
        value={fx('Rp 860Jt')}
        change={3.1}
        changePeriod={t('vs prev period')}
        sparkline={apSparkline}
        status="neutral"
        subtitle={fx(t('Rp 142M due this week'))}
        onClick={() => router?.push('/transactions')}
      />
      {/* EBITDA */}
      <MetricCard
        id="kpi-ebitda"
        label={t('EBITDA')}
        value={fx('Rp 2,31M')}
        change={11.7}
        changePeriod={t('vs prev period')}
        sparkline={ebitdaSparkline}
        status="positive"
        subtitle={t('Margin 27.4%')}
        onClick={() => router?.push('/financial-statements')}
      />
      {/* Tax Payable — warning */}
      <MetricCard
        id="kpi-tax"
        label={t('Tax Payable')}
        value={fx('Rp 182Jt')}
        change={6.2}
        changePeriod={t('vs prev period')}
        sparkline={taxSparkline}
        status="warning"
        alert={t('Due in 14 days — 8 Sep 2026')}
        onClick={() => router?.push('/transactions')}
      />
    </div>
  );
}
