'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CircleCheck, Database, Eye, FileText, LayoutGrid } from 'lucide-react';
import { tabBadgeCls, tabCls, tabNavCls } from '@/components/shared/moduleUi';

interface Tab {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: number;
  description: string;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', icon: LayoutGrid, href: '/transactions/purchase', description: 'Summary of purchasing performance and key metrics.' },
  { id: 'tab-source', label: 'Source Data', icon: Database, href: '/transactions/purchase/source-data', description: 'Manage and process purchase source data before it is journalized.' },
  { id: 'tab-transaction', label: 'Purchase Transaction', icon: FileText, href: '/transactions/purchase/transaction', badge: 2, description: 'Detailed purchase transaction workspace, integrated with the accounting journal.' },
  { id: 'tab-preview', label: 'Purchase Preview', icon: Eye, href: '/transactions/purchase/preview', description: 'Preview the journal of each purchase transaction before posting.' },
  { id: 'tab-exceptions', label: 'Exceptions', icon: AlertTriangle, href: '/transactions/purchase/exceptions', badge: 5, description: 'Manage and follow up purchase transactions that need review.' },
  { id: 'tab-posted', label: 'Posted', icon: CircleCheck, href: '/transactions/purchase/posted', description: 'Purchase transactions that have been posted to the accounting system.' },
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
      <h1 className="text-2xl font-bold text-foreground">Purchase</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>

      <nav className={`${tabNavCls} mt-4`}>
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={tabCls(active)}
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