'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, ChevronDown, Loader2, Plus, Upload } from 'lucide-react';
import { useStatementUpload } from './useStatementUpload';
import CashBankTransactionModal from './CashBankTransactionModal';
import { LayoutDashboard, ArrowUpRight, ArrowDownLeft, Database, Scale, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface Tab {
  id: string;
  label: string;
  href: string;
  description: string;
  icon: React.ComponentType<{ size?: number | string; strokeWidth?: number | string; className?: string }>;
}

// Tab Cash & Bank + header: [tanggal] [Upload File] [Add Cash/Bank Transaction] -- sama dengan
// Sales/Purchase/Journal Entry/Other, tampil di SEMUA tab. Add Cash/Bank Transaction = input manual
// kas/bank tanpa rekening koran (CashBankTransactionModal.tsx); Upload File = import rekening koran
// (useStatementUpload.tsx).
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
    label: 'Payables',
    href: '/transactions/bank-cash/cash-payment',
    description: 'Vendor bills from Purchase (payables) and how much of each has been paid',
  },
  {
    id: 'tab-cash-receipt',
    icon: ArrowDownLeft,
    label: 'Receivables',
    href: '/transactions/bank-cash/cash-receipt',
    description: 'Customer invoices from Sales (receivables) and how much of each has been collected',
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

/** `actions` (opsional) = tombol aksi di baris tab sebelah kanan (mis. Approve All / Post All di Journal Preview). */
export default function CashBankTabs({ actions }: { actions?: React.ReactNode } = {}) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + '/');

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];
  const [formBaru, setFormBaru] = useState(false);
  const { openPicker, importing, progressLabel, canUpload, ui: uploadUi } = useStatementUpload();

  return (
    <div className="mb-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Cash & Bank</h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">{activeTab.description}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tombol tanggal -- desain sama dengan header Sales */}
          <button className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
            <CalendarDays size={14} className="text-neutral-500" />
            <span className="font-medium text-neutral-900">{`01 Jan ${new Date().getFullYear()} – 31 Dec ${new Date().getFullYear()}`}</span>
            <ChevronDown size={14} className="text-neutral-500" />
          </button>
          <button
            type="button"
            onClick={openPicker}
            disabled={importing || !canUpload}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {importing ? (progressLabel ?? 'Reading...') : 'Upload File'}
          </button>
          <button
            type="button"
            onClick={() => setFormBaru(true)}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={14} /> Add Cash/Bank Transaction
          </button>
        </div>
      </div>
      {uploadUi}
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
        {actions && <div className="order-first flex shrink-0 items-center justify-end pt-1 lg:order-none lg:pt-0">{actions}</div>}
      </div>
    </div>
  );
}