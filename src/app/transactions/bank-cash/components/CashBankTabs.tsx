'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { PlusIcon } from '@heroicons/react/24/outline';
import CashBankTransactionModal from './CashBankTransactionModal';

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
}

// Tab Cash & Bank + tombol "Transaksi Baru" (input manual kas/bank tanpa
// rekening koran, lihat CashBankTransactionModal.tsx).
const tabs: Tab[] = [
  {
    id: 'tab-overview',
    label: 'Overview',
    href: '/transactions/bank-cash/overview',
    description: 'Cash flow summary, balance per account & reconciliation status',
  },
  {
    id: 'tab-cash-payment',
    label: 'Cash Payment',
    href: '/transactions/bank-cash/cash-payment',
    description: 'Posted Purchase bills & their payment status',
  },
  {
    id: 'tab-cash-receipt',
    label: 'Cash Receipt',
    href: '/transactions/bank-cash/cash-receipt',
    description: 'Posted Sales invoices & their receipt status',
  },
  {
    id: 'tab-bank-feed',
    label: 'Bank Feed',
    href: '/transactions/bank-cash/bank-feed',
    description: 'Import bank statements (saved permanently) to match against the books',
  },
  {
    id: 'tab-reconciliation',
    label: 'Reconciliation',
    href: '/transactions/bank-cash/reconciliation',
    description: 'Match Bank Feed lines to Sales/Purchase invoices or other accounts — including matched history',
  },
  {
    id: 'tab-journal-preview',
    label: 'Journal Preview',
    href: '/transactions/bank-cash/journal-preview',
    description: 'Review cash & bank journals, then Approve and Post them to the ledger',
  },
  {
    id: 'tab-exceptions',
    label: 'Exceptions',
    href: '/transactions/bank-cash/exceptions',
    description: 'Manage and follow up cash & bank items that need review',
  },
  {
    id: 'tab-posted',
    label: 'Posted',
    href: '/transactions/bank-cash/posted',
    description: 'Cash & bank transactions posted to the ledger (and their reversals)',
  },
];

export default function CashBankTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];
  const [formBaru, setFormBaru] = useState(false);

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cash & Bank</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{activeTab.description}</p>
        </div>
        <button
          onClick={() => setFormBaru(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
        >
          <PlusIcon className="w-4 h-4" /> New Transaction
        </button>
      </div>
      <CashBankTransactionModal open={formBaru} onClose={() => setFormBaru(false)} />

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