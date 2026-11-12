'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  Download, ChevronLeft, ChevronRight, MoreHorizontal, ChevronDown,
  X, Eye, Printer, Copy, FileSpreadsheet, BookOpen,
  FileText, CalendarDays, ShieldCheck, CheckCircle, Clock, LayoutGrid, Check, Search,
} from 'lucide-react';
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

const PAY_STATUS_STYLE: Record<PayStatus, string> = {
  Paid: 'bg-emerald-100 text-emerald-700',
  Partial: 'bg-amber-100 text-amber-700',
  Unpaid: 'bg-red-100 text-red-700',
};

const RECONCILE_STYLE: Record<string, string> = {
  Reconciled: 'bg-emerald-100 text-emerald-700',
  Unreconciled: 'bg-gray-100 text-gray-600',
};

const POSTING_STATUS_STYLE: Record<string, string> = {
  Posted: 'bg-blue-100 text-blue-700',
  Partial: 'bg-amber-100 text-amber-700',
  Paid: 'bg-emerald-100 text-emerald-700',
};

// Gaya kontrol (select / input / tombol tanggal) -- disamakan dengan tombol &
// kontrol di tab Source Data: sudut rounded-xl, border hijau brand, fokus ring.
const BTN_SECONDARY = 'btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary';
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

// Dropdown filter kustom -- sama persis dengan FilterSelect di tab Sales
// Transaction: selalu terbuka ke bawah, bisa di-scroll, hover/terpilih hijau brand.
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
        className={`flex items-center gap-2 text-xs border rounded-[6px] px-3 py-1.5 bg-card text-foreground transition-colors ${open ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}
      >
        <span className="truncate max-w-[170px]">{current?.label}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-max min-w-full max-w-[320px] rounded-[6px] border border-slate-300 bg-card shadow-xl">
          {searchable && (
            <div className="border-b border-border p-2">
              <input
                autoFocus
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Cari..."
                className="w-full rounded-md border border-border px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 && <li className="px-4 py-2 text-sm text-muted-foreground">Tidak ditemukan</li>}
            {shown.map(o => {
              const selected = o.value === value;
              return (
                <li key={o.value} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => { onChange(o.value); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2 text-left text-sm transition-colors hover:bg-[#6EE7B7] hover:text-[#064E3B] ${selected ? 'bg-[#D1FAE5] font-semibold text-[#065F46]' : 'text-foreground'}`}
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

// Kartu KPI Posted -- desain sama dengan SourceKpiTile di Source Data (garis
// aksen atas, gradasi hijau lembut, kilau di sudut, ikon, bar proporsi).
// UKURAN sengaja tidak diubah: label/angka/keterangan tetap sekecil sebelumnya
// supaya 6 kartu masih muat sebaris.
type KpiTone = 'slate' | 'amber' | 'green' | 'sky';
const KPI_TONE: Record<KpiTone, { strip: string; iconBg: string; iconText: string; bar: string; glow: string }> = {
  slate: { strip: 'bg-[#6EE7B7]', iconBg: 'bg-[#ECFDF5]', iconText: 'text-[#047857]', bar: 'bg-[#6EE7B7]', glow: 'bg-[#6EE7B7]' },
  amber: { strip: 'bg-[#22C55E]', iconBg: 'bg-[#DCFCE7]', iconText: 'text-[#15803D]', bar: 'bg-[#22C55E]', glow: 'bg-[#22C55E]' },
  green: { strip: 'bg-[#0F7D4E]', iconBg: 'bg-[#D1FAE5]', iconText: 'text-[#065F46]', bar: 'bg-[#0F7D4E]', glow: 'bg-[#0F7D4E]' },
  sky: { strip: 'bg-[#0B5E5C]', iconBg: 'bg-[#CCFBF1]', iconText: 'text-[#0F766E]', bar: 'bg-[#0B5E5C]', glow: 'bg-[#0B5E5C]' },
};

