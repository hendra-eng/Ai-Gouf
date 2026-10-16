'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, CircleCheck, Database, Eye, FileText, LayoutGrid } from 'lucide-react';
import { tabBadgeCls, tabCls, tabNavCls } from '@/components/shared/moduleUi';

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
  activeTab: 'overview' | 'source' | 'transaction' | 'preview' | 'exceptions' | 'posted';
}

export default function JournalEntryTabs({ activeTab }: JournalEntryTabsProps) {
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

      <nav className={`${tabNavCls} mt-4`}>
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={tabCls(isActive)}
            >
              <tab.icon size={16} /> {tab.label}
              {tab.badge !== undefined && (
                <span className={tabBadgeCls}>{tab.badge}</span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}