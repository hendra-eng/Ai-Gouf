'use client';
// [BARU] ─── JEMBATAN DATA ANALYTICS → FINANCIAL ANOMALY DETECTION ────────
// Pola sama seperti financialInsights.ts / liabilitiesBridge.ts: daftar
// "Financial Anomalies" di bawah BUKAN model ML/agent AI terpisah,
// melainkan deviasi current vs previous (MoM) yang dihitung dari data REAL
// client aktif -- expenseBreakdown/revenueByCategory/growth.revenue dari
// useAnalyticsData.ts, ditambah sebaran AR per-customer dari arBridge.ts
// (sumber yang sama dengan halaman Account Receivable) -- menggantikan 5
// baris hardcoded (anom-1..5) yang sebelumnya statis.
//
// Ambang batas (threshold) deviasi %:
//  - Expense category: >=40% High, >=20% Medium, >=10% Low, di bawah itu diabaikan
//  - Revenue (total, MoM): deviasi negatif (di bawah bulan sebelumnya) yang
//    ditandai -- >=15% High, >=7% Medium/Low tergantung arah; kenaikan besar
//    juga ditandai sebagai info-level, bukan cuma penurunan.
//  - Accounts Receivable per customer: dibandingkan RATA-RATA AR seluruh
//    customer aktif -- customer dgn AR jauh di atas rata-rata (>=75% lebih
//    tinggi) ditandai sebagai anomali konsentrasi.
// Ambang ini best-effort (belum ada baseline statistik/historical
// std-dev dari backend), ditandai jelas sebagai deviasi vs bulan
// sebelumnya/rata-rata, bukan klaim fraud/kesalahan.

import type { Customer } from '@/lib/mockData';
import type { useAnalyticsData } from './useAnalyticsData';

type AnalyticsData = ReturnType<typeof useAnalyticsData>;

export type AnomalySeverity = 'High' | 'Medium' | 'Low';
export type AnomalyCategory = 'Expenses' | 'Revenue' | 'Accounts Receivable';

export interface FinancialAnomaly {
  id: string;
  metric: string;
  category: AnomalyCategory;
  currentValue: number;
  expectedValue: number;
  difference: number;
  diffPct: number;
  severity: AnomalySeverity;
  description: string;
  period: string;
}

function expenseSeverity(absPct: number): AnomalySeverity | null {
  if (absPct >= 40) return 'High';
  if (absPct >= 20) return 'Medium';
  if (absPct >= 10) return 'Low';
  return null;
}

/** Bangun daftar anomali dari expense/revenue/AR data real -- pengganti 5 baris hardcoded. */
export function generateAnomalies(params: {
  analytics: AnalyticsData;
  customers: Customer[];
  rp: (v: number) => string;
}): FinancialAnomaly[] {
  const { analytics, customers } = params;
  const { expenseBreakdown, growth, absolutes, periodLabel } = analytics;
  const RP_JUTA = 1_000_000;
  const out: FinancialAnomaly[] = [];

  // 1) Expense categories — current vs previous month per kategori.
  expenseBreakdown.forEach((cat) => {
    const absPct = Math.abs(cat.growth);
    const severity = expenseSeverity(absPct);
    if (!severity) return;
    const current = cat.current * RP_JUTA;
    const expected = cat.previous * RP_JUTA;
    out.push({
      id: `anom-exp-${cat.id}`,
      metric: `${cat.name} Expenses`,
      category: 'Expenses',
      currentValue: current,
      expectedValue: expected,
      difference: current - expected,
      diffPct: cat.growth,
      severity,
      description: `Unusual movement detected — ${cat.name.toLowerCase()} spend ${cat.growth >= 0 ? 'above' : 'below'} last month's level by ${absPct.toFixed(1)}%.`,
      period: periodLabel,
    });
  });

  // 2) Total revenue — MoM deviation.
  const revAbsPct = Math.abs(growth.revenue);
  if (revAbsPct >= 7) {
    const current = absolutes.revenue.current * RP_JUTA;
    const expected = absolutes.revenue.previous * RP_JUTA;
    const severity: AnomalySeverity = revAbsPct >= 15 ? 'High' : revAbsPct >= 10 ? 'Medium' : 'Low';
    out.push({
      id: 'anom-revenue',
      metric: `Revenue — ${periodLabel}`,
      category: 'Revenue',
      currentValue: current,
      expectedValue: expected,
      difference: current - expected,
      diffPct: growth.revenue,
      severity,
      description: growth.revenue < 0
        ? `Unusual movement detected — revenue below the previous month's trajectory. Deviation exceeds the ${revAbsPct >= 15 ? '15%' : '7%'} threshold.`
        : `Unusual movement detected — revenue significantly above the previous month's trajectory (${absPctLabel(growth.revenue)}).`,
      period: periodLabel,
    });
  }

  // 3) AR concentration per customer — dibandingkan rata-rata AR seluruh customer aktif.
  if (customers.length >= 2) {
    const avgAR = customers.reduce((s, c) => s + c.totalAR, 0) / customers.length;
    if (avgAR > 0.01) {
      const worst = [...customers].sort((a, b) => b.totalAR - a.totalAR)[0];
      const diffPct = ((worst.totalAR - avgAR) / avgAR) * 100;
      if (diffPct >= 75) {
        out.push({
          id: `anom-ar-${worst.id}`,
          metric: `${worst.name} AR`,
          category: 'Accounts Receivable',
          currentValue: worst.totalAR,
          expectedValue: avgAR,
          difference: worst.totalAR - avgAR,
          diffPct,
          severity: diffPct >= 150 ? 'High' : diffPct >= 100 ? 'Medium' : 'Low',
          description: `Unusual movement detected — AR balance for this customer is significantly above the average customer balance. DSO: ${worst.dso} days.`,
          period: periodLabel,
        });
      }
    }
  }

  return out.sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct)).slice(0, 8);
}

function absPctLabel(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export function countBySeverity(anomalies: FinancialAnomaly[]): Record<AnomalySeverity, number> {
  const counts: Record<AnomalySeverity, number> = { High: 0, Medium: 0, Low: 0 };
  anomalies.forEach((a) => { counts[a.severity] += 1; });
  return counts;
}
