'use client';

import React from 'react';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav, { type TabNavItem } from '@/components/ui/TabNav';

export type OtherTabKey = 'overview' | 'source' | 'transaction' | 'preview' | 'exceptions' | 'posted';

const descriptions: Record<OtherTabKey, string> = {
  overview: 'Ringkasan jurnal lain-lain (di luar Sales, Purchase, dan Bank & Cash) — tambah jurnal, approve, lalu posting ke Buku Besar.',
  source: 'Data sumber transaksi Other (General Journal, CapEx, dan transaksi belum terkategori) sebelum dijurnal.',
  transaction: 'Daftar jurnal Other per nomor jurnal, terintegrasi dengan jurnal akuntansi.',
  preview: 'Pratinjau jurnal Other yang belum diposting — cek keseimbangan debit dan kredit.',
  exceptions: 'Jurnal Other yang perlu ditinjau: tanpa nomor jurnal, tidak balance, draft, atau akun belum dipetakan.',
  posted: 'Daftar jurnal Other yang telah diposting ke sistem akuntansi.',
};

// Header + tab bar halaman Other (pola sama dengan JournalEntryTabs / PurchaseTabs).
// Badge tab Exceptions dihitung dari data asli, bukan angka statis.
export default function OtherTabs({ activeTab, exceptionCount = 0 }: { activeTab: OtherTabKey; exceptionCount?: number }) {
  const tabs: TabNavItem[] = [
    { key: 'overview', label: 'Overview', href: '/transactions/other', icon: LayoutDashboard },
    { key: 'source', label: 'Source Data', href: '/transactions/other/source-data', icon: Database },
    { key: 'transaction', label: 'Other Transaction', href: '/transactions/other/transaction', icon: FileText },
    { key: 'preview', label: 'Journal Preview', href: '/transactions/other/preview', icon: Eye },
    { key: 'exceptions', label: 'Exceptions', href: '/transactions/other/exceptions', icon: AlertTriangle, badge: exceptionCount > 0 ? exceptionCount : undefined },
    { key: 'posted', label: 'Posted', href: '/transactions/other/posted', icon: CheckCircle2 },
  ];

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Other</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{descriptions[activeTab]}</p>
      <TabNav items={tabs} activeKey={activeTab} className="mt-4" />
    </div>
  );
}
