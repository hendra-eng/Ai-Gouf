'use client';

import React, { useState, useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import type { PurchaseStatus, PaymentStatus } from '@/data/purchaseData';
import { useAuth } from '@/lib/auth';
import { usePurchaseTransactions, usePurchaseTransactionLines, mapTransactionToUi, mapTransactionLineToUi } from '@/lib/purchaseStore';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ArrowsUpDownIcon,
  EyeIcon,
  ArrowDownTrayIcon,
} from '@heroicons/react/24/outline';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const statusColors: Record<PurchaseStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_review: 'bg-amber-100 text-amber-700',
  approved: 'bg-blue-100 text-blue-700',
  pending_posting: 'bg-cyan-100 text-cyan-700',
  posted: 'bg-green-100 text-green-700',
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
  unpaid: 'bg-red-50 text-red-700',
  partially_paid: 'bg-amber-50 text-amber-700',
  paid: 'bg-green-50 text-green-700',
  overdue: 'bg-red-100 text-red-800 font-semibold',
  on_hold: 'bg-slate-100 text-slate-600',
};

const paymentLabels: Record<PaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partial',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On Hold',
};

export default function PurchaseTransactionPage() {
  const { user } = useAuth();
  const clientId = user?.id ?? null;
  const { transactions: backendTransactions } = usePurchaseTransactions(clientId);
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

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const summary = useMemo(() => ({
    total: purchaseTransactions.length,
    pendingReview: purchaseTransactions.filter(t => t.status === 'pending_review').length,
    approved: purchaseTransactions.filter(t => t.status === 'approved').length,
    posted: purchaseTransactions.filter(t => t.status === 'posted').length,
    exceptions: purchaseTransactions.filter(t => t.status === 'exception').length,
    totalAmount: purchaseTransactions.reduce((s, t) => s + t.total, 0),
  }), [purchaseTransactions]);

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { label: 'Total', value: summary.total, color: 'text-slate-700' },
            { label: 'Pending Review', value: summary.pendingReview, color: 'text-amber-700' },
            { label: 'Approved', value: summary.approved, color: 'text-blue-700' },
            { label: 'Posted', value: summary.posted, color: 'text-green-700' },
            { label: 'Exceptions', value: summary.exceptions, color: 'text-orange-700' },
            { label: 'Total Amount', value: fmt(summary.totalAmount), color: 'text-foreground' },
          ].map(card => (
            <div key={card.label} className="je-card p-3">
              <p className={`text-lg font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.label}</p>
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
                <select className="je-select text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="All">All Status</option>
                  {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <select className="je-select text-sm" value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)}>
                <option value="All">All Payment</option>
                {Object.entries(paymentLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="je-select text-sm" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
                {uniqueCategories.map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="je-select text-sm" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
                {uniqueVendors.map(v => <option key={v}>{v}</option>)}
              </select>
              <button className="je-btn-secondary text-xs px-3 py-2 flex items-center gap-1.5">
                <ArrowDownTrayIcon className="w-3.5 h-3.5" />Export
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between mt-2">
            <p className="text-xs text-muted-foreground">{filtered.length} of {purchaseTransactions.length} transactions</p>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{selectedIds.size} selected</span>
                <button className="je-btn-primary text-xs px-3 py-1.5">Bulk Approve</button>
                <button className="je-btn-secondary text-xs px-3 py-1.5" onClick={() => setSelectedIds(new Set())}>Clear</button>
              </div>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="je-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="px-4 py-3 w-8">
                    <input type="checkbox" className="rounded" onChange={e => {
                      if (e.target.checked) setSelectedIds(new Set(filtered.map(r => r.id)));
                      else setSelectedIds(new Set());
                    }} />
                  </th>
                  {[
                    { label: 'Purchase ID', field: 'purchaseId' },
                    { label: 'Date', field: 'purchaseDate' },
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
                  ].map(col => (
                    <th
                      key={col.field}
                      className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap"
                      onClick={() => handleSort(col.field)}
                    >
                      <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={15} className="px-4 py-12 text-center text-muted-foreground text-sm">No transactions match your filters.</td></tr>
                ) : filtered.map(row => (
                  <tr
                    key={row.id}
                    className={`table-row-hover cursor-pointer ${selectedIds.has(row.id) ? 'bg-blue-50/50' : ''}`}
                    onClick={() => setSelectedRow(selectedRow?.id === row.id ? null : row)}
                  >
                    <td className="px-4 py-3" onClick={e => { e.stopPropagation(); toggleSelect(row.id); }}>
                      <input type="checkbox" className="rounded" checked={selectedIds.has(row.id)} onChange={() => {}} />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.purchaseId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.purchaseDate}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.invoiceNumber}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.poNumber}</td>
                    <td className="px-4 py-3 text-xs font-medium text-foreground whitespace-nowrap max-w-[140px] truncate">{row.vendor}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground">{row.category}</span>
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap">{fmt(row.subtotal)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                    <td className="px-4 py-3 text-xs font-bold tabular-nums text-right whitespace-nowrap">{fmt(row.total)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[row.paymentStatus]}`}>{paymentLabels[row.paymentStatus]}</span>
                    </td>
                    <td className={`px-4 py-3 text-xs whitespace-nowrap ${row.paymentStatus === 'overdue' ? 'text-red-600 font-semibold' : 'text-muted-foreground'}`}>{row.dueDate}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[row.status]}`}>{statusLabels[row.status]}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.period}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button className="text-xs text-primary hover:underline flex items-center gap-0.5" onClick={e => { e.stopPropagation(); setSelectedRow(row); }}>
                        <EyeIcon className="w-3.5 h-3.5" /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedRowWithLines && (
          <div className="je-card p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-mono text-sm font-bold text-primary">{selectedRowWithLines.purchaseId}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedRowWithLines.status]}`}>{statusLabels[selectedRowWithLines.status]}</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentColors[selectedRowWithLines.paymentStatus]}`}>{paymentLabels[selectedRowWithLines.paymentStatus]}</span>
                </div>
                <p className="text-sm text-foreground font-medium">{selectedRowWithLines.description}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{selectedRowWithLines.vendor} · {selectedRowWithLines.category}</p>
              </div>
              <button className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 border border-border rounded" onClick={() => setSelectedRow(null)}>✕ Close</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
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
                  <p className="text-xs text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            {/* Line Items */}
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-muted/40 border-b border-border">
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Item/Service</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Qty</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Unit Price</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Discount</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Tax</th>
                    <th className="px-3 py-2 text-right font-semibold text-muted-foreground">Total</th>
                    <th className="px-3 py-2 text-left font-semibold text-muted-foreground">Account</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {selectedRowWithLines.lines.map(line => (
                    <tr key={line.id} className="table-row-hover">
                      <td className="px-3 py-2">
                        <p className="font-medium text-foreground">{line.description}</p>
                        {line.itemCode && <p className="text-muted-foreground">{line.itemCode}</p>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{line.quantity} {line.unit}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmt(line.unitPrice)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-600">{line.discount > 0 ? `-${fmt(line.discount)}` : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{fmt(line.taxAmount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold">{fmt(line.total)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{line.accountCode} · {line.accountName}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/40 border-t border-border">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold text-muted-foreground">Subtotal</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(selectedRowWithLines.subtotal)}</td>
                    <td colSpan={2} />
                  </tr>
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold text-muted-foreground">Discount</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-red-600">-{fmt(selectedRowWithLines.discount)}</td>
                    <td colSpan={2} />
                  </tr>
                  <tr className="bg-muted/40">
                    <td colSpan={4} className="px-3 py-2 text-right font-semibold text-muted-foreground">Tax (Input VAT)</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{fmt(selectedRowWithLines.taxAmount)}</td>
                    <td colSpan={2} />
                  </tr>
                  <tr className="bg-blue-50">
                    <td colSpan={4} className="px-3 py-2 text-right font-bold text-blue-700">Total Payable</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums text-blue-700 text-sm">{fmt(selectedRowWithLines.total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
            {selectedRowWithLines.notes && (
              <div className="mt-3 bg-amber-50 rounded-lg px-4 py-2.5">
                <p className="text-xs text-amber-700">{selectedRowWithLines.notes}</p>
              </div>
            )}
          </div>
        )}
      </div>
  );
}