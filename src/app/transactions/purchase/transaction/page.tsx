'use client';

import React, { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { runPurchaseStatusAction } from '@/app/transactions/purchase/components/purchaseStatusActions';
import type { PurchaseStatus, PaymentStatus } from '@/data/purchaseData';
import { buildPurchaseListReport, buildPurchaseDetailReport } from '@/app/transactions/purchase/components/purchasePrintReports';
import { Search, ShoppingBag, Clock, CheckCircle, FileCheck, AlertTriangle, CircleDollarSign, MoreHorizontal, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, FileText, Eye, Edit, Calendar } from 'lucide-react';
import { formatTanggalSingkat } from '@/lib/salesStore';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import PrintMenu from '@/components/shared/PrintMenu';
import { printReport, type PrintFormat } from '@/lib/printExport';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useAuth } from '@/lib/auth';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';

// Status yang masih bisa diubah lewat form Create Bill (sama dengan purchase_bill_v1.STATUS_BISA_DIUBAH).
const BILL_EDITABLE: PurchaseStatus[] = ['draft', 'pending_review', 'rejected', 'exception'];

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

// Pill status -- desain SAMA PERSIS dengan StatusPill di Sales Transaction (pill bergaris + titik berwarna).
const PILL: Record<string, { pill: string; dot: string }> = {
  slate: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
  amber: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  blue: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  sky: { pill: 'bg-sky-100 text-sky-800 border-sky-300', dot: 'bg-sky-600' },
  teal: { pill: 'bg-teal-100 text-teal-800 border-teal-300', dot: 'bg-teal-600' },
  orange: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  emerald: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  red: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  neutral: { pill: 'bg-neutral-100 text-neutral-600 border-neutral-300', dot: 'bg-neutral-400' },
  violet: { pill: 'bg-violet-100 text-violet-800 border-violet-300', dot: 'bg-violet-600' },
};

function StatusPill({ tone, label }: { tone: keyof typeof PILL; label: string }) {
  const st = PILL[tone] || PILL.neutral;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-full font-medium border ${st.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{label}
    </span>
  );
}

