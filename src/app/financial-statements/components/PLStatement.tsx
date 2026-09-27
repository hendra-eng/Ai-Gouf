'use client';
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useLanguage } from '@/lib/language';
import { useProfitLossStatement } from '../lib/useStatementData';

const PLWaterfallChart = dynamic(() => import('./PLWaterfallChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full rounded-xl" />,
});

function formatPct(v: number, total: number) {
  return total ? `${((v / total) * 100).toFixed(1)}%` : '—';
}

interface PLRowProps {
  label: string;
  value: number;
  indent?: number;
  isTotal?: boolean;
  isSubtotal?: boolean;
  isNegative?: boolean;
  isBold?: boolean;
  subRows?: { label: string; value: number; pct: number }[];
  revenueBase?: number;
}

function PLRow({ label, value, indent = 0, isTotal, isSubtotal, isNegative, isBold, subRows, revenueBase }: PLRowProps) {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const [expanded, setExpanded] = useState(false);
  const hasChildren = subRows && subRows.length > 0;

  const rowBg = isTotal
    ? 'bg-primary/5 border-t-2 border-b-2 border-primary/20'
    : isSubtotal
    ? 'bg-muted/60 border-t border-border' :'';

  return (
    <>
      <tr
        className={`${rowBg} ${hasChildren ? 'cursor-pointer hover:bg-muted/40' : ''} transition-colors`}
        onClick={hasChildren ? () => setExpanded((p) => !p) : undefined}
      >
        <td className="px-5 py-3" style={{ paddingLeft: `${20 + indent * 20}px` }}>
          <div className="flex items-center gap-2">
            {hasChildren && (
              expanded ? <ChevronDown size={14} className="text-muted-foreground flex-shrink-0" />
                       : <ChevronRight size={14} className="text-muted-foreground flex-shrink-0" />
            )}
            <span className={`text-sm ${isBold || isTotal || isSubtotal ? 'font-bold text-foreground' : 'font-medium text-foreground'} ${indent > 0 ? 'text-muted-foreground font-normal' : ''}`}>
              {t(label)}
            </span>
          </div>
        </td>
        <td className="px-5 py-3 text-right">
          <span className={`text-sm font-semibold font-mono ${isTotal ? 'text-primary text-base' : isNegative ? 'text-negative' : isSubtotal ? 'text-foreground' : 'text-muted-foreground'}`}>
            {isNegative ? `(${formatRp(value)})` : formatRp(value)}
          </span>
        </td>
        <td className="px-5 py-3 text-right hidden md:table-cell">
          {!!revenueBase && (
            <span className="text-xs text-muted-foreground font-mono">
              {formatPct(value, revenueBase)}
            </span>
          )}
        </td>
        <td className="px-5 py-3 hidden lg:table-cell">
          {!!revenueBase && (
            <div className="w-full max-w-[120px] h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${isNegative ? 'bg-negative/60' : isTotal || isSubtotal ? 'bg-primary' : 'bg-primary/40'}`}
                style={{ width: `${Math.min(Math.abs(value / revenueBase) * 100, 100)}%` }}
              />
            </div>
          )}
        </td>
      </tr>
      {hasChildren && expanded && subRows.map((child, i) => (
        <tr key={`plchild-${label}-${i}`} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
          <td className="py-2.5" style={{ paddingLeft: `${20 + (indent + 1) * 20}px` }}>
            <span className="text-xs text-muted-foreground">{t(child.label)}</span>
          </td>
          <td className="px-5 py-2.5 text-right">
            <span className="text-xs font-mono text-muted-foreground">{formatRp(child.value)}</span>
          </td>
          <td className="px-5 py-2.5 text-right hidden md:table-cell">
            <span className="text-xs text-muted-foreground font-mono">{child.pct.toFixed(1)}%</span>
          </td>
          <td className="px-5 py-2.5 hidden lg:table-cell">
            <div className="w-full max-w-[120px] h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${Math.min(Math.abs(child.pct), 100)}%` }} />
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

export default function PLStatement() {
  const { currency } = useCurrency();
  const { t } = useLanguage();
  const { PL_CORE: c, MARGINS, RINCIAN, periodLabel, effectiveTaxRate } = useProfitLossStatement();
  const formatRp = (v: number) => formatMoney(v * 1_000_000, currency);
  const anak = (items: { name: string; value: number; pct: number }[]) => items.map((i) => ({ label: i.name, value: i.value, pct: i.pct }));
  // Data dari API /api/v1/financial-statements (transaksi posted), satuan juta.
  const plData = {
    revenue: { label: 'Total Revenue', value: c.revenue, children: anak(RINCIAN.revenue) },
    cogs: { label: 'Cost of Goods Sold', value: c.cogs, children: anak(RINCIAN.cogs) },
    grossProfit: { label: 'Gross Profit', value: c.grossProfit },
    opex: { label: 'Operating Expenses', value: c.operatingExpenses, children: anak(RINCIAN.operatingExpenses) },
    ebitda: { label: 'EBITDA', value: c.ebitda },
    depreciation: { label: 'Depreciation & Amortization', value: c.da, children: anak(RINCIAN.da) },
    ebit: { label: 'EBIT (Operating Income)', value: c.ebit },
    interest: { label: 'Interest Expense', value: c.interestExpense, children: anak(RINCIAN.interest) },
    ebt: { label: 'Earnings Before Tax', value: c.ebt },
    tax: { label: 'Income Tax (PPh Badan)', value: c.incomeTax, children: anak(RINCIAN.tax) },
    netProfit: { label: 'Net Profit', value: c.netProfit },
  };
  const rev = plData.revenue.value;

  return (
    <div className="space-y-6">
      {/* Waterfall chart */}
      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-base font-bold text-foreground mb-1">{t('P&L Waterfall — Revenue to Net Profit')}</h3>
        <p className="text-xs text-muted-foreground mb-4">{t('Revenue')} {formatRp(c.revenue)} → {t('Net Profit')} {formatRp(c.netProfit)}</p>
        <PLWaterfallChart values={{ revenue: c.revenue, cogs: c.cogs, opex: c.operatingExpenses, da: c.da, interest: c.interestExpense, tax: c.incomeTax }} />
      </div>

      {/* P&L Table */}
      <div className="card-elevated-md rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-foreground">{t('Laporan Laba Rugi')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('Periode')}: {periodLabel}</p>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden sm:inline">{t('Click a row to expand details')}</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Account')}</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Amount')} ({currency})</th>
                <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">{t('% Revenue')}</th>
                <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">{t('Visual')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              <PLRow label={plData.revenue.label} value={plData.revenue.value} isBold subRows={plData.revenue.children} revenueBase={rev} />
              <PLRow label={plData.cogs.label} value={plData.cogs.value} isNegative subRows={plData.cogs.children} revenueBase={rev} />
              <PLRow label={plData.grossProfit.label} value={plData.grossProfit.value} isSubtotal isBold revenueBase={rev} />

              <tr><td colSpan={4} className="px-5 py-1.5 bg-muted/20"><span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('Operating')}</span></td></tr>
              <PLRow label={plData.opex.label} value={plData.opex.value} isNegative subRows={plData.opex.children} revenueBase={rev} />
              <PLRow label={plData.ebitda.label} value={plData.ebitda.value} isSubtotal isBold revenueBase={rev} />
              <PLRow label={plData.depreciation.label} value={plData.depreciation.value} isNegative subRows={plData.depreciation.children} revenueBase={rev} />
              <PLRow label={plData.ebit.label} value={plData.ebit.value} isSubtotal revenueBase={rev} />

              <tr><td colSpan={4} className="px-5 py-1.5 bg-muted/20"><span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{t('Below the Line')}</span></td></tr>
              <PLRow label={plData.interest.label} value={plData.interest.value} isNegative subRows={plData.interest.children} revenueBase={rev} />
              <PLRow label={plData.ebt.label} value={plData.ebt.value} isSubtotal revenueBase={rev} />
              <PLRow label={plData.tax.label} value={plData.tax.value} isNegative subRows={plData.tax.children} revenueBase={rev} />
              <PLRow label={plData.netProfit.label} value={plData.netProfit.value} isTotal isBold revenueBase={rev} />
            </tbody>
          </table>
        </div>

        {/* Summary metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border border-t border-border">
          {[
            { label: 'Gross Margin', value: `${MARGINS.grossMargin.toFixed(1)}%`, positive: MARGINS.grossMargin >= 0 },
            { label: 'EBITDA Margin', value: `${MARGINS.ebitdaMargin.toFixed(1)}%`, positive: MARGINS.ebitdaMargin >= 0 },
            { label: 'Net Margin', value: `${MARGINS.netMargin.toFixed(1)}%`, positive: MARGINS.netMargin >= 0 },
            { label: 'Tax Rate Effective', value: `${effectiveTaxRate.toFixed(1)}%`, positive: false },
          ].map((m) => (
            <div key={`plsum-${m.label}`} className="bg-card px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(m.label)}</p>
              <p className={`text-xl font-bold font-mono mt-1 ${m.positive ? 'text-positive' : 'text-foreground'}`}>{m.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
