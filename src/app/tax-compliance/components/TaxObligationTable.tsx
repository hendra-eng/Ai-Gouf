'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData, type TaxObligation } from '../lib/taxBridge';

const STATUS_STYLES: Record<string, string> = {
  'Draft': 'bg-muted text-muted-foreground',
  'Calculated': 'bg-info-subtle text-info',
  'Ready to File': 'bg-warning-subtle text-warning',
  'Filed': 'bg-chart-2/10 text-chart-2',
  'Paid': 'bg-positive-subtle text-positive',
  'Due Soon': 'bg-warning-subtle text-warning border border-warning/30',
  'Overdue': 'bg-negative-subtle text-negative border border-negative/30',
};

export default function TaxObligationTable() {
  const { fx } = useCurrency();
  const { obligations, isSampleData } = useTaxComplianceData();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [detailObligation, setDetailObligation] = useState<TaxObligation | null>(null);
  const PAGE_SIZE = 7;

  const downloadCsv = (rows: TaxObligation[], filename: string) => {
    const header = ['Tax Type', 'Period', 'Tax Base', 'Tax Amount', 'Due Date', 'Payment Date', 'Filing Date', 'Status', 'Reference'];
    const csvRows = rows.map((o) => [o.taxType, o.period, o.taxBase, o.taxAmount, o.dueDateLabel, o.paymentDate || '', o.filingDate || '', o.status, o.reference]);
    const csv = [header, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = obligations.filter((o) =>
    o.taxType.toLowerCase().includes(search.toLowerCase()) ||
    o.period.toLowerCase().includes(search.toLowerCase()) ||
    o.reference.toLowerCase().includes(search.toLowerCase())
  );

  const sortValue = (o: TaxObligation, key: string) => {
    if (key === 'dueDate') return o.dueDate.getTime();
    return (o as unknown as Record<string, unknown>)[key] ?? '';
  };

  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, sortKey);
    const bv = sortValue(b, sortKey);
    if (typeof av === 'number' && typeof bv === 'number') {
      return sortDir === 'asc' ? av - bv : bv - av;
    }
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  };

  const SortIcon = ({ col }: { col: string }) => (
    <Icon
      name={sortKey === col ? (sortDir === 'asc' ? 'ChevronUpIcon' : 'ChevronDownIcon') : 'ChevronUpDownIcon'}
      size={12}
      className={sortKey === col ? 'text-primary' : 'text-muted-foreground'}
    />
  );

  return (
    <div id="tax-obligations" className="card-base">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Tax Obligations</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {filtered.length} obligations{isSampleData ? ' · Sample data' : ' · From posted tax transactions'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
            <Icon name="MagnifyingGlassIcon" size={14} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search obligations..."
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-36"
            />
          </div>
          <button
            onClick={() => downloadCsv(sorted, 'tax-obligations.csv')}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 bg-muted border border-border rounded-lg"
          >
            <Icon name="ArrowDownTrayIcon" size={14} />
            Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr className="border-b border-border">
              {[
                { key: 'taxType', label: 'Tax Type' },
                { key: 'period', label: 'Period' },
                { key: 'taxBase', label: 'Tax Base' },
                { key: 'taxAmount', label: 'Tax Amount' },
                { key: 'dueDate', label: 'Due Date' },
                { key: 'paymentDate', label: 'Payment Date' },
                { key: 'filingDate', label: 'Filing Date' },
                { key: 'status', label: 'Status' },
                { key: 'reference', label: 'Reference' },
              ].map((col) => (
                <th
                  key={`th-${col.key}`}
                  onClick={() => handleSort(col.key)}
                  className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground cursor-pointer hover:text-foreground transition-colors select-none"
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    <SortIcon col={col.key} />
                  </div>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  No tax obligations found. They appear here once tax payment journals (category "Tax") are posted for this client.
                </td>
              </tr>
            )}
            {paginated.map((ob) => (
              <tr key={ob.id} className="border-b border-border hover:bg-muted/40 transition-colors group">
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-foreground">{ob.taxType}</span>
                </td>
                <td className="px-4 py-3 text-sm text-foreground tabular-nums">{ob.period}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{fx(formatIDR(ob.taxBase, true))}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums font-semibold text-foreground">{fx(formatIDR(ob.taxAmount, true))}</td>
                <td className="px-4 py-3 text-sm text-foreground">{ob.dueDateLabel}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{ob.paymentDate || '—'}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{ob.filingDate || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-2xs font-semibold px-2 py-1 rounded-full ${STATUS_STYLES[ob.status] || 'bg-muted text-muted-foreground'}`}>
                    {ob.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs font-mono text-muted-foreground">{ob.reference}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setDetailObligation(ob)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="View details">
                      <Icon name="EyeIcon" size={14} />
                    </button>
                    <button onClick={() => downloadCsv([ob], `${ob.reference}.csv`)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors" title="Download">
                      <Icon name="ArrowDownTrayIcon" size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between px-5 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground">
          {sorted.length === 0 ? 'Showing 0 of 0' : `Showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, sorted.length)} of ${sorted.length}`}
        </p>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page === 1}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="ChevronLeftIcon" size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button
              key={`page-${p}`}
              onClick={() => setPage(p)}
              className={`w-7 h-7 rounded-lg text-xs font-medium transition-colors ${p === page ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}
            >
              {p}
            </button>
          ))}
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page === totalPages}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Icon name="ChevronRightIcon" size={14} />
          </button>
        </div>
      </div>

      {detailObligation && (
        <div
          className="fixed inset-0 bg-foreground/20 z-50 flex items-center justify-center p-4"
          onClick={() => setDetailObligation(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-xl shadow-card-lg w-full max-w-md p-5 fade-in"
          >
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-base font-semibold text-foreground">{detailObligation.taxType} · {detailObligation.period}</h4>
              <button onClick={() => setDetailObligation(null)} className="p-1 rounded-lg hover:bg-muted text-muted-foreground">
                <Icon name="XMarkIcon" size={16} />
              </button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Tax Base</span><span className="tabular-nums text-foreground">{fx(formatIDR(detailObligation.taxBase, true))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Tax Amount</span><span className="tabular-nums font-semibold text-foreground">{fx(formatIDR(detailObligation.taxAmount, true))}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span className="text-foreground">{detailObligation.dueDateLabel}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Payment Date</span><span className="text-foreground">{detailObligation.paymentDate || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Filing Date</span><span className="text-foreground">{detailObligation.filingDate || '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span className="text-foreground">{detailObligation.status}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-xs text-foreground">{detailObligation.reference}</span></div>
            </div>
            <button
              onClick={() => downloadCsv([detailObligation], `${detailObligation.reference}.csv`)}
              className="w-full mt-4 flex items-center justify-center gap-1.5 text-xs font-semibold text-primary-foreground bg-primary rounded-lg py-2 hover:bg-primary/90 transition-colors"
            >
              <Icon name="ArrowDownTrayIcon" size={14} />
              Download
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
