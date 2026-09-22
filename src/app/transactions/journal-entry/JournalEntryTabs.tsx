'use client';

import React from 'react';
import Link from 'next/link';

interface Tab {
  id: string;
  label: string;
  href: string;
  badge?: number;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', href: '/transactions/journal-entry' },
  { id: 'tab-source', label: 'Source Data', href: '/transactions/journal-entry/source-data' },
  { id: 'tab-transaction', label: 'JE Transaction', href: '/transactions/journal-entry/transactions', badge: 14 },
  { id: 'tab-preview', label: 'Journal Preview', href: '/transactions/journal-entry/preview' },
  { id: 'tab-exceptions', label: 'Exceptions', href: '/transactions/journal-entry/exceptions', badge: 7 },
  { id: 'tab-posted', label: 'Posted', href: '/transactions/journal-entry/posted' },
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

      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto scrollbar-thin mt-4">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 ${
                isActive ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && (
                <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold bg-red-100 text-red-600 rounded-full">
                  {tab.badge}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}