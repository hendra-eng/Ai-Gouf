'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Icon from '@/components/ui/AppIcon';
import dynamic from 'next/dynamic';
import { useLanguage } from '@/lib/language';
import { CURRENCIES, useCurrency } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';
import { COMPANY } from '@/lib/financialData';
// [BARU] KPI grid sekarang REAL: KPIBentoGrid.tsx sudah lengkap ambil data
// dari backend (GET /api/client/{id}/kpi-bento, lihat ambilKpiBento() di
// agent-ai/lib/api.js) untuk client yang lagi aktif (useActiveClient) --
// sebelumnya komponen ini sudah ada & sudah benar, tapi TIDAK PERNAH dipakai
// di halaman manapun; OverviewContent (halaman "/" yang sebenarnya) masih
// pakai 8 kartu KPI hardcoded sendiri (`kpiCards` di bawah, sekarang
// dihapus). KPIBentoGrid otomatis fallback ke data contoh + banner "Showing
// sample data" kalau belum ada client aktif / client belum ada jurnal sama
// sekali -- jadi halaman tidak pernah kosong.
import KPIBentoGrid from './KPIBentoGrid';

const OverviewCharts = dynamic(() => import('./OverviewCharts'), { ssr: false });

export default function OverviewContent() {
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [branch, setBranch] = useState('All Branches');
  const { t } = useLanguage();
  const { currency, setCurrency, fx } = useCurrency();
  const { activeClientName } = useActiveClient();
  const companyName = activeClientName || COMPANY.name;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">{t('Financial Overview')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('Comprehensive financial performance and business health')} — {companyName}</p>
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

      {/* KPI Grid — sekarang REAL, ambil dari backend untuk client aktif (lihat import KPIBentoGrid di atas) */}
      <KPIBentoGrid />

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