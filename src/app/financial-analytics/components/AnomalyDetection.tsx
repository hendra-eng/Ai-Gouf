'use client';
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency, formatMoney } from '@/lib/currency';
import { useAnalyticsData } from '../lib/useAnalyticsData';
import { useTransactions } from '@/app/transactions/context/TransactionsContext';
import { invoicesFromTransactions, customersFromInvoices } from '@/app/transactions/lib/arBridge';
import { generateAnomalies, countBySeverity, type FinancialAnomaly } from '../lib/anomalyDetection';

// [BARU] Anomali sekarang di-generate dari data REAL client aktif -- lihat
// lib/anomalyDetection.ts (pola sama seperti financialInsights.ts /
// liabilitiesBridge.ts) -- menggantikan 5 baris hardcoded (anom-1..5).
// Sumber datanya: useAnalyticsData.ts (expense/revenue MoM, sudah
// tersambung ke trial balance bulanan backend) + arBridge.ts (sebaran AR
// per customer, sumber yang sama dengan halaman Account Receivable).
const SAMPLE_ANOMALIES: FinancialAnomaly[] = [
  {
    id: 'anom-1',
    metric: 'Marketing Expenses',
    category: 'Expenses',
    currentValue: 202_000_000,
    expectedValue: 164_000_000,
    difference: 38_000_000,
    diffPct: 23.2,
    severity: 'Medium',
    description: 'Unusual movement detected — marketing spend significantly above historical average for this period.',
    period: 'Aug 2026',
  },
  {
    id: 'anom-2',
    metric: 'Technology Expenses',
    category: 'Expenses',
    currentValue: 138_000_000,
    expectedValue: 108_000_000,
    difference: 30_000_000,
    diffPct: 27.8,
    severity: 'Medium',
    description: 'Unusual movement detected — technology infrastructure costs increased above typical monthly run rate.',
    period: 'Aug 2026',
  },
  {
    id: 'anom-3',
    metric: 'Revenue — Aug 2026',
    category: 'Revenue',
    currentValue: 700_000_000,
    expectedValue: 850_000_000,
    difference: -150_000_000,
    diffPct: -17.6,
    severity: 'High',
    description: 'Unusual movement detected — August revenue below expected trajectory. Deviation exceeds 15% threshold.',
    period: 'Aug 2026',
  },
  {
    id: 'anom-4',
    metric: 'CV Mitra Digital AR',
    category: 'Accounts Receivable',
    currentValue: 380_000_000,
    expectedValue: 120_000_000,
    difference: 260_000_000,
    diffPct: 216.7,
    severity: 'High',
    description: 'Unusual movement detected — AR balance for this customer is significantly above normal collection pattern. DSO: 239 days.',
    period: 'Aug 2026',
  },
  {
    id: 'anom-5',
    metric: 'Travel & Entertainment',
    category: 'Expenses',
    currentValue: 41_000_000,
    expectedValue: 28_000_000,
    difference: 13_000_000,
    diffPct: 46.4,
    severity: 'Low',
    description: 'Unusual movement detected — travel expenses above average. Spike may relate to Q3 sales conference.',
    period: 'Aug 2026',
  },
];

const SEVERITY_STYLES: Record<string, { badge: string; row: string; icon: string }> = {
  High: { badge: 'bg-negative-subtle text-negative border-negative/20', row: 'border-l-2 border-l-negative', icon: 'text-negative' },
  Medium: { badge: 'bg-warning-subtle text-warning border-warning/20', row: 'border-l-2 border-l-warning', icon: 'text-warning' },
  Low: { badge: 'bg-info-subtle text-info border-info/20', row: 'border-l-2 border-l-info', icon: 'text-info' },
};

// Maps an anomaly's category to the closest AI Analyst analysis type
const CATEGORY_ANALYSIS: Record<string, string> = {
  'Expenses': 'expense-anomaly',
  'Revenue': 'profit-decrease',
  'Accounts Receivable': 'ar-risk',
};

