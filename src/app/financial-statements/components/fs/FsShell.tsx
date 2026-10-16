'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Scale, TrendingUp, RefreshCcw, Activity, NotebookText, SlidersHorizontal, BookOpen, Lock } from 'lucide-react';
import { useActiveClient } from '@/lib/activeClient';
import { formatDate, useLockStatus } from '@/lib/yearEndClosingStore';
import { tabCls, tabNavCls } from '@/components/shared/moduleUi';

// Kerangka halaman Financial Statements berbasis mapping: judul + navigasi
// antar laporan + slot aksi (download, dsb).

export const FS_TABS = [
  { href: '/financial-statements/balance-sheet', label: 'Balance Sheet', icon: Scale },
  { href: '/financial-statements/profit-loss', label: 'Profit & Loss', icon: TrendingUp },
  { href: '/financial-statements/changes-in-equity', label: 'Changes in Equity', icon: RefreshCcw },
  { href: '/financial-statements/cash-flow', label: 'Cash Flow', icon: Activity },
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
  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-5 fade-in">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/financial-statements" className="text-sm text-muted-foreground hover:text-blue-700">Financial Statements</Link>
            <ClosedBadge />
          </div>
          <h1 className="text-3xl font-bold text-foreground tracking-tight mt-1">{title}</h1>
          {subtitle && <div className="text-sm text-muted-foreground mt-1.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <nav className={tabNavCls}>
        {FS_TABS.map(t => {
          const active = pathname === t.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={tabCls(active)}
            >
              <Icon size={16} /> {t.label}
            </Link>
          );
        })}
        <Link
          href="/reports/general-ledger"
          className={`ml-auto ${tabCls(false)}`}
        >
          <BookOpen size={16} /> General Ledger
        </Link>
      </nav>

      {children}
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
      className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800 ring-1 ring-inset ring-blue-600/20 hover:bg-blue-100"
    >
      <Lock size={11} /> FY {last.fiscal_year} closed · locked through {formatDate(last.period_end)}
    </Link>
  );
}

export function NoClient() {
  return (
    <div className="bg-card border border-dashed border-border rounded-xl p-12 text-center">
      <p className="text-sm font-semibold text-foreground">Select a company first</p>
      <p className="text-xs text-muted-foreground mt-1">Use the company switcher in the top bar.</p>
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3, 4].map(i => <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />)}
    </div>
  );
}

export function ErrorBlock({ message }: { message: string }) {
  return <div className="border border-rose-200 bg-rose-50 text-rose-700 rounded-xl px-4 py-3 text-sm">{message}</div>;
}
