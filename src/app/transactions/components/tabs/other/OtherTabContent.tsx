'use client';
// [DIUBAH] Semula src/app/transactions/components/tabs/other/page.tsx — sama
// seperti Cash & Bank: otomatis jadi route Next.js sendiri dan membungkus
// diri dengan <AppLayout> kedua + import TransactionPageHeader/KpiCard/
// ExportMenu/@/lib/exportUtils yang tidak ada di project ini. Sekarang jadi
// komponen konten tab biasa yang dipasang dari TransactionsContent.tsx.
import React, { useState, useMemo } from 'react';
import KpiCard from '../shared/TabKpiCard';
import StatusBadge from '../shared/TabStatusBadge';
import TabExportMenu from '../shared/TabExportMenu';
import { exportToCSV, exportToPDF, exportGLSnapshot } from '../shared/exportUtils';
import { toast } from 'sonner';
import { Layers, TrendingDown, FileWarning, Calendar, Search, ChevronDown, ChevronUp, Eye, X, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell,  } from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────
type OtherTxType =
  | 'Depreciation' |'Accrual' |'Prepayment' |'Tax Adjustment' |'Asset Adjustment' |'Reclassification' |'Opening Balance' |'FX Adjustment' |'Intercompany' |'Closing Adjustment';

interface OtherTransaction {
  id: string;
  date: string;
  txType: OtherTxType;
  description: string;
  reference: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  source: string;
  accountingPeriod: string;
  status: 'posted' | 'draft' | 'pending' | 'approved' | 'rejected';
  createdBy: string;
  approvedBy: string;
  postingStatus: 'posted' | 'draft' | 'pending';
  notes?: string;
}

