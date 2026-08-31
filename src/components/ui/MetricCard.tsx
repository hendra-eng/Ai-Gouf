'use client';
import React from 'react';
import { TrendingUp, TrendingDown, Minus, AlertTriangle } from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';

interface SparklinePoint {
  v: number;
}

interface MetricCardProps {
  id: string;
  label: string;
  value: string;
  change: number;
  changePeriod: string;
  sparkline?: SparklinePoint[];
  status?: 'positive' | 'negative' | 'warning' | 'neutral';
  alert?: string;
  subtitle?: string;
  onClick?: () => void;
  hero?: boolean;
}

export default function MetricCard({
  label, value, change, changePeriod, sparkline, status = 'neutral', alert, subtitle, onClick, hero = false
}: MetricCardProps) {
  const isPositive = change > 0;
  const isNegative = change < 0;
  const isWarning = status === 'warning';

  const cardBg = isWarning
    ? 'bg-warning-subtle border-warning/30'
    : status === 'negative' ?'bg-negative-subtle border-negative/20' :'bg-card border-border';

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const trendColor = isPositive ? 'text-positive' : isNegative ? 'text-negative' : 'text-muted-foreground';
  const sparkColor = isPositive ? 'var(--positive)' : isNegative ? 'var(--negative)' : 'var(--primary)';

  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl border p-4 ${cardBg} ${onClick ? 'cursor-pointer hover:shadow-card-md transition-all duration-200 active:scale-[0.99]' : ''} ${hero ? 'p-5' : ''}`}
    >
      {isWarning && (
        <div className="absolute top-3 right-3">
          <AlertTriangle size={14} className="text-warning" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 ${hero ? 'text-sm' : ''}`}>
            {label}
          </p>
          <p className={`number-display font-bold text-foreground leading-none ${hero ? 'text-3xl' : 'text-xl'}`}>
            {value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          )}
          {alert && (
            <p className="text-xs font-semibold text-warning mt-1.5">{alert}</p>
          )}
        </div>

        {sparkline && sparkline.length > 0 && (
          <div className="w-16 h-10 flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkline} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                <defs>
                  <linearGradient id={`spark-${label.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={sparkColor} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={sparkColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={sparkColor}
                  strokeWidth={1.5}
                  fill={`url(#spark-${label.replace(/\s/g, '')})`}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className={`flex items-center gap-1.5 mt-3 ${hero ? 'mt-4' : ''}`}>
        <div className={`flex items-center gap-1 ${trendColor}`}>
          <TrendIcon size={12} />
          <span className="text-xs font-semibold font-mono-nums">
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <span className="text-xs text-muted-foreground">{changePeriod}</span>
      </div>
    </div>
  );
}
