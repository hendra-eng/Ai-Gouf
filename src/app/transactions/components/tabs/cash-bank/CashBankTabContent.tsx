'use client';
// [DIUBAH] Semula src/app/transactions/components/tabs/cash-bank/page.tsx —
// otomatis jadi route Next.js sendiri (karena berada di src/app) dan
// membungkus diri dengan <AppLayout> kedua (AppLayout sudah dipasang sekali
// untuk seluruh app di src/app/layout.tsx) + import TransactionPageHeader/
// KpiCard/ExportMenu/@/lib/exportUtils yang tidak ada di project ini.
// Sekarang jadi komponen konten tab biasa yang dipasang dari
// TransactionsContent.tsx, pakai TabKpiCard/TabStatusBadge/TabExportMenu +
// exportUtils lokal di ../shared/.
import React, { useState, useMemo } from 'react';
import KpiCard from '../shared/TabKpiCard';
import StatusBadge from '../shared/TabStatusBadge';
import TabExportMenu from '../shared/TabExportMenu';
import { exportToCSV, exportToPDF, exportGLSnapshot } from '../shared/exportUtils';
import { toast } from 'sonner';
import { Landmark, Banknote, ArrowDownLeft, ArrowUpRight, RefreshCw, Search, ChevronDown, ChevronUp, Eye, X, ChevronLeft, ChevronRight, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,  } from 'recharts';

// ─── Types ─────────────────────────────────────────────────────
type TxType = 'Receipt' | 'Payment' | 'Transfer' | 'Deposit' | 'Withdrawal' | 'Bank Charge' | 'Interest' | 'Adjustment';
type ReconStatus = 'reconciled' | 'unreconciled' | 'review' | 'pending';
type AccountType = 'Bank' | 'Cash';

interface CashBankTransaction {
  id: string;
  date: string;
  account: string;
  accountCode: string;
  accountType: AccountType;
  reference: string;
  description: string;
  counterparty: string;
  txType: TxType;
  inflow: number;
  outflow: number;
  runningBalance: number;
  reconStatus: ReconStatus;
  source: string;
  accountingPeriod: string;
  createdBy: string;
  postingStatus: 'posted' | 'draft' | 'pending';
  bankRef?: string;
}

