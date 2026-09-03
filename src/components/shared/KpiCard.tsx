'use client';

import React, { useId } from 'react';
import { AreaChart, Area, YAxis, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown } from 'lucide-react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/transactionData';

interface KpiCardProps {
  title?: string;
  /** Alias for `title`, used by AP/AR-style callers. */
  label?: string;
  value: number | string;
  /** Either a plain number (e.g. 3.1) or a pre-formatted string (e.g. "+3.1% vs prev period"). */
  change?: number | string;
  changeLabel?: string;
  /** Secondary line shown under the value, used by AP/AR-style callers. */
  subLabel?: string;
  /** Explicit color override when `change` is a string (can't be inferred from a string's sign reliably). */
  changePositive?: boolean;
  /** When true, render the change text in neutral gray with no up/down arrow. */
  changeNeutral?: boolean;
  /** When true, adds a subtle alert highlight to the card. */
  alert?: boolean;
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  sparklineData?: { value: number }[] | number[];
  /** Explicit stroke color override for the sparkline. */
  sparklineColor?: string;
  compact?: boolean;
  prefix?: string;
  suffix?: string;
  valueColor?: string;
  className?: string;
}

export default function KpiCard({
  title,
  label,
  value,
  change,
  changeLabel = 'vs prev period',
  subLabel,
  changePositive,
  changeNeutral,
  alert,
  icon,
  iconColor = 'text-primary',
  iconBg = 'bg-muted',
  sparklineData,
  sparklineColor,
  compact = false,
  prefix,
  suffix,
  valueColor,
  className,
}: KpiCardProps) {
  const displayTitle = title ?? label ?? '';
  const formattedValue = typeof value === 'number' ? formatIDR(value, compact) : value;

  // Normalize sparklineData to [{ value: number }] regardless of which shape was passed in.
  const normalizedSparkline = sparklineData
    ? (sparklineData as any[]).map((d) => (typeof d === 'number' ? { value: d } : d))
    : undefined;

  const isNumericChange = typeof change === 'number';
  const isPositive = changeNeutral
    ? false
    : changePositive !== undefined
    ? changePositive
    : isNumericChange
    ? (change as number) >= 0
    : typeof change === 'string'
    ? !change.trim().startsWith('-')
    : false;

  const changeText = isNumericChange
    ? `${isPositive ? '+' : ''}${(change as number).toFixed(1)}%`
    : (change as string | undefined);

  // Use the same design tokens as the Financial Overview's MetricCard (var(--positive)/var(--negative))
  // instead of hardcoded hex, so sparklines stay in sync if the theme colors ever change.
  const sparklineStroke = sparklineColor || (isPositive ? 'var(--positive)' : 'var(--negative)');
  const gradientId = `kpiSpark-${useId().replace(/:/g, '')}`;

  // Pad the Y domain so the curve's peak/trough never touches the tiny chart's
  // top/bottom edge — without this the area fill (the reddish/greenish "shadow")
  // gets clamped hard against the container edge instead of tapering away
  // naturally, which is what made it look like the shadow sat in the wrong spot.
  let sparklineDomain: [number, number] | undefined;
  if (normalizedSparkline && normalizedSparkline.length > 0) {
    const values = normalizedSparkline.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const pad = range > 0 ? range * 0.35 : Math.max(Math.abs(max) * 0.2, 1);
    sparklineDomain = [min - pad, max + pad];
  }

  // Card shell matches MetricCard exactly: rounded-xl, 1px border, shadow only on hover
  // (instead of the old kpi-card class which had a permanent 2px border + heavy shadow).
  const cardBg = alert ? 'bg-negative-subtle border-negative/20' : 'bg-card border-border';

  return (
    <div
      className={`relative rounded-xl border p-4 ${cardBg} hover:shadow-card-md transition-all duration-200 ${className || ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {icon && (
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mb-2 ${iconBg}`}>
              <Icon name={icon} size={18} className={iconColor} />
            </div>
          )}
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 truncate">
            {displayTitle}
          </p>
          <p className={`number-display font-bold leading-none text-xl ${valueColor || 'text-foreground'}`}>
            {prefix}{formattedValue}{suffix}
          </p>
          {subLabel && <p className="text-xs text-muted-foreground mt-1">{subLabel}</p>}
        </div>

        {normalizedSparkline && normalizedSparkline.length > 0 && (
          <div className="w-16 h-10 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={normalizedSparkline} margin={{ top: 5, right: 1, left: 1, bottom: 3 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineStroke} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={sparklineStroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={sparklineDomain} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={sparklineStroke}
                  strokeWidth={1.5}
                  dot={false}
                  fill={`url(#${gradientId})`}
                  isAnimationActive={false}
                  baseValue={sparklineDomain ? sparklineDomain[0] : 'dataMin'}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {changeText && (
        <div className="flex items-center gap-1.5 mt-3">
          <div className={`flex items-center gap-1 ${changeNeutral ? 'text-muted-foreground' : isPositive ? 'text-positive' : 'text-negative'}`}>
            {!changeNeutral && (isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />)}
            <span className="text-xs font-semibold font-mono-nums">{changeText}</span>
          </div>
          {isNumericChange && <span className="text-xs text-muted-foreground">{changeLabel}</span>}
        </div>
      )}
    </div>
  );
}