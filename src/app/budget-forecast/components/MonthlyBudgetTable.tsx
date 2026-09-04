'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useBudgetData, type MonthBudgetRow } from '../lib/budgetBridge';

function VCell({ budget, actual, invert = false }: { budget: number; actual: number; invert?: boolean }) {
  const diff = actual - budget;
  const pct = budget !== 0 ? (diff / budget) * 100 : 0;
  const isFav = invert ? diff <= 0 : diff >= 0;
  return (
    <td className={`px-3 py-2.5 text-right text-sm tabular-nums font-medium ${isFav ? 'text-positive' : 'text-negative'}`}>
      {isFav ? '+' : ''}{diff.toFixed(0)}
      <span className="text-2xs ml-1 opacity-70">({isFav ? '+' : ''}{pct.toFixed(1)}%)</span>
    </td>
  );
}

function fyTotal(rows: MonthBudgetRow[], key: keyof MonthBudgetRow): number {
  return rows.reduce((s, r) => s + (r[key] as number), 0);
}

export default function MonthlyBudgetTable() {
  const [search, setSearch] = useState('');
  const { monthlyRows, isSampleData, periodLabel } = useBudgetData();
  const filtered = monthlyRows.filter((r) => r.month.toLowerCase().includes(search.toLowerCase()));

  const fyRevBudget = fyTotal(monthlyRows, 'revBudget');
  const fyRevActual = fyTotal(monthlyRows, 'revActual');
  const fyCogsBudget = fyTotal(monthlyRows, 'cogsBudget');
  const fyCogsActual = fyTotal(monthlyRows, 'cogsActual');
  const fyOpexBudget = fyTotal(monthlyRows, 'opexBudget');
  const fyOpexActual = fyTotal(monthlyRows, 'opexActual');
  const fyEbitdaBudget = fyTotal(monthlyRows, 'ebitdaBudget');
  const fyEbitdaActual = fyTotal(monthlyRows, 'ebitdaActual');
  const fyNpBudget = fyTotal(monthlyRows, 'netProfitBudget');
  const fyNpActual = fyTotal(monthlyRows, 'netProfitActual');
  const revDiff = fyRevActual - fyRevBudget;
  const revPct = fyRevBudget !== 0 ? (revDiff / fyRevBudget) * 100 : 0;
  const cogsDiff = fyCogsActual - fyCogsBudget;
  const cogsPct = fyCogsBudget !== 0 ? (cogsDiff / fyCogsBudget) * 100 : 0;

  return (
    <div className="card-base">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Monthly Budget Performance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {periodLabel || 'Year to date'} · Actual from posted transactions
            {isSampleData ? ' · Sample data' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 bg-muted border border-border rounded-lg px-3 py-2">
            <Icon name="MagnifyingGlassIcon" size={14} className="text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter month..."
              className="bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none w-24"
            />
          </div>
          <button
            onClick={() => toast.success('Export dimulai', { description: 'Tabel budget bulanan akan diunduh sebagai Excel' })}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-2 bg-muted border border-border rounded-lg"
          >
            <Icon name="ArrowDownTrayIcon" size={14} />
            Export
          </button>
        </div>
      </div>

      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[1100px]">
          <thead>
            <tr className="border-b border-border">
              <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground sticky left-0 bg-card z-10">Month</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Rev Budget</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Rev Actual</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">Rev Var</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">COGS Budget</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">COGS Actual</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">COGS Var</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">OpEx Budget</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">OpEx Actual</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">EBITDA Budget</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">EBITDA Actual</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">NP Budget</th>
              <th className="px-3 py-3 text-right text-xs font-semibold text-muted-foreground">NP Actual</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={13} className="px-4 py-8 text-center text-sm text-muted-foreground">No monthly data posted yet for this client.</td></tr>
            )}
            {filtered.map((row) => (
              <tr key={`monthly-${row.month}`} className="border-b border-border hover:bg-muted/40 transition-colors">
                <td className="px-3 py-2.5 sticky left-0 bg-card z-10">
                  <span className="text-sm font-semibold text-foreground">{row.month}</span>
                </td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.revBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-foreground">{row.revActual}M</td>
                <VCell budget={row.revBudget} actual={row.revActual} />
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.cogsBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-foreground">{row.cogsActual}M</td>
                <VCell budget={row.cogsBudget} actual={row.cogsActual} invert />
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.opexBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-foreground">{row.opexActual}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.ebitdaBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-foreground">{row.ebitdaActual}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{row.netProfitBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm tabular-nums font-medium text-foreground">{row.netProfitActual}M</td>
              </tr>
            ))}
          </tbody>
          {monthlyRows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-border bg-muted/30">
                <td className="px-3 py-3 text-sm font-bold text-foreground sticky left-0 bg-muted/30 z-10">YTD Total</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-muted-foreground">{fyRevBudget}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">{fyRevActual}M</td>
                <td className={`px-3 py-3 text-right text-sm font-bold tabular-nums ${revDiff >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {revDiff >= 0 ? '+' : ''}{revDiff.toFixed(0)}M ({revDiff >= 0 ? '+' : ''}{revPct.toFixed(1)}%)
                </td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-muted-foreground">{fyCogsBudget}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">{fyCogsActual}M</td>
                <td className={`px-3 py-3 text-right text-sm font-bold tabular-nums ${cogsDiff <= 0 ? 'text-positive' : 'text-negative'}`}>
                  {cogsDiff >= 0 ? '+' : ''}{cogsDiff.toFixed(0)}M ({cogsDiff >= 0 ? '+' : ''}{cogsPct.toFixed(1)}%)
                </td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-muted-foreground">{fyOpexBudget}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">{fyOpexActual}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-muted-foreground">{fyEbitdaBudget}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">{fyEbitdaActual}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-muted-foreground">{fyNpBudget}M</td>
                <td className="px-3 py-3 text-right text-sm font-bold tabular-nums text-foreground">{fyNpActual}M</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
