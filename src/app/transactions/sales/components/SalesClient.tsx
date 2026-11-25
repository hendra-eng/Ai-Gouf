'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, CalendarDays, ChevronDown, Layers, LayoutDashboard, Plus, ReceiptText, ScanSearch, ShieldAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import SalesOverview from './SalesOverview';
import SalesSourceData from './SalesSourceData';
import SalesTransaction from './SalesTransaction';
import SalesJournalPreview from './SalesJournalPreview';
import SalesExceptions from './SalesExceptions';
import SalesPosted from './SalesPosted';
import { salesFont } from './salesFont';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { useSalesExceptions, uploadSalesSourceFile } from '@/lib/salesStore';

const TABS: { key: string; label: string; icon: React.ElementType }[] = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'source-data', label: 'Source Data', icon: Layers },
  { key: 'sales-transaction', label: 'Sales Transaction', icon: ReceiptText },
  { key: 'journal-preview', label: 'Journal Preview', icon: ScanSearch },
  { key: 'exceptions', label: 'Exceptions', icon: ShieldAlert },
  { key: 'posted', label: 'Posted', icon: BadgeCheck },
];

// Gaya tab halaman Sales -- tema elegant monokrom (garis bawah hitam, ikon garis tipis),
// serasi dengan kartu, tabel, dan tombol di tiap tab. Khusus Sales, tidak mengubah tab modul lain.
const tabBarCls = 'flex flex-col gap-2 border-b border-neutral-300 lg:flex-row lg:items-center lg:justify-between';
const tabListCls = '-mb-px flex gap-1 overflow-x-auto';
const tabCls = (active: boolean) =>
  `group flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm tracking-tight transition-colors ${active ? 'border-neutral-900 font-semibold text-neutral-900' : 'border-transparent font-medium text-neutral-500 hover:border-neutral-300 hover:text-neutral-900'}`;
const tabBadgeCls = 'inline-flex min-w-[18px] items-center justify-center rounded-full bg-blue-600 px-1.5 py-px text-[10px] font-semibold text-white';

