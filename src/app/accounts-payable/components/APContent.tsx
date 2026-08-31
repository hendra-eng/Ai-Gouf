'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/ui/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import dynamic from 'next/dynamic';
import { vendors, bills, paymentForecastData, formatRupiah, riskColors, apStatusColors, type Vendor, type Bill, type APStatus } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';

const APCharts = dynamic(() => import('./APCharts'), { ssr: false });
const VendorDetailPanel = dynamic(() => import('./VendorDetailPanel'), { ssr: false });
const BillDetailPanel = dynamic(() => import('./BillDetailPanel'), { ssr: false });

type APTab = 'overview' | 'vendors' | 'bills' | 'payment-planning';

export default function APContent() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [activeTab, setActiveTab] = useState<APTab>('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<APStatus | 'All'>('All');
  const [sortField, setSortField] = useState<keyof Bill>('daysOverdue');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedVendor, setSelectedVendor] = useState<Vendor | null>(null);
  const [selectedBill, setSelectedBill] = useState<Bill | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const pageSize = 8;

  const tabs: { id: APTab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'vendors', label: 'Vendors', count: vendors.length },
    { id: 'bills', label: 'Bills', count: bills.length },
    { id: 'payment-planning', label: 'Payment Planning' },
  ];

  const filteredBills = bills
    .filter((b) => {
      const matchSearch = searchQuery === '' ||
        b.number.toLowerCase().includes(searchQuery.toLowerCase()) ||
        b.vendorName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchStatus = statusFilter === 'All' || b.status === statusFilter;
      return matchSearch && matchStatus;
    })
    .sort((a, b) => {
      const av = a[sortField] as any;
      const bv = b[sortField] as any;
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

  const totalPages = Math.ceil(filteredBills.length / pageSize);
  const pagedBills = filteredBills.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const handleSort = (field: keyof Bill) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const toggleRow = (id: string) => {
    const next = new Set(selectedRows);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedRows(next);
  };

  const kpis = [
    { id: 'kpi-ap-total', label: 'TOTAL ACCOUNTS PAYABLE', value: 'Rp 860M', subLabel: 'Jan–Aug 2026', change: '+3.1% vs prev period', changePositive: false, sparkline: [720, 690, 655, 725, 678, 802, 725, 860], color: 'var(--primary)' },
    { id: 'kpi-ap-current', label: 'CURRENT PAYABLES', value: 'Rp 540M', subLabel: '62.8% of total AP', change: '+1.4% vs prev period', changePositive: false, sparkline: [510, 498, 485, 520, 505, 525, 518, 540], color: 'var(--info)' },
    { id: 'kpi-ap-overdue', label: 'OVERDUE PAYABLES', value: 'Rp 96M', subLabel: '11.2% of total AP', change: '+24.7% vs prev period', changePositive: false, alert: true, sparkline: [42, 48, 55, 62, 68, 74, 82, 96], color: 'var(--danger)' },
    { id: 'kpi-ap-week', label: 'DUE THIS WEEK', value: 'Rp 142M', subLabel: '3 bills pending', change: '', changeNeutral: true, sparkline: [68, 82, 95, 78, 112, 125, 135, 142], color: 'var(--warning)' },
    { id: 'kpi-ap-month', label: 'DUE THIS MONTH', value: 'Rp 320M', subLabel: '7 bills total', change: '+8.2% vs prev period', changePositive: false, sparkline: [242, 258, 275, 265, 288, 295, 308, 320], color: 'var(--warning)' },
    { id: 'kpi-ap-days', label: 'AVG PAYMENT DAYS', value: '36 days', subLabel: 'Days Payable Outstanding', change: '+2 days vs prev period', changePositive: false, sparkline: [31, 33, 34, 32, 35, 36, 35, 36], color: 'var(--info)' },
    { id: 'kpi-ap-forecast', label: 'PAYMENT FORECAST', value: 'Rp 480M', subLabel: 'Next 30 days', change: '', changeNeutral: true, sparkline: [380, 395, 412, 398, 425, 448, 462, 480], color: 'var(--primary)' },
    { id: 'kpi-ap-vendor', label: 'VENDOR CONCENTRATION', value: '62%', subLabel: 'Top 10 vendors', change: '-1.8% vs prev period', changePositive: true, sparkline: [68, 66, 65, 64, 63, 63, 62, 62], color: 'var(--muted-foreground)' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-700 text-foreground">Accounts Payable</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor vendor obligations, upcoming payments, liabilities, and cash requirements.</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-xs font-600 text-primary">Jan 2026 – Aug 2026</span>
            <span className="text-xs bg-secondary text-muted-foreground px-2 py-0.5 rounded-full font-500">YTD</span>
            <span className="text-xs text-muted-foreground">Last updated: 28 Aug 2026, 16:11 WIB</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => router.push('/ai-financial-analyst?analysis=ap-risk')}
            className="flex items-center gap-1.5 text-sm font-500 text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-3 py-1.5 transition-colors border border-purple-200"
          >
            <Icon name="SparklesIcon" size={14} />
            AI Analysis
          </button>
          <button onClick={() => toast.success('Exporting AP report...')} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
            <Icon name="ArrowDownTrayIcon" size={14} />
            Export
          </button>
          <button className="p-1.5 rounded-md hover:bg-secondary text-muted-foreground transition-colors" onClick={() => toast.info('Refreshing AP data...')}>
            <Icon name="ArrowPathIcon" size={16} />
          </button>
        </div>
      </div>

      {/* KPI Grid */}
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
            key={`ap-tab-${tab.id}`}
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

      {activeTab === 'overview' && <APCharts />}

      {activeTab === 'vendors' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="text-md font-600 text-foreground">Vendor AP Balances</h3>
            <div className="flex items-center gap-1.5 bg-secondary rounded-md px-3 py-1.5 w-52">
              <Icon name="MagnifyingGlassIcon" size={13} className="text-muted-foreground" />
              <input
                type="text"
                placeholder="Search vendors..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-full"
              />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-secondary/50 border-b border-border">
                  {['Vendor', 'Total AP', 'Current', 'Overdue', 'Due Soon', 'Payment Terms', 'Avg Days', 'Risk', 'Next Payment', 'Status'].map((h) => (
                    <th key={`vend-th-${h}`} className="px-4 py-2.5 text-left text-2xs font-600 text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {vendors
                  .filter((v) => searchQuery === '' || v.name.toLowerCase().includes(searchQuery.toLowerCase()))
                  .map((v) => (
                    <tr
                      key={v.id}
                      className="border-b border-border hover:bg-secondary/40 cursor-pointer transition-colors"
                      onClick={() => setSelectedVendor(v)}
                    >
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-500 text-foreground">{v.name}</p>
                          <p className="text-2xs text-muted-foreground">{v.code} · {v.category}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-600 text-foreground">{fx(formatRupiah(v.totalAP, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{fx(formatRupiah(v.currentAP, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-danger">{v.overdueAP > 0 ? fx(formatRupiah(v.overdueAP, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums text-warning">{v.dueSoon > 0 ? fx(formatRupiah(v.dueSoon, true)) : '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{v.paymentTerms}</td>
                      <td className="px-4 py-3 tabular-nums">{v.avgPaymentDays}d</td>
                      <td className="px-4 py-3">
                        <StatusBadge label={v.riskLevel} className={riskColors[v.riskLevel]} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{v.nextPayment}</td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={v.status}
                          className={
                            v.status === 'Overdue' ? 'bg-danger-bg text-danger-foreground' :
                            v.status === 'Due Soon' ? 'bg-warning-bg text-warning-foreground' :
                            'bg-secondary text-muted-foreground'
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" onClick={(e) => { e.stopPropagation(); }}>
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

      {activeTab === 'bills' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 bg-secondary rounded-md px-3 py-1.5 w-56">
                <Icon name="MagnifyingGlassIcon" size={13} className="text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search bills..."
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
                {(['Open', 'Due Soon', 'Overdue', 'Scheduled', 'Pending Approval', 'Paid', 'Disputed', 'On Hold'] as APStatus[]).map((s) => (
                  <option key={`ap-status-opt-${s}`} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              {selectedRows.size > 0 && (
                <div className="flex items-center gap-2 bg-primary/10 rounded-md px-3 py-1.5">
                  <span className="text-sm font-600 text-primary">{selectedRows.size} selected</span>
                  <button className="text-sm text-primary hover:text-primary/80" onClick={() => toast.success(`${selectedRows.size} bills scheduled for payment`)}>Schedule</button>
                  <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => { setSelectedRows(new Set()); }}>Clear</button>
                </div>
              )}
              <button onClick={() => toast.success('Exporting bills...')} className="flex items-center gap-1.5 text-sm border border-border rounded-md px-2.5 py-1.5 text-foreground hover:bg-secondary transition-colors">
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
                      if (e.target.checked) setSelectedRows(new Set(pagedBills.map(b => b.id)));
                      else setSelectedRows(new Set());
                    }} />
                  </th>
                  {([
                    { key: 'number', label: 'Bill #' },
                    { key: 'vendorName', label: 'Vendor' },
                    { key: 'billDate', label: 'Bill Date' },
                    { key: 'dueDate', label: 'Due Date' },
                    { key: 'amount', label: 'Amount' },
                    { key: 'paid', label: 'Paid' },
                    { key: 'outstanding', label: 'Outstanding' },
                    { key: 'daysOverdue', label: 'Days Overdue' },
                    { key: 'status', label: 'Status' },
                    { key: 'priority', label: 'Priority' },
                    { key: 'approvalStatus', label: 'Approval' },
                  ] as { key: keyof Bill; label: string }[]).map((col) => (
                    <th
                      key={`bill-th-${col.key}`}
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
                {pagedBills.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40" />
                        <p className="text-sm font-500 text-muted-foreground">No bills match your current filters</p>
                        <button onClick={() => { setSearchQuery(''); setStatusFilter('All'); }} className="text-xs text-primary hover:underline">Clear filters</button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedBills.map((bill) => (
                    <tr
                      key={bill.id}
                      className={`border-b border-border hover:bg-secondary/40 cursor-pointer transition-colors ${selectedRows.has(bill.id) ? 'bg-primary/5' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <input type="checkbox" className="rounded" checked={selectedRows.has(bill.id)} onChange={() => toggleRow(bill.id)} onClick={(e) => e.stopPropagation()} />
                      </td>
                      <td className="px-4 py-3 font-500 text-primary hover:underline cursor-pointer" onClick={() => setSelectedBill(bill)}>{bill.number}</td>
                      <td className="px-4 py-3">
                        <p className="font-500 text-foreground">{bill.vendorName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{bill.billDate}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{bill.dueDate}</td>
                      <td className="px-4 py-3 tabular-nums font-500">{fx(formatRupiah(bill.amount, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{bill.paid > 0 ? fx(formatRupiah(bill.paid, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums font-600 text-foreground">{bill.outstanding > 0 ? fx(formatRupiah(bill.outstanding, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {bill.daysOverdue > 0 ? (
                          <span className={`font-600 ${bill.daysOverdue > 60 ? 'text-danger' : bill.daysOverdue > 30 ? 'text-warning' : 'text-orange-600'}`}>
                            {bill.daysOverdue}d
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge label={bill.status} className={apStatusColors[bill.status]} />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={bill.priority}
                          className={
                            bill.priority === 'Critical' ? 'bg-danger-bg text-danger-foreground' :
                            bill.priority === 'High' ? 'bg-orange-50 text-orange-700' :
                            bill.priority === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                            'bg-secondary text-muted-foreground'
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          label={bill.approvalStatus}
                          className={bill.approvalStatus === 'Approved' ? 'bg-success-bg text-success-foreground' : 'bg-warning-bg text-warning-foreground'}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="View bill" onClick={() => setSelectedBill(bill)}>
                            <Icon name="EyeIcon" size={14} />
                          </button>
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Schedule payment" onClick={() => toast.success(`Payment scheduled for ${bill.number}`)}>
                            <Icon name="CalendarIcon" size={14} />
                          </button>
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Mark paid" onClick={() => toast.success(`${bill.number} marked as paid`)}>
                            <Icon name="CheckCircleIcon" size={14} />
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
              Showing {Math.min((currentPage - 1) * pageSize + 1, filteredBills.length)}–{Math.min(currentPage * pageSize, filteredBills.length)} of {filteredBills.length} bills
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setCurrentPage(Math.max(1, currentPage - 1))} disabled={currentPage === 1} className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 transition-colors">
                <Icon name="ChevronLeftIcon" size={14} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={`ap-page-${p}`} onClick={() => setCurrentPage(p)} className={`w-7 h-7 text-xs rounded font-500 transition-colors ${currentPage === p ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'}`}>{p}</button>
              ))}
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 transition-colors">
                <Icon name="ChevronRightIcon" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payment-planning' && <APPaymentPlanning />}

      {selectedVendor && <VendorDetailPanel vendor={selectedVendor} onClose={() => setSelectedVendor(null)} />}
      {selectedBill && <BillDetailPanel bill={selectedBill} onClose={() => setSelectedBill(null)} />}
    </div>
  );
}

function APPaymentPlanning() {
  const { fx } = useCurrency();
  const overdue = bills.filter((b) => b.status === 'Overdue' && b.outstanding > 0);
  const dueSoon = bills.filter((b) => b.status === 'Due Soon' && b.outstanding > 0);
  const upcoming = bills.filter((b) => b.status === 'Open' && b.outstanding > 0);

  const totalCashRequired = [...overdue, ...dueSoon].reduce((sum, b) => sum + b.outstanding, 0);

  const BillCard = ({ bill }: { bill: Bill }) => (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-600 text-foreground">{bill.vendorName}</p>
          <p className="text-xs text-muted-foreground">{bill.number}</p>
        </div>
        <StatusBadge label={bill.status} className={apStatusColors[bill.status]} />
      </div>
      <p className="text-xl font-700 tabular-nums text-foreground">{fx(formatRupiah(bill.outstanding, true))}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">Due: {bill.dueDate}</span>
        <div className="flex gap-1">
          <button className="text-xs text-primary hover:underline font-500" onClick={() => toast.success(`Payment scheduled for ${bill.number}`)}>Schedule</button>
          <button className="text-xs text-muted-foreground hover:text-foreground font-500 ml-2" onClick={() => toast.success(`${bill.number} marked as paid`)}>Mark Paid</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Cash Requirement Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {paymentForecastData.map((pf) => (
          <div key={`pf-${pf.period}`} className="bg-card border border-border rounded-lg p-4 shadow-card">
            <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{pf.period}</p>
            <p className="text-2xl font-700 tabular-nums text-foreground">{fx(formatRupiah(pf.amount, true))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pf.bills} bill{pf.bills !== 1 ? 's' : ''} due</p>
          </div>
        ))}
      </div>

      {/* Alert Banner */}
      <div className="flex items-center gap-3 bg-danger-bg border border-red-200 rounded-lg p-4">
        <Icon name="ExclamationTriangleIcon" size={18} className="text-danger flex-shrink-0" />
        <div>
          <p className="text-sm font-600 text-danger">Immediate Cash Requirement: {fx(formatRupiah(totalCashRequired, true))}</p>
          <p className="text-xs text-danger/80 mt-0.5">Overdue and due-soon bills require immediate payment action to avoid vendor relationship risk.</p>
        </div>
        <button
          onClick={() => toast.success('Payment batch initiated')}
          className="ml-auto text-sm font-500 text-white bg-danger hover:bg-danger/90 rounded-md px-3 py-1.5 transition-colors flex-shrink-0"
        >
          Pay All Overdue
        </button>
      </div>

      {/* Payment Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-danger-bg border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ExclamationTriangleIcon" size={16} className="text-danger" />
            <span className="text-sm font-600 text-danger">Overdue — Pay Immediately</span>
          </div>
          <div className="space-y-3">
            {overdue.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No overdue bills</p>
            ) : (
              overdue.map((b) => <BillCard key={b.id} bill={b} />)
            )}
          </div>
        </div>
        <div className="bg-warning-bg border border-yellow-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ClockIcon" size={16} className="text-warning" />
            <span className="text-sm font-600 text-warning">Due Soon — Schedule Now</span>
          </div>
          <div className="space-y-3">
            {dueSoon.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No bills due soon</p>
            ) : (
              dueSoon.map((b) => <BillCard key={b.id} bill={b} />)
            )}
          </div>
        </div>
        <div className="bg-secondary rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="CalendarIcon" size={16} className="text-muted-foreground" />
            <span className="text-sm font-600 text-foreground">Upcoming — Plan Ahead</span>
          </div>
          <div className="space-y-3">
            {upcoming.slice(0, 4).map((b) => <BillCard key={b.id} bill={b} />)}
          </div>
        </div>
      </div>
    </div>
  );
}