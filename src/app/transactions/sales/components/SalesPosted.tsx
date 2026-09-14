'use client';

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Download, ChevronLeft, ChevronRight, MoreHorizontal, ChevronDown,
  X, Eye, Printer, Copy, FileSpreadsheet, FileText, BookOpen,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import KpiCard from '@/components/shared/KpiCard';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type PayStatus = 'Paid' | 'Partial' | 'Unpaid';
type ReconcileStatus = 'Reconciled' | 'Unreconciled';
type JournalStatus = 'Synced' | 'Pending';

interface PostedItem {
  postDate: string; // "14 Des 2024"
  postDateISO: string; // "2024-12-14"
  invoice: string;
  customer: string;
  dpp: number;
  ppn: number;
  gross: number;
  journal: string;
  ar: number;
  payStatus: PayStatus;
  reconcile: ReconcileStatus;
  journalStatus: JournalStatus;
  postedBy: string;
  status: 'Posted';
}

const POSTED_TRANSACTIONS: PostedItem[] = [
  { postDate: '14 Des 2024', postDateISO: '2024-12-14', invoice: 'INV-2024-0185', customer: 'PT Maju Bersama', dpp: 563636364, ppn: 61363636, gross: 625000000, journal: 'JE-2024-3187', ar: 0, payStatus: 'Paid', reconcile: 'Reconciled', journalStatus: 'Synced', postedBy: 'Andi Setiawan', status: 'Posted' },
  { postDate: '14 Des 2024', postDateISO: '2024-12-14', invoice: 'INV-2024-0184', customer: 'PT Solusi Digital', dpp: 436363636, ppn: 47636364, gross: 484000000, journal: 'JE-2024-3186', ar: 0, payStatus: 'Paid', reconcile: 'Reconciled', journalStatus: 'Synced', postedBy: 'Siti Rahma', status: 'Posted' },
  { postDate: '14 Des 2024', postDateISO: '2024-12-14', invoice: 'INV-2024-0183', customer: 'PT Nusantara Teknologi', dpp: 315909091, ppn: 34090909, gross: 350000000, journal: 'JE-2024-3185', ar: 122500000, payStatus: 'Partial', reconcile: 'Unreconciled', journalStatus: 'Pending', postedBy: 'Andi Setiawan', status: 'Posted' },
  { postDate: '13 Des 2024', postDateISO: '2024-12-13', invoice: 'INV-2024-0182', customer: 'CV Kreatif Indonesia', dpp: 259000000, ppn: 28409091, gross: 287500000, journal: 'JE-2024-3184', ar: 0, payStatus: 'Paid', reconcile: 'Unreconciled', journalStatus: 'Synced', postedBy: 'Budi Santoso', status: 'Posted' },
  { postDate: '12 Des 2024', postDateISO: '2024-12-12', invoice: 'INV-2024-0181', customer: 'PT Global Solusi', dpp: 204545455, ppn: 22500000, gross: 227045455, journal: 'JE-2024-3183', ar: 45409091, payStatus: 'Partial', reconcile: 'Unreconciled', journalStatus: 'Synced', postedBy: 'Siti Rahma', status: 'Posted' },
  { postDate: '11 Des 2024', postDateISO: '2024-12-11', invoice: 'INV-2024-0180', customer: 'PT Jaya Abadi', dpp: 150000000, ppn: 16500000, gross: 166500000, journal: 'JE-2024-3182', ar: 0, payStatus: 'Paid', reconcile: 'Reconciled', journalStatus: 'Pending', postedBy: 'Andi Setiawan', status: 'Posted' },
  { postDate: '10 Des 2024', postDateISO: '2024-12-10', invoice: 'INV-2024-0179', customer: 'PT Sukses Mandiri', dpp: 122727273, ppn: 13500000, gross: 136227273, journal: 'JE-2024-3181', ar: 136227273, payStatus: 'Unpaid', reconcile: 'Unreconciled', journalStatus: 'Synced', postedBy: 'Rina Putri', status: 'Posted' },
  { postDate: '09 Des 2024', postDateISO: '2024-12-09', invoice: 'INV-2024-0178', customer: 'CV Mitra Usaha', dpp: 100000000, ppn: 11000000, gross: 111000000, journal: 'JE-2024-3180', ar: 0, payStatus: 'Paid', reconcile: 'Reconciled', journalStatus: 'Synced', postedBy: 'Budi Santoso', status: 'Posted' },
  { postDate: '09 Des 2024', postDateISO: '2024-12-09', invoice: 'INV-2024-0177', customer: 'PT Cipta Kreasi', dpp: 86363636, ppn: 9500000, gross: 95863636, journal: 'JE-2024-3179', ar: 0, payStatus: 'Paid', reconcile: 'Reconciled', journalStatus: 'Synced', postedBy: 'Siti Rahma', status: 'Posted' },
  { postDate: '08 Des 2024', postDateISO: '2024-12-08', invoice: 'INV-2024-0176', customer: 'PT Prima Sejahtera', dpp: 68181818, ppn: 7500000, gross: 75681818, journal: 'JE-2024-3178', ar: 75681818, payStatus: 'Unpaid', reconcile: 'Unreconciled', journalStatus: 'Synced', postedBy: 'Andi Setiawan', status: 'Posted' },
];

