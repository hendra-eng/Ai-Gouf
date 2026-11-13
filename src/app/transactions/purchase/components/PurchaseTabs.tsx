'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CalendarDays, ChevronDown, CircleCheck, Database, Eye, FileText, LayoutGrid } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions } from '@/lib/purchaseStore';
import { tabBadgeCls, tabCls, tabListCls } from '@/components/shared/moduleUi';

interface Tab {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', icon: LayoutGrid, href: '/transactions/purchase', description: 'Summary of purchasing performance and key metrics.' },
  { id: 'tab-source', label: 'Source Data', icon: Database, href: '/transactions/purchase/source-data', description: 'Manage and process purchase source data before it is journalized.' },
  { id: 'tab-transaction', label: 'Purchase Transaction', icon: FileText, href: '/transactions/purchase/transaction', description: 'Detailed purchase transaction workspace, integrated with the accounting journal.' },
  { id: 'tab-preview', label: 'Journal Preview', icon: Eye, href: '/transactions/purchase/preview', description: 'Preview the journal of each purchase transaction before posting.' },
  { id: 'tab-exceptions', label: 'Exceptions', icon: AlertTriangle, href: '/transactions/purchase/exceptions', description: 'Manage and follow up purchase transactions that need review.' },
  { id: 'tab-posted', label: 'Posted', icon: CircleCheck, href: '/transactions/purchase/posted', description: 'Purchase transactions that have been posted to the accounting system.' },
];

/** `actions` (opsional) = tombol aksi di baris tab sebelah kanan. Bila diisi, header & bar tab
 *  memakai tata letak yang sama dengan halaman Sales (judul + rentang tanggal, tab + aksi satu baris). */
export default function PurchaseTabs({ actions }: { actions?: React.ReactNode }) {
  const pathname = usePathname();
  // Badge Exceptions = jumlah exception yang belum selesai (data asli, seperti tab Sales); disembunyikan bila 0.
  const { activeClientId } = useActiveClient();
  const { exceptions } = usePurchaseExceptions(activeClientId ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved' && e.status !== 'Ignored').length;

  const isActive = (href: string) => {
    if (href === '/transactions/purchase') return pathname === '/transactions/purchase';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  const renderTabs = (compact: boolean) => tabs.map((tab) => {
    const active = isActive(tab.href);
    return (
      <Link
        key={tab.id}
        href={tab.href}
        className={compact ? tabCls(active).replace('px-4', 'px-3.5') : tabCls(active)}
      >
        <tab.icon size={16} /> {tab.label}
        {tab.id === 'tab-exceptions' && openExceptionCount > 0 && (
          <span className={tabBadgeCls}>{openExceptionCount}</span>
        )}
      </Link>
    );
  });

  const year = new Date().getFullYear();
  return (
      <div>
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Purchase</h1>
            <p className="text-xs font-bold text-muted-foreground mt-0.5">{activeTab.description}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors">
              <CalendarDays size={14} className="text-muted-foreground" />
              <span className="text-foreground font-medium">{`01 Jan ${year} – 31 Dec ${year}`}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>
        {/* Satu baris di layar lebar (xl+); di layar sempit tombol naik ke atas tab, tanpa scrollbar. */}
        <div className="flex flex-col gap-2 border-b border-border xl:flex-row xl:items-center xl:justify-between">
          <nav className={`${tabListCls} min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>{renderTabs(true)}</nav>
          {actions && <div className="order-first flex shrink-0 items-center justify-end pt-1 xl:order-none xl:pt-0">{actions}</div>}
        </div>
      </div>
    );
}
