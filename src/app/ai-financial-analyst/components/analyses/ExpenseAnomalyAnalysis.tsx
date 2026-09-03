'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { useCurrency } from '@/lib/currency';

const anomalies = [
  { id: 'anom-001', account: 'IT Infrastructure — Server', amount: 96000000, expected: 35000000, variance: 61000000, variancePct: 174.3, date: '2026-06-20', vendor: 'PT Infratech Solusi', risk: 'High', explanation: 'Emergency server replacement not in budget. Invoice overdue 69 days.' },
  { id: 'anom-002', account: 'Marketing — Digital Campaigns', amount: 68000000, expected: 45000000, variance: 23000000, variancePct: 51.1, date: '2026-07-15', vendor: 'PT Kreasi Utama', risk: 'Medium', explanation: 'Campaign spend exceeded approved budget. No pre-approval obtained.' },
  { id: 'anom-003', account: 'Travel & Entertainment', amount: 42000000, expected: 18000000, variance: 24000000, variancePct: 133.3, date: '2026-08-10', vendor: 'Various', risk: 'Medium', explanation: 'T&E expenses significantly above baseline. Multiple team offsites in August.' },
  { id: 'anom-004', account: 'Software Licenses', amount: 68000000, expected: 52000000, variance: 16000000, variancePct: 30.8, date: '2026-08-18', vendor: 'PT Daya Cipta Digital', risk: 'Low', explanation: 'License renewal includes new seats added in Q2. Partially expected.' },
  { id: 'anom-005', account: 'Professional Fees', amount: 45000000, expected: 28000000, variance: 17000000, variancePct: 60.7, date: '2026-08-16', vendor: 'CV Prima Konsultan', risk: 'Medium', explanation: 'Additional consulting scope added without formal change order.' },
];

export default function ExpenseAnomalyAnalysis() {
  const router = useRouter();
  const { fx } = useCurrency();

  return (
    <div className="space-y-6">
      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-3">
          <Icon name="DocumentTextIcon" size={16} className="text-ai-purple" />
          <h3 className="text-md font-semibold text-foreground">Executive Summary</h3>
        </div>
        <p className="text-sm text-foreground/80 leading-relaxed">
          AI analysis detected <strong>5 expense anomalies</strong> with a total variance of <strong>{fx('Rp 141M')} above expected range</strong>.
          The most significant is IT Infrastructure (PT Infratech Solusi) at +174.3% over baseline — this emergency server replacement
          was not budgeted and the invoice remains overdue. Marketing digital campaigns also exceeded approval thresholds.
          Combined, these anomalies represent <strong>10.2% of total operating expenses</strong> and require management review and corrective action.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Anomalies Detected', value: '5', color: 'text-foreground', bg: 'bg-card' },
          { label: 'Total Variance', value: 'Rp 141M', color: 'text-danger', bg: 'bg-danger-bg' },
          { label: 'High Risk Items', value: '1', color: 'text-danger', bg: 'bg-danger-bg' },
        ]?.map((m) => (
          <div key={`anom-m-${m?.label}`} className={`${m?.bg} border border-border rounded-lg p-4`}>
            <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{m?.label}</p>
            <p className={`text-3xl font-bold tabular-nums ${m?.color}`}>{fx(m?.value ?? '')}</p>
          </div>
        ))}
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <h3 className="text-md font-semibold text-foreground mb-4">Detected Anomalies</h3>
        <div className="space-y-3">
          {anomalies?.map((anom) => (
            <div
              key={anom?.id}
              className={`border rounded-lg p-4 ${
                anom?.risk === 'High' ? 'border-danger/30 bg-danger-bg/20' :
                anom?.risk === 'Medium'? 'border-warning/30 bg-warning-bg/20' : 'border-border bg-secondary/20'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-foreground">{anom?.account}</p>
                    <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold ${
                      anom?.risk === 'High' ? 'bg-danger-bg text-danger-foreground' :
                      anom?.risk === 'Medium' ? 'bg-warning-bg text-warning-foreground' :
                      'bg-secondary text-muted-foreground'
                    }`}>{anom?.risk} Risk</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{anom?.vendor} · {anom?.date}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold tabular-nums text-foreground">{fx(`Rp ${(anom?.amount / 1000000)?.toFixed(0)}M`)}</p>
                  <p className={`text-xs font-semibold ${anom?.risk === 'High' ? 'text-danger' : 'text-warning'}`}>
                    +{fx(`Rp ${(anom?.variance / 1000000)?.toFixed(0)}M`)} (+{anom?.variancePct?.toFixed(1)}%)
                  </p>
                </div>
              </div>

              {/* Expected vs Actual bar */}
              <div className="mb-2">
                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                  <span>Expected: {fx(`Rp ${(anom?.expected / 1000000)?.toFixed(0)}M`)}</span>
                  <span>Actual: {fx(`Rp ${(anom?.amount / 1000000)?.toFixed(0)}M`)}</span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden relative">
                  <div className="h-full bg-success rounded-full" style={{ width: `${(anom?.expected / anom?.amount) * 100}%` }} />
                  <div className="absolute top-0 h-full rounded-full bg-danger/60" style={{ left: `${(anom?.expected / anom?.amount) * 100}%`, width: `${100 - (anom?.expected / anom?.amount) * 100}%` }} />
                </div>
              </div>

              <p className="text-xs text-muted-foreground italic">{anom?.explanation}</p>

              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => router?.push('/transactions')}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  View Transactions
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => router?.push('/accounts-payable')}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  View Vendor
                </button>
                <span className="text-muted-foreground">·</span>
                <button
                  onClick={() => toast?.success('Investigation initiated')}
                  className="text-xs text-primary hover:underline font-medium"
                >
                  Investigate
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card-elevated-md rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon name="LightBulbIcon" size={16} className="text-warning" />
          <h3 className="text-md font-semibold text-foreground">AI Recommendations</h3>
        </div>
        <div className="space-y-3">
          {[
            { priority: 'High', title: 'Review IT Infrastructure Approval Process', desc: 'Emergency purchases above Rp 50M should require CFO pre-approval. Implement purchase order controls.', action: 'View Transactions', route: '/transactions' },
            { priority: 'Medium', title: 'Enforce Marketing Budget Controls', desc: 'Digital campaign spend exceeded approved budget without escalation. Implement real-time budget tracking with alerts.', action: 'View Report', route: '/reports' },
            { priority: 'Medium', title: 'T&E Policy Review', desc: 'August T&E spike (+133%) requires policy reinforcement and post-event expense reporting.', action: 'View Transactions', route: '/transactions' },
          ]?.map((rec) => (
            <div key={`ea-rec-${rec?.title}`} className="flex items-start gap-3 p-3 border border-border rounded-lg">
              <span className={`text-2xs px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0 mt-0.5 ${
                rec?.priority === 'High' ? 'bg-danger-bg text-danger-foreground' : 'bg-warning-bg text-warning-foreground'
              }`}>{rec?.priority}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{rec?.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{fx(rec?.desc ?? '')}</p>
              </div>
              <button onClick={() => router?.push(rec?.route)} className="text-xs text-primary hover:underline font-medium flex-shrink-0 whitespace-nowrap">
                {rec?.action} →
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}