const CUSTOMERS = Array.from(new Set(POSTED_TRANSACTIONS.map(r => r.customer)));
const PAGE_SIZE = 5;

const PAY_STATUS_STYLE: Record<PayStatus, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Partial: 'bg-amber-100 text-amber-700',
  Unpaid: 'bg-red-100 text-red-700',
};

const RECONCILE_STYLE: Record<ReconcileStatus, string> = {
  Reconciled: 'bg-emerald-100 text-emerald-700',
  Unreconciled: 'bg-gray-100 text-gray-600',
};

const RECENT_ACTIVITY = [
  { time: '14 Nov 2024, 10:24', activity: 'Berhasil memposting faktur penjualan', ref: 'INV-2024-0185', user: 'Andi Setiawan' },
  { time: '14 Nov 2024, 10:23', activity: 'Jurnal berhasil disinkronkan ke General Ledger', ref: 'JE-2024-3187', user: 'System' },
  { time: '14 Nov 2024, 09:17', activity: 'Berhasil memposting faktur penjualan', ref: 'INV-2024-0184', user: 'Siti Rahma' },
  { time: '14 Nov 2024, 09:16', activity: 'Jurnal berhasil disinkronkan ke General Ledger', ref: 'JE-2024-3186', user: 'System' },
  { time: '13 Nov 2024, 16:45', activity: 'Berhasil memposting faktur penjualan', ref: 'INV-2024-0183', user: 'Andi Setiawan' },
];

const RECENT_ACTIVITY_MORE = [
  { time: '13 Nov 2024, 16:44', activity: 'Jurnal berhasil disinkronkan ke General Ledger', ref: 'JE-2024-3185', user: 'System' },
  { time: '12 Nov 2024, 14:02', activity: 'Berhasil memposting faktur penjualan', ref: 'INV-2024-0182', user: 'Budi Santoso' },
  { time: '11 Nov 2024, 11:30', activity: 'Berhasil memposting faktur penjualan', ref: 'INV-2024-0181', user: 'Siti Rahma' },
];

