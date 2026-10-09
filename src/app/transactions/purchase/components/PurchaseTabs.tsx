'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';
import TabNav from '@/components/ui/TabNav';

interface Tab {
  id: string;
  label: string;
  href: string;
  badge?: number;
  description: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', href: '/transactions/purchase', description: 'Summary of purchasing performance and key metrics.', icon: LayoutDashboard },
  { id: 'tab-source', label: 'Source Data', href: '/transactions/purchase/source-data', description: 'Manage and process purchase source data before it is journalized.', icon: Database },
  { id: 'tab-transaction', label: 'Purchase Transaction', href: '/transactions/purchase/transaction', badge: 2, description: 'Detailed purchase transaction workspace, integrated with the accounting journal.', icon: FileText },
  { id: 'tab-preview', label: 'Purchase Preview', href: '/transactions/purchase/preview', description: 'Preview the journal of each purchase transaction before posting.', icon: Eye },
  { id: 'tab-exceptions', label: 'Exceptions', href: '/transactions/purchase/exceptions', badge: 5, description: 'Manage and follow up purchase transactions that need review.', icon: AlertTriangle },
  { id: 'tab-posted', label: 'Posted', href: '/transactions/purchase/posted', description: 'Purchase transactions that have been posted to the accounting system.', icon: CheckCircle2 },
];

export default function PurchaseTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === '/transactions/purchase') return pathname === '/transactions/purchase';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">Purchase</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>

      <TabNav
        className="mt-4"
        activeKey={activeTab.id}
        items={tabs.map(t => ({ key: t.id, label: t.label, href: t.href, icon: t.icon, badge: t.badge }))}
      />
    </div>
  );
}
