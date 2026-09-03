'use client';
import React from 'react';
import { toast } from 'sonner';
import Icon from '@/components/ui/AppIcon';
import { formatIDR, FINANCIALS, BUDGET, FORECAST, calcVariance } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

interface KPICard {
  id: string;
  label: string;
  actual: number;
  budget: number;
  forecast: number;
  icon: string;
  invertVariance?: boolean;
}

const CARDS: KPICard[] = [
  { id: 'rev-budget', label: 'Revenue Budget', actual: FINANCIALS.revenue, budget: BUDGET.revenue, forecast: FORECAST.revenue, icon: 'BanknotesIcon' },
  { id: 'ebitda-budget', label: 'EBITDA Budget', actual: FINANCIALS.ebitda, budget: BUDGET.ebitda, forecast: FORECAST.ebitda, icon: 'ChartBarIcon' },
  { id: 'net-profit-budget', label: 'Net Profit Budget', actual: FINANCIALS.netProfit, budget: BUDGET.netProfit, forecast: FORECAST.netProfit, icon: 'ArrowTrendingUpIcon' },
  { id: 'cogs-budget', label: 'COGS Budget', actual: FINANCIALS.cogs, budget: BUDGET.cogs, forecast: FORECAST.cogs, icon: 'CubeIcon', invertVariance: true },
  { id: 'opex-budget', label: 'OpEx Budget', actual: FINANCIALS.operatingExpenses, budget: BUDGET.operatingExpenses, forecast: FORECAST.operatingExpenses, icon: 'ReceiptPercentIcon', invertVariance: true },
  { id: 'gross-profit-budget', label: 'Gross Profit Budget', actual: FINANCIALS.grossProfit, budget: BUDGET.grossProfit, forecast: FORECAST.grossProfit, icon: 'CurrencyDollarIcon' },
  { id: 'rev-forecast', label: 'Revenue Forecast', actual: FINANCIALS.revenue, budget: BUDGET.revenue, forecast: FORECAST.revenue, icon: 'ArrowPathIcon' },
  { id: 'total-variance', label: 'Total Budget Variance', actual: FINANCIALS.netProfit, budget: BUDGET.netProfit, forecast: FORECAST.netProfit, icon: 'ScaleIcon' },
];

export default function BudgetKPICards() {
  const { fx } = useCurrency();
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
      {CARDS.map((card) => {
        const { diff, pct } = calcVariance(card.actual, card.budget);
        const isPositive = card.invertVariance ? diff <= 0 : diff >= 0;
        const forecastVar = calcVariance(card.forecast, card.budget);
        const forecastPositive = card.invertVariance ? forecastVar.diff <= 0 : forecastVar.diff >= 0;

        return (
          <div
            key={card.id}
            onClick={() => toast.info(card.label, { description: `Aktual: ${fx(formatIDR(card.actual, true))} · Budget: ${fx(formatIDR(card.budget, true))} · Forecast: ${fx(formatIDR(card.forecast, true))}` })}
            className="rounded-xl border p-4 bg-card border-border hover:shadow-card-md transition-all duration-200 cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Icon name={card.icon as Parameters<typeof Icon>[0]['name']} size={14} className="text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${isPositive ? 'bg-positive-subtle text-positive' : 'bg-negative-subtle text-negative'}`}>
                {isPositive ? '▲' : '▼'} {Math.abs(pct).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 leading-tight truncate">{card.label}</p>
            <p className="number-display font-bold text-xl text-foreground leading-tight">
              {fx(formatIDR(card.actual, true))}
            </p>
            <div className="mt-2 pt-2 border-t border-border space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground">Budget</span>
                <span className="text-2xs font-medium text-foreground number-display">{fx(formatIDR(card.budget, true))}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-2xs text-muted-foreground">Forecast</span>
                <span className={`text-2xs font-medium number-display ${forecastPositive ? 'text-positive' : 'text-negative'}`}>
                  {fx(formatIDR(card.forecast, true))}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
