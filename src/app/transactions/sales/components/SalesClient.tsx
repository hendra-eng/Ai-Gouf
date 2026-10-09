'use client';

import React, { useState } from 'react';
import { CalendarDays, ChevronDown, LayoutDashboard, Database, ShoppingCart, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav from '@/components/ui/TabNav';
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

const TABS: { key: string; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'source-data', label: 'Source Data' },
  { key: 'sales-transaction', label: 'Sales Transaction' },
  { key: 'journal-preview', label: 'Journal Preview' },
  { key: 'exceptions', label: 'Exceptions' },
  { key: 'posted', label: 'Posted' },
];

const TAB_ICONS: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  'overview': LayoutDashboard,
  'source-data': Database,
  'sales-transaction': ShoppingCart,
  'journal-preview': Eye,
  'exceptions': AlertTriangle,
  'posted': CheckCircle2,
};

export default function SalesClient() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeClientId } = useActiveClient();
  const [activeTab, setActiveTab] = useState('overview');

  // Badge di tab "Exceptions" -- jumlah exception yang BELUM selesai
  // (Open/In Review), dari data asli (financial_transaction_sales_
  // exceptions), bukan lagi angka statis "24".
  const { exceptions } = useSalesExceptions(activeClientId ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved').length;

  return (
    <div className="space-y-0">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('Sales')}</h1>
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

      {/* Tabs -- gaya underline, disamakan dengan Financial Statements (TabNav) */}
      <TabNav
        activeKey={activeTab}
        onSelect={setActiveTab}
        items={TABS.map(tab => ({
          key: tab.key,
          label: t(tab.label),
          icon: TAB_ICONS[tab.key],
          badge: tab.key === 'exceptions' && openExceptionCount > 0 ? openExceptionCount : undefined,
        }))}
      />

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