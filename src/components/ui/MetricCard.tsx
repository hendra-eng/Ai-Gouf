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

  // Gaya kartu disamakan dengan kartu KPI halaman Sales (monokrom: garis aksen atas, border abu, hover hitam).

  const TrendIcon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus;
  const trendColor = isPositive ? 'text-positive' : isNegative ? 'text-negative' : 'text-muted-foreground';
  const sparkColor = isPositive ? 'var(--positive)' : isNegative ? 'var(--negative)' : 'var(--primary)';

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden rounded-[10px] border border-neutral-300 bg-white p-4 pt-5 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-neutral-700 hover:ring-1 hover:ring-neutral-700 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-800" />
      {isWarning && (
        <div className="absolute top-3 right-3">
          <AlertTriangle size={14} className="text-warning" />
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="mb-1 truncate text-xs font-semibold uppercase tracking-wide text-neutral-600" title={label}>
            {label}
          </p>
          <p className={`truncate font-semibold tabular-nums tracking-tight text-neutral-900 ${hero ? 'text-2xl' : 'text-lg'}`}>
            {value}
          </p>
          {subtitle && (
            <p className="mt-1 text-[11px] font-medium text-neutral-500">{subtitle}</p>
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

      <div className="mt-3 flex items-center gap-1.5">
        <div className={`flex items-center gap-1 ${trendColor}`}>
          <TrendIcon size={12} />
          <span className="text-xs font-semibold tabular-nums">
            {isPositive ? '+' : ''}{change.toFixed(1)}%
          </span>
        </div>
        <span className="text-[11px] font-medium text-neutral-500">{changePeriod}</span>
      </div>
    </div>
  );
}
