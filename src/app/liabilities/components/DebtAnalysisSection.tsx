'use client';
import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useCurrency, formatMoney } from '@/lib/currency';
import type { DebtMetrics, LiabilityObligation, MaturityBucket } from '../lib/liabilitiesBridge';

// Data contoh — tampil hanya kalau belum ada client aktif / belum ada jurnal (isSampleData).
const SAMPLE_MATURITY: MaturityBucket[] = [
  { bucket: '\u226430 days', amount: 182, color: '#dc2626' },
  { bucket: '31\u201390 days', amount: 340, color: '#d97706' },
  { bucket: '3\u20136 months', amount: 280, color: '#f59e0b' },
  { bucket: '6\u201312 months', amount: 458, color: '#2563eb' },
  { bucket: '1\u20133 years', amount: 520, color: '#7c3aed' },
  { bucket: '3+ years', amount: 360, color: '#16a34a' },
];

const SAMPLE_METRICS: DebtMetrics = {
  totalDebt: 860_000_000,
  shortTermDebt: 240_000_000,
  longTermDebt: 620_000_000,
  shortTermPct: 27.9,
  longTermPct: 72.1,
  debtToEquity: 0.18,
  interestExpenseYtd: 48_200_000,
  interestCoverage: 12.7,
};

interface DebtAnalysisSectionProps {
  isSampleData: boolean;
  companyName: string | null;
  metrics: DebtMetrics;
  maturityBuckets: MaturityBucket[];
  nearestObligation: LiabilityObligation | null;
}

export default function DebtAnalysisSection({ isSampleData, companyName, metrics, maturityBuckets, nearestObligation }: DebtAnalysisSectionProps) {
  const { fx } = useCurrency();
  const rp = (v: number) => fx(formatMoney(v, 'IDR'));

  const maturityData = isSampleData ? SAMPLE_MATURITY : maturityBuckets;
  const m = isSampleData ? SAMPLE_METRICS : metrics;
  const hasAnyDebt = maturityData.some((b) => b.amount > 0);

  const debtMetrics = [
    { label: 'Total Debt', value: rp(m.totalDebt), sub: 'Short + Long-term' },
    { label: 'Short-Term Debt', value: rp(m.shortTermDebt), sub: `${m.shortTermPct}% of total debt` },
    { label: 'Long-Term Debt', value: rp(m.longTermDebt), sub: `${m.longTermPct}% of total debt` },
    {
      label: 'Debt-to-Equity',
      value: m.debtToEquity !== null ? `${m.debtToEquity}x` : 'N/A',
      sub: m.debtToEquity !== null ? (m.debtToEquity < 1 ? 'Healthy leverage' : 'Above 1.0x threshold') : 'Equity data unavailable',
    },
    {
      label: 'Interest Coverage',
      value: m.interestCoverage !== null ? `${m.interestCoverage}x` : 'N/A',
      sub: m.interestCoverage !== null ? 'Est. EBIT / Interest Exp.' : 'No interest expense found',
    },
    {
      label: 'Interest Expense',
      value: m.interestExpenseYtd !== null ? rp(m.interestExpenseYtd) : 'N/A',
      sub: m.interestExpenseYtd !== null ? 'YTD, from posted journals' : 'No "Beban Bunga" account found',
    },
  ];

  const deRatioPct = m.debtToEquity !== null ? Math.min(100, Math.round(m.debtToEquity * 100)) : 0;
  const deHealthy = m.debtToEquity !== null && m.debtToEquity < 1;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
      {/* Debt Maturity Chart */}
      <div className="xl:col-span-2 fin-card p-5">
        <div className="mb-4">
          <div className="text-[14px] font-600 text-foreground">Debt Maturity Profile</div>
          <div className="text-[11px] text-muted-foreground">
            Upcoming obligation schedule{companyName ? ` — ${companyName}` : ''}
          </div>
        </div>

        {/* Urgency callout — derived from the nearest real obligation, not hardcoded */}
        {!isSampleData && nearestObligation && (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 mb-4 border ${nearestObligation.status === 'overdue' ? 'bg-negative-subtle border-red-200' : 'bg-warning-subtle border-amber-200'}`}>
            <span className={`w-2 h-2 rounded-full inline-block ${nearestObligation.status === 'overdue' ? 'bg-negative' : 'bg-warning'}`} />
            <span className={`text-[12px] font-600 ${nearestObligation.status === 'overdue' ? 'text-negative' : 'text-warning'}`}>
              {nearestObligation.status === 'overdue'
                ? fx(`${formatMoney(nearestObligation.amount, 'IDR')} overdue by ${Math.abs(nearestObligation.daysRemaining)} days`)
                : fx(`${formatMoney(nearestObligation.amount, 'IDR')} due within ${nearestObligation.daysRemaining} days`)}
            </span>
            <span className="text-[11px] text-muted-foreground ml-1 truncate">— {nearestObligation.liability} ({nearestObligation.creditor})</span>
          </div>
        )}
        {isSampleData && (
          <div className="flex items-center gap-2 bg-negative-subtle border border-red-200 rounded-lg px-3 py-2 mb-4">
            <span className="w-2 h-2 rounded-full bg-negative inline-block" />
            <span className="text-[12px] font-600 text-negative">{fx('Rp 182M due within 30 days')}</span>
            <span className="text-[11px] text-muted-foreground ml-1">— Sample: Tax payable</span>
          </div>
        )}

        {!isSampleData && !hasAnyDebt ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="text-[12px] text-muted-foreground">No outstanding liability obligations found for this client yet.</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={maturityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="bucket" tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}M`} />
              <Tooltip
                contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                formatter={(v: number) => [fx(`Rp ${v.toLocaleString('id-ID')}M`), 'Obligations']}
              />
              <Bar dataKey="amount" radius={[3, 3, 0, 0]} name="Obligations">
                {maturityData.map((entry, i) => (
                  <Cell key={`maturity-cell-${i}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Debt Metrics */}
      <div className="fin-card p-5">
        <div className="text-[14px] font-600 text-foreground mb-0.5">Debt Analysis</div>
        <div className="text-[11px] text-muted-foreground mb-4">Key debt ratios and metrics</div>
        <div className="space-y-3">
          {debtMetrics.map((m2, i) => (
            <div key={`debt-metric-${i}`} className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
              <div>
                <div className="text-[12px] font-500 text-foreground">{m2.label}</div>
                <div className="text-[10px] text-muted-foreground">{m2.sub}</div>
              </div>
              <div className="text-[14px] font-700 text-foreground financial-value">{m2.value}</div>
            </div>
          ))}
        </div>

        {/* D/E Ratio visual */}
        <div className="mt-4 pt-4 border-t border-border">
          <div className="text-[11px] font-600 text-muted-foreground mb-2">Debt-to-Equity Ratio</div>
          {m.debtToEquity !== null ? (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-full h-2">
                  <div className={`h-2 rounded-full ${deHealthy ? 'bg-primary' : 'bg-negative'}`} style={{ width: `${deRatioPct}%` }} />
                </div>
                <span className={`text-[11px] font-600 ${deHealthy ? 'text-positive' : 'text-negative'}`}>
                  {m.debtToEquity}x — {deHealthy ? 'Healthy' : 'Elevated'}
                </span>
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                <span>0x</span>
                <span>Threshold: 1.0x</span>
              </div>
            </>
          ) : (
            <div className="text-[11px] text-muted-foreground">Equity balance not available yet — ratio will appear once equity accounts have posted balances.</div>
          )}
        </div>
      </div>
    </div>
  );
}
