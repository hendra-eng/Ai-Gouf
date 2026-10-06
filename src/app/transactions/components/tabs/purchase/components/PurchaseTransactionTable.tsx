'use client';
import React, { useState, useMemo } from 'react';
import { Search, ChevronDown, ChevronUp, Eye, Edit2, MoreHorizontal, X, ChevronLeft, ChevronRight, Download, Filter } from 'lucide-react';
import StatusBadge from '../../shared/TabStatusBadge';
import PurchaseDetailPanel from './PurchaseDetailPanel';
import { toast } from 'sonner';

export interface PurchaseTransaction {
  id: string;
  purchaseId: string;
  invoiceNumber: string;
  purchaseDate: string;
  vendor: string;
  vendorId: string;
  purchaseOrder: string;
  productService: string;
  category: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  paymentStatus: 'paid' | 'unpaid' | 'partial' | 'overdue';
  approvalStatus: 'approved' | 'pending' | 'rejected' | 'draft';
  postingStatus: 'posted' | 'draft' | 'pending';
  source: string;
  accountingPeriod: string;
  createdBy: string;
  createdDate: string;
  dueDate: string;
  expenseAccount: string;
  apAccount: string;
  taxAccount: string;
}

// Backend integration point: replace with API call to /api/transactions/purchases
const purchaseData: PurchaseTransaction[] = [];

type SortField = keyof PurchaseTransaction;
type SortDir = 'asc' | 'desc';

