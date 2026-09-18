'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import Icon from '@/components/ui/AppIcon';
import dynamic from 'next/dynamic';
import { useLanguage } from '@/lib/language';
import { CURRENCIES, useCurrency, formatMoney } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';
import { COMPANY } from '@/lib/financialData';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, customersFromInvoices, arKpisFromInvoices } from '@/app/transactions/lib/arBridge';
import { billsFromTransactions, vendorsFromBills, apKpisFromBills } from '@/app/transactions/lib/apBridge';
// [BARU] Import file (rekening koran/Excel) langsung dari Financial Overview,
// tanpa perlu pindah ke halaman Transaksi. Pakai modal yang sama persis
// dengan yang dipakai halaman Transaksi & 5 sub halamannya, mode "append"
// supaya data yang sudah ada di seluruh dashboard TIDAK terhapus — hasil
// import hanya ditambahkan (sama seperti pola di TransactionsGroupPanel).
import ImportRekeningKoranModal from '@/app/transactions/components/ImportRekeningKoranModal';
import type { Transaction } from '@/app/transactions/components/transactionData';
// [BARU] KPI grid sekarang REAL: KPIBentoGrid.tsx sudah lengkap ambil data
// dari backend (GET /api/client/{id}/kpi-bento, lihat ambilKpiBento() di
// agent-ai/lib/api.js) untuk client yang lagi aktif (useActiveClient) --
// sebelumnya komponen ini sudah ada & sudah benar, tapi TIDAK PERNAH dipakai
// di halaman manapun; OverviewContent (halaman "/" yang sebenarnya) masih
// pakai 8 kartu KPI hardcoded sendiri (`kpiCards` di bawah, sekarang
// dihapus). KPIBentoGrid otomatis fallback ke data contoh + banner "Showing
// sample data" kalau belum ada client aktif / client belum ada jurnal sama
// sekali -- jadi halaman tidak pernah kosong.
import KPIBentoGrid from './KPIBentoGrid';

const formatDateForFilename = () => new Date().toISOString().slice(0, 10);

