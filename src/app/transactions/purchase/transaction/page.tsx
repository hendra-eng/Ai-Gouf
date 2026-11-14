'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { runPurchaseStatusAction } from '@/app/transactions/purchase/components/purchaseStatusActions';
import type { PurchaseStatus, PaymentStatus } from '@/data/purchaseData';
import { buildPurchaseListReport, buildPurchaseDetailReport } from '@/app/transactions/purchase/components/purchasePrintReports';
import ProgressKpiTile, { type KpiTone } from '@/components/shared/ProgressKpiTile';
import { Search, ShoppingBag, Clock, CheckCircle, FileCheck, AlertTriangle, CircleDollarSign, MoreHorizontal, ChevronLeft, ChevronRight, X, FileText } from 'lucide-react';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import PrintMenu from '@/components/shared/PrintMenu';
import { printReport, type PrintFormat } from '@/lib/printExport';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import {
  ArrowsUpDownIcon,
  EyeIcon,
  PencilSquareIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Status yang masih bisa diubah lewat form Create Bill (sama dengan purchase_bill_v1.STATUS_BISA_DIUBAH).
const BILL_EDITABLE: PurchaseStatus[] = ['draft', 'pending_review', 'rejected', 'exception'];

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

const statusColors: Record<PurchaseStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
  exception: 'bg-orange-100 text-orange-700',
  cancelled: 'bg-slate-100 text-slate-500',
};

const statusLabels: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  pending_review: 'Pending Review',
  approved: 'Approved',
  pending_posting: 'Pending Posting',
  posted: 'Posted',
  rejected: 'Rejected',
  exception: 'Exception',
  cancelled: 'Cancelled',
};

