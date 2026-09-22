'use client';

import React, { useState } from 'react';
import { CalendarDays, ChevronDown } from 'lucide-react';
import SalesOverview from './SalesOverview';
import SalesSourceData from './SalesSourceData';
import SalesTransaction from './SalesTransaction';
import SalesJournalPreview from './SalesJournalPreview';
import SalesExceptions from './SalesExceptions';
import SalesPosted from './SalesPosted';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useSalesExceptions } from '@/lib/salesStore';

const TABS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'source-data', label: 'Source Data' },
  { key: 'sales-transaction', label: 'Sales Transaction' },
  { key: 'journal-preview', label: 'Journal Preview' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'posted', label: 'Posted' },
];

export default function SalesClient() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('overview');

  // Badge di tab "Exceptions" -- jumlah exception yang BELUM selesai
  // (Open/In Review), dari data asli (financial_transaction_sales_
  // exceptions), bukan lagi angka statis "24".
  const { exceptions } = useSalesExceptions(user?.id ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved').length;

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('Sales')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {activeTab === 'overview' && t('Ringkasan performa penjualan dan metrik utama.')}
            {activeTab === 'source-data' && t('Kelola dan proses data sumber penjualan sebelum dilakukan penjurnalan.')}
            {activeTab === 'sales-transaction' && t('Workspace transaksi penjualan yang detail dan terintegrasi dengan jurnal akuntansi.')}
            {activeTab === 'journal-preview' && t('Kelola dan pantau seluruh transaksi penjualan perusahaan.')}
            {activeTab === 'exceptions' && t('Kelola dan tindak lanjuti transaksi penjualan yang memerlukan review.')}
            {activeTab === 'posted' && t('Daftar transaksi penjualan yang telah diposting ke dalam sistem akuntansi.')}
          </p>
        </div>
        <button className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors">
          <CalendarDays size={14} className="text-muted-foreground" />
          <span className="text-foreground font-medium">01 Jan 2024 – 31 Dec 2024</span>
          <ChevronDown size={14} className="text-muted-foreground" />
        </button>
      </div>

      {/* Tabs — desain pill/segmented, disamakan dengan Financial Statements
          (FinancialStatementsContent.tsx): kontainer bg-muted rounded-xl,
          tab aktif dapat bg-card + shadow-card, tanpa garis bawah. */}
      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto scrollbar-thin mb-0">
        {TABS?.map(tab => (
          <button
            key={tab?.key}
            onClick={() => setActiveTab(tab?.key)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
              activeTab === tab?.key
                ? 'bg-card text-foreground shadow-card'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(tab?.label)}
            {tab?.key === 'exceptions' && openExceptionCount > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-red-100 text-red-600 rounded-full">{openExceptionCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="pt-5">
        {activeTab === 'overview' && <SalesOverview />}
        {activeTab === 'source-data' && <SalesSourceData />}
        {activeTab === 'sales-transaction' && <SalesTransaction />}
        {activeTab === 'journal-preview' && <SalesJournalPreview />}
        {activeTab === 'exceptions' && <SalesExceptions />}
        {activeTab === 'posted' && <SalesPosted />}
      </div>
    </div>
  );
}