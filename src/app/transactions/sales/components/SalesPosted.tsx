'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Download, ChevronLeft, ChevronRight, MoreHorizontal, ChevronDown,
  X, Eye, Printer, Copy, FileSpreadsheet, BookOpen,
  FileText, CalendarDays, ShieldCheck, CheckCircle, Clock, LayoutGrid, Check, Search,
} from 'lucide-react';
import { salesFont } from './salesFont';
import { useLanguage } from '@/lib/language';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
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

type PillStyle = { pill: string; dot: string };

// Pill bergaris + titik berwarna -- gaya sama dengan StatusPill di tab Sales Transaction & Source Data.
const PAY_STATUS_STYLE: Record<PayStatus, PillStyle> = {
  Paid: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  Partial: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Unpaid: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
};

const RECONCILE_STYLE: Record<string, PillStyle> = {
  Reconciled: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  Unreconciled: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
};

const POSTING_STATUS_STYLE: Record<string, PillStyle> = {
  Posted: { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' },
  Partial: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Paid: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
};
const PILL_FALLBACK: PillStyle = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

function Pill({ style, label }: { style?: PillStyle; label: string }) {
  const st = style || PILL_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

// Gaya tombol netral -- sama dengan tab Sales Transaction & Source Data.
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-neutral-800 bg-neutral-800 text-white hover:bg-neutral-700`;
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

// Dropdown filter kustom -- sama persis dengan FilterSelect di tab Sales
// Transaction: selalu terbuka ke bawah, bisa di-scroll, hover/terpilih abu netral.
interface FilterOption { value: string; label: string }

function FilterSelect({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: FilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = options.find(o => o.value === value) ?? options[0];
  const searchable = options.length > 10;
  const needle = q.trim().toLowerCase();
  const shown = needle ? options.filter(o => o.label.toLowerCase().includes(needle)) : options;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(v => !v); setQ(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-neutral-900 transition-colors ${open ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-neutral-300 bg-white shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-neutral-500">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-neutral-300 hover:text-neutral-900 ${selected ? 'bg-neutral-200 font-semibold text-neutral-900' : 'text-neutral-700'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {selected && <Check size={14} className="shrink-0" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// Kartu KPI Posted -- desain sama dengan SourceKpiTile di Source Data / tab Sales
// Transaction (garis aksen hitam tipis di atas, ikon netral, bar proporsi netral).
function PostedKpiTile({ label, value, sub, pct, pctLabel, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
          <Icon size={16} className="text-neutral-700" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? ''}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Panel putih dengan garis aksen hitam & header abu -- sama dengan SourcePanel di Source Data.
function PostedPanel({ title, leading, action, children, className = '' }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      <div className="flex items-center justify-between gap-3 border-b border-neutral-300 bg-neutral-50 px-4 pb-3 pt-4">
        <div className="flex min-w-0 items-center gap-3">
          {leading}
          <h3 className="truncate text-sm font-semibold text-neutral-900">{title}</h3>
        </div>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

const iconBadge = (node: React.ReactNode) => (
  <span className={PANEL_ICON_CHIP}>{node}</span>
);

// Kolom nominal (header rata kanan), sama dengan isi selnya.
const POSTED_NUMERIC_COLS = ['DPP (Rp)', 'PPN (Rp)', 'Nilai Gross (Rp)', 'AR (Rp)'];

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const items: (number | '…')[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1] > 1) items.push('…');
    items.push(n);
  });
  return items;
}

function downloadCSV(rows: (BackendSalesInvoice & { payStatus: PayStatus })[], filename: string) {
  const headers = ['Posting Date', 'Invoice', 'Customer', 'Branch', 'Tax Base (DPP)', 'VAT', 'Gross Value', 'Journal No.', 'AR', 'Payment Status', 'Reconciliation', 'Posted By', 'Status'];
  const lines = rows.map(r => [
    r.posted_at || '', r.invoice_no, r.customer_name, r.cabang || '', r.dpp, r.ppn, r.gross_amount,
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

// actionSlot: elemen di baris tab (SalesClient) tempat tombol aksi dirender
// lewat portal, sejajar dengan nama tab -- sama seperti Source Data.
// undefined = render di tempat, null = slot belum siap (tunggu), element = portal.
export default function SalesPosted({ actionSlot }: { actionSlot?: HTMLElement | null } = {}) {
  const { t } = useLanguage();
  const { user } = useAuth();
  // userId = akun yang login (management_users) -- untuk kolom "siapa" (posted_by, mapped_by, assigned_to, resolved_by).
  // clientId = company aktif dari Switch Company (management_clients) -- untuk client_id & filter data, sama seperti Purchase.
  const userId = user?.id ?? null;
  const { activeClientId } = useActiveClient();
  const clientId = activeClientId ?? null;

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
  const [branchFilter, setBranchFilter] = useState('all');
  const [payStatusFilter, setPayStatusFilter] = useState('all');
  const [journalStatusFilter, setJournalStatusFilter] = useState('all');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Selection / detail
  const [selectedInvoiceNo, setSelectedInvoiceNo] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [showAllActivity, setShowAllActivity] = useState(false);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const CUSTOMERS = useMemo(() => Array.from(new Set(postedInvoices.map(r => r.customer_name))), [postedInvoices]);
  const BRANCHES = useMemo(() => Array.from(new Set(postedInvoices.map(r => r.cabang).filter((b): b is string => !!b))).sort(), [postedInvoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const start = dateStart ? new Date(dateStart) : null;
    const end = dateEnd ? new Date(dateEnd + 'T23:59:59') : null;
    return postedInvoices.filter(r => {
      if (q && !(r.invoice_no.toLowerCase().includes(q) || r.customer_name.toLowerCase().includes(q) || String(r.journal_entry_id ?? '').includes(q))) return false;
      if (customerFilter !== 'all' && r.customer_name !== customerFilter) return false;
      if (branchFilter !== 'all' && r.cabang !== branchFilter) return false;
      if (payStatusFilter !== 'all' && r.payStatus !== payStatusFilter) return false;
      if (journalStatusFilter !== 'all' && r.journal_sync_status !== journalStatusFilter) return false;
      const d = r.posted_at ? new Date(r.posted_at) : (r.invoice_date ? new Date(r.invoice_date) : null);
      if (start && d && d < start) return false;
      if (end && d && d > end) return false;
      return true;
    });
  }, [postedInvoices, search, customerFilter, branchFilter, payStatusFilter, journalStatusFilter, dateStart, dateEnd]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const selected = postedInvoices.find(r => r.invoice_no === selectedInvoiceNo) || null;

  const totalPostedValue = postedInvoices.reduce((s, r) => s + r.gross_amount, 0);
  const postedToday = postedInvoices.filter(r => r.posted_at && new Date(r.posted_at).toDateString() === new Date().toDateString()).length;
  const journalSynced = postedInvoices.filter(r => r.journal_sync_status === 'Synced').length;
  const fullyPaid = postedInvoices.filter(r => r.payStatus === 'Paid').length;
  const outstandingAR = postedInvoices.filter(r => r.payStatus !== 'Paid').reduce((s, r) => s + r.outstanding_amount, 0);
  const outstandingCount = postedInvoices.filter(r => r.payStatus !== 'Paid').length;

  const totalPosted = postedInvoices.length;
  const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  const goToPage = (p: number) => setCurrentPage(Math.min(Math.max(1, p), totalPages));

  const resetFilters = () => {
    setSearch(''); setCustomerFilter('all'); setBranchFilter('all'); setPayStatusFilter('all'); setJournalStatusFilter('all');
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
  };

  const exportSelected = () => {
    const rows = postedInvoices.filter(r => selectedRows.has(r.invoice_no));
    exportCSV(rows, t('Transaksi terpilih'));
  };

  const printList = () => {
    window.print();
  };

  const openARReconciliation = () => {
    toast.info(t('Rekonsiliasi AR'), {
      description: t('Lihat status rekonsiliasi piutang lengkap di halaman Accounts Receivable.'),
    });
  };

  const recentActivity = showAllActivity ? activityLogs : activityLogs.slice(0, 5);

  // Tombol aksi -- dipindah ke baris yang sama dengan nama tab (via portal ke
  // slot di SalesClient), gaya tombol sama dengan Source Data.
  const actionBar = (
    <div className={`${salesFont.className} flex flex-wrap items-center justify-end gap-2 pb-2 lg:pb-0`}>
      <button onClick={() => exportCSV(filtered, t('Semua data (sesuai filter)'))} className={ACTION_BTN_SECONDARY}>
        <FileSpreadsheet size={13} /> {t('Export')}
      </button>
      <button onClick={printList} className={ACTION_BTN_SECONDARY}>
        <Printer size={13} /> {t('Cetak Daftar')}
      </button>
      {selectedRows.size > 0 && (
        <button onClick={exportSelected} className={ACTION_BTN_PRIMARY}>
          <Download size={13} /> {t('Export Terpilih')} ({selectedRows.size})
        </button>
      )}
    </div>
  );

  const quickActions: { icon: React.ElementType; label: string; sub: string; onClick: () => void }[] = [
    { icon: FileText, label: 'Lihat Jurnal', sub: 'Lihat detail jurnal akuntansi', onClick: () => toast.info(t('Pilih transaksi'), { description: t("Klik 'Lihat' pada salah satu baris transaksi untuk melihat detail jurnalnya.") }) },
    { icon: BookOpen, label: 'Buka di General Ledger', sub: 'Lihat posting di buku besar', onClick: () => openGeneralLedger() },
    { icon: FileSpreadsheet, label: 'Export ke Excel', sub: 'Export data ke Excel (XLSX)', onClick: () => exportCSV(filtered, t('Semua data (sesuai filter)')) },
    { icon: ShieldCheck, label: 'Rekonsiliasi AR', sub: 'Lihat status rekonsiliasi piutang', onClick: openARReconciliation },
    { icon: Printer, label: 'Cetak Daftar', sub: 'Cetak daftar transaksi', onClick: printList },
  ];

  return (
    <div className={`${salesFont.className} space-y-4`}>
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {actionSlot === undefined ? actionBar : actionSlot ? createPortal(actionBar, actionSlot) : null}

      {/* KPI Cards -- desain sama dengan tab Sales Transaction & Source Data */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <PostedKpiTile label={t('Total Posted')} value={String(totalPosted)} pct={pctOf(totalPosted, allInvoices.length)} pctLabel={t('dari semua invoice')} icon={FileText} />
        <PostedKpiTile label={t('Nilai Terposting')} value={formatIDR(totalPostedValue)} pct={pctOf(totalPostedValue - outstandingAR, totalPostedValue)} pctLabel={t('sudah terbayar')} icon={BookOpen} />
        <PostedKpiTile label={t('Posted Hari Ini')} value={String(postedToday)} pct={pctOf(postedToday, totalPosted)} pctLabel={t('dari total posted')} icon={CalendarDays} />
        <PostedKpiTile label={t('Journal Synced')} value={String(journalSynced)} pct={pctOf(journalSynced, totalPosted)} pctLabel={t('dari total posted')} icon={ShieldCheck} />
        <PostedKpiTile label={t('Fully Paid')} value={String(fullyPaid)} pct={pctOf(fullyPaid, totalPosted)} pctLabel={t('dari total transaksi')} icon={CheckCircle} />
        <PostedKpiTile label={t('Outstanding AR')} value={formatIDR(outstandingAR)} sub={`${outstandingCount} ${t('transaksi')}`} pct={pctOf(outstandingAR, totalPostedValue)} pctLabel={t('dari nilai terposting')} icon={Clock} />
      </div>

      {/* Filters -- desain sama dengan filter di tab Sales Transaction */}
      <div className="card relative px-0 pb-0 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}>
              <CalendarDays size={12} className="text-neutral-500" />
              <span className="text-neutral-500">{t('Periode Posting')}</span>
              <span className="font-medium text-neutral-900">
                {dateStart ? formatTanggalSingkat(dateStart) : t('Semua')}
                {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
                <div>
                  <label className="text-[11px] font-medium text-neutral-500">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-neutral-500">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                </div>
                <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full rounded-[6px] bg-neutral-800 py-2 text-xs font-semibold text-white transition-colors hover:bg-neutral-700">
                  {t('Terapkan')}
                </button>
              </div>
            )}
          </div>

          <FilterSelect
            value={customerFilter}
            onChange={v => { setCustomerFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('Semua Pelanggan') }, ...CUSTOMERS.map(c => ({ value: c, label: c }))]}
          />
          <FilterSelect
            value={branchFilter}
            onChange={v => { setBranchFilter(v); setCurrentPage(1); }}
            options={[{ value: 'all', label: t('All Branches') }, ...BRANCHES.map(b => ({ value: b, label: b }))]}
          />
          <FilterSelect
            value={payStatusFilter}
            onChange={v => { setPayStatusFilter(v); setCurrentPage(1); }}
            options={[
              { value: 'all', label: t('Status Pembayaran') },
              { value: 'Paid', label: t('Paid') },
              { value: 'Partial', label: t('Partial') },
              { value: 'Unpaid', label: t('Unpaid') },
            ]}
          />
          <FilterSelect
            value={journalStatusFilter}
            onChange={v => { setJournalStatusFilter(v); setCurrentPage(1); }}
            options={[
              { value: 'all', label: t('Status Jurnal') },
              { value: 'Synced', label: t('Synced') },
              { value: 'Pending', label: t('Pending') },
            ]}
          />

        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4 items-start !mt-1">
        {/* Table */}
        <div className="card overflow-hidden flex-1 min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
            <div>
              <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">{t('Daftar Transaksi Penjualan (Posted)')}</h3>
              <p className="text-sm text-neutral-500 mt-0.5">
                {loading
                  ? t('Memuat...')
                  : filtered.length === 0
                  ? t('Menampilkan 0 dari 0 transaksi')
                  : `${t('Menampilkan')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('dari')} ${filtered.length} ${t('transaksi')}`}
              </p>
            </div>
            <div className="ml-auto flex w-full flex-col items-end gap-1.5 sm:w-auto">
              <div className="flex items-center justify-end gap-2">
                <button onClick={resetFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">{t('Reset')}</button>
              </div>
              <div className="relative w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  type="text"
                  value={search}
                  onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
                  placeholder={t('Cari invoice, pelanggan, atau no jurnal...')}
                  className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1200px] select-text border-separate border-spacing-0">
              <thead>
                <tr className="bg-neutral-300">
                  <th className="py-2 px-3 w-8 leading-none border-t border-b border-neutral-800">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="block rounded border-neutral-400 accent-neutral-800" />
                  </th>
                  {['Tanggal Posting', 'Invoice', 'Pelanggan', 'Cabang', 'DPP (Rp)', 'PPN (Rp)', 'Nilai Gross (Rp)', 'No. Jurnal', 'AR (Rp)', 'Status Pembayaran', 'Rekonsiliasi', 'Diposting Oleh', 'Status', 'Aksi'].map(h => (
                    <th key={h} className={`py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800 ${POSTED_NUMERIC_COLS.includes(h) ? 'text-right' : 'text-left'}`}>{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-2 px-2 text-center text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">{t('Tidak ada transaksi yang cocok dengan filter.')}</span></td>
                  </tr>
                )}
                {paginated.map(row => (
                  <tr
                    key={row.id}
                    className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedInvoiceNo === row.invoice_no ? '[&>td]:bg-neutral-100' : ''}`}
                    onClick={() => openDetail(row)}
                  >
                    <td className="py-2 px-3" onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" checked={selectedRows.has(row.invoice_no)} onChange={() => toggleRow(row.invoice_no)} className="rounded border-neutral-400 accent-neutral-800" />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{formatTanggalSingkat(row.posted_at)}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{row.invoice_no}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-neutral-900">{row.customer_name}</td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.cabang || '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatIDR(row.dpp)}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatIDR(row.ppn)}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{formatIDR(row.gross_amount)}</td>
                    <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{row.journal_entry_id ? `JE-${row.journal_entry_id}` : '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{row.outstanding_amount > 0 ? formatIDR(row.outstanding_amount) : 'Rp 0'}</td>
                    <td className="py-2 px-2">
                      <Pill style={PAY_STATUS_STYLE[row.payStatus]} label={t(row.payStatus)} />
                    </td>
                    <td className="py-2 px-2">
                      <Pill style={RECONCILE_STYLE[row.reconcile_status]} label={t(row.reconcile_status)} />
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.posted_by ? (row.posted_by === userId ? (user?.nama || user?.username) : t('User lain')) : '—'}</td>
                    <td className="py-2 px-2">
                      <Pill style={POSTING_STATUS_STYLE[row.posting_status]} label={t(row.posting_status)} />
                    </td>
                    <td className="py-2 px-2" onClick={ev => ev.stopPropagation()}>
                      <div className="relative flex items-center gap-1">
                        <button onClick={() => openDetail(row)} className="text-xs font-semibold text-neutral-800 hover:text-neutral-900 hover:underline">{t('Lihat')}</button>
                        <button onClick={() => setOpenMenuId(prev => (prev === row.invoice_no ? null : row.invoice_no))} className="p-1 hover:bg-neutral-300 rounded transition-colors">
                          <MoreHorizontal size={13} className="text-neutral-600" />
                        </button>
                        {openMenuId === row.invoice_no && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-lg border border-neutral-300 bg-white shadow-lg py-1">
                              <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                <Eye size={12} /> {t('Lihat Detail')}
                              </button>
                              <button onClick={() => copyJournal(row.journal_entry_id ? `JE-${row.journal_entry_id}` : '-')} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                <Copy size={12} /> {t('Salin No. Jurnal')}
                              </button>
                              <button onClick={() => openGeneralLedger(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                <BookOpen size={12} /> {t('Lihat di General Ledger')}
                              </button>
                              <button onClick={downloadProof} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                <Download size={12} /> {t('Download Bukti')}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-500">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-neutral-300 rounded-lg px-2 py-1.5 text-xs font-medium text-neutral-900 bg-card focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300">
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-neutral-900">
                  {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-neutral-900">{filtered.length}</span> {t('transaksi')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Halaman sebelumnya')} className={NAV_BTN}><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-neutral-800 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Halaman berikutnya')} className={NAV_BTN}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Detail Drawer -- gaya panel & ringkasan seperti AI Extraction Summary di Source Data */}
        {selected && (() => {
          const paidAmount = Math.max(0, selected.gross_amount - selected.outstanding_amount);
          const paidPct = selected.gross_amount > 0 ? Math.min(100, Math.round((paidAmount / selected.gross_amount) * 100)) : 0;
          const rows: [string, React.ReactNode][] = [
            ['Tanggal Posting', formatTanggalSingkat(selected.posted_at)],
            ['Cabang', selected.cabang || '—'],
            ['DPP', formatIDR(selected.dpp)],
            ['PPN', formatIDR(selected.ppn)],
            ['No. Jurnal', selected.journal_entry_id ? `JE-${selected.journal_entry_id}` : '—'],
            ['Status Jurnal', selected.journal_sync_status === 'Synced' ? t('Synced') : t('Pending')],
            ['AR Outstanding', selected.outstanding_amount > 0 ? formatIDR(selected.outstanding_amount) : 'Rp 0'],
            ['Status Pembayaran', <Pill key="p" style={PAY_STATUS_STYLE[selected.payStatus]} label={t(selected.payStatus)} />],
            ['Rekonsiliasi', <Pill key="r" style={RECONCILE_STYLE[selected.reconcile_status]} label={t(selected.reconcile_status)} />],
          ];
          return (
            <PostedPanel
              className="w-80 flex-shrink-0 sticky top-4"
              title={t('Detail Transaksi')}
              leading={iconBadge(<FileText size={17} />)}
              action={<button onClick={() => setSelectedInvoiceNo(null)} className="p-1 hover:bg-neutral-100 rounded transition-colors"><X size={16} className="text-neutral-500" /></button>}
            >
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-900 text-[11px] font-bold uppercase tracking-wider text-white">INV</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{selected.invoice_no}</p>
                  <p className="truncate text-xs font-medium text-neutral-500">{selected.customer_name}</p>
                </div>
                <span className="ml-auto shrink-0"><Pill style={POSTING_STATUS_STYLE[selected.posting_status]} label={t(selected.posting_status)} /></span>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">{t('Nilai Gross')}</p>
                <p className="mt-1.5 truncate text-lg font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{formatIDR(selected.gross_amount)}</p>
              </div>
              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
                  <div className="h-full rounded-full bg-neutral-800" style={{ width: `${paidPct > 0 ? Math.max(paidPct, 3) : 0}%` }} />
                </div>
                <p className="mt-1 text-[11px] font-medium text-neutral-600">{paidPct}% {t('sudah terbayar')}</p>
              </div>

              <div className="mt-3 divide-y divide-neutral-200 text-xs">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-neutral-500">{t(k)}</span>
                    <span className="text-sm font-semibold tabular-nums text-neutral-900 text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2 border-t border-neutral-200 pt-3">
                <button onClick={() => copyJournal(selected.journal_entry_id ? `JE-${selected.journal_entry_id}` : '-')} className={`${ACTION_BTN_SECONDARY} flex-1 justify-center`}>
                  <Copy size={12} /> {t('Salin Jurnal')}
                </button>
                <button onClick={() => openGeneralLedger(selected)} className={`${ACTION_BTN_SECONDARY} flex-1 justify-center`}>
                  <BookOpen size={12} /> {t('General Ledger')}
                </button>
              </div>
              <button onClick={printList} className={`${ACTION_BTN_PRIMARY} mt-2 w-full justify-center`}>
                <Printer size={12} /> {t('Cetak')}
              </button>
            </PostedPanel>
          );
        })()}
      </div>

      {/* Bottom Section -- panel sama dengan panel bawah Source Data */}
      <div className="grid grid-cols-1 items-start xl:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <PostedPanel
          title={t('Aktivitas Posting Terbaru')}
          leading={iconBadge(<Clock size={17} />)}
          action={activityLogs.length > 5 ? (
            <button onClick={() => setShowAllActivity(v => !v)} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">
              {showAllActivity ? t('Sembunyikan') : t('Lihat Semua')}
            </button>
          ) : undefined}
        >
          <div className="space-y-2">
            {recentActivity.length === 0 && (
              <p className="py-6 text-center text-xs text-neutral-500">{t('Belum ada aktivitas posting.')}</p>
            )}
            {recentActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200">
                  {a.performed_by === 'System' ? <ShieldCheck size={15} /> : <FileText size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-neutral-900">{t(a.description)}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-neutral-500">
                    <span>{formatTanggalWaktu(a.created_at)}</span>
                    {a.reference_no && <span className="font-semibold text-blue-700">{a.reference_no}</span>}
                    <span>{a.performed_by}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </PostedPanel>

        {/* Quick Actions */}
        <PostedPanel title={t('Aksi Cepat')} leading={iconBadge(<LayoutGrid size={17} />)}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {quickActions.map(a => (
              <button
                key={a.label}
                onClick={a.onClick}
                className="group flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5 text-left transition-colors hover:border-neutral-700 hover:bg-neutral-100"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 ring-1 ring-neutral-200">
                  <a.icon size={16} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{t(a.label)}</p>
                  <p className="truncate text-xs font-medium text-neutral-500">{t(a.sub)}</p>
                </div>
              </button>
            ))}
          </div>
        </PostedPanel>
      </div>
    </div>
  );
}