'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useActiveClient } from '@/lib/activeClient';
import { useBudgetData } from '../lib/budgetBridge';

export default function PlanningStatusHero() {
  const { fx } = useCurrency();
  const { activeClientName } = useActiveClient();
  const { kpis, lines, periodLabel, isSampleData } = useBudgetData();

  const achievement = kpis.totalBudget !== 0 ? Math.round((kpis.totalActual / kpis.totalBudget) * 1000) / 10 : 0;
  const forecastVsBudget = lines.revenue.budget !== 0 ? ((lines.revenue.forecast - lines.revenue.budget) / lines.revenue.budget) * 100 : 0;
  const isOnTrack = achievement >= 95;
  const forecastConfidence = Math.max(50, Math.min(95, 95 - Math.abs(forecastVsBudget) * 2));

  const STATUS_ITEMS = [
    { label: 'Budget Achievement', value: `${achievement}%`, trend: kpis.variance >= 0 ? 'Above budget' : 'Below budget', status: achievement >= 95 ? 'positive' : 'neutral', icon: 'CheckCircleIcon' },
    { label: 'Forecast vs Budget', value: `${forecastVsBudget >= 0 ? '+' : ''}${forecastVsBudget.toFixed(1)}%`, trend: forecastVsBudget >= 0 ? 'Above Plan' : 'Below Plan', status: forecastVsBudget >= 0 ? 'positive' : 'neutral', icon: 'ArrowTrendingUpIcon' },
    { label: 'Actual Revenue', value: formatIDR(kpis.totalActual * 1_000_000, true), trend: `YTD ${periodLabel || ''}`, status: 'neutral', icon: 'BanknotesIcon' },
    { label: 'Forecast Revenue', value: formatIDR(lines.revenue.forecast * 1_000_000, true), trend: 'Full Year', status: 'positive', icon: 'ChartBarIcon' },
    { label: 'Forecast Confidence', value: `${forecastConfidence.toFixed(1)}%`, trend: forecastConfidence >= 80 ? 'High Confidence' : 'Moderate Confidence', status: forecastConfidence >= 80 ? 'positive' : 'neutral', icon: 'ShieldCheckIcon' },
  ];

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
              <h2 className="text-xl font-bold text-foreground">Financial Plan</h2>
              <p className="text-xs text-muted-foreground">
                {activeClientName || 'No active client'} · {periodLabel || 'Year to date'}
                {isSampleData ? ' · Sample data' : ''}
              </p>
            </div>
            <span className={`ml-auto px-2.5 py-1 rounded-full text-xs font-semibold border flex items-center gap-1 ${isOnTrack ? 'bg-positive-subtle text-positive border-positive/20' : 'bg-warning-subtle text-warning border-warning/20'}`}>
              <Icon name={isOnTrack ? 'CheckCircleIcon' : 'ExclamationCircleIcon'} size={12} />
              {isOnTrack ? 'On Track' : 'Behind Plan'}
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
                style={{ width: `${Math.min(100, Math.max(0, achievement))}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{fx(formatIDR(kpis.totalActual * 1_000_000, true))}</span>
              <span>{fx(`Budget: ${formatIDR(kpis.totalBudget * 1_000_000, true)}`)}</span>
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
