'use client';

import React, { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Download, ChevronLeft, ChevronRight, MoreHorizontal, ChevronDown,
  X, Eye, Printer, Copy, FileSpreadsheet, BookOpen,
} from 'lucide-react';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import {
  useSalesInvoices, useSalesActivityLogs, formatTanggalSingkat, formatTanggalWaktu,
  type BackendSalesInvoice,
} from '@/lib/salesStore';

const formatIDR = (n: number) => 'Rp ' + n.toLocaleString('id-ID');

type PayStatus = 'Paid' | 'Partial' | 'Unpaid';

function payStatusDari(inv: BackendSalesInvoice): PayStatus {
  if (inv.outstanding_amount <= 0) return 'Paid';
  if (inv.paid_amount > 0) return 'Partial';
  return 'Unpaid';
}

const PAY_STATUS_STYLE: Record<PayStatus, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Partial: 'bg-amber-100 text-amber-700',
  Unpaid: 'bg-red-100 text-red-700',
};

const RECONCILE_STYLE: Record<string, string> = {
  Reconciled: 'bg-emerald-100 text-emerald-700',
  Unreconciled: 'bg-gray-100 text-gray-600',
};

function downloadCSV(rows: (BackendSalesInvoice & { payStatus: PayStatus })[], filename: string) {
  const headers = ['Tanggal Posting', 'Invoice', 'Pelanggan', 'DPP', 'PPN', 'Nilai Gross', 'No. Jurnal', 'AR', 'Status Pembayaran', 'Rekonsiliasi', 'Diposting Oleh', 'Status'];
  const lines = rows.map(r => [
    r.posted_at || '', r.invoice_no, r.customer_name, r.dpp, r.ppn, r.gross_amount,
    r.journal_entry_id ?? '', r.outstanding_amount, r.payStatus, r.reconcile_status, r.posted_by || '', r.posting_status,
  ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...lines].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
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
  const { user } = useAuth();
  const clientId = user?.id ?? null;

  const { invoices: allInvoices, loading, error, refresh } = useSalesInvoices(clientId);
  const { logs: activityLogs } = useSalesActivityLogs(clientId);

  const postedInvoices = useMemo(
    () => allInvoices
      .filter(i => i.posting_status === 'Posted' || i.posting_status === 'Partial' || i.posting_status === 'Paid')
      .map(i => ({ ...i, payStatus: payStatusDari(i) })),
    [allInvoices],
  );

  // Filters
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('all');
  const [payStatusFilter, setPayStatusFilter] = useState('all');
  const [journalStatusFilter, setJournalStatusFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Selection / detail
  const [selectedInvoiceNo, setSelectedInvoiceNo] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 5;

  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const CUSTOMERS = useMemo(() => Array.from(new Set(postedInvoices.map(r => r.customer_name))), [postedInvoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return postedInvoices.filter(r => {
      if (q && !(r.invoice_no.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q) || String(r.journal_entry_id ?? '').includes(q))) return false;
      if (customerFilter !== 'all' && r.customer_name !== customerFilter) return false;
      if (payStatusFilter !== 'all' && r.payStatus !== payStatusFilter) return false;
      if (journalStatusFilter !== 'all' && r.journal_sync_status !== journalStatusFilter) return false;
      const d = r.posted_at ? new Date(r.posted_at) : (r.invoice_date ? new Date(r.invoice_date) : null);
      if (start && d && d < start) return false;
      if (end && d && d > end) return false;
      return true;
    });
  }, [postedInvoices, search, customerFilter, payStatusFilter, journalStatusFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);
  const selected = postedInvoices.find(r => r.invoice_no === selectedInvoiceNo) || null;

  const totalPostedValue = postedInvoices.reduce((s, r) => s + r.gross_amount, 0);
  const postedToday = postedInvoices.filter(r => r.posted_at && new Date(r.posted_at).toDateString() === new Date().toDateString()).length;
  const journalSynced = postedInvoices.filter(r => r.journal_sync_status === 'Synced').length;
  const fullyPaid = postedInvoices.filter(r => r.payStatus === 'Paid').length;
  const outstandingAR = postedInvoices.filter(r => r.payStatus !== 'Paid').reduce((s, r) => s + r.outstanding_amount, 0);
  const outstandingCount = postedInvoices.filter(r => r.payStatus !== 'Paid').length;

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setCustomerFilter('all'); setPayStatusFilter('all'); setJournalStatusFilter('all');
    setDateStart(''); setDateEnd('');
    setCurrentPage(1); setShowDatePicker(false);
  };

  const toggleRow = (invoiceNo: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      next.has(invoiceNo) ? next.delete(invoiceNo) : next.add(invoiceNo);
      return next;
    });
  };

  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.invoice_no));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(r => next.delete(r.invoice_no));
      else paginated.forEach(r => next.add(r.invoice_no));
      return next;
    });
  };

  const openDetail = (row: { invoice_no: string }) => {
    setSelectedInvoiceNo(row.invoice_no);
    setOpenMenuId(null);
  };

  const copyJournal = (journal: string) => {
    navigator.clipboard?.writeText(journal);
    toast.success(t('No. jurnal disalin'), { description: journal });
    setOpenMenuId(null);
  };

  const openGeneralLedger = (row?: { journal_entry_id: number | null }) => {
    toast.info(t('Buka di General Ledger belum tersedia'), {
      description: row?.journal_entry_id ? `JE-${row.journal_entry_id} — ${t('halaman General Ledger belum terhubung.')}` : t('Halaman General Ledger belum terhubung.'),
    });
    setOpenMenuId(null);
  };

  const downloadProof = () => {
    toast.info(t('Bukti/PDF belum tersedia'), {
      description: t('Belum ada file bukti yang tertaut ke invoice ini.'),
    });
    setOpenMenuId(null);
  };

  const exportCSV = (rows: typeof postedInvoices, label: string) => {
    if (rows.length === 0) {
      toast.error(t('Tidak ada data untuk diexport'));
      return;
    }
    downloadCSV(rows, `sales-posted-${new Date().toISOString().slice(0, 10)}.csv`);
    toast.success(t('Export berhasil'), { description: `${label}: ${rows.length} ${t('baris')}` });
    setShowExportMenu(false);
  };

  const exportSelected = () => {
    const rows = postedInvoices.filter(r => selectedRows.has(r.invoice_no));
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

  const recentActivity = showAllActivity ? activityLogs : activityLogs.slice(0, 5);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {[
          { label: 'Total Posted', value: String(postedInvoices.length) },
          { label: 'Nilai Terposting', value: formatIDR(totalPostedValue) },
          { label: 'Posted Hari Ini', value: String(postedToday) },
          { label: 'Journal Synced', value: String(journalSynced) },
          { label: 'Fully Paid', value: String(fullyPaid), sub: postedInvoices.length > 0 ? `${((fullyPaid / postedInvoices.length) * 100).toFixed(1)}% ${t('dari total transaksi')}` : undefined },
          { label: 'Outstanding AR', value: formatIDR(outstandingAR), sub: `${outstandingCount} ${t('transaksi')}` },
        ].map(k => (
          <div key={k.label} className="card p-4">
            <p className="text-xs text-muted-foreground">{t(k.label)}</p>
            <p className="text-lg font-bold text-foreground mt-1">{k.value}</p>
            {k.sub && <p className="text-[11px] text-muted-foreground mt-0.5">{k.sub}</p>}
          </div>
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
                {dateStart ? new Date(dateStart).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : t('Semua')}
                {dateEnd ? ` – ${new Date(dateEnd).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}
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
                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={14} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {paginated.map(row => (
                  <tr key={row.id} className="border-b border-border/50 hover:bg-muted/30 transition-colors text-xs cursor-pointer" onClick={() => openDetail(row)}>
                    <td className="py-2.5 px-3" onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" checked={selectedRows.has(row.invoice_no)} onChange={() => toggleRow(row.invoice_no)} className="rounded border-border" />
                    </td>
                    <td className="py-2.5 px-2 text-muted-foreground whitespace-nowrap">{formatTanggalSingkat(row.posted_at)}</td>
                    <td className="py-2.5 px-2 text-primary font-medium whitespace-nowrap">{row.invoice_no}</td>
                    <td className="py-2.5 px-2 font-medium text-foreground whitespace-nowrap">{row.customer_name}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatIDR(row.dpp)}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{formatIDR(row.ppn)}</td>
                    <td className="py-2.5 px-2 text-right font-semibold whitespace-nowrap">{formatIDR(row.gross_amount)}</td>
                    <td className="py-2.5 px-2 text-primary whitespace-nowrap">{row.journal_entry_id ? `JE-${row.journal_entry_id}` : '—'}</td>
                    <td className="py-2.5 px-2 text-right whitespace-nowrap">{row.outstanding_amount > 0 ? formatIDR(row.outstanding_amount) : 'Rp 0'}</td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[row.payStatus]}`}>{t(row.payStatus)}</span>
                    </td>
                    <td className="py-2.5 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[row.reconcile_status] || 'bg-muted text-muted-foreground'}`}>{t(row.reconcile_status)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-foreground whitespace-nowrap">{row.posted_by ? (row.posted_by === clientId ? (user?.nama || user?.username) : t('User lain')) : '—'}</td>
                    <td className="py-2.5 px-2">
                      <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{t(row.posting_status)}</span>
                    </td>
                    <td className="py-2.5 px-2 relative" onClick={ev => ev.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetail(row)} className="text-xs text-primary hover:underline">{t('Lihat')}</button>
                        <button onClick={() => setOpenMenuId(prev => (prev === row.invoice_no ? null : row.invoice_no))} className="p-1 hover:bg-muted rounded">
                          <MoreHorizontal size={12} className="text-muted-foreground" />
                        </button>
                      </div>
                      {openMenuId === row.invoice_no && (
                        <div className="absolute z-20 right-2 top-full mt-1 w-48 card p-1 shadow-card">
                          <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Lihat Detail')}
                          </button>
                          <button onClick={() => copyJournal(row.journal_entry_id ? `JE-${row.journal_entry_id}` : '-')} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Copy size={12} /> {t('Salin No. Jurnal')}
                          </button>
                          <button onClick={() => openGeneralLedger(row)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <BookOpen size={12} /> {t('Lihat di General Ledger')}
                          </button>
                          <button onClick={downloadProof} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-foreground hover:bg-muted rounded-md">
                            <Eye size={12} /> {t('Download Bukti')}
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
              <button onClick={() => setSelectedInvoiceNo(null)} className="p-1 hover:bg-muted rounded"><X size={14} /></button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] px-2 py-0.5 rounded-full font-medium bg-blue-100 text-blue-700">{t(selected.posting_status)}</span>
              <span className="text-xs text-muted-foreground">{selected.invoice_no}</span>
            </div>

            <div className="space-y-1.5 text-xs">
              {[
                ['Tanggal Posting', formatTanggalSingkat(selected.posted_at)],
                ['Pelanggan', selected.customer_name],
                ['DPP', formatIDR(selected.dpp)],
                ['PPN', formatIDR(selected.ppn)],
                ['Nilai Gross', formatIDR(selected.gross_amount)],
                ['No. Jurnal', selected.journal_entry_id ? `JE-${selected.journal_entry_id}` : '—'],
                ['Status Jurnal', selected.journal_sync_status === 'Synced' ? t('Synced') : t('Pending')],
                ['AR Outstanding', selected.outstanding_amount > 0 ? formatIDR(selected.outstanding_amount) : 'Rp 0'],
                ['Status Pembayaran', <span key="p" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[selected.payStatus]}`}>{t(selected.payStatus)}</span>],
                ['Rekonsiliasi', <span key="r" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[selected.reconcile_status] || 'bg-muted text-muted-foreground'}`}>{t(selected.reconcile_status)}</span>],
              ].map(([k, v]) => (
                <div key={String(k)} className="flex justify-between items-center">
                  <span className="text-muted-foreground">{t(k as string)}</span>
                  <span className="font-medium text-foreground text-right">{v}</span>
                </div>
              ))}
            </div>

            <div className="flex gap-2 pt-2 border-t border-border">
              <button onClick={() => copyJournal(selected.journal_entry_id ? `JE-${selected.journal_entry_id}` : '-')} className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-border rounded-lg text-xs hover:bg-muted transition-colors">
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
            {activityLogs.length > 5 && (
              <button onClick={() => setShowAllActivity(v => !v)} className="text-xs text-primary hover:underline">
                {showAllActivity ? t('Sembunyikan') : t('Lihat Semua')}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {recentActivity.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">{t('Belum ada aktivitas posting.')}</p>
            )}
            {recentActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 py-2 border-b border-border/50">
                <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 ${a.performed_by === 'System' ? 'bg-blue-100' : 'bg-emerald-100'}`}>
                  <span className="text-[9px]">{a.performed_by === 'System' ? '🔄' : '📄'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-foreground">{t(a.description)}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-muted-foreground">{formatTanggalWaktu(a.created_at)}</span>
                    {a.reference_no && <span className="text-[11px] text-primary">{a.reference_no}</span>}
                    <span className="text-[11px] text-muted-foreground">{a.performed_by}</span>
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