// ─── Sample Data ──────────────────────────────────────────────────────────────
const otherData: OtherTransaction[] = [
  { id: 'OTH-2026-0088', date: '09/13/2026', txType: 'Depreciation', description: 'Monthly depreciation — IT Equipment (Sep 2026)', reference: 'DEP-SEP-2026-01', accountCode: '6700', accountName: 'Depreciation Expense', debit: 8400, credit: 8400, source: 'Fixed Asset Register', accountingPeriod: 'Sep 2026', status: 'posted', createdBy: 'System', approvedBy: 'L. Chen', postingStatus: 'posted', notes: 'Straight-line depreciation on IT equipment pool. Useful life 5 years.' },
  { id: 'OTH-2026-0087', date: '09/13/2026', txType: 'Depreciation', description: 'Monthly depreciation — Office Furniture (Sep 2026)', reference: 'DEP-SEP-2026-02', accountCode: '6700', accountName: 'Depreciation Expense', debit: 1250, credit: 1250, source: 'Fixed Asset Register', accountingPeriod: 'Sep 2026', status: 'posted', createdBy: 'System', approvedBy: 'L. Chen', postingStatus: 'posted' },
  { id: 'OTH-2026-0086', date: '09/12/2026', txType: 'Accrual', description: 'Accrued salaries — Sep 2026 (unpaid portion)', reference: 'ACR-SEP-2026-01', accountCode: '6100', accountName: 'Salaries Expense', debit: 42000, credit: 42000, source: 'Payroll Estimate', accountingPeriod: 'Sep 2026', status: 'approved', createdBy: 'M. Patel', approvedBy: 'R. Holloway', postingStatus: 'posted', notes: 'Accrual for last 2 weeks of Sep 2026 salaries not yet paid.' },
  { id: 'OTH-2026-0085', date: '09/12/2026', txType: 'Accrual', description: 'Accrued interest expense — Sep 2026', reference: 'ACR-SEP-2026-02', accountCode: '6800', accountName: 'Interest Expense', debit: 3200, credit: 3200, source: 'Loan Schedule', accountingPeriod: 'Sep 2026', status: 'approved', createdBy: 'L. Chen', approvedBy: 'R. Holloway', postingStatus: 'posted' },
  { id: 'OTH-2026-0084', date: '09/10/2026', txType: 'Prepayment', description: 'Prepaid insurance — Q4 2026 amortization', reference: 'PRE-SEP-2026-01', accountCode: '1300', accountName: 'Prepaid Insurance', debit: 4800, credit: 4800, source: 'Insurance Policy INS-2026', accountingPeriod: 'Sep 2026', status: 'posted', createdBy: 'M. Patel', approvedBy: 'L. Chen', postingStatus: 'posted', notes: 'Monthly amortization of annual insurance premium paid Jan 2026.' },
  { id: 'OTH-2026-0083', date: '09/10/2026', txType: 'Prepayment', description: 'Prepaid software subscriptions — Sep 2026', reference: 'PRE-SEP-2026-02', accountCode: '1310', accountName: 'Prepaid Software', debit: 2100, credit: 2100, source: 'Subscription Schedule', accountingPeriod: 'Sep 2026', status: 'posted', createdBy: 'M. Patel', approvedBy: 'L. Chen', postingStatus: 'posted' },
  { id: 'OTH-2026-0082', date: '09/08/2026', txType: 'Tax Adjustment', description: 'GST/VAT input tax correction — Aug 2026', reference: 'TAX-ADJ-2026-08', accountCode: '2300', accountName: 'Tax Payable', debit: 1840, credit: 1840, source: 'Tax Review AUG-2026', accountingPeriod: 'Sep 2026', status: 'approved', createdBy: 'L. Chen', approvedBy: 'R. Holloway', postingStatus: 'posted', notes: 'Correction of input tax credit misclassification in Aug 2026.' },
  { id: 'OTH-2026-0081', date: '09/07/2026', txType: 'Reclassification', description: 'Reclassify marketing expense to R&D', reference: 'RCL-SEP-2026-01', accountCode: '6200', accountName: 'Marketing Expense', debit: 5500, credit: 5500, source: 'Budget Review Q3-2026', accountingPeriod: 'Sep 2026', status: 'approved', createdBy: 'R. Holloway', approvedBy: 'L. Chen', postingStatus: 'posted', notes: 'Product marketing costs reclassified per management decision.' },
  { id: 'OTH-2026-0080', date: '09/05/2026', txType: 'FX Adjustment', description: 'Foreign exchange revaluation — USD receivables', reference: 'FX-SEP-2026-01', accountCode: '4800', accountName: 'FX Gain/Loss', debit: 2280, credit: 2280, source: 'FX Rate Sep 13 2026', accountingPeriod: 'Sep 2026', status: 'posted', createdBy: 'System', approvedBy: 'L. Chen', postingStatus: 'posted', notes: 'USD/local currency revaluation at period-end rate.' },
  { id: 'OTH-2026-0079', date: '09/04/2026', txType: 'Asset Adjustment', description: 'Write-down — obsolete inventory items', reference: 'AST-ADJ-2026-09', accountCode: '1500', accountName: 'Inventory', debit: 6800, credit: 6800, source: 'Inventory Review SEP-2026', accountingPeriod: 'Sep 2026', status: 'approved', createdBy: 'M. Patel', approvedBy: 'R. Holloway', postingStatus: 'posted', notes: 'Write-down of slow-moving inventory per NRV assessment.' },
  { id: 'OTH-2026-0078', date: '09/03/2026', txType: 'Intercompany', description: 'Intercompany charge — shared services Q3', reference: 'IC-SEP-2026-01', accountCode: '1800', accountName: 'Intercompany Receivable', debit: 18500, credit: 18500, source: 'IC Agreement 2026', accountingPeriod: 'Sep 2026', status: 'pending', createdBy: 'L. Chen', approvedBy: '—', postingStatus: 'pending', notes: 'Quarterly intercompany recharge for shared IT and HR services.' },
  { id: 'OTH-2026-0077', date: '09/02/2026', txType: 'Closing Adjustment', description: 'Period-end closing adjustment — accrued revenue', reference: 'CLO-AUG-2026-01', accountCode: '1150', accountName: 'Accrued Revenue', debit: 9200, credit: 9200, source: 'Month-end Close AUG-2026', accountingPeriod: 'Aug 2026', status: 'posted', createdBy: 'R. Holloway', approvedBy: 'L. Chen', postingStatus: 'posted' },
  { id: 'OTH-2026-0076', date: '09/01/2026', txType: 'Accrual', description: 'Accrued utilities — Aug 2026 (estimated)', reference: 'ACR-AUG-2026-03', accountCode: '6400', accountName: 'Utilities Expense', debit: 3840, credit: 3840, source: 'Utility Estimate AUG-2026', accountingPeriod: 'Aug 2026', status: 'posted', createdBy: 'M. Patel', approvedBy: 'L. Chen', postingStatus: 'posted' },
  { id: 'OTH-2026-0075', date: '08/31/2026', txType: 'Depreciation', description: 'Monthly depreciation — Vehicles (Aug 2026)', reference: 'DEP-AUG-2026-03', accountCode: '6700', accountName: 'Depreciation Expense', debit: 2800, credit: 2800, source: 'Fixed Asset Register', accountingPeriod: 'Aug 2026', status: 'posted', createdBy: 'System', approvedBy: 'L. Chen', postingStatus: 'posted' },
  { id: 'OTH-2026-0074', date: '08/30/2026', txType: 'Tax Adjustment', description: 'Corporate tax provision — Q3 2026', reference: 'TAX-PRV-2026-Q3', accountCode: '2310', accountName: 'Income Tax Payable', debit: 28400, credit: 28400, source: 'Tax Provision Q3-2026', accountingPeriod: 'Aug 2026', status: 'approved', createdBy: 'L. Chen', approvedBy: 'R. Holloway', postingStatus: 'posted', notes: 'Estimated corporate income tax provision for Q3 2026.' },
];

