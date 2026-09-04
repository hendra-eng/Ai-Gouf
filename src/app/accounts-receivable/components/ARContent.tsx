'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import dynamic from 'next/dynamic';
import { formatRupiah, riskColors, arStatusColors, type Customer, type Invoice, type ARStatus } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
// [BARU] Data customers/invoices/KPI di halaman ini TIDAK LAGI dari mock
// statis — semuanya diturunkan langsung dari transaksi kelompok Sales di
// halaman Transaksi lewat TransactionsContext + arBridge.ts. Kalau ada
// transaksi Sales baru/diedit, halaman ini otomatis ikut berubah (re-render)
// karena sama-sama membaca context yang sama. Polanya sama persis dengan
// APContent.tsx (Expense -> Account Payable).
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import {
  AR_REFERENCE_DATE,
  invoicesFromTransactions,
  customersFromInvoices,
  arKpisFromInvoices,
  arAgingFromInvoices,
  arTrendFromInvoices,
  sparklineFromTrend,
  collectionForecastFromInvoices,
} from '@/app/transactions/lib/arBridge';

const ARCharts = dynamic(() => import('./ARCharts'), { ssr: false });
const CustomerDetailPanel = dynamic(() => import('./CustomerDetailPanel'), { ssr: false });
const InvoiceDetailPanel = dynamic(() => import('./InvoiceDetailPanel'), { ssr: false });

type ARTab = 'overview' | 'customers' | 'invoices' | 'collections';

