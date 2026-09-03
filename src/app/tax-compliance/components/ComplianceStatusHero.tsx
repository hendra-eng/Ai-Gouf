'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';

const STATUS_SUMMARY = [
  { label: 'Compliant', count: 8, color: 'text-positive', bg: 'bg-positive-subtle border-positive/20', icon: 'CheckCircleIcon' },
  { label: 'Upcoming', count: 3, color: 'text-info', bg: 'bg-info-subtle border-info/20', icon: 'ClockIcon' },
  { label: 'Due Soon', count: 2, color: 'text-warning', bg: 'bg-warning-subtle border-warning/20', icon: 'ExclamationCircleIcon' },
  { label: 'Attention Required', count: 1, color: 'text-chart-5', bg: 'bg-chart-5/10 border-chart-5/20', icon: 'BellAlertIcon' },
  { label: 'Overdue', count: 0, color: 'text-negative', bg: 'bg-negative-subtle border-negative/20', icon: 'XCircleIcon' },
];

export default function ComplianceStatusHero() {
  return (
    <div className="card-base p-6 bg-gradient-to-br from-card to-muted/40 border-positive/20">
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Left */}
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-positive/10 border border-positive/20 flex items-center justify-center flex-shrink-0">
            <Icon name="ShieldCheckIcon" size={28} className="text-positive" />
          </div>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-2xl font-bold text-foreground">Compliance Overview</h2>
              <span className="px-3 py-1 rounded-full bg-positive-subtle text-positive text-sm font-bold border border-positive/20">
                ✓ Compliant
              </span>
            </div>
            <p className="text-sm text-muted-foreground">PT Nusantara Teknologi Indonesia · Tax Period Aug 2026</p>
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
