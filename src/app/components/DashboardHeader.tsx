'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Download, RefreshCw } from 'lucide-react';
import { CURRENCIES, CurrencyCode, useCurrency } from '@/lib/currency';
import { useLanguage } from '@/lib/language';

const branches = ['All Branches', 'Jakarta HQ', 'Surabaya', 'Bandung', 'Medan'];
const views = ['Actual', 'Budget', 'Previous Year'];

export default function DashboardHeader() {
  const [branch, setBranch] = useState('All Branches');
  const { currency, setCurrency } = useCurrency();
  const { t } = useLanguage();
  const [view, setView] = useState('Actual');

  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('Financial Overview')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('Comprehensive financial performance and business health — PT Nusantara Teknologi Indonesia')}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span className="badge-info">Jan 2026 – Aug 2026</span>
          <span className="badge-neutral">YTD</span>
          <span className="text-xs text-muted-foreground">{t('Last updated')}: 25 Aug 2026, 05:48 WIB</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {/* Branch */}
        <select
          value={branch}
          onChange={(e) => setBranch(e?.target?.value)}
          className="input-base w-auto text-xs py-1.5 pr-7 cursor-pointer"
        >
          {branches?.map((b) => (
            <option key={`branch-${b}`} value={b}>{t(b)}</option>
          ))}
        </select>

        {/* Currency */}
        <select
          value={currency}
          onChange={(e) => setCurrency(e?.target?.value as CurrencyCode)}
          className="input-base w-auto text-xs py-1.5 pr-7 cursor-pointer"
        >
          {CURRENCIES?.map((c) => (
            <option key={`cur-${c}`} value={c}>{c}</option>
          ))}
        </select>

        {/* View */}
        <div className="flex items-center bg-muted rounded-lg p-0.5 border border-border">
          {views?.map((v) => (
            <button
              key={`view-${v}`}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-150 ${
                view === v ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(v)}
            </button>
          ))}
        </div>

        <button
          onClick={() => toast.success(t('Export dimulai'), { description: t('Laporan dashboard akan diunduh sebagai Excel') })}
          className="btn-secondary text-xs py-1.5 gap-1.5"
        >
          <Download size={13} />
          {t('Export')}
        </button>

        <button
          onClick={() => toast.info(t('Memperbarui data dashboard...'))}
          className="p-2 rounded-lg border border-border bg-card hover:bg-muted text-muted-foreground transition-colors"
          aria-label="Refresh data"
        >
          <RefreshCw size={14} />
        </button>
      </div>
    </div>
  );
}
