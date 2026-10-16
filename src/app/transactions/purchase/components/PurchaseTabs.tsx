'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2, CalendarDays, ChevronDown } from 'lucide-react';
import TabNav from '@/components/ui/TabNav';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions } from '@/lib/purchaseStore';

interface Tab {
  id: string;
  label: string;
  href: string;
    description: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', href: '/transactions/purchase', description: 'Summary of purchasing performance and key metrics.', icon: LayoutDashboard },
  { id: 'tab-source', label: 'Source Data', href: '/transactions/purchase/source-data', description: 'Manage and process purchase source data before it is journalized.', icon: Database },
  { id: 'tab-transaction', label: 'Purchase Transaction', href: '/transactions/purchase/transaction', description: 'Detailed purchase transaction workspace, integrated with the accounting journal.', icon: FileText },
  { id: 'tab-preview', label: 'Purchase Preview', href: '/transactions/purchase/preview', description: 'Preview the journal of each purchase transaction before posting.', icon: Eye },
  { id: 'tab-exceptions', label: 'Exceptions', href: '/transactions/purchase/exceptions', description: 'Manage and follow up purchase transactions that need review.', icon: AlertTriangle },
  { id: 'tab-posted', label: 'Posted', href: '/transactions/purchase/posted', description: 'Purchase transactions that have been posted to the accounting system.', icon: CheckCircle2 },
];

// showDateRange: tampilkan tombol rentang tanggal di pojok kanan atas header
// (sama seperti header Sales). Default false supaya tab Purchase lain tidak berubah.
export default function PurchaseTabs({ showDateRange = false }: { showDateRange?: boolean }) {
  const pathname = usePathname();

  // Badge tab Exceptions = jumlah exception yang BELUM selesai (bukan Resolved/Ignored), dari data asli
  // (financial_transaction_purchase_exceptions) -- sama seperti badge Exceptions di Sales.
  const { activeClientId } = useActiveClient();
  const { exceptions } = usePurchaseExceptions(activeClientId ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved' && e.status !== 'Ignored').length;

  const isActive = (href: string) => {
    if (href === '/transactions/purchase') return pathname === '/transactions/purchase';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  return (
    <div className="mb-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Purchase</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>
        </div>
        {showDateRange && (
          <button className="flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors">
            <CalendarDays size={14} className="text-muted-foreground" />
            <span className="text-foreground font-medium">01 Jan 2024 – 31 Dec 2024</span>
            <ChevronDown size={14} className="text-muted-foreground" />
          </button>
        )}
      </div>

      <TabNav
        className="mt-4"
        activeKey={activeTab.id}
        items={tabs.map(t => ({ key: t.id, label: t.label, href: t.href, icon: t.icon, badge: t.id === 'tab-exceptions' && openExceptionCount > 0 ? openExceptionCount : undefined }))}
      />
    </div>
  );
}