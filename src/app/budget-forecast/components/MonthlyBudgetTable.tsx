'use client';
import React, { useState } from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface MonthRow {
  month: string;
  isForecast: boolean;
  revBudget: number; revActual: number;
  cogsBudget: number; cogsActual: number;
  opexBudget: number; opexActual: number;
  ebitdaBudget: number; ebitdaActual: number;
  netProfitBudget: number; netProfitActual: number;
}

const TABLE_DATA: MonthRow[] = [
  { month: 'Jan', isForecast: false, revBudget: 780, revActual: 718, cogsBudget: 429, cogsActual: 398, opexBudget: 105, opexActual: 98, ebitdaBudget: 198, ebitdaActual: 185, netProfitBudget: 138, netProfitActual: 142 },
  { month: 'Feb', isForecast: false, revBudget: 810, revActual: 769, cogsBudget: 446, cogsActual: 421, opexBudget: 108, opexActual: 104, ebitdaBudget: 206, ebitdaActual: 200, netProfitBudget: 143, netProfitActual: 149 },
  { month: 'Mar', isForecast: false, revBudget: 840, revActual: 858, cogsBudget: 462, cogsActual: 471, opexBudget: 112, opexActual: 109, ebitdaBudget: 213, ebitdaActual: 224, netProfitBudget: 148, netProfitActual: 156 },
  { month: 'Apr', isForecast: false, revBudget: 820, revActual: 724, cogsBudget: 451, cogsActual: 401, opexBudget: 110, opexActual: 108, ebitdaBudget: 207, ebitdaActual: 181, netProfitBudget: 144, netProfitActual: 132 },
  { month: 'May', isForecast: false, revBudget: 860, revActual: 834, cogsBudget: 473, cogsActual: 458, opexBudget: 115, opexActual: 112, ebitdaBudget: 218, ebitdaActual: 211, netProfitBudget: 151, netProfitActual: 154 },
  { month: 'Jun', isForecast: false, revBudget: 890, revActual: 936, cogsBudget: 490, cogsActual: 514, opexBudget: 119, opexActual: 122, ebitdaBudget: 225, ebitdaActual: 248, netProfitBudget: 156, netProfitActual: 168 },
  { month: 'Jul', isForecast: false, revBudget: 870, revActual: 881, cogsBudget: 479, cogsActual: 484, opexBudget: 116, opexActual: 119, ebitdaBudget: 220, ebitdaActual: 226, netProfitBudget: 153, netProfitActual: 158 },
  { month: 'Aug', isForecast: false, revBudget: 850, revActual: 700, cogsBudget: 468, cogsActual: 390, opexBudget: 114, opexActual: 106, ebitdaBudget: 215, ebitdaActual: 177, netProfitBudget: 149, netProfitActual: 141 },
  { month: 'Sep', isForecast: true, revBudget: 880, revActual: 906, cogsBudget: 484, cogsActual: 498, opexBudget: 118, opexActual: 115, ebitdaBudget: 223, ebitdaActual: 229, netProfitBudget: 155, netProfitActual: 159 },
  { month: 'Oct', isForecast: true, revBudget: 920, revActual: 948, cogsBudget: 506, cogsActual: 521, opexBudget: 123, opexActual: 119, ebitdaBudget: 233, ebitdaActual: 240, netProfitBudget: 162, netProfitActual: 167 },
  { month: 'Nov', isForecast: true, revBudget: 950, revActual: 978, cogsBudget: 523, cogsActual: 537, opexBudget: 127, opexActual: 123, ebitdaBudget: 240, ebitdaActual: 248, netProfitBudget: 167, netProfitActual: 172 },
  { month: 'Dec', isForecast: true, revBudget: 980, revActual: 1028, cogsBudget: 539, cogsActual: 565, opexBudget: 131, opexActual: 126, ebitdaBudget: 248, ebitdaActual: 261, netProfitBudget: 172, netProfitActual: 182 },
];

function VCell({ budget, actual, invert = false }: { budget: number; actual: number; invert?: boolean }) {
  const diff = actual - budget;
  const pct = ((diff / budget) * 100);
  const isFav = invert ? diff <= 0 : diff >= 0;
  return (
    <td className={`px-3 py-2.5 text-right text-sm font-tabular font-500 ${isFav ? 'text-positive' : 'text-negative'}`}>
      {isFav ? '+' : ''}{diff.toFixed(0)}
      <span className="text-2xs ml-1 opacity-70">({isFav ? '+' : ''}{pct.toFixed(1)}%)</span>
    </td>
  );
}

export default function MonthlyBudgetTable() {
  const [search, setSearch] = useState('');
  const filtered = TABLE_DATA.filter((r) => r.month.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="card-base">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-600 text-foreground">Monthly Budget Performance</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Jan–Dec 2026 · Forecast from Sep onwards</p>
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
              <th className="px-3 py-3 text-left text-xs font-600 text-muted-foreground sticky left-0 bg-card z-10">Month</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">Rev Budget</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">Rev Actual</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">Rev Var</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">COGS Budget</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">COGS Actual</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">COGS Var</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">OpEx Budget</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">OpEx Actual</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">EBITDA Budget</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">EBITDA Actual</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">NP Budget</th>
              <th className="px-3 py-3 text-right text-xs font-600 text-muted-foreground">NP Actual</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={`monthly-${row.month}`}
                className={`border-b border-border hover:bg-muted/40 transition-colors ${row.isForecast ? 'opacity-80' : ''}`}
              >
                <td className="px-3 py-2.5 sticky left-0 bg-card z-10">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-600 text-foreground">{row.month}</span>
                    {row.isForecast && (
                      <span className="text-2xs px-1.5 py-0.5 rounded-full bg-warning-subtle text-warning border border-warning/20 font-500">
                        Forecast
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular text-muted-foreground">{row.revBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular font-500 text-foreground">{row.revActual}M</td>
                <VCell budget={row.revBudget} actual={row.revActual} />
                <td className="px-3 py-2.5 text-right text-sm font-tabular text-muted-foreground">{row.cogsBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular font-500 text-foreground">{row.cogsActual}M</td>
                <VCell budget={row.cogsBudget} actual={row.cogsActual} invert />
                <td className="px-3 py-2.5 text-right text-sm font-tabular text-muted-foreground">{row.opexBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular font-500 text-foreground">{row.opexActual}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular text-muted-foreground">{row.ebitdaBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular font-500 text-foreground">{row.ebitdaActual}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular text-muted-foreground">{row.netProfitBudget}M</td>
                <td className="px-3 py-2.5 text-right text-sm font-tabular font-500 text-foreground">{row.netProfitActual}M</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border bg-muted/30">
              <td className="px-3 py-3 text-sm font-700 text-foreground sticky left-0 bg-muted/30 z-10">FY Total</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-muted-foreground">10,200M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-foreground">10,480M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-positive">+280M (+2.7%)</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-muted-foreground">5,610M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-foreground">5,720M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-negative">-110M (-2.0%)</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-muted-foreground">1,380M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-foreground">1,340M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-muted-foreground">2,550M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-foreground">2,720M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-muted-foreground">1,760M</td>
              <td className="px-3 py-3 text-right text-sm font-700 font-tabular text-positive">1,910M</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
