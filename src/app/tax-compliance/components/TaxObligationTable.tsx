'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const STATUS_STYLES: Record<string, string> = {
  'Draft': 'bg-muted text-muted-foreground',
  'Calculated': 'bg-info-subtle text-info',
  'Ready to File': 'bg-warning-subtle text-warning',
  'Filed': 'bg-chart-2/10 text-chart-2',
  'Paid': 'bg-positive-subtle text-positive',
  'Due Soon': 'bg-warning-subtle text-warning border border-warning/30',
  'Overdue': 'bg-negative-subtle text-negative border border-negative/30',
};

const OBLIGATIONS = [
  { id: 'ob-pph21-aug', taxType: 'PPh 21', period: 'Aug 2026', taxBase: 192_000_000, taxAmount: 38_400_000, dueDate: 'Sep 10, 2026', paymentDate: null, filingDate: null, status: 'Due Soon', reference: 'PPh21/VIII/2026/001' },
  { id: 'ob-pph23-aug', taxType: 'PPh 23', period: 'Aug 2026', taxBase: 64_000_000, taxAmount: 12_800_000, dueDate: 'Sep 10, 2026', paymentDate: null, filingDate: null, status: 'Due Soon', reference: 'PPh23/VIII/2026/001' },
  { id: 'ob-ppn-aug', taxType: 'PPN Masa', period: 'Aug 2026', taxBase: 942_000_000, taxAmount: 94_200_000, dueDate: 'Sep 30, 2026', paymentDate: null, filingDate: null, status: 'Calculated', reference: 'PPN/VIII/2026/001' },
  { id: 'ob-pph25-aug', taxType: 'PPh 25', period: 'Aug 2026', taxBase: 183_000_000, taxAmount: 36_600_000, dueDate: 'Sep 15, 2026', paymentDate: null, filingDate: null, status: 'Ready to File', reference: 'PPh25/VIII/2026/001' },
  { id: 'ob-pph21-jul', taxType: 'PPh 21', period: 'Jul 2026', taxBase: 186_000_000, taxAmount: 37_200_000, dueDate: 'Aug 10, 2026', paymentDate: 'Aug 8, 2026', filingDate: 'Aug 9, 2026', status: 'Paid', reference: 'PPh21/VII/2026/001' },
  { id: 'ob-pph23-jul', taxType: 'PPh 23', period: 'Jul 2026', taxBase: 58_000_000, taxAmount: 11_600_000, dueDate: 'Aug 10, 2026', paymentDate: 'Aug 8, 2026', filingDate: 'Aug 9, 2026', status: 'Paid', reference: 'PPh23/VII/2026/001' },
  { id: 'ob-ppn-jul', taxType: 'PPN Masa', period: 'Jul 2026', taxBase: 908_000_000, taxAmount: 90_800_000, dueDate: 'Aug 31, 2026', paymentDate: 'Aug 28, 2026', filingDate: 'Aug 29, 2026', status: 'Paid', reference: 'PPN/VII/2026/001' },
  { id: 'ob-pph25-jul', taxType: 'PPh 25', period: 'Jul 2026', taxBase: 176_000_000, taxAmount: 35_200_000, dueDate: 'Aug 15, 2026', paymentDate: 'Aug 12, 2026', filingDate: 'Aug 13, 2026', status: 'Paid', reference: 'PPh25/VII/2026/001' },
  { id: 'ob-pph21-jun', taxType: 'PPh 21', period: 'Jun 2026', taxBase: 194_000_000, taxAmount: 38_800_000, dueDate: 'Jul 10, 2026', paymentDate: 'Jul 8, 2026', filingDate: 'Jul 9, 2026', status: 'Paid', reference: 'PPh21/VI/2026/001' },
  { id: 'ob-ppn-jun', taxType: 'PPN Masa', period: 'Jun 2026', taxBase: 936_000_000, taxAmount: 93_600_000, dueDate: 'Jul 31, 2026', paymentDate: 'Jul 29, 2026', filingDate: 'Jul 30, 2026', status: 'Filed', reference: 'PPN/VI/2026/001' },
];

export default function TaxObligationTable() {
  const { fx } = useCurrency();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('dueDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [detailObligation, setDetailObligation] = useState<(typeof OBLIGATIONS)[number] | null>(null);
  const PAGE_SIZE = 7;

  const downloadCsv = (rows: typeof OBLIGATIONS, filename: string) => {
    const header = ['Tax Type', 'Period', 'Tax Base', 'Tax Amount', 'Due Date', 'Payment Date', 'Filing Date', 'Status', 'Reference'];
    const csvRows = rows.map((o) => [o.taxType, o.period, o.taxBase, o.taxAmount, o.dueDate, o.paymentDate || '', o.filingDate || '', o.status, o.reference]);
    const csv = [header, ...csvRows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = OBLIGATIONS.filter((o) =>
    o.taxType.toLowerCase().includes(search.toLowerCase()) ||
    o.period.toLowerCase().includes(search.toLowerCase()) ||
    o.reference.toLowerCase().includes(search.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey as keyof typeof a] ?? '';
    const bv = b[sortKey as keyof typeof b] ?? '';
    return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  });

  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);

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
          <p className="text-xs text-muted-foreground mt-0.5">{filtered.length} obligations · Aug 2026</p>
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
            {paginated.map((ob) => (
              <tr key={ob.id} className="border-b border-border hover:bg-muted/40 transition-colors group">
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-foreground">{ob.taxType}</span>
                </td>
                <td className="px-4 py-3 text-sm text-foreground tabular-nums">{ob.period}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums text-muted-foreground">{fx(formatIDR(ob.taxBase, true))}</td>
                <td className="px-4 py-3 text-sm text-right tabular-nums font-semibold text-foreground">{fx(formatIDR(ob.taxAmount, true))}</td>
                <td className="px-4 py-3 text-sm text-foreground">{ob.dueDate}</td>
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
          Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
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
              <div className="flex justify-between"><span className="text-muted-foreground">Due Date</span><span className="text-foreground">{detailObligation.dueDate}</span></div>
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
