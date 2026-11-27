'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, CalendarDays, ChevronDown, CircleCheck, Database, Eye, FileText, LayoutGrid, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions } from '@/lib/purchaseStore';
import { mulaiBatch, useProgresBatch } from '@/lib/uploadBatch';
import { buatHandlerPurchase } from '@/lib/uploadBatchHandlers';
import { tabBadgeCls, tabCls, tabListCls } from '@/components/shared/moduleUi';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { formatRangeLabel, usePurchaseDateRange } from '@/app/transactions/purchase/purchaseDateRange';

interface Tab {
  id: string;
  label: string;
  href: string;
  icon: React.ElementType;
  description: string;
}

const tabs: Tab[] = [
  { id: 'tab-overview', label: 'Overview', icon: LayoutGrid, href: '/transactions/purchase', description: 'Summary of purchasing performance and key metrics.' },
  { id: 'tab-source', label: 'Source Data', icon: Database, href: '/transactions/purchase/source-data', description: 'Manage and process purchase source data before it is journalized.' },
  { id: 'tab-transaction', label: 'Purchase Transaction', icon: FileText, href: '/transactions/purchase/transaction', description: 'Detailed purchase transaction workspace, integrated with the accounting journal.' },
  { id: 'tab-preview', label: 'Journal Preview', icon: Eye, href: '/transactions/purchase/preview', description: 'Preview the journal of each purchase transaction before posting.' },
  { id: 'tab-exceptions', label: 'Exceptions', icon: AlertTriangle, href: '/transactions/purchase/exceptions', description: 'Manage and follow up purchase transactions that need review.' },
  { id: 'tab-posted', label: 'Posted', icon: CircleCheck, href: '/transactions/purchase/posted', description: 'Purchase transactions that have been posted to the accounting system.' },
];

// Varian "elegant" -- tema monokrom yang sama dengan halaman Sales (font Inter, garis bawah hitam,
// tombol & rentang tanggal netral). Dipakai lewat prop variant="elegant"; tab lain tidak berubah.
const elegantTabBarCls = 'flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between';
const elegantTabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
const elegantTabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white';

/** `actions` (opsional) = tombol aksi di baris tab sebelah kanan. Bila diisi, header & bar tab
 *  memakai tata letak yang sama dengan halaman Sales (judul + rentang tanggal, tab + aksi satu baris). */
