'use client';
// ─── JEMBATAN DATA REAL → BUDGET & FORECAST ────────────────────────────────
// "Actual" pada seluruh halaman ini diambil dari useProfitLossData() -- hook
// REAL yang sama yang sudah dipakai halaman Financial Statements (P&L),
// yang mengambil data dari backend (trial balance bulanan client aktif).
//
// [DIUBAH] "Budget" (target rencana) SEKARANG diambil dari tabel
// forecast_assumption (schema 5_Planning) lewat GET
// /api/client/{id}/forecast-assumption -- diisi tombol Apply di
// ForecastAssumptions.tsx.
//
// [DITUNTASKAN] Sebelumnya kalau client belum PERNAH pencet Apply, baris
// forecast_assumption tidak ada sama sekali dan halaman jatuh balik ke
// konstanta hardcoded BUDGET_ASSUMPTIONS di bawah -- artinya "Budget" bisa
// saja TIDAK berasal dari database. Backend (db_client.py::
// ambil_forecast_assumption) sekarang membuat baris default itu SEKALI
// secara otomatis saat baris belum ada, jadi setelah request pertama,
// setiap client SELALU punya baris asli di tabel. BUDGET_ASSUMPTIONS di
// bawah cuma dipakai kalau field TERTENTU sengaja dikosongkan (null) --
// mis. cogs_pct/tax_rate_pct/interest_expense yang belum tentu client mau
// override manual -- bukan lagi fallback utk "belum pernah Apply sama
// sekali".
//
// [BARU] `capexBudget` & `expectedCollections` mengaktifkan kolom
// forecast_assumption yang sebelumnya tersimpan tapi tidak dipakai
// perhitungan apa pun (capex, collection_rate_pct) -- lihat penggunaannya
// di useBudgetData() dan tampilannya di PlanningStatusHero.tsx.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useActiveClient } from '@/lib/activeClient';
import { ambilForecastAssumption, daftarScenario, tambahScenario, hapusScenario } from '@/app/agent-ai/lib/api';
import { useProfitLossData, type MonthlyPLRow, type BreakdownItem, type PLCoreValues } from '@/app/financial-statements/lib/useProfitLossData';

export const BUDGET_ASSUMPTIONS = {
  revenueGrowth: 0.08, // target pertumbuhan revenue tahunan vs run-rate aktual
  cogsRatioDelta: -0.01, // target efisiensi COGS (rasio thd revenue turun 1pp)
  opExGrowth: 0.05, // target pertumbuhan opex tahunan (di bawah target revenue)
};

/** Baris mentah forecast_assumption dari backend (null field = belum diisi). */
export interface RawForecastAssumption {
  tahun: number;
  revenue_growth_pct: number | null;
  cogs_pct: number | null;
  payroll_growth_pct: number | null;
  opex_growth_pct: number | null;
  collection_rate_pct: number | null;
  tax_rate_pct: number | null;
  capex: number | null;
  interest_expense: number | null;
}

/** Fetch asumsi budget tersimpan client aktif utk tahun berjalan --
 * dipakai useBudgetData() di bawah DAN ForecastAssumptions.tsx (share
 * queryKey ['forecast-assumption', clientId, tahun] supaya konsisten). */
export function useForecastAssumption() {
  const { activeClientId, hydrated } = useActiveClient();
  const tahun = new Date().getFullYear();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['forecast-assumption', activeClientId, tahun],
    queryFn: async () => {
      const res = (await ambilForecastAssumption(activeClientId as string | number, tahun)) as { assumption: RawForecastAssumption | null };
      return res?.assumption ?? null;
    },
    enabled: hydrated && !!activeClientId,
  });
  return { assumption: data ?? null, loading: !hydrated || isLoading, tahun, refetch };
}

/** Skenario custom tersimpan (tabel scenario, schema 5_Planning) -- dipakai
 * ScenarioPlanning.tsx sbg tambahan atas 3 skenario bawaan yang tetap
 * dihitung dari run-rate (skenario custom TIDAK menggantikannya). */
