'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';
import dynamic from 'next/dynamic';
import { useLanguage } from '@/lib/language';
import { CURRENCIES, useCurrency } from '@/lib/currency';

const OverviewCharts = dynamic(() => import('./OverviewCharts'), { ssr: false });

export default function OverviewContent() {
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [branch, setBranch] = useState('All Branches');
  const { t } = useLanguage();
  const { currency, setCurrency, fx } = useCurrency();

  // labelKey/subLabelKey/changePeriodKey reference the shared translations
  // table (see src/lib/language.tsx); rawValue is a "Rp ..." shorthand run
  // through fx() so it follows the selected currency.
  const kpiCards = [
    { id: 'kpi-revenue', labelKey: 'Total Revenue', rawValue: 'Rp 8,42M', subLabelKey: 'Jan–Aug 2026 YTD', changeNum: 12.8, changePeriodKey: 'vs Jan–Aug 2025', changePositive: true, size: 'large' as const, sparkline: [620, 680, 720, 690, 810, 850, 890, 842] },
    { id: 'kpi-netprofit', labelKey: 'Net Profit', rawValue: 'Rp 1,84M', subLabelKey: 'Margin 21.8%', changeNum: 8.4, changePeriodKey: 'vs prev period', changePositive: true, sparkline: [140, 155, 160, 148, 175, 182, 188, 184] },
    { id: 'kpi-grossprofit', labelKey: 'Gross Profit', rawValue: 'Rp 3,72M', subLabelKey: 'Margin 44.2%', changeNum: 10.2, changePeriodKey: 'vs prev period', changePositive: true, sparkline: [310, 330, 345, 320, 365, 370, 375, 372] },
    { id: 'kpi-cash', labelKey: 'Cash & Bank', rawValue: 'Rp 2,96M', subLabelKey: '4.8 mo runway', changeNum: 5.7, changePeriodKey: 'vs prev period', changePositive: true, sparkline: [260, 270, 280, 275, 285, 290, 295, 296] },
    { id: 'kpi-ar', labelKey: 'Accounts Receivable', rawValue: 'Rp 1,24M', subLabelKey: 'Rp 320M overdue', changeNum: -4.3, changePeriodKey: 'vs prev period', changePositive: false, alert: true, sparkline: [980, 1020, 995, 1065, 1038, 1162, 1085, 1240] },
    { id: 'kpi-ap', labelKey: 'Accounts Payable', rawValue: 'Rp 860Jt', subLabelKey: 'Rp 142M due this week', changeNum: 3.1, changePeriodKey: 'vs prev period', changePositive: true, sparkline: [720, 690, 655, 725, 678, 802, 725, 860] },
    { id: 'kpi-ebitda', labelKey: 'EBITDA', rawValue: 'Rp 2,31M', subLabelKey: 'Margin 27.4%', changeNum: 11.7, changePeriodKey: 'vs prev period', changePositive: true, sparkline: [195, 210, 215, 205, 225, 228, 232, 231] },
    { id: 'kpi-tax', labelKey: 'Tax Payable', rawValue: 'Rp 182Jt', subLabelKey: '', alertLabelKey: 'Due in 14 days — 8 Sep 2026', changeNum: 6.2, changePeriodKey: 'vs prev period', changePositive: false, alert: true, sparkline: [145, 158, 162, 155, 170, 174, 178, 182] },
  ];

  const translatedKpiCards = kpiCards.map((kpi) => ({
    ...kpi,
    label: t(kpi.labelKey),
    value: fx(kpi.rawValue),
    subLabel: kpi.subLabelKey.startsWith('Rp ') ? fx(t(kpi.subLabelKey)) : t(kpi.subLabelKey),
    change: kpi.changeNum,
    changeLabel: t(kpi.changePeriodKey),
    ...(kpi.alertLabelKey ? { alertLabel: fx(t(kpi.alertLabelKey)) } : {}),
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">{t('Financial Overview')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('Comprehensive financial performance and business health — PT Nusantara Teknologi Indonesia')}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-600 text-primary">Jan 2026 – Aug 2026</span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-500">YTD</span>
            <span className="text-xs text-muted-foreground">{t('Last updated')}: 25 Aug 2026, 05:48 WIB</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option>{t('All Branches')}</option>
            <option>Jakarta</option>
            <option>Surabaya</option>
          </select>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value as typeof currency)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(['Actual', 'Budget', 'Previous Year'] as const).map((m) => (
            <button
              key={`view-${m}`}
              onClick={() => setViewMode(m)}
              className={`text-sm px-3 py-1.5 rounded-md font-500 transition-colors ${
                viewMode === m ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {t(m)}
            </button>
          ))}
          <button
            onClick={() => toast.success(t('Export dimulai'), { description: t('Laporan dashboard akan diunduh sebagai Excel') })}
            className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="ArrowDownTrayIcon" size={14} />
            {t('Export')}
          </button>
          <button
            onClick={() => toast.info(t('Memperbarui data dashboard...'))}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
          >
            <Icon name="ArrowPathIcon" size={16} />
          </button>
        </div>
      </div>

      {/* KPI Grid — 3 cols row 1: hero spans 2 + 1, row 2: 4 equal, row 3: 1 tax */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {/* Row 1 */}
        <KpiCard {...translatedKpiCards[0]} sparklineData={translatedKpiCards[0].sparkline} sparklineColor="var(--primary)" className="lg:col-span-2" />
        <KpiCard {...translatedKpiCards[1]} sparklineData={translatedKpiCards[1].sparkline} sparklineColor="var(--success)" />
        <KpiCard {...translatedKpiCards[2]} sparklineData={translatedKpiCards[2].sparkline} sparklineColor="var(--success)" />
        {/* Row 2 */}
        <KpiCard {...translatedKpiCards[3]} sparklineData={translatedKpiCards[3].sparkline} sparklineColor="var(--info)" />
        <KpiCard {...translatedKpiCards[4]} sparklineData={translatedKpiCards[4].sparkline} sparklineColor="var(--danger)" />
        <KpiCard {...translatedKpiCards[5]} sparklineData={translatedKpiCards[5].sparkline} sparklineColor="var(--warning)" />
        <KpiCard {...translatedKpiCards[6]} sparklineData={translatedKpiCards[6].sparkline} sparklineColor="var(--success)" />
        {/* Row 3 */}
        <KpiCard {...translatedKpiCards[7]} sparklineData={translatedKpiCards[7].sparkline} sparklineColor="var(--warning)" className="lg:col-span-1" />
      </div>

      {/* Charts */}
      <OverviewCharts />

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/accounts-receivable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">{t('Accounts Receivable')}</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-2xl font-700 text-foreground tabular-nums">{fx('Rp 1.24M')}</p>
          <p className="text-xs text-danger mt-0.5">{fx(t('Rp 320M overdue'))} — action required</p>
        </Link>
        <Link href="/accounts-payable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">{t('Accounts Payable')}</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-2xl font-700 text-foreground tabular-nums">{fx('Rp 860M')}</p>
          <p className="text-xs text-warning mt-0.5">{fx(t('Rp 142M due this week'))}</p>
        </Link>
        <Link href="/ai-financial-analyst" className="bg-ai-purple-bg border border-purple-200 rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-ai-purple">AI Financial Analyst</span>
            <Icon name="ArrowRightIcon" size={14} className="text-ai-purple group-hover:text-purple-700 transition-colors" />
          </div>
          <p className="text-sm text-ai-purple-foreground">5 analyses ready</p>
          <p className="text-xs text-ai-purple mt-0.5">Ask a financial question →</p>
        </Link>
      </div>
    </div>
  );
}