'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Scale, TrendingUp, RefreshCcw, Activity, NotebookText, SlidersHorizontal, BookOpen } from 'lucide-react';

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
          <Link href="/financial-statements" className="text-sm text-muted-foreground hover:text-blue-700">Financial Statements</Link>
          <h1 className="text-3xl font-bold text-foreground tracking-tight mt-1">{title}</h1>
          {subtitle && <div className="text-sm text-muted-foreground mt-1.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <nav className="flex items-center gap-1 overflow-x-auto scrollbar-thin pb-1 -mx-1 px-1 border-b border-border">
        {FS_TABS.map(t => {
          const active = pathname === t.href;
          const Icon = t.icon;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
                active ? 'border-blue-600 text-blue-800 font-semibold' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon size={16} /> {t.label}
            </Link>
          );
        })}
        <Link
          href="/reports/general-ledger"
          className="ml-auto flex items-center gap-2 px-3.5 py-2.5 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground"
        >
          <BookOpen size={16} /> General Ledger
        </Link>
      </nav>

      {children}
    </div>
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