export interface CustomScenario {
  id: string;
  nama_skenario: string;
  revenue_growth_pct: number | null;
  cogs_pct: number | null;
  opex_growth_pct: number | null;
  tax_rate_pct: number | null;
  is_base_case: boolean;
  created_by: string | null;
}

export interface NewScenarioInput {
  nama_skenario: string;
  revenue_growth_pct?: number;
  cogs_pct?: number;
  opex_growth_pct?: number;
  tax_rate_pct?: number;
  is_base_case?: boolean;
}

export function useScenarios() {
  const { activeClientId, hydrated } = useActiveClient();
  const queryClient = useQueryClient();
  const tahun = new Date().getFullYear();
  const { data, isLoading } = useQuery({
    queryKey: ['scenarios', activeClientId, tahun],
    queryFn: async () => {
      const res = (await daftarScenario(activeClientId as string | number, tahun)) as { scenarios: CustomScenario[] };
      return res?.scenarios ?? [];
    },
    enabled: hydrated && !!activeClientId,
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['scenarios', activeClientId, tahun] }),
    [queryClient, activeClientId, tahun]
  );

  const addScenario = useCallback(
    async (input: NewScenarioInput) => {
      if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
      const { nama_skenario, ...nilai } = input;
      await tambahScenario(activeClientId, tahun, nama_skenario, nilai);
      await invalidate();
    },
    [activeClientId, tahun, invalidate]
  );

  const removeScenario = useCallback(
    async (id: string) => {
      if (!activeClientId) throw new Error('Belum ada client yang dipilih.');
      await hapusScenario(activeClientId, id);
      await invalidate();
    },
    [activeClientId, invalidate]
  );

  return { scenarios: data ?? [], loading: !hydrated || isLoading, addScenario, removeScenario };
}

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
  /** Target CapEx tahunan dari asumsi tersimpan (assumption.capex), satuan
   * "Rp M" sama seperti PL_CORE/`lines` lainnya di sini -- dikali 1_000_000
   * hanya saat diformat utk tampilan. Belum ada "actual" pembanding --
   * lihat catatan di ForecastAssumptions.tsx (belum dilacak modul Assets). */
  capexBudget: number;
  /** Proyeksi kas tertagih dari revenue budget tahunan x collection_rate_pct
   * (assumption.collection_rate_pct). Ini estimasi PENAGIHAN, bukan revenue
   * itu sendiri -- dipakai bareng annualRevenueBudget, bukan pengganti. */
  expectedCollections: number;
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
  const { PL_CORE, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN, loading: plLoading, isSampleData, companyName, periodLabel } = pl;
  const { assumption } = useForecastAssumption();

  return useMemo(() => {
    const monthsElapsed = MONTHLY_PL.length || 1;
    const revenueRunRate = monthsElapsed > 0 ? (PL_CORE.revenue / monthsElapsed) * 12 : 0;
    const cogsRunRate = monthsElapsed > 0 ? (PL_CORE.cogs / monthsElapsed) * 12 : 0;
    const opExRunRate = monthsElapsed > 0 ? (PL_CORE.operatingExpenses / monthsElapsed) * 12 : 0;

    // [DIUBAH] Kalau client sudah pernah "Apply" asumsi (tabel
    // forecast_assumption terisi), pakai angka itu langsung -- revenue &
    // opex dari % pertumbuhan thd run-rate, COGS dari target % thd revenue
    // budget (lebih akurat drpd delta rasio). Kalau belum, fallback ke
    // BUDGET_ASSUMPTIONS lama supaya halaman tetap jalan.
    const revenueGrowthPct = assumption?.revenue_growth_pct ?? BUDGET_ASSUMPTIONS.revenueGrowth * 100;
    const opexGrowthPct = assumption?.opex_growth_pct ?? BUDGET_ASSUMPTIONS.opExGrowth * 100;

    const annualRevenueBudget = Math.round(revenueRunRate * (1 + revenueGrowthPct / 100));
    const monthlyOpexBudget = Math.round((opExRunRate * (1 + opexGrowthPct / 100)) / 12);
    const monthlyCogsBudget = assumption?.cogs_pct != null
      ? Math.round((annualRevenueBudget * (assumption.cogs_pct / 100)) / 12)
      : Math.round((cogsRunRate * (1 + BUDGET_ASSUMPTIONS.cogsRatioDelta)) / 12);
    const monthlyExpBudget = monthlyCogsBudget + monthlyOpexBudget;
    const annualExpenseBudget = monthlyExpBudget * 12;

    const monthlyRevBudget = annualRevenueBudget / 12;
    const interestExpenseBudget = assumption?.interest_expense ?? PL_CORE.interestExpense;
    const ebtBudget = annualRevenueBudget - annualExpenseBudget - PL_CORE.da - interestExpenseBudget;
    const netProfitBudgetAnnual = assumption?.tax_rate_pct != null
      ? ebtBudget - Math.max(0, ebtBudget) * (assumption.tax_rate_pct / 100)
      : ebtBudget - PL_CORE.incomeTax;
    const netMarginTarget = annualRevenueBudget !== 0 ? netProfitBudgetAnnual / annualRevenueBudget : 0;

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
    const cogsVar = Math.round(monthlyCogsBudget * monthsElapsed) - PL_CORE.cogs;
    const opexVar = Math.round(monthlyOpexBudget * monthsElapsed) - PL_CORE.operatingExpenses;

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
    const cogsBudget = Math.round(monthlyCogsBudget * 12);
    const opExBudget = Math.round(monthlyOpexBudget * 12);
    const grossProfitBudget = annualRevenueBudget - cogsBudget;
    const ebitdaBudget = annualRevenueBudget - annualExpenseBudget;
    const netProfitBudget = Math.round(netProfitBudgetAnnual);

    const lines = {
      revenue: { actual: PL_CORE.revenue, budget: annualRevenueBudget, forecast: runRate(PL_CORE.revenue) },
      cogs: { actual: PL_CORE.cogs, budget: cogsBudget, forecast: runRate(PL_CORE.cogs) },
      grossProfit: { actual: PL_CORE.grossProfit, budget: grossProfitBudget, forecast: runRate(PL_CORE.grossProfit) },
      operatingExpenses: { actual: PL_CORE.operatingExpenses, budget: opExBudget, forecast: runRate(PL_CORE.operatingExpenses) },
      ebitda: { actual: PL_CORE.ebitda, budget: ebitdaBudget, forecast: runRate(PL_CORE.ebitda) },
      netProfit: { actual: PL_CORE.netProfit, budget: netProfitBudget, forecast: runRate(PL_CORE.netProfit) },
    };

    // [BARU] CapEx & Collection Rate -- dua kolom forecast_assumption yang
    // sebelumnya cuma tersimpan tanpa dipakai. capex di tabel SUDAH dalam
    // satuan "Rp M" (jutaan) -- satuan yang SAMA dipakai PL_CORE/`lines` di
    // sini (lihat bulatkanJuta() di useProfitLossData.ts) -- jadi TIDAK
    // perlu dikonversi lagi, tinggal dipakai apa adanya supaya konsisten
    // dgn cara PlanningStatusHero.tsx menampilkan field "M" lain (dikali
    // 1_000_000 hanya saat format tampilan, bukan di sini).
    const capexBudget = Math.round(assumption?.capex ?? 0);
    const collectionRatePct = assumption?.collection_rate_pct ?? 95;
    const expectedCollections = Math.round(annualRevenueBudget * (collectionRatePct / 100));

    return {
      loading: plLoading,
      isSampleData,
      companyName,
      periodLabel,
      monthsElapsed,
      annualRevenueBudget,
      annualExpenseBudget,
      capexBudget,
      expectedCollections,
      PL_CORE,
      lines,
      monthlyRows,
      kpis: { totalBudget, totalActual, variance, variancePct, onTrackMonths, overBudgetMonths },
      revenueCategoryVariance,
      expenseCategoryVariance,
      waterfall,
    };
  }, [PL_CORE, MONTHLY_PL, REVENUE_BY_CATEGORY, EXPENSE_BREAKDOWN, plLoading, isSampleData, companyName, periodLabel, assumption]);
}