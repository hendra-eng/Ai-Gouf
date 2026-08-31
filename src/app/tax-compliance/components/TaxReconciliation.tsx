'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const RECON_ITEMS = [
  {
    id: 'recon-rev',
    category: 'Revenue',
    accountingValue: 8_420_000_000,
    taxValue: 8_420_000_000,
    difference: 0,
    diffPct: 0,
    status: 'Reconciled',
    note: 'Revenue fully recognized for tax purposes',
  },
  {
    id: 'recon-expense',
    category: 'Expenses',
    accountingValue: 5_880_000_000,
    taxValue: 5_720_000_000,
    difference: 160_000_000,
    diffPct: 2.72,
    status: 'Difference Found',
    note: 'Entertainment expenses partially non-deductible under Art. 9 PPh',
  },
  {
    id: 'recon-tax',
    category: 'Tax Expense',
    accountingValue: 182_000_000,
    taxValue: 182_000_000,
    difference: 0,
    diffPct: 0,
    status: 'Reconciled',
    note: 'Tax payable matches accounting records',
  },
  {
    id: 'recon-ar',
    category: 'Accounts Receivable',
    accountingValue: 1_240_000_000,
    taxValue: 1_240_000_000,
    difference: 0,
    diffPct: 0,
    status: 'Reconciled',
    note: 'AR balance consistent with invoiced amounts',
  },
  {
    id: 'recon-depreciation',
    category: 'Depreciation',
    accountingValue: 248_000_000,
    taxValue: 224_000_000,
    difference: 24_000_000,
    diffPct: 9.68,
    status: 'Requires Review',
    note: 'Timing difference in depreciation method — requires fiscal adjustment',
  },
];

const STATUS_STYLES: Record<string, { badge: string; icon: string }> = {
  'Reconciled': { badge: 'bg-positive-subtle text-positive border-positive/20', icon: 'CheckCircleIcon' },
  'Difference Found': { badge: 'bg-warning-subtle text-warning border-warning/20', icon: 'ExclamationCircleIcon' },
  'Requires Review': { badge: 'bg-negative-subtle text-negative border-negative/20', icon: 'ExclamationTriangleIcon' },
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
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-600 text-foreground">Tax Reconciliation</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Accounting records vs tax records · Aug 2026 — Validate with applicable Indonesian tax regulations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-600 text-positive bg-positive-subtle px-2.5 py-1 rounded-full border border-positive/20 flex items-center gap-1">
            <Icon name="CheckCircleIcon" size={11} />3 Reconciled
          </span>
          <span className="text-xs font-600 text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">1 Difference</span>
          <span className="text-xs font-600 text-negative bg-negative-subtle px-2.5 py-1 rounded-full border border-negative/20">1 Review</span>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-600 text-muted-foreground">Category</th>
              <th className="px-4 py-3 text-right text-xs font-600 text-muted-foreground">Accounting Value</th>
              <th className="px-4 py-3 text-right text-xs font-600 text-muted-foreground">Tax Record Value</th>
              <th className="px-4 py-3 text-right text-xs font-600 text-muted-foreground">Difference</th>
              <th className="px-4 py-3 text-right text-xs font-600 text-muted-foreground">Diff %</th>
              <th className="px-4 py-3 text-left text-xs font-600 text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-600 text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {RECON_ITEMS.map((item) => {
              const cfg = STATUS_STYLES[item.status];
              const isExpanded = expanded === item.id;
              return (
                <React.Fragment key={item.id}>
                  <tr className="border-b border-border hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-500 text-foreground">{item.category}</td>
                    <td className="px-4 py-3 text-right text-sm font-tabular text-muted-foreground">{fx(formatIDR(item.accountingValue, true))}</td>
                    <td className="px-4 py-3 text-right text-sm font-tabular text-foreground">{fx(formatIDR(item.taxValue, true))}</td>
                    <td className={`px-4 py-3 text-right text-sm font-600 font-tabular ${item.difference !== 0 ? 'text-warning' : 'text-positive'}`}>
                      {item.difference !== 0 ? fx(formatIDR(item.difference, true)) : '—'}
                    </td>
                    <td className={`px-4 py-3 text-right text-sm font-tabular ${item.diffPct !== 0 ? 'text-warning' : 'text-positive'}`}>
                      {item.diffPct !== 0 ? `${item.diffPct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-2xs font-600 px-2 py-1 rounded-full border flex items-center gap-1 w-fit ${cfg.badge}`}>
                        <Icon name={cfg.icon as Parameters<typeof Icon>[0]['name']} size={10} />
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {item.difference !== 0 && (
                        <button
                          onClick={() => setExpanded(isExpanded ? null : item.id)}
                          className="text-xs text-primary hover:text-primary/80 transition-colors"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      )}
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
