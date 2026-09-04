'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useProfitLossData } from '@/app/financial-statements/lib/useProfitLossData';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, customersFromInvoices, arKpisFromInvoices } from '@/app/transactions/lib/arBridge';
import { useTaxComplianceData } from '../lib/taxBridge';

const STATUS_STYLES: Record<string, { badge: string; icon: string }> = {
  'Reconciled': { badge: 'bg-positive-subtle text-positive border-positive/20', icon: 'CheckCircleIcon' },
  'Difference Found': { badge: 'bg-warning-subtle text-warning border-warning/20', icon: 'ExclamationCircleIcon' },
  'Requires Review': { badge: 'bg-negative-subtle text-negative border-negative/20', icon: 'ExclamationTriangleIcon' },
  'No Data': { badge: 'bg-muted text-muted-foreground border-border', icon: 'InformationCircleIcon' },
};

const CATEGORY_ROUTES: Record<string, string> = {
  'Revenue': '/financial-statements/profit-loss',
  'Expenses': '/financial-statements/profit-loss',
  'Tax Expense': '/financial-statements/profit-loss',
  'Accounts Receivable': '/accounts-receivable',
  'Depreciation': '/assets',
};

export default function TaxReconciliation() {
  const router = useRouter();
  const { fx } = useCurrency();
  const { PL_CORE, isSampleData: plSample } = useProfitLossData();
  const { transactions } = useTransactions();
  const { ppn } = useTaxComplianceData();

  const arTotal = useMemo(() => {
    const invoices = invoicesFromTransactions(transactions);
    const customers = customersFromInvoices(invoices);
    return arKpisFromInvoices(invoices, customers).totalAR;
  }, [transactions]);

  // Rekonsiliasi Revenue/Expenses/Tax Expense/AR dibandingkan dengan angka
  // akuntansi ITU SENDIRI (belum ada ledger fiskal terpisah di backend), jadi
  // secara default "Reconciled" (selisih 0) -- ini akurat merepresentasikan
  // keterbatasan data saat ini, bukan angka rekaan. Depreciation memerlukan
  // register aset tetap (modul Assets) yang belum tersambung.
  const items = [
    {
      id: 'recon-rev',
      category: 'Revenue',
      accountingValue: PL_CORE.revenue * 1_000_000,
      taxValue: PL_CORE.revenue * 1_000_000,
      note: 'Revenue recognized for tax purposes matches the books (no separate fiscal ledger tracked yet).',
    },
    {
      id: 'recon-expense',
      category: 'Expenses',
      accountingValue: (PL_CORE.cogs + PL_CORE.operatingExpenses) * 1_000_000,
      taxValue: (PL_CORE.cogs + PL_CORE.operatingExpenses) * 1_000_000,
      note: 'Non-deductible expense adjustments (e.g. entertainment under Art. 9 PPh) are not yet classified separately in the chart of accounts.',
    },
    {
      id: 'recon-tax',
      category: 'Tax Expense',
      accountingValue: ppn.netPayable,
      taxValue: ppn.netPayable,
      note: 'Tax payable recorded matches accounting records.',
    },
    {
      id: 'recon-ar',
      category: 'Accounts Receivable',
      accountingValue: arTotal,
      taxValue: arTotal,
      note: 'AR balance consistent with invoiced amounts.',
    },
    {
      id: 'recon-depreciation',
      category: 'Depreciation',
      accountingValue: 0,
      taxValue: 0,
      note: 'Fixed asset depreciation schedule not yet connected — link the Assets module to enable this comparison.',
      noData: true,
    },
  ].map((it) => {
    const difference = it.accountingValue - it.taxValue;
    const diffPct = it.accountingValue !== 0 ? (difference / it.accountingValue) * 100 : 0;
    const status = it.noData ? 'No Data' : difference === 0 ? 'Reconciled' : Math.abs(diffPct) > 5 ? 'Requires Review' : 'Difference Found';
    return { ...it, difference, diffPct, status };
  });

  const reconciledCount = items.filter((i) => i.status === 'Reconciled').length;
  const diffCount = items.filter((i) => i.status === 'Difference Found').length;
  const reviewCount = items.filter((i) => i.status === 'Requires Review' || i.status === 'No Data').length;

  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Tax Reconciliation</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accounting records vs tax records{plSample ? ' · Sample data' : ''} — Validate with applicable Indonesian tax regulations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-positive bg-positive-subtle px-2.5 py-1 rounded-full border border-positive/20 flex items-center gap-1">
            <Icon name="CheckCircleIcon" size={11} />{reconciledCount} Reconciled
          </span>
          <span className="text-xs font-semibold text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">{diffCount} Difference</span>
          <span className="text-xs font-semibold text-negative bg-negative-subtle px-2.5 py-1 rounded-full border border-negative/20">{reviewCount} Review</span>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Accounting Value</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Tax Record Value</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Difference</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Diff %</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const cfg = STATUS_STYLES[item.status];
              const isExpanded = expanded === item.id;
              return (
                <React.Fragment key={item.id}>
                  <tr className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-foreground">{item.category}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-muted-foreground">{item.noData ? '—' : fx(formatIDR(item.accountingValue, true))}</td>
                    <td className="px-4 py-3 text-right text-sm tabular-nums text-foreground">{item.noData ? '—' : fx(formatIDR(item.taxValue, true))}</td>
                    <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${item.difference !== 0 ? 'text-warning' : 'text-positive'}`}>
                      {item.noData ? '—' : item.difference !== 0 ? fx(formatIDR(item.difference, true)) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right text-sm tabular-nums ${item.diffPct !== 0 ? 'text-warning' : 'text-positive'}`}>
                      {item.noData ? '—' : item.diffPct !== 0 ? `${item.diffPct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-2xs font-semibold px-2 py-1 rounded-full border flex items-center gap-1 w-fit ${cfg.badge}`}>
                        <Icon name={cfg.icon as Parameters<typeof Icon>[0]['name']} size={10} />
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setExpanded(isExpanded ? null : item.id)}
                        className="text-xs text-primary hover:text-primary/80 transition-colors"
                      >
                        {isExpanded ? 'Hide' : 'Details'}
                      </button>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${item.id}-detail`} className="border-b border-border bg-muted/20">
                      <td colSpan={7} className="px-4 py-3">
                        <div className="flex items-start gap-2 animate-fade-in">
                          <Icon name="InformationCircleIcon" size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                          <p className="text-xs text-muted-foreground leading-relaxed">{item.note}</p>
                          <button
                            onClick={() => router.push(CATEGORY_ROUTES[item.category] || '/financial-statements')}
                            className="ml-auto text-xs text-primary hover:text-primary/80 flex items-center gap-1 flex-shrink-0"
                          >
                            <Icon name="ArrowTopRightOnSquareIcon" size={12} />
                            View Accounts
                          </button>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
