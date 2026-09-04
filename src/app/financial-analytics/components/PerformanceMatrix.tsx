'use client';
import React, { useMemo } from 'react';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';
import { useBudgetData } from '@/app/budget-forecast/lib/budgetBridge';

interface MatrixRow {
  id: string;
  metric: string;
  current: number | string;
  previous: number | string;
  budget: number | string | null;
  variance: number | string | null;
  growth: number;
  isCurrency: boolean;
}

// [BARU] Sambungkan Performance Matrix ke data ASLI client aktif --
// Current/Previous/Growth diambil dari `absolutes` di useAnalyticsData.ts
// (Rp Juta, sudah dihitung dari trial balance bulanan real -- lihat catatan
// di file itu). Karena backend cuma punya 1 tahun berjalan, "Previous" di
// sini adalah BULAN SEBELUMNYA (MoM), bukan tahun sebelumnya seperti versi
// mock lama -- label kolom menyesuaikan otomatis.
//
// Budget (target FY) untuk Revenue/Gross Profit/EBITDA/Net Profit diambil
// dari useBudgetData() (budgetBridge.ts) yang sudah dipakai halaman Budget &
// Forecast -- targetnya dihitung dari run-rate aktual + asumsi pertumbuhan
// (BUDGET_ASSUMPTIONS), karena backend belum punya modul input budget
// manual. Cash/AR/AP TIDAK punya padanan budget di aplikasi ini (budget yang
// ada cuma untuk line P&L) -- ditampilkan "–" apa adanya, bukan angka
// karangan, sampai ada modul budget neraca.
function useMatrixData(): { rows: MatrixRow[]; isSampleData: boolean; previousLabel: string; growthLabel: string } {
  const analytics = useAnalyticsData();
  const budget = useBudgetData();

  return useMemo(() => {
    if (analytics.isSampleData) {
      return {
        isSampleData: true,
        previousLabel: 'Previous Year',
        growthLabel: 'YoY Growth',
        rows: [
          { id: 'mx-rev', metric: 'Revenue', current: 8_420_000_000, previous: 7_466_000_000, budget: 10_200_000_000, variance: -1_780_000_000, growth: 12.8, isCurrency: true },
          { id: 'mx-gp', metric: 'Gross Profit', current: 3_720_000_000, previous: 3_194_000_000, budget: 4_590_000_000, variance: -870_000_000, growth: 16.5, isCurrency: true },
          { id: 'mx-ebitda', metric: 'EBITDA', current: 2_310_000_000, previous: 1_951_000_000, budget: 2_550_000_000, variance: -240_000_000, growth: 18.4, isCurrency: true },
          { id: 'mx-np', metric: 'Net Profit', current: 1_840_000_000, previous: 1_584_000_000, budget: 1_760_000_000, variance: 80_000_000, growth: 16.2, isCurrency: true },
          { id: 'mx-cash', metric: 'Cash', current: 2_960_000_000, previous: 2_480_000_000, budget: 3_200_000_000, variance: -240_000_000, growth: 19.4, isCurrency: true },
          { id: 'mx-ar', metric: 'Accounts Receivable', current: 1_240_000_000, previous: 1_080_000_000, budget: 1_100_000_000, variance: 140_000_000, growth: 14.8, isCurrency: true },
          { id: 'mx-ap', metric: 'Accounts Payable', current: 860_000_000, previous: 780_000_000, budget: 820_000_000, variance: 40_000_000, growth: 10.3, isCurrency: true },
        ],
      };
    }

    const RP_JUTA = 1_000_000;
    const growthPct = (curr: number, prev: number) => (prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0);
    const { absolutes } = analytics;

    const withPLBudget = (id: string, metric: string, abs: { current: number; previous: number }, line: { actual: number; budget: number } | null): MatrixRow => {
      const current = abs.current * RP_JUTA;
      const previous = abs.previous * RP_JUTA;
      const budgetVal = line ? line.budget : null;
      const variance = budgetVal !== null ? line!.actual - budgetVal : null;
      return { id, metric, current, previous, budget: budgetVal, variance, growth: growthPct(abs.current, abs.previous), isCurrency: true };
    };

    const rows: MatrixRow[] = [
      withPLBudget('mx-rev', 'Revenue', absolutes.revenue, budget.isSampleData ? null : budget.lines.revenue),
      withPLBudget('mx-gp', 'Gross Profit', absolutes.grossProfit, budget.isSampleData ? null : budget.lines.grossProfit),
      withPLBudget('mx-ebitda', 'EBITDA', absolutes.ebitda, budget.isSampleData ? null : budget.lines.ebitda),
      withPLBudget('mx-np', 'Net Profit', absolutes.netProfit, budget.isSampleData ? null : budget.lines.netProfit),
      { id: 'mx-cash', metric: 'Cash', current: absolutes.cash.current * RP_JUTA, previous: absolutes.cash.previous * RP_JUTA, budget: null, variance: null, growth: growthPct(absolutes.cash.current, absolutes.cash.previous), isCurrency: true },
      { id: 'mx-ar', metric: 'Accounts Receivable', current: absolutes.ar.current * RP_JUTA, previous: absolutes.ar.previous * RP_JUTA, budget: null, variance: null, growth: growthPct(absolutes.ar.current, absolutes.ar.previous), isCurrency: true },
      { id: 'mx-ap', metric: 'Accounts Payable', current: absolutes.ap.current * RP_JUTA, previous: absolutes.ap.previous * RP_JUTA, budget: null, variance: null, growth: growthPct(absolutes.ap.current, absolutes.ap.previous), isCurrency: true },
    ];

    return { isSampleData: false, previousLabel: 'Previous Month', growthLabel: 'MoM Growth', rows };
  }, [analytics, budget]);
}

