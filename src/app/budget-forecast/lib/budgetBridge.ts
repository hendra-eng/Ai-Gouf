'use client';
// ─── JEMBATAN DATA REAL → BUDGET & FORECAST ────────────────────────────────
// "Actual" pada seluruh halaman ini diambil dari useProfitLossData() -- hook
// REAL yang sama yang sudah dipakai halaman Financial Statements (P&L),
// yang mengambil data dari backend (trial balance bulanan client aktif).
//
// "Budget" (target rencana) secara alami TIDAK bisa diturunkan dari transaksi
// historis -- budget adalah angka target yang ditentukan tim finance/
// manajemen, bukan hasil pencatatan. Karena backend belum punya modul input
// budget tersendiri, target budget di sini dihitung otomatis dari actual
// run-rate client yang aktif + asumsi pertumbuhan (BUDGET_ASSUMPTIONS di
// bawah), supaya angkanya tetap relevan untuk client yang sedang aktif
// (bukan angka generik yang tidak berhubungan). Begitu ada fitur input
// budget manual, cukup ganti annualBudgetFromAssumptions() dengan nilai
// tersimpan itu -- struktur/])consumer di seluruh komponen tidak perlu berubah.
import { useMemo } from 'react';
import { useProfitLossData, type MonthlyPLRow, type BreakdownItem, type PLCoreValues } from '@/app/financial-statements/lib/useProfitLossData';

export const BUDGET_ASSUMPTIONS = {
  revenueGrowth: 0.08, // target pertumbuhan revenue tahunan vs run-rate aktual
  cogsRatioDelta: -0.01, // target efisiensi COGS (rasio thd revenue turun 1pp)
  opExGrowth: 0.05, // target pertumbuhan opex tahunan (di bawah target revenue)
};

function sum(rows: number[]): number {
  return rows.reduce((s, v) => s + v, 0);
}

export interface MonthBudgetRow {
  month: string;
  isForecast: boolean;
  revBudget: number;
  revActual: number;
  cogsBudget: number;
  cogsActual: number;
  opexBudget: number;
  opexActual: number;
  expBudget: number;
  expActual: number;
  ebitdaBudget: number;
  ebitdaActual: number;
  netProfitBudget: number;
  netProfitActual: number;
  variance: number;
  variancePct: number;
}

export interface LineBudget { actual: number; budget: number; forecast: number }

export interface BudgetData {
  loading: boolean;
  isSampleData: boolean;
  companyName: string;
  periodLabel: string;
  monthsElapsed: number;
  annualRevenueBudget: number;
  annualExpenseBudget: number;
  PL_CORE: PLCoreValues;
  lines: {
    revenue: LineBudget; cogs: LineBudget; grossProfit: LineBudget;
    operatingExpenses: LineBudget; ebitda: LineBudget; netProfit: LineBudget;
  };
  monthlyRows: MonthBudgetRow[];
  kpis: {
    totalBudget: number;
    totalActual: number;
    variance: number;
    variancePct: number;
    onTrackMonths: number;
    overBudgetMonths: number;
  };
  revenueCategoryVariance: { name: string; actual: number; budget: number; variance: number; variancePct: number }[];
  expenseCategoryVariance: { name: string; actual: number; budget: number; variance: number; variancePct: number }[];
  waterfall: { label: string; value: number; type: 'total' | 'positive' | 'negative' }[];
}