export default function PurchaseTabs({ actions, dateRangeActive = false, variant = 'default' }: { actions?: React.ReactNode; dateRangeActive?: boolean; variant?: 'default' | 'elegant' }) {
  const elegant = variant === 'elegant';
  const [range, setRange] = usePurchaseDateRange();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Upload File & Add Transaction -- tampil di header SEMUA tab Purchase (posisi sama dgn Sales):
  // [tanggal] [Upload File] [Add Transaction]. Sama seperti Sales: klik tombol langsung membuka
  // dialog pilih file; file dikirim ke backend (dicocokkan ke Purchase Import Template company aktif).
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pathname = usePathname();
  // Badge Exceptions = jumlah exception yang belum selesai (data asli, seperti tab Sales); disembunyikan bila 0.
  const { activeClientId } = useActiveClient();
  // Progres batch (berhasil/total) dibaca dari store global, bukan state lokal -> tidak reset saat pindah tab/halaman.
  const uploadProgres = useProgresBatch('purchase', activeClientId ?? null);
  const isUploading = !!uploadProgres;
  const { exceptions } = usePurchaseExceptions(activeClientId ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved' && e.status !== 'Ignored').length;

  const isActive = (href: string) => {
    if (href === '/transactions/purchase') return pathname === '/transactions/purchase';
    return pathname === href || pathname.startsWith(href + '/');
  };

  const handleUploadClick = () => {
    if (!activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
    if (!activeClientId) {
      toast.error('Select a company in the header before uploading a file.');
      return;
    }
    // Loop upload berjalan di engine global (lib/uploadBatch.ts), bukan di komponen ini -> tetap jalan &
    // angka di tombol tetap benar walau user pindah tab / halaman / refresh.
    mulaiBatch('purchase', activeClientId, files, buatHandlerPurchase(activeClientId));
  };

  const activeTab = tabs.find((tab) => isActive(tab.href)) ?? tabs[0];

  const renderTabs = (compact: boolean) => tabs.map((tab) => {
    const active = isActive(tab.href);
    return (
      <Link
        key={tab.id}
        href={tab.href}
        className={elegant ? elegantTabCls(active) : compact ? tabCls(active).replace('px-4', 'px-3.5') : tabCls(active)}
      >
        <tab.icon size={16} strokeWidth={elegant ? (active ? 2 : 1.5) : undefined} /> {tab.label}
        {tab.id === 'tab-exceptions' && openExceptionCount > 0 && (
          <span className={elegant ? elegantTabBadgeCls : tabBadgeCls}>{openExceptionCount}</span>
        )}
      </Link>
    );
  });

  const year = new Date().getFullYear();
  return (
      <div>
        <div className={`${elegant ? `${salesFont.className} ` : ''}flex items-start justify-between mb-4`}>
          <div>
            {elegant ? (
              <>
                <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">Purchase</h1>
                <p className="mt-1 text-sm font-medium text-neutral-500">{activeTab.description}</p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-foreground">Purchase</h1>
                <p className="text-xs font-bold text-muted-foreground mt-0.5">{activeTab.description}</p>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
            <button
              type="button"
              disabled={!dateRangeActive}
              onClick={() => setPickerOpen(o => !o)}
              className={elegant
                ? 'flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-default disabled:hover:border-neutral-300 disabled:hover:bg-white'
                : 'flex items-center gap-2 px-3 py-2 text-sm border border-border rounded-lg bg-card hover:bg-muted transition-colors disabled:cursor-default disabled:hover:bg-card'}
            >
              <CalendarDays size={14} className={elegant ? 'text-neutral-500' : 'text-muted-foreground'} />
              <span className={`${elegant ? 'text-neutral-900' : 'text-foreground'} font-medium`}>{dateRangeActive ? formatRangeLabel(range) : `01 Jan ${year} – 31 Dec ${year}`}</span>
              <ChevronDown size={14} className={elegant ? 'text-neutral-500' : 'text-muted-foreground'} />
            </button>
            {dateRangeActive && pickerOpen && (
              <div className="absolute right-0 top-full mt-2 z-30 w-72 rounded-lg border border-border bg-card p-3 shadow-lg space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-muted-foreground">From
                    <input type="date" className="je-input mt-1" value={range.from} max={range.to || undefined}
                      onChange={e => setRange({ ...range, from: e.target.value })} />
                  </label>
                  <label className="text-xs text-muted-foreground">To
                    <input type="date" className="je-input mt-1" value={range.to} min={range.from || undefined}
                      onChange={e => setRange({ ...range, to: e.target.value })} />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: `${year}-01-01`, to: `${year}-12-31` })}>This year</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: `${year - 1}-01-01`, to: `${year - 1}-12-31` })}>Last year</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1" onClick={() => setRange({ from: '', to: '' })}>All time</button>
                  <button type="button" className="je-btn-secondary text-xs px-2 py-1 ml-auto" onClick={() => setPickerOpen(false)}>Done</button>
                </div>
              </div>
            )}
            </div>
            <button
              type="button"
              onClick={handleUploadClick}
              disabled={isUploading || !activeClientId}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Upload size={14} /> {isUploading ? (uploadProgres ? `Uploading ${uploadProgres.berhasil}/${uploadProgres.total}...` : 'Uploading...') : 'Upload File'}
            </button>
            <input ref={fileInputRef} type="file" multiple accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFilesSelected} />
            <Link
              href="/transactions/purchase/bill/new"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
            >
              <Plus size={14} /> Add Purchase Bill
            </Link>
          </div>
        </div>
        {/* Satu baris di layar lebar (xl+); di layar sempit tombol naik ke atas tab, tanpa scrollbar. */}
        <div className={elegant ? elegantTabBarCls : 'flex flex-col gap-2 border-b border-border xl:flex-row xl:items-center xl:justify-between'}>
          <nav className={`${elegant ? `${salesFont.className} ` : ''}${tabListCls} min-w-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}>{renderTabs(true)}</nav>
          {actions && <div className="order-first flex shrink-0 items-center justify-end pt-1 xl:order-none xl:pt-0">{actions}</div>}
        </div>
      </div>
    );
}