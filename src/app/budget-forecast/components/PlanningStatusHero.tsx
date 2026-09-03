'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const STATUS_ITEMS = [
  { label: 'Budget Achievement', value: '94.8%', trend: '+2.1%', status: 'positive', icon: 'CheckCircleIcon' },
  { label: 'Forecast vs Budget', value: '+3.6%', trend: 'Above Plan', status: 'positive', icon: 'ArrowTrendingUpIcon' },
  { label: 'Actual Revenue', value: formatIDR(8_420_000_000, true), trend: 'YTD Aug 2026', status: 'neutral', icon: 'BanknotesIcon' },
  { label: 'Forecast Revenue', value: formatIDR(10_480_000_000, true), trend: 'FY 2026', status: 'positive', icon: 'ChartBarIcon' },
  { label: 'Forecast Confidence', value: '87.3%', trend: 'High Confidence', status: 'positive', icon: 'ShieldCheckIcon' },
];

export default function PlanningStatusHero() {
  const { fx } = useCurrency();
  const achievement = 94.8;

  return (
    <div className="card-base p-6 bg-gradient-to-br from-card to-muted/40 border-primary/20">
      <div className="flex flex-col lg:flex-row lg:items-center gap-6">
        {/* Left: Title + progress */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Icon name="FlagIcon" size={20} className="text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-foreground">FY2026 Financial Plan</h2>
              <p className="text-xs text-muted-foreground">PT Nusantara Teknologi Indonesia · Updated Aug 26, 2026</p>
            </div>
            <span className="ml-auto px-2.5 py-1 rounded-full bg-positive-subtle text-positive text-xs font-semibold border border-positive/20 flex items-center gap-1">
              <Icon name="CheckCircleIcon" size={12} />
              On Track
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground font-medium">Budget Achievement</span>
              <span className="font-bold text-foreground tabular-nums">{achievement}%</span>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-chart-2 transition-all duration-700"
                style={{ width: `${achievement}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{fx('Rp 0')}</span>
              <span>{fx('Budget: Rp 10.20M')}</span>
            </div>
          </div>
        </div>

        {/* Right: Status items */}
        <div className="flex flex-wrap lg:flex-nowrap gap-3">
          {STATUS_ITEMS.map((item) => (
            <div
              key={`status-${item.label}`}
              className="flex-1 min-w-[140px] lg:min-w-[120px] bg-muted/60 border border-border rounded-xl p-3"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon
                  name={item.icon as Parameters<typeof Icon>[0]['name']}
                  size={14}
                  className={item.status === 'positive' ? 'text-positive' : 'text-muted-foreground'}
                />
                <span className="text-2xs text-muted-foreground font-medium">{item.label}</span>
              </div>
              <p className={`text-lg font-bold tabular-nums ${item.status === 'positive' ? 'text-positive' : 'text-foreground'}`}>
                {fx(item.value)}
              </p>
              <p className="text-2xs text-muted-foreground mt-0.5">{item.trend}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