const paymentColors: Record<PaymentStatus, string> = {
  unpaid: 'bg-red-100 text-red-700',
  partially_paid: 'bg-amber-100 text-amber-700',
  paid: 'bg-emerald-100 text-emerald-700',
  overdue: 'bg-red-100 text-red-700',
  on_hold: 'bg-slate-100 text-slate-600',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

// Badge status -- bentuk pil, ukuran & warna sama dengan tabel Purchase Source Data.
const BADGE_BASE = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';

// Panel putih dengan header terpisah garis -- sama dengan SourcePanel di Source Data.
function SourcePanel({ title, leading, action, children }: {
  title: string; leading?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
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

export default function PurchaseTransactionPage() {
  useKodeAkun(); // re-render saat peta kode akun (Source Account Code) dimuat
  const { user } = useAuth();
  const { clients, activeClientId, activeClientName } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const { transactions: backendTransactions } = usePurchaseTransactions(activeClientId ?? null);
  const purchaseTransactions = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [sortField, setSortField] = useState('purchaseDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRow, setSelectedRow] = useState<typeof purchaseTransactions[0] | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'approve' | 'post' | null>(null);

  // Baris item/jasa dimuat lazy, cuma untuk transaksi yang sedang dibuka
  // di detail panel (bukan seluruh daftar) -- pola sama seperti
  // useJeDraftLines() di journalEntryStore.tsx.
  const { lines: selectedLines } = usePurchaseTransactionLines(selectedRow?.id);
  const selectedRowWithLines = useMemo(
    () => (selectedRow ? { ...selectedRow, lines: selectedLines.map(mapTransactionLineToUi) } : null),
    [selectedRow, selectedLines],
  );

  const uniqueVendors = ['All', ...Array.from(new Set(purchaseTransactions.map(t => t.vendor)))];
  const uniqueCategories = ['All', ...Array.from(new Set(purchaseTransactions.map(t => t.category)))];

  const filtered = useMemo(() => {
    let data = [...purchaseTransactions];
    if (search) data = data.filter(r =>
      r.purchaseId.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase()) ||
      r.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase())
    );
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (paymentFilter !== 'All') data = data.filter(r => r.paymentStatus === paymentFilter);
    if (categoryFilter !== 'All') data = data.filter(r => r.category === categoryFilter);
    if (vendorFilter !== 'All') data = data.filter(r => r.vendor === vendorFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [purchaseTransactions, search, statusFilter, paymentFilter, categoryFilter, vendorFilter, sortField, sortDir]);
  // Paging gaya tab Purchase Source Data (pilih baris per halaman 10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [menuRowId, setMenuRowId] = useState<string | number | null>(null);
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, paymentFilter, categoryFilter, vendorFilter, sortField, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const companyName = clients.find(c => c.id === activeClientId)?.companyName || activeClientName || undefined;
  const printedBy = user?.nama || user?.username || undefined;

  // Print daftar = semua transaksi yang lolos filter (bukan cuma halaman aktif).
  const printList = (format: PrintFormat) => printReport(buildPurchaseListReport(filtered, companyName, printedBy), format);
  const printDetail = async (format: PrintFormat) => {
    if (!selectedRowWithLines) return;
    await printReport(buildPurchaseDetailReport(selectedRowWithLines, selectedRowWithLines.lines, companyName, printedBy), format);
  };

  // Alur: draft -> Approve -> approved -> Post -> posted (pindah ke tab Posted).
  const selectedRows = purchaseTransactions.filter(t => selectedIds.has(t.id));
  const bisaApprove = selectedRows.filter(t => ['draft', 'pending_review', 'exception'].includes(t.status)).length;
  const bisaPost = selectedRows.filter(t => ['approved', 'pending_posting'].includes(t.status)).length;

  const runBulk = async (action: 'approve' | 'post') => {
    setBulkBusy(action);
    const n = await runPurchaseStatusAction(action, [...selectedIds]);
    setBulkBusy(null);
    if (n > 0) setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => {
    const by = (st: PurchaseStatus) => {
      const rows = purchaseTransactions.filter(t => t.status === st);
      return { count: rows.length, amount: rows.reduce((s, t) => s + t.total, 0) };
    };
    return {
      total: purchaseTransactions.length,
      pendingReview: by('pending_review'),
      approved: by('approved'),
      posted: by('posted'),
      exceptions: by('exception'),
      totalAmount: purchaseTransactions.reduce((s, t) => s + t.total, 0),
    };
  }, [purchaseTransactions]);

  // Kartu KPI memakai desain yang sama dengan Purchase Source Data (ProgressKpiTile), tetap 6 kartu ukuran kecil.
  const pctOf = (n: number) => (summary.total > 0 ? Math.round((n / summary.total) * 100) : 0);
  const kpiTiles: {
    label: string; value: string | number; detail: string; detailUnit: string; pct: number;
    pctLabel: string; tone: KpiTone; icon: React.ElementType; compact?: boolean; barActive: boolean;
  }[] = [
    { label: 'Total', value: summary.total, detail: fmt(summary.totalAmount), detailUnit: 'gross', pct: summary.total > 0 ? 100 : 0, pctLabel: 'of all bills', tone: 'slate', icon: ShoppingBag, barActive: summary.total > 0 },
    { label: 'Pending Review', value: summary.pendingReview.count, detail: fmt(summary.pendingReview.amount), detailUnit: 'gross', pct: pctOf(summary.pendingReview.count), pctLabel: 'of all bills', tone: 'amber', icon: Clock, barActive: summary.pendingReview.count > 0 },
    { label: 'Approved', value: summary.approved.count, detail: fmt(summary.approved.amount), detailUnit: 'gross', pct: pctOf(summary.approved.count), pctLabel: 'of all bills', tone: 'green', icon: CheckCircle, barActive: summary.approved.count > 0 },
    { label: 'Posted', value: summary.posted.count, detail: fmt(summary.posted.amount), detailUnit: 'gross', pct: pctOf(summary.posted.count), pctLabel: 'of all bills', tone: 'sky', icon: FileCheck, barActive: summary.posted.count > 0 },
    { label: 'Exceptions', value: summary.exceptions.count, detail: fmt(summary.exceptions.amount), detailUnit: 'gross', pct: pctOf(summary.exceptions.count), pctLabel: 'of all bills', tone: 'amber', icon: AlertTriangle, barActive: summary.exceptions.count > 0 },
    { label: 'Total Amount', value: fmt(summary.totalAmount), detail: `${summary.total}`, detailUnit: 'bills', pct: summary.total > 0 ? 100 : 0, pctLabel: 'of gross value', tone: 'green', icon: CircleDollarSign, compact: true, barActive: summary.total > 0 },
  ];

  // Tombol aksi -- ditaruh di baris yang sama dengan tab, di sebelah kanan (sama dengan Source Data).
  const actionBar = (
    <div className="flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap">
      <Link href="/transactions/purchase/bill/new" className="btn-primary text-xs py-1.5 gap-1.5 whitespace-nowrap">
        <PlusIcon className="w-3.5 h-3.5" />Create Bill
      </Link>
      <PrintMenu
        onPrint={printList}
        label="Print All"
        align="right"
        disabled={filtered.length === 0}
        buttonClassName="flex items-center gap-1.5 text-xs py-1.5 px-3 rounded-xl border border-primary/60 hover:border-primary bg-card text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
      />
    </div>
  );

  const columns = [
    { label: 'Purchase ID', field: 'purchaseId', align: 'left' },
    { label: 'Date', field: 'purchaseDate', align: 'left' },
    { label: 'Invoice No.', field: 'invoiceNumber', align: 'left' },
    { label: 'PO Number', field: 'poNumber', align: 'left' },
    { label: 'Vendor', field: 'vendor', align: 'left' },
    { label: 'Category', field: 'category', align: 'left' },
    { label: 'Subtotal', field: 'subtotal', align: 'right' },
    { label: 'Tax', field: 'taxAmount', align: 'right' },
    { label: 'Total', field: 'total', align: 'right' },
    { label: 'Payment', field: 'paymentStatus', align: 'left' },
    { label: 'Due Date', field: 'dueDate', align: 'left' },
    { label: 'Status', field: 'status', align: 'left' },
    { label: 'Period', field: 'period', align: 'left' },
  ];

  const thBase = 'py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]';

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0 fade-in">
      <PurchaseTabs actions={actionBar} />

      <div className="pt-5 space-y-5">
        {/* Summary Cards -- desain KPI sama dengan Source Data, grid 6 kartu tetap */}
        <div className="!mt-4 grid grid-cols-2 md:grid-cols-6 gap-3">
          {kpiTiles.map(k => (
            <ProgressKpiTile
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.detail}
              detailUnit={k.detailUnit}
              pct={k.pct}
              pctLabel={k.pctLabel}
              tone={k.tone}
              icon={k.icon}
              compactValue={k.compact}
              barActive={k.barActive}
              size="compact"
            />
          ))}
        </div>

        {/* Transaction Table -- desain sama dengan Purchase Source Record List */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-2xl font-bold text-foreground">Purchase Transaction List</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {filtered.length === 0
                    ? `Showing 0 of ${purchaseTransactions.length} transactions`
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} transactions`}
                </p>
              </div>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                  <button
                    className="je-btn-secondary text-xs px-3 py-1.5 disabled:opacity-40"
                    disabled={bulkBusy !== null || bisaApprove === 0}
                    title="Draft / pending review → Approved"
                    onClick={() => runBulk('approve')}
                  >
                    {bulkBusy === 'approve' ? 'Approving…' : `Approve (${bisaApprove})`}
                  </button>
                  <button
                    className="je-btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                    disabled={bulkBusy !== null || bisaPost === 0}
                    title="Approved → Posted (moves to the Posted tab)"
                    onClick={() => runBulk('post')}
                  >
                    {bulkBusy === 'post' ? 'Posting…' : `Post (${bisaPost})`}
                  </button>
                  <button className="je-btn-secondary text-xs px-3 py-1.5" onClick={() => setSelectedIds(new Set())}>Clear</button>
                </div>
              )}
            </div>
            {/* Filter bar -- dropdown di kiri, kolom cari di kanan */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={[{ value: 'All', label: 'All Status' }, ...Object.entries(statusLabels).map(([k, v]) => ({ value: k, label: v }))]}
              />
              <FilterSelect
                value={paymentFilter}
                onChange={setPaymentFilter}
                options={[{ value: 'All', label: 'All Payment' }, ...Object.entries(paymentLabels).map(([k, v]) => ({ value: k, label: v }))]}
              />
              <FilterSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={uniqueCategories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
              />
              <FilterSelect
                value={vendorFilter}
                onChange={setVendorFilter}
                options={uniqueVendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
              />
              <div className="relative ml-auto w-full sm:w-[400px]">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by purchase ID, vendor, invoice number, PO number..."
                  className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1400px]">
              <thead>
                <tr className="bg-[#8FE3B5]">
                  <th className={`${thBase} w-8 text-left`}>
                    <input
                      type="checkbox"
                      className="rounded"
                      title={`Select all ${filtered.length} filtered transactions`}
                      checked={filtered.length > 0 && filtered.every(r => selectedIds.has(r.id))}
                      onChange={e => {
                        if (e.target.checked) setSelectedIds(new Set(filtered.map(r => r.id)));
                        else setSelectedIds(new Set());
                      }}
                    />
                  </th>
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`${thBase} cursor-pointer select-none hover:text-[#064E3B] ${col.align === 'right' ? 'text-right' : 'text-left'}`}
                    >
                      <span className={`inline-flex items-center gap-1 ${col.align === 'right' ? 'flex-row-reverse' : ''}`}>
                        {col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-60" />
                      </span>
                    </th>
                  ))}
                  <th className={`${thBase} text-left`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={15} className="py-8 text-center text-xs text-muted-foreground">No transactions match your filters.</td></tr>
                ) : paginated.map(row => (
                  <tr
                    key={row.id}
                    onClick={() => setSelectedRow(selectedRow?.id === row.id ? null : row)}
                    className={`border-b border-slate-400/80 cursor-pointer transition-colors text-xs ${selectedRow?.id === row.id || selectedIds.has(row.id) ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
                  >
                    <td className="py-2 px-2" onClick={e => { e.stopPropagation(); toggleSelect(row.id); }}>
                      <input type="checkbox" className="rounded" checked={selectedIds.has(row.id)} onChange={() => {}} />
                    </td>
                    <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{row.purchaseId}</td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.purchaseDate}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.invoiceNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.poNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{row.vendor}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`${BADGE_BASE} bg-muted text-muted-foreground`}>{row.category}</span>
                    </td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.subtotal)}</td>
                    <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(row.total)}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`${BADGE_BASE} ${paymentColors[row.paymentStatus]}`}>{paymentLabels[row.paymentStatus]}</span>
                    </td>
                    <td className={`py-2 px-2 whitespace-nowrap ${row.paymentStatus === 'overdue' ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>{row.dueDate}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`${BADGE_BASE} ${statusColors[row.status]}`}>{statusLabels[row.status]}</span>
                    </td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.period}</td>
                    <td className="py-2 px-2">
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuRowId(menuRowId === row.id ? null : row.id)}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={14} className="text-muted-foreground" />
                        </button>
                        {menuRowId === row.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuRowId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[140px] rounded-lg border border-border bg-card shadow-lg py-1">
                              <button
                                onClick={() => { setSelectedRow(row); setMenuRowId(null); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left"
                              >
                                <EyeIcon className="w-3 h-3" /> View detail
                              </button>
                              {BILL_EDITABLE.includes(row.status) && (
                                <Link
                                  href={`/transactions/purchase/bill/new?id=${row.id}`}
                                  onClick={() => setMenuRowId(null)}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left"
                                >
                                  <PencilSquareIcon className="w-3 h-3" /> Edit
                                </Link>
                              )}
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
                <span>Rows per page</span>
                <select value={pageSize} onChange={ev => { setPageSize(Number(ev.target.value)); setCurrentPage(1); }} className="border border-border rounded-lg px-2 py-1.5 text-xs font-medium text-foreground bg-card focus:outline-none focus:ring-2 focus:ring-primary/30">
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
                of <span className="font-semibold text-foreground">{filtered.length}</span> transactions
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
              {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                p === '…' ? (
                  <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                ) : (
                  <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-primary font-semibold text-primary-foreground shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}>{p}</button>
                )
              )}
              <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
            </div>
          </div>
        </div>

        {/* Detail Panel -- gaya SourcePanel Source Data */}
        {selectedRowWithLines && (
          <SourcePanel
            title={selectedRowWithLines.purchaseId}
            leading={
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]"><FileText size={17} /></span>
            }
            action={
              <div className="flex items-center gap-2">
                <PrintMenu onPrint={printDetail} />
                <button onClick={() => setSelectedRow(null)} className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-slate-600 hover:bg-slate-100">
                  <X size={13} /> Close
                </button>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className={`${BADGE_BASE} ${statusColors[selectedRowWithLines.status]}`}>{statusLabels[selectedRowWithLines.status]}</span>
              <span className={`${BADGE_BASE} ${paymentColors[selectedRowWithLines.paymentStatus]}`}>{paymentLabels[selectedRowWithLines.paymentStatus]}</span>
            </div>
            <p className="text-sm text-foreground font-medium">{selectedRowWithLines.description}</p>
            <p className="mb-4 text-sm text-muted-foreground">{selectedRowWithLines.vendor} · {selectedRowWithLines.category}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-4">
              {[
                { label: 'Invoice Number', value: selectedRowWithLines.invoiceNumber },
                { label: 'PO Number', value: selectedRowWithLines.poNumber },
                { label: 'Invoice Date', value: selectedRowWithLines.invoiceDate },
                { label: 'Due Date', value: selectedRowWithLines.dueDate },
                { label: 'Payment Terms', value: selectedRowWithLines.paymentTerms },
                { label: 'Period', value: selectedRowWithLines.period },
                { label: 'Created By', value: selectedRowWithLines.createdBy },
                { label: 'Approved By', value: selectedRowWithLines.approvedBy || '—' },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            {/* Line Items */}
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#8FE3B5]">
                    <th className="px-3 py-2 text-left font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Item/Service</th>
                    <th className="px-3 py-2 text-right font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Qty</th>
                    <th className="px-3 py-2 text-right font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Unit Price</th>
                    <th className="px-3 py-2 text-right font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Discount</th>
                    <th className="px-3 py-2 text-right font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Tax</th>
                    <th className="px-3 py-2 text-right font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Total</th>
                    <th className="px-3 py-2 text-left font-bold text-[#065F46] border-t-2 border-b border-[#0A4A32]">Account</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRowWithLines.lines.map(line => (
                    <tr key={line.id} className="border-b border-slate-400/80 hover:bg-slate-200/70 transition-colors">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{line.description}</p>
                        {line.itemCode && <p className="text-muted-foreground">{line.itemCode}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity} {line.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(line.taxAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(line.total)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{kodeAkun(line.accountCode)} · {line.accountName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Subtotal</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRowWithLines.subtotal)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Discount</p>
                <p className="text-base font-bold text-red-600 tabular-nums">-{fmt(selectedRowWithLines.discount)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Tax (Input VAT)</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRowWithLines.taxAmount)}</p>
              </div>
              <div className="rounded-xl border border-[#6EE7B7]/60 bg-[#ECFDF5] p-3">
                <p className="text-xs font-medium text-[#047857]">Total Payable</p>
                <p className="text-base font-bold text-[#064E3B] tabular-nums">{fmt(selectedRowWithLines.total)}</p>
              </div>
            </div>
            {selectedRowWithLines.notes && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                <p className="text-xs text-amber-700">{selectedRowWithLines.notes}</p>
              </div>
            )}
          </SourcePanel>
        )}
      </div>
    </div>
  );
}