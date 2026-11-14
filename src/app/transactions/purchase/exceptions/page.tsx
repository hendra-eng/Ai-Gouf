'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { toast } from 'sonner';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import ProgressKpiTile, { type KpiTone } from '@/components/shared/ProgressKpiTile';
import type { ExceptionSeverity, ExceptionStatus } from '@/data/purchaseData';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseExceptions, updatePurchaseException, mapExceptionToUi } from '@/lib/purchaseStore';
import { ArrowsUpDownIcon } from '@heroicons/react/24/outline';
import { Search, AlertTriangle, AlertCircle, Clock, CheckCircle, MoreHorizontal, ChevronLeft, ChevronRight, X } from 'lucide-react';

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

// Badge -- bentuk pil, ukuran & warna sama dengan tabel Purchase Source Data / Purchase Transaction.
const BADGE_BASE = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';

const severityConfig: Record<ExceptionSeverity, { cls: string; dot: string }> = {
  Critical: { cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  High: { cls: 'bg-orange-100 text-orange-700', dot: 'bg-orange-500' },
  Medium: { cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  Low: { cls: 'bg-blue-100 text-blue-700', dot: 'bg-blue-400' },
};

const statusConfig: Record<ExceptionStatus, string> = {
  Open: 'bg-red-100 text-red-700',
  'Under Review': 'bg-amber-100 text-amber-700',
  'Requires Correction': 'bg-orange-100 text-orange-700',
  Resolved: 'bg-emerald-100 text-emerald-700',
  Ignored: 'bg-slate-100 text-slate-600',
};

function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  return <span className={`${BADGE_BASE} ${severityConfig[severity].cls}`}>{severity}</span>;
}

function StatusBadge({ status }: { status: ExceptionStatus }) {
  return <span className={`${BADGE_BASE} ${statusConfig[status]}`}>{status}</span>;
}

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

  // Kartu KPI memakai desain yang sama dengan Purchase Transaction (ProgressKpiTile ukuran kecil), 5 kartu.
  const pctOf = (n: number) => (summary.total.count > 0 ? Math.round((n / summary.total.count) * 100) : 0);
  const kpiTiles: { label: string; g: { count: number; amount: number }; tone: KpiTone; icon: React.ElementType }[] = [
    { label: 'Total Exceptions', g: summary.total, tone: 'slate', icon: AlertTriangle },
    { label: 'Open', g: summary.open, tone: 'amber', icon: AlertCircle },
    { label: 'Critical', g: summary.critical, tone: 'sky', icon: AlertTriangle },
    { label: 'Under Review', g: summary.underReview, tone: 'amber', icon: Clock },
    { label: 'Resolved', g: summary.resolved, tone: 'green', icon: CheckCircle },
  ];

  const columns = [
    { label: 'Purchase ID', field: 'purchaseId', align: 'left' },
    { label: 'Exception Type', field: 'exceptionType', align: 'left' },
    { label: 'Severity', field: 'severity', align: 'left' },
    { label: 'Status', field: 'status', align: 'left' },
    { label: 'Vendor', field: 'vendor', align: 'left' },
    { label: 'Invoice No.', field: 'invoiceNumber', align: 'left' },
    { label: 'Date', field: 'purchaseDate', align: 'left' },
    { label: 'Detected', field: 'detectedDate', align: 'left' },
    { label: 'Amount', field: 'amount', align: 'right' },
    { label: 'Assigned To', field: 'assignedTo', align: 'left' },
  ];
  const thBase = 'py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]';

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
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0 fade-in">
      <PurchaseTabs />

      <div className="pt-5 space-y-5">
        {/* Summary Cards -- desain KPI sama dengan Purchase Transaction */}
        <div className="!mt-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          {kpiTiles.map(k => (
            <ProgressKpiTile
              key={k.label}
              label={k.label}
              value={k.g.count}
              detail={fmt(k.g.amount)}
              detailUnit="affected"
              pct={pctOf(k.g.count)}
              pctLabel="of all exceptions"
              tone={k.tone}
              icon={k.icon}
              barActive={k.g.count > 0}
              size="compact"
            />
          ))}
        </div>

        {/* Exception Type Breakdown */}
        <SourcePanel title="Exception Breakdown by Type">
          {purchaseExceptions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No exceptions detected.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {purchaseExceptions.map(exc => (
                <div key={exc.id} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityConfig[exc.severity].dot}`} />
                    <span className="text-xs text-foreground truncate">{exc.exceptionType}</span>
                  </div>
                  <SeverityBadge severity={exc.severity} />
                </div>
              ))}
            </div>
          )}
        </SourcePanel>

        {/* Exception Table -- desain sama dengan Purchase Transaction List */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border flex flex-col gap-3">
            <div>
              <h3 className="text-2xl font-bold text-foreground">Purchase Exception List</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filtered.length === 0
                  ? `Showing 0 of ${purchaseExceptions.length} exceptions`
                  : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} exceptions`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={severityFilter}
                onChange={setSeverityFilter}
                options={['All', 'Critical', 'High', 'Medium', 'Low'].map(v => ({ value: v, label: v === 'All' ? 'All Severity' : v }))}
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={['All', 'Open', 'Under Review', 'Requires Correction', 'Resolved', 'Ignored'].map(v => ({ value: v, label: v === 'All' ? 'All Status' : v }))}
              />
              <FilterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={exceptionTypes.map(v => ({ value: v, label: v === 'All' ? 'All Types' : v }))}
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
                  placeholder="Search by purchase ID, vendor, invoice number, exception type..."
                  className="w-full text-xs border border-primary/60 rounded-lg pl-9 pr-3 py-1.5 bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full min-w-[1300px]">
              <thead>
                <tr className="bg-[#8FE3B5]">
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
                  <tr><td colSpan={11} className="py-8 text-center text-xs text-muted-foreground">No exceptions match your filters.</td></tr>
                ) : paginated.map(exc => (
                  <tr
                    key={exc.id}
                    onClick={() => setSelectedExc(selectedExc?.id === exc.id ? null : exc)}
                    className={`border-b border-slate-400/80 cursor-pointer transition-colors text-xs ${selectedExc?.id === exc.id ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}
                  >
                    <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{exc.purchaseId}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      <span className={`${BADGE_BASE} bg-muted text-muted-foreground`}>{exc.exceptionType}</span>
                    </td>
                    <td className="py-2 px-2 whitespace-nowrap"><SeverityBadge severity={exc.severity} /></td>
                    <td className="py-2 px-2 whitespace-nowrap"><StatusBadge status={getStatus(exc)} /></td>
                    <td className="py-2 px-2 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{exc.vendor}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{exc.invoiceNumber || <span className="text-muted-foreground">—</span>}</td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{exc.purchaseDate}</td>
                    <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{exc.detectedDate}</td>
                    <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(exc.amount)}</td>
                    <td className="py-2 px-2 text-foreground whitespace-nowrap">{exc.assignedTo}</td>
                    <td className="py-2 px-2">
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button
                          onClick={() => setMenuRowId(menuRowId === exc.id ? null : exc.id)}
                          className="p-1 hover:bg-muted rounded transition-colors"
                          aria-label="Actions"
                        >
                          <MoreHorizontal size={14} className="text-muted-foreground" />
                        </button>
                        {menuRowId === exc.id && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={() => setMenuRowId(null)} />
                            <div className="absolute right-0 top-full mt-1 z-20 min-w-[150px] rounded-lg border border-border bg-card shadow-lg py-1">
                              <button
                                onClick={() => { setSelectedExc(exc); setMenuRowId(null); }}
                                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left"
                              >
                                View detail
                              </button>
                              {statusActions(exc).map(a => (
                                <button
                                  key={a.label}
                                  onClick={() => { handleStatusChange(exc.id, a.to); setMenuRowId(null); }}
                                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground hover:bg-muted text-left"
                                >
                                  {a.label}
                                </button>
                              ))}
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
                of <span className="font-semibold text-foreground">{filtered.length}</span> exceptions
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
        {selectedExc && (
          <SourcePanel
            title={selectedExc.purchaseId}
            leading={
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#D1FAE5] text-[#065F46]"><AlertTriangle size={17} /></span>
            }
            action={
              <button onClick={() => setSelectedExc(null)} className="flex h-7 items-center gap-1 rounded-lg border border-border bg-card px-2 text-xs text-slate-600 hover:bg-slate-100">
                <X size={13} /> Close
              </button>
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={selectedExc.severity} />
              <StatusBadge status={getStatus(selectedExc)} />
              <span className={`${BADGE_BASE} bg-muted text-muted-foreground`}>{selectedExc.exceptionType}</span>
            </div>
            <p className="mb-4 text-sm text-muted-foreground">{selectedExc.description}</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Vendor', value: selectedExc.vendor },
                { label: 'Invoice Number', value: selectedExc.invoiceNumber || '— Not provided —' },
                { label: 'Accounting Period', value: selectedExc.period },
                { label: 'Assigned To', value: selectedExc.assignedTo },
                { label: 'Purchase Date', value: selectedExc.purchaseDate },
                { label: 'Detected', value: selectedExc.detectedDate },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl border border-[#6EE7B7]/60 bg-[#ECFDF5] p-3">
                <p className="text-xs font-medium text-[#047857]">Affected Amount</p>
                <p className="text-base font-bold text-[#064E3B] tabular-nums">{fmt(selectedExc.amount)}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-medium text-slate-600">Resolution Notes</p>
                <p className="text-xs text-foreground leading-relaxed mt-1">
                  {selectedExc.resolution || 'No resolution notes yet. Assign and begin review to add notes.'}
                </p>
                {selectedExc.resolutionDate && (
                  <p className="text-xs text-muted-foreground mt-2">Resolved on: <span className="font-medium">{selectedExc.resolutionDate}</span></p>
                )}
              </div>
            </div>
            {statusActions(selectedExc).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {statusActions(selectedExc).map(a => (
                  <button
                    key={a.label}
                    className={`${a.to === 'Resolved' ? 'je-btn-primary' : 'je-btn-secondary'} text-xs px-3 py-1.5`}
                    onClick={() => handleStatusChange(selectedExc.id, a.to)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
          </SourcePanel>
        )}
      </div>
    </div>
  );
}