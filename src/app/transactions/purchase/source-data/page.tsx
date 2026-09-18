'use client';

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { usePurchaseData } from '@/app/transactions/purchase/purchasebridge';
import type { PurchaseSourceRecord } from '@/data/purchaseData';
import { MagnifyingGlassIcon, FunnelIcon, ArrowsUpDownIcon, CheckCircleIcon, ClockIcon, XCircleIcon, ArrowTopRightOnSquareIcon,  } from '@heroicons/react/24/outline';

type SourceStatus = 'Mapped' | 'Pending Mapping' | 'Validation Error' | 'Imported';
type ValidationStatus = 'Valid' | 'Pending Validation' | 'Invalid';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const sourceTypeColors: Record<string, string> = {
  'Purchase Order': 'bg-blue-100 text-blue-700',
  'Vendor Invoice': 'bg-indigo-100 text-indigo-700',
  'Goods Receipt': 'bg-emerald-100 text-emerald-700',
  'Service Receipt': 'bg-teal-100 text-teal-700',
  'Supplier Bill': 'bg-cyan-100 text-cyan-700',
  'Expense Claim': 'bg-orange-100 text-orange-700',
  'Recurring Purchase': 'bg-purple-100 text-purple-700',
  Manual: 'bg-slate-100 text-slate-700',
};

function SourceStatusBadge({ status }: { status: SourceStatus }) {
  const map: Record<SourceStatus, { cls: string; icon: React.ReactNode }> = {
    Mapped: { cls: 'bg-green-50 text-green-700 border border-green-200', icon: <CheckCircleIcon className="w-3 h-3" /> },
    'Pending Mapping': { cls: 'bg-amber-50 text-amber-700 border border-amber-200', icon: <ClockIcon className="w-3 h-3" /> },
    'Validation Error': { cls: 'bg-red-50 text-red-700 border border-red-200', icon: <XCircleIcon className="w-3 h-3" /> },
    Imported: { cls: 'bg-blue-50 text-blue-700 border border-blue-200', icon: <ClockIcon className="w-3 h-3" /> },
  };
  const { cls, icon } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {icon}{status}
    </span>
  );
}

function ValidationBadge({ status }: { status: ValidationStatus }) {
  const map: Record<ValidationStatus, string> = {
    Valid: 'bg-green-50 text-green-700',
    'Pending Validation': 'bg-amber-50 text-amber-700',
    Invalid: 'bg-red-50 text-red-700',
  };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>{status}</span>;
}

