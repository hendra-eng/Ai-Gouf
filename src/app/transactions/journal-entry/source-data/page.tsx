'use client';

import React, { useState, useMemo } from 'react';
import JournalEntryTabs from '@/app/transactions/journal-entry/JournalEntryTabs';
import { MagnifyingGlassIcon, FunnelIcon, ArrowsUpDownIcon, ArrowTopRightOnSquareIcon, CheckCircleIcon, ExclamationTriangleIcon, ClockIcon, XCircleIcon } from '@heroicons/react/24/outline';

type SourceStatus = 'Mapped' | 'Pending Mapping' | 'Validation Error' | 'Imported';
type SyncStatus = 'Synced' | 'Pending Sync' | 'Sync Failed' | 'Manual';

interface SourceRecord {
  id: string;
  sourceId: string;
  sourceType: string;
  sourceDate: string;
  description: string;
  amount: number;
  currency: string;
  relatedAccount: string;
  accountCode: string;
  sourceStatus: SourceStatus;
  jeReference: string | null;
  createdDate: string;
  syncStatus: SyncStatus;
  mappingStatus: SourceStatus;
  vendor?: string;
}

const sourceData: SourceRecord[] = [
  { id: 'src-001', sourceId: 'INV-2026-1847', sourceType: 'Sales', sourceDate: '2026-09-14', description: 'Customer Invoice — Meridian Corp Q3 Services', amount: 125000.00, currency: 'USD', relatedAccount: 'Accounts Receivable', accountCode: '1200', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0042', createdDate: '2026-09-14', syncStatus: 'Synced', mappingStatus: 'Mapped', vendor: 'Meridian Corp' },
  { id: 'src-002', sourceId: 'PO-2026-0934', sourceType: 'Purchase', sourceDate: '2026-09-13', description: 'Vendor Purchase Order — Apex Supplies Ltd', amount: 48750.00, currency: 'USD', relatedAccount: 'Accounts Payable', accountCode: '2100', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0041', createdDate: '2026-09-13', syncStatus: 'Synced', mappingStatus: 'Mapped', vendor: 'Apex Supplies Ltd' },
  { id: 'src-003', sourceId: 'PR-2026-09-W2', sourceType: 'Payroll', sourceDate: '2026-09-12', description: 'Payroll Run — Sep 2026 Week 2', amount: 287400.00, currency: 'USD', relatedAccount: 'Salaries & Wages Expense', accountCode: '6100', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0040', createdDate: '2026-09-12', syncStatus: 'Synced', mappingStatus: 'Mapped' },
  { id: 'src-004', sourceId: 'BT-2026-0188', sourceType: 'Bank', sourceDate: '2026-09-11', description: 'Bank Transfer — Operating to Reserve Account', amount: 75000.00, currency: 'USD', relatedAccount: 'Cash — Reserve Account', accountCode: '1101', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0039', createdDate: '2026-09-11', syncStatus: 'Synced', mappingStatus: 'Mapped' },
  { id: 'src-005', sourceId: 'DEP-2026-09', sourceType: 'Fixed Assets', sourceDate: '2026-09-10', description: 'Fixed Asset Depreciation Schedule — Sep 2026', amount: 12350.00, currency: 'USD', relatedAccount: 'Depreciation Expense', accountCode: '6500', sourceStatus: 'Validation Error', jeReference: 'JE-2026-09-0038', createdDate: '2026-09-10', syncStatus: 'Sync Failed', mappingStatus: 'Validation Error' },
  { id: 'src-006', sourceId: 'EXP-2026-0417', sourceType: 'Expense', sourceDate: '2026-09-10', description: 'Expense Reimbursement — Sales Team Q3 Travel', amount: 8920.00, currency: 'USD', relatedAccount: 'Travel & Entertainment', accountCode: '6300', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0037', createdDate: '2026-09-10', syncStatus: 'Synced', mappingStatus: 'Mapped' },
  { id: 'src-007', sourceId: 'INV-ADJ-2026-031', sourceType: 'Inventory', sourceDate: '2026-09-09', description: 'Inventory Physical Count Adjustment — Sep 2026', amount: 5640.00, currency: 'USD', relatedAccount: 'Inventory', accountCode: '1400', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0036', createdDate: '2026-09-09', syncStatus: 'Synced', mappingStatus: 'Mapped' },
  { id: 'src-008', sourceId: 'ACR-2026-09-003', sourceType: 'Manual', sourceDate: '2026-09-08', description: 'Accrued Expenses — Utilities & Rent Sep 2026', amount: 34200.00, currency: 'USD', relatedAccount: 'Accrued Liabilities', accountCode: '2200', sourceStatus: 'Pending Mapping', jeReference: 'JE-2026-09-0035', createdDate: '2026-09-08', syncStatus: 'Manual', mappingStatus: 'Pending Mapping' },
  { id: 'src-009', sourceId: 'TAX-Q3-2026', sourceType: 'Tax', sourceDate: '2026-09-07', description: 'Q3 2026 Income Tax Provision Calculation', amount: 62500.00, currency: 'USD', relatedAccount: 'Income Tax Payable', accountCode: '2400', sourceStatus: 'Pending Mapping', jeReference: 'JE-2026-09-0034', createdDate: '2026-09-07', syncStatus: 'Manual', mappingStatus: 'Pending Mapping' },
  { id: 'src-010', sourceId: 'CR-2026-0892', sourceType: 'Cash', sourceDate: '2026-09-06', description: 'Cash Receipt — Hartley Industries Invoice Settlement', amount: 98400.00, currency: 'USD', relatedAccount: 'Cash — Operating Account', accountCode: '1100', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0033', createdDate: '2026-09-06', syncStatus: 'Synced', mappingStatus: 'Mapped', vendor: 'Hartley Industries' },
  { id: 'src-011', sourceId: 'AMR-2026-09-001', sourceType: 'Manual', sourceDate: '2026-09-05', description: 'Prepaid Insurance Amortization — Sep 2026', amount: 4166.67, currency: 'USD', relatedAccount: 'Prepaid Insurance', accountCode: '1500', sourceStatus: 'Pending Mapping', jeReference: 'JE-2026-09-0032', createdDate: '2026-09-05', syncStatus: 'Manual', mappingStatus: 'Pending Mapping' },
  { id: 'src-012', sourceId: 'REV-2026-0291', sourceType: 'Sales', sourceDate: '2026-09-04', description: 'Deferred Revenue Release — Sep 2026 Recognition', amount: 22000.00, currency: 'USD', relatedAccount: 'Deferred Revenue', accountCode: '2600', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0031', createdDate: '2026-09-04', syncStatus: 'Synced', mappingStatus: 'Mapped' },
  { id: 'src-013', sourceId: 'INV-2026-1831', sourceType: 'Sales', sourceDate: '2026-09-03', description: 'Customer Invoice — Brightfield Tech Ltd', amount: 67800.00, currency: 'USD', relatedAccount: 'Accounts Receivable', accountCode: '1200', sourceStatus: 'Imported', jeReference: null, createdDate: '2026-09-03', syncStatus: 'Pending Sync', mappingStatus: 'Imported', vendor: 'Brightfield Tech Ltd' },
  { id: 'src-014', sourceId: 'PO-2026-0921', sourceType: 'Purchase', sourceDate: '2026-09-02', description: 'Vendor Purchase — Nexus IT Solutions', amount: 31500.00, currency: 'USD', relatedAccount: 'Accounts Payable', accountCode: '2100', sourceStatus: 'Imported', jeReference: null, createdDate: '2026-09-02', syncStatus: 'Pending Sync', mappingStatus: 'Imported', vendor: 'Nexus IT Solutions' },
  { id: 'src-015', sourceId: 'PR-2026-09-W1', sourceType: 'Payroll', sourceDate: '2026-09-01', description: 'Payroll Run — Sep 2026 Week 1', amount: 291200.00, currency: 'USD', relatedAccount: 'Salaries & Wages Expense', accountCode: '6100', sourceStatus: 'Mapped', jeReference: 'JE-2026-09-0028', createdDate: '2026-09-01', syncStatus: 'Synced', mappingStatus: 'Mapped' },
];

const sourceTypeColors: Record<string, string> = {
  Sales: 'bg-emerald-100 text-emerald-700',
  Purchase: 'bg-blue-100 text-blue-700',
  Payroll: 'bg-purple-100 text-purple-700',
  Bank: 'bg-cyan-100 text-cyan-700',
  Cash: 'bg-teal-100 text-teal-700',
  Expense: 'bg-orange-100 text-orange-700',
  Inventory: 'bg-yellow-100 text-yellow-700',
  'Fixed Assets': 'bg-indigo-100 text-indigo-700',
  Tax: 'bg-red-100 text-red-700',
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

function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const map: Record<SyncStatus, string> = {
    Synced: 'bg-green-50 text-green-700',
    'Pending Sync': 'bg-amber-50 text-amber-700',
    'Sync Failed': 'bg-red-50 text-red-700',
    Manual: 'bg-slate-50 text-slate-600',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  );
}

export default function SourceDataPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sortField, setSortField] = useState<keyof SourceRecord>('sourceDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedRow, setSelectedRow] = useState<SourceRecord | null>(null);

  const sourceTypes = ['All', 'Sales', 'Purchase', 'Payroll', 'Bank', 'Cash', 'Expense', 'Inventory', 'Fixed Assets', 'Tax', 'Manual'];
  const statuses = ['All', 'Mapped', 'Pending Mapping', 'Validation Error', 'Imported'];

  const filtered = useMemo(() => {
    let data = [...sourceData];
    if (search) data = data.filter(r => r.description.toLowerCase().includes(search.toLowerCase()) || r.sourceId.toLowerCase().includes(search.toLowerCase()) || (r.vendor || '').toLowerCase().includes(search.toLowerCase()));
    if (typeFilter !== 'All') data = data.filter(r => r.sourceType === typeFilter);
    if (statusFilter !== 'All') data = data.filter(r => r.sourceStatus === statusFilter);
    data.sort((a, b) => {
      const av = a[sortField] as string | number;
      const bv = b[sortField] as string | number;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return data;
  }, [search, typeFilter, statusFilter, sortField, sortDir]);

  const handleSort = (field: keyof SourceRecord) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const summaryStats = useMemo(() => ({
    total: sourceData.length,
    mapped: sourceData.filter(r => r.sourceStatus === 'Mapped').length,
    pending: sourceData.filter(r => r.sourceStatus === 'Pending Mapping' || r.sourceStatus === 'Imported').length,
    errors: sourceData.filter(r => r.sourceStatus === 'Validation Error').length,
    totalAmount: sourceData.reduce((s, r) => s + r.amount, 0),
  }), []);

  const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n);

  return (
      <div className="space-y-6 fade-in">
        <JournalEntryTabs activeTab="source" />

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total Sources', value: summaryStats.total, sub: 'All source records', color: 'text-slate-700', bg: 'bg-slate-50' },
            { label: 'Mapped to JE', value: summaryStats.mapped, sub: `${Math.round(summaryStats.mapped / summaryStats.total * 100)}% mapped`, color: 'text-green-700', bg: 'bg-green-50' },
            { label: 'Pending / Imported', value: summaryStats.pending, sub: 'Awaiting mapping', color: 'text-amber-700', bg: 'bg-amber-50' },
            { label: 'Validation Errors', value: summaryStats.errors, sub: 'Require attention', color: 'text-red-700', bg: 'bg-red-50' },
          ].map(card => (
            <div key={card.label} className="je-card p-4">
              <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${card.bg} mb-3`}>
                <span className={`text-sm font-bold ${card.color}`}>{card.value}</span>
              </div>
              <p className="text-xl font-bold text-foreground tabular-nums">{card.value}</p>
              <p className="text-xs font-medium text-foreground mt-0.5">{card.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{card.sub}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="je-card p-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input className="je-input pl-9" placeholder="Search by source ID, description, or vendor…" value={search} onChange={e => setSearch(e.target.value)} />
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
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{filtered.length} of {sourceData.length} records</p>
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
                    { label: 'Date', field: 'sourceDate' },
                    { label: 'Description', field: 'description' },
                    { label: 'Amount', field: 'amount' },
                    { label: 'Account', field: 'relatedAccount' },
                    { label: 'JE Reference', field: 'jeReference' },
                    { label: 'Sync', field: 'syncStatus' },
                    { label: 'Status', field: 'sourceStatus' },
                  ].map(col => (
                    <th key={col.field} className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none whitespace-nowrap" onClick={() => handleSort(col.field as keyof SourceRecord)}>
                      <span className="flex items-center gap-1">{col.label}<ArrowsUpDownIcon className="w-3 h-3 opacity-50" /></span>
                    </th>
                  ))}
                  <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.length === 0 ? (
                  <tr><td colSpan={10} className="px-4 py-12 text-center text-muted-foreground text-sm">No source records match your filters.</td></tr>
                ) : filtered.map(row => (
                  <tr key={row.id} className="table-row-hover cursor-pointer" onClick={() => setSelectedRow(row)}>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-primary whitespace-nowrap">{row.sourceId}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${sourceTypeColors[row.sourceType] || 'bg-gray-100 text-gray-700'}`}>{row.sourceType}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{row.sourceDate}</td>
                    <td className="px-4 py-3 text-xs max-w-xs truncate" title={row.description}>{row.description}</td>
                    <td className="px-4 py-3 text-xs font-semibold tabular-nums text-right whitespace-nowrap">{fmt(row.amount)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <span className="text-muted-foreground">{row.accountCode}</span>
                      <span className="mx-1 text-border">·</span>
                      <span>{row.relatedAccount}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {row.jeReference ? (
                        <span className="font-mono text-xs text-primary font-medium">{row.jeReference}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">Not mapped</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap"><SyncStatusBadge status={row.syncStatus} /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><SourceStatusBadge status={row.sourceStatus} /></td>
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
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">{selectedRow.sourceId}</h3>
                <p className="text-sm text-muted-foreground mt-0.5">{selectedRow.description}</p>
              </div>
              <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setSelectedRow(null)}>✕ Close</button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              {[
                { label: 'Source Type', value: selectedRow.sourceType },
                { label: 'Source Date', value: selectedRow.sourceDate },
                { label: 'Amount', value: fmt(selectedRow.amount) },
                { label: 'Currency', value: selectedRow.currency },
                { label: 'Account Code', value: selectedRow.accountCode },
                { label: 'Account Name', value: selectedRow.relatedAccount },
                { label: 'JE Reference', value: selectedRow.jeReference || 'Not mapped' },
                { label: 'Sync Status', value: selectedRow.syncStatus },
                { label: 'Mapping Status', value: selectedRow.mappingStatus },
                { label: 'Created Date', value: selectedRow.createdDate },
                ...(selectedRow.vendor ? [{ label: 'Vendor / Party', value: selectedRow.vendor }] : []),
              ].map(item => (
                <div key={item.label} className="bg-muted/30 rounded-lg p-3">
                  <p className="text-xs text-muted-foreground mb-1">{item.label}</p>
                  <p className="text-sm font-medium text-foreground">{item.value}</p>
                </div>
              ))}
            </div>
            {selectedRow.sourceStatus === 'Validation Error' && (
              <div className="mt-4 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                <ExclamationTriangleIcon className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">This source record has a validation error. The associated Journal Entry may have a debit/credit mismatch. Please review the depreciation schedule and correct the amounts before reprocessing.</p>
              </div>
            )}
          </div>
        )}
      </div>
  );
}