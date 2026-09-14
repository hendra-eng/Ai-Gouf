'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  id: string;
  label: string;
  href: string;
  badge?: number;
  description: string;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', href: '/transactions/purchase', description: 'Ringkasan performa pembelian dan metrik utama.' },
  { id: 'tab-source', label: 'Source Data', href: '/transactions/purchase/source-data', description: 'Kelola dan proses data sumber pembelian sebelum dilakukan penjurnalan.' },
  { id: 'tab-transaction', label: 'Purchase Transaction', href: '/transactions/purchase/transaction', badge: 2, description: 'Workspace transaksi pembelian yang detail dan terintegrasi dengan jurnal akuntansi.' },
  { id: 'tab-preview', label: 'Purchase Preview', href: '/transactions/purchase/preview', description: 'Pratinjau jurnal transaksi pembelian sebelum diposting.' },
  { id: 'tab-exceptions', label: 'Exceptions', href: '/transactions/purchase/exceptions', badge: 5, description: 'Kelola dan tindak lanjuti transaksi pembelian yang memerlukan review.' },
  { id: 'tab-posted', label: 'Posted', href: '/transactions/purchase/posted', description: 'Daftar transaksi pembelian yang telah diposting ke dalam sistem akuntansi.' },
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

      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto scrollbar-thin mt-4">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 flex items-center gap-1.5 ${
                active ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
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