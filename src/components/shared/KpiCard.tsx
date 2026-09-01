'use client';

import React, { useId } from 'react';
import { AreaChart, Area, YAxis, ResponsiveContainer } from 'recharts';
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
  iconColor = 'text-teal-600',
  iconBg = 'bg-teal-50',
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

  const sparklineStroke = sparklineColor || (isPositive ? '#059669' : '#DC2626');
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

  return (
    <div className={`kpi-card flex flex-col gap-3 ${alert ? 'ring-1 ring-red-200 bg-danger-bg/40' : ''} ${className || ''}`}>
      <div className="flex items-start justify-between">
        {icon && (
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${iconBg}`}>
            <Icon name={icon} size={18} className={iconColor} />
          </div>
        )}
        {normalizedSparkline && normalizedSparkline.length > 0 && (
          <div className="w-20 h-11 ml-auto relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={normalizedSparkline} margin={{ top: 5, right: 1, left: 1, bottom: 3 }}>
                <defs>
                  <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparklineStroke} stopOpacity={0.4} />
                    <stop offset="55%" stopColor={sparklineStroke} stopOpacity={0.14} />
                    <stop offset="85%" stopColor={sparklineStroke} stopOpacity={0.03} />
                    <stop offset="100%" stopColor={sparklineStroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={sparklineDomain} />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={sparklineStroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill={`url(#${gradientId})`}
                  dot={false}
                  activeDot={{ r: 3, fill: sparklineStroke, strokeWidth: 0 }}
                  isAnimationActive={false}
                  baseValue={sparklineDomain ? sparklineDomain[0] : 'dataMin'}
                />
              </AreaChart>
            </ResponsiveContainer>
            {/* subtle baseline so the fade has a clear resting edge instead of a hard clip */}
            <div className="absolute inset-x-0 bottom-0 h-px bg-border/60 pointer-events-none" />
          </div>
        )}
      </div>
      <div>
        <p className="text-xs font-medium text-text-secondary mb-1">{displayTitle}</p>
        <p className={`text-xl font-bold font-mono ${valueColor || 'text-text-primary'}`}>
          {prefix}{formattedValue}{suffix}
        </p>
        {subLabel && <p className="text-2xs text-muted-foreground mt-0.5">{subLabel}</p>}
      </div>
      {changeText && (
        <div className="flex items-center gap-1.5">
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${changeNeutral ? 'text-muted-foreground' : isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
            {!changeNeutral && (
              <Icon name={isPositive ? 'ArrowTrendingUpIcon' : 'ArrowTrendingDownIcon'} size={13} />
            )}
            {changeText}
          </span>
          {isNumericChange && <span className="text-xs text-text-muted">{changeLabel}</span>}
        </div>
      )}
    </div>
  );
}