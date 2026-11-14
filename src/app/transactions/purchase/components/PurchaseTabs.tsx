'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CalendarDays, ChevronDown, CircleCheck, Database, Eye, FileText, LayoutGrid } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions } from '@/lib/purchaseStore';
import { tabBadgeCls, tabCls, tabListCls } from '@/components/shared/moduleUi';
import { formatRangeLabel, usePurchaseDateRange } from '@/app/transactions/purchase/purchaseDateRange';

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
export default function PurchaseTabs({ actions, dateRangeActive = false }: { actions?: React.ReactNode; dateRangeActive?: boolean }) {
  const [range, setRange] = usePurchaseDateRange();
  const [pickerOpen, setPickerOpen] = useState(false);
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
          <div className="relative flex items-center gap-2">
            <button
              type="button"
              disabled={!dateRangeActive}
              onClick={() => setPickerOpen(o => !o)}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors disabled:cursor-default disabled:hover:bg-card"
            >
              <CalendarDays size={14} className="text-muted-foreground" />
              <span className="text-foreground font-medium">{dateRangeActive ? formatRangeLabel(range) : `01 Jan ${year} – 31 Dec ${year}`}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {dateRangeActive && pickerOpen && (
              <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-lg border border-border bg-card p-3 shadow-lg space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">From
                    <input type="date" className="je-input mt-1" value={range.from} max={range.to || undefined}
                      onChange={e => setRange({ ...range, from: e.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground">To
                    <input type="date" className="je-input mt-1" value={range.to} min={range.from || undefined}
                      onChange={e => setRange({ ...range, to: e.target.value })} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: `${year}-01-01`, to: `${year}-12-31` })}>This year</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` })}>Last year</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: '', to: '' })}>All time</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1 ml-auto" onClick={() => setPickerOpen(false)}>Done</button>
                </div>
              </div>
            )}
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
