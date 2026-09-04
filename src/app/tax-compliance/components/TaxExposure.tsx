'use client';
import React from 'react';
import Icon from '@/components/ui/AppIcon';
import { formatIDR } from '@/lib/financialData';
import { useCurrency } from '@/lib/currency';
import { useTaxComplianceData } from '../lib/taxBridge';

const ICONS: Record<string, string> = {
  'exp-outstanding': 'ClockIcon',
  'exp-overdue': 'CheckCircleIcon',
  'exp-upcoming': 'CalendarDaysIcon',
  'exp-unfiled': 'DocumentTextIcon',
};

const SEVERITY_STYLES: Record<string, { badge: string; bar: string }> = {
  'None': { badge: 'bg-positive-subtle text-positive', bar: 'bg-positive' },
  'Low': { badge: 'bg-info-subtle text-info', bar: 'bg-info' },
  'Medium': { badge: 'bg-warning-subtle text-warning', bar: 'bg-warning' },
  'High': { badge: 'bg-negative-subtle text-negative', bar: 'bg-negative' },
};

export default function TaxExposure() {
  const { fx } = useCurrency();
  const { exposure } = useTaxComplianceData();
  const totalExposure = exposure.filter((e) => e.amount > 0).reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="card-base p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Tax Exposure</h3>
          <p className="text-xs text-muted-foreground mt-0.5">Based on recorded accounting data — not a legal assessment</p>
        </div>
        <div className="text-right">
          <p className="text-2xs text-muted-foreground">Total Exposure</p>
          <p className="text-lg font-bold tabular-nums text-warning">{fx(formatIDR(totalExposure, true))}</p>
        </div>
      </div>

      <div className="space-y-3">
        {exposure.map((item) => {
          const cfg = SEVERITY_STYLES[item.severity];
          const pct = totalExposure > 0 ? (item.amount / totalExposure) * 100 : 0;
          return (
            <div key={item.id} className="rounded-xl border border-border p-4 hover:border-primary/20 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <Icon
                    name={(ICONS[item.id] || 'DocumentTextIcon') as Parameters<typeof Icon>[0]['name']}
                    size={16}
                    className={item.severity === 'None' ? 'text-positive' : item.severity === 'Medium' || item.severity === 'High' ? 'text-warning' : 'text-muted-foreground'}
                  />
                  <span className="text-sm font-semibold text-foreground">{item.category}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-2xs font-semibold px-1.5 py-0.5 rounded-full ${cfg.badge}`}>{item.severity}</span>
                  <span className={`text-sm font-bold tabular-nums ${item.amount > 0 ? 'text-foreground' : 'text-positive'}`}>
                    {item.amount > 0 ? fx(formatIDR(item.amount, true)) : 'Rp 0'}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mb-2">{item.description}</p>
              {item.amount > 0 && (
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
