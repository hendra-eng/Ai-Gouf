'use client';
import React from 'react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

interface SparkPoint { v: number; }

interface FinancialKPICardProps {
  label: string;
  value: string;
  subValue?: string;
  change: number;
  changeLabel?: string;
  sparkData: SparkPoint[];
  status?: 'positive' | 'negative' | 'warning' | 'neutral';
  highlight?: boolean;
  onClick?: () => void;
  tooltip?: string;
}

function formatChange(change: number) {
  const sign = change >= 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

export default function FinancialKPICard({
  label, value, subValue, change, changeLabel, sparkData, status = 'neutral', highlight, onClick, tooltip
}: FinancialKPICardProps) {
  const isPositive = change >= 0;
  const changeColor = status === 'negative' ? 'text-negative' : status === 'warning' ? 'text-warning' : isPositive ? 'text-positive' : 'text-negative';
  const sparkColor = status === 'negative' ? '#dc2626' : status === 'warning' ? '#d97706' : isPositive ? '#16a34a' : '#dc2626';

  const cardBg = highlight
    ? status === 'negative' ? 'bg-negative-subtle border-red-200'
    : status === 'warning'? 'bg-warning-subtle border-amber-200' :'bg-card border-border' :'bg-card border-border';

  return (
    <div
      className={`relative rounded-xl border ${cardBg} p-4 cursor-pointer hover:shadow-card-md transition-all duration-200 active:scale-[0.99] group ${onClick ? 'hover:-translate-y-0.5' : ''}`}
      onClick={onClick}
      title={tooltip}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5">{label}</p>
          <p className="number-display font-bold text-foreground leading-none text-xl">{value}</p>
          {subValue && <p className="text-xs text-muted-foreground mt-1">{subValue}</p>}
          <div className={`flex items-center gap-1.5 mt-3 text-xs font-semibold ${changeColor}`}>
            <span>{isPositive ? '↗' : '↘'}</span>
            <span className="font-mono-nums">{formatChange(change)}</span>
            {changeLabel && <span className="text-muted-foreground font-normal">{changeLabel}</span>}
          </div>
        </div>
        <div className="w-16 h-10 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sparkData}>
              <Line type="monotone" dataKey="v" stroke={sparkColor} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
