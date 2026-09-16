'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
}

const tabs: Tab[] = [
  {
    id: 'tab-cash-payment',
    label: 'Cash Payment',
    href: '/transactions/bank-cash/cash-payment',
    description: 'Pembayaran hutang usaha & pajak — diambil otomatis dari halaman Transaksi',
  },
  {
    id: 'tab-cash-receipt',
    label: 'Cash Receipt',
    href: '/transactions/bank-cash/cash-receipt',
    description: 'Pergerakan kas, bank & pendanaan — diambil otomatis dari halaman Transaksi',
  },
];

export default function CashBankTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  return (
    <div className="mb-4">
      <h1 className="text-2xl font-bold text-foreground">Cash & Bank</h1>
      <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>

      <div className="flex items-center gap-1 bg-muted rounded-xl p-1 border border-border w-fit max-w-full overflow-x-auto scrollbar-thin mt-4">
        {tabs.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={`px-5 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all duration-150 ${
                active ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
