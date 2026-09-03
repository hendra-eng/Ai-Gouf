'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';

const CARDS = [
  { id: 'tax-payable', label: 'Total Tax Payable', value: 182_000_000, sub: 'Aug 2026', icon: 'ReceiptPercentIcon', status: 'warning', trend: '+8.4% vs Jul' },
  { id: 'tax-receivable', label: 'Tax Receivable', value: 48_500_000, sub: 'Input VAT credit', icon: 'ArrowDownCircleIcon', status: 'positive', trend: 'Claimable' },
  { id: 'ppn', label: 'PPN (VAT)', value: 94_200_000, sub: 'Output - Input', icon: 'DocumentTextIcon', status: 'neutral', trend: 'Due Sep 30' },
  { id: 'pph21', label: 'PPh 21', value: 38_400_000, sub: 'Employee income tax', icon: 'UserGroupIcon', status: 'neutral', trend: 'Due Sep 10' },
  { id: 'pph23', label: 'PPh 23', value: 12_800_000, sub: 'Withholding tax', icon: 'ArrowsRightLeftIcon', status: 'neutral', trend: 'Due Sep 10' },
  { id: 'pph2529', label: 'PPh 25/29', value: 36_600_000, sub: 'Corporate income tax', icon: 'BuildingOfficeIcon', status: 'neutral', trend: 'Installment' },
  { id: 'upcoming', label: 'Upcoming Tax', value: 145_000_000, sub: 'Next 30 days', icon: 'ClockIcon', status: 'warning', trend: '3 obligations' },
  { id: 'overdue', label: 'Overdue Tax', value: 0, sub: 'No overdue items', icon: 'ExclamationTriangleIcon', status: 'positive', trend: 'All current' },
];

const STATUS_COLORS: Record<string, { text: string; badge: string }> = {
  positive: { text: 'text-positive', badge: 'bg-positive-subtle text-positive' },
  warning: { text: 'text-warning', badge: 'bg-warning-subtle text-warning' },
  negative: { text: 'text-negative', badge: 'bg-negative-subtle text-negative' },
  neutral: { text: 'text-foreground', badge: 'bg-muted text-muted-foreground' },
};

export default function TaxKPICards() {
  const { fx } = useCurrency();
  const goToObligation = () => {
    document.getElementById('tax-obligations')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-4 2xl:grid-cols-8 gap-3">
      {CARDS.map((card) => {
        const cfg = STATUS_COLORS[card.status];
        return (
          <div key={card.id} onClick={goToObligation} className="rounded-xl border p-4 bg-card border-border hover:shadow-card-md transition-all duration-200 cursor-pointer group">
            <div className="flex items-center justify-between mb-3">
              <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                <Icon name={card.icon as Parameters<typeof Icon>[0]['name']} size={14} className="text-muted-foreground group-hover:text-chart-3 transition-colors" />
              </div>
              <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>
                {card.trend}
              </span>
            </div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 leading-tight truncate">{card.label}</p>
            <p className={`number-display font-bold text-xl leading-tight ${card.value === 0 ? 'text-positive' : cfg.text}`}>
              {card.value === 0 ? 'Rp 0' : fx(formatIDR(card.value, true))}
            </p>
            <p className="text-2xs text-muted-foreground mt-1">{card.sub}</p>
          </div>
        );
      })}
    </div>
  );
}
