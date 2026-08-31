'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';

interface KpiCardProps {
  label: string;
  value: string;
  subLabel?: string;
  change?: string;
  changePositive?: boolean;
  changeNeutral?: boolean;
  alert?: boolean;
  alertLabel?: string;
  sparklineData?: number[];
  sparklineColor?: string;
  className?: string;
  size?: 'default' | 'large';
}

export default function KpiCard({
  label,
  value,
  subLabel,
  change,
  changePositive,
  changeNeutral,
  alert,
  alertLabel,
  sparklineData,
  sparklineColor = 'var(--primary)',
  className = '',
  size = 'default',
}: KpiCardProps) {
  // Simple SVG sparkline
  const renderSparkline = () => {
    if (!sparklineData || sparklineData.length < 2) return null;
    const max = Math.max(...sparklineData);
    const min = Math.min(...sparklineData);
    const range = max - min || 1;
    const w = 72;
    const h = 28;
    const points = sparklineData.map((v, i) => {
      const x = (i / (sparklineData.length - 1)) * w;
      const y = h - ((v - min) / range) * (h - 4) - 2;
      return `${x},${y}`;
    });
    return (
      <svg width={w} height={h} className="overflow-visible">
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={sparklineColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  return (
    <div
      className={`bg-card rounded-lg border border-border p-4 shadow-card ${
        alert ? 'border-l-2 border-l-warning bg-warning-bg/30' : ''
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-2xs font-600 text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
          <p className={`tabular-nums font-700 text-foreground leading-tight ${size === 'large' ? 'text-4xl' : 'text-2xl'}`}>
            {value}
          </p>
          {subLabel && <p className="text-xs text-muted-foreground mt-0.5">{subLabel}</p>}
          {alertLabel && (
            <p className="text-xs font-600 text-warning mt-0.5">{alertLabel}</p>
          )}
          {change && (
            <div className="flex items-center gap-1 mt-1.5">
              {!changeNeutral && (
                <Icon
                  name={changePositive ? 'ArrowTrendingUpIcon' : 'ArrowTrendingDownIcon'}
                  size={12}
                  className={changePositive ? 'text-success' : 'text-danger'}
                />
              )}
              <span className={`text-xs font-600 ${
                changeNeutral ? 'text-muted-foreground' : changePositive ? 'text-success' : 'text-danger'
              }`}>
                {change}
              </span>
            </div>
          )}
        </div>
        {sparklineData && (
          <div className="flex-shrink-0 opacity-80">{renderSparkline()}</div>
        )}
      </div>
    </div>
  );
}