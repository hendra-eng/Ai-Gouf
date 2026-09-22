'use client';
import React, { useState } from 'react';
import Icon from '@/components/ui/AppIcon';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { EquityTreeItem } from '../lib/equityBridge';

// [UBAH] Data contoh dikosongkan — tampil hanya kalau belum ada client aktif
// / belum ada jurnal (isSampleData); sekarang tetap kosong/0.
const SAMPLE_TREE: EquityTreeItem[] = [];
const SAMPLE_TOTAL = 0;
const SAMPLE_GROWTH = 0;

function EquityTreeRow({ item, depth = 0 }: { item: EquityTreeItem; depth?: number }) {
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
            {fx(formatMoney(item.amount, 'IDR'))}
          </span>
        </td>
        <td className="px-4 py-2.5 text-right">
          <span className={`text-[11px] font-500 ${isNegative ? 'text-negative' : 'text-muted-foreground'}`}>
            {item.pct > 0 ? '+' : ''}{item.pct}%
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

interface EquityClassificationProps {
  isSampleData: boolean;
  tree: EquityTreeItem[];
  totalEquity: number;
  growthPct: number;
}

export default function EquityClassification({ isSampleData, tree, totalEquity, growthPct }: EquityClassificationProps) {
  const { fx } = useCurrency();
  const source = isSampleData ? SAMPLE_TREE : tree;
  const total = isSampleData ? SAMPLE_TOTAL : totalEquity;
  const growth = isSampleData ? SAMPLE_GROWTH : growthPct;

  return (
    <div className="fin-card p-5">
      <div className="mb-4">
        <div className="text-[14px] font-600 text-foreground">Equity Classification</div>
        <div className="text-[11px] text-muted-foreground">Hierarchical breakdown of shareholder equity components</div>
      </div>

      {!isSampleData && source.length === 0 ? (
        <div className="text-[12px] text-muted-foreground py-6 text-center">
          No equity account balances found for this client yet.
        </div>
      ) : (
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
              {source.map(item => (
                <EquityTreeRow key={`eq-class-${item.id}`} item={item} depth={0} />
              ))}
              <tr className="border-t-2 border-border bg-primary/5">
                <td className="px-4 py-3 text-[13px] font-700 text-primary">Total Equity</td>
                <td className="px-4 py-3 text-right text-[13px] font-700 text-primary financial-value">{fx(formatMoney(total, 'IDR'))}</td>
                <td className={`px-4 py-3 text-right text-[11px] font-600 ${growth >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {growth >= 0 ? '+' : ''}{growth}% growth
                </td>
                <td className="px-4 py-3" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}