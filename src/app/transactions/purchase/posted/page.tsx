'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import {
  Download, Search, ChevronLeft, ChevronRight, ArrowUpDown, MoreHorizontal, X, Eye, Copy,
  FileText, FileSpreadsheet, CheckCircle2, Banknote, Receipt, CreditCard, CalendarDays, BadgeCheck, ShieldCheck,
} from 'lucide-react';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { exportPurchaseTransactionsCsv } from '@/app/transactions/purchase/purchaseExport';
import { inPurchaseDateRange, usePurchaseDateRange } from '@/app/transactions/purchase/purchaseDateRange';

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

// ── Pill bergaris + titik berwarna -- sama dengan StatusPill di Sales Posted / Purchase Transaction ──
type PillStyle = { pill: string; dot: string };
const PILL_FALLBACK: PillStyle = { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' };

const PAYMENT_STYLE: Record<string, PillStyle> = {
  paid: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  partially_paid: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  unpaid: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  overdue: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  on_hold: PILL_FALLBACK,
};

const paymentLabels: Record<string, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

function Pill({ style, label }: { style?: PillStyle; label: string }) {
  const st = style || PILL_FALLBACK;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

// Kategori: pill netral (tema monokrom -- tidak lagi warna-warni).
function CategoryPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-neutral-300 bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700 whitespace-nowrap">
      {label}
    </span>
  );
}

// ── Gaya tombol netral -- sama dengan Sales Posted ──
const ACTION_BTN_BASE = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const ACTION_BTN_SECONDARY = `${ACTION_BTN_BASE} border border-neutral-300 bg-white text-neutral-800 hover:border-neutral-700 hover:bg-neutral-50`;
const ACTION_BTN_PRIMARY = `${ACTION_BTN_BASE} border border-blue-600 bg-blue-600 text-white hover:bg-blue-700`;
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';
const NAV_BTN = 'flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card';

