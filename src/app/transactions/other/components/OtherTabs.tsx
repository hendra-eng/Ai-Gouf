'use client';

import React from 'react';
import Link from 'next/link';
import { LayoutDashboard, Database, FileText, Eye, AlertTriangle, CheckCircle2 } from 'lucide-react';

export type OtherTabKey = 'overview' | 'source' | 'transaction' | 'preview' | 'exceptions' | 'posted';

// Gaya tab -- disamakan dengan halaman Sales (tema monokrom: garis bawah hitam, ikon garis tipis).
const tabBarCls = 'flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
const tabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white';

interface OtherTabItem { key: OtherTabKey; label: string; href: string; icon: React.ElementType; badge?: number }

const descriptions: Record<OtherTabKey, string> = {
  overview: 'Ringkasan jurnal lain-lain (di luar Sales, Purchase, dan Bank & Cash) — tambah jurnal, approve, lalu posting ke Buku Besar.',
  source: 'Data sumber transaksi Other (General Journal, CapEx, dan transaksi belum terkategori) sebelum dijurnal.',
  transaction: 'Daftar jurnal Other per nomor jurnal, terintegrasi dengan jurnal akuntansi.',
  preview: 'Pratinjau jurnal Other yang belum diposting — cek keseimbangan debit dan kredit.',
  exceptions: 'Jurnal Other yang perlu ditinjau: tanpa nomor jurnal, tidak balance, draft, atau akun belum dipetakan.',
  posted: 'Daftar jurnal Other yang telah diposting ke sistem akuntansi.',
};

// Header + tab bar halaman Other (pola sama dengan JournalEntryTabs / PurchaseTabs).
// Badge tab Exceptions dihitung dari data asli, bukan angka statis.
export default function OtherTabs({ activeTab, exceptionCount = 0 }: { activeTab: OtherTabKey; exceptionCount?: number }) {
  const tabs: OtherTabItem[] = [
    { key: 'overview', label: 'Overview', href: '/transactions/other', icon: LayoutDashboard },
    { key: 'source', label: 'Source Data', href: '/transactions/other/source-data', icon: Database },
    { key: 'transaction', label: 'Other Transaction', href: '/transactions/other/transaction', icon: FileText },
    { key: 'preview', label: 'Journal Preview', href: '/transactions/other/preview', icon: Eye },
    { key: 'exceptions', label: 'Exceptions', href: '/transactions/other/exceptions', icon: AlertTriangle, badge: exceptionCount > 0 ? exceptionCount : undefined },
    { key: 'posted', label: 'Posted', href: '/transactions/other/posted', icon: CheckCircle2 },
  ];

  return (
    <div className="mb-4">
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Other</h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">{descriptions[activeTab]}</p>
        </div>
      </div>
      <div className={tabBarCls}>
        <nav className={tabListCls}>
          {tabs.map(tab => {
            const active = tab.key === activeTab;
            return (
              <Link key={tab.key} href={tab.href} className={tabCls(active)} aria-current={active ? 'page' : undefined}>
                <tab.icon size={16} strokeWidth={active ? 2 : 1.5} /> {tab.label}
                {tab.badge !== undefined && <span className={tabBadgeCls}>{tab.badge}</span>}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}