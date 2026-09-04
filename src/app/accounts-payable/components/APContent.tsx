'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import KpiCard from '@/components/shared/KpiCard';
import StatusBadge from '@/components/ui/StatusBadge';
import dynamic from 'next/dynamic';
import { formatRupiah, riskColors, apStatusColors, type Vendor, type Bill, type APStatus } from '@/lib/mockData';
import { useCurrency } from '@/lib/currency';
// [BARU] Data vendors/bills/KPI di halaman ini TIDAK LAGI dari mock statis —
// semuanya diturunkan langsung dari transaksi kelompok Expense di halaman
// Transaksi lewat TransactionsContext + apBridge.ts. Kalau ada transaksi
// Expense baru/diedit/status pembayarannya berubah, halaman ini otomatis
// ikut berubah (re-render) karena sama-sama membaca context yang sama.
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import {
  AP_REFERENCE_DATE,
  billsFromTransactions,
  vendorsFromBills,
  apKpisFromBills,
  apAgingFromBills,
  apTrendFromBills,
  sparklineFromTrend,
  paymentForecastFromBills,
  markExpenseTxPaid,
  rescheduleExpenseTx,
} from '@/app/transactions/lib/apBridge';

const APCharts = dynamic(() => import('./APCharts'), { ssr: false });
const VendorDetailPanel = dynamic(() => import('./VendorDetailPanel'), { ssr: false });
const BillDetailPanel = dynamic(() => import('./BillDetailPanel'), { ssr: false });
// [BARU] Panel "AI Error Detection" -- menjalankan 7 pengecekan rule-based
// Agent AI (deteksiKesalahanPembelian) atas dokumen pembelian client aktif.
// Lihat lib/apErrorDetection.ts untuk detail jembatannya ke backend.
const APErrorDetection = dynamic(() => import('./APErrorDetection'), { ssr: false });

type APTab = 'overview' | 'vendors' | 'bills' | 'payment-planning' | 'error-detection';