// ─── Sample Data ──────────────────────────────────────────────────────────────
const cashBankData: CashBankTransaction[] = [
  { id: 'CB-2026-0148', date: '09/13/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'RCP-0921', description: 'Customer payment — INV-2026-0921', counterparty: 'Meridian Tech Solutions', txType: 'Receipt', inflow: 39349, outflow: 0, runningBalance: 412580, reconStatus: 'reconciled', source: 'INV-2026-0921', accountingPeriod: 'Sep 2026', createdBy: 'R. Holloway', postingStatus: 'posted', bankRef: 'BNK-TXN-88421' },
  { id: 'CB-2026-0147', date: '09/12/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'PMT-0884', description: 'Vendor payment — Sigma Components Ltd.', counterparty: 'Sigma Components Ltd.', txType: 'Payment', inflow: 0, outflow: 28750, runningBalance: 373231, reconStatus: 'reconciled', source: 'PO-2026-0312', accountingPeriod: 'Sep 2026', createdBy: 'L. Chen', postingStatus: 'posted', bankRef: 'BNK-TXN-88390' },
  { id: 'CB-2026-0146', date: '09/11/2026', account: 'Petty Cash', accountCode: '1020', accountType: 'Cash', reference: 'PCH-0091', description: 'Office supplies — petty cash disbursement', counterparty: 'Internal', txType: 'Withdrawal', inflow: 0, outflow: 340, runningBalance: 1660, reconStatus: 'reconciled', source: 'EXP-0091', accountingPeriod: 'Sep 2026', createdBy: 'M. Patel', postingStatus: 'posted' },
  { id: 'CB-2026-0145', date: '09/11/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'TRF-0044', description: 'Transfer to Payroll Account', counterparty: 'Payroll Account', txType: 'Transfer', inflow: 0, outflow: 85000, runningBalance: 401981, reconStatus: 'reconciled', source: 'PAY-SEP-2026', accountingPeriod: 'Sep 2026', createdBy: 'R. Holloway', postingStatus: 'posted', bankRef: 'BNK-TXN-88301' },
  { id: 'CB-2026-0144', date: '09/10/2026', account: 'Payroll Account', accountCode: '1015', accountType: 'Bank', reference: 'TRF-0044', description: 'Transfer from Main Operating Account', counterparty: 'Main Operating Account', txType: 'Transfer', inflow: 85000, outflow: 0, runningBalance: 85000, reconStatus: 'reconciled', source: 'PAY-SEP-2026', accountingPeriod: 'Sep 2026', createdBy: 'R. Holloway', postingStatus: 'posted', bankRef: 'BNK-TXN-88302' },
  { id: 'CB-2026-0143', date: '09/10/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'RCP-0920', description: 'Customer payment — INV-2026-0918', counterparty: 'Cascade Logistics Ltd.', txType: 'Receipt', inflow: 12348, outflow: 0, runningBalance: 486981, reconStatus: 'reconciled', source: 'INV-2026-0918', accountingPeriod: 'Sep 2026', createdBy: 'L. Chen', postingStatus: 'posted', bankRef: 'BNK-TXN-88288' },
  { id: 'CB-2026-0142', date: '09/09/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'BCH-0018', description: 'Monthly bank service fee', counterparty: 'First National Bank', txType: 'Bank Charge', inflow: 0, outflow: 125, runningBalance: 474633, reconStatus: 'reconciled', source: 'BANK-STMT-SEP', accountingPeriod: 'Sep 2026', createdBy: 'System', postingStatus: 'posted', bankRef: 'BNK-TXN-88201' },
  { id: 'CB-2026-0141', date: '09/08/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'INT-0009', description: 'Interest earned — Sep 2026', counterparty: 'First National Bank', txType: 'Interest', inflow: 820, outflow: 0, runningBalance: 474758, reconStatus: 'reconciled', source: 'BANK-STMT-SEP', accountingPeriod: 'Sep 2026', createdBy: 'System', postingStatus: 'posted', bankRef: 'BNK-TXN-88199' },
  { id: 'CB-2026-0140', date: '09/07/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'PMT-0881', description: 'Vendor payment — Vertex Supplies Inc.', counterparty: 'Vertex Supplies Inc.', txType: 'Payment', inflow: 0, outflow: 14200, runningBalance: 473938, reconStatus: 'unreconciled', source: 'PO-2026-0308', accountingPeriod: 'Sep 2026', createdBy: 'M. Patel', postingStatus: 'posted', bankRef: 'BNK-TXN-88140' },
  { id: 'CB-2026-0139', date: '09/06/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'RCP-0919', description: 'Partial payment — INV-2026-0919', counterparty: 'Horizon Retail Group', txType: 'Receipt', inflow: 9470, outflow: 0, runningBalance: 488138, reconStatus: 'reconciled', source: 'INV-2026-0919', accountingPeriod: 'Sep 2026', createdBy: 'R. Holloway', postingStatus: 'posted', bankRef: 'BNK-TXN-88088' },
  { id: 'CB-2026-0138', date: '09/05/2026', account: 'Petty Cash', accountCode: '1020', accountType: 'Cash', reference: 'PCH-0090', description: 'Petty cash replenishment', counterparty: 'Internal', txType: 'Deposit', inflow: 2000, outflow: 0, runningBalance: 2000, reconStatus: 'reconciled', source: 'PCH-REP-SEP', accountingPeriod: 'Sep 2026', createdBy: 'M. Patel', postingStatus: 'posted' },
  { id: 'CB-2026-0137', date: '09/04/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'PMT-0879', description: 'Rent payment — Sep 2026', counterparty: 'Westfield Properties', txType: 'Payment', inflow: 0, outflow: 22000, runningBalance: 478668, reconStatus: 'reconciled', source: 'LEASE-2026', accountingPeriod: 'Sep 2026', createdBy: 'L. Chen', postingStatus: 'posted', bankRef: 'BNK-TXN-88001' },
  { id: 'CB-2026-0136', date: '09/03/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'RCP-0918', description: 'Customer payment — INV-2026-0916', counterparty: 'Summit Capital Group', txType: 'Receipt', inflow: 21464, outflow: 0, runningBalance: 500668, reconStatus: 'review', source: 'INV-2026-0916', accountingPeriod: 'Sep 2026', createdBy: 'R. Holloway', postingStatus: 'posted', bankRef: 'BNK-TXN-87940' },
  { id: 'CB-2026-0135', date: '09/02/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'ADJ-0011', description: 'Bank reconciliation adjustment', counterparty: 'First National Bank', txType: 'Adjustment', inflow: 0, outflow: 45, runningBalance: 479204, reconStatus: 'reconciled', source: 'RECON-AUG-2026', accountingPeriod: 'Sep 2026', createdBy: 'L. Chen', postingStatus: 'posted', bankRef: 'BNK-TXN-87901' },
  { id: 'CB-2026-0134', date: '09/01/2026', account: 'Main Operating Account', accountCode: '1010', accountType: 'Bank', reference: 'PMT-0877', description: 'Utility payment — electricity & internet', counterparty: 'City Utilities Corp.', txType: 'Payment', inflow: 0, outflow: 3840, runningBalance: 479249, reconStatus: 'unreconciled', source: 'UTIL-SEP-2026', accountingPeriod: 'Sep 2026', createdBy: 'M. Patel', postingStatus: 'pending' },
];

// ─── Chart Data ───────────────────────────────────────────────────────────────
const cashFlowTrend = [
  { month: 'Apr', inflow: 142000, outflow: 118000 },
  { month: 'May', inflow: 158000, outflow: 131000 },
  { month: 'Jun', inflow: 171000, outflow: 144000 },
  { month: 'Jul', inflow: 163000, outflow: 152000 },
  { month: 'Aug', inflow: 189000, outflow: 161000 },
  { month: 'Sep', inflow: 168451, outflow: 154300 },
];

const accountBalances = [
  { account: 'Main Operating', balance: 412580 },
  { account: 'Payroll Acct', balance: 85000 },
  { account: 'Petty Cash', balance: 1660 },
  { account: 'Reserve Fund', balance: 95000 },
];

// ─── Formatters ───────────────────────────────────────────────────────────────
const fmt = (n: number) =>
  n === 0 ? '—' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtK = (n: number) => {
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}k`;
  return `$${n}`;
};

type SortField = keyof CashBankTransaction;
type SortDir = 'asc' | 'desc';

// ─── Detail Panel ─────────────────────────────────────────────────────────────
function CashBankDetailPanel({ tx, onClose }: { tx: CashBankTransaction; onClose: () => void }) {
  const netAmount = tx.inflow - tx.outflow;
  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md bg-card border-l border-border shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
        <div>
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Transaction Detail</p>
          <h3 className="text-base font-700 text-foreground mt-0.5">{tx.id}</h3>
        </div>
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-5 space-y-5">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className={`rounded-xl p-4 ${tx.inflow > 0 ? 'bg-emerald-50 border border-emerald-100' : 'bg-slate-50 border border-border'}`}>
            <p className="text-[10px] font-600 uppercase tracking-wider text-muted-foreground mb-1">Inflow</p>
            <p className={`text-xl font-700 ${tx.inflow > 0 ? 'text-emerald-700' : 'text-muted-foreground'}`}>{fmt(tx.inflow)}</p>
          </div>
          <div className={`rounded-xl p-4 ${tx.outflow > 0 ? 'bg-red-50 border border-red-100' : 'bg-slate-50 border border-border'}`}>
            <p className="text-[10px] font-600 uppercase tracking-wider text-muted-foreground mb-1">Outflow</p>
            <p className={`text-xl font-700 ${tx.outflow > 0 ? 'text-red-700' : 'text-muted-foreground'}`}>{fmt(tx.outflow)}</p>
          </div>
        </div>
        <div className="rounded-xl bg-muted/40 border border-border p-4 flex items-center justify-between">
          <span className="text-sm font-600 text-foreground">Net Movement</span>
          <span className={`text-lg font-700 ${netAmount >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {netAmount >= 0 ? '+' : ''}{fmt(netAmount)}
          </span>
        </div>
        {/* Details */}
        <div className="space-y-3">
          <h4 className="text-xs font-700 uppercase tracking-wider text-muted-foreground">Transaction Information</h4>
          {[
            ['Transaction ID', tx.id],
            ['Date', tx.date],
            ['Reference', tx.reference],
            ['Type', tx.txType],
            ['Account', `${tx.accountCode} — ${tx.account}`],
            ['Account Type', tx.accountType],
            ['Counterparty', tx.counterparty],
            ['Source', tx.source],
            ['Accounting Period', tx.accountingPeriod],
            ['Created By', tx.createdBy],
            ['Posting Status', tx.postingStatus.charAt(0).toUpperCase() + tx.postingStatus.slice(1)],
            ...(tx.bankRef ? [['Bank Reference', tx.bankRef]] : []),
          ].map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-3 py-1.5 border-b border-border/50 last:border-0">
              <span className="text-xs text-muted-foreground shrink-0 w-36">{k}</span>
              <span className="text-xs font-500 text-foreground text-right">{v}</span>
            </div>
          ))}
        </div>
        {/* Reconciliation */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h4 className="text-xs font-700 uppercase tracking-wider text-muted-foreground">Reconciliation Status</h4>
          <div className="flex items-center gap-3">
            <StatusBadge status={tx.reconStatus} />
            <span className="text-xs text-muted-foreground">
              {tx.reconStatus === 'reconciled' && 'Matched with bank statement'}
              {tx.reconStatus === 'unreconciled' && 'Pending bank statement match'}
              {tx.reconStatus === 'review' && 'Flagged for manual review'}
              {tx.reconStatus === 'pending' && 'Awaiting bank confirmation'}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">Running Balance after this transaction: <span className="font-600 text-foreground">{fmt(tx.runningBalance)}</span></div>
        </div>
        {/* Accounting Impact */}
        <div className="rounded-xl border border-border p-4 space-y-3">
          <h4 className="text-xs font-700 uppercase tracking-wider text-muted-foreground">Accounting Impact</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 text-muted-foreground font-600">Account</th>
                  <th className="text-right py-1.5 text-muted-foreground font-600">Dr</th>
                  <th className="text-right py-1.5 text-muted-foreground font-600">Cr</th>
                </tr>
              </thead>
              <tbody>
                {tx.txType === 'Receipt' && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.account}</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(tx.inflow)}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">1100 — Accounts Receivable</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(tx.inflow)}</td>
                    </tr>
                  </>
                )}
                {tx.txType === 'Payment' && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">2100 — Accounts Payable</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(tx.outflow)}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.account}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(tx.outflow)}</td>
                    </tr>
                  </>
                )}
                {tx.txType === 'Transfer' && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">{tx.inflow > 0 ? tx.accountCode + ' — ' + tx.account : 'Destination Account'}</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(Math.max(tx.inflow, tx.outflow))}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">{tx.outflow > 0 ? tx.accountCode + ' — ' + tx.account : 'Source Account'}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(Math.max(tx.inflow, tx.outflow))}</td>
                    </tr>
                  </>
                )}
                {(tx.txType === 'Bank Charge' || tx.txType === 'Withdrawal') && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">6500 — Bank Charges / Expense</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(tx.outflow)}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.account}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(tx.outflow)}</td>
                    </tr>
                  </>
                )}
                {tx.txType === 'Interest' && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.account}</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(tx.inflow)}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">4900 — Interest Income</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(tx.inflow)}</td>
                    </tr>
                  </>
                )}
                {(tx.txType === 'Deposit' || tx.txType === 'Adjustment') && (
                  <>
                    <tr className="border-b border-border/50">
                      <td className="py-1.5 text-foreground">{tx.accountCode} — {tx.account}</td>
                      <td className="py-1.5 text-right font-600 text-emerald-700">{fmt(Math.max(tx.inflow, tx.outflow))}</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 text-foreground">Various Accounts</td>
                      <td className="py-1.5 text-right text-muted-foreground">—</td>
                      <td className="py-1.5 text-right font-600 text-red-700">{fmt(Math.max(tx.inflow, tx.outflow))}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const cashBankCSVRows = cashBankData.map((r) => ({
  'Transaction ID': r.id,
  Date: r.date,
  Account: r.account,
  'Account Code': r.accountCode,
  'Account Type': r.accountType,
  Reference: r.reference,
  Description: r.description,
  Counterparty: r.counterparty,
  Type: r.txType,
  Inflow: r.inflow > 0 ? `$${r.inflow.toFixed(2)}` : '—',
  Outflow: r.outflow > 0 ? `$${r.outflow.toFixed(2)}` : '—',
  'Running Balance': `$${r.runningBalance.toFixed(2)}`,
  Reconciliation: r.reconStatus,
  'Posting Status': r.postingStatus,
  'Accounting Period': r.accountingPeriod,
  'Created By': r.createdBy,
  'Bank Reference': r.bankRef ?? '—',
}));

const cashBankGLEntries = [
  { accountCode: '1010', accountName: 'Main Operating Account', openingBalance: 379231, totalDebits: 168451, totalCredits: 135102, closingBalance: 412580, period: 'Sep 2026' },
  { accountCode: '1015', accountName: 'Payroll Account', openingBalance: 0, totalDebits: 85000, totalCredits: 0, closingBalance: 85000, period: 'Sep 2026' },
  { accountCode: '1020', accountName: 'Petty Cash', openingBalance: 0, totalDebits: 2000, totalCredits: 340, closingBalance: 1660, period: 'Sep 2026' },
  { accountCode: '1100', accountName: 'Accounts Receivable', openingBalance: 148200, totalDebits: 0, totalCredits: 83131, closingBalance: 65069, period: 'Sep 2026' },
  { accountCode: '2000', accountName: 'Accounts Payable', openingBalance: 68400, totalDebits: 65090, totalCredits: 0, closingBalance: 3310, period: 'Sep 2026' },
  { accountCode: '4900', accountName: 'Interest Income', openingBalance: 0, totalDebits: 0, totalCredits: 820, closingBalance: 820, period: 'Sep 2026' },
  { accountCode: '6500', accountName: 'Bank Charges / Expense', openingBalance: 0, totalDebits: 125, totalCredits: 0, closingBalance: 125, period: 'Sep 2026' },
];

// ─── Main Content ─────────────────────────────────────────────────────────────
export default function CashBankTabContent() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [reconFilter, setReconFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleExportCSV = () => {
    exportToCSV(cashBankCSVRows, 'CashBank_Transactions_Sep2026');
    toast.success('CSV exported successfully');
  };

  const handleExportPDF = () => {
    exportToPDF(
      'Cash & Bank Transactions Report',
      'Transaction period: September 2026 — All cash and bank movements',
      ['Txn ID', 'Date', 'Account', 'Description', 'Type', 'Inflow', 'Outflow', 'Balance', 'Reconciliation', 'Posting', 'Period'],
      cashBankData.map((r) => [r.id, r.date, r.account, r.description, r.txType, r.inflow > 0 ? `$${r.inflow.toFixed(2)}` : '—', r.outflow > 0 ? `$${r.outflow.toFixed(2)}` : '—', `$${r.runningBalance.toFixed(2)}`, r.reconStatus, r.postingStatus, r.accountingPeriod]),
      'CashBank_Transactions_Sep2026'
    );
    toast.success('PDF report opened for printing');
  };

  const handleExportGLSnapshot = () => {
    exportGLSnapshot(cashBankGLEntries, 'Sep 2026', 'Cash & Bank');
    toast.success('GL Snapshot opened for printing');
  };

  const filtered = useMemo(() => {
    let data = [...cashBankData];
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(
        (r) =>
          r.id.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q) ||
          r.counterparty.toLowerCase().includes(q) ||
          r.reference.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== 'all') data = data.filter((r) => r.txType === typeFilter);
    if (reconFilter !== 'all') data = data.filter((r) => r.reconStatus === reconFilter);
    if (accountFilter !== 'all') data = data.filter((r) => r.account === accountFilter);
    data.sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [search, typeFilter, reconFilter, accountFilter, sortField, sortDir]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selectedTx = cashBankData.find((t) => t.id === selectedId) ?? null;

  const totalInflow = cashBankData.reduce((s, r) => s + r.inflow, 0);
  const totalOutflow = cashBankData.reduce((s, r) => s + r.outflow, 0);
  const unreconciledCount = cashBankData.filter((r) => r.reconStatus === 'unreconciled').length;
  const reviewCount = cashBankData.filter((r) => r.reconStatus === 'review').length;

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

  const txTypeColor: Record<TxType, string> = {
    Receipt: 'bg-emerald-50 text-emerald-700',
    Payment: 'bg-red-50 text-red-700',
    Transfer: 'bg-blue-50 text-blue-700',
    Deposit: 'bg-teal-50 text-teal-700',
    Withdrawal: 'bg-orange-50 text-orange-700',
    'Bank Charge': 'bg-slate-100 text-slate-600',
    Interest: 'bg-purple-50 text-purple-700',
    Adjustment: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end gap-2">
        <TabExportMenu
          onExportCSV={handleExportCSV}
          onExportPDF={handleExportPDF}
          onExportGLSnapshot={handleExportGLSnapshot}
        />
        <button className="px-3 py-1.5 text-sm font-600 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity duration-150 active:scale-95 flex items-center gap-1.5">
          <RefreshCw size={14} /> Reconcile
        </button>
      </div>
      <div className="space-y-5">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <KpiCard label="Main Bank Balance" value="$412,580" subValue="Main Operating Account" trend={3.2} trendLabel="vs Aug 2026" icon={<Landmark size={18} />} variant="positive" />
          <KpiCard label="Total Cash Balance" value="$1,660" subValue="Petty Cash on hand" trend={-14.8} trendLabel="vs prior period" icon={<Banknote size={18} />} variant="info" />
          <KpiCard label="Total Receipts (Sep)" value="$168,451" subValue="Inflows this period" trend={8.4} trendLabel="vs Aug 2026" icon={<ArrowDownLeft size={18} />} variant="positive" />
          <KpiCard label="Total Payments (Sep)" value="$154,300" subValue="Outflows this period" trend={-2.1} trendLabel="vs Aug 2026" icon={<ArrowUpRight size={18} />} variant="warning" />
          <KpiCard label="Unreconciled Items" value={String(unreconciledCount + reviewCount)} subValue={`${unreconciledCount} unmatched, ${reviewCount} in review`} icon={<AlertCircle size={18} />} variant="negative" />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Cash Flow Trend */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-700 text-foreground">Cash Flow Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Monthly inflows vs outflows (Apr–Sep 2026)</p>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-emerald-500 inline-block" />Inflow</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-red-400 inline-block" />Outflow</span>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={cashFlowTrend} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="inflowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="outflowGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={fmtK} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }} />
                <Area type="monotone" dataKey="inflow" stroke="#10b981" strokeWidth={2} fill="url(#inflowGrad)" name="Inflow" />
                <Area type="monotone" dataKey="outflow" stroke="#f87171" strokeWidth={2} fill="url(#outflowGrad)" name="Outflow" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Account Balances */}
          <div className="bg-card border border-border rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-700 text-foreground">Account Balances</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Current balance by account</p>
            </div>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={accountBalances} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tickFormatter={fmtK} tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="account" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)' }} />
                <Bar dataKey="balance" fill="var(--primary)" radius={[0, 4, 4, 0]} name="Balance" />
              </BarChart>
            </ResponsiveContainer>
            {/* Reconciliation Summary */}
            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <p className="text-[10px] font-700 uppercase tracking-wider text-muted-foreground mb-2">Reconciliation Summary</p>
              {[
                { label: 'Reconciled', count: cashBankData.filter(r => r.reconStatus === 'reconciled').length, color: 'text-emerald-600', icon: <CheckCircle2 size={13} className="text-emerald-500" /> },
                { label: 'Unreconciled', count: unreconciledCount, color: 'text-red-600', icon: <AlertCircle size={13} className="text-red-500" /> },
                { label: 'In Review', count: reviewCount, color: 'text-blue-600', icon: <Clock size={13} className="text-blue-500" /> },
              ].map(({ label, count, color, icon }) => (
                <div key={label} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
                  <span className={`text-xs font-700 ${color}`}>{count}</span>
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
              {(['Receipt','Payment','Transfer','Deposit','Withdrawal','Bank Charge','Interest','Adjustment'] as TxType[]).map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={reconFilter} onChange={(e) => { setReconFilter(e.target.value); setPage(1); }} className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground">
              <option value="all">All Reconciliation</option>
              <option value="reconciled">Reconciled</option>
              <option value="unreconciled">Unreconciled</option>
              <option value="review">In Review</option>
              <option value="pending">Pending</option>
            </select>
            <select value={accountFilter} onChange={(e) => { setAccountFilter(e.target.value); setPage(1); }} className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none text-foreground">
              <option value="all">All Accounts</option>
              <option value="Main Operating Account">Main Operating</option>
              <option value="Petty Cash">Petty Cash</option>
              <option value="Payroll Account">Payroll Account</option>
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
                    { label: 'Account', field: 'account' as SortField },
                    { label: 'Description', field: 'description' as SortField },
                    { label: 'Type', field: 'txType' as SortField },
                    { label: 'Inflow', field: 'inflow' as SortField },
                    { label: 'Outflow', field: 'outflow' as SortField },
                    { label: 'Balance', field: 'runningBalance' as SortField },
                    { label: 'Reconciliation', field: 'reconStatus' as SortField },
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
                {paginated.map((tx) => (
                  <tr key={tx.id} className={`border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer ${selectedId === tx.id ? 'bg-primary/5' : ''}`} onClick={() => setSelectedId(selectedId === tx.id ? null : tx.id)}>
                    <td className="px-4 py-3 font-600 text-primary text-xs whitespace-nowrap">{tx.id}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{tx.date}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <div className="font-500 text-foreground">{tx.account}</div>
                      <div className="text-muted-foreground">{tx.accountCode} · {tx.accountType}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-foreground max-w-[200px] truncate">{tx.description}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`text-[11px] font-600 px-2 py-0.5 rounded-full ${txTypeColor[tx.txType]}`}>{tx.txType}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-600 text-emerald-600 whitespace-nowrap text-right">{tx.inflow > 0 ? fmt(tx.inflow) : '—'}</td>
                    <td className="px-4 py-3 text-xs font-600 text-red-600 whitespace-nowrap text-right">{tx.outflow > 0 ? fmt(tx.outflow) : '—'}</td>
                    <td className="px-4 py-3 text-xs font-600 text-foreground whitespace-nowrap text-right">{fmt(tx.runningBalance)}</td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={tx.reconStatus} size="sm" /></td>
                    <td className="px-4 py-3 whitespace-nowrap"><StatusBadge status={tx.postingStatus as 'posted' | 'draft' | 'pending'} size="sm" /></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={(e) => { e.stopPropagation(); setSelectedId(tx.id); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-border flex items-center justify-between bg-muted/10">
            <div className="text-xs text-muted-foreground">
              Showing {Math.min((page - 1) * pageSize + 1, filtered.length)}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
              &nbsp;·&nbsp;
              <span className="text-emerald-600 font-600">Total Inflow: {fmt(totalInflow)}</span>
              &nbsp;·&nbsp;
              <span className="text-red-600 font-600">Total Outflow: {fmt(totalOutflow)}</span>
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
      {selectedTx && <CashBankDetailPanel tx={selectedTx} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