export default function AnomalyDetection() {
  const router = useRouter();
  const { fx } = useCurrency();
  const [expanded, setExpanded] = useState<string | null>(null);
  const analytics = useAnalyticsData();
  const { transactions } = useTransactions();

  const customers = useMemo(() => {
    const invoices = invoicesFromTransactions(transactions);
    return customersFromInvoices(invoices);
  }, [transactions]);

  const rp = (v: number) => fx(formatMoney(v, 'IDR'));

  const anomalies = useMemo(() => {
    if (analytics.isSampleData) return SAMPLE_ANOMALIES;
    return generateAnomalies({ analytics, customers, rp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analytics, customers]);

  const counts = useMemo(() => countBySeverity(anomalies), [anomalies]);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-xl font-semibold text-foreground">Financial Anomalies</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Unusual movements in financial data — not indicative of fraud or misconduct
          </p>
        </div>
        <div className="flex items-center gap-2">
          {counts.High > 0 && (
            <span className="text-xs font-semibold text-negative bg-negative-subtle px-2.5 py-1 rounded-full border border-negative/20">
              {counts.High} High
            </span>
          )}
          {counts.Medium > 0 && (
            <span className="text-xs font-semibold text-warning bg-warning-subtle px-2.5 py-1 rounded-full border border-warning/20">
              {counts.Medium} Medium
            </span>
          )}
          {counts.Low > 0 && (
            <span className="text-xs font-semibold text-info bg-info-subtle px-2.5 py-1 rounded-full border border-info/20">
              {counts.Low} Low
            </span>
          )}
        </div>
      </div>

      {anomalies.length === 0 ? (
        <div className="text-xs text-muted-foreground py-6 text-center">
          No notable deviations detected in this client&apos;s posted journals yet.
        </div>
      ) : (
        <div className="space-y-3">
          {anomalies.map((anomaly) => {
            const cfg = SEVERITY_STYLES[anomaly.severity];
            const isExpanded = expanded === anomaly.id;
            const isPositiveDiff = anomaly.difference > 0;

            return (
              <div
                key={anomaly.id}
                className={`rounded-xl border border-border p-4 transition-all duration-150 hover:border-primary/20 cursor-pointer ${cfg.row}`}
                onClick={() => setExpanded(isExpanded ? null : anomaly.id)}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-9 h-9 rounded-xl bg-muted flex items-center justify-center flex-shrink-0 mt-0.5`}>
                    <Icon name="ExclamationTriangleIcon" size={16} className={cfg.icon} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-foreground">{anomaly.metric}</span>
                        <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full border ${cfg.badge}`}>
                          {anomaly.severity}
                        </span>
                        <span className="text-2xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                          {anomaly.category}
                        </span>
                      </div>
                      <span className="text-xs text-muted-foreground flex-shrink-0">{anomaly.period}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed mb-3">{anomaly.description}</p>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div>
                        <p className="text-2xs text-muted-foreground">Current</p>
                        <p className="text-sm font-semibold tabular-nums text-foreground">{fx(formatIDR(anomaly.currentValue, true))}</p>
                      </div>
                      <div>
                        <p className="text-2xs text-muted-foreground">Expected</p>
                        <p className="text-sm font-semibold tabular-nums text-muted-foreground">{fx(formatIDR(anomaly.expectedValue, true))}</p>
                      </div>
                      <div>
                        <p className="text-2xs text-muted-foreground">Difference</p>
                        <p className={`text-sm font-semibold tabular-nums ${isPositiveDiff ? 'text-negative' : 'text-warning'}`}>
                          {isPositiveDiff ? '+' : ''}{fx(formatIDR(anomaly.difference, true))}
                        </p>
                      </div>
                      <div>
                        <p className="text-2xs text-muted-foreground">Deviation</p>
                        <p className={`text-sm font-semibold tabular-nums ${Math.abs(anomaly.diffPct) > 20 ? 'text-negative' : 'text-warning'}`}>
                          {isPositiveDiff ? '+' : ''}{anomaly.diffPct.toFixed(1)}%
                        </p>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-border flex items-center gap-3 animate-fade-in">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router?.push(`/ai-financial-analyst?analysis=${CATEGORY_ANALYSIS[anomaly.category] || 'profit-decrease'}`);
                          }}
                          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80 transition-colors px-3 py-1.5 rounded-lg bg-primary/10"
                        >
                          <Icon name="MagnifyingGlassIcon" size={12} />
                          Analyze
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router?.push('/transactions');
                          }}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
                        >
                          <Icon name="TableCellsIcon" size={12} />
                          View Transactions
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router?.push('/transactions');
                          }}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-lg hover:bg-muted"
                        >
                          <Icon name="DocumentTextIcon" size={12} />
                          View Journal Entries
                        </button>
                      </div>
                    )}
                  </div>
                  <Icon
                    name={isExpanded ? 'ChevronUpIcon' : 'ChevronDownIcon'}
                    size={16}
                    className="text-muted-foreground flex-shrink-0 mt-1"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