export default function APContent() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { transactions, saveEdit } = useTransactions();

  // [BARU] Aksi "Mark Paid" / "Schedule payment" di halaman AP menulis balik
  // ke transaksi Expense sumbernya (bill.id === transaction.id), bukan cuma
  // toast kosong — supaya perubahan di AP benar-benar sinkron dua arah
  // dengan Expense, bukan cuma satu arah (Expense -> AP saja).
  const markBillPaid = (bill: Bill) => {
    const tx = transactions.find((t) => t.id === bill.id);
    if (!tx) { toast.error(`Transaksi untuk ${bill.number} tidak ditemukan`); return; }
    saveEdit(markExpenseTxPaid(tx));
    toast.success(`${bill.number} ditandai Lunas`, { description: `Status pembayaran ikut berubah di halaman Expense.` });
  };

  const scheduleBillPayment = (bill: Bill, newDueDate: string) => {
    const tx = transactions.find((t) => t.id === bill.id);
    if (!tx) { toast.error(`Transaksi untuk ${bill.number} tidak ditemukan`); return; }
    saveEdit(rescheduleExpenseTx(tx, newDueDate));
    toast.success(`Jatuh tempo ${bill.number} dijadwalkan ulang`, { description: `Tanggal baru: ${newDueDate}` });
  };

  // ─── Turunan dari transaksi Expense (sumber tunggal) ───────────────────
  const bills = useMemo(() => billsFromTransactions(transactions), [transactions]);
  const vendors = useMemo(() => vendorsFromBills(bills), [bills]);
  const kpiValues = useMemo(() => apKpisFromBills(bills, vendors), [bills, vendors]);
  const agingData = useMemo(() => apAgingFromBills(bills), [bills]);
  const trendData = useMemo(() => apTrendFromBills(bills), [bills]);
  const forecastData = useMemo(() => paymentForecastFromBills(bills), [bills]);
  const trendSparkline = useMemo(() => sparklineFromTrend(trendData), [trendData]);

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
    { id: 'error-detection', label: 'AI Error Detection' },
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

  // [DIUBAH] Sebelumnya 8 angka ini hardcoded string. Sekarang dihitung
  // langsung dari `bills` (hasil turunan transaksi Expense) lewat
  // apKpisFromBills() — kalau status pembayaran/tanggal jatuh tempo transaksi
  // Expense berubah, angka-angka ini otomatis ikut berubah.
  const overduePct = kpiValues.totalAP > 0 ? Math.round((kpiValues.overdueAP / kpiValues.totalAP) * 1000) / 10 : 0;
  const currentPct = kpiValues.totalAP > 0 ? Math.round((kpiValues.currentAP / kpiValues.totalAP) * 1000) / 10 : 0;

  const kpis: { id: string; label: string; value: string; subLabel: string; change: string; changeNeutral: boolean; changePositive?: boolean; alert?: boolean; sparkline: number[]; color: string }[] = [
    { id: 'kpi-ap-total', label: 'TOTAL ACCOUNTS PAYABLE', value: formatRupiah(kpiValues.totalAP, true), subLabel: `Dari ${bills.length} transaksi Expense`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--primary)' },
    { id: 'kpi-ap-current', label: 'CURRENT PAYABLES', value: formatRupiah(kpiValues.currentAP, true), subLabel: `${currentPct}% dari total AP`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--info)' },
    { id: 'kpi-ap-overdue', label: 'OVERDUE PAYABLES', value: formatRupiah(kpiValues.overdueAP, true), subLabel: `${overduePct}% dari total AP`, change: '', changeNeutral: true, alert: kpiValues.overdueAP > 0, sparkline: trendSparkline, color: 'var(--danger)' },
    { id: 'kpi-ap-week', label: 'DUE THIS WEEK', value: formatRupiah(kpiValues.dueThisWeek, true), subLabel: `${kpiValues.dueThisWeekCount} tagihan`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--warning)' },
    { id: 'kpi-ap-month', label: 'DUE THIS MONTH', value: formatRupiah(kpiValues.dueThisMonth, true), subLabel: `${kpiValues.dueThisMonthCount} tagihan`, change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--warning)' },
    { id: 'kpi-ap-days', label: 'AVG PAYMENT DAYS', value: `${kpiValues.avgPaymentDays} hari`, subLabel: 'Days Payable Outstanding', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--info)' },
    { id: 'kpi-ap-forecast', label: 'PAYMENT FORECAST', value: formatRupiah(kpiValues.paymentForecast30d, true), subLabel: 'Next 30 days', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--primary)' },
    { id: 'kpi-ap-vendor', label: 'VENDOR CONCENTRATION', value: `${kpiValues.vendorConcentrationPct}%`, subLabel: 'Top 10 vendors', change: '', changeNeutral: true, sparkline: trendSparkline, color: 'var(--muted-foreground)' },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-tight">Accounts Payable</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monitor vendor obligations, upcoming payments, liabilities, and cash requirements.</p>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="badge-info">Tersinkron dari Transaksi → Expense</span>
            <span className="badge-neutral">{bills.length} tagihan · {vendors.length} vendor</span>
            <span className="text-xs text-muted-foreground">Per {AP_REFERENCE_DATE}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => router.push('/ai-financial-analyst?analysis=ap-risk')}
            className="flex items-center gap-1.5 text-sm font-medium text-ai-purple bg-ai-purple-bg hover:bg-purple-100 rounded-md px-3 py-1.5 transition-colors border border-purple-200"
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

      {activeTab === 'overview' && (
        <APCharts
          agingData={agingData}
          trendData={trendData}
          forecastData={forecastData}
          vendors={vendors}
          totalAP={kpiValues.totalAP}
          overdueAP={kpiValues.overdueAP}
        />
      )}

      {activeTab === 'vendors' && (
        <div className="bg-card border border-border rounded-lg shadow-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="text-md font-semibold text-foreground">Vendor AP Balances</h3>
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
                    <th key={`vend-th-${h}`} className="px-4 py-2.5 text-left text-2xs font-semibold text-muted-foreground uppercase tracking-wider whitespace-nowrap">{h}</th>
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
                          <p className="font-medium text-foreground">{v.name}</p>
                          <p className="text-2xs text-muted-foreground">{v.code} · {v.category}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-foreground">{fx(formatRupiah(v.totalAP, true))}</td>
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
                  <span className="text-sm font-semibold text-primary">{selectedRows.size} selected</span>
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
                {pagedBills.length === 0 ? (
                  <tr>
                    <td colSpan={13} className="px-4 py-12 text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Icon name="DocumentTextIcon" size={32} className="text-muted-foreground/40" />
                        <p className="text-sm font-medium text-muted-foreground">No bills match your current filters</p>
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
                      <td className="px-4 py-3 font-medium text-primary hover:underline cursor-pointer" onClick={() => setSelectedBill(bill)}>{bill.number}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-foreground">{bill.vendorName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{bill.billDate}</td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{bill.dueDate}</td>
                      <td className="px-4 py-3 tabular-nums font-medium">{fx(formatRupiah(bill.amount, true))}</td>
                      <td className="px-4 py-3 tabular-nums text-success">{bill.paid > 0 ? fx(formatRupiah(bill.paid, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums font-semibold text-foreground">{bill.outstanding > 0 ? fx(formatRupiah(bill.outstanding, true)) : '—'}</td>
                      <td className="px-4 py-3 tabular-nums">
                        {bill.daysOverdue > 0 ? (
                          <span className={`font-semibold ${bill.daysOverdue > 60 ? 'text-danger' : bill.daysOverdue > 30 ? 'text-warning' : 'text-orange-600'}`}>
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
                          {/* Ikon kalender tidak punya input tanggal sendiri di baris tabel —
                              buka panel detail (yang punya form "Schedule Payment" lengkap
                              dengan date picker) daripada menjadwalkan ulang diam-diam. */}
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Schedule payment" onClick={() => setSelectedBill(bill)}>
                            <Icon name="CalendarIcon" size={14} />
                          </button>
                          <button className="p-1 rounded hover:bg-secondary text-muted-foreground transition-colors" title="Mark paid" onClick={() => markBillPaid(bill)}>
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
                <button key={`ap-page-${p}`} onClick={() => setCurrentPage(p)} className={`w-7 h-7 text-xs rounded font-medium transition-colors ${currentPage === p ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-secondary'}`}>{p}</button>
              ))}
              <button onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages} className="p-1.5 rounded hover:bg-secondary text-muted-foreground disabled:opacity-40 transition-colors">
                <Icon name="ChevronRightIcon" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'payment-planning' && <APPaymentPlanning bills={bills} forecastData={forecastData} onMarkPaid={markBillPaid} />}

      {activeTab === 'error-detection' && <APErrorDetection />}

      {selectedVendor && <VendorDetailPanel vendor={selectedVendor} bills={bills} onClose={() => setSelectedVendor(null)} />}
      {selectedBill && (
        <BillDetailPanel
          bill={selectedBill}
          onClose={() => setSelectedBill(null)}
          onMarkPaid={() => { markBillPaid(selectedBill); setSelectedBill(null); }}
          onSchedule={(newDueDate) => { scheduleBillPayment(selectedBill, newDueDate); setSelectedBill(null); }}
        />
      )}
    </div>
  );
}

function APPaymentPlanning({ bills, forecastData, onMarkPaid }: { bills: Bill[]; forecastData: ReturnType<typeof paymentForecastFromBills>; onMarkPaid: (bill: Bill) => void }) {
  const { fx } = useCurrency();
  const overdue = bills.filter((b) => b.status === 'Overdue' && b.outstanding > 0);
  const dueSoon = bills.filter((b) => b.status === 'Due Soon' && b.outstanding > 0);
  const upcoming = bills.filter((b) => (b.status === 'Open' || b.status === 'Pending Approval') && b.outstanding > 0);

  const totalCashRequired = [...overdue, ...dueSoon].reduce((sum, b) => sum + b.outstanding, 0);

  const BillCard = ({ bill }: { bill: Bill }) => (
    <div className="bg-card border border-border rounded-lg p-4 hover:shadow-card-md transition-all">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{bill.vendorName}</p>
          <p className="text-xs text-muted-foreground">{bill.number}</p>
        </div>
        <StatusBadge label={bill.status} className={apStatusColors[bill.status]} />
      </div>
      <p className="text-xl font-bold tabular-nums text-foreground">{fx(formatRupiah(bill.outstanding, true))}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-muted-foreground">Due: {bill.dueDate}</span>
        <div className="flex gap-1">
          <button className="text-xs text-primary hover:underline font-medium" onClick={() => toast.success(`Payment scheduled for ${bill.number}`)}>Schedule</button>
          <button className="text-xs text-muted-foreground hover:text-foreground font-medium ml-2" onClick={() => onMarkPaid(bill)}>Mark Paid</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Cash Requirement Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {forecastData.map((pf) => (
          <div key={`pf-${pf.period}`} className="bg-card border border-border rounded-lg p-4 shadow-card">
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{pf.period}</p>
            <p className="text-2xl font-bold tabular-nums text-foreground">{fx(formatRupiah(pf.amount, true))}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{pf.bills} bill{pf.bills !== 1 ? 's' : ''} due</p>
          </div>
        ))}
      </div>

      {/* Alert Banner */}
      <div className="flex items-center gap-3 bg-danger-bg border border-red-200 rounded-lg p-4">
        <Icon name="ExclamationTriangleIcon" size={18} className="text-danger flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold text-danger">Immediate Cash Requirement: {fx(formatRupiah(totalCashRequired, true))}</p>
          <p className="text-xs text-danger/80 mt-0.5">Overdue and due-soon bills require immediate payment action to avoid vendor relationship risk.</p>
        </div>
        <button
          onClick={() => toast.success('Payment batch initiated')}
          className="ml-auto text-sm font-medium text-white bg-danger hover:bg-danger/90 rounded-md px-3 py-1.5 transition-colors flex-shrink-0"
        >
          Pay All Overdue
        </button>
      </div>

      {/* Payment Columns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-danger-bg border border-red-200 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="ExclamationTriangleIcon" size={16} className="text-danger" />
            <span className="text-sm font-semibold text-danger">Overdue — Pay Immediately</span>
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
            <span className="text-sm font-semibold text-warning">Due Soon — Schedule Now</span>
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
            <span className="text-sm font-semibold text-foreground">Upcoming — Plan Ahead</span>
          </div>
          <div className="space-y-3">
            {upcoming.slice(0, 4).map((b) => <BillCard key={b.id} bill={b} />)}
          </div>
        </div>
      </div>
    </div>
  );
}