function PostedKpiTile({ label, value, sub, pct, pctLabel, tone, icon: Icon }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  tone: KpiTone;
  icon: React.ElementType;
}) {
  const c = KPI_TONE[tone];
  const p = Math.min(100, Math.max(0, Math.round(pct)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-primary/60 bg-gradient-to-br from-white via-white to-[#F0FDF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-x-0 top-0 h-1 ${c.strip}`} />
      <span className={`pointer-events-none absolute -bottom-8 -right-8 h-24 w-24 rounded-full opacity-[0.12] blur-xl ${c.glow}`} />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-extrabold uppercase tracking-wide text-slate-700">{label}</p>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-white ${c.iconBg}`}>
          <Icon size={16} className={c.iconText} />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-extrabold tabular-nums text-[#064E3B]">{value}</p>
      {sub && <p className="relative truncate text-[11px] font-semibold text-slate-500">{sub}</p>}
      <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${c.bar}`} style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-semibold text-slate-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Panel putih dengan header terpisah garis -- sama dengan SourcePanel di
// Source Data (File Preview / AI Extraction Summary / Data Quality Check).
function PostedPanel({ title, leading, action, children, className = '' }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-border bg-slate-50/70 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {leading}
          <h3 className="truncate text-lg font-bold text-foreground">{title}</h3>
        </div>
        {action}
      </div>
      <div className="flex flex-1 flex-col p-4">{children}</div>
    </div>
  );
}

const iconBadge = (node: React.ReactNode) => (
  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]">{node}</span>
);

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
    <div className="flex flex-wrap items-center justify-end gap-2 pb-2 lg:pb-0">
      <button onClick={() => exportCSV(filtered, t('Semua data (sesuai filter)'))} className={BTN_SECONDARY}>
        <FileSpreadsheet size={13} /> {t('Export')}
      </button>
      <button onClick={printList} className={BTN_SECONDARY}>
        <Printer size={13} /> {t('Cetak Daftar')}
      </button>
      {selectedRows.size > 0 && (
        <button onClick={exportSelected} className="btn-primary text-xs py-1.5 gap-1.5">
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
    <div className="space-y-5">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={refresh} className="underline font-medium">{t('Coba lagi')}</button>
        </div>
      )}

      {actionSlot === undefined ? actionBar : actionSlot ? createPortal(actionBar, actionSlot) : null}

      {/* KPI Cards -- desain sama dengan Source Data, ukuran tetap */}
      <div className="!mt-4 grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <PostedKpiTile label={t('Total Posted')} value={String(totalPosted)} pct={pctOf(totalPosted, allInvoices.length)} pctLabel={t('dari semua invoice')} tone="slate" icon={FileText} />
        <PostedKpiTile label={t('Nilai Terposting')} value={formatIDR(totalPostedValue)} pct={pctOf(totalPostedValue - outstandingAR, totalPostedValue)} pctLabel={t('sudah terbayar')} tone="green" icon={BookOpen} />
        <PostedKpiTile label={t('Posted Hari Ini')} value={String(postedToday)} pct={pctOf(postedToday, totalPosted)} pctLabel={t('dari total posted')} tone="amber" icon={CalendarDays} />
        <PostedKpiTile label={t('Journal Synced')} value={String(journalSynced)} pct={pctOf(journalSynced, totalPosted)} pctLabel={t('dari total posted')} tone="sky" icon={ShieldCheck} />
        <PostedKpiTile label={t('Fully Paid')} value={String(fullyPaid)} pct={pctOf(fullyPaid, totalPosted)} pctLabel={t('dari total transaksi')} tone="green" icon={CheckCircle} />
        <PostedKpiTile label={t('Outstanding AR')} value={formatIDR(outstandingAR)} sub={`${outstandingCount} ${t('transaksi')}`} pct={pctOf(outstandingAR, totalPostedValue)} pctLabel={t('dari nilai terposting')} tone="sky" icon={Clock} />
      </div>

      {/* Filters -- desain sama dengan filter di tab Sales Transaction */}
      <div className="card p-3 relative">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-primary ring-2 ring-primary/20' : 'border-primary/60 hover:border-primary hover:bg-slate-50'}`}>
              <CalendarDays size={12} className="text-muted-foreground" />
              <span className="text-muted-foreground">{t('Periode Posting')}</span>
              <span className="font-medium text-foreground">
                {dateStart ? formatTanggalSingkat(dateStart) : t('Semua')}
                {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
              </span>
            </button>
            {showDatePicker && (
              <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-slate-300 bg-white p-3 shadow-xl">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">{t('Dari')}</label>
                  <input type="date" value={dateStart} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-slate-300 rounded-[6px] px-2 py-1.5 bg-white text-foreground mt-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground">{t('Sampai')}</label>
                  <input type="date" value={dateEnd} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-slate-300 rounded-[6px] px-2 py-1.5 bg-white text-foreground mt-0.5 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20" />
                </div>
                <button onClick={() => { setCurrentPage(1); setShowDatePicker(false); }} className="w-full text-xs py-2 bg-primary text-primary-foreground rounded-[6px] font-semibold hover:opacity-90">
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

          <div className="relative ml-auto w-full sm:w-[400px]">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
            <input
              type="text"
              value={search}
              onChange={ev => { setSearch(ev.target.value); setCurrentPage(1); }}
              placeholder={t('Cari invoice, pelanggan, atau no jurnal...')}
              className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {/* Baris kedua: aksi Reset (rata kanan), sama seperti Sales Transaction */}
          <div className="flex w-full items-center justify-end gap-2">
            <button onClick={resetFilters} className="text-xs text-primary hover:underline">{t('Reset')}</button>
          </div>
        </div>
      </div>

      {/* Table + Drawer */}
      <div className="flex gap-4 items-start">
        {/* Table */}
        <div className="card overflow-hidden flex-1 min-w-0">
          <div className="px-0 py-3 border-b border-border flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold text-foreground">{t('Daftar Transaksi Penjualan (Posted)')}</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {loading
                  ? t('Memuat...')
                  : filtered.length === 0
                  ? t('Menampilkan 0 dari 0 transaksi')
                  : `${t('Menampilkan')} ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} ${t('dari')} ${filtered.length} ${t('transaksi')}`}
              </p>
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1200px]">
              <thead>
                <tr className="bg-[#8FE3B5]">
                  <th className="py-3 px-3 w-8 border-t-2 border-b border-[#0A4A32]">
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="rounded border-border accent-[#0F7D4E]" />
                  </th>
                  {['Tanggal Posting', 'Invoice', 'Pelanggan', 'Cabang', 'DPP (Rp)', 'PPN (Rp)', 'Nilai Gross (Rp)', 'No. Jurnal', 'AR (Rp)', 'Status Pembayaran', 'Rekonsiliasi', 'Diposting Oleh', 'Status', 'Aksi'].map(h => (
                    <th key={h} className="text-left py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]">{t(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loading && paginated.length === 0 && (
                  <tr>
                    <td colSpan={15} className="py-8 text-center text-xs text-muted-foreground">{t('Tidak ada transaksi yang cocok dengan filter.')}</td>
                  </tr>
                )}
                {paginated.map(row => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-300/70 cursor-pointer transition-colors text-xs ${selectedInvoiceNo === row.invoice_no ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
                    onClick={() => openDetail(row)}
                  >
                    <td className="py-2 px-3" onClick={ev => ev.stopPropagation()}>
                      <input type="checkbox" checked={selectedRows.has(row.invoice_no)} onChange={() => toggleRow(row.invoice_no)} className="rounded border-border accent-[#0F7D4E]" />
                    </td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{formatTanggalSingkat(row.posted_at)}</td>
                    <td className="py-2 px-2 text-primary font-medium whitespace-nowrap">{row.invoice_no}</td>
                    <td className="py-2 px-2 font-medium text-foreground whitespace-nowrap">{row.customer_name}</td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.cabang || '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatIDR(row.dpp)}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{formatIDR(row.ppn)}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{formatIDR(row.gross_amount)}</td>
                    <td className="py-2 px-2 text-primary font-medium whitespace-nowrap">{row.journal_entry_id ? `JE-${row.journal_entry_id}` : '—'}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{row.outstanding_amount > 0 ? formatIDR(row.outstanding_amount) : 'Rp 0'}</td>
                    <td className="py-2 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[row.payStatus]}`}>{t(row.payStatus)}</span>
                    </td>
                    <td className="py-2 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[row.reconcile_status] || 'bg-muted text-muted-foreground'}`}>{t(row.reconcile_status)}</span>
                    </td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.posted_by ? (row.posted_by === userId ? (user?.nama || user?.username) : t('User lain')) : '—'}</td>
                    <td className="py-2 px-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${POSTING_STATUS_STYLE[row.posting_status] || 'bg-blue-100 text-blue-700'}`}>{t(row.posting_status)}</span>
                    </td>
                    <td className="py-2 px-2" onClick={ev => ev.stopPropagation()}>
                      <div className="relative flex items-center gap-1">
                        <button onClick={() => openDetail(row)} className="text-xs font-semibold text-primary hover:underline">{t('Lihat')}</button>
                        <button onClick={() => setOpenMenuId(prev => (prev === row.invoice_no ? null : row.invoice_no))} className="p-1 hover:bg-muted rounded transition-colors">
                          <MoreHorizontal size={14} className="text-muted-foreground" />
                        </button>
                        {openMenuId === row.invoice_no && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-lg border border-border bg-card shadow-lg py-1">
                              <button onClick={() => openDetail(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left">
                                <Eye size={12} /> {t('Lihat Detail')}
                              </button>
                              <button onClick={() => copyJournal(row.journal_entry_id ? `JE-${row.journal_entry_id}` : '-')} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left">
                                <Copy size={12} /> {t('Salin No. Jurnal')}
                              </button>
                              <button onClick={() => openGeneralLedger(row)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left">
                                <BookOpen size={12} /> {t('Lihat di General Ledger')}
                              </button>
                              <button onClick={downloadProof} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left">
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
          <div className="px-0 py-3 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                <span>{t('Baris per halaman')}</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                </select>
              </label>
              <span className="hidden sm:inline text-slate-300">|</span>
              <span>
                <span className="font-semibold text-foreground">
                  {filtered.length === 0 ? 0 : (pageSafe - 1) * pageSize + 1}–{Math.min(pageSafe * pageSize, filtered.length)}
                </span>{' '}
                {t('dari')} <span className="font-semibold text-foreground">{filtered.length}</span> {t('transaksi')}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label={t('Halaman sebelumnya')} className={NAV_BTN}><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label={t('Halaman berikutnya')} className={NAV_BTN}><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Detail Drawer -- gaya panel & ringkasan seperti AI Extraction Summary */}
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
            ['Status Pembayaran', <span key="p" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PAY_STATUS_STYLE[selected.payStatus]}`}>{t(selected.payStatus)}</span>],
            ['Rekonsiliasi', <span key="r" className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${RECONCILE_STYLE[selected.reconcile_status] || 'bg-muted text-muted-foreground'}`}>{t(selected.reconcile_status)}</span>],
          ];
          return (
            <PostedPanel
              className="w-80 flex-shrink-0 sticky top-4"
              title={t('Detail Transaksi')}
              leading={iconBadge(<FileText size={17} />)}
              action={<button onClick={() => setSelectedInvoiceNo(null)} className="p-1 hover:bg-muted rounded transition-colors"><X size={16} className="text-muted-foreground" /></button>}
            >
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D1FAE5] text-[11px] font-extrabold text-[#065F46] shadow-sm ring-1 ring-white">INV</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{selected.invoice_no}</p>
                  <p className="truncate text-xs font-medium text-slate-600">{selected.customer_name}</p>
                </div>
                <span className={`ml-auto shrink-0 text-[11px] px-2 py-0.5 rounded-full font-medium ${POSTING_STATUS_STYLE[selected.posting_status] || 'bg-blue-100 text-blue-700'}`}>{t(selected.posting_status)}</span>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <p className="truncate text-[10px] font-bold uppercase leading-tight tracking-wide text-slate-500">{t('Nilai Gross')}</p>
                <p className="mt-1.5 truncate text-xl font-extrabold leading-none tabular-nums text-[#064E3B]">{formatIDR(selected.gross_amount)}</p>
              </div>
              <div className="mt-3">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-[#0F7D4E]" style={{ width: `${paidPct > 0 ? Math.max(paidPct, 3) : 0}%` }} />
                </div>
                <p className="mt-1.5 text-xs font-semibold text-slate-600">{paidPct}% {t('sudah terbayar')}</p>
              </div>

              <div className="mt-3 divide-y divide-slate-200 text-xs">
                {rows.map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-muted-foreground">{t(k)}</span>
                    <span className="text-sm font-bold tabular-nums text-slate-900 text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div className="mt-3 flex gap-2 border-t border-border pt-3">
                <button onClick={() => copyJournal(selected.journal_entry_id ? `JE-${selected.journal_entry_id}` : '-')} className={`${BTN_SECONDARY} flex-1 justify-center`}>
                  <Copy size={12} /> {t('Salin Jurnal')}
                </button>
                <button onClick={() => openGeneralLedger(selected)} className={`${BTN_SECONDARY} flex-1 justify-center`}>
                  <BookOpen size={12} /> {t('General Ledger')}
                </button>
              </div>
              <button onClick={printList} className="btn-primary mt-2 w-full justify-center text-xs py-1.5 gap-1.5">
                <Printer size={12} /> {t('Cetak')}
              </button>
            </PostedPanel>
          );
        })()}
      </div>

      {/* Bottom Section -- panel sama dengan panel bawah Source Data */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Recent Activity */}
        <PostedPanel
          title={t('Aktivitas Posting Terbaru')}
          leading={iconBadge(<Clock size={17} />)}
          action={activityLogs.length > 5 ? (
            <button onClick={() => setShowAllActivity(v => !v)} className="text-xs font-semibold text-primary hover:underline">
              {showAllActivity ? t('Sembunyikan') : t('Lihat Semua')}
            </button>
          ) : undefined}
        >
          <div className="space-y-2">
            {recentActivity.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">{t('Belum ada aktivitas posting.')}</p>
            )}
            {recentActivity.map((a) => (
              <div key={a.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${a.performed_by === 'System' ? 'bg-[#CCFBF1] text-[#0F766E]' : 'bg-[#D1FAE5] text-[#065F46]'}`}>
                  {a.performed_by === 'System' ? <ShieldCheck size={15} /> : <FileText size={15} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-foreground">{t(a.description)}</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span>{formatTanggalWaktu(a.created_at)}</span>
                    {a.reference_no && <span className="font-semibold text-primary">{a.reference_no}</span>}
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
                className="group flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:bg-[#F0FDF7] hover:shadow-sm"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#D1FAE5] text-[#065F46] shadow-sm ring-1 ring-white transition-colors group-hover:bg-[#A7F3D0]">
                  <a.icon size={18} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-foreground">{t(a.label)}</p>
                  <p className="truncate text-xs font-medium text-slate-600">{t(a.sub)}</p>
                </div>
              </button>
            ))}
          </div>
        </PostedPanel>
      </div>
    </div>
  );
}