function downloadCSV(rows: PostedItem[], filename: string) {
  const headers = ['Tanggal Posting', 'Invoice', 'Pelanggan', 'DPP', 'PPN', 'Nilai Gross', 'No. Jurnal', 'AR', 'Status Pembayaran', 'Rekonsiliasi', 'Diposting Oleh', 'Status'];
  const lines = rows.map(r => [
    r.postDate, r.invoice, r.customer, r.dpp, r.ppn, r.gross, r.journal, r.ar, r.payStatus, r.reconcile, r.postedBy, r.status,
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function SalesPosted() {
  const { t } = useLanguage();

  // Filters
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [payStatusFilter, setPayStatusFilter] = useState('all');
  const [journalStatusFilter, setJournalStatusFilter] = useState('all');
  const [dateStart, setDateStart] = useState('2024-01-01');
  const [dateEnd, setDateEnd] = useState('2024-12-31');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Selection / detail
  const [selectedInvoice, setSelectedInvoice] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return POSTED_TRANSACTIONS.filter(r => {
      if (q && !(r.invoice.toLowerCase().includes(q) || r.customer.toLowerCase().includes(q) || r.journal.toLowerCase().includes(q))) return false;
      if (customerFilter !== 'all' && r.customer !== customerFilter) return false;
      if (payStatusFilter !== 'all' && r.payStatus !== payStatusFilter) return false;
      if (journalStatusFilter !== 'all' && r.journalStatus !== journalStatusFilter) return false;
      const d = new Date(r.postDateISO);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  }, [search, customerFilter, payStatusFilter, journalStatusFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const selected = POSTED_TRANSACTIONS.find(r => r.invoice === selectedInvoice) || null;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setCustomerFilter('all'); setPayStatusFilter('all'); setJournalStatusFilter('all');
    setDateStart('2024-01-01'); setDateEnd('2024-12-31');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (invoice: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(invoice) ? next.delete(invoice) : next.add(invoice);
      return next;
    });
  };

  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.invoice));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        paginated.forEach(r => next.delete(r.invoice));
      } else {
        paginated.forEach(r => next.add(r.invoice));
      }
      return next;
    });
  };

  const openDetail = (row: PostedItem) => {
    setSelectedInvoice(row.invoice);
    setOpenMenuId(null);
  };

  const copyJournal = (journal: string) => {
    navigator.clipboard?.writeText(journal);
    toast.success(t('No. jurnal disalin'), { description: journal });
    setOpenMenuId(null);
  };

  const openGeneralLedger = (row?: PostedItem) => {
    toast.info(t('Buka di General Ledger belum tersedia'), {
      description: row ? `${row.journal} — ${t('halaman General Ledger belum terhubung.')}` : t('Halaman General Ledger belum terhubung.'),
    });
    setOpenMenuId(null);
  };

  const downloadProof = (row: PostedItem) => {
    toast.info(t('Bukti/PDF belum tersedia'), {
      description: t('Data ini masih data contoh dan belum terhubung ke file sumber asli.'),
    });
    setOpenMenuId(null);
  };

  const exportCSV = (rows: PostedItem[], label: string) => {
    if (rows.length === 0) {
      toast.error(t('Tidak ada data untuk diexport'));
      return;
    }
    downloadCSV(rows, `sales-posted-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(t('Export berhasil'), { description: `${label}: ${rows.length} ${t('baris')}` });
    setShowExportMenu(false);
  };

  const exportSelected = () => {
    const rows = POSTED_TRANSACTIONS.filter(r => selectedRows.has(r.invoice));
    exportCSV(rows, t('Transaksi terpilih'));
  };

  const printList = () => {
    setShowExportMenu(false);
    window.print();
  };

  const openARReconciliation = () => {
    toast.info(t('Rekonsiliasi AR'), {
      description: t('Lihat status rekonsiliasi piutang lengkap di halaman Accounts Receivable.'),
    });
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Total Posted', value: '1.248', change: 12.5, changeLabel: t('vs periode sebelumnya'), icon: 'ChartBarIcon', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
          { label: 'Nilai Terposting', value: 'Rp 2.847.500.000', change: 8.2, changeLabel: t('vs periode sebelumnya'), icon: 'BanknotesIcon', iconColor: 'text-blue-600', iconBg: 'bg-blue-50' },
          { label: 'Posted Hari Ini', value: '24', change: 33.3, changeLabel: t('vs kemarin'), icon: 'CalendarIcon', iconColor: 'text-purple-600', iconBg: 'bg-purple-50' },
          { label: 'Journal Synced', value: '1.248', change: 100, changeLabel: t('sudah tersinkron'), icon: 'ArrowPathIcon', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
          { label: 'Fully Paid', value: '892', subLabel: t('71,5% dari total transaksi'), icon: 'CheckCircleIcon', iconColor: 'text-emerald-600', iconBg: 'bg-emerald-50' },
          { label: 'Outstanding AR', value: 'Rp 620.750.000', subLabel: t('356 transaksi'), icon: 'ClockIcon', iconColor: 'text-amber-600', iconBg: 'bg-amber-50' },
        ].map(k => (
          <KpiCard
            key={k.label}
            title={t(k.label)}
            value={k.value}
            change={k.change}
            changeLabel={k.changeLabel}
            subLabel={k.subLabel}
            icon={k.icon}
            iconColor={k.iconColor}
            iconBg={k.iconBg}
          />
        ))}
      </div>

      {/* Filters */}
      <div className="card p-3 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button
              onClick={() => setShowDatePicker(v => !v)}
              className="flex items-center gap-1.5 text-xs border border-border rounded-lg px-3 py-1.5 bg-card hover:bg-muted transition-colors"
            >
              <span className="text-muted-foreground">📅 {t('Periode Posting')}</span>
              <span className="font-medium text-foreground">
                {new Date(dateStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
                {' – '}
                {new Date(dateEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}
              </span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </button>
            {showDatePicker && (
              <div className="absolute z-20 top-full mt-1 left-0 card p-3 w-64 space-y-2 shadow-card">
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-border rounded-lg px-2 py-1 bg-card text-foreground mt-0.5" />
                </div>
                <button
                  onClick={() => { setCurrentPage(1); setShowDatePicker(false); }}
                  className="w-full text-xs py-1.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90"
                >
                  {t('Terapkan')}
                </button>
              </div>
            )}
          </div>

          <select
            value={customerFilter}
            onChange={ev => { setCustomerFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Semua Pelanggan')}</option>
            {CUSTOMERS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={payStatusFilter}
            onChange={ev => { setPayStatusFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Status Pembayaran')}</option>
            <option value="Paid">{t('Paid')}</option>
            <option value="Partial">{t('Partial')}</option>
            <option value="Unpaid">{t('Unpaid')}</option>
          </select>
          <select
            value={journalStatusFilter}
            onChange={ev => { setJournalStatusFilter(ev.target.value); setCurrentPage(1); }}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground"
          >
            <option value="all">{t('Status Jurnal')}</option>
            <option value="Synced">{t('Synced')}</option>
            <option value="Pending">{t('Pending')}</option>
          </select>
          <input
            type="text"
            value={search}
            onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
            placeholder={t('Cari invoice, pelanggan, atau no jurnal...')}
            className="text-xs border border-border rounded-lg px-3 py-1.5 bg-card text-foreground flex-1 min-w-[200px]"
          />
          <button onClick={resetFilters} className="text-xs text-primary hover:underline">{t('Reset')}</button>

          <div className="relative ml-auto flex items-center gap-1.5" ref={exportMenuRef}>
            <button
              onClick={() => exportCSV(filtered, t('Semua data (sesuai filter)'))}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Download size={12} /> {t('Export')}
            </button>
            <button onClick={() => setShowExportMenu(v => !v)} className="p-1.5 border border-border rounded-lg hover:bg-muted transition-colors">
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
            {showExportMenu && (
              <div className="absolute z-20 top-full mt-1 right-0 card p-1 w-52 shadow-card">
                <button onClick={() => exportCSV(filtered, t('Semua data (sesuai filter)'))} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                  <FileSpreadsheet size={12} /> {t('Export ke CSV/Excel')}
                </button>
                <button onClick={printList} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                  <Printer size={12} /> {t('Cetak Daftar')}
                </button>
                {selectedRows.size > 0 && (
                  <button onClick={exportSelected} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-primary hover:bg-muted rounded-md">
                    <Download size={12} /> {t('Export Terpilih')} ({selectedRows.size})
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4">
        {/* Table */}
        <div className="card overflow-hidden flex-1 min-w-0">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{t('Daftar Transaksi Penjualan (Posted)')}</h3>
            {selectedRows.size > 0 && (
              <button onClick={exportSelected} className="text-xs text-primary hover:underline flex items-center gap-1">
                <Download size={12} /> {t('Export Terpilih')} ({selectedRows.size})
              </button>
            )}
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1200px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="py-2.5 px-3 w-8">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="rounded border-border" />
                  </th>
                  {['Tanggal Posting', 'Invoice', 'Pelanggan', 'DPP (Rp)', 'PPN (Rp)', 'Nilai Gross (Rp)', 'No. Jurnal', 'AR (Rp)', 'Status Pembayaran', 'Rekonsiliasi', 'Diposting Oleh', 'Status', 'Aksi'].map(h => (
                    <th key={h} className="text-left py-2.5 px-2 text-xs font-semibold text-muted-foreground whitespace-nowrap">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.length === 0 && (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {paginated.map(row => (
                  <tr key={row.invoice} className="border-b border-border/50 hover:bg-muted/30 transition-colors text-xs cursor-pointer" onClick={() => openDetail(row)}>
                    <td className="py-2.5 px-3" onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" checked={selectedRows.has(row.invoice)} onChange={() => toggleRow(row.invoice)} className="rounded border-border" />
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{row.postDate}</td>
                    <td className="py-2.5 px-2 text-primary font-medium whitespace-nowrap">{row.invoice}</td>
                    <td className="py-2.5 px-2 font-medium text-foreground whitespace-nowrap">{row.customer}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatIDR(row.dpp)}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatIDR(row.ppn)}</td>
                    <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">{formatIDR(row.gross)}</td>
                    <td className="py-2.5 px-2 text-primary whitespace-nowrap">{row.journal}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{row.ar > 0 ? formatIDR(row.ar) : 'Rp 0'}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[row.payStatus]}`}>{t(row.payStatus)}</span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[row.reconcile]}`}>{t(row.reconcile)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-foreground whitespace-nowrap">{row.postedBy}</td>
                    <td className="py-2.5 px-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{t(row.status)}</span>
                    </td>
                    <td className="py-2.5 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetail(row)} className="text-xs text-primary hover:underline">{t('Lihat')}</button>
                        <button onClick={() => setOpenMenuId(prev => (prev === row.invoice ? null : row.invoice))} className="p-1 hover:bg-muted rounded">
                          <MoreHorizontal size={12} className="text-muted-foreground" />
                        </button>
                      </div>
                      {openMenuId === row.invoice && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-48 card p-1 shadow-card">
                          <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Lihat Detail')}
                          </button>
                          <button onClick={() => copyJournal(row.journal)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Copy size={12} /> {t('Salin No. Jurnal')}
                          </button>
                          <button onClick={() => openGeneralLedger(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <BookOpen size={12} /> {t('Lihat di General Ledger')}
                          </button>
                          <button onClick={() => downloadProof(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <FileText size={12} /> {t('Download Bukti')}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {filtered.length === 0
                ? t('Menampilkan 0 dari 0 transaksi')
                : `${t('Menampilkan')} ${(pageSafe - 1) * PAGE_SIZE + 1} - ${Math.min(pageSafe * PAGE_SIZE, filtered.length)} ${t('dari')} ${filtered.length} ${t('transaksi')}`}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronLeft size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => goToPage(p)}
                  className={`w-6 h-6 rounded text-xs ${p === pageSafe ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
                >
                  {p}
                </button>
              ))}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} className="p-1 hover:bg-muted rounded disabled:opacity-40 disabled:cursor-not-allowed">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Detail Drawer */}
        {selected && (
          <div className="w-80 flex-shrink-0 card p-4 space-y-3 self-start sticky top-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">{t('Detail Transaksi')}</h3>
              <button onClick={() => setSelectedInvoice(null)} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{t(selected.status)}</span>
              <span className="text-xs text-muted-foreground">{selected.invoice}</span>
            </div>

            <div className="space-y-1.5 text-xs">
              {[
                ['Tanggal Posting', selected.postDate],
                ['Pelanggan', selected.customer],
                ['DPP', formatIDR(selected.dpp)],
                ['PPN', formatIDR(selected.ppn)],
                ['Nilai Gross', formatIDR(selected.gross)],
                ['No. Jurnal', selected.journal],
                ['Status Jurnal', selected.journalStatus === 'Synced' ? t('Synced') : t('Pending')],
                ['AR Outstanding', selected.ar > 0 ? formatIDR(selected.ar) : 'Rp 0'],
                ['Status Pembayaran', <span key="p" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[selected.payStatus]}`}>{t(selected.payStatus)}</span>],
                ['Rekonsiliasi', <span key="r" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[selected.reconcile]}`}>{t(selected.reconcile)}</span>],
                ['Diposting Oleh', selected.postedBy],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t(k as string)}</span>
                  <span className="font-medium text-foreground text-right">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => copyJournal(selected.journal)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                <Copy size={12} /> {t('Salin Jurnal')}
              </button>
              <button onClick={() => openGeneralLedger(selected)} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
                <BookOpen size={12} /> {t('General Ledger')}
              </button>
            </div>
            <button onClick={printList} className="w-full py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-colors flex items-center justify-center gap-1.5">
              <Printer size={12} /> {t('Cetak')}
            </button>
          </div>
        )}
      </div>

      {/* Bottom Section */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('Aktivitas Posting Terbaru')}</h3>
            <button onClick={() => setShowAllActivity(v => !v)} className="text-xs text-primary hover:underline">
              {showAllActivity ? t('Sembunyikan') : t('Lihat Semua')}
            </button>
          </div>
          <div className="space-y-2">
            {(showAllActivity ? [...RECENT_ACTIVITY, ...RECENT_ACTIVITY_MORE] : RECENT_ACTIVITY).map((a, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-border/50">
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${a.user === 'System' ? 'bg-blue-100' : 'bg-emerald-100'}`}>
                  <span className="text-[9px]">{a.user === 'System' ? '🔄' : '📄'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">{t(a.activity)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">{a.time}</span>
                    <span className="text-[11px] text-primary">{a.ref}</span>
                    <span className="text-[11px] text-muted-foreground">{a.user === 'System' ? t('System') : a.user}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">{t('Aksi Cepat')}</h3>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: '📋', label: 'Lihat Jurnal', sub: 'Lihat detail jurnal akuntansi', color: 'bg-blue-50 hover:bg-blue-100', onClick: () => toast.info(t('Pilih transaksi'), { description: t("Klik 'Lihat' pada salah satu baris transaksi untuk melihat detail jurnalnya.") }) },
              { icon: '📚', label: 'Buka di General Ledger', sub: 'Lihat posting di buku besar', color: 'bg-emerald-50 hover:bg-emerald-100', onClick: () => openGeneralLedger() },
              { icon: '📄', label: 'Export ke PDF', sub: 'Download daftar transaksi', color: 'bg-red-50 hover:bg-red-100', onClick: printList },
              { icon: '📊', label: 'Export ke Excel', sub: 'Export data ke Excel (XLSX)', color: 'bg-emerald-50 hover:bg-emerald-100', onClick: () => exportCSV(filtered, t('Semua data (sesuai filter)')) },
              { icon: '🔄', label: 'Rekonsiliasi AR', sub: 'Lihat status rekonsiliasi piutang', color: 'bg-purple-50 hover:bg-purple-100', onClick: openARReconciliation },
              { icon: '🖨', label: 'Cetak Daftar', sub: 'Cetak daftar transaksi', color: 'bg-gray-50 hover:bg-gray-100', onClick: printList },
            ].map(a => (
              <button key={a.label} onClick={a.onClick} className={`flex items-center gap-3 p-3 rounded-lg text-left transition-colors ${a.color}`}>
                <span className="text-lg flex-shrink-0">{a.icon}</span>
                <div>
                  <p className="text-xs font-semibold text-foreground">{t(a.label)}</p>
                  <p className="text-[11px] text-muted-foreground">{t(a.sub)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}