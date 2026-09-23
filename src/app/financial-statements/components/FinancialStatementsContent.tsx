'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import PLStatement from './PLStatement';
import BalanceSheetStatement from './BalanceSheetStatement';
import CashFlowStatement from './CashFlowStatement';
import LPEStatement from './LPEStatement';
import CALKStatement from './CALKStatement';
import { Download, Printer, FileText } from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useStatementMeta } from '../lib/useStatementData';

const tabs = [
  { id: 'tab-pl', label: 'Profit & Loss', short: 'P&L' },
  { id: 'tab-bs', label: 'Balance Sheet', short: 'B/S' },
  { id: 'tab-cf', label: 'Cash Flow', short: 'C/F' },
  { id: 'tab-lpe', label: 'Changes in Equity', short: 'LPE' },
  { id: 'tab-calk', label: 'Notes', short: 'CALK' },
];

const tabNames: Record<string, string> = {
  'tab-pl': 'Profit & Loss Statement',
  'tab-bs': 'Balance Sheet',
  'tab-cf': 'Cash Flow Statement',
  'tab-lpe': 'Statement of Changes in Equity',
  'tab-calk': 'Notes to Financial Statements',
};

export default function FinancialStatementsContent() {
  const { t } = useLanguage();
  // Data dari API /api/v1/financial-statements (transaksi posted).
  const { companyName, periodLabel, asOfLabel, data, loading, error, adaData } = useStatementMeta();
  const seimbang = data ? data.balance_sheet.seimbang && data.trial_balance.seimbang : null;
  const [activeTab, setActiveTab] = useState('tab-pl');

  function handlePrint() {
    toast.info(t('Menyiapkan cetak'), { description: t(tabNames[activeTab]) });
    window.print();
  }

  function handleExportPdf() {
    toast.success(t('PDF sedang dibuat'), { description: `${t(tabNames[activeTab])} · ${companyName}` });
  }

  function handleExportExcel() {
    toast.success(t('Export Excel dimulai'), { description: `${t(tabNames[activeTab])} ${t('akan tersedia untuk diunduh sebentar lagi.')}` });
  }

  return (
    <div className="space-y-6 fade-in">
      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">{t('Financial Statements')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {companyName} · {periodLabel}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span className="badge-info">{t('Posted transactions only')}</span>
            {seimbang !== null && (
              <span className={seimbang ? 'badge-positive' : 'badge-negative'}>{seimbang ? t('Balanced ✓') : t('Not balanced')}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {loading ? t('Memuat...') : error ? `${t('Gagal memuat')}: ${error}` : adaData ? `${asOfLabel} · ${data?.periode.jumlah_jurnal ?? 0} ${t('journals')}` : t('Belum ada transaksi posted')}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handlePrint} className="btn-secondary text-xs py-1.5 gap-1.5">
            <Printer size={13} />
            {t('Print')}
          </button>
          <button onClick={handleExportPdf} className="btn-secondary text-xs py-1.5 gap-1.5">
            <FileText size={13} />
            {t('PDF')}
          </button>
          <button onClick={handleExportExcel} className="btn-primary text-xs py-1.5 gap-1.5">
            <Download size={13} />
            {t('Export Excel')}
          </button>
        </div>
      </div>
      {/* Tab navigation */}
      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto">
        {tabs?.map((tab) => (
          <button
            key={tab?.id}
            onClick={() => setActiveTab(tab?.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all duration-150 ${
              activeTab === tab?.id
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <span className="hidden sm:inline">{t(tab?.label)}</span>
            <span className="sm:hidden">{tab?.short}</span>
          </button>
        ))}
      </div>
      {/* Tab content */}
      <div className="fade-in">
        {activeTab === 'tab-pl' && <PLStatement />}
        {activeTab === 'tab-bs' && <BalanceSheetStatement />}
        {activeTab === 'tab-cf' && <CashFlowStatement />}
        {activeTab === 'tab-lpe' && <LPEStatement />}
        {activeTab === 'tab-calk' && <CALKStatement />}
      </div>
    </div>
  );
}