function toCsvValue(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// [BARU] Export tombol "Export" di header Financial Overview sekarang
// benar-benar mengunduh file, bukan cuma toast — mengikuti pola
// exportGroupToCsv() di TransactionsGroupPanel.tsx (project ini belum
// pakai library xlsx apa pun, jadi format CSV dipilih: bisa langsung dibuka
// di Excel/Google Sheets tanpa dependency tambahan). Isinya seluruh
// transaksi yang sedang jadi sumber data dashboard ini (sama seperti yang
// dipakai KPIBentoGrid/OverviewCharts/AR/AP di atas), bukan cuma yang
// tampil di layar (dashboard ini tidak punya tabel baris-per-baris sendiri).
function exportOverviewToCsv(transactions: Transaction[], companyName: string) {
  const header = ['Tanggal', 'TX ID', 'No. Jurnal', 'No. Voucher', 'Kode Akun', 'Nama Akun', 'Deskripsi', 'Pihak', 'Kategori', 'Debit', 'Kredit', 'Status'];
  const rows = transactions.map((t) => [
    t.date, t.txId, t.jeId, t.voucherNo, t.accountCode, t.accountName, t.description, t.party, t.category, t.debit, t.credit, t.status,
  ]);
  const csv = [header, ...rows].map((r) => r.map(toCsvValue).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Financial-Overview-${companyName.replace(/[^a-z0-9]+/gi, '-')}-${formatDateForFilename()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const OverviewCharts = dynamic(() => import('./OverviewCharts'), { ssr: false });

export default function OverviewContent() {
  const [viewMode, setViewMode] = useState<'Actual' | 'Budget' | 'Previous Year'>('Actual');
  const [branch, setBranch] = useState('All Branches');
  const { t } = useLanguage();
  const { currency, setCurrency, fx } = useCurrency();
  const { activeClientName } = useActiveClient();
  const companyName = activeClientName || COMPANY.name;

  // [BARU] Kartu "Accounts Receivable"/"Accounts Payable" di bawah SEBELUMNYA
  // teks hardcoded ("Rp 1.24M", "Rp 320M overdue", dst) -- sekarang dihitung
  // dari transaksi client aktif (TransactionsContext, SAMA PERSIS dgn sumber
  // AR Aging Donut di OverviewCharts.tsx & halaman AR/AP), jadi ikut
  // ter-update otomatis begitu Agent AI selesai upload (TransactionsContext
  // sudah dengarkan listenClientDataChanged).
  const { transactions, isSampleData: txIsSample, addTransactions, refetch: refetchTransactions, loading: transactionsLoading } = useTransactions();
  // [BARU] State modal import di Financial Overview. Toast konfirmasi sudah
  // ditampilkan oleh ImportRekeningKoranModal sendiri (lihat handleConfirm
  // di dalamnya) -- tidak perlu toast tambahan di sini, sama seperti pola
  // handleImported() di TransactionsContent.tsx & TransactionsGroupPanel.tsx.
  const [showImportModal, setShowImportModal] = useState(false);
  const handleImported = (newTx: Transaction[]) => {
    addTransactions(newTx);
    setShowImportModal(false);
  };

  // [BARU] Tombol reload (ikon ArrowPathIcon) sekarang benar-benar memuat
  // ulang data, bukan cuma toast kosong:
  // 1. refetchTransactions() -> tarik ulang transaksi dari backend (lihat
  //    refetch di TransactionsContext, sumber AR/AP card & OverviewCharts).
  // 2. refreshKey berubah -> KPIBentoGrid & OverviewCharts di-remount lewat
  //    prop `key` di bawah, supaya useEffect fetch internal mereka
  //    (ambilKpiBento, fetchMonthlyPLForYear) ikut jalan ulang -- kedua
  //    komponen itu sebelumnya hanya fetch saat activeClientId/branch
  //    berubah, tidak ada cara lain memicu refetch dari luar.
  const [refreshKey, setRefreshKey] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  // Set sekali di client saat mount (bukan saat render server) supaya tidak
  // ada mismatch hydration antara waktu server & waktu browser.
  useEffect(() => { setLastUpdated(new Date()); }, []);
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (isRefreshing && wasLoadingRef.current && !transactionsLoading) {
      setIsRefreshing(false);
      setLastUpdated(new Date());
      toast.success(t('Data dashboard diperbarui'));
    }
    wasLoadingRef.current = transactionsLoading;
  }, [transactionsLoading, isRefreshing, t]);
  const handleRefresh = () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    toast.info(t('Memperbarui data dashboard...'));
    refetchTransactions();
    setRefreshKey((k) => k + 1);
  };
  const formatLastUpdated = (d: Date) =>
    `${d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB`;

  const invoices = useMemo(() => invoicesFromTransactions(transactions), [transactions]);
  const arKpis = useMemo(() => arKpisFromInvoices(invoices, customersFromInvoices(invoices)), [invoices]);
  const bills = useMemo(() => billsFromTransactions(transactions), [transactions]);
  const apKpis = useMemo(() => apKpisFromBills(bills, vendorsFromBills(bills)), [bills]);
  const punyaDataAR = !txIsSample && invoices.length > 0;
  const punyaDataAP = !txIsSample && bills.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">{t('Financial Overview')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{t('Comprehensive financial performance and business health')} — {companyName}</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-600 text-primary">Jan 2026 – Aug 2026</span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-500">YTD</span>
            <span className="text-xs text-muted-foreground">{t('Last updated')}: {lastUpdated ? formatLastUpdated(lastUpdated) : '—'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <select
            value={branch}
            onChange={e => setBranch(e.target.value)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            <option>{t('All Branches')}</option>
            <option>Jakarta</option>
            <option>Surabaya</option>
          </select>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value as typeof currency)}
            className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {(['Actual', 'Budget', 'Previous Year'] as const).map((m) => (
            <button
              key={`view-${m}`}
              onClick={() => setViewMode(m)}
              className={`text-sm px-3 py-1.5 rounded-md font-500 transition-colors ${
                viewMode === m ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'
              }`}
            >
              {t(m)}
            </button>
          ))}
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="ArrowUpTrayIcon" size={14} />
            {t('Import')}
          </button>
          <button
            onClick={() => {
              if (transactions.length === 0) {
                toast.error(t('Tidak ada data untuk diekspor'));
                return;
              }
              exportOverviewToCsv(transactions, companyName);
              toast.success(t('Export dimulai'), { description: `${transactions.length} transaksi diunduh sebagai CSV` });
            }}
            className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors"
          >
            <Icon name="ArrowDownTrayIcon" size={14} />
            {t('Export')}
          </button>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title={t('Muat ulang data dashboard')}
            className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <Icon name="ArrowPathIcon" size={16} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* KPI Grid — sekarang REAL, ambil dari backend untuk client aktif (lihat import KPIBentoGrid di atas) */}
      {/* [BARU] branch diteruskan supaya dropdown "All Branches"/"Jakarta"/"Surabaya" di atas benar2 memfilter 8 kartu ini (lihat Coa.cabang di backend/db_client.py) */}
      {/* [BARU] key={refreshKey} -> remount paksa saat tombol reload ditekan, supaya useEffect fetch (ambilKpiBento) di dalamnya jalan ulang. */}
      <KPIBentoGrid key={`kpi-${refreshKey}`} viewMode={viewMode} branch={branch} />

      {/* Charts */}
      {/* [BARU] key={refreshKey} -> sama seperti KPIBentoGrid di atas, supaya fetchMonthlyPLForYear di dalam OverviewCharts ikut jalan ulang saat reload. */}
      <OverviewCharts key={`charts-${refreshKey}`} viewMode={viewMode} />

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/accounts-receivable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">{t('Accounts Receivable')}</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          {punyaDataAR ? (
            <>
              <p className="text-2xl font-700 text-foreground tabular-nums">{formatMoney(arKpis.totalAR, currency)}</p>
              <p className="text-xs text-danger mt-0.5">{formatMoney(arKpis.overdueAR, currency)} {t('overdue')} — {t('action required')}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-700 text-foreground tabular-nums">{fx('Rp 0')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('No data yet')}</p>
            </>
          )}
        </Link>
        <Link href="/accounts-payable" className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-foreground">{t('Accounts Payable')}</span>
            <Icon name="ArrowRightIcon" size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          {punyaDataAP ? (
            <>
              <p className="text-2xl font-700 text-foreground tabular-nums">{formatMoney(apKpis.totalAP, currency)}</p>
              <p className="text-xs text-warning mt-0.5">{formatMoney(apKpis.dueThisWeek, currency)} {t('due this week')}</p>
            </>
          ) : (
            <>
              <p className="text-2xl font-700 text-foreground tabular-nums">{fx('Rp 0')}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t('No data yet')}</p>
            </>
          )}
        </Link>
        <Link href="/ai-financial-analyst" className="bg-ai-purple-bg border border-purple-200 rounded-lg p-4 hover:shadow-card-md transition-all group">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-600 text-ai-purple">AI Financial Analyst</span>
            <Icon name="ArrowRightIcon" size={14} className="text-ai-purple group-hover:text-purple-700 transition-colors" />
          </div>
          <p className="text-sm text-ai-purple-foreground">0 analyses ready</p>
          <p className="text-xs text-ai-purple mt-0.5">Ask a financial question →</p>
        </Link>
      </div>

      {showImportModal && (
        <ImportRekeningKoranModal
          mode="append"
          onClose={() => setShowImportModal(false)}
          onImported={handleImported}
        />
      )}
    </div>
  );
}