'use client';

import React from 'react';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav, { type TabNavItem } from '@/components/ui/TabNav';

// Key tab = nilai prop `activeTab` yang dikirim tiap halaman.
const tabs: TabNavItem[] = [
  { key: 'overview', label: 'Overview', href: '/transactions/journal-entry', icon: LayoutDashboard },
  { key: 'source', label: 'Source Data', href: '/transactions/journal-entry/source-data', icon: Database },
  { key: 'transaction', label: 'JE Transaction', href: '/transactions/journal-entry/transactions', icon: FileText, badge: 14 },
  { key: 'preview', label: 'Journal Preview', href: '/transactions/journal-entry/preview', icon: Eye },
  { key: 'exceptions', label: 'Exceptions', href: '/transactions/journal-entry/exceptions', icon: AlertTriangle, badge: 7 },
  { key: 'posted', label: 'Posted', href: '/transactions/journal-entry/posted', icon: CheckCircle2 },
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
  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Journal Entry</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{descriptions[activeTab]}</p>

      <TabNav items={tabs} activeKey={activeTab} className="mt-4" />
    </div>
  );
}