// ─── Chart Data ───────────────────────────────────────────────────────────────
const typeDistribution = [
  { name: 'Depreciation', value: 3, color: '#6366f1' },
  { name: 'Accrual', value: 4, color: '#f59e0b' },
  { name: 'Prepayment', value: 2, color: '#10b981' },
  { name: 'Tax Adjustment', value: 2, color: '#ef4444' },
  { name: 'Reclassification', value: 1, color: '#3b82f6' },
  { name: 'Other', value: 3, color: '#94a3b8' },
];

const monthlyOtherActivity = [
  { month: 'Apr', amount: 88000 },
  { month: 'May', amount: 94000 },
  { month: 'Jun', amount: 102000 },
  { month: 'Jul', amount: 87000 },
  { month: 'Aug', amount: 118000 },
  { month: 'Sep', amount: 112110 },
];

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n === 0 ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtK = (n: number) => `$${(n / 1000).toFixed(0)}k`;

type SortField = keyof OtherTransaction;
type SortDir = 'asc' | 'desc';

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function OtherDetailPanel({ tx, onClose }: { tx: OtherTransaction; onClose: () => void }) {
  const isBalanced = tx.debit === tx.credit;
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Other Transaction Detail</p>
          <h3 className="text-base font-700 text-foreground mt-0.5">{tx.id}</h3>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Type Badge */}
        <div className="flex items-center gap-3">
          <span className="text-xs font-700 px-3 py-1.5 rounded-full bg-primary/10 text-primary">{tx.txType}</span>
          <StatusBadge status={tx.status as 'posted' | 'draft' | 'pending' | 'approved' | 'rejected'} />
        </div>

        {/* Description */}
        <div className="rounded-xl bg-muted/40 border border-border p-4">
          <p className="text-xs font-600 text-muted-foreground mb-1">Description</p>
          <p className="text-sm text-foreground">{tx.description}</p>
          {tx.notes && <p className="text-xs text-muted-foreground mt-2 italic">{tx.notes}</p>}
        </div>

        {/* Details */}
        <div className="space-y-3">
          <h4 className="text-xs font-700 uppercase tracking-wider text-muted-foreground">Transaction Information</h4>
          {[
            ['Transaction ID', tx.id],
            ['Date', tx.date],
            ['Reference', tx.reference],
            ['Transaction Type', tx.txType],
            ['Account', `${tx.accountCode} — ${tx.accountName}`],
            ['Source', tx.source],
            ['Accounting Period', tx.accountingPeriod],
            ['Created By', tx.createdBy],
            ['Approved By', tx.approvedBy],
            ['Posting Status', tx.postingStatus.charAt(0).toUpperCase() + tx.postingStatus.slice(1)],
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
              <span className="text-xs text-muted-foreground shrink-0 w-36">{k}</span>
              <span className="text-xs font-500 text-foreground text-right">{v}</span>
            </div>
          ))}
        </div>

        {/* Accounting Entry */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-700 uppercase tracking-wider text-muted-foreground">Accounting Entry</h4>
            <span className={`text-[11px] font-700 px-2 py-0.5 rounded-full ${isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
              {isBalanced ? '✓ Balanced' : '✗ Unbalanced'}
            </span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-1.5 text-muted-foreground font-600">Account</th>
                <th className="text-right py-1.5 text-muted-foreground font-600">Debit</th>
                <th className="text-right py-1.5 text-muted-foreground font-600">Credit</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/50">
                <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.accountName}</td>
                <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(tx.debit)}</td>
                <td className="py-1.5 text-right text-muted-foreground">—</td>
              </tr>
              <tr className="border-b border-border/50">
                <td className="py-1.5 text-foreground">Contra Account</td>
                <td className="py-1.5 text-right text-muted-foreground">—</td>
                <td className="py-1.5 text-right font-600 text-red-700">{fmt(tx.credit)}</td>
              </tr>
              <tr className="bg-muted/20">
                <td className="py-1.5 font-700 text-foreground">Total</td>
                <td className="py-1.5 text-right font-700 text-foreground">{fmt(tx.debit)}</td>
                <td className="py-1.5 text-right font-700 text-foreground">{fmt(tx.credit)}</td>
              </tr>
            </tbody>
          </table>
          <div className={`flex items-center gap-2 text-xs p-2 rounded-lg ${isBalanced ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
            {isBalanced ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
            {isBalanced ? 'Entry is balanced. Debit equals Credit.' : 'Entry is unbalanced. Review required.'}
          </div>
        </div>
      </div>
    </div>
  );
}

const otherCSVRows = otherData.map((r) => ({
  'Transaction ID': r.id,
  Date: r.date,
  Type: r.txType,
  Description: r.description,
  Reference: r.reference,
  'Account Code': r.accountCode,
  'Account Name': r.accountName,
  Debit: `$${r.debit.toFixed(2)}`,
  Credit: `$${r.credit.toFixed(2)}`,
  Balanced: r.debit === r.credit ? 'Yes' : 'No',
  Source: r.source,
  'Accounting Period': r.accountingPeriod,
  Status: r.status,
  'Created By': r.createdBy,
  'Approved By': r.approvedBy,
  'Posting Status': r.postingStatus,
}));

const otherGLEntries = [
  { accountCode: '1300', accountName: 'Prepaid Insurance', openingBalance: 57600, totalDebits: 0, totalCredits: 4800, closingBalance: 52800, period: 'Sep 2026' },
  { accountCode: '1310', accountName: 'Prepaid Software', openingBalance: 12600, totalDebits: 0, totalCredits: 2100, closingBalance: 10500, period: 'Sep 2026' },
  { accountCode: '1500', accountName: 'Inventory', openingBalance: 84200, totalDebits: 0, totalCredits: 6800, closingBalance: 77400, period: 'Sep 2026' },
  { accountCode: '1800', accountName: 'Intercompany Receivable', openingBalance: 0, totalDebits: 18500, totalCredits: 0, closingBalance: 18500, period: 'Sep 2026' },
  { accountCode: '2300', accountName: 'Tax Payable', openingBalance: 14200, totalDebits: 1840, totalCredits: 28400, closingBalance: 40760, period: 'Sep 2026' },
  { accountCode: '4800', accountName: 'FX Gain/Loss', openingBalance: 0, totalDebits: 0, totalCredits: 2280, closingBalance: 2280, period: 'Sep 2026' },
  { accountCode: '6100', accountName: 'Salaries Expense', openingBalance: 0, totalDebits: 42000, totalCredits: 0, closingBalance: 42000, period: 'Sep 2026' },
  { accountCode: '6200', accountName: 'Marketing Expense', openingBalance: 0, totalDebits: 5500, totalCredits: 5500, closingBalance: 0, period: 'Sep 2026' },
  { accountCode: '6400', accountName: 'Utilities Expense', openingBalance: 0, totalDebits: 3840, totalCredits: 0, closingBalance: 3840, period: 'Sep 2026' },
  { accountCode: '6700', accountName: 'Depreciation Expense', openingBalance: 0, totalDebits: 12450, totalCredits: 0, closingBalance: 12450, period: 'Sep 2026' },
  { accountCode: '6800', accountName: 'Interest Expense', openingBalance: 0, totalDebits: 3200, totalCredits: 0, closingBalance: 3200, period: 'Sep 2026' },
];

// ─── Type Color Map ───────────────────────────────────────────────────────────
const typeColorMap: Record<OtherTxType, string> = {
  Depreciation: 'bg-indigo-50 text-indigo-700',
  Accrual: 'bg-amber-50 text-amber-700',
  Prepayment: 'bg-emerald-50 text-emerald-700',
  'Tax Adjustment': 'bg-red-50 text-red-700',
  'Asset Adjustment': 'bg-orange-50 text-orange-700',
  Reclassification: 'bg-blue-50 text-blue-700',
  'Opening Balance': 'bg-teal-50 text-teal-700',
  'FX Adjustment': 'bg-purple-50 text-purple-700',
  Intercompany: 'bg-cyan-50 text-cyan-700',
  'Closing Adjustment': 'bg-slate-100 text-slate-700',
};

// ─── Main Content ─────────────────────────────────────────────────────────────
export default function OtherTabContent() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [periodFilter, setPeriodFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let data = [...otherData];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q) ||
          r.accountName.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== 'all') data = data.filter((r) => r.txType === typeFilter);
    if (statusFilter !== 'all') data = data.filter((r) => r.status === statusFilter);
    if (periodFilter !== 'all') data = data.filter((r) => r.accountingPeriod === periodFilter);
    data.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [search, typeFilter, statusFilter, periodFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedTx = otherData.find((t) => t.id === selectedId) ?? null;

  const handleExportCSV = () => {
    exportToCSV(otherCSVRows, 'Other_Transactions_Sep2026');
    toast.success('CSV exported successfully');
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Other Transactions Report',
      'Transaction period: September 2026 — Adjustments, accruals, depreciation and other entries',
      ['Txn ID', 'Date', 'Type', 'Description', 'Account', 'Debit', 'Credit', 'Balanced', 'Period', 'Status', 'Posting'],
      otherData.map((r) => [r.id, r.date, r.txType, r.description, `${r.accountCode} — ${r.accountName}`, `$${r.debit.toFixed(2)}`, `$${r.credit.toFixed(2)}`, r.debit === r.credit ? 'Yes' : 'No', r.accountingPeriod, r.status, r.postingStatus]),
      'Other_Transactions_Sep2026'
    );
    toast.success('PDF report opened for printing');
  };

  const handleExportGLSnapshot = () => {
    exportGLSnapshot(otherGLEntries, 'Sep 2026', 'Other Transactions');
    toast.success('GL Snapshot opened for printing');
  };

  const totalDebit = otherData.reduce((s, r) => s + r.debit, 0);
  const pendingCount = otherData.filter((r) => r.status === 'pending').length;
  const postedCount = otherData.filter((r) => r.postingStatus === 'posted').length;
  const allBalanced = otherData.every((r) => r.debit === r.credit);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className="ml-1 inline-flex flex-col opacity-40">
      {sortField === field ? (
        sortDir === 'asc' ? <ChevronUp size={12} className="opacity-100" /> : <ChevronDown size={12} className="opacity-100" />
      ) : (
        <ChevronDown size={12} />
      )}
    </span>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <TabExportMenu
          onExportCSV={handleExportCSV}
          onExportPDF={handleExportPDF}
          onExportGLSnapshot={handleExportGLSnapshot}
        />
        <button className="px-3 py-1.5 text-sm font-600 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity duration-150 active:scale-95 flex items-center gap-1.5">
          <Layers size={14} /> New Adjustment
        </button>
      </div>
      <div className="space-y-5">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <KpiCard label="Total Adjustments (Sep)" value="$112,110" subValue="15 transactions this period" trend={-5.0} trendLabel="vs Aug 2026" icon={<Layers size={18} />} variant="info" />
          <KpiCard label="Depreciation (Sep)" value="$12,450" subValue="3 asset groups" trend={0} trendLabel="Consistent with prior" icon={<TrendingDown size={18} />} variant="default" />
          <KpiCard label="Accruals (Sep)" value="$49,040" subValue="4 accrual entries" trend={8.2} trendLabel="vs Aug 2026" icon={<Calendar size={18} />} variant="warning" />
          <KpiCard label="Pending Approval" value={String(pendingCount)} subValue={`${pendingCount} transactions awaiting`} icon={<FileWarning size={18} />} variant="negative" />
          <KpiCard label="Posted Transactions" value={String(postedCount)} subValue={`${postedCount} of ${otherData.length} posted`} trend={allBalanced ? 0 : undefined} icon={<CheckCircle2 size={18} />} variant="positive" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Monthly Activity */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-700 text-foreground">Monthly Other Transaction Activity</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Total adjustment amounts by month (Apr–Sep 2026)</p>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={monthlyOtherActivity} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }} />
                <Bar dataKey="amount" fill="var(--primary)" radius={[4, 4, 0, 0]} name="Total Amount" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Type Distribution */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-700 text-foreground">Transaction Type Distribution</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Count by transaction type</p>
            </div>
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie data={typeDistribution} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={3} dataKey="value">
                  {typeDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => [`${v} entries`, '']} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="mt-2 space-y-1.5">
              {typeDistribution.map((item) => (
                <div key={item.name} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-muted-foreground">{item.name}</span>
                  </div>
                  <span className="font-600 text-foreground">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transaction Table */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {/* Toolbar */}
          <div className="px-5 py-4 border-b border-border flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search transactions…"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                className="w-full pl-8 pr-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
              />
            </div>
            <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }} className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground">
              <option value="all">All Types</option>
              {(['Depreciation','Accrual','Prepayment','Tax Adjustment','Asset Adjustment','Reclassification','Opening Balance','FX Adjustment','Intercompany','Closing Adjustment'] as OtherTxType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground">
              <option value="all">All Statuses</option>
              <option value="posted">Posted</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
              <option value="rejected">Rejected</option>
            </select>
            <select value={periodFilter} onChange={(e) => { setPeriodFilter(e.target.value); setPage(1); }} className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground">
              <option value="all">All Periods</option>
              <option value="Sep 2026">Sep 2026</option>
              <option value="Aug 2026">Aug 2026</option>
            </select>
            <div className="ml-auto text-xs text-muted-foreground">{filtered.length} transactions</div>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  {[
                    { label: 'Txn ID', field: 'id' as SortField },
                    { label: 'Date', field: 'date' as SortField },
                    { label: 'Type', field: 'txType' as SortField },
                    { label: 'Description', field: 'description' as SortField },
                    { label: 'Reference', field: 'reference' as SortField },
                    { label: 'Account', field: 'accountName' as SortField },
                    { label: 'Debit', field: 'debit' as SortField },
                    { label: 'Credit', field: 'credit' as SortField },
                    { label: 'Period', field: 'accountingPeriod' as SortField },
                    { label: 'Status', field: 'status' as SortField },
                    { label: 'Posting', field: 'postingStatus' as SortField },
                  ].map(({ label, field }) => (
                    <th key={field} onClick={() => handleSort(field)} className="text-left px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none whitespace-nowrap">
                      {label}<SortIcon field={field} />
                    </th>
                  ))}
                  <th className="px-4 py-3 text-[11px] font-700 uppercase tracking-wider text-muted-foreground text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((tx) => {
                  const isBalanced = tx.debit === tx.credit;
                  return (
                    <tr key={tx.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${selectedId === tx.id ? 'bg-primary/5' : ''}`} onClick={() => setSelectedId(selectedId === tx.id ? null : tx.id)}>
                      <td className="px-4 py-3 font-600 text-primary text-xs whitespace-nowrap">{tx.id}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{tx.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`text-[11px] font-600 px-2 py-0.5 rounded-full ${typeColorMap[tx.txType]}`}>{tx.txType}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{tx.description}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{tx.reference}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <div className="font-500 text-foreground">{tx.accountName}</div>
                        <div className="text-muted-foreground">{tx.accountCode}</div>
                      </td>
                      <td className="px-4 py-3 text-xs font-600 text-emerald-600 whitespace-nowrap text-right">{fmt(tx.debit)}</td>
                      <td className="px-4 py-3 text-xs font-600 text-red-600 whitespace-nowrap text-right">{fmt(tx.credit)}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{tx.accountingPeriod}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <StatusBadge status={tx.status as 'posted' | 'draft' | 'pending' | 'approved' | 'rejected'} size="sm" />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <StatusBadge status={tx.postingStatus as 'posted' | 'draft' | 'pending'} size="sm" />
                          {!isBalanced && <AlertTriangle size={12} className="text-red-500" />}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button onClick={(e) => { e.stopPropagation(); setSelectedId(tx.id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/10">
            <div className="text-xs text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
              &nbsp;·&nbsp;
              <span className="font-600 text-foreground">Total Debit/Credit: {fmt(totalDebit)}</span>
              &nbsp;·&nbsp;
              <span className={`font-600 ${allBalanced ? 'text-emerald-600' : 'text-red-600'}`}>{allBalanced ? '✓ All Balanced' : '✗ Check Entries'}</span>
            </div>
            <div className="flex items-center gap-1">
              <button disabled={page === 1} onClick={() => setPage(page - 1)} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 text-muted-foreground hover:text-foreground transition-colors">
                <ChevronLeft size={15} />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button key={p} onClick={() => setPage(p)} className={`w-7 h-7 text-xs rounded-lg font-medium transition-colors ${p === page ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground hover:text-foreground'}`}>{p}</button>
              ))}
              <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 text-muted-foreground hover:text-foreground transition-colors">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Detail Panel */}
      {selectedTx && <OtherDetailPanel tx={selectedTx} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
