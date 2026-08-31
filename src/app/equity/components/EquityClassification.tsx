'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

// Backend integration point: replace with API call to /api/equity/classification?period=...
interface EquityItem {
  id: string;
  label: string;
  value: string;
  amount: number;
  pct: number;
  children?: EquityItem[];
}

const equityTree: EquityItem[] = [
  {
    id: 'share-capital',
    label: 'Share Capital',
    value: 'Rp 3,000M',
    amount: 3000,
    pct: 63.8,
    children: [
      { id: 'paid-in', label: 'Paid-in Capital', value: 'Rp 2,500M', amount: 2500, pct: 53.2 },
      { id: 'additional', label: 'Additional Paid-in Capital', value: 'Rp 500M', amount: 500, pct: 10.6 },
    ],
  },
  {
    id: 'retained-earnings',
    label: 'Retained Earnings',
    value: 'Rp 2,040M',
    amount: 2040,
    pct: 43.4,
    children: [
      { id: 'prior-retained', label: 'Prior Year Retained Earnings', value: 'Rp 1,080M', amount: 1080, pct: 23.0 },
      { id: 'current-profit', label: 'Current Year Profit', value: 'Rp 1,840M', amount: 1840, pct: 39.1 },
      { id: 'dividends', label: 'Dividends Paid', value: '(Rp 880M)', amount: -880, pct: -18.7 },
    ],
  },
  {
    id: 'other-equity',
    label: 'Other Equity',
    value: 'Rp 460M',
    amount: 460,
    pct: 9.8,
    children: [
      { id: 'oci', label: 'Other Comprehensive Income', value: 'Rp 280M', amount: 280, pct: 6.0 },
      { id: 'reval', label: 'Revaluation Reserve', value: 'Rp 180M', amount: 180, pct: 3.8 },
    ],
  },
];

function EquityTreeRow({ item, depth = 0 }: { item: EquityItem; depth?: number }) {
  const { fx } = useCurrency();
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = item.children && item.children.length > 0;
  const isNegative = item.amount < 0;

  return (
    <>
      <tr
        className={`border-b border-border hover:bg-muted/30 transition-colors ${depth === 0 ? 'bg-muted/20' : ''}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
        style={{ cursor: hasChildren ? 'pointer' : 'default' }}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
            {hasChildren ? (
              <Icon
                name={expanded ? 'ChevronDownIcon' : 'ChevronRightIcon'}
                size={12}
                className="text-muted-foreground shrink-0"
              />
            ) : (
              <span className="w-3 h-3 shrink-0" />
            )}
            <span className={`text-[12px] ${depth === 0 ? 'font-600 text-foreground' : 'font-400 text-muted-foreground'}`}>
              {item.label}
            </span>
          </div>
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className={`text-[12px] font-600 financial-value ${isNegative ? 'text-negative' : depth === 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
            {fx(item.value)}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className={`text-[11px] font-500 ${isNegative ? 'text-negative' : 'text-muted-foreground'}`}>
            {isNegative ? '' : ''}{item.pct > 0 ? '+' : ''}{item.pct}%
          </span>
        </td>
        <td className="px-4 py-2.5">
          <div className="w-24 bg-muted rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full"
              style={{
                width: `${Math.min(Math.abs(item.pct), 100)}%`,
                background: isNegative ? 'var(--negative)' : depth === 0 ? 'var(--primary)' : '#94a3b8',
              }}
            />
          </div>
        </td>
      </tr>
      {hasChildren && expanded && item.children!.map(child => (
        <EquityTreeRow key={`eq-tree-${child.id}`} item={child} depth={depth + 1} />
      ))}
    </>
  );
}

export default function EquityClassification() {
  const { fx } = useCurrency();
  return (
    <div className="fin-card p-5">
      <div className="mb-4">
        <div className="text-[14px] font-600 text-foreground">Equity Classification</div>
        <div className="text-[11px] text-muted-foreground">Hierarchical breakdown of shareholder equity components</div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="text-left px-4 py-2.5 font-600 text-muted-foreground">Account</th>
              <th className="text-right px-4 py-2.5 font-600 text-muted-foreground">Amount</th>
              <th className="text-right px-4 py-2.5 font-600 text-muted-foreground">% of Total</th>
              <th className="px-4 py-2.5 font-600 text-muted-foreground">Composition</th>
            </tr>
          </thead>
          <tbody>
            {equityTree.map(item => (
              <EquityTreeRow key={`eq-class-${item.id}`} item={item} depth={0} />
            ))}
            <tr className="border-t-2 border-border bg-primary/5">
              <td className="px-4 py-3 text-[13px] font-700 text-primary">Total Equity</td>
              <td className="px-4 py-3 text-right text-[13px] font-700 text-primary financial-value">{fx('Rp 4,700M')}</td>
              <td className="px-4 py-3 text-right text-[11px] font-600 text-positive">+9.6% growth</td>
              <td className="px-4 py-3" />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
