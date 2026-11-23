'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarDays, ChevronDown, Layers, LayoutDashboard, Plus, ReceiptText, ScanSearch, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import ImportJournalModal from '@/app/transactions/journal-entry/components/ImportJournalModal';
import NewJournalEntryModal from '@/app/transactions/journal-entry/components/NewJournalEntryModal';
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
  /** Tombol aksi tambahan di kanan judul halaman, tampil sebelum Upload File & Add Transaction. */
  actions?: React.ReactNode;
  /** Tombol aksi di baris yang sama dengan nama tab, rata kanan (gaya Sales > Posted / Source Data). */
  tabActions?: React.ReactNode;
}

export default function JournalEntryTabs({ activeTab, actions, tabActions }: JournalEntryTabsProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeClientId } = useActiveClient();
  // Upload File & Add Transaction -- tampil di header SEMUA tab Journal Entry (posisi sama dgn Sales/Purchase).
  // Upload File = ImportJournalModal, Add Transaction = NewJournalEntryModal (ex "New Journal Entry").
  // Store jurnal memanggil notifyJeChanged() setelah simpan/upload, jadi daftar di tab lain ter-refresh otomatis.
  const [showImport, setShowImport] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const userId = user?.id ?? null;
  const createdByName = user?.nama || user?.username || 'System';

  const handleUploadClick = () => {
    if (!userId || !activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    setShowImport(true);
  };

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
        <div className="flex items-center gap-2">
          {/* Tombol tanggal -- desain sama dengan header Sales (urutan: tanggal, Upload File, Add Transaction). */}
          <button className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
            <CalendarDays size={14} className="text-neutral-500" />
            <span className="font-medium text-neutral-900">{`01 Jan ${new Date().getFullYear()} – 31 Dec ${new Date().getFullYear()}`}</span>
            <ChevronDown size={14} className="text-neutral-500" />
          </button>
          {actions}
          <button
            type="button"
            onClick={handleUploadClick}
            disabled={!userId || !activeClientId}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={14} /> Upload File
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            disabled={!userId}
            className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} /> Add Journal Entry
          </button>
        </div>
      </div>
      {showImport && userId && (
        <ImportJournalModal clientId={userId} createdByName={createdByName} onClose={() => setShowImport(false)} />
      )}
      {showNew && userId && (
        <NewJournalEntryModal clientId={userId} createdByName={createdByName} onClose={() => setShowNew(false)} />
      )}

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