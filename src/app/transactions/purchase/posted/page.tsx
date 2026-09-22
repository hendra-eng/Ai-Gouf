'use client';

import React, { useState, useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { useAuth } from '@/lib/auth';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  CheckBadgeIcon,
  ArrowDownTrayIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

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
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { transactions: backendTransactions } = usePurchaseTransactions(clientId, 'posted');
  const postedPurchases = useMemo(() => backendTransactions.map(t => mapTransactionToUi(t)), [backendTransactions]);

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

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Posted Purchases', value: summary.total.toString(), sub: 'Finalized records', cls: 'text-green-700', icon: <CheckBadgeIcon className="w-4 h-4 text-green-500" /> },
            { label: 'Total Posted Amount', value: fmt(summary.totalAmount), sub: 'Gross purchase value', cls: 'text-slate-700', icon: null },
            { label: 'Total Input Tax', value: fmt(summary.totalTax), sub: 'Recoverable VAT', cls: 'text-purple-700', icon: null },
            { label: 'Total AP Generated', value: fmt(summary.totalAP), sub: 'Accounts payable', cls: 'text-blue-700', icon: null },
            { label: 'Accounting Periods', value: summary.periods.toString(), sub: 'Periods covered', cls: 'text-slate-700', icon: null },
          ].map(card => (
            <div key={card.label} className="je-card p-4">
              <div className="flex items-center gap-2 mb-2">
                {card.icon || <CheckBadgeIcon className="w-4 h-4 text-green-400" />}
                <span className="text-xs text-muted-foreground font-medium">{card.label}</span>
              </div>
              <p className={`text-lg font-bold tabular-nums ${card.cls}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="je-card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="je-input pl-9"
                placeholder="Search by purchase ID, vendor, invoice number, PO number…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4 text-muted-foreground" />
                <select className="je-select text-sm" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
                  {periods.map(p => <option key={p}>{p}</option>)}
                </select>
              </div>
              <select className="je-select text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                {categories.map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="je-select text-sm" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
                {vendors.map(v => <option key={v}>{v}</option>)}
              </select>
              <select className="je-select text-sm" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
                <option value="All">All Payment</option>
                {Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button className="je-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
                <ArrowDownTrayIcon className="w-3.5 h-3.5" />Export
              </button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {postedPurchases.length} posted purchases</p>
        </div>

        {/* Table */}
        <div className="je-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: 'Purchase ID', field: 'purchaseId' },
                    { label: 'Posting Date', field: 'postingDate' },
                    { label: 'Purchase Date', field: 'purchaseDate' },
                    { label: 'Invoice No.', field: 'invoiceNumber' },
                    { label: 'Vendor', field: 'vendor' },
                    { label: 'Category', field: 'category' },
                    { label: 'Subtotal', field: 'subtotal' },
                    { label: 'Tax', field: 'taxAmount' },
                    { label: 'Total', field: 'total' },
                    { label: 'Payment', field: 'paymentStatus' },
                    { label: 'Period', field: 'period' },
                    { label: 'Posted By', field: 'postedBy' },
                    { label: 'Approved By', field: 'approvedBy' },
                  ].map(col => (
                    <th
                      key={col.field}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                      onClick={() => handleSort(col.field)}
                    >
                      <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={14} className="px-4 py-12 text-center text-muted-foreground text-sm">No posted purchases match your filters.</td></tr>
                ) : filtered.map(row => (
                  <React.Fragment key={row.id}>
                    <tr className="table-row-hover">
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.purchaseId}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.postingDate}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.purchaseDate}</td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.invoiceNumber}</td>
                      <td className="px-4 py-3 text-xs font-medium text-foreground whitespace-nowrap max-w-[140px] truncate">{row.vendor}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${categoryColors[row.category] || 'bg-gray-100 text-gray-700'}`}>{row.category}</span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.subtotal)}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                      <td className="px-4 py-3 text-xs font-bold tabular-nums text-right whitespace-nowrap">{fmt(row.total)}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[row.paymentStatus]}`}>{paymentLabels[row.paymentStatus]}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.period}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.postedBy}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.approvedBy}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          className="text-xs text-primary hover:underline flex items-center gap-0.5"
                          onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}
                        >
                          {expandedId === row.id ? <ChevronUpIcon className="w-3.5 h-3.5" /> : <ChevronDownIcon className="w-3.5 h-3.5" />}
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
                                      <td className="px-3 py-2 text-muted-foreground">{line.accountCode} · {line.accountName}</td>
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
        </div>
      </div>
  );
}