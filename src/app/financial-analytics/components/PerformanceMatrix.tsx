'use client';
import React from 'react';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

interface MatrixRow {
  id: string;
  metric: string;
  current: number | string;
  previous: number | string;
  budget: number | string;
  variance: number | string;
  growth: number;
  isCurrency: boolean;
}

const MATRIX_DATA: MatrixRow[] = [
  { id: 'mx-rev', metric: 'Revenue', current: 8_420_000_000, previous: 7_466_000_000, budget: 10_200_000_000, variance: -1_780_000_000, growth: 12.8, isCurrency: true },
  { id: 'mx-gp', metric: 'Gross Profit', current: 3_720_000_000, previous: 3_194_000_000, budget: 4_590_000_000, variance: -870_000_000, growth: 16.5, isCurrency: true },
  { id: 'mx-ebitda', metric: 'EBITDA', current: 2_310_000_000, previous: 1_951_000_000, budget: 2_550_000_000, variance: -240_000_000, growth: 18.4, isCurrency: true },
  { id: 'mx-np', metric: 'Net Profit', current: 1_840_000_000, previous: 1_584_000_000, budget: 1_760_000_000, variance: 80_000_000, growth: 16.2, isCurrency: true },
  { id: 'mx-cash', metric: 'Cash', current: 2_960_000_000, previous: 2_480_000_000, budget: 3_200_000_000, variance: -240_000_000, growth: 19.4, isCurrency: true },
  { id: 'mx-ar', metric: 'Accounts Receivable', current: 1_240_000_000, previous: 1_080_000_000, budget: 1_100_000_000, variance: 140_000_000, growth: 14.8, isCurrency: true },
  { id: 'mx-ap', metric: 'Accounts Payable', current: 860_000_000, previous: 780_000_000, budget: 820_000_000, variance: 40_000_000, growth: 10.3, isCurrency: true },
];

function CellValue({ value, isCurrency, className = '' }: { value: number | string; isCurrency: boolean; className?: string }) {
  const { fx } = useCurrency();
  const display = typeof value === 'number' && isCurrency ? fx(formatIDR(value as number, true)) : String(value);
  return (
    <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${className}`}>
      {display}
    </td>
  );
}

export default function PerformanceMatrix() {
  const { fx } = useCurrency();
  return (
    <div className="card-base">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Financial Performance Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Key metrics with conditional formatting · FY 2026 YTD</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-positive-subtle border border-positive/30" /><span>Favorable</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-negative-subtle border border-negative/30" /><span>Unfavorable</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-muted border border-border" /><span>Neutral</span></div>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[700px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-4 py-3 text-left text-xs font-semibold text-muted-foreground">Metric</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Current (YTD)</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Previous Year</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">FY Budget</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Budget Variance</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">YoY Growth</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX_DATA.map((row) => {
              const varNum = typeof row.variance === 'number' ? row.variance : 0;
              // For AR and AP, positive variance vs budget is unfavorable (higher than budget)
              const isARorAP = row.metric.includes('Receivable') || row.metric.includes('Payable');
              const isFavorable = isARorAP ? varNum <= 0 : varNum >= 0;
              const varColor = isFavorable ? 'text-positive' : 'text-negative';
              const varBg = isFavorable ? 'bg-positive-subtle' : 'bg-negative-subtle';

              return (
                <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">{row.metric}</td>
                  <CellValue value={row.current} isCurrency={row.isCurrency} className="text-foreground" />
                  <CellValue value={row.previous} isCurrency={row.isCurrency} className="text-muted-foreground" />
                  <CellValue value={row.budget} isCurrency={row.isCurrency} className="text-muted-foreground" />
                  <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${varColor}`}>
                    <span className={`px-2 py-0.5 rounded-md ${varBg}`}>
                      {varNum >= 0 ? '+' : ''}{fx(formatIDR(varNum, true))}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right text-sm font-bold tabular-nums ${row.growth >= 0 ? 'text-positive' : 'text-negative'}`}>
                    {row.growth >= 0 ? '+' : ''}{row.growth.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
