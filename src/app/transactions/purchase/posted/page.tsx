'use client';

import React, { useState, useMemo, useEffect } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import FilterSelect from '@/app/transactions/purchase/components/FilterSelect';
import { useActiveClient } from '@/lib/activeClient';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import { ArrowsUpDownIcon, CheckBadgeIcon } from '@heroicons/react/24/outline';
import { Download, Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, CheckCircle2, Banknote, Receipt, CreditCard, CalendarDays } from 'lucide-react';
import { KPI_TONE, type KpiTone } from '@/components/shared/ProgressKpiTile';
import { kodeAkun, useKodeAkun } from '@/lib/accountCode';
import { exportPurchaseTransactionsCsv } from '@/app/transactions/purchase/purchaseExport';
import { inPurchaseDateRange, usePurchaseDateRange } from '@/app/transactions/purchase/purchaseDateRange';

const fmt = (n: number) =>
  new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(n);

// Badge pil -- ukuran & bentuk sama dengan tabel Source Data.
const BADGE_BASE = 'text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap';

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

const categoryColors: Record<string, string> = {
  Inventory: 'bg-emerald-100 text-emerald-700',
  'Office Supplies': 'bg-blue-100 text-blue-700',
  'IT Equipment': 'bg-indigo-100 text-indigo-700',
  'Professional Services': 'bg-purple-100 text-purple-700',
  Utilities: 'bg-cyan-100 text-cyan-700',
  Maintenance: 'bg-yellow-100 text-yellow-700',
  Marketing: 'bg-pink-100 text-pink-700',
  Travel: 'bg-orange-100 text-orange-700',
  'Fixed Assets': 'bg-slate-100 text-slate-700',
  'Raw Materials': 'bg-amber-100 text-amber-700',
  Logistics: 'bg-teal-100 text-teal-700',
  Other: 'bg-gray-100 text-gray-700',
};

const paymentColors: Record<string, string> = {
  unpaid: 'bg-red-50 text-red-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid: 'bg-green-50 text-green-700',
  overdue: 'bg-red-100 text-red-800',
  on_hold: 'bg-slate-100 text-slate-600',
};

