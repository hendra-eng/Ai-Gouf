'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData } from '../lib/taxBridge';

const STATUS_COLORS: Record<string, { text: string; badge: string }> = {
  positive: { text: 'text-positive', badge: 'bg-positive-subtle text-positive' },
  warning: { text: 'text-warning', badge: 'bg-warning-subtle text-warning' },
  negative: { text: 'text-negative', badge: 'bg-negative-subtle text-negative' },
  neutral: { text: 'text-foreground', badge: 'bg-muted text-muted-foreground' },
};

export default function TaxKPICards() {
  const { fx } = useCurrency();
  const { byType, ppn, exposure } = useTaxComplianceData();

  const pph21 = byType.find((t) => t.taxType === 'PPh 21');
  const pph23 = byType.find((t) => t.taxType === 'PPh 23');
  const pph25 = byType.find((t) => t.taxType === 'PPh 25');
  const upcoming = exposure.find((e) => e.id === 'exp-upcoming')?.amount || 0;
  const overdue = exposure.find((e) => e.id === 'exp-overdue')?.amount || 0;

  const CARDS = [
    { id: 'tax-payable', label: 'Total Tax Payable', value: ppn.netPayable + (pph21?.outstanding || 0) + (pph23?.outstanding || 0) + (pph25?.outstanding || 0), sub: ppn.latestPeriod || 'Latest period', icon: 'ReceiptPercentIcon', status: 'warning' },
    { id: 'tax-receivable', label: 'Input VAT Credit', value: ppn.inputVAT, sub: 'From purchases', icon: 'ArrowDownCircleIcon', status: 'positive' },
    { id: 'ppn', label: 'PPN (VAT)', value: ppn.netPayable, sub: 'Output - Input', icon: 'DocumentTextIcon', status: 'neutral' },
    { id: 'pph21', label: 'PPh 21', value: pph21?.current || 0, sub: 'Employee income tax', icon: 'UserGroupIcon', status: 'neutral' },
    { id: 'pph23', label: 'PPh 23', value: pph23?.current || 0, sub: 'Withholding tax', icon: 'ArrowsRightLeftIcon', status: 'neutral' },
    { id: 'pph2529', label: 'PPh 25/29', value: pph25?.current || 0, sub: 'Corporate income tax', icon: 'BuildingOfficeIcon', status: 'neutral' },
    { id: 'upcoming', label: 'Upcoming Tax', value: upcoming, sub: 'Next 30 days', icon: 'ClockIcon', status: upcoming > 0 ? 'warning' : 'positive' },
    { id: 'overdue', label: 'Overdue Tax', value: overdue, sub: overdue > 0 ? 'Requires attention' : 'No overdue items', icon: 'ExclamationTriangleIcon', status: overdue > 0 ? 'negative' : 'positive' },
  ];

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
                {card.sub}
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
