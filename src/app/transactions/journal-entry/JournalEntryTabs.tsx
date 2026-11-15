'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleCheck, Database, Eye, FileText, LayoutGrid } from 'lucide-react';
import { tabBadgeCls, tabCls, tabListCls, tabNavCls } from '@/components/shared/moduleUi';

interface Tab {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', href: '/transactions/journal-entry', icon: LayoutGrid },
  { id: 'tab-source', label: 'Source Data', href: '/transactions/journal-entry/source-data', icon: Database },
  { id: 'tab-transaction', label: 'JE Transaction', href: '/transactions/journal-entry/transactions', icon: FileText, badge: 14 },
  { id: 'tab-preview', label: 'Journal Preview', href: '/transactions/journal-entry/preview', icon: Eye },
  { id: 'tab-exceptions', label: 'Exceptions', href: '/transactions/journal-entry/exceptions', icon: AlertTriangle, badge: 7 },
  { id: 'tab-posted', label: 'Posted', href: '/transactions/journal-entry/posted', icon: CircleCheck },
];

const descriptions: Record<string, string> = {
  overview: 'Summary of journal activity and key metrics.',
  source: 'Manage and process journal source data before posting.',
  transaction: 'Detailed journal transaction workspace, integrated with the accounting journal.',
  preview: 'Preview journal entries before posting.',
  exceptions: 'Manage and follow up on journal entries that need review.',
  posted: 'List of journal entries that have been posted to the accounting system.',
};

interface JournalEntryTabsProps {
  /** Opsional: tombol aksi di baris tab sebelah kanan (tata letak sama dengan Purchase/Sales). */
  actions?: React.ReactNode;
  activeTab: 'overview' | 'source' | 'transaction' | 'preview' | 'exceptions' | 'posted';
}

export default function JournalEntryTabs({ activeTab, actions }: JournalEntryTabsProps) {
  const activeMap: Record<string, string> = {
    overview: 'tab-overview',
    source: 'tab-source',
    transaction: 'tab-transaction',
    preview: 'tab-preview',
    exceptions: 'tab-exceptions',
    posted: 'tab-posted',
  };
  const activeId = activeMap[activeTab];

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold text-foreground">Journal Entry</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{descriptions[activeTab]}</p>

      {(() => {
        const items = tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={actions ? tabCls(isActive).replace('px-4', 'px-3.5') : tabCls(isActive)}
            >
              <tab.icon size={16} /> {tab.label}
              {tab.badge !== undefined && (
                <span className={tabBadgeCls}>{tab.badge}</span>
              )}
            </Link>
          );
        });
        if (!actions) return <nav className={`${tabNavCls} mt-4`}>{items}</nav>;
        // Satu baris di layar lebar (xl+); di layar sempit tombol naik ke atas tab.
        return (
          <div className="mt-4 flex flex-col gap-2 border-b border-border xl:flex-row xl:items-center xl:justify-between">
            <nav className={`${tabListCls} min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>{items}</nav>
            <div className="order-first flex shrink-0 items-center justify-end pt-1 xl:order-none xl:pt-0">{actions}</div>
          </div>
        );
      })()}
    </div>
  );
}