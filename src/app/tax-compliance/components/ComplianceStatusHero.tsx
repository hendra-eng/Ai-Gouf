'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { useActiveClient } from '@/lib/activeClient';
import { useTaxComplianceData } from '../lib/taxBridge';

export default function ComplianceStatusHero() {
  const { activeClientName } = useActiveClient();
  const { statusCounts, ppn, isSampleData } = useTaxComplianceData();

  const STATUS_SUMMARY = [
    { label: 'Compliant', count: statusCounts.compliant, color: 'text-positive', bg: 'bg-positive-subtle border-positive/20', icon: 'CheckCircleIcon' },
    { label: 'Upcoming', count: statusCounts.upcoming, color: 'text-info', bg: 'bg-info-subtle border-info/20', icon: 'ClockIcon' },
    { label: 'Due Soon', count: statusCounts.dueSoon, color: 'text-warning', bg: 'bg-warning-subtle border-warning/20', icon: 'ExclamationCircleIcon' },
    { label: 'Attention Required', count: statusCounts.attention, color: 'text-chart-5', bg: 'bg-chart-5/10 border-chart-5/20', icon: 'BellAlertIcon' },
    { label: 'Overdue', count: statusCounts.overdue, color: 'text-negative', bg: 'bg-negative-subtle border-negative/20', icon: 'XCircleIcon' },
  ];
  const isCompliant = statusCounts.overdue === 0;

  return (
    <div className="card-base p-6 bg-gradient-to-br from-card to-muted/40 border-positive/20">
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Left */}
        <div className="flex items-start gap-4">
          <div className={`w-14 h-14 rounded-2xl border flex items-center justify-center flex-shrink-0 ${isCompliant ? 'bg-positive/10 border-positive/20' : 'bg-negative/10 border-negative/20'}`}>
            <Icon name="ShieldCheckIcon" size={28} className={isCompliant ? 'text-positive' : 'text-negative'} />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-bold text-foreground">Compliance Overview</h2>
              <span className={`px-3 py-1 rounded-full text-sm font-bold border ${isCompliant ? 'bg-positive-subtle text-positive border-positive/20' : 'bg-negative-subtle text-negative border-negative/20'}`}>
                {isCompliant ? '✓ Compliant' : '⚠ Needs Attention'}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {activeClientName || 'No active client'} · Tax Period {ppn.latestPeriod || '—'}
              {isSampleData && ' · Sample data'}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Internal compliance dashboard indicator — not an official government compliance certificate.
            </p>
          </div>
        </div>

        {/* Right: status breakdown */}
        <div className="flex flex-wrap gap-3 lg:ml-auto">
          {STATUS_SUMMARY.map((s) => (
            <div
              key={`cs-${s.label}`}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${s.bg} min-w-[130px]`}
            >
              <Icon name={s.icon as Parameters<typeof Icon>[0]['name']} size={18} className={s.color} />
              <div>
                <p className={`text-xl font-bold tabular-nums ${s.color}`}>{s.count}</p>
                <p className="text-2xs text-muted-foreground font-medium">{s.label}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
