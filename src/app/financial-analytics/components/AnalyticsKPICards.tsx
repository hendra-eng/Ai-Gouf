'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { useAnalyticsData } from '../lib/useAnalyticsData';

function fmtChange(delta: number, decimals = 1, suffix = 'pp'): string {
  const sign = delta >= 0 ? '+' : '';
  return `${sign}${delta.toFixed(decimals)}${suffix}`;
}

export default function AnalyticsKPICards() {
  const router = useRouter();
  const data = useAnalyticsData();
  const { margins, liquidity, solvency, growth, isSampleData } = data;

  const CARDS = [
    { id: 'rev-growth', label: 'Revenue Growth', value: `${growth.revenue >= 0 ? '+' : ''}${growth.revenue.toFixed(1)}%`, prev: '\u2014', change: growth.revenue >= 0 ? 'Growing' : 'Declining', status: growth.revenue >= 0 ? 'positive' : 'negative', icon: 'ArrowTrendingUpIcon', benchmark: '>10%', route: '/ai-financial-analyst?analysis=profit-decrease' },
    { id: 'gross-margin', label: 'Gross Margin', value: `${margins.gross.current.toFixed(1)}%`, prev: `${margins.gross.previous.toFixed(1)}%`, change: fmtChange(margins.gross.current - margins.gross.previous), status: margins.gross.current >= margins.gross.previous ? 'positive' : 'negative', icon: 'ChartBarIcon', benchmark: '>40%', route: '/financial-statements/profit-loss' },
    { id: 'ebitda-margin', label: 'EBITDA Margin', value: `${margins.ebitda.current.toFixed(1)}%`, prev: `${margins.ebitda.previous.toFixed(1)}%`, change: fmtChange(margins.ebitda.current - margins.ebitda.previous), status: margins.ebitda.current >= margins.ebitda.previous ? 'positive' : 'negative', icon: 'CurrencyDollarIcon', benchmark: '>20%', route: '/financial-statements/profit-loss' },
    { id: 'net-margin', label: 'Net Margin', value: `${margins.net.current.toFixed(1)}%`, prev: `${margins.net.previous.toFixed(1)}%`, change: fmtChange(margins.net.current - margins.net.previous), status: margins.net.current >= margins.net.previous ? 'positive' : 'negative', icon: 'BanknotesIcon', benchmark: '>15%', route: '/financial-statements/profit-loss' },
    { id: 'current-ratio', label: 'Current Ratio', value: liquidity.currentRatio.current.toFixed(2), prev: liquidity.currentRatio.previous.toFixed(2), change: fmtChange(liquidity.currentRatio.current - liquidity.currentRatio.previous, 2, ''), status: liquidity.currentRatio.current >= liquidity.currentRatio.previous ? 'positive' : 'negative', icon: 'ScaleIcon', benchmark: '>2.0', route: '/ai-financial-analyst?analysis=cash-flow' },
    { id: 'quick-ratio', label: 'Quick Ratio', value: liquidity.quickRatio.current.toFixed(2), prev: liquidity.quickRatio.previous.toFixed(2), change: fmtChange(liquidity.quickRatio.current - liquidity.quickRatio.previous, 2, ''), status: liquidity.quickRatio.current >= liquidity.quickRatio.previous ? 'positive' : 'negative', icon: 'BoltIcon', benchmark: '>1.0', route: '/ai-financial-analyst?analysis=cash-flow' },
    { id: 'debt-equity', label: 'Debt-to-Equity', value: solvency.debtToEquity.current.toFixed(2), prev: solvency.debtToEquity.previous.toFixed(2), change: fmtChange(solvency.debtToEquity.current - solvency.debtToEquity.previous, 2, ''), status: solvency.debtToEquity.current <= solvency.debtToEquity.previous ? 'positive' : 'negative', icon: 'ArrowsRightLeftIcon', benchmark: '<0.5', route: '/financial-statements/balance-sheet' },
    { id: 'roe', label: 'Return on Equity', value: `${margins.roe.current.toFixed(1)}%`, prev: `${margins.roe.previous.toFixed(1)}%`, change: fmtChange(margins.roe.current - margins.roe.previous), status: margins.roe.current >= margins.roe.previous ? 'positive' : 'negative', icon: 'TrophyIcon', benchmark: '>15%', route: '/ai-financial-analyst?analysis=profit-decrease' },
  ];

  return (
    <div>
      {isSampleData && (
        <p className="text-xs text-muted-foreground mb-2">Showing sample data</p>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
        {CARDS.map((card) => (
          <div
            key={card.id}
            onClick={() => router?.push(card.route)}
            className="rounded-xl border p-4 bg-card border-border hover:shadow-card-md transition-all duration-200 cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Icon name={card.icon as Parameters<typeof Icon>[0]['name']} size={14} className="text-muted-foreground group-hover:text-chart-4 transition-colors" />
              </div>
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${
                card.status === 'positive' ? 'bg-positive-subtle text-positive' : 'bg-negative-subtle text-negative'
              }`}>
                {card.change}
              </span>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 leading-tight truncate">{card.label}</p>
            <p className="number-display font-bold text-xl text-foreground leading-tight">{card.value}</p>
            <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
              <span className="text-2xs text-muted-foreground">Prev: {card.prev}</span>
              <span className="text-2xs text-muted-foreground">Target: {card.benchmark}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