function PurchaseSourceDataPageInner() {
  const { purchaseSourceRecords } = usePurchaseData();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [sortField, setSortField] = useState('sourceDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRow, setSelectedRow] = useState<PurchaseSourceRecord | null>(null);

  // Deep-link dari tombol "View Source" di halaman Journal Preview
  // (?purchaseId=PUR-2026-09-0001) -- langsung isi kolom pencarian.
  useEffect(() => {
    const purchaseId = searchParams.get('purchaseId');
    if (purchaseId) setSearch(purchaseId);
  }, [searchParams]);

  const sourceTypes = ['All', 'Purchase Order', 'Vendor Invoice', 'Goods Receipt', 'Service Receipt'];
  const statuses = ['All', 'Mapped', 'Pending Mapping', 'Validation Error', 'Imported'];
  const uniqueVendors = ['All', ...Array.from(new Set(purchaseSourceRecords.map(r => r.vendor)))];

  const filtered = useMemo(() => {
    let data = [...purchaseSourceRecords];
    if (search) data = data.filter(r =>
      r.sourceId.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.vendor.toLowerCase().includes(search.toLowerCase()) ||
      r.invoiceNumber.toLowerCase().includes(search.toLowerCase()) ||
      r.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      (r.relatedPurchaseId || '').toLowerCase().includes(search.toLowerCase())
    );
    if (typeFilter !== 'All') data = data.filter(r => r.sourceType === typeFilter);
    if (statusFilter !== 'All') data = data.filter(r => r.status === statusFilter);
    if (vendorFilter !== 'All') data = data.filter(r => r.vendor === vendorFilter);
    data.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortField] as string | number;
      const bv = (b as unknown as Record<string, unknown>)[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [purchaseSourceRecords, search, typeFilter, statusFilter, vendorFilter, sortField, sortDir]);

  const handleSort = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const summary = useMemo(() => ({
    total: purchaseSourceRecords.length,
    mapped: purchaseSourceRecords.filter(r => r.status === 'Mapped').length,
    pending: purchaseSourceRecords.filter(r => r.status === 'Pending Mapping').length,
    errors: purchaseSourceRecords.filter(r => r.status === 'Validation Error').length,
    totalAmount: purchaseSourceRecords.reduce((s, r) => s + r.totalAmount, 0),
  }), [purchaseSourceRecords]);

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Sources', value: summary.total, sub: 'All source documents', color: 'text-slate-700', bg: 'bg-slate-50' },
            { label: 'Mapped', value: summary.mapped, sub: `${summary.total > 0 ? Math.round(summary.mapped / summary.total * 100) : 0}% mapped`, color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Pending Mapping', value: summary.pending, sub: 'Awaiting transaction', color: 'text-amber-700', bg: 'bg-amber-50' },
            { label: 'Validation Errors', value: summary.errors, sub: 'Require correction', color: 'text-red-700', bg: 'bg-red-50' },
            { label: 'Total Source Value', value: fmt(summary.totalAmount), sub: 'Gross incl. tax', color: 'text-blue-700', bg: 'bg-blue-50' },
          ].map(card => (
            <div key={card.label} className="je-card p-4">
              <p className={`text-xl font-bold tabular-nums ${card.color}`}>{card.value}</p>
              <p className="text-xs font-semibold text-foreground mt-0.5">{card.label}</p>
              <p className="text-xs text-muted-foreground">{card.sub}</p>
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
                placeholder="Search by source ID, invoice number, PO number, vendor, or description…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4 text-muted-foreground" />
                <select className="je-select text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                  {sourceTypes.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
              <select className="je-select text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {statuses.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="je-select text-sm" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
                {uniqueVendors.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {purchaseSourceRecords.length} source records</p>
        </div>

        {/* Table */}
        <div className="je-card overflow-hidden">
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  {[
                    { label: 'Source ID', field: 'sourceId' },
                    { label: 'Type', field: 'sourceType' },
                    { label: 'Vendor', field: 'vendor' },
                    { label: 'Date', field: 'sourceDate' },
                    { label: 'Invoice No.', field: 'invoiceNumber' },
                    { label: 'PO Number', field: 'poNumber' },
                    { label: 'Amount', field: 'amount' },
                    { label: 'Tax', field: 'taxAmount' },
                    { label: 'Total', field: 'totalAmount' },
                    { label: 'Purchase Ref', field: 'relatedPurchaseId' },
                    { label: 'Validation', field: 'validationStatus' },
                    { label: 'Status', field: 'status' },
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
                  <tr><td colSpan={13} className="px-4 py-12 text-center text-muted-foreground text-sm">No source records match your filters.</td></tr>
                ) : filtered.map(row => (
                  <tr key={row.id} className="table-row-hover cursor-pointer" onClick={() => setSelectedRow(row)}>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary whitespace-nowrap">{row.sourceId}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceTypeColors[row.sourceType] || 'bg-gray-100 text-gray-700'}`}>{row.sourceType}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-medium text-foreground whitespace-nowrap max-w-[140px] truncate">{row.vendor}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.sourceDate}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.invoiceNumber || <span className="text-muted-foreground italic">—</span>}</td>
                    <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">{row.poNumber}</td>
                    <td className="px-4 py-3 text-xs font-semibold tabular-nums text-right whitespace-nowrap">{fmt(row.amount)}</td>
                    <td className="px-4 py-3 text-xs tabular-nums text-right whitespace-nowrap text-muted-foreground">{fmt(row.taxAmount)}</td>
                    <td className="px-4 py-3 text-xs font-bold tabular-nums text-right whitespace-nowrap">{fmt(row.totalAmount)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.relatedPurchaseId ? (
                        <span className="font-mono text-xs text-primary font-medium">{row.relatedPurchaseId}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Not mapped</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><ValidationBadge status={row.validationStatus} /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><SourceStatusBadge status={row.status} /></td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <button className="text-xs text-primary hover:underline flex items-center gap-0.5" onClick={e => { e.stopPropagation(); setSelectedRow(row); }}>
                        View <ArrowTopRightOnSquareIcon className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Detail Panel */}
        {selectedRow && (
          <div className="je-card p-6">
            <div className="flex items-start justify-between mb-5">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceTypeColors[selectedRow.sourceType] || 'bg-gray-100 text-gray-700'}`}>{selectedRow.sourceType}</span>
                  <SourceStatusBadge status={selectedRow.status} />
                </div>
                <h3 className="text-base font-bold text-foreground">{selectedRow.sourceId}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{selectedRow.description}</p>
              </div>
              <button className="text-muted-foreground hover:text-foreground text-xs px-2 py-1 border border-border rounded" onClick={() => setSelectedRow(null)}>✕ Close</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Vendor', value: selectedRow.vendor },
                { label: 'Vendor ID', value: selectedRow.vendorId },
                { label: 'Source Date', value: selectedRow.sourceDate },
                { label: 'Period', value: selectedRow.period },
                { label: 'Invoice Number', value: selectedRow.invoiceNumber || '— Not provided —' },
                { label: 'PO Number', value: selectedRow.poNumber },
                { label: 'Created By', value: selectedRow.createdBy },
                { label: 'Created Date', value: selectedRow.createdDate },
              ].map(item => (
                <div key={item.label}>
                  <p className="text-xs text-muted-foreground font-medium">{item.label}</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">{item.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-4">
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Net Amount</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRow.amount)}</p>
              </div>
              <div className="bg-muted/40 rounded-lg p-3">
                <p className="text-xs text-muted-foreground">Tax Amount</p>
                <p className="text-base font-bold text-foreground tabular-nums">{fmt(selectedRow.taxAmount)}</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3">
                <p className="text-xs text-blue-600">Total Amount</p>
                <p className="text-base font-bold text-blue-700 tabular-nums">{fmt(selectedRow.totalAmount)}</p>
              </div>
            </div>
            {selectedRow.relatedPurchaseId && (
              <div className="mt-3 flex items-center gap-2 bg-green-50 rounded-lg px-4 py-2.5">
                <CheckCircleIcon className="w-4 h-4 text-green-600 flex-shrink-0" />
                <p className="text-xs text-green-700">Mapped to purchase transaction: <span className="font-bold font-mono">{selectedRow.relatedPurchaseId}</span></p>
              </div>
            )}
            {!selectedRow.relatedPurchaseId && (
              <div className="mt-3 flex items-center gap-2 bg-amber-50 rounded-lg px-4 py-2.5">
                <ClockIcon className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <p className="text-xs text-amber-700">This source document has not yet been mapped to a purchase transaction.</p>
              </div>
            )}
          </div>
        )}
      </div>
  );
}

export default function PurchaseSourceDataPage() {
  return (
    <Suspense fallback={<div className="space-y-6 fade-in"><PurchaseTabs /></div>}>
      <PurchaseSourceDataPageInner />
    </Suspense>
  );
}