const paymentLabels: Record<string, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

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
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Baris item/jasa dimuat lazy, cuma untuk baris yang sedang di-expand.
  const { lines: expandedLines } = usePurchaseTransactionLines(expandedId);
  const mappedExpandedLines = useMemo(() => expandedLines.map(mapTransactionLineToUi), [expandedLines]);

  const periods = ['All', ...Array.from(new Set(postedPurchases.map(t => t.period)))];
  const categories = ['All', ...Array.from(new Set(postedPurchases.map(t => t.category)))];
  const vendors = ['All', ...Array.from(new Set(postedPurchases.map(t => t.vendor)))];

  const filtered = useMemo(() => {
    let data = [...postedPurchases];
    if (search) data = data.filter(r =>
      r.purchaseId.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase()) ||
      r.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase())
    );
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
  // Paging -- sama dengan tabel Source Data (Rows per page 10/25/50). Kembali ke hal. 1 tiap filter/sort berubah.
  const [pageSize, setPageSize] = useState(10);
  const [currentPage, setCurrentPage] = useState(1);
  useEffect(() => { setCurrentPage(1); }, [search, periodFilter, categoryFilter, vendorFilter, paymentFilter, sortField, sortDir, dateRange]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageSafe = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const goToPage = (n: number) => setCurrentPage(Math.min(Math.max(1, n), totalPages));

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const summary = useMemo(() => ({
    total: postedPurchases.length,
    totalAmount: postedPurchases.reduce((s, t) => s + t.total, 0),
    totalTax: postedPurchases.reduce((s, t) => s + t.taxAmount, 0),
    totalAP: postedPurchases.reduce((s, t) => s + t.accountsPayable, 0),
    periods: [...new Set(postedPurchases.map(t => t.period))].length,
  }), [postedPurchases]);

  const columns = [
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
  const thBase = 'py-3 px-2 text-xs font-bold text-[#065F46] whitespace-nowrap border-t-2 border-b border-[#0A4A32]';

  // Tombol aksi -- di baris yang sama dengan tab, sebelah kanan (sama dengan Source Data).
  const actionBar = (
    <div className="flex flex-nowrap items-center justify-end gap-2 pb-2 xl:pb-0 [&>button]:whitespace-nowrap">
      <button
        type="button"
        disabled={filtered.length === 0}
        onClick={() => exportPurchaseTransactionsCsv(filtered, 'purchase-posted')}
        className="btn-secondary text-xs py-1.5 gap-1.5 rounded-xl border-primary/60 hover:border-primary disabled:opacity-50"
      >
        <Download size={13} /> Export
      </button>
    </div>
  );

  return (
    <div className="px-6 py-5 lg:px-8 xl:px-10 max-w-screen-2xl mx-auto space-y-0 fade-in">
      <PurchaseTabs actions={actionBar} dateRangeActive />

      <div className="pt-5 space-y-5">
        {/* Summary Cards -- tampilan sama dengan KPI Source Data (kartu gradasi, strip atas, badge ikon); isi & ukuran tetap */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Posted Purchases', value: summary.total.toString(), sub: 'Finalized records', tone: 'slate' as KpiTone, Icon: CheckCircle2 },
            { label: 'Total Posted Amount', value: fmt(summary.totalAmount), sub: 'Gross purchase value', tone: 'amber' as KpiTone, Icon: Banknote },
            { label: 'Total Input Tax', value: fmt(summary.totalTax), sub: 'Recoverable VAT', tone: 'green' as KpiTone, Icon: Receipt },
            { label: 'Total AP Generated', value: fmt(summary.totalAP), sub: 'Accounts payable', tone: 'sky' as KpiTone, Icon: CreditCard },
            { label: 'Accounting Periods', value: summary.periods.toString(), sub: 'Periods covered', tone: 'slate' as KpiTone, Icon: CalendarDays },
          ].map(card => {
            const c = KPI_TONE[card.tone];
            return (
              <div key={card.label} className="group relative overflow-hidden rounded-xl border border-primary/40 bg-gradient-to-br from-white via-white to-[#F3FBF7] p-4 pt-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/70 hover:shadow-lg">
                <span className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${c.strip}`} />
                <div className="relative flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-[11px] font-extrabold uppercase tracking-wide text-slate-600">{card.label}</p>
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${c.badge}`}>
                    <card.Icon size={14} />
                  </span>
                </div>
                <p className="relative mt-2 truncate text-lg font-extrabold leading-none tabular-nums text-[#064E3B]" title={card.value}>{card.value}</p>
                <p className="relative mt-1.5 text-xs font-semibold text-slate-500">{card.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Posted Purchase Table -- tampilan sama dengan tabel Source Data */}
        <div className="card overflow-hidden">
          <div className="px-0 py-3 border-b border-border flex flex-col gap-3">
            <div>
              <h3 className="text-2xl font-bold text-foreground">Posted Purchase List</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {filtered.length === 0
                  ? `Showing 0 of ${postedPurchases.length} posted purchases`
                  : `Showing ${(pageSafe - 1) * pageSize + 1} - ${Math.min(pageSafe * pageSize, filtered.length)} of ${filtered.length} posted purchases`}
              </p>
            </div>
            {/* Filter bar -- dropdown di kiri, kolom cari di kanan (sama dengan tab Purchase Transaction) */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={periodFilter}
                onChange={setPeriodFilter}
                options={periods.map(p => ({ value: p, label: p === 'All' ? 'All Periods' : p }))}
              />
              <FilterSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={categories.map(c => ({ value: c, label: c === 'All' ? 'All Categories' : c }))}
              />
              <FilterSelect
                value={vendorFilter}
                onChange={setVendorFilter}
                options={vendors.map(v => ({ value: v, label: v === 'All' ? 'All Vendors' : v }))}
              />
              <FilterSelect
                value={paymentFilter}
                onChange={setPaymentFilter}
                options={[{ value: 'All', label: 'All Payment' }, ...Object.entries(paymentLabels).map(([k, v]) => ({ value: k, label: v }))]}
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
            <table className="w-full min-w-[1500px]">
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
                  <th className={`${thBase} text-left`}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={14} className="py-8 text-center text-xs text-muted-foreground">No posted purchases match your filters.</td></tr>
                ) : paginated.map(row => (
                  <React.Fragment key={row.id}>
                    <tr className={`border-b border-slate-400/80 transition-colors text-xs ${expandedId === row.id ? 'bg-primary/5' : 'hover:bg-slate-200/70'}`}>
                      <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">{row.purchaseId}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.postingDate}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.purchaseDate}</td>
                      <td className="py-2 px-2 text-foreground whitespace-nowrap">{row.invoiceNumber}</td>
                      <td className="py-2 px-2 text-foreground font-medium whitespace-nowrap max-w-[160px] truncate">{row.vendor}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className={`${BADGE_BASE} ${categoryColors[row.category] || 'bg-gray-100 text-gray-700'}`}>{row.category}</span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap">{fmt(row.subtotal)}</td>
                      <td className="py-2 px-2 text-right tabular-nums whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                      <td className="py-2 px-2 text-right font-semibold tabular-nums whitespace-nowrap">{fmt(row.total)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <span className={`${BADGE_BASE} ${paymentColors[row.paymentStatus]}`}>{paymentLabels[row.paymentStatus]}</span>
                      </td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.period}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.postedBy}</td>
                      <td className="py-2 px-2 text-muted-foreground whitespace-nowrap">{row.approvedBy}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        <button
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          {expandedId === row.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {expandedId === row.id ? 'Hide' : 'Detail'}
                        </button>
                      </td>
                    </tr>
                    {expandedId === row.id && (
                      <tr>
                        <td colSpan={14} className="px-4 py-0 bg-muted/20">
                          <div className="py-4 space-y-3">
                            {/* Audit Info */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {[
                                { label: 'PO Number', value: row.poNumber },
                                { label: 'Source Type', value: row.sourceDocType },
                                { label: 'Payment Terms', value: row.paymentTerms },
                                { label: 'Posted Timestamp', value: row.postedTimestamp || '—' },
                              ].map(item => (
                                <div key={item.label} className="bg-card rounded-lg px-3 py-2 border border-border">
                                  <p className="text-xs text-muted-foreground">{item.label}</p>
                                  <p className="text-xs font-semibold text-foreground mt-0.5">{item.value}</p>
                                </div>
                              ))}
                            </div>
                            {/* Line Items */}
                            <div className="bg-card rounded-lg border border-border overflow-hidden">
                              <div className="px-3 py-2 bg-muted/30 border-b border-border">
                                <p className="text-xs font-semibold text-foreground">Purchase Line Items</p>
                              </div>
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="border-b border-border">
                                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Description</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Qty</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Unit Price</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Tax</th>
                                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</th>
                                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">GL Account</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border">
                                  {mappedExpandedLines.map(line => (
                                    <tr key={line.id}>
                                      <td className="px-3 py-2 text-foreground">{line.description}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity} {line.unit}</td>
                                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(line.taxAmount)}</td>
                                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(line.total)}</td>
                                      <td className="px-3 py-2 text-muted-foreground">{kodeAkun(line.accountCode)} · {line.accountName}</td>
                                    </tr>
                                  ))}
                                </tbody>
                                <tfoot>
                                  <tr className="bg-green-50 border-t border-green-200">
                                    <td colSpan={4} className="px-3 py-2 text-right font-bold text-green-700">Total Posted</td>
                                    <td className="px-3 py-2 text-right font-bold tabular-nums text-green-700">{fmt(row.total)}</td>
                                    <td />
                                  </tr>
                                </tfoot>
                              </table>
                            </div>
                            {/* Posted status indicator */}
                            <div className="flex items-center gap-2 bg-green-50 rounded-lg px-4 py-2.5">
                              <CheckBadgeIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                              <p className="text-xs text-green-700 font-medium">
                                Posted to General Ledger — Accounts Payable generated: <span className="font-bold tabular-nums">{fmt(row.accountsPayable)}</span>
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
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
                of <span className="font-semibold text-foreground">{filtered.length}</span> posted purchases
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
      </div>
    </div>
  );
}