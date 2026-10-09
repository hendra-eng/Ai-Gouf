'use client';

import React from 'react';
import Link from 'next/link';
import TabNav from '@/components/ui/TabNav';
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
    <div className="space-y-5">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3">
        <div>
          <Link href="/financial-statements" className="text-sm text-muted-foreground hover:text-blue-700">Financial Statements</Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {subtitle && <div className="text-sm text-muted-foreground mt-0.5">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>

      <TabNav
        activeKey={FS_TABS.find(t => t.href === pathname)?.href ?? ''}
        items={[
          ...FS_TABS.map(t => ({ key: t.href, label: t.label, href: t.href, icon: t.icon })),
          { key: '/reports/general-ledger', label: 'General Ledger', href: '/reports/general-ledger', icon: BookOpen },
        ]}
      />

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
