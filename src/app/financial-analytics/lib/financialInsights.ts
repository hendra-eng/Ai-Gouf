'use client';
// [BARU] ─── JEMBATAN DATA ANALYTICS → AI FINANCIAL INSIGHTS ──────────────
// Pola SAMA seperti liabilitiesBridge.ts::generateLiabilityInsights: kartu
// "AI Financial Insights" di bawah BUKAN pemanggilan agent AI eksternal,
// melainkan kartu insight yang di-generate dari RULE-BASED analysis atas
// data keuangan REAL client aktif -- margins/liquidity/growth/expense dari
// useAnalyticsData.ts (sudah tersambung ke trial balance bulanan backend),
// ditambah konsentrasi piutang per-customer dari arBridge.ts (sama seperti
// yang dipakai halaman Account Receivable) -- menggantikan 4 kartu
// hardcoded yang sebelumnya statis (fa-ai-1..4).
//
// Kalau nanti mau versi "agent AI" sungguhan (LLM call ke backend endpoint
// baru), modul ini tetap jadi tempat yang tepat utk menyiapkan payload
// context-nya -- tinggal ganti isi generateFinancialInsights() jadi
// pemanggil endpoint async; interface FinancialInsight di bawah tidak
// perlu berubah, jadi FinancialAIInsights.tsx tidak perlu ikut diubah.

import type { Customer } from '@/lib/mockData';
import type { useAnalyticsData } from './useAnalyticsData';

type AnalyticsData = ReturnType<typeof useAnalyticsData>;

