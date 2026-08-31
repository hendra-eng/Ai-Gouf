'use client';
import React from 'react';
import { useRouter } from 'next/navigation';
import Icon from '@/components/ui/AppIcon';
import { FINANCIALS } from '@/lib/financialData';

const currentRatio = (FINANCIALS.cash + FINANCIALS.accountsReceivable + FINANCIALS.inventory) / FINANCIALS.accountsPayable;
const quickRatio = (FINANCIALS.cash + FINANCIALS.accountsReceivable) / FINANCIALS.accountsPayable;
const debtToEquity = FINANCIALS.totalDebt / FINANCIALS.totalEquity;
const roe = (FINANCIALS.netProfit / FINANCIALS.totalEquity) * 100;

const CARDS = [
  { id: 'rev-growth', label: 'Revenue Growth', value: '12.8%', prev: '9.4%', change: '+3.4pp', status: 'positive', icon: 'ArrowTrendingUpIcon', benchmark: '>10%', route: '/ai-financial-analyst?analysis=profit-decrease' },
  { id: 'gross-margin', label: 'Gross Margin', value: '44.2%', prev: '42.8%', change: '+1.4pp', status: 'positive', icon: 'ChartBarIcon', benchmark: '>40%', route: '/financial-statements/profit-loss' },
  { id: 'ebitda-margin', label: 'EBITDA Margin', value: '27.4%', prev: '25.9%', change: '+1.5pp', status: 'positive', icon: 'CurrencyDollarIcon', benchmark: '>20%', route: '/financial-statements/profit-loss' },
  { id: 'net-margin', label: 'Net Margin', value: '21.9%', prev: '20.1%', change: '+1.8pp', status: 'positive', icon: 'BanknotesIcon', benchmark: '>15%', route: '/financial-statements/profit-loss' },
  { id: 'current-ratio', label: 'Current Ratio', value: currentRatio.toFixed(2), prev: '2.18', change: '+0.23', status: 'positive', icon: 'ScaleIcon', benchmark: '>2.0', route: '/ai-financial-analyst?analysis=cash-flow' },
  { id: 'quick-ratio', label: 'Quick Ratio', value: quickRatio.toFixed(2), prev: '1.94', change: '+0.18', status: 'positive', icon: 'BoltIcon', benchmark: '>1.0', route: '/ai-financial-analyst?analysis=cash-flow' },
  { id: 'debt-equity', label: 'Debt-to-Equity', value: debtToEquity.toFixed(2), prev: '0.24', change: '-0.03', status: 'positive', icon: 'ArrowsRightLeftIcon', benchmark: '<0.5', route: '/financial-statements/balance-sheet' },
  { id: 'roe', label: 'Return on Equity', value: `${roe.toFixed(1)}%`, prev: '18.2%', change: '+3.2pp', status: 'positive', icon: 'TrophyIcon', benchmark: '>15%', route: '/ai-financial-analyst?analysis=profit-decrease' },
];

export default function AnalyticsKPICards() {
  const router = useRouter();

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
      {CARDS.map((card) => (
        <div
          key={card.id}
          onClick={() => router?.push(card.route)}
          className="card-base p-4 hover:border-chart-4/30 transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
              <Icon name={card.icon as Parameters<typeof Icon>[0]['name']} size={14} className="text-muted-foreground group-hover:text-chart-4 transition-colors" />
            </div>
            <span className={`text-2xs font-600 px-1.5 py-0.5 rounded-full ${
              card.status === 'positive' ? 'bg-positive-subtle text-positive' : 'bg-negative-subtle text-negative'
            }`}>
              {card.change}
            </span>
          </div>
          <p className="text-2xs text-muted-foreground font-500 mb-1 leading-tight">{card.label}</p>
          <p className="text-xl font-700 text-foreground font-tabular leading-tight">{card.value}</p>
          <div className="mt-2 pt-2 border-t border-border flex items-center justify-between">
            <span className="text-2xs text-muted-foreground">Prev: {card.prev}</span>
            <span className="text-2xs text-muted-foreground">Target: {card.benchmark}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