const statusTones: Record<PurchaseStatus, keyof typeof PILL> = {
  draft: 'slate',
  pending_review: 'amber',
  approved: 'blue',
  pending_posting: 'sky',
  posted: 'teal',
  rejected: 'red',
  exception: 'orange',
  cancelled: 'neutral',
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

const paymentTones: Record<PaymentStatus, keyof typeof PILL> = {
  unpaid: 'red',
  partially_paid: 'orange',
  paid: 'emerald',
  overdue: 'red',
  on_hold: 'slate',
  non_cash: 'violet',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
  non_cash: 'Non-Cash',
};

// Kolom nominal (header & isi rata kanan) & gaya tombol netral -- sama dengan Sales Transaction.
const NUMERIC_FIELDS = ['subtotal', 'taxAmount', 'total'];

// Format tanggal sama persis dengan halaman Sales: "04 Jun 2026" (tgl 2 digit, bulan singkat, tahun).
function formatTanggal(iso?: string): string {
  const v = (iso || '').slice(0, 10);
  if (!v) return '-'; // transaksi tanpa tanggal tampil "-"
  try {
    const d = new Date(v + 'T00:00:00');
    if (isNaN(d.getTime())) return v;
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')} ${names[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return v;
  }
}
const PRINT_BTN = 'flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50';
const BTN_SECONDARY = 'border border-neutral-300 bg-white rounded-lg text-xs font-semibold text-neutral-800 shadow-sm hover:border-neutral-700 hover:bg-neutral-50 transition-colors';
const BTN_PRIMARY = 'border border-blue-600 bg-blue-600 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-blue-700 transition-colors';

// Kartu KPI -- desain sama persis dengan SalesKpiTile di Sales Transaction (garis aksen hitam tipis,
// ikon kecil, angka semibold, bar proporsi netral, hover garis hitam).
function PurchaseKpiTile({ label, value, detail, pct, pctLabel, icon: Icon, barActive }: {
  label: string;
  value: number | string;
  detail: string;
  pct: number;
  pctLabel: string;
  icon: React.ElementType;
  barActive: boolean;
}) {
  const p = Math.min(100, Math.max(0, Math.round(Number.isFinite(pct) ? pct : 0)));
  const shown = typeof value === 'number' ? value.toLocaleString('id-ID') : value;
  return (
    <div className="relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700">
      <span className="absolute inset-x-0 top-0 h-0.5 bg-blue-600" />
      <div className="relative flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>{label}</p>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Icon size={16} className="text-blue-600" />
        </span>
      </div>
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900" title={shown}>{shown}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-blue-600" style={{ width: `${barActive && p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Panel detail -- sama dengan SourcePanel di Source Data Sales (border neutral-300, garis aksen hitam tipis
// di atas, header neutral-50, judul neutral-900).
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';

function SourcePanel({ title, leading, action, children }: {
  title: string; leading?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
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
  // Filter periode tanggal (sama dengan Sales Transaction). Kosong = semua tanggal.
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sortField, setSortField] = useState('purchaseDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
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
    // purchaseDate = 'YYYY-MM-DD' (bisa kosong untuk transaksi tanpa tanggal -> ikut tersaring kalau periode diisi).
    if (dateStart) data = data.filter(r => !!r.purchaseDate && r.purchaseDate.slice(0, 10) >= dateStart);
    if (dateEnd) data = data.filter(r => !!r.purchaseDate && r.purchaseDate.slice(0, 10) <= dateEnd);
    const byId = (a: { purchaseId: string }, b: { purchaseId: string }) =>
      a.purchaseId.localeCompare(b.purchaseId, undefined, { numeric: true });
    data.sort((a, b) => {
      if (sortField === 'purchaseDate') {
        const da = (a.purchaseDate || '').slice(0, 10);
        const db = (b.purchaseDate || '').slice(0, 10);
        if (da !== db) {
          if (!da) return -1; // tanpa tanggal selalu paling atas (tampil "-"), apa pun arah sortirnya
          if (!db) return 1;
          return (da < db ? -1 : 1) * (sortDir === 'asc' ? 1 : -1);
        }
        return byId(a, b);
      }
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [purchaseTransactions, search, statusFilter, paymentFilter, categoryFilter, vendorFilter, dateStart, dateEnd, sortField, sortDir]);
  // Paging gaya tab Purchase Source Data (pilih baris per halaman 10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  const [menuRowId, setMenuRowId] = useState<string | number | null>(null);
  useEffect(() => { setCurrentPage(1); }, [search, statusFilter, paymentFilter, categoryFilter, vendorFilter, dateStart, dateEnd, sortField, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir(field === 'purchaseDate' ? 'asc' : 'desc'); }
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

  // Kartu KPI -- desain sama dengan SalesKpiTile (Sales Transaction), tetap 6 kartu.
  const pctOf = (n: number) => (summary.total > 0 ? Math.round((n / summary.total) * 100) : 0);
  const kpiTiles: {
    label: string; value: string | number; detail: string; pct: number;
    pctLabel: string; icon: React.ElementType; barActive: boolean;
  }[] = [
    { label: 'Total', value: summary.total, detail: `${fmt(summary.totalAmount)} gross`, pct: summary.total > 0 ? 100 : 0, pctLabel: 'of all bills', icon: ShoppingBag, barActive: summary.total > 0 },
    { label: 'Pending Review', value: summary.pendingReview.count, detail: `${fmt(summary.pendingReview.amount)} gross`, pct: pctOf(summary.pendingReview.count), pctLabel: 'of all bills', icon: Clock, barActive: summary.pendingReview.count > 0 },
    { label: 'Approved', value: summary.approved.count, detail: `${fmt(summary.approved.amount)} gross`, pct: pctOf(summary.approved.count), pctLabel: 'of all bills', icon: CheckCircle, barActive: summary.approved.count > 0 },
    { label: 'Posted', value: summary.posted.count, detail: `${fmt(summary.posted.amount)} gross`, pct: pctOf(summary.posted.count), pctLabel: 'of all bills', icon: FileCheck, barActive: summary.posted.count > 0 },
    { label: 'Exceptions', value: summary.exceptions.count, detail: `${fmt(summary.exceptions.amount)} gross`, pct: pctOf(summary.exceptions.count), pctLabel: 'of all bills', icon: AlertTriangle, barActive: summary.exceptions.count > 0 },
    { label: 'Total Amount', value: fmt(summary.totalAmount), detail: `${summary.total} bills`, pct: summary.total > 0 ? 100 : 0, pctLabel: 'of gross value', icon: CircleDollarSign, barActive: summary.total > 0 },
  ];

  // Tombol Add Transaction (ex Create Bill) sudah dipindah ke header semua tab (PurchaseTabs).
  // (Print All dipindah ke header tabel, seperti di Sales.)

  const columns = [
    { label: 'Date', field: 'purchaseDate' },
    { label: 'Purchase ID', field: 'purchaseId' },
    { label: 'Invoice No.', field: 'invoiceNumber' },
    { label: 'PO Number', field: 'poNumber' },
    { label: 'Vendor', field: 'vendor' },
    { label: 'Category', field: 'category' },
    { label: 'Subtotal', field: 'subtotal' },
    { label: 'Tax', field: 'taxAmount' },
    { label: 'Total', field: 'total' },
    { label: 'Payment', field: 'paymentStatus' },
    { label: 'Due Date', field: 'dueDate' },
    { label: 'Status', field: 'status' },
    { label: 'Period', field: 'period' },
  ];
  const COL_COUNT = columns.length + 2; // + checkbox + Actions

  const thCls = 'py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800';

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      <PurchaseTabs variant="elegant" />

      <div className={`${salesFont.className} pt-5 space-y-4`}>
        {/* KPI Cards -- desain sama dengan Sales Transaction, grid 6 kartu */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {kpiTiles.map(k => (
            <PurchaseKpiTile
              key={k.label}
              label={k.label}
              value={k.value}
              detail={k.detail}
              pct={k.pct}
              pctLabel={k.pctLabel}
              icon={k.icon}
              barActive={k.barActive}
            />
          ))}
        </div>

        {/* Table + Detail */}
        <div className="flex gap-4 !mt-1">
          <div className="card flex-1 min-w-0 w-full">
            {/* Header + filter bar -- sama dengan Sales Transaction List: judul kiri, Reset + Print All kanan; dropdown filter kiri, kolom cari (400px) kanan */}
            <div className="flex flex-col gap-3 px-0 py-3 border-b border-border">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Purchase Transaction List</h3>
                  <p className="text-sm text-neutral-500 mt-0.5">
                    {filtered.length === 0
                      ? `Showing 0 of ${purchaseTransactions.length} transactions`
                      : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} transactions`}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => { setSearch(''); setStatusFilter('All'); setPaymentFilter('All'); setCategoryFilter('All'); setVendorFilter('All'); setDateStart(''); setDateEnd(''); }}
                    className="text-xs font-semibold text-neutral-700 hover:text-neutral-900 hover:underline"
                  >
                    Reset
                  </button>
                  <PrintMenu
                    onPrint={printList}
                    label="Print All"
                    align="right"
                    disabled={filtered.length === 0}
                    buttonClassName={PRINT_BTN}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <button onClick={() => setShowDatePicker(v => !v)} className={`flex items-center gap-1.5 text-xs border rounded-[6px] px-3 py-1.5 bg-card transition-colors ${showDatePicker ? 'border-neutral-700 ring-2 ring-neutral-300' : 'border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50'}`}>
                    <Calendar size={12} className="text-neutral-500" />
                    <span className="text-neutral-500">Date Period</span>
                    <span className="font-medium text-neutral-900">
                      {dateStart ? formatTanggalSingkat(dateStart) : 'All'}
                      {dateEnd ? ` – ${formatTanggalSingkat(dateEnd)}` : ''}
                    </span>
                  </button>
                  {showDatePicker && (
                    <div className="absolute z-30 top-full mt-1 left-0 w-64 space-y-2 rounded-[6px] border border-neutral-300 bg-white p-3 shadow-xl">
                      <div>
                        <label className="text-[11px] font-medium text-neutral-500">From</label>
                        <input type="date" value={dateStart} max={dateEnd || undefined} onChange={ev => setDateStart(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                      </div>
                      <div>
                        <label className="text-[11px] font-medium text-neutral-500">To</label>
                        <input type="date" value={dateEnd} min={dateStart || undefined} onChange={ev => setDateEnd(ev.target.value)} className="w-full text-xs border border-neutral-300 rounded-[6px] px-2 py-1.5 bg-white text-neutral-900 mt-0.5 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300" />
                      </div>
                      <div className="flex gap-2">
                        {(dateStart || dateEnd) && (
                          <button onClick={() => { setDateStart(''); setDateEnd(''); setShowDatePicker(false); }} className="flex-1 rounded-[6px] border border-neutral-300 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                            Clear
                          </button>
                        )}
                        <button onClick={() => setShowDatePicker(false)} className="flex-1 rounded-[6px] bg-blue-600 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-700">
                          Apply
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <FilterSelect
                  variant="elegant"
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={[{ value: 'All', label: 'All Status' }, ...Object.entries(statusLabels).map(([k, v]) => ({ value: k, label: v }))]}
                />
                <FilterSelect
                  variant="elegant"
                  value={paymentFilter}
                  onChange={setPaymentFilter}
                  options={[{ value: 'All', label: 'All Payment' }, ...Object.entries(paymentLabels).map(([k, v]) => ({ value: k, label: v }))]}
                />
                <FilterSelect
                  variant="elegant"
                  value={categoryFilter}
                  onChange={setCategoryFilter}
                  options={uniqueCategories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
                />
                <FilterSelect
                  variant="elegant"
                  value={vendorFilter}
                  onChange={setVendorFilter}
                  options={uniqueVendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
                />
                <div className="relative ml-auto w-full sm:w-[400px]">
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
            {selectedIds.size > 0 && (
              <div className="flex flex-wrap items-center gap-3 border-b border-border bg-neutral-50 px-3 py-2 text-xs">
                <span className="font-semibold text-neutral-900">{selectedIds.size} selected</span>
                <div className="ml-auto flex items-center gap-2">
                  <button className="rounded-lg px-2.5 py-1.5 font-semibold text-neutral-700 hover:bg-neutral-200" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
                  <button
                    className={`${BTN_SECONDARY} px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed`}
                    disabled={bulkBusy !== null || bisaApprove === 0}
                    title="Draft / pending review → Approved"
                    onClick={() => runBulk('approve')}
                  >
                    {bulkBusy === 'approve' ? 'Approving…' : `Approve (${bisaApprove})`}
                  </button>
                  <button
                    className={`${BTN_PRIMARY} px-3 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed`}
                    disabled={bulkBusy !== null || bisaPost === 0}
                    title="Approved → Posted (moves to the Posted tab)"
                    onClick={() => runBulk('post')}
                  >
                    {bulkBusy === 'post' ? 'Posting…' : `Post (${bisaPost})`}
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1100px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className="py-2 px-3 w-8 leading-none border-t border-b border-neutral-800">
                      <input
                        type="checkbox"
                        className="block rounded border-neutral-400 accent-neutral-800"
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
                        aria-sort={sortField === col.field ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                        title="Click to sort"
                        className={`${thCls} cursor-pointer select-none ${NUMERIC_FIELDS.includes(col.field) ? 'text-right' : 'text-left'}`}
                      >
                        {/* Teks polos seperti header Sales; penanda sortir diposisikan absolut (hanya di kolom aktif)
                            supaya tidak menambah lebar/tinggi header. */}
                        <span className="relative">
                          {col.label}
                          {sortField === col.field && (
                            sortDir === 'asc'
                              ? <ChevronUp size={12} className={`absolute top-1/2 -translate-y-1/2 ${NUMERIC_FIELDS.includes(col.field) ? 'right-full mr-0.5' : 'left-full ml-0.5'}`} />
                              : <ChevronDown size={12} className={`absolute top-1/2 -translate-y-1/2 ${NUMERIC_FIELDS.includes(col.field) ? 'right-full mr-0.5' : 'left-full ml-0.5'}`} />
                          )}
                        </span>
                      </th>
                    ))}
                    <th className={`${thCls} text-left`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={COL_COUNT} className="py-2 px-2 text-center text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No transactions match your filters.</span></td></tr>
                  )}
                  {paginated.map(row => (
                    <tr
                      key={row.id}
                      onClick={() => setSelectedRow(selectedRow?.id === row.id ? null : row)}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedRow?.id === row.id || selectedIds.has(row.id) ? '[&>td]:bg-neutral-100' : ''}`}
                    >
                      <td className="py-2 px-3" onClick={e => { e.stopPropagation(); toggleSelect(row.id); }}>
                        <input type="checkbox" className="rounded border-neutral-400 accent-neutral-800" checked={selectedIds.has(row.id)} onChange={() => {}} />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{formatTanggal(row.purchaseDate)}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{row.purchaseId}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.invoiceNumber || <span className="text-neutral-600">—</span>}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{row.poNumber || <span className="text-neutral-600">—</span>}</td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-neutral-900 max-w-[160px] truncate">{row.vendor}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.category}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right tabular-nums">{fmt(row.subtotal)}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right tabular-nums">{fmt(row.taxAmount)}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right font-semibold tabular-nums">{fmt(row.total)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <StatusPill tone={paymentTones[row.paymentStatus]} label={paymentLabels[row.paymentStatus]} />
                      </td>
                      <td className={`py-2 px-2 whitespace-nowrap ${row.paymentStatus === 'overdue' ? 'font-semibold text-red-600' : 'text-neutral-600'}`}>{formatTanggal(row.dueDate)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <StatusPill tone={statusTones[row.status]} label={statusLabels[row.status]} />
                      </td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{row.period}</td>
                      <td className="py-2 px-2 relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuRowId(menuRowId === row.id ? null : row.id)}
                          className="p-1 hover:bg-neutral-300 rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={13} className="text-neutral-600" />
                        </button>
                        {menuRowId === row.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuRowId(null)} />
                            <div className="absolute z-20 right-2 top-full mt-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg">
                              <button
                                onClick={() => { setSelectedRow(row); setMenuRowId(null); }}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md"
                              >
                                <Eye size={12} /> View detail
                              </button>
                              {BILL_EDITABLE.includes(row.status) && (
                                <Link
                                  href={`/transactions/purchase/bill/new?id=${row.id}`}
                                  onClick={() => setMenuRowId(null)}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md"
                                >
                                  <Edit size={12} /> Edit
                                </Link>
                              )}
                            </div>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                  {/* Baris kosong pengisi: tinggi tabel selalu = "Rows per page", supaya layar tidak bergeser (sama dengan Sales). */}
                  {Array.from({ length: Math.max(0, pageSize - (paginated.length > 0 ? paginated.length : 1)) }).map((_, i) => (
                    <tr key={`pad-${i}`} aria-hidden="true" className="invisible text-xs">
                      <td colSpan={COL_COUNT} className="py-2 px-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium">&nbsp;</span>
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
                  of <span className="font-semibold text-neutral-900">{filtered.length}</span> transactions
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
                {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-blue-600 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                  )
                )}
                <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>
        </div>

        {/* Detail Panel -- gaya SourcePanel Sales */}
        {selectedRowWithLines && (
          <SourcePanel
            title={selectedRowWithLines.purchaseId}
            leading={
              <span className={PANEL_ICON_CHIP}><FileText size={17} /></span>
            }
            action={
              <div className="flex items-center gap-2">
                <PrintMenu onPrint={printDetail} buttonClassName={PRINT_BTN} />
                <button onClick={() => setSelectedRow(null)} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-800 shadow-sm transition-colors hover:border-neutral-700 hover:bg-neutral-50">
                  <X size={13} /> Close
                </button>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <StatusPill tone={statusTones[selectedRowWithLines.status]} label={statusLabels[selectedRowWithLines.status]} />
              <StatusPill tone={paymentTones[selectedRowWithLines.paymentStatus]} label={paymentLabels[selectedRowWithLines.paymentStatus]} />
            </div>
            <p className="text-sm font-semibold text-neutral-900">{selectedRowWithLines.description}</p>
            <p className="mb-4 text-sm text-neutral-600">{selectedRowWithLines.vendor} · {selectedRowWithLines.category}</p>
            <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-4">
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
                  <p className="text-xs font-medium text-neutral-500">{item.label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-neutral-900">{item.value}</p>
                </div>
              ))}
            </div>
            {/* Line Items -- tabel gaya sama dengan File Preview di Source Data Sales */}
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full select-text border-separate border-spacing-0 text-xs">
                <thead>
                  <tr className="bg-neutral-300">
                    <th className={`${thCls} text-left`}>Item/Service</th>
                    <th className={`${thCls} text-right`}>Qty</th>
                    <th className={`${thCls} text-right`}>Unit Price</th>
                    <th className={`${thCls} text-right`}>Discount</th>
                    <th className={`${thCls} text-right`}>Tax</th>
                    <th className={`${thCls} text-right`}>Total</th>
                    <th className={`${thCls} text-left`}>Account</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRowWithLines.lines.map(line => (
                    <tr key={line.id} className="[&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200">
                      <td className="px-2 py-2">
                        <p className="font-medium text-neutral-900">{line.description}</p>
                        {line.itemCode && <p className="text-neutral-500">{line.itemCode}</p>}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{line.quantity} {line.unit}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-red-600">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums">{fmt(line.taxAmount)}</td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-semibold tabular-nums">{fmt(line.total)}</td>
                      <td className="px-2 py-2 text-neutral-600">{kodeAkun(line.accountCode)} · {line.accountName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 border-t border-neutral-200 pt-4">
              {[
                { label: 'Subtotal', value: fmt(selectedRowWithLines.subtotal), cls: 'text-neutral-900' },
                { label: 'Discount', value: `-${fmt(selectedRowWithLines.discount)}`, cls: 'text-red-600' },
                { label: 'Tax (Input VAT)', value: fmt(selectedRowWithLines.taxAmount), cls: 'text-neutral-900' },
                { label: 'Total Payable', value: fmt(selectedRowWithLines.total), cls: 'text-neutral-900' },
              ].map(st => (
                <div key={st.label} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2.5">
                  <p className="truncate text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">{st.label}</p>
                  <p className={`mt-1.5 truncate text-lg font-semibold leading-none tabular-nums tracking-tight ${st.cls}`}>{st.value}</p>
                </div>
              ))}
            </div>
            {selectedRowWithLines.notes && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-100/60 px-4 py-2.5">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 ring-1 ring-amber-300"><AlertTriangle size={12} /></span>
                <p className="text-xs font-medium text-amber-900">{selectedRowWithLines.notes}</p>
              </div>
            )}
          </SourcePanel>
        )}
      </div>
    </div>
  );
}