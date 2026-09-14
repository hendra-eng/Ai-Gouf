'use client';

import React, { useState, useMemo } from 'react';
import PurchaseTabs from '@/app/transactions/purchase/components/PurchaseTabs';
import { purchaseExceptions } from '@/data/purchaseData';
import type { ExceptionSeverity, ExceptionStatus } from '@/data/purchaseData';
import {
  MagnifyingGlassIcon,
  FunnelIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ArrowPathIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

const severityConfig: Record<ExceptionSeverity, { cls: string; dot: string; icon: React.ReactNode }> = {
  Critical: { cls: 'bg-red-50 text-red-700 border border-red-200', dot: 'bg-red-500', icon: <ExclamationCircleIcon className="w-3.5 h-3.5" /> },
  High: { cls: 'bg-orange-50 text-orange-700 border border-orange-200', dot: 'bg-orange-500', icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" /> },
  Medium: { cls: 'bg-amber-50 text-amber-700 border border-amber-200', dot: 'bg-amber-400', icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" /> },
  Low: { cls: 'bg-blue-50 text-blue-700 border border-blue-200', dot: 'bg-blue-400', icon: <ExclamationTriangleIcon className="w-3.5 h-3.5" /> },
};

const statusConfig: Record<ExceptionStatus, { cls: string; icon: React.ReactNode }> = {
  Open: { cls: 'bg-red-50 text-red-700', icon: <ExclamationCircleIcon className="w-3 h-3" /> },
  'Under Review': { cls: 'bg-amber-50 text-amber-700', icon: <ArrowPathIcon className="w-3 h-3" /> },
  'Requires Correction': { cls: 'bg-orange-50 text-orange-700', icon: <ExclamationTriangleIcon className="w-3 h-3" /> },
  Resolved: { cls: 'bg-green-50 text-green-700', icon: <CheckCircleIcon className="w-3 h-3" /> },
  Ignored: { cls: 'bg-slate-50 text-slate-600', icon: <XCircleIcon className="w-3 h-3" /> },
};

function SeverityBadge({ severity }: { severity: ExceptionSeverity }) {
  const { cls, icon } = severityConfig[severity];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>{icon}{severity}</span>;
}

function StatusBadge({ status }: { status: ExceptionStatus }) {
  const { cls, icon } = statusConfig[status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{icon}{status}</span>;
}

export default function PurchaseExceptionsPage() {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [vendorFilter, setVendorFilter] = useState('All');
  const [selectedExc, setSelectedExc] = useState<typeof purchaseExceptions[0] | null>(null);
  const [resolveMap, setResolveMap] = useState<Record<string, ExceptionStatus>>({});

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
    return data;
  }, [search, severityFilter, statusFilter, typeFilter, vendorFilter, resolveMap]);

  const summary = useMemo(() => ({
    total: purchaseExceptions.length,
    open: purchaseExceptions.filter(e => (resolveMap[e.id] || e.status) === 'Open').length,
    critical: purchaseExceptions.filter(e => e.severity === 'Critical').length,
    underReview: purchaseExceptions.filter(e => (resolveMap[e.id] || e.status) === 'Under Review').length,
    resolved: purchaseExceptions.filter(e => (resolveMap[e.id] || e.status) === 'Resolved').length,
  }), [resolveMap]);

  const handleStatusChange = (id: string, status: ExceptionStatus) => {
    setResolveMap(prev => ({ ...prev, [id]: status }));
    if (selectedExc?.id === id) setSelectedExc(prev => prev ? { ...prev, status } : null);
  };

  return (
      <div className="space-y-6 fade-in">
        <PurchaseTabs />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[
            { label: 'Total Exceptions', value: summary.total, cls: 'text-slate-700' },
            { label: 'Open', value: summary.open, cls: 'text-red-700' },
            { label: 'Critical', value: summary.critical, cls: 'text-red-700' },
            { label: 'Under Review', value: summary.underReview, cls: 'text-amber-700' },
            { label: 'Resolved', value: summary.resolved, cls: 'text-green-700' },
          ].map(card => (
            <div key={card.label} className="je-card p-4">
              <p className={`text-2xl font-bold tabular-nums ${card.cls}`}>{card.value}</p>
              <p className="text-xs font-medium text-foreground mt-1">{card.label}</p>
            </div>
          ))}
        </div>

        {/* Exception Type Breakdown */}
        <div className="je-card p-5">
          <h3 className="text-sm font-semibold text-foreground mb-3">Exception Breakdown by Type</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {purchaseExceptions.map(exc => (
              <div key={exc.id} className="flex items-center justify-between bg-muted/30 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${severityConfig[exc.severity].dot}`} />
                  <span className="text-xs text-foreground truncate">{exc.exceptionType}</span>
                </div>
                <SeverityBadge severity={exc.severity} />
              </div>
            ))}
          </div>
        </div>

        {/* Filters */}
        <div className="je-card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                className="je-input pl-9"
                placeholder="Search by purchase ID, vendor, invoice number, or exception type…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <FunnelIcon className="w-4 h-4 text-muted-foreground" />
                <select className="je-select text-sm" value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}>
                  {['All', 'Critical', 'High', 'Medium', 'Low'].map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <select className="je-select text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                {['All', 'Open', 'Under Review', 'Requires Correction', 'Resolved', 'Ignored'].map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="je-select text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
                {exceptionTypes.map(t => <option key={t}>{t}</option>)}
              </select>
              <select className="je-select text-sm" value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
                {uniqueVendors.map(v => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {purchaseExceptions.length} exceptions</p>
        </div>

        {/* Exception Cards */}
        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="je-card p-12 text-center">
              <CheckCircleIcon className="w-10 h-10 text-green-400 mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">No exceptions match your filters</p>
              <p className="text-xs text-muted-foreground mt-1">Adjust your filters or clear the search to see all exceptions.</p>
            </div>
          ) : filtered.map(exc => (
            <div
              key={exc.id}
              className={`je-card p-5 cursor-pointer transition-all ${selectedExc?.id === exc.id ? 'ring-2 ring-primary/30' : ''}`}
              onClick={() => setSelectedExc(selectedExc?.id === exc.id ? null : exc)}
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-mono text-xs font-semibold text-primary">{exc.purchaseId}</span>
                    <SeverityBadge severity={exc.severity} />
                    <StatusBadge status={getStatus(exc)} />
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">{exc.exceptionType}</span>
                  </div>
                  <p className="text-sm text-foreground">{exc.description}</p>
                  <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted-foreground">
                    <span>Vendor: <span className="text-foreground font-medium">{exc.vendor}</span></span>
                    <span>Invoice: <span className="text-foreground font-medium">{exc.invoiceNumber || '—'}</span></span>
                    <span>Date: <span className="text-foreground font-medium">{exc.purchaseDate}</span></span>
                    <span>Detected: <span className="text-foreground font-medium">{exc.detectedDate}</span></span>
                    <span>Amount: <span className="text-foreground font-semibold tabular-nums">{fmt(exc.amount)}</span></span>
                    <span>Assigned: <span className="text-foreground font-medium">{exc.assignedTo}</span></span>
                  </div>
                </div>
                <div className="flex gap-2 flex-shrink-0 flex-wrap">
                  {getStatus(exc) === 'Open' && (
                    <>
                      <button className="je-btn-secondary text-xs px-3 py-1.5" onClick={e => { e.stopPropagation(); handleStatusChange(exc.id, 'Under Review'); }}>Start Review</button>
                      <button className="je-btn-secondary text-xs px-3 py-1.5 text-orange-700 border-orange-200" onClick={e => { e.stopPropagation(); handleStatusChange(exc.id, 'Requires Correction'); }}>Flag</button>
                    </>
                  )}
                  {getStatus(exc) === 'Under Review' && (
                    <button className="je-btn-primary text-xs px-3 py-1.5" onClick={e => { e.stopPropagation(); handleStatusChange(exc.id, 'Resolved'); }}>Mark Resolved</button>
                  )}
                  {getStatus(exc) === 'Requires Correction' && (
                    <button className="je-btn-secondary text-xs px-3 py-1.5" onClick={e => { e.stopPropagation(); handleStatusChange(exc.id, 'Under Review'); }}>Begin Correction</button>
                  )}
                  {getStatus(exc) === 'Resolved' && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-700 font-medium"><CheckCircleIcon className="w-4 h-4" />Resolved</span>
                  )}
                </div>
              </div>

              {/* Expanded Detail */}
              {selectedExc?.id === exc.id && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Exception Details</p>
                      <div className="space-y-2">
                        {[
                          { label: 'Purchase ID', value: exc.purchaseId },
                          { label: 'Vendor', value: exc.vendor },
                          { label: 'Invoice Number', value: exc.invoiceNumber || '— Not provided —' },
                          { label: 'Affected Amount', value: fmt(exc.amount) },
                          { label: 'Accounting Period', value: exc.period },
                          { label: 'Assigned To', value: exc.assignedTo },
                        ].map(item => (
                          <div key={item.label} className="flex justify-between text-xs">
                            <span className="text-muted-foreground">{item.label}</span>
                            <span className="font-medium text-foreground">{item.value}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Resolution Notes</p>
                      <div className="bg-muted/40 rounded-lg p-3 text-xs text-foreground leading-relaxed">
                        {exc.resolution || 'No resolution notes yet. Assign and begin review to add notes.'}
                      </div>
                      {exc.resolutionDate && (
                        <p className="text-xs text-muted-foreground mt-2">Resolved on: <span className="font-medium">{exc.resolutionDate}</span></p>
                      )}
                      <div className="mt-3 flex gap-2">
                        {getStatus(exc) !== 'Resolved' && getStatus(exc) !== 'Ignored' && (
                          <button className="je-btn-secondary text-xs px-3 py-1.5 text-slate-500" onClick={e => { e.stopPropagation(); handleStatusChange(exc.id, 'Ignored'); }}>Ignore</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
  );
}