export default function SalesClient() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { activeClientId } = useActiveClient();
  const [activeTab, setActiveTab] = useState('overview');
  // Slot di baris tab untuk tombol aksi milik tab Source Data, Journal Preview & Posted (dirender via portal).
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);

  // Deep link ?tab=journal-preview (mis. dari AR > Create Invoice setelah Submit for Approval).
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t && TABS.some(x => x.key === t)) setActiveTab(t);
  }, []);

  // Upload File (dipindah dari tab Source Data ke header, tampil di semua tab Sales). File dikirim
  // sungguhan ke backend lewat uploadSalesSourceFile(); store otomatis refresh
  // (notifySalesChanged), jadi tab Source Data langsung menampilkan hasilnya.
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const handleUploadClick = () => {
    if (!activeClientId) {
      toast.error(t('Select a company in the header before uploading a file.'));
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    if (!user?.id) {
      toast.error(t('Sesi login tidak ditemukan, silakan login ulang.'));
      return;
    }
    if (!activeClientId) {
      toast.error(t('Select a company in the header before uploading a file.'));
      return;
    }
    setIsUploading(true);
    let berhasil = 0;
    let butuhReview = 0;
    try {
      for (const file of files) {
        try {
          const hasil = await uploadSalesSourceFile(file, activeClientId);
          if (hasil.template_matched) {
            berhasil += 1;
            toast.success(t('File berhasil diekstrak'), {
              description: `${file.name}: ${hasil.rows_extracted} ${t('baris ditemukan.')}`,
            });
          } else {
            butuhReview += 1;
            toast.info(t('Belum ada template yang cocok'), {
              description: `${file.name} ${t('ditandai "Butuh Review" -- perlu template baru untuk klien/format ini.')}`,
            });
          }
        } catch (err) {
          toast.error(`${file.name}: ${err instanceof Error ? err.message : t('Gagal mengunggah file')}`);
        }
      }
      if (files.length > 1) {
        toast.message(t('Upload selesai'), {
          description: `${berhasil} ${t('berhasil diekstrak')}, ${butuhReview} ${t('butuh review')}.`,
        });
      }
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Badge di tab "Exceptions" -- jumlah exception yang BELUM selesai
  // (Open/In Review), dari data asli (financial_transaction_sales_
  // exceptions), bukan lagi angka statis "24".
  const { exceptions } = useSalesExceptions(activeClientId ?? null);
  const openExceptionCount = exceptions.filter(e => e.status !== 'Resolved').length;

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      {/* Header */}
      <div className={`${salesFont.className} flex items-start justify-between mb-4`}>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Sales')}</h1>
          <p className="mt-1 text-sm font-medium text-neutral-500">
            {activeTab === 'overview' && t('Ringkasan performa penjualan dan metrik utama.')}
            {activeTab === 'source-data' && t('Kelola dan proses data sumber penjualan sebelum dilakukan penjurnalan.')}
            {activeTab === 'sales-transaction' && t('Workspace transaksi penjualan yang detail dan terintegrasi dengan jurnal akuntansi.')}
            {activeTab === 'journal-preview' && t('Tinjau jurnal otomatis, setujui klasifikasi akun, lalu posting ke buku besar.')}
            {activeTab === 'exceptions' && t('Kelola dan tindak lanjuti transaksi penjualan yang memerlukan review.')}
            {activeTab === 'posted' && t('Daftar transaksi penjualan yang telah diposting ke dalam sistem akuntansi.')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-2 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
            <CalendarDays size={14} className="text-neutral-500" />
            <span className="font-medium text-neutral-900">{`01 Jan ${new Date().getFullYear()} – 31 Dec ${new Date().getFullYear()}`}</span>
            <ChevronDown size={14} className="text-neutral-500" />
          </button>
          <input ref={fileInputRef} type="file" multiple accept=".xlsx,.xls,.csv,.pdf,.txt" className="hidden" onChange={handleFilesSelected} />
          <button
            onClick={handleUploadClick}
            disabled={isUploading || !activeClientId}
            className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={14} /> {isUploading ? t('Mengunggah...') : t('Upload File')}
          </button>
          <Link
            href="/transactions/sales/invoice/new"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700"
          >
            <Plus size={14} /> {t('Add Sales Invoice')}
          </Link>
        </div>
      </div>

      {/* Tabs — gaya underline bersama (tabCls, acuan Transactions > Other). */}
      <div className={tabBarCls}>
        <nav className={`${salesFont.className} ${tabListCls}`}>
          {TABS?.map(tab => (
            <button
              key={tab?.key}
              onClick={() => setActiveTab(tab?.key)}
              className={tabCls(activeTab === tab?.key)}
            >
              <tab.icon size={16} strokeWidth={activeTab === tab?.key ? 2 : 1.5} /> {t(tab?.label)}
              {tab?.key === 'exceptions' && openExceptionCount > 0 && (
                <span className={tabBadgeCls}>{openExceptionCount}</span>
              )}
            </button>
          ))}
        </nav>
        {(activeTab === 'source-data' || activeTab === 'posted' || activeTab === 'journal-preview') && <div ref={setActionSlot} className="flex items-center" />}
      </div>

      {/* Tab Content */}
      <div className="pt-5">
        {activeTab === 'overview' && <SalesOverview />}
        {activeTab === 'source-data' && <SalesSourceData actionSlot={actionSlot} />}
        {activeTab === 'sales-transaction' && <SalesTransaction />}
        {activeTab === 'journal-preview' && <SalesJournalPreview actionSlot={actionSlot} />}
        {activeTab === 'exceptions' && <SalesExceptions />}
        {activeTab === 'posted' && <SalesPosted actionSlot={actionSlot} />}
      </div>
    </div>
  );
}