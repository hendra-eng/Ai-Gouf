'use client';

import React, { useMemo } from 'react';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav, { type TabNavItem } from '@/components/ui/TabNav';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { useJeDrafts, useJeSourceFiles, mapJeDraftToUi, jeFlagReasons } from '@/lib/journalEntryStore';

// Key tab = nilai prop `activeTab` yang dikirim tiap halaman.
const buildTabs = (badges: { transaction?: number; exceptions?: number }): TabNavItem[] => [
  { key: 'overview', label: 'Overview', href: '/transactions/journal-entry', icon: LayoutDashboard },
  { key: 'source', label: 'Source Data', href: '/transactions/journal-entry/source-data', icon: Database },
  { key: 'transaction', label: 'JE Transaction', href: '/transactions/journal-entry/transactions', icon: FileText, badge: badges.transaction },
  { key: 'preview', label: 'Journal Preview', href: '/transactions/journal-entry/preview', icon: Eye },
  { key: 'exceptions', label: 'Exceptions', href: '/transactions/journal-entry/exceptions', icon: AlertTriangle, badge: badges.exceptions },
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
  const { user } = useAuth();
  const { activeClientId } = useActiveClient();
  const { drafts } = useJeDrafts(user?.id ?? null);
  const { files } = useJeSourceFiles(activeClientId);

  // Badge = jumlah yang butuh tindakan (disembunyikan kalau 0):
  //  - JE Transaction : jurnal yang belum final (draft / pending / approved / exception)
  //  - Exceptions     : jurnal bermasalah + baris source yang gagal validasi
  const tabs = useMemo(() => {
    const entries = drafts.map(mapJeDraftToUi);
    const open = entries.filter(e => ['draft', 'pending', 'approved', 'exception'].includes(e.status)).length;
    const flagged = entries.filter(e => jeFlagReasons(e).length > 0).length;
    const invalidRows = files.reduce((sum, f) => sum + (f.rows_invalid || 0), 0);
    const exceptions = flagged + invalidRows;
    return buildTabs({ transaction: open || undefined, exceptions: exceptions || undefined });
  }, [drafts, files]);

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Journal Entry</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{descriptions[activeTab]}</p>

      <TabNav items={tabs} activeKey={activeTab} className="mt-4" />
    </div>
  );
}