export function useBudgetData(): BudgetData {
  const pl = useProfitLossData();
  const { PL_CORE, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN, loading, isSampleData, companyName, periodLabel } = pl;

  return useMemo(() => {
    const monthsElapsed = MONTHLY_PL.length || 1;
    const revenueRunRate = monthsElapsed > 0 ? (PL_CORE.revenue / monthsElapsed) * 12 : 0;
    const expenseRunRate = monthsElapsed > 0 ? ((PL_CORE.cogs + PL_CORE.operatingExpenses) / monthsElapsed) * 12 : 0;

    const annualRevenueBudget = Math.round(revenueRunRate * (1 + BUDGET_ASSUMPTIONS.revenueGrowth));
    const annualExpenseBudget = Math.round(expenseRunRate * (1 + BUDGET_ASSUMPTIONS.opExGrowth + BUDGET_ASSUMPTIONS.cogsRatioDelta));

    const monthlyRevBudget = annualRevenueBudget / 12;
    const monthlyExpBudget = annualExpenseBudget / 12;
    const cogsShare = (PL_CORE.cogs) / Math.max(1, PL_CORE.cogs + PL_CORE.operatingExpenses);
    const monthlyCogsBudget = monthlyExpBudget * cogsShare;
    const monthlyOpexBudget = monthlyExpBudget * (1 - cogsShare);
    const netMarginTarget = (annualRevenueBudget - annualExpenseBudget) > 0
      ? ((annualRevenueBudget - annualExpenseBudget - PL_CORE.da - PL_CORE.interestExpense - PL_CORE.incomeTax) / annualRevenueBudget)
      : 0;

    const monthlyRows: MonthBudgetRow[] = MONTHLY_PL.map((m: MonthlyPLRow) => {
      const expActual = m.cogs + m.opEx;
      const ebitdaBudget = monthlyRevBudget - monthlyExpBudget;
      const variance = m.revenue - monthlyRevBudget;
      const variancePct = monthlyRevBudget !== 0 ? (variance / monthlyRevBudget) * 100 : 0;
      return {
        month: m.month,
        isForecast: false,
        revBudget: Math.round(monthlyRevBudget),
        revActual: m.revenue,
        cogsBudget: Math.round(monthlyCogsBudget),
        cogsActual: m.cogs,
        opexBudget: Math.round(monthlyOpexBudget),
        opexActual: m.opEx,
        expBudget: Math.round(monthlyExpBudget),
        expActual,
        ebitdaBudget: Math.round(ebitdaBudget),
        ebitdaActual: m.ebitda,
        netProfitBudget: Math.round(monthlyRevBudget * netMarginTarget),
        netProfitActual: m.netProfit,
        variance: Math.round(variance),
        variancePct,
      };
    });

    const totalBudget = Math.round(monthlyRevBudget * monthsElapsed);
    const totalActual = sum(monthlyRows.map((r) => r.revActual));
    const variance = totalActual - totalBudget;
    const variancePct = totalBudget !== 0 ? (variance / totalBudget) * 100 : 0;
    const onTrackMonths = monthlyRows.filter((r) => r.variance >= 0).length;
    const overBudgetMonths = monthlyRows.filter((r) => r.expActual > r.expBudget).length;

    // Budget per kategori = pangsa aktual kategori itu (pct) diterapkan ke
    // total anggaran kelompoknya (revenue/expense) -- jadi proporsi antar
    // kategori tetap realistis mengikuti komposisi aktual, sementara total
    // per kelompok mengikuti target tahunan di atas.
    const toVarianceRows = (items: BreakdownItem[], totalBudgetForGroup: number) =>
      items.map((it) => {
        const budget = Math.round((it.pct / 100) * totalBudgetForGroup);
        const v = it.value - budget;
        return {
          name: it.name,
          actual: it.value,
          budget,
          variance: v,
          variancePct: budget !== 0 ? (v / budget) * 100 : 0,
        };
      });

    const revenueCategoryVariance = toVarianceRows(REVENUE_BY_CATEGORY, annualRevenueBudget);
    const expenseCategoryVariance = toVarianceRows(EXPENSE_BREAKDOWN, annualExpenseBudget);

    const revVar = PL_CORE.revenue - Math.round(monthlyRevBudget * monthsElapsed);
    const cogsVar = Math.round(monthlyExpBudget * monthsElapsed * (PL_CORE.cogs / Math.max(1, PL_CORE.cogs + PL_CORE.operatingExpenses))) - PL_CORE.cogs;
    const opexVar = Math.round(monthlyExpBudget * monthsElapsed * (PL_CORE.operatingExpenses / Math.max(1, PL_CORE.cogs + PL_CORE.operatingExpenses))) - PL_CORE.operatingExpenses;

    const waterfall: { label: string; value: number; type: 'total' | 'positive' | 'negative' }[] = [
      { label: 'Budgeted EBITDA', value: Math.round(monthlyRevBudget * monthsElapsed - monthlyExpBudget * monthsElapsed), type: 'total' },
      { label: 'Revenue Variance', value: revVar, type: revVar >= 0 ? 'positive' : 'negative' },
      { label: 'COGS Variance', value: cogsVar, type: cogsVar >= 0 ? 'positive' : 'negative' },
      { label: 'OpEx Variance', value: opexVar, type: opexVar >= 0 ? 'positive' : 'negative' },
      { label: 'Actual EBITDA', value: PL_CORE.ebitda, type: 'total' },
    ];

    // Forecast Full-Year = run-rate aktual (YTD / bulan berjalan * 12) --
    // proyeksi linear sederhana, konsisten dgn cara Financial Statements
    // menghitung run-rate.
    const runRate = (ytd: number) => Math.round((ytd / monthsElapsed) * 12);
    const cogsBudget = Math.round(annualExpenseBudget * (PL_CORE.cogs / Math.max(1, PL_CORE.cogs + PL_CORE.operatingExpenses)));
    const opExBudget = annualExpenseBudget - cogsBudget;
    const grossProfitBudget = annualRevenueBudget - cogsBudget;
    const ebitdaBudget = annualRevenueBudget - annualExpenseBudget;
    const netProfitBudget = Math.round(ebitdaBudget - PL_CORE.da - PL_CORE.interestExpense - PL_CORE.incomeTax);

    const lines = {
      revenue: { actual: PL_CORE.revenue, budget: annualRevenueBudget, forecast: runRate(PL_CORE.revenue) },
      cogs: { actual: PL_CORE.cogs, budget: cogsBudget, forecast: runRate(PL_CORE.cogs) },
      grossProfit: { actual: PL_CORE.grossProfit, budget: grossProfitBudget, forecast: runRate(PL_CORE.grossProfit) },
      operatingExpenses: { actual: PL_CORE.operatingExpenses, budget: opExBudget, forecast: runRate(PL_CORE.operatingExpenses) },
      ebitda: { actual: PL_CORE.ebitda, budget: ebitdaBudget, forecast: runRate(PL_CORE.ebitda) },
      netProfit: { actual: PL_CORE.netProfit, budget: netProfitBudget, forecast: runRate(PL_CORE.netProfit) },
    };

    return {
      loading,
      isSampleData,
      companyName,
      periodLabel,
      monthsElapsed,
      annualRevenueBudget,
      annualExpenseBudget,
      PL_CORE,
      lines,
      monthlyRows,
      kpis: { totalBudget, totalActual, variance, variancePct, onTrackMonths, overBudgetMonths },
      revenueCategoryVariance,
      expenseCategoryVariance,
      waterfall,
    };
  }, [PL_CORE, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN, loading, isSampleData, companyName, periodLabel]);
}