export default function ARContent() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { transactions } = useTransactions();

  // ─── Turunan dari transaksi Sales (sumber tunggal) ─────────────────────
  const invoices = useMemo(() => invoicesFromTransactions(transactions), [transactions]);
  const customers = useMemo(() => customersFromInvoices(invoices), [invoices]);
  const kpiValues = useMemo(() => arKpisFromInvoices(invoices, customers), [invoices, customers]);
  const agingData = useMemo(() => arAgingFromInvoices(invoices), [invoices]);
  const trendData = useMemo(() => arTrendFromInvoices(invoices), [invoices]);
  const forecastData = useMemo(() => collectionForecastFromInvoices(invoices), [invoices]);
  const trendSparkline = useMemo(() => sparklineFromTrend(trendData), [trendData]);

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

  // [DIUBAH] Sebelumnya 8 angka ini hardcoded string. Sekarang dihitung
  // langsung dari `invoices` (hasil turunan transaksi Sales) lewat
  // arKpisFromInvoices() — kalau ada transaksi Sales baru/status
  // pembayarannya berubah, angka-angka ini otomatis ikut berubah, sama
  // seperti kpiValues di APContent.tsx.
  const overduePct = kpiValues.totalAR > 0 ? Math.round((kpiValues.overdueAR / kpiValues.totalAR) * 1000) / 10 : 0;
  const ar90PlusPct = kpiValues.totalAR > 0 ? Math.round((kpiValues.ar90Plus / kpiValues.totalAR) * 1000) / 10 : 0;

  const kpis: { id: string; label: string; value: string; subLabel: string; change: string; changeNeutral: boolean; changePositive?: boolean; alert?: boolean; sparkline: number[]; color: string }[] = [
    { id: 'kpi-ar-total', label: 'TOTAL ACCOUNTS RECEIVABLE', value: formatRupiah(kpiValues.totalAR, true), subLabel: `Dari ${invoices.length} transaksi Sales`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--primary)' },
    { id: 'kpi-ar-current', label: 'CURRENT RECEIVABLES', value: formatRupiah(kpiValues.currentAR, true), subLabel: `${kpiValues.totalAR > 0 ? Math.round((kpiValues.currentAR / kpiValues.totalAR) * 1000) / 10 : 0}% dari total AR`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--success)' },
    { id: 'kpi-ar-overdue', label: 'OVERDUE RECEIVABLES', value: formatRupiah(kpiValues.overdueAR, true), subLabel: `${overduePct}% dari total AR`, change: '', changeNeutral: true, alert: kpiValues.overdueAR > 0, sparkline: trendSparkline, color: 'var(--danger)' },
    { id: 'kpi-ar-week', label: 'DUE SOON', value: formatRupiah(kpiValues.dueSoonAR, true), subLabel: 'Jatuh tempo ≤ 7 hari', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--warning)' },
    { id: 'kpi-ar-90', label: '90+ DAYS OVERDUE', value: formatRupiah(kpiValues.ar90Plus, true), subLabel: 'Bad debt risk', change: '', changeNeutral: true, alert: kpiValues.ar90Plus > 0, sparkline: trendSparkline, color: 'var(--danger)' },
    { id: 'kpi-ar-dso', label: 'DSO', value: `${kpiValues.dso} days`, subLabel: 'Days Sales Outstanding', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--warning)' },
    { id: 'kpi-ar-collection', label: 'COLLECTION RATE', value: `${kpiValues.collectionRate}%`, subLabel: 'YTD performance', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--info)' },
    { id: 'kpi-ar-baddebt', label: 'BAD DEBT EXPOSURE', value: formatRupiah(kpiValues.badDebtExposure, true), subLabel: `${ar90PlusPct}% dari total AR`, change: '', changeNeutral: true, alert: kpiValues.badDebtExposure > 0, sparkline: trendSparkline, color: 'var(--danger)' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Accounts Receivable</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor receivables, collections, customer exposure, and overdue balances.</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="badge-info">Tersinkron dari Transaksi → Sales</span>
            <span className="badge-neutral">{invoices.length} invoice · {customers.length} customer</span>
            <span className="text-xs text-muted-foreground">Per {AR_REFERENCE_DATE}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={handleAIAnalyze}
            className="flex items-center gap-1.5 text-sm font-medium text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-3 py-1.5 transition-colors border border-purple-200"
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
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
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
      {activeTab === 'overview' && (
        <ARCharts
          agingData={agingData}
          trendData={trendData}
          customers={customers}
          totalAR={kpiValues.totalAR}
          overdueAR={kpiValues.overdueAR}
          dso={kpiValues.dso}
        />
      )}

      {activeTab === 'customers' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="text-md font-semibold text-foreground">Top Customers by AR Balance</h3>
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
                    <th key={`cust-th-${h}`} className="px-4 py-2.5 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {customers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Icon name="UsersIcon" size={32} className="text-muted-foreground/40" />
                        <p className="text-sm font-medium text-muted-foreground">Belum ada transaksi Sales</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  customers
                    .filter((c) => searchQuery === '' || c.name.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((c) => (
                      <tr
                        key={c.id}
                        className="border-b border-border hover:bg-secondary/40 cursor-pointer transition-colors"
                        onClick={() => setSelectedCustomer(c)}
                      >
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-foreground">{c.name}</p>
                            <p className="text-2xs text-muted-foreground">{c.code} · {c.industry}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 tabular-nums font-semibold text-foreground">{fx(formatRupiah(c.totalAR, true))}</td>
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
                    ))
                )}
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
                  <span className="text-sm font-semibold text-primary">{selectedRows.size} selected</span>
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
                      className="px-4 py-2.5 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap cursor-pointer hover:text-foreground"
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
                  <th className="px-4 py-2.5 text-2xs font-semibold text-muted-foreground uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedInvoices.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40" />
                        <p className="text-sm font-medium text-muted-foreground">No invoices match your current filters</p>
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
                      <td className="px-4 py-3 font-medium text-primary hover:underline cursor-pointer" onClick={() => setSelectedInvoice(inv)}>{inv.number}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{inv.customerName}</p>
                        <p className="text-2xs text-muted-foreground">{inv.accountManager}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.invoiceDate}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{inv.dueDate}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{fx(formatRupiah(inv.amount, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{inv.paid > 0 ? fx(formatRupiah(inv.paid, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-foreground">{inv.outstanding > 0 ? fx(formatRupiah(inv.outstanding, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {inv.daysOverdue > 0 ? (
                          <span className={`font-semibold ${inv.daysOverdue > 60 ? 'text-danger' : inv.daysOverdue > 30 ? 'text-warning' : 'text-orange-600'}`}>
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
                  className={`w-7 h-7 text-xs rounded font-medium transition-colors ${
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

      {activeTab === 'collections' && <ARCollections invoices={invoices} forecastData={forecastData} />}

      {/* Detail Panels */}
      {selectedCustomer && (
        <CustomerDetailPanel customer={selectedCustomer} invoices={invoices} onClose={() => setSelectedCustomer(null)} />
      )}
      {selectedInvoice && (
        <InvoiceDetailPanel invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
      )}
    </div>
  );
}

// [DIUBAH] invoices & forecastData sekarang diterima lewat props (hasil
// turunan transaksi Sales), bukan import langsung dari mockData — sama
// seperti APPaymentPlanning di APContent.tsx.
function ARCollections({ invoices, forecastData }: { invoices: Invoice[]; forecastData: ReturnType<typeof collectionForecastFromInvoices> }) {
  const { fx } = useCurrency();
  const critical = invoices.filter((i) => i.priority === 'Critical' && i.outstanding > 0);
  const high = invoices.filter((i) => i.priority === 'High' && i.outstanding > 0);
  const medium = invoices.filter((i) => i.priority === 'Medium' && i.outstanding > 0);

  const CollectionCard = ({ inv }: { inv: Invoice }) => (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{inv.customerName}</p>
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
      <p className="text-xl font-bold tabular-nums text-foreground">{fx(formatRupiah(inv.outstanding, true))}</p>
      <div className="flex items-center justify-between mt-2">
        <span className={`text-xs font-medium ${inv.daysOverdue > 60 ? 'text-danger' : inv.daysOverdue > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
          {inv.daysOverdue > 0 ? `${inv.daysOverdue} days overdue` : 'Due soon'}
        </span>
        <div className="flex gap-1">
          <button className="text-xs text-primary hover:underline font-medium" onClick={() => toast.success('Collection action recorded')}>Record</button>
          <button className="text-xs text-muted-foreground hover:text-foreground font-medium ml-2" onClick={() => toast.info('Note added')}>Note</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-danger-bg border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ExclamationTriangleIcon" size={16} className="text-danger" />
            <span className="text-sm font-semibold text-danger">Critical — Immediate Action</span>
          </div>
          <div className="space-y-3">
            {critical.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Tidak ada invoice kritis</p>
            ) : (
              critical.map((inv) => <CollectionCard key={inv.id} inv={inv} />)
            )}
          </div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="BellAlertIcon" size={16} className="text-orange-600" />
            <span className="text-sm font-semibold text-orange-700">High Priority</span>
          </div>
          <div className="space-y-3">
            {high.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Tidak ada invoice high priority</p>
            ) : (
              high.map((inv) => <CollectionCard key={inv.id} inv={inv} />)
            )}
          </div>
        </div>
        <div className="bg-warning-bg border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ClockIcon" size={16} className="text-warning" />
            <span className="text-sm font-semibold text-warning">Medium Priority</span>
          </div>
          <div className="space-y-3">
            {medium.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Tidak ada invoice medium priority</p>
            ) : (
              medium.map((inv) => <CollectionCard key={inv.id} inv={inv} />)
            )}
          </div>
        </div>
      </div>

      {/* Collection Forecast */}
      <div className="bg-card border border-border rounded-lg p-5 shadow-card">
        <h3 className="text-md font-semibold text-foreground mb-4">Collection Forecast</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {forecastData.map((cf) => (
            <div key={`cf-${cf.period}`} className="text-center p-3 bg-secondary rounded-lg">
              <p className="text-xs text-muted-foreground font-medium mb-1">{cf.period}</p>
              <p className="text-xl font-bold tabular-nums text-foreground">{fx(formatRupiah(cf.expected, true))}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{cf.probability}% probability</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}