export default function PurchaseTransactionTable() {
  const [search, setSearch] = useState('');
  const [approvalFilter, setApprovalFilter] = useState('all');
  const [paymentFilter, setPaymentFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('purchaseDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    let data = [...purchaseData];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.purchaseId.toLowerCase().includes(q) ||
          r.invoiceNumber.toLowerCase().includes(q) ||
          r.vendor.toLowerCase().includes(q) ||
          r.productService.toLowerCase().includes(q)
      );
    }
    if (approvalFilter !== 'all') data = data.filter((r) => r.approvalStatus === approvalFilter);
    if (paymentFilter !== 'all') data = data.filter((r) => r.paymentStatus === paymentFilter);
    if (categoryFilter !== 'all') data = data.filter((r) => r.category === categoryFilter);
    data.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number')
        return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [search, approvalFilter, paymentFilter, categoryFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };

  const toggleRow = (id: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedRows.size === paginated.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(paginated.map((r) => r.id)));
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="inline-flex flex-col ml-1">
      {sortField === field ? (
        sortDir === 'asc' ? <ChevronUp size={12} className="text-primary" /> : <ChevronDown size={12} className="text-primary" />
      ) : (
        <ChevronDown size={12} className="text-muted-foreground opacity-40" />
      )}
    </span>
  );

  const selectedTx = purchaseData.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm">
      <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search PO, vendor, invoice…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-8 pr-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-primary transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X size={12} />
            </button>
          )}
        </div>
        <select
          value={approvalFilter}
          onChange={(e) => { setApprovalFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Approvals</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
          <option value="draft">Draft</option>
        </select>
        <select
          value={paymentFilter}
          onChange={(e) => { setPaymentFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Payments</option>
          <option value="paid">Paid</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partial</option>
          <option value="overdue">Overdue</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
          className="text-sm border border-border rounded-lg px-3 py-2 bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30"
        >
          <option value="all">All Categories</option>
          <option value="Technology">Technology</option>
          <option value="Raw Materials">Raw Materials</option>
          <option value="Office Supplies">Office Supplies</option>
          <option value="Logistics">Logistics</option>
          <option value="Cloud Services">Cloud Services</option>
          <option value="Engineering">Engineering</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} records</span>
          <button
            onClick={() => toast.success('Exporting purchase transactions…')}
            className="flex items-center gap-1.5 text-sm text-muted-foreground border border-border rounded-lg px-3 py-2 hover:bg-muted transition-colors"
          >
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {selectedRows.size > 0 && (
        <div className="animate-slide-up px-5 py-2.5 bg-primary/5 border-b border-primary/20 flex items-center gap-3">
          <span className="text-sm font-500 text-primary">{selectedRows.size} selected</span>
          <button onClick={() => { toast.success(`${selectedRows.size} purchase(s) approved`); setSelectedRows(new Set()); }} className="text-sm font-500 text-primary hover:underline">Approve</button>
          <button onClick={() => toast.success('Export initiated')} className="text-sm font-500 text-muted-foreground hover:text-foreground">Export</button>
          <button onClick={() => setSelectedRows(new Set())} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-sm min-w-[1200px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="w-10 px-4 py-3">
                <input type="checkbox" checked={selectedRows.size === paginated.length && paginated.length > 0} onChange={toggleAll} className="rounded border-border" />
              </th>
              {[
                { key: 'purchaseId', label: 'Purchase ID' },
                { key: 'invoiceNumber', label: 'Vendor Invoice' },
                { key: 'purchaseDate', label: 'Date' },
                { key: 'vendor', label: 'Vendor' },
                { key: 'category', label: 'Category' },
                { key: 'subtotal', label: 'Subtotal' },
                { key: 'tax', label: 'Input Tax' },
                { key: 'total', label: 'Total' },
                { key: 'approvalStatus', label: 'Approval' },
                { key: 'paymentStatus', label: 'Payment' },
                { key: 'postingStatus', label: 'Posting' },
              ].map((col) => (
                <th
                  key={`pcol-${col.key}`}
                  onClick={() => handleSort(col.key as SortField)}
                  className="px-4 py-3 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground whitespace-nowrap select-none"
                >
                  {col.label}
                  <SortIcon field={col.key as SortField} />
                </th>
              ))}
              <th className="px-4 py-3 text-left text-[11px] font-600 uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {paginated.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-16 text-center">
                  <div className="flex flex-col items-center gap-2">
                    <Filter size={28} className="text-muted-foreground opacity-40" />
                    <p className="text-sm font-500 text-muted-foreground">No purchases match your filters</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginated.map((row) => (
                <tr
                  key={`pur-row-${row.id}`}
                  className={`border-b border-border transition-colors duration-100 cursor-pointer ${selectedId === row.id ? 'bg-primary/5' : 'hover:bg-muted/40'} ${selectedRows.has(row.id) ? 'bg-primary/5' : ''}`}
                  onClick={() => setSelectedId(selectedId === row.id ? null : row.id)}
                >
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedRows.has(row.id)} onChange={() => toggleRow(row.id)} className="rounded border-border" />
                  </td>
                  <td className="px-4 py-3 font-500 text-primary font-tabular whitespace-nowrap">{row.purchaseId}</td>
                  <td className="px-4 py-3 text-muted-foreground font-tabular whitespace-nowrap">{row.invoiceNumber}</td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap font-tabular">{row.purchaseDate}</td>
                  <td className="px-4 py-3 font-500 text-foreground max-w-[160px] truncate">{row.vendor}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-md font-500">{row.category}</span>
                  </td>
                  <td className="px-4 py-3 text-right font-tabular text-foreground whitespace-nowrap">${row.subtotal.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-tabular text-muted-foreground whitespace-nowrap">${row.tax.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-700 font-tabular text-foreground whitespace-nowrap">${row.total.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.approvalStatus as 'approved' | 'pending' | 'rejected' | 'draft'} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.paymentStatus} size="sm" />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.postingStatus as 'posted' | 'draft' | 'pending'} size="sm" />
                  </td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button onClick={() => setSelectedId(selectedId === row.id ? null : row.id)} title="View details" className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                        <Eye size={14} />
                      </button>
                      <button onClick={() => toast.info(`Editing ${row.purchaseId}`)} title="Edit purchase" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => toast.info('More actions')} title="More actions" className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selectedTx && (
        <div className="border-t border-border animate-fade-in">
          <PurchaseDetailPanel tx={selectedTx} onClose={() => setSelectedId(null)} />
        </div>
      )}

      <div className="px-5 py-3 border-t border-border flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-muted-foreground">
          Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} purchases
        </p>
        <div className="flex items-center gap-1">
          <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button key={`ppage-${p}`} onClick={() => setPage(p)} className={`w-7 h-7 text-xs rounded-md font-500 transition-colors ${page === p ? 'bg-primary text-primary-foreground' : 'border border-border text-muted-foreground hover:bg-muted'}`}>
              {p}
            </button>
          ))}
          <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-md border border-border text-muted-foreground hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}