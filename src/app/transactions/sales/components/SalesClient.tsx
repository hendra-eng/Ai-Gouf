'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarDays, ChevronDown, CircleCheck, Database, Eye, FileText, LayoutGrid, Plus } from 'lucide-react';
import { tabBadgeCls, tabCls, tabNavCls } from '@/components/shared/moduleUi';
import SalesOverview from './SalesOverview';
import SalesSourceData from './SalesSourceData';
import SalesTransaction from './SalesTransaction';
import SalesJournalPreview from './SalesJournalPreview';
import SalesExceptions from './SalesExceptions';
import SalesPosted from './SalesPosted';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesExceptions } from '@/lib/salesStore';

const TABS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutGrid },
  { key: 'source-data', label: 'Source Data', icon: Database },
  { key: 'sales-transaction', label: 'Sales Transaction', icon: FileText },
  { key: 'journal-preview', label: 'Journal Preview', icon: Eye },
  { key: 'exceptions', label: 'Exceptions', icon: AlertTriangle },
  { key: 'posted', label: 'Posted', icon: CircleCheck },
];

export default function SalesClient() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeClientId } = useActiveClient();
  const [activeTab, setActiveTab] = useState('overview');

  // Deep link ?tab=journal-preview (mis. dari AR > Create Invoice setelah Submit for Approval).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(x => x.key === t)) setActiveTab(t);
  }, []);

  // Badge di tab "Exceptions" -- jumlah exception yang BELUM selesai
  // (Open/In Review), dari data asli (financial_transaction_sales_
  // exceptions), bukan lagi angka statis "24".
  const { exceptions } = useSalesExceptions(activeClientId ?? null);
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
        <div className="flex items-center gap-2">
          {activeTab === 'sales-transaction' && (
            <Link href="/transactions/sales/invoice/new" className="flex items-center gap-1.5 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
              <Plus size={14} /> {t('Tambah Transaksi')}
            </Link>
          )}
          <button className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors">
            <CalendarDays size={14} className="text-muted-foreground" />
            <span className="text-foreground font-medium">01 Jan 2024 – 31 Dec 2024</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Tabs — gaya underline bersama (tabCls, acuan Transactions > Other). */}
      <nav className={tabNavCls}>
        {TABS?.map(tab => (
          <button
            key={tab?.key}
            onClick={() => setActiveTab(tab?.key)}
            className={tabCls(activeTab === tab?.key)}
          >
            <tab.icon size={16} /> {t(tab?.label)}
            {tab?.key === 'exceptions' && openExceptionCount > 0 && (
              <span className={tabBadgeCls}>{openExceptionCount}</span>
            )}
          </button>
        ))}
      </nav>

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