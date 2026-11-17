'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import type { ExceptionSeverity, ExceptionStatus } from '@/data/purchaseData';
import { salesFont } from '@/app/transactions/sales/components/salesFont';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions, updatePurchaseException, mapExceptionToUi } from '@/lib/purchaseStore';
import { Search, AlertTriangle, AlertCircle, Clock, CheckCircle, MoreHorizontal, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, X, Eye, Edit } from 'lucide-react';

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

// Pill bergaris + titik berwarna -- desain SAMA PERSIS dengan Pill di Sales Exceptions / Sales Transaction.
type PillStyle = { pill: string; dot: string };

const severityStyle: Record<ExceptionSeverity, PillStyle> = {
  Critical: { pill: 'bg-red-100 text-red-800 border-red-300', dot: 'bg-red-600' },
  High: { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Medium: { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  Low: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
};

const statusStyle: Record<ExceptionStatus, PillStyle> = {
  Open: { pill: 'bg-blue-100 text-blue-800 border-blue-300', dot: 'bg-blue-600' },
  'Under Review': { pill: 'bg-amber-100 text-amber-900 border-amber-300', dot: 'bg-amber-600' },
  'Requires Correction': { pill: 'bg-orange-100 text-orange-800 border-orange-300', dot: 'bg-orange-600' },
  Resolved: { pill: 'bg-emerald-100 text-emerald-800 border-emerald-300', dot: 'bg-emerald-600' },
  Ignored: { pill: 'bg-slate-200 text-slate-800 border-slate-400', dot: 'bg-slate-500' },
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

// Gaya tombol netral (putih bergaris abu = sekunder, hitam = utama) -- sama dengan Sales Exceptions.
const BTN_SECONDARY = 'border border-neutral-300 bg-white rounded-lg text-xs font-semibold text-neutral-800 shadow-sm hover:border-neutral-700 hover:bg-neutral-50 transition-colors';
const BTN_PRIMARY = 'bg-neutral-800 text-white rounded-lg text-xs font-semibold shadow-sm hover:bg-neutral-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

// Kolom nominal (header & isi rata kanan).
const NUMERIC_FIELDS = ['amount'];

// Kartu KPI -- desain sama persis dengan ExceptionKpiTile di Sales Exceptions (garis aksen hitam tipis,
// ikon kecil, angka semibold, bar proporsi netral, hover garis hitam).
function ExceptionKpiTile({ label, count, detail, detailUnit, pct, pctLabel, icon: Icon }: {
  label: string;
  count: number;
  detail: string;
  detailUnit: string;
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
      <p className="relative mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-neutral-900">{count.toLocaleString('id-ID')}</p>
      <p className="relative h-4 truncate text-[11px] font-medium text-neutral-500">{detail} {detailUnit}</p>
      <div className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
        <div className="h-full rounded-full bg-neutral-800" style={{ width: `${p > 0 ? Math.max(p, 3) : 0}%` }} />
      </div>
      <p className="relative mt-1 truncate text-[11px] font-medium text-neutral-600">{p}% {pctLabel}</p>
    </div>
  );
}

// Panel -- sama dengan SourcePanel di Source Data Sales (border neutral-300, garis aksen hitam tipis di atas,
// header neutral-50, judul neutral-900).
const PANEL_ICON_CHIP = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200';

function SourcePanel({ title, leading, action, children }: {
  title: string; leading?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-neutral-300 bg-white shadow-sm">
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

export default function PurchaseExceptionsPage() {
  const { activeClientId } = useActiveClient();
  // Filter Purchase = company aktif ("Switch Company"), dikirim sbg management_client_id -- lihat purchaseStore.tsx.
  const clientId = activeClientId ?? null;
  const { exceptions: backendExceptions } = usePurchaseExceptions(clientId);
  const purchaseExceptions = useMemo(() => backendExceptions.map(mapExceptionToUi), [backendExceptions]);

  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [sortField, setSortField] = useState('detectedDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedExc, setSelectedExc] = useState<typeof purchaseExceptions[0] | null>(null);
  const [resolveMap, setResolveMap] = useState<Record<string, ExceptionStatus>>({});
  const [menuRowId, setMenuRowId] = useState<string | number | null>(null);

  const exceptionTypes = ['All', ...Array.from(new Set(purchaseExceptions.map(e => e.exceptionType)))];
  const uniqueVendors = ['All', ...Array.from(new Set(purchaseExceptions.map(e => e.vendor)))];

  const getStatus = (exc: typeof purchaseExceptions[0]): ExceptionStatus => resolveMap[exc.id] || exc.status;

  const filtered = useMemo(() => {
    let data = purchaseExceptions.map(e => ({ ...e, status: resolveMap[e.id] || e.status }));
    if (search) data = data.filter(r =>
      r.purchaseId.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.exceptionType.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase()) ||
      r.invoiceNumber.toLowerCase().includes(search.toLowerCase())
    );
    if (severityFilter !== 'All') data = data.filter(r => r.severity === severityFilter);
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (typeFilter !== 'All') data = data.filter(r => r.exceptionType === typeFilter);
    if (vendorFilter !== 'All') data = data.filter(r => r.vendor === vendorFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [purchaseExceptions, search, severityFilter, statusFilter, typeFilter, vendorFilter, resolveMap, sortField, sortDir]);

  // Paging gaya tab Purchase Source Data (pilih baris per halaman 10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [search, severityFilter, statusFilter, typeFilter, vendorFilter, sortField, sortDir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const summary = useMemo(() => {
    const st = (e: typeof purchaseExceptions[0]) => resolveMap[e.id] || e.status;
    const group = (rows: typeof purchaseExceptions) => ({ count: rows.length, amount: rows.reduce((s, e) => s + e.amount, 0) });
    return {
      total: group(purchaseExceptions),
      open: group(purchaseExceptions.filter(e => st(e) === 'Open')),
      critical: group(purchaseExceptions.filter(e => e.severity === 'Critical')),
      underReview: group(purchaseExceptions.filter(e => st(e) === 'Under Review')),
      resolved: group(purchaseExceptions.filter(e => st(e) === 'Resolved')),
    };
  }, [purchaseExceptions, resolveMap]);

  const handleStatusChange = (id: string, status: ExceptionStatus) => {
    setResolveMap(prev => ({ ...prev, [id]: status }));
    if (selectedExc?.id === id) setSelectedExc(prev => prev ? { ...prev, status } : null);
    updatePurchaseException(id, { status }).catch(err => {
      toast.error(err instanceof Error ? err.message : 'Failed to update exception status.');
    });
  };

  // Kartu KPI -- desain sama dengan ExceptionKpiTile (Sales Exceptions), 5 kartu.
  const pctOf = (n: number) => (summary.total.count > 0 ? Math.round((n / summary.total.count) * 100) : 0);
  const kpiTiles: { label: string; g: { count: number; amount: number }; icon: React.ElementType }[] = [
    { label: 'Total Exceptions', g: summary.total, icon: AlertTriangle },
    { label: 'Open', g: summary.open, icon: AlertCircle },
    { label: 'Critical', g: summary.critical, icon: AlertTriangle },
    { label: 'Under Review', g: summary.underReview, icon: Clock },
    { label: 'Resolved', g: summary.resolved, icon: CheckCircle },
  ];

  const columns = [
    { label: 'Purchase ID', field: 'purchaseId' },
    { label: 'Exception Type', field: 'exceptionType' },
    { label: 'Severity', field: 'severity' },
    { label: 'Status', field: 'status' },
    { label: 'Vendor', field: 'vendor' },
    { label: 'Invoice No.', field: 'invoiceNumber' },
    { label: 'Date', field: 'purchaseDate' },
    { label: 'Detected', field: 'detectedDate' },
    { label: 'Amount', field: 'amount' },
    { label: 'Assigned To', field: 'assignedTo' },
  ];
  const COL_COUNT = columns.length + 1; // + kolom Actions
  const thCls = 'py-2 px-2 text-xs font-bold text-black whitespace-nowrap border-t border-b border-neutral-800';

  // Ikon kecil untuk tiap aksi status (menu titik tiga & drawer).
  const actionIcon = (to: ExceptionStatus, label: string) => {
    if (to === 'Resolved') return <CheckCircle size={12} />;
    if (to === 'Ignored') return <X size={12} />;
    if (label === 'Flag') return <AlertTriangle size={12} />;
    if (label === 'Begin Correction') return <Edit size={12} />;
    return <Clock size={12} />;
  };

  // Aksi status per baris (menu titik tiga & panel detail).
  const statusActions = (exc: typeof purchaseExceptions[0]): { label: string; to: ExceptionStatus }[] => {
    const st = getStatus(exc);
    const acts: { label: string; to: ExceptionStatus }[] = [];
    if (st === 'Open') acts.push({ label: 'Start Review', to: 'Under Review' }, { label: 'Flag', to: 'Requires Correction' });
    if (st === 'Under Review') acts.push({ label: 'Mark Resolved', to: 'Resolved' });
    if (st === 'Requires Correction') acts.push({ label: 'Begin Correction', to: 'Under Review' });
    if (st !== 'Resolved' && st !== 'Ignored') acts.push({ label: 'Ignore', to: 'Ignored' });
    return acts;
  };

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0">
      <PurchaseTabs variant="elegant" />

      <div className={`${salesFont.className} pt-5 space-y-4`}>
        {/* KPI Cards -- desain sama dengan Sales Exceptions */}
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {kpiTiles.map(k => (
            <ExceptionKpiTile
              key={k.label}
              label={k.label}
              count={k.g.count}
              detail={fmt(k.g.amount)}
              detailUnit="affected"
              pct={pctOf(k.g.count)}
              pctLabel="of all exceptions"
              icon={k.icon}
            />
          ))}
        </div>

        {/* Exception Type Breakdown */}
        <SourcePanel
          title="Exception Breakdown by Type"
          leading={<span className={PANEL_ICON_CHIP}><AlertTriangle size={17} /></span>}
        >
          {purchaseExceptions.length === 0 ? (
            <p className="text-xs text-neutral-500">No exceptions detected.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {purchaseExceptions.map(exc => (
                <div key={exc.id} className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <span className="min-w-0 truncate text-xs text-neutral-900">{exc.exceptionType}</span>
                  <Pill style={severityStyle[exc.severity]} label={exc.severity} />
                </div>
              ))}
            </div>
          )}
        </SourcePanel>

        {/* Filters -- baris terpisah di atas tabel, sama dengan Sales Exceptions */}
        <div className="card relative px-0 pb-0 pt-3">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterSelect
              variant="elegant"
              value={severityFilter}
              onChange={setSeverityFilter}
              options={['All', 'Critical', 'High', 'Medium', 'Low'].map(v => ({ value: v, label: v === 'All' ? 'All Severity' : v }))}
            />
            <FilterSelect
              variant="elegant"
              value={statusFilter}
              onChange={setStatusFilter}
              options={['All', 'Open', 'Under Review', 'Requires Correction', 'Resolved', 'Ignored'].map(v => ({ value: v, label: v === 'All' ? 'All Status' : v }))}
            />
            <FilterSelect
              variant="elegant"
              value={typeFilter}
              onChange={setTypeFilter}
              options={exceptionTypes.map(v => ({ value: v, label: v === 'All' ? 'All Types' : v }))}
            />
            <FilterSelect
              variant="elegant"
              value={vendorFilter}
              onChange={setVendorFilter}
              options={uniqueVendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
            />
          </div>
        </div>

        {/* Table + Drawer */}
        <div className="flex gap-4">
          {/* Table */}
          <div className="card overflow-hidden flex-1 min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-3 px-0 pb-3 pt-1 border-b border-border">
              <div>
                <h3 className="text-2xl font-semibold tracking-tight text-neutral-900">Purchase Exception List</h3>
                <p className="text-sm text-neutral-500 mt-0.5">
                  {filtered.length === 0
                    ? `Showing 0 of ${purchaseExceptions.length} exceptions`
                    : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} exceptions`}
                </p>
              </div>
              <div className="ml-auto flex w-full flex-col items-end gap-1.5 sm:w-auto">
                <div className="relative w-full sm:w-[400px]">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
                  <input
                    type="text"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by purchase ID, vendor, invoice number, exception type..."
                    className="w-full text-xs border border-neutral-300 rounded-lg pl-9 pr-3 py-1.5 bg-card text-neutral-900 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-700 focus:ring-2 focus:ring-neutral-300"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full min-w-[1100px] select-text border-separate border-spacing-0">
                <thead>
                  <tr className="bg-neutral-300">
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
                    <tr>
                      <td colSpan={COL_COUNT} className="py-2 px-2 text-center text-xs text-neutral-500"><span className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2 py-0.5 text-xs">No exceptions match your filters.</span></td>
                    </tr>
                  )}
                  {paginated.map(exc => (
                    <tr
                      key={exc.id}
                      onClick={() => setSelectedExc(selectedExc?.id === exc.id ? null : exc)}
                      className={`cursor-pointer [&>td]:shadow-[inset_0_-1px_0_#b4b4b4] [&:hover>td]:bg-neutral-200 text-xs ${selectedExc?.id === exc.id ? '[&>td]:bg-neutral-100' : ''}`}
                    >
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-blue-700">{exc.purchaseId}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-600">{exc.exceptionType}</td>
                      <td className="py-2 px-2 whitespace-nowrap"><Pill style={severityStyle[exc.severity]} label={exc.severity} /></td>
                      <td className="py-2 px-2 whitespace-nowrap"><Pill style={statusStyle[getStatus(exc)]} label={getStatus(exc)} /></td>
                      <td className="py-2 px-2 whitespace-nowrap font-medium text-neutral-900 max-w-[160px] truncate">{exc.vendor}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{exc.invoiceNumber || <span className="text-neutral-600">—</span>}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{exc.purchaseDate}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{exc.detectedDate}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-right font-semibold tabular-nums">{fmt(exc.amount)}</td>
                      <td className="py-2 px-2 whitespace-nowrap text-neutral-900">{exc.assignedTo}</td>
                      <td className="py-2 px-2 relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuRowId(menuRowId === exc.id ? null : exc.id)}
                          className="p-1 hover:bg-neutral-300 rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={13} className="text-neutral-600" />
                        </button>
                        {menuRowId === exc.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuRowId(null)} />
                            <div className="absolute z-20 right-2 top-full mt-1 w-40 rounded-lg border border-neutral-300 bg-white p-1 shadow-lg">
                              <button
                                onClick={() => { setSelectedExc(exc); setMenuRowId(null); }}
                                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-900 hover:bg-neutral-100 rounded-md"
                              >
                                <Eye size={12} /> View detail
                              </button>
                              {statusActions(exc).map(a => (
                                <button
                                  key={a.label}
                                  onClick={() => { handleStatusChange(exc.id, a.to); setMenuRowId(null); }}
                                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-neutral-800 hover:bg-neutral-100 rounded-md"
                                >
                                  {actionIcon(a.to, a.label)} {a.label}
                                </button>
                              ))}
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
                  of <span className="font-semibold text-neutral-900">{filtered.length}</span> exceptions
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => goToPage(pageSafe - 1)} disabled={pageSafe <= 1} aria-label="Previous page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronLeft size={16} /></button>
                {buildPageItems(pageSafe, totalPages).map((p, idx) =>
                  p === '…' ? (
                    <span key={`gap-${idx}`} className="flex h-8 w-6 items-center justify-center text-slate-400">…</span>
                  ) : (
                    <button key={p} onClick={() => goToPage(p)} aria-current={p === pageSafe ? 'page' : undefined} className={`h-8 min-w-[2rem] rounded-lg px-2 text-sm transition-colors ${p === pageSafe ? 'bg-neutral-800 font-semibold text-white shadow-sm' : 'text-neutral-600 hover:bg-neutral-100'}`}>{p}</button>
                  )
                )}
                <button onClick={() => goToPage(pageSafe + 1)} disabled={pageSafe >= totalPages} aria-label="Next page" className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-card"><ChevronRight size={16} /></button>
              </div>
            </div>
          </div>

          {/* Detail Drawer -- sama dengan Sales Exceptions (samping, lebar 320px, menempel saat scroll) */}
          {selectedExc && (
            <div className="relative w-80 flex-shrink-0 self-start sticky top-4 space-y-3 overflow-hidden rounded-xl border border-neutral-300 bg-white p-4 pt-5 shadow-sm">
              <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-neutral-900">Exception Detail</h3>
                <button onClick={() => setSelectedExc(null)} className="p-1 hover:bg-neutral-100 rounded" aria-label="Close"><X size={14} /></button>
              </div>
              <div className="flex items-center justify-between">
                <Pill style={severityStyle[selectedExc.severity]} label={`${selectedExc.severity} Severity`} />
                <span className="text-xs text-neutral-500">ID: {selectedExc.purchaseId}</span>
              </div>
              <div>
                <h4 className="text-sm font-semibold text-neutral-900">{selectedExc.exceptionType}</h4>
                {selectedExc.description && <p className="text-xs text-neutral-500 mt-0.5">{selectedExc.description}</p>}
              </div>

              <div className="space-y-1.5 text-xs">
                {([
                  ['Vendor', selectedExc.vendor],
                  ['Invoice Number', selectedExc.invoiceNumber || '— Not provided —'],
                  ['Accounting Period', selectedExc.period],
                  ['Assigned To', selectedExc.assignedTo],
                  ['Purchase Date', selectedExc.purchaseDate],
                  ['Detected', selectedExc.detectedDate],
                  ['Status', <Pill key="s" style={statusStyle[getStatus(selectedExc)]} label={getStatus(selectedExc)} />],
                  ['Affected Amount', <span key="a" className="font-semibold tabular-nums">{fmt(selectedExc.amount)}</span>],
                ] as [string, React.ReactNode][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3">
                    <span className="text-neutral-500">{k}</span>
                    <span className="font-medium text-neutral-900 text-right">{v}</span>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                <p className="text-[10px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">Resolution Notes</p>
                <p className="mt-1.5 text-xs leading-relaxed text-neutral-900">
                  {selectedExc.resolution || 'No resolution notes yet. Assign and begin review to add notes.'}
                </p>
                {selectedExc.resolutionDate && (
                  <p className="mt-2 text-xs text-neutral-500">Resolved on: <span className="font-medium text-neutral-900">{selectedExc.resolutionDate}</span></p>
                )}
              </div>

              {statusActions(selectedExc).length > 0 && (
                <div className="flex flex-wrap gap-2 pt-2 border-t border-neutral-200">
                  {statusActions(selectedExc).map(a => (
                    <button
                      key={a.label}
                      onClick={() => handleStatusChange(selectedExc.id, a.to)}
                      className={`flex-1 min-w-[120px] py-1.5 px-2 flex items-center justify-center gap-1.5 ${a.to === 'Resolved' ? BTN_PRIMARY : BTN_SECONDARY}`}
                    >
                      {actionIcon(a.to, a.label)} {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}