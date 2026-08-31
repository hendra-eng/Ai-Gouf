'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/ui/KpiCard';
import dynamic from 'next/dynamic';

const OverviewCharts = dynamic(() => import('./OverviewCharts'), { ssr: false });

export default function OverviewContent() {
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [branch, setBranch] = useState('All Branches');
  const [currency, setCurrency] = useState('IDR');

  const kpiCards = [
    { id: 'kpi-revenue', label: 'TOTAL REVENUE', value: 'Rp 8,42M', subLabel: 'Jan–Aug 2026 YTD', change: '+12.8% vs Jan–Aug 2025', changePositive: true, size: 'large' as const, sparkline: [620, 680, 720, 690, 810, 850, 890, 842] },
    { id: 'kpi-netprofit', label: 'NET PROFIT', value: 'Rp 1,84M', subLabel: 'Margin 21.8%', change: '+8.4% vs prev period', changePositive: true, sparkline: [140, 155, 160, 148, 175, 182, 188, 184] },
    { id: 'kpi-grossprofit', label: 'GROSS PROFIT', value: 'Rp 3,72M', subLabel: 'Margin 44.2%', change: '+10.2% vs prev period', changePositive: true, sparkline: [310, 330, 345, 320, 365, 370, 375, 372] },
    { id: 'kpi-cash', label: 'CASH & BANK', value: 'Rp 2,96M', subLabel: '4.8 mo runway', change: '+5.7% vs prev period', changePositive: true, sparkline: [260, 270, 280, 275, 285, 290, 295, 296] },
    { id: 'kpi-ar', label: 'ACCOUNTS RECEIVABLE', value: 'Rp 1,24M', subLabel: 'Rp 320M overdue', change: '-4.3% vs prev period', changePositive: false, alert: true, sparkline: [980, 1020, 995, 1065, 1038, 1162, 1085, 1240] },
    { id: 'kpi-ap', label: 'ACCOUNTS PAYABLE', value: 'Rp 860Jt', subLabel: 'Rp 142M due this week', change: '+3.1% vs prev period', changePositive: true, sparkline: [720, 690, 655, 725, 678, 802, 725, 860] },
    { id: 'kpi-ebitda', label: 'EBITDA', value: 'Rp 2,31M', subLabel: 'Margin 27.4%', change: '+11.7% vs prev period', changePositive: true, sparkline: [195, 210, 215, 205, 225, 228, 232, 231] },
    { id: 'kpi-tax', label: 'TAX PAYABLE', value: 'Rp 182Jt', subLabel: '', alertLabel: 'Due in 14 days — 8 Sep 2026', change: '+6.2% vs prev period', changePositive: false, alert: true, sparkline: [145, 158, 162, 155, 170, 174, 178, 182] },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">Financial Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Comprehensive financial performance and business health — PT Nusantara Teknologi Indonesia</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-600 text-primary">Jan 2026 – Aug 2026</span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-500">YTD</span>
            <span className="text-xs text-muted-foreground">Last updated: 25 Aug 2026, 05:48 WIB</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option>All Branches</option>
            <option>Jakarta</option>
            <option>Surabaya</option>
          </select>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option>IDR</option>
            <option>USD</option>
          </select>
          {(['Actual', 'Budget', 'Previous Year'] as const).map((m) => (
            <button
              key={`view-${m}`}
              onClick={() => setViewMode(m)}
              className={`text-sm px-3 py-1.5 rounded-md font-500 transition-colors ${
                viewMode === m ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {m}
            </button>
          ))}
          <button
            onClick={() => toast.success('Export dimulai', { description: 'Laporan overview akan diunduh sebagai Excel' })}
            className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="ArrowDownTrayIcon" size={14} />
            Export
          </button>
          <button
            onClick={() => toast.info('Memperbarui data overview...')}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors"
          >
            <Icon name="ArrowPathIcon" size={16} />
          </button>
        </div>
      </div>

      {/* KPI Grid — 3 cols row 1: hero spans 2 + 1, row 2: 4 equal, row 3: 1 tax */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {/* Row 1 */}
        <KpiCard {...kpiCards[0]} sparklineData={kpiCards[0].sparkline} sparklineColor="var(--primary)" className="lg:col-span-2" />
        <KpiCard {...kpiCards[1]} sparklineData={kpiCards[1].sparkline} sparklineColor="var(--success)" />
        <KpiCard {...kpiCards[2]} sparklineData={kpiCards[2].sparkline} sparklineColor="var(--success)" />
        {/* Row 2 */}
        <KpiCard {...kpiCards[3]} sparklineData={kpiCards[3].sparkline} sparklineColor="var(--info)" />
        <KpiCard {...kpiCards[4]} sparklineData={kpiCards[4].sparkline} sparklineColor="var(--danger)" />
        <KpiCard {...kpiCards[5]} sparklineData={kpiCards[5].sparkline} sparklineColor="var(--warning)" />
        <KpiCard {...kpiCards[6]} sparklineData={kpiCards[6].sparkline} sparklineColor="var(--success)" />
        {/* Row 3 */}
        <KpiCard {...kpiCards[7]} sparklineData={kpiCards[7].sparkline} sparklineColor="var(--warning)" className="lg:col-span-1" />
      </div>

      {/* Charts */}
      <OverviewCharts />

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/accounts-receivable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">Accounts Receivable</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-2xl font-700 text-foreground tabular-nums">Rp 1.24B</p>
          <p className="text-xs text-danger mt-0.5">Rp 320M overdue — action required</p>
        </Link>
        <Link href="/accounts-payable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">Accounts Payable</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <p className="text-2xl font-700 text-foreground tabular-nums">Rp 860M</p>
          <p className="text-xs text-warning mt-0.5">Rp 142M due this week</p>
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