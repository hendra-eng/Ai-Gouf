'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import { BadgeCheck, Layers, LayoutDashboard, ReceiptText, ScanSearch, ShieldAlert } from 'lucide-react';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { jeFlagReasons, mapJeDraftToUi, useJeDrafts } from '@/lib/journalEntryStore';

type TabKey = 'overview' | 'source' | 'transaction' | 'preview' | 'exceptions' | 'posted';

interface Tab {
  key: TabKey;
  label: string;
  href: string;
  icon: React.ElementType;
}

// Urutan, label, dan ikon tab disamakan dengan halaman Sales.
const TABS: Tab[] = [
  { key: 'overview', label: 'Overview', href: '/transactions/journal-entry', icon: LayoutDashboard },
  { key: 'source', label: 'Source Data', href: '/transactions/journal-entry/source-data', icon: Layers },
  { key: 'transaction', label: 'JE Transaction', href: '/transactions/journal-entry/transactions', icon: ReceiptText },
  { key: 'preview', label: 'Journal Preview', href: '/transactions/journal-entry/preview', icon: ScanSearch },
  { key: 'exceptions', label: 'Exceptions', href: '/transactions/journal-entry/exceptions', icon: ShieldAlert },
  { key: 'posted', label: 'Posted', href: '/transactions/journal-entry/posted', icon: BadgeCheck },
];

const DESCRIPTIONS: Record<TabKey, string> = {
  overview: 'Ringkasan aktivitas jurnal dan metrik utama.',
  source: 'Kelola dan proses data sumber jurnal sebelum diposting.',
  transaction: 'Workspace transaksi jurnal yang detail dan terintegrasi dengan jurnal akuntansi.',
  preview: 'Tinjau journal entry sebelum diposting ke buku besar.',
  exceptions: 'Kelola dan tindak lanjuti journal entry yang memerlukan review.',
  posted: 'Daftar journal entry yang telah diposting ke dalam sistem akuntansi.',
};

// Gaya tab -- mengikuti SalesClient.tsx (tema monokrom: garis bawah hitam, ikon garis tipis), tanpa garis abu panjang di bawah bar tab.
const tabBarCls = 'flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
const tabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white';

interface JournalEntryTabsProps {
  activeTab: TabKey;
  /** Tombol aksi di kanan judul halaman (posisi sama dengan tombol rentang tanggal di Sales). */
  actions?: React.ReactNode;
  /** Tombol aksi di baris yang sama dengan nama tab, rata kanan (gaya Sales > Posted / Source Data). */
  tabActions?: React.ReactNode;
}

export default function JournalEntryTabs({ activeTab, actions, tabActions }: JournalEntryTabsProps) {
  const { t } = useLanguage();
  const { user } = useAuth();

  // Badge di tab "Exceptions" -- jumlah JE bermasalah dari data asli (aturan sama dengan halaman
  // Exceptions: jeFlagReasons), bukan angka statis. Cache hook dibagi dengan halaman lain, jadi tidak fetch ganda.
  const { drafts } = useJeDrafts(user?.id ?? null);
  const exceptionCount = useMemo(
    () => drafts.map(mapJeDraftToUi).filter(je => jeFlagReasons(je).length > 0).length,
    [drafts],
  );

  return (
    <div>
      {/* Header -- sama dengan halaman Sales */}
      <div className={`${salesFont.className} flex items-start justify-between mb-4`}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Journal Entry')}</h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">{t(DESCRIPTIONS[activeTab])}</p>
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {/* Tabs -- sama dengan halaman Sales */}
      <div className={tabBarCls}>
        <nav className={`${salesFont.className} ${tabListCls}`}>
          {TABS.map(tab => {
            const isActive = tab.key === activeTab;
            return (
              <Link key={tab.key} href={tab.href} className={tabCls(isActive)}>
                <tab.icon size={16} strokeWidth={isActive ? 2 : 1.5} /> {t(tab.label)}
                {tab.key === 'exceptions' && exceptionCount > 0 && (
                  <span className={tabBadgeCls}>{exceptionCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
        {tabActions && (
          <div className={`${salesFont.className} flex items-center justify-end pb-2 lg:pb-0`}>{tabActions}</div>
        )}
      </div>
    </div>
  );
}