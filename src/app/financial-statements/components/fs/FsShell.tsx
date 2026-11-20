'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Scale, TrendingUp, RefreshCcw, Activity, NotebookText, SlidersHorizontal, BookOpen, Lock } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { formatDate, useLockStatus } from '@/lib/yearEndClosingStore';
import { salesFont } from '@/app/transactions/sales/components/salesFont';

// Gaya tab disamakan dengan halaman Sales (garis bawah hitam, ikon tipis, Inter).
const tabBarCls = 'flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;

// Kerangka halaman Financial Statements berbasis mapping: judul + navigasi
// antar laporan + slot aksi (download, dsb).

export const FS_TABS = [
  { href: '/financial-statements/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { href: '/financial-statements/balance-sheet', label: 'Balance Sheet', icon: Scale },
  { href: '/financial-statements/cash-flow', label: 'Cash Flow', icon: Activity },
  { href: '/financial-statements/changes-in-equity', label: 'Changes in Equity', icon: RefreshCcw },
  { href: '/financial-statements/notes', label: 'Notes (CALK)', icon: NotebookText },
  { href: '/financial-statements/mapping', label: 'Mapping', icon: SlidersHorizontal },
];

export default function FsShell({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const tabs = [
    ...FS_TABS,
    { href: '/reports/general-ledger', label: 'General Ledger', icon: BookOpen },
  ];
  return (
    // Spasi disamakan dengan halaman Sales: padding luar px-6 py-5 (lg:px-8 xl:px-10),
    // header mb-4, bar tab (py-3), lalu isi dimulai pt-5.
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto">
      <div className={`${salesFont.className} mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between`}>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ClosedBadge />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm font-medium text-neutral-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <div className={tabBarCls}>
        <nav className={`${salesFont.className} ${tabListCls}`}>
          {tabs.map(t => {
            const active = t.href === pathname;
            return (
              <Link key={t.href} href={t.href} className={tabCls(active)} aria-current={active ? 'page' : undefined}>
                <t.icon size={16} strokeWidth={active ? 2 : 1.5} /> {t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className={`${salesFont.className} pt-5 space-y-5`}>{children}</div>
    </div>
  );
}

/** Label tahun buku terakhir yang sudah ditutup (Year-End Closing). */
function ClosedBadge() {
  const { activeClientId } = useActiveClient();
  const status = useLockStatus(activeClientId);
  const last = status?.closed_years[0];
  if (!last) return null;
  return (
    <Link
      href="/year-end-closing"
      title={`Transactions up to ${formatDate(last.period_end)} are locked${last.closed_by_name ? ` · closed by ${last.closed_by_name}` : ''}`}
      className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-300 transition-colors hover:bg-neutral-200"
    >
      <Lock size={11} /> FY {last.fiscal_year} closed · locked through {formatDate(last.period_end)}
    </Link>
  );
}

export function NoClient() {
  return (
    <div className="rounded-[10px] border border-dashed border-neutral-300 bg-white p-12 text-center">
      <p className="text-sm font-semibold text-neutral-900">Select a company first</p>
      <p className="mt-1 text-xs font-medium text-neutral-500">Use the company switcher in the top bar.</p>
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-[10px] bg-neutral-200 animate-pulse" />)}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return <div className="rounded-lg border border-red-200 border-l-[3px] border-l-red-700 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">{message}</div>;
}