export interface FinancialInsight {
  id: string;
  title: string;
  summary: string;
  numbers: string[];
  factors: string[];
  recommendation: string;
  severity: 'positive' | 'warning' | 'negative' | 'info';
  icon: string;
  analysisType: string;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

/** Bangun kartu AI Insight dari data analytics + AR customer real -- pengganti 4 kartu hardcoded. */
export function generateFinancialInsights(params: {
  analytics: AnalyticsData;
  customers: Customer[];
  rp: (v: number) => string;
}): FinancialInsight[] {
  const { analytics, customers, rp } = params;
  const { margins, liquidity, growth, absolutes, expenseBreakdown, periodLabel } = analytics;
  const RP_JUTA = 1_000_000;
  const insights: FinancialInsight[] = [];

  // 1) Profitability — arah margin & laba bersih MoM.
  const profitUp = growth.netProfit >= 0;
  insights.push({
    id: 'fa-profit',
    title: profitUp ? 'Profitability: Margin Expansion' : 'Profitability: Margin Under Pressure',
    summary: profitUp
      ? `Net profit grew ${pct(growth.netProfit)} vs the previous month, as revenue growth (${pct(growth.revenue)}) helped move net margin from ${margins.net.previous.toFixed(1)}% to ${margins.net.current.toFixed(1)}%.`
      : `Net profit declined ${pct(growth.netProfit)} vs the previous month. Net margin moved from ${margins.net.previous.toFixed(1)}% to ${margins.net.current.toFixed(1)}%, while revenue growth was ${pct(growth.revenue)}.`,
    numbers: [
      `Revenue Growth: ${pct(growth.revenue)}`,
      `EBITDA Margin: ${margins.ebitda.current.toFixed(1)}%`,
      `Net Margin: ${margins.net.current.toFixed(1)}%`,
      `Net Profit Growth: ${pct(growth.netProfit)}`,
    ],
    factors: profitUp
      ? ['Revenue growth outpaced expense growth', 'Margin held or improved MoM']
      : ['Expense growth outpaced revenue growth', 'Margin compressed MoM'],
    recommendation: profitUp
      ? 'Maintain cost discipline to protect the current margin trend.'
      : 'Review cost drivers behind the margin compression and identify which expense lines grew fastest this month.',
    severity: profitUp ? 'positive' : 'negative',
    icon: 'ChartBarIcon',
    analysisType: 'profit-decrease',
  });

  // 2) Liquidity — posisi kas & current ratio.
  const cashRp = absolutes.cash.current * RP_JUTA;
  const cr = liquidity.currentRatio.current;
  const healthyLiquidity = cr >= 1.5;
  const tightLiquidity = cr < 1;
  insights.push({
    id: 'fa-liquidity',
    title: healthyLiquidity ? 'Liquidity: Cash Position Remains Strong' : tightLiquidity ? 'Liquidity: Cash Position Is Tight' : 'Liquidity: Cash Position Adequate',
    summary: `Cash reserves of ${rp(cashRp)} with a current ratio of ${cr.toFixed(2)}x and quick ratio of ${liquidity.quickRatio.current.toFixed(2)}x this period (${periodLabel}).`,
    numbers: [
      `Cash: ${rp(cashRp)}`,
      `Current Ratio: ${cr.toFixed(2)}x`,
      `Quick Ratio: ${liquidity.quickRatio.current.toFixed(2)}x`,
      `Cash Runway: ${liquidity.cashRunwayMonths.current.toFixed(0)} months`,
    ],
    factors: healthyLiquidity
      ? ['Current ratio comfortably above the 1.5x safety threshold', 'Cash runway provides room to operate']
      : ['Current ratio below the 1.5x safety threshold — monitor short-term obligations closely'],
    recommendation: healthyLiquidity
      ? 'Consider deploying excess cash strategically — short-term instruments or accelerated debt reduction.'
      : 'Tighten collection cycles and review upcoming short-term obligations to avoid a cash crunch.',
    severity: healthyLiquidity ? 'positive' : tightLiquidity ? 'negative' : 'warning',
    icon: 'BanknotesIcon',
    analysisType: 'cash-flow',
  });

  // 3) Receivables concentration — dari data customer real (arBridge.ts), sama sumbernya dgn halaman Account Receivable.
  const totalAR = customers.reduce((s, c) => s + c.totalAR, 0);
  if (totalAR > 0) {
    const worst = [...customers].sort((a, b) => b.overdueAR - a.overdueAR)[0];
    if (worst && worst.overdueAR > 0) {
      const pctOfAR = Math.round((worst.totalAR / totalAR) * 1000) / 10;
      const critical = worst.riskLevel === 'Critical' || worst.riskLevel === 'High';
      insights.push({
        id: 'fa-ar',
        title: 'Receivables: Concentration Risk Requires Attention',
        summary: `${worst.name} carries ${rp(worst.overdueAR)} in overdue receivables (DSO ${worst.dso} days), out of total outstanding AR of ${rp(totalAR)}.`,
        numbers: [
          `Total AR: ${rp(totalAR)}`,
          `${worst.name}: ${rp(worst.overdueAR)} overdue`,
          `DSO: ${worst.dso} days`,
          `Share of Total AR: ${pctOfAR}%`,
        ],
        factors: [`${worst.name} concentration in overdue AR`, `Collection rate: ${worst.collectionRate.toFixed(1)}%`],
        recommendation: `Escalate collection efforts on ${worst.name}. Review credit terms and consider requiring advance payments.`,
        severity: critical ? 'warning' : 'info',
        icon: 'InboxArrowDownIcon',
        analysisType: 'ar-risk',
      });
    }
  }

  // 4) Expense driver — kategori beban yang tumbuh paling cepat dibanding revenue.
  const topExpense = [...expenseBreakdown].sort((a, b) => b.growth - a.growth)[0];
  if (topExpense && topExpense.growth > growth.revenue) {
    insights.push({
      id: 'fa-expense',
      title: `Expenses: ${topExpense.name} Growing Faster Than Revenue`,
      summary: `${topExpense.name} expenses grew ${pct(topExpense.growth)} vs revenue growth of ${pct(growth.revenue)} this period. This divergence warrants review to ensure the spend is generating commensurate returns.`,
      numbers: [
        `${topExpense.name} Growth: ${pct(topExpense.growth)}`,
        `Revenue Growth: ${pct(growth.revenue)}`,
        `${topExpense.name}: ${rp(topExpense.current * RP_JUTA)}`,
      ],
      factors: [`${topExpense.name} outpacing revenue growth`, 'Worth reviewing for one-time vs recurring cost'],
      recommendation: `Review ${topExpense.name} spend drivers and confirm the investment is generating commensurate returns.`,
      severity: 'info',
      icon: 'CpuChipIcon',
      analysisType: 'expense-anomaly',
    });
  }

  return insights.slice(0, 6);
}
