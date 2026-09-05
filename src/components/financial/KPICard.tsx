'use client';

import React from 'react';
import { ArrowTrendingUpIcon, ArrowTrendingDownIcon } from '@heroicons/react/24/outline';
import { useLanguage } from '@/lib/language';

interface KPICardProps {
  title: string;
  value: string;
  change?: number;
  previousLabel?: string;
  previousValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  sparkline?: number[];
  status?: 'positive' | 'negative' | 'neutral' | 'warning';
  subtitle?: string;
  onClick?: () => void;
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 64;
  const h = 40;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  });
  const pathD = `M ${points.join(' L ')}`;
  const areaD = `M ${points[0]} L ${points.join(' L ')} L ${w},${h} L 0,${h} Z`;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#sg-${color})`} />
      <path d={pathD} stroke={color} strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function KPICard({
  title,
  value,
  change,
  previousLabel = 'vs prev period',
  previousValue,
  sparkline,
  status = 'neutral',
  subtitle,
  onClick,
}: KPICardProps) {
  const { t } = useLanguage();
  const isWarning = status === 'warning';
  const isPositive = status === 'positive' || (change !== undefined && change > 0 && status !== 'negative');
  const isNegative = status === 'negative' || (change !== undefined && change < 0 && status !== 'positive');

  // Warna & background kartu mengikuti token tema (sama seperti MetricCard di Overview)
  const cardBg = isWarning
    ? 'bg-warning-subtle border-warning/30'
    : status === 'negative'
    ? 'bg-negative-subtle border-negative/20'
    : 'bg-card border-border';

  const trendColor = isPositive ? 'text-positive' : isNegative ? 'text-negative' : 'text-muted-foreground';
  const sparkColor = isPositive ? '#10b981' : isNegative ? '#ef4444' : '#6366f1';

  return (
    <div
      onClick={onClick}
      className={`relative rounded-xl border p-4 ${cardBg} ${onClick ? 'cursor-pointer hover:shadow-card-md transition-all duration-200 active:scale-[0.99]' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 truncate">
            {t(title)}
          </p>
          <p className="number-display font-bold text-foreground leading-none text-xl">
            {value}
          </p>
          {previousValue ? (
            <p className="text-xs text-muted-foreground mt-1">{t(previousLabel)}: {previousValue}</p>
          ) : subtitle ? (
            <p className="text-xs text-muted-foreground mt-1">{t(subtitle)}</p>
          ) : null}
        </div>

        {sparkline && sparkline.length > 0 && (
          <div className="w-16 h-10 flex-shrink-0">
            <MiniSparkline data={sparkline} color={sparkColor} />
          </div>
        )}
      </div>

      {change !== undefined && (
        <div className="flex items-center gap-1.5 mt-3">
          <div className={`flex items-center gap-1 ${trendColor}`}>
            {isPositive ? (
              <ArrowTrendingUpIcon className="w-3 h-3" />
            ) : isNegative ? (
              <ArrowTrendingDownIcon className="w-3 h-3" />
            ) : null}
            <span className="text-xs font-semibold font-mono-nums">
              {change > 0 ? '+' : ''}{change.toFixed(1)}%
            </span>
          </div>
          <span className="text-xs text-muted-foreground">{t(previousLabel)}</span>
        </div>
      )}
    </div>
  );
}