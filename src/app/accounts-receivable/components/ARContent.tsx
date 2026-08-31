'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/ui/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import dynamic from 'next/dynamic';
import { customers, invoices, collectionForecast, formatRupiah, riskColors, arStatusColors, type Customer, type Invoice, type ARStatus } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

const ARCharts = dynamic(() => import('./ARCharts'), { ssr: false });
const CustomerDetailPanel = dynamic(() => import('./CustomerDetailPanel'), { ssr: false });
const InvoiceDetailPanel = dynamic(() => import('./InvoiceDetailPanel'), { ssr: false });

type ARTab = 'overview' | 'customers' | 'invoices' | 'collections';

export default function ARContent() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [activeTab, setActiveTab] = useState<ARTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ARStatus | 'All'>('All');
  const [sortField, setSortField] = useState<keyof Invoice>('daysOverdue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const pageSize = 8;

  const tabs: { id: ARTab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'customers', label: 'Customers', count: customers.length },
    { id: 'invoices', label: 'Invoices', count: invoices.length },
    { id: 'collections', label: 'Collections' },
  ];

  const filteredInvoices = invoices
    .filter((inv) => {
      const matchSearch = searchQuery === '' ||
        inv.number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inv.customerName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'All' || inv.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const av = a[sortField] as any;
      const bv = b[sortField] as any;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const totalPages = Math.ceil(filteredInvoices.length / pageSize);
  const pagedInvoices = filteredInvoices.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (field: keyof Invoice) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRows(next);
  };

  const handleExport = () => {
    toast.success('Export initiated — AR report will be ready in a moment');
  };

  const handleAIAnalyze = () => {
    router.push('/ai-financial-analyst?analysis=ar-risk');
  };

  const kpis = [
    { id: 'kpi-ar-total', label: 'TOTAL ACCOUNTS RECEIVABLE', value: 'Rp 1.24B', subLabel: 'Jan–Aug 2026', change: '-4.3% vs prev period', changePositive: false, sparkline: [980, 1020, 995, 1065, 1038, 1162, 1085, 1240], color: 'var(--primary)' },
    { id: 'kpi-ar-current', label: 'CURRENT RECEIVABLES', value: 'Rp 620M', subLabel: '50% of total AR', change: '+2.1% vs prev period', changePositive: true, sparkline: [580, 595, 610, 600, 615, 608, 612, 620], color: 'var(--success)' },
    { id: 'kpi-ar-overdue', label: 'OVERDUE RECEIVABLES', value: 'Rp 320M', subLabel: '25.8% of total AR', change: '+18.4% vs prev period', changePositive: false, alert: true, sparkline: [180, 195, 210, 205, 240, 268, 295, 320], color: 'var(--danger)' },
    { id: 'kpi-ar-week', label: 'DUE THIS WEEK', value: 'Rp 142M', subLabel: '3 invoices pending', change: '', changeNeutral: true, sparkline: [85, 92, 110, 98, 125, 132, 138, 142], color: 'var(--warning)' },
    { id: 'kpi-ar-90', label: '90+ DAYS OVERDUE', value: 'Rp 85M', subLabel: 'Bad debt risk', change: '+32.8% vs prev period', changePositive: false, alert: true, sparkline: [42, 48, 52, 58, 62, 68, 74, 85], color: 'var(--danger)' },
    { id: 'kpi-ar-dso', label: 'DSO', value: '42 days', subLabel: 'Days Sales Outstanding', change: '+4 days vs prev period', changePositive: false, sparkline: [38, 35, 40, 37, 44, 46, 43, 42], color: 'var(--warning)' },
    { id: 'kpi-ar-collection', label: 'COLLECTION RATE', value: '87.4%', subLabel: 'YTD performance', change: '-1.2% vs prev period', changePositive: false, sparkline: [91, 89, 88, 90, 87, 86, 88, 87.4], color: 'var(--info)' },
    { id: 'kpi-ar-baddebt', label: 'BAD DEBT EXPOSURE', value: 'Rp 72M', subLabel: '5.8% of total AR', change: '+28.6% vs prev period', changePositive: false, alert: true, sparkline: [35, 40, 45, 48, 55, 60, 66, 72], color: 'var(--danger)' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">Accounts Receivable</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor receivables, collections, customer exposure, and overdue balances.</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-600 text-primary">Jan 2026 – Aug 2026</span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-500">YTD</span>
            <span className="text-xs text-muted-foreground">Last updated: 28 Aug 2026, 16:11 WIB</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleAIAnalyze}
            className="flex items-center gap-1.5 text-sm font-500 text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-3 py-1.5 transition-colors border border-purple-200"
          >
            <Icon name="SparklesIcon" size={14} />
            AI Analysis
          </button>
          <button onClick={handleExport} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
            <Icon name="ArrowDownTrayIcon" size={14} />
            Export
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => toast.info('Refreshing AR data...')}>
            <Icon name="ArrowPathIcon" size={16} />
          </button>
        </div>
      </div>

      {/* KPI Grid — 4 cols × 2 rows = 8 cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <KpiCard
            key={k.id}
            label={k.label}
            value={fx(k.value)}
            subLabel={k.subLabel}
            change={k.change}
            changePositive={k.changePositive}
            changeNeutral={k.changeNeutral}
            alert={k.alert}
            sparklineData={k.sparkline}
            sparklineColor={k.color}
          />
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={`ar-tab-${tab.id}`}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-500 border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? 'border-primary text-primary' :'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span className="text-2xs bg-secondary text-muted-foreground px-1.5 py-0.5 rounded-full">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <ARCharts />}

      {activeTab === 'customers' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="text-md font-600 text-foreground">Top Customers by AR Balance</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 bg-secondary rounded-md px-3 py-1.5 w-52">
                <Icon name="MagnifyingGlassIcon" size={13} className="text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search customers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
                />
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  {['Customer', 'Total AR', 'Current', 'Overdue', '90+ Days', 'DSO', 'Credit Limit', 'Utilization', 'Risk', 'Last Payment'].map((h) => (
                    <th key={`cust-th-${h}`} className="px-4 py-2.5 text-left text-2xs font-600 text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {customers
                  .filter((c) => searchQuery === '' || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => setSelectedCustomer(c)}
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-500 text-foreground">{c.name}</p>
                          <p className="text-2xs text-muted-foreground">{c.code} · {c.industry}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-600 text-foreground">{fx(formatRupiah(c.totalAR, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{fx(formatRupiah(c.currentAR, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-danger">{c.overdueAR > 0 ? fx(formatRupiah(c.overdueAR, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums text-danger">{c.ar90Plus > 0 ? fx(formatRupiah(c.ar90Plus, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">{c.dso}d</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{fx(formatRupiah(c.creditLimit, true))}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className="w-16 h-1.5 bg-secondary rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${c.creditUtilization > 80 ? 'bg-danger' : c.creditUtilization > 60 ? 'bg-warning' : 'bg-success'}`}
                              style={{ width: `${c.creditUtilization}%` }}
                            />
                          </div>
                          <span className="text-xs tabular-nums">{c.creditUtilization}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={c.riskLevel} className={riskColors[c.riskLevel]} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{c.lastPayment}</td>
                      <td className="px-4 py-3">
                        <button
                          className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors"
                          onClick={(e) => { e.stopPropagation(); toast.info(`Menu aksi untuk ${c.name}`); }}
                        >
                          <Icon name="EllipsisHorizontalIcon" size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'invoices' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          {/* Toolbar */}
          <div className="flex items-center justify-between p-4 border-b border-border gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-secondary rounded-md px-3 py-1.5 w-56">
                <Icon name="MagnifyingGlassIcon" size={13} className="text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search invoices..."
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1); }}
                  className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value as any); setCurrentPage(1); }}
                className="text-sm border border-border rounded-md px-2.5 py-1.5 bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                <option value="All">All Status</option>
                {(['Open', 'Due Soon', 'Overdue', 'Partially Paid', 'Paid', 'Disputed', 'Written Off'] as ARStatus[]).map((s) => (
                  <option key={`status-opt-${s}`} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {selectedRows.size > 0 && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-md px-3 py-1.5">
                  <span className="text-sm font-600 text-primary">{selectedRows.size} selected</span>
                  <button className="text-sm text-primary hover:text-primary/80" onClick={() => toast.success(`${selectedRows.size} invoices exported`)}>Export</button>
                  <button className="text-sm text-danger hover:text-danger/80" onClick={() => { setSelectedRows(new Set()); toast.info('Selection cleared'); }}>Clear</button>
                </div>
              )}
              <button onClick={handleExport} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
                <Icon name="ArrowDownTrayIcon" size={13} />
                Export
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  <th className="px-4 py-2.5 w-10">
                    <input type="checkbox" className="rounded" onChange={(e) => {
                      if (e.target.checked) setSelectedRows(new Set(pagedInvoices.map(i => i.id)));
                      else setSelectedRows(new Set());
                    }} />
                  </th>
                  {([
                    { key: 'number', label: 'Invoice #' },
                    { key: 'customerName', label: 'Customer' },
                    { key: 'invoiceDate', label: 'Invoice Date' },
                    { key: 'dueDate', label: 'Due Date' },
                    { key: 'amount', label: 'Amount' },
                    { key: 'paid', label: 'Paid' },
                    { key: 'outstanding', label: 'Outstanding' },
                    { key: 'daysOverdue', label: 'Days Overdue' },
                    { key: 'status', label: 'Status' },
                    { key: 'priority', label: 'Priority' },
                  ] as { key: keyof Invoice; label: string }[]).map((col) => (
                    <th
                      key={`inv-th-${col.key}`}
                      className="px-4 py-2.5 text-left text-2xs font-600 text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground"
                      onClick={() => handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.label}
                        {sortField === col.key && (
                          <Icon name={sortDir === 'asc' ? 'ChevronUpIcon' : 'ChevronDownIcon'} size={12} className="text-primary" />
                        )}
                      </div>
                    </th>
                  ))}
                  <th className="px-4 py-2.5 text-2xs font-600 text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40" />
                        <p className="text-sm font-500 text-muted-foreground">No invoices match your current filters</p>
                        <button onClick={() => { setSearchQuery(''); setStatusFilter('All'); }} className="text-xs text-primary hover:underline">Clear filters</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedInvoices.map((inv) => (
                    <tr
                      key={inv.id}
                      className={`border-b border-border hover:bg-secondary/40 cursor-pointer transition-colors ${selectedRows.has(inv.id) ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded" checked={selectedRows.has(inv.id)} onChange={() => toggleRow(inv.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="px-4 py-3 font-500 text-primary hover:underline cursor-pointer" onClick={() => setSelectedInvoice(inv)}>{inv.number}</td>
                      <td className="px-4 py-3">
                        <p className="font-500 text-foreground">{inv.customerName}</p>
                        <p className="text-2xs text-muted-foreground">{inv.accountManager}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.invoiceDate}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.dueDate}</td>
                      <td className="px-4 py-3 tabular-nums font-500">{fx(formatRupiah(inv.amount, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{inv.paid > 0 ? fx(formatRupiah(inv.paid, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums font-600 text-foreground">{inv.outstanding > 0 ? fx(formatRupiah(inv.outstanding, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {inv.daysOverdue > 0 ? (
                          <span className={`font-600 ${inv.daysOverdue > 60 ? 'text-danger' : inv.daysOverdue > 30 ? 'text-warning' : 'text-orange-600'}`}>
                            {inv.daysOverdue}d
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={inv.status} className={arStatusColors[inv.status]} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={inv.priority}
                          className={
                            inv.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' :
                            inv.priority === 'High' ? 'bg-orange-50 text-orange-700' :
                            inv.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                            'bg-secondary text-muted-foreground'
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="View invoice" onClick={() => setSelectedInvoice(inv)}>
                            <Icon name="EyeIcon" size={14} />
                          </button>
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Record payment" onClick={() => toast.success(`Recording payment for ${inv.number}`)}>
                            <Icon name="BanknotesIcon" size={14} />
                          </button>
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Add note" onClick={() => toast.info(`Note added to ${inv.number}`)}>
                            <Icon name="ChatBubbleLeftIcon" size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {Math.min((currentPage - 1) * pageSize + 1, filteredInvoices.length)}–{Math.min(currentPage * pageSize, filteredInvoices.length)} of {filteredInvoices.length} invoices
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 transition-colors"
              >
                <Icon name="ChevronLeftIcon" size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={`page-${p}`}
                  onClick={() => setCurrentPage(p)}
                  className={`w-7 h-7 text-xs rounded font-500 transition-colors ${
                    currentPage === p ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 transition-colors"
              >
                <Icon name="ChevronRightIcon" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'collections' && <ARCollections />}

      {/* Detail Panels */}
      {selectedCustomer && (
        <CustomerDetailPanel customer={selectedCustomer} onClose={() => setSelectedCustomer(null)} />
      )}
      {selectedInvoice && (
        <InvoiceDetailPanel invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}
    </div>
  );
}

function ARCollections() {
  const { fx } = useCurrency();
  const critical = invoices.filter((i) => i.priority === 'Critical' && i.outstanding > 0);
  const high = invoices.filter((i) => i.priority === 'High' && i.outstanding > 0);
  const medium = invoices.filter((i) => i.priority === 'Medium' && i.outstanding > 0);

  const CollectionCard = ({ inv }: { inv: Invoice }) => (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-600 text-foreground">{inv.customerName}</p>
          <p className="text-xs text-muted-foreground">{inv.number}</p>
        </div>
        <StatusBadge
          label={inv.priority}
          className={
            inv.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' :
            inv.priority === 'High'? 'bg-orange-50 text-orange-700' : 'bg-warning-bg text-warning-foreground'
          }
        />
      </div>
      <p className="text-xl font-700 tabular-nums text-foreground">{fx(formatRupiah(inv.outstanding, true))}</p>
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs font-500 ${inv.daysOverdue > 60 ? 'text-danger' : inv.daysOverdue > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {inv.daysOverdue > 0 ? `${inv.daysOverdue} days overdue` : 'Due soon'}
        </span>
        <div className="flex gap-1">
          <button className="text-xs text-primary hover:underline font-500" onClick={() => toast.success('Collection action recorded')}>Record</button>
          <button className="text-xs text-muted-foreground hover:text-foreground font-500 ml-2" onClick={() => toast.info('Note added')}>Note</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-danger-bg border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ExclamationTriangleIcon" size={16} className="text-danger" />
            <span className="text-sm font-600 text-danger">Critical — Immediate Action</span>
          </div>
          <div className="space-y-3">
            {critical.map((inv) => <CollectionCard key={inv.id} inv={inv} />)}
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="BellAlertIcon" size={16} className="text-orange-600" />
            <span className="text-sm font-600 text-orange-700">High Priority</span>
          </div>
          <div className="space-y-3">
            {high.map((inv) => <CollectionCard key={inv.id} inv={inv} />)}
          </div>
        </div>
        <div className="bg-warning-bg border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ClockIcon" size={16} className="text-warning" />
            <span className="text-sm font-600 text-warning">Medium Priority</span>
          </div>
          <div className="space-y-3">
            {medium.map((inv) => <CollectionCard key={inv.id} inv={inv} />)}
          </div>
        </div>
      </div>

      {/* Collection Forecast */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-600 text-foreground mb-4">Collection Forecast</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {collectionForecast.map((cf) => (
            <div key={`cf-${cf.period}`} className="text-center p-3 bg-secondary rounded-lg">
              <p className="text-xs text-muted-foreground font-500 mb-1">{cf.period}</p>
              <p className="text-xl font-700 tabular-nums text-foreground">{fx(formatRupiah(cf.expected, true))}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cf.probability}% probability</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}