// Kartu KPI -- desain sama dengan PostedKpiTile di Sales Posted (garis aksen hitam, ikon netral, bar proporsi netral).
function PostedKpiTile({ label, value, sub, pct, pctLabel, icon: Icon, barActive = true }: {
  label: string;
  value: string;
  sub?: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
  barActive?: boolean;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={value}>{value}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{sub ?? ''}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${barActive && p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{barActive ? `${p}% ` : ''}{pctLabel}</p>
    </div>
  );
}

// Panel putih dengan garis aksen hitam & header abu -- sama dengan PostedPanel di Sales Posted.
function PostedPanel({ title, leading, action, children, className = '' }: {
  title: string;
  leading?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm ${className}`}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
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

function buildPageItems(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  if (current <= 3) { pages.add(2); pages.add(3); pages.add(4); }
  if (current >= total - 2) { pages.add(total - 1); pages.add(total - 2); pages.add(total - 3); }
  const sorted = Array.from(pages).filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  sorted.forEach((n, idx) => {
    if (idx > 0 && n - sorted[idx - 1] > 1) out.push('…');
    out.push(n);
  });
  return out;
}

export default function PurchasePostedPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const clientId = activeClientId ?? null;
  const { transactions: backendTransactions } = usePurchaseTransactions(clientId, 'posted');
  const [dateRange] = usePurchaseDateRange();
  const allPosted = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);
  // Rentang tanggal di header memfilter berdasarkan Posting Date (fallback Purchase Date).
  const postedPurchases = useMemo(
    () => allPosted.filter(t => inPurchaseDateRange(t.postingDate || t.purchaseDate, dateRange)),
    [allPosted, dateRange],
  );

  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [sortField, setSortField] = useState('postingDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Pilihan baris (checkbox), baris yang dibuka di panel detail, dan menu aksi.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Baris item/jasa dimuat lazy, cuma untuk transaksi yang sedang dibuka di panel detail.
  const { lines: detailLines } = usePurchaseTransactionLines(selectedId);
  const mappedDetailLines = useMemo(() => detailLines.map(mapTransactionLineToUi), [detailLines]);

  const periods = ['All', ...Array.from(new Set(postedPurchases.map(t => t.period)))];
  const categories = ['All', ...Array.from(new Set(postedPurchases.map(t => t.category)))];
  const vendors = ['All', ...Array.from(new Set(postedPurchases.map(t => t.vendor)))];

  const filtered = useMemo(() => {
    let data = [...postedPurchases];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.purchaseId.toLowerCase().includes(q) ||
        r.vendor.toLowerCase().includes(q) ||
        r.invoiceNumber.toLowerCase().includes(q) ||
        r.poNumber.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q),
      );
    }
    if (periodFilter !== 'All') data = data.filter(r => r.period === periodFilter);
    if (categoryFilter !== 'All') data = data.filter(r => r.category === categoryFilter);
    if (vendorFilter !== 'All') data = data.filter(r => r.vendor === vendorFilter);
    if (paymentFilter !== 'All') data = data.filter(r => r.paymentStatus === paymentFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [postedPurchases, search, periodFilter, categoryFilter, vendorFilter, paymentFilter, sortField, sortDir]);

  // Paging -- sama dengan Sales Posted (Rows per page 5/10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [search, periodFilter, categoryFilter, vendorFilter, paymentFilter, sortField, sortDir, dateRange]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));
  const selected = postedPurchases.find(r => r.id === selectedId) || null;

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('desc'); }
  };

  const resetFilters = () => {
    setSearch(''); setPeriodFilter('All'); setCategoryFilter('All'); setVendorFilter('All'); setPaymentFilter('All');
    setCurrentPage(1);
  };

  const toggleRow = (id: string) => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const allOnPageSelected = paginated.length > 0 && paginated.every(r => selectedRows.has(r.id));
  const toggleSelectAllOnPage = () => {
    setSelectedRows(prev => {
      const next = new Set(prev);
      if (allOnPageSelected) paginated.forEach(r => next.delete(r.id));
      else paginated.forEach(r => next.add(r.id));
      return next;
    });
  };

  const openDetail = (id: string) => { setSelectedId(id); setOpenMenuId(null); };

  const copyPurchaseId = (purchaseId: string) => {
    navigator.clipboard?.writeText(purchaseId);
    toast.success('Purchase ID copied', { description: purchaseId });
    setOpenMenuId(null);
  };

  const exportAll = () => {
    if (filtered.length === 0) { toast.error('No data to export'); return; }
    exportPurchaseTransactionsCsv(filtered, 'purchase-posted');
  };
  const exportSelected = () => {
    const rows = postedPurchases.filter(r => selectedRows.has(r.id));
    if (rows.length === 0) { toast.error('No data to export'); return; }
    exportPurchaseTransactionsCsv(rows, 'purchase-posted-selected');
  };

  // ── KPI ──
  const summary = useMemo(() => {
    const total = postedPurchases.length;
    const totalAmount = postedPurchases.reduce((s, t) => s + t.total, 0);
    const totalTax = postedPurchases.reduce((s, t) => s + t.taxAmount, 0);
    const totalAP = postedPurchases.reduce((s, t) => s + t.accountsPayable, 0);
    const periodCount = new Set(postedPurchases.map(t => t.period)).size;
    const fullyPaid = postedPurchases.filter(t => t.paymentStatus === 'paid').length;
    return { total, totalAmount, totalTax, totalAP, periodCount, fullyPaid };
  }, [postedPurchases]);
  const pctOf = (n: number, d: number) => (d > 0 ? (n / d) * 100 : 0);

  // Tombol aksi -- di baris yang sama dengan tab, sebelah kanan (sama dengan Sales Posted).
  const actionBar = (
    <div className={`${salesFont.className} flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap`}>
      <button type="button" onClick={exportAll} disabled={filtered.length === 0} className={ACTION_BTN_SECONDARY}>
        <FileSpreadsheet size={13} /> Export
      </button>
      {selectedRows.size > 0 && (
        <button type="button" onClick={exportSelected} className={ACTION_BTN_PRIMARY}>
          <Download size={13} /> Export Selected ({selectedRows.size})
        </button>
      )}
    </div>
  );

  const columns: { label: string; field: string; align: 'left' | 'right' }[] = [
    { label: 'Purchase ID', field: 'purchaseId', align: 'left' },
    { label: 'Posting Date', field: 'postingDate', align: 'left' },
    { label: 'Purchase Date', field: 'purchaseDate', align: 'left' },
    { label: 'Invoice No.', field: 'invoiceNumber', align: 'left' },
    { label: 'Vendor', field: 'vendor', align: 'left' },
    { label: 'Category', field: 'category', align: 'left' },
    { label: 'Subtotal', field: 'subtotal', align: 'right' },
    { label: 'Tax', field: 'taxAmount', align: 'right' },
    { label: 'Total', field: 'total', align: 'right' },
    { label: 'Payment', field: 'paymentStatus', align: 'left' },
    { label: 'Period', field: 'period', align: 'left' },
    { label: 'Posted By', field: 'postedBy', align: 'left' },
    { label: 'Approved By', field: 'approvedBy', align: 'left' },
  ];
  const COL_COUNT = columns.length + 2; // + checkbox + Actions
  const thCls = 'py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800';

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      <PurchaseTabs actions={actionBar} dateRangeActive variant="elegant" />

      <div className={`${salesFont.className} pt-5 space-y-4`}>
        {/* KPI Cards -- desain sama dengan Sales Posted, grid 6 kartu */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <PostedKpiTile label="Posted Purchases" value={summary.total.toLocaleString('id-ID')} sub="Finalized records" pct={pctOf(summary.fullyPaid, summary.total)} pctLabel="fully paid" icon={CheckCircle2} />
          <PostedKpiTile label="Total Posted Amount" value={fmt(summary.totalAmount)} sub="Gross purchase value" pct={0} pctLabel="Gross purchase value" icon={Banknote} barActive={false} />
          <PostedKpiTile label="Total Input Tax" value={fmt(summary.totalTax)} sub="Recoverable VAT" pct={pctOf(summary.totalTax, summary.totalAmount)} pctLabel="of posted amount" icon={Receipt} />
          <PostedKpiTile label="Total AP Generated" value={fmt(summary.totalAP)} sub="Accounts payable" pct={pctOf(summary.totalAP, summary.totalAmount)} pctLabel="of posted amount" icon={CreditCard} />
          <PostedKpiTile label="Fully Paid" value={summary.fullyPaid.toLocaleString('id-ID')} sub="Paid in full" pct={pctOf(summary.fullyPaid, summary.total)} pctLabel="of posted purchases" icon={BadgeCheck} />
          <PostedKpiTile label="Accounting Periods" value={summary.periodCount.toLocaleString('id-ID')} sub="Periods covered" pct={0} pctLabel="Periods covered" icon={CalendarDays} barActive={false} />
        </div>

        {/* Filters -- baris terpisah di atas tabel, sama dengan Sales Posted */}
        <div className="card relative px-0 pb-0 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              variant="elegant"
              value={periodFilter}
              onChange={setPeriodFilter}
              options={periods.map(p => ({ value: p, label: p === 'All' ? 'All Periods' : p }))}
            />
            <FilterSelect
              variant="elegant"
              value={categoryFilter}
              onChange={setCategoryFilter}
              options={categories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
            />
            <FilterSelect
              variant="elegant"
              value={vendorFilter}
              onChange={setVendorFilter}
              options={vendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
            />
            <FilterSelect
              variant="elegant"
              value={paymentFilter}
              onChange={setPaymentFilter}
              options={[{ value: 'All', label: 'All Payment' }, ...Object.entries(paymentLabels).map(([k, v]) => ({ value: k, label: v }))]}
            />
          </div>
        </div>

        {/* Table + Detail panel */}
        <div className="flex gap-4 items-start !mt-1">
          <div className="card overflow-hidden flex-1 min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Posted Purchase List</h3>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {filtered.length === 0
                    ? `Showing 0 of ${postedPurchases.length} posted purchases`
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} posted purchases`}
                </p>
              </div>
              <div className="ml-auto flex w-full flex-col items-end gap-1.5 sm:w-auto">
                <div className="flex items-center justify-end gap-2">
                  <button onClick={resetFilters} className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline">Reset</button>
                </div>
                <div className="relative w-full sm:w-[400px]">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by purchase ID, vendor, invoice number, PO number..."
                    className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1500px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className="py-2 px-3 w-8 leading-none border-t border-b border-neutral-800">
                      <input type="checkbox" checked={allOnPageSelected} onChange={toggleSelectAllOnPage} className="block rounded border-neutral-400 accent-neutral-800" />
                    </th>
                    {columns.map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        className={`${thCls} cursor-pointer select-none hover:text-neutral-700 ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                      >
                        <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                          {col.label}<ArrowUpDown size={11} className="opacity-50" />
                        </span>
                      </th>
                    ))}
                    <th className={`${thCls} text-left`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td colSpan={COL_COUNT} className="py-2 px-2 text-center text-xs text-neutral-500">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No posted purchases match your filters.</span>
                      </td>
                    </tr>
                  ) : paginated.map(row => (
                    <tr
                      key={row.id}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedId === row.id ? '[&>td]:bg-neutral-100' : ''}`}
                      onClick={() => openDetail(row.id)}
                    >
                      <td className="py-2 px-3" onClick={ev => ev.stopPropagation()}>
                        <input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRow(row.id)} className="rounded border-neutral-400 accent-neutral-800" />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{row.purchaseId}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.postingDate || '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.purchaseDate}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.invoiceNumber || '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-neutral-900 max-w-[160px] truncate">{row.vendor}</td>
                      <td className="py-2 px-2 whitespace-nowrap"><CategoryPill label={row.category} /></td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.subtotal)}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.taxAmount)}</td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(row.total)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <Pill style={PAYMENT_STYLE[row.paymentStatus]} label={paymentLabels[row.paymentStatus] || row.paymentStatus} />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.period}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.postedBy || '—'}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.approvedBy || '—'}</td>
                      <td className="py-2 px-2" onClick={ev => ev.stopPropagation()}>
                        <div className="relative flex items-center gap-1">
                          <button onClick={() => openDetail(row.id)} className="text-xs font-semibold text-neutral-800 hover:text-neutral-900 hover:underline">View</button>
                          <button onClick={() => setOpenMenuId(prev => (prev === row.id ? null : row.id))} className="p-1 hover:bg-neutral-300 rounded transition-colors">
                            <MoreHorizontal size={13} className="text-neutral-600" />
                          </button>
                          {openMenuId === row.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
                              <div className="absolute right-0 top-full mt-1 z-20 min-w-[180px] rounded-lg border border-neutral-300 bg-white shadow-lg py-1">
                                <button onClick={() => openDetail(row.id)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                  <Eye size={12} /> View Detail
                                </button>
                                <button onClick={() => copyPurchaseId(row.purchaseId)} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 text-left">
                                  <Copy size={12} /> Copy Purchase ID
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
                  <span>Rows per page</span>
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
                  of <span className="font-semibold text-neutral-900">{filtered.length}</span> posted purchases
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className={NAV_BTN}><ChevronLeft size={16} /></button>
                {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                  )
                )}
                <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className={NAV_BTN}><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>

          {/* Detail panel -- gaya sama dengan Detail Transaksi di Sales Posted (menggantikan baris expand) */}
          {selected && (
            <PostedPanel
              className="w-80 flex-shrink-0 sticky top-4"
              title="Purchase Detail"
              leading={<span className={PANEL_ICON_CHIP}><FileText size={17} /></span>}
              action={<button onClick={() => setSelectedId(null)} className="p-1 hover:bg-neutral-100 rounded transition-colors"><X size={16} className="text-neutral-500" /></button>}
            >
              <div className="mb-3 flex items-center gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-[11px] font-bold uppercase tracking-wider text-white">PUR</div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-neutral-900">{selected.purchaseId}</p>
                  <p className="truncate text-xs font-medium text-neutral-500">{selected.vendor}</p>
                </div>
                <span className="ml-auto shrink-0"><Pill style={PAYMENT_STYLE[selected.paymentStatus]} label={paymentLabels[selected.paymentStatus] || selected.paymentStatus} /></span>
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">Total Posted</p>
                <p className="mt-1.5 truncate text-lg font-semibold leading-none tabular-nums tracking-tight text-neutral-900">{fmt(selected.total)}</p>
              </div>

              <div className="mt-3 divide-y divide-neutral-200 text-xs">
                {([
                  ['Posting Date', selected.postingDate || '—'],
                  ['Purchase Date', selected.purchaseDate],
                  ['Invoice No.', selected.invoiceNumber || '—'],
                  ['PO Number', selected.poNumber || '—'],
                  ['Source Type', selected.sourceDocType],
                  ['Payment Terms', selected.paymentTerms || '—'],
                  ['Due Date', selected.dueDate || '—'],
                  ['Subtotal', fmt(selected.subtotal)],
                  ['Tax', fmt(selected.taxAmount)],
                  ['AP Generated', fmt(selected.accountsPayable)],
                  ['Posted By', selected.postedBy || '—'],
                  ['Approved By', selected.approvedBy || '—'],
                  ['Posted Timestamp', selected.postedTimestamp || '—'],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-neutral-500">{k}</span>
                    <span className="text-sm font-semibold tabular-nums text-neutral-900 text-right break-all">{v}</span>
                  </div>
                ))}
              </div>

              {/* Line items */}
              <div className="mt-3 border-t border-neutral-200 pt-3">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Purchase Line Items</p>
                <div className="space-y-2">
                  {mappedDetailLines.length === 0 && (
                    <p className="py-3 text-center text-xs text-neutral-500">No line items.</p>
                  )}
                  {mappedDetailLines.map(line => (
                    <div key={line.id} className="rounded-xl border border-neutral-200 bg-neutral-50 p-2.5">
                      <p className="text-xs font-semibold text-neutral-900">{line.description}</p>
                      <p className="mt-0.5 text-[11px] font-medium text-neutral-500">
                        {line.quantity} {line.unit} × {fmt(line.unitPrice)}
                      </p>
                      <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-neutral-500">{kodeAkun(line.accountCode)} · {line.accountName}</span>
                        <span className="shrink-0 font-semibold tabular-nums text-neutral-900">{fmt(line.total)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5">
                <ShieldCheck size={14} className="shrink-0 text-neutral-700" />
                <p className="text-[11px] font-medium text-neutral-700">
                  Posted to General Ledger — AP generated <span className="font-semibold tabular-nums">{fmt(selected.accountsPayable)}</span>
                </p>
              </div>

              <button onClick={() => copyPurchaseId(selected.purchaseId)} className={`${ACTION_BTN_SECONDARY} mt-3 w-full justify-center`}>
                <Copy size={12} /> Copy Purchase ID
              </button>
            </PostedPanel>
          )}
        </div>
      </div>
    </div>
  );
}