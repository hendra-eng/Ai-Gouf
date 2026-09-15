'use client';

// [BARU] Kartu KPI kecil khusus buat tab-tab baru di halaman /transactions
// (Sales, Purchase, Journal Entry, Cash & Bank, Other). File-file yang
// dibuat/diedit di folder tabs/ semula memanggil `@/components/ui/KpiCard`
// dengan props (label, value, subValue, trend, trendLabel, icon, variant) —
// komponen itu TIDAK ADA di project ini (yang ada cuma
// src/components/shared/KpiCard.tsx dengan API yang beda: title/change/dst).
// Daripada ubah props di puluhan pemanggilan, komponen ini dibuat supaya
// API-nya persis sama dengan yang sudah dipakai di semua file tab.
import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';

type KpiVariant = 'positive' | 'negative' | 'warning' | 'info' | 'default';

interface TabKpiCardProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: number;
  trendLabel?: string;
  icon?: React.ReactNode;
  variant?: KpiVariant;
  className?: string;
}

const VARIANT_STYLES: Record<KpiVariant, { iconBg: string; iconColor: string }> = {
  positive: { iconBg: 'bg-positive-subtle', iconColor: 'text-positive' },
  negative: { iconBg: 'bg-negative-subtle', iconColor: 'text-negative' },
  warning: { iconBg: 'bg-warning-subtle', iconColor: 'text-warning' },
  info: { iconBg: 'bg-info-subtle', iconColor: 'text-info' },
  default: { iconBg: 'bg-muted', iconColor: 'text-muted-foreground' },
};

export default function TabKpiCard({
  label,
  value,
  subValue,
  trend,
  trendLabel,
  icon,
  variant = 'default',
  className = '',
}: TabKpiCardProps) {
  const styles = VARIANT_STYLES[variant] ?? VARIANT_STYLES.default;
  const hasTrend = typeof trend === 'number' && !Number.isNaN(trend);
  const isPositiveTrend = hasTrend && (trend as number) >= 0;

  return (
    <div
      className={`rounded-xl border border-border bg-card p-4 hover:shadow-card-md transition-all duration-200 ${className}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 truncate">
            {label}
          </p>
          <p className="number-display font-bold leading-none text-xl text-foreground">{value}</p>
          {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
        </div>
        {icon && (
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${styles.iconBg} ${styles.iconColor}`}
          >
            {icon}
          </div>
        )}
      </div>
      {hasTrend && (
        <div className="flex items-center gap-1.5 mt-3">
          <div className={`flex items-center gap-1 ${isPositiveTrend ? 'text-positive' : 'text-negative'}`}>
            {isPositiveTrend ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            <span className="text-xs font-semibold font-mono-nums">
              {isPositiveTrend ? '+' : ''}
              {trend}%
            </span>
          </div>
          {trendLabel && <span className="text-xs text-muted-foreground">{trendLabel}</span>}
        </div>
      )}
    </div>
  );
}
