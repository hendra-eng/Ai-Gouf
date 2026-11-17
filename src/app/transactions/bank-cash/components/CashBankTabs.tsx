'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import CashBankTransactionModal from './CashBankTransactionModal';
import { LayoutDashboard, ArrowUpRight, ArrowDownLeft, Database, Scale, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
}

// Tab Cash & Bank + tombol "Transaksi Baru" (input manual kas/bank tanpa
// rekening koran, lihat CashBankTransactionModal.tsx).
const tabs: Tab[] = [
  {
    id: 'tab-overview',
    icon: LayoutDashboard,
    label: 'Overview',
    href: '/transactions/bank-cash/overview',
    description: 'Cash flow summary, balance per account & reconciliation status',
  },
  {
    id: 'tab-bank-feed',
    icon: Database,
    label: 'Source Data',
    href: '/transactions/bank-cash/source-data',
    description: 'Import bank statements (saved permanently) to match against the books',
  },
  {
    id: 'tab-cash-payment',
    icon: ArrowUpRight,
    label: 'Cash Payment',
    href: '/transactions/bank-cash/cash-payment',
    description: 'Posted Purchase bills & their payment status',
  },
  {
    id: 'tab-cash-receipt',
    icon: ArrowDownLeft,
    label: 'Cash Receipt',
    href: '/transactions/bank-cash/cash-receipt',
    description: 'Posted Sales invoices & their receipt status',
  },
  {
    id: 'tab-reconciliation',
    icon: Scale,
    label: 'Reconciliation',
    href: '/transactions/bank-cash/reconciliation',
    description: 'Match Source Data lines to Sales/Purchase invoices or other accounts — including matched history',
  },
  {
    id: 'tab-journal-preview',
    icon: Eye,
    label: 'Journal Preview',
    href: '/transactions/bank-cash/journal-preview',
    description: 'Review cash & bank journals, then Approve and Post them to the ledger',
  },
  {
    id: 'tab-exceptions',
    icon: AlertTriangle,
    label: 'Exceptions',
    href: '/transactions/bank-cash/exceptions',
    description: 'Manage and follow up cash & bank items that need review',
  },
  {
    id: 'tab-posted',
    icon: CheckCircle2,
    label: 'Posted',
    href: '/transactions/bank-cash/posted',
    description: 'Cash & bank transactions posted to the ledger (and their reversals)',
  },
];

// Gaya tab disamakan dengan halaman Sales -- tema elegant monokrom (garis bawah hitam,
// ikon garis tipis, tombol aksi hitam).
const tabBarCls = 'flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;

export default function CashBankTabs() {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];
  const [formBaru, setFormBaru] = useState(false);

  return (
    <div className="mb-4">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Cash & Bank</h1>
        <p className="mt-1 text-sm font-medium text-neutral-500">{activeTab.description}</p>
      </div>
      <CashBankTransactionModal open={formBaru} onClose={() => setFormBaru(false)} />

      <div className={tabBarCls}>
        <nav className={tabListCls}>
          {tabs.map((tab) => {
            const active = tab.id === activeTab.id;
            return (
              <Link key={tab.id} href={tab.href} className={tabCls(active)} aria-current={active ? 'page' : undefined}>
                <tab.icon size={16} strokeWidth={active ? 2 : 1.5} /> {tab.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center justify-end pb-2 lg:pb-0">
          <button
            onClick={() => setFormBaru(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-neutral-700"
          >
            <Plus size={13} /> New Transaction
          </button>
        </div>
      </div>
    </div>
  );
}