function CellValue({ value, isCurrency, className = '' }: { value: number | string | null; isCurrency: boolean; className?: string }) {
  const { fx } = useCurrency();
  const display = value === null
    ? '–'
    : typeof value === 'number' && isCurrency ? fx(formatIDR(value as number, true)) : String(value);
  return (
    <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${className}`}>
      {display}
    </td>
  );
}

export default function PerformanceMatrix() {
  const { fx } = useCurrency();
  const { rows, isSampleData, previousLabel, growthLabel } = useMatrixData();

  return (
    <div className="card-base">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Financial Performance Matrix</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Key metrics with conditional formatting · {isSampleData ? 'FY 2026 YTD (sample)' : 'Current Month'}
          </p>
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
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Current</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{previousLabel}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{isSampleData ? 'FY Budget' : 'FY Budget (Target)'}</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">Budget Variance</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-muted-foreground">{growthLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const varNum = typeof row.variance === 'number' ? row.variance : null;
              // For AR and AP, positive variance vs budget is unfavorable (higher than budget)
              const isARorAP = row.metric.includes('Receivable') || row.metric.includes('Payable');
              const isFavorable = varNum === null ? null : isARorAP ? varNum <= 0 : varNum >= 0;
              const varColor = isFavorable === null ? 'text-muted-foreground' : isFavorable ? 'text-positive' : 'text-negative';
              const varBg = isFavorable === null ? '' : isFavorable ? 'bg-positive-subtle' : 'bg-negative-subtle';

              return (
                <tr key={row.id} className="border-b border-border hover:bg-muted/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3 text-sm font-semibold text-foreground">{row.metric}</td>
                  <CellValue value={row.current} isCurrency={row.isCurrency} className="text-foreground" />
                  <CellValue value={row.previous} isCurrency={row.isCurrency} className="text-muted-foreground" />
                  <CellValue value={row.budget} isCurrency={row.isCurrency} className="text-muted-foreground" />
                  <td className={`px-4 py-3 text-right text-sm font-semibold tabular-nums ${varColor}`}>
                    {varNum === null ? (
                      <span className="text-muted-foreground">–</span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-md ${varBg}`}>
                        {varNum >= 0 ? '+' : ''}{fx(formatIDR(varNum, true))}
                